"""P16: comparison honesty, immutable snapshots, document notes."""

import pytest
from test_journal_api import setup
from test_local_data_api import csrf
from test_research_api import FakeEdgarClient, _ingest
from test_research_domain import _fact

import blueprints.research as research_module
from blueprints.research import research_bp
from services.fundamentals import compare_line, series_history

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/research"
AT = "2027-01-01T12:00:00Z"


def _bundle(bundle_id, name, facts):
    return {"id": bundle_id, "issuer": {"name": name}, "facts": facts, "documents": []}


def test_compare_flags_units_and_gaps_without_conversion():
    msft = _fact("factobservation-cmp-msft01", value="246000000000")
    other = _fact(
        "factobservation-cmp-othr01",
        issuer_id="issuer-other-001",
        value="1000",
        unit="EUR",
        currency="EUR",
    )
    result = compare_line(
        [_bundle("b1", "MICROSOFT CORP", [msft]), _bundle("b2", "OTHER SA", [other])],
        line="revenue",
        as_of=AT,
    )
    assert result["comparable"] is False
    assert result["units"] == ["EUR", "USD"]
    assert "NOT converted" in result["comparabilityNote"]
    assert {row["value"] for row in result["rows"]} == {"246000000000", "1000"}
    missing = compare_line(
        [_bundle("b1", "MICROSOFT CORP", [msft]), _bundle("b3", "EMPTY INC", [])],
        line="revenue",
        as_of=AT,
    )
    assert missing["complete"] is False
    assert missing["rows"][1]["status"] == "unavailable"


def test_series_history_uses_one_comparable_span():
    """Live-found sawtooth: quarters + full years must never share a line."""
    quarters = [
        _fact(
            f"factobservation-span-q{i}",
            metric_id="us-gaap:Revenues",
            value=str(60000 + i * 1000),
            period_start=start,
            period_end=end,
            fiscal_year=2026,
            fiscal_period=f"Q{i}",
            available_at="2026-10-15T12:00:00Z",
            published_at="2026-10-15T12:00:00Z",
            retrieved_at="2026-10-16T12:00:00Z",
        )
        for i, (start, end) in enumerate(
            [
                ("2025-10-01", "2025-12-31"),
                ("2026-01-01", "2026-03-31"),
                ("2026-04-01", "2026-06-30"),
            ],
            start=1,
        )
    ]
    year = _fact(
        "factobservation-span-yr1",
        metric_id="us-gaap:Revenues",
        value="250000",
        period_start="2025-07-01",
        period_end="2026-06-30",
        fiscal_year=2026,
        fiscal_period="FY",
        available_at="2026-10-15T12:00:00Z",
        published_at="2026-10-15T12:00:00Z",
        retrieved_at="2026-10-16T12:00:00Z",
    )
    history = series_history([*quarters, year], line="revenue", as_of=AT)
    assert history["spanUsed"] == "quarter"
    assert [row["span"] for row in history["points"]] == ["quarter"] * 3


def test_series_history_carries_span_and_citations():
    msft = _fact("factobservation-hist-msft1", value="245122000000")
    history = series_history([msft], line="revenue", as_of=AT)
    assert history["concept"] == "us-gaap:Revenues"
    assert history["points"][0]["date"] == "2026-06-30"
    assert history["points"][0]["span"] == "year"
    assert history["points"][0]["citation"]
    assert series_history([], line="revenue", as_of=AT)["points"] == []


@pytest.fixture
def app(api, monkeypatch):
    api.register_blueprint(research_bp)
    monkeypatch.setattr(research_module, "make_edgar_client", FakeEdgarClient)
    return api


def test_snapshot_survives_restatement_and_notes_attach_to_versions(app):
    with app.test_client() as client:
        origin = setup(client)["originId"]
        headers = csrf(client)
        _ingest(client, origin)
        issuer_id = client.get(BASE + f"/issuers?originId={origin}").json["issuers"][0]["id"]
        documents = client.get(
            BASE + f"/issuers/{issuer_id}/documents?originId={origin}"
        ).json["documents"]
        saved = client.post(
            BASE + f"/issuers/{issuer_id}/snapshots",
            json={
                "originId": origin,
                "label": "Pre-restatement evidence",
                "asOf": "2026-01-01T00:00:00Z",
                "links": [{"kind": "journalTrade", "id": "trade-1"}],
            },
            headers=headers,
        )
        assert saved.status_code == 201, saved.json
        snapshot_id = saved.json["id"]
        values = {row["value"] for row in saved.json["facts"]}
        assert "245122000000" in values  # as originally reported
        reopened = client.get(
            BASE + f"/issuers/{issuer_id}/snapshots/{snapshot_id}?originId={origin}"
        ).json
        assert {row["value"] for row in reopened["facts"]} == values  # immutable
        assert reopened["links"] == [{"kind": "journalTrade", "id": "trade-1"}]
        note = client.post(
            BASE + f"/issuers/{issuer_id}/notes",
            json={
                "originId": origin,
                "documentVersionId": documents[0]["id"],
                "text": "Revenue recognition footnote checked.",
            },
            headers=headers,
        )
        assert note.status_code == 201, note.json
        notes = client.get(BASE + f"/issuers/{issuer_id}/notes?originId={origin}").json
        assert notes["notes"][0]["documentVersionId"] == documents[0]["id"]
        bad = client.post(
            BASE + f"/issuers/{issuer_id}/notes",
            json={
                "originId": origin,
                "documentVersionId": "documentversion-missing1",
                "text": "orphan",
            },
            headers=headers,
        )
        assert bad.status_code == 404
        overlay = client.get(
            BASE + f"/issuers/{issuer_id}/overlay?originId={origin}&line=revenue"
        ).json
        assert overlay["semantics"]["interpolated"] is False
        assert overlay["series"]["points"][-1]["value"] == "246000000000"
        assert overlay["series"]["points"][-1]["date"] == "2025-06-30"
        assert len(overlay["events"]) == 3
        assert overlay["events"][0]["sourceUrl"].startswith("https://www.sec.gov/")
        assert "period end" in overlay["semantics"]["seriesDates"]
