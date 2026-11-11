"""P21-T03/T04: causal splits, holdout integrity, preserved trial grids."""

import pytest

from services.strategy_artifacts import ArtifactError
from services.strategy_trials import expand_search_space, run_parameter_trials
from services.strategy_validation import (
    assert_holdout_claim,
    build_evaluation_split,
    generate_walk_forward,
    holdout_status,
)
from test_strategy_experiments import CANDLES, COVERAGE, _manifest

TIMES = [f"2026-01-{day:02d}T00:00:00Z" for day in range(1, 29)]


def test_walk_forward_folds_are_causal_and_holdout_excluded():
    result = generate_walk_forward(
        TIMES, train_bars=10, validation_bars=5, step_bars=5, holdout_bars=3
    )
    assert result["holdout"] == {
        "holdoutStart": "2026-01-26T00:00:00Z",
        "holdoutEnd": "2026-01-28T00:00:00Z",
        "bars": 3,
    }
    assert len(result["folds"]) == 3
    for fold in result["folds"]:
        assert fold["trainingEnd"] < fold["validationStart"] <= fold["validationEnd"]
        assert fold["validationEnd"] < result["holdout"]["holdoutStart"]


def test_evaluation_split_record_and_non_causal_rejection():
    walk = generate_walk_forward(TIMES, train_bars=10, validation_bars=5, step_bars=5, holdout_bars=3)
    record = build_evaluation_split(
        split_id="evaluationsplit-0001",
        owner_id="owner-val-test",
        workspace_id="workspace-val-test",
        at="2026-11-04T12:00:00Z",
        experiment_id="experiment-0001",
        fold=walk["folds"][0],
        holdout=walk["holdout"],
    )
    assert record["experimentId"] == "experiment-0001"
    bad_fold = {**walk["folds"][0], "validationStart": walk["holdout"]["holdoutStart"]}
    with pytest.raises(ArtifactError):
        build_evaluation_split(
            split_id="evaluationsplit-0002",
            owner_id="owner-val-test",
            workspace_id="workspace-val-test",
            at="2026-11-04T12:00:00Z",
            experiment_id="experiment-0001",
            fold=bad_fold,
            holdout=walk["holdout"],
        )


def test_holdout_contamination_cannot_be_reset():
    uses = [{"purpose": "selection"}]
    assert holdout_status(uses) == "contaminated"
    with pytest.raises(ArtifactError, match="holdout_contaminated"):
        assert_holdout_claim(uses, claim="untouched-holdout")
    # Renaming/copying changes nothing: any recorded use blocks the claim.
    with pytest.raises(ArtifactError, match="holdout_contaminated"):
        assert_holdout_claim([{"purpose": "final-report"}], claim="untouched-holdout")
    assert assert_holdout_claim([], claim="untouched-holdout") is True


SMA_DOC = {
    "format": "chartly-rules-v1",
    "kind": "strategy",
    "inputs": [
        {"name": "level", "type": "decimal", "default": "10", "min": "1", "max": "100"},
        {"name": "source", "type": "source", "default": "close"},
    ],
    "outputs": [
        {"name": "entry", "plot": "marker"},
        {"name": "exit", "plot": "marker"},
    ],
    "policy": {"warmupBars": 2, "barCloseOnly": True, "missingData": "skip-bar"},
    "rules": [
        {"op": "cross_over", "left": "close", "right": "level", "output": "entry"},
        {"op": "cross_under", "left": "close", "right": "level", "output": "exit"},
    ],
}


def test_trials_preserve_failures_and_report_stability():
    result = run_parameter_trials(
        SMA_DOC,
        base_values={},
        search_space={"level": ["10", "99", "not-a-number"]},
        candles=CANDLES,
        manifest_template=_manifest(),
        coverage=COVERAGE,
    )
    assert result["budget"] == {"declared": 3, "run": 3, "truncated": False}
    statuses = [row["status"] for row in result["trials"]]
    assert statuses == ["completed", "completed", "failed"]
    assert result["selection"]["values"]["level"] == "10"
    assert result["stability"]["completed"] == 2 and result["stability"]["failed"] == 1
    combos, budget = expand_search_space({"a": ["1", "2"], "b": ["x", "y", "z"]}, max_trials=4)
    assert len(combos) == 4 and budget["truncated"] is True and budget["declared"] == 6
