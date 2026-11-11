"""Kraken spot AssetPairs -> canonical P01 Instrument/Listing mapping (P08-T03).

Pure mapping plus a pure pre-trade validator. Nothing here submits an
order: the validator only answers "would these numbers satisfy the venue
filters" so P11 can reuse it before any future dispatch. All economics
stay exact decimal strings; a pair whose mapping cannot be represented
canonically is skipped with an explicit reason, never rounded into shape.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from services.connector_adapters import AdapterError
from services.connector_adapters import instant as _adapter_instant
from services.domain.validation import decimal_units, validate_record

VENUE = "kraken"
MAX_PAIRS = 2000
# Kraken spells bitcoin XBT in REST/wsname and BTC in WebSocket v2. BTC is
# the canonical code; XBT is preserved as an alias so either spelling (and
# either provider surface) resolves to the same instrument.
CANONICAL_ASSET_CODES = {"XBT": "BTC"}
_WSNAME = re.compile(r"([A-Z][A-Z0-9]{0,11})/([A-Z][A-Z0-9]{2,11})")
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")
_ID_SAFE = re.compile(r"[^a-z0-9_-]+")


def _fail(reason):
    return AdapterError("kraken.instrument_" + reason)


def _as_text(value):
    """Exact text for a provider scalar; floats are rejected, never coerced."""
    if isinstance(value, str):
        return value
    if type(value) is int:
        return str(value)
    raise _fail("invalid_economics")


def _decimal_text(value, *, positive=False):
    text = _as_text(value)
    if not _DECIMAL_TEXT.fullmatch(text):
        raise _fail("invalid_economics")
    try:
        parsed = Decimal(text)
    except InvalidOperation:
        raise _fail("invalid_economics") from None
    if not parsed.is_finite() or abs(parsed) > Decimal("1e39"):
        raise _fail("invalid_economics")
    if positive and parsed <= 0:
        raise _fail("invalid_economics")
    return text


def _scale(value):
    text = _as_text(value)
    if not re.fullmatch(r"\d{1,2}", text):
        raise _fail("invalid_economics")
    scale = int(text)
    if scale > 18:
        raise _fail("precision_unsupported")
    return scale


def _fraction_digits(text):
    return len(text.partition(".")[2].rstrip("0")) if "." in text else 0


def _step_text(scale, multiplier_text="1"):
    unit = "1" if scale == 0 else "0." + "0" * (scale - 1) + "1"
    stepped = Decimal(multiplier_text) * Decimal(unit)
    return format(stepped.normalize(), "f")


def _record_id(*parts):
    slug = _ID_SAFE.sub("-", "-".join(parts).lower()).strip("-")
    if not re.fullmatch(r"[a-z][a-z0-9_-]{7,127}", slug):
        raise _fail("identity_unmappable")
    return slug


def canonical_asset_code(code):
    return CANONICAL_ASSET_CODES.get(code, code)


def _canonical_instant(value):
    """Canonical P01 instants carry at most millisecond precision."""
    try:
        stamp = _adapter_instant(value)
    except AdapterError:
        raise _fail("invalid_observed_at") from None
    return stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def decode_asset_pairs(result, *, owner_id, workspace_id, observed_at):
    """Map an AssetPairs `result` object into canonical records + economics.

    Returns {"instruments": [...], "skipped": [...]}. Every emitted record
    passes P01 validate_record; anything else is skipped with a reason.
    Minimum order/cost values are venue filters with no canonical
    Instrument field, so they travel in the per-pair `economics` dict.
    """
    if not isinstance(result, dict) or len(result) > MAX_PAIRS:
        raise _fail("invalid_response")
    observed_at = _canonical_instant(observed_at)
    instruments = []
    skipped = []
    seen_instruments = set()
    for native_pair, entry in result.items():
        try:
            mapped = _map_pair(
                native_pair,
                entry,
                owner_id=owner_id,
                workspace_id=workspace_id,
                observed_at=observed_at,
            )
        except AdapterError as error:
            skipped.append({"nativePair": str(native_pair)[:80], "reason": error.code})
            continue
        if mapped is None:
            continue
        instrument_id = mapped["instrument"]["value"]["id"]
        if instrument_id in seen_instruments:
            skipped.append(
                {"nativePair": str(native_pair)[:80], "reason": "kraken.duplicate_instrument"}
            )
            continue
        seen_instruments.add(instrument_id)
        instruments.append(mapped)
    return {"instruments": instruments, "skipped": skipped}


def _map_pair(native_pair, entry, *, owner_id, workspace_id, observed_at):
    if not isinstance(native_pair, str) or not isinstance(entry, dict):
        raise _fail("invalid_response")
    altname = entry.get("altname")
    wsname = entry.get("wsname")
    if not isinstance(altname, str) or not isinstance(wsname, str):
        raise _fail("identity_unmappable")
    if altname.endswith(".d"):
        raise _fail("dark_pool")
    if entry.get("aclass_base") not in (None, "currency"):
        raise _fail("asset_class_unsupported")
    match = _WSNAME.fullmatch(wsname)
    if not match:
        raise _fail("identity_unmappable")
    status = entry.get("status", "online")
    if status != "online":
        raise _fail("pair_not_online")
    base_native, quote_native = match.groups()
    base = canonical_asset_code(base_native)
    quote = canonical_asset_code(quote_native)
    lot_decimals = _scale(entry.get("lot_decimals"))
    pair_decimals = _scale(entry.get("pair_decimals"))
    cost_decimals = _scale(entry.get("cost_decimals"))
    tick = _decimal_text(entry.get("tick_size"), positive=True)
    price_scale = max(pair_decimals, _fraction_digits(tick))
    if price_scale > 18:
        raise _fail("precision_unsupported")
    ordermin = _decimal_text(entry.get("ordermin"), positive=True)
    costmin = _decimal_text(entry.get("costmin"), positive=True)
    multiplier = _decimal_text(entry.get("lot_multiplier", "1"), positive=True)
    instrument_id = _record_id("instrument", VENUE, base, quote)
    base_record = {
        "schemaVersion": 1,
        "ownerId": owner_id,
        "workspaceId": workspace_id,
        "revision": 1,
        "createdAt": observed_at,
        "updatedAt": observed_at,
    }
    aliases = [
        {"namespace": "kraken-native-pair", "key": native_pair},
        {"namespace": "kraken-altname", "key": altname},
        {"namespace": "kraken-wsname", "key": wsname},
        {"namespace": "kraken-ws-v2", "key": f"{base}/{quote}"},
    ]
    instrument = {
        **base_record,
        "id": instrument_id,
        "aliases": aliases,
        "assetClass": "spot",
        "name": f"{base}/{quote}",
        "baseCurrency": base,
        "quoteCurrency": quote,
        "quantityUnit": "base_asset",
        "quantityStep": _step_text(lot_decimals, multiplier),
        "quantityScale": lot_decimals,
        "priceTick": tick,
        "priceScale": price_scale,
        "multiplier": multiplier,
        "calendarId": "continuous-utc",
    }
    listing = {
        **base_record,
        "id": _record_id("listing", VENUE, altname),
        "instrumentId": instrument_id,
        "venue": VENUE,
        "symbol": altname,
        "currency": quote,
        "validFrom": observed_at,
    }
    for type_name, record in (("Instrument", instrument), ("Listing", listing)):
        issues = validate_record(type_name, record)
        if issues:
            raise _fail("canonical_invalid:" + ",".join(sorted({row["code"] for row in issues})))
    return {
        "instrument": {"type": "Instrument", "value": instrument},
        "listing": {"type": "Listing", "value": listing},
        "economics": {
            "nativePair": native_pair,
            "altname": altname,
            "wsname": wsname,
            "wsV2Symbol": f"{base}/{quote}",
            "baseAssetNative": entry.get("base"),
            "quoteAssetNative": entry.get("quote"),
            "orderminBase": ordermin,
            "costminQuote": costmin,
            "costDecimals": cost_decimals,
            "status": status,
        },
        "spellings": [native_pair, altname, wsname, f"{base}/{quote}"],
    }


def build_spelling_index(mapped):
    """Every provider spelling of a pair -> canonical instrument id."""
    index = {}
    for row in mapped:
        for spelling in row["spellings"]:
            index[spelling] = row["instrument"]["value"]["id"]
    return index


def validate_order_intent(instrument, economics, *, side, quantity, price=None):
    """Pure venue-filter check. Returns a list of stable error codes.

    Empty list means the numbers satisfy quantity step/minimum and, when a
    price is supplied, tick and minimum-cost filters. This never submits
    anything; execution remains P11's responsibility.
    """
    errors = []
    if side not in {"buy", "sell"}:
        errors.append("kraken.invalid_side")
    quantity_text = quantity if isinstance(quantity, str) else None
    quantity_units = (
        decimal_units(quantity_text, instrument["quantityScale"]) if quantity_text else None
    )
    step_units = decimal_units(instrument["quantityStep"], instrument["quantityScale"])
    if quantity_units is None or step_units is None:
        errors.append("kraken.quantity_precision")
    elif quantity_units <= 0:
        errors.append("kraken.quantity_positive")
    elif quantity_units % step_units != 0:
        errors.append("kraken.quantity_step")
    if quantity_units is not None and quantity_units > 0:
        minimum = decimal_units(economics["orderminBase"], instrument["quantityScale"])
        if minimum is None or quantity_units < minimum:
            errors.append("kraken.below_ordermin")
    if price is not None:
        price_text = price if isinstance(price, str) else None
        price_units = decimal_units(price_text, instrument["priceScale"]) if price_text else None
        tick_units = decimal_units(instrument["priceTick"], instrument["priceScale"])
        if price_units is None or tick_units is None:
            errors.append("kraken.price_precision")
        elif price_units <= 0:
            errors.append("kraken.price_positive")
        elif price_units % tick_units != 0:
            errors.append("kraken.price_tick")
        if (
            price_units is not None
            and price_units > 0
            and quantity_units is not None
            and quantity_units > 0
        ):
            cost = (Decimal(quantity_text) * Decimal(price_text)).normalize()
            if cost < Decimal(economics["costminQuote"]):
                errors.append("kraken.below_costmin")
    return errors


def fetch_instrument_mapping(*, owner_id, workspace_id, observed_at, fetcher=None):
    """Fetch AssetPairs through the bounded public reader and map them."""
    if fetcher is None:
        from services.kraken_market import fetch_public

        fetcher = fetch_public
    result = fetcher("AssetPairs", {})
    if not isinstance(result, dict):
        raise _fail("invalid_response")
    return decode_asset_pairs(
        result, owner_id=owner_id, workspace_id=workspace_id, observed_at=observed_at
    )
