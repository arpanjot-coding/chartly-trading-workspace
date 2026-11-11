"""Execution/data stress scenarios and seeded resampling (P21-T05/T06).

Every stress scenario **reruns causal matching** through the baseline
simulator with declared changed assumptions (costs, slippage, fill
delay, seeded missed entries, bar gaps). Nothing here transforms
finished returns and calls it execution modelling, and unsupported
microstructure (queue position, partial-fill priority) stays
unavailable rather than implied. Monte Carlo resamples realized trade
outcomes with a recorded seed; paths are sensitivity illustrations,
not probability guarantees.
"""

from __future__ import annotations

import hashlib
import json
import random
from decimal import Decimal

from services.strategy_artifacts import ArtifactError
from services.strategy_experiments import run_experiment


def _fail(code):
    raise ArtifactError("stress." + code)


def _gap_candles(candles, drop_every):
    if drop_every is None:
        return candles
    if type(drop_every) is not int or drop_every < 2:
        _fail("gap_invalid")
    return [c for index, c in enumerate(candles) if (index + 1) % drop_every != 0]


def run_stress_scenarios(plan, candles, manifest, scenarios):
    results = []
    for scenario in scenarios:
        if not isinstance(scenario, dict) or not isinstance(scenario.get("name"), str):
            _fail("scenario_invalid")
        altered = json.loads(json.dumps(manifest))
        if "feeBps" in scenario:
            altered["costModel"]["feeBps"] = scenario["feeBps"]
        if "slippageBps" in scenario:
            altered["costModel"]["slippageBps"] = scenario["slippageBps"]
        stressed_candles = _gap_candles(candles, scenario.get("dropEvery"))
        try:
            report = run_experiment(
                plan,
                stressed_candles,
                altered,
                fill_delay_bars=scenario.get("fillDelayBars", 0),
                miss_entry_probability=scenario.get("missEntryProbability"),
            )
            results.append(
                {
                    "name": scenario["name"],
                    "model": "rerun-causal-next-open",
                    "status": "completed",
                    "totalReturn": report["totalReturn"],
                    "maxDrawdown": report["maxDrawdown"],
                    "tradeCount": report["tradeCount"],
                    "endingEquity": report["endingEquity"],
                    "reportChecksum": report["checksum"],
                }
            )
        except ArtifactError as error:
            results.append(
                {
                    "name": scenario["name"],
                    "model": "rerun-causal-next-open",
                    "status": "failed",
                    "failureCode": error.code,
                }
            )
    result = {
        "format": "chartly-stress-report-v1",
        "scenarios": results,
        "note": "Each scenario reruns causal next-open matching with its declared changes. Queue position and partial-fill priority are not modelled.",
    }
    canonical = json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    result["checksum"] = hashlib.sha256(canonical.encode()).hexdigest()
    return result


def _percentile(sorted_values, fraction):
    if not sorted_values:
        return None
    index = min(len(sorted_values) - 1, max(0, round(fraction * (len(sorted_values) - 1))))
    return sorted_values[index]


def monte_carlo_trades(report, *, starting_cash, paths=200, seed=1):
    """Seeded iid resampling of realized trade net outcomes.

    Dependence limitation (stated, not hidden): trades are resampled
    independently, so regime clustering and serial correlation in the
    original sequence are not preserved.
    """
    nets = [Decimal(trade["netPnl"]) for trade in report.get("trades", [])]
    if not nets:
        _fail("no_trades_to_resample")
    if type(paths) is not int or not 1 <= paths <= 10000:
        _fail("paths_invalid")
    start = Decimal(starting_cash)
    rng = random.Random(seed)
    finals = []
    drawdowns = []
    for _ in range(paths):
        equity = start
        peak = start
        worst = Decimal(0)
        for _trade in range(len(nets)):
            equity += nets[rng.randrange(len(nets))]
            peak = max(peak, equity)
            if peak > 0:
                worst = max(worst, (peak - equity) / peak)
        finals.append(equity)
        drawdowns.append(worst)
    finals.sort()
    drawdowns.sort()
    fmt = lambda v: format(v.normalize(), "f") if v is not None else None  # noqa: E731
    result = {
        "format": "chartly-monte-carlo-v1",
        "seed": seed,
        "paths": paths,
        "tradesPerPath": len(nets),
        "finalEquity": {
            "p05": fmt(_percentile(finals, 0.05)),
            "p50": fmt(_percentile(finals, 0.50)),
            "p95": fmt(_percentile(finals, 0.95)),
        },
        "maxDrawdown": {
            "p50": fmt(_percentile(drawdowns, 0.50)),
            "p95": fmt(_percentile(drawdowns, 0.95)),
        },
        "limitations": "Trades are resampled independently (iid); regime clustering and serial dependence are not preserved. Percentiles describe this resampling model only, not future probabilities.",
    }
    canonical = json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    result["checksum"] = hashlib.sha256(canonical.encode()).hexdigest()
    return result
