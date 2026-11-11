"""P20-T03 rule engine: canonical plans, prefix causality, exact math."""

import pytest

from services.strategy_artifacts import ArtifactError
from services.strategy_rules import (
    build_rules_document,
    compile_plan,
    evaluate_plan,
    evaluate_with_forming_bar,
    explain_last_bar,
)

POLICY = {"warmupBars": 0, "barCloseOnly": True, "missingData": "skip-bar"}
INPUTS = [
    {"name": "length", "type": "integer", "default": "3", "min": "1", "max": "500"},
    {"name": "source", "type": "source", "default": "close"},
]


def _candles(closes):
    return [
        {
            "time": f"2026-11-04T00:{index:02d}:00Z",
            "open": str(value),
            "high": str(value),
            "low": str(value),
            "close": str(value),
            "volume": "10",
        }
        for index, value in enumerate(closes)
    ]


def _sma_doc():
    return build_rules_document(
        kind="indicator",
        inputs=INPUTS,
        outputs=[{"name": "avg", "plot": "line"}],
        policy=POLICY,
        rules=[{"op": "sma", "input": "source", "length": "length", "output": "avg"}],
    )


def test_sma_exact_values_and_warmup_absent():
    plan = compile_plan(_sma_doc())
    rows = evaluate_plan(plan, _candles([1, 2, 3, 4, 5]))
    assert [row["outputs"]["avg"] for row in rows] == [None, None, "2", "3", "4"]


def test_prefix_causality_appending_bars_never_changes_history():
    plan = compile_plan(_sma_doc())
    base = evaluate_plan(plan, _candles([1, 2, 3, 4, 5]))
    extended = evaluate_plan(plan, _candles([1, 2, 3, 4, 5, 100, 100]))
    assert [row["outputs"] for row in extended[:5]] == [row["outputs"] for row in base]


def test_rsi_and_cross_strategy_signals():
    doc = build_rules_document(
        kind="strategy",
        inputs=INPUTS,
        outputs=[
            {"name": "strength", "plot": "line"},
            {"name": "entry", "plot": "marker"},
        ],
        policy=POLICY,
        rules=[
            {"op": "rsi", "input": "source", "length": "length", "output": "strength"},
            {"op": "cross_over", "left": "close", "right": "10", "output": "entry"},
        ],
    )
    rows = evaluate_plan(compile_plan(doc), _candles([8, 9, 11, 12, 13, 14]))
    assert rows[1]["outputs"]["entry"] is None or rows[1]["outputs"]["entry"] is False
    assert rows[2]["outputs"]["entry"] is True
    # Monotonic rise: Wilder RSI saturates at 100 once seeded.
    assert rows[-1]["outputs"]["strength"] == "100"


def test_builder_and_handwritten_documents_compile_identically():
    handwritten = {
        "format": "chartly-rules-v1",
        "kind": "indicator",
        "inputs": INPUTS,
        "outputs": [{"name": "avg", "plot": "line"}],
        "policy": POLICY,
        "rules": [{"op": "sma", "input": "source", "length": "length", "output": "avg"}],
    }
    assert compile_plan(handwritten)["checksum"] == compile_plan(_sma_doc())["checksum"]


def test_future_access_and_unknown_references_are_rejected():
    doc = _sma_doc()
    doc["rules"] = [{"op": "lag", "input": "close", "bars": -1, "output": "avg"}]
    with pytest.raises(ArtifactError, match="future_access"):
        compile_plan(doc)
    doc = _sma_doc()
    doc["rules"] = [{"op": "sma", "input": "tomorrow", "length": "length", "output": "avg"}]
    with pytest.raises(ArtifactError, match="reference_unknown"):
        compile_plan(doc)
    doc = _sma_doc()
    doc["rules"] = [{"op": "teleport", "output": "avg"}]
    with pytest.raises(ArtifactError, match="op_unsupported"):
        compile_plan(doc)


def test_missing_data_policies():
    candles = _candles([1, 2, 3, 4])
    del candles[2]["close"]
    skip_rows = evaluate_plan(compile_plan(_sma_doc()), candles)
    assert skip_rows[2]["outputs"]["avg"] is None
    strict = _sma_doc()
    strict["policy"] = {**POLICY, "missingData": "error"}
    with pytest.raises(ArtifactError, match="missing_data"):
        evaluate_plan(compile_plan(strict), candles)


def test_warmup_policy_masks_early_outputs():
    doc = _sma_doc()
    doc["policy"] = {**POLICY, "warmupBars": 4}
    rows = evaluate_plan(compile_plan(doc), _candles([1, 2, 3, 4, 5, 6]))
    assert [row["outputs"]["avg"] for row in rows] == [None, None, None, None, "4", "5"]


def test_parameter_override_changes_plan_identity():
    base = compile_plan(_sma_doc())
    tuned = compile_plan(_sma_doc(), {"length": "2"})
    assert base["checksum"] != tuned["checksum"]
    rows = evaluate_plan(tuned, _candles([1, 2, 3]))
    assert [row["outputs"]["avg"] for row in rows] == [None, "1.5", "2.5"]
    with pytest.raises(ArtifactError, match="parameters_invalid"):
        compile_plan(_sma_doc(), {"length": "9999"})


def test_forming_bar_respects_bar_close_policy():
    closed = _candles([1, 2, 3])
    forming = {
        "time": "2026-11-04T00:03:00Z",
        "open": "100",
        "high": "100",
        "low": "100",
        "close": "100",
        "volume": "1",
    }
    result = evaluate_with_forming_bar(compile_plan(_sma_doc()), closed, forming)
    assert result["forming"] == {"included": False, "reason": "bar_close_only", "outputs": None}
    assert result["rows"][-1]["outputs"]["avg"] == "2"
    intrabar = _sma_doc()
    intrabar["policy"] = {**POLICY, "barCloseOnly": False}
    result = evaluate_with_forming_bar(compile_plan(intrabar), closed, forming)
    assert result["forming"]["included"] is True
    assert result["forming"]["provisional"] is True
    assert result["forming"]["outputs"]["avg"] == "35"  # SMA3 of 2, 3, 100


def test_explain_last_bar_shows_why_entry_did_not_fire():
    doc = build_rules_document(
        kind="strategy",
        inputs=INPUTS,
        outputs=[{"name": "entry", "plot": "marker"}],
        policy=POLICY,
        rules=[{"op": "cross_over", "left": "close", "right": "10", "output": "entry"}],
    )
    explanation = explain_last_bar(compile_plan(doc), _candles([8, 9, 9]))
    assert explanation["outputs"]["entry"] == {"value": False, "reason": "condition_false"}
    [step] = explanation["steps"]
    assert step["left"] == "9" and step["right"] == "10" and step["leftPrevious"] == "9"
    fired = explain_last_bar(compile_plan(doc), _candles([8, 9, 11]))
    assert fired["outputs"]["entry"]["reason"] == "fired"
