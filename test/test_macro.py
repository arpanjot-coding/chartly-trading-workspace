"""P15: BLS mapping, vintages, transforms, calendar zones, tracking."""

import json

from services.bls_adapter import fetch_series, map_series
from services.macro import (
    align,
    calendar_entry,
    due_notifications,
    evidence_snapshot,
    select_vintage,
    series_points,
    transform,
)

V1 = "2026-10-15T12:30:00Z"
V2 = "2026-11-14T12:30:00Z"


def _payload(value="336.298"):
    return {
        "status": "REQUEST_SUCCEEDED",
        "Results": {
            "series": [
                {
                    "seriesID": "CUSR0000SA0",
                    "data": [
                        {"year": "2026", "period": "M09", "value": value},
                        {"year": "2026", "period": "M08", "value": "335.100"},
                        {"year": "2026", "period": "M13", "value": "334.000"},
                        {"year": "2026", "period": "M07", "value": "-"},
                    ],
                }
            ]
        },
    }


def test_bls_mapping_separates_annual_average_and_skips_missing():
    result = map_series(_payload(), retrieved_at=V1)
    assert result["skipped"] == 1
    by_period = {(row["seriesId"], row["period"]): row for row in result["observations"]}
    assert by_period[("CUSR0000SA0", "2026-09")]["value"] == "336.298"
    assert ("CUSR0000SA0:annual", "2026") in by_period


def test_vintage_selection_shows_what_was_known_then():
    first = map_series(_payload("336.298"), retrieved_at=V1)["observations"]
    revised = map_series(_payload("336.450"), retrieved_at=V2)["observations"]
    all_rows = first + revised
    then = series_points(all_rows, "CUSR0000SA0", as_of="2026-10-20T00:00:00Z")
    assert then[-1]["value"] == "336.298"  # revision did not exist yet
    now_points = series_points(all_rows, "CUSR0000SA0", as_of="2026-12-01T00:00:00Z")
    assert now_points[-1]["value"] == "336.450"
    snapshot = evidence_snapshot(all_rows, as_of="2026-10-20T00:00:00Z", series_ids=["CUSR0000SA0"])
    assert snapshot["CUSR0000SA0"]["points"][-1]["vintage"] == V1
    assert len(select_vintage(all_rows, as_of=V1)) == 3


def test_transforms_are_labelled_and_exact():
    points = [
        {"period": "2026-08", "value": "200"},
        {"period": "2026-09", "value": "220"},
    ]
    pct = transform(points, "pct_change")
    assert pct["points"][0]["value"] is None
    assert pct["points"][1]["value"] == "10"
    rebased = transform(points, "rebase100", base_period="2026-08")
    assert rebased["points"][1]["value"] == "110"
    assert rebased["formula"] == "100 * value[t] / value[base]"
    joined = align(points, [{"period": "2026-09", "value": "4.2"}])
    assert joined["matched"] == [{"period": "2026-09", "a": "220", "b": "4.2"}]
    assert joined["onlyA"] == ["2026-08"]
    assert joined["interpolated"] is False


def test_calendar_zones_and_consensus_honesty():
    release = {
        "id": "bls-cpi-2026-11",
        "title": "Consumer Price Index",
        "seriesId": "CUSR0000SA0",
        "scheduledAt": "2026-11-10T08:30:00-05:00",
        "sourceZone": "America/New_York",
        "state": "released",
        "actual": "336.9",
        "prior": "336.298",
        "revised": None,
    }
    entry = calendar_entry(release, "Europe/London")
    assert entry["scheduledAtDisplay"].startswith("2026-11-10T13:30")
    assert entry["consensus"]["status"] == "unavailable"
    notices = due_notifications([release], {"CUSR0000SA0"}, now="2026-11-10T14:00:00Z", already_notified=set())
    assert len(notices) == 1
    assert due_notifications([release], {"CUSR0000SA0"}, now="2026-11-10T14:00:00Z", already_notified={"bls-cpi-2026-11"}) == []


def test_fetch_series_uses_injected_transport():
    def transport(url):
        assert "CUSR0000SA0" in url
        return 200, json.dumps(_payload()).encode()

    result = fetch_series("CUSR0000SA0", retrieved_at=V1, transport=transport)
    assert len(result["observations"]) == 3
