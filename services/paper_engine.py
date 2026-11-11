"""Deterministic native-candle paper matching, without transport, storage or clocks.

This is a declared linear notional-collateral model, not a broker simulator.
Only the owning service supplies candles and their known availability. Functions
return detached mutable projections; immutable historical rows may share objects
with their input and are never changed. All financial values are decimal strings.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from copy import deepcopy
from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_EVEN, Decimal, localcontext
from functools import wraps

ENGINE_VERSION = "1"
MAX_ORDERS = 5000
MAX_POSITIONS = 2500
MAX_FILLS = 10000
MAX_LEDGER = 40000
MAX_COMMANDS = 5000
MAX_ACTIVE = 200
MAX_CURVE = 2048
MAX_STATE_BYTES = 12 * 1024 * 1024
MAX_CURSOR = 49999
ID = re.compile(r"^[A-Za-z][A-Za-z0-9_:\-]{0,159}$")
DECIMAL = re.compile(r"^-?(?:0|[1-9][0-9]{0,59})(?:\.[0-9]{1,60})?$")
INTERVALS = {
    "1s",
    "5s",
    "15s",
    "30s",
    "1m",
    "2m",
    "3m",
    "5m",
    "10m",
    "15m",
    "30m",
    "1h",
    "2h",
    "4h",
    "D",
}


class PaperEngineError(ValueError):
    def __init__(self, code, message=None, status=400):
        super().__init__(message or code)
        self.code, self.status = code, status


def _fail(code, message=None, status=400):
    raise PaperEngineError("paper." + code, message, status)


def _validated(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except PaperEngineError:
            raise
        except (
            TypeError,
            ValueError,
            KeyError,
            IndexError,
            ArithmeticError,
            UnicodeError,
        ) as error:
            raise PaperEngineError("paper.invalid_shape") from error

    return wrapped


def _keys(value, required, optional=()):
    if (
        not isinstance(value, dict)
        or set(value) - set(required) - set(optional)
        or not set(required) <= set(value)
    ):
        _fail("invalid_shape")


def _number(value, *, positive=False, nonnegative=False, maximum=Decimal("1e60")):
    if not isinstance(value, str) or len(value) > 125 or not DECIMAL.fullmatch(value):
        _fail("invalid_decimal")
    result = Decimal(value)
    if abs(result) > maximum or positive and result <= 0 or nonnegative and result < 0:
        _fail("invalid_amount")
    return result


def _string(value):
    if not value:
        return "0"
    result = format(value, "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


def _integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        _fail("invalid_integer")
    return value


def _id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        _fail("invalid_id")
    return value


def _time(value):
    if (
        type(value) not in (int, float)
        or not math.isfinite(value)
        or not -62135596800 <= value <= 253402300799
    ):
        _fail("invalid_time")
    if (Decimal(str(value)) * 1000000) % 1:
        _fail("invalid_time")
    return value


def _json(value):
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
        )
    except (ValueError, TypeError, RecursionError, UnicodeError):
        _fail("invalid_json")


def _hash(value):
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


@_validated
def normalize_config(config):
    _keys(
        config,
        (
            "version",
            "instrument",
            "startingCash",
            "moneyScale",
            "costs",
            "policy",
            "seed",
            "startTime",
        ),
    )
    if type(config["version"]) is not int or config["version"] != 1:
        _fail("unsupported_version")
    instrument = config["instrument"]
    _keys(
        instrument,
        (
            "symbol",
            "exchange",
            "interval",
            "currency",
            "quantityUnit",
            "quantityStep",
            "priceTick",
            "multiplier",
            "quantityScale",
            "priceScale",
        ),
    )
    for field in ("symbol", "exchange"):
        if (
            not isinstance(instrument[field], str)
            or not 1 <= len(instrument[field]) <= 120
            or any(ord(c) < 32 or ord(c) == 127 for c in instrument[field])
        ):
            _fail("invalid_instrument")
    if (
        instrument["interval"] not in INTERVALS
        or not isinstance(instrument["currency"], str)
        or not re.fullmatch(r"[A-Z][A-Z0-9]{1,11}", instrument["currency"])
    ):
        _fail("invalid_instrument")
    if instrument["quantityUnit"] not in {"share", "base_asset", "contract", "lot"}:
        _fail("unsupported_units")
    quantity_scale = _integer(instrument["quantityScale"], 0, 18)
    price_scale = _integer(instrument["priceScale"], 0, 18)
    costs = config["costs"]
    _keys(costs, ("spreadTicks", "slippageTicks", "feeBps", "feePerFill"))
    _integer(costs["spreadTicks"], 0, 10000)
    _integer(costs["slippageTicks"], 0, 10000)
    _keys(config["policy"], ("id", "gap"))
    if config["policy"] != {"id": "native-ohlc-conservative-v1", "gap": "next-observed"}:
        _fail("unsupported_policy")
    _integer(config["seed"], 0, 9007199254740991)
    _time(config["startTime"])
    money_scale = _integer(config["moneyScale"], 0, 8)
    with localcontext() as context:
        context.prec = 100
        for field, scale in (("quantityStep", quantity_scale), ("priceTick", price_scale)):
            value = _number(instrument[field], positive=True, maximum=Decimal("1e18"))
            if value.quantize(Decimal(1).scaleb(-scale)) != value:
                _fail("economics_scale")
        multiplier = _number(instrument["multiplier"], positive=True, maximum=Decimal("1e18"))
        if multiplier.normalize().as_tuple().exponent < -18:
            _fail("economics_scale")
        capital = _number(config["startingCash"], positive=True, maximum=Decimal("1e30"))
        if capital.quantize(Decimal(1).scaleb(-money_scale)) != capital:
            _fail("money_scale")
        fee = _number(costs["feePerFill"], nonnegative=True, maximum=Decimal("1e18"))
        if fee.quantize(Decimal(1).scaleb(-money_scale)) != fee:
            _fail("money_scale")
        _number(costs["feeBps"], nonnegative=True, maximum=Decimal(10000))
    result = deepcopy(config)
    for field in ("quantityStep", "priceTick", "multiplier"):
        result["instrument"][field] = _string(Decimal(instrument[field]))
    result["startingCash"] = _string(capital)
    result["costs"]["feePerFill"] = _string(fee)
    result["costs"]["feeBps"] = _string(Decimal(costs["feeBps"]))
    return result


@_validated
def initial_state(config):
    config = normalize_config(config)
    capital = config["startingCash"]
    return {
        "version": 1,
        "engineVersion": ENGINE_VERSION,
        "config": config,
        "status": "ready",
        "cursor": -1,
        "asOf": config["startTime"],
        "cash": capital,
        "equity": capital,
        "collateral": "0",
        "available": capital,
        "realizedGross": "0",
        "fees": "0",
        "unrealized": "0",
        "markPrice": None,
        "lastBar": None,
        "peakEquity": capital,
        "maxDrawdown": "0",
        "maxDrawdownPct": "0",
        "orders": [],
        "positions": [],
        "fills": [],
        "ledger": [],
        "equityCurve": [],
        "curveStride": 1,
        "sequence": 0,
        "commands": {},
    }


def _copy(state):
    result = dict(state)
    result["orders"] = [dict(row) if row["status"] == "pending" else row for row in state["orders"]]
    result["positions"] = [
        {**row, "fillIds": list(row["fillIds"])} if row["status"] == "open" else row
        for row in state["positions"]
    ]
    for field in ("fills", "ledger", "equityCurve"):
        result[field] = list(state[field])
    result["commands"] = dict(state["commands"])
    return result


def _money(config, value, *, cost=False):
    return value.quantize(
        Decimal(1).scaleb(-config["moneyScale"]),
        rounding=ROUND_CEILING if cost else ROUND_HALF_EVEN,
    )


def _step(config, value, field):
    result = _number(value, positive=True, maximum=Decimal("1e18"))
    increment = Decimal(
        config["instrument"]["quantityStep" if field == "quantity" else "priceTick"]
    )
    if result % increment:
        _fail("quantity_step" if field == "quantity" else "price_tick")
    return result


def _event(state, kind, data):
    if len(state["ledger"]) >= MAX_LEDGER:
        _fail("ledger_limit", status=413)
    state["sequence"] += 1
    event = {
        "id": f"event_{state['sequence']}",
        "sequence": state["sequence"],
        "type": kind,
        "asOf": state["asOf"],
        "cursor": state["cursor"],
        "data": deepcopy(data),
    }
    state["ledger"].append(event)
    return event


def _revalue(config, state, mark):
    multiplier = Decimal(config["instrument"]["multiplier"])
    unrealized = Decimal(0)
    collateral = Decimal(0)
    for position in state["positions"]:
        quantity = Decimal(position["quantity"])
        if not quantity:
            continue
        entry = Decimal(position["entryPrice"])
        collateral += quantity * entry * multiplier
        if mark is not None:
            unrealized += (
                quantity * (mark - entry) * multiplier * (1 if position["side"] == "buy" else -1)
            )
    unrealized = _money(config, unrealized)
    cash = Decimal(state["cash"])
    equity = cash + unrealized
    state.update(
        unrealized=_string(unrealized),
        collateral=_string(collateral),
        equity=_string(equity),
        available=_string(max(Decimal(0), min(cash, equity) - collateral)),
        markPrice=_string(mark) if mark is not None else None,
    )


def _position(state, identifier):
    found = next(
        (row for row in state["positions"] if row["id"] == identifier and row["status"] == "open"),
        None,
    )
    if found is None:
        _fail("position_unavailable", status=409)
    return found


def _normalize_command(config, state, command):
    if not isinstance(command, dict):
        _fail("invalid_command")
    kind = command.get("type")
    _id(command.get("id"))
    if kind == "cancel":
        _keys(command, ("id", "type", "orderId"))
        _id(command["orderId"])
        return deepcopy(command)
    if kind == "close":
        _keys(command, ("id", "type", "positionId", "quantity"))
        position = _position(state, _id(command["positionId"]))
        return {
            "id": command["id"],
            "type": "order",
            "side": "sell" if position["side"] == "buy" else "buy",
            "orderType": "market",
            "quantity": _string(_step(config, command["quantity"], "quantity")),
            "positionId": position["id"],
            "reduceOnly": True,
        }
    if kind != "order":
        _fail("unsupported_command")
    _keys(
        command,
        ("id", "type", "side", "orderType", "quantity"),
        ("limitPrice", "stopPrice", "stopLoss", "takeProfit", "positionId", "reduceOnly"),
    )
    if command["side"] not in {"buy", "sell"} or command["orderType"] not in {
        "market",
        "limit",
        "stop",
    }:
        _fail("unsupported_order")
    if "reduceOnly" in command and type(command["reduceOnly"]) is not bool:
        _fail("invalid_reduce_only")
    required_price = {"limit": "limitPrice", "stop": "stopPrice"}.get(command["orderType"])
    if (
        any(field in command for field in ("limitPrice", "stopPrice") if field != required_price)
        or required_price
        and required_price not in command
    ):
        _fail("invalid_order_price")
    if command.get("reduceOnly"):
        if "positionId" not in command or "stopLoss" in command or "takeProfit" in command:
            _fail("invalid_reduce_only")
        position = _position(state, _id(command["positionId"]))
        if position["side"] == command["side"]:
            _fail("invalid_close_side")
    elif "positionId" in command:
        _fail("invalid_reduce_only")
    result = deepcopy(command)
    result["quantity"] = _string(_step(config, command["quantity"], "quantity"))
    for field in ("limitPrice", "stopPrice", "stopLoss", "takeProfit"):
        if field in command:
            result[field] = _string(_step(config, command[field], "price"))
    if "stopLoss" in result and "takeProfit" in result:
        stop, target = Decimal(result["stopLoss"]), Decimal(result["takeProfit"])
        if stop >= target if result["side"] == "buy" else stop <= target:
            _fail("invalid_bracket")
    return result


@_validated
def apply_command(config, state, command):
    with localcontext() as context:
        context.prec = 100
        config = normalize_config(config)
        if state["config"] != config:
            _fail("config_mismatch", status=409)
        fingerprint = _hash(command)
        if isinstance(command, dict) and command.get("id") in state["commands"]:
            if state["commands"][command["id"]] != fingerprint:
                _fail("command_conflict", status=409)
            return _copy(state), []
        if state["status"] not in {"in_progress", "paused"}:
            _fail("inactive_session", status=409)
        normalized = _normalize_command(config, state, command)
        if len(state["commands"]) >= MAX_COMMANDS:
            _fail("command_limit", status=413)
        result = _copy(state)
        old_sequence = result["sequence"]
        if normalized["type"] == "cancel":
            order = next(
                (
                    row
                    for row in result["orders"]
                    if row["id"] == normalized["orderId"] and row["status"] == "pending"
                ),
                None,
            )
            if order is None:
                _fail("order_unavailable", status=409)
            order["status"] = "cancelled"
            order["reason"] = "user_cancelled"
            _event(
                result,
                "order_cancelled",
                {"commandId": normalized["id"], "orderId": order["id"], "reason": "user_cancelled"},
            )
        else:
            if (
                len(result["orders"]) >= MAX_ORDERS
                or sum(row["status"] == "pending" for row in result["orders"]) >= MAX_ACTIVE
            ):
                _fail("order_limit", status=413)
            if normalized.get("reduceOnly"):
                position = _position(result, normalized["positionId"])
                reserved = sum(
                    (
                        Decimal(row["quantity"])
                        for row in result["orders"]
                        if row["status"] == "pending" and row.get("positionId") == position["id"]
                    ),
                    Decimal(0),
                )
                if Decimal(normalized["quantity"]) > Decimal(position["quantity"]) - reserved:
                    _fail("overclose", status=409)
            order = {key: value for key, value in normalized.items() if key != "type"}
            order.update(
                id="order_" + hashlib.sha256(normalized["id"].encode()).hexdigest()[:32],
                commandId=normalized["id"],
                status="pending",
                createdIndex=result["cursor"],
                eligibleIndex=result["cursor"] + 1,
                createdTime=result["asOf"],
            )
            result["orders"].append(order)
            _event(
                result, "order_accepted", {"commandId": normalized["id"], "orderId": order["id"]}
            )
        result["commands"][normalized["id"]] = fingerprint
        return result, result["ledger"][old_sequence:]


def _quote(config, side, base, *, slippage=True):
    tick = Decimal(config["instrument"]["priceTick"])
    offset = tick * Decimal(config["costs"]["spreadTicks"]) / 2
    if slippage:
        offset += tick * config["costs"]["slippageTicks"]
    adjusted = base + offset if side == "buy" else base - offset
    return (adjusted / tick).to_integral_value(
        rounding=ROUND_CEILING if side == "buy" else ROUND_FLOOR
    ) * tick


def _candidate(config, order, bar):
    side, kind = order["side"], order["orderType"]
    opened = Decimal(bar["open"])
    quote = _quote(config, side, opened, slippage=False)
    if kind == "market":
        return _quote(config, side, opened), "open", opened
    field = "limitPrice" if kind == "limit" else "stopPrice"
    level = Decimal(order[field])
    if kind == "limit":
        opened_matches = quote <= level if side == "buy" else quote >= level
        extremum = Decimal(bar["low"] if side == "buy" else bar["high"])
        touched = (
            _quote(config, side, extremum, slippage=False) <= level
            if side == "buy"
            else _quote(config, side, extremum, slippage=False) >= level
        )
        if opened_matches:
            price = _quote(config, side, opened)
            return (min(price, level) if side == "buy" else max(price, level)), "open", opened
        if touched:
            offset = Decimal(config["instrument"]["priceTick"]) * config["costs"]["spreadTicks"] / 2
            return level, "intrabar", level - offset if side == "buy" else level + offset
    else:
        opened_matches = quote >= level if side == "buy" else quote <= level
        extremum = Decimal(bar["high"] if side == "buy" else bar["low"])
        touched = (
            _quote(config, side, extremum, slippage=False) >= level
            if side == "buy"
            else _quote(config, side, extremum, slippage=False) <= level
        )
        if opened_matches:
            return _quote(config, side, opened), "open", opened
        if touched:
            offset = Decimal(config["instrument"]["priceTick"]) * config["costs"]["spreadTicks"] / 2
            base = level - offset if side == "buy" else level + offset
            return _quote(config, side, base), "intrabar", base
    return None


def _reject(state, order, reason):
    order["status"], order["reason"] = "rejected", reason
    _event(state, "order_rejected", {"orderId": order["id"], "reason": reason})


def _fill(config, state, order, bar, candidate, reason=None, assumptions=()):
    price, phase, mark = candidate
    quantity = Decimal(order["quantity"])
    if price <= 0:
        return _reject(state, order, "nonpositive_execution_price")
    if len(state["fills"]) >= MAX_FILLS:
        _fail("fill_limit", status=413)
    multiplier = Decimal(config["instrument"]["multiplier"])
    fee = _money(
        config,
        quantity * price * multiplier * Decimal(config["costs"]["feeBps"]) / 10000
        + Decimal(config["costs"]["feePerFill"]),
        cost=True,
    )
    _revalue(config, state, mark)
    gross = Decimal(0)
    if order.get("reduceOnly"):
        try:
            position = _position(state, order["positionId"])
        except PaperEngineError:
            return _reject(state, order, "position_closed")
        if quantity > Decimal(position["quantity"]):
            return _reject(state, order, "overclose")
        position["quantity"] = _string(Decimal(position["quantity"]) - quantity)
        position["exitQuantity"] = _string(Decimal(position["exitQuantity"]) + quantity)
        position["exitNotional"] = _string(Decimal(position["exitNotional"]) + price * quantity)
        position["exitFees"] = _string(Decimal(position["exitFees"]) + fee)
        settled_gross = _money(
            config,
            (
                Decimal(position["exitNotional"])
                - Decimal(position["entryPrice"]) * Decimal(position["exitQuantity"])
            )
            * multiplier
            * (1 if position["side"] == "buy" else -1),
        )
        gross = settled_gross - Decimal(position["realizedGross"])
        position["realizedGross"] = _string(settled_gross)
        if not Decimal(position["quantity"]):
            position["status"], position["closedTime"] = "closed", bar["availableAt"]
    else:
        if (
            len(state["positions"]) >= MAX_POSITIONS
            or sum(row["status"] == "open" for row in state["positions"]) >= MAX_ACTIVE
        ):
            return _reject(state, order, "position_limit")
        if quantity * price * multiplier + fee > Decimal(state["available"]):
            return _reject(state, order, "insufficient_collateral")
        for field, below in (
            ("stopLoss", order["side"] == "buy"),
            ("takeProfit", order["side"] == "sell"),
        ):
            if field in order and (
                Decimal(order[field]) >= price if below else Decimal(order[field]) <= price
            ):
                return _reject(state, order, "entry_gap_invalidates_bracket")
        position = {
            "id": "position_" + hashlib.sha256(order["id"].encode()).hexdigest()[:32],
            "orderId": order["id"],
            "side": order["side"],
            "status": "open",
            "initialQuantity": order["quantity"],
            "quantity": order["quantity"],
            "entryPrice": _string(price),
            "entryTime": bar["availableAt"],
            "entryFee": _string(fee),
            "exitQuantity": "0",
            "exitNotional": "0",
            "exitFees": "0",
            "realizedGross": "0",
            "fillIds": [],
        }
        for field in ("stopLoss", "takeProfit"):
            if field in order:
                position[field] = order[field]
        state["positions"].append(position)
    sequence = state["sequence"] + 1
    fill = {
        "id": "fill_"
        + hashlib.sha256(f"{order['id']}:{bar['index']}:{sequence}".encode()).hexdigest()[:32],
        "sequence": sequence,
        "orderId": order["id"],
        "positionId": position["id"],
        "kind": "exit" if order.get("reduceOnly") else "entry",
        "side": order["side"],
        "quantity": order["quantity"],
        "price": _string(price),
        "fee": _string(fee),
        "grossPnl": _string(gross),
        "time": bar["availableAt"],
        "barIndex": bar["index"],
        "barTime": bar["time"],
        "phase": phase,
        "reason": reason or order["orderType"],
        "assumptions": list(assumptions)
        + (["ohlc_sequence_unknown"] if phase == "intrabar" else []),
    }
    state["fills"].append(fill)
    position["fillIds"].append(fill["id"])
    order["status"], order["fillId"] = "filled", fill["id"]
    state["fees"] = _string(Decimal(state["fees"]) + fee)
    state["realizedGross"] = _string(Decimal(state["realizedGross"]) + gross)
    state["cash"] = _string(
        Decimal(config["startingCash"]) + Decimal(state["realizedGross"]) - Decimal(state["fees"])
    )
    _event(
        state, "fill", {"fillId": fill["id"], "orderId": order["id"], "positionId": position["id"]}
    )
    if position["status"] == "closed":
        for other in state["orders"]:
            if other["status"] == "pending" and other.get("positionId") == position["id"]:
                other["status"], other["reason"] = "cancelled", "position_closed"
                _event(
                    state, "order_cancelled", {"orderId": other["id"], "reason": "position_closed"}
                )
    _revalue(config, state, mark)
    return fill


def _brackets(config, state, bar, position, *, new_intrabar=False):
    if position["status"] != "open":
        return
    side = "sell" if position["side"] == "buy" else "buy"
    candidates = {}
    for field, kind in (("stopLoss", "stop"), ("takeProfit", "limit")):
        if field in position:
            candidate = _candidate(
                config,
                {
                    "side": side,
                    "orderType": kind,
                    "stopPrice" if kind == "stop" else "limitPrice": position[field],
                },
                bar,
            )
            if candidate:
                candidates[field] = candidate
    chosen = (
        "stopLoss"
        if "stopLoss" in candidates
        else "takeProfit"
        if "takeProfit" in candidates and not new_intrabar
        else None
    )
    if chosen is None:
        return
    candidate = candidates[chosen]
    if new_intrabar and chosen == "stopLoss":
        # The opening price happened before this entry existed. It cannot be
        # reused as a post-entry gap execution; assume a conservative stop touch.
        level = Decimal(position[chosen])
        offset = Decimal(config["instrument"]["priceTick"]) * config["costs"]["spreadTicks"] / 2
        mark = level - offset if side == "buy" else level + offset
        candidate = _quote(config, side, mark), "intrabar", mark
    if len(state["orders"]) >= MAX_ORDERS:
        _fail("order_limit", status=413)
    identifier = f"bracket_{position['id']}_{bar['index']}_{chosen}"
    order = {
        "id": identifier,
        "commandId": identifier,
        "side": side,
        "orderType": "stop" if chosen == "stopLoss" else "limit",
        "quantity": position["quantity"],
        "positionId": position["id"],
        "reduceOnly": True,
        "status": "pending",
        "createdIndex": bar["index"] - 1,
        "eligibleIndex": bar["index"],
        "createdTime": bar["time"],
        "stopPrice" if chosen == "stopLoss" else "limitPrice": position[chosen],
    }
    state["orders"].append(order)
    _event(
        state,
        "order_accepted",
        {"orderId": identifier, "positionId": position["id"], "reason": "protective_bracket"},
    )
    assumptions = []
    if len(candidates) == 2:
        assumptions.append("stop_before_target")
    if new_intrabar:
        assumptions.append("conservative_entry_bar_stop")
    _fill(
        config,
        state,
        order,
        bar,
        candidate,
        "stop-loss" if chosen == "stopLoss" else "take-profit",
        assumptions,
    )


def _bar(bar, state):
    _keys(bar, ("index", "time", "availableAt", "open", "high", "low", "close"), ("gap",))
    if _integer(bar["index"], 0, MAX_CURSOR) != state["cursor"] + 1:
        _fail("nonsequential_bar", status=409)
    opened, available = _time(bar["time"]), _time(bar["availableAt"])
    if opened < state["asOf"] or available <= opened or available <= state["asOf"]:
        _fail("noncausal_bar", status=409)
    prices = {
        field: _number(bar[field], positive=True, maximum=Decimal("1e18"))
        for field in ("open", "high", "low", "close")
    }
    if prices["high"] < max(prices.values()) or prices["low"] > min(prices.values()):
        _fail("invalid_candle")
    if "gap" in bar and len(_json(bar["gap"]).encode("utf-8")) > 1024:
        _fail("gap_metadata_limit", status=413)


def _curve(config, state):
    equity = Decimal(state["equity"])
    peak = max(Decimal(state["peakEquity"]), equity)
    drawdown = peak - equity
    state["peakEquity"] = _string(peak)
    state["maxDrawdown"] = _string(max(Decimal(state["maxDrawdown"]), drawdown))
    percent = (drawdown * 100 / peak).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_EVEN)
    state["maxDrawdownPct"] = _string(max(Decimal(state["maxDrawdownPct"]), percent))
    point = {
        "index": state["cursor"],
        "time": state["asOf"],
        **{
            field: state[field]
            for field in ("cash", "equity", "unrealized", "realizedGross", "fees")
        },
    }
    curve, stride = state["equityCurve"], state["curveStride"]
    if curve and curve[-1]["index"] % stride:
        curve.pop()
    curve.append(point)
    if len(curve) > MAX_CURVE:
        stride *= 2
        state["curveStride"] = stride
        state["equityCurve"] = [row for row in curve if row["index"] % stride == 0 or row is point]


@_validated
def advance_bar(config, state, bar):
    with localcontext() as context:
        context.prec = 100
        config = normalize_config(config)
        if state["config"] != config:
            _fail("config_mismatch", status=409)
        if state["status"] not in {"ready", "in_progress", "paused"}:
            _fail("inactive_session", status=409)
        _bar(bar, state)
        result = _copy(state)
        old_sequence = result["sequence"]
        result["cursor"], result["asOf"] = bar["index"], bar["availableAt"]
        result["lastBar"] = {key: value for key, value in bar.items() if key != "gap"}
        _revalue(config, result, Decimal(bar["open"]))
        if bar.get("gap"):
            _event(
                result,
                "gap",
                {"gap": bar["gap"], "barIndex": bar["index"], "policy": "next-observed"},
            )
        eligible = [
            row
            for row in result["orders"]
            if row["status"] == "pending" and row["eligibleIndex"] <= bar["index"]
        ]
        for order in eligible:
            if order["status"] != "pending":
                continue
            candidate = _candidate(config, order, bar)
            if candidate and candidate[1] == "open":
                _fill(config, result, order, bar, candidate)
        for position in result["positions"]:
            if position["status"] == "open":
                _brackets(config, result, bar, position)
        for order in eligible:
            if order["status"] != "pending":
                continue
            candidate = _candidate(config, order, bar)
            if candidate and candidate[1] == "intrabar":
                fill = _fill(config, result, order, bar, candidate)
                if fill and fill["kind"] == "entry":
                    _brackets(
                        config,
                        result,
                        bar,
                        _position(result, fill["positionId"]),
                        new_intrabar=True,
                    )
        _revalue(config, result, Decimal(bar["close"]))
        _curve(config, result)
        return result, result["ledger"][old_sequence:]


@_validated
def summary(config, state):
    config = normalize_config(config)
    if state["config"] != config:
        _fail("config_mismatch", status=409)
    with localcontext() as context:
        context.prec = 100
        return {
            **{
                field: state[field]
                for field in (
                    "cash",
                    "equity",
                    "collateral",
                    "available",
                    "realizedGross",
                    "fees",
                    "unrealized",
                    "markPrice",
                    "peakEquity",
                    "maxDrawdown",
                    "maxDrawdownPct",
                )
            },
            "netPnl": _string(Decimal(state["realizedGross"]) - Decimal(state["fees"])),
            "totalPnl": _string(Decimal(state["equity"]) - Decimal(config["startingCash"])),
            "pendingOrders": sum(row["status"] == "pending" for row in state["orders"]),
            "openPositions": sum(row["status"] == "open" for row in state["positions"]),
            "closedPositions": sum(row["status"] == "closed" for row in state["positions"]),
            "fillCount": len(state["fills"]),
            "observedBars": state["cursor"] + 1,
            "model": "linear-notional-collateral-v1",
            "curveSampled": state["curveStride"] > 1,
        }


@_validated
def validate_state(config, state):
    """Bound restored data and reconcile its financial projection to confirmed fills.

    Dataset/calendar ownership and this state's durable checksum are verified by
    the owning service/recovery boundary. No restored state starts execution.
    """
    config = normalize_config(config)
    expected = initial_state(config)
    _keys(state, expected)
    if (
        state["version"] != 1
        or type(state["version"]) is not int
        or state["engineVersion"] != ENGINE_VERSION
        or state["config"] != config
    ):
        _fail("invalid_state")
    if state["status"] not in {"ready", "in_progress", "paused", "finished", "abandoned"}:
        _fail("invalid_state")
    if len(_json(state).encode("utf-8")) > MAX_STATE_BYTES:
        _fail("state_limit", status=413)
    _integer(state["cursor"], -1, MAX_CURSOR)
    _time(state["asOf"])
    _integer(state["sequence"], 0, MAX_LEDGER)
    stride = _integer(state["curveStride"], 1, 1 << 16)
    if stride & (stride - 1):
        _fail("invalid_curve")
    for field, maximum in (
        ("orders", MAX_ORDERS),
        ("positions", MAX_POSITIONS),
        ("fills", MAX_FILLS),
        ("ledger", MAX_LEDGER),
        ("equityCurve", MAX_CURVE),
    ):
        if not isinstance(state[field], list) or len(state[field]) > maximum:
            _fail("state_limit", status=413)
    if (
        not isinstance(state["commands"], dict)
        or len(state["commands"]) > MAX_COMMANDS
        or any(
            not ID.fullmatch(key)
            or not isinstance(value, str)
            or not re.fullmatch("[a-f0-9]{64}", value)
            for key, value in state["commands"].items()
        )
    ):
        _fail("invalid_commands")
    with localcontext() as context:
        context.prec = 100
        _validate_financial_state(config, state)
    return deepcopy(state)


def _validate_financial_state(config, state):
    for field in (
        "cash",
        "equity",
        "collateral",
        "available",
        "realizedGross",
        "fees",
        "unrealized",
        "peakEquity",
        "maxDrawdown",
        "maxDrawdownPct",
    ):
        _number(
            state[field],
            nonnegative=field
            in {"collateral", "available", "fees", "peakEquity", "maxDrawdown", "maxDrawdownPct"},
        )
    if state["markPrice"] is not None:
        _number(state["markPrice"], positive=True)
    if state["cursor"] == -1:
        if (
            state["lastBar"] is not None
            or state["markPrice"] is not None
            or state["asOf"] != config["startTime"]
            or state["fills"]
            or state["positions"]
            or state["equityCurve"]
        ):
            _fail("invalid_initial_state")
    else:
        last = state["lastBar"]
        if not isinstance(last, dict):
            _fail("invalid_last_bar")
        prior = {"cursor": state["cursor"] - 1, "asOf": config["startTime"]}
        _bar(last, prior)
        if last["availableAt"] != state["asOf"] or Decimal(last["close"]) != Decimal(
            state["markPrice"]
        ):
            _fail("invalid_last_bar")
    orders, positions, fills = {}, {}, {}
    for row in state["orders"]:
        _keys(
            row,
            (
                "id",
                "commandId",
                "side",
                "orderType",
                "quantity",
                "status",
                "createdIndex",
                "eligibleIndex",
                "createdTime",
            ),
            (
                "limitPrice",
                "stopPrice",
                "stopLoss",
                "takeProfit",
                "positionId",
                "reduceOnly",
                "fillId",
                "reason",
            ),
        )
        if (
            _id(row["id"]) in orders
            or row["status"] not in {"pending", "filled", "cancelled", "rejected"}
            or row["side"] not in {"buy", "sell"}
            or row["orderType"] not in {"market", "limit", "stop"}
        ):
            _fail("invalid_order_state")
        _id(row["commandId"])
        _step(config, row["quantity"], "quantity")
        if (
            _integer(row["createdIndex"], -1, state["cursor"]) + 1 != row["eligibleIndex"]
            or not config["startTime"] <= _time(row["createdTime"]) <= state["asOf"]
        ):
            _fail("invalid_order_state")
        _integer(row["eligibleIndex"], 0, MAX_CURSOR + 1)
        for field in ("limitPrice", "stopPrice", "stopLoss", "takeProfit"):
            if field in row:
                _step(config, row[field], "price")
        if row.get("reduceOnly") is not None and type(row["reduceOnly"]) is not bool:
            _fail("invalid_order_state")
        required_price = {"limit": "limitPrice", "stop": "stopPrice"}.get(row["orderType"])
        if (
            any(field in row for field in ("limitPrice", "stopPrice") if field != required_price)
            or required_price
            and required_price not in row
        ):
            _fail("invalid_order_state")
        if (row["status"] == "filled") != ("fillId" in row):
            _fail("invalid_order_state")
        if "positionId" in row:
            _id(row["positionId"])
        if "fillId" in row:
            _id(row["fillId"])
        if bool(row.get("reduceOnly")) != ("positionId" in row):
            _fail("invalid_order_state")
        orders[row["id"]] = row
    fee, gross = Decimal(0), Decimal(0)
    previous_fill_sequence = 0
    for row in state["fills"]:
        _keys(
            row,
            (
                "id",
                "sequence",
                "orderId",
                "positionId",
                "kind",
                "side",
                "quantity",
                "price",
                "fee",
                "grossPnl",
                "time",
                "barIndex",
                "barTime",
                "phase",
                "reason",
                "assumptions",
            ),
        )
        if (
            _id(row["id"]) in fills
            or row["kind"] not in {"entry", "exit"}
            or row["side"] not in {"buy", "sell"}
            or row["phase"] not in {"open", "intrabar"}
        ):
            _fail("invalid_fill")
        _integer(row["sequence"], 1, state["sequence"])
        if row["sequence"] <= previous_fill_sequence:
            _fail("nonchronological_fills")
        previous_fill_sequence = row["sequence"]
        _id(row["orderId"])
        _id(row["positionId"])
        _integer(row["barIndex"], 0, state["cursor"])
        if _time(row["barTime"]) >= _time(row["time"]) or row["time"] > state["asOf"]:
            _fail("invalid_fill")
        order = orders.get(row["orderId"])
        if (
            not order
            or order["status"] != "filled"
            or order.get("fillId") != row["id"]
            or order["side"] != row["side"]
            or order["quantity"] != row["quantity"]
            or order["eligibleIndex"] > row["barIndex"]
            or row["barTime"] < order["createdTime"]
            or bool(order.get("reduceOnly")) != (row["kind"] == "exit")
            or row["kind"] == "exit"
            and order.get("positionId") != row["positionId"]
        ):
            _fail("invalid_fill_order")
        _step(config, row["quantity"], "quantity")
        price = _step(config, row["price"], "price")
        actual_fee = _number(row["fee"], nonnegative=True)
        expected_fee = _money(
            config,
            price
            * Decimal(row["quantity"])
            * Decimal(config["instrument"]["multiplier"])
            * Decimal(config["costs"]["feeBps"])
            / 10000
            + Decimal(config["costs"]["feePerFill"]),
            cost=True,
        )
        if (
            actual_fee != expected_fee
            or not isinstance(row["assumptions"], list)
            or len(row["assumptions"]) > 10
            or any(
                item
                not in {
                    "ohlc_sequence_unknown",
                    "stop_before_target",
                    "conservative_entry_bar_stop",
                }
                for item in row["assumptions"]
            )
        ):
            _fail("invalid_fill_cost")
        if order["orderType"] == "limit" and (
            price > Decimal(order["limitPrice"])
            if row["side"] == "buy"
            else price < Decimal(order["limitPrice"])
        ):
            _fail("invalid_limit_fill")
        fee += actual_fee
        gross += _number(row["grossPnl"])
        fills[row["id"]] = row
    for row in state["positions"]:
        _keys(
            row,
            (
                "id",
                "orderId",
                "side",
                "status",
                "initialQuantity",
                "quantity",
                "entryPrice",
                "entryTime",
                "entryFee",
                "exitQuantity",
                "exitNotional",
                "exitFees",
                "realizedGross",
                "fillIds",
            ),
            ("stopLoss", "takeProfit", "closedTime"),
        )
        if (
            _id(row["id"]) in positions
            or row["side"] not in {"buy", "sell"}
            or row["status"] not in {"open", "closed"}
        ):
            _fail("invalid_position")
        initial = _step(config, row["initialQuantity"], "quantity")
        quantity = _number(row["quantity"], nonnegative=True)
        if (
            quantity > initial
            or quantity % Decimal(config["instrument"]["quantityStep"])
            or (row["status"] == "closed") != (quantity == 0)
        ):
            _fail("invalid_position_quantity")
        entry = _step(config, row["entryPrice"], "price")
        _time(row["entryTime"])
        for field in ("stopLoss", "takeProfit"):
            if field in row:
                _step(config, row[field], "price")
        if (
            not isinstance(row["fillIds"], list)
            or any(not isinstance(identifier, str) for identifier in row["fillIds"])
            or len(row["fillIds"]) != len(set(row["fillIds"]))
        ):
            _fail("invalid_position_fills")
        linked = [fills.get(identifier) for identifier in row["fillIds"]]
        if any(fill is None or fill["positionId"] != row["id"] for fill in linked):
            _fail("invalid_position_fills")
        if [fill["sequence"] for fill in linked] != sorted(fill["sequence"] for fill in linked):
            _fail("nonchronological_fills")
        entries, exits = (
            [fill for fill in linked if fill["kind"] == "entry"],
            [fill for fill in linked if fill["kind"] == "exit"],
        )
        if (
            len(entries) != 1
            or entries[0]["orderId"] != row["orderId"]
            or Decimal(entries[0]["quantity"]) != initial
            or Decimal(entries[0]["price"]) != entry
            or entries[0]["side"] != row["side"]
            or Decimal(entries[0]["grossPnl"]) != 0
            or entries[0]["time"] != row["entryTime"]
            or Decimal(entries[0]["fee"]) != _number(row["entryFee"], nonnegative=True)
        ):
            _fail("invalid_position_entry")
        exit_quantity = sum((Decimal(fill["quantity"]) for fill in exits), Decimal(0))
        if (
            exit_quantity != initial - quantity
            or exit_quantity != _number(row["exitQuantity"], nonnegative=True)
            or sum(
                (Decimal(fill["quantity"]) * Decimal(fill["price"]) for fill in exits), Decimal(0)
            )
            != _number(row["exitNotional"], nonnegative=True)
            or sum((Decimal(fill["fee"]) for fill in exits), Decimal(0))
            != _number(row["exitFees"], nonnegative=True)
        ):
            _fail("invalid_position_exit")
        exit_gross, raw_exit_gross = Decimal(0), Decimal(0)
        for fill in exits:
            raw_exit_gross += (
                Decimal(fill["quantity"])
                * (Decimal(fill["price"]) - entry)
                * Decimal(config["instrument"]["multiplier"])
                * (1 if row["side"] == "buy" else -1)
            )
            expected_gross = _money(config, raw_exit_gross) - exit_gross
            if (
                fill["side"] == row["side"]
                or Decimal(fill["grossPnl"]) != expected_gross
                or fill["time"] < row["entryTime"]
            ):
                _fail("invalid_position_pnl")
            exit_gross += expected_gross
        if exit_gross != _number(row["realizedGross"]):
            _fail("invalid_position_pnl")
        if row["status"] == "closed" and (not exits or row.get("closedTime") != exits[-1]["time"]):
            _fail("invalid_position_close")
        positions[row["id"]] = row
    if any(
        fill["positionId"] not in positions
        or fill["id"] not in positions[fill["positionId"]]["fillIds"]
        for fill in fills.values()
    ):
        _fail("unlinked_fill")
    if (
        sum(row["status"] == "pending" for row in orders.values()) > MAX_ACTIVE
        or sum(row["status"] == "open" for row in positions.values()) > MAX_ACTIVE
    ):
        _fail("active_limit", status=413)
    for row in orders.values():
        if row["status"] == "filled" and row["fillId"] not in fills:
            _fail("unlinked_order_fill")
        if row["status"] == "pending" and row.get("reduceOnly"):
            position = positions.get(row["positionId"])
            if position is None or position["status"] != "open" or row["side"] == position["side"]:
                _fail("invalid_pending_close")
    for position in positions.values():
        pending = sum(
            (
                Decimal(order["quantity"])
                for order in orders.values()
                if order["status"] == "pending" and order.get("positionId") == position["id"]
            ),
            Decimal(0),
        )
        if pending > Decimal(position["quantity"]):
            _fail("invalid_pending_close")
    if (
        fee != Decimal(state["fees"])
        or gross != Decimal(state["realizedGross"])
        or Decimal(config["startingCash"]) + gross - fee != Decimal(state["cash"])
    ):
        _fail("accounting_mismatch")
    projected = dict(state)
    _revalue(
        config, projected, Decimal(state["markPrice"]) if state["markPrice"] is not None else None
    )
    if any(
        projected[field] != state[field]
        for field in ("equity", "unrealized", "available", "collateral")
    ):
        _fail("accounting_mismatch")
    if len(state["ledger"]) != state["sequence"]:
        _fail("invalid_ledger")
    previous_cursor, previous_time = -1, config["startTime"]
    accepted, terminal, ledger_commands = {}, {}, set()
    for index, event in enumerate(state["ledger"], 1):
        _keys(event, ("id", "sequence", "type", "asOf", "cursor", "data"))
        if (
            event["sequence"] != index
            or event["id"] != f"event_{index}"
            or event["type"]
            not in {"order_accepted", "order_cancelled", "order_rejected", "fill", "gap"}
            or not isinstance(event["data"], dict)
            or len(_json(event["data"])) > 2048
        ):
            _fail("invalid_ledger")
        _integer(event["sequence"], index, index)
        _integer(event["cursor"], -1, state["cursor"])
        if (
            _time(event["asOf"]) > state["asOf"]
            or event["asOf"] < previous_time
            or event["cursor"] < previous_cursor
        ):
            _fail("invalid_ledger")
        previous_cursor, previous_time = event["cursor"], event["asOf"]
        if event["type"] == "fill":
            fill = fills.get(event["data"].get("fillId"))
            if fill is None or fill["sequence"] != index:
                _fail("invalid_ledger_fill")
        if event["type"].startswith("order_"):
            order_id = event["data"].get("orderId")
            order = orders.get(order_id)
            if order is None:
                _fail("invalid_ledger_order")
            if event["type"] == "order_accepted":
                if order_id in accepted or event["asOf"] < order["createdTime"]:
                    _fail("invalid_ledger_order")
                accepted[order_id] = index
                if event["data"].get("reason") == "protective_bracket":
                    if event["data"].get("positionId") != order.get(
                        "positionId"
                    ) or not order_id.startswith("bracket_"):
                        _fail("invalid_ledger_order")
                    if event["cursor"] != order["eligibleIndex"]:
                        _fail("invalid_ledger_order")
                elif (
                    event["data"].get("commandId") != order["commandId"]
                    or order["commandId"] not in state["commands"]
                ):
                    _fail("invalid_ledger_command")
                else:
                    ledger_commands.add(order["commandId"])
                    if event["cursor"] != order["createdIndex"]:
                        _fail("invalid_ledger_order")
            else:
                final_status = "cancelled" if event["type"] == "order_cancelled" else "rejected"
                if (
                    order_id in terminal
                    or order["status"] != final_status
                    or order.get("reason") != event["data"].get("reason")
                ):
                    _fail("invalid_ledger_order")
                terminal[order_id] = index
                if "commandId" in event["data"]:
                    command_id = event["data"]["commandId"]
                    if command_id not in state["commands"]:
                        _fail("invalid_ledger_command")
                    ledger_commands.add(command_id)
        elif event["type"] == "gap":
            if (
                event["cursor"] < 0
                or event["data"].get("barIndex") != event["cursor"]
                or event["data"].get("policy") != "next-observed"
            ):
                _fail("invalid_gap_ledger")
    if set(accepted) != set(orders) or ledger_commands != set(state["commands"]):
        _fail("unlinked_ledger_order")
    for order_id, order in orders.items():
        if (order["status"] in {"cancelled", "rejected"}) != (order_id in terminal):
            _fail("unlinked_ledger_order")
        if (
            order_id in terminal
            and terminal[order_id] <= accepted[order_id]
            or order["status"] == "filled"
            and fills[order["fillId"]]["sequence"] <= accepted[order_id]
        ):
            _fail("noncausal_order_ledger")
    if any(
        state["ledger"][fill["sequence"] - 1]["type"] != "fill"
        or state["ledger"][fill["sequence"] - 1]["data"].get("fillId") != fill["id"]
        for fill in fills.values()
    ):
        _fail("invalid_ledger_fill")
    previous = -1
    for row in state["equityCurve"]:
        _keys(row, ("index", "time", "cash", "equity", "unrealized", "realizedGross", "fees"))
        if not previous < _integer(row["index"], 0, state["cursor"]):
            _fail("invalid_curve")
        previous = row["index"]
        if _time(row["time"]) > state["asOf"] or _number(row["cash"]) + _number(
            row["unrealized"]
        ) != _number(row["equity"]):
            _fail("invalid_curve")
        _number(row["realizedGross"])
        _number(row["fees"], nonnegative=True)
    if state["cursor"] >= 0 and (
        not state["equityCurve"]
        or state["equityCurve"][-1]["index"] != state["cursor"]
        or state["equityCurve"][-1]["time"] != state["asOf"]
        or any(
            state["equityCurve"][-1][field] != state[field]
            for field in ("cash", "equity", "unrealized", "realizedGross", "fees")
        )
    ):
        _fail("invalid_curve")
    if Decimal(state["peakEquity"]) < max(
        Decimal(config["startingCash"]),
        Decimal(state["equity"]),
        *(Decimal(row["equity"]) for row in state["equityCurve"]),
    ) or Decimal(state["maxDrawdown"]) < Decimal(state["peakEquity"]) - Decimal(state["equity"]):
        _fail("invalid_drawdown")
