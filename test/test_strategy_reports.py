"""P21-T07/T08: cited robustness evidence, validity, promotion ceiling."""

import pytest

from services.domain.validation import validate_record
from services.strategy_artifacts import ArtifactError
from services.strategy_experiments import run_experiment
from services.strategy_reports import (
    build_robustness_report,
    build_validation_record,
    evidence_fingerprint,
    evidence_validity,
    promotion_decision,
)
from services.strategy_rules import compile_plan
from services.strategy_stress import run_stress_scenarios
from test_strategy_experiments import CANDLES, DOC, _manifest


def test_report_cites_evidence_and_flags_small_sample():
    baseline = run_experiment(compile_plan(DOC), CANDLES, _manifest())
    report = build_robustness_report(baseline=baseline, manifest=_manifest())
    assert report["evidence"]["baselineChecksum"] == baseline["checksum"]
    assert report["sampleSize"] == {"trades": 1, "bars": 5}
    assert any(row["code"] == "small_sample" for row in report["findings"])
    decision = promotion_decision(report, holdout_status_value="untouched")
    assert decision["candidateDecision"] == "research_only"
    assert decision["canArm"] is False
    assert decision["accountEligibility"] == "not-assessed-requires-p11"


def test_cost_fragility_and_failed_scenarios_are_visible():
    plan = compile_plan(DOC)
    baseline = run_experiment(plan, CANDLES, _manifest())
    stress = run_stress_scenarios(
        plan,
        CANDLES,
        _manifest(),
        [
            {"name": "baseline"},
            {"name": "punishing", "feeBps": "5000", "slippageBps": "0"},
        ],
    )
    report = build_robustness_report(baseline=baseline, manifest=_manifest(), stress=stress)
    assert report["costSensitivity"]["worstScenario"] == "punishing"
    assert any(row["code"] == "cost_fragile" for row in report["findings"])


def test_evidence_fingerprint_change_requires_new_evidence():
    fingerprint, payload = evidence_fingerprint(
        revision_checksum="a" * 64,
        dependency_locks=[{"revisionId": "artifactrevision-dep1", "checksum": "b" * 64}],
        parameter_values={"length": "14"},
        dataset_version_id="datasetversion-0001",
        engine="chartly-rules-sim@1.0",
        manifest_essentials={"feeBps": "10"},
    )
    assert evidence_validity(payload, payload)["valid"] is True
    changed = {**payload, "parameterValues": {"length": "21"}}
    verdict = evidence_validity(payload, changed)
    assert verdict == {
        "valid": False,
        "changedComponents": ["parameterValues"],
        "requirement": "new-evidence-required",
    }
    assert len(fingerprint) == 64


def test_validation_record_ceiling_below_live():
    record = build_validation_record(
        record_id="validationrecord-001",
        owner_id="owner-report-test",
        workspace_id="workspace-report-test",
        at="2026-11-04T12:00:00Z",
        manifest=_manifest(),
        experiment_ids=["experiment-0001"],
        decision="paper_candidate",
        limitations="Small sample; OHLC next-open model only.",
    )
    assert validate_record("ValidationRecord", record) == []
    with pytest.raises(ArtifactError, match="promotion_requires_p11"):
        build_validation_record(
            record_id="validationrecord-002",
            owner_id="owner-report-test",
            workspace_id="workspace-report-test",
            at="2026-11-04T12:00:00Z",
            manifest=_manifest(),
            experiment_ids=["experiment-0001"],
            decision="live_candidate",
            limitations="None stated.",
        )
