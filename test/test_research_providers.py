"""P13-T01: SEC EDGAR provider manifest is complete and canonical."""

from services.domain.validation import validate_record
from services.research_providers import EDGAR_PROVIDER, build_capability_manifest


def test_manifest_covers_every_t01_dimension():
    for field in (
        "geography",
        "assetClasses",
        "fields",
        "history",
        "latency",
        "quota",
        "attribution",
        "storage",
        "export",
        "subscription",
    ):
        assert EDGAR_PROVIDER[field], field
    assert EDGAR_PROVIDER["quota"] == {
        "maxRequestsPerSecond": 10,
        "credentials": "none",
        "userAgentRequired": True,
    }
    assert "never the browser" in EDGAR_PROVIDER["transport"]["cors"]


def test_capability_manifest_record_validates():
    record = build_capability_manifest(
        manifest_id="capabilitymanifest-edgar1",
        owner_id="owner-research-tt",
        workspace_id="workspace-research",
        at="2026-11-04T12:00:00Z",
        verified_at="2026-11-04T12:00:00Z",
        evidence_id="evidence-edgar-official-docs",
    )
    assert validate_record("CapabilityManifest", record) == []
    assert record["capabilities"]["researchRead"]["state"] == "supported"
    assert record["capabilities"]["orderSubmit"]["state"] == "unsupported"
    assert record["environment"] == "data_only"
