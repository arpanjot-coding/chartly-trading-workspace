"""Final independent P03 scope, restore chronology and input-boundary regressions."""

import base64
import json
from copy import deepcopy
from uuid import uuid4

import pytest
from test_journal_service import act, manual, mapping, statement

from services.journal_ledger import validate_ledger
from services.journal_service import JournalService
from services.workspace_storage import WorkspaceError

pytest_plugins = ["test_journal_service"]


def test_scoped_book_export_never_emits_trade_history_without_its_trade(storage):
    state = storage.workspace()
    tables = deepcopy(state["tables"])
    tables["portfolios"].append({**tables["portfolios"][0], "id": 2, "name": "Second environment"})
    storage.save_tables(state["originId"], tables, state["revision"], uuid4().hex)
    first_book = act(storage, "create-book", {"portfolioId": 1, "accountId": 1})["result"]["bookId"]
    second_book = act(storage, "create-book", {"portfolioId": 2, "accountId": 1})["result"][
        "bookId"
    ]
    assert first_book == second_book
    service = JournalService(storage)
    for profile_id, suffix in [(1, "one"), (2, "two")]:
        text = (
            statement()
            .replace("fill-1", f"fill-{suffix}")
            .replace("position-1", f"position-{suffix}")
        )
        preview = service.preview_import(
            "journal_origin_01",
            profile_id,
            first_book,
            "fixture-csv",
            text,
            mapping(),
            storage.workspace()["revision"],
            1,
        )
        assert preview["preview"]["canCommit"]
        service.commit_import(preview["id"], preview["expectedRevision"], uuid4().hex)
    exported = json.loads(
        base64.b64decode(service.export("journal_origin_01", 1, first_book)["base64"])
    )
    assert {trade["portfolioId"] for trade in exported["trades"]} == {1, 2}
    ids = {trade["id"] for trade in exported["trades"]}
    for kind, records in exported["ledger"].items():
        if kind == "version":
            continue
        assert {record["tradeId"] for record in records if "tradeId" in record} <= ids
        for record in records:
            assert set(record.get("includedTradeIds", [])) <= ids


def test_restore_rejects_closed_parent_time_that_is_not_its_final_exit(storage):
    trade = act(storage, "create-trade", {"trade": manual(storage)})["detail"]["trade"]
    act(
        storage,
        "close-trade",
        {
            "tradeId": trade["id"],
            "patch": {
                "result": "Win",
                "closeDate": "2026-11-02T11:00:00Z",
                "amounts": {"netPnl": "100"},
            },
        },
    )
    state = storage.workspace()
    snapshot = {"tables": deepcopy(state["tables"])}
    snapshot["tables"]["journalTrades"][0]["closeDate"] = "2026-11-02T10:00:00.000000Z"
    with pytest.raises(ValueError):
        validate_ledger(state["journalLedger"], snapshot)


def test_restore_does_not_accept_submicrosecond_time_that_manual_service_would_truncate(storage):
    act(storage, "create-trade", {"trade": manual(storage)})
    state = storage.workspace()
    snapshot = {"tables": deepcopy(state["tables"])}
    snapshot["tables"]["journalTrades"][0]["openDate"] = "2026-11-02T09:00:00.000000001Z"
    with pytest.raises(ValueError):
        validate_ledger(state["journalLedger"], snapshot)


def test_restore_rejects_closed_result_label_that_contradicts_known_net(storage):
    act(
        storage,
        "create-trade",
        {
            "trade": manual(
                storage,
                result="Win",
                closeDate="2026-11-02T10:00:00Z",
                amounts={"quantity": "10", "netPnl": "100"},
            )
        },
    )
    state = storage.workspace()
    snapshot = {"tables": deepcopy(state["tables"])}
    snapshot["tables"]["journalTrades"][0]["result"] = "Loss"
    with pytest.raises(ValueError):
        validate_ledger(state["journalLedger"], snapshot)


def test_attachment_updates_the_current_review_record_as_well_as_trade_projection(storage):
    trade = act(storage, "create-trade", {"trade": manual(storage)})["detail"]["trade"]
    act(
        storage,
        "review-trade",
        {
            "tradeId": trade["id"],
            "review": {
                "screenshotUrl": "https://example.test/previous.png",
                "technicalNotes": "Keep these notes",
            },
        },
    )
    png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Iu8AAAAASUVORK5CYII="
    result = JournalService(storage).attachment(
        "journal_origin_01",
        storage.workspace()["revision"],
        uuid4().hex,
        trade["id"],
        "image/png",
        png,
    )
    detail = result["detail"]
    assert detail["review"]["revision"] == detail["trade"]["reviewRevision"]
    assert detail["review"]["fields"]["screenshotUrl"] == detail["trade"]["screenshotUrl"]
    assert detail["review"]["fields"]["technicalNotes"] == "Keep these notes"


def test_malformed_unicode_manual_input_is_structured_invalid_text_and_rolls_back(storage):
    before = storage.snapshot()
    with pytest.raises(WorkspaceError) as caught:
        act(storage, "create-trade", {"trade": manual(storage, technicalNotes="\ud800")})
    assert caught.value.code == "journal.invalid_text"
    assert storage.snapshot() == before


def test_malformed_unicode_statement_is_structured_invalid_text_and_rolls_back(storage):
    state = storage.workspace()
    book = next(book["id"] for book in state["books"] if book["kind"] == "manual")
    before = storage.snapshot()
    with pytest.raises(WorkspaceError) as caught:
        JournalService(storage).preview_import(
            "journal_origin_01",
            1,
            book,
            "fixture-csv",
            statement() + "\ud800",
            mapping(),
            state["revision"],
        )
    assert caught.value.code == "journal.invalid_text"
    assert storage.snapshot() == before
