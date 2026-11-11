"""One authoritative local store for the existing journal UI.

Legacy economic values stay explicitly raw until P03 normalizes them. Migration
decisions and immutable source snapshots retain provenance and original IDs.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import re
from collections import Counter
from contextlib import contextmanager
from copy import deepcopy
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import and_, delete, func, insert, literal_column, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError, OperationalError

from database.connector_vault_db import connector_secrets
from database.connectors_db import connectors
from database.execution_db import deployments as _deployments_table
from database.execution_db import execution_accounts as _execution_accounts_table
from database.experiments_db import experiments as _experiments_table
from database.paper_sessions_db import paper_sessions
from database.research_db import research_ingestion_jobs as _research_ingestion_table
from database.research_db import research_issuers as _research_issuers_table
from database.strategy_artifacts_db import strategy_artifacts as _strategy_artifacts_table
from database.workspace_storage_db import (
    TABLES,
    aliases,
    assets,
    book_registry,
    create_workspace_engine,
    jobs,
    journal_records,
    native_catalogs,
    principals,
    receipts,
    recovery_copies,
    states,
)
from services.chart_preferences import CHART_PREFERENCES_KEY

NATIVE = {
    "workspace": "openalgo-chart-workspaces",
    "watchlist": "openalgo-chart-watchlists",
    "drawingTemplates": "openalgo-chart-drawing-templates",
}
PREFS = {
    "chartly.combined-selection.v1",
    "chartly.customIndicators.manifest.v1",
    "oa-trading-script-open",
    "oa-trading-script-recent",
    "oa-agent-model",
    "chartly-theme",
}
SECRET = {
    "apikey",
    "password",
    "passwordhash",
    "accesstoken",
    "refreshtoken",
    "authtoken",
    "clientsecret",
    "apisecret",
    "authorization",
    "credentials",
    "totpsecret",
}
MAX_BYTES = 512 * 1024 * 1024
MAX_RECOVERY_STATUS_BYTES = 4 * 1024 * 1024
MIMES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/avif",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/octet-stream",
}


class WorkspaceError(Exception):
    def __init__(self, code, status=400, issues=None):
        super().__init__(code)
        self.code = code
        self.status = status
        self.issues = issues or []


def dumps(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )


def digest(value):
    return hashlib.sha256(dumps(value).encode()).hexdigest()


def now():
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def opaque(prefix, value):
    return prefix + "_" + hashlib.sha256(value.encode()).hexdigest()[:40]


def valid_id(value):
    return type(value) is int and 0 < value <= 9007199254740991


def valid_origin(value):
    return (
        isinstance(value, str)
        and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{7,127}", value) is not None
    )


def validate_snapshot(snapshot, *, evidence_assets=False):
    if (
        not isinstance(snapshot, dict)
        or snapshot.get("format") != "chartly-browser-snapshot"
        or type(snapshot.get("version")) is not int
        or snapshot["version"] != 1
        or not valid_origin(snapshot.get("originId"))
    ):
        raise WorkspaceError("snapshot.invalid_format")
    allowed = {
        "format",
        "version",
        "originId",
        "createdAt",
        "tables",
        "nativeCatalogs",
        "preferences",
        "attachments",
        "datasetManifests",
    }
    if set(snapshot) - allowed:
        raise WorkspaceError("snapshot.unknown_field")
    result = deepcopy(snapshot)
    for field, default in [
        ("nativeCatalogs", {}),
        ("preferences", {}),
        ("attachments", {}),
        ("datasetManifests", []),
    ]:
        result.setdefault(field, default)
    try:
        if len(dumps(result).encode()) > MAX_BYTES:
            raise WorkspaceError("snapshot.too_large", 413)
    except (ValueError, TypeError, RecursionError) as error:
        raise WorkspaceError("snapshot.invalid_json") from error

    def scan(value, depth=0):
        if depth > 40:
            raise WorkspaceError("snapshot.too_deep")
        if isinstance(value, dict):
            for key, item in value.items():
                if (
                    not isinstance(key, str)
                    or key in ("__proto__", "constructor", "prototype")
                    or re.sub("[^a-z]", "", key.lower()) in SECRET
                ):
                    raise WorkspaceError("snapshot.secret_field")
                scan(item, depth + 1)
        elif isinstance(value, list):
            for item in value:
                scan(item, depth + 1)
        elif isinstance(value, float) and not math.isfinite(value):
            raise WorkspaceError("snapshot.nonfinite")

    scan(result)
    tables = result.get("tables")
    if not isinstance(tables, dict) or set(tables) != set(TABLES):
        raise WorkspaceError("snapshot.tables_required")
    indexes = {}
    if sum(len(rows) for rows in tables.values() if isinstance(rows, list)) > 100000:
        raise WorkspaceError("snapshot.table_budget_exceeded", 413)
    for name, rows in tables.items():
        if not isinstance(rows, list) or len(rows) > 100000:
            raise WorkspaceError("snapshot.invalid_table")
        index = {}
        for row in rows:
            if not isinstance(row, dict) or not valid_id(row.get("id")) or row["id"] in index:
                raise WorkspaceError("snapshot.invalid_identity")
            index[row["id"]] = row
        indexes[name] = index
    for session in tables["practiceSessions"]:
        marker = session.get("paper")
        if marker is not None and (
            not isinstance(marker, dict)
            or set(marker)
            - {"version", "revision", "status", "manifestId", "window", "startingCash"}
            or not {"version", "revision", "status", "manifestId"} <= set(marker)
            or type(marker.get("version")) is not int
            or marker["version"] != 1
            or type(marker.get("revision")) is not int
            or marker["revision"] < 0
            or marker.get("status")
            not in {"ready", "in_progress", "paused", "finished", "abandoned"}
            or not isinstance(marker.get("manifestId"), str)
            or not re.fullmatch(r"[a-z][a-z0-9_]{7,127}", marker["manifestId"])
            or "startingCash" in marker
            and (
                not isinstance(marker["startingCash"], str)
                or not re.fullmatch(
                    r"(?:0|[1-9][0-9]{0,33})(?:\.[0-9]{1,18})?", marker["startingCash"]
                )
                or not marker["startingCash"].strip("0.")
            )
            or "window" in marker
            and (
                not isinstance(marker["window"], dict)
                or set(marker["window"]) != {"from", "to"}
                or any(
                    type(marker["window"][key]) not in (int, float)
                    or not math.isfinite(marker["window"][key])
                    for key in ("from", "to")
                )
                or marker["window"]["from"] > marker["window"]["to"]
            )
        ):
            raise WorkspaceError("paper.invalid_marker")
    refs = {
        "practiceSessions": [("portfolioId", "portfolios", True)],
        "journalTrades": [
            ("portfolioId", "portfolios", True),
            ("sessionId", "practiceSessions", False),
            ("accountId", "brokerAccounts", False),
        ],
        "dailyMoods": [("portfolioId", "portfolios", True)],
        "profileDestinations": [
            ("portfolioId", "portfolios", True),
            ("accountId", "brokerAccounts", True),
            ("terminalId", "terminals", False),
        ],
        "terminals": [("assignedAccountId", "brokerAccounts", False)],
    }
    for name, fields in refs.items():
        for row in tables[name]:
            for field, parent, required in fields:
                if field not in row and not required:
                    continue
                if not valid_id(row.get(field)) or row[field] not in indexes[parent]:
                    raise WorkspaceError(
                        "snapshot.missing_parent",
                        400,
                        [{"table": name, "recordId": row["id"], "field": field}],
                    )
            if (
                name == "journalTrades"
                and "sessionId" in row
                and indexes["practiceSessions"][row["sessionId"]]["portfolioId"]
                != row["portfolioId"]
            ):
                raise WorkspaceError("snapshot.session_scope")
    if not isinstance(result["preferences"], dict) or any(
        key not in PREFS
        and not CHART_PREFERENCES_KEY.fullmatch(key)
        and not re.fullmatch(
            r"oa-trading-script-draft:[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\.oscript", key
        )
        for key in result["preferences"]
    ):
        raise WorkspaceError("snapshot.preference_not_allowed")
    if any(not isinstance(value, str) for value in result["preferences"].values()):
        raise WorkspaceError("snapshot.invalid_preference")
    if "chartly-theme" in result["preferences"]:
        try:
            theme = json.loads(result["preferences"]["chartly-theme"])
        except (ValueError, TypeError) as error:
            raise WorkspaceError("snapshot.invalid_preference") from error
        if (
            not isinstance(theme, dict)
            or set(theme) - {"state", "version"}
            or not isinstance(theme.get("state"), dict)
            or set(theme["state"]) - {"mode", "color"}
        ):
            raise WorkspaceError("snapshot.preference_not_allowed")
    # The archive and live native save share the actual public chart schema.
    from services.workspace_recovery import (
        WorkspaceRecoveryError,
        _attachments,
        _catalogs,
        _data_only,
        _preferences,
    )

    try:
        _data_only(result)
        _catalogs(result["nativeCatalogs"])
        _attachments(result["attachments"])
        _preferences(result["preferences"])
    except WorkspaceRecoveryError as error:
        raise WorkspaceError(error.code, error.status) from error
    if not isinstance(result["nativeCatalogs"], dict) or set(result["nativeCatalogs"]) - set(
        NATIVE.values()
    ):
        raise WorkspaceError("snapshot.invalid_native_store")
    for catalogs in result["nativeCatalogs"].values():
        if not isinstance(catalogs, dict):
            raise WorkspaceError("snapshot.invalid_native_catalog")
        for namespace, catalog in catalogs.items():
            if (
                not isinstance(namespace, str)
                or not 1 <= len(namespace) <= 300
                or not isinstance(catalog, dict)
                or type(catalog.get("revision")) is not int
                or catalog["revision"] < 0
            ):
                raise WorkspaceError("snapshot.invalid_native_catalog")
    if not isinstance(result["attachments"], dict):
        raise WorkspaceError("snapshot.invalid_attachments")
    for id, attachment in result["attachments"].items():
        if isinstance(attachment, dict) and attachment.get("status") == "unavailable":
            continue
        if (
            not valid_origin(id)
            or not isinstance(attachment, dict)
            or attachment.get("mimeType") not in MIMES
            or not isinstance(attachment.get("base64"), str)
        ):
            raise WorkspaceError("snapshot.invalid_attachment")
        try:
            if len(base64.b64decode(attachment["base64"], validate=True)) > 64 * 1024 * 1024:
                raise WorkspaceError("snapshot.attachment_too_large", 413)
        except ValueError as error:
            raise WorkspaceError("snapshot.invalid_attachment") from error
    if not isinstance(result["datasetManifests"], list):
        raise WorkspaceError("snapshot.invalid_datasets")
    from services.chart_evidence_validation import snapshot_evidence

    snapshot_evidence(result, require_assets=evidence_assets)
    return result


class WorkspaceStorage:
    def __init__(self, database_url, principal_uid):
        if not isinstance(principal_uid, str) or not 8 <= len(principal_uid) <= 128:
            raise WorkspaceError("scope.invalid", 401)
        self.uid = principal_uid
        self.engine = (
            database_url
            if isinstance(database_url, Engine)
            else create_workspace_engine(database_url)
        )

    def scope(self, table, origin=None):
        terms = [table.c.uid == self.uid]
        if origin is not None:
            terms.append(table.c.origin == origin)
        return and_(*terms)

    def setup(self):
        with self.transaction() as connection:
            self._principal(connection, True)
        return self.context()

    @contextmanager
    def transaction(self):
        try:
            with self.engine.connect() as connection:
                connection.exec_driver_sql("BEGIN IMMEDIATE")
                try:
                    yield connection
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
        except IntegrityError as error:
            raise WorkspaceError("storage.integrity_conflict", 409) from error
        except OperationalError as error:
            raise WorkspaceError("storage.unavailable", 503) from error

    def _principal(self, connection, create=False):
        row = (
            connection.execute(select(principals).where(principals.c.uid == self.uid))
            .mappings()
            .first()
        )
        if row is None and create:
            connection.execute(
                insert(principals).values(uid=self.uid, generation=0, active_origin=None)
            )
            return {"uid": self.uid, "generation": 0, "active_origin": None}
        return row

    def context(self):
        with self.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            principal = self._principal(connection)
            rows = (
                connection.execute(
                    select(states.c.origin, states.c.revision, states.c.state_revision).where(
                        self.scope(states)
                    )
                )
                .mappings()
                .all()
            )
            return {
                "authenticated": True,
                "principalId": self.uid,
                "setupRequired": not rows,
                "activeOriginId": principal["active_origin"] if principal else None,
                "revision": principal["generation"] if principal else 0,
                "generation": principal["generation"] if principal else 0,
                "workspaces": [
                    {
                        "originId": row["origin"],
                        "revision": row["revision"],
                        "stateRevision": row["state_revision"],
                    }
                    for row in rows
                ],
            }

    def _read(
        self,
        connection,
        origin,
        full_modules=True,
        *,
        attachment_bytes=True,
        paper_modules=True,
        connector_modules=True,
    ):
        row = (
            connection.execute(select(states).where(self.scope(states, origin))).mappings().first()
        )
        if row is None:
            raise WorkspaceError("workspace.not_found", 404)
        snapshot = json.loads(row["snapshot_meta"])
        snapshot["tables"] = {}
        snapshot["attachments"] = {
            **snapshot.get("attachments", {}),
            **(
                {
                    item["id"]: {
                        "mimeType": item["mime_type"],
                        **(
                            {"base64": base64.b64encode(item["content"]).decode()}
                            if attachment_bytes
                            else {
                                "url": f"/api/local/v1/attachments/{item['id']}?originId={origin}"
                            }
                        ),
                        "originalSource": item["source"],
                    }
                    for item in connection.execute(
                        (
                            select(assets)
                            if attachment_bytes
                            else select(assets.c.id, assets.c.mime_type, assets.c.source)
                        ).where(self.scope(assets, origin))
                    ).mappings()
                }
                if full_modules
                else {}
            ),
        }
        snapshot["nativeCatalogs"] = {}
        if full_modules:
            for item in connection.execute(
                select(native_catalogs).where(self.scope(native_catalogs, origin))
            ).mappings():
                snapshot["nativeCatalogs"].setdefault(item["database"], {})[item["namespace"]] = (
                    json.loads(item["payload"])
                )
        for name, table in TABLES.items():
            snapshot["tables"][name] = [
                json.loads(record["payload"])
                for record in connection.execute(
                    select(table).where(self.scope(table, origin)).order_by(table.c.id)
                ).mappings()
            ]
        return {
            "snapshot": snapshot,
            "revision": row["revision"],
            "stateRevision": row["state_revision"],
            "bindings": json.loads(row["bindings"]),
            "journalLedger": self._read_journal_ledger(connection, origin),
            "paperSessions": (
                [
                    json.loads(item[0])
                    for item in connection.execute(
                        select(paper_sessions.c.payload)
                        .where(self.scope(paper_sessions, origin))
                        .order_by(paper_sessions.c.run_id)
                    )
                ]
                if full_modules and paper_modules
                else []
            ),
            "connectorRecords": (
                [
                    json.loads(item[0])
                    for item in connection.execute(
                        select(connectors.c.payload)
                        .where(self.scope(connectors, origin))
                        .order_by(connectors.c.id)
                    )
                ]
                if full_modules and connector_modules
                else []
            ),
        }

    def _read_journal_ledger(self, connection, origin):
        from services.journal_ledger import empty_ledger

        ledger = empty_ledger()
        for row in connection.execute(
            select(journal_records.c.kind, journal_records.c.payload)
            .where(self.scope(journal_records, origin))
            .order_by(journal_records.c.kind, journal_records.c.id)
        ):
            if row.kind not in ledger:
                raise WorkspaceError("journal.invalid_record_kind", 503)
            ledger[row.kind].append(json.loads(row.payload))
        ledger["history"].sort(
            key=lambda item: (item.get("sequence", 0), item.get("at", ""), item["id"])
        )
        return ledger

    def _write_journal_ledger(self, connection, origin, ledger, snapshot):
        from services.journal_ledger import FIELDS, validate_ledger

        try:
            ledger = validate_ledger(ledger, snapshot)
        except ValueError as error:
            raise WorkspaceError(str(error), 413 if "budget" in str(error) else 400) from error
        existing = {
            (row.kind, row.id): row.payload
            for row in connection.execute(
                select(
                    journal_records.c.kind, journal_records.c.id, journal_records.c.payload
                ).where(self.scope(journal_records, origin))
            )
        }
        for kind in FIELDS:
            for item in ledger[kind]:
                payload = dumps(item)
                if existing.get((kind, item["id"])) == payload:
                    continue
                values = {
                    "payload": payload,
                    "trade_id": item.get("tradeId"),
                    "book_id": item.get("bookId"),
                }
                if (kind, item["id"]) in existing:
                    if kind in ("observations", "history"):
                        raise WorkspaceError("journal.immutable_history", 409)
                    connection.execute(
                        update(journal_records)
                        .where(
                            self.scope(journal_records, origin),
                            journal_records.c.kind == kind,
                            journal_records.c.id == item["id"],
                        )
                        .values(**values)
                    )
                else:
                    connection.execute(
                        insert(journal_records).values(
                            uid=self.uid, origin=origin, kind=kind, id=item["id"], **values
                        )
                    )

    def workspace(self, origin=None):
        with self.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            principal = self._principal(connection)
            if principal is None or not principal["active_origin"]:
                raise WorkspaceError("workspace.setup_required", 409)
            origin = origin or principal["active_origin"]
            state = self._read(
                connection,
                origin,
                attachment_bytes=False,
                paper_modules=False,
                connector_modules=False,
            )
            result = {
                **state["snapshot"],
                "revision": state["revision"],
                "stateRevision": state["stateRevision"],
                "generation": principal["generation"],
                "books": state["bindings"]["books"],
                "bookAssignments": state["bindings"]["bookAssignments"],
                "archives": state["bindings"].get("archives", {}),
                "active": True,
                "journalLedger": state["journalLedger"],
            }
            attachment_urls = {
                item["originalSource"]: f"/api/local/v1/attachments/{id}?originId={origin}"
                for id, item in result.get("attachments", {}).items()
                if item.get("url") and item.get("originalSource")
            }
            for trade in result["tables"]["journalTrades"]:
                for field in ("screenshotUrl", "chartUrl"):
                    original = trade.get(field)
                    if isinstance(original, str) and original in attachment_urls:
                        trade[field] = attachment_urls[original]
            result["attachments"] = {
                id: (
                    {key: value for key, value in item.items() if key != "base64"}
                    | (
                        {"url": f"/api/local/v1/attachments/{id}?originId={origin}"}
                        if "base64" in item or item.get("url")
                        else {}
                    )
                )
                for id, item in result["attachments"].items()
            }
            return result

    def _receipt(self, connection, request_id, operation, body):
        if not valid_origin(request_id):
            raise WorkspaceError("request.invalid_id")
        existing = (
            connection.execute(
                select(receipts).where(
                    receipts.c.uid == self.uid, receipts.c.request_id == request_id
                )
            )
            .mappings()
            .first()
        )
        if existing:
            if existing["operation"] != operation or existing["input_hash"] != digest(body):
                raise WorkspaceError("request.reused_with_different_input", 409)
            return json.loads(existing["response"])

    def _save_receipt(self, connection, id, operation, body, response):
        connection.execute(
            insert(receipts).values(
                uid=self.uid,
                request_id=id,
                operation=operation,
                input_hash=digest(body),
                response=dumps(response),
            )
        )

    def _write(
        self,
        connection,
        snapshot,
        bindings,
        *,
        table_change=True,
        module_change=True,
        revision_floor=0,
        activate=False,
    ):
        principal = self._principal(connection, True)
        origin = snapshot["originId"]
        previous = (
            connection.execute(select(states).where(self.scope(states, origin))).mappings().first()
        )
        revision = (
            max(previous["revision"] if previous else 0, principal["generation"], revision_floor)
            + 1
            if table_change
            else previous["revision"]
        )
        state_revision = (
            max(
                previous["state_revision"] if previous else 0,
                principal["generation"],
                revision_floor,
            )
            + 1
        )
        meta = {
            key: value
            for key, value in snapshot.items()
            if key not in ("tables", "attachments", "nativeCatalogs")
        }
        meta["attachments"] = {
            id: item
            for id, item in snapshot["attachments"].items()
            if item.get("status") == "unavailable"
        }
        values = {
            "revision": revision,
            "state_revision": state_revision,
            "snapshot_meta": dumps(meta),
            "bindings": dumps(bindings),
            "native_mappings": dumps(bindings.get("nativeNamespaceMappings", {})),
        }
        if previous:
            connection.execute(update(states).where(self.scope(states, origin)).values(**values))
        else:
            if (
                connection.execute(
                    select(func.count()).select_from(states).where(self.scope(states))
                ).scalar_one()
                >= 1000
            ):
                raise WorkspaceError("snapshot.origin_budget_exceeded", 413)
            connection.execute(insert(states).values(uid=self.uid, origin=origin, **values))
        for db, catalogs in (snapshot["nativeCatalogs"] if module_change else {}).items():
            for namespace, catalog in catalogs.items():
                where = and_(
                    self.scope(native_catalogs, origin),
                    native_catalogs.c.database == db,
                    native_catalogs.c.namespace == namespace,
                )
                if connection.execute(select(native_catalogs.c.namespace).where(where)).first():
                    connection.execute(
                        update(native_catalogs)
                        .where(where)
                        .values(revision=catalog["revision"], payload=dumps(catalog))
                    )
                else:
                    connection.execute(
                        insert(native_catalogs).values(
                            uid=self.uid,
                            origin=origin,
                            database=db,
                            namespace=namespace,
                            revision=catalog["revision"],
                            payload=dumps(catalog),
                        )
                    )
        for id, item in (snapshot["attachments"] if module_change else {}).items():
            if item.get("status") == "unavailable":
                continue
            content = base64.b64decode(item["base64"], validate=True)
            where = and_(self.scope(assets, origin), assets.c.id == id)
            values = {
                "mime_type": item["mimeType"],
                "source": item.get("originalSource"),
                "content": content,
                "sha256": hashlib.sha256(content).hexdigest(),
            }
            if connection.execute(select(assets.c.id).where(where)).first():
                connection.execute(update(assets).where(where).values(**values))
            else:
                connection.execute(
                    insert(assets).values(uid=self.uid, origin=origin, id=id, **values)
                )
        for name, table in TABLES.items():
            existing_payloads = dict(
                connection.execute(
                    select(table.c.id, table.c.payload).where(self.scope(table, origin))
                ).all()
            )
            for row in snapshot["tables"][name]:
                payload = dumps(row)
                if existing_payloads.get(row["id"]) == payload:
                    continue
                columns = {
                    column: row.get(column)
                    for column in table.c.keys()
                    if column not in {"uid", "origin", "id", "payload"}
                }
                values = {"payload": payload, **columns}
                exists = row["id"] in existing_payloads
                if exists:
                    connection.execute(
                        update(table)
                        .where(self.scope(table, origin), table.c.id == row["id"])
                        .values(**values)
                    )
                else:
                    connection.execute(
                        insert(table).values(uid=self.uid, origin=origin, id=row["id"], **values)
                    )
                alias = opaque(
                    "legacy", self.uid + "|" + origin + "|" + name + "|" + str(row["id"])
                )
                if not exists:
                    connection.execute(
                        insert(aliases).values(
                            uid=self.uid,
                            origin=origin,
                            table_name=name,
                            legacy_id=row["id"],
                            canonical_id=alias,
                        )
                    )
        existing_books = set(
            connection.execute(
                select(book_registry.c.id).where(book_registry.c.uid == self.uid)
            ).scalars()
        )
        for book in bindings["books"]:
            if book["id"] not in existing_books:
                connection.execute(
                    insert(book_registry).values(
                        uid=self.uid,
                        id=book["id"],
                        account_key=book.get("accountKey"),
                        kind=book["kind"],
                        payload=dumps(book),
                    )
                )
        generation = principal["generation"] + 1
        connection.execute(
            update(principals)
            .where(principals.c.uid == self.uid)
            .values(
                generation=generation,
                active_origin=origin
                if activate or not principal["active_origin"]
                else principal["active_origin"],
            )
        )
        return {
            "originId": origin,
            "revision": revision,
            "stateRevision": state_revision,
            "generation": generation,
            "status": "saved",
        }

    def _issues(self, snapshot, target=None):
        issues = []
        trades = snapshot["tables"]["journalTrades"]
        if trades:
            issues.append(
                {
                    "id": "legacy-precision",
                    "kind": "precision",
                    "message": "Original numeric amounts are retained without claiming recovered decimal precision.",
                    "choices": ["keep-raw"],
                }
            )
        if any(
            any(
                isinstance(row.get(field), str)
                and row[field]
                and not re.search(r"(Z|[+-]\d\d:\d\d)$", row[field])
                for field in ("openDate", "closeDate")
            )
            for row in trades
        ):
            issues.append(
                {
                    "id": "legacy-timezone",
                    "kind": "time",
                    "message": "Date-only/local source times remain unchanged for later timezone normalization.",
                    "choices": ["keep-raw"],
                }
            )
        for row in trades:
            if (
                row.get("origin") == "manual"
                and not row.get("accountId")
                and not row.get("sessionId")
            ):
                continue
            if row.get("origin") in ("replay", "simulator") and row.get("sessionId"):
                continue
            choices = ["manual"]
            if row.get("accountId"):
                choices.append("account:" + str(row["accountId"]))
            if row.get("sessionId"):
                choices.append("paper:" + str(row["sessionId"]))
            issues.append(
                {
                    "id": "trade:" + str(row["id"]),
                    "kind": "ownership",
                    "table": "journalTrades",
                    "recordId": row["id"],
                    "message": "Choose the book for this source record; account metadata does not prove a live connection.",
                    "choices": choices,
                }
            )
        for db, catalogs in snapshot["nativeCatalogs"].items():
            for namespace in catalogs:
                if target and namespace != target:
                    issues.append(
                        {
                            "id": "native:" + db + ":" + namespace,
                            "kind": "namespace",
                            "message": f"Keep {namespace} or explicitly open it as {target}.",
                            "choices": ["preserve", "map-current"],
                            "sourceNamespace": namespace,
                            "targetNamespace": target,
                            "database": db,
                        }
                    )
        for row in trades:
            for field in ("screenshotUrl", "chartUrl"):
                value = row.get(field)
                if (
                    isinstance(value, str)
                    and value.startswith(("blob:", "http:", "https:"))
                    and not any(
                        item.get("originalSource") == value and "base64" in item
                        for item in snapshot["attachments"].values()
                    )
                ):
                    issues.append(
                        {
                            "id": f"attachment:{row['id']}:{field}",
                            "kind": "attachment",
                            "message": "This link has no portable bytes in the export; retain it as an explicitly external/unavailable reference.",
                            "choices": ["keep-reference"],
                        }
                    )
        return issues

    def preview_migration(self, snapshot, native_target=None):
        snapshot = validate_snapshot(snapshot, evidence_assets=True)
        if any(session.get("paper") for session in snapshot["tables"]["practiceSessions"]):
            raise WorkspaceError("paper.restore_workspace_required")
        if native_target is not None and (
            not isinstance(native_target, str) or not 1 <= len(native_target) <= 300
        ):
            raise WorkspaceError("snapshot.invalid_namespace")
        id = "migration_" + uuid4().hex
        job = {
            "id": id,
            "status": "preview",
            "snapshot": snapshot,
            "snapshotHash": digest(snapshot),
            "originId": snapshot["originId"],
            "tableChecksums": {name: digest(rows) for name, rows in snapshot["tables"].items()},
            "createdAt": now(),
            "issues": self._issues(snapshot, native_target),
            "counts": {name: len(rows) for name, rows in snapshot["tables"].items()},
            "nativeTargetNamespace": native_target,
        }
        with self.transaction() as connection:
            self._principal(connection, True)
            try:
                existing = self._read(connection, snapshot["originId"])
            except WorkspaceError:
                existing = None
            job["expectedRevision"] = existing["revision"] if existing else 0
            connection.execute(
                insert(jobs).values(uid=self.uid, id=id, kind="migration", payload=dumps(job))
            )
        return {key: value for key, value in job.items() if key != "snapshot"}

    def _bindings(self, snapshot, resolutions, issues=None, ledger=None):
        origin = snapshot["originId"]
        rows = snapshot["tables"]
        books = {}
        assignments = {}
        archives = {
            name: [row["id"] for row in values if row.get("archivedAt")]
            for name, values in rows.items()
        }
        profiles = {row["id"]: row for row in rows["portfolios"]}
        accounts = {row["id"]: row for row in rows["brokerAccounts"]}

        def book(kind, profile_id, account_id=None, session_id=None):
            account_key = None
            if kind == "connected":
                account = accounts[account_id]
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
                    else digest([origin, account_id, *fields])
                )
                key = self.uid + "|account|" + account_key
                name = account.get("displayName") or "Account book"
            else:
                key = (
                    self.uid
                    + "|"
                    + origin
                    + "|"
                    + kind
                    + "|"
                    + str(session_id if kind == "paper" else profile_id)
                )
                name = profiles[profile_id].get("name", "Journal") + (
                    " · Paper" if kind == "paper" else " · Manual"
                )
            id = opaque("book", key)
            books.setdefault(
                id,
                {
                    "id": id,
                    "kind": kind,
                    "name": name,
                    "profileIds": [],
                    "accountId": account_id,
                    "accountKey": account_key,
                    "sessionId": session_id,
                    "identityState": "declared" if kind == "connected" else "local",
                    "ownerId": self.uid,
                },
            )
            if profile_id not in books[id]["profileIds"]:
                books[id]["profileIds"].append(profile_id)
            return id

        for profile_id in profiles:
            book("manual", profile_id)
        for session in rows["practiceSessions"]:
            if session.get("paper"):
                book("paper", session["portfolioId"], session_id=session["id"])
        for link in (ledger or {}).get("bookLinks", []):
            if link.get("portfolioId") not in profiles or link.get("accountId") not in accounts:
                raise WorkspaceError("journal.invalid_book_link")
            book("connected", link["portfolioId"], account_id=link["accountId"])
        for row in rows["journalTrades"]:
            choice = resolutions.get("trade:" + str(row["id"]))
            if choice is None:
                choice = (
                    "paper:" + str(row["sessionId"])
                    if row.get("origin") in ("replay", "simulator") and row.get("sessionId")
                    else "manual"
                )
            if choice.startswith("account:"):
                bid = book("connected", row["portfolioId"], account_id=int(choice.split(":")[1]))
            elif choice.startswith("paper:"):
                bid = book("paper", row["portfolioId"], session_id=int(choice.split(":")[1]))
            else:
                bid = book("manual", row["portfolioId"])
            if row.get("journalBookId") and row["journalBookId"] != bid:
                raise WorkspaceError("journal.book_mismatch", 409)
            assignments["journalTrades:" + str(row["id"])] = bid
            assignments[str(row["id"])] = bid
        mappings = {}
        for issue in issues or []:
            if issue["kind"] == "namespace" and resolutions.get(issue["id"]) == "map-current":
                db = issue["database"]
                target = issue["targetNamespace"]
                source = issue["sourceNamespace"]
                if target in mappings.setdefault(db, {}) and mappings[db][target] != source:
                    raise WorkspaceError("migration.ambiguous_namespace", 409)
                mappings[db][target] = source
        return {
            "books": list(books.values()),
            "bookAssignments": assignments,
            "resolutions": resolutions,
            "archives": archives,
            "nativeNamespaceMappings": mappings,
        }

    def get_job(self, id, kind=None):
        with self.engine.connect() as connection:
            row = (
                connection.execute(select(jobs).where(jobs.c.uid == self.uid, jobs.c.id == id))
                .mappings()
                .first()
            )
            if row is None or (kind and row["kind"] != kind):
                raise WorkspaceError("job.not_found", 404)
            return json.loads(row["payload"])

    def commit_migration(self, id, resolutions, request_id):
        if not isinstance(resolutions, dict):
            raise WorkspaceError("migration.resolutions_required")
        body = {"id": id, "resolutions": resolutions}
        with self.transaction() as connection:
            replay = self._receipt(connection, request_id, "migration", body)
            if replay:
                return replay
            row = (
                connection.execute(
                    select(jobs).where(
                        jobs.c.uid == self.uid, jobs.c.id == id, jobs.c.kind == "migration"
                    )
                )
                .mappings()
                .first()
            )
            if row is None:
                raise WorkspaceError("job.not_found", 404)
            job = json.loads(row["payload"])
            if job["status"] == "completed":
                return job["receipt"]
            valid_choices = {issue["id"]: issue["choices"] for issue in job["issues"]}
            if set(resolutions) != set(valid_choices) or any(
                choice not in valid_choices[key] for key, choice in resolutions.items()
            ):
                raise WorkspaceError("migration.unresolved_issues", 409, job["issues"])
            try:
                existing = self._read(connection, job["snapshot"]["originId"])
            except WorkspaceError:
                existing = None
            if existing and existing["revision"] != job["expectedRevision"]:
                raise WorkspaceError("storage.revision_conflict", 409)
            if existing:
                if digest(
                    {
                        key: value
                        for key, value in existing["snapshot"].items()
                        if key != "createdAt"
                    }
                ) == digest(
                    {key: value for key, value in job["snapshot"].items() if key != "createdAt"}
                ):
                    receipt = {
                        "status": "completed",
                        "originId": job["snapshot"]["originId"],
                        "revision": existing["revision"],
                        "idempotent": True,
                    }
                else:
                    raise WorkspaceError("migration.changed_origin_requires_review", 409)
            else:
                receipt = {
                    **self._write(
                        connection,
                        job["snapshot"],
                        self._bindings(job["snapshot"], resolutions, job["issues"]),
                        activate=True,
                    ),
                    "status": "completed",
                    "counts": job["counts"],
                    "snapshotHash": job["snapshotHash"],
                    "tableChecksums": job.get(
                        "tableChecksums",
                        {name: digest(rows) for name, rows in job["snapshot"]["tables"].items()},
                    ),
                }
            job["status"] = "completed"
            job["receipt"] = receipt
            job["resolutions"] = resolutions
            connection.execute(
                update(jobs)
                .where(jobs.c.uid == self.uid, jobs.c.id == id)
                .values(payload=dumps(job))
            )
            self._save_receipt(connection, request_id, "migration", body, receipt)
            return receipt

    def save_tables(self, origin, tables, expected_revision, request_id):
        body = {"origin": origin, "tables": tables, "expectedRevision": expected_revision}
        dataset_library = None
        if isinstance(tables, dict) and any(
            isinstance(row, dict)
            and any(
                key in row
                for key in ("datasetVersionId", "datasetChecksum", "chartSource", "chartView")
            )
            for name in ("portfolios", "practiceSessions")
            for row in (tables.get(name) if isinstance(tables.get(name), list) else [])
        ):
            from services.data_library import DataLibrary

            dataset_library = DataLibrary(self)
        with self.transaction() as connection:
            replay = self._receipt(connection, request_id, "tables", body)
            if replay:
                return replay
            previous = self._read(connection, origin, full_modules=False)
            if type(expected_revision) is not int or expected_revision != previous["revision"]:
                raise WorkspaceError("storage.revision_conflict", 409)
            snapshot = deepcopy(previous["snapshot"])
            snapshot["tables"] = deepcopy(tables)
            if not isinstance(tables, dict) or set(tables) != set(TABLES):
                raise WorkspaceError("snapshot.tables_required")
            for name, old in previous["snapshot"]["tables"].items():
                if not isinstance(tables[name], list):
                    raise WorkspaceError("snapshot.invalid_table")
                supplied = {row.get("id") for row in tables[name] if isinstance(row, dict)}
                snapshot["tables"][name] += [
                    {**row, "archivedAt": row.get("archivedAt") or now()}
                    for row in old
                    if row["id"] not in supplied
                ]
            snapshot = validate_snapshot(snapshot)
            from services.connector_records import ConnectorRecords, validate_account_bindings

            validate_account_bindings(snapshot, ConnectorRecords(self).list(connection, origin))
            for name in ("journalTrades", "practiceSessions"):
                old_rows = {item["id"]: item for item in previous["snapshot"]["tables"][name]}
                for item in snapshot["tables"][name]:
                    if item.get("chartEvidence") != old_rows.get(item["id"], {}).get(
                        "chartEvidence"
                    ):
                        raise WorkspaceError("chart.evidence_server_owned", 409)
            previous_sessions = {
                row["id"]: row for row in previous["snapshot"]["tables"]["practiceSessions"]
            }
            for session in snapshot["tables"]["practiceSessions"]:
                old = previous_sessions.get(session["id"], {})
                if session.get("paper") != old.get("paper"):
                    raise WorkspaceError("paper.server_owned", 409)
                if old.get("paper") and any(
                    session.get(key) != old.get(key)
                    for key in (
                        "portfolioId",
                        "symbol",
                        "timeframe",
                        "market",
                        "mode",
                        "status",
                        "startingBalance",
                        "currency",
                        "dataSource",
                        "rangeStart",
                        "rangeEnd",
                        "datasetVersionId",
                        "datasetChecksum",
                    )
                ):
                    raise WorkspaceError("paper.manifest_locked", 409)
                if (old.get("datasetVersionId"), old.get("datasetChecksum")) != (
                    session.get("datasetVersionId"),
                    session.get("datasetChecksum"),
                ) and any(
                    trade.get("sessionId") == session["id"]
                    for trade in previous["snapshot"]["tables"]["journalTrades"]
                ):
                    raise WorkspaceError("dataset.version_reference_locked", 409)
            previous_profiles = {
                item["id"]: item for item in previous["snapshot"]["tables"]["portfolios"]
            }
            for profile in snapshot["tables"]["portfolios"]:
                if (
                    profile.get("kind") != "replay"
                    or previous_profiles.get(profile["id"], {}).get("kind") == "replay"
                ):
                    continue
                source = profile.get("chartSource")
                if (
                    not isinstance(source, dict)
                    or set(source) != {"kind", "versionId", "checksum"}
                    or source.get("kind") != "dataset"
                    or not isinstance(source.get("versionId"), str)
                    or not isinstance(source.get("checksum"), str)
                ):
                    raise WorkspaceError("dataset.profile_history_required", 409)
                try:
                    version = dataset_library._version(connection, source["versionId"])
                except WorkspaceError as error:
                    if error.code not in {"dataset.invalid_identity", "dataset.version_not_found"}:
                        raise
                    raise WorkspaceError("dataset.profile_history_required", 409) from error
                if (
                    version.get("archivedAt")
                    or type(version.get("rowCount")) is not int
                    or version["rowCount"] < 1
                ):
                    raise WorkspaceError("dataset.profile_history_required", 409)
                if source["checksum"] != version["checksum"]:
                    raise WorkspaceError("dataset.checksum_mismatch", 409)
                if any(
                    profile.get(profile_field) != version["metadata"].get(source_field)
                    for profile_field, source_field in (
                        ("defaultSymbol", "symbol"),
                        ("defaultTimeframe", "interval"),
                        ("currency", "currency"),
                    )
                ):
                    raise WorkspaceError("dataset.profile_source_mismatch", 409)
            if dataset_library:
                from services.chart_context import validate_chart_bindings

                validate_chart_bindings(connection, snapshot, previous, dataset_library)
                for session in snapshot["tables"]["practiceSessions"]:
                    old = previous_sessions.get(session["id"], {})
                    binding = (session.get("datasetVersionId"), session.get("datasetChecksum"))
                    if binding == (old.get("datasetVersionId"), old.get("datasetChecksum")) and all(
                        session.get(key) == old.get(key)
                        for key in ("symbol", "timeframe", "status")
                    ):
                        continue
                    if old.get("datasetVersionId") and any(
                        trade.get("sessionId") == session["id"]
                        for trade in previous["snapshot"]["tables"]["journalTrades"]
                    ):
                        raise WorkspaceError("dataset.version_reference_locked", 409)
                    if binding == (None, None):
                        continue
                    if session.get("status") != "Draft" or not all(
                        isinstance(value, str) for value in binding
                    ):
                        raise WorkspaceError("dataset.draft_reference_required")
                    version = dataset_library._version(connection, binding[0])
                    if version["checksum"] != binding[1]:
                        raise WorkspaceError("dataset.checksum_mismatch", 409)
                    if (
                        session.get("symbol") != version["metadata"]["symbol"]
                        or session.get("timeframe") != version["metadata"]["interval"]
                    ):
                        raise WorkspaceError("dataset.instrument_or_interval_mismatch", 409)
                    manifests = snapshot.setdefault("datasetManifests", [])
                    if not any(item.get("id") == version["id"] for item in manifests):
                        if len(manifests) >= 10000:
                            raise WorkspaceError("dataset.manifest_limit", 413)
                        manifests.append(
                            {
                                key: version[key]
                                for key in (
                                    "id",
                                    "datasetId",
                                    "checksum",
                                    "rowCount",
                                    "start",
                                    "end",
                                )
                            }
                        )
            new_accounts = {row["id"]: row for row in snapshot["tables"]["brokerAccounts"]}
            for account in previous["snapshot"]["tables"]["brokerAccounts"]:
                if any(
                    row.get("accountId") == account["id"]
                    for row in previous["snapshot"]["tables"]["journalTrades"]
                ):
                    if any(
                        account.get(key) != new_accounts[account["id"]].get(key)
                        for key in (
                            "platform",
                            "brokerName",
                            "server",
                            "externalLogin",
                            "accountKind",
                            "currency",
                        )
                    ):
                        raise WorkspaceError("account.identity_locked", 409)
            previous_trades = {
                row["id"]: row for row in previous["snapshot"]["tables"]["journalTrades"]
            }
            journal_history_added = False
            history_sequence = max(
                [item.get("sequence", 0) for item in previous["journalLedger"]["history"]] + [0]
            )
            journal_tracked_ids = {
                item.get("tradeId") for item in previous["journalLedger"]["events"]
            }
            for trade in snapshot["tables"]["journalTrades"]:
                old = previous_trades.get(trade["id"])
                tracked = old is not None and (
                    bool(old.get("factRevision")) or trade["id"] in journal_tracked_ids
                )
                if tracked:
                    if any(
                        old.get(key) != trade.get(key)
                        for key in (set(old) | set(trade)) - {"archivedAt", "journalBookId"}
                    ):
                        raise WorkspaceError("journal.tracked_trade_requires_action", 409)
                    if old.get("archivedAt") != trade.get("archivedAt"):
                        history_sequence += 1
                        journal_history_added = True
                        previous["journalLedger"]["history"].append(
                            {
                                "id": "history_" + uuid4().hex,
                                "sequence": history_sequence,
                                "at": now(),
                                "tradeId": trade["id"],
                                "bookId": previous["bindings"]["bookAssignments"].get(
                                    str(trade["id"])
                                ),
                                "action": "archive-trade"
                                if trade.get("archivedAt")
                                else "restore-trade",
                                "reason": "Compatibility archive/recovery action",
                                "before": deepcopy(old),
                                "after": deepcopy(trade),
                            }
                        )
                elif any(
                    trade.get(key) is not None and key not in (old or {})
                    for key in (
                        "amounts",
                        "realizations",
                        "factRevision",
                        "reviewRevision",
                        "positionKey",
                        "sourceEventKeys",
                    )
                ):
                    raise WorkspaceError("journal.tracked_trade_requires_action", 409)
                if old and old.get("origin") not in (None, "manual"):
                    editable = {
                        "archivedAt",
                        "journalBookId",
                        "strategy",
                        "setup",
                        "tags",
                        "rating",
                        "screenshotUrl",
                        "chartUrl",
                        "preTradeState",
                        "conviction",
                        "planConfirmed",
                        "riskDefined",
                        "emotion",
                        "emotionalNotes",
                        "technicalNotes",
                        "otherNotes",
                        "notes",
                    }
                    immutable = (set(old) | set(trade)) - editable
                    if any(old.get(key) != trade.get(key) for key in immutable):
                        raise WorkspaceError("trade.source_fact_locked", 409)
            archived_profiles = {
                row["id"] for row in snapshot["tables"]["portfolios"] if row.get("archivedAt")
            }
            for destination in snapshot["tables"]["profileDestinations"]:
                if destination["portfolioId"] in archived_profiles:
                    destination["copyingEnabled"] = False
            bindings = self._bindings(
                snapshot,
                previous["bindings"].get("resolutions", {}),
                ledger=previous["journalLedger"],
            )
            bindings["nativeNamespaceMappings"] = previous["bindings"].get(
                "nativeNamespaceMappings", {}
            )
            result = self._write(connection, snapshot, bindings, module_change=False)
            if journal_history_added:
                self._write_journal_ledger(connection, origin, previous["journalLedger"], snapshot)
            response = {
                **snapshot,
                **result,
                "books": bindings["books"],
                "bookAssignments": bindings["bookAssignments"],
                "archives": bindings["archives"],
                "active": True,
                "journalLedger": previous["journalLedger"],
            }
            self._save_receipt(connection, request_id, "tables", body, response)
            return response

    def save_preferences(self, origin, preferences, request_id, expected_preferences):
        if not isinstance(expected_preferences, dict):
            raise WorkspaceError("preferences.expected_state_required")
        body = {
            "origin": origin,
            "preferences": preferences,
            "expectedPreferences": expected_preferences,
        }
        with self.transaction() as connection:
            replay = self._receipt(connection, request_id, "preferences", body)
            if replay:
                return replay
            principal = self._principal(connection)
            if not principal or not principal["active_origin"]:
                raise WorkspaceError("workspace.setup_required", 409)
            origin = origin or principal["active_origin"]
            row = connection.execute(
                select(states.c.snapshot_meta).where(self.scope(states, origin))
            ).first()
            if row is None:
                raise WorkspaceError("workspace.not_found", 404)
            meta = json.loads(row[0])
            if meta.get("preferences", {}) != expected_preferences:
                raise WorkspaceError("storage.revision_conflict", 409)
            meta["preferences"] = preferences
            validate_snapshot({**meta, "tables": {name: [] for name in TABLES}})
            generation = principal["generation"] + 1
            connection.execute(
                update(states)
                .where(self.scope(states, origin))
                .values(snapshot_meta=dumps(meta), state_revision=states.c.state_revision + 1)
            )
            connection.execute(
                update(principals).where(principals.c.uid == self.uid).values(generation=generation)
            )
            result = {"status": "saved", "generation": generation, "preferences": preferences}
            self._save_receipt(connection, request_id, "preferences", body, result)
            return result

    def attachment(self, id, origin=None):
        with self.engine.connect() as connection:
            principal = self._principal(connection)
            if not principal:
                raise WorkspaceError("attachment.not_found", 404)
            origin = origin or principal["active_origin"]
            row = (
                connection.execute(
                    select(assets).where(self.scope(assets, origin), assets.c.id == id)
                )
                .mappings()
                .first()
            )
            if row is None:
                raise WorkspaceError("attachment.not_found", 404)
            if hashlib.sha256(row["content"]).hexdigest() != row["sha256"]:
                raise WorkspaceError("attachment.corrupt", 503)
            return row

    def native(self, kind, namespace, origin=None):
        if kind not in NATIVE or not isinstance(namespace, str) or not 1 <= len(namespace) <= 300:
            raise WorkspaceError("native.invalid_context")
        with self.engine.connect() as connection:
            principal = self._principal(connection)
            if not principal or not principal["active_origin"]:
                raise WorkspaceError("workspace.setup_required", 409)
            origin = origin or principal["active_origin"]
            db = NATIVE[kind]
            row = connection.execute(
                select(states.c.native_mappings).where(self.scope(states, origin))
            ).first()
            if row is None:
                raise WorkspaceError("workspace.not_found", 404)
            source = json.loads(row[0]).get(db, {}).get(namespace, namespace)
            catalog = connection.execute(
                select(native_catalogs.c.payload).where(
                    self.scope(native_catalogs, origin),
                    native_catalogs.c.database == db,
                    native_catalogs.c.namespace == source,
                )
            ).first()
            value = json.loads(catalog[0]) if catalog else None
            return {
                "catalog": value,
                "revision": value["revision"] if value else 0,
                "generation": principal["generation"],
            }

    def save_native(self, kind, namespace, catalog, expected_revision, request_id, origin=None):
        if (
            kind not in NATIVE
            or not isinstance(namespace, str)
            or not 1 <= len(namespace) <= 300
            or not isinstance(catalog, dict)
        ):
            raise WorkspaceError("native.invalid_context")
        body = {
            "kind": kind,
            "namespace": namespace,
            "catalog": catalog,
            "expected": expected_revision,
            "origin": origin,
        }
        with self.transaction() as connection:
            replay = self._receipt(connection, request_id, "native", body)
            if replay:
                return replay
            principal = self._principal(connection)
            if not principal or not principal["active_origin"]:
                raise WorkspaceError("workspace.setup_required", 409)
            origin = origin or principal["active_origin"]
            db = NATIVE[kind]
            row = connection.execute(
                select(states.c.native_mappings).where(self.scope(states, origin))
            ).first()
            if row is None:
                raise WorkspaceError("workspace.not_found", 404)
            source = json.loads(row[0]).get(db, {}).get(namespace, namespace)
            where = and_(
                self.scope(native_catalogs, origin),
                native_catalogs.c.database == db,
                native_catalogs.c.namespace == source,
            )
            old = connection.execute(select(native_catalogs.c.payload).where(where)).first()
            previous = json.loads(old[0]) if old else None
            revision = previous["revision"] if previous else 0
            if (
                type(expected_revision) is not int
                or expected_revision != revision
                or catalog.get("revision") != revision + 1
            ):
                raise WorkspaceError("storage.revision_conflict", 409)
            validate_snapshot(
                {
                    "format": "chartly-browser-snapshot",
                    "version": 1,
                    "originId": origin,
                    "createdAt": now(),
                    "tables": {key: [] for key in TABLES},
                    "nativeCatalogs": {db: {source: catalog}},
                }
            )
            if old:
                connection.execute(
                    update(native_catalogs)
                    .where(where)
                    .values(payload=dumps(catalog), revision=catalog["revision"])
                )
            else:
                if (
                    connection.execute(
                        select(func.count())
                        .select_from(native_catalogs)
                        .where(
                            self.scope(native_catalogs, origin), native_catalogs.c.database == db
                        )
                    ).scalar_one()
                    >= 10000
                ):
                    raise WorkspaceError("native.namespace_budget_exceeded", 413)
                connection.execute(
                    insert(native_catalogs).values(
                        uid=self.uid,
                        origin=origin,
                        database=db,
                        namespace=source,
                        payload=dumps(catalog),
                        revision=catalog["revision"],
                    )
                )
            generation = principal["generation"] + 1
            connection.execute(
                update(principals).where(principals.c.uid == self.uid).values(generation=generation)
            )
            connection.execute(
                update(states)
                .where(self.scope(states, origin))
                .values(state_revision=states.c.state_revision + 1)
            )
            response = {
                "catalog": catalog,
                "revision": catalog["revision"],
                "generation": generation,
            }
            self._save_receipt(connection, request_id, "native", body, response)
            return response

    def set_active(self, origin):
        with self.transaction() as connection:
            if not connection.execute(
                select(states.c.origin).where(self.scope(states, origin))
            ).first():
                raise WorkspaceError("workspace.not_found", 404)
            connection.execute(
                update(principals)
                .where(principals.c.uid == self.uid)
                .values(active_origin=origin, generation=principals.c.generation + 1)
            )
        return self.context()

    def current_revision(self, scope=None):
        self._check_scope(scope)
        return self.context()["generation"]

    def _check_scope(self, scope):
        if scope is not None and scope != self.uid:
            raise WorkspaceError("scope.denied", 403)

    def snapshot(self, scope=None):
        self._check_scope(scope)
        with self.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            principal = self._principal(connection)
            if not principal or not principal["active_origin"]:
                raise WorkspaceError("workspace.setup_required", 409)
            all_states = [
                self._read(connection, row["origin"])
                for row in connection.execute(
                    select(states.c.origin).where(self.scope(states))
                ).mappings()
            ]
            active = next(
                item
                for item in all_states
                if item["snapshot"]["originId"] == principal["active_origin"]
            )
            return {
                **active,
                "revision": principal["generation"],
                "principalUid": self.uid,
                "activeOriginId": principal["active_origin"],
                "workspaces": all_states,
            }

    def save_recovery_job(self, scope, job):
        self._check_scope(scope)
        with self.transaction() as connection:
            self._principal(connection, True)
            old = connection.execute(
                select(jobs.c.id).where(jobs.c.uid == self.uid, jobs.c.id == job["id"])
            ).first()
            if old:
                connection.execute(
                    update(jobs)
                    .where(jobs.c.uid == self.uid, jobs.c.id == job["id"])
                    .values(payload=dumps(job))
                )
            else:
                connection.execute(
                    insert(jobs).values(
                        uid=self.uid, id=job["id"], kind="restore", payload=dumps(job)
                    )
                )

    def get_recovery_job(self, scope, id):
        self._check_scope(scope)
        return self.get_job(id, "restore")

    def recovery_status(self):
        """Return restart-safe job metadata without staged workspace content.

        Call through the workspace worker: the durable job envelope can contain
        a large staged snapshot even though this response contains only metadata.
        """
        result = {"restores": [], "migrations": []}
        migration_fields = (
            "id",
            "status",
            "snapshotHash",
            "createdAt",
            "counts",
            "nativeTargetNamespace",
            "expectedRevision",
            "receipt",
        )
        restore_fields = (
            "jobId",
            "expectedRevision",
            "confirmationHash",
            "archiveSha256",
            "originCount",
            "activeOriginId",
            "tableCounts",
            "moduleCounts",
            "excludedModules",
            "ownershipChange",
            "requiresOwnershipConfirmation",
            "recoveryCopyId",
        )
        output_bytes = len(dumps(result).encode("utf-8"))
        with self.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            for kind, key in (("restore", "restores"), ("migration", "migrations")):
                fields = (
                    (*restore_fields, "status", "receipt")
                    if kind == "restore"
                    else migration_fields
                )
                # SQLite projects only public paths. The staged snapshot stays
                # inside SQLite; Python never loads twenty full job envelopes.
                paths = [
                    (
                        "$.preview." + field
                        if kind == "restore" and field in restore_fields
                        else "$." + field
                    )
                    for field in fields
                ]
                projected = func.json_extract(jobs.c.payload, *paths)
                count_paths = (
                    ("$.preview.unavailableAttachments", "$.preview.unverifiedDependencies")
                    if kind == "restore"
                    else ("$.issues", None)
                )
                counts = [
                    func.coalesce(func.json_array_length(jobs.c.payload, path), 0)
                    if path
                    else literal_column("0")
                    for path in count_paths
                ]
                values = connection.execute(
                    select(projected, *counts)
                    .where(jobs.c.uid == self.uid, jobs.c.kind == kind)
                    .order_by(literal_column("rowid").desc())
                    .limit(20)
                )
                for value, first_count, second_count in values:
                    if (
                        len(value) > MAX_RECOVERY_STATUS_BYTES
                        or len(value.encode("utf-8")) > MAX_RECOVERY_STATUS_BYTES
                    ):
                        raise WorkspaceError("recovery.status_too_large", 413)
                    extracted = json.loads(value)
                    public = {
                        field: item
                        for field, item in zip(fields, extracted, strict=True)
                        if item is not None
                    }
                    if kind == "restore":
                        public.update(
                            unavailableAttachments=[],
                            unavailableAttachmentCount=first_count,
                            unverifiedDependencies=[],
                            unverifiedDependencyCount=second_count,
                            previewDetailsTruncated=True,
                        )
                    else:
                        public.update(
                            issues=[], issuesCount=first_count, issuesTruncated=bool(first_count)
                        )
                    output_bytes += len(dumps(public).encode("utf-8")) + bool(result[key])
                    if output_bytes > MAX_RECOVERY_STATUS_BYTES:
                        raise WorkspaceError("recovery.status_too_large", 413)
                    result[key].append(public)
        return result

    def get_recovery_copy(self, scope, id):
        self._check_scope(scope)
        with self.engine.connect() as connection:
            row = connection.execute(
                select(recovery_copies.c.payload).where(
                    recovery_copies.c.uid == self.uid, recovery_copies.c.id == id
                )
            ).first()
            if row is None:
                raise WorkspaceError("recovery.not_found", 404)
            return {"principalUid": self.uid, **json.loads(row[0])}

    def restore_snapshot(self, scope, state, expected_revision, job_id):
        from services.connector_records import (
            ConnectorRecords,
        )
        from services.connector_records import (
            rebind_record as rebind_connector,
        )
        from services.connector_records import (
            validate_records as validate_connectors,
        )
        from services.journal_ledger import empty_ledger, rebind_ledger, validate_ledger
        from services.paper_records import PaperRecords, rebind_record, validate_records

        self._check_scope(scope)
        workspaces = (
            state["workspaces"]
            if "workspaces" in state
            else [
                {
                    "snapshot": state["snapshot"],
                    "bindings": state.get("bindings", {}),
                    "journalLedger": state.get("journalLedger", empty_ledger()),
                    "paperSessions": state.get("paperSessions", []),
                    "connectorRecords": state.get("connectorRecords", []),
                }
            ]
        )
        validated = []
        for item in workspaces:
            snapshot = validate_snapshot(item["snapshot"], evidence_assets=True)
            try:
                ledger = validate_ledger(item.get("journalLedger", empty_ledger()), snapshot)
            except (TypeError, ValueError) as error:
                raise WorkspaceError("restore.invalid_journal_records") from error
            paper = validate_records(item.get("paperSessions", []), snapshot)
            connector_values = validate_connectors(
                item.get("connectorRecords", []), snapshot, item.get("bindings", {})
            )
            validated.append((snapshot, item.get("bindings", {}), ledger, paper, connector_values))
        if len({snapshot["originId"] for snapshot, _, _, _, _ in validated}) != len(validated):
            raise WorkspaceError("restore.duplicate_origin")
        with self.transaction() as connection:
            principal = self._principal(connection, True)
            job_row = (
                connection.execute(
                    select(jobs).where(
                        jobs.c.uid == self.uid, jobs.c.id == job_id, jobs.c.kind == "restore"
                    )
                )
                .mappings()
                .first()
            )
            if not job_row:
                raise WorkspaceError("job.not_found", 404)
            job = json.loads(job_row["payload"])
            if job.get("status") == "completed":
                return job["receipt"]
            if principal["generation"] != expected_revision:
                raise WorkspaceError("storage.revision_conflict", 409)
            old_states = [
                self._read(connection, row["origin"])
                for row in connection.execute(
                    select(states.c.origin).where(self.scope(states))
                ).mappings()
            ]
            old_by_origin = {item["snapshot"]["originId"]: item for item in old_states}
            recovery_id = "recovery_" + uuid4().hex
            connection.execute(
                insert(recovery_copies).values(
                    uid=self.uid,
                    id=recovery_id,
                    payload=dumps(
                        {"activeOriginId": principal["active_origin"], "workspaces": old_states}
                    ),
                )
            )
            connection.execute(delete(connector_secrets).where(connector_secrets.c.uid == self.uid))
            connection.execute(delete(connectors).where(connectors.c.uid == self.uid))
            connection.execute(delete(paper_sessions).where(paper_sessions.c.uid == self.uid))
            connection.execute(delete(journal_records).where(journal_records.c.uid == self.uid))
            for table in reversed(list(TABLES.values())):
                connection.execute(delete(table).where(self.scope(table)))
            connection.execute(delete(assets).where(assets.c.uid == self.uid))
            connection.execute(delete(native_catalogs).where(native_catalogs.c.uid == self.uid))
            connection.execute(delete(aliases).where(aliases.c.uid == self.uid))
            connection.execute(delete(states).where(states.c.uid == self.uid))
            connection.execute(delete(book_registry).where(book_registry.c.uid == self.uid))
            for snapshot, bindings, ledger, paper, connector_values in validated:
                old = old_by_origin.get(snapshot["originId"], {})
                for db, catalogs in snapshot["nativeCatalogs"].items():
                    for namespace, catalog in catalogs.items():
                        prior = (
                            old.get("snapshot", {})
                            .get("nativeCatalogs", {})
                            .get(db, {})
                            .get(namespace, {})
                        )
                        catalog["revision"] = max(catalog["revision"], prior.get("revision", 0)) + 1
                for trade in snapshot["tables"]["journalTrades"]:
                    trade.pop("journalBookId", None)
                rebuilt = self._bindings(snapshot, bindings.get("resolutions", {}), ledger=ledger)
                rebuilt["nativeNamespaceMappings"] = bindings.get("nativeNamespaceMappings", {})

                def book_signature(book):
                    kind = book.get("kind")
                    if kind == "connected":
                        return kind, book.get("accountKey") or book.get("accountId")
                    if kind == "paper":
                        return kind, book.get("sessionId")
                    return kind, tuple(sorted(book.get("profileIds", [])))

                targets = {book_signature(book): book["id"] for book in rebuilt["books"]}
                book_map = {
                    book["id"]: targets[book_signature(book)]
                    for book in bindings.get("books", [])
                    if isinstance(book, dict)
                    and isinstance(book.get("id"), str)
                    and book_signature(book) in targets
                }
                for kind, items in ledger.items():
                    if kind != "version" and any(
                        item.get("bookId") and item["bookId"] not in book_map for item in items
                    ):
                        raise WorkspaceError("restore.book_rebind_failed")
                ledger = rebind_ledger(ledger, book_map)
                self._write(
                    connection,
                    snapshot,
                    rebuilt,
                    revision_floor=max(old.get("revision", 0), old.get("stateRevision", 0)),
                )
                self._write_journal_ledger(connection, snapshot["originId"], ledger, snapshot)
                for record in paper:
                    PaperRecords(self).save(
                        connection,
                        snapshot["originId"],
                        record["runId"],
                        rebind_record(record, self.uid, snapshot["originId"], book_map),
                    )
                book_accounts = {
                    book["id"]: book.get("accountKey")
                    for book in rebuilt["books"]
                    if book.get("kind") == "connected"
                }
                for record in connector_values:
                    ConnectorRecords(self).save(
                        connection,
                        snapshot["originId"],
                        record["id"],
                        rebind_connector(
                            record, self.uid, snapshot["originId"], book_map, book_accounts
                        ),
                    )
            active = (
                (state.get("activeOriginId") or validated[0][0]["originId"]) if validated else None
            )
            if validated and active not in {
                snapshot["originId"] for snapshot, _, _, _, _ in validated
            }:
                raise WorkspaceError("restore.invalid_active_origin")
            if not validated:
                connection.execute(
                    update(principals)
                    .where(principals.c.uid == self.uid)
                    .values(generation=principal["generation"] + 1)
                )
            connection.execute(
                update(principals).where(principals.c.uid == self.uid).values(active_origin=active)
            )
            generation = self._principal(connection)["generation"]
            receipt = {
                "status": "completed",
                "originId": active,
                "revision": generation,
                "generation": generation,
                "recoveryCopyId": recovery_id,
                "activated": True,
            }
            job["status"] = "completed"
            job["receipt"] = receipt
            connection.execute(
                update(jobs)
                .where(jobs.c.uid == self.uid, jobs.c.id == job_id)
                .values(payload=dumps(job))
            )
            return receipt
