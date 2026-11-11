"""Read up to 50 prices from one public venue ticker response."""

import json
import time
from decimal import Decimal

import httpx

from services.market_feeds import (
    MARKET_PROVIDERS,
    _check_provider_status,
    _err,
    _hyperliquid_symbol,
    _quote,
    _rows,
    _symbol,
)
from services.workspace_storage import WorkspaceError
from utils.httpx_client import get_httpx_client
from utils.logging import get_logger

logger = get_logger(__name__)

MAX_BATCH_SYMBOLS = 50
_MAX_TICKER_BYTES = 4 * 1024 * 1024
_TICKER_TIMEOUT = 10.0

# Each route is a fixed public market endpoint. No account headers or URLs
# arrive from the client, and only the requested symbols leave this service.
_SPOT_TICKERS = {
    "binance": ("https://api.binance.com/api/v3/ticker/price", {}, (), "symbol", "price"),
    "bybit": (
        "https://api.bybit.com/v5/market/tickers",
        {"category": "spot"},
        ("result", "list"),
        "symbol",
        "lastPrice",
    ),
    "okx": (
        "https://www.okx.com/api/v5/market/tickers",
        {"instType": "SPOT"},
        ("data",),
        "instId",
        "last",
    ),
    "bitget": (
        "https://api.bitget.com/api/v2/spot/market/tickers",
        {},
        ("data",),
        "symbol",
        "lastPr",
    ),
}


def _request(method, url, *, params=None, body=None):
    deadline = time.monotonic() + _TICKER_TIMEOUT
    try:
        with get_httpx_client().stream(
            method,
            url,
            params=params,
            json=body,
            headers={"Accept-Encoding": "identity"},
            timeout=_TICKER_TIMEOUT,
            follow_redirects=False,
        ) as response:
            if response.status_code == 418:
                raise _err("market.provider_rate_limited", 503)
            _check_provider_status(response.status_code)
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                raise _err("market.provider_payload", 502)
            data = bytearray()
            for chunk in response.iter_raw(chunk_size=64 * 1024):
                if time.monotonic() >= deadline:
                    raise _err("market.provider_unreachable", 502)
                if len(data) + len(chunk) > _MAX_TICKER_BYTES:
                    raise _err("market.provider_payload", 502)
                data.extend(chunk)
            return json.loads(data)
    except httpx.HTTPError:
        logger.exception("Public ticker request failed")
        raise _err("market.provider_unreachable", 502) from None
    except (ValueError, UnicodeError, RecursionError):
        raise _err("market.provider_payload", 502) from None


def get_quotes(provider, symbols, *, request=None):
    """Return requested ticker matches from one bounded, unauthenticated venue read."""
    provider = provider.strip().lower() if isinstance(provider, str) else ""
    if not MARKET_PROVIDERS.get(provider, {}).get("batchQuotes") or (
        provider != "hyperliquid" and provider not in _SPOT_TICKERS
    ):
        raise _err("market.batch_quote_unsupported")
    if not isinstance(symbols, (list, tuple)) or not 1 <= len(symbols) <= MAX_BATCH_SYMBOLS:
        raise _err("market.invalid_limit")
    request = request or _request
    symbol_format = _hyperliquid_symbol if provider == "hyperliquid" else _symbol
    wanted = dict.fromkeys(symbol_format(symbol) for symbol in symbols)
    extra = None
    if provider == "hyperliquid":
        payload = request("POST", "https://api.hyperliquid.xyz/info", body={"type": "allMids"})
        if not isinstance(payload, dict):
            raise _err("market.provider_payload", 502)
        values = {symbol: (payload[symbol], None) for symbol in wanted if symbol in payload}
        extra = {"priceBasis": "mid", "instrumentKind": "perp"}
    else:
        url, params, path, symbol_field, price_field = _SPOT_TICKERS[provider]
        payload = request("GET", url, params=params)
        if isinstance(payload, dict):
            expected = {"bybit": ("retCode", 0), "okx": ("code", "0"), "bitget": ("code", "00000")}
            if provider in expected:
                field, status = expected[provider]
                if payload.get(field) != status:
                    raise _err("market.provider_payload", 502)
        values = {}
        for row in _rows(payload, *path):
            if not isinstance(row, dict):
                continue
            symbol = row.get(symbol_field)
            if isinstance(symbol, str) and symbol in wanted:
                values[symbol] = (row.get(price_field), row.get("ts"))

    quotes = []
    for symbol in wanted:
        if symbol not in values:
            continue
        value, timestamp = values[symbol]
        # Skip a malformed quote for one requested instrument and return its
        # valid neighbors. The client retains the instrument's last price.
        try:
            quote = _quote(provider, symbol, value, time_ms=timestamp, extra=extra)
        except (WorkspaceError, TypeError, ValueError, OverflowError):
            continue
        price = Decimal(quote["price"])
        if price.is_finite() and price > 0:
            quotes.append(quote)
    matched = {row["symbol"] for row in quotes}
    return {"quotes": quotes, "missing": [symbol for symbol in wanted if symbol not in matched]}
