"""Feed -> Data Library preview bridge tests (no network)."""

from contextlib import contextmanager
from datetime import UTC, datetime

import pytest

from services import feed_market
from services.workspace_storage import WorkspaceError

NOW = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)
HOUR = 3600 * 1000
BASE = int(datetime(2026, 11, 4, 8, 0, tzinfo=UTC).timestamp() * 1000)


class FakeLibrary:
    def __init__(self):
        self.captured = None
        self.checked = []

    @property
    def engine(self):
        class Engine:
            @contextmanager
            def connect(self):
                yield object()

        return Engine()

    def _check_revision(self, connection, revision):
        self.checked.append(revision)

    def preview_import(self, revision, csv_text, mapping, context, source_observation=None):
        self.captured = {
            "revision": revision,
            "csv": csv_text,
            "mapping": mapping,
            "context": context,
            "observation": source_observation,
        }
        return {"preview": "staged"}


def _candle(open_ms, o="100.0", h="110.0", low="90.0", c="105.0", v="12.5"):
    return {
        "openTimeMs": open_ms,
        "open": o,
        "high": h,
        "low": low,
        "close": c,
        "volume": v,
        "source": "binance",
        "symbol": "BTCUSDT",
        "interval": "1h",
    }


def _feed(candles):
    def feed(provider, symbol, interval, limit, start=None, end=None):
        return list(candles)

    return feed


def test_preview_stages_closed_candles_only_with_exact_context():
    library = FakeLibrary()
    candles = [
        _candle(BASE),
        _candle(BASE + HOUR),
        _candle(BASE + 2 * HOUR),
        _candle(BASE + 4 * HOUR),
    ]  # last opens 12:00 == NOW: still forming
    out = feed_market.preview(
        library, 7, "binance", "BTCUSDT", "1h", feed=_feed(candles), clock=lambda: NOW
    )
    assert out == {"preview": "staged"}
    assert library.checked == [7]
    lines = library.captured["csv"].strip().splitlines()
    assert lines[0] == "timestamp,open,high,low,close,volume"
    assert len(lines) == 4  # header + 3 closed
    obs = library.captured["observation"]
    assert obs["closedRows"] == 3 and obs["excludedUnfinished"] == 1
    assert obs["provider"] == "binance-public" and obs["nativePair"] == "BTCUSDT"
    ctx = library.captured["context"]
    assert ctx["exchange"] == "BINANCE" and ctx["calendar"]["id"] == "continuous"
    assert "currency" not in ctx


def test_dukascopy_context_declares_fx_week_and_currency():
    library = FakeLibrary()
    candles = [_candle(BASE), _candle(BASE + HOUR), _candle(BASE + 2 * HOUR)]
    feed_market.preview(
        library, 1, "dukascopy", "EURUSD", "1h", feed=_feed(candles), clock=lambda: NOW
    )
    ctx = library.captured["context"]
    assert ctx["calendar"]["id"] == "fx-week"
    assert ctx["calendar"]["sessions"][0]["weekdays"] == [0, 1, 2, 3, 4]
    assert ctx["currency"] == "USD"
    assert library.captured["observation"]["provider"] == "dukascopy-public"


def test_unclosed_only_and_bad_shapes_fail_closed():
    library = FakeLibrary()
    with pytest.raises(WorkspaceError) as exc:
        feed_market.preview(
            library,
            1,
            "binance",
            "BTCUSDT",
            "1h",
            feed=_feed([_candle(BASE + 4 * HOUR)]),
            clock=lambda: NOW,
        )
    assert exc.value.code == "dataset.feed_no_closed_candles"

    bad = _candle(BASE, h="80.0")  # high below open/close
    with pytest.raises(WorkspaceError) as exc:
        feed_market.preview(
            library,
            1,
            "binance",
            "BTCUSDT",
            "1h",
            feed=_feed([bad, _candle(BASE + HOUR)]),
            clock=lambda: NOW,
        )
    assert exc.value.code == "dataset.feed_invalid_candle"

    with pytest.raises(WorkspaceError) as exc:
        feed_market.preview(library, 1, "oanda", "EUR_USD", "1h", feed=_feed([]), clock=lambda: NOW)
    assert exc.value.code == "dataset.feed_provider_not_supported"
    assert library.captured is None


def _mt5_candle(open_ms, skew=7199.2):
    candle = _candle(open_ms, o="1.10000", h="1.10100", low="1.09900", c="1.10050", v="321")
    candle.update(
        {
            "source": "mt5",
            "symbol": "EURUSDm",
            "observedSkewSeconds": skew,
            "timeBasis": "provider-epoch-unverified",
            "utcAlignmentVerified": False,
        }
    )
    return candle


@pytest.mark.parametrize("interval", ["1m", "1h", "4h", "1d"])
@pytest.mark.parametrize("skew", [0, -10800, 7199.2, 5400, None])
def test_mt5_preview_rejects_unverified_time_before_reading_terminal(interval, skew):
    library = FakeLibrary()
    candles = [_mt5_candle(BASE + n * HOUR, skew=skew) for n in range(2)]
    called = []

    def feed(*args):
        called.append(args)
        return candles

    with pytest.raises(WorkspaceError) as exc:
        feed_market.preview(library, 3, "mt5", "EURUSDm", interval, feed=feed, clock=lambda: NOW)
    assert exc.value.code == "dataset.feed_time_unverified"
    assert library.checked == [3] and called == []
    assert library.captured is None


def test_revision_checked_before_any_feed_call():
    class StaleLibrary(FakeLibrary):
        def _check_revision(self, connection, revision):
            raise WorkspaceError("dataset.revision_conflict", 409)

    called = []

    def feed(*args):
        called.append(args)
        return []

    with pytest.raises(WorkspaceError):
        feed_market.preview(
            StaleLibrary(), 99, "binance", "BTCUSDT", "1h", feed=feed, clock=lambda: NOW
        )
    assert called == []
