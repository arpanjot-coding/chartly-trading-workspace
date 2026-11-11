"""Canonical derivative contract economics (P08-T07, fixture scope).

Derivatives exist in this codebase only as *modelled economics*: this
module maps venue perpetual-contract metadata into one canonical
record and provides pure validators for leverage, margin mode,
position mode and reduce-only intents. Nothing here submits, signs or
enables an order — venue dispatch stays behind P11 and per-venue
Phase-B certification, and no derivative trading controls are exposed
in the UI until product support is independently verified per venue.

Semantics that must never be blurred:
- **linear** contracts settle PnL in the quote/margin asset and are
  sized in base-asset units; **inverse** contracts are sized in
  contracts (each worth ``contractSize`` quote units) and settle in
  the base asset. The two are never mixed or converted silently.
- Funding is a cashflow observation, kept separate from trading PnL
  exactly like deposits/withdrawals (P08-T06), in whatever asset the
  venue actually paid it — a third-currency funding amount is
  recorded as-is, never converted.
- All economics are exact decimal text; floats are rejected.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from services.connector_adapters import AdapterError

_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")
_ASSET = re.compile(r"[A-Z0-9]{2,12}")
_POSITION_MODES = {"net", "hedge"}
_MARGIN_MODES = {"cross", "isolated"}


def _fail(reason, status=502):
    return AdapterError("derivative." + reason, status)


def _text(value, *, positive=False, signed=False):
    if type(value) is int:
        value = str(value)
    if not isinstance(value, str) or not _DECIMAL_TEXT.fullmatch(value):
        raise _fail("invalid_economics")
    try:
        parsed = Decimal(value)
    except InvalidOperation:
        raise _fail("invalid_economics") from None
    if not parsed.is_finite() or abs(parsed) > Decimal("1e39"):
        raise _fail("invalid_economics")
    if positive and parsed <= 0:
        raise _fail("invalid_economics")
    if not signed and not positive and parsed < 0:
        raise _fail("invalid_economics")
    return value


def _asset(value):
    if not isinstance(value, str) or not _ASSET.fullmatch(value):
        raise _fail("invalid_asset")
    return value


def _leverage(value):
    text = _text(value, positive=True)
    parsed = Decimal(text)
    if parsed != parsed.to_integral_value() or parsed > 500:
        raise _fail("invalid_leverage")
    return int(parsed)


def _contract(
    venue,
    native,
    settlement,
    base,
    quote,
    margin,
    contract_size,
    quantity_unit,
    tick,
    step,
    min_qty,
    max_leverage,
    funding_minutes,
):
    return {
        "venue": venue,
        "nativeSymbol": native,
        "kind": "perp",
        "settlement": settlement,
        "baseAsset": _asset(base),
        "quoteAsset": _asset(quote),
        "marginAsset": _asset(margin),
        "contractSize": _text(contract_size, positive=True),
        "quantityUnit": quantity_unit,
        "tickSize": _text(tick, positive=True),
        "quantityStep": _text(step, positive=True),
        "minQuantity": _text(min_qty, positive=True),
        "maxLeverage": max_leverage,
        "fundingIntervalMinutes": funding_minutes,
        "expiryMs": None,
    }


def _binance_filters(row):
    tick = step = min_qty = None
    for entry in row.get("filters") or []:
        if not isinstance(entry, dict):
            raise _fail("invalid_contract")
        if entry.get("filterType") == "PRICE_FILTER":
            tick = entry.get("tickSize")
        elif entry.get("filterType") == "LOT_SIZE":
            step, min_qty = entry.get("stepSize"), entry.get("minQty")
    if tick is None or step is None or min_qty is None:
        raise _fail("missing_filters")
    return tick, step, min_qty


def map_binance_usdm(row):
    """Binance USDT-M (linear) exchangeInfo symbol -> canonical contract."""
    if not isinstance(row, dict) or row.get("contractType") != "PERPETUAL":
        raise _fail("unsupported_contract_type")
    tick, step, min_qty = _binance_filters(row)
    return _contract(
        "binance",
        row.get("symbol"),
        "linear",
        row.get("baseAsset"),
        row.get("quoteAsset"),
        row.get("marginAsset"),
        "1",
        "base_asset",
        tick,
        step,
        min_qty,
        None,
        480,  # leverage brackets are account-scoped on Binance; funding is 8h venue policy
    ) | {"maxLeverage": None, "maxLeverageSource": "account-brackets"}


def map_binance_coinm(row):
    """Binance COIN-M (inverse) exchangeInfo symbol -> canonical contract."""
    if not isinstance(row, dict) or row.get("contractType") != "PERPETUAL":
        raise _fail("unsupported_contract_type")
    if row.get("marginAsset") != row.get("baseAsset"):
        raise _fail("not_inverse")
    tick, step, min_qty = _binance_filters(row)
    return _contract(
        "binance",
        row.get("symbol"),
        "inverse",
        row.get("baseAsset"),
        row.get("quoteAsset"),
        row.get("marginAsset"),
        row.get("contractSize"),
        "contracts",
        tick,
        step,
        min_qty,
        None,
        480,
    ) | {"maxLeverage": None, "maxLeverageSource": "account-brackets"}


def map_bybit(row, category):
    """Bybit v5 instruments-info row (category linear|inverse) -> canonical."""
    if category not in ("linear", "inverse") or not isinstance(row, dict):
        raise _fail("unsupported_contract_type")
    expected = "LinearPerpetual" if category == "linear" else "InversePerpetual"
    if row.get("contractType") != expected:
        raise _fail("unsupported_contract_type")
    price_filter = row.get("priceFilter") or {}
    lot_filter = row.get("lotSizeFilter") or {}
    leverage_filter = row.get("leverageFilter") or {}
    funding = row.get("fundingInterval")
    if type(funding) is not int or funding <= 0:
        raise _fail("invalid_funding_interval")
    if category == "inverse" and row.get("settleCoin") != row.get("baseCoin"):
        raise _fail("not_inverse")
    return _contract(
        "bybit",
        row.get("symbol"),
        category,
        row.get("baseCoin"),
        row.get("quoteCoin"),
        row.get("settleCoin"),
        "1",
        "base_asset" if category == "linear" else "contracts",
        price_filter.get("tickSize"),
        lot_filter.get("qtyStep"),
        lot_filter.get("minOrderQty"),
        _leverage(leverage_filter.get("maxLeverage")),
        funding,
    )


def map_hyperliquid(row):
    """Hyperliquid meta universe row -> canonical (USDC-margined linear).

    Venue meta carries no price tick (ticks derive from the live book
    under the venue's significant-figures rule), so a row must be
    enriched with an explicit ``tickSize`` by the caller; otherwise it
    is skipped with ``derivative.tick_unavailable_from_meta`` rather
    than mapped with an invented tick.
    """
    if not isinstance(row, dict):
        raise _fail("invalid_contract")
    if row.get("tickSize") is None:
        raise _fail("tick_unavailable_from_meta")
    size_decimals = row.get("szDecimals")
    if type(size_decimals) is not int or not 0 <= size_decimals <= 18:
        raise _fail("invalid_economics")
    step = "1" if size_decimals == 0 else "0." + "0" * (size_decimals - 1) + "1"
    return _contract(
        "hyperliquid",
        row.get("name"),
        "linear",
        row.get("name"),
        "USDC",
        "USDC",
        "1",
        "base_asset",
        row.get("tickSize"),
        step,
        step,
        _leverage(row.get("maxLeverage")),
        60,
    )


MAPPERS = {
    "binance-usdm": map_binance_usdm,
    "binance-coinm": map_binance_coinm,
    "bybit-linear": lambda row: map_bybit(row, "linear"),
    "bybit-inverse": lambda row: map_bybit(row, "inverse"),
    "hyperliquid": map_hyperliquid,
}


def map_many(source, rows, *, symbol_key="symbol"):
    """Map rows, collecting explicit skip reasons instead of failing the set."""
    mapper = MAPPERS.get(source)
    if mapper is None:
        raise _fail("source_unsupported", 400)
    contracts, skipped = [], []
    for row in rows or []:
        try:
            contracts.append(mapper(row))
        except AdapterError as error:
            native = row.get(symbol_key) if isinstance(row, dict) else None
            if native is None and isinstance(row, dict):
                native = row.get("name")
            skipped.append({"nativeSymbol": native, "reason": error.code})
    return contracts, skipped


# ---------------------------------------------------------------------------
# Funding + trading-control validators (pure; no dispatch)
# ---------------------------------------------------------------------------


def funding_observation(venue, symbol, amount, asset, time_ms, rate=None):
    """One funding cashflow in the asset actually paid; never PnL, never converted."""
    if type(time_ms) is not int or time_ms <= 0:
        raise _fail("invalid_funding_time")
    return {
        "kind": "funding",
        "venue": venue,
        "symbol": symbol,
        "amount": _text(amount, signed=True),
        "asset": _asset(asset),
        "timeMs": time_ms,
        "rate": None if rate is None else _text(rate, signed=True),
        "affectsTradingPnl": False,
    }


def check_leverage(contract, leverage):
    if type(leverage) is not int or leverage < 1:
        raise _fail("invalid_leverage", 400)
    maximum = contract.get("maxLeverage") if isinstance(contract, dict) else None
    if maximum is not None and leverage > maximum:
        raise _fail("leverage_exceeds_max", 400)
    return leverage


def check_margin_mode(mode):
    if mode not in _MARGIN_MODES:
        raise _fail("invalid_margin_mode", 400)
    return mode


def check_position_mode(mode):
    if mode not in _POSITION_MODES:
        raise _fail("invalid_position_mode", 400)
    return mode


def position_mode_allows(mode, open_sides, new_side):
    """net (one-way): one side per symbol. hedge: long+short may coexist."""
    check_position_mode(mode)
    if new_side not in ("long", "short") or not set(open_sides) <= {"long", "short"}:
        raise _fail("invalid_position_side", 400)
    if mode == "hedge":
        return True
    return not open_sides or set(open_sides) == {new_side}


def check_reduce_only(side, quantity, position_quantity):
    """A reduce-only intent may shrink a position, never grow or flip it.

    ``position_quantity`` is signed text (long positive). Returns the
    resulting signed quantity text on success.
    """
    qty = Decimal(_text(quantity, positive=True))
    position = Decimal(_text(position_quantity, signed=True))
    if side == "sell":
        if position <= 0 or qty > position:
            raise _fail("reduce_only_exceeds_position", 400)
        result = position - qty
    elif side == "buy":
        if position >= 0 or qty > -position:
            raise _fail("reduce_only_exceeds_position", 400)
        result = position + qty
    else:
        raise _fail("invalid_order_side", 400)
    return format(result, "f")
