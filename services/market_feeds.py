"""Keyless and client-keyed market-data feeds (candles + latest quote).

Truth rules carried from the platform core: prices stay exact text
(Decimal-validated, never rounded), every candle is stamped with its
source provider, no cross-venue symbol translation happens silently
(callers pass the venue-native symbol), and unsupported interval or
instrument requests fail closed instead of being approximated.

Providers
---------
Keyless public REST (live-verified 2026-11-04): binance, bybit,
coinbase, okx, bitget, kraken. Dukascopy serves free historical tick
files (.bi5); candles are aggregated here from mid-price ticks and
labelled ``priceBasis: mid``. OANDA requires the client's own API
token (sent per request, never stored or logged by this module).

Nothing in this module can place orders; it is a read-only feed layer.
One user's keyed feed is never cached or shared with another caller.
"""

from __future__ import annotations

import json
import lzma
import re
import struct
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path

import requests

from services.connector_mt5 import NATIVE_SYMBOL_PATTERN
from services.workspace_storage import WorkspaceError

INTERVAL_SECONDS = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
}

MARKET_PROVIDERS = {
    row["id"]: row
    for row in json.loads(
        Path(__file__).with_name("market_providers.json").read_text(encoding="utf-8")
    )
}

_SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9\-_/]{2,23}$")
_HYPERLIQUID_SYMBOL_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,23}")
_MAX_LIMIT = 1000
_MAX_DUKAS_HOURS = MARKET_PROVIDERS["dukascopy"]["maxWindowHours"]
_TIMEOUT = 20
_USER_AGENT = "Chartly/2.0 (local market-data feed)"

# Dukascopy integer prices are scaled by an instrument-specific point
# value. Only instruments with a verified divisor are served; anything
# else fails closed rather than guessing a scale.
DUKASCOPY_DIVISORS = {
    "EURUSD": 100000,
    "GBPUSD": 100000,
    "AUDUSD": 100000,
    "NZDUSD": 100000,
    "USDCHF": 100000,
    "USDCAD": 100000,
    "USDJPY": 1000,
    "EURJPY": 1000,
    "GBPJPY": 1000,
    "XAUUSD": 1000,
}


def _err(code, status=400):
    return WorkspaceError(code, status)


def _symbol(raw):
    if not isinstance(raw, str):
        raise _err("market.invalid_symbol")
    symbol = raw.strip().upper()
    if not _SYMBOL_RE.match(symbol):
        raise _err("market.invalid_symbol")
    return symbol


def _interval(raw):
    if raw not in INTERVAL_SECONDS:
        raise _err("market.invalid_interval")
    return raw


def _limit(raw):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise _err("market.invalid_limit") from None
    if not 1 <= value <= _MAX_LIMIT:
        raise _err("market.invalid_limit")
    return value


def _decimal_text(value, *, provider):
    """Validate a provider number as exact decimal text (no rounding)."""
    if isinstance(value, bool) or value is None:
        raise _err("market.provider_payload", 502)
    text = value if isinstance(value, str) else repr(value)
    try:
        Decimal(text)
    except InvalidOperation:
        raise _err("market.provider_payload", 502) from None
    return text


def _candle(provider, symbol, interval, open_ms, o, h, low, c, volume, **extra):
    candle = {
        "source": provider,
        "symbol": symbol,
        "interval": interval,
        "openTimeMs": int(open_ms),
        "open": _decimal_text(o, provider=provider),
        "high": _decimal_text(h, provider=provider),
        "low": _decimal_text(low, provider=provider),
        "close": _decimal_text(c, provider=provider),
        "volume": _decimal_text(volume, provider=provider),
    }
    candle.update(extra)
    return candle


def _check_provider_status(status):
    if status == 401:
        raise _err("market.provider_authentication", 502)
    if status in (403, 451):
        raise _err("market.provider_access_denied", 502)
    if status == 429:
        raise _err("market.provider_rate_limited", 503)
    if status != 200:
        raise _err("market.provider_http", 502)


def default_fetch_json(url, params=None, headers=None):
    merged = {"User-Agent": _USER_AGENT}
    merged.update(headers or {})
    try:
        response = requests.get(url, params=params or {}, headers=merged, timeout=_TIMEOUT)
    except requests.RequestException:
        raise _err("market.provider_unreachable", 502) from None
    _check_provider_status(response.status_code)
    try:
        return response.json()
    except ValueError:
        raise _err("market.provider_payload", 502) from None


def default_post_json(url, body, headers=None):
    merged = {"User-Agent": _USER_AGENT, "Content-Type": "application/json"}
    merged.update(headers or {})
    try:
        response = requests.post(url, json=body, headers=merged, timeout=_TIMEOUT)
    except requests.RequestException:
        raise _err("market.provider_unreachable", 502) from None
    _check_provider_status(response.status_code)
    try:
        return response.json()
    except ValueError:
        raise _err("market.provider_payload", 502) from None


def default_fetch_bytes(url):
    try:
        response = requests.get(url, headers={"User-Agent": _USER_AGENT}, timeout=_TIMEOUT)
    except requests.RequestException:
        raise _err("market.provider_unreachable", 502) from None
    if response.status_code == 404:
        return b""
    _check_provider_status(response.status_code)
    return response.content


def _rows(payload, *path):
    node = payload
    for key in path:
        if isinstance(key, str) and isinstance(node, dict) and key in node:
            node = node[key]
        else:
            raise _err("market.provider_payload", 502)
    if not isinstance(node, list):
        raise _err("market.provider_payload", 502)
    return node


# ---------------------------------------------------------------------------
# Keyless crypto venues
# ---------------------------------------------------------------------------

_BINANCE_INTERVALS = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d"}
_BYBIT_INTERVALS = {"1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D"}
_COINBASE_INTERVALS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400}
_OKX_INTERVALS = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D"}
_BITGET_INTERVALS = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "1h": "1h",
    "4h": "4h",
    "1d": "1day",
}
_KRAKEN_INTERVALS = {"1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440}


def _venue_interval(mapping, interval):
    if interval not in mapping:
        raise _err("market.interval_unsupported")
    return mapping[interval]


def _binance_candles(fetch, symbol, interval, limit):
    payload = fetch(
        "https://api.binance.com/api/v3/klines",
        {
            "symbol": symbol,
            "interval": _venue_interval(_BINANCE_INTERVALS, interval),
            "limit": limit,
        },
    )
    rows = _rows(payload)
    return [
        _candle(
            "binance",
            symbol,
            interval,
            r[0],
            r[1],
            r[2],
            r[3],
            r[4],
            r[5],
            trades=int(r[8]),
            exactness="provider-text",
        )
        for r in rows
    ]


def _bybit_candles(fetch, symbol, interval, limit):
    payload = fetch(
        "https://api.bybit.com/v5/market/kline",
        {
            "category": "spot",
            "symbol": symbol,
            "interval": _venue_interval(_BYBIT_INTERVALS, interval),
            "limit": limit,
        },
    )
    rows = _rows(payload, "result", "list")
    candles = [
        _candle(
            "bybit", symbol, interval, r[0], r[1], r[2], r[3], r[4], r[5], exactness="provider-text"
        )
        for r in rows
    ]
    return sorted(candles, key=lambda c: c["openTimeMs"])


def _coinbase_candles(fetch, symbol, interval, limit):
    payload = fetch(
        f"https://api.exchange.coinbase.com/products/{symbol}/candles",
        {"granularity": _venue_interval(_COINBASE_INTERVALS, interval)},
    )
    rows = _rows(payload)
    # Coinbase order: [time_s, low, high, open, close, volume], newest first;
    # values are JSON floats, so exactness is labelled provider-float.
    candles = [
        _candle(
            "coinbase",
            symbol,
            interval,
            int(r[0]) * 1000,
            r[3],
            r[2],
            r[1],
            r[4],
            r[5],
            exactness="provider-float",
        )
        for r in rows
    ]
    candles = sorted(candles, key=lambda c: c["openTimeMs"])
    return candles[-limit:]


def _okx_candles(fetch, symbol, interval, limit):
    payload = fetch(
        "https://www.okx.com/api/v5/market/candles",
        {"instId": symbol, "bar": _venue_interval(_OKX_INTERVALS, interval), "limit": limit},
    )
    rows = _rows(payload, "data")
    candles = [
        _candle(
            "okx",
            symbol,
            interval,
            r[0],
            r[1],
            r[2],
            r[3],
            r[4],
            r[5],
            confirmed=r[8] == "1" if len(r) > 8 else None,
            exactness="provider-text",
        )
        for r in rows
    ]
    return sorted(candles, key=lambda c: c["openTimeMs"])


def _bitget_candles(fetch, symbol, interval, limit):
    payload = fetch(
        "https://api.bitget.com/api/v2/spot/market/candles",
        {
            "symbol": symbol,
            "granularity": _venue_interval(_BITGET_INTERVALS, interval),
            "limit": limit,
        },
    )
    rows = _rows(payload, "data")
    return [
        _candle(
            "bitget",
            symbol,
            interval,
            r[0],
            r[1],
            r[2],
            r[3],
            r[4],
            r[5],
            exactness="provider-text",
        )
        for r in rows
    ]


def _kraken_candles(fetch, symbol, interval, limit):
    payload = fetch(
        "https://api.kraken.com/0/public/OHLC",
        {"pair": symbol, "interval": _venue_interval(_KRAKEN_INTERVALS, interval)},
    )
    result = payload.get("result") if isinstance(payload, dict) else None
    if not isinstance(result, dict):
        raise _err("market.provider_payload", 502)
    pair_keys = [k for k in result if k != "last"]
    if len(pair_keys) != 1:
        raise _err("market.provider_payload", 502)
    rows = result[pair_keys[0]]
    candles = [
        _candle(
            "kraken",
            symbol,
            interval,
            int(r[0]) * 1000,
            r[1],
            r[2],
            r[3],
            r[4],
            r[6],
            trades=int(r[7]),
            venuePair=pair_keys[0],
            exactness="provider-text",
        )
        for r in rows
    ]
    return candles[-limit:]


_HYPERLIQUID_INTERVALS = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d"}


def _hyperliquid_candles(post, symbol, interval, limit, now_ms):
    seconds = INTERVAL_SECONDS[interval]
    payload = post(
        "https://api.hyperliquid.xyz/info",
        {
            "type": "candleSnapshot",
            "req": {
                "coin": symbol,
                "interval": _venue_interval(_HYPERLIQUID_INTERVALS, interval),
                "startTime": now_ms - limit * seconds * 1000,
                "endTime": now_ms,
            },
        },
    )
    rows = _rows(payload)
    candles = []
    for r in rows:
        if not isinstance(r, dict) or r.get("s", symbol) != symbol:
            raise _err("market.provider_payload", 502)
        candles.append(
            _candle(
                "hyperliquid",
                symbol,
                interval,
                r.get("t"),
                r.get("o"),
                r.get("h"),
                r.get("l"),
                r.get("c"),
                r.get("v"),
                trades=r.get("n"),
                instrumentKind="perp",
                exactness="provider-text",
            )
        )
    return sorted(candles, key=lambda c: c["openTimeMs"])[-limit:]


_CRYPTO_CANDLES = {
    "binance": _binance_candles,
    "bybit": _bybit_candles,
    "coinbase": _coinbase_candles,
    "okx": _okx_candles,
    "bitget": _bitget_candles,
    "kraken": _kraken_candles,
}


def _quote(provider, symbol, price, *, time_ms=None, extra=None):
    quote = {
        "source": provider,
        "symbol": symbol,
        "price": _decimal_text(price, provider=provider),
        "observedAtMs": int(time_ms) if time_ms is not None else None,
    }
    if extra:
        quote.update(extra)
    return quote


def _hyperliquid_quote(post, symbol):
    payload = post("https://api.hyperliquid.xyz/info", {"type": "allMids"})
    if not isinstance(payload, dict) or symbol not in payload:
        raise _err("market.symbol_unknown", 404)
    return _quote(
        "hyperliquid",
        symbol,
        payload[symbol],
        extra={"priceBasis": "mid", "instrumentKind": "perp"},
    )


def _crypto_quote(fetch, provider, symbol):
    if provider == "binance":
        payload = fetch("https://api.binance.com/api/v3/ticker/price", {"symbol": symbol})
        return _quote(provider, symbol, payload["price"])
    if provider == "bybit":
        payload = fetch(
            "https://api.bybit.com/v5/market/tickers", {"category": "spot", "symbol": symbol}
        )
        rows = _rows(payload, "result", "list")
        if not rows:
            raise _err("market.symbol_unknown", 404)
        row = rows[0]
        return _quote(
            provider,
            symbol,
            row["lastPrice"],
            extra={
                "bid": _decimal_text(row.get("bid1Price"), provider=provider),
                "ask": _decimal_text(row.get("ask1Price"), provider=provider),
            },
        )
    if provider == "coinbase":
        payload = fetch(f"https://api.exchange.coinbase.com/products/{symbol}/ticker", {})
        quote = _quote(provider, symbol, payload["price"], extra={"exactness": "provider-text"})
        if payload.get("bid") is not None:
            quote["bid"] = _decimal_text(payload["bid"], provider=provider)
        if payload.get("ask") is not None:
            quote["ask"] = _decimal_text(payload["ask"], provider=provider)
        return quote
    if provider == "okx":
        payload = fetch("https://www.okx.com/api/v5/market/ticker", {"instId": symbol})
        rows = _rows(payload, "data")
        if not rows:
            raise _err("market.symbol_unknown", 404)
        row = rows[0]
        return _quote(
            provider,
            symbol,
            row["last"],
            time_ms=row.get("ts"),
            extra={
                "bid": _decimal_text(row.get("bidPx"), provider=provider),
                "ask": _decimal_text(row.get("askPx"), provider=provider),
            },
        )
    if provider == "bitget":
        payload = fetch("https://api.bitget.com/api/v2/spot/market/tickers", {"symbol": symbol})
        rows = _rows(payload, "data")
        if not rows:
            raise _err("market.symbol_unknown", 404)
        row = rows[0]
        return _quote(
            provider,
            symbol,
            row["lastPr"],
            time_ms=row.get("ts"),
            extra={
                "bid": _decimal_text(row.get("bidPr"), provider=provider),
                "ask": _decimal_text(row.get("askPr"), provider=provider),
            },
        )
    if provider == "kraken":
        payload = fetch("https://api.kraken.com/0/public/Ticker", {"pair": symbol})
        result = payload.get("result") if isinstance(payload, dict) else None
        if not isinstance(result, dict) or len(result) != 1:
            raise _err("market.provider_payload", 502)
        row = next(iter(result.values()))
        return _quote(
            provider,
            symbol,
            row["c"][0],
            extra={
                "bid": _decimal_text(row["b"][0], provider=provider),
                "ask": _decimal_text(row["a"][0], provider=provider),
            },
        )
    raise _err("market.provider_unsupported")


# ---------------------------------------------------------------------------
# Dukascopy free history (tick files -> mid-price candles)
# ---------------------------------------------------------------------------

_TICK = struct.Struct(">IIIff")


def _parse_bi5(blob, hour_start, divisor):
    if not blob:
        return []
    try:
        raw = lzma.decompress(blob, format=lzma.FORMAT_ALONE)
    except lzma.LZMAError:
        raise _err("market.provider_payload", 502) from None
    if len(raw) % _TICK.size != 0:
        raise _err("market.provider_payload", 502)
    ticks = []
    for offset in range(0, len(raw), _TICK.size):
        ms, ask, bid, ask_vol, bid_vol = _TICK.unpack_from(raw, offset)
        when = hour_start + timedelta(milliseconds=ms)
        # Mid from integers stays exact: (ask+bid) / (2*divisor).
        mid = Decimal(ask + bid) / Decimal(2 * divisor)
        ticks.append((when, mid, Decimal(repr(ask_vol)) + Decimal(repr(bid_vol))))
    return ticks


def _dukascopy_candles(fetch_bytes, symbol, interval, start, end):
    if symbol not in DUKASCOPY_DIVISORS:
        raise _err("market.symbol_unsupported")
    if start is None or end is None or end <= start:
        raise _err("market.invalid_window")
    hour = start.replace(minute=0, second=0, microsecond=0)
    if end - hour > timedelta(hours=_MAX_DUKAS_HOURS):
        raise _err("market.window_too_large")
    divisor = DUKASCOPY_DIVISORS[symbol]
    bucket_seconds = INTERVAL_SECONDS[interval]
    buckets: dict[int, dict] = {}
    while hour < end:
        url = (
            "https://datafeed.dukascopy.com/datafeed/"
            f"{symbol}/{hour.year}/{hour.month - 1:02d}/{hour.day:02d}/{hour.hour:02d}h_ticks.bi5"
        )
        for when, mid, volume in _parse_bi5(fetch_bytes(url), hour, divisor):
            if when < start or when >= end:
                continue
            epoch = int(when.timestamp())
            key = epoch - (epoch % bucket_seconds)
            bucket = buckets.get(key)
            if bucket is None:
                buckets[key] = {
                    "open": mid,
                    "high": mid,
                    "low": mid,
                    "close": mid,
                    "volume": volume,
                }
            else:
                bucket["high"] = max(bucket["high"], mid)
                bucket["low"] = min(bucket["low"], mid)
                bucket["close"] = mid
                bucket["volume"] += volume
        hour += timedelta(hours=1)
    return [
        {
            "source": "dukascopy",
            "symbol": symbol,
            "interval": interval,
            "openTimeMs": key * 1000,
            "open": format(b["open"], "f"),
            "high": format(b["high"], "f"),
            "low": format(b["low"], "f"),
            "close": format(b["close"], "f"),
            "volume": format(b["volume"], "f"),
            "priceBasis": "mid",
            "volumeUnits": "provider-float32-sum",
            "exactness": "integer-tick-derived",
        }
        for key, b in sorted(buckets.items())
    ]


# ---------------------------------------------------------------------------
# MetaTrader 5 on this PC (already-running, already-logged-in terminal)
# ---------------------------------------------------------------------------


def _mt5_symbol(raw):
    if not isinstance(raw, str):
        raise _err("market.invalid_symbol")
    symbol = raw.strip()
    if NATIVE_SYMBOL_PATTERN.fullmatch(symbol) is None:
        raise _err("market.invalid_symbol")
    return symbol


def _hyperliquid_symbol(raw):
    if not isinstance(raw, str) or _HYPERLIQUID_SYMBOL_RE.fullmatch(raw.strip()) is None:
        raise _err("market.invalid_symbol")
    return raw.strip()


def _default_mt5_adapter():
    from services.connector_mt5 import MT5Adapter

    return MT5Adapter()


def _mt5_call(mt5_adapter_factory, method, *args, binding=None):
    from services.connector_adapters import AdapterError

    adapter = (mt5_adapter_factory or _default_mt5_adapter)()
    try:
        if binding is None:
            return getattr(adapter, method)(*args)
        return getattr(adapter, method)(*args, binding=binding)
    except AdapterError as exc:
        code = getattr(exc, "code", "")
        if code in (
            "connector.selected_terminal_not_running",
            "connector.terminal_offline",
            "connector.terminal_attach_failed",
            "connector.terminal_identity_mismatch",
        ):
            raise _err("market.terminal_not_running", 409) from None
        if code == "connector.symbol_unavailable":
            raise _err("market.symbol_unknown", 404) from None
        if code == "connector.market_history_unavailable":
            raise _err("market.terminal_history_unavailable", 409) from None
        if code == "connector.optional_sdk_unavailable":
            raise _err("market.provider_unreachable", 502) from None
        if code == "connector.account_identity_mismatch":
            raise _err("market.account_changed", 409) from None
        if code == "connector.terminal_not_allowlisted":
            raise _err("connector.terminal_not_allowlisted", 409) from None
        raise _err("market.provider_payload", 502) from None


def _mt5_candles(symbol, interval, limit, mt5_adapter_factory, binding):
    rows = _mt5_call(
        mt5_adapter_factory,
        "market_candles",
        symbol,
        INTERVAL_SECONDS[interval],
        limit,
        binding=binding,
    )
    return [
        {
            "source": "mt5",
            "symbol": symbol,
            "interval": interval,
            # Preserve the terminal's raw coordinate. Its UTC interpretation
            # requires native evidence before time-sensitive use.
            "openTimeMs": row["rawProviderOpenTimeMs"],
            "rawProviderOpenTimeMs": row["rawProviderOpenTimeMs"],
            "open": _decimal_text(row["open"], provider="mt5"),
            "high": _decimal_text(row["high"], provider="mt5"),
            "low": _decimal_text(row["low"], provider="mt5"),
            "close": _decimal_text(row["close"], provider="mt5"),
            "volume": _decimal_text(row["tickVolume"], provider="mt5"),
            "volumeMeaning": "tick-count",
            "priceDigits": row.get("priceDigits"),
            "timeBasis": row["timeBasis"],
            "receivedAt": row.get("receivedAt"),
            "clockPolicy": "native-read-only",
            "utcAlignmentVerified": False,
            "exactness": "provider-float",
        }
        for row in rows
    ]


def _mt5_quote(symbol, mt5_adapter_factory, binding):
    row = _mt5_call(mt5_adapter_factory, "market_quote", symbol, binding=binding)
    bid = Decimal(_decimal_text(row["bid"], provider="mt5"))
    ask = Decimal(_decimal_text(row["ask"], provider="mt5"))
    return {
        "source": "mt5",
        "symbol": symbol,
        "price": format((bid + ask) / Decimal(2), "f"),
        "bid": format(bid, "f"),
        "ask": format(ask, "f"),
        "priceBasis": "mid",
        "priceDigits": row.get("priceDigits"),
        "rawProviderTimeMsc": row["rawProviderTimeMsc"],
        "observedSkewSeconds": row["observedSkewSeconds"],
        "receivedAt": row["receivedAt"],
        "timeBasis": row["timeBasis"],
        "observedAtMs": None,
    }


# ---------------------------------------------------------------------------
# OANDA (client's own token; never stored or logged here)
# ---------------------------------------------------------------------------

_OANDA_HOSTS = {
    "practice": "https://api-fxpractice.oanda.com",
    "live": "https://api-fxtrade.oanda.com",
}
_OANDA_INTERVALS = {"1m": "M1", "5m": "M5", "15m": "M15", "1h": "H1", "4h": "H4", "1d": "D"}


class OandaFeed:
    """Read-only OANDA candles/pricing with the client's own token."""

    def __init__(self, token, environment="practice", fetch=None):
        if not token or not isinstance(token, str):
            raise _err("market.credentials_required", 409)
        if environment not in _OANDA_HOSTS:
            raise _err("market.invalid_environment")
        self._host = _OANDA_HOSTS[environment]
        self._headers = {"Authorization": f"Bearer {token}"}
        self._fetch = fetch or default_fetch_json

    def _get(self, path, params):
        return self._fetch(f"{self._host}{path}", params, self._headers)

    def candles(self, symbol, interval, limit):
        granularity = _venue_interval(_OANDA_INTERVALS, interval)
        payload = self._get(
            f"/v3/instruments/{symbol}/candles",
            {"granularity": granularity, "count": limit, "price": "M"},
        )
        rows = _rows(payload, "candles")
        out = []
        for row in rows:
            mid = row.get("mid") if isinstance(row, dict) else None
            when = row.get("time") if isinstance(row, dict) else None
            if not isinstance(mid, dict) or not isinstance(when, str):
                raise _err("market.provider_payload", 502)
            try:
                stamp = datetime.fromisoformat(when.replace("Z", "+00:00"))
            except ValueError:
                raise _err("market.provider_payload", 502) from None
            out.append(
                _candle(
                    "oanda",
                    symbol,
                    interval,
                    int(stamp.timestamp() * 1000),
                    mid.get("o"),
                    mid.get("h"),
                    mid.get("l"),
                    mid.get("c"),
                    row.get("volume", 0),
                    priceBasis="mid",
                    complete=bool(row.get("complete")),
                    exactness="provider-text",
                )
            )
        return out

    def quote(self, symbol, account_id):
        if not account_id:
            raise _err("market.account_required", 409)
        payload = self._get(f"/v3/accounts/{account_id}/pricing", {"instruments": symbol})
        rows = _rows(payload, "prices")
        if not rows:
            raise _err("market.symbol_unknown", 404)
        row = rows[0]
        bids, asks = row.get("bids") or [], row.get("asks") or []
        if not bids or not asks:
            raise _err("market.provider_payload", 502)
        bid = Decimal(_decimal_text(bids[0].get("price"), provider="oanda"))
        ask = Decimal(_decimal_text(asks[0].get("price"), provider="oanda"))
        mid = (bid + ask) / Decimal(2)
        return {
            "source": "oanda",
            "symbol": symbol,
            "price": format(mid, "f"),
            "bid": format(bid, "f"),
            "ask": format(ask, "f"),
            "priceBasis": "mid",
            "observedAt": row.get("time"),
            "tradeable": bool(row.get("tradeable")),
        }


# ---------------------------------------------------------------------------
# Public service surface
# ---------------------------------------------------------------------------


def list_providers():
    out = []
    for provider in MARKET_PROVIDERS.values():
        entry = dict(provider)
        entry["intervals"] = list(provider["intervals"])
        entry["chartIntervals"] = list(
            provider.get(
                "chartIntervals", provider["intervals"] if provider.get("directChart") else ()
            )
        )
        entry["directChart"] = bool(entry["chartIntervals"])
        if provider["id"] == "dukascopy":
            entry["supportedSymbols"] = sorted(DUKASCOPY_DIVISORS)
        out.append(entry)
    return out


def _parse_instant(raw):
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise _err("market.invalid_window")
    try:
        stamp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise _err("market.invalid_window") from None
    if stamp.tzinfo is None:
        raise _err("market.invalid_window")
    return stamp.astimezone(UTC)


def get_candles(
    provider,
    symbol,
    interval="1h",
    limit=100,
    start=None,
    end=None,
    *,
    oanda_token=None,
    oanda_environment="practice",
    fetch=None,
    fetch_bytes=None,
    mt5_adapter_factory=None,
    post=None,
    now_ms=None,
    binding=None,
):
    provider = (provider or "").strip().lower()
    interval = _interval(interval)
    limit = _limit(limit)
    fetch = fetch or default_fetch_json
    if provider == "mt5":
        return _mt5_candles(_mt5_symbol(symbol), interval, limit, mt5_adapter_factory, binding)
    if provider in _CRYPTO_CANDLES:
        return _CRYPTO_CANDLES[provider](fetch, _symbol(symbol), interval, limit)
    if provider == "hyperliquid":
        if now_ms is None:
            now_ms = int(datetime.now(UTC).timestamp() * 1000)
        return _hyperliquid_candles(
            post or default_post_json, _hyperliquid_symbol(symbol), interval, limit, now_ms
        )
    symbol = _symbol(symbol)
    if provider == "dukascopy":
        return _dukascopy_candles(
            fetch_bytes or default_fetch_bytes,
            symbol,
            interval,
            _parse_instant(start),
            _parse_instant(end),
        )
    if provider == "oanda":
        return OandaFeed(oanda_token, oanda_environment, fetch=fetch).candles(
            symbol, interval, limit
        )
    raise _err("market.provider_unsupported")


# ---------------------------------------------------------------------------
# Venue symbol lists (chart search). Public instrument directories are
# large and change rarely, so parsed rows are cached briefly per venue;
# the cache holds public data only, never anything keyed.
# ---------------------------------------------------------------------------

_SYMBOL_CACHE: dict[str, tuple[float, list[dict]]] = {}
_SYMBOL_CACHE_TTL = 300.0


def _symbol_key(value):
    return re.sub(r"[^A-Za-z0-9]", "", value or "").upper()


def _ranked_symbols(rows, query, limit):
    needle = _symbol_key(query)
    matched = []
    seen = set()
    for row in rows:
        symbol = row.get("symbol")
        if not isinstance(symbol, str) or not symbol or symbol in seen:
            continue
        seen.add(symbol)
        normalized = _symbol_key(symbol)
        if needle and needle not in normalized:
            continue
        rank = 0 if normalized == needle else 1 if normalized.startswith(needle) else 2
        matched.append((rank, len(normalized), symbol, row))
    matched.sort(key=lambda item: (item[0], item[1], item[2]))
    return [item[3] for item in matched[:limit]]


def _pair_rows(rows, symbol_key, base_key, quote_key, *, status_key=None, live_values=()):
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if status_key and live_values and row.get(status_key) not in live_values:
            continue
        symbol = row.get(symbol_key)
        if not isinstance(symbol, str) or not symbol:
            continue
        base, quote = row.get(base_key), row.get(quote_key)
        name = f"{base}/{quote}" if isinstance(base, str) and isinstance(quote, str) else symbol
        out.append({"symbol": symbol, "name": name})
    return out


def _crypto_symbol_rows(provider, fetch, post):
    if provider == "binance":
        payload = fetch("https://api.binance.com/api/v3/exchangeInfo", {})
        return _pair_rows(
            _rows(payload, "symbols"),
            "symbol",
            "baseAsset",
            "quoteAsset",
            status_key="status",
            live_values=("TRADING",),
        )
    if provider == "bybit":
        rows, cursor = [], None
        for _page in range(3):
            params = {"category": "spot", "limit": 1000}
            if cursor:
                params["cursor"] = cursor
            payload = fetch("https://api.bybit.com/v5/market/instruments-info", params)
            result = payload.get("result") if isinstance(payload, dict) else None
            if not isinstance(result, dict):
                raise _err("market.provider_payload", 502)
            rows.extend(_rows(result, "list"))
            cursor = result.get("nextPageCursor")
            if not cursor:
                break
        return _pair_rows(
            rows, "symbol", "baseCoin", "quoteCoin", status_key="status", live_values=("Trading",)
        )
    if provider == "coinbase":
        payload = fetch("https://api.exchange.coinbase.com/products", {})
        out = []
        for row in _rows(payload):
            if not isinstance(row, dict) or row.get("status") not in (None, "online"):
                continue
            symbol = row.get("id")
            if isinstance(symbol, str) and symbol:
                out.append({"symbol": symbol, "name": row.get("display_name") or symbol})
        return out
    if provider == "okx":
        payload = fetch("https://www.okx.com/api/v5/public/instruments", {"instType": "SPOT"})
        return _pair_rows(
            _rows(payload, "data"),
            "instId",
            "baseCcy",
            "quoteCcy",
            status_key="state",
            live_values=("live",),
        )
    if provider == "bitget":
        payload = fetch("https://api.bitget.com/api/v2/spot/public/symbols", {})
        return _pair_rows(
            _rows(payload, "data"),
            "symbol",
            "baseCoin",
            "quoteCoin",
            status_key="status",
            live_values=("online",),
        )
    if provider == "kraken":
        payload = fetch("https://api.kraken.com/0/public/AssetPairs", {})
        result = payload.get("result") if isinstance(payload, dict) else None
        if not isinstance(result, dict):
            raise _err("market.provider_payload", 502)
        out = []
        for row in result.values():
            if not isinstance(row, dict):
                continue
            symbol = row.get("altname")
            # .d pairs are dark-pool duplicates of the lit pair.
            if isinstance(symbol, str) and symbol and not symbol.endswith(".d"):
                out.append({"symbol": symbol, "name": row.get("wsname") or symbol})
        return out
    if provider == "hyperliquid":
        payload = post("https://api.hyperliquid.xyz/info", {"type": "meta"})
        universe = payload.get("universe") if isinstance(payload, dict) else None
        if not isinstance(universe, list):
            raise _err("market.provider_payload", 502)
        return [
            {"symbol": row["name"], "name": f"{row['name']} perpetual"}
            for row in universe
            if isinstance(row, dict) and isinstance(row.get("name"), str) and row["name"]
        ]
    raise _err("market.symbols_unsupported")


def list_symbols(
    provider,
    query="",
    limit=100,
    *,
    mt5_adapter_factory=None,
    fetch=None,
    post=None,
    clock=None,
    binding=None,
):
    """Venue-native symbols for chart search.

    MT5 returns the broker's own list (native names with prefixes/
    suffixes preserved); crypto venues return their public spot
    directories (Hyperliquid: perpetuals). Providers without a public
    list report ``market.symbols_unsupported`` honestly; the chart
    then accepts an exact typed venue symbol instead of a list pick.
    """
    provider = (provider or "").strip().lower()
    if not isinstance(query, str) or len(query) > (80 if provider == "mt5" else 64):
        raise _err("market.invalid_query")
    limit = _limit(limit)
    if limit > 200:
        limit = 200
    if provider == "mt5":
        rows = _mt5_call(mt5_adapter_factory, "market_symbols", query, limit, binding=binding)
        return [
            {
                "symbol": row["symbol"],
                "exchange": "MT5",
                "name": row.get("description") or row["symbol"],
                "digits": row.get("digits"),
            }
            for row in rows
        ]
    if provider in _CRYPTO_CANDLES or provider == "hyperliquid":
        now = clock() if clock is not None else time.monotonic()
        cached = _SYMBOL_CACHE.get(provider)
        if cached is None or now - cached[0] > _SYMBOL_CACHE_TTL:
            rows = _crypto_symbol_rows(
                provider, fetch or default_fetch_json, post or default_post_json
            )
            _SYMBOL_CACHE[provider] = (now, rows)
        else:
            rows = cached[1]
        return [
            {**row, "exchange": provider.upper()} for row in _ranked_symbols(rows, query, limit)
        ]
    if provider in MARKET_PROVIDERS:
        raise _err("market.symbols_unsupported")
    raise _err("market.provider_unsupported")


def get_account_snapshot(
    provider,
    *,
    mt5_adapter_factory=None,
    history_days=7,
    history_limit=200,
    include_history=True,
    binding=None,
):
    """Live account books for the chart dock (MT5 terminal account).

    Balance, equity, margin, open positions and pending orders are read-only.
    The requested history adds separate bounded order and deal books.
    """
    provider = (provider or "").strip().lower()
    if type(history_days) is not int or not 1 <= history_days <= 90:
        raise _err("market.invalid_window")
    if type(history_limit) is not int or not 1 <= history_limit <= 500:
        raise _err("market.invalid_limit")
    if type(include_history) is not bool:
        raise _err("request.invalid")
    if provider == "mt5":
        return _mt5_call(
            mt5_adapter_factory,
            "account_snapshot",
            history_days,
            history_limit,
            include_history,
            binding,
        )
    if provider in MARKET_PROVIDERS:
        raise _err("market.account_unsupported")
    raise _err("market.provider_unsupported")


def get_quote(
    provider,
    symbol,
    *,
    oanda_token=None,
    oanda_environment="practice",
    oanda_account=None,
    fetch=None,
    mt5_adapter_factory=None,
    post=None,
    binding=None,
):
    provider = (provider or "").strip().lower()
    fetch = fetch or default_fetch_json
    if provider == "mt5":
        return _mt5_quote(_mt5_symbol(symbol), mt5_adapter_factory, binding)
    if provider in _CRYPTO_CANDLES:
        return _crypto_quote(fetch, provider, _symbol(symbol))
    if provider == "hyperliquid":
        return _hyperliquid_quote(post or default_post_json, _hyperliquid_symbol(symbol))
    if provider == "dukascopy":
        raise _err("market.quote_unsupported")
    if provider == "oanda":
        return OandaFeed(oanda_token, oanda_environment, fetch=fetch).quote(
            _symbol(symbol), oanda_account
        )
    raise _err("market.provider_unsupported")
