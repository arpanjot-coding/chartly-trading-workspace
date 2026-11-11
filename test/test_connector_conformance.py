"""Measured readiness cannot be supplied as a healthy flag or fake evidence."""

from copy import deepcopy

import pytest
from test_connector_mt5 import NOW, SDK

from services import connector_adapters as adapters
from services import connector_conformance as conformance
from services.connector_adapters import AdapterError
from services.connector_mt5 import MT5Adapter

WINDOW = {"from": "2026-11-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"}


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    monkeypatch.setattr(adapters, "utc_now", lambda: NOW)


def observation():
    return adapters.probe("diagnostic", {})


def page():
    return adapters.history("diagnostic", {}, observation()["identity"], WINDOW)


def report():
    return conformance.run_conformance("diagnostic", {})


def rehash(value):
    value["checksum"] = adapters.checksum(
        {key: item for key, item in value.items() if key != "checksum"}
    )
    return value


def test_trusted_diagnostic_conformance_is_repeatable_and_clearly_synthetic():
    result = report()
    assert result == report() and result["passed"] is True
    assert result["synthetic"] is True and result["readiness"] == "read-only-verified"
    assert "Synthetic" in result["scope"] and "identity" not in result
    assert result["identityHash"] == adapters.checksum(observation()["identity"])
    assert result["sample"] == {"pages": 2, "eventCount": 2}
    assert all(check["passed"] for check in result["checks"])
    assert (
        conformance.validate_conformance(
            result, "diagnostic", observation()["identity"], checked_at=NOW
        )
        == result
    )


@pytest.mark.parametrize("fault", [value for value in adapters.FAULTS if value != "none"])
def test_every_controlled_fault_refuses_readiness_promotion(fault):
    result = conformance.run_conformance("diagnostic", {"fault": fault})
    assert result["passed"] is False and result["readiness"] == "prototype"
    assert result["synthetic"] is True and not all(check["passed"] for check in result["checks"])


@pytest.mark.parametrize(
    "key,value",
    [
        ("providerId", "mt5"),
        ("adapterVersion", "made-up-v2"),
        ("observedAt", "2026-10-01T00:00:00Z"),
        ("observedAt", "2027-10-01T00:00:00Z"),
        ("permissions", ["accountRead", "orderSubmit"]),
        ("permissions", [{"bad": "shape"}]),
        ("identity", "not-an-identity"),
    ],
)
def test_observed_identity_version_freshness_and_grants_are_required(key, value):
    observed = observation()
    observed[key] = value
    result = conformance.evaluate_conformance("diagnostic", {}, observed, checked_at=NOW)
    assert result["passed"] is False


def test_supported_execution_claim_is_refused_even_with_recomputed_hash():
    observed = observation()
    observed["capabilities"]["orderSubmit"] = {"state": "supported"}
    observed["permissions"].append("orderSubmit")
    result = conformance.evaluate_conformance("diagnostic", {}, observed, checked_at=NOW)
    assert result["passed"] is False
    saved = report()
    saved["capabilities"]["orderSubmit"] = {"state": "supported"}
    rehash(saved)
    with pytest.raises(AdapterError, match="invalid_capability_evidence"):
        conformance.validate_conformance(saved, "diagnostic", checked_at=NOW)


def test_unknown_and_partial_observations_cannot_be_disguised_as_closed_trades():
    snapshot = page()
    snapshot["events"][0]["status"] = "partial"
    result = conformance.evaluate_conformance(
        "diagnostic", {}, observation(), [snapshot], checked_at=NOW
    )
    assert result["passed"] is False


def test_false_complete_coverage_and_unstable_native_facts_refuse_promotion():
    snapshot = page()
    snapshot["coverage"]["complete"] = False
    result = conformance.evaluate_conformance(
        "diagnostic", {}, observation(), [snapshot], checked_at=NOW
    )
    assert result["passed"] is False
    first, second = page(), page()
    second["events"][0]["payload"]["netPnl"] = "99999"
    result = conformance.evaluate_conformance(
        "diagnostic", {}, observation(), [first, second], checked_at=NOW
    )
    assert result["passed"] is False


@pytest.mark.parametrize(
    "malformed", [None, [], {"identity": []}, {"capabilities": {"accountRead": "true"}}]
)
def test_malformed_evidence_is_not_a_healthy_flag(malformed):
    assert (
        conformance.evaluate_conformance("diagnostic", {}, malformed, checked_at=NOW)["passed"]
        is False
    )


def test_bad_pages_and_unbounded_events_are_rejected():
    for malformed in (
        [None],
        [{"events": ["bad"]}],
        [{"events": [{}] * 201}],
        [{"events": [], "coverage": None}],
    ):
        assert (
            conformance.evaluate_conformance(
                "diagnostic", {}, observation(), malformed, checked_at=NOW
            )["passed"]
            is False
        )


def test_checksum_and_bound_identity_are_revalidated():
    saved = report()
    saved["passed"] = False
    with pytest.raises(AdapterError, match="checksum_mismatch"):
        conformance.validate_conformance(saved, "diagnostic", checked_at=NOW)
    with pytest.raises(AdapterError, match="identity_mismatch"):
        conformance.validate_conformance(
            report(),
            "diagnostic",
            {**observation()["identity"], "externalId": "OTHER"},
            checked_at=NOW,
        )


def test_synthetic_or_old_provider_evidence_cannot_promote_a_real_adapter():
    with pytest.raises(AdapterError, match="not_verified"):
        conformance.validate_conformance(report(), "mt5", checked_at=NOW)
    saved = report()
    saved["adapterVersion"] = "old-version"
    rehash(saved)
    with pytest.raises(AdapterError, match="not_verified"):
        conformance.validate_conformance(saved, "diagnostic", checked_at=NOW)


def test_expired_evidence_is_rejected_without_new_provider_calls():
    with pytest.raises(AdapterError, match="conformance_stale"):
        conformance.validate_conformance(report(), "diagnostic", checked_at="2026-11-03T12:06:00Z")


def test_mt5_read_only_conformance_preserves_unverified_clock_and_raw_history_limits(monkeypatch):
    sdk = SDK()
    original = adapters.get_adapter
    monkeypatch.setattr(
        adapters,
        "get_adapter",
        lambda provider: (
            MT5Adapter(sdk=sdk, terminal_checker=lambda _: True, clock=lambda: NOW)
            if provider == "mt5"
            else original(provider)
        ),
    )
    result = conformance.run_conformance("mt5", {})
    assert result["passed"] is True and result["readiness"] == "read-only-verified"
    assert result["synthetic"] is False
    assert result["capabilities"]["accountRead"]["state"] == "supported"
    assert result["capabilities"]["marketHistory"]["state"] == "unknown"
    assert result["limits"] == ["provider_clock_unverified", "raw_history_only"]
    assert sdk.opened == sdk.closed == 3
    assert "PRIVATE" not in str(result) and "100001" not in str(result)
    conformance.validate_conformance(result, "mt5", checked_at=NOW)


def test_unavailable_brokerage_reports_blocked_evidence_without_claiming_account_access():
    result = conformance.run_conformance("alpaca-paper", {})
    assert result["passed"] is False and result["readiness"] == "prototype"
    assert result["checks"][0]["reason"] == "connector.credential_required"
    assert result["capabilities"]["accountRead"]["state"] != "supported"


@pytest.mark.parametrize(
    ("provider", "environment"),
    [
        ("alpaca-paper", "paper"),
        ("bitget", "production"),
        ("coinbase", "production"),
        ("topstepx", "production"),
    ],
)
def test_saved_provider_configuration_is_idempotent_and_fences_environment(provider, environment):
    normalized = adapters.normalize_configuration(provider, {})
    assert normalized["environment"] == environment
    assert adapters.normalize_configuration(provider, normalized) == normalized
    with pytest.raises(AdapterError, match="connector.invalid_configuration"):
        adapters.normalize_configuration(provider, {**normalized, "environment": "foreign"})


def test_readiness_cannot_be_raised_by_changing_only_a_label():
    saved = report()
    saved["readiness"] = "live-execution-verified"
    rehash(saved)
    with pytest.raises(AdapterError, match="not_verified"):
        conformance.validate_conformance(saved, "diagnostic", checked_at=NOW)
