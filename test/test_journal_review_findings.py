"""Independent lifecycle/source integrity findings reproduced through real stores."""

from copy import deepcopy
from uuid import uuid4

import pytest

from database.workspace_storage_db import TABLES
from services.journal_service import JournalService
from services.workspace_recovery import WorkspaceRecoveryService
from services.workspace_storage import WorkspaceError, WorkspaceStorage

ORIGIN = "review_findings_origin"
ALICE = "principal_review_findings"


@pytest.fixture
def storage(tmp_path):
    store = WorkspaceStorage("sqlite:///" + (tmp_path / "review.db").as_posix(), ALICE)
    tables = {name: [] for name in TABLES}
    tables["portfolios"] = [
        {
            "id": 1,
            "name": "Review fixture",
            "kind": "live",
            "currency": "USD",
            "startingBalance": 10000,
            "createdAt": "2026-11-02T08:00:00Z",
            "updatedAt": "2026-11-02T08:00:00Z",
        }
    ]
    snapshot = {
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
    preview = store.preview_migration(snapshot)
    store.commit_migration(preview["id"], {}, uuid4().hex)
    yield store
    store.engine.dispose()


def create_manual(store):
    service = JournalService(store)
    record = {
        "portfolioId": 1,
        "pair": "EURUSD",
        "direction": "Buy",
        "openDate": "2026-11-02T09:00:00Z",
        "closeDate": "2026-11-02T10:00:00Z",
        "result": "Win",
        "currency": "USD",
        "amounts": {"netPnl": "100", "quantity": "1"},
    }
    service.action(
        ORIGIN, store.workspace()["revision"], uuid4().hex, "create-trade", {"trade": record}
    )


def test_compatibility_table_write_cannot_bypass_manual_fact_history(storage):
    create_manual(storage)
    state = storage.workspace()
    before = storage.snapshot()
    changed = deepcopy(state["tables"])
    changed["journalTrades"][0]["amounts"]["netPnl"] = "999"
    changed["journalTrades"][0]["netPnl"] = 999
    changed["journalTrades"][0]["pnl"] = 999
    with pytest.raises(WorkspaceError):
        storage.save_tables(ORIGIN, changed, state["revision"], uuid4().hex)
    assert storage.snapshot() == before


def test_reimporting_manual_book_after_owner_restore_reuses_existing_source_identity(storage):
    service = JournalService(storage)
    book = storage.workspace()["books"][0]["id"]
    csv_text = "eventId,eventType,openedAt,closedAt,symbol,side,quantity,netPnl,currency\nsource-1,trade,2026-11-02T09:00:00Z,2026-11-02T10:00:00Z,EURUSD,Buy,1,100,USD\n"
    mapping = {
        "version": 1,
        "name": "Original mapping",
        "timezone": "UTC",
        "currency": "USD",
        "quantityUnit": "units",
        "columns": {field: field for field in csv_text.splitlines()[0].split(",")},
    }
    preview = service.preview_import(
        ORIGIN, 1, book, "fixture", csv_text, mapping, storage.workspace()["revision"]
    )
    service.commit_import(preview["id"], preview["expectedRevision"], uuid4().hex)
    archive = WorkspaceRecoveryService(storage, storage.uid).create_backup()
    target = WorkspaceStorage(storage.engine, "principal_rebound_review")
    recovery = WorkspaceRecoveryService(target, target.uid)
    restore = recovery.preview_restore(archive, 0)
    recovery.commit_restore(restore["jobId"], 0, restore["confirmationHash"], True)
    restored_book = target.workspace()["books"][0]["id"]
    repeated = JournalService(target).preview_import(
        ORIGIN, 1, restored_book, "fixture", csv_text, mapping, target.workspace()["revision"]
    )
    assert repeated["preview"]["canCommit"] and repeated["preview"]["counts"]["unchanged"] == 1
    assert repeated["preview"]["counts"]["insert"] == 0


def test_closed_position_cannot_be_closed_again_as_a_zero_quantity_exit(storage):
    create_manual(storage)
    before = storage.snapshot()
    with pytest.raises(WorkspaceError):
        JournalService(storage).action(
            ORIGIN,
            storage.workspace()["revision"],
            uuid4().hex,
            "close-trade",
            {
                "tradeId": 1,
                "patch": {
                    "closeDate": "2026-11-02T11:00:00Z",
                    "result": "Win",
                    "amounts": {"netPnl": "200"},
                },
            },
        )
    assert storage.snapshot() == before


def test_restored_period_review_is_updated_under_same_identity_after_owner_rebind(storage):
    create_manual(storage)
    book = storage.workspace()["books"][0]["id"]
    payload = {
        "portfolioId": 1,
        "bookId": book,
        "period": "day",
        "startDate": "2026-11-02",
        "timezone": "UTC",
        "currency": "USD",
        "strategy": "All",
        "notes": "Before restore",
        "includedTradeIds": [1],
    }
    JournalService(storage).action(
        ORIGIN, storage.workspace()["revision"], uuid4().hex, "review-period", payload
    )
    previous = storage.snapshot()["journalLedger"]["periodReviews"][0]
    archive = WorkspaceRecoveryService(storage, storage.uid).create_backup()
    target = WorkspaceStorage(storage.engine, "principal_period_rebound")
    recovery = WorkspaceRecoveryService(target, target.uid)
    preview = recovery.preview_restore(archive, 0)
    recovery.commit_restore(preview["jobId"], 0, preview["confirmationHash"], True)
    new_book = target.workspace()["books"][0]["id"]
    JournalService(target).action(
        ORIGIN,
        target.workspace()["revision"],
        uuid4().hex,
        "review-period",
        {**payload, "bookId": new_book, "notes": "After restore"},
    )
    reviews = target.snapshot()["journalLedger"]["periodReviews"]
    assert len(reviews) == 1 and reviews[0]["id"] == previous["id"]
    assert reviews[0]["revision"] == 2 and reviews[0]["notes"] == "After restore"
