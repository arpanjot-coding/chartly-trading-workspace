"""P14: statement assembly, TTM/growth/ratios, coverage, HTTP journey."""

import pytest
from test_journal_api import setup
from test_local_data_api import csrf
from test_research_api import FakeEdgarClient, _ingest

import blueprints.research as research_module
from blueprints.research import research_bp
from services.domain.validation import validate_record
from services.fundamentals import build_statement, classify_span, compute_metrics, field_coverage
from test_research_domain import _fact

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/research"
AT = "2027-01-01T12:00:00Z"
OWNER = {"owner_id": "owner-research-tt", "workspace_id": "workspace-research"}


def _income_facts():
    quarters = []
    specs = [
        ("q1", "2025-01-01", "2025-03-31", "100"),
        ("q2", "2025-04-01", "2025-06-30", "110"),
        ("q3", "2025-07-01", "2025-09-30", "120"),
        ("q4", "2025-10-01", "2025-12-31", "130"),
    ]
    for suffix, start, end, value in specs:
        quarters.append(
            _fact(
                f"factobservation-{suffix}1",
                metric_id="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
                value=value,
                period_start=start,
                period_end=end,
                fiscal_year=2025,
                fiscal_period="Q" + suffix[1],
                available_at="2026-01-15T12:00:00Z",
                published_at="2026-01-15T12:00:00Z",
                retrieved_at="2026-01-16T12:00:00Z",
            )
        )
        quarters.append(
            _fact(
                f"factobservation-{suffix}2",
                metric_id="us-gaap:NetIncomeLoss",
                value=str(int(value) // 5),
                period_start=start,
                period_end=end,
                fiscal_year=2025,
                fiscal_period="Q" + suffix[1],
                available_at="2026-01-15T12:00:00Z",
                published_at="2026-01-15T12:00:00Z",
                retrieved_at="2026-01-16T12:00:00Z",
            )
        )
    return quarters


def test_span_classification_and_statement_assembly():
    facts = _income_facts()
    assert classify_span(facts[0]) == "quarter"
    statement = build_statement(facts, statement="income", as_of=AT, span="quarter", scale="millions")
    lines = {row["line"]: row for row in statement["lines"]}
    assert lines["revenue"]["value"] == "130"  # latest quarter by periodEnd
    assert lines["revenue"]["basis"] == "reported"
    assert statement["segmentData"]["status"] == "unavailable"
    assert {row["line"] for row in statement["unavailable"]} >= {"gross_profit", "eps_diluted"}


def test_ttm_sums_four_quarters_and_margins_are_exact():
    results = compute_metrics(
        _income_facts(), issuer_id="issuer-msft-001", at=AT, **OWNER
    )
    by_formula = {row["formulaId"]: row for row in results}
    for row in results:
        assert validate_record("DerivedMetric", {k: v for k, v in row.items() if k != "basis"}) == []
    # Revenue TTM 460, net income TTM 92 -> net margin 0.2 exactly.
    assert by_formula["net-margin"]["value"] == "0.2"
    assert len(by_formula["net-margin"]["inputFactIds"]) == 8
    assert by_formula["net-margin"]["basis"] == "calculated"
    assert by_formula["current-ratio"]["unavailableReason"] == "missing_input"
    assert "value" not in by_formula["current-ratio"]


def test_repeating_ratios_stay_within_canonical_decimal():
    """Real-world ratios repeat (1/3): values must quantize to the
    canonical 18dp instead of failing schema validation (live-found)."""
    facts = []
    facts.append(
        _fact(
            "factobservation-ratio-rev1",
            metric_id="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
            value="3",
            period_start="2025-01-01",
            period_end="2025-12-31",
            fiscal_year=2025,
            fiscal_period="FY",
            available_at="2026-01-15T12:00:00Z",
            published_at="2026-01-15T12:00:00Z",
            retrieved_at="2026-01-16T12:00:00Z",
        )
    )
    facts.append(
        _fact(
            "factobservation-ratio-net1",
            metric_id="us-gaap:NetIncomeLoss",
            value="1",
            period_start="2025-01-01",
            period_end="2025-12-31",
            fiscal_year=2025,
            fiscal_period="FY",
            available_at="2026-01-15T12:00:00Z",
            published_at="2026-01-15T12:00:00Z",
            retrieved_at="2026-01-16T12:00:00Z",
        )
    )
    results = compute_metrics(facts, issuer_id="issuer-msft-001", at=AT, **OWNER)
    margin = next(row for row in results if row["formulaId"] == "net-margin")
    assert validate_record("DerivedMetric", {k: v for k, v in margin.items() if k != "basis"}) == []
    assert margin["value"] == "0.333333333333333333"


def test_statement_prefers_freshest_candidate_and_never_scales_per_share():
    """Live-found: first-candidate-wins showed a 2018 cost line beside
    2026 revenue, and millions-scaling rendered EPS as 0."""
    stale = _fact(
        "factobservation-stale-cost1",
        metric_id="us-gaap:CostOfRevenue",
        value="28611000000",
        period_start="2018-01-01",
        period_end="2018-03-31",
        fiscal_year=2018,
        fiscal_period="Q3",
        available_at="2018-04-15T12:00:00Z",
        published_at="2018-04-15T12:00:00Z",
        retrieved_at="2018-04-16T12:00:00Z",
    )
    fresh = _fact(
        "factobservation-fresh-cost1",
        metric_id="us-gaap:CostOfGoodsAndServicesSold",
        value="29820000000",
        period_start="2026-07-01",
        period_end="2026-09-30",
        fiscal_year=2027,
        fiscal_period="Q1",
        available_at="2026-10-15T12:00:00Z",
        published_at="2026-10-15T12:00:00Z",
        retrieved_at="2026-10-16T12:00:00Z",
    )
    eps = _fact(
        "factobservation-eps-live01",
        metric_id="us-gaap:EarningsPerShareDiluted",
        value="4.92",
        unit="USD/shares",
        period_start="2026-07-01",
        period_end="2026-09-30",
        fiscal_year=2027,
        fiscal_period="Q1",
        available_at="2026-10-15T12:00:00Z",
        published_at="2026-10-15T12:00:00Z",
        retrieved_at="2026-10-16T12:00:00Z",
    )
    statement = build_statement([stale, fresh, eps], statement="income", as_of=AT, scale="millions")
    lines = {row["line"]: row for row in statement["lines"]}
    assert lines["cost_of_revenue"]["value"] == "29820000000"
    assert lines["eps_diluted"]["displayValue"] == "4.92"
    assert lines["eps_diluted"]["scale"] == "units"


def test_field_coverage_reports_present_and_missing():
    coverage = field_coverage(_income_facts(), as_of=AT)
    by_line = {row["line"]: row for row in coverage["fields"]}
    assert by_line["revenue"]["status"] == "available"
    assert by_line["total_assets"]["status"] == "unavailable"
    assert by_line["revenue"]["definition"]


@pytest.fixture
def app(api, monkeypatch):
    api.register_blueprint(research_bp)
    monkeypatch.setattr(research_module, "make_edgar_client", FakeEdgarClient)
    return api


def test_http_statement_metrics_events_journey(app):
    with app.test_client() as client:
        origin = setup(client)["originId"]
        _ingest(client, origin)
        issuer_id = client.get(BASE + f"/issuers?originId={origin}").json["issuers"][0]["id"]
        income = client.get(
            BASE + f"/issuers/{issuer_id}/statements/income?originId={origin}&scale=millions"
        ).json
        revenue = next(row for row in income["lines"] if row["line"] == "revenue")
        assert revenue["value"] == "246000000000"  # latest-restated view default as-of now
        assert revenue["displayValue"] == "246000"
        assert revenue["citation"]
        as_reported = client.get(
            BASE
            + f"/issuers/{issuer_id}/statements/income?originId={origin}&view=as-of&asOf=2026-01-01T00:00:00Z"
        ).json
        old = next(row for row in as_reported["lines"] if row["line"] == "revenue")
        assert old["value"] == "245122000000"
        metrics = client.get(BASE + f"/issuers/{issuer_id}/metrics?originId={origin}").json
        assert metrics["metrics"]
        events = client.get(BASE + f"/issuers/{issuer_id}/events?originId={origin}").json
        assert events["page"]["total"] == 3
        assert events["gated"] == ["estimates", "transcripts", "ownership", "news"]
        assert csrf(client)  # session helper parity with other API suites
