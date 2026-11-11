"""P20-T07 parity fixtures: batch vs prefix replay, preview plumbing,
and EMA/RSI against an independent rational-arithmetic oracle."""

from decimal import Decimal
from fractions import Fraction

import pytest

from services.strategy_artifact_store import StrategyArtifactStore
from services.strategy_rules import compile_plan, evaluate_plan
from services.strategy_templates import TEMPLATES, template_document

pytest_plugins = ["test_journal_service"]
ORIGIN = "journal_origin_01"


def _candles(closes):
    return [
        {
            "time": f"2026-01-01T{index // 60:02d}:{index % 60:02d}:00Z",
            "open": str(value),
            "high": str(value),
            "low": str(value),
            "close": str(value),
            "volume": "10",
        }
        for index, value in enumerate(closes)
    ]


SERIES = [100, 98, 97, 99, 102, 101, 104, 108, 107, 110, 112, 111, 109, 113, 116, 115, 118, 121, 120, 124, 127, 126, 130, 129, 133, 136, 135, 139, 142, 145]


def test_prefix_replay_matches_batch_for_all_templates():
    candles = _candles(SERIES)
    for template in TEMPLATES:
        document, _name, _kind = template_document(template["id"])
        plan = compile_plan(document)
        batch = evaluate_plan(plan, candles)
        for end in range(1, len(candles) + 1):
            prefix = evaluate_plan(plan, candles[:end])
            assert prefix[-1]["outputs"] == batch[end - 1]["outputs"], (
                template["id"],
                end,
            )


def _oracle_ema(values, length):
    out = [None] * len(values)
    if len(values) < length:
        return out
    current = Fraction(sum(values[:length]), length)
    out[length - 1] = current
    k = Fraction(2, length + 1)
    for index in range(length, len(values)):
        current = (Fraction(values[index]) - current) * k + current
        out[index] = current
    return out


def _oracle_rsi(values, length):
    out = [None] * len(values)
    gains, losses = [], []
    avg_gain = avg_loss = None
    for index in range(1, len(values)):
        change = values[index] - values[index - 1]
        gain = Fraction(max(change, 0))
        loss = Fraction(max(-change, 0))
        if avg_gain is None:
            gains.append(gain)
            losses.append(loss)
            if len(gains) < length:
                continue
            avg_gain = sum(gains) / length
            avg_loss = sum(losses) / length
        else:
            avg_gain = (avg_gain * (length - 1) + gain) / length
            avg_loss = (avg_loss * (length - 1) + loss) / length
        out[index] = None if avg_loss == 0 and avg_gain == 0 else (
            Fraction(100) if avg_loss == 0 else Fraction(100) - Fraction(100) / (1 + avg_gain / avg_loss)
        )
    return out


def _close(actual_text, expected_fraction):
    if expected_fraction is None:
        return actual_text is None
    if actual_text is None:
        return False
    return abs(Decimal(actual_text) - Decimal(expected_fraction.numerator) / Decimal(expected_fraction.denominator)) <= Decimal("0.000000000001")


def test_ema_rsi_match_independent_rational_oracle():
    doc = {
        "format": "chartly-rules-v1",
        "kind": "indicator",
        "inputs": [{"name": "source", "type": "source", "default": "close"}],
        "outputs": [
            {"name": "smooth", "plot": "line"},
            {"name": "strength", "plot": "line"},
        ],
        "policy": {"warmupBars": 0, "barCloseOnly": True, "missingData": "skip-bar"},
        "rules": [
            {"op": "ema", "input": "source", "length": "5", "output": "smooth"},
            {"op": "rsi", "input": "source", "length": "6", "output": "strength"},
        ],
    }
    rows = evaluate_plan(compile_plan(doc), _candles(SERIES))
    ema_expected = _oracle_ema(SERIES, 5)
    rsi_expected = _oracle_rsi(SERIES, 6)
    for index, row in enumerate(rows):
        assert _close(row["outputs"]["smooth"], ema_expected[index]), index
        assert _close(row["outputs"]["strength"], rsi_expected[index]), index


def test_store_preview_matches_direct_evaluation(storage):
    store = StrategyArtifactStore(storage)
    bundle = store.create_from_template(ORIGIN, "template-sma-cross-strategy")
    bundle = store.create_revision(ORIGIN, bundle["id"], expected_revision=1)
    revision = bundle["revisions"][0]
    params = bundle["parameterSets"][0]
    candles = _candles(SERIES)
    preview = store.preview_revision(
        ORIGIN, bundle["id"], revision_id=revision["id"], parameter_set_id=params["id"], candles=candles
    )
    document, _name, _kind = template_document("template-sma-cross-strategy")
    direct = evaluate_plan(compile_plan(document, params["values"]), candles)
    assert preview["rows"] == direct
