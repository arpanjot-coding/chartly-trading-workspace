"""P13-T05/T06/T07: unit validation, quarantine, splits, quality, snapshot."""

import pytest
from test_journal_api import setup
from test_local_data_api import csrf
from test_research_api import _ingest

from blueprints.research import research_bp
from services.research_quality import parse_unit, split_adjusted_series, validate_facts
from test_research_domain import _fact

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/research"


def test_unit_classification_and_quarantine():
    assert parse_unit("USD") == {"kind": "currency", "currency": "USD"}
    assert parse_unit("USD/shares") == {"kind": "per-share", "currency": "USD"}
    assert parse_unit("shares") == {"kind": "shares", "currency": None}
    good = _fact()
    conflict = _fact("factobservation-99", value="1")
    # The builder rejects this at construction; quarantine exists for
    # records that arrive by other paths (imports, older stores).
    bad_unit = {
        **_fact("factobservation-98"),
        "currency": "EUR",
        "documentVersionId": "document-other-001",
    }
    accepted, quarantined = validate_facts([good, conflict, bad_unit])
    assert accepted == [good]
    reasons = {row["fact"]["id"]: row["reasons"] for row in quarantined}
    assert reasons["factobservation-99"] == ["conflicting_fact_same_document"]
    assert reasons["factobservation-98"] == ["currency_mismatch"]


def test_split_adjustment_is_explicit_and_derived_only():
    share_fact = _fact(
        "factobservation-shares",
        metric_id="dei:EntityCommonStockSharesOutstanding",
        value="1000000",
        unit="shares",
        currency=None,
        period_kind="instant",
        period_start=None,
        period_end="2025-06-30",
    )
    adjusted = split_adjusted_series(
        [share_fact], [{"effectiveDate": "2026-01-15", "ratio": "4"}]
    )
    assert adjusted == [
        {
            "factId": "factobservation-shares",
            "metricId": "dei:EntityCommonStockSharesOutstanding",
            "periodEnd": "2025-06-30",
            "reportedValue": "1000000",
            "splitFactor": "4",
            "adjustedValue": "4000000",
            "basis": "split-adjusted-derived",
        }
    ]
    assert share_fact["value"] == "1000000"  # original untouched


@pytest.fixture
def app(api, monkeypatch):
    import blueprints.research as research_module
    from test_research_api import FakeEdgarClient

    api.register_blueprint(research_bp)
    monkeypatch.setattr(research_module, "make_edgar_client", FakeEdgarClient)
    return api


def test_snapshot_quality_and_retention_over_http(app):
    with app.test_client() as client:
        origin = setup(client)["originId"]
        _ingest(client, origin)
        issuer_id = client.get(BASE + f"/issuers?originId={origin}").json["issuers"][0]["id"]
        snapshot = client.get(
            BASE + f"/issuers/{issuer_id}/snapshot?originId={origin}&asOf=2026-01-01T00:00:00Z"
        ).json
        assert snapshot["coverage"]["documentsAvailable"] == 1
        revenue = next(f for f in snapshot["facts"] if f["metricId"] == "us-gaap:Revenues")
        assert revenue["value"] == "245122000000"
        assert revenue["source"]["accession"] == "0000950170-25-000010"

        quality = client.get(
            BASE + f"/issuers/{issuer_id}/quality?originId={origin}&asOf=2027-01-01T00:00:00Z"
        ).json
        assert quality["acceptedFacts"] == 3 and quality["quarantined"] == []
        assert quality["restatedIdentities"] == 1
        assert quality["sourcesMixed"] is False

        wrong = client.post(
            BASE + "/retention/action",
            json={
                "originId": origin,
                "action": "delete-issuer",
                "payload": {"issuerId": issuer_id, "expectedFactCount": 99},
            },
            headers=csrf(client),
        )
        assert wrong.status_code == 409
        deleted = client.post(
            BASE + "/retention/action",
            json={
                "originId": origin,
                "action": "delete-issuer",
                "payload": {"issuerId": issuer_id, "expectedFactCount": 3},
            },
            headers=csrf(client),
        )
        assert deleted.status_code == 200, deleted.json
        assert client.get(BASE + f"/issuers?originId={origin}").json["issuers"] == []
