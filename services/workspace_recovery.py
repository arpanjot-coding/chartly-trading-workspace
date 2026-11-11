"""Scoped module archives and transactional recovery for durable workspaces.

Archive content is data. This module never extracts paths, imports supplied code,
restores credentials, arms a destination or starts a strategy runtime. The bound
storage service supplies authenticated ownership and the atomic restore boundary.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
import re
import stat
import struct
from collections import Counter
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from typing import Any
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZIP_STORED, BadZipFile, ZipFile

from services.chart_preferences import CHART_PREFERENCES_KEY, validate_chart_preferences

MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024
MAX_ROWS = 100_000
MAX_ORIGINS = 1_000
MAX_JSON_NODES = 4_000_000
TABLES = (
    "portfolios",
    "practiceSessions",
    "journalTrades",
    "dailyMoods",
    "brokerAccounts",
    "terminals",
    "profileDestinations",
)
CATALOG_DATABASES = frozenset(
    (
        "openalgo-chart-workspaces",
        "openalgo-chart-watchlists",
        "openalgo-chart-drawing-templates",
    )
)
PREFERENCE_KEYS = frozenset(
    (
        "chartly.combined-selection.v1",
        "chartly.customIndicators.manifest.v1",
        "oa-trading-script-open",
        "oa-trading-script-recent",
        "oa-agent-model",
        "chartly-theme",
    )
)
DRAFT_KEY = re.compile(r"oa-trading-script-draft:[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\.oscript\Z")
SCRIPT_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\.oscript\Z")
FORBIDDEN_KEYS = frozenset(
    (
        "password",
        "passwordhash",
        "apikey",
        "brokerapikey",
        "apisecret",
        "clientsecret",
        "secret",
        "privatekey",
        "accesstoken",
        "refreshtoken",
        "authtoken",
        "authorization",
        "sessioncookie",
        "cookie",
        "appkey",
        "accountauthtag",
        "token",
        "auth",
        "credentials",
        "totpsecret",
    )
)
EXCLUSIONS = (
    "authentication-and-credential-stores",
    "live-runtime-activation",
    "installed-strategy-code",
    "market-data-file-content",
    "unscoped-legacy-backend-databases",
)


class WorkspaceRecoveryError(Exception):
    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


def _fail(code: str, status: int = 400):
    raise WorkspaceRecoveryError(code, status)


def _json(value: Any) -> bytes:
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
        ).encode("utf-8")
    except (ValueError, TypeError, RecursionError, UnicodeError) as error:
        raise WorkspaceRecoveryError("recovery.invalid_json") from error


def _pairs(values):
    result = {}
    for key, value in values:
        if key in result:
            _fail("recovery.duplicate_json_key")
        result[key] = value
    return result


def _load(data: bytes):
    try:
        return json.loads(
            data,
            object_pairs_hook=_pairs,
            parse_constant=lambda _: _fail("recovery.nonfinite_number"),
        )
    except (ValueError, UnicodeError, RecursionError) as error:
        raise WorkspaceRecoveryError("recovery.invalid_json") from error


def _text(value, limit=500):
    return isinstance(value, str) and 0 < len(value) <= limit


def _integer(value, minimum=0, maximum=9_007_199_254_740_991):
    return type(value) is int and minimum <= value <= maximum


def _instant(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z", value
    ):
        return False
    try:
        datetime.fromisoformat(value)
        return True
    except ValueError:
        return False


def _data_only(value):
    pending = [(value, 0)]
    nodes = 0
    while pending:
        current, depth = pending.pop()
        nodes += 1
        if nodes > MAX_JSON_NODES or depth > 64:
            _fail("recovery.payload_budget_exceeded", 413)
        if current is None or isinstance(current, (str, bool, int)):
            continue
        if isinstance(current, float):
            if not math.isfinite(current):
                _fail("recovery.nonfinite_number")
        elif isinstance(current, list):
            pending.extend((item, depth + 1) for item in current)
        elif isinstance(current, dict):
            for key, item in current.items():
                if not isinstance(key, str):
                    _fail("recovery.invalid_json")
                normalized = re.sub(r"[^a-z0-9]", "", key.lower())
                if normalized in FORBIDDEN_KEYS or key in ("__proto__", "prototype", "constructor"):
                    _fail("recovery.credentials_forbidden")
                pending.append((item, depth + 1))
        else:
            _fail("recovery.invalid_json")


def _tables(value):
    if not isinstance(value, dict) or set(value) != set(TABLES):
        _fail("recovery.invalid_tables")
    indexes = {}
    total = 0
    for name in TABLES:
        rows = value[name]
        if not isinstance(rows, list) or len(rows) > MAX_ROWS:
            _fail("recovery.table_budget_exceeded", 413)
        index = {}
        for row in rows:
            if not isinstance(row, dict) or not _integer(row.get("id"), 1):
                _fail("recovery.invalid_record_identity")
            if row["id"] in index:
                _fail("recovery.duplicate_record_identity")
            index[row["id"]] = row
        indexes[name] = index
        total += len(rows)
    if total > MAX_ROWS:
        _fail("recovery.table_budget_exceeded", 413)
    relationships = {
        "practiceSessions": {"portfolioId": ("portfolios", True)},
        "journalTrades": {
            "portfolioId": ("portfolios", True),
            "sessionId": ("practiceSessions", False),
            "accountId": ("brokerAccounts", False),
        },
        "dailyMoods": {"portfolioId": ("portfolios", True)},
        "terminals": {"assignedAccountId": ("brokerAccounts", False)},
        "profileDestinations": {
            "portfolioId": ("portfolios", True),
            "accountId": ("brokerAccounts", True),
            "terminalId": ("terminals", False),
        },
    }
    for name, fields in relationships.items():
        for row in value[name]:
            for field, (target, required) in fields.items():
                if field not in row and not required:
                    continue
                key = row.get(field)
                if not _integer(key, 1) or key not in indexes[target]:
                    _fail("recovery.broken_relationship")
            if name == "journalTrades" and "sessionId" in row:
                if (
                    indexes["practiceSessions"][row["sessionId"]]["portfolioId"]
                    != row["portfolioId"]
                ):
                    _fail("recovery.broken_relationship")


def _catalogs(value):
    if not isinstance(value, dict) or not set(value).issubset(CATALOG_DATABASES):
        _fail("recovery.invalid_catalogs")
    for database, namespaces in value.items():
        if not isinstance(namespaces, dict) or len(namespaces) > 10_000:
            _fail("recovery.invalid_catalogs")
        for namespace, catalog in namespaces.items():
            if not _text(namespace, 300) or not isinstance(catalog, dict):
                _fail("recovery.invalid_catalogs")
            if not _integer(catalog.get("revision"), 0):
                _fail("recovery.invalid_catalog_revision")
            if type(catalog.get("version")) is not int or catalog["version"] != 1:
                _fail("recovery.unsupported_catalog_version")
            if database == "openalgo-chart-workspaces":
                for field in ("workspaces", "templates", "recentWorkspaceIds"):
                    if not isinstance(catalog.get(field), list):
                        _fail("recovery.invalid_catalogs")
                if type(catalog.get("autosave")) is not bool:
                    _fail("recovery.invalid_catalogs")
                ids = set()
                for document in catalog["workspaces"]:
                    _document_metadata(document, "workspace")
                    if document["id"] in ids:
                        _fail("recovery.invalid_catalogs")
                    ids.add(document["id"])
                    _workspace_document(document)
                if catalog.get("activeWorkspaceId") is not None and (
                    not isinstance(catalog["activeWorkspaceId"], str)
                    or catalog["activeWorkspaceId"] not in ids
                ):
                    _fail("recovery.invalid_catalogs")
                recents = catalog["recentWorkspaceIds"]
                if any(not isinstance(id, str) or id not in ids for id in recents) or len(
                    set(recents)
                ) != len(recents):
                    _fail("recovery.invalid_catalogs")
                templates = set()
                for document in catalog["templates"]:
                    _document_metadata(document, "indicator-template")
                    if (
                        document["id"] in templates
                        or not isinstance(document.get("indicators"), list)
                        or any(not isinstance(item, dict) for item in document["indicators"])
                    ):
                        _fail("recovery.invalid_catalogs")
                    templates.add(document["id"])
            elif database == "openalgo-chart-watchlists":
                if not isinstance(catalog.get("lists"), list):
                    _fail("recovery.invalid_catalogs")
                ids = set()
                for item in catalog["lists"]:
                    if (
                        not isinstance(item, dict)
                        or not _text(item.get("id"))
                        or not _text(item.get("name"))
                        or item["id"] in ids
                        or not isinstance(item.get("entries"), list)
                    ):
                        _fail("recovery.invalid_catalogs")
                    _times(item)
                    ids.add(item["id"])
                    for instrument in item["entries"]:
                        if (
                            not isinstance(instrument, dict)
                            or not isinstance(instrument.get("symbol"), str)
                            or not isinstance(instrument.get("exchange"), str)
                        ):
                            _fail("recovery.invalid_catalogs")
                if catalog.get("activeListId") is not None and (
                    not isinstance(catalog["activeListId"], str)
                    or catalog["activeListId"] not in ids
                ):
                    _fail("recovery.invalid_catalogs")
            else:
                if not isinstance(catalog.get("templates"), list) or not isinstance(
                    catalog.get("defaults"), list
                ):
                    _fail("recovery.invalid_catalogs")
                ids = set()
                tools = set()
                for item in catalog["templates"]:
                    if (
                        not isinstance(item, dict)
                        or not _text(item.get("id"))
                        or not _text(item.get("name"))
                        or not _text(item.get("tool"))
                        or not isinstance(item.get("values"), dict)
                        or item["id"] in ids
                    ):
                        _fail("recovery.invalid_catalogs")
                    _times(item)
                    ids.add(item["id"])
                for item in catalog["defaults"]:
                    if (
                        not isinstance(item, dict)
                        or not _text(item.get("tool"))
                        or not isinstance(item.get("values"), dict)
                        or item["tool"] in tools
                        or not _number(item.get("updatedAt"))
                    ):
                        _fail("recovery.invalid_catalogs")
                    tools.add(item["tool"])


def _number(value):
    return (
        type(value) in (int, float) and 0 <= value <= 9_007_199_254_740_991 and math.isfinite(value)
    )


def _times(value):
    if (
        not _number(value.get("createdAt"))
        or not _number(value.get("updatedAt"))
        or value["updatedAt"] < value["createdAt"]
    ):
        _fail("recovery.invalid_catalog_timestamp")


def _document_metadata(value, kind):
    if (
        not isinstance(value, dict)
        or type(value.get("version")) is not int
        or value["version"] != 1
        or value.get("kind") != kind
        or not _text(value.get("id"))
        or not _text(value.get("name"))
    ):
        _fail("recovery.invalid_catalog_document")
    _times(value)


def _workspace_document(value):
    panes = value.get("panes")
    layout = value.get("layout")
    sync = value.get("sync")
    if (
        not isinstance(panes, list)
        or not 1 <= len(panes) <= 64
        or not isinstance(layout, dict)
        or not isinstance(sync, dict)
    ):
        _fail("recovery.invalid_workspace_layout")
    rows = layout.get("rows")
    columns = layout.get("columns")
    slots = layout.get("slots")
    if (
        not _integer(rows, 1, 64)
        or not _integer(columns, 1, 64)
        or not isinstance(slots, list)
        or len(slots) != len(panes)
    ):
        _fail("recovery.invalid_workspace_layout")
    ids = set()
    for pane in panes:
        if (
            not isinstance(pane, dict)
            or not _text(pane.get("id"))
            or pane["id"] in ids
            or any(
                not isinstance(pane.get(field), str)
                for field in ("symbol", "exchange", "interval", "chartType")
            )
            or not isinstance(pane.get("chart"), dict)
            or not isinstance(pane.get("settings"), dict)
        ):
            _fail("recovery.invalid_workspace_layout")
        if (
            any(type(pane.get(field)) is not bool for field in ("volume", "stay"))
            or pane.get("magnet") not in ("off", "weak", "strong")
            or pane.get("comparisonMode") not in ("price", "percent")
            or not isinstance(pane.get("comparisons"), list)
        ):
            _fail("recovery.invalid_workspace_layout")
        ids.add(pane["id"])
    if not isinstance(value.get("activePaneId"), str) or value["activePaneId"] not in ids:
        _fail("recovery.invalid_workspace_layout")
    covered = set()
    slotted = set()
    for slot in slots:
        if (
            not isinstance(slot, dict)
            or not isinstance(slot.get("paneId"), str)
            or slot["paneId"] not in ids
            or slot["paneId"] in slotted
        ):
            _fail("recovery.invalid_workspace_layout")
        if (
            any(
                not _integer(slot.get(field), 0 if field in ("row", "column") else 1, 64)
                for field in ("row", "column", "rowSpan", "columnSpan")
            )
            or slot["row"] + slot["rowSpan"] > rows
            or slot["column"] + slot["columnSpan"] > columns
        ):
            _fail("recovery.invalid_workspace_layout")
        slotted.add(slot["paneId"])
        for row in range(slot["row"], slot["row"] + slot["rowSpan"]):
            for column in range(slot["column"], slot["column"] + slot["columnSpan"]):
                if (row, column) in covered:
                    _fail("recovery.invalid_workspace_layout")
                covered.add((row, column))
    if any(
        type(sync.get(field)) is not bool
        for field in ("crosshair", "viewport", "symbol", "interval")
    ):
        _fail("recovery.invalid_workspace_layout")


validate_native_catalogs = _catalogs


def _preferences(value):
    if not isinstance(value, dict) or len(value) > 10_000:
        _fail("recovery.invalid_preferences")
    for key, raw in value.items():
        if (
            key not in PREFERENCE_KEYS
            and not DRAFT_KEY.fullmatch(key)
            and not CHART_PREFERENCES_KEY.fullmatch(key)
        ):
            _fail("recovery.preference_forbidden")
        if not isinstance(raw, str) or len(raw) > (
            2 * 1024 * 1024 if CHART_PREFERENCES_KEY.fullmatch(key) else 2_000_000
        ):
            _fail("recovery.invalid_preferences")
        if DRAFT_KEY.fullmatch(key):
            # Draft source is retained as text, never evaluated by recovery.
            continue
        if CHART_PREFERENCES_KEY.fullmatch(key):
            try:
                decoded = validate_chart_preferences(raw)
            except ValueError as error:
                raise WorkspaceRecoveryError("recovery.invalid_chart_preferences") from error
            _data_only(decoded)
            continue
        if key == "oa-trading-script-open":
            if not SCRIPT_NAME.fullmatch(raw):
                _fail("recovery.invalid_preferences")
            continue
        if key == "oa-agent-model":
            if not re.fullmatch(r"[0-9]{1,20}", raw):
                _fail("recovery.invalid_preferences")
            continue
        decoded = _load(raw.encode("utf-8"))
        _data_only(decoded)
        if key == "chartly-theme":
            if not isinstance(decoded, dict) or not set(decoded).issubset({"state", "version"}):
                _fail("recovery.invalid_theme")
            state = decoded.get("state")
            if not isinstance(state, dict) or set(state) != {"mode", "color"}:
                _fail("recovery.invalid_theme")
            if state["mode"] not in ("light", "dark", "system") or not _text(state["color"], 100):
                _fail("recovery.invalid_theme")
        elif key == "oa-trading-script-recent":
            if (
                not isinstance(decoded, list)
                or len(decoded) > 100
                or any(
                    not isinstance(name, str) or not SCRIPT_NAME.fullmatch(name) for name in decoded
                )
            ):
                _fail("recovery.invalid_preferences")
        elif key == "chartly.combined-selection.v1":
            if (
                not isinstance(decoded, dict)
                or set(decoded) != {"version", "profileIds", "currency"}
                or type(decoded["version"]) is not int
                or decoded["version"] != 1
            ):
                _fail("recovery.invalid_selection")
            if (
                not isinstance(decoded["profileIds"], list)
                or any(not _integer(id, 1) for id in decoded["profileIds"])
                or not isinstance(decoded["currency"], str)
                or not re.fullmatch(r"[A-Z]{3}", decoded["currency"])
            ):
                _fail("recovery.invalid_selection")


def _attachments(value):
    if not isinstance(value, dict) or len(value) > MAX_ROWS:
        _fail("recovery.invalid_attachments")
    for id, item in value.items():
        if (
            not isinstance(id, str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{7,127}", id)
            or not isinstance(item, dict)
            or not set(item).issubset(
                {"mimeType", "base64", "originalSource", "status", "reason", "sha256", "bytes"}
            )
        ):
            _fail("recovery.invalid_attachment")
        if item.get("status") == "unavailable":
            if (
                "base64" in item
                or not _text(item.get("originalSource"), MAX_ATTACHMENT_BYTES)
                or "reason" in item
                and not _text(item.get("reason"), 1000)
            ):
                _fail("recovery.invalid_attachment")
            continue
        if "status" in item and item["status"] != "available":
            _fail("recovery.invalid_attachment")
        if not isinstance(item.get("mimeType"), str) or not re.fullmatch(
            r"[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+", item["mimeType"]
        ):
            _fail("recovery.invalid_attachment")
        if item.get("originalSource") is not None and not _text(
            item["originalSource"], MAX_UNCOMPRESSED_BYTES
        ):
            _fail("recovery.invalid_attachment")
        if item["mimeType"] not in {
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
        }:
            _fail("recovery.attachment_type_forbidden")
        raw = item.get("base64")
        if not isinstance(raw, str) or len(raw) > ((MAX_ATTACHMENT_BYTES + 2) // 3) * 4:
            _fail("recovery.attachment_budget_exceeded", 413)
        try:
            content = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError) as error:
            raise WorkspaceRecoveryError("recovery.invalid_attachment") from error
        if len(content) > MAX_ATTACHMENT_BYTES:
            _fail("recovery.attachment_budget_exceeded", 413)
        if "sha256" in item and item["sha256"] != hashlib.sha256(content).hexdigest():
            _fail("recovery.attachment_checksum_mismatch")
        if "bytes" in item and (type(item["bytes"]) is not int or item["bytes"] != len(content)):
            _fail("recovery.attachment_checksum_mismatch")


def _datasets(value):
    if (
        not isinstance(value, list)
        or len(value) > 10_000
        or any(not isinstance(item, dict) for item in value)
    ):
        _fail("recovery.invalid_dataset_manifests")


def _bindings(value):
    if not isinstance(value, dict):
        _fail("recovery.invalid_bindings")


def _empty_journal_ledger():
    from services.journal_ledger import empty_ledger

    return empty_ledger()


def _journal_records(value):
    from services.journal_ledger import validate_ledger

    try:
        validate_ledger(value)
    except (TypeError, ValueError) as error:
        raise WorkspaceRecoveryError(
            "recovery.invalid_journal_records", 413 if "budget" in str(error) else 400
        ) from error


def _workspace_bindings(workspace):
    bindings = workspace.get("bindings", {})
    resolutions = bindings.get("resolutions", {})
    snapshot = workspace["snapshot"]
    tables = snapshot.get("tables", {})
    if not isinstance(resolutions, dict) or any(
        not isinstance(key, str) or not isinstance(choice, str)
        for key, choice in resolutions.items()
    ):
        _fail("recovery.invalid_bindings")
    trades = {str(row["id"]): row for row in tables.get("journalTrades", [])}
    for key, choice in resolutions.items():
        if not key.startswith("trade:"):
            continue
        trade = trades.get(key[6:])
        if (
            trade is None
            or choice
            not in (
                "manual",
                "account:" + str(trade.get("accountId")),
                "paper:" + str(trade.get("sessionId")),
            )
            or choice in ("account:None", "paper:None")
        ):
            _fail("recovery.invalid_book_resolution")
    mappings = bindings.get("nativeNamespaceMappings", {})
    if not isinstance(mappings, dict):
        _fail("recovery.invalid_bindings")
    for database, namespaces in mappings.items():
        catalogs = snapshot.get("nativeCatalogs", {}).get(database)
        if (
            not isinstance(catalogs, dict)
            or not isinstance(namespaces, dict)
            or any(
                not _text(target, 300) or not isinstance(source, str) or source not in catalogs
                for target, source in namespaces.items()
            )
        ):
            _fail("recovery.invalid_namespace_mapping")
    if "books" in bindings and (
        not isinstance(bindings["books"], list)
        or any(not isinstance(book, dict) for book in bindings["books"])
    ):
        _fail("recovery.invalid_bindings")
    ledger = workspace.get("journalLedger")
    if ledger:
        books = {
            book.get("id"): book
            for book in bindings.get("books", [])
            if isinstance(book.get("id"), str)
        }
        referenced = {
            item["bookId"]
            for key, items in ledger.items()
            if key != "version"
            for item in items
            if isinstance(item.get("bookId"), str)
        }
        profiles = {row["id"] for row in tables.get("portfolios", [])}
        accounts = {row["id"] for row in tables.get("brokerAccounts", [])}
        sessions = {row["id"] for row in tables.get("practiceSessions", [])}
        for id in referenced:
            book = books.get(id)
            if book is None:
                _fail("recovery.missing_journal_book")
            kind = book.get("kind")
            if kind == "connected" and book.get("accountId") in accounts:
                continue
            if kind == "paper" and book.get("sessionId") in sessions:
                continue
            if (
                kind == "manual"
                and isinstance(book.get("profileIds"), list)
                and book["profileIds"]
                and all(type(id) is int and id in profiles for id in book["profileIds"])
            ):
                continue
            _fail("recovery.invalid_journal_book")


@dataclass(frozen=True)
class BackupModule:
    name: str
    field: str
    source: str
    validate: Callable[[Any], None]


def _paper_sessions(value):
    from services.paper_records import validate_records
    from services.workspace_storage import WorkspaceError

    try:
        validate_records(value)
    except WorkspaceError as error:
        raise WorkspaceRecoveryError(error.code, error.status) from error


def _connectors(value):
    from services.connector_records import validate_records
    from services.workspace_storage import WorkspaceError

    try:
        validate_records(value)
    except WorkspaceError as error:
        raise WorkspaceRecoveryError(error.code, error.status) from error


class BackupModuleRegistry:
    """Only installed trusted code registers modules; archives cannot add code."""

    def __init__(self, modules=None):
        self.modules = {}
        for module in (
            modules
            if modules is not None
            else (
                BackupModule("journal", "tables", "snapshot", _tables),
                BackupModule("charts", "nativeCatalogs", "snapshot", _catalogs),
                BackupModule("preferences", "preferences", "snapshot", _preferences),
                BackupModule("attachments", "attachments", "snapshot", _attachments),
                BackupModule("datasets", "datasetManifests", "snapshot", _datasets),
                BackupModule("bindings", "bindings", "workspace", _bindings),
                BackupModule("journal-records", "journalLedger", "workspace", _journal_records),
                BackupModule("paper-sessions", "paperSessions", "workspace", _paper_sessions),
                BackupModule("connectors", "connectorRecords", "workspace", _connectors),
            )
        ):
            self.register(module)

    def register(self, module):
        if (
            not isinstance(module, BackupModule)
            or not isinstance(module.name, str)
            or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", module.name)
            or not _text(module.field, 100)
            or not callable(module.validate)
            or module.source not in ("snapshot", "workspace")
            or module.name in self.modules
            or module.source == "snapshot"
            and module.field in {"format", "version", "originId", "createdAt"}
            or module.source == "workspace"
            and module.field in {"snapshot", "revision", "stateRevision"}
            or any(
                existing.field == module.field and existing.source == module.source
                for existing in self.modules.values()
            )
        ):
            _fail("recovery.invalid_module_registration")
        self.modules[module.name] = module

    def paths(self):
        return {f"modules/{name}.json" for name in self.modules}


DEFAULT_REGISTRY = BackupModuleRegistry()
SNAPSHOT_META = {"format", "version", "originId", "createdAt"}


def _normalize_state(state, registry=DEFAULT_REGISTRY):
    _data_only(state)
    if not isinstance(state, dict) or not _text(state.get("principalUid"), 256):
        _fail("recovery.invalid_scope")
    if not set(state).issubset(
        {
            "principalUid",
            "activeOriginId",
            "workspaces",
            "snapshot",
            "revision",
            "stateRevision",
            "bindings",
            "generation",
            "journalLedger",
            "paperSessions",
            "connectorRecords",
        }
    ):
        _fail("recovery.invalid_state")
    has_journal = any(
        module.source == "workspace" and module.field == "journalLedger"
        for module in registry.modules.values()
    )
    has_paper = any(
        module.source == "workspace" and module.field == "paperSessions"
        for module in registry.modules.values()
    )
    has_connectors = any(
        module.source == "workspace" and module.field == "connectorRecords"
        for module in registry.modules.values()
    )
    if "journalLedger" in state and not has_journal:
        _fail("recovery.unsupported_modules")
    if "paperSessions" in state and not has_paper:
        _fail("recovery.unsupported_modules")
    if "connectorRecords" in state and not has_connectors:
        _fail("recovery.unsupported_modules")
    if "workspaces" in state:
        workspaces = deepcopy(state["workspaces"])
    elif isinstance(state.get("snapshot"), dict):
        workspaces = [
            {
                "snapshot": deepcopy(state["snapshot"]),
                "revision": state.get("revision", 0),
                "bindings": deepcopy(state.get("bindings", {})),
                **(
                    {"journalLedger": deepcopy(state.get("journalLedger", _empty_journal_ledger()))}
                    if has_journal
                    else {}
                ),
                **(
                    {"paperSessions": deepcopy(state.get("paperSessions", []))} if has_paper else {}
                ),
                **(
                    {"connectorRecords": deepcopy(state.get("connectorRecords", []))}
                    if has_connectors
                    else {}
                ),
            }
        ]
    else:
        workspaces = []
    if not isinstance(workspaces, list) or len(workspaces) > MAX_ORIGINS:
        _fail("recovery.invalid_workspaces")
    seen = set()
    for workspace in workspaces:
        allowed = {"snapshot", "revision", "stateRevision"} | {
            module.field for module in registry.modules.values() if module.source == "workspace"
        }
        if (
            not isinstance(workspace, dict)
            or not set(workspace).issubset(allowed)
            or not isinstance(workspace.get("snapshot"), dict)
        ):
            _fail("recovery.invalid_workspace")
        if not _integer(workspace.get("revision", 0)) or not _integer(
            workspace.get("stateRevision", 0)
        ):
            _fail("recovery.invalid_revision")
        snapshot = workspace["snapshot"]
        expected = SNAPSHOT_META | {
            module.field for module in registry.modules.values() if module.source == "snapshot"
        }
        if (
            set(snapshot) != expected
            or snapshot["format"] != "chartly-browser-snapshot"
            or type(snapshot["version"]) is not int
            or snapshot["version"] != 1
        ):
            _fail("recovery.unsupported_snapshot")
        origin = snapshot["originId"]
        if (
            not isinstance(origin, str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{7,127}", origin)
            or origin in seen
            or not _instant(snapshot["createdAt"])
        ):
            _fail("recovery.invalid_origin")
        seen.add(origin)
        for module in registry.modules.values():
            source = snapshot if module.source == "snapshot" else workspace
            if module.field not in source and module.field == "bindings":
                source[module.field] = {}
            if module.field not in source and module.field == "journalLedger":
                source[module.field] = _empty_journal_ledger()
            if module.field not in source and module.field == "paperSessions":
                source[module.field] = []
            if module.field not in source and module.field == "connectorRecords":
                source[module.field] = []
            if module.field not in source:
                _fail("recovery.missing_module")
            module.validate(source[module.field])
        if "journalLedger" in workspace:
            from services.journal_ledger import validate_ledger

            try:
                validate_ledger(workspace["journalLedger"], snapshot)
            except (TypeError, ValueError) as error:
                raise WorkspaceRecoveryError(
                    "recovery.invalid_journal_records", 413 if "budget" in str(error) else 400
                ) from error
        _workspace_bindings(workspace)
        if has_paper:
            from services.paper_records import validate_records
            from services.workspace_storage import WorkspaceError

            try:
                validate_records(workspace["paperSessions"], snapshot)
            except WorkspaceError as error:
                raise WorkspaceRecoveryError(error.code, error.status) from error
        if has_connectors:
            from services.connector_records import validate_records as validate_connectors
            from services.workspace_storage import WorkspaceError

            try:
                validate_connectors(
                    workspace["connectorRecords"], snapshot, workspace.get("bindings", {})
                )
            except WorkspaceError as error:
                raise WorkspaceRecoveryError(error.code, error.status) from error
        from services.chart_evidence_validation import snapshot_evidence
        from services.workspace_storage import WorkspaceError

        try:
            snapshot_evidence(snapshot, require_assets=True)
        except WorkspaceError as error:
            raise WorkspaceRecoveryError(error.code, error.status) from error
    active = state.get("activeOriginId")
    if active is None and len(workspaces) == 1:
        active = workspaces[0]["snapshot"]["originId"]
    if (
        workspaces
        and (not isinstance(active, str) or active not in seen)
        or not workspaces
        and active is not None
    ):
        _fail("recovery.invalid_active_origin")
    generation = state.get("generation", state.get("revision", 0))
    if not _integer(generation) or "revision" in state and state["revision"] != generation:
        _fail("recovery.invalid_revision")
    result = {
        "principalUid": state["principalUid"],
        "activeOriginId": active,
        "workspaces": workspaces,
        "revision": generation,
        "generation": generation,
    }
    selected = next((item for item in workspaces if item["snapshot"]["originId"] == active), None)
    if selected is not None:
        # A supplied active mirror must agree; never silently drop divergent data.
        if "snapshot" in state and _json(state["snapshot"]) != _json(selected["snapshot"]):
            _fail("recovery.active_mirror_mismatch")
        if "bindings" in state and _json(state["bindings"]) != _json(selected["bindings"]):
            _fail("recovery.active_mirror_mismatch")
        if "journalLedger" in state and _json(state["journalLedger"]) != _json(
            selected.get("journalLedger", _empty_journal_ledger())
        ):
            _fail("recovery.active_mirror_mismatch")
        if "paperSessions" in state and _json(state["paperSessions"]) != _json(
            selected.get("paperSessions", [])
        ):
            _fail("recovery.active_mirror_mismatch")
        if "connectorRecords" in state and _json(state["connectorRecords"]) != _json(
            selected.get("connectorRecords", [])
        ):
            _fail("recovery.active_mirror_mismatch")
        if "stateRevision" in state and state["stateRevision"] != selected.get("stateRevision", 0):
            _fail("recovery.invalid_revision")
        result.update(
            snapshot=deepcopy(selected["snapshot"]), bindings=deepcopy(selected.get("bindings", {}))
        )
        if has_journal:
            result["journalLedger"] = deepcopy(
                selected.get("journalLedger", _empty_journal_ledger())
            )
        if has_paper:
            result["paperSessions"] = deepcopy(selected.get("paperSessions", []))
        if has_connectors:
            result["connectorRecords"] = deepcopy(selected.get("connectorRecords", []))
        if "stateRevision" in selected:
            result["stateRevision"] = selected["stateRevision"]
    elif (
        "snapshot" in state
        or "bindings" in state
        or "journalLedger" in state
        or "paperSessions" in state
        or "connectorRecords" in state
    ):
        _fail("recovery.active_mirror_mismatch")
    return result


def _module_counts(state, registry=DEFAULT_REGISTRY):
    tables = Counter(dict.fromkeys(TABLES, 0))
    counts = Counter(dict.fromkeys(registry.modules, 0))
    unavailable = []
    dependencies = []
    for workspace in state["workspaces"]:
        snapshot = workspace["snapshot"]
        origin = snapshot["originId"]
        for name, rows in snapshot.get("tables", {}).items():
            tables[name] += len(rows)
            counts["journal"] += len(rows)
        counts["charts"] += sum(len(value) for value in snapshot.get("nativeCatalogs", {}).values())
        counts["preferences"] += len(snapshot.get("preferences", {}))
        counts["attachments"] += len(snapshot.get("attachments", {}))
        counts["datasets"] += len(snapshot.get("datasetManifests", []))
        counts["bindings"] += len(workspace.get("bindings", {}).get("books", []))
        for id, attachment in snapshot.get("attachments", {}).items():
            if attachment.get("status") == "unavailable":
                unavailable.append(
                    {
                        "originId": origin,
                        "id": id,
                        "originalSource": attachment.get("originalSource"),
                        "reason": attachment.get(
                            "reason", "Attachment content was not available at export"
                        ),
                    }
                )
        if snapshot.get("datasetManifests"):
            dependencies.append(
                {"originId": origin, "kind": "market-data-files", "status": "references-retained"}
            )
        if snapshot.get("preferences", {}).get("chartly.customIndicators.manifest.v1"):
            dependencies.append(
                {
                    "originId": origin,
                    "kind": "installed-indicator-code",
                    "status": "verification-required",
                }
            )
        for name, module in registry.modules.items():
            if name == "journal-records":
                counts[name] += sum(
                    len(rows)
                    for key, rows in workspace.get("journalLedger", {}).items()
                    if key != "version"
                )
            elif name not in {
                "journal",
                "charts",
                "preferences",
                "attachments",
                "datasets",
                "bindings",
            }:
                source = snapshot if module.source == "snapshot" else workspace
                value = source[module.field]
                counts[name] += (
                    len(value) if isinstance(value, (dict, list)) else 0 if value is None else 1
                )
    return {
        "tableCounts": dict(tables),
        "moduleCounts": dict(counts),
        "originCount": len(state["workspaces"]),
        "activeOriginId": state["activeOriginId"],
        "unavailableAttachments": unavailable,
        "unverifiedDependencies": dependencies,
    }


def build_workspace_backup(scope: str, state: dict, registry=DEFAULT_REGISTRY) -> bytes:
    normalized = _normalize_state(state, registry)
    if normalized["principalUid"] != scope:
        _fail("recovery.scope_denied", 403)
    metadata = {
        key: normalized[key] for key in ("principalUid", "activeOriginId", "revision", "generation")
    }
    metadata["workspaces"] = []
    module_values = {name: {} for name in registry.modules}
    for workspace in normalized["workspaces"]:
        snapshot = workspace["snapshot"]
        origin = snapshot["originId"]
        item = {
            "metadata": {key: snapshot[key] for key in SNAPSHOT_META},
            "revision": workspace.get("revision", 0),
        }
        if "stateRevision" in workspace:
            item["stateRevision"] = workspace["stateRevision"]
        metadata["workspaces"].append(item)
        for name, module in registry.modules.items():
            source = snapshot if module.source == "snapshot" else workspace
            module_values[name][origin] = source[module.field]
    files = {"state.json": _json(metadata)}
    files.update({f"modules/{name}.json": _json(value) for name, value in module_values.items()})
    if sum(len(value) for value in files.values()) > MAX_UNCOMPRESSED_BYTES:
        _fail("recovery.archive_budget_exceeded", 413)
    manifest = {
        "format": "chartly-workspace-backup",
        "version": 1,
        "createdAt": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "modules": list(registry.modules),
        "excludedModules": list(EXCLUSIONS),
        "counts": _module_counts(normalized, registry),
        "files": {
            name: {"sha256": hashlib.sha256(value).hexdigest(), "bytes": len(value)}
            for name, value in files.items()
        },
    }
    manifest_bytes = _json(manifest)
    # The reader budgets every ZIP member, including the manifest itself.
    if len(manifest_bytes) + sum(len(value) for value in files.values()) > MAX_UNCOMPRESSED_BYTES:
        _fail("recovery.archive_budget_exceeded", 413)
    result = BytesIO()
    with ZipFile(result, "w", compression=ZIP_DEFLATED, allowZip64=False) as archive:
        archive.writestr("manifest.json", manifest_bytes)
        for name, value in files.items():
            archive.writestr(name, value)
    data = result.getvalue()
    if len(data) > MAX_ARCHIVE_BYTES:
        _fail("recovery.archive_budget_exceeded", 413)
    return data


def inspect_workspace_backup(data: bytes, registry=DEFAULT_REGISTRY):
    if not isinstance(data, bytes) or not 22 <= len(data) <= MAX_ARCHIVE_BYTES:
        _fail("recovery.invalid_archive_size", 413)
    signature, disk, central_disk, disk_count, count, directory_bytes, offset, comment = (
        struct.unpack("<4s4H2LH", data[-22:])
    )
    expected = {"manifest.json", "state.json"} | registry.paths()
    optional_modules = [
        name
        for name in ("journal-records", "paper-sessions", "connectors")
        if name in registry.modules
    ]
    optional_paths = {f"modules/{name}.json" for name in optional_modules}
    if (
        signature != b"PK\x05\x06"
        or disk
        or central_disk
        or comment
        or not len(expected) - len(optional_paths) <= count <= len(expected)
        or disk_count != count
        or directory_bytes > 2 * 1024 * 1024
        or offset + directory_bytes + 22 != len(data)
    ):
        _fail("recovery.invalid_archive")
    try:
        with ZipFile(BytesIO(data)) as archive:
            members = archive.infolist()
            names = {member.filename for member in members}
            if names.issubset(expected) and expected - names <= optional_paths:
                expected = names
            if len(members) != len(expected) or names != expected:
                _fail("recovery.invalid_archive_members")
            if sum(member.file_size for member in members) > MAX_UNCOMPRESSED_BYTES:
                _fail("recovery.archive_budget_exceeded", 413)
            for member in members:
                if (
                    member.flag_bits & 1
                    or stat.S_ISLNK(member.external_attr >> 16)
                    or member.compress_type not in (ZIP_STORED, ZIP_DEFLATED)
                ):
                    _fail("recovery.invalid_archive_member")
            contents = {name: archive.read(name) for name in expected}
    except (BadZipFile, RuntimeError, NotImplementedError, ValueError) as error:
        raise WorkspaceRecoveryError("recovery.invalid_archive") from error
    manifest = _load(contents.pop("manifest.json"))
    if (
        not isinstance(manifest, dict)
        or set(manifest)
        != {"format", "version", "createdAt", "modules", "excludedModules", "counts", "files"}
        or manifest["format"] != "chartly-workspace-backup"
    ):
        _fail("recovery.invalid_manifest")
    if type(manifest["version"]) is not int or manifest["version"] != 1:
        _fail("recovery.unsupported_version")
    upgraded_modules = [name for name in optional_modules if f"modules/{name}.json" not in contents]
    declared_modules = [name for name in registry.modules if name not in upgraded_modules]
    if (
        manifest["modules"] != declared_modules
        or manifest["excludedModules"] != list(EXCLUSIONS)
        or not _instant(manifest["createdAt"])
    ):
        _fail("recovery.unsupported_modules")
    if not isinstance(manifest["files"], dict) or set(manifest["files"]) != set(contents):
        _fail("recovery.invalid_file_manifest")
    for name, value in contents.items():
        descriptor = manifest["files"][name]
        if (
            not isinstance(descriptor, dict)
            or set(descriptor) != {"sha256", "bytes"}
            or type(descriptor["bytes"]) is not int
            or descriptor["bytes"] != len(value)
            or descriptor["sha256"] != hashlib.sha256(value).hexdigest()
        ):
            _fail("recovery.checksum_mismatch")
    metadata = _load(contents["state.json"])
    if (
        not isinstance(metadata, dict)
        or set(metadata)
        != {"principalUid", "activeOriginId", "revision", "generation", "workspaces"}
        or not isinstance(metadata["workspaces"], list)
    ):
        _fail("recovery.invalid_state")
    modules = {
        name: _load(contents[f"modules/{name}.json"])
        for name in registry.modules
        if f"modules/{name}.json" in contents
    }
    origins = []
    for item in metadata["workspaces"]:
        if (
            not isinstance(item, dict)
            or not set(item).issubset({"metadata", "revision", "stateRevision"})
            or not isinstance(item.get("metadata"), dict)
            or set(item["metadata"]) != SNAPSHOT_META
        ):
            _fail("recovery.invalid_workspace")
        origin = item["metadata"]["originId"]
        if not isinstance(origin, str) or origin in origins:
            _fail("recovery.invalid_origin")
        origins.append(origin)
    if "journal-records" in upgraded_modules:
        modules["journal-records"] = {origin: _empty_journal_ledger() for origin in origins}
    if "paper-sessions" in upgraded_modules:
        modules["paper-sessions"] = {origin: [] for origin in origins}
    if "connectors" in upgraded_modules:
        modules["connectors"] = {origin: [] for origin in origins}
    for values in modules.values():
        if not isinstance(values, dict) or set(values) != set(origins):
            _fail("recovery.module_origin_mismatch")
    workspaces = []
    for item in metadata["workspaces"]:
        origin = item["metadata"]["originId"]
        workspace = {"snapshot": dict(item["metadata"]), "revision": item.get("revision", 0)}
        if "stateRevision" in item:
            workspace["stateRevision"] = item["stateRevision"]
        for name, module in registry.modules.items():
            source = workspace["snapshot"] if module.source == "snapshot" else workspace
            source[module.field] = modules[name][origin]
        workspaces.append(workspace)
    state = _normalize_state({**metadata, "workspaces": workspaces}, registry)
    counts = _module_counts(state, registry)
    comparison = deepcopy(counts)
    for name in upgraded_modules:
        comparison["moduleCounts"].pop(name, None)
    if _json(manifest["counts"]) != _json(comparison):
        _fail("recovery.count_mismatch")
    return {
        "manifest": manifest,
        "state": state,
        "archiveSha256": hashlib.sha256(data).hexdigest(),
        "upgradedModules": upgraded_modules,
        **counts,
    }


class WorkspaceRecoveryService:
    def __init__(self, storage, scope: str, registry=DEFAULT_REGISTRY):
        if not _text(scope, 256):
            _fail("recovery.scope_denied", 403)
        self.storage = storage
        self.scope = scope
        self.registry = registry

    def _call(self, method, *args, **kwargs):
        try:
            return getattr(self.storage, method)(*args, **kwargs)
        except WorkspaceRecoveryError:
            raise
        except Exception as error:
            code = getattr(error, "code", "")
            if isinstance(code, str) and code.startswith(
                (
                    "storage.",
                    "workspace.",
                    "recovery.",
                    "scope.",
                    "snapshot.",
                    "restore.",
                    "job.",
                    "request.",
                    "native.",
                )
            ):
                status = getattr(error, "status", None)
                if status is None:
                    status = (
                        409
                        if any(word in code for word in ("conflict", "revision", "stale"))
                        else 403
                        if "scope" in code
                        else 404
                        if "not_found" in code
                        else 503
                    )
                raise WorkspaceRecoveryError(code, status) from error
            if isinstance(error, OSError):
                raise WorkspaceRecoveryError("recovery.storage_unavailable", 503) from error
            raise

    def create_backup(self):
        state = self._call("snapshot", self.scope)
        normalized = _normalize_state(state, self.registry)
        if not normalized["workspaces"]:
            _fail("recovery.no_saved_data", 409)
        return build_workspace_backup(self.scope, normalized, self.registry)

    def preview_restore(self, data: bytes, expected_revision: int):
        if not _integer(expected_revision):
            _fail("recovery.invalid_revision")
        parsed = inspect_workspace_backup(data, self.registry)
        if self._call("current_revision", self.scope) != expected_revision:
            _fail("recovery.revision_conflict", 409)
        job_id = "workspace_restore_" + uuid4().hex
        token = hashlib.sha256(
            _json(
                {
                    "jobId": job_id,
                    "scope": self.scope,
                    "archiveSha256": parsed["archiveSha256"],
                    "expectedRevision": expected_revision,
                }
            )
        ).hexdigest()
        ownership_change = parsed["state"]["principalUid"] != self.scope
        preview = {
            key: parsed[key]
            for key in (
                "tableCounts",
                "moduleCounts",
                "originCount",
                "activeOriginId",
                "unavailableAttachments",
                "unverifiedDependencies",
            )
        }
        preview.update(
            jobId=job_id,
            status="preview",
            expectedRevision=expected_revision,
            confirmationHash=token,
            archiveSha256=parsed["archiveSha256"],
            excludedModules=list(EXCLUSIONS),
            ownershipChange=ownership_change,
            requiresOwnershipConfirmation=ownership_change,
        )
        now = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        job = {
            "id": job_id,
            "kind": "restore",
            "status": "preview",
            "scope": self.scope,
            "createdAt": now,
            "updatedAt": now,
            "expectedRevision": expected_revision,
            "archiveSha256": parsed["archiveSha256"],
            "confirmationHash": token,
            "payloadSha256": hashlib.sha256(_json(parsed["state"])).hexdigest(),
            "payload": parsed["state"],
            "preview": preview,
        }
        self._call("save_recovery_job", self.scope, job)
        return preview

    def preview_recovery_copy(self, copy_id: str, expected_revision: int):
        if not _text(copy_id, 128) or not _integer(expected_revision):
            _fail("recovery.invalid_copy")
        previous = self._call("get_recovery_copy", self.scope, copy_id)
        if not isinstance(previous, dict):
            _fail("recovery.copy_not_found", 404)
        previous = {
            **previous,
            "principalUid": self.scope,
            "revision": expected_revision,
            "generation": expected_revision,
        }
        data = build_workspace_backup(self.scope, previous, self.registry)
        preview = self.preview_restore(data, expected_revision)
        preview["recoveryCopyId"] = copy_id
        job = self._call("get_recovery_job", self.scope, preview["jobId"])
        job["sourceRecoveryCopyId"] = copy_id
        job["preview"] = preview
        self._call("save_recovery_job", self.scope, job)
        return preview

    def commit_restore(
        self,
        job_id: str,
        expected_revision: int,
        confirmation_hash: str,
        confirm_owner: bool = False,
    ):
        if (
            not _text(job_id, 128)
            or not _integer(expected_revision)
            or not isinstance(confirmation_hash, str)
        ):
            _fail("recovery.invalid_confirmation")
        job = self._call("get_recovery_job", self.scope, job_id)
        if (
            not isinstance(job, dict)
            or job.get("scope") != self.scope
            or job.get("kind") != "restore"
        ):
            _fail("recovery.job_not_found", 404)
        if (
            job.get("expectedRevision") != expected_revision
            or job.get("confirmationHash") != confirmation_hash
        ):
            _fail("recovery.confirmation_mismatch", 409)
        if job.get("status") in ("complete", "completed", "restored"):
            receipt = job.get("receipt")
            if not isinstance(receipt, dict):
                _fail("recovery.invalid_receipt", 503)
            return deepcopy(receipt)
        if job.get("status") != "preview":
            _fail("recovery.job_not_ready", 409)
        state = _normalize_state(job.get("payload"), self.registry)
        if hashlib.sha256(_json(state)).hexdigest() != job.get("payloadSha256"):
            _fail("recovery.staged_payload_changed", 409)
        if state["principalUid"] != self.scope and confirm_owner is not True:
            _fail("recovery.owner_confirmation_required", 409)
        if self._call("current_revision", self.scope) != expected_revision:
            _fail("recovery.revision_conflict", 409)
        state["principalUid"] = self.scope
        return self._call("restore_snapshot", self.scope, state, expected_revision, job_id)
