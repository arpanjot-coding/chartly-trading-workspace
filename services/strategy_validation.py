"""Evaluation splits, walk-forward folds and holdout integrity (P21-T03).

All windows are causal: validation always follows training, and the
holdout tail is excluded from every fold. Once a holdout has informed
any selection decision it is contaminated forever for that experiment
lineage — renaming or copying an experiment cannot reset that fact.
"""

from __future__ import annotations

from services.domain.validation import validate_record
from services.strategy_artifacts import ArtifactError


def _fail(code):
    raise ArtifactError("validation." + code)


def generate_walk_forward(times, *, train_bars, validation_bars, step_bars, holdout_bars):
    """Causal folds over bar times; the final `holdout_bars` stay untouched."""
    for value in (train_bars, validation_bars, step_bars):
        if type(value) is not int or value < 1:
            _fail("fold_size_invalid")
    if type(holdout_bars) is not int or holdout_bars < 0:
        _fail("fold_size_invalid")
    usable = len(times) - holdout_bars
    folds = []
    start = 0
    while start + train_bars + validation_bars <= usable:
        train = times[start : start + train_bars]
        validation = times[start + train_bars : start + train_bars + validation_bars]
        folds.append(
            {
                "index": len(folds),
                "trainingStart": train[0],
                "trainingEnd": train[-1],
                "validationStart": validation[0],
                "validationEnd": validation[-1],
            }
        )
        start += step_bars
    holdout = None
    if holdout_bars:
        tail = times[len(times) - holdout_bars :]
        holdout = {"holdoutStart": tail[0], "holdoutEnd": tail[-1], "bars": len(tail)}
    return {"folds": folds, "holdout": holdout}


def build_evaluation_split(
    *, split_id, owner_id, workspace_id, at, experiment_id, fold, holdout
):
    if holdout is None:
        _fail("holdout_required")
    record = {
        "schemaVersion": 1,
        "id": split_id,
        "ownerId": owner_id,
        "workspaceId": workspace_id,
        "revision": 1,
        "createdAt": at,
        "updatedAt": at,
        "experimentId": experiment_id,
        "trainingStart": fold["trainingStart"],
        "trainingEnd": fold["trainingEnd"],
        "validationStart": fold["validationStart"],
        "validationEnd": fold["validationEnd"],
        "holdoutStart": holdout["holdoutStart"],
        "holdoutEnd": holdout["holdoutEnd"],
    }
    issues = validate_record("EvaluationSplit", record)
    if issues:
        _fail(
            "canonical_invalid:" + ",".join(sorted({row["code"] for row in issues}))
        )
    if not (
        record["trainingStart"] < record["validationStart"] <= record["validationEnd"]
        and record["validationEnd"] < record["holdoutStart"]
    ):
        _fail("split_not_causal")
    return record


def holdout_status(uses):
    """uses: [{purpose: 'selection'|'final-report', ...}] in order."""
    if any(use.get("purpose") == "selection" for use in uses):
        return "contaminated"
    if uses:
        return "reported"
    return "untouched"


def assert_holdout_claim(uses, *, claim):
    """An untouched-holdout claim is valid only with zero prior uses."""
    if claim == "untouched-holdout" and uses:
        _fail("holdout_contaminated")
    if claim not in {"untouched-holdout", "holdout-reported", "no-holdout-claim"}:
        _fail("holdout_claim_invalid")
    return True
