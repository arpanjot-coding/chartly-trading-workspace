"""P06 actual SQLite record, module, scope, checkpoint and restore expectations."""

import json
from copy import deepcopy
from io import BytesIO
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from sqlalchemy import event

from services.journal_service import JournalService
from services.paper_engine import initial_state, normalize_config
from services.paper_journal import paper_book_id
from services.paper_records import PaperRecords, validate_record
from services.paper_reports import canonical_checkpoint, canonical_manifest
from services.workspace_recovery import (
    WorkspaceRecoveryError,
    WorkspaceRecoveryService,
    inspect_workspace_backup,
)
from services.workspace_storage import WorkspaceError, WorkspaceStorage

pytest_plugins = ["test_journal_service"]
ORIGIN = "journal_origin_01"
AT = "2026-11-03T10:00:00.000Z"


def config():
    return normalize_config(
        {
            "version": 1,
            "instrument": {
                "symbol": "EXAMPLE",
                "exchange": "LOCAL",
                "interval": "1m",
                "currency": "USD",
                "quantityUnit": "share",
                "quantityStep": "1",
                "priceTick": "0.01",
                "multiplier": "1",
                "quantityScale": 0,
                "priceScale": 2,
            },
            "startingCash": "10000",
            "moneyScale": 2,
            "costs": {"spreadTicks": 0, "slippageTicks": 0, "feeBps": "0", "feePerFill": "1"},
            "policy": {"id": "native-ohlc-conservative-v1", "gap": "next-observed"},
            "seed": 0,
            "startTime": 1793610000,
        }
    )


def make_record(storage, *, engine_state=None):
    cfg = config()
    state = engine_state if engine_state is not None else initial_state(cfg)
    session = {
        "id": 1,
        "portfolioId": 1,
        "name": "Verified paper",
        "symbol": "EXAMPLE",
        "timeframe": "1m",
        "market": "Stocks",
        "mode": "replay",
        "status": "Ready",
        "startingBalance": 10000,
        "currency": "USD",
        "createdAt": AT,
        "updatedAt": AT,
    }
    dataset = {
        "id": "version_paperfixture01",
        "checksum": "a" * 64,
        "start": 1793610000,
        "end": 1793610420,
        "metadata": {"symbol": "EXAMPLE", "exchange": "LOCAL", "currency": "USD"},
    }
    window = {
        "from": dataset["start"],
        "to": dataset["end"],
        "count": 8,
        "firstAvailableAt": 1793610060,
        "lastAvailableAt": 1793610480,
    }
    manifest = canonical_manifest(
        storage.uid,
        ORIGIN,
        session,
        cfg,
        dataset,
        AT,
        book_id=paper_book_id(storage.uid, ORIGIN, 1),
        window=window,
    )
    record = {
        "version": 1,
        "originId": ORIGIN,
        "runId": 1,
        "profileId": 1,
        "revision": 1,
        "status": state["status"],
        "config": cfg,
        "manifest": manifest,
        "checkpoint": canonical_checkpoint(manifest, state, 1, AT),
        "state": deepcopy(state),
        "receipts": [],
        "createdAt": AT,
        "updatedAt": AT,
        "datasetVersionId": dataset["id"],
        "datasetChecksum": dataset["checksum"],
        "window": window,
    }
    session["paper"] = {
        "version": 1,
        "revision": 1,
        "status": record["status"],
        "manifestId": manifest["id"],
    }
    return record, session


def save_record(storage, record=None, session=None):
    if record is None:
        record, session = make_record(storage)
    with storage.transaction() as connection:
        state = storage._read(connection, ORIGIN, full_modules=False)
        state["snapshot"]["tables"]["portfolios"][0]["kind"] = "replay"
        state["snapshot"]["tables"]["practiceSessions"] = [deepcopy(session)]
        JournalService(storage)._save(connection, state, ORIGIN)
        PaperRecords(storage).save(connection, ORIGIN, 1, record)
    return record, session


def test_paper_table_is_created_before_first_transaction_and_empty_book_exists(storage):
    record, _ = save_record(storage)
    books = storage.workspace()["books"]
    assert (
        next(book for book in books if book["kind"] == "paper")["id"]
        == record["manifest"]["bookId"]
    )
    with storage.engine.connect() as connection:
        assert PaperRecords(storage).load(connection, ORIGIN, 1) == record
        other = WorkspaceStorage(storage.engine, "principal_other_owner")
        assert PaperRecords(other).load(connection, ORIGIN, 1) is None
        assert PaperRecords(storage).load(connection, "other_origin01", 1) is None


def test_routine_workspace_does_not_select_paper_payload(storage):
    save_record(storage)
    statements = []

    def observe(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(storage.engine, "before_cursor_execute", observe)
    try:
        result = storage.workspace()
    finally:
        event.remove(storage.engine, "before_cursor_execute", observe)
    assert "paperSessions" not in result
    assert not any("workspace_paper_sessions" in statement for statement in statements)
    assert result["tables"]["practiceSessions"][0]["paper"]["status"] == "ready"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda row: row["checkpoint"].update(stateChecksum="b" * 64),
        lambda row: row["checkpoint"].update(ledgerSequence=10),
        lambda row: row["manifest"].update(bookId="book_other_scope001"),
        lambda row: row["state"].update(cash="10001"),
        lambda row: row.update(datasetChecksum="no-checksum"),
        lambda row: row.update(
            receipts=[{"requestId": "same", "inputHash": "f" * 64, "revision": 1}] * 2
        ),
        lambda row: row.update(version=True),
        lambda row: row.update(password="forbidden"),
    ],
)
def test_restored_record_rejects_tampered_state_scope_or_receipts(storage, mutate):
    record, _ = make_record(storage)
    mutate(record)
    with pytest.raises(WorkspaceError):
        validate_record(record)


def test_paper_record_rolls_back_with_the_journal_and_marker(storage):
    record, session = make_record(storage)
    before = storage.workspace()
    with pytest.raises(RuntimeError):
        with storage.transaction() as connection:
            state = storage._read(connection, ORIGIN, full_modules=False)
            state["snapshot"]["tables"]["practiceSessions"] = [session]
            JournalService(storage)._save(connection, state, ORIGIN)
            PaperRecords(storage).save(connection, ORIGIN, 1, record)
            raise RuntimeError("crash before commit")
    assert storage.workspace() == before
    with storage.engine.connect() as connection:
        assert PaperRecords(storage).load(connection, ORIGIN, 1) is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("paper", None),
        ("status", "Completed"),
        ("startingBalance", 20000),
        ("symbol", "OTHER"),
        ("rangeStart", "2025-01-01"),
    ],
)
def test_generic_save_cannot_rewrite_managed_paper_finances_or_status(storage, field, value):
    save_record(storage)
    workspace = storage.workspace()
    changed = deepcopy(workspace["tables"])
    changed["practiceSessions"][0][field] = value
    with pytest.raises(WorkspaceError, match="paper"):
        storage.save_tables(ORIGIN, changed, workspace["revision"], uuid4().hex)


def test_archive_is_allowed_and_does_not_delete_paper_record(storage):
    record, _ = save_record(storage)
    workspace = storage.workspace()
    changed = deepcopy(workspace["tables"])
    changed["practiceSessions"][0]["archivedAt"] = AT
    storage.save_tables(ORIGIN, changed, workspace["revision"], uuid4().hex)
    with storage.engine.connect() as connection:
        assert PaperRecords(storage).load(connection, ORIGIN, 1) == record


def test_backup_cross_owner_restore_and_undo_preserve_exact_engine_state(storage):
    record, _ = save_record(storage)
    archive = WorkspaceRecoveryService(storage, storage.uid).create_backup()
    parsed = inspect_workspace_backup(archive)
    assert parsed["moduleCounts"]["paper-sessions"] == 1
    target = WorkspaceStorage(storage.engine, "principal_paper_restored")
    recovery = WorkspaceRecoveryService(target, target.uid)
    preview = recovery.preview_restore(archive, 0)
    recovery.commit_restore(preview["jobId"], 0, preview["confirmationHash"], confirm_owner=True)
    with target.engine.connect() as connection:
        restored = PaperRecords(target).load(connection, ORIGIN, 1)
    assert restored["state"] == record["state"]
    assert restored["checkpoint"]["stateChecksum"] == record["checkpoint"]["stateChecksum"]
    assert restored["manifest"]["ownerId"] == target.uid
    assert restored["manifest"]["bookId"] != record["manifest"]["bookId"]
    assert restored["datasetVersionId"] == record["datasetVersionId"]
    with storage.engine.connect() as connection:
        assert PaperRecords(storage).load(connection, ORIGIN, 1) == record


def test_older_archive_without_paper_module_upgrades_to_empty_module(storage):
    archive = WorkspaceRecoveryService(storage, storage.uid).create_backup()
    with ZipFile(BytesIO(archive)) as source:
        files = {name: source.read(name) for name in source.namelist()}
    manifest = json.loads(files.pop("manifest.json"))
    removed = "modules/paper-sessions.json"
    files.pop(removed)
    manifest["modules"].remove("paper-sessions")
    manifest["files"].pop(removed)
    manifest["counts"]["moduleCounts"].pop("paper-sessions")
    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive_file:
        archive_file.writestr("manifest.json", json.dumps(manifest))
        for name, content in files.items():
            archive_file.writestr(name, content)
    parsed = inspect_workspace_backup(buffer.getvalue())
    assert parsed["upgradedModules"] == ["paper-sessions"]
    assert parsed["state"]["workspaces"][0]["paperSessions"] == []


def test_prepared_marker_without_ledger_is_rejected_in_backup_and_migration(storage):
    record, session = make_record(storage)
    snapshot = storage.snapshot()
    snapshot["workspaces"][0]["snapshot"]["tables"]["practiceSessions"] = [session]
    snapshot.pop("snapshot")
    with pytest.raises(WorkspaceRecoveryError, match="paper"):
        from services.workspace_recovery import build_workspace_backup

        build_workspace_backup(storage.uid, snapshot)
    with pytest.raises(WorkspaceError, match="restore_workspace_required"):
        storage.preview_migration(snapshot["workspaces"][0]["snapshot"])


def test_restore_then_undo_recovers_open_position_pending_orders_and_state_hash(storage):
    from test_paper_journal import advance, order, publish

    ready, _ = save_record(storage)
    recovery = WorkspaceRecoveryService(storage, storage.uid)
    before = recovery.create_backup()
    trading = deepcopy(ready)
    order(trading)
    advance(trading, 0)
    publish(storage, trading)
    prior_state = deepcopy(trading["state"])
    expected = storage.current_revision()
    preview = recovery.preview_restore(before, expected)
    restored = recovery.commit_restore(preview["jobId"], expected, preview["confirmationHash"])
    with storage.engine.connect() as connection:
        assert PaperRecords(storage).load(connection, ORIGIN, 1)["state"] == ready["state"]
    undo = recovery.preview_recovery_copy(restored["recoveryCopyId"], storage.current_revision())
    recovery.commit_restore(undo["jobId"], undo["expectedRevision"], undo["confirmationHash"])
    with storage.engine.connect() as connection:
        actual = PaperRecords(storage).load(connection, ORIGIN, 1)
    assert actual["state"] == prior_state
    assert actual["checkpoint"]["stateChecksum"] == trading["checkpoint"]["stateChecksum"]


def test_paper_book_export_includes_exact_matching_durable_session(storage):
    import base64

    record, _ = save_record(storage)
    exported = JournalService(storage).export(ORIGIN, 1, record["manifest"]["bookId"])
    contents = json.loads(base64.b64decode(exported["base64"]))
    assert contents["paperSessions"] == [record]
    manual_book = next(book for book in storage.workspace()["books"] if book["kind"] == "manual")
    manual = JournalService(storage).export(ORIGIN, 1, manual_book["id"])
    assert "paperSessions" not in json.loads(base64.b64decode(manual["base64"]))


def test_utf8_aggregate_budget_checks_replacement_without_loading_all_ledgers(storage, monkeypatch):
    from services import paper_records
    from services.workspace_storage import dumps

    record, session = save_record(storage)
    record["restoreLabel"] = "界" * 100
    byte_count = len(dumps(record).encode())
    monkeypatch.setattr(paper_records, "MAX_ORIGIN_BYTES", byte_count - 1)
    with pytest.raises(WorkspaceError, match="origin_budget"):
        with storage.transaction() as connection:
            PaperRecords(storage).save(connection, ORIGIN, 1, record)
    with storage.engine.connect() as connection:
        assert "restoreLabel" not in PaperRecords(storage).load(connection, ORIGIN, 1)
