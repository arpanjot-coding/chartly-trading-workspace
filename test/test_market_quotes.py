"""Bounded watchlist requests use public prices with exact venue symbols."""

from urllib.parse import urlencode

import httpx
import pytest
from test_local_data_api import api as api
from test_local_data_api import login

from blueprints import market_data
from services import market_quotes
from services.workspace_storage import WorkspaceError

PRICE = "123456.123456789012345"


@pytest.mark.parametrize(
    ("provider", "symbol", "payload"),
    [
        ("binance", "BTCUSDT", [{"symbol": "BTCUSDT", "price": PRICE}]),
        (
            "bybit",
            "BTCUSDT",
            {"retCode": 0, "result": {"list": [{"symbol": "BTCUSDT", "lastPrice": PRICE}]}},
        ),
        ("okx", "BTC-USDT", {"code": "0", "data": [{"instId": "BTC-USDT", "last": PRICE}]}),
        (
            "bitget",
            "BTCUSDT",
            {"code": "00000", "data": [{"symbol": "BTCUSDT", "lastPr": PRICE}]},
        ),
        ("hyperliquid", "kPEPE", {"kPEPE": PRICE, "OTHER": "1"}),
    ],
)
def test_each_batch_venue_uses_one_request_and_keeps_precision(provider, symbol, payload):
    calls = []

    def fetch(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return payload

    result = market_quotes.get_quotes(provider, [symbol, symbol, "MISSING"], request=fetch)
    assert len(calls) == 1
    assert calls[0][0] == ("POST" if provider == "hyperliquid" else "GET")
    assert len(result["quotes"]) == 1
    quote = result["quotes"][0]
    assert (quote["source"], quote["symbol"], quote["price"]) == (provider, symbol, PRICE)
    assert result["missing"] == ["MISSING"]


def test_batch_isolates_missing_invalid_and_unrequested_rows():
    payload = [
        {"symbol": "BTCUSDT", "price": PRICE},
        {"symbol": "ETHUSDT", "price": "NaN"},
        {"symbol": "SOLUSDT", "price": "0"},
        {"symbol": "DOGEUSDT", "price": "1.00"},
        {"symbol": ["not hashable"], "price": "1.00"},
        None,
    ]
    result = market_quotes.get_quotes(
        "binance", ["btcUsdt", "ETHUSDT", "SOLUSDT", "ADAUSDT"], request=lambda *_a, **_kw: payload
    )
    assert [row["symbol"] for row in result["quotes"]] == ["BTCUSDT"]
    assert result["missing"] == ["ETHUSDT", "SOLUSDT", "ADAUSDT"]


@pytest.mark.parametrize(
    ("provider", "symbols", "code"),
    [
        ("mt5", ["EURUSD"], "market.batch_quote_unsupported"),
        ("binance", ["BTCUSDT"] * 51, "market.invalid_limit"),
        ("binance", ["BTCUSDT", ""], "market.invalid_symbol"),
    ],
)
def test_batch_validates_before_transport(provider, symbols, code):
    with pytest.raises(WorkspaceError) as caught:
        market_quotes.get_quotes(
            provider, symbols, request=lambda *_a, **_kw: pytest.fail("Unexpected upstream call")
        )
    assert caught.value.code == code


def test_batch_limit_and_local_access_contract(api, monkeypatch):
    api.register_blueprint(market_data.market_data_bp)
    client = api.test_client()
    names = [f"BTC{index}" for index in range(50)]
    path = "/api/local/v1/market/quotes"
    query = urlencode({"provider": "binance", "symbols": ",".join(names)})
    calls = []

    def get_quotes(provider, symbols):
        calls.append((provider, symbols))
        return {"quotes": [], "missing": symbols}

    monkeypatch.setattr(market_data, "get_quotes", get_quotes)
    assert client.get(f"{path}?{query}").status_code == 401
    login(client)
    response = client.get(f"{path}?{query}")
    assert response.status_code == 200, response.json
    assert response.json == {"quotes": [], "missing": names}
    assert response.headers["Cache-Control"] == "private, no-store"
    assert client.get(f"{path}?{query}&unexpected=1").status_code == 400
    assert calls == [("binance", names)]


def test_ticker_stream_closes_on_success_payload_limit_and_access_failure(monkeypatch):
    class TickerStream(httpx.SyncByteStream):
        closed = False

        def __init__(self, chunks):
            self.chunks = chunks

        def __iter__(self):
            yield from self.chunks

        def close(self):
            self.closed = True

    streams = [
        TickerStream([b"[]"]),
        TickerStream([b"x" * 65_536, b"x" * 65_536]),
        TickerStream([]),
    ]
    responses = iter(zip([200, 200, 403], streams, strict=True))

    def handle(request):
        assert request.headers["Accept-Encoding"] == "identity"
        status, stream = next(responses)
        return httpx.Response(status, stream=stream)

    monkeypatch.setattr(market_quotes, "_MAX_TICKER_BYTES", 65_536)
    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(market_quotes, "get_httpx_client", lambda: client)
        assert market_quotes.get_quotes("binance", ["BTCUSDT"])["quotes"] == []
        with pytest.raises(WorkspaceError, match=r"market\.provider_payload"):
            market_quotes.get_quotes("binance", ["BTCUSDT"])
        with pytest.raises(WorkspaceError, match=r"market\.provider_access_denied"):
            market_quotes.get_quotes("binance", ["BTCUSDT"])
    assert all(stream.closed for stream in streams)
