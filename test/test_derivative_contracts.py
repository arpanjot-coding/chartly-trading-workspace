"""P08-T07 fixture-scope tests: canonical derivative contract mapping.

Payloads mirror each venue's documented public instrument shapes.
No network. Fulfils the required scenarios at fixture scope:
linear vs inverse economics kept distinct, funding in a third
currency recorded unconverted, leverage bound refusal, reduce-only
and hedge/net position-mode rules.
"""

import pytest

from services.connector_adapters import AdapterError
from services.derivative_contracts import (
    check_leverage,
    check_margin_mode,
    check_reduce_only,
    funding_observation,
    map_binance_coinm,
    map_binance_usdm,
    map_bybit,
    map_hyperliquid,
    map_many,
    position_mode_allows,
)

BINANCE_USDM_BTC = {
    "symbol": "BTCUSDT",
    "contractType": "PERPETUAL",
    "baseAsset": "BTC",
    "quoteAsset": "USDT",
    "marginAsset": "USDT",
    "filters": [
        {"filterType": "PRICE_FILTER", "tickSize": "0.10"},
        {"filterType": "LOT_SIZE", "minQty": "0.001", "stepSize": "0.001"},
    ],
}

BINANCE_COINM_BTC = {
    "symbol": "BTCUSD_PERP",
    "contractType": "PERPETUAL",
    "baseAsset": "BTC",
    "quoteAsset": "USD",
    "marginAsset": "BTC",
    "contractSize": "100",
    "filters": [
        {"filterType": "PRICE_FILTER", "tickSize": "0.10"},
        {"filterType": "LOT_SIZE", "minQty": "1", "stepSize": "1"},
    ],
}

BYBIT_LINEAR_BTC = {
    "symbol": "BTCUSDT",
    "contractType": "LinearPerpetual",
    "baseCoin": "BTC",
    "quoteCoin": "USDT",
    "settleCoin": "USDT",
    "fundingInterval": 480,
    "priceFilter": {"tickSize": "0.50"},
    "lotSizeFilter": {"minOrderQty": "0.001", "qtyStep": "0.001"},
    "leverageFilter": {"minLeverage": "1", "maxLeverage": "125.00"},
}

BYBIT_INVERSE_BTC = {
    "symbol": "BTCUSD",
    "contractType": "InversePerpetual",
    "baseCoin": "BTC",
    "quoteCoin": "USD",
    "settleCoin": "BTC",
    "fundingInterval": 480,
    "priceFilter": {"tickSize": "0.50"},
    "lotSizeFilter": {"minOrderQty": "1", "qtyStep": "1"},
    "leverageFilter": {"minLeverage": "1", "maxLeverage": "125.00"},
}

HL_BTC = {"name": "BTC", "szDecimals": 5, "maxLeverage": 50}


def test_binance_linear_and_inverse_stay_distinct():
    linear = map_binance_usdm(BINANCE_USDM_BTC)
    assert linear["settlement"] == "linear" and linear["quantityUnit"] == "base_asset"
    assert linear["marginAsset"] == "USDT" and linear["tickSize"] == "0.10"
    assert linear["maxLeverage"] is None and linear["maxLeverageSource"] == "account-brackets"

    inverse = map_binance_coinm(BINANCE_COINM_BTC)
    assert inverse["settlement"] == "inverse" and inverse["quantityUnit"] == "contracts"
    assert inverse["contractSize"] == "100" and inverse["marginAsset"] == "BTC"
    assert inverse["quoteAsset"] == "USD"


def test_binance_wrong_shapes_fail_closed():
    with pytest.raises(AdapterError) as exc:
        map_binance_usdm({**BINANCE_USDM_BTC, "contractType": "CURRENT_QUARTER"})
    assert exc.value.code == "derivative.unsupported_contract_type"
    with pytest.raises(AdapterError) as exc:
        map_binance_coinm({**BINANCE_COINM_BTC, "marginAsset": "USDT"})
    assert exc.value.code == "derivative.not_inverse"
    with pytest.raises(AdapterError) as exc:
        map_binance_usdm({**BINANCE_USDM_BTC, "filters": []})
    assert exc.value.code == "derivative.missing_filters"


def test_bybit_linear_inverse_and_leverage_parsing():
    linear = map_bybit(BYBIT_LINEAR_BTC, "linear")
    assert linear["settlement"] == "linear" and linear["maxLeverage"] == 125
    assert linear["fundingIntervalMinutes"] == 480

    inverse = map_bybit(BYBIT_INVERSE_BTC, "inverse")
    assert inverse["settlement"] == "inverse" and inverse["quantityUnit"] == "contracts"
    assert inverse["marginAsset"] == "BTC"

    with pytest.raises(AdapterError):
        map_bybit(BYBIT_LINEAR_BTC, "inverse")
    with pytest.raises(AdapterError) as exc:
        map_bybit({**BYBIT_LINEAR_BTC, "fundingInterval": 0}, "linear")
    assert exc.value.code == "derivative.invalid_funding_interval"


def test_hyperliquid_requires_explicit_tick_never_invented():
    with pytest.raises(AdapterError) as exc:
        map_hyperliquid(HL_BTC)
    assert exc.value.code == "derivative.tick_unavailable_from_meta"

    contract = map_hyperliquid({**HL_BTC, "tickSize": "1"})
    assert contract["settlement"] == "linear" and contract["quantityStep"] == "0.00001"
    assert contract["maxLeverage"] == 50 and contract["fundingIntervalMinutes"] == 60
    assert contract["marginAsset"] == "USDC"


def test_map_many_collects_skip_reasons():
    contracts, skipped = map_many("hyperliquid", [HL_BTC, {**HL_BTC, "tickSize": "1"}])
    assert len(contracts) == 1
    assert skipped == [{"nativeSymbol": "BTC", "reason": "derivative.tick_unavailable_from_meta"}]
    with pytest.raises(AdapterError) as exc:
        map_many("kraken-futures", [])
    assert exc.value.code == "derivative.source_unsupported"


def test_funding_in_third_currency_recorded_unconverted():
    # USDC-margined contract, funding actually paid in USDT: kept as-is.
    obs = funding_observation("hyperliquid", "BTC", "-1.2345", "USDT", 1793832000000, rate="0.0001")
    assert obs["asset"] == "USDT" and obs["amount"] == "-1.2345"
    assert obs["affectsTradingPnl"] is False and obs["kind"] == "funding"
    with pytest.raises(AdapterError):
        funding_observation("bybit", "BTCUSDT", "not-a-number", "USDT", 1793832000000)


def test_leverage_and_margin_mode_bounds():
    contract = map_bybit(BYBIT_LINEAR_BTC, "linear")
    assert check_leverage(contract, 125) == 125
    with pytest.raises(AdapterError) as exc:
        check_leverage(contract, 126)
    assert exc.value.code == "derivative.leverage_exceeds_max"
    with pytest.raises(AdapterError):
        check_leverage(contract, 0)
    assert check_margin_mode("isolated") == "isolated"
    with pytest.raises(AdapterError):
        check_margin_mode("portfolio")


def test_reduce_only_never_grows_or_flips():
    assert check_reduce_only("sell", "0.40", "1.25") == "0.85"
    assert check_reduce_only("buy", "1.25", "-1.25") == "0.00"
    with pytest.raises(AdapterError) as exc:
        check_reduce_only("sell", "1.26", "1.25")
    assert exc.value.code == "derivative.reduce_only_exceeds_position"
    with pytest.raises(AdapterError):
        check_reduce_only("sell", "0.1", "0")  # flat: nothing to reduce
    with pytest.raises(AdapterError):
        check_reduce_only("buy", "0.1", "1.0")  # would grow the long


def test_position_modes_net_vs_hedge():
    assert position_mode_allows("net", [], "long") is True
    assert position_mode_allows("net", ["long"], "long") is True
    assert position_mode_allows("net", ["long"], "short") is False
    assert position_mode_allows("hedge", ["long"], "short") is True
    with pytest.raises(AdapterError):
        position_mode_allows("both", [], "long")


def test_float_economics_rejected_everywhere():
    with pytest.raises(AdapterError):
        map_binance_usdm(
            {
                **BINANCE_USDM_BTC,
                "filters": [
                    {"filterType": "PRICE_FILTER", "tickSize": 0.1},
                    {"filterType": "LOT_SIZE", "minQty": "0.001", "stepSize": "0.001"},
                ],
            }
        )
