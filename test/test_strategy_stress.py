"""P21-T05/T06: causal stress reruns + seeded Monte Carlo."""

from services.strategy_experiments import run_experiment
from services.strategy_rules import compile_plan
from services.strategy_stress import monte_carlo_trades, run_stress_scenarios
from test_strategy_experiments import CANDLES, DOC, _manifest

PLAN = compile_plan(DOC)


def test_baseline_unchanged_by_stress_hooks():
    plain = run_experiment(PLAN, CANDLES, _manifest())
    assert "stress" not in plain
    delayed = run_experiment(PLAN, CANDLES, _manifest(), fill_delay_bars=1)
    # Entry signalled at bar 2 now fills at bar 4 open (13) instead of bar 3.
    assert delayed["trades"] == [] or delayed["trades"][0]["entryPrice"] != "12"
    assert delayed["stress"]["fillDelayBars"] == 1


def test_cost_stress_reruns_and_reduces_return():
    baseline = run_experiment(PLAN, CANDLES, _manifest())
    result = run_stress_scenarios(
        PLAN,
        CANDLES,
        _manifest(),
        [
            {"name": "baseline"},
            {"name": "high-fees", "feeBps": "100", "slippageBps": "50"},
            {"name": "gaps", "dropEvery": 3},
            {"name": "all-missed", "missEntryProbability": 1.0},
        ],
    )
    by_name = {row["name"]: row for row in result["scenarios"]}
    assert by_name["baseline"]["reportChecksum"] == baseline["checksum"]
    assert float(by_name["high-fees"]["totalReturn"]) < float(by_name["baseline"]["totalReturn"])
    assert by_name["all-missed"]["tradeCount"] == 0
    assert all(row["model"] == "rerun-causal-next-open" for row in result["scenarios"])
    assert "not modelled" in result["note"]


def test_monte_carlo_is_seeded_and_bounded_by_outcomes():
    report = run_experiment(PLAN, CANDLES, _manifest())
    first = monte_carlo_trades(report, starting_cash="1200", paths=100, seed=7)
    second = monte_carlo_trades(report, starting_cash="1200", paths=100, seed=7)
    assert first == second
    # Single +300 trade resampled: every path ends at 1500.
    assert first["finalEquity"] == {"p05": "1500", "p50": "1500", "p95": "1500"}
    assert "iid" in first["limitations"]
    manual = {
        "trades": [
            {"netPnl": "100"},
            {"netPnl": "-50"},
            {"netPnl": "100"},
            {"netPnl": "-50"},
        ]
    }
    spread = monte_carlo_trades(manual, starting_cash="1000", paths=400, seed=3)
    assert float(spread["finalEquity"]["p05"]) <= float(spread["finalEquity"]["p50"]) <= float(
        spread["finalEquity"]["p95"]
    )
    assert float(spread["finalEquity"]["p95"]) <= 1400
    assert float(spread["finalEquity"]["p05"]) >= 800
