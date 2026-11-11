"""P13-T02: alias resolution, fact semantics, point-in-time selection."""

import pytest

from services.domain.validation import validate_record, validate_records
from services.research_domain import (
    ResearchError,
    build_document_version,
    build_fact_observation,
    build_issuer,
    resolve_issuer,
    select_facts_as_of,
)

AT = "2026-11-04T12:00:00Z"
OWNER = {"owner_id": "owner-research-tt", "workspace_id": "workspace-research"}


def _issuer(identifier_key="0000789019", issuer_id="issuer-msft-001"):
    return build_issuer(
        issuer_id=issuer_id,
        at=AT,
        name="Microsoft Corporation",
        country="US",
        identifiers=[
            {"namespace": "cik", "key": identifier_key},
            {"namespace": "ticker", "key": "msft"},
        ],
        **OWNER,
    )


def _document(document_id="document-10k-0001", **changes):
    values = dict(
        document_id=document_id,
        at=AT,
        issuer_id="issuer-msft-001",
        source_id="sourceconnection-edgar",
        native_document_id="0000950170-24-000001",
        checksum="a" * 64,
        published_at="2026-10-30T12:00:00Z",
        available_at="2026-10-30T12:05:00Z",
        retrieved_at="2026-11-04T12:00:00Z",
        source_url="https://www.sec.gov/",
        **OWNER,
    )
    values.update(changes)
    return build_document_version(**values)


def _fact(fact_id="factobservation-01", **changes):
    values = dict(
        fact_id=fact_id,
        at=AT,
        issuer_id="issuer-msft-001",
        document_version_id="document-10k-0001",
        metric_id="us-gaap:Revenues",
        value="245122000000",
        unit="USD",
        currency="USD",
        period_kind="duration",
        period_start="2025-07-01",
        period_end="2026-06-30",
        fiscal_year=2026,
        fiscal_period="FY",
        reporting_basis="consolidated",
        citation="10-K accession 0000950170-24-000001, Revenues",
        published_at="2026-10-30T12:00:00Z",
        available_at="2026-10-30T12:05:00Z",
        retrieved_at="2026-11-04T12:00:00Z",
        **OWNER,
    )
    values.update(changes)
    return build_fact_observation(**values)


def test_records_validate_and_aliases_canonicalise():
    issuer = _issuer()
    assert validate_record("Issuer", issuer) == []
    assert {"namespace": "cik", "key": "789019"} in issuer["identifiers"]
    assert {"namespace": "ticker", "key": "MSFT"} in issuer["identifiers"]
    document = _document()
    fact = _fact()
    assert validate_record("DocumentVersion", document) == []
    assert validate_record("FactObservation", fact) == []
    issues = validate_records(
        [
            {"type": "Issuer", "value": issuer},
            {"type": "DocumentVersion", "value": document},
            {"type": "FactObservation", "value": fact},
        ]
    )
    assert {row["code"] for row in issues} == {"reference.missing"}


def test_alias_resolution_and_ambiguity():
    one = _issuer()
    two = _issuer(issuer_id="issuer-clone-001")
    assert resolve_issuer([one], "cik", "789019") is one
    assert resolve_issuer([one], "ticker", "msft") is one
    assert resolve_issuer([one], "ticker", "AAPL") is None
    with pytest.raises(ResearchError, match="alias_ambiguous"):
        resolve_issuer([one, two], "ticker", "MSFT")


def test_fact_semantics_fail_closed():
    with pytest.raises(ResearchError, match="fact_period_invalid"):
        _fact(period_kind="instant")  # still carries period_start
    with pytest.raises(ResearchError, match="fact_currency_mismatch"):
        _fact(currency="EUR")
    with pytest.raises(ResearchError, match="fact_time_order"):
        _fact(available_at="2026-10-29T00:00:00Z")
    with pytest.raises(ResearchError, match="fact_citation_required"):
        _fact(citation="  ")
    with pytest.raises(ResearchError, match="document_time_order"):
        _document(available_at="2026-10-29T00:00:00Z")


def test_point_in_time_selection_preserves_restatement_history():
    original = _fact()
    restated = _fact(
        "factobservation-02",
        value="246000000000",
        document_version_id="document-10ka-001",
        published_at="2026-12-01T12:00:00Z",
        available_at="2026-12-01T12:05:00Z",
        retrieved_at="2026-12-02T12:00:00Z",
        revises_fact_id="factobservation-01",
    )
    facts = [restated, original]
    before = select_facts_as_of(facts, as_of="2026-11-15T00:00:00Z")
    after = select_facts_as_of(facts, as_of="2027-01-01T00:00:00Z")
    assert [row["value"] for row in before] == ["245122000000"]
    assert [row["value"] for row in after] == ["246000000000"]
    assert after[0]["revisesFactId"] == "factobservation-01"
    assert select_facts_as_of(facts, as_of="2026-10-01T00:00:00Z") == []
