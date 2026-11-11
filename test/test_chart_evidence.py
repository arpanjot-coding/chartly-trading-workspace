"""Chart PNG ownership, immutable metadata and real scoped recovery semantics."""

import base64
import hashlib
import json
from copy import deepcopy
from io import BytesIO
from uuid import uuid4

import pytest
from PIL import Image
from sqlalchemy import event, func, select
from test_data_library import commit, preview
from test_journal_service import act, manual

from database.workspace_storage_db import assets
from services.chart_evidence import ChartEvidenceService
from services.data_library import DataLibrary
from services.journal_service import JournalService
from services.workspace_recovery import (
    WorkspaceRecoveryError,
    WorkspaceRecoveryService,
    build_workspace_backup,
)
from services.workspace_storage import WorkspaceError, WorkspaceStorage

pytest_plugins = ["test_journal_service"]
ORIGIN = "journal_origin_01"


def png(color="white"):
    stream = BytesIO()
    with Image.new("RGB", (20, 12), color) as image:
        image.save(stream, format="PNG")
    return base64.b64encode(stream.getvalue()).decode()


def capture(version=None):
    return {
        "version": 1,
        "capturedAt": "2026-11-03T09:00:00Z",
        "source": {
            "kind": "dataset",
            "datasetVersionId": version["id"],
            "checksum": version["checksum"],
        }
        if version
        else {"kind": "legacy-connected", "provider": "fixture"},
        "instrument": {"symbol": "EXAMPLE", "exchange": "LOCAL"},
        "view": {
            "interval": "1m",
            "chartType": "candlestick",
            "timezone": "UTC",
            "visibleFrom": 1793610000,
            "visibleTo": 1793610060,
            "paneId": "p0",
        },
    }


def trade(store):
    return act(store, "create-trade", {"trade": manual(store)})["detail"]["trade"]


def attach(
    store,
    row,
    *,
    metadata=None,
    target=None,
    request_id=None,
    revision=None,
    content=None,
    notes="Measured context",
):
    return ChartEvidenceService(store).attach(
        ORIGIN,
        store.workspace()["revision"] if revision is None else revision,
        request_id or uuid4().hex,
        target
        or {
            "kind": "trade",
            "id": row["id"],
            "profileId": row["portfolioId"],
            "bookId": row["journalBookId"],
        },
        "image/png",
        content or png(),
        capture() if metadata is None else metadata,
        notes,
    )


def test_multiple_captures_are_append_only_idempotent_and_do_not_change_financial_facts(storage):
    row = trade(storage)
    revision, request_id = storage.workspace()["revision"], uuid4().hex
    first = attach(storage, row, request_id=request_id, revision=revision)
    repeated = attach(storage, row, request_id=request_id, revision=revision)
    assert first == repeated
    assert len(first["detail"]["trade"]["chartEvidence"]) == 1
    second = attach(storage, row, content=png("black"))
    saved = second["detail"]["trade"]
    assert len(saved["chartEvidence"]) == 2
    assert saved["chartEvidence"][0] == first["detail"]["trade"]["chartEvidence"][0]
    assert saved["amounts"] == row["amounts"] and saved["factRevision"] == row["factRevision"]
    assert (
        saved["reviewRevision"] == 2
        and second["detail"]["history"][-1]["action"] == "attach-chart-evidence"
    )
    with pytest.raises(WorkspaceError, match="reused_with_different_input"):
        attach(
            storage,
            row,
            revision=revision,
            request_id=request_id,
            notes="Changed after acknowledgement",
        )
    with pytest.raises(WorkspaceError, match="revision_conflict"):
        attach(storage, row, revision=revision)
    for item in saved["chartEvidence"]:
        blob = storage.attachment(item["attachmentId"], ORIGIN)
        assert hashlib.sha256(blob["content"]).hexdigest() == item["imageSha256"]


def test_owned_native_source_is_resolved_and_foreign_or_changed_identity_is_rejected(storage):
    library = DataLibrary(storage)
    version = commit(library, preview(library))["version"]
    row = trade(storage)
    result = attach(storage, row, metadata=capture(version))
    assert (
        result["detail"]["trade"]["chartEvidence"][0]["source"]["provider"]
        == version["metadata"]["provider"]
    )
    for path, value in (
        ("checksum", "0" * 64),
        ("datasetVersionId", "version_missing"),
        ("provider", "other"),
    ):
        changed = capture(version)
        changed["source"][path] = value
        with pytest.raises(WorkspaceError):
            attach(storage, row, metadata=changed)
    bad = capture(version)
    bad["instrument"]["exchange"] = "OTHER"
    with pytest.raises(WorkspaceError, match="instrument_or_interval"):
        attach(storage, row, metadata=bad)
    foreign = WorkspaceStorage(storage.engine, "principal_chart_other")
    with pytest.raises(WorkspaceError, match="not_found"):
        attach(foreign, row, metadata=capture(version), revision=0)


@pytest.mark.parametrize(
    "changed",
    [
        {"profileId": 999},
        {"id": 999},
        {"bookId": "book_missing"},
        {"profileId": True},
        {"kind": "account"},
        {"kind": "run"},
        {"ownerId": "principal_other"},
    ],
)
def test_target_scope_cannot_be_granted_by_caller_labels(storage, changed):
    row = trade(storage)
    target = {
        "kind": "trade",
        "id": row["id"],
        "profileId": 1,
        "bookId": row["journalBookId"],
        **changed,
    }
    with pytest.raises(WorkspaceError):
        attach(storage, row, target=target)
    assert not storage.workspace()["tables"]["journalTrades"][0].get("chartEvidence")


@pytest.mark.parametrize(
    "path,value",
    [
        (("extra",), "code"),
        (("version",), True),
        (("capturedAt",), "2026-11-03T09:00:00"),
        (("capturedAt",), "2026-11-03T09:00:00.0000001Z"),
        (("source", "kind"), "live-execution"),
        (("source", "apiKey"), "not-a-key"),
        (("view", "timezone"), "invalid/timezone"),
        (("view", "visibleFrom"), float("inf")),
        (("view", "visibleTo"), 0),
        (("view", "replayAsOf"), True),
        (("instrument", "symbol"), "OTHER"),
    ],
)
def test_malformed_or_mismatched_capture_never_writes_an_asset(storage, path, value):
    row = trade(storage)
    metadata = capture()
    child = metadata
    for name in path[:-1]:
        child = child[name]
    child[path[-1]] = value
    with pytest.raises(WorkspaceError):
        attach(storage, row, metadata=metadata)
    with storage.engine.connect() as connection:
        assert connection.execute(select(func.count()).select_from(assets)).scalar_one() == 0


@pytest.mark.parametrize(
    "content",
    [
        "not base64",
        base64.b64encode(b"\x89PNG\r\n\x1a\n").decode(),
        base64.b64encode(b"%PDF-invalid").decode(),
    ],
)
def test_actual_png_structure_is_required(storage, content):
    with pytest.raises(WorkspaceError, match="invalid_image"):
        attach(storage, trade(storage), content=content)


def test_archived_trade_rejects_new_capture_and_generic_edit_cannot_forge_evidence(storage):
    row = trade(storage)
    attach(storage, row)
    current = storage.workspace()
    tables = deepcopy(current["tables"])
    tables["journalTrades"][0]["chartEvidence"] = []
    with pytest.raises(WorkspaceError, match="server_owned"):
        storage.save_tables(ORIGIN, tables, current["revision"], uuid4().hex)
    with pytest.raises(WorkspaceError, match="server_owned"):
        act(storage, "update-trade", {"tradeId": row["id"], "patch": {"chartEvidence": []}})
    act(
        storage,
        "review-trade",
        {"tradeId": row["id"], "review": {"notes": "Review remains editable"}},
    )
    act(storage, "archive-trade", {"tradeId": row["id"]})
    with pytest.raises(WorkspaceError, match="target_mismatch"):
        attach(storage, row)


def test_metadata_reads_do_not_select_or_encode_image_bytes(storage, monkeypatch):
    attach(storage, trade(storage))
    queries = []

    def observe(_connection, _cursor, statement, _parameters, _context, _executemany):
        queries.append(statement)

    event.listen(storage.engine, "before_cursor_execute", observe)
    try:
        monkeypatch.setattr(
            base64,
            "b64encode",
            lambda *_: (_ for _ in ()).throw(AssertionError("Metadata must not encode images")),
        )
        response = storage.workspace()
    finally:
        event.remove(storage.engine, "before_cursor_execute", observe)
    assert response["attachments"] and all(
        "base64" not in item for item in response["attachments"].values()
    )
    asset_reads = [query for query in queries if "FROM workspace_assets" in query]
    assert asset_reads and all("workspace_assets.content" not in query for query in asset_reads)


def test_book_export_and_cross_owner_workspace_restore_keep_all_capture_bytes(storage):
    row = trade(storage)
    attach(storage, row)
    final = attach(storage, row, content=png("black"))
    items = final["detail"]["trade"]["chartEvidence"]
    exported = JournalService(storage).export(ORIGIN, 1, row["journalBookId"])
    decoded = json.loads(base64.b64decode(exported["base64"]))
    assert {item["attachmentId"] for item in items} <= set(decoded["attachments"])
    backup = WorkspaceRecoveryService(storage, storage.uid).create_backup()
    other = WorkspaceStorage(storage.engine, "principal_chart_restore")
    recovery = WorkspaceRecoveryService(other, other.uid)
    previewed = recovery.preview_restore(backup, other.current_revision())
    recovery.commit_restore(
        previewed["jobId"], previewed["expectedRevision"], previewed["confirmationHash"], True
    )
    restored = other.workspace()
    assert restored["tables"]["journalTrades"][0]["chartEvidence"] == items
    for item in items:
        blob = other.attachment(item["attachmentId"], ORIGIN)
        assert hashlib.sha256(blob["content"]).hexdigest() == item["imageSha256"]


def test_tampered_capture_hash_or_missing_bytes_is_rejected_before_restore(storage):
    attach(storage, trade(storage))
    snapshot = storage.snapshot()
    for remove in (False, True):
        changed = deepcopy(snapshot)
        item = changed["workspaces"][0]["snapshot"]["tables"]["journalTrades"][0]["chartEvidence"][
            0
        ]
        if remove:
            del changed["workspaces"][0]["snapshot"]["attachments"][item["attachmentId"]]
        else:
            item["imageSha256"] = "0" * 64
        with pytest.raises(WorkspaceRecoveryError, match="evidence_asset"):
            build_workspace_backup(storage.uid, changed)


def test_publication_rollback_leaves_no_asset_or_record_change(storage, monkeypatch):
    row = trade(storage)
    before = storage.workspace()
    monkeypatch.setattr(
        storage, "_save_receipt", lambda *_args: (_ for _ in ()).throw(RuntimeError("interrupted"))
    )
    with pytest.raises(RuntimeError):
        attach(storage, row)
    assert storage.workspace() == before
    with storage.engine.connect() as connection:
        assert connection.execute(select(func.count()).select_from(assets)).scalar_one() == 0


def test_run_capture_retains_draft_and_rejects_a_different_data_source(storage):
    library = DataLibrary(storage)
    version = commit(library, preview(library))["version"]
    tables = storage.workspace()["tables"]
    run = {
        "id": 1,
        "portfolioId": 1,
        "name": "Pinned run",
        "status": "Draft",
        "symbol": "EXAMPLE",
        "timeframe": "1m",
        "datasetVersionId": version["id"],
        "datasetChecksum": version["checksum"],
    }
    tables["practiceSessions"].append(run)
    storage.save_tables(ORIGIN, tables, storage.workspace()["revision"], uuid4().hex)
    target = {"kind": "run", "id": 1, "profileId": 1}
    response = attach(storage, run, target=target, metadata=capture(version))
    saved = response["workspace"]["tables"]["practiceSessions"][0]
    assert saved["status"] == "Draft" and len(saved["chartEvidence"]) == 1
    assert any(
        item["kind"] == "chart-evidence" for item in library.detail(version["id"])["dependencies"]
    )
    with pytest.raises(WorkspaceError, match="source_mismatch"):
        attach(storage, run, target=target)
    current = storage.workspace()
    bad = deepcopy(current["tables"])
    bad["practiceSessions"][0]["chartEvidence"] = []
    with pytest.raises(WorkspaceError, match="server_owned"):
        storage.save_tables(ORIGIN, bad, current["revision"], uuid4().hex)


def test_metadata_budget_counts_actual_utf8_bytes_and_keeps_earlier_captures(storage):
    row = trade(storage)
    for _ in range(5):
        attach(storage, row, notes="中" * 4000)
    with pytest.raises(WorkspaceError, match="metadata_budget"):
        attach(storage, row, notes="中" * 4000)
    assert len(storage.workspace()["tables"]["journalTrades"][0]["chartEvidence"]) == 5
