"""P08-T03: AssetPairs -> canonical Instrument/Listing + pure order validator.

Fixtures are shaped from Kraken's official AssetPairs documentation.
No network is used.
"""

import pytest

from services.connector_adapters import AdapterError
from services.domain.validation import validate_record, validate_records
from services.kraken_instruments import (
    build_spelling_index,
    decode_asset_pairs,
    fetch_instrument_mapping,
    validate_order_intent,
)

OWNER = {
    "owner_id": "owner-kraken-test",
    "workspace_id": "workspace-kraken-test",
    "observed_at": "2026-11-04T12:00:00Z",
}


def _xbtusd(**changes):
    entry = {
        "altname": "XBTUSD",
        "wsname": "XBT/USD",
        "aclass_base": "currency",
        "base": "XXBT",
        "aclass_quote": "currency",
        "quote": "ZUSD",
        "status": "online",
        "lot_decimals": 8,
        "pair_decimals": 1,
        "cost_decimals": 5,
        "lot_multiplier": 1,
        "ordermin": "0.00005",
        "costmin": "0.5",
        "tick_size": "0.1",
        "fees": [],
        "fees_maker": [],
        "leverage_buy": [2, 3],
    }
    entry.update(changes)
    return entry


def test_maps_online_pair_to_valid_canonical_records():
    mapped = decode_asset_pairs({"XXBTZUSD": _xbtusd()}, **OWNER)
    assert mapped["skipped"] == []
    [row] = mapped["instruments"]
    instrument = row["instrument"]["value"]
    listing = row["listing"]["value"]
    assert validate_record("Instrument", instrument) == []
    assert validate_record("Listing", listing) == []
    # Collection validation additionally requires the referenced owner and
    # workspace records, which the persistence layer supplies; the mapper
    # must contribute no other issue.
    collection_issues = validate_records([row["instrument"], row["listing"]])
    assert {issue["code"] for issue in collection_issues} == {"reference.missing"}
    assert instrument["baseCurrency"] == "BTC"  # XBT canonicalises to BTC
    assert instrument["quoteCurrency"] == "USD"
    assert instrument["quantityUnit"] == "base_asset"
    assert instrument["quantityStep"] == "0.00000001"
    assert instrument["quantityScale"] == 8
    assert instrument["priceTick"] == "0.1"
    assert instrument["priceScale"] == 1
    assert listing["symbol"] == "XBTUSD"
    assert listing["venue"] == "kraken"
    assert row["economics"]["orderminBase"] == "0.00005"
    assert row["economics"]["costminQuote"] == "0.5"
    assert row["economics"]["baseAssetNative"] == "XXBT"


def test_microsecond_observed_at_is_normalised_to_canonical_milliseconds():
    mapped = decode_asset_pairs(
        {"XXBTZUSD": _xbtusd()},
        owner_id="owner-kraken-test",
        workspace_id="workspace-kraken-test",
        observed_at="2026-11-04T12:00:00.123456Z",
    )
    assert mapped["skipped"] == []
    instrument = mapped["instruments"][0]["instrument"]["value"]
    assert instrument["createdAt"] == "2026-11-04T12:00:00.123Z"
    assert validate_record("Instrument", instrument) == []


def test_every_spelling_resolves_to_the_same_instrument():
    mapped = decode_asset_pairs({"XXBTZUSD": _xbtusd()}, **OWNER)
    index = build_spelling_index(mapped["instruments"])
    expected = mapped["instruments"][0]["instrument"]["value"]["id"]
    for spelling in ("XXBTZUSD", "XBTUSD", "XBT/USD", "BTC/USD"):
        assert index[spelling] == expected


def test_skips_dark_pool_offline_and_unmappable_pairs_with_reasons():
    mapped = decode_asset_pairs(
        {
            "XXBTZUSD.d": _xbtusd(altname="XBTUSD.d"),
            "PAUSED": _xbtusd(altname="PAUSEDUSD", wsname="PAUSED/USD", status="cancel_only"),
            "BROKEN": _xbtusd(altname="BROKENUSD", wsname="not-a-pair"),
            "PRECISE": _xbtusd(altname="PRECISEUSD", wsname="PRECISE/USD", lot_decimals=19),
        },
        **OWNER,
    )
    assert mapped["instruments"] == []
    reasons = {row["nativePair"]: row["reason"] for row in mapped["skipped"]}
    assert reasons["XXBTZUSD.d"] == "kraken.instrument_dark_pool"
    assert reasons["PAUSED"] == "kraken.instrument_pair_not_online"
    assert reasons["BROKEN"] == "kraken.instrument_identity_unmappable"
    assert reasons["PRECISE"] == "kraken.instrument_precision_unsupported"


def test_float_economics_are_rejected_never_coerced():
    mapped = decode_asset_pairs({"XXBTZUSD": _xbtusd(tick_size=0.1)}, **OWNER)
    assert mapped["instruments"] == []
    assert mapped["skipped"][0]["reason"] == "kraken.instrument_invalid_economics"


def test_fetch_mapping_uses_bounded_public_reader():
    calls = []

    def fake_fetcher(endpoint, params):
        calls.append((endpoint, params))
        return {"XXBTZUSD": _xbtusd()}

    mapped = fetch_instrument_mapping(**OWNER, fetcher=fake_fetcher)
    assert calls == [("AssetPairs", {})]
    assert len(mapped["instruments"]) == 1


def test_oversized_pair_directory_fails_closed():
    with pytest.raises(AdapterError):
        decode_asset_pairs({f"P{i}": _xbtusd() for i in range(2001)}, **OWNER)


def _mapped_parts():
    mapped = decode_asset_pairs({"XXBTZUSD": _xbtusd()}, **OWNER)
    row = mapped["instruments"][0]
    return row["instrument"]["value"], row["economics"]


def test_validator_accepts_a_filter_clean_intent():
    instrument, economics = _mapped_parts()
    assert (
        validate_order_intent(
            instrument, economics, side="buy", quantity="0.00500000", price="60123.4"
        )
        == []
    )
    assert validate_order_intent(instrument, economics, side="sell", quantity="0.00005") == []


def test_validator_rejects_each_venue_filter():
    instrument, economics = _mapped_parts()
    cases = {
        "kraken.invalid_side": dict(side="hold", quantity="1"),
        "kraken.quantity_positive": dict(side="buy", quantity="0"),
        "kraken.quantity_precision": dict(side="buy", quantity="0.000000001"),
        "kraken.below_ordermin": dict(side="buy", quantity="0.00004"),
        "kraken.price_precision": dict(side="buy", quantity="1", price="100.15"),
        "kraken.below_costmin": dict(side="buy", quantity="0.00005", price="10.0"),
    }
    for code, intent in cases.items():
        errors = validate_order_intent(instrument, economics, **intent)
        assert code in errors, (code, errors)


def test_validator_quantity_step_honours_lot_multiplier():
    mapped = decode_asset_pairs(
        {"XXBTZUSD": _xbtusd(lot_multiplier=10, ordermin="0.0000001")}, **OWNER
    )
    row = mapped["instruments"][0]
    instrument, economics = row["instrument"]["value"], row["economics"]
    assert instrument["quantityStep"] == "0.0000001"
    assert validate_order_intent(instrument, economics, side="buy", quantity="0.0000002") == []
    assert "kraken.quantity_step" in validate_order_intent(
        instrument, economics, side="buy", quantity="0.00000015"
    )


def test_validator_price_tick_uses_effective_scale():
    # pair_decimals 1 but a finer tick must widen the effective price scale.
    mapped = decode_asset_pairs({"XXBTZUSD": _xbtusd(tick_size="0.05")}, **OWNER)
    row = mapped["instruments"][0]
    instrument, economics = row["instrument"]["value"], row["economics"]
    assert instrument["priceScale"] == 2
    assert (
        validate_order_intent(
            instrument, economics, side="buy", quantity="1", price="100.15"
        )
        == []
    )
    assert "kraken.price_tick" in validate_order_intent(
        instrument, economics, side="buy", quantity="1", price="100.12"
    )
