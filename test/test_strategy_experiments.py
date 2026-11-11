"""P21-T01: manifest quality gates + deterministic exact-cost simulation."""

from services.domain.validation import validate_record
from services.strategy_experiments import (
    build_experiment_record,
    run_experiment,
    validate_manifest,
)
from services.strategy_rules import compile_plan

DOC = {
    "format": "chartly-rules-v1",
    "kind": "strategy",
    "inputs": [{"name": "source", "type": "source", "default": "close"}],
    "outputs": [
        {"name": "entry", "plot": "marker"},
        {"name": "exit", "plot": "marker"},
    ],
    "policy": {"warmupBars": 2, "barCloseOnly": True, "missingData": "skip-bar"},
    "rules": [
        {"op": "cross_over", "left": "close", "right": "10", "output": "entry"},
        {"op": "cross_under", "left": "close", "right": "10", "output": "exit"},
    ],
}

# Distinct opens prove next-bar-open fills (never signal-bar prices).
BARS = [
    # time, open, close
    ("2026-01-01T00:00:00Z", "8", "8"),
    ("2026-01-01T01:00:00Z", "8", "9"),
    ("2026-01-01T02:00:00Z", "9", "11"),   # entry signal at close
    ("2026-01-01T03:00:00Z", "12", "13"),  # buy fills here at open 12
    ("2026-01-01T04:00:00Z", "13", "9"),   # exit signal at close
    ("2026-01-01T05:00:00Z", "15", "9"),   # sell fills here at open 15
    ("2026-01-01T06:00:00Z", "9", "9"),
]
CANDLES = [
    {"time": at, "open": o, "high": max(o, c), "low": min(o, c), "close": c, "volume": "10"}
    for at, o, c in BARS
]
COVERAGE = {
    "firstBarTime": "2026-01-01T00:00:00Z",
    "lastBarTime": "2026-01-01T07:00:00Z",
    "warmupBarsAvailable": 2,
    "totalBars": len(CANDLES),
}


def _manifest(**changes):
    manifest = {
        "artifactRevisionId": "artifactrevision-0001",
        "parameterSetId": "parameterset-0001",
        "datasetVersionId": "datasetversion-0001",
        "instrumentId": "instrument-kraken-btc-usd",
        "costModelId": "costmodel-spot-001",
        "fillPolicyId": "fillpolicy-next-open",
        "warmupStart": "2026-01-01T00:00:00Z",
        "rangeStart": "2026-01-01T02:00:00Z",
        "rangeEnd": "2026-01-01T07:00:00Z",
        "startingCash": {"value": "1200", "currency": "USD"},
        "costModel": {"feeBps": "0", "slippageBps": "0"},
        "fillPolicy": {"timing": "next-bar-open", "sizing": {"mode": "fixed-fraction", "fraction": "1"}},
        "quantityStep": "1",
        "quantityScale": 0,
        "entryOutput": "entry",
        "exitOutput": "exit",
        "seed": 42,
    }
    manifest.update(changes)
    return manifest


def test_manifest_quality_gates():
    plan = compile_plan(DOC)
    assert validate_manifest(_manifest(), plan=plan, coverage=COVERAGE) == []
    assert validate_manifest(
        _manifest(), plan=plan, coverage={**COVERAGE, "warmupBarsAvailable": 1}
    ) == ["experiment.warmup_insufficient"]
    bad = _manifest(fillPolicy={"timing": "same-bar-close", "sizing": {"mode": "fixed-fraction", "fraction": "1"}})
    assert "experiment.fill_timing_unsupported" in validate_manifest(bad, plan=plan, coverage=COVERAGE)
    bad = _manifest(entryOutput="moon")
    assert "experiment.signal_output_missing" in validate_manifest(bad, plan=plan, coverage=COVERAGE)


def test_simulation_next_open_fills_with_exact_zero_cost_math():
    # Buy 100 units at open 12 (1200 cash), sell at open 15 -> +300.
    report = run_experiment(compile_plan(DOC), CANDLES, _manifest())
    [trade] = report["trades"]
    assert trade["entryTime"] == "2026-01-01T03:00:00Z"
    assert trade["entryPrice"] == "12" and trade["quantity"] == "100"
    assert trade["exitTime"] == "2026-01-01T05:00:00Z" and trade["exitPrice"] == "15"
    assert trade["grossPnl"] == "300" and trade["netPnl"] == "300"
    assert report["endingEquity"] == "1500"
    assert report["totalReturn"] == "0.25"
    assert report["openPosition"] is None


def test_fees_and_slippage_are_applied_exactly():
    manifest = _manifest(costModel={"feeBps": "100", "slippageBps": "0"})
    report = run_experiment(compile_plan(DOC), CANDLES, manifest)
    [trade] = report["trades"]
    # Quantity still 100 would need 1200 + 12 fee > cash, so sizing keeps
    # 100 only if affordable: budget is cash*fraction on price alone and
    # affordability includes the fee, hence 99 units fit exactly.
    assert trade["quantity"] == "99"
    # Entry fee 99*12*1% = 11.88; exit fee 99*15*1% = 14.85; gross 297.
    assert trade["fees"] == "26.73"
    assert trade["netPnl"] == "270.27"


def test_determinism_and_open_position_reporting():
    plan = compile_plan(DOC)
    first = run_experiment(plan, CANDLES, _manifest())
    second = run_experiment(plan, CANDLES, _manifest())
    assert first == second and first["checksum"] == second["checksum"]
    # Truncate before the exit fill: position stays open and is marked.
    truncated = CANDLES[:5]
    manifest = _manifest(rangeEnd="2026-01-01T05:00:00Z")
    report = run_experiment(plan, truncated, manifest)
    assert report["trades"] == []
    assert report["openPosition"]["quantity"] == "100"
    assert report["endingEquity"] == "900"  # 0 cash + 100 * close 9


def test_experiment_record_is_canonical():
    record = build_experiment_record(
        experiment_id="experiment-0001",
        owner_id="owner-exp-test",
        workspace_id="workspace-exp-test",
        at="2026-11-04T12:00:00Z",
        manifest=_manifest(),
    )
    assert validate_record("Experiment", record) == []
    assert record["engine"]["name"] == "chartly-rules-sim"
