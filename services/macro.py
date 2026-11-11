"""Macro series with vintages, calendar and transformations (P15).

An observation is immutable: {seriesId, period, value (exact text),
retrievedAt (the vintage stamp), source}. A revised print is a new
observation for the same period with a later retrievedAt; as-of
selection picks the newest vintage that existed at that time, so
history is never rewritten. Transformations label their formula and
never interpolate or align frequencies by invention — alignment joins
on exact shared periods only.
"""

from __future__ import annotations

from decimal import Decimal, localcontext
from zoneinfo import ZoneInfo

SERIES_UNIVERSE = {
    "CUSR0000SA0": {
        "title": "Consumer Price Index for All Urban Consumers (seasonally adjusted)",
        "provider": "bls",
        "frequency": "monthly",
        "unit": "index 1982-84=100",
    },
    "LNS14000000": {
        "title": "Unemployment Rate (seasonally adjusted)",
        "provider": "bls",
        "frequency": "monthly",
        "unit": "percent",
    },
    "PAYEMS": {
        "title": "All Employees, Total Nonfarm (BLS CES via BLS series CES0000000001)",
        "provider": "bls",
        "frequency": "monthly",
        "unit": "thousands of persons",
        "nativeSeriesId": "CES0000000001",
    },
    "WPSFD4": {
        "title": "Producer Price Index, Final Demand (not seasonally adjusted)",
        "provider": "bls",
        "frequency": "monthly",
        "unit": "index Nov 2009=100",
    },
}


def select_vintage(observations, *, as_of):
    """Latest value per (series, period) whose vintage existed at as_of."""
    chosen = {}
    for row in observations:
        if row["retrievedAt"] > as_of:
            continue
        key = (row["seriesId"], row["period"])
        if key not in chosen or row["retrievedAt"] > chosen[key]["retrievedAt"]:
            chosen[key] = row
    return [chosen[key] for key in sorted(chosen)]


def series_points(observations, series_id, *, as_of):
    rows = [row for row in select_vintage(observations, as_of=as_of) if row["seriesId"] == series_id]
    return sorted(rows, key=lambda row: row["period"])


def transform(points, kind, *, base_period=None):
    """levels|change|pct_change|rebase100 with formula labels."""
    labels = {
        "levels": "as published",
        "change": "value[t] - value[t-1]",
        "pct_change": "100 * (value[t] / value[t-1] - 1)",
        "rebase100": "100 * value[t] / value[base]",
    }
    if kind not in labels:
        raise ValueError("macro.transform_unsupported")
    out = []
    with localcontext() as context:
        context.prec = 50
        base_value = None
        if kind == "rebase100":
            base = next((row for row in points if row["period"] == base_period), None)
            if base is None:
                return {"transform": kind, "formula": labels[kind], "points": [], "unavailable": "base_period_missing"}
            base_value = Decimal(base["value"])
            if base_value == 0:
                return {"transform": kind, "formula": labels[kind], "points": [], "unavailable": "zero_denominator"}
        previous = None
        for row in points:
            value = Decimal(row["value"])
            if kind == "levels":
                result = value
            elif kind == "change":
                result = None if previous is None else value - previous
            elif kind == "pct_change":
                result = None if previous in (None, Decimal(0)) else 100 * (value / previous - 1)
            else:
                result = 100 * value / base_value
            out.append(
                {
                    "period": row["period"],
                    "value": format(result.normalize(), "f") if result is not None else None,
                }
            )
            previous = value
    return {"transform": kind, "formula": labels[kind], "points": out}


def align(points_a, points_b):
    """Exact-period join only; unmatched periods are reported, not filled."""
    by_b = {row["period"]: row["value"] for row in points_b}
    matched, only_a = [], []
    for row in points_a:
        if row["period"] in by_b:
            matched.append({"period": row["period"], "a": row["value"], "b": by_b[row["period"]]})
        else:
            only_a.append(row["period"])
    only_b = [row["period"] for row in points_b if row["period"] not in {m["period"] for m in matched}]
    return {"matched": matched, "onlyA": only_a, "onlyB": only_b, "interpolated": False}


# ---------------------------------------------------------------------------
# Release calendar (T03) and tracking (T06)
# ---------------------------------------------------------------------------

RELEASE_STATES = {"scheduled", "confirmed", "cancelled", "released"}


def calendar_entry(release, display_zone):
    """release: {id, title, seriesId, scheduledAt (ISO with offset),
    sourceZone, state, actual, prior, revised} — consensus is a gated
    provider field and is reported as such, never guessed."""
    if release["state"] not in RELEASE_STATES:
        raise ValueError("macro.release_state_invalid")
    from datetime import datetime

    when = datetime.fromisoformat(release["scheduledAt"].replace("Z", "+00:00"))
    return {
        "id": release["id"],
        "title": release["title"],
        "seriesId": release.get("seriesId"),
        "state": release["state"],
        "scheduledAtSource": release["scheduledAt"],
        "sourceZone": release["sourceZone"],
        "displayZone": display_zone,
        "scheduledAtDisplay": when.astimezone(ZoneInfo(display_zone)).isoformat(),
        "actual": release.get("actual"),
        "prior": release.get("prior"),
        "revised": release.get("revised"),
        "consensus": {"status": "unavailable", "reason": "capability-gated provider addition; no source configured"},
    }


def due_notifications(releases, watched_series, *, now, already_notified):
    """Local notifications for watched releases; deduped by release id.

    Delivery requires the local app/worker to be running — there is no
    server push in this architecture (stated in every notice)."""
    out = []
    for release in releases:
        if release.get("seriesId") not in watched_series:
            continue
        if release["id"] in already_notified:
            continue
        if release["state"] == "released" and release["scheduledAt"] <= now:
            out.append(
                {
                    "releaseId": release["id"],
                    "title": release["title"],
                    "actual": release.get("actual"),
                    "prior": release.get("prior"),
                    "note": "Local notice generated while the app is running; nothing is sent when it is closed.",
                }
            )
    return out


def evidence_snapshot(observations, *, as_of, series_ids):
    """Point-in-time macro evidence for notebooks/reviews (T08)."""
    snapshot = {}
    for series_id in series_ids:
        points = series_points(observations, series_id, as_of=as_of)
        snapshot[series_id] = {
            "asOf": as_of,
            "points": [
                {"period": row["period"], "value": row["value"], "vintage": row["retrievedAt"]}
                for row in points
            ],
            "source": points[0]["source"] if points else None,
        }
    return snapshot
