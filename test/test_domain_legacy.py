import json
from pathlib import Path

import pytest

from services.domain.legacy import classify_legacy_trade, legacy_alias

CASES = json.loads(
    (Path(__file__).resolve().parents[1] / "contracts/v1/fixtures/legacy-cases.json").read_text(
        encoding="utf-8"
    )
)


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_legacy_classification(case):
    assert classify_legacy_trade(case["value"]) == case["expected"]


def test_aliases_do_not_collide_across_origins_or_tables():
    assert legacy_alias("origin-a", "portfolios", 1) == {
        "namespace": "ChartlyTraderDB:origin-a:portfolios",
        "key": "1",
    }
    assert legacy_alias("origin-a", "portfolios", 1) != legacy_alias("origin-b", "portfolios", 1)
    assert legacy_alias("origin-a", "portfolios", 1) != legacy_alias(
        "origin-a", "brokerAccounts", 1
    )


@pytest.mark.parametrize(
    "origin,table,id",
    [
        ("", "portfolios", 1),
        ("a:b", "portfolios", 1),
        ("origin-a", "unknown", 1),
        ("origin-a", "portfolios", True),
        ("origin-a", "portfolios", 1.5),
    ],
)
def test_invalid_alias(origin, table, id):
    with pytest.raises(ValueError):
        legacy_alias(origin, table, id)
