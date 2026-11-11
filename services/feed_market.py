"""Feed candles -> owned Data Library previews (replay/paper history).

Mirrors ``services.kraken_market`` strictness for the feeds in
``services.market_feeds``: the library revision is checked before any
network or terminal activity, only *closed* candles are staged,
timestamps must be aligned and strictly increasing, OHLC must be sane
exact decimals, and nothing is zero-filled or invented.

MT5 is a special case. Its native timestamp alignment remains unverified,
so it cannot enter the UTC Data Library through this bridge. Tick age
cannot establish the historical server timezone. OANDA remains excluded because
its client token must never cross the workspace-worker boundary or be persisted
with a job.
"""

from __future__ import annotations

import csv
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from io import StringIO

from services.market_feeds import INTERVAL_SECONDS, MARKET_PROVIDERS, get_candles
from services.workspace_storage import WorkspaceError

MAX_CANDLES = 1000
_SCOPES = {
    "dukascopy": "Free Dukascopy historical ticks aggregated to mid-price candles; no live quotes or execution.",
    "hyperliquid": "Recent public perpetual-contract candles (derivative prices, not spot); no account, funding history or execution.",
}
_DEFAULT_SCOPE = (
    "Recent public spot candles only; no private account, full historical backfill or execution."
)


def _error(code, status=400):
    raise WorkspaceError("dataset.feed_" + code, status)


def _decimal(value, *, positive=False):
    if not isinstance(value, str) or len(value) > 100:
        _error("invalid_candle", 502)
    try:
        number = Decimal(value)
    except InvalidOperation:
        _error("invalid_candle", 502)
    if not number.is_finite() or positive and number <= 0 or not positive and number < 0:
        _error("invalid_candle", 502)
    return number


def _closed_rows(candles, interval, received_at):
    seconds = INTERVAL_SECONDS[interval]
    rows = []
    excluded = 0
    previous = -1
    now = received_at.timestamp()
    for candle in candles:
        stamp_ms = candle.get("openTimeMs") if isinstance(candle, dict) else None
        if type(stamp_ms) is not int:
            _error("invalid_candle", 502)
        if stamp_ms % (seconds * 1000):
            _error("invalid_candle", 502)
        stamp = stamp_ms // 1000
        if stamp <= previous:
            _error("invalid_candle", 502)
        previous = stamp
        opening = _decimal(candle.get("open"), positive=True)
        high = _decimal(candle.get("high"), positive=True)
        low = _decimal(candle.get("low"), positive=True)
        closing = _decimal(candle.get("close"), positive=True)
        _decimal(candle.get("volume"))
        if high < max(opening, closing, low) or low > min(opening, closing):
            _error("invalid_candle", 502)
        if stamp + seconds > now + 5:
            excluded += 1  # Still forming (or future-dated): never staged.
            continue
        rows.append(
            [
                stamp,
                candle["open"],
                candle["high"],
                candle["low"],
                candle["close"],
                candle["volume"],
            ]
        )
    if len(rows) < 2:
        _error("no_closed_candles", 409)
    return rows, excluded


def preview(
    library,
    expected_revision,
    provider,
    symbol,
    interval,
    limit=500,
    start=None,
    end=None,
    *,
    feed=None,
    clock=None,
):
    capabilities = MARKET_PROVIDERS.get(provider)
    if not capabilities or capabilities["historyImport"] not in ("available", "clock-unverified"):
        _error("provider_not_supported")
    if interval not in capabilities["intervals"]:
        _error("interval_not_supported")
    # A stale library request cannot trigger network activity.
    with library.engine.connect() as connection:
        library._check_revision(connection, expected_revision)
    if capabilities["historyImport"] == "clock-unverified":
        _error("time_unverified", 409)
    candles = (feed or get_candles)(provider, symbol, interval, limit, start, end)
    if not isinstance(candles, list) or len(candles) > MAX_CANDLES:
        _error("response_budget", 413)
    received = (clock or (lambda: datetime.now(UTC)))().astimezone(UTC)
    rows, excluded = _closed_rows(candles, interval, received)

    stream = StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(("timestamp", "open", "high", "low", "close", "volume"))
    writer.writerows(rows)

    label = "OKX" if provider == "okx" else provider.capitalize()
    provider_id = f"{provider}-public"
    native_symbol = symbol.strip() if provider == "hyperliquid" else symbol.strip().upper()
    calendar = {
        "id": "fx-week" if provider == "dukascopy" else "continuous",
        "timezone": "UTC",
        "sessions": [
            {
                "weekdays": [0, 1, 2, 3, 4] if provider == "dukascopy" else list(range(7)),
                "open": "00:00",
                "close": "24:00",
            }
        ],
        "exceptions": {},
    }
    context = {
        "name": f"{label} {native_symbol} {interval}",
        "provider": provider_id,
        "symbol": native_symbol,
        "exchange": provider.upper(),
        "interval": interval,
        "priceBasis": "raw",
        "adjustment": "none",
        "volumeMeaning": "units",
        "allowNegativePrices": False,
        "calendar": calendar,
    }
    if provider == "dukascopy":
        context["currency"] = symbol.upper()[-3:]
    mapping = {
        "version": 1,
        "columns": {key: key for key in ("timestamp", "open", "high", "low", "close", "volume")},
        "timestampFormat": "seconds",
        "timezone": "UTC",
        "delimiter": ",",
        "decimalSeparator": ".",
        "timestampMeaning": "open",
    }
    scope = _SCOPES.get(provider, _DEFAULT_SCOPE)
    observation = {
        "provider": provider_id,
        "receivedAt": received.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "nativePair": native_symbol,
        "symbol": native_symbol,
        "interval": interval,
        "returnedFirst": rows[0][0],
        "returnedLast": rows[-1][0],
        "closedRows": len(rows),
        "excludedUnfinished": excluded,
        "maxEntries": MAX_CANDLES,
        "scope": scope,
    }
    return library.preview_import(
        expected_revision, stream.getvalue(), mapping, context, source_observation=observation
    )
