"""Independent review: currency residues, chronological proof and failure isolation."""

from copy import deepcopy
from decimal import ROUND_HALF_EVEN, Decimal

import pytest

from services.paper_engine import (
    PaperEngineError,
    advance_bar,
    apply_command,
    initial_state,
    validate_state,
)


def settings():
    return {
        "version": 1,
        "instrument": {
            "symbol": "FRACTION",
            "exchange": "LOCAL",
            "interval": "1m",
            "currency": "USD",
            "quantityUnit": "share",
            "quantityStep": "1",
            "priceTick": "0.001",
            "multiplier": "1",
            "quantityScale": 0,
            "priceScale": 3,
        },
        "startingCash": "10000",
        "moneyScale": 2,
        "costs": {"spreadTicks": 0, "slippageTicks": 0, "feeBps": "0", "feePerFill": "0"},
        "policy": {"id": "native-ohlc-conservative-v1", "gap": "next-observed"},
        "seed": 0,
        "startTime": 1000,
    }


def candle(index, price):
    return {
        "index": index,
        "time": 1000 + index * 60,
        "availableAt": 1060 + index * 60,
        "open": price,
        "high": price,
        "low": price,
        "close": price,
    }


def round_trip(side, exit_price, quantities):
    cfg = settings()
    state = initial_state(cfg)
    state["status"] = "in_progress"
    state, _ = apply_command(
        cfg,
        state,
        {
            "id": "review_entry",
            "type": "order",
            "side": side,
            "orderType": "market",
            "quantity": "3",
        },
    )
    state, _ = advance_bar(cfg, state, candle(0, "1"))
    for index, quantity in enumerate(quantities, 1):
        state, _ = apply_command(
            cfg,
            state,
            {
                "id": f"review_exit_{index}",
                "type": "close",
                "positionId": state["positions"][0]["id"],
                "quantity": quantity,
            },
        )
        state, _ = advance_bar(cfg, state, candle(index, exit_price))
    return cfg, state


@pytest.mark.parametrize(
    "side,price,expected",
    [
        ("buy", "1.005", "0.02"),
        ("buy", "0.995", "-0.02"),
        ("sell", "0.995", "0.02"),
        ("sell", "1.005", "-0.02"),
    ],
)
def test_partial_closes_preserve_final_currency_rounding_residue(side, price, expected):
    cfg, split = round_trip(side, price, ["1", "1", "1"])
    _, whole = round_trip(side, price, ["3"])
    independently = (
        Decimal("3") * (Decimal(price) - Decimal("1")) * (1 if side == "buy" else -1)
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)
    assert Decimal(split["realizedGross"]) == independently == Decimal(expected)
    assert split["realizedGross"] == whole["realizedGross"]
    assert split["cash"] == whole["cash"]
    assert sum(Decimal(fill["grossPnl"]) for fill in split["fills"]) == independently
    assert validate_state(cfg, split) == split


def test_restored_position_cannot_reorder_partial_exits_and_claim_an_earlier_close():
    cfg, state = round_trip("buy", "1.1", ["1", "2"])
    changed = deepcopy(state)
    position = changed["positions"][0]
    position["fillIds"][1:] = reversed(position["fillIds"][1:])
    position["closedTime"] = changed["fills"][1]["time"]
    with pytest.raises(PaperEngineError):
        validate_state(cfg, changed)


def test_fill_budget_failure_does_not_mutate_the_acknowledged_account(monkeypatch):
    from services import paper_engine

    cfg = settings()
    state = initial_state(cfg)
    state["status"] = "in_progress"
    state, _ = apply_command(
        cfg,
        state,
        {"id": "first", "type": "order", "side": "buy", "orderType": "market", "quantity": "3"},
    )
    state, _ = advance_bar(cfg, state, candle(0, "1"))
    state, _ = apply_command(
        cfg,
        state,
        {
            "id": "close",
            "type": "close",
            "positionId": state["positions"][0]["id"],
            "quantity": "3",
        },
    )
    before = deepcopy(state)
    monkeypatch.setattr(paper_engine, "MAX_FILLS", 1)
    with pytest.raises(PaperEngineError, match="fill_limit"):
        advance_bar(cfg, state, candle(1, "1.1"))
    assert state == before
