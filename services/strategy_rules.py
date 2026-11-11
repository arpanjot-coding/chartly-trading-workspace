"""chartly-rules-v1 compiler and evaluator (P20-T03).

Compiles a Rule Builder document into a canonical, checksum-identified
plan and evaluates it prefix-causally over closed candles: outputs at
bar N depend only on bars <= N. Warmup produces absent values (never
zero-filled), missing data follows the document policy, and future-bar
access is structurally impossible (only past `lag` offsets exist).
Indicator math is exact Decimal; reported values are rounded half-even
to OUTPUT_SCALE decimal places — a declared display precision for
indicator values, never used for accounting.
"""

from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation, localcontext

from services.strategy_artifacts import (
    SOURCE_FIELDS,
    ArtifactError,
    validate_parameter_values,
    validate_source_document,
)

OUTPUT_SCALE = 12
MAX_BARS = 200000
_OPS = {"sma", "ema", "rsi", "lag", "cross_over", "cross_under", "compare", "and", "or", "not"}
_COMPARISONS = {">", "<", ">=", "<=", "==", "!="}
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")


def _fail(code):
    raise ArtifactError("rules." + code)


def _decimal(text):
    if isinstance(text, str) and _DECIMAL_TEXT.fullmatch(text):
        try:
            return Decimal(text)
        except InvalidOperation:
            return None
    return None


def _out(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    quantized = value.quantize(Decimal(1).scaleb(-OUTPUT_SCALE))
    return format(quantized.normalize(), "f")


def _resolve_parameters(document, values):
    issues = validate_parameter_values(document, values or {})
    if issues:
        _fail("parameters_invalid:" + ",".join(issues))
    resolved = {}
    for entry in document.get("inputs", []):
        resolved[entry["name"]] = (values or {}).get(entry["name"], entry.get("default"))
    return resolved


def compile_plan(document, values=None):
    """Validate + normalize a rules document into a canonical plan."""
    issues = validate_source_document(document, for_revision=True)
    if issues:
        _fail("document_invalid:" + ",".join(issues))
    parameters = _resolve_parameters(document, values)
    input_types = {entry["name"]: entry["type"] for entry in document.get("inputs", [])}
    declared_outputs = {entry["name"] for entry in document.get("outputs", [])}
    series = set(SOURCE_FIELDS)
    steps = []
    for index, rule in enumerate(document.get("rules", [])):
        if not isinstance(rule, dict):
            _fail("rule_invalid")
        op = rule.get("op")
        if op not in _OPS:
            _fail("op_unsupported")
        output = rule.get("output")
        if not isinstance(output, str) or not output or output in series:
            _fail("output_invalid")

        def operand(ref):
            if not isinstance(ref, str) or not ref:
                _fail("reference_invalid")
            if ref in parameters and input_types.get(ref) == "source":
                return {"series": parameters[ref]}
            if ref in series:
                return {"series": ref}
            if ref in parameters and input_types.get(ref) in {"integer", "decimal"}:
                return {"constant": parameters[ref]}
            if _decimal(ref) is not None:
                return {"constant": ref}
            _fail("reference_unknown")

        step = {"index": index, "op": op, "output": output}
        if op in {"sma", "ema", "rsi"}:
            step["input"] = operand(rule.get("input"))
            length_ref = rule.get("length")
            length_text = parameters.get(length_ref, length_ref)
            if not isinstance(length_text, str) or not re.fullmatch(r"\d{1,6}", length_text):
                _fail("length_invalid")
            length = int(length_text)
            if not 1 <= length <= 100000:
                _fail("length_invalid")
            step["length"] = length
        elif op == "lag":
            step["input"] = operand(rule.get("input"))
            bars = rule.get("bars")
            if type(bars) is not int or bars < 0:
                # A negative lag would read the future; it does not exist.
                _fail("future_access")
            step["bars"] = bars
        elif op in {"cross_over", "cross_under", "and", "or"}:
            step["left"] = operand(rule.get("left"))
            step["right"] = operand(rule.get("right"))
        elif op == "compare":
            if rule.get("cmp") not in _COMPARISONS:
                _fail("comparison_invalid")
            step["left"] = operand(rule.get("left"))
            step["right"] = operand(rule.get("right"))
            step["cmp"] = rule["cmp"]
        elif op == "not":
            step["input"] = operand(rule.get("input"))
        series.add(output)
        steps.append(step)
    missing = declared_outputs - series
    if missing:
        _fail("output_unproduced")
    plan = {
        "format": "chartly-rules-plan-v1",
        "kind": document["kind"],
        "policy": document["policy"],
        "parameters": parameters,
        "outputs": [entry["name"] for entry in document.get("outputs", [])],
        "steps": steps,
    }
    canonical = json.dumps(plan, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    plan["checksum"] = hashlib.sha256(canonical.encode()).hexdigest()
    return plan


def build_rules_document(*, kind, inputs, outputs, policy, rules):
    """Rule Builder emission helper: the exact document a person could
    also write by hand, so both compile to the identical plan."""
    document = {
        "format": "chartly-rules-v1",
        "kind": kind,
        "inputs": inputs,
        "outputs": outputs,
        "policy": policy,
        "rules": rules,
    }
    issues = validate_source_document(document, for_revision=True)
    if issues:
        _fail("document_invalid:" + ",".join(issues))
    return document


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------


def _series_values(operand, columns, length):
    if "series" in operand:
        return columns[operand["series"]]
    return [Decimal(operand["constant"])] * length


def _sma(values, length):
    out = []
    window = []
    total = Decimal(0)
    for value in values:
        window.append(value)
        if value is not None:
            total += value
        if len(window) > length:
            dropped = window.pop(0)
            if dropped is not None:
                total -= dropped
        out.append(total / length if len(window) == length and all(v is not None for v in window) else None)
    return out


def _ema(values, length):
    out = [None] * len(values)
    seed = []
    current = None
    factor = Decimal(2) / Decimal(length + 1)
    for index, value in enumerate(values):
        if value is None:
            continue
        if current is None:
            seed.append(value)
            if len(seed) == length:
                current = sum(seed) / length
                out[index] = current
        else:
            current = (value - current) * factor + current
            out[index] = current
    return out


def _rsi(values, length):
    out = [None] * len(values)
    gains, losses = [], []
    avg_gain = avg_loss = None
    previous = None
    for index, value in enumerate(values):
        if value is None:
            continue
        if previous is None:
            previous = value
            continue
        change = value - previous
        previous = value
        gain = change if change > 0 else Decimal(0)
        loss = -change if change < 0 else Decimal(0)
        if avg_gain is None:
            gains.append(gain)
            losses.append(loss)
            if len(gains) == length:
                avg_gain = sum(gains) / length
                avg_loss = sum(losses) / length
            else:
                continue
        else:
            avg_gain = (avg_gain * (length - 1) + gain) / length
            avg_loss = (avg_loss * (length - 1) + loss) / length
        if avg_loss == 0:
            out[index] = Decimal(100) if avg_gain > 0 else None
        else:
            out[index] = Decimal(100) - Decimal(100) / (1 + avg_gain / avg_loss)
    return out


def _compare(left, comparison, right):
    if left is None or right is None:
        return None
    if isinstance(left, bool) or isinstance(right, bool):
        if comparison == "==":
            return left == right
        if comparison == "!=":
            return left != right
        return None
    return {
        ">": left > right,
        "<": left < right,
        ">=": left >= right,
        "<=": left <= right,
        "==": left == right,
        "!=": left != right,
    }[comparison]


def _run(plan, candles):
    """Evaluate over closed candles [{time, open, high, low, close, volume?}].

    Returns one row per bar: {time, outputs{name: text|bool|None}}.
    Missing required fields follow plan policy: `error` raises,
    `skip-bar` yields absent outputs for that bar without advancing
    indicator state for missing inputs.
    """
    if not isinstance(candles, list) or len(candles) > MAX_BARS:
        _fail("candles_invalid")
    policy = plan["policy"]
    columns = {field: [] for field in SOURCE_FIELDS if field in ("open", "high", "low", "close", "volume")}
    times = []
    with localcontext() as context:
        context.prec = 50
        for candle in candles:
            if not isinstance(candle, dict) or "time" not in candle:
                _fail("candles_invalid")
            parsed = {}
            for field in ("open", "high", "low", "close"):
                value = _decimal(candle.get(field))
                if value is None:
                    if policy["missingData"] == "error":
                        _fail("missing_data")
                parsed[field] = value
            volume = _decimal(candle.get("volume")) if "volume" in candle else None
            parsed["volume"] = volume
            times.append(candle["time"])
            for field in columns:
                columns[field].append(parsed[field])
        derived = {
            "hl2": [
                (h + low) / 2 if h is not None and low is not None else None
                for h, low in zip(columns["high"], columns["low"], strict=True)
            ],
            "hlc3": [
                (h + low + c) / 3 if None not in (h, low, c) else None
                for h, low, c in zip(columns["high"], columns["low"], columns["close"], strict=True)
            ],
            "ohlc4": [
                (o + h + low + c) / 4 if None not in (o, h, low, c) else None
                for o, h, low, c in zip(
                    columns["open"], columns["high"], columns["low"], columns["close"], strict=True
                )
            ],
        }
        columns.update(derived)
        count = len(times)
        for step in plan["steps"]:
            op = step["op"]
            if op in {"sma", "ema", "rsi"}:
                source = _series_values(step["input"], columns, count)
                fn = {"sma": _sma, "ema": _ema, "rsi": _rsi}[op]
                columns[step["output"]] = fn(source, step["length"])
            elif op == "lag":
                source = _series_values(step["input"], columns, count)
                bars = step["bars"]
                columns[step["output"]] = [None] * bars + source[: count - bars] if bars else list(source)
            elif op in {"cross_over", "cross_under"}:
                left = _series_values(step["left"], columns, count)
                right = _series_values(step["right"], columns, count)
                out = [None] * count
                for i in range(1, count):
                    if None in (left[i], right[i], left[i - 1], right[i - 1]):
                        continue
                    if isinstance(left[i], bool) or isinstance(right[i], bool):
                        continue
                    out[i] = (
                        (left[i - 1] <= right[i - 1] and left[i] > right[i])
                        if op == "cross_over"
                        else (left[i - 1] >= right[i - 1] and left[i] < right[i])
                    )
                columns[step["output"]] = out
            elif op == "compare":
                left = _series_values(step["left"], columns, count)
                right = _series_values(step["right"], columns, count)
                columns[step["output"]] = [
                    _compare(a, step["cmp"], b) for a, b in zip(left, right, strict=True)
                ]
            elif op in {"and", "or"}:
                left = _series_values(step["left"], columns, count)
                right = _series_values(step["right"], columns, count)
                columns[step["output"]] = [
                    None
                    if a is None or b is None
                    else (bool(a) and bool(b) if op == "and" else bool(a) or bool(b))
                    for a, b in zip(left, right, strict=True)
                ]
            elif op == "not":
                source = _series_values(step["input"], columns, count)
                columns[step["output"]] = [None if v is None else not bool(v) for v in source]
        warmup = policy["warmupBars"]
        rows = []
        for index, at in enumerate(times):
            outputs = {}
            for name in plan["outputs"]:
                value = columns[name][index] if index >= warmup else None
                outputs[name] = _out(value)
            rows.append({"time": at, "outputs": outputs})
        return rows, columns


def evaluate_plan(plan, candles):
    rows, _columns = _run(plan, candles)
    return rows


def evaluate_with_forming_bar(plan, closed_candles, forming_candle=None):
    """Historical rows plus explicit current-candle treatment (P20-T04).

    A bar-close-only artifact never reads the forming candle: its latest
    outputs stay at the last closed bar and the forming bar is reported
    as excluded. Otherwise the forming bar is evaluated and flagged
    provisional so UIs can label values that may still change.
    """
    rows = evaluate_plan(plan, closed_candles)
    if forming_candle is None:
        return {"rows": rows, "forming": None}
    if plan["policy"]["barCloseOnly"]:
        return {
            "rows": rows,
            "forming": {"included": False, "reason": "bar_close_only", "outputs": None},
        }
    extended = evaluate_plan(plan, [*closed_candles, forming_candle])
    return {
        "rows": rows,
        "forming": {
            "included": True,
            "provisional": True,
            "outputs": extended[-1]["outputs"] if extended else None,
        },
    }


def explain_last_bar(plan, candles):
    """Why each output did or did not fire on the latest closed bar."""
    _rows, columns = _run(plan, candles)
    if not candles:
        return {"time": None, "steps": [], "outputs": {}}
    index = len(candles) - 1
    warmup = plan["policy"]["warmupBars"]

    def operand_value(operand):
        if "series" in operand:
            return _out(columns[operand["series"]][index])
        return operand["constant"]

    steps = []
    for step in plan["steps"]:
        facts = {"op": step["op"], "output": step["output"]}
        facts["value"] = _out(columns[step["output"]][index])
        for key in ("input", "left", "right"):
            if key in step:
                facts[key] = operand_value(step[key])
        if "cmp" in step:
            facts["cmp"] = step["cmp"]
        if step["op"] in {"cross_over", "cross_under"} and index >= 1:
            for key in ("left", "right"):
                operand = step[key]
                if "series" in operand:
                    facts[key + "Previous"] = _out(columns[operand["series"]][index - 1])
        steps.append(facts)
    outputs = {}
    for name in plan["outputs"]:
        value = columns[name][index] if index >= warmup else None
        if value is None:
            reason = "warmup" if index < warmup else "insufficient_data"
        elif value is True:
            reason = "fired"
        elif value is False:
            reason = "condition_false"
        else:
            reason = "value"
        outputs[name] = {"value": _out(value), "reason": reason}
    return {"time": candles[-1]["time"], "steps": steps, "outputs": outputs}
