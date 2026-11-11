"""Independent exact partial/final paper outcomes in the existing journal."""

from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

import pytest
from test_paper_storage import AT, ORIGIN, make_record, save_record

from services.journal_ledger import validate_ledger
from services.journal_service import JournalService
from services.paper_engine import advance_bar, apply_command
from services.paper_journal import project_paper_positions
from services.paper_records import PaperRecords
from services.paper_reports import canonical_checkpoint
from services.workspace_storage import WorkspaceError

pytest_plugins = ["test_journal_service"]


def bar(index, opened="100", close="101"):
    prices = [Decimal(opened), Decimal(close)]
    return {
        "index": index,
        "time": 1793610000 + index * 60,
        "availableAt": 1793610060 + index * 60,
        "open": opened,
        "high": str(max(prices) + 2),
        "low": str(min(prices) - 2),
        "close": close,
    }


def order(record, *, side="buy", quantity="10", identity="entry_first"):
    record["state"]["status"] = "in_progress"
    record["state"], _ = apply_command(
        record["config"],
        record["state"],
        {
            "id": identity,
            "type": "order",
            "side": side,
            "orderType": "market",
            "quantity": quantity,
        },
    )


def advance(record, index, opened="100", close="101"):
    record["state"], _ = advance_bar(record["config"], record["state"], bar(index, opened, close))


def close(record, quantity, identity):
    record["state"], _ = apply_command(
        record["config"],
        record["state"],
        {
            "id": identity,
            "type": "close",
            "positionId": record["state"]["positions"][0]["id"],
            "quantity": quantity,
        },
    )


def publish(storage, record):
    record["revision"] += 1
    record["status"] = record["state"]["status"]
    record["checkpoint"] = canonical_checkpoint(
        record["manifest"], record["state"], record["revision"], AT
    )
    with storage.transaction() as connection:
        state = storage._read(connection, ORIGIN, full_modules=False)
        run = state["snapshot"]["tables"]["practiceSessions"][0]
        run["paper"].update(revision=record["revision"], status=record["status"])
        result = project_paper_positions(state, run, record, at=AT)
        JournalService(storage)._save(connection, state, ORIGIN)
        PaperRecords(storage).save(connection, ORIGIN, 1, record)
        validate_ledger(state["journalLedger"], state["snapshot"])
    return result


def only_trade(storage):
    return storage.workspace()["tables"]["journalTrades"][0]


def test_entry_brackets_and_order_reference_survive_partial_projection(storage):
    record, _ = save_record(storage)
    record["state"]["status"] = "in_progress"
    record["state"], _ = apply_command(
        record["config"],
        record["state"],
        {
            "id": "entry_bracket_plan",
            "type": "order",
            "side": "buy",
            "orderType": "market",
            "quantity": "10",
            "stopLoss": "90",
            "takeProfit": "150",
        },
    )
    advance(record, 0)
    publish(storage, record)
    trade = only_trade(storage)
    assert trade["sl"] == 90 and trade["tp"] == 150
    assert trade["externalId"] == record["state"]["positions"][0]["orderId"]
    assert trade["amounts"]["riskAmount"] is None
    close(record, "4", "close_with_initial_plan")
    advance(record, 1, "110", "111")
    publish(storage, record)
    updated = only_trade(storage)
    assert (updated["sl"], updated["tp"], updated["externalId"]) == (
        trade["sl"],
        trade["tp"],
        trade["externalId"],
    )
    assert updated["remainingQuantity"] == "6"


def test_entry_fee_partial_and_final_close_reconcile_without_double_count(storage):
    record, _ = save_record(storage)
    order(record)
    advance(record, 0)
    assert len(publish(storage, record)["appliedFillIds"]) == 1
    trade = only_trade(storage)
    assert trade["origin"] == "simulator" and trade["quantityUnit"] == "shares"
    assert trade["result"] == "Open" and trade["remainingQuantity"] == "10"
    assert trade["realizations"][0]["kind"] == "fee"
    assert trade["realizations"][0]["quantity"] == "0"
    assert trade["amounts"]["netPnl"] == "-1"
    close(record, "4", "close_partial")
    advance(record, 1, "110", "111")
    publish(storage, record)
    trade = only_trade(storage)
    assert trade["result"] == "Open" and trade["remainingQuantity"] == "6"
    assert trade["amounts"]["grossPnl"] == "40"
    assert trade["amounts"]["commission"] == "2"
    assert trade["amounts"]["netPnl"] == "38"
    close(record, "6", "close_final")
    advance(record, 2, "90", "91")
    publish(storage, record)
    trade = only_trade(storage)
    assert trade["result"] == "Loss" and trade["remainingQuantity"] == "0"
    assert trade["amounts"]["grossPnl"] == "-20"
    assert trade["amounts"]["commission"] == "3"
    assert trade["amounts"]["netPnl"] == "-23"
    assert Decimal(record["state"]["cash"]) - Decimal(record["config"]["startingCash"]) == Decimal(
        trade["amounts"]["netPnl"]
    )
    assert [item["quantity"] for item in trade["realizations"]] == ["0", "4", "6"]


def test_duplicate_projection_has_no_extra_trade_event_history_or_fact_revision(storage):
    record, _ = save_record(storage)
    order(record)
    advance(record, 0)
    publish(storage, record)
    before = storage.snapshot()
    with storage.transaction() as connection:
        state = storage._read(connection, ORIGIN, full_modules=False)
        run = state["snapshot"]["tables"]["practiceSessions"][0]
        result = project_paper_positions(state, run, record, at=AT)
        assert result["appliedFillIds"] == []
        JournalService(storage)._save(connection, state, ORIGIN)
    after = storage.snapshot()
    assert (
        before["snapshot"]["tables"]["journalTrades"]
        == after["snapshot"]["tables"]["journalTrades"]
    )
    assert before["journalLedger"] == after["journalLedger"]


def test_later_fill_preserves_notes_review_and_archived_trade(storage):
    record, _ = save_record(storage)
    order(record)
    advance(record, 0)
    publish(storage, record)
    trade = only_trade(storage)
    journal = JournalService(storage)
    journal.action(
        ORIGIN,
        storage.workspace()["revision"],
        uuid4().hex,
        "review-trade",
        {
            "tradeId": trade["id"],
            "review": {
                "technicalNotes": "Decision preserved",
                "strategy": "My manual paper strategy",
                "reviewStatus": "reviewed",
            },
        },
    )
    journal.action(
        ORIGIN,
        storage.workspace()["revision"],
        uuid4().hex,
        "archive-trade",
        {"tradeId": trade["id"]},
    )
    before = only_trade(storage)
    close(record, "4", "close_partial")
    advance(record, 1, "110", "111")
    publish(storage, record)
    after = only_trade(storage)
    assert after["technicalNotes"] == "Decision preserved"
    assert after["strategy"] == "My manual paper strategy"
    assert after["reviewStatus"] == "reviewed" and after["reviewedAt"] == before["reviewedAt"]
    assert after["reviewRevision"] == before["reviewRevision"]
    assert after["archivedAt"] == before["archivedAt"]
    assert after["factRevision"] == before["factRevision"] + 1


@pytest.mark.parametrize(
    "action,payload",
    [
        ("partial-close-trade", {"quantity": "1"}),
        ("update-trade", {"patch": {"amounts": {"netPnl": "999"}}}),
    ],
)
def test_simulated_facts_cannot_be_edited_through_manual_lifecycle(storage, action, payload):
    record, _ = save_record(storage)
    order(record)
    advance(record, 0)
    publish(storage, record)
    with pytest.raises(WorkspaceError, match="source_fact_locked"):
        JournalService(storage).action(
            ORIGIN,
            storage.workspace()["revision"],
            uuid4().hex,
            action,
            {"tradeId": only_trade(storage)["id"], **payload},
        )


def test_short_result_sign_and_entry_fee_are_exact(storage):
    record, _ = save_record(storage)
    order(record, side="sell", quantity="5")
    advance(record, 0)
    publish(storage, record)
    close(record, "5", "short_exit")
    advance(record, 1, "90", "91")
    publish(storage, record)
    trade = only_trade(storage)
    assert trade["direction"] == "Sell" and trade["result"] == "Win"
    assert trade["amounts"]["grossPnl"] == "50"
    assert trade["amounts"]["netPnl"] == "48"


def test_recovered_owner_continues_same_journal_position_without_duplicate(storage):
    from services.workspace_recovery import WorkspaceRecoveryService
    from services.workspace_storage import WorkspaceStorage

    record, _ = save_record(storage)
    order(record)
    advance(record, 0)
    publish(storage, record)
    archive = WorkspaceRecoveryService(storage, storage.uid).create_backup()
    target = WorkspaceStorage(storage.engine, "principal_paper_restored")
    recovery = WorkspaceRecoveryService(target, target.uid)
    preview = recovery.preview_restore(archive, 0)
    recovery.commit_restore(preview["jobId"], 0, preview["confirmationHash"], confirm_owner=True)
    with target.engine.connect() as connection:
        recovered = PaperRecords(target).load(connection, ORIGIN, 1)
    close(recovered, "4", "restored_partial")
    advance(recovered, 1, "110", "111")
    publish(target, recovered)
    trades = target.workspace()["tables"]["journalTrades"]
    assert len(trades) == 1 and trades[0]["remainingQuantity"] == "6"
    assert len(target.snapshot()["journalLedger"]["events"]) == 2


def test_engine_position_mismatch_refuses_projection(storage):
    record, session = make_record(storage)
    session["id"] = 2
    with storage.engine.connect() as connection:
        state = storage._read(connection, ORIGIN, full_modules=False)
    with pytest.raises(WorkspaceError, match="scope_mismatch"):
        project_paper_positions(state, session, record, at=AT)
