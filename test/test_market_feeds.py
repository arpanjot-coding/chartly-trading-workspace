"""Market feed parsing tests against recorded live payload shapes.

Payloads below mirror the exact field order observed from each venue's
public endpoint on 2026-11-04 (values shortened). No network is used.
"""

import lzma
import struct
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from flask import Flask

from blueprints.local_data import _error
from services import market_feeds
from services.market_feeds import OandaFeed, get_candles, get_quote, list_providers, list_symbols
from services.workspace_storage import WorkspaceError


def _fetch(payload):
    def fetch(url, params=None, headers=None):
        fetch.calls.append((url, params, headers))
        return payload

    fetch.calls = []
    return fetch


def test_binance_candles_exact_text_and_order():
    fetch = _fetch(
        [
            [
                1793826000000,
                "80138.00000000",
                "80320.01000000",
                "80090.00000000",
                "80240.18000000",
                "308.52006000",
                1793829599999,
                "24743481.9",
                97241,
                "157.9",
                "12668316.9",
                "0",
            ]
        ]
    )
    out = get_candles("binance", "BTCUSDT", "1h", 1, fetch=fetch)
    assert out[0]["open"] == "80138.00000000"
    assert out[0]["close"] == "80240.18000000"
    assert out[0]["source"] == "binance" and out[0]["trades"] == 97241
    assert fetch.calls[0][1] == {"symbol": "BTCUSDT", "interval": "1h", "limit": 1}


def test_bybit_candles_resorted_ascending():
    payload = {
        "retCode": 0,
        "result": {
            "list": [
                [
                    "1793829600000",
                    "80250.5",
                    "80946.8",
                    "80235.2",
                    "80897",
                    "352.257202",
                    "28401101.09",
                ],
                [
                    "1793826000000",
                    "80134.8",
                    "80320.4",
                    "80089.5",
                    "80240.1",
                    "300.1",
                    "24000000.0",
                ],
            ]
        },
    }
    out = get_candles("bybit", "BTCUSDT", "1h", 2, fetch=_fetch(payload))
    assert [c["openTimeMs"] for c in out] == [1793826000000, 1793829600000]
    assert out[0]["open"] == "80134.8"


def test_coinbase_field_order_and_float_labelling():
    payload = [[1793829600, 80142.46, 80870.13, 80155.43, 80837.84, 239.25844447]]
    out = get_candles("coinbase", "BTC-USD", "1h", 5, fetch=_fetch(payload))
    assert out[0]["open"] == "80155.43" and out[0]["low"] == "80142.46"
    assert out[0]["exactness"] == "provider-float"
    assert out[0]["openTimeMs"] == 1793829600000


def test_coinbase_4h_refused_not_approximated():
    with pytest.raises(WorkspaceError) as exc:
        get_candles("coinbase", "BTC-USD", "4h", 5, fetch=_fetch([]))
    assert exc.value.code == "market.interval_unsupported"


def test_okx_and_bitget_candles():
    okx = {
        "code": "0",
        "data": [
            [
                "1793829600000",
                "80235",
                "80934.9",
                "80221.1",
                "80899.4",
                "304.93859478",
                "24601724.9",
                "24601724.9",
                "1",
            ]
        ],
    }
    out = get_candles("okx", "BTC-USDT", "1h", 1, fetch=_fetch(okx))
    assert out[0]["close"] == "80899.4" and out[0]["confirmed"] is True

    bg = {
        "code": "00000",
        "data": [
            [
                "1793826000000",
                "80130.01",
                "80317.82",
                "80083.7",
                "80242.6",
                "51.513734",
                "4131085.15",
                "4131085.15",
            ]
        ],
    }
    out = get_candles("bitget", "BTCUSDT", "1h", 1, fetch=_fetch(bg))
    assert out[0]["high"] == "80317.82" and out[0]["source"] == "bitget"


def test_kraken_candles_skip_last_key_and_tail_limit():
    payload = {
        "error": [],
        "result": {
            "last": 1791244800,
            "XXBTZUSD": [
                [
                    1791237600,
                    "85930.4",
                    "86009.9",
                    "85837.5",
                    "85923.3",
                    "85941.0",
                    "62.71466661",
                    3419,
                ],
                [
                    1791241200,
                    "85923.3",
                    "86054.8",
                    "85716.6",
                    "85751.5",
                    "85923.9",
                    "94.15501287",
                    3726,
                ],
            ],
        },
    }
    out = get_candles("kraken", "XBTUSD", "1h", 1, fetch=_fetch(payload))
    assert len(out) == 1 and out[0]["close"] == "85751.5"
    assert out[0]["venuePair"] == "XXBTZUSD" and out[0]["volume"] == "94.15501287"


def test_validation_failures_are_closed():
    with pytest.raises(WorkspaceError) as exc:
        get_candles("binance", "btc usdt!", "1h", 1, fetch=_fetch([]))
    assert exc.value.code == "market.invalid_symbol"
    with pytest.raises(WorkspaceError) as exc:
        get_candles("binance", "BTCUSDT", "7m", 1, fetch=_fetch([]))
    assert exc.value.code == "market.invalid_interval"
    with pytest.raises(WorkspaceError) as exc:
        get_candles("nope", "BTCUSDT", "1h", 1, fetch=_fetch([]))
    assert exc.value.code == "market.provider_unsupported"
    with pytest.raises(WorkspaceError) as exc:
        get_candles("binance", "BTCUSDT", "1h", 0, fetch=_fetch([]))
    assert exc.value.code == "market.invalid_limit"


def test_malformed_payload_is_502_not_silent_empty():
    with pytest.raises(WorkspaceError) as exc:
        get_candles("binance", "BTCUSDT", "1h", 1, fetch=_fetch({"unexpected": True}))
    assert exc.value.code == "market.provider_payload" and exc.value.status == 502


def test_quotes_each_venue_shape():
    q = get_quote(
        "binance", "BTCUSDT", fetch=_fetch({"symbol": "BTCUSDT", "price": "80240.18000000"})
    )
    assert q["price"] == "80240.18000000"

    q = get_quote(
        "kraken",
        "XBTUSD",
        fetch=_fetch(
            {
                "error": [],
                "result": {
                    "XXBTZUSD": {
                        "a": ["85950.0", "1", "1.0"],
                        "b": ["85940.0", "2", "2.0"],
                        "c": ["85945.5", "0.1"],
                    }
                },
            }
        ),
    )
    assert q["price"] == "85945.5" and q["bid"] == "85940.0"

    with pytest.raises(WorkspaceError) as exc:
        get_quote("dukascopy", "EURUSD", fetch=_fetch({}))
    assert exc.value.code == "market.quote_unsupported"


def _bi5(ticks):
    raw = b"".join(struct.pack(">IIIff", *t) for t in ticks)
    return lzma.compress(raw, format=lzma.FORMAT_ALONE)


def test_dukascopy_ticks_aggregate_to_exact_mid_candles():
    # EURUSD divisor 100000: ask 110150, bid 110149 -> mid 1.101495 exactly.
    hour_ticks = [
        (1000, 110150, 110149, 1.0, 2.0),  # 10:00:01.000 mid 1.101495
        (61000, 110160, 110158, 0.5, 0.5),  # 10:01:01.000 mid 1.10159
        (62000, 110140, 110139, 0.25, 0.25),  # 10:01:02.000 mid 1.101395
    ]
    calls = []

    def fetch_bytes(url):
        calls.append(url)
        return _bi5(hour_ticks) if url.endswith("10h_ticks.bi5") else b""

    out = get_candles(
        "dukascopy",
        "EURUSD",
        "1m",
        100,
        start="2024-01-02T10:00:00+00:00",
        end="2024-01-02T11:00:00+00:00",
        fetch_bytes=fetch_bytes,
    )
    assert calls == ["https://datafeed.dukascopy.com/datafeed/EURUSD/2024/00/02/10h_ticks.bi5"]
    assert len(out) == 2
    first, second = out
    assert first["open"] == "1.101495" and first["close"] == "1.101495"
    assert second["open"] == "1.10159" and second["low"] == "1.101395"
    assert second["close"] == "1.101395" and second["priceBasis"] == "mid"
    start_ms = int(datetime(2024, 1, 2, 10, 0, tzinfo=UTC).timestamp() * 1000)
    assert first["openTimeMs"] == start_ms and second["openTimeMs"] == start_ms + 60000


def test_dukascopy_unknown_symbol_and_oversized_window_refused():
    with pytest.raises(WorkspaceError) as exc:
        get_candles(
            "dukascopy",
            "USDRUB",
            "1h",
            1,
            start="2024-01-02T10:00:00+00:00",
            end="2024-01-02T11:00:00+00:00",
            fetch_bytes=lambda url: b"",
        )
    assert exc.value.code == "market.symbol_unsupported"
    with pytest.raises(WorkspaceError) as exc:
        get_candles(
            "dukascopy",
            "EURUSD",
            "1h",
            1,
            start="2024-01-02T10:00:00+00:00",
            end="2024-01-09T11:00:00+00:00",
            fetch_bytes=lambda url: b"",
        )
    assert exc.value.code == "market.window_too_large"


def test_dukascopy_window_budget_counts_partial_utc_hours_before_fetching():
    def unexpected_fetch(_):
        pytest.fail("The partial first and last UTC hours exceed the request budget")

    with pytest.raises(WorkspaceError, match="market.window_too_large"):
        get_candles(
            "dukascopy",
            "EURUSD",
            "1h",
            1,
            start="2024-01-02T10:30:00Z",
            end="2024-01-05T10:15:00Z",
            fetch_bytes=unexpected_fetch,
        )


def test_oanda_requires_token_and_parses_mid_candles():
    with pytest.raises(WorkspaceError) as exc:
        OandaFeed(None)
    assert exc.value.code == "market.credentials_required" and exc.value.status == 409

    payload = {
        "candles": [
            {
                "complete": True,
                "volume": 1234,
                "time": "2026-11-04T10:00:00.000000000Z",
                "mid": {"o": "1.10150", "h": "1.10200", "l": "1.10100", "c": "1.10180"},
            }
        ]
    }
    fetch = _fetch(payload)
    out = get_candles("oanda", "EUR_USD", "1h", 1, oanda_token="sekret", fetch=fetch)
    assert out[0]["open"] == "1.10150" and out[0]["priceBasis"] == "mid"
    url, params, headers = fetch.calls[0]
    assert url.startswith("https://api-fxpractice.oanda.com/v3/instruments/EUR_USD/candles")
    assert headers == {"Authorization": "Bearer sekret"}
    assert "sekret" not in str(out)


def test_oanda_quote_mid_from_bid_ask():
    payload = {
        "prices": [
            {
                "instrument": "EUR_USD",
                "time": "2026-11-04T10:00:00Z",
                "tradeable": True,
                "bids": [{"price": "1.10149"}],
                "asks": [{"price": "1.10151"}],
            }
        ]
    }
    q = get_quote("oanda", "EUR_USD", oanda_token="t", oanda_account="001-1", fetch=_fetch(payload))
    assert q["price"] == "1.10150" and q["bid"] == "1.10149" and q["ask"] == "1.10151"


class FakeMT5Adapter:
    def market_candles(self, symbol, interval_seconds, limit):
        assert (symbol, interval_seconds, limit) == ("EURUSDm", 3600, 2)
        return [
            {
                "symbol": symbol,
                "rawProviderOpenTimeMs": 1793836800000,
                "open": "1.12310",
                "high": "1.12400",
                "low": "1.12290",
                "close": "1.12350",
                "tickVolume": "321",
                "receivedAt": "2026-11-04T12:00:00Z",
                "utcAlignmentVerified": False,
                "timeBasis": "provider-epoch-unverified",
            }
        ]

    def market_quote(self, symbol):
        return {
            "symbol": symbol,
            "bid": "1.12329",
            "ask": "1.12331",
            "rawProviderTimeMsc": 1793841016000,
            "observedSkewSeconds": 7199.2,
            "receivedAt": "2026-11-04T12:00:00Z",
            "utcAlignmentVerified": False,
            "timeBasis": "provider-epoch-unverified",
        }


def test_mt5_feed_preserves_native_symbol_and_provider_epoch():
    factory = lambda: FakeMT5Adapter()  # noqa: E731
    out = get_candles("mt5", "EURUSDm", "1h", 2, mt5_adapter_factory=factory)
    assert out[0]["symbol"] == "EURUSDm"
    assert out[0]["openTimeMs"] == 1793836800000
    assert out[0]["rawProviderOpenTimeMs"] == out[0]["openTimeMs"]
    assert out[0]["receivedAt"] == "2026-11-04T12:00:00Z"
    assert out[0]["clockPolicy"] == "native-read-only"
    assert "observedSkewSeconds" not in out[0]
    assert out[0]["timeBasis"] == "provider-epoch-unverified"
    assert out[0]["volumeMeaning"] == "tick-count"
    q = get_quote("mt5", "EURUSDm", mt5_adapter_factory=factory)
    assert q["price"] == "1.12330" and q["bid"] == "1.12329"


def test_mt5_terminal_down_is_actionable_409():
    from services.connector_adapters import AdapterError

    class Down:
        def market_quote(self, symbol):
            raise AdapterError("connector.selected_terminal_not_running", 409)

    with pytest.raises(WorkspaceError) as exc:
        get_quote("mt5", "EURUSD", mt5_adapter_factory=lambda: Down())
    assert exc.value.code == "market.terminal_not_running" and exc.value.status == 409


def _post(payload):
    def post(url, body, headers=None):
        post.calls.append((url, body, headers))
        return payload

    post.calls = []
    return post


def test_hyperliquid_candles_window_and_parse():
    now_ms = 1793832000000 + 3600000
    post = _post(
        [
            {
                "t": 1793828400000,
                "T": 1793831999999,
                "s": "BTC",
                "i": "1h",
                "o": "80250.0",
                "c": "80391.5",
                "h": "80400.0",
                "l": "80200.0",
                "v": "123.456",
                "n": 999,
            },
            {
                "t": 1793832000000,
                "T": 1793835599999,
                "s": "BTC",
                "i": "1h",
                "o": "80391.5",
                "c": "80389.0",
                "h": "80410.0",
                "l": "80350.0",
                "v": "98.1",
                "n": 800,
            },
        ]
    )
    out = get_candles("hyperliquid", "BTC", "1h", 2, post=post, now_ms=now_ms)
    assert out[0]["open"] == "80250.0" and out[1]["close"] == "80389.0"
    assert out[0]["instrumentKind"] == "perp" and out[0]["source"] == "hyperliquid"
    url, body, _ = post.calls[0]
    assert url == "https://api.hyperliquid.xyz/info"
    assert body["type"] == "candleSnapshot"
    assert body["req"]["endTime"] == now_ms
    assert body["req"]["startTime"] == now_ms - 2 * 3600 * 1000


def test_hyperliquid_quote_is_mid_and_unknown_coin_404s():
    q = get_quote("hyperliquid", "BTC", post=_post({"BTC": "80391.5", "ETH": "2500.0"}))
    assert q["price"] == "80391.5" and q["priceBasis"] == "mid"
    with pytest.raises(WorkspaceError) as exc:
        get_quote("hyperliquid", "NOPE", post=_post({"BTC": "1"}))
    assert exc.value.code == "market.symbol_unknown" and exc.value.status == 404


def test_hyperliquid_chart_uses_the_case_sensitive_catalog_name():
    stamp = 1793832000000
    post = _post([{"s": "kBONK", "t": stamp, "o": "1", "h": "2", "l": "1", "c": "2", "v": "3"}])
    rows = get_candles("hyperliquid", "kBONK", "1h", 1, post=post, now_ms=stamp + 3600000)
    assert post.calls[0][1]["req"]["coin"] == "kBONK"
    assert rows[0]["symbol"] == "kBONK"


def test_providers_listing_is_honest():
    providers = {p["id"]: p for p in list_providers()}
    assert set(providers) == {
        "mt5",
        "binance",
        "bybit",
        "coinbase",
        "okx",
        "bitget",
        "kraken",
        "hyperliquid",
        "dukascopy",
        "oanda",
    }
    assert providers["hyperliquid"]["kind"] == "crypto-perps"
    assert providers["hyperliquid"]["credentials"] == "none"
    assert providers["mt5"]["credentials"] == "terminal-session"
    assert providers["dukascopy"]["liveQuote"] is False
    assert providers["oanda"]["credentials"] == "client-token"
    assert "4h" not in providers["coinbase"]["intervals"]
    assert providers["binance"]["credentials"] == "none"
    assert providers["mt5"]["directChart"] is True
    assert "1d" in providers["mt5"]["intervals"]
    assert "1d" not in providers["mt5"]["chartIntervals"]
    assert providers["mt5"]["historyImport"] == "clock-unverified"
    assert providers["dukascopy"]["directChart"] is False
    assert providers["dukascopy"]["historyImport"] == "available"
    assert providers["oanda"]["directChart"] is False
    assert providers["oanda"]["historyImport"] == "client-token"


@pytest.mark.parametrize(
    ("upstream_status", "code", "message"),
    [
        (401, "market.provider_authentication", "renew"),
        (403, "market.provider_access_denied", "entitlement"),
        (451, "market.provider_access_denied", "regional availability"),
        (429, "market.provider_rate_limited", "rate-limiting"),
    ],
)
def test_oanda_upstream_authentication_entitlement_and_rate_limit_are_distinct(
    monkeypatch, upstream_status, code, message
):
    def get(url, **kwargs):
        assert url.startswith("https://api-fxpractice.oanda.com/")
        assert kwargs["headers"]["Authorization"] == "Bearer test-token"
        return SimpleNamespace(status_code=upstream_status)

    monkeypatch.setattr(market_feeds.requests, "get", get)
    with pytest.raises(WorkspaceError) as denied:
        get_candles("oanda", "EUR_USD", "1h", 1, oanda_token="test-token")
    assert denied.value.code == code
    with Flask(__name__).app_context():
        response, status = _error(denied.value.code, denied.value.status)
        assert message in response.get_json()["error"]["message"]
        assert "test-token" not in response.get_data(as_text=True)
        assert status == (503 if upstream_status == 429 else 502)


@pytest.fixture(autouse=True)
def _clear_symbol_cache():
    market_feeds._SYMBOL_CACHE.clear()
    yield
    market_feeds._SYMBOL_CACHE.clear()


def _fetch_returning(payload):
    calls = []

    def fetch(url, params=None, headers=None):
        calls.append((url, params))
        return payload

    fetch.calls = calls
    return fetch


def test_binance_symbol_list_filters_ranks_and_caches():
    fetch = _fetch_returning(
        {
            "symbols": [
                {
                    "symbol": "ETHUSDT",
                    "status": "TRADING",
                    "baseAsset": "ETH",
                    "quoteAsset": "USDT",
                },
                {
                    "symbol": "BTCUSDT",
                    "status": "TRADING",
                    "baseAsset": "BTC",
                    "quoteAsset": "USDT",
                },
                {"symbol": "BTCBUSD", "status": "BREAK", "baseAsset": "BTC", "quoteAsset": "BUSD"},
                {
                    "symbol": "WBTCUSDT",
                    "status": "TRADING",
                    "baseAsset": "WBTC",
                    "quoteAsset": "USDT",
                },
            ]
        }
    )
    out = list_symbols("binance", "BTC", 10, fetch=fetch)
    assert [r["symbol"] for r in out] == ["BTCUSDT", "WBTCUSDT"]
    assert out[0] == {"symbol": "BTCUSDT", "name": "BTC/USDT", "exchange": "BINANCE"}
    out = list_symbols("binance", "ETH", 10, fetch=fetch)
    assert [r["symbol"] for r in out] == ["ETHUSDT"]
    assert len(fetch.calls) == 1  # second query served from cache


def test_other_crypto_symbol_lists():
    bybit = _fetch_returning(
        {
            "result": {
                "nextPageCursor": "",
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "baseCoin": "BTC",
                        "quoteCoin": "USDT",
                        "status": "Trading",
                    },
                    {
                        "symbol": "ETHUSDT",
                        "baseCoin": "ETH",
                        "quoteCoin": "USDT",
                        "status": "Trading",
                    },
                ],
            }
        }
    )
    assert [r["symbol"] for r in list_symbols("bybit", "eth", 5, fetch=bybit)] == ["ETHUSDT"]

    coinbase = _fetch_returning(
        [
            {"id": "BTC-USD", "display_name": "BTC/USD", "status": "online"},
            {"id": "ETH-USD", "display_name": "ETH/USD", "status": "delisted"},
        ]
    )
    out = list_symbols("coinbase", "BTC USD", 5, fetch=coinbase)
    assert out == [{"symbol": "BTC-USD", "name": "BTC/USD", "exchange": "COINBASE"}]

    okx = _fetch_returning(
        {
            "data": [
                {"instId": "BTC-USDT", "baseCcy": "BTC", "quoteCcy": "USDT", "state": "live"},
                {"instId": "OLD-USDT", "baseCcy": "OLD", "quoteCcy": "USDT", "state": "suspend"},
            ]
        }
    )
    assert [r["symbol"] for r in list_symbols("okx", "", 5, fetch=okx)] == ["BTC-USDT"]

    bitget = _fetch_returning(
        {
            "data": [
                {"symbol": "BTCUSDT", "baseCoin": "BTC", "quoteCoin": "USDT", "status": "online"},
            ]
        }
    )
    assert [r["symbol"] for r in list_symbols("bitget", "btc", 5, fetch=bitget)] == ["BTCUSDT"]

    kraken = _fetch_returning(
        {
            "error": [],
            "result": {
                "XXBTZUSD": {"altname": "XBTUSD", "wsname": "XBT/USD"},
                "XXBTZUSD.d": {"altname": "XBTUSD.d", "wsname": "XBT/USD"},
            },
        }
    )
    assert list_symbols("kraken", "XBT", 5, fetch=kraken) == [
        {"symbol": "XBTUSD", "name": "XBT/USD", "exchange": "KRAKEN"}
    ]

    hl = _post({"universe": [{"name": "BTC"}, {"name": "ETH"}]})
    out = list_symbols("hyperliquid", "BT", 5, post=hl)
    assert out == [{"symbol": "BTC", "name": "BTC perpetual", "exchange": "HYPERLIQUID"}]


def test_symbol_list_unsupported_providers_stay_honest():
    with pytest.raises(WorkspaceError) as exc:
        list_symbols("dukascopy", "EUR", 5)
    assert exc.value.code == "market.symbols_unsupported"
    with pytest.raises(WorkspaceError) as exc:
        list_symbols("nope", "EUR", 5)
    assert exc.value.code == "market.provider_unsupported"
