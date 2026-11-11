"""Reference reader for the standalone Chartly chart-study protocol v1."""

import json
import re
import sys

MAX_BYTES = 1_048_576
MAX_CANDLES = 4096
MAX_VALUE = 1_000_000_000_000
MAX_TIME = 253402300799
ID_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9._-]{0,63}")
REQUEST_FIELDS = {"version", "id", "method", "study", "parameters", "candles"}
CANDLE_FIELDS = {"time", "open", "high", "low", "close", "volume"}


def identifier(value):
    return isinstance(value, str) and ID_PATTERN.fullmatch(value) is not None


def number(value, minimum, maximum):
    return type(value) in (int, float) and minimum <= value <= maximum


def integer(value, minimum, maximum):
    return number(value, minimum, maximum) and value == int(value)


def fail(code, request_id=None):
    return {"version": 1, "id": request_id, "error": {"code": code}}


def valid_candles(candles):
    if not isinstance(candles, list) or not 1 <= len(candles) <= MAX_CANDLES:
        return False
    previous_time = -1
    for candle in candles:
        if not isinstance(candle, dict) or set(candle) != CANDLE_FIELDS:
            return False
        time = candle["time"]
        if not integer(time, 0, MAX_TIME) or time <= previous_time:
            return False
        if not all(
            number(candle[key], -MAX_VALUE, MAX_VALUE) for key in ("open", "high", "low", "close")
        ):
            return False
        if not (
            candle["low"] <= min(candle["open"], candle["close"])
            and max(candle["open"], candle["close"]) <= candle["high"]
            and number(candle["volume"], 0, MAX_VALUE)
        ):
            return False
        previous_time = time
    return True


def reject_constant(_):
    raise ValueError("Non-JSON numeric constant")


def accumulate(total, correction, value):
    updated = total + value
    if abs(total) >= abs(value):
        correction += (total - updated) + value
    else:
        correction += (value - updated) + total
    return updated, correction


def evaluate(raw):
    try:
        request = json.loads(raw.decode("utf-8"), parse_constant=reject_constant, parse_int=float)
    except (UnicodeError, ValueError, RecursionError):
        return fail("request.invalid_json")
    if not isinstance(request, dict):
        return fail("request.invalid")
    request_id = request.get("id")
    if not identifier(request_id):
        return fail("request.invalid")
    if not integer(request.get("version"), 1, 1):
        return fail("request.unsupported_version", request_id)
    if (
        set(request) != REQUEST_FIELDS
        or request["method"] != "study.evaluate"
        or not identifier(request["study"])
        or not isinstance(request["parameters"], dict)
    ):
        return fail("request.invalid", request_id)
    if request["study"] != "sma.close":
        return fail("study.unsupported", request_id)
    parameters = request["parameters"]
    if set(parameters) != {"period"} or not integer(parameters["period"], 1, MAX_CANDLES):
        return fail("study.invalid_parameters", request_id)
    candles = request["candles"]
    if not valid_candles(candles):
        return fail("study.invalid_candles", request_id)

    period = int(parameters["period"])
    running = correction = 0.0
    points = []
    for index, candle in enumerate(candles):
        if index >= period:
            running, correction = accumulate(running, correction, -candles[index - period]["close"])
        running, correction = accumulate(running, correction, candle["close"])
        value = (
            max(-MAX_VALUE, min(MAX_VALUE, (running + correction) / period))
            if index + 1 >= period
            else None
        )
        points.append({"time": int(candle["time"]), "value": value})
    return {"version": 1, "id": request_id, "series": [{"id": "sma", "points": points}]}


def main():
    stream = sys.stdin.buffer
    output = sys.stdout.buffer
    while raw := stream.readline(MAX_BYTES + 2):
        line = raw.removesuffix(b"\n").removesuffix(b"\r") if raw.endswith(b"\n") else raw
        if len(line) > MAX_BYTES:
            while raw and not raw.endswith(b"\n"):
                raw = stream.readline(MAX_BYTES + 2)
            reply = fail("request.too_large")
        else:
            reply = evaluate(line)
        output.write(json.dumps(reply, allow_nan=False, separators=(",", ":")).encode("utf-8"))
        output.write(b"\n")
        output.flush()


if __name__ == "__main__":
    main()
