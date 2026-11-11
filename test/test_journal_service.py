"""Independent lifecycle/import/review expectations on real scoped SQLite."""

import base64
import csv
import json
from copy import deepcopy
from io import StringIO
from uuid import uuid4

import pytest
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError

from database.workspace_storage_db import TABLES, journal_records
from services.journal_service import JournalService
from services.workspace_storage import WorkspaceError, WorkspaceStorage


@pytest.fixture
def storage(tmp_path):
    service = WorkspaceStorage(
        "sqlite:///" + (tmp_path / "journal.db").as_posix(), "principal_journal_owner"
    )
    tables = {name: [] for name in TABLES}
    tables["portfolios"] = [
        {
            "id": 1,
            "name": "Original",
            "kind": "live",
            "currency": "USD",
            "startingBalance": 1000,
            "createdAt": "2026-11-02T00:00:00Z",
            "updatedAt": "2026-11-02T00:00:00Z",
        }
    ]
    tables["brokerAccounts"] = [
        {
            "id": 1,
            "displayName": "Account",
            "platform": "manual",
            "brokerName": "Fixture",
            "server": "fixture-server",
            "externalLogin": "111",
            "accountKind": "demo",
            "currency": "USD",
            "symbolSuffix": "",
        },
        {
            "id": 2,
            "displayName": "Other account",
            "platform": "manual",
            "brokerName": "Fixture",
            "server": "fixture-server",
            "externalLogin": "222",
            "accountKind": "demo",
            "currency": "USD",
            "symbolSuffix": "",
        },
    ]
    snapshot = {
        "format": "chartly-browser-snapshot",
        "version": 1,
        "originId": "journal_origin_01",
        "createdAt": "2026-11-02T00:00:00Z",
        "tables": tables,
        "nativeCatalogs": {},
        "preferences": {},
        "attachments": {},
        "datasetManifests": [],
    }
    preview = service.preview_migration(snapshot)
    service.commit_migration(preview["id"], {}, str(uuid4()))
    yield service
    service.engine.dispose()


def act(storage, action, payload, **extra):
    return JournalService(storage).action(
        "journal_origin_01",
        extra.get("revision", storage.workspace()["revision"]),
        extra.get("request_id", str(uuid4())),
        action,
        payload,
    )


def manual(storage, **changes):
    book = next(book for book in storage.workspace()["books"] if book["kind"] == "manual")
    return {
        "portfolioId": 1,
        "journalBookId": book["id"],
        "pair": "EXAMPLE",
        "direction": "Buy",
        "result": "Open",
        "openDate": "2026-11-02T09:00:00Z",
        "closeDate": "",
        "currency": "USD",
        "quantityUnit": "units",
        "amounts": {"quantity": "10", "netPnl": None, "riskAmount": None},
        **changes,
    }


def test_open_partial_final_close_exact_money_and_history_reopen(storage):
    created = act(storage, "create-trade", {"trade": manual(storage)})
    trade = created["detail"]["trade"]
    id = trade["id"]
    assert (
        trade["closeDate"] == ""
        and trade["amounts"]["netPnl"] is None
        and trade["rMultiple"] is None
    )
    partial = act(
        storage,
        "partial-close-trade",
        {
            "tradeId": id,
            "quantity": "4",
            "closedAt": "2026-11-02T10:00:00Z",
            "netPnl": "38.2",
            "grossPnl": "40",
            "commission": "1.8",
            "fees": "0",
            "swap": "0",
        },
    )
    assert (
        partial["detail"]["trade"]["remainingQuantity"] == "6"
        and partial["detail"]["trade"]["result"] == "Open"
    )
    closed = act(
        storage,
        "close-trade",
        {
            "tradeId": id,
            "patch": {
                "result": "Win",
                "closeDate": "2026-11-02T11:00:00Z",
                "amounts": {
                    "netPnl": "100",
                    "grossPnl": "103",
                    "commission": "3",
                    "fees": "0",
                    "swap": "0",
                },
            },
        },
    )
    final = closed["detail"]["trade"]
    assert final["amounts"]["netPnl"] == "100" and final["realizations"][1]["netPnl"] == "61.8"
    assert final["realizations"][1]["commission"] == "1.2" and final["remainingQuantity"] == "0"
    assert len(closed["detail"]["history"]) == 3
    reopened = JournalService(WorkspaceStorage(storage.engine, storage.uid)).detail(
        "journal_origin_01", id
    )
    assert reopened == closed["detail"]


def test_cas_uncertain_reply_and_reused_id_never_duplicate(storage):
    revision = storage.workspace()["revision"]
    request_id = str(uuid4())
    payload = {"trade": manual(storage)}
    first = act(storage, "create-trade", payload, revision=revision, request_id=request_id)
    replay = act(storage, "create-trade", payload, revision=revision, request_id=request_id)
    assert (
        first["result"] == replay["result"]
        and len(replay["workspace"]["tables"]["journalTrades"]) == 1
    )
    with pytest.raises(WorkspaceError, match="revision_conflict"):
        act(storage, "create-trade", payload, revision=revision)
    with pytest.raises(WorkspaceError, match="reused_with_different_input"):
        act(
            storage,
            "create-trade",
            {"trade": manual(storage, pair="OTHER")},
            revision=revision,
            request_id=request_id,
        )


@pytest.mark.parametrize(
    "changes,code",
    [
        ({"openDate": "2026-11-02T09:00"}, "timestamp_offset"),
        ({"closeDate": "2026-11-02T10:00Z"}, "open_trade"),
        ({"amounts": {"quantity": "-2"}}, "quantity"),
        ({"amounts": {"quantity": "1e4"}}, "decimal"),
        ({"amounts": {"quantity": "10", "netPnl": "100"}}, "open_pnl"),
        (
            {"result": "Win", "closeDate": "2026-11-01T09:00Z", "amounts": {"netPnl": "5"}},
            "close_before",
        ),
        ({"sourceEventKeys": ["foreign_event"]}, "provenance"),
    ],
)
def test_invalid_manual_capture_rolls_back(storage, changes, code):
    with pytest.raises(WorkspaceError, match=code):
        act(storage, "create-trade", {"trade": manual(storage, **changes)})
    assert storage.workspace()["tables"]["journalTrades"] == []


def test_review_clear_and_archive_undo_preserve_facts(storage):
    trade = act(storage, "create-trade", {"trade": manual(storage)})["detail"]["trade"]
    reviewed = act(
        storage,
        "review-trade",
        {
            "tradeId": trade["id"],
            "review": {
                "technicalNotes": "Keep this review",
                "tags": ["planned"],
                "rating": 4,
                "chartUrl": "https://example.test/chart",
                "reviewStatus": "reviewed",
            },
        },
    )
    assert reviewed["detail"]["trade"]["factRevision"] == trade["factRevision"]
    cleared = act(
        storage,
        "review-trade",
        {"tradeId": trade["id"], "review": {"rating": None, "chartUrl": None}},
    )
    assert (
        "rating" not in cleared["detail"]["trade"] and "chartUrl" not in cleared["detail"]["trade"]
    )
    act(storage, "archive-trade", {"tradeId": trade["id"]})
    assert storage.workspace()["tables"]["journalTrades"][0]["archivedAt"]
    restored = act(storage, "restore-trade", {"tradeId": trade["id"]})
    assert (
        "archivedAt" not in restored["detail"]["trade"]
        and restored["detail"]["trade"]["technicalNotes"] == "Keep this review"
    )
    assert [row["action"] for row in restored["detail"]["history"]][-2:] == [
        "archive-trade",
        "restore-trade",
    ]


def test_partial_exit_bounds_and_unknown_quantity(storage):
    id = act(
        storage,
        "create-trade",
        {"trade": manual(storage, amounts={"quantity": None, "netPnl": None})},
    )["detail"]["trade"]["id"]
    with pytest.raises(WorkspaceError, match="known_quantity"):
        act(
            storage,
            "partial-close-trade",
            {"tradeId": id, "quantity": "2", "closedAt": "2026-11-02T10:00:00Z", "netPnl": "1"},
        )
    act(storage, "update-trade", {"tradeId": id, "patch": {"amounts": {"quantity": "2"}}})
    with pytest.raises(WorkspaceError, match="exceeds_position"):
        act(
            storage,
            "partial-close-trade",
            {"tradeId": id, "quantity": "3", "closedAt": "2026-11-02T10:00:00Z", "netPnl": "1"},
        )


def test_manual_closed_total_correction_and_partial_exit_correction_are_audited(storage):
    id = act(storage, "create-trade", {"trade": manual(storage)})["detail"]["trade"]["id"]
    act(
        storage,
        "partial-close-trade",
        {"tradeId": id, "quantity": "4", "closedAt": "2026-11-02T10:00:00Z", "netPnl": "40"},
    )
    corrected = act(
        storage,
        "correct-realization",
        {
            "tradeId": id,
            "realizationId": storage.workspace()["tables"]["journalTrades"][0]["realizations"][0][
                "id"
            ],
            "patch": {"netPnl": "38.2"},
            "reason": "Corrected the recorded commission",
        },
    )
    assert (
        corrected["detail"]["trade"]["amounts"]["netPnl"] == "38.2"
        and corrected["detail"]["trade"]["result"] == "Open"
    )
    act(
        storage,
        "close-trade",
        {
            "tradeId": id,
            "patch": {
                "result": "Win",
                "closeDate": "2026-11-02T11:00:00Z",
                "amounts": {"netPnl": "100"},
            },
        },
    )
    with pytest.raises(WorkspaceError, match="correction_reason"):
        act(storage, "update-trade", {"tradeId": id, "patch": {"amounts": {"netPnl": "90"}}})
    updated = act(
        storage,
        "update-trade",
        {
            "tradeId": id,
            "patch": {"amounts": {"netPnl": "90"}},
            "reason": "Corrected final total from statement",
        },
    )
    assert (
        updated["detail"]["trade"]["realizations"][0]["netPnl"] == "38.2"
        and updated["detail"]["trade"]["realizations"][1]["netPnl"] == "51.8"
    )
    assert updated["detail"]["history"][-1]["before"]["amounts"]["netPnl"] == "100"


def test_manual_exit_status_change_needs_explicit_confirmation(storage):
    id = act(storage, "create-trade", {"trade": manual(storage)})["detail"]["trade"]["id"]
    partial = act(
        storage,
        "partial-close-trade",
        {"tradeId": id, "quantity": "4", "closedAt": "2026-11-02T10:00:00Z", "netPnl": "1"},
    )
    payload = {
        "tradeId": id,
        "realizationId": partial["detail"]["trade"]["realizations"][0]["id"],
        "patch": {"quantity": "10"},
        "reason": "Correct original filled quantity",
    }
    with pytest.raises(WorkspaceError, match="changes_position_state"):
        act(storage, "correct-realization", payload)
    assert storage.workspace()["tables"]["journalTrades"][0]["remainingQuantity"] == "6"
    result = act(storage, "correct-realization", {**payload, "confirmStatusChange": True})
    assert (
        result["detail"]["trade"]["remainingQuantity"] == "0"
        and result["detail"]["trade"]["result"] == "Win"
    )


def test_open_position_quantity_edit_recalculates_remaining(storage):
    id = act(storage, "create-trade", {"trade": manual(storage)})["detail"]["trade"]["id"]
    changed = act(
        storage, "update-trade", {"tradeId": id, "patch": {"amounts": {"quantity": "20"}}}
    )
    assert changed["detail"]["trade"]["remainingQuantity"] == "20"


def mapping():
    return {
        "version": 1,
        "name": "Normalized fixture",
        "columns": {
            name: name
            for name in (
                "eventId",
                "eventType",
                "positionId",
                "openedAt",
                "closedAt",
                "symbol",
                "side",
                "quantity",
                "netPnl",
                "commission",
                "currency",
            )
        },
        "timezone": "UTC",
        "currency": "USD",
        "quantityUnit": "units",
    }


def statement(net="12.34", commission="0"):
    return (
        "eventId,eventType,positionId,openedAt,closedAt,symbol,side,quantity,netPnl,commission,currency\n"
        + f"fill-1,trade,position-1,2026-11-02T09:00:00Z,2026-11-02T10:00:00Z,EXAMPLE,Buy,2,{net},{commission},USD\n"
    )


def preview_import(storage, text=None, book_id=None, account_id=None, provider="fixture-csv"):
    service = JournalService(storage)
    state = storage.workspace()
    book_id = book_id or next(book["id"] for book in state["books"] if book["kind"] == "manual")
    return service.preview_import(
        state["originId"],
        1,
        book_id,
        provider,
        text or statement(),
        mapping(),
        state["revision"],
        account_id,
    )


def commit(storage, preview, accept=False, request_id=None):
    return JournalService(storage).commit_import(
        preview["id"], preview["expectedRevision"], request_id or str(uuid4()), accept
    )


def test_import_repeat_correction_preserves_notes_and_original_observations(storage):
    first = commit(storage, preview_import(storage))
    trade = first["workspace"]["tables"]["journalTrades"][0]
    act(
        storage,
        "review-trade",
        {
            "tradeId": trade["id"],
            "review": {
                "technicalNotes": "User decision",
                "reviewStatus": "reviewed",
                "tags": ["breakout"],
            },
        },
    )
    repeat = commit(storage, preview_import(storage))
    assert len(repeat["workspace"]["tables"]["journalTrades"]) == 1
    assert len(repeat["workspace"]["journalLedger"]["observations"]) == 1
    correction = preview_import(storage, statement("11.34", "1"))
    assert correction["preview"]["counts"]["correction"] == 1
    with pytest.raises(WorkspaceError, match="corrections_require"):
        commit(storage, correction)
    changed = commit(storage, correction, True)
    final = changed["workspace"]["tables"]["journalTrades"][0]
    assert (
        final["id"] == trade["id"]
        and final["technicalNotes"] == "User decision"
        and final["tags"] == ["breakout"]
    )
    assert final["amounts"]["netPnl"] == "11.34" and final["reviewStatus"] == "unreviewed"
    assert len(changed["workspace"]["journalLedger"]["observations"]) == 2
    with pytest.raises(WorkspaceError, match="source_fact_locked"):
        act(storage, "update-trade", {"tradeId": final["id"], "patch": {"netPnl": 1000}})


def test_same_external_id_is_account_scoped_and_cross_source_ambiguity_blocks(storage):
    book1 = act(storage, "create-book", {"portfolioId": 1, "accountId": 1})["result"]["bookId"]
    book2 = act(storage, "create-book", {"portfolioId": 1, "accountId": 2})["result"]["bookId"]
    commit(storage, preview_import(storage, book_id=book1, account_id=1))
    commit(storage, preview_import(storage, book_id=book2, account_id=2))
    assert len(storage.workspace()["tables"]["journalTrades"]) == 2
    ambiguous = preview_import(storage, book_id=book1, account_id=1, provider="other-csv")
    assert not ambiguous["preview"]["canCommit"]
    with pytest.raises(WorkspaceError, match="import_has_errors"):
        commit(storage, ambiguous)


def test_daily_review_included_ids_timezone_and_versions(storage):
    id = act(
        storage,
        "create-trade",
        {
            "trade": manual(
                storage,
                result="Win",
                closeDate="2026-11-02T10:00:00Z",
                amounts={"quantity": "2", "netPnl": "1"},
            )
        },
    )["detail"]["trade"]["id"]
    book = storage.workspace()["books"][0]["id"]
    payload = {
        "portfolioId": 1,
        "bookId": book,
        "period": "day",
        "startDate": "2026-11-02",
        "timezone": "UTC",
        "currency": "USD",
        "strategy": "All",
        "filters": {"period": "all", "q": "", "result": "All", "direction": "All", "review": "All"},
        "notes": "First review",
        "goals": "Plan",
        "includedTradeIds": [id],
    }
    first = act(storage, "review-period", payload)["result"]["periodReview"]
    next_review = act(storage, "review-period", {**payload, "notes": "Second review"})["result"][
        "periodReview"
    ]
    assert next_review["id"] == first["id"] and next_review["revision"] == 2
    assert (
        len(
            [
                row
                for row in storage.workspace()["journalLedger"]["history"]
                if row.get("periodReviewId") == first["id"]
            ]
        )
        == 2
    )
    with pytest.raises(WorkspaceError, match="scope_mismatch"):
        act(storage, "review-period", {**payload, "startDate": "2026-11-03"})


def test_import_strategy_is_source_metadata_and_preserves_user_override(storage):
    service = JournalService(storage)
    state = storage.workspace()
    book = next(book["id"] for book in state["books"] if book["kind"] == "manual")
    mapping_value = mapping()
    mapping_value["columns"]["strategy"] = "strategy"

    def load(strategy, net):
        text = (
            statement(net)
            .replace("currency\n", "currency,strategy\n")
            .replace("USD\n", f"USD,{strategy}\n")
        )
        preview = service.preview_import(
            state["originId"],
            1,
            book,
            "fixture-csv",
            text,
            mapping_value,
            storage.workspace()["revision"],
        )
        return commit(storage, preview, True)["workspace"]["tables"]["journalTrades"][0]

    first = load("Breakout", "10")
    assert first["strategy"] == first["sourceStrategy"] == "Breakout"
    changed = load("Revised source", "9")
    assert changed["strategy"] == "Revised source"
    act(
        storage,
        "review-trade",
        {"tradeId": first["id"], "review": {"strategy": "User classification"}},
    )
    final = load("Another source correction", "8")
    assert final["strategy"] == "User classification"
    assert final["sourceStrategy"] == "Another source correction"


def test_real_export_files_exact_amount_notes_history_and_spreadsheet_safety(storage):
    created = act(
        storage,
        "create-trade",
        {
            "trade": manual(
                storage,
                result="Loss",
                closeDate="2026-11-02T10:00:00Z",
                amounts={"quantity": "1", "netPnl": "-0.123456789012345678"},
                technicalNotes=' =HYPERLINK("bad")',
            )
        },
    )
    service = JournalService(storage)
    book = created["detail"]["trade"]["journalBookId"]
    exported = service.export("journal_origin_01", 1, book)
    data = json.loads(base64.b64decode(exported["base64"]))
    assert (
        data["trades"][0]["amounts"]["netPnl"] == "-0.123456789012345678"
        and len(data["ledger"]["history"]) == 1
    )
    report = service.export("journal_origin_01", 1, book, "csv")
    rows = list(csv.DictReader(StringIO(base64.b64decode(report["base64"]).decode("utf-8-sig"))))
    assert rows[0]["netPnl"] == "-0.123456789012345678" and rows[0]["technicalNotes"].startswith(
        "' ="
    )


def test_other_owner_cannot_read_edit_export_or_reuse_job(storage):
    preview = preview_import(storage)
    other = JournalService(WorkspaceStorage(storage.engine, "principal_foreign_owner"))
    with pytest.raises(WorkspaceError, match="not_found"):
        other.state("journal_origin_01")
    with pytest.raises(WorkspaceError, match="not_found"):
        other.commit_import(preview["id"], preview["expectedRevision"], str(uuid4()), False)
