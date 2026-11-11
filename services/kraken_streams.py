"""Pure Kraken WebSocket v2 stream protocol layer (P08-T04).

Decodes public and authenticated messages into exact-text observations,
maintains a CRC32-verified order book, tracks subscription sequences and
freshness. This module owns no socket: the live lifecycle (connect,
token refresh, resubscribe) is a separate integration slice, and REST
history remains the accounting authority. Private decoders return
owner-scoped observations only; nothing here broadcasts them.
"""

from __future__ import annotations

import re
import zlib
from decimal import Decimal, InvalidOperation

from services.connector_adapters import AdapterError, instant
from services.connector_kraken import decode_json_exact

MAX_MESSAGE_BYTES = 1024 * 1024
MAX_ROWS = 500
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")


def _invalid(code="invalid_stream_message", status=502):
    return AdapterError("kraken." + code, status)


def _decimal_text(value, *, positive=False):
    if not isinstance(value, str) or not _DECIMAL_TEXT.fullmatch(value):
        raise _invalid()
    try:
        parsed = Decimal(value)
    except InvalidOperation:
        raise _invalid() from None
    if not parsed.is_finite() or (positive and parsed <= 0):
        raise _invalid()
    return value


def _text(value, maximum=200):
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise _invalid()
    return value


def _sequence(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,19}", value):
        raise _invalid()
    return int(value)


def _timestamp(value):
    try:
        stamp = instant(value)
    except AdapterError:
        raise _invalid() from None
    return stamp.isoformat(timespec="microseconds").replace("+00:00", "Z")


def decode_ws_message(raw):
    if isinstance(raw, str):
        raw = raw.encode()
    if not isinstance(raw, (bytes, bytearray)) or len(raw) > MAX_MESSAGE_BYTES:
        raise _invalid("stream_message_budget", 413)
    value = decode_json_exact(bytes(raw))
    if not isinstance(value, dict):
        raise _invalid()
    return value


def classify(message):
    channel = message.get("channel")
    if channel == "heartbeat":
        return "heartbeat"
    if channel == "status":
        return "status"
    if message.get("method") in {"subscribe", "unsubscribe", "ping", "pong"}:
        return "acknowledgement"
    if channel in {"ticker", "trade", "ohlc", "book", "instrument", "executions", "balances"}:
        return channel
    raise _invalid("unknown_stream_channel")


# ---------------------------------------------------------------------------
# Order book with Kraken CRC32 checksum (top 10 levels, asks then bids)
# ---------------------------------------------------------------------------


def _checksum_field(text):
    return text.replace(".", "").lstrip("0")


def book_checksum(bids, asks):
    """bids/asks: iterables of (price_text, qty_text) already in book order."""
    asks_text = "".join(
        _checksum_field(price) + _checksum_field(qty) for price, qty in list(asks)[:10]
    )
    bids_text = "".join(
        _checksum_field(price) + _checksum_field(qty) for price, qty in list(bids)[:10]
    )
    return zlib.crc32((asks_text + bids_text).encode()) & 0xFFFFFFFF


class BookTracker:
    """One symbol's book. A checksum failure latches `needs_resync`."""

    def __init__(self, symbol, depth=10):
        if depth not in (10, 25, 100, 500, 1000):
            raise _invalid("invalid_book_depth", 400)
        self.symbol = symbol
        self.depth = depth
        self._bids = {}
        self._asks = {}
        self.needs_resync = True

    def _rows(self, side):
        items = sorted(side.items(), key=lambda item: item[0])
        return items

    def _ordered(self):
        bids = [
            (price_text, qty) for _d, (price_text, qty) in sorted(self._bids.items(), reverse=True)
        ]
        asks = [(price_text, qty) for _d, (price_text, qty) in sorted(self._asks.items())]
        return bids, asks

    def _apply_side(self, book, levels):
        if not isinstance(levels, list) or len(levels) > 1100:
            raise _invalid()
        for level in levels:
            if not isinstance(level, dict):
                raise _invalid()
            price = _decimal_text(level.get("price"), positive=True)
            qty = _decimal_text(level.get("qty"))
            key = Decimal(price)
            if Decimal(qty) == 0:
                book.pop(key, None)
            else:
                book[key] = (price, qty)

    def _truncate(self):
        for book, reverse in ((self._bids, True), (self._asks, False)):
            if len(book) > self.depth:
                keep = sorted(book, reverse=reverse)[: self.depth]
                for key in list(book):
                    if key not in keep:
                        del book[key]

    def apply(self, row):
        if not isinstance(row, dict) or row.get("symbol") != self.symbol:
            raise _invalid()
        message_type = row.get("_type", "update")
        if message_type == "snapshot":
            self._bids, self._asks = {}, {}
            self.needs_resync = False
        elif self.needs_resync:
            raise _invalid("book_resync_required", 409)
        self._apply_side(self._bids, row.get("bids", []))
        self._apply_side(self._asks, row.get("asks", []))
        self._truncate()
        checksum = row.get("checksum")
        if checksum is not None:
            expected = _sequence(checksum) if isinstance(checksum, str) else checksum
            bids, asks = self._ordered()
            if type(expected) is not int or book_checksum(bids, asks) != expected:
                self.needs_resync = True
                raise _invalid("book_checksum_mismatch", 409)
        bids, asks = self._ordered()
        return {
            "symbol": self.symbol,
            "bids": [{"price": price, "qty": qty} for price, qty in bids],
            "asks": [{"price": price, "qty": qty} for price, qty in asks],
            "checksumVerified": checksum is not None,
        }


def decode_book_message(message, trackers):
    """Apply one book channel message to per-symbol trackers (created lazily)."""
    rows = message.get("data")
    if not isinstance(rows, list) or not rows or len(rows) > MAX_ROWS:
        raise _invalid()
    results = []
    for row in rows:
        if not isinstance(row, dict):
            raise _invalid()
        symbol = _text(row.get("symbol"), 40)
        tracker = trackers.setdefault(symbol, BookTracker(symbol))
        results.append(tracker.apply({**row, "_type": message.get("type", "update")}))
    return results


# ---------------------------------------------------------------------------
# Sequence and freshness tracking
# ---------------------------------------------------------------------------


class SequenceTracker:
    """Detects gaps in a subscription sequence. First value is the baseline."""

    def __init__(self):
        self._last = None

    def observe(self, sequence):
        value = _sequence(sequence) if isinstance(sequence, str) else sequence
        if type(value) is not int or value < 0:
            raise _invalid()
        if self._last is None:
            self._last = value
            return "baseline"
        if value == self._last + 1:
            self._last = value
            return "ok"
        if value <= self._last:
            return "duplicate"
        self._last = value
        return "gap"

    def reset(self):
        self._last = None


class FreshnessTracker:
    """Live/stale/dead labels from injected time; heartbeats count as contact."""

    def __init__(self, *, stale_after_seconds=5, dead_after_seconds=30):
        self.stale_after = stale_after_seconds
        self.dead_after = dead_after_seconds
        self._last_contact = None

    def note(self, at_iso):
        self._last_contact = instant(at_iso)

    def state(self, at_iso):
        if self._last_contact is None:
            return "dead"
        age = (instant(at_iso) - self._last_contact).total_seconds()
        if age <= self.stale_after:
            return "live"
        if age <= self.dead_after:
            return "stale"
        return "dead"


# ---------------------------------------------------------------------------
# Public market decoders
# ---------------------------------------------------------------------------


def _data_rows(message):
    rows = message.get("data")
    if not isinstance(rows, list) or len(rows) > MAX_ROWS:
        raise _invalid()
    return rows


def decode_ticker(message):
    out = []
    for row in _data_rows(message):
        if not isinstance(row, dict):
            raise _invalid()
        out.append(
            {
                "symbol": _text(row.get("symbol"), 40),
                "bid": _decimal_text(row.get("bid"), positive=True),
                "ask": _decimal_text(row.get("ask"), positive=True),
                "last": _decimal_text(row.get("last"), positive=True),
                "timestamp": _timestamp(row.get("timestamp")),
            }
        )
    return out


def decode_trades(message):
    out = []
    for row in _data_rows(message):
        if not isinstance(row, dict):
            raise _invalid()
        side = row.get("side")
        if side not in {"buy", "sell"}:
            raise _invalid()
        out.append(
            {
                "symbol": _text(row.get("symbol"), 40),
                "tradeId": _sequence(row.get("trade_id")),
                "side": side,
                "price": _decimal_text(row.get("price"), positive=True),
                "qty": _decimal_text(row.get("qty"), positive=True),
                "timestamp": _timestamp(row.get("timestamp")),
            }
        )
    return out


def decode_ohlc(message):
    out = []
    for row in _data_rows(message):
        if not isinstance(row, dict):
            raise _invalid()
        out.append(
            {
                "symbol": _text(row.get("symbol"), 40),
                "interval": _sequence(row.get("interval")),
                "begin": _timestamp(row.get("timestamp")),
                "open": _decimal_text(row.get("open"), positive=True),
                "high": _decimal_text(row.get("high"), positive=True),
                "low": _decimal_text(row.get("low"), positive=True),
                "close": _decimal_text(row.get("close"), positive=True),
                "volume": _decimal_text(row.get("volume")),
                "trades": _sequence(row.get("trades")),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Private executions/balances decoders (owner-scoped observations)
# ---------------------------------------------------------------------------

_ORDER_STATUS = {
    "filled": "confirmed",
    "canceled": "cancelled",
    "expired": "cancelled",
    "partially_filled": "partial",
}


def decode_executions(message, sequences: SequenceTracker):
    """Return (events, sequence_state). REST remains the accounting authority."""
    sequence_state = sequences.observe(message.get("sequence"))
    events = []
    for row in _data_rows(message):
        if not isinstance(row, dict):
            raise _invalid()
        exec_type = _text(row.get("exec_type"), 40)
        order_status = _text(row.get("order_status"), 40)
        order_id = _text(row.get("order_id"), 80)
        occurred = _timestamp(row.get("timestamp"))
        payload = {
            "symbol": _text(row.get("symbol"), 40),
            "side": row.get("side")
            if row.get("side") in {"buy", "sell"}
            else _text(row.get("side"), 10),
            "orderId": order_id,
            "execType": exec_type,
            "nativeStatus": order_status,
        }
        if exec_type == "trade":
            exec_id = row.get("exec_id")
            if not isinstance(exec_id, str) or not exec_id:
                raise _invalid()
            payload.update(
                {
                    "lastPrice": _decimal_text(row.get("last_price"), positive=True),
                    "lastQty": _decimal_text(row.get("last_qty"), positive=True),
                    "cumCost": _decimal_text(row.get("cum_cost")),
                    "fees": [
                        {
                            "asset": _text(fee.get("asset"), 20),
                            "amount": _decimal_text(fee.get("qty")),
                        }
                        for fee in row.get("fees", [])
                        if isinstance(fee, dict)
                    ],
                }
            )
            if len(payload["fees"]) != len(row.get("fees", [])):
                raise _invalid()
            events.append(
                {
                    "externalEventId": exec_id,
                    "kind": "fill",
                    "status": "confirmed",
                    "occurredAt": occurred,
                    "timeBasis": "provider",
                    "payload": payload,
                }
            )
        else:
            events.append(
                {
                    "externalEventId": f"{order_id}:{exec_type}:{occurred}",
                    "kind": "order",
                    "status": _ORDER_STATUS.get(order_status, "unknown"),
                    "occurredAt": occurred,
                    "timeBasis": "provider",
                    "payload": payload,
                }
            )
    return events, sequence_state


def decode_balances(message, sequences: SequenceTracker):
    """Return (state, events, sequence_state).

    Snapshot rows define current balances; update rows carry a ledger id
    and become balance observations. Neither is a journal fact.
    """
    sequence_state = sequences.observe(message.get("sequence"))
    state = {}
    events = []
    for row in _data_rows(message):
        if not isinstance(row, dict):
            raise _invalid()
        asset = _text(row.get("asset"), 20)
        balance = _decimal_text(row.get("balance"))
        state[asset] = balance
        ledger_id = row.get("ledger_id")
        if isinstance(ledger_id, str) and ledger_id:
            events.append(
                {
                    "externalEventId": ledger_id,
                    "kind": "balance",
                    "status": "confirmed",
                    "occurredAt": _timestamp(row.get("timestamp")),
                    "timeBasis": "provider",
                    "payload": {
                        "asset": asset,
                        "amount": _decimal_text(row.get("amount")),
                        "balance": balance,
                        "type": _text(row.get("type"), 40),
                    },
                }
            )
    return state, events, sequence_state
