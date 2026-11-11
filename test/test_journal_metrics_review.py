"""Independent exact-accounting and lifecycle boundary review for P03."""

from copy import deepcopy

import pytest
from test_journal_service import act, manual

from services.journal_ledger import validate_ledger
from services.workspace_storage import WorkspaceError

pytest_plugins = ["test_journal_service"]


def test_final_close_and_total_correction_keep_24_decimal_residuals_exact(storage):
    trade = act(storage, "create-trade", {"trade": manual(storage)})["detail"]["trade"]
    act(
        storage,
        "partial-close-trade",
        {
            "tradeId": trade["id"],
            "quantity": "4",
            "closedAt": "2026-11-02T10:00:00Z",
            "netPnl": "0.000000000000000000000001",
            "commission": "1.8",
        },
    )
    closed = act(
        storage,
        "close-trade",
        {
            "tradeId": trade["id"],
            "patch": {
                "result": "Win",
                "closeDate": "2026-11-02T11:00:00Z",
                "amounts": {
                    "netPnl": "12345678901234567890.123456789012345678901234",
                    "commission": "3",
                },
            },
        },
    )["detail"]["trade"]
    assert closed["realizations"][1]["netPnl"] == "12345678901234567890.123456789012345678901233"
    assert closed["realizations"][1]["commission"] == "1.2"
    corrected = act(
        storage,
        "update-trade",
        {
            "tradeId": trade["id"],
            "reason": "Correct total using the full source precision",
            "patch": {
                "amounts": {"netPnl": "12345678901234567890.123456789012345678901231"},
            },
        },
    )["detail"]["trade"]
    assert corrected["realizations"][1]["netPnl"] == "12345678901234567890.12345678901234567890123"
    assert corrected["realizations"][0]["netPnl"] == "0.000000000000000000000001"


def test_manual_capture_rejects_contradictory_fully_known_money_components(storage):
    before = storage.snapshot()
    with pytest.raises(WorkspaceError):
        act(
            storage,
            "create-trade",
            {
                "trade": manual(
                    storage,
                    result="Win",
                    closeDate="2026-11-02T10:00:00Z",
                    amounts={
                        "quantity": "10",
                        "netPnl": "100",
                        "grossPnl": "90",
                        "commission": "10",
                        "fees": "0",
                        "swap": "0",
                    },
                )
            },
        )
    assert storage.snapshot() == before


def test_exit_correction_rejects_contradictory_known_money_components(storage):
    trade = act(storage, "create-trade", {"trade": manual(storage)})["detail"]["trade"]
    partial = act(
        storage,
        "partial-close-trade",
        {
            "tradeId": trade["id"],
            "quantity": "4",
            "closedAt": "2026-11-02T10:00:00Z",
            "netPnl": "38.2",
            "grossPnl": "40",
            "commission": "1.8",
            "fees": "0",
            "swap": "0",
        },
    )["detail"]["trade"]
    before = storage.snapshot()
    with pytest.raises(WorkspaceError):
        act(
            storage,
            "correct-realization",
            {
                "tradeId": trade["id"],
                "realizationId": partial["realizations"][0]["id"],
                "patch": {"netPnl": "100"},
                "reason": "A contradictory net must not replace known gross and costs",
            },
        )
    assert storage.snapshot() == before


@pytest.mark.parametrize(
    "result,remaining,close", [("Open", "0", ""), ("Win", "4", "2026-11-02T10:00:00Z")]
)
def test_ledger_restore_rejects_position_status_inconsistent_with_remaining_quantity(
    storage, result, remaining, close
):
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
    row = snapshot["tables"]["journalTrades"][0]
    row.update(result=result, remainingQuantity=remaining, closeDate=close)
    with pytest.raises(ValueError):
        validate_ledger(state["journalLedger"], snapshot)


def test_period_review_uses_dst_aware_local_day_and_exact_book_currency_strategy_scope(storage):
    first = act(
        storage,
        "create-trade",
        {
            "trade": manual(
                storage,
                strategy="Fixture",
                result="Win",
                openDate="2026-11-01T09:00:00Z",
                closeDate="2026-11-02T04:59:59.999999Z",
                amounts={"quantity": "1", "netPnl": "1"},
            )
        },
    )["detail"]["trade"]
    next_day = act(
        storage,
        "create-trade",
        {
            "trade": manual(
                storage,
                strategy="Fixture",
                result="Win",
                openDate="2026-11-01T09:00:00Z",
                closeDate="2026-11-02T05:00:00Z",
                amounts={"quantity": "1", "netPnl": "1"},
            )
        },
    )["detail"]["trade"]
    connected = act(storage, "create-book", {"portfolioId": 1, "accountId": 1})["result"]["bookId"]
    payload = {
        "portfolioId": 1,
        "bookId": first["journalBookId"],
        "period": "day",
        "startDate": "2026-11-01",
        "timezone": "America/New_York",
        "currency": "USD",
        "strategy": "Fixture",
        "notes": "DST boundary review",
        "includedTradeIds": [first["id"]],
    }
    assert act(storage, "review-period", payload)["result"]["periodReview"]["includedTradeIds"] == [
        first["id"]
    ]
    for invalid in (
        {"includedTradeIds": [next_day["id"]]},
        {"bookId": connected},
        {"currency": "EUR"},
        {"strategy": "Another strategy"},
    ):
        before = storage.snapshot()
        with pytest.raises(WorkspaceError, match="scope_mismatch"):
            act(storage, "review-period", {**payload, **invalid})
        assert storage.snapshot() == before
