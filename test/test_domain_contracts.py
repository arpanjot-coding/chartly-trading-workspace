"""Independent shared fixtures run against the backend's real runtime validator."""

import json
from copy import deepcopy
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from services.domain.validation import (
    RECORD_TYPES,
    SCHEMA,
    decimal_units,
    require_valid_records,
    validate_record,
    validate_records,
    validate_replacement,
    validate_transition,
)

ROOT = Path(__file__).resolve().parents[1] / "contracts/v1"
MANIFEST = json.loads((ROOT / "fixture-manifest.json").read_text(encoding="utf-8"))
CASES = [
    case
    for file in MANIFEST["files"]
    for case in json.loads((ROOT / file).read_text(encoding="utf-8"))
]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_shared_contract_case(case):
    if case["operation"] == "collection":
        records = json.loads((ROOT / case["baseFile"]).read_text(encoding="utf-8"))
        if "takeBase" in case:
            records = records[: case["takeBase"]]
        if case.get("reverseBase"):
            records.reverse()
        for replacement in case["replace"]:
            records[replacement["index"]] = deepcopy(replacement["record"])
        records.extend(deepcopy(case["append"]))
        actual = validate_records(records)
    elif case["operation"] == "replacement":
        actual = validate_replacement(case["type"], case["previous"], case["proposed"])
    elif case["operation"] == "record":
        actual = validate_record(case["type"], case["value"])
    elif case["operation"] == "transition":
        context = case.get("context", {})
        actual = validate_transition(
            case["machine"],
            case["before"],
            case["after"],
            manifest_valid=context.get("manifestValid", False),
            eligible=context.get("eligible", False),
            approved=context.get("approved", False),
        )
    else:
        raise AssertionError("Unknown fixture operation")
    assert actual == case["expected"]


def test_schema_itself_is_valid():
    Draft202012Validator.check_schema(SCHEMA)


def test_supported_record_types_have_worked_positive_fixtures():
    records = json.loads((ROOT / "fixtures/full-v1.json").read_text(encoding="utf-8"))
    assert {entry["type"] for entry in records} == RECORD_TYPES
    assert validate_records(records) == []


def test_validation_batch_limit_is_explicit():
    assert validate_records([{}] * 10001) == [{"code": "collection.limit", "path": ""}]


def test_decimal_does_not_pass_through_float():
    assert decimal_units("9007199254740993.00000001", 8) == 900719925474099300000001
    assert decimal_units("0.125", 2) is None
    assert decimal_units("1e3", 2) is None
    assert decimal_units("1", True) is None


@pytest.mark.parametrize("value", [None, 3, {}, "records"])
def test_collection_requires_array(value):
    assert validate_records(value) == [{"code": "collection.array_required", "path": ""}]


def test_untrusted_entry_is_rejected():
    assert validate_records([{"type": {}, "value": {}}]) == [
        {"code": "collection.entry_invalid", "path": "/0"}
    ]
    assert validate_record("Decimal", "1") == [{"code": "contract.unknown_type", "path": ""}]


def test_parsed_records_do_not_alias_untrusted_input():
    source = json.loads((ROOT / "fixtures/local-core.json").read_text(encoding="utf-8"))
    result = require_valid_records(source)
    result[2]["value"]["name"] = "Changed"
    assert source[2]["value"]["name"] == "Manual book"
    with pytest.raises(ValueError):
        require_valid_records([{"type": "JournalBook", "value": {}}])
