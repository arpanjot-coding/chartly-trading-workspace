"""Both reference processes conform to the same wire shapes and fixtures."""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "chart-study" / "v1"
REQUESTS = (CONTRACT / "fixtures" / "requests.jsonl").read_bytes()
RESPONSES = (CONTRACT / "fixtures" / "responses.jsonl").read_bytes()
SCHEMA = json.loads((CONTRACT / "protocol.schema.json").read_bytes())
VALIDATOR = Draft202012Validator(SCHEMA)
MAX_BYTES = 1_048_576


@pytest.fixture(params=["python", "node"])
def run_study(request):
    if request.param == "python":
        command = [sys.executable, str(ROOT / "examples" / "python" / "chart_study.py")]
    else:
        node = shutil.which("node")
        if node is None:
            pytest.skip("Node.js is needed for the cross-language protocol tests")
        command = [node, str(ROOT / "examples" / "nodejs" / "chart_study.mjs")]

    def run(data):
        process = subprocess.run(
            command, input=data, capture_output=True, cwd=ROOT, check=True, timeout=15
        )
        assert not process.stderr
        assert process.stdout.endswith(b"\n")
        lines = process.stdout.splitlines()
        assert all(len(line) <= MAX_BYTES for line in lines)
        replies = [json.loads(line) for line in lines]
        for reply in replies:
            VALIDATOR.validate(reply)
        return replies

    return run


def base_request():
    return json.loads(REQUESTS.splitlines()[0])


def encoded(value):
    return json.dumps(value, separators=(",", ":")).encode("utf-8")


def test_reference_clients_match_shared_fixtures_and_exact_input_times(run_study):
    Draft202012Validator.check_schema(SCHEMA)
    requests = [json.loads(line) for line in REQUESTS.splitlines()]
    expected = [json.loads(line) for line in RESPONSES.splitlines()]
    for request in requests:
        VALIDATOR.validate(request)
    replies = run_study(REQUESTS)
    assert replies == expected
    for request, reply in zip(requests, replies, strict=True):
        assert reply["id"] == request["id"]
        for series in reply["series"]:
            assert [point["time"] for point in series["points"]] == [
                candle["time"] for candle in request["candles"]
            ]


def test_process_recovers_after_bad_lines_and_respects_exact_frame_budget(run_study):
    valid = REQUESTS.splitlines()[0]
    exact = valid.ljust(MAX_BYTES, b" ")
    oversized = b" " * (2 * MAX_BYTES + 1)
    replies = run_study(b"\xff\n\n" + oversized + b"\n" + exact + b"\r\n" + valid)
    assert [reply["error"]["code"] for reply in replies[:3]] == [
        "request.invalid_json",
        "request.invalid_json",
        "request.too_large",
    ]
    assert all(reply["id"] is None for reply in replies[:3])
    assert replies[3] == replies[4] == json.loads(RESPONSES.splitlines()[0])


def test_process_refuses_versions_methods_and_account_or_execution_fields(run_study):
    request = base_request()
    cases = [
        ({**request, "version": 2}, "request.unsupported_version"),
        ({**request, "version": True}, "request.unsupported_version"),
        ({**request, "method": "order.place"}, "request.invalid"),
        ({**request, "account": "private-account"}, "request.invalid"),
        ({**request, "study": "other.study"}, "study.unsupported"),
        ({**request, "parameters": {"period": 0}}, "study.invalid_parameters"),
        ({**request, "parameters": {"period": 4097}}, "study.invalid_parameters"),
        (
            {**request, "parameters": {"period": 2, "credential": "test-only"}},
            "study.invalid_parameters",
        ),
    ]
    responses = run_study(b"\n".join(encoded(value) for value, _ in cases) + b"\n")
    assert responses == [
        {"version": 1, "id": request["id"], "error": {"code": code}} for _, code in cases
    ]
    assert not VALIDATOR.is_valid({**request, "account": "private-account"})
    assert not VALIDATOR.is_valid({**request, "parameters": {"credential": "test-only"}})


def test_process_rejects_invalid_candle_time_price_volume_and_count(run_study):
    request = base_request()
    first, second, third = request["candles"]
    cases = [
        [],
        [first, {**second, "time": first["time"]}],
        [third, first],
        [{**first, "time": first["time"] + 0.5}],
        [{**first, "close": first["high"] + 1}],
        [{**first, "volume": -1}],
        [{**first, "open": 1e15}],
        [{**first, "open": False}],
        [{**first, "extra": "unexpected"}],
        [{**first, "time": first["time"] + index * 60} for index in range(4097)],
    ]
    replies = run_study(b"\n".join(encoded({**request, "candles": candles}) for candles in cases))
    assert replies == [
        {"version": 1, "id": request["id"], "error": {"code": "study.invalid_candles"}}
    ] * len(cases)
