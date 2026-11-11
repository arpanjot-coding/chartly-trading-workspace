"""Strategy experiment manifests, quality gates and simulator (P21-T01 core).

A manifest pins every input that can change a result. Quality checks run
before any compute: coverage, warmup depth, supported fill timing,
sizing and cost bounds, computational budget. The baseline simulator is
long-only spot with next-bar-open fills, exact Decimal cash accounting,
explicit fee/slippage models and deterministic output — identical
pinned inputs always produce the identical report checksum. Simulated
results are research evidence only; nothing here can arm an account.
"""

from __future__ import annotations

import hashlib
import json
import re
from decimal import ROUND_DOWN, Decimal, InvalidOperation, localcontext

from services.domain.validation import validate_record
from services.strategy_artifacts import ArtifactError
from services.strategy_rules import evaluate_plan

ENGINE = {"name": "chartly-rules-sim", "version": "1.0", "capabilityId": "capability-rules-sim-v1"}
MAX_EXPERIMENT_BARS = 100000
DISPLAY_SCALE = 12
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")
_INSTANT = re.compile(r"\d{4}-\d{2}-\d{2}T")


def _fail(code):
    raise ArtifactError("experiment." + code)


def _decimal(text, *, positive=False):
    if not isinstance(text, str) or not _DECIMAL_TEXT.fullmatch(text):
        return None
    try:
        value = Decimal(text)
    except InvalidOperation:
        return None
    if positive and value <= 0:
        return None
    return value


def _text_amount(value):
    return format(value.normalize(), "f")


def _display(value):
    return format(value.quantize(Decimal(1).scaleb(-DISPLAY_SCALE)).normalize(), "f")


def validate_manifest(manifest, *, plan, coverage):
    """Return issue codes; empty means the experiment may run.

    coverage: {firstBarTime, lastBarTime, warmupBarsAvailable} describing
    the pinned dataset slice from warmupStart to rangeStart.
    """
    issues = []
    if not isinstance(manifest, dict):
        return ["experiment.manifest_invalid"]
    for field in ("artifactRevisionId", "parameterSetId", "datasetVersionId", "instrumentId"):
        if not isinstance(manifest.get(field), str) or not manifest[field]:
            issues.append("experiment.pin_missing")
    for field in ("warmupStart", "rangeStart", "rangeEnd"):
        if not isinstance(manifest.get(field), str) or not _INSTANT.match(manifest[field]):
            issues.append("experiment.range_invalid")
    if not issues:
        if not (manifest["warmupStart"] <= manifest["rangeStart"] < manifest["rangeEnd"]):
            issues.append("experiment.range_invalid")
        if manifest["rangeStart"] < coverage["firstBarTime"] or manifest["rangeEnd"] > coverage["lastBarTime"]:
            issues.append("experiment.coverage_insufficient")
        if coverage["warmupBarsAvailable"] < plan["policy"]["warmupBars"]:
            issues.append("experiment.warmup_insufficient")
    if _decimal(manifest.get("startingCash", {}).get("value") if isinstance(manifest.get("startingCash"), dict) else None, positive=True) is None:
        issues.append("experiment.starting_cash_invalid")
    cost = manifest.get("costModel") or {}
    for field in ("feeBps", "slippageBps"):
        value = _decimal(cost.get(field))
        if value is None or not (0 <= value <= 10000):
            issues.append("experiment.cost_model_invalid")
    fill = manifest.get("fillPolicy") or {}
    if fill.get("timing") != "next-bar-open":
        issues.append("experiment.fill_timing_unsupported")
    sizing = fill.get("sizing") or {}
    fraction = _decimal(sizing.get("fraction"))
    if sizing.get("mode") != "fixed-fraction" or fraction is None or not (0 < fraction <= 1):
        issues.append("experiment.sizing_invalid")
    step = _decimal(manifest.get("quantityStep"), positive=True)
    scale = manifest.get("quantityScale")
    if step is None or type(scale) is not int or not 0 <= scale <= 18:
        issues.append("experiment.quantity_economics_missing")
    outputs = set(plan.get("outputs", []))
    if manifest.get("entryOutput") not in outputs or manifest.get("exitOutput") not in outputs:
        issues.append("experiment.signal_output_missing")
    if type(manifest.get("seed")) is not int:
        issues.append("experiment.seed_invalid")
    if coverage.get("totalBars", 0) > MAX_EXPERIMENT_BARS:
        issues.append("experiment.budget_exceeded")
    return sorted(set(issues))


def _floor_step(quantity, step, scale):
    units = (quantity / step).to_integral_value(rounding=ROUND_DOWN)
    return (units * step).quantize(Decimal(1).scaleb(-scale)) if scale else units * step


def run_experiment(plan, candles, manifest, *, fill_delay_bars=0, miss_entry_probability=None):
    """Deterministic long-only simulation over warmup+range candles.

    Signals are read at bar close and filled at the next bar's open with
    declared slippage; fees are charged on notional. A position still
    open at range end is marked at the last close and reported open —
    never silently force-closed. The optional stress hooks (extra fill
    delay, seeded missed entries) default off and never alter baseline
    reports; stress scenarios that use them are labelled as reruns.
    """
    import random as _random

    if type(fill_delay_bars) is not int or fill_delay_bars < 0:
        _fail("fill_delay_invalid")
    miss_rng = _random.Random(manifest["seed"]) if miss_entry_probability is not None else None
    missed_entries = 0
    rows = evaluate_plan(plan, candles)
    range_start, range_end = manifest["rangeStart"], manifest["rangeEnd"]
    cash = Decimal(manifest["startingCash"]["value"])
    starting = cash
    fee_rate = Decimal(manifest["costModel"]["feeBps"]) / Decimal(10000)
    slip_rate = Decimal(manifest["costModel"]["slippageBps"]) / Decimal(10000)
    fraction = Decimal(manifest["fillPolicy"]["sizing"]["fraction"])
    step = Decimal(manifest["quantityStep"])
    scale = manifest["quantityScale"]
    entry_name, exit_name = manifest["entryOutput"], manifest["exitOutput"]
    position = None
    trades = []
    equity = []
    with localcontext() as context:
        context.prec = 60
        for index, candle in enumerate(candles):
            at = candle["time"]
            in_range = range_start <= at < range_end
            open_price = Decimal(candle["open"])
            close_price = Decimal(candle["close"])
            signal_index = index - 1 - fill_delay_bars
            if in_range and signal_index >= 0:
                signals = rows[signal_index]["outputs"]
                if (
                    position is None
                    and signals.get(entry_name) is True
                    and miss_rng is not None
                    and miss_rng.random() < float(miss_entry_probability)
                ):
                    missed_entries += 1
                    signals = {}
                if position is None and signals.get(entry_name) is True:
                    fill_price = open_price * (1 + slip_rate)
                    budget = cash * fraction
                    # Size against price + entry fee so the declared
                    # fraction is never exceeded by costs.
                    quantity = _floor_step(budget / (fill_price * (1 + fee_rate)), step, scale)
                    if quantity > 0:
                        notional = quantity * fill_price
                        fee = notional * fee_rate
                        if notional + fee <= cash:
                            cash -= notional + fee
                            position = {
                                "quantity": quantity,
                                "entryPrice": fill_price,
                                "entryFee": fee,
                                "entryTime": at,
                            }
                elif position is not None and signals.get(exit_name) is True:
                    fill_price = open_price * (1 - slip_rate)
                    notional = position["quantity"] * fill_price
                    fee = notional * fee_rate
                    entry_notional = position["quantity"] * position["entryPrice"]
                    gross = notional - entry_notional
                    total_fees = position["entryFee"] + fee
                    cash += notional - fee
                    trades.append(
                        {
                            "entryTime": position["entryTime"],
                            "exitTime": at,
                            "quantity": _text_amount(position["quantity"]),
                            "entryPrice": _text_amount(position["entryPrice"]),
                            "exitPrice": _text_amount(fill_price),
                            "grossPnl": _text_amount(gross),
                            "fees": _text_amount(total_fees),
                            "netPnl": _text_amount(gross - total_fees),
                        }
                    )
                    position = None
            if in_range:
                value = cash + (position["quantity"] * close_price if position else Decimal(0))
                equity.append({"time": at, "equity": _text_amount(value)})
        final_mark = equity[-1]["equity"] if equity else _text_amount(cash)
        peak = starting
        max_drawdown = Decimal(0)
        for point in equity:
            value = Decimal(point["equity"])
            peak = max(peak, value)
            if peak > 0:
                max_drawdown = max(max_drawdown, (peak - value) / peak)
        wins = sum(1 for trade in trades if Decimal(trade["netPnl"]) > 0)
        report = {
            "format": "chartly-experiment-report-v1",
            "engine": f"{ENGINE['name']}@{ENGINE['version']}",
            "startingCash": _text_amount(starting),
            "endingEquity": final_mark,
            "totalReturn": _display((Decimal(final_mark) - starting) / starting) if starting else "0",
            "maxDrawdown": _display(max_drawdown),
            "tradeCount": len(trades),
            "winRate": _display(Decimal(wins) / Decimal(len(trades))) if trades else None,
            "trades": trades,
            "openPosition": (
                {
                    "quantity": _text_amount(position["quantity"]),
                    "entryPrice": _text_amount(position["entryPrice"]),
                    "entryTime": position["entryTime"],
                }
                if position
                else None
            ),
            "equityCurve": equity,
            **(
                {
                    "stress": {
                        "fillDelayBars": fill_delay_bars,
                        "missEntryProbability": miss_entry_probability,
                        "missedEntries": missed_entries,
                    }
                }
                if fill_delay_bars or miss_entry_probability is not None
                else {}
            ),
            "assumptions": {
                "fillTiming": "next-bar-open",
                "feeBps": manifest["costModel"]["feeBps"],
                "slippageBps": manifest["costModel"]["slippageBps"],
                "sizingFraction": manifest["fillPolicy"]["sizing"]["fraction"],
                "seed": manifest["seed"],
                "note": "OHLC simulation cannot resolve intrabar order; results are research evidence, not a performance guarantee.",
            },
        }
        canonical = json.dumps(report, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        report["checksum"] = hashlib.sha256(canonical.encode()).hexdigest()
        return report


def build_experiment_record(*, experiment_id, owner_id, workspace_id, at, manifest):
    record = {
        "schemaVersion": 1,
        "id": experiment_id,
        "ownerId": owner_id,
        "workspaceId": workspace_id,
        "revision": 1,
        "createdAt": at,
        "updatedAt": at,
        "artifactRevisionId": manifest["artifactRevisionId"],
        "parameterSetId": manifest["parameterSetId"],
        "datasetVersionId": manifest["datasetVersionId"],
        "instrumentId": manifest["instrumentId"],
        "engine": dict(ENGINE),
        "rangeStart": manifest["rangeStart"],
        "rangeEnd": manifest["rangeEnd"],
        "warmupStart": manifest["warmupStart"],
        "startingCash": manifest["startingCash"],
        "costModelId": manifest["costModelId"],
        "fillPolicyId": manifest["fillPolicyId"],
        "seed": manifest["seed"],
    }
    issues = validate_record("Experiment", record)
    if issues:
        raise ArtifactError(
            "experiment.canonical_invalid:" + ",".join(sorted({row["code"] for row in issues}))
        )
    return record
