"""Robustness reports and evidence/promotion policy (P21-T07/T08).

The report assembles only cited, checksum-bound evidence: baseline
experiment, parameter stability, stress outcomes, resampling, holdout
status and data quality. Promotion separates three different questions
that must never be conflated: is the research evidence complete
(candidate approval), may this account trade it (P11 eligibility —
always unassessed here), and does risk permission exist (also P11).
A strong report can therefore never arm an account by itself.
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal

from services.domain.validation import validate_record
from services.strategy_artifacts import ArtifactError


def _fail(code):
    raise ArtifactError("report." + code)


def _d(text):
    return Decimal(text) if isinstance(text, str) else Decimal(0)


def build_robustness_report(
    *,
    baseline,
    manifest,
    trials=None,
    stress=None,
    monte_carlo=None,
    holdout=None,
    data_quality=None,
):
    trades = baseline.get("trades", [])
    starting = _d(baseline.get("startingCash", "0")) or Decimal(1)
    turnover = sum(
        (
            abs(_d(t["quantity"]) * _d(t["entryPrice"]))
            + abs(_d(t["quantity"]) * _d(t["exitPrice"]))
            for t in trades
        ),
        Decimal(0),
    )
    nets = [_d(t["netPnl"]) for t in trades]
    total_net = sum(nets, Decimal(0))
    concentration = None
    if nets and total_net > 0:
        concentration = format((max(nets) / total_net).normalize(), "f")
    findings = []
    if len(trades) < 10:
        findings.append(
            {"severity": "warning", "code": "small_sample", "detail": f"Only {len(trades)} closed trades; metrics are fragile."}
        )
    if concentration is not None and _d(concentration) > Decimal("0.5"):
        findings.append(
            {"severity": "warning", "code": "concentrated", "detail": "One trade contributes over half of net profit."}
        )
    failed_scenarios = []
    cost_sensitivity = None
    if stress:
        failed_scenarios = [
            row["name"] for row in stress.get("scenarios", []) if row.get("status") == "failed"
        ]
        base = next(
            (row for row in stress.get("scenarios", []) if row["name"] == "baseline"), None
        )
        stressed = [
            row for row in stress.get("scenarios", []) if row.get("status") == "completed" and row["name"] != "baseline"
        ]
        if base and stressed:
            worst = min(stressed, key=lambda row: _d(row["totalReturn"]))
            cost_sensitivity = {
                "baselineReturn": base["totalReturn"],
                "worstScenario": worst["name"],
                "worstReturn": worst["totalReturn"],
            }
            if _d(worst["totalReturn"]) < 0 <= _d(base["totalReturn"]):
                findings.append(
                    {"severity": "warning", "code": "cost_fragile", "detail": f"Scenario '{worst['name']}' turns the result negative."}
                )
    if holdout and holdout.get("status") == "contaminated":
        findings.append(
            {"severity": "warning", "code": "holdout_contaminated", "detail": "Holdout informed selection; no untouched-holdout claim is available."}
        )
    report = {
        "format": "chartly-robustness-report-v1",
        "artifactRevisionId": manifest["artifactRevisionId"],
        "parameterSetId": manifest["parameterSetId"],
        "evidence": {
            "baselineChecksum": baseline.get("checksum"),
            "trialsChecksum": (trials or {}).get("checksum"),
            "stressChecksum": (stress or {}).get("checksum"),
            "monteCarloChecksum": (monte_carlo or {}).get("checksum"),
        },
        "sampleSize": {"trades": len(trades), "bars": len(baseline.get("equityCurve", []))},
        "oosScope": holdout or {"status": "none-declared"},
        "turnover": format((turnover / starting).normalize(), "f"),
        "costSensitivity": cost_sensitivity,
        "concentrationTopTradeShare": concentration,
        "parameterStability": (trials or {}).get("stability"),
        "failedScenarios": failed_scenarios,
        "dataQuality": data_quality or {"status": "not-assessed"},
        "findings": findings,
    }
    canonical = json.dumps(report, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    report["checksum"] = hashlib.sha256(canonical.encode()).hexdigest()
    return report


def evidence_fingerprint(*, revision_checksum, dependency_locks, parameter_values, dataset_version_id, engine, manifest_essentials):
    payload = {
        "revisionChecksum": revision_checksum,
        "dependencyLocks": sorted(
            (lock["revisionId"], lock["checksum"]) for lock in dependency_locks
        ),
        "parameterValues": parameter_values,
        "datasetVersionId": dataset_version_id,
        "engine": engine,
        "manifestEssentials": manifest_essentials,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest(), payload


def evidence_validity(previous_payload, current_payload):
    """Any change in fingerprint components requires fresh evidence."""
    changed = [
        key for key in current_payload if previous_payload.get(key) != current_payload[key]
    ]
    return {
        "valid": not changed,
        "changedComponents": changed,
        "requirement": "none" if not changed else "new-evidence-required",
    }


def promotion_decision(report, *, holdout_status_value):
    """Candidate approval only — account eligibility is never granted here."""
    blockers = []
    if report["sampleSize"]["trades"] < 10:
        blockers.append("small_sample")
    if report["failedScenarios"]:
        blockers.append("failed_scenarios")
    if holdout_status_value == "contaminated":
        blockers.append("holdout_contaminated")
    if report["evidence"]["stressChecksum"] is None:
        blockers.append("stress_missing")
    if blockers:
        decision = "research_only"
    else:
        # Paper observation is the ceiling until P11 account/risk gates exist.
        decision = "paper_candidate"
    return {
        "candidateDecision": decision,
        "blockers": blockers,
        "accountEligibility": "not-assessed-requires-p11",
        "riskPermission": "not-granted",
        "canArm": False,
    }


def build_validation_record(
    *, record_id, owner_id, workspace_id, at, manifest, experiment_ids, decision, limitations
):
    record = {
        "schemaVersion": 1,
        "id": record_id,
        "ownerId": owner_id,
        "workspaceId": workspace_id,
        "revision": 1,
        "createdAt": at,
        "updatedAt": at,
        "artifactRevisionId": manifest["artifactRevisionId"],
        "parameterSetId": manifest["parameterSetId"],
        "experimentIds": list(experiment_ids),
        "decision": decision,
        "limitations": limitations,
    }
    issues = validate_record("ValidationRecord", record)
    if issues:
        _fail("canonical_invalid:" + ",".join(sorted({row["code"] for row in issues})))
    if decision in {"demo_candidate", "live_candidate"}:
        _fail("promotion_requires_p11")
    return record
