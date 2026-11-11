"""Coverage and overlap expectations independent of the transport/registry."""

from datetime import datetime

import pytest

from services.connector_history import empty_history
from services.connector_sync_plan import suggested_window


def test_no_checkpoint_suggests_one_day_not_all_history():
    assert suggested_window(empty_history(), "2026-11-03T12:00:00Z") == {
        "from": "2026-11-02T12:00:00Z",
        "to": "2026-11-03T12:00:00Z",
    }


def test_incomplete_native_cursor_repeats_exact_saved_window():
    history = empty_history()
    history["cursor"] = {
        "nativeCursor": "page_2",
        "window": {"from": "2026-10-01T00:00:00Z", "to": "2026-10-02T00:00:00Z"},
    }
    assert suggested_window(history, "2026-11-03T12:00:00Z") == history["cursor"]["window"]


def test_unverified_clock_does_not_invent_a_continuation_cursor():
    history = empty_history()
    history["coverage"] = [
        {
            "from": "2026-11-01T00:00:00Z",
            "to": "2026-11-02T00:00:00Z",
            "complete": False,
            "reason": "provider_clock_unverified",
        }
    ]
    assert suggested_window(history, "2026-11-03T12:00:00Z") == {
        "from": "2026-11-01T00:00:00Z",
        "to": "2026-11-02T00:00:00Z",
    }
    assert history["cursor"] is None


@pytest.mark.parametrize(
    "through,now,end",
    [
        ("2026-11-02T00:00:00Z", "2026-11-03T12:00:00Z", "2026-11-03T12:00:00Z"),
        ("2026-09-02T00:00:00Z", "2026-11-03T12:00:00Z", "2026-09-08T23:55:00Z"),
    ],
)
def test_completed_coverage_resumes_with_five_minute_overlap_and_seven_day_cap(through, now, end):
    history = empty_history()
    history["cursor"] = {
        "nativeCursor": None,
        "window": {"from": "2026-09-01T00:00:00Z", "to": through},
        "observedThrough": through,
    }
    result = suggested_window(history, now)
    delta = datetime.fromisoformat(through.replace("Z", "+00:00")) - datetime.fromisoformat(
        result["from"].replace("Z", "+00:00")
    )
    assert delta.total_seconds() == 300 and result["to"] == end


def test_future_checkpoint_cannot_suggest_future_read():
    history = empty_history()
    history["cursor"] = {"observedThrough": "2028-01-01T00:00:00Z", "nativeCursor": None}
    assert suggested_window(history, "2026-11-03T12:00:00Z") == {
        "from": "2026-11-03T11:55:00Z",
        "to": "2026-11-03T12:00:00Z",
    }
