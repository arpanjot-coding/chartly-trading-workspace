"""Controlled parameter trials (P21-T04).

A declared search space is expanded deterministically, every trial is
run on the validation window only, and every outcome — including
failures — is preserved. Selection reports the best validation metric
plus stability across the grid; it never promotes anything to live.
"""

from __future__ import annotations

import hashlib
import itertools
import json
from decimal import Decimal

from services.strategy_artifacts import ArtifactError
from services.strategy_experiments import run_experiment, validate_manifest
from services.strategy_rules import compile_plan

METRICS = {"totalReturn", "netPnl", "maxDrawdown"}


def _fail(code):
    raise ArtifactError("trials." + code)


def expand_search_space(space, *, max_trials):
    if not isinstance(space, dict) or not space:
        _fail("search_space_empty")
    names = sorted(space)
    combos = []
    for name in names:
        values = space[name]
        if not isinstance(values, list) or not values or not all(isinstance(v, str) for v in values):
            _fail("search_space_invalid")
    total = 1
    for name in names:
        total *= len(space[name])
    truncated = total > max_trials
    for values in itertools.product(*(space[name] for name in names)):
        combos.append(dict(zip(names, values, strict=True)))
        if len(combos) >= max_trials:
            break
    return combos, {"declared": total, "run": len(combos), "truncated": truncated}


def run_parameter_trials(
    document,
    *,
    base_values,
    search_space,
    candles,
    manifest_template,
    coverage,
    selection_metric="totalReturn",
    max_trials=64,
):
    if selection_metric not in METRICS:
        _fail("selection_metric_unsupported")
    combos, budget = expand_search_space(search_space, max_trials=max_trials)
    trials = []
    for index, overrides in enumerate(combos):
        values = {**base_values, **overrides}
        trial = {"index": index, "values": values}
        try:
            plan = compile_plan(document, values)
            issues = validate_manifest(manifest_template, plan=plan, coverage=coverage)
            if issues:
                trial.update(status="failed", failureCode=";".join(issues))
            else:
                report = run_experiment(plan, candles, manifest_template)
                net = sum(
                    (Decimal(trade["netPnl"]) for trade in report["trades"]), Decimal(0)
                )
                trial.update(
                    status="completed",
                    metrics={
                        "totalReturn": report["totalReturn"],
                        "netPnl": format(net.normalize(), "f"),
                        "maxDrawdown": report["maxDrawdown"],
                        "tradeCount": report["tradeCount"],
                    },
                    reportChecksum=report["checksum"],
                )
        except ArtifactError as error:
            trial.update(status="failed", failureCode=error.code)
        trials.append(trial)
    completed = [row for row in trials if row["status"] == "completed"]
    selection = None
    stability = None
    if completed:
        def metric(row):
            value = Decimal(row["metrics"][selection_metric])
            return -value if selection_metric == "maxDrawdown" else value

        best = max(completed, key=metric)
        ordered = sorted(Decimal(row["metrics"][selection_metric]) for row in completed)
        median = ordered[len(ordered) // 2] if len(ordered) % 2 else (ordered[len(ordered) // 2 - 1] + ordered[len(ordered) // 2]) / 2
        selection = {
            "metric": selection_metric,
            "values": best["values"],
            "value": best["metrics"][selection_metric],
            "note": "Best on the validation window only. This is a research candidate, not a live promotion.",
        }
        stability = {
            "metric": selection_metric,
            "min": format(ordered[0].normalize(), "f"),
            "median": format(median.normalize(), "f"),
            "max": format(ordered[-1].normalize(), "f"),
            "completed": len(completed),
            "failed": len(trials) - len(completed),
        }
    result = {
        "format": "chartly-parameter-trials-v1",
        "budget": budget,
        "trials": trials,
        "selection": selection,
        "stability": stability,
    }
    canonical = json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    result["checksum"] = hashlib.sha256(canonical.encode()).hexdigest()
    return result
