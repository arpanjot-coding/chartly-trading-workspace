"""Bounded connector records in caller-owned scoped SQLite transactions."""

from __future__ import annotations

import json
import re
from copy import deepcopy

from sqlalchemy import LargeBinary, cast, func, insert, select, update

from database.connectors_db import connectors
from services.connector_history import data_only, instant, validate_history

MAX_RECORD_BYTES = 4 * 1024 * 1024
MAX_ORIGIN_BYTES = 32 * 1024 * 1024
MAX_CONNECTIONS = 100
MAX_RECEIPTS = 5000
STATUSES = {
    "unverified",
    "ready",
    "linked",
    "disconnected",
    "archived",
    "verifying",
    "recovering",
    "revoked",
    "paused",
}
HEALTH = {"unknown", "healthy", "stale", "degraded", "recovering", "offline", "expired"}


def _error(code, status=400):
    from services.workspace_storage import WorkspaceError

    raise WorkspaceError("connector." + code, status)


def _id(value):
    return isinstance(value, str) and bool(
        re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}", value)
    )


def validate_record(value):
    if (
        not isinstance(value, dict)
        or type(value.get("version")) is not int
        or value["version"] != 1
    ):
        _error("invalid_record")
    for field in ("id", "ownerId", "originId"):
        if not _id(value.get(field)):
            _error("invalid_record_identity")
    if type(value.get("revision")) is not int or not 1 <= value["revision"] <= 9007199254740991:
        _error("invalid_record_revision")
    for field in ("providerId", "adapterVersion"):
        if not isinstance(value.get(field), str) or not 1 <= len(value[field]) <= 100:
            _error("invalid_record_provider")
    if value.get("status") not in STATUSES or value.get("health") not in HEALTH:
        _error("invalid_record_state")
    if not isinstance(value.get("configuration"), dict):
        _error("invalid_record_configuration")
    for field in ("createdAt", "updatedAt"):
        instant(value.get(field))
    if instant(value["updatedAt"]) < instant(value["createdAt"]):
        _error("invalid_record_time")
    validate_history(value.get("history"))
    history_scope = value["history"].get("scope")
    if history_scope and (
        history_scope["providerId"] != value["providerId"]
        or history_scope["connectionId"] != value["id"]
    ):
        _error("record_history_scope_mismatch")
    receipts = value.get("receipts")
    if not isinstance(receipts, list) or len(receipts) > MAX_RECEIPTS:
        _error("receipt_budget", 413)
    seen = set()
    for receipt in receipts:
        if (
            not isinstance(receipt, dict)
            or set(receipt) != {"requestId", "inputHash", "revision"}
            or not isinstance(receipt["requestId"], str)
            or not 1 <= len(receipt["requestId"]) <= 128
            or receipt["requestId"] in seen
            or not isinstance(receipt["inputHash"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", receipt["inputHash"])
            or type(receipt["revision"]) is not int
            or not 1 <= receipt["revision"] <= value["revision"]
        ):
            _error("invalid_receipt")
        seen.add(receipt["requestId"])
    from services.domain.validation import validate_record as canonical
    from services.workspace_storage import opaque

    workspace_id = opaque("workspace", value["ownerId"] + "|" + value["originId"])
    for field, kind in (
        ("source", "SourceConnection"),
        ("manifest", "CapabilityManifest"),
        ("accountSourceLink", "AccountSourceLink"),
    ):
        if field not in value or value[field] is None:
            continue
        record = value[field]
        if canonical(kind, record):
            _error("invalid_" + field)
        if record["ownerId"] != value["ownerId"] or record["workspaceId"] != workspace_id:
            _error("canonical_scope_mismatch")
    source, manifest = value.get("source"), value.get("manifest")
    if source and (
        source["providerId"] != value["providerId"]
        or source["adapterVersion"] != value["adapterVersion"]
    ):
        _error("source_configuration_mismatch")
    if manifest and (
        not source
        or manifest["sourceId"] != source["id"]
        or manifest["adapterVersion"] != value["adapterVersion"]
    ):
        _error("manifest_configuration_mismatch")
    if value.get("accountSourceLink") and (
        not source or value["accountSourceLink"]["sourceId"] != source["id"]
    ):
        _error("account_source_mismatch")
    link = value.get("link")
    if link is not None:
        if (
            not isinstance(link, dict)
            or any(
                type(link.get(key)) is not int or link[key] < 1
                for key in ("profileId", "accountId")
            )
            or not _id(link.get("bookId"))
            or type(link.get("active")) is not bool
        ):
            _error("invalid_account_link")
    data_only(value, maximum=MAX_RECORD_BYTES)
    return deepcopy(value)


def validate_records(values, snapshot=None, bindings=None):
    if not isinstance(values, list) or len(values) > MAX_CONNECTIONS:
        _error("record_budget", 413)
    seen = set()
    for value in values:
        validate_record(value)
        if value["id"] in seen:
            _error("duplicate_connection")
        seen.add(value["id"])
        if snapshot is not None:
            if value["originId"] != snapshot["originId"]:
                _error("origin_mismatch")
            link = value.get("link")
            if link:
                profiles = {row["id"]: row for row in snapshot["tables"]["portfolios"]}
                accounts = {row["id"]: row for row in snapshot["tables"]["brokerAccounts"]}
                if link["profileId"] not in profiles or link["accountId"] not in accounts:
                    _error("missing_linked_account")
                if bindings is not None and not any(
                    book.get("id") == link["bookId"]
                    and book.get("kind") == "connected"
                    and book.get("accountId") == link["accountId"]
                    and link["profileId"] in book.get("profileIds", [])
                    for book in bindings.get("books", [])
                ):
                    _error("missing_linked_book")
    data_only(values, maximum=MAX_ORIGIN_BYTES)
    return deepcopy(values)


def rebind_record(value, uid, origin, book_map, book_accounts=None):
    """Restore provenance and scope, never a credential, active link or health claim."""
    from services.workspace_storage import opaque

    result = validate_record(value)
    old_owner, old_origin = result["ownerId"], result["originId"]
    result["ownerId"], result["originId"] = uid, origin
    result["health"], result["status"] = "unknown", "unverified"
    result.pop("credentialRef", None)
    result.pop("credentialGeneration", None)
    result["requiresVerification"] = True
    result["credentialRequired"] = bool(
        value.get("credentialRef") or value.get("credentialRequired")
    )
    if result.get("link"):
        old_book = result["link"]["bookId"]
        if old_book not in book_map:
            _error("book_rebind_failed")
        result["link"]["bookId"] = book_map[old_book]
        result["link"]["active"] = False
    if old_owner != uid or old_origin != origin:
        result.setdefault("restoredFrom", {"ownerId": old_owner, "originId": old_origin})
    for field in ("source", "manifest", "accountSourceLink"):
        record = result.get(field)
        if not record:
            continue
        record["ownerId"], record["workspaceId"] = uid, opaque("workspace", uid + "|" + origin)
        if field == "source":
            record["health"] = "unknown"
            record.pop("credentialRef", None)
        if field == "accountSourceLink":
            record["state"] = "paused"
    # Account IDs derive from the declared account key and owner, while immutable
    # source IDs/observation hashes/receipts remain provenance identifiers.
    link = result.get("link")
    if link:
        account_key = (book_accounts or {}).get(link["bookId"])
        if not account_key:
            _error("account_rebind_failed")
        for field in ("source", "accountSourceLink"):
            record = result.get(field)
            if record and record.get("accountId"):
                record["accountId"] = opaque("account", uid + "|account|" + account_key)
    return validate_record(result)


def validate_account_bindings(snapshot, values):
    """Mutable profile configuration cannot relabel an observed account/book."""
    validate_records(values, snapshot)
    accounts = {row["id"]: row for row in snapshot["tables"]["brokerAccounts"]}
    from services.workspace_storage import digest, opaque

    for value in values:
        link, identity = value.get("link"), value.get("identity")
        if not link or not identity:
            continue
        account = accounts[link["accountId"]]
        fields = [
            account.get(key, "")
            for key in (
                "platform",
                "brokerName",
                "server",
                "externalLogin",
                "accountKind",
                "currency",
            )
        ]
        account_key = (
            digest(fields)
            if account.get("externalLogin") and account.get("server")
            else digest([snapshot["originId"], account["id"], *fields])
        )
        if (
            opaque("book", value["ownerId"] + "|account|" + account_key) != link["bookId"]
            or link.get("accountKey", account_key) != account_key
        ):
            _error("linked_account_identity_locked", 409)
        pairs = (("externalLogin", "externalId"), ("server", "server"), ("currency", "currency"))
        if any(
            key in identity and str(account.get(field, "")) != str(identity[key])
            for field, key in pairs
        ):
            _error("linked_account_identity_locked", 409)
        environment = identity.get("environment")
        if (
            environment in {"broker_demo", "demo"}
            and account.get("accountKind") != "demo"
            or environment in {"broker_live", "live"}
            and account.get("accountKind") != "live"
        ):
            _error("linked_account_identity_locked", 409)


class ConnectorRecords:
    def __init__(self, storage):
        self.storage = storage

    def load(self, connection, origin, identity):
        row = connection.execute(
            select(connectors.c.payload).where(
                self.storage.scope(connectors, origin), connectors.c.id == identity
            )
        ).first()
        return json.loads(row[0]) if row else None

    def list(self, connection, origin):
        return [
            json.loads(row[0])
            for row in connection.execute(
                select(connectors.c.payload)
                .where(self.storage.scope(connectors, origin))
                .order_by(connectors.c.id)
            )
        ]

    def save(self, connection, origin, identity, value):
        from services.workspace_storage import dumps

        value = validate_record(value)
        if (
            value["id"] != identity
            or value["originId"] != origin
            or value["ownerId"] != self.storage.uid
        ):
            _error("record_identity_mismatch")
        raw = dumps(value)
        byte_length = func.length(cast(connectors.c.payload, LargeBinary))
        prior = connection.execute(
            select(byte_length).where(
                self.storage.scope(connectors, origin), connectors.c.id == identity
            )
        ).scalar()
        total = connection.execute(
            select(func.coalesce(func.sum(byte_length), 0)).where(
                self.storage.scope(connectors, origin)
            )
        ).scalar()
        if total - (prior or 0) + len(raw.encode()) > MAX_ORIGIN_BYTES:
            _error("origin_budget", 413)
        if prior is None:
            count = connection.execute(
                select(func.count())
                .select_from(connectors)
                .where(self.storage.scope(connectors, origin))
            ).scalar()
            if count >= MAX_CONNECTIONS:
                _error("connection_budget", 413)
            connection.execute(
                insert(connectors).values(
                    uid=self.storage.uid, origin=origin, id=identity, payload=raw
                )
            )
        else:
            connection.execute(
                update(connectors)
                .where(self.storage.scope(connectors, origin), connectors.c.id == identity)
                .values(payload=raw)
            )
