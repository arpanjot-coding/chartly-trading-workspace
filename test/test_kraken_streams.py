"""P08-T04 stream protocol: official CRC32 vector, gaps, freshness, private decode."""

import json
import zlib

import pytest

from services.connector_adapters import AdapterError
from services.connector_history import empty_history, merge_history
from services.kraken_streams import (
    BookTracker,
    FreshnessTracker,
    SequenceTracker,
    book_checksum,
    classify,
    decode_balances,
    decode_book_message,
    decode_executions,
    decode_ohlc,
    decode_ticker,
    decode_trades,
    decode_ws_message,
)

# Official worked example from Kraken's book checksum guide.
DOC_BIDS = [
    ("45283.5", "0.10000000"),
    ("45283.4", "1.54582015"),
    ("45282.1", "0.10000000"),
    ("45281.0", "0.10000000"),
    ("45280.3", "1.54592586"),
    ("45279.0", "0.07990000"),
    ("45277.6", "0.03310103"),
    ("45277.5", "0.30000000"),
    ("45277.3", "1.54602737"),
    ("45276.6", "0.15445238"),
]
DOC_ASKS = [
    ("45285.2", "0.00100000"),
    ("45286.4", "1.54571953"),
    ("45286.6", "1.54571109"),
    ("45289.6", "1.54560911"),
    ("45290.2", "0.15890660"),
    ("45291.8", "1.54553491"),
    ("45294.7", "0.04454749"),
    ("45296.1", "0.35380000"),
    ("45297.5", "0.09945542"),
    ("45299.5", "0.18772827"),
]


def _levels(pairs):
    return [{"price": price, "qty": qty} for price, qty in pairs]


def test_book_checksum_matches_official_worked_example():
    assert book_checksum(DOC_BIDS, DOC_ASKS) == 3310070434


def test_book_snapshot_verifies_and_update_removes_zero_qty_level():
    trackers = {}
    snapshot = {
        "channel": "book",
        "type": "snapshot",
        "data": [
            {
                "symbol": "BTC/USD",
                "bids": _levels(DOC_BIDS),
                "asks": _levels(DOC_ASKS),
                "checksum": 3310070434,
            }
        ],
    }
    [book] = decode_book_message(decode_ws_message(json.dumps(snapshot)), trackers)
    assert book["checksumVerified"] is True
    assert book["bids"][0] == {"price": "45283.5", "qty": "0.10000000"}

    # Remove the best bid; expected checksum derived here directly from the
    # documented string algorithm over the remaining top levels.
    remaining_bids = DOC_BIDS[1:]
    asks_text = "".join(
        p.replace(".", "").lstrip("0") + q.replace(".", "").lstrip("0") for p, q in DOC_ASKS
    )
    bids_text = "".join(
        p.replace(".", "").lstrip("0") + q.replace(".", "").lstrip("0") for p, q in remaining_bids
    )
    expected = zlib.crc32((asks_text + bids_text).encode()) & 0xFFFFFFFF
    update = {
        "channel": "book",
        "type": "update",
        "data": [
            {
                "symbol": "BTC/USD",
                "bids": [{"price": "45283.5", "qty": "0"}],
                "asks": [],
                "checksum": expected,
            }
        ],
    }
    [book] = decode_book_message(decode_ws_message(json.dumps(update)), trackers)
    assert book["bids"][0]["price"] == "45283.4"
    assert len(book["bids"]) == 9


def test_book_checksum_mismatch_latches_resync_until_snapshot():
    tracker = BookTracker("BTC/USD")
    tracker.apply(
        {
            "_type": "snapshot",
            "symbol": "BTC/USD",
            "bids": _levels(DOC_BIDS),
            "asks": _levels(DOC_ASKS),
            "checksum": "3310070434",
        }
    )
    with pytest.raises(AdapterError) as caught:
        tracker.apply(
            {"_type": "update", "symbol": "BTC/USD", "bids": [], "asks": [], "checksum": "42"}
        )
    assert caught.value.code == "kraken.book_checksum_mismatch"
    with pytest.raises(AdapterError) as caught:
        tracker.apply({"_type": "update", "symbol": "BTC/USD", "bids": [], "asks": []})
    assert caught.value.code == "kraken.book_resync_required"


def test_sequence_tracker_baseline_ok_gap_duplicate():
    tracker = SequenceTracker()
    assert tracker.observe(8) == "baseline"
    assert tracker.observe(9) == "ok"
    assert tracker.observe(11) == "gap"
    assert tracker.observe(11) == "duplicate"
    assert tracker.observe(12) == "ok"


def test_freshness_labels():
    tracker = FreshnessTracker(stale_after_seconds=5, dead_after_seconds=30)
    assert tracker.state("2026-11-04T12:00:00Z") == "dead"
    tracker.note("2026-11-04T12:00:00Z")
    assert tracker.state("2026-11-04T12:00:04Z") == "live"
    assert tracker.state("2026-11-04T12:00:20Z") == "stale"
    assert tracker.state("2026-11-04T12:01:00Z") == "dead"


def test_public_decoders_keep_exact_text():
    ticker = decode_ws_message(
        json.dumps(
            {
                "channel": "ticker",
                "type": "snapshot",
                "data": [
                    {
                        "symbol": "BTC/USD",
                        "bid": 60123.4,
                        "ask": 60124.0,
                        "last": 60123.9,
                        "timestamp": "2026-11-04T12:00:00.123456Z",
                    }
                ],
            }
        )
    )
    [row] = decode_ticker(ticker)
    assert row["bid"] == "60123.4" and row["ask"] == "60124.0"
    trades = decode_ws_message(
        json.dumps(
            {
                "channel": "trade",
                "type": "update",
                "data": [
                    {
                        "symbol": "BTC/USD",
                        "trade_id": 12345,
                        "side": "buy",
                        "price": 60123.4,
                        "qty": 0.005,
                        "timestamp": "2026-11-04T12:00:01Z",
                    }
                ],
            }
        )
    )
    [trade] = decode_trades(trades)
    assert trade["tradeId"] == 12345 and trade["qty"] == "0.005"
    candles = decode_ws_message(
        json.dumps(
            {
                "channel": "ohlc",
                "type": "update",
                "data": [
                    {
                        "symbol": "BTC/USD",
                        "interval": 1,
                        "timestamp": "2026-11-04T12:00:00Z",
                        "open": 100.0,
                        "high": 101.0,
                        "low": 99.5,
                        "close": 100.5,
                        "volume": 2.5,
                        "trades": 7,
                    }
                ],
            }
        )
    )
    [candle] = decode_ohlc(candles)
    assert candle["close"] == "100.5" and candle["trades"] == 7


def test_executions_decode_to_mergeable_events_and_track_sequence():
    message = decode_ws_message(
        json.dumps(
            {
                "channel": "executions",
                "type": "update",
                "sequence": 8,
                "data": [
                    {
                        "exec_type": "trade",
                        "order_status": "filled",
                        "exec_id": "TFILL1",
                        "order_id": "ORD1",
                        "symbol": "BTC/USD",
                        "side": "buy",
                        "last_price": 60123.4,
                        "last_qty": 0.005,
                        "cum_cost": 300.617,
                        "fees": [{"asset": "USD", "qty": 0.481}],
                        "timestamp": "2026-11-04T08:00:00.250000Z",
                    },
                    {
                        "exec_type": "new",
                        "order_status": "new",
                        "order_id": "ORD2",
                        "symbol": "BTC/USD",
                        "side": "sell",
                        "timestamp": "2026-11-04T08:01:00Z",
                    },
                ],
            }
        )
    )
    events, state = decode_executions(message, SequenceTracker())
    assert state == "baseline"
    fill, order = events
    assert fill["kind"] == "fill" and fill["externalEventId"] == "TFILL1"
    assert fill["payload"]["fees"] == [{"asset": "USD", "amount": "0.481"}]
    assert order["kind"] == "order" and order["status"] == "unknown"
    page = {
        "providerId": "kraken",
        "adapterVersion": "test",
        "identity": {"externalId": "k"},
        "window": {"from": "2026-11-04T00:00:00Z", "to": "2026-11-05T00:00:00Z"},
        "cursor": None,
        "nextCursor": None,
        "events": events,
        "hasMore": False,
        "complete": True,
        "coverage": {
            "from": "2026-11-04T00:00:00Z",
            "to": "2026-11-05T00:00:00Z",
            "complete": True,
            "observedAt": "2026-11-04T12:00:00Z",
        },
    }
    merged = merge_history(
        empty_history(),
        page,
        {
            "providerId": "kraken",
            "connectionId": "connection_k1",
            "accountKey": "account_k1",
            "receivedAt": "2026-11-04T12:00:00Z",
        },
    )
    history = merged["history"] if "history" in merged else merged
    assert len(history["observations"]) == 2


def test_balances_snapshot_state_and_ledger_updates():
    sequences = SequenceTracker()
    snapshot = decode_ws_message(
        json.dumps(
            {
                "channel": "balances",
                "type": "snapshot",
                "sequence": 1,
                "data": [
                    {"asset": "USD", "balance": 1000.5, "wallets": [{"type": "spot", "balance": 1000.5}]}
                ],
            }
        )
    )
    state, events, seq = decode_balances(snapshot, sequences)
    assert state == {"USD": "1000.5"} and events == [] and seq == "baseline"
    update = decode_ws_message(
        json.dumps(
            {
                "channel": "balances",
                "type": "update",
                "sequence": 2,
                "data": [
                    {
                        "asset": "USD",
                        "amount": -300.617,
                        "balance": 699.883,
                        "ledger_id": "L99",
                        "type": "trade",
                        "timestamp": "2026-11-04T08:00:01Z",
                    }
                ],
            }
        )
    )
    state, events, seq = decode_balances(update, sequences)
    assert seq == "ok"
    assert events[0]["externalEventId"] == "L99"
    assert events[0]["payload"]["amount"] == "-300.617"


def test_classify_and_malformed_messages_fail_closed():
    assert classify({"channel": "heartbeat"}) == "heartbeat"
    assert classify({"channel": "status"}) == "status"
    with pytest.raises(AdapterError):
        classify({"channel": "surprise"})
    with pytest.raises(AdapterError):
        decode_ws_message(b'{"channel": "ticker", "channel": "trade"}')
    with pytest.raises(AdapterError):
        decode_ws_message(b"not json")
