"""Pure bounded overlap plan; a plan never asserts provider coverage."""

from datetime import datetime, timedelta

from services.connector_history import instant

OVERLAP_SECONDS = 300
MAX_WINDOW_DAYS = 7


def suggested_window(history, observed_at):
    target = datetime.fromisoformat(instant(observed_at).replace("Z", "+00:00"))
    cursor = history.get("cursor") or {}
    if cursor.get("nativeCursor"):
        return dict(cursor["window"])
    through = cursor.get("observedThrough")
    if through:
        start = datetime.fromisoformat(instant(through).replace("Z", "+00:00")) - timedelta(
            seconds=OVERLAP_SECONDS
        )
        if start >= target:
            start = target - timedelta(seconds=OVERLAP_SECONDS)
        end = min(start + timedelta(days=MAX_WINDOW_DAYS), target)
    elif history.get("coverage"):
        # An unverified source clock or incomplete page proves no new high-water mark.
        previous = history["coverage"][-1]
        return {key: previous[key] for key in ("from", "to")}
    else:
        start, end = target - timedelta(days=1), target
    return {
        "from": start.isoformat().replace("+00:00", "Z"),
        "to": end.isoformat().replace("+00:00", "Z"),
    }
