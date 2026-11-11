"""Journal source/review/history coverage across real scoped archive restores."""

import json
from copy import deepcopy
from io import BytesIO
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from sqlalchemy import func, select

from database.workspace_storage_db import TABLES, journal_records, recovery_copies
from services.journal_ledger import empty_ledger
from services.journal_service import JournalService
from services.workspace_recovery import (
    DEFAULT_REGISTRY,
    BackupModuleRegistry,
    WorkspaceRecoveryError,
    WorkspaceRecoveryService,
    build_workspace_backup,
    inspect_workspace_backup,
)
from services.workspace_storage import WorkspaceError, WorkspaceStorage

ALICE = "principal_journal_alice"
BOB = "principal_journal_bob"
ORIGIN = "journal_browser_origin"


def source():
    tables = {name: [] for name in TABLES}
    tables["portfolios"] = [
        {
            "id": 1,
            "name": "Source fixture",
            "kind": "live",
            "currency": "USD",
            "startingBalance": 10000,
            "createdAt": "2026-11-02T08:00:00Z",
            "updatedAt": "2026-11-02T08:00:00Z",
        }
    ]
    tables["brokerAccounts"] = [
        {
            "id": 1,
            "displayName": "Imported fixture account",
            "platform": "broker-api",
            "brokerName": "fixture",
            "server": "fixture-server",
            "externalLogin": "fixture-account",
            "accountKind": "demo",
            "currency": "USD",
            "createdAt": "2026-11-02T08:00:00Z",
            "updatedAt": "2026-11-02T08:00:00Z",
        }
    ]
    return {
        "format": "chartly-browser-snapshot",
        "version": 1,
        "originId": ORIGIN,
        "createdAt": "2026-11-02T08:00:00Z",
        "tables": tables,
        "nativeCatalogs": {},
        "preferences": {},
        "attachments": {},
        "datasetManifests": [],
    }


@pytest.fixture
def storage(tmp_path):
    store = WorkspaceStorage("sqlite:///" + (tmp_path / "journal.db").as_posix(), ALICE)
    preview = store.preview_migration(source())
    store.commit_migration(preview["id"], {}, uuid4().hex)
    yield store
    store.engine.dispose()


def populate(store):
    service = JournalService(store)

    def action(name, payload):
        return service.action(ORIGIN, store.workspace()["revision"], uuid4().hex, name, payload)

    linked = action("create-book", {"portfolioId": 1, "accountId": 1})
    book = linked["result"]["bookId"]
    csv_text = "eventId,eventType,positionId,openedAt,closedAt,symbol,side,quantity,grossPnl,commission,netPnl,currency\nfixture-event,trade,fixture-position,2026-11-02T09:00:00Z,2026-11-02T10:00:00Z,EURUSD,Buy,1,102,2,100,USD\n"
    mapping = {
        "version": 1,
        "name": "Saved fixture mapping",
        "timezone": "UTC",
        "currency": "USD",
        "quantityUnit": "units",
        "columns": {field: field for field in csv_text.splitlines()[0].split(",")},
    }
    preview = service.preview_import(
        ORIGIN, 1, book, "fixture-provider", csv_text, mapping, store.workspace()["revision"], 1
    )
    assert preview["preview"]["canCommit"]
    service.commit_import(preview["id"], preview["expectedRevision"], uuid4().hex)
    trade = store.workspace()["tables"]["journalTrades"][0]
    action(
        "review-trade",
        {
            "tradeId": trade["id"],
            "review": {
                "reviewStatus": "reviewed",
                "technicalNotes": "User-owned review survives a correction and restore",
                "tags": ["reviewed"],
                "strategy": "Fixture",
            },
        },
    )
    action("save-mapping", {"mapping": mapping})
    action(
        "review-period",
        {
            "portfolioId": 1,
            "bookId": book,
            "period": "day",
            "startDate": "2026-11-02",
            "timezone": "UTC",
            "notes": "Daily source review",
            "goals": "Keep exact scope",
            "includedTradeIds": [trade["id"]],
            "currency": "USD",
            "strategy": "All",
        },
    )
    return store.snapshot(), book


def restore(store, archive, confirm=False):
    recovery = WorkspaceRecoveryService(store, store.uid)
    preview = recovery.preview_restore(archive, store.current_revision())
    receipt = recovery.commit_restore(
        preview["jobId"], preview["expectedRevision"], preview["confirmationHash"], confirm
    )
    return recovery, receipt


def test_journal_records_registered_and_same_owner_roundtrip_retains_all_kinds(storage):
    before, book = populate(storage)
    ledger = before["journalLedger"]
    assert all(ledger[kind] for kind in ledger if kind != "version")
    archive = WorkspaceRecoveryService(storage, ALICE).create_backup()
    parsed = inspect_workspace_backup(archive)
    assert parsed["state"]["journalLedger"] == ledger
    assert parsed["moduleCounts"]["journal-records"] == sum(
        len(rows) for key, rows in ledger.items() if key != "version"
    )
    _, receipt = restore(storage, archive)
    assert storage.snapshot()["journalLedger"] == ledger
    assert storage.workspace()["bookAssignments"] == before["bindings"]["bookAssignments"]
    assert receipt["recoveryCopyId"]
    with storage.engine.connect() as connection:
        assert connection.execute(
            select(func.count()).select_from(journal_records).where(journal_records.c.uid == ALICE)
        ).scalar_one() == sum(len(rows) for key, rows in ledger.items() if key != "version")


def test_cross_owner_restore_rebinds_current_references_and_preserves_observed_proof(storage):
    before, old_book = populate(storage)
    archive = WorkspaceRecoveryService(storage, ALICE).create_backup()
    target = WorkspaceStorage(storage.engine, BOB)
    recovery = WorkspaceRecoveryService(target, BOB)
    preview = recovery.preview_restore(archive, 0)
    assert preview["requiresOwnershipConfirmation"]
    with pytest.raises(WorkspaceRecoveryError, match="owner_confirmation"):
        recovery.commit_restore(preview["jobId"], 0, preview["confirmationHash"])
    recovery.commit_restore(preview["jobId"], 0, preview["confirmationHash"], True)
    restored = target.snapshot()
    new_book = restored["bindings"]["bookAssignments"]["1"]
    assert new_book != old_book
    for kind in ("events", "reviews", "history", "periodReviews", "batches"):
        assert all(
            item.get("bookId", new_book) == new_book for item in restored["journalLedger"][kind]
        )
    assert (
        restored["journalLedger"]["events"][0]["canonicalHash"]
        == before["journalLedger"]["events"][0]["canonicalHash"]
    )
    observed = restored["journalLedger"]["observations"][0]
    assert observed["bookId"] == new_book and observed["sourceEvent"]["bookId"] == old_book
    assert storage.snapshot()["journalLedger"] == before["journalLedger"]


def test_old_p02_v1_backup_without_new_module_upgrades_to_empty_ledger(storage):
    old = storage.snapshot()
    old.pop("journalLedger")
    for workspace in old["workspaces"]:
        workspace.pop("journalLedger")
    legacy = BackupModuleRegistry(
        [module for name, module in DEFAULT_REGISTRY.modules.items() if name != "journal-records"]
    )
    archive = build_workspace_backup(ALICE, old, legacy)
    parsed = inspect_workspace_backup(archive)
    assert parsed["upgradedModules"] == ["journal-records"]
    assert parsed["state"]["journalLedger"] == empty_ledger()
    assert parsed["moduleCounts"]["journal-records"] == 0
    restore(storage, archive)
    assert storage.snapshot()["journalLedger"] == empty_ledger()


def test_declared_new_module_cannot_be_removed_as_a_legacy_upgrade(storage):
    populate(storage)
    archive = WorkspaceRecoveryService(storage, ALICE).create_backup()
    with ZipFile(BytesIO(archive)) as reader:
        files = {
            name: reader.read(name)
            for name in reader.namelist()
            if name != "modules/journal-records.json"
        }
    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as writer:
        for name, value in files.items():
            writer.writestr(name, value)
    with pytest.raises(WorkspaceRecoveryError):
        inspect_workspace_backup(output.getvalue())


@pytest.mark.parametrize(
    "kind,record",
    [
        ("reviews", {"id": "review:999", "tradeId": 999, "bookId": "missing"}),
        ("periodReviews", {"id": "period_missing", "includedTradeIds": [999], "bookId": "missing"}),
        ("bookLinks", {"id": "link_missing", "portfolioId": 1, "accountId": 999}),
    ],
)
def test_orphan_journal_records_cannot_be_backed_up_or_restored(storage, kind, record):
    before, _ = populate(storage)
    invalid = deepcopy(before)
    invalid["workspaces"][0]["journalLedger"][kind].append(record)
    invalid["journalLedger"] = deepcopy(invalid["workspaces"][0]["journalLedger"])
    with pytest.raises(WorkspaceRecoveryError):
        build_workspace_backup(ALICE, invalid)
    assert storage.snapshot() == before


def test_failed_journal_record_restore_rolls_back_entire_replacement(storage, monkeypatch):
    before, _ = populate(storage)
    recovery = WorkspaceRecoveryService(storage, ALICE)
    preview = recovery.preview_restore(recovery.create_backup(), storage.current_revision())

    def fail(*_args, **_kwargs):
        raise WorkspaceError("storage.injected_failure", 503)

    monkeypatch.setattr(storage, "_write_journal_ledger", fail)
    with pytest.raises(WorkspaceRecoveryError):
        recovery.commit_restore(
            preview["jobId"], preview["expectedRevision"], preview["confirmationHash"]
        )
    assert storage.snapshot() == before
    with storage.engine.connect() as connection:
        assert (
            connection.execute(
                select(func.count())
                .select_from(recovery_copies)
                .where(recovery_copies.c.uid == ALICE)
            ).scalar_one()
            == 0
        )


def test_active_ledger_mirror_must_match_workspace_data(storage):
    before, _ = populate(storage)
    wrong = deepcopy(before)
    wrong["journalLedger"] = deepcopy(before["journalLedger"])
    wrong["journalLedger"]["reviews"][0]["fields"]["technicalNotes"] = "divergent"
    with pytest.raises(WorkspaceRecoveryError, match="active_mirror_mismatch"):
        build_workspace_backup(ALICE, wrong)


def test_journal_registry_budget_failure_is_structured_and_does_not_modify_storage(
    storage, monkeypatch
):
    import services.journal_ledger as records

    before, _ = populate(storage)
    monkeypatch.setattr(records, "MAX_LEDGER_BYTES", 1)
    with pytest.raises(WorkspaceRecoveryError) as failure:
        build_workspace_backup(ALICE, before)
    assert failure.value.status == 413 and storage.snapshot() == before
