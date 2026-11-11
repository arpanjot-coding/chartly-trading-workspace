"""Independent arithmetic and adversarial native OHLC paper-engine fixtures."""

import json
import time
from copy import deepcopy
from decimal import Decimal

import pytest

from services.paper_engine import (
    MAX_CURVE,
    PaperEngineError,
    advance_bar,
    apply_command,
    initial_state,
    normalize_config,
    summary,
    validate_state,
)


def config(**changes):
    result = {
        "version": 1,
        "instrument": {
            "symbol": "EXAMPLE",
            "exchange": "LOCAL",
            "interval": "1m",
            "currency": "USD",
            "quantityUnit": "share",
            "quantityStep": "1",
            "priceTick": "0.25",
            "multiplier": "1",
            "quantityScale": 0,
            "priceScale": 2,
        },
        "startingCash": "10000",
        "moneyScale": 2,
        "costs": {"spreadTicks": 0, "slippageTicks": 0, "feeBps": "0", "feePerFill": "0"},
        "policy": {"id": "native-ohlc-conservative-v1", "gap": "next-observed"},
        "seed": 0,
        "startTime": 1000,
    }
    result.update(changes)
    return result


def started(configuration=None):
    configuration = configuration or config()
    state = initial_state(configuration)
    state["status"] = "in_progress"
    return configuration, state


def bar(index, opened="100", high=None, low=None, closed=None, **changes):
    result = {
        "index": index,
        "time": 1000 + index * 60,
        "availableAt": 1060 + index * 60,
        "open": opened,
        "high": high or opened,
        "low": low or opened,
        "close": closed or opened,
    }
    result.update(changes)
    return result


def order(configuration, state, identifier="entry", **changes):
    payload = {
        "id": identifier,
        "type": "order",
        "side": "buy",
        "orderType": "market",
        "quantity": "10",
        **changes,
    }
    return apply_command(configuration, state, payload)[0]


def advance(configuration, state, index, **changes):
    return advance_bar(configuration, state, bar(index, **changes))[0]


def close(configuration, state, quantity, identifier="close", position=None):
    return apply_command(
        configuration,
        state,
        {
            "id": identifier,
            "type": "close",
            "positionId": position or state["positions"][0]["id"],
            "quantity": quantity,
        },
    )[0]


def test_initial_exact_account_and_no_automatic_playback():
    c = config()
    state = initial_state(c)
    assert state["status"] == "ready"
    assert state["cursor"] == -1 and state["asOf"] == 1000
    assert summary(c, state)["cash"] == "10000"
    assert validate_state(c, state) == state
    with pytest.raises(PaperEngineError, match="inactive_session"):
        order(c, state)


def test_long_partial_final_exit_cash_fees_and_collateral_independent_arithmetic():
    c, state = started(
        config(costs={"spreadTicks": 0, "slippageTicks": 0, "feeBps": "10", "feePerFill": "0.25"})
    )
    state = advance(c, order(c, state), 0)
    assert state["cash"] == "9998.75"  # 1000 × .001 + .25, charged immediately.
    assert state["collateral"] == "1000"
    state = advance(c, close(c, state, "4"), 1, opened="110")
    assert state["positions"][0]["quantity"] == "6"
    assert state["collateral"] == "600"
    assert state["cash"] == "10038.06"  # +40 gross − (.44+.25) exit costs.
    state = advance(c, close(c, state, "6", "final"), 2, opened="90")
    assert state["cash"] == "9977.27"  # +40 −60 −1.25 −.69 −.79.
    assert state["realizedGross"] == "-20" and state["fees"] == "2.73"
    assert state["equity"] == state["cash"] and state["collateral"] == "0"
    assert state["positions"][0]["entryFee"] == "1.25"
    assert state["positions"][0]["exitFees"] == "1.48"
    assert state["positions"][0]["exitNotional"] == "980"
    assert [fill["fee"] for fill in state["fills"]] == ["1.25", "0.69", "0.79"]
    assert summary(c, state)["netPnl"] == "-22.73"
    assert validate_state(c, state) == state


def test_short_sale_proceeds_do_not_become_spendable_cash_and_close_is_profitable():
    c, state = started()
    state = advance(c, order(c, state, side="sell"), 0)
    assert state["cash"] == "10000" and state["available"] == "9000"
    state = advance(c, close(c, state, "10"), 1, opened="90")
    assert state["cash"] == "10100" and state["realizedGross"] == "100"
    assert state["fills"][-1]["side"] == "buy"
    validate_state(c, state)


def test_distinct_long_and_short_entries_do_not_silently_net_or_flip():
    c, state = started()
    state = order(c, order(c, state, "long"), "short", side="sell", quantity="4")
    state = advance(c, state, 0, high="111", low="98", closed="110")
    assert len(state["positions"]) == 2
    assert [position["quantity"] for position in state["positions"]] == ["10", "4"]
    assert state["unrealized"] == "60" and state["collateral"] == "1400"
    state = advance(c, close(c, state, "4", position=state["positions"][1]["id"]), 1, opened="90")
    assert state["positions"][0]["status"] == "open"
    assert state["positions"][1]["status"] == "closed"
    validate_state(c, state)


def test_negative_equity_short_gap_still_allows_reduce_only_exit():
    c, state = started(config(startingCash="1000"))
    state = advance(c, order(c, state, side="sell"), 0)
    state = advance(c, state, 1, opened="300")
    assert state["cash"] == "1000" and state["equity"] == "-1000"
    assert state["available"] == "0"
    state = advance(c, close(c, state, "10"), 2, opened="310")
    assert state["cash"] == "-1100" and state["positions"][0]["status"] == "closed"
    validate_state(c, state)


def test_insufficient_collateral_rejects_at_actual_next_event_price_fifo():
    c, state = started(config(startingCash="1500"))
    state = order(c, order(c, state, "first"), "second")
    state = advance(c, state, 0)
    assert [row["status"] for row in state["orders"]] == ["filled", "rejected"]
    assert state["orders"][1]["reason"] == "insufficient_collateral"
    assert len(state["positions"]) == 1
    c2, s2 = started(config(startingCash="1000"))
    s2 = advance(c2, order(c2, s2), 0, opened="101")
    assert not s2["fills"] and s2["orders"][0]["reason"] == "insufficient_collateral"


def test_future_closing_profit_cannot_fund_an_opening_order():
    c, state = started(config(startingCash="1500"))
    state = advance(c, order(c, state), 0)
    state = order(c, state, "unfunded")
    state = advance(c, state, 1, opened="100", high="1000", closed="1000")
    assert len(state["fills"]) == 1
    assert state["orders"][1]["reason"] == "insufficient_collateral"


def test_no_same_candle_fill_and_no_history_mutation_on_next_step():
    c, state = started()
    state = advance(c, state, 0, opened="50", high="1000", low="1")
    state = order(c, state)
    assert not state["fills"] and state["orders"][0]["eligibleIndex"] == 1
    before = json.dumps(state, sort_keys=True)
    following = advance(c, state, 1, opened="101")
    assert following["fills"][0]["price"] == "101"
    assert following["fills"][0]["barIndex"] == 1
    assert json.dumps(state, sort_keys=True) == before
    assert state["orders"][0]["status"] == "pending"


def test_exact_duplicate_command_has_no_duplicate_order_or_event():
    c, state = started()
    command = {
        "id": "same_request",
        "type": "order",
        "side": "buy",
        "orderType": "market",
        "quantity": "1",
    }
    first, events = apply_command(c, state, command)
    repeated, again = apply_command(c, first, command)
    assert first == repeated and len(events) == 1 and again == []
    with pytest.raises(PaperEngineError, match="command_conflict"):
        apply_command(c, first, {**command, "quantity": "2"})


def test_close_receipt_remains_idempotent_after_position_has_closed():
    c, state = started()
    state = advance(c, order(c, state), 0)
    command = {
        "id": "exit",
        "type": "close",
        "positionId": state["positions"][0]["id"],
        "quantity": "10",
    }
    state = apply_command(c, state, command)[0]
    state = advance(c, state, 1)
    repeated, events = apply_command(c, state, command)
    assert repeated == state and not events


def test_exact_old_command_retry_is_a_noop_after_session_finishes():
    c, state = started()
    command = {
        "id": "same_request",
        "type": "order",
        "side": "buy",
        "orderType": "market",
        "quantity": "1",
    }
    state = apply_command(c, state, command)[0]
    state["status"] = "finished"
    repeated, events = apply_command(c, state, command)
    assert repeated == state and events == []


def test_cancelled_order_never_fills_and_cancellation_is_not_an_execution():
    c, state = started()
    state = order(c, state)
    state = apply_command(
        c, state, {"id": "cancel", "type": "cancel", "orderId": state["orders"][0]["id"]}
    )[0]
    state = advance(c, state, 0)
    assert not state["positions"] and not state["fills"]
    assert state["cash"] == "10000"
    assert state["orders"][0]["status"] == "cancelled"
    validate_state(c, state)


@pytest.mark.parametrize("side,opened,expected", [("buy", "100", "100.5"), ("sell", "100", "99.5")])
def test_nondecimal_power_tick_spread_slippage_and_adverse_rounding(side, opened, expected):
    c, state = started(
        config(costs={"spreadTicks": 1, "slippageTicks": 1, "feeBps": "0.1", "feePerFill": "0"})
    )
    state = advance(c, order(c, state, side=side, quantity="1"), 0, opened=opened)
    assert (
        state["fills"][0]["price"] == expected
    )  # 0.25 tick, half-spread + full slip → adverse .50.
    assert state["fills"][0]["fee"] == "0.01"
    validate_state(c, state)


@pytest.mark.parametrize("unit,multiplier", [("contract", "50"), ("lot", "100")])
def test_explicit_contract_or_lot_multiplier_is_used_without_implicit_lot_guessing(
    unit, multiplier
):
    c = config()
    c["instrument"].update(quantityUnit=unit, multiplier=multiplier)
    c, state = started(c)
    state = advance(c, order(c, state, quantity="1"), 0, opened="10")
    assert Decimal(state["collateral"]) == Decimal(multiplier) * 10
    state = advance(c, close(c, state, "1"), 1, opened="12")
    assert Decimal(state["realizedGross"]) == Decimal(multiplier) * 2
    validate_state(c, state)


def test_fractional_binary_tick_uses_multiples_rather_than_decimal_places():
    c = config()
    c["instrument"].update(priceTick="0.03125", priceScale=5)
    c, state = started(c)
    state = advance(c, order(c, state, quantity="1"), 0, opened="100.01")
    assert state["fills"][0]["price"] == "100.03125"
    state = advance(c, close(c, state, "1"), 1, opened="101.01")
    assert state["fills"][-1]["price"] == "101"
    assert state["realizedGross"] == "0.97"
    validate_state(c, state)


@pytest.mark.parametrize(
    "side,opened,high,low,limit,expected,phase",
    [
        ("buy", "90", "105", "85", "100", "90", "open"),
        ("sell", "110", "115", "90", "100", "110", "open"),
        ("buy", "110", "120", "95", "100", "100", "intrabar"),
        ("sell", "90", "105", "80", "100", "100", "intrabar"),
    ],
)
def test_native_limits_allow_only_bounded_improvement(
    side, opened, high, low, limit, expected, phase
):
    c, state = started()
    state = advance(
        c,
        order(c, state, side=side, orderType="limit", limitPrice=limit),
        0,
        opened=opened,
        high=high,
        low=low,
    )
    assert state["fills"][0]["price"] == expected
    assert state["fills"][0]["phase"] == phase
    validate_state(c, state)


@pytest.mark.parametrize("side,expected", [("buy", "100"), ("sell", "100")])
def test_slippage_never_violates_a_limit(side, expected):
    c, state = started(
        config(costs={"spreadTicks": 0, "slippageTicks": 100, "feeBps": "0", "feePerFill": "0"})
    )
    state = advance(
        c, order(c, state, side=side, orderType="limit", limitPrice="100"), 0, opened="100"
    )
    assert state["fills"][0]["price"] == expected


@pytest.mark.parametrize(
    "side,opened,high,low,stop,expected,phase",
    [
        ("buy", "110", "115", "100", "105", "110", "open"),
        ("sell", "90", "100", "85", "95", "90", "open"),
        ("buy", "100", "110", "90", "105", "105", "intrabar"),
        ("sell", "100", "110", "90", "95", "95", "intrabar"),
    ],
)
def test_stop_market_uses_adverse_open_gap_or_touched_stop(
    side, opened, high, low, stop, expected, phase
):
    c, state = started()
    state = advance(
        c,
        order(c, state, side=side, orderType="stop", stopPrice=stop),
        0,
        opened=opened,
        high=high,
        low=low,
    )
    assert state["fills"][0]["price"] == expected and state["fills"][0]["phase"] == phase


@pytest.mark.parametrize(
    "side,stop,target,exit_price,gross",
    [("buy", "90", "110", "90", "-100"), ("sell", "110", "90", "110", "-100")],
)
def test_bracket_same_bar_stop_target_ambiguity_chooses_protective_stop(
    side, stop, target, exit_price, gross
):
    c, state = started()
    state = advance(
        c, order(c, state, side=side, stopLoss=stop, takeProfit=target), 0, high="115", low="85"
    )
    assert len(state["fills"]) == 2 and state["fills"][-1]["price"] == exit_price
    assert state["fills"][-1]["grossPnl"] == gross
    assert "stop_before_target" in state["fills"][-1]["assumptions"]
    assert state["positions"][0]["status"] == "closed"
    validate_state(c, state)


def test_protective_stop_after_prior_entry_fills_at_worse_gap_open():
    c, state = started()
    state = advance(c, order(c, state, stopLoss="90"), 0)
    state = advance(c, state, 1, opened="80", high="85", low="70")
    assert state["fills"][-1]["price"] == "80"
    assert state["fills"][-1]["reason"] == "stop-loss"


def test_intrabar_entry_cannot_claim_a_favourable_same_bar_target():
    c, state = started()
    state = advance(
        c,
        order(c, state, orderType="limit", limitPrice="95", takeProfit="110"),
        0,
        opened="100",
        high="120",
        low="90",
        closed="100",
    )
    assert len(state["fills"]) == 1
    assert state["positions"][0]["status"] == "open"
    state = advance(c, state, 1, opened="100", high="120", low="95")
    assert len(state["fills"]) == 2 and state["fills"][-1]["reason"] == "take-profit"


def test_intrabar_entry_can_take_a_conservative_stop_even_when_ohlc_path_is_unknown():
    c, state = started()
    state = advance(
        c,
        order(c, state, orderType="limit", limitPrice="95", stopLoss="90", takeProfit="110"),
        0,
        opened="100",
        high="120",
        low="85",
    )
    assert state["fills"][-1]["price"] == "90"
    assert "conservative_entry_bar_stop" in state["fills"][-1]["assumptions"]


def test_stop_entry_does_not_reuse_an_opening_gap_that_preceded_its_own_existence():
    c, state = started()
    state = advance(
        c,
        order(c, state, orderType="stop", stopPrice="105", stopLoss="100"),
        0,
        opened="90",
        high="110",
        low="85",
        closed="100",
    )
    assert [fill["price"] for fill in state["fills"]] == ["105", "100"]
    assert state["fills"][-1]["phase"] == "intrabar"
    assert state["fills"][-1]["grossPnl"] == "-50"
    validate_state(c, state)


def test_market_close_at_open_precedes_later_intrabar_bracket_stop():
    c, state = started()
    state = advance(c, order(c, state, stopLoss="90"), 0)
    state = advance(c, close(c, state, "10"), 1, opened="105", high="110", low="80")
    assert state["fills"][-1]["price"] == "105"
    assert len(state["fills"]) == 2


def test_bracket_fill_cancels_reserved_manual_reduce_order_without_flipping():
    c, state = started()
    state = advance(c, order(c, state, stopLoss="90"), 0)
    state = order(
        c,
        state,
        "reduce",
        side="sell",
        orderType="limit",
        limitPrice="120",
        quantity="10",
        positionId=state["positions"][0]["id"],
        reduceOnly=True,
    )
    state = advance(c, state, 1, opened="100", high="125", low="85")
    assert state["positions"][0]["status"] == "closed"
    assert state["orders"][1]["status"] == "cancelled"
    assert len(state["fills"]) == 2


def test_gap_disclosure_preserves_time_and_uses_only_next_observed_open():
    c, state = started()
    state = advance(c, state, 0)
    state = order(c, state)
    state, events = advance_bar(
        c,
        state,
        bar(1, opened="150", time=5000, availableAt=5060, gap={"kind": "unknown", "missing": None}),
    )
    assert state["asOf"] == 5060 and state["fills"][0]["price"] == "150"
    assert events[0]["type"] == "gap" and events[0]["data"]["policy"] == "next-observed"


@pytest.mark.parametrize(
    "changes",
    [
        {"index": 1},
        {"time": 999},
        {"availableAt": 1000},
        {"availableAt": float("nan")},
        {"time": True},
        {"high": "90"},
        {"low": "110"},
        {"open": "0"},
        {"close": "1e2"},
        {"extra": "value"},
    ],
)
def test_invalid_or_noncausal_bars_are_rejected_without_mutating_input(changes):
    c, state = started()
    before = deepcopy(state)
    with pytest.raises(PaperEngineError):
        advance_bar(c, state, {**bar(0), **changes})
    assert state == before


@pytest.mark.parametrize("quantity", ["0", "-1", "0.1", "NaN", "1e2", "1" * 200, 1, True, None])
def test_invalid_quantities_are_rejected(quantity):
    c, state = started()
    with pytest.raises(PaperEngineError):
        order(c, state, quantity=quantity)


@pytest.mark.parametrize(
    "changes",
    [
        {"orderType": "stop-limit"},
        {"side": "BUY"},
        {"limitPrice": "100"},
        {"orderType": "limit"},
        {"orderType": "stop", "stopPrice": "100.1"},
        {"reduceOnly": "true"},
        {"positionId": "foreign"},
        {"stopLoss": "100", "takeProfit": "100"},
        {"side": "sell", "stopLoss": "100", "takeProfit": "100"},
        {"rawBars": []},
    ],
)
def test_invalid_order_shapes_ticks_and_brackets_are_rejected(changes):
    c, state = started()
    with pytest.raises(PaperEngineError):
        order(c, state, **changes)


def test_overclose_and_duplicate_pending_close_are_rejected():
    c, state = started()
    state = advance(c, order(c, state), 0)
    with pytest.raises(PaperEngineError, match="overclose"):
        close(c, state, "11")
    state = close(c, state, "6")
    with pytest.raises(PaperEngineError, match="overclose"):
        close(c, state, "5", "too_many")
    with pytest.raises(PaperEngineError, match="invalid_close_side"):
        order(
            c,
            state,
            "wrong_side",
            quantity="1",
            positionId=state["positions"][0]["id"],
            reduceOnly=True,
        )


@pytest.mark.parametrize(
    "change",
    [
        lambda c: c.update(version=True),
        lambda c: c.update(moneyScale=19),
        lambda c: c.update(startingCash="0"),
        lambda c: c.update(startingCash="100.001"),
        lambda c: c["instrument"].update(quantityUnit="unknown"),
        lambda c: c["instrument"].update(priceTick="0.001"),
        lambda c: c["instrument"].update(multiplier="0"),
        lambda c: c["costs"].update(feeBps="-1"),
        lambda c: c["costs"].update(feePerFill="0.001"),
        lambda c: c["costs"].update(slippageTicks=True),
        lambda c: c["policy"].update(gap="invent-candles"),
        lambda c: c.update(apiKey="secret"),
    ],
)
def test_config_requires_explicit_supported_economics_and_costs(change):
    c = config()
    change(c)
    with pytest.raises(PaperEngineError):
        normalize_config(c)


def test_fractional_quantity_multiplier_and_last_close_reconcile_exactly():
    c = config()
    c["instrument"].update(
        quantityUnit="base_asset", quantityStep="0.001", quantityScale=3, multiplier="0.1"
    )
    c["costs"].update(feePerFill="0.01")
    c, state = started(c)
    state = advance(c, order(c, state, quantity="0.003"), 0)
    state = advance(c, close(c, state, "0.001"), 1, opened="150")
    state = advance(c, close(c, state, "0.002", "final"), 2, opened="150")
    assert state["positions"][0]["quantity"] == "0"
    assert (
        state["realizedGross"] == "0.02"
    )  # The final close retains the cumulative settlement rounding residue.
    assert state["fees"] == "0.03" and state["cash"] == "9999.99"
    validate_state(c, state)


def completed_state():
    c, state = started()
    state = advance(c, order(c, state), 0)
    state = advance(c, close(c, state, "4"), 1, opened="110")
    state = advance(c, close(c, state, "6", "final"), 2, opened="90")
    return c, state


@pytest.mark.parametrize(
    "tamper",
    [
        lambda s: s.update(cash="999999"),
        lambda s: s.update(fees="1"),
        lambda s: s.update(collateral="1"),
        lambda s: s.update(asOf=99999),
        lambda s: s["fills"][0].update(fee="1"),
        lambda s: s["fills"][1].update(grossPnl="999"),
        lambda s: s["fills"][0].update(barIndex=5),
        lambda s: s["positions"][0].update(quantity="1"),
        lambda s: s["positions"][0].update(fillIds=[]),
        lambda s: s["orders"][0].update(fillId="foreign"),
        lambda s: s["ledger"][1]["data"].update(fillId="foreign"),
        lambda s: s["equityCurve"][-1].update(equity="1"),
        lambda s: s.update(curveStride=3),
        lambda s: s.update(maxDrawdown="0"),
    ],
)
def test_restore_reconciles_finances_clocks_links_and_bounded_rows(tamper):
    c, state = completed_state()
    validate_state(c, state)
    tamper(state)
    with pytest.raises(PaperEngineError):
        validate_state(c, state)


def test_restart_with_pending_order_and_partial_position_matches_uninterrupted_run():
    c, state = started()
    state = advance(c, order(c, state), 0)
    state = advance(c, close(c, state, "4"), 1, opened="110")
    state = order(c, state, "future_entry", orderType="limit", limitPrice="80", quantity="3")
    restored = validate_state(c, json.loads(json.dumps(state)))
    uninterrupted = advance(c, state, 2, opened="100", high="105", low="75", closed="90")
    resumed = advance(c, restored, 2, opened="100", high="105", low="75", closed="90")
    assert resumed == uninterrupted and len(resumed["positions"]) == 2
    assert resumed["positions"][0]["quantity"] == "6"


@pytest.mark.parametrize(
    "tamper",
    [
        lambda s: s.update(status={}),
        lambda s: s["fills"][0].update(orderId={}),
        lambda s: s["positions"][0].update(fillIds=[{}]),
        lambda s: s["orders"][0].update(orderType="limit"),
        lambda s: s["orders"][0].update(reduceOnly=True),
        lambda s: s["ledger"][-1].update(asOf=1001),
        lambda s: s["ledger"][-1].update(cursor=-1),
        lambda s: s.update(commands={"unbounded": "secret"}),
    ],
)
def test_malformed_restored_types_are_safe_domain_errors(tamper):
    c, state = completed_state()
    tamper(state)
    with pytest.raises(PaperEngineError):
        validate_state(c, state)


@pytest.mark.parametrize(
    "tamper",
    [
        lambda s: s["ledger"][0]["data"].update(orderId="missing"),
        lambda s: s["ledger"][0].update(sequence=True),
        lambda s: s["orders"][0].update(createdTime=999),
        lambda s: s["orders"][0].update(eligibleIndex=True),
        lambda s: s["ledger"][0]["data"].update(commandId="missing"),
        lambda s: s["ledger"][0].update(cursor=1),
        lambda s: s["commands"].update(orphan="a" * 64),
    ],
)
def test_restore_rejects_orphan_commands_and_noncausal_order_ledger(tamper):
    c, state = completed_state()
    tamper(state)
    with pytest.raises(PaperEngineError):
        validate_state(c, state)


def test_pending_order_budget_is_bounded_and_full_state_stays_valid():
    c, state = started()
    for index in range(200):
        state = order(c, state, f"entry_{index}", orderType="limit", limitPrice="1", quantity="1")
    with pytest.raises(PaperEngineError, match="order_limit") as error:
        order(c, state, "beyond_limit")
    assert error.value.status == 413
    assert len(state["orders"]) == 200 and not state["fills"]
    validate_state(c, state)


def test_config_instrument_mismatch_and_finished_sessions_cannot_accept_events():
    c, state = completed_state()
    changed = deepcopy(c)
    changed["instrument"]["symbol"] = "ANOTHER"
    with pytest.raises(PaperEngineError, match="config_mismatch"):
        advance(changed, state, 3)
    state["status"] = "finished"
    with pytest.raises(PaperEngineError, match="inactive_session"):
        order(c, state, "after_finish")
    with pytest.raises(PaperEngineError, match="inactive_session"):
        advance(c, state, 3)


def test_50000_observations_keep_curve_bounded_and_track_unsampled_drawdown(tmp_path):
    c, state = started()
    began = time.perf_counter()
    for index in range(50000):
        # A short-lived peak/drop must survive curve compaction in exact DD state.
        state = advance(c, state, index)
    elapsed = time.perf_counter() - began
    assert state["cursor"] == 49999 and state["asOf"] == 3001000
    assert len(state["equityCurve"]) <= MAX_CURVE and state["curveStride"] > 1
    assert len(state["ledger"]) == 0 and not state["fills"]
    validate_state(c, state)
    result = {
        "observations": 50000,
        "elapsedSeconds": round(elapsed, 4),
        "curvePoints": len(state["equityCurve"]),
        "ledgerRows": len(state["ledger"]),
    }
    (tmp_path / "paper-engine-measurements.json").write_text(json.dumps(result))
    print("P06_ENGINE_50000", json.dumps(result))
    assert elapsed < 30, "Defined 30-second pure 50k fixture processing budget exceeded"


def test_drawdown_retains_every_observed_close_not_only_curve_samples():
    c, state = started()
    state = advance(c, order(c, state), 0)
    for index in range(1, 4100):
        price = "200" if index == 3001 else "50" if index == 3002 else "100"
        state = advance(c, state, index, opened=price)
    assert Decimal(state["peakEquity"]) == Decimal("11000")
    assert Decimal(state["maxDrawdown"]) == Decimal("1500")
    assert Decimal(state["maxDrawdownPct"]) == Decimal("13.63636364")
    validate_state(c, state)
