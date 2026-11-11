"""Frozen calendar/publication semantics independent from frontend replay."""

from copy import deepcopy

import pytest

from services.paper_market import market_window
from services.workspace_storage import WorkspaceError


def fixture():
    source = {
        "start": 1793610000,
        "end": 1793610120,
        "createdAt": "2026-11-03T00:00:00Z",
        "metadata": {
            "interval": "1m",
            "adjustment": "none",
            "priceBasis": "raw",
            "calendar": {"id": "unknown", "timezone": "UTC", "sessions": [], "exceptions": {}},
        },
    }
    bars = [
        {
            "timestamp": 1793610000 + n * 60,
            "open": "100",
            "high": "102",
            "low": "98",
            "close": "101",
        }
        for n in range(3)
    ]
    return source, {"rangeStart": "2026-11-02", "rangeEnd": "2026-11-02"}, bars


def test_native_bar_close_unknown_gap_and_window_are_explicit():
    version, run, bars = fixture()
    result, window = market_window(version, run, bars)
    assert result[0]["availableAt"] == bars[0]["timestamp"] + 60
    assert window["firstAvailableAt"] == result[0]["availableAt"] and window["count"] == 3
    version["end"] += 60
    bars[2]["timestamp"] += 60
    result, _ = market_window(version, run, bars)
    assert result[2]["gap"]["kind"] == "unknown" and result[2]["gap"]["missingCount"] is None


def test_immutable_unconfirmed_tail_never_executes_using_later_wall_clock():
    version, run, bars = fixture()
    version["createdAt"] = "2026-11-02T09:02:30Z"
    result, window = market_window(version, run, bars)
    assert len(result) == 2 and window["to"] == bars[1]["timestamp"]


@pytest.mark.parametrize(
    "change",
    [{"adjustment": "split"}, {"priceBasis": "adjusted"}, {"interval": "D"}, {"interval": "1M"}],
)
def test_unsupported_timing_and_revised_prices_are_not_substituted(change):
    version, run, bars = fixture()
    version["metadata"].update(change)
    with pytest.raises(WorkspaceError):
        market_window(version, run, bars)


def test_declared_short_session_clips_last_candle_and_refuses_outside_session():
    version, run, bars = fixture()
    version["metadata"]["calendar"] = {
        "id": "short",
        "timezone": "UTC",
        "sessions": [{"weekdays": [0], "open": "09:00", "close": "09:02"}],
        "exceptions": {},
    }
    with pytest.raises(WorkspaceError, match="outside_declared_session"):
        market_window(version, run, bars)
    result, _ = market_window(version, run, bars[:2])
    assert result[-1]["availableAt"] == 1793610120
