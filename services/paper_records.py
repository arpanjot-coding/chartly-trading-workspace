"""Bounded data-only paper records within the existing caller-owned transaction."""

from __future__ import annotations

import json
import re
from copy import deepcopy

from sqlalchemy import LargeBinary, cast, func, insert, select, update

from database.paper_sessions_db import paper_sessions

MAX_RECORD_BYTES = 32 * 1024 * 1024
MAX_RUNS = 500
MAX_ORIGIN_BYTES = 128 * 1024 * 1024
MAX_NODES = 500_000
STATUSES = {"ready", "in_progress", "paused", "finished", "abandoned"}


def _error(code, status=400):
    from services.workspace_storage import WorkspaceError

    raise WorkspaceError(code, status)


def validate_record(value):
    """Validate bounded state, canonical adapters and cross-field checkpoint identity."""
    if (
        not isinstance(value, dict)
        or type(value.get("version")) is not int
        or value["version"] != 1
    ):
        _error("paper.invalid_record")
    for field in ("runId", "profileId"):
        if type(value.get(field)) is not int or not 0 < value[field] <= 9007199254740991:
            _error("paper.invalid_record_identity")
    if (
        type(value.get("revision")) is not int
        or value["revision"] < 0
        or value.get("status") not in STATUSES
    ):
        _error("paper.invalid_record_state")
    stack = [(value, 0)]
    nodes = 0
    while stack:
        item, depth = stack.pop()
        nodes += 1
        if depth > 40 or nodes > MAX_NODES:
            _error("paper.record_budget", 413)
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str) or key in ("__proto__", "constructor", "prototype"):
                    _error("paper.invalid_record")
                if key.lower().replace("_", "") in {
                    "password",
                    "apikey",
                    "secret",
                    "accesstoken",
                    "credentials",
                }:
                    _error("paper.secret_field")
                stack.append((child, depth + 1))
        elif isinstance(item, list):
            stack.extend((child, depth + 1) for child in item)
        elif item is not None and not isinstance(item, (str, int, float, bool)):
            _error("paper.invalid_record")
    try:
        raw = json.dumps(value, allow_nan=False, ensure_ascii=False, separators=(",", ":")).encode()
    except (ValueError, TypeError, RecursionError, UnicodeError):
        _error("paper.invalid_record")
    if len(raw) > MAX_RECORD_BYTES:
        _error("paper.record_budget", 413)
    if not isinstance(value.get("datasetChecksum"), str) or not re.fullmatch(
        r"[a-f0-9]{64}", value["datasetChecksum"]
    ):
        _error("paper.invalid_source_checksum")
    receipts = value.get("receipts")
    if not isinstance(receipts, list) or len(receipts) > 5000:
        _error("paper.receipt_budget", 413)
    receipt_ids = set()
    for receipt in receipts:
        if (
            not isinstance(receipt, dict)
            or set(receipt) - {"requestId", "inputHash", "revision", "resultRunId"}
            or not {"requestId", "inputHash", "revision"} <= set(receipt)
            or not isinstance(receipt["requestId"], str)
            or not 1 <= len(receipt["requestId"]) <= 128
            or receipt["requestId"] in receipt_ids
            or not isinstance(receipt["inputHash"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", receipt["inputHash"])
            or type(receipt["revision"]) is not int
            or not 1 <= receipt["revision"] <= value["revision"]
            or "resultRunId" in receipt
            and (
                type(receipt["resultRunId"]) is not int
                or not 0 < receipt["resultRunId"] <= 9007199254740991
            )
        ):
            _error("paper.invalid_receipt")
        receipt_ids.add(receipt["requestId"])
    from services.domain.validation import validate_record as canonical

    for field, kind in (("manifest", "RunManifest"), ("checkpoint", "Checkpoint")):
        if canonical(kind, value.get(field)):
            _error("paper.invalid_" + field)
    manifest, checkpoint = value["manifest"], value["checkpoint"]
    if checkpoint["runId"] != manifest["id"]:
        _error("paper.checkpoint_run_mismatch")
    if (
        checkpoint["revision"] != value["revision"]
        or value.get("datasetVersionId") != manifest["datasetVersionId"]
    ):
        _error("paper.checkpoint_revision_mismatch")
    from services.paper_engine import validate_state

    try:
        validate_state(value.get("config"), value.get("state"))
    except (ValueError, TypeError, KeyError) as error:
        _error("paper.invalid_engine_state:" + getattr(error, "code", "invalid"))
    if value["state"]["status"] != value["status"]:
        _error("paper.status_mismatch")
    from services.paper_reports import state_checksum

    if checkpoint["stateChecksum"] != state_checksum(value["state"]):
        _error("paper.checkpoint_checksum_mismatch")
    if checkpoint["ledgerSequence"] != value["state"]["sequence"]:
        _error("paper.checkpoint_sequence_mismatch")
    if (
        checkpoint["ownerId"] != manifest["ownerId"]
        or checkpoint["workspaceId"] != manifest["workspaceId"]
    ):
        _error("paper.checkpoint_scope_mismatch")
    from services.workspace_storage import opaque, valid_origin

    if not valid_origin(value.get("originId")):
        _error("paper.invalid_record_origin")
    identity = manifest["ownerId"] + "|" + value["originId"]
    if (
        manifest["workspaceId"] != opaque("workspace", identity)
        or manifest["accountId"] != opaque("paperaccount", identity + "|" + str(value["runId"]))
        or manifest["bookId"] != opaque("book", identity + "|paper|" + str(value["runId"]))
    ):
        _error("paper.canonical_scope_mismatch")
    return deepcopy(value)


def validate_records(values, snapshot=None):
    if not isinstance(values, list) or len(values) > MAX_RUNS:
        _error("paper.record_budget", 413)
    seen = set()
    runs = (
        {item["id"]: item for item in snapshot["tables"]["practiceSessions"]} if snapshot else None
    )
    for value in values:
        validate_record(value)
        if value["runId"] in seen:
            _error("paper.duplicate_run")
        seen.add(value["runId"])
        if runs is not None:
            run = runs.get(value["runId"])
            if not run or run["portfolioId"] != value["profileId"]:
                _error("paper.missing_run")
            if value["originId"] != snapshot["originId"] or any(
                run.get(key) != value["config"]["instrument"][field]
                for key, field in (
                    ("symbol", "symbol"),
                    ("timeframe", "interval"),
                    ("currency", "currency"),
                )
            ):
                _error("paper.run_configuration_mismatch")
            marker = run.get("paper")
            if (
                not isinstance(marker, dict)
                or marker.get("version") != 1
                or marker.get("revision") != value["revision"]
                or marker.get("status") != value["status"]
                or marker.get("manifestId") != value["manifest"]["id"]
            ):
                _error("paper.marker_mismatch")
            if marker.get("window") is not None and marker["window"] != {
                key: value["window"][key] for key in ("from", "to")
            }:
                _error("paper.marker_window_mismatch")
            if (
                "startingCash" in marker
                and marker["startingCash"] != value["config"]["startingCash"]
            ):
                _error("paper.marker_starting_cash_mismatch")
            for receipt in value["receipts"]:
                if "resultRunId" in receipt and (
                    receipt["resultRunId"] not in runs
                    or runs[receipt["resultRunId"]]["portfolioId"] != value["profileId"]
                ):
                    _error("paper.branch_receipt_scope_mismatch")
    if (
        len(json.dumps(values, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode())
        > MAX_ORIGIN_BYTES
    ):
        _error("paper.origin_budget", 413)
    if runs is not None and any(
        run.get("paper") and run["id"] not in seen for run in runs.values()
    ):
        _error("paper.missing_ledger")
    return deepcopy(values)


def rebind_record(value, uid, origin, book_map):
    """Owner-confirmed restore changes local canonical scope, never trading state."""
    from services.workspace_storage import opaque

    result = deepcopy(value)
    old_manifest = result["manifest"]
    workspace_id = opaque("workspace", uid + "|" + origin)
    account_id = opaque("paperaccount", uid + "|" + origin + "|" + str(value["runId"]))
    book_id = book_map.get(old_manifest["bookId"])
    if not book_id:
        _error("paper.book_rebind_failed")
    if (
        old_manifest["ownerId"] == uid
        and old_manifest["workspaceId"] == workspace_id
        and old_manifest["bookId"] == book_id
    ):
        return validate_record(result)
    result.setdefault(
        "restoredFrom",
        {
            "ownerId": old_manifest["ownerId"],
            "workspaceId": old_manifest["workspaceId"],
            "manifestId": old_manifest["id"],
        },
    )
    # Immutable engine state, source ID/checksum, receipt IDs and manifest identity
    # remain preserved. These local canonical ownership references follow P02's
    # explicit owner-confirmation mapping, rather than granting external access.
    for record in (result["manifest"], result["checkpoint"]):
        record["ownerId"], record["workspaceId"] = uid, workspace_id
    result["manifest"]["bookId"] = book_id
    result["manifest"]["accountId"] = account_id
    if "ownerId" in result:
        result["ownerId"] = uid
    if "originId" in result:
        result["originId"] = origin
    return validate_record(result)


class PaperRecords:
    def __init__(self, storage):
        self.storage = storage

    def load(self, connection, origin, run_id):
        row = connection.execute(
            select(paper_sessions.c.payload).where(
                self.storage.scope(paper_sessions, origin), paper_sessions.c.run_id == run_id
            )
        ).first()
        return json.loads(row[0]) if row else None

    def list(self, connection, origin):
        rows = connection.execute(
            select(paper_sessions.c.payload)
            .where(self.storage.scope(paper_sessions, origin))
            .order_by(paper_sessions.c.run_id)
        ).all()
        return [json.loads(row[0]) for row in rows]

    def save(self, connection, origin, run_id, value):
        from services.workspace_storage import dumps

        value = validate_record(value)
        if (
            value["runId"] != run_id
            or value["originId"] != origin
            or value["manifest"]["ownerId"] != self.storage.uid
        ):
            _error("paper.record_identity_mismatch")
        raw = dumps(value)
        byte_length = func.length(cast(paper_sessions.c.payload, LargeBinary))
        existing_bytes = connection.execute(
            select(byte_length).where(
                self.storage.scope(paper_sessions, origin), paper_sessions.c.run_id == run_id
            )
        ).scalar()
        total_bytes = connection.execute(
            select(func.coalesce(func.sum(byte_length), 0)).where(
                self.storage.scope(paper_sessions, origin)
            )
        ).scalar()
        if total_bytes - (existing_bytes or 0) + len(raw.encode()) > MAX_ORIGIN_BYTES:
            _error("paper.origin_budget", 413)
        if existing_bytes is None:
            count = len(
                connection.execute(
                    select(paper_sessions.c.run_id).where(
                        self.storage.scope(paper_sessions, origin)
                    )
                ).all()
            )
            if count >= MAX_RUNS:
                _error("paper.run_budget", 413)
            connection.execute(
                insert(paper_sessions).values(
                    uid=self.storage.uid, origin=origin, run_id=run_id, payload=raw
                )
            )
        else:
            connection.execute(
                update(paper_sessions)
                .where(
                    self.storage.scope(paper_sessions, origin), paper_sessions.c.run_id == run_id
                )
                .values(payload=raw)
            )
