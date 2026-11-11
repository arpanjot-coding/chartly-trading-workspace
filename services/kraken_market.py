"""Finite public market data for owned previews; no private account or order API."""

from __future__ import annotations

import csv
import json
import re
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from io import StringIO

from services.workspace_storage import WorkspaceError

BASE = "https://api.kraken.com/0/public/"
MAX_BYTES = 4 * 1024 * 1024
MAX_INSTRUMENTS = 10000
MAX_CANDLES = 720
INTERVALS = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "D": 1440}


def _error(code, status=502):
    raise WorkspaceError("dataset.kraken_" + code, status)


def _text(value, maximum=100):
    return (
        isinstance(value, str)
        and 0 < len(value) <= maximum
        and not any(ord(char) < 32 for char in value)
    )


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _error("invalid_response")
        result[key] = value
    return result


def fetch_public(endpoint, params):
    if endpoint not in {"AssetPairs", "OHLC"}:
        _error("invalid_request", 400)
    from utils.httpx_client import get_httpx_client

    try:
        with get_httpx_client().stream(
            "GET", BASE + endpoint, params=params, timeout=10, follow_redirects=False
        ) as response:
            if response.status_code == 429:
                _error("rate_limited", 429)
            if response.status_code != 200:
                _error("unavailable", 503)
            content = bytearray()
            for chunk in response.iter_bytes(chunk_size=16384):
                content.extend(chunk)
                if len(content) > MAX_BYTES:
                    _error("response_budget", 413)
            value = json.loads(content, object_pairs_hook=_unique)
    except WorkspaceError:
        raise
    except Exception:
        _error("unavailable", 503)
    if (
        isinstance(value, dict)
        and isinstance(value.get("error"), list)
        and any(
            isinstance(error, str)
            and error.startswith(("EAPI:Rate limit exceeded", "EService:Throttled"))
            for error in value["error"]
        )
    ):
        _error("rate_limited", 429)
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("error"), list)
        or value["error"]
        or not isinstance(value.get("result"), dict)
    ):
        _error("invalid_response")
    return value["result"]


def decode_instruments(result):
    if not isinstance(result, dict) or len(result) > MAX_INSTRUMENTS:
        _error("response_budget", 413)
    instruments = []
    for native, value in result.items():
        if not isinstance(value, dict) or not _text(native) or not _text(value.get("altname")):
            _error("invalid_response")
        # This source supports online spot pairs only, never dark pools/tokenized equities.
        if value.get("status") != "online" or value.get("aclass_base") != "currency":
            continue
        name = value.get("wsname")
        if not _text(name) or name.count("/") != 1 or native.endswith(".d"):
            continue
        base, quote = name.split("/")
        if not all(re.fullmatch(r"[A-Z][A-Z0-9]{1,11}", token) for token in (base, quote)):
            continue
        # Data Library/replay requires a declared currency with at least three characters.
        if len(quote) < 3:
            continue
        instruments.append(
            {"id": native, "symbol": name, "base": base, "quote": quote, "alias": value["altname"]}
        )
    return sorted(instruments, key=lambda value: (value["symbol"], value["id"]))


def instruments(query="", limit=50, *, fetcher=fetch_public):
    if (
        not isinstance(query, str)
        or len(query) > 80
        or any(ord(char) < 32 for char in query)
        or type(limit) is not int
        or not 1 <= limit <= 50
    ):
        _error("invalid_request", 400)
    rows = decode_instruments(fetcher("AssetPairs", {}))
    query = query.strip().upper()
    found = [
        row
        for row in rows
        if query in (row["symbol"] + " " + row["id"] + " " + row["alias"]).upper()
    ]
    return {
        "sourceId": "kraken-public",
        "instruments": found[:limit],
        "matched": len(found),
        "intervals": list(INTERVALS),
    }


def _number(value, *, positive=False):
    if not isinstance(value, str) or len(value) > 100 or not re.fullmatch(r"\d+(?:\.\d+)?", value):
        _error("invalid_candle")
    try:
        number = Decimal(value)
    except InvalidOperation:
        _error("invalid_candle")
    if (
        not number.is_finite()
        or number > Decimal("1e39")
        or number.as_tuple().exponent < -24
        or positive
        and number <= 0
    ):
        _error("invalid_candle")
    return value


def decode_candles(result, instrument, interval, received_at):
    if not isinstance(interval, str) or interval not in INTERVALS:
        _error("interval_not_supported", 400)
    if not isinstance(result, dict):
        _error("invalid_response")
    keys = set(result) - {"last"}
    allowed = {instrument["id"], instrument["alias"], instrument["symbol"]}
    if len(keys) != 1 or not keys <= allowed:
        _error("instrument_mismatch")
    rows = result[next(iter(keys))]
    if not isinstance(rows, list) or len(rows) > MAX_CANDLES + 1:
        _error("response_budget", 413)
    if len(rows) < 2:
        _error("no_closed_candles", 409)
    seconds = INTERVALS[interval] * 60
    previous = -1
    closed = []
    for index, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != 8:
            _error("invalid_candle")
        stamp = row[0]
        if (
            type(stamp) is not int
            or not 0 < stamp < 253402300799
            or stamp % seconds
            or stamp <= previous
        ):
            _error("invalid_candle")
        previous = stamp
        prices = [_number(value, positive=True) for value in row[1:5]]
        _number(row[5])  # Native VWAP remains validated even though CSV omits it.
        volume = _number(row[6])
        if type(row[7]) is not int or row[7] < 0:
            _error("invalid_candle")
        opening, high, low, closing = map(Decimal, prices)
        if high < max(opening, closing, low) or low > min(opening, closing):
            _error("invalid_candle")
        if index == len(rows) - 1:
            continue  # Provider explicitly says its final row is not committed.
        if stamp + seconds > received_at.timestamp() + 5:
            _error("future_closed_candle")
        closed.append([stamp, *prices, volume])
    stream = StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(("timestamp", "open", "high", "low", "close", "volume"))
    writer.writerows(closed)
    return stream.getvalue(), {
        "provider": "kraken-public",
        "receivedAt": received_at.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "nativePair": instrument["id"],
        "symbol": instrument["symbol"],
        "interval": interval,
        "returnedFirst": closed[0][0],
        "returnedLast": closed[-1][0],
        "closedRows": len(closed),
        "excludedUnfinished": 1,
        "maxEntries": MAX_CANDLES,
        "scope": "Recent public spot candles only; no private account, full historical backfill or execution.",
    }


def preview(library, expected_revision, pair, interval, *, fetcher=fetch_public, clock=None):
    if not _text(pair) or not isinstance(interval, str) or interval not in INTERVALS:
        _error("invalid_request", 400)
    # A stale library request cannot trigger network activity or stage another owner's data.
    with library.engine.connect() as connection:
        library._check_revision(connection, expected_revision)
    rows = decode_instruments(fetcher("AssetPairs", {"pair": pair}))
    selected = next((row for row in rows if row["id"] == pair), None)
    if selected is None:
        _error("instrument_unavailable", 409)
    result = fetcher("OHLC", {"pair": selected["id"], "interval": INTERVALS[interval]})
    received = (clock or (lambda: datetime.now(UTC)))().astimezone(UTC)
    csv_text, observation = decode_candles(result, selected, interval, received)
    mapping = {
        "version": 1,
        "columns": {key: key for key in ("timestamp", "open", "high", "low", "close", "volume")},
        "timestampFormat": "seconds",
        "timezone": "UTC",
        "delimiter": ",",
        "decimalSeparator": ".",
        "timestampMeaning": "open",
    }
    context = {
        "name": "Kraken " + selected["symbol"] + " " + interval,
        "provider": "kraken-public",
        "symbol": selected["symbol"],
        "exchange": "KRAKEN",
        "interval": interval,
        "currency": selected["quote"],
        "priceBasis": "raw",
        "adjustment": "none",
        "volumeMeaning": "units",
        "allowNegativePrices": False,
        "calendar": {
            "id": "continuous",
            "timezone": "UTC",
            "sessions": [{"weekdays": list(range(7)), "open": "00:00", "close": "24:00"}],
            "exceptions": {},
        },
    }
    return library.preview_import(
        expected_revision, csv_text, mapping, context, source_observation=observation
    )
