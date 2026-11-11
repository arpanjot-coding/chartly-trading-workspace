"""Private read-only connector registry and atomic account-history publication.

Only static, trusted adapters fetch observations. No broker order dispatcher,
global API key, browser account assertion or configuration switch is authority.
"""

import csv
import hashlib
import hmac
import io
import os
from copy import deepcopy
from datetime import UTC, datetime, timedelta

from sqlalchemy import update

from database.workspace_storage_db import principals
from services.connector_history import empty_history, instant, merge_history
from services.connector_records import ConnectorRecords
from services.connector_sync_plan import MAX_WINDOW_DAYS, OVERLAP_SECONDS, suggested_window
from services.connector_vault import ConnectorVault
from services.domain.validation import validate_record
from services.journal_service import JournalService
from services.workspace_storage import (
    WorkspaceError,
    digest,
    dumps,
    now,
    opaque,
    valid_id,
    valid_origin,
)

READ_CAPABILITIES = {"accountRead", "accountHistory", "marketHistory", "marketLive", "researchRead"}
WRITE_CAPABILITIES = {"orderSubmit", "orderCancel", "protectiveOrders"}
LABELS = {
    "accountRead": "Account details",
    "accountHistory": "Account history",
    "marketHistory": "Saved market history",
    "marketLive": "Current market data",
    "researchRead": "Research",
    "orderSubmit": "Submit orders",
    "orderCancel": "Cancel orders",
    "protectiveOrders": "Protective orders",
}
MAX_RECEIPTS = 5000
HEARTBEAT_SECONDS = 120


def keys(value, required=(), optional=()):
    if (
        not isinstance(value, dict)
        or set(required) - set(value)
        or set(value) - set(required) - set(optional)
    ):
        raise WorkspaceError("connector.invalid_command")


def _text(value, maximum=200):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= maximum or "\x00" in value:
        raise WorkspaceError("connector.invalid_text")
    return value.strip()


def _contract_time(value):
    return (
        datetime.fromisoformat(instant(value).replace("Z", "+00:00"))
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


class Connectors:
    def __init__(self, storage, *, adapters=None, clock=now, vault_key=None):
        from services import connector_adapters

        self.storage = storage
        self.records = ConnectorRecords(storage)
        self.vault = ConnectorVault(storage, master_key=vault_key)
        self.journal = JournalService(storage)
        self.adapters = adapters or connector_adapters
        self.clock = clock

    def providers(self):
        return {"providers": self.adapters.provider_catalog()}

    def _load(self, connection, origin, identity):
        if not valid_origin(identity):
            raise WorkspaceError("connector.invalid_identity")
        record = self.records.load(connection, origin, identity)
        if record is None:
            raise WorkspaceError("connector.not_found", 404)
        return record

    def _health(self, record):
        health = record["health"]
        if health in {"healthy", "degraded"} and record.get("observedAt"):
            age = datetime.fromisoformat(
                instant(self.clock()).replace("Z", "+00:00")
            ) - datetime.fromisoformat(instant(record["observedAt"]).replace("Z", "+00:00"))
            if age.total_seconds() > HEARTBEAT_SECONDS or age.total_seconds() < -5:
                health = "stale"
        return health

    def _public(self, connection, origin, record):
        if record is None:
            return None
        identity = record.get("identity")
        history = record["history"]
        caps = record.get("probe", {}).get("capabilities", {})
        credential = self.vault.status(connection, origin, record)
        health = self._health(record)
        if record.get("credentialRef") and credential["status"] in {
            "expired",
            "revoked",
            "missing",
        }:
            health = "expired"
        public_caps = []
        for name in sorted(READ_CAPABILITIES | WRITE_CAPABILITIES):
            value = caps.get(name, {})
            state = "unsupported" if name in WRITE_CAPABILITIES else value.get("state", "unknown")
            if state == "supported" and name not in record.get("permissions", []):
                state = "unknown"
            if state == "supported" and (
                record.get("requiresVerification")
                or health not in {"healthy", "degraded"}
                or record.get("verifiedConfigHash") != digest(record["configuration"])
            ):
                state = "unknown"
            public_caps.append(
                {
                    "id": name,
                    "label": LABELS[name],
                    "state": state,
                    "supported": state == "supported",
                    "reason": "Trading is unavailable through this read-only connection."
                    if name in WRITE_CAPABILITIES
                    else value.get("reason", "Recheck the connection to observe this capability."),
                    **(
                        {"verifiedAt": record["observedAt"]}
                        if state == "supported" and record.get("observedAt")
                        else {}
                    ),
                }
            )
        result = {
            "id": record["id"],
            "revision": record["revision"],
            "label": record["label"],
            "providerId": record["providerId"],
            "adapterVersion": record["adapterVersion"],
            "state": record["status"],
            "health": health,
            "configuration": deepcopy(record["configuration"]),
            "synthetic": record["providerId"] == "diagnostic",
            "capabilities": public_caps,
            "credential": credential,
            "history": {
                "observations": len(history["observations"]),
                "confirmed": len(history["confirmed"]),
                "conflicts": len(history["conflicts"]),
                "coverage": history["coverage"][-20:],
                "cursor": history["cursor"],
                "summary": record.get("historySummary", {}),
                "suggestedWindow": suggested_window(history, record["updatedAt"]),
                "overlapSeconds": OVERLAP_SECONDS,
                "maxWindowDays": MAX_WINDOW_DAYS,
                **({"lastSyncedAt": record["lastSyncedAt"]} if record.get("lastSyncedAt") else {}),
            },
            "createdAt": record["createdAt"],
            "updatedAt": record["updatedAt"],
        }
        if identity:
            external = str(identity["externalId"])
            result["identity"] = {
                "displayName": record["label"],
                "externalIdMasked": "••••" + external[-4:],
                **{
                    name: identity[name]
                    for name in ("server", "environment", "currency", "synthetic")
                },
            }
        if record.get("profileId"):
            result["profileId"] = record["profileId"]
        if record.get("link"):
            result.update(
                {key: record["link"][key] for key in ("profileId", "accountId", "bookId", "active")}
            )
        for name in (
            "observedAt",
            "lastAttemptAt",
            "failure",
            "conformance",
            "requiresVerification",
        ):
            if record.get(name) is not None:
                result[name] = deepcopy(record[name])
        if record.get("requiresVerification") and result.get("conformance"):
            result["conformance"] = {
                "readiness": "unverified",
                "passed": False,
                "synthetic": record["providerId"] == "diagnostic",
                "checkedAt": record["conformance"].get("checkedAt"),
                "checks": [
                    {
                        "id": "reverification-required",
                        "passed": False,
                        "reason": "Recheck the restored account before using previous evidence.",
                    }
                ],
            }
        return result

    def list(self, origin, profile_id=None):
        with self.storage.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            state = self.storage._read(connection, origin, full_modules=False)
            if profile_id is not None:
                self._profile(state, profile_id)
            records = self.records.list(connection, origin)
            return {
                "connections": [
                    self._public(connection, origin, record)
                    for record in records
                    if profile_id is None
                    or record.get("profileId") == profile_id
                    or record.get("link", {}).get("profileId") == profile_id
                ],
                **self.providers(),
            }

    def detail(self, origin, connection_id):
        with self.storage.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            self.storage._read(connection, origin, full_modules=False)
            return {
                "connection": self._public(
                    connection, origin, self._load(connection, origin, connection_id)
                )
            }

    def history(self, origin, connection_id, offset=0, limit=100):
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 200:
            raise WorkspaceError("connector.invalid_page")
        with self.storage.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            self.storage._read(connection, origin, full_modules=False)
            record = self._load(connection, origin, connection_id)
            history = record["history"]
            return {
                "connection": self._public(connection, origin, record),
                "history": {
                    "observations": history["observations"][offset : offset + limit],
                    "coverage": history["coverage"][-20:],
                    "conflicts": history["conflicts"][-100:],
                    "total": len(history["observations"]),
                    "offset": offset,
                    "limit": limit,
                },
            }

    def _profile(self, state, profile_id):
        profile = next(
            (
                row
                for row in state["snapshot"]["tables"]["portfolios"]
                if row["id"] == profile_id and not row.get("archivedAt")
            ),
            None,
        )
        if not valid_id(profile_id) or not profile:
            raise WorkspaceError("connector.profile_not_found", 404)
        if profile.get("kind") != "live":
            raise WorkspaceError("connector.live_environment_required", 409)
        return profile

    def _input_hash(self, body):
        if body["action"] != "set-secret":
            return digest(body)
        key = self.vault.master_key or os.environ.get("APP_KEY")
        if not isinstance(key, str) or len(key) < 32:
            raise WorkspaceError("connector.vault_key_unavailable", 503)
        return hmac.new(
            key.encode(),
            ("connector-receipt:" + self.storage.uid + dumps(body)).encode(),
            hashlib.sha256,
        ).hexdigest()

    def _replay(self, record, request_id, input_hash):
        found = next((row for row in record["receipts"] if row["requestId"] == request_id), None)
        if found and found["inputHash"] != input_hash:
            raise WorkspaceError("request.reused_with_different_input", 409)
        return found

    def _canonical(self, record):
        at = _contract_time(record["updatedAt"])
        scope = record["ownerId"] + "|" + record["originId"]
        base = {
            "schemaVersion": 1,
            "ownerId": record["ownerId"],
            "workspaceId": opaque("workspace", scope),
            "revision": record["revision"],
            "createdAt": _contract_time(record["createdAt"]),
            "updatedAt": at,
        }
        kind = self.adapters.describe_provider(record["providerId"])["kind"]
        source = {
            **base,
            "id": opaque("source", scope + "|" + record["id"]),
            "providerId": record["providerId"],
            "adapterVersion": record["adapterVersion"],
            "kind": kind,
            "configurationState": "configured",
            "health": {"stale": "degraded", "recovering": "offline"}.get(
                self._health(record), record["health"]
            ),
        }
        if record.get("observedAt"):
            source["observedAt"] = _contract_time(record["observedAt"])
        elif record.get("lastAttemptAt") and source["health"] != "unknown":
            source["observedAt"] = _contract_time(record["lastAttemptAt"])
        if record.get("credentialRef"):
            source["credentialRef"] = record["credentialRef"]
        link = record.get("link")
        if link:
            account_id = opaque("account", self.storage.uid + "|account|" + link["accountKey"])
            source["accountId"] = account_id
            active = (
                link["active"]
                and self._health(record) in {"healthy", "degraded"}
                and not record.get("requiresVerification")
                and record.get("verifiedConfigHash") == digest(record["configuration"])
            )
            record["accountSourceLink"] = {
                **base,
                "id": opaque("accountsource", scope + "|" + record["id"]),
                "accountId": account_id,
                "sourceId": source["id"],
                "verificationReceiptId": opaque("verification", digest(record.get("probe", {}))),
                "capability": "history_read",
                "state": "active" if active else "paused",
            }
        record["source"] = source
        if record.get("probe"):
            evidence_id = opaque("evidence", scope + "|" + digest(record["probe"]))
            caps = {}
            for name in sorted(READ_CAPABILITIES | WRITE_CAPABILITIES):
                supported = (
                    name not in WRITE_CAPABILITIES
                    and name in record.get("permissions", [])
                    and record["probe"].get("capabilities", {}).get(name, {}).get("state")
                    == "supported"
                )
                fallback = (
                    record["probe"].get("capabilities", {}).get(name, {}).get("state", "unknown")
                )
                caps[name] = (
                    {
                        "state": "supported",
                        "verifiedAt": _contract_time(record["observedAt"]),
                        "evidenceId": evidence_id,
                    }
                    if supported
                    else {
                        "state": "unsupported"
                        if name in WRITE_CAPABILITIES
                        else "unknown"
                        if fallback == "supported"
                        else fallback
                    }
                )
            record["manifest"] = {
                **base,
                "id": opaque("capabilities", scope + "|" + record["id"]),
                "sourceId": source["id"],
                "environment": record["identity"]["environment"],
                "adapterVersion": record["adapterVersion"],
                "capabilities": caps,
            }
        for field, kind_name in (
            ("source", "SourceConnection"),
            ("manifest", "CapabilityManifest"),
            ("accountSourceLink", "AccountSourceLink"),
        ):
            if record.get(field) and validate_record(kind_name, record[field]):
                raise WorkspaceError("connector.invalid_canonical_record")

    def _checked_probe(self, record, result):
        identity = result.get("identity") if isinstance(result, dict) else None
        if not isinstance(identity, dict) or {
            "providerId",
            "externalId",
            "server",
            "environment",
            "currency",
            "synthetic",
        } - set(identity):
            raise WorkspaceError("connector.invalid_observation", 502)
        if (
            identity["providerId"] != record["providerId"]
            or result.get("adapterVersion") != record["adapterVersion"]
        ):
            raise WorkspaceError("connector.adapter_version_changed", 409)
        if (
            identity["environment"] not in {"broker_demo", "broker_live", "data_only"}
            or not isinstance(identity["currency"], str)
            or not 2 <= len(identity["currency"]) <= 12
            or type(identity["synthetic"]) is not bool
        ):
            raise WorkspaceError("connector.invalid_observation", 502)
        _text(str(identity["externalId"]), 200)
        _text(identity["server"], 200)
        if bool(identity["synthetic"]) != (record["providerId"] == "diagnostic"):
            raise WorkspaceError("connector.synthetic_identity_mismatch", 409)
        if record.get("identity") and identity != record["identity"]:
            raise WorkspaceError("connector.observed_identity_changed", 409)
        observed_at = instant(result.get("observedAt"))
        age = datetime.fromisoformat(
            instant(self.clock()).replace("Z", "+00:00")
        ) - datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
        if not -5 <= age.total_seconds() <= HEARTBEAT_SECONDS:
            raise WorkspaceError("connector.stale_observation", 409)
        permissions = result.get("permissions")
        if not isinstance(permissions, list) or set(permissions) - READ_CAPABILITIES:
            raise WorkspaceError("connector.invalid_permission", 502)
        record.update(
            identity=deepcopy(identity),
            probe=deepcopy(result),
            permissions=permissions,
            observedAt=observed_at,
            health="healthy",
            requiresVerification=False,
        )
        record["status"] = "linked" if record.get("link", {}).get("active") else "ready"
        record["verifiedConfigHash"] = digest(record["configuration"])
        record.pop("failure", None)

    def _link(self, connection, origin, state, record, payload):
        keys(payload, ("profileId", "confirmIdentity"), ("accountId", "createObservedAccount"))
        if (
            payload["confirmIdentity"] is not True
            or record.get("requiresVerification")
            or self._health(record) not in {"healthy", "degraded"}
            or record.get("verifiedConfigHash") != digest(record["configuration"])
            or "accountRead" not in record.get("permissions", [])
        ):
            raise WorkspaceError("connector.verify_and_review_required", 409)
        profile_id = payload["profileId"]
        self._profile(state, profile_id)
        identity = record["identity"]
        if identity["environment"] not in {"broker_demo", "broker_live"}:
            raise WorkspaceError("connector.account_identity_required", 409)
        accounts = state["snapshot"]["tables"]["brokerAccounts"]
        account = next(
            (
                row
                for row in accounts
                if row["id"] == payload.get("accountId") and not row.get("archivedAt")
            ),
            None,
        )
        expected_kind = "live" if identity["environment"] == "broker_live" else "demo"
        expected_platform = "mt5" if record["providerId"] == "mt5" else "broker-api"
        observed = (
            identity["server"],
            str(identity["externalId"]),
            expected_kind,
            identity["currency"],
            expected_platform,
        )

        def matches(row):
            return (
                tuple(
                    row.get(key)
                    for key in ("server", "externalLogin", "accountKind", "currency", "platform")
                )
                == observed
            )

        if payload.get("accountId") is not None:
            if not valid_id(payload["accountId"]) or not account or not matches(account):
                raise WorkspaceError("connector.account_identity_mismatch", 409)
        elif payload.get("createObservedAccount") is True:
            candidates = [row for row in accounts if matches(row) and not row.get("archivedAt")]
            if len(candidates) > 1:
                raise WorkspaceError("connector.ambiguous_account_selection", 409)
            account = candidates[0] if candidates else None
            if account is None:
                account = {
                    "id": max([row["id"] for row in accounts] + [0]) + 1,
                    "displayName": record["label"],
                    "platform": expected_platform,
                    "brokerName": record["providerId"],
                    "server": identity["server"],
                    "externalLogin": str(identity["externalId"]),
                    "accountKind": expected_kind,
                    "currency": identity["currency"],
                    "enabled": False,
                    "createdAt": self.clock(),
                    "updatedAt": self.clock(),
                }
                if not valid_id(account["id"]):
                    raise WorkspaceError("connector.identity_exhausted")
                accounts.append(account)
        else:
            raise WorkspaceError("connector.account_selection_required")
        result = self.journal._apply(
            state, "create-book", {"portfolioId": profile_id, "accountId": account["id"]}
        )
        bindings = self.storage._bindings(
            state["snapshot"],
            state["bindings"].get("resolutions", {}),
            ledger=state["journalLedger"],
        )
        bindings["nativeNamespaceMappings"] = state["bindings"].get("nativeNamespaceMappings", {})
        state["bindings"] = bindings
        book = next(row for row in bindings["books"] if row["id"] == result["bookId"])
        old_link = record.get("link")
        if old_link and old_link["bookId"] != book["id"]:
            raise WorkspaceError("connector.relink_requires_review", 409)
        for other in self.records.list(connection, origin):
            if other["id"] == record["id"]:
                continue
            other_link = other.get("link") or {}
            if (
                record["providerId"] == other["providerId"] == "mt5"
                and other_link.get("active")
                and other_link.get("profileId") == profile_id
            ):
                raise WorkspaceError("mt5.profile_binding_ambiguous", 409)
            if (
                other.get("identity") == identity
                and other_link
                and other_link["bookId"] != book["id"]
            ):
                raise WorkspaceError("connector.identity_book_conflict", 409)
        record["link"] = {
            "profileId": profile_id,
            "accountId": account["id"],
            "bookId": book["id"],
            "accountKey": book["accountKey"],
            "active": True,
        }
        record["profileId"] = profile_id
        record["status"] = "linked"

    def _project(self, state, record, *, corrections=False):
        from services.journal_import import JournalImportError, normalize_statement

        rows = record["history"]["confirmed"]
        if not rows:
            return {"projected": 0, "pendingCorrections": 0}
        link = record["link"]
        context = self.journal._import_context(
            state, link["profileId"], link["bookId"], link["accountId"], record["providerId"]
        )
        fields = sorted(set().union(*(row.keys() for row in rows)))
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
        mapping = {
            "columns": {field: field for field in fields},
            "timezone": "UTC",
            "decimalSeparator": ".",
            "delimiter": ",",
            "quantityUnit": rows[0].get("quantityUnit", "units"),
        }
        previous = [
            row
            for row in state["journalLedger"]["events"]
            if row.get("provider") == context["provider"]
            and row.get("accountKey") == context["accountKey"]
            and row.get("bookId") == context["bookId"]
        ]
        try:
            preview = normalize_statement(stream.getvalue(), mapping, context, previous)
        except JournalImportError as error:
            raise WorkspaceError("connector.journal_normalization_failed", 409) from error
        if not preview["canCommit"]:
            raise WorkspaceError("connector.journal_normalization_failed", 409)
        pending = sum(row["action"] == "correction" for row in preview["rows"])
        if pending and not corrections:
            old_events = {row["eventKey"]: row for row in previous}
            changes = []
            for row in preview["rows"]:
                if row["action"] != "correction":
                    continue
                event = row["event"]
                old = old_events.get(event["eventKey"], {})
                fields = (
                    "symbol",
                    "quantity",
                    "entryPrice",
                    "exitPrice",
                    "grossPnl",
                    "netPnl",
                    "commission",
                    "fees",
                    "swap",
                    "currency",
                    "openedAt",
                    "closedAt",
                )
                changes.append(
                    {
                        "id": opaque("correction", digest(event)),
                        "summary": "Updated confirmed trade facts",
                        "changedFields": [
                            {"field": field, "before": old.get(field), "after": event.get(field)}
                            for field in fields
                            if old.get(field) != event.get(field)
                        ],
                    }
                )
            return {"projected": 0, "pendingCorrections": pending, "corrections": changes}
        event_map = {row["eventKey"]: row for row in state["journalLedger"]["events"]}
        for row in preview["rows"]:
            if not row.get("event") or row["action"] == "unchanged":
                continue
            event = {**deepcopy(row["event"]), "id": row["event"]["eventKey"]}
            if event["eventKey"] in event_map:
                event_map[event["eventKey"]].clear()
                event_map[event["eventKey"]].update(event)
                event = event_map[event["eventKey"]]
            else:
                event_map[event["eventKey"]] = event
                state["journalLedger"]["events"].append(event)
            state["journalLedger"]["observations"].append(
                {
                    "id": opaque("connectorobservation", record["id"] + "|" + digest(event)),
                    "bookId": context["bookId"],
                    "at": self.clock(),
                    "batchId": record["id"],
                    "sourceHash": preview["sourceHash"],
                    "action": row["action"],
                    "sourceEvent": deepcopy(event),
                }
            )
        changed = 0
        for projection in preview["tradeProjections"]:
            trade_id, did_change = self.journal._import_projection(state, projection, context)
            changed += int(did_change)
            for key in projection["sourceEventKeys"]:
                if key in event_map:
                    event_map[key]["tradeId"] = trade_id
        return {"projected": changed, "pendingCorrections": 0}

    def action(self, origin, connection_id, expected_revision, request_id, action, payload):
        from services.connector_adapters import AdapterError

        try:
            result = self._action(
                origin, connection_id, expected_revision, request_id, action, payload
            )
            return {**result, "workspace": self.storage.workspace(origin)}
        except AdapterError as error:
            raise WorkspaceError(error.code, error.status) from error

    def _action(self, origin, connection_id, expected_revision, request_id, action, payload):
        from services.connector_adapters import AdapterError

        if not isinstance(action, str) or action not in {
            "create",
            "probe",
            "sync",
            "link",
            "conformance",
            "configure",
            "set-secret",
            "disconnect",
            "revoke",
            "archive",
            "apply-corrections",
        }:
            raise WorkspaceError("connector.invalid_command")
        if (
            not valid_origin(origin)
            or not valid_origin(request_id)
            or not 8 <= len(request_id) <= 128
            or type(expected_revision) is not int
            or not 0 <= expected_revision <= 9007199254740991
        ):
            raise WorkspaceError("connector.invalid_command")
        if not isinstance(payload, dict) or len(dumps(payload).encode()) > 32768:
            raise WorkspaceError("connector.invalid_command")
        identity = (
            opaque("connection", f"{self.storage.uid}|{origin}|{request_id}")
            if action == "create"
            else connection_id
        )
        if not valid_origin(identity):
            raise WorkspaceError("connector.invalid_identity")
        body = {
            "origin": origin,
            "connectionId": identity,
            "expectedRevision": expected_revision,
            "action": action,
            "payload": payload,
        }
        input_hash = self._input_hash(body)
        external = None
        error = None
        fetched_from = None
        if action in {"probe", "sync", "conformance"}:
            with self.storage.engine.connect() as connection:
                connection.exec_driver_sql("BEGIN")
                self.storage._read(connection, origin, full_modules=False)
                record = self._load(connection, origin, identity)
                replay = self._replay(record, request_id, input_hash)
                if replay:
                    return {
                        "connection": self._public(connection, origin, record),
                        "receipt": replay,
                    }
                if record["revision"] != expected_revision or record["status"] == "archived":
                    raise WorkspaceError("connector.revision_conflict", 409)
                if action != "sync":
                    keys(payload)
                    if action == "conformance" and (
                        self._health(record) != "healthy" or not record.get("identity")
                    ):
                        raise WorkspaceError("connector.verify_and_review_required", 409)
                else:
                    keys(payload, ("window",))
                    self._require_link(record)
                    self._require_active_mt5_origin(connection, origin, record)
                    self._window(payload["window"])
                    if "accountHistory" not in record.get("permissions", []):
                        raise WorkspaceError("connector.history_not_supported", 409)
                if record.get("failure", {}).get("retryAt") and instant(
                    record["failure"]["retryAt"]
                ) > instant(self.clock()):
                    raise WorkspaceError("connector.retry_later", 429)
                secret = (
                    self.vault.load(connection, origin, record)
                    if record.get("credentialRef")
                    else None
                )
                fetched_from = digest(
                    {
                        key: record.get(key)
                        for key in ("configuration", "credentialGeneration", "identity", "link")
                    }
                )
            try:
                if action == "conformance":
                    from services.connector_conformance import run_conformance, validate_conformance

                    external = run_conformance(
                        record["providerId"], record["configuration"], secret
                    )
                    if external.get("passed"):
                        validate_conformance(external, record["providerId"], record["identity"])
                elif action == "probe":
                    external = self.adapters.probe(
                        record["providerId"], record["configuration"], secret
                    )
                else:
                    native_cursor = self._native_cursor(record, payload["window"])
                    external = self.adapters.history(
                        record["providerId"],
                        record["configuration"],
                        record["identity"],
                        payload["window"],
                        native_cursor,
                        secret,
                    )
                    if external.get("identity") != record["identity"]:
                        raise AdapterError("connector.identity_changed", 409)
                    received = datetime.fromisoformat(instant(self.clock()).replace("Z", "+00:00"))
                    observed = datetime.fromisoformat(
                        instant(external.get("coverage", {}).get("observedAt")).replace(
                            "Z", "+00:00"
                        )
                    )
                    if not -5 <= (received - observed).total_seconds() <= HEARTBEAT_SECONDS:
                        raise AdapterError("connector.stale_observation", 409)
            except AdapterError as failure:
                error = {
                    "code": failure.code,
                    "message": "The source could not complete this read. Recheck its connection and permitted access.",
                }
                retry_after = getattr(failure, "retry_after", None)
                if retry_after is not None:
                    error["retryAt"] = (
                        (
                            datetime.fromisoformat(instant(self.clock()).replace("Z", "+00:00"))
                            + timedelta(seconds=max(1, min(int(retry_after), 86400)))
                        )
                        .isoformat()
                        .replace("+00:00", "Z")
                    )
            except WorkspaceError as failure:
                if failure.code not in {
                    "connector.observed_identity_changed",
                    "connector.stale_observation",
                }:
                    raise
                error = {
                    "code": failure.code,
                    "message": "The observed account or source clock changed. Recheck the original account before continuing.",
                }
        with self.storage.transaction() as connection:
            state = self.storage._read(connection, origin, full_modules=False)
            record = self.records.load(connection, origin, identity)
            if record:
                replay = self._replay(record, request_id, input_hash)
                if replay:
                    return {
                        "connection": self._public(connection, origin, record),
                        "receipt": replay,
                    }
                if record["revision"] != expected_revision:
                    raise WorkspaceError("connector.revision_conflict", 409)
            elif action != "create":
                raise WorkspaceError("connector.not_found", 404)
            if action == "create":
                keys(payload, ("providerId", "label", "configuration"), ("profileId",))
                if expected_revision != 0 or record is not None:
                    raise WorkspaceError("connector.revision_conflict", 409)
                provider = self.adapters.describe_provider(payload["providerId"])
                if not provider["available"]:
                    raise WorkspaceError("connector.provider_unavailable", 409)
                configuration = self.adapters.normalize_configuration(
                    payload["providerId"], payload["configuration"]
                )
                at = self.clock()
                record = {
                    "version": 1,
                    "id": identity,
                    "ownerId": self.storage.uid,
                    "originId": origin,
                    "revision": 0,
                    "providerId": provider["id"],
                    "adapterVersion": provider["version"],
                    "label": _text(payload["label"]),
                    "configuration": configuration,
                    "status": "unverified",
                    "health": "unknown",
                    "createdAt": at,
                    "updatedAt": at,
                    "history": empty_history(),
                    "receipts": [],
                    "credentialGeneration": 0,
                }
                if payload.get("profileId") is not None:
                    self._profile(state, payload["profileId"])
                    record["profileId"] = payload["profileId"]
            elif record["status"] == "archived":
                raise WorkspaceError("connector.archived", 409)
            if fetched_from and fetched_from != digest(
                {
                    key: record.get(key)
                    for key in ("configuration", "credentialGeneration", "identity", "link")
                }
            ):
                raise WorkspaceError("connector.observation_context_changed", 409)
            if action == "sync":
                self._require_active_mt5_origin(connection, origin, record)
            journal_changed = False
            if action in {"probe", "conformance", "sync"}:
                record["lastAttemptAt"] = self.clock()
                if error:
                    record["health"] = (
                        "expired"
                        if any(key in error["code"] for key in ("expired", "revoked"))
                        else "offline"
                        if any(
                            key in error["code"] for key in ("offline", "disconnect", "unavailable")
                        )
                        else "degraded"
                    )
                    if "identity" in error["code"] or "stale_observation" in error["code"]:
                        record["requiresVerification"] = True
                    record["failure"] = error
                elif action == "probe":
                    try:
                        self._checked_probe(record, external)
                    except WorkspaceError as failure:
                        record["health"] = "degraded"
                        record["requiresVerification"] = True
                        record["failure"] = {
                            "code": failure.code,
                            "message": "The observed account or source clock does not match this connection. Restore the original account and recheck.",
                        }
                elif action == "conformance":
                    record["conformance"] = external
                else:
                    if (
                        external.get("identity") != record["identity"]
                        or external.get("adapterVersion") != record["adapterVersion"]
                    ):
                        raise WorkspaceError("connector.observed_identity_changed", 409)
                    link = record["link"]
                    merged = merge_history(
                        record["history"],
                        external,
                        {
                            "providerId": record["providerId"],
                            "connectionId": record["id"],
                            "accountKey": link["accountKey"],
                            "currency": record["identity"]["currency"],
                            "receivedAt": self.clock(),
                            "identity": record["identity"],
                            "window": payload["window"],
                            "expectedCursor": self._native_cursor(record, payload["window"]),
                        },
                    )
                    record["history"] = merged["history"]
                    record["historySummary"] = {**merged["summary"], **self._project(state, record)}
                    record["lastSyncedAt"] = self.clock()
                    record["observedAt"] = instant(external["coverage"]["observedAt"])
                    record["health"] = "healthy" if merged["summary"]["complete"] else "degraded"
                    record.pop("failure", None)
                    journal_changed = bool(record["historySummary"]["projected"])
            elif action == "link":
                self._link(connection, origin, state, record, payload)
                journal_changed = True
            elif action == "configure":
                keys(payload, (), ("configuration", "label"))
                if not payload:
                    raise WorkspaceError("connector.invalid_command")
                if "configuration" in payload:
                    record["configuration"] = self.adapters.normalize_configuration(
                        record["providerId"], payload["configuration"]
                    )
                if "label" in payload:
                    record["label"] = _text(payload["label"])
                record["health"] = "unknown"
                record["status"] = "unverified"
                record.pop("conformance", None)
                record.pop("failure", None)
            elif action == "set-secret":
                keys(payload, ("secret",), ("expiresAt",))
                generation = record.get("credentialGeneration", 0) + 1
                record["credentialRef"] = self.vault.save(
                    connection,
                    origin,
                    record["id"],
                    payload["secret"],
                    generation,
                    payload.get("expiresAt"),
                )
                record["credentialGeneration"] = generation
                record["health"] = "unknown"
                record["status"] = "unverified"
                record.pop("conformance", None)
            elif action == "apply-corrections":
                keys(payload)
                self._require_link(record)
                record["historySummary"] = {
                    **record.get("historySummary", {}),
                    **self._project(state, record, corrections=True),
                }
                journal_changed = True
            elif action in {"disconnect", "revoke", "archive"}:
                keys(payload)
                record["status"] = "archived" if action == "archive" else "disconnected"
                record["health"] = "expired" if action == "revoke" else "offline"
                if record.get("link"):
                    record["link"]["active"] = False
                if action in {"revoke", "archive"}:
                    self.vault.revoke(connection, origin, record["id"])
                    record.pop("credentialRef", None)
                    record["credentialGeneration"] = record.get("credentialGeneration", 0) + 1
                record.pop("conformance", None)
            elif action != "create":
                raise WorkspaceError("connector.invalid_command")
            record["revision"] += 1
            record["updatedAt"] = self.clock()
            if len(record["receipts"]) >= MAX_RECEIPTS:
                raise WorkspaceError("connector.receipt_budget", 413)
            receipt = {
                "requestId": request_id,
                "inputHash": input_hash,
                "revision": record["revision"],
            }
            record["receipts"].append(receipt)
            self._canonical(record)
            if journal_changed:
                self.journal._save(connection, state, origin)
            else:
                connection.execute(
                    update(principals)
                    .where(principals.c.uid == self.storage.uid)
                    .values(generation=principals.c.generation + 1)
                )
            self.records.save(connection, origin, identity, record)
        return {**self.detail(origin, identity), "receipt": receipt}

    def _require_link(self, record):
        if (
            record.get("requiresVerification")
            or not record.get("link", {}).get("active")
            or self._health(record) not in {"healthy", "degraded"}
            or record.get("verifiedConfigHash") != digest(record["configuration"])
        ):
            raise WorkspaceError("connector.verify_and_link_required", 409)

    def _require_active_mt5_origin(self, connection, origin, record):
        if record["providerId"] == "mt5":
            principal = self.storage._principal(connection)
            if not principal or principal["active_origin"] != origin:
                raise WorkspaceError("connector.observation_context_changed", 409)

    def _native_cursor(self, record, window):
        cursor = record["history"]["cursor"]
        normalized = {key: instant(window[key]) for key in ("from", "to")}
        return cursor.get("nativeCursor") if cursor and cursor.get("window") == normalized else None

    def _window(self, window):
        keys(window, ("from", "to"))
        start, end = (
            datetime.fromisoformat(instant(window[key]).replace("Z", "+00:00"))
            for key in ("from", "to")
        )
        if not timedelta(0) < end - start <= timedelta(days=7) or end > datetime.fromisoformat(
            instant(self.clock()).replace("Z", "+00:00")
        ) + timedelta(seconds=5):
            raise WorkspaceError("connector.invalid_window")
