"""Frozen native candle availability for historical paper execution; no live feeds."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from services.chart_context import run_window
from services.dataset_quality import INTERVAL_SECONDS, _calendar_windows, _gap
from services.workspace_storage import WorkspaceError


def market_window(version, run, raw_bars, *, branch_from=None):
    metadata = version["metadata"]
    interval = metadata["interval"]
    if interval not in INTERVAL_SECONDS or metadata.get("adjustment") != "none":
        raise WorkspaceError("paper.unsupported_history")
    if metadata.get("priceBasis") != "raw":
        raise WorkspaceError("paper.unsupported_history")
    start, end = run_window(run)
    start = max(version["start"], start if start is not None else version["start"])
    if branch_from is not None:
        start = max(start, branch_from)
    end = min(version["end"] + 0.000001, end if end is not None else version["end"] + 0.000001)
    if start >= end:
        raise WorkspaceError("paper.empty_window", 409)
    try:
        publication = datetime.fromisoformat(
            version["createdAt"].replace("Z", "+00:00")
        ).timestamp()
        calendar = metadata["calendar"]
        zone = ZoneInfo(calendar["timezone"])
        duration = INTERVAL_SECONDS[interval]
        windows_cache = {}

        def windows(day):
            if day not in windows_cache:
                windows_cache[day] = _calendar_windows(day, calendar)
            return windows_cache[day]

        bars = []
        gap_budget = [36600]
        previous = None
        for row in raw_bars:
            at = row["timestamp"]
            if not start <= at < end:
                continue
            close = at + duration
            if calendar["id"] != "unknown":
                day = datetime.fromtimestamp(at, UTC).astimezone(zone).date()
                ranges = windows(day)
                if interval == "D":
                    if not ranges:
                        raise WorkspaceError("paper.calendar_unavailable")
                    close = max(item[1] for item in ranges) / 1_000_000
                else:
                    prior = windows(day - timedelta(days=1)) if day.year > 1 else []
                    if ranges is None or prior is None:
                        raise WorkspaceError("paper.calendar_unavailable")
                    containing = [
                        b / 1_000_000 for a, b in ranges + prior if a <= at * 1_000_000 < b
                    ]
                    if not containing:
                        raise WorkspaceError("paper.outside_declared_session")
                    close = min(close, max(containing))
            elif interval == "D":
                raise WorkspaceError("paper.calendar_unavailable")
            if close <= at:
                raise WorkspaceError("paper.noncausal_calendar", 409)
            if close > publication:
                continue  # an immutable unconfirmed tail never becomes confirmed with wall time
            bar = {
                "index": len(bars),
                "time": at,
                "availableAt": close,
                **{key: row[key] for key in ("open", "high", "low", "close")},
            }
            if previous is not None:
                if at < previous["availableAt"]:
                    raise WorkspaceError("paper.overlapping_observations")
                present, missing = _gap(
                    int(previous["time"] * 1_000_000),
                    int(at * 1_000_000),
                    calendar,
                    interval,
                    gap_budget,
                )
                if present:
                    bar["gap"] = {
                        "kind": "unknown"
                        if missing is None
                        else "missing"
                        if missing
                        else "declared_closure",
                        "missingCount": missing,
                        "from": previous["time"],
                        "to": at,
                    }
            bars.append(bar)
            previous = bar
        if not 2 <= len(bars) <= 50000:
            raise WorkspaceError("paper.confirmed_history_required", 409)
        return bars, {
            "from": bars[0]["time"],
            "to": bars[-1]["time"],
            "count": len(bars),
            "firstAvailableAt": bars[0]["availableAt"],
            "lastAvailableAt": bars[-1]["availableAt"],
        }
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        raise WorkspaceError("paper.calendar_unavailable") from error
