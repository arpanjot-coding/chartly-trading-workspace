"""Bounded market-history normalization and structural quality, without I/O.

This does not blend providers, repair prices, fill missing candles or certify
source authenticity. A caller owns source/account identity, immutable versions,
the overlap policy and consent to retain only the valid rows of an upload.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation, localcontext
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MAX_CSV_BYTES = 8 * 1024 * 1024
MAX_ROWS = 50_000
MAX_COLUMNS = 32
MAX_CELL_CHARS = 2_000
MAX_DETAILS = 1_000
MAX_PREVIOUS_BARS = 100_000
MAX_CALENDAR_DAYS = 36_600
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
DAY_US = 86_400_000_000
PRICE_FIELDS = ("open", "high", "low", "close")
OPTIONAL_FIELDS = ("volume", "openInterest")
FIELDS = ("timestamp", *PRICE_FIELDS, *OPTIONAL_FIELDS)
INTERVAL_SECONDS = {
    "1s": 1,
    "5s": 5,
    "15s": 15,
    "30s": 30,
    "1m": 60,
    "2m": 120,
    "3m": 180,
    "5m": 300,
    "10m": 600,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "D": 86400,
}
SECRET_HEADERS = {
    "apikey",
    "apisecret",
    "password",
    "passwordhash",
    "authorization",
    "accesstoken",
    "refreshtoken",
    "privatekey",
    "clientsecret",
    "credentials",
    "totpsecret",
    "__proto__",
    "constructor",
    "prototype",
}


class DatasetQualityError(ValueError):
    def __init__(self, code: str, message: str = "Invalid historical data.", status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


def _error(code, message, status=400):
    raise DatasetQualityError(code, message, status)


def _text(value, field, maximum=200, *, blank=False):
    if not isinstance(value, str) or len(value) > maximum:
        _error(f"{field}.invalid", f"{field} must be text of at most {maximum} characters.")
    try:
        value.encode("utf-8")
    except UnicodeError as error:
        raise DatasetQualityError(
            f"{field}.invalid", f"{field} contains invalid Unicode."
        ) from error
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        _error(f"{field}.invalid", f"{field} contains a control character.")
    value = value.strip()
    if not blank and not value:
        _error(f"{field}.required", f"{field} is required.")
    return value


def _zone(value, field):
    value = _text(value, field, 100)
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise DatasetQualityError(f"{field}.invalid", "Choose a valid IANA timezone.") from error
    return value


def _canonical(value):
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )


def _hash(value):
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def validate_mapping(mapping):
    """Normalize only documented mapping keys; no implicit timestamp-unit guessing."""
    allowed = {
        "version",
        "name",
        "columns",
        "timestampFormat",
        "timestampMeaning",
        "timezone",
        "delimiter",
        "decimalSeparator",
        "thousandsSeparator",
    }
    if not isinstance(mapping, dict) or set(mapping) - allowed:
        _error("mapping.invalid", "The mapping contains unsupported fields.")
    if type(mapping.get("version")) is not int or mapping["version"] != 1:
        _error("mapping.version", "Use mapping version 1.")
    columns = mapping.get("columns")
    if not isinstance(columns, dict) or set(columns) - set(FIELDS):
        _error("mapping.columns", "Map timestamp, open, high, low and close columns explicitly.")
    columns = {
        key: _text(value, f"mapping.{key}", 200)
        for key, value in columns.items()
        if value not in (None, "")
    }
    if not {"timestamp", *PRICE_FIELDS} <= set(columns):
        _error("mapping.required_columns", "Timestamp and all four OHLC prices are required.")
    if len(set(columns.values())) != len(columns):
        _error(
            "mapping.duplicate_column", "A CSV column cannot supply two different candle fields."
        )
    timestamp_format = mapping.get("timestampFormat")
    if timestamp_format not in ("iso", "seconds", "milliseconds"):
        _error(
            "mapping.timestamp_format",
            "Choose ISO date/time, epoch seconds or epoch milliseconds explicitly.",
        )
    meaning = mapping.get("timestampMeaning", "open")
    if meaning != "open":
        _error(
            "mapping.timestamp_meaning",
            "This version supports candle-opening timestamps only. Convert closing labels explicitly before importing.",
        )
    delimiter = mapping.get("delimiter", ",")
    if delimiter not in (",", ";", "\t", "|"):
        _error("mapping.delimiter", "Choose comma, semicolon, tab or pipe as the CSV delimiter.")
    decimal = mapping.get("decimalSeparator", ".")
    thousands = mapping.get("thousandsSeparator") or None
    if (
        decimal not in (".", ",")
        or thousands not in (None, ".", ",", " ", "'")
        or decimal == thousands
    ):
        _error(
            "mapping.number_separators",
            "Decimal and thousands separators must be supported and distinct.",
        )
    result = {
        "version": 1,
        "columns": columns,
        "timestampFormat": timestamp_format,
        "timestampMeaning": "open",
        "timezone": _zone(mapping.get("timezone"), "mapping.timezone"),
        "delimiter": delimiter,
        "decimalSeparator": decimal,
        "thousandsSeparator": thousands,
    }
    if "name" in mapping:
        result["name"] = _text(mapping["name"], "mapping.name", 200)
    return result


def _clock(value, *, close=False):
    if not isinstance(value, str) or not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", value):
        if close and value == "24:00":
            return 1440
        _error("calendar.clock", "Session times must use HH:MM; a close may use 24:00.")
    hour, minute = value.split(":")
    return int(hour) * 60 + int(minute)


def _windows(value, field):
    if not isinstance(value, list) or len(value) > 8:
        _error("calendar.windows", f"{field} must contain at most eight session windows.")
    result = []
    ranges = []
    for window in value:
        if not isinstance(window, dict) or set(window) != {"open", "close"}:
            _error("calendar.window", "A session window contains open and close only.")
        opened = _clock(window["open"])
        closed = _clock(window["close"], close=True)
        if opened == closed:
            _error(
                "calendar.empty_window",
                "Use 00:00–24:00 for a full day; equal endpoints are ambiguous.",
            )
        if closed < opened:
            closed += 1440
        ranges.append((opened, closed))
        result.append({"open": window["open"], "close": window["close"]})
    for previous, current in zip(sorted(ranges), sorted(ranges)[1:], strict=False):
        if current[0] < previous[1]:
            _error("calendar.overlap", "Session windows must not overlap.")
    return result


def _date(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        _error("calendar.date", "Calendar exceptions require YYYY-MM-DD dates.")
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise DatasetQualityError("calendar.date", "Calendar exception date is invalid.") from error


def _raw_windows(day, calendar):
    if day.isoformat() in calendar["exceptions"]:
        return calendar["exceptions"][day.isoformat()]
    return [
        {"open": item["open"], "close": item["close"]}
        for item in calendar["sessions"]
        if day.weekday() in item["weekdays"]
    ]


def _local_ranges(day, calendar):
    midnight = datetime.combine(day, datetime.min.time())
    result = []
    for window in _raw_windows(day, calendar):
        opened = _clock(window["open"])
        closed = _clock(window["close"], close=True)
        if closed < opened:
            closed += 1440
        result.append((midnight + timedelta(minutes=opened), midnight + timedelta(minutes=closed)))
    return result


def validate_calendar(calendar):
    if calendar is None:
        calendar = {"id": "unknown", "timezone": "UTC", "sessions": [], "exceptions": {}}
    if not isinstance(calendar, dict) or set(calendar) - {
        "id",
        "timezone",
        "sessions",
        "exceptions",
    }:
        _error(
            "calendar.invalid",
            "Use a calendar ID, IANA timezone, weekly sessions and dated exceptions.",
        )
    result = {
        "id": _text(calendar.get("id"), "calendar.id", 200),
        "timezone": _zone(calendar.get("timezone"), "calendar.timezone"),
        "sessions": [],
        "exceptions": {},
    }
    sessions = calendar.get("sessions", [])
    exceptions = calendar.get("exceptions", {})
    if (
        not isinstance(sessions, list)
        or len(sessions) > 16
        or not isinstance(exceptions, dict)
        or len(exceptions) > 1000
    ):
        _error(
            "calendar.budget",
            "Limit a calendar to sixteen weekly sessions and 1000 date exceptions.",
        )
    for session in sessions:
        if not isinstance(session, dict) or set(session) != {"weekdays", "open", "close"}:
            _error("calendar.session", "A weekly session needs weekdays, open and close.")
        weekdays = session["weekdays"]
        if (
            not isinstance(weekdays, list)
            or not 1 <= len(weekdays) <= 7
            or any(type(day) is not int or not 0 <= day <= 6 for day in weekdays)
            or len(set(weekdays)) != len(weekdays)
        ):
            _error("calendar.weekdays", "Use unique weekdays from Monday 0 through Sunday 6.")
        window = _windows([{key: session[key] for key in ("open", "close")}], "calendar.sessions")[
            0
        ]
        result["sessions"].append({"weekdays": sorted(weekdays), **window})
    for key, windows in exceptions.items():
        _date(key)
        result["exceptions"][key] = _windows(windows, f"calendar.exceptions.{key}")
    if result["id"] == "unknown" and (result["sessions"] or result["exceptions"]):
        _error(
            "calendar.unknown_has_sessions",
            "Give a declared calendar its own ID instead of unknown.",
        )
    # Validate weekly/exception cross-midnight overlaps without accessing a clock.
    days = {date(2024, 1, 1) + timedelta(days=offset) for offset in range(8)}
    for key in exceptions:
        day = _date(key)
        days.add(day)
        if day > date.min:
            days.add(day - timedelta(days=1))
        if day < date.max:
            days.add(day + timedelta(days=1))
    for day in days:
        try:
            ranges = _local_ranges(day, result)
            if day > date.min:
                ranges.extend(_local_ranges(day - timedelta(days=1), result))
        except OverflowError as error:
            raise DatasetQualityError(
                "calendar.date", "Calendar boundary exceeds supported dates."
            ) from error
        ordered = sorted(ranges)
        if any(current[0] < prior[1] for prior, current in zip(ordered, ordered[1:], strict=False)):
            _error(
                "calendar.overlap",
                "Declared session windows overlap, including a previous overnight session.",
            )
    return result


def validate_context(context):
    allowed = {
        "name",
        "provider",
        "symbol",
        "exchange",
        "instrumentId",
        "sourceId",
        "interval",
        "priceBasis",
        "adjustment",
        "volumeMeaning",
        "allowNegativePrices",
        "currency",
        "calendar",
    }
    if not isinstance(context, dict) or set(context) - allowed:
        _error("context.invalid", "Dataset metadata contains unsupported fields.")
    provider = _text(context.get("provider"), "context.provider", 80).lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.:-]{0,79}", provider):
        _error(
            "context.provider",
            "Use a stable provider name containing letters, numbers, dots, dashes or underscores.",
        )
    interval = context.get("interval")
    interval = "D" if interval == "1D" else interval
    if not isinstance(interval, str) or interval not in INTERVAL_SECONDS:
        _error(
            "context.interval",
            "Choose a supported native seconds, minutes, hours or daily interval.",
        )
    if context.get("priceBasis", "raw") not in ("raw", "split_adjusted", "total_return"):
        _error("context.price_basis", "Choose raw, split-adjusted or total-return prices.")
    volume_meaning = context.get("volumeMeaning", "unknown")
    if volume_meaning not in ("unknown", "units", "contracts", "ticks", "currency"):
        _error(
            "context.volume_meaning",
            "Declare volume as unknown, units, contracts, ticks or currency.",
        )
    allow_negative = context.get("allowNegativePrices", False)
    if type(allow_negative) is not bool:
        _error("context.negative_prices", "Negative-price permission must be an explicit boolean.")
    result = {
        "provider": provider,
        "symbol": _text(context.get("symbol"), "context.symbol", 160),
        "exchange": _text(context.get("exchange"), "context.exchange", 80),
        "interval": interval,
        "priceBasis": context.get("priceBasis", "raw"),
        "adjustment": _text(context.get("adjustment", "none"), "context.adjustment", 500),
        "volumeMeaning": volume_meaning,
        "allowNegativePrices": allow_negative,
        "calendar": validate_calendar(context.get("calendar")),
    }
    if "name" in context:
        result["name"] = _text(context["name"], "context.name", 200)
    for field in ("instrumentId", "sourceId"):
        if field in context:
            value = _text(context[field], f"context.{field}", 128)
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", value):
                _error(f"context.{field}", "Use a valid opaque source/instrument ID.")
            result[field] = value
    if "currency" in context:
        currency = context["currency"]
        if not isinstance(currency, str) or not re.fullmatch(r"[A-Z][A-Z0-9]{2,11}", currency):
            _error("context.currency", "Use a 3–12 character uppercase native currency/asset code.")
        result["currency"] = currency
    return result


def _decimal_text(value):
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if value == 0 else text


def _number(value, field, mapping, *, optional=False):
    if not isinstance(value, str):
        _error(f"row.{field}_invalid", f"{field} is not a number.")
    raw = value.strip()
    if not raw and optional:
        return None
    decimal = mapping["decimalSeparator"]
    thousands = mapping["thousandsSeparator"]
    if thousands and thousands in raw:
        integer, *fraction = raw.split(decimal)
        if (
            not re.fullmatch(r"[+-]?[0-9]{1,3}(?:" + re.escape(thousands) + r"[0-9]{3})+", integer)
            or len(fraction) > 1
        ):
            _error(f"row.{field}_grouping", f"{field} has invalid thousands grouping.")
        raw = integer.replace(thousands, "") + ((decimal + fraction[0]) if fraction else "")
    raw = raw.replace(decimal, ".")
    if not re.fullmatch(r"[+-]?[0-9]+(?:\.[0-9]+)?", raw):
        _error(
            f"row.{field}_invalid",
            f"{field} requires a finite plain decimal; exponent notation is unsupported.",
        )
    integer, _, fraction = raw.lstrip("+-").partition(".")
    if len(integer.lstrip("0")) > 40 or len(fraction) > 24 or len(raw) > 100:
        _error(f"row.{field}_precision", f"{field} exceeds 40 integer or 24 fractional digits.")
    try:
        return Decimal(raw)
    except InvalidOperation as error:
        raise DatasetQualityError(f"row.{field}_invalid", f"{field} is invalid.") from error


def _localize(value, zone):
    candidates = set()
    for fold in (0, 1):
        candidate = value.replace(tzinfo=zone, fold=fold).astimezone(UTC)
        if candidate.astimezone(zone).replace(tzinfo=None) == value:
            candidates.add(candidate)
    if not candidates:
        _error(
            "row.timestamp_nonexistent",
            "The local time falls in a daylight-saving gap; provide an actual offset-aware time.",
        )
    if len(candidates) != 1:
        _error(
            "row.timestamp_ambiguous",
            "The local time occurs twice at a daylight-saving fold; provide an explicit offset.",
        )
    return next(iter(candidates))


def _micros(value):
    delta = value - EPOCH
    return delta.days * DAY_US + delta.seconds * 1_000_000 + delta.microseconds


def _timestamp(raw, timestamp_format, timezone):
    raw = _text(raw, "row.timestamp", 100)
    if timestamp_format in ("seconds", "milliseconds"):
        if not re.fullmatch(r"[+-]?[0-9]{1,20}(?:\.[0-9]{1,12})?", raw):
            _error("row.timestamp_invalid", "Epoch timestamps require an explicit plain number.")
        with localcontext() as context:
            context.prec = 50
            micros = Decimal(raw) * (1_000_000 if timestamp_format == "seconds" else 1000)
        if micros != micros.to_integral_value():
            _error(
                "row.timestamp_precision",
                "Timestamp precision finer than a microsecond is unsupported.",
            )
        try:
            value = EPOCH + timedelta(microseconds=int(micros))
        except OverflowError as error:
            raise DatasetQualityError(
                "row.timestamp_range", "Timestamp is outside supported calendar dates."
            ) from error
    else:
        if not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d{1,18})?)?(?:Z|[+-]\d{2}:\d{2})?)?",
            raw,
        ):
            _error(
                "row.timestamp_invalid",
                "Use an ISO date/time and an explicit offset or declared IANA timezone.",
            )
        fraction = re.search(r"[.,]([0-9]+)", raw)
        if fraction and len(fraction[1].rstrip("0")) > 6:
            _error(
                "row.timestamp_precision",
                "Timestamp precision finer than a microsecond is unsupported.",
            )
        try:
            value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            value = (
                _localize(value, ZoneInfo(timezone))
                if value.tzinfo is None
                else value.astimezone(UTC)
            )
        except (ValueError, OverflowError) as error:
            if isinstance(error, DatasetQualityError):
                raise
            raise DatasetQualityError(
                "row.timestamp_invalid", "Timestamp is not a valid calendar date/time."
            ) from error
    microseconds = _micros(value)
    timestamp = (
        microseconds // 1_000_000 if microseconds % 1_000_000 == 0 else microseconds / 1_000_000
    )
    return microseconds, value.isoformat(timespec="microseconds").replace("+00:00", "Z"), timestamp


def _bar(raw, mapping, context):
    micros, instant, timestamp = _timestamp(
        raw[mapping["columns"]["timestamp"]], mapping["timestampFormat"], mapping["timezone"]
    )
    prices = {
        field: _number(raw[mapping["columns"][field]], field, mapping) for field in PRICE_FIELDS
    }
    if not context["allowNegativePrices"] and any(value < 0 for value in prices.values()):
        _error(
            "row.negative_price",
            "This instrument has not been declared eligible for negative prices.",
        )
    if (
        not prices["low"]
        <= min(prices["open"], prices["close"])
        <= max(prices["open"], prices["close"])
        <= prices["high"]
    ):
        _error(
            "row.ohlc_incoherent",
            "Low must not exceed open/close, and high must not be below open/close.",
        )
    result = {
        "time": instant,
        "timestamp": timestamp,
        **{key: _decimal_text(value) for key, value in prices.items()},
    }
    for field in OPTIONAL_FIELDS:
        header = mapping["columns"].get(field)
        value = _number(raw.get(header, ""), field, mapping, optional=True) if header else None
        if value is not None and value < 0:
            _error(f"row.{field}_negative", f"{field} must be nonnegative or blank when unknown.")
        if (
            field == "volume"
            and context["volumeMeaning"] == "ticks"
            and value is not None
            and value != value.to_integral_value()
        ):
            _error("row.volume_tick_fraction", "Tick-count volume must be a whole count.")
        result[field] = _decimal_text(value) if value is not None else None
    return micros, result


def _bar_facts(bar):
    return {key: bar[key] for key in ("time", *PRICE_FIELDS, *OPTIONAL_FIELDS)}


def _previous(previous_bars, context):
    if not isinstance(previous_bars, (list, tuple)) or len(previous_bars) > MAX_PREVIOUS_BARS:
        _error(
            "history.previous_budget",
            "Previous history exceeds the supported comparison budget.",
            413,
        )
    result = {}
    mapping = validate_mapping(
        {
            "version": 1,
            "columns": {key: key for key in FIELDS},
            "timestampFormat": "iso",
            "timezone": "UTC",
        }
    )
    for value in previous_bars:
        if not isinstance(value, dict) or not isinstance(value.get("time"), str):
            _error(
                "history.previous_invalid",
                "Previous bars require canonical UTC time and exact OHLC strings.",
            )
        raw = {
            "timestamp": value["time"],
            **{field: value.get(field, "") for field in (*PRICE_FIELDS, *OPTIONAL_FIELDS)},
        }
        raw = {key: "" if value is None else value for key, value in raw.items()}
        micros, bar = _bar(raw, mapping, context)
        if micros in result and _bar_facts(result[micros]) != _bar_facts(bar):
            _error(
                "history.previous_conflict",
                "Previous history contains conflicting candles at the same time.",
            )
        result[micros] = bar
    return result


def _calendar_windows(day, calendar):
    zone = ZoneInfo(calendar["timezone"])
    try:
        return [
            (_micros(_localize(opened, zone)), _micros(_localize(closed, zone)))
            for opened, closed in _local_ranges(day, calendar)
        ]
    except (DatasetQualityError, OverflowError):
        return None


def _session_status(micros, calendar, interval):
    if calendar["id"] == "unknown":
        return None, None
    try:
        local_day = (
            (EPOCH + timedelta(microseconds=micros))
            .astimezone(ZoneInfo(calendar["timezone"]))
            .date()
        )
    except (OverflowError, ValueError):
        return None, None
    if interval == "D":
        windows = _calendar_windows(local_day, calendar)
        return (bool(windows), True) if windows is not None else (None, None)
    windows = _calendar_windows(local_day, calendar)
    if local_day > date.min:
        previous = _calendar_windows(local_day - timedelta(days=1), calendar)
        if previous is None:
            return None, None
        windows = (windows + previous) if windows is not None else None
    if windows is None:
        return None, None
    for opened, closed in windows:
        if opened <= micros < closed:
            return True, (micros - opened) % (INTERVAL_SECONDS[interval] * 1_000_000) == 0
    return False, None


def _gap(left, right, calendar, interval, budget):
    step = INTERVAL_SECONDS[interval] * 1_000_000
    if calendar["id"] == "unknown":
        return (True, None) if right - left > step else (False, 0)
    zone = ZoneInfo(calendar["timezone"])
    try:
        first = (EPOCH + timedelta(microseconds=left)).astimezone(zone).date()
        last = (EPOCH + timedelta(microseconds=right)).astimezone(zone).date()
    except (OverflowError, ValueError):
        return True, None
    if interval == "D":
        if (last - first).days <= 1:
            return False, 0
        start, end = first + timedelta(days=1), last
    else:
        if right - left <= step:
            return False, 0
        start, end = (
            max(date.min, first - timedelta(days=1)) if first > date.min else date.min,
            last,
        )
    days = (end - start).days + (0 if interval == "D" else 1)
    if days < 0 or days > budget[0]:
        return True, None
    budget[0] -= days
    missing = 0
    for offset in range(days):
        windows = _calendar_windows(start + timedelta(days=offset), calendar)
        if windows is None:
            return True, None
        if interval == "D":
            missing += bool(windows)
        else:
            for opened, closed in windows:
                lower = max(left + 1, opened)
                upper = min(right - 1, closed - 1)
                first_index = (lower - opened + step - 1) // step
                last_index = (upper - opened) // step
                missing += max(0, last_index - first_index + 1)
    return True, missing


def _coverage(bars, context, counts):
    calendar = context["calendar"]
    segments = []
    gaps = []
    segment_count = 0
    unclassified = 0
    missing = 0
    budget = [MAX_CALENDAR_DAYS]
    previous = None
    current = None
    for micros, bar in bars:
        if previous is not None:
            if context["interval"] == "D" and calendar["id"] != "unknown":
                try:
                    zone = ZoneInfo(calendar["timezone"])
                    before = (EPOCH + timedelta(microseconds=previous[0])).astimezone(zone).date()
                    after = (EPOCH + timedelta(microseconds=micros)).astimezone(zone).date()
                    if before == after:
                        counts["duplicateDailyDates"] += 1
                except (OverflowError, ValueError):
                    counts["calendarUnclassified"] += 1
            is_gap, absent = _gap(previous[0], micros, calendar, context["interval"], budget)
            if is_gap:
                counts["gaps"] += 1
                missing += absent or 0
                unclassified += absent is None
                if len(gaps) < MAX_DETAILS:
                    gaps.append(
                        {
                            "after": previous[1]["time"],
                            "before": bar["time"],
                            "missingBars": absent,
                            "classification": "unclassified"
                            if absent is None
                            else "missing_expected"
                            if absent
                            else "market_closed",
                        }
                    )
                if absent is None or absent > 0:
                    if current is not None:
                        segment_count += 1
                        if len(segments) < MAX_DETAILS:
                            segments.append(current)
                    current = None
        if current is None:
            current = {"start": bar["time"], "end": bar["time"], "bars": 1}
        else:
            current["end"] = bar["time"]
            current["bars"] += 1
        previous = (micros, bar)
    if current is not None:
        segment_count += 1
        if len(segments) < MAX_DETAILS:
            segments.append(current)
    counts["missingExpectedBars"] = missing
    return {
        "rangeStart": bars[0][1]["time"] if bars else None,
        "rangeEnd": bars[-1][1]["time"] if bars else None,
        "barCount": len(bars),
        "nativeInterval": context["interval"],
        "storageTimezone": "UTC",
        "calendarChecksum": _hash(calendar),
        "segments": segments,
        "segmentCount": segment_count,
        "gaps": gaps,
        "gapCount": counts["gaps"],
        "missingExpectedBars": None if unclassified or calendar["id"] == "unknown" else missing,
        "knownMissingExpectedBars": missing,
        "unclassifiedGaps": unclassified,
        "volumeKnownRows": sum(bar["volume"] is not None for _, bar in bars),
        "volumeUnknownRows": sum(bar["volume"] is None for _, bar in bars),
        "openInterestKnownRows": sum(bar["openInterest"] is not None for _, bar in bars),
        "detailsTruncated": len(gaps) < counts["gaps"] or len(segments) < segment_count,
    }


def _counts():
    return Counter(
        dict.fromkeys(
            (
                "accepted",
                "rejected",
                "duplicate",
                "unchanged",
                "changed",
                "conflicts",
                "reordered",
                "outsideSession",
                "offGrid",
                "calendarUnclassified",
                "duplicateDailyDates",
                "gaps",
                "missingExpectedBars",
                "blank",
                "warnings",
            ),
            0,
        )
    )


def _report(ordered, context, counts):
    coverage = _coverage(ordered, context, counts)
    warnings = []
    if context["calendar"]["id"] == "unknown":
        warnings.append(
            {
                "code": "calendar.unknown",
                "message": "No session calendar was declared. Gaps are unclassified; they are not automatically corruption.",
            }
        )
    for key, code, message in (
        (
            "rejected",
            "quality.rejected",
            "Rejected rows are excluded; retaining only valid rows requires explicit confirmation.",
        ),
        ("duplicate", "quality.duplicates", "Identical duplicate candles are counted once."),
        (
            "reordered",
            "quality.reordered",
            "Source ordering changed; the version is chronological.",
        ),
        (
            "outsideSession",
            "quality.outside_session",
            "Some candles are outside the declared sessions; check extended-hours coverage.",
        ),
        (
            "offGrid",
            "quality.off_grid",
            "Some openings do not match the declared interval/session grid.",
        ),
        (
            "calendarUnclassified",
            "quality.calendar_boundary",
            "Some declared calendar boundaries are ambiguous or out of range; completeness remains unknown.",
        ),
        (
            "duplicateDailyDates",
            "quality.multiple_daily_labels",
            "More than one distinct daily candle opening falls on a declared local calendar date. Check native interval and source labels.",
        ),
        (
            "missingExpectedBars",
            "quality.missing_expected",
            "Declared trading sessions contain missing expected candles. No candles were filled.",
        ),
    ):
        if counts[key]:
            warnings.append({"code": code, "message": message, "count": counts[key]})
    if coverage["unclassifiedGaps"]:
        warnings.append(
            {
                "code": "quality.unclassified_gaps",
                "message": "Some gap classifications are unknown because calendar evidence or the bounded scan budget is unavailable.",
                "count": coverage["unclassifiedGaps"],
            }
        )
    if coverage["volumeUnknownRows"] or context["volumeMeaning"] == "unknown":
        warnings.append(
            {
                "code": "volume.unknown",
                "message": "Missing volume stays unknown and a declared unit is required to interpret supplied volume.",
            }
        )
    can_commit = bool(ordered) and counts["conflicts"] == 0
    status = (
        "invalid"
        if not can_commit
        else "partial"
        if counts["rejected"]
        or counts["outsideSession"]
        or counts["offGrid"]
        or counts["calendarUnclassified"]
        or counts["duplicateDailyDates"]
        or counts["missingExpectedBars"]
        or coverage["unclassifiedGaps"]
        or context["calendar"]["id"] == "unknown"
        else "verified"
    )
    quality = {
        "status": status,
        "scope": "structural_checks_only",
        "summary": f"{len(ordered)} unique valid candles; {counts['rejected']} rejected rows; {counts['changed']} changed overlaps. Quality does not certify source authenticity.",
        "warnings": warnings,
    }
    return coverage, quality, can_commit


def analyze_bars(bars, context):
    """Validate/reanalyze a merged or restored canonical version, without I/O.

    Invalid canonical rows reject the whole operation. Input ordering may change;
    identical duplicates collapse, while conflicting duplicates are refused.
    ``time`` is authoritative and its numeric projection must agree within one
    microsecond (the boundary of supported source timestamp precision).
    """
    context = validate_context(context)
    if not isinstance(bars, (list, tuple)) or len(bars) > MAX_ROWS:
        _error("history.bar_budget", "A canonical version supports at most 50,000 candles.", 413)
    counts = _counts()
    mapping = validate_mapping(
        {
            "version": 1,
            "columns": {key: key for key in FIELDS},
            "timestampFormat": "iso",
            "timezone": "UTC",
        }
    )
    unique = {}
    last_time = None
    expected_fields = {"time", "timestamp", *PRICE_FIELDS, *OPTIONAL_FIELDS}
    for value in bars:
        if not isinstance(value, dict) or set(value) != expected_fields:
            _error(
                "history.canonical_bar",
                "A canonical candle has time, timestamp, OHLC, volume and openInterest fields only.",
            )
        if not isinstance(value["time"], str) or not value["time"].endswith("Z"):
            _error("history.canonical_time", "Canonical time must be an explicit UTC instant.")
        if (
            isinstance(value["timestamp"], bool)
            or not isinstance(value["timestamp"], (int, float))
            or not -62_135_596_800 <= value["timestamp"] <= 253_402_300_800
            or not math.isfinite(value["timestamp"])
        ):
            _error(
                "history.timestamp_projection",
                "The timestamp projection must be finite numeric epoch seconds.",
            )
        raw = {
            "timestamp": value["time"],
            **{
                field: "" if value[field] is None else value[field]
                for field in (*PRICE_FIELDS, *OPTIONAL_FIELDS)
            },
        }
        micros, bar = _bar(raw, mapping, context)
        if bar["time"] != value["time"]:
            _error(
                "history.canonical_time",
                "Canonical time must retain normalized UTC microsecond precision.",
            )
        with localcontext() as decimal_context:
            decimal_context.prec = 100
            difference = abs(Decimal(str(value["timestamp"])) * 1_000_000 - Decimal(micros))
        if difference > 1:
            _error(
                "history.timestamp_projection",
                "Numeric timestamp does not agree with canonical UTC time.",
            )
        if last_time is not None and micros < last_time:
            counts["reordered"] += 1
        last_time = micros
        if micros in unique:
            if _bar_facts(unique[micros]) != _bar_facts(bar):
                _error(
                    "history.canonical_conflict",
                    "Canonical candles conflict at the same UTC timestamp.",
                )
            counts["duplicate"] += 1
            continue
        unique[micros] = bar
        counts["accepted"] += 1
        inside, aligned = _session_status(micros, context["calendar"], context["interval"])
        if inside is False:
            counts["outsideSession"] += 1
        elif inside is True and aligned is False:
            counts["offGrid"] += 1
        elif inside is None and context["calendar"]["id"] != "unknown":
            counts["calendarUnclassified"] += 1
    ordered = sorted(unique.items())
    coverage, quality, can_commit = _report(ordered, context, counts)
    return {
        "bars": [bar for _, bar in ordered],
        "contentHash": _hash([_bar_facts(bar) for _, bar in ordered]),
        "coverage": coverage,
        "quality": quality,
        "counts": dict(counts),
        "canCommit": can_commit,
    }


def normalize_history(csv_text, mapping, context, previous_bars=()):
    """Return a deterministic preview; only the caller can commit a version."""
    mapping = validate_mapping(mapping)
    context = validate_context(context)
    if not isinstance(csv_text, str):
        _error("csv.invalid", "Upload UTF-8 CSV text.")
    try:
        encoded = csv_text.encode("utf-8")
    except UnicodeError as error:
        raise DatasetQualityError(
            "csv.invalid_unicode", "The CSV contains invalid Unicode."
        ) from error
    if len(encoded) > MAX_CSV_BYTES:
        _error("csv.byte_budget", "CSV exceeds the 8 MiB limit.", 413)
    if "\x00" in csv_text:
        _error("csv.nul", "CSV cannot contain NUL bytes.")
    previous = _previous(previous_bars, context)
    reader = csv.reader(
        io.StringIO(csv_text.lstrip("\ufeff"), newline=""),
        delimiter=mapping["delimiter"],
        strict=True,
    )
    try:
        raw_headers = next(reader)
    except (StopIteration, csv.Error) as error:
        raise DatasetQualityError("csv.headers", "A CSV header row is required.") from error
    headers = [_text(header, "csv.header", 200) for header in raw_headers]
    if (
        not headers
        or len(headers) > MAX_COLUMNS
        or len({header.casefold() for header in headers}) != len(headers)
    ):
        _error("csv.headers", "Use 1–32 distinct nonblank CSV column names.")
    if any(re.sub(r"[^a-z0-9_]", "", header.lower()) in SECRET_HEADERS for header in headers):
        _error("csv.secret_header", "Remove credential columns before importing market history.")
    if set(mapping["columns"].values()) - set(headers):
        _error("mapping.column_missing", "A mapped column is absent from this CSV header.")
    counts = _counts()
    rows = []
    replaceable_details = []
    row_errors = {}
    unique = {}
    total_rows = 0
    last_source_time = None
    try:
        for row_number, cells in enumerate(reader, start=2):
            if not cells:
                counts["blank"] += 1
                continue
            total_rows += 1
            if total_rows > MAX_ROWS:
                _error("csv.row_budget", "CSV exceeds the 50,000 row limit.", 413)
            raw = dict(zip(headers, cells[: len(headers)], strict=False))
            row = {
                "rowNumber": row_number,
                "action": "rejected",
                "raw": raw,
                "errors": [],
                "warnings": [],
            }
            try:
                if len(cells) != len(headers):
                    _error(
                        "row.column_count",
                        "This row has a different number of fields from the header.",
                    )
                if any(len(cell) > MAX_CELL_CHARS for cell in cells):
                    _error("row.cell_budget", "A CSV cell exceeds 2000 characters.")
                micros, bar = _bar(raw, mapping, context)
                row["bar"] = bar
                if last_source_time is not None and micros < last_source_time:
                    counts["reordered"] += 1
                    row["warnings"].append(
                        {
                            "code": "row.reordered",
                            "message": "Source rows are not chronological; stored bars will be sorted by UTC time.",
                        }
                    )
                last_source_time = micros
                if micros in unique:
                    if _bar_facts(unique[micros]) == _bar_facts(bar):
                        row["action"] = "duplicate"
                    else:
                        counts["conflicts"] += 1
                        _error(
                            "row.timestamp_conflict",
                            "This file gives different candle values for the same UTC timestamp. Resolve the conflict before committing.",
                        )
                else:
                    unique[micros] = bar
                    row["action"] = (
                        "unchanged"
                        if micros in previous and _bar_facts(previous[micros]) == _bar_facts(bar)
                        else "changed"
                        if micros in previous
                        else "accepted"
                    )
                    inside, aligned = _session_status(
                        micros, context["calendar"], context["interval"]
                    )
                    if inside is False:
                        counts["outsideSession"] += 1
                        row["warnings"].append(
                            {
                                "code": "row.outside_session",
                                "message": "The candle is outside the declared session calendar. Its source time is preserved.",
                            }
                        )
                    elif inside is True and aligned is False:
                        counts["offGrid"] += 1
                        row["warnings"].append(
                            {
                                "code": "row.off_grid",
                                "message": "The candle opening does not align with the declared native interval and session open.",
                            }
                        )
                    elif inside is None and context["calendar"]["id"] != "unknown":
                        counts["calendarUnclassified"] += 1
                        row["warnings"].append(
                            {
                                "code": "calendar.boundary_ambiguous",
                                "message": "This calendar boundary is ambiguous or unsupported at the source date; session quality is unclassified.",
                            }
                        )
            except DatasetQualityError as error:
                row["errors"].append({"code": error.code, "message": str(error)})
                row["action"] = "rejected"
                summary = row_errors.setdefault(
                    error.code,
                    {"code": error.code, "message": str(error), "count": 0, "firstRowNumbers": []},
                )
                summary["count"] += 1
                if len(summary["firstRowNumbers"]) < 10:
                    summary["firstRowNumbers"].append(row_number)
            counts[row["action"]] += 1
            counts["warnings"] += len(row["warnings"])
            if len(rows) < MAX_DETAILS:
                if not row["errors"]:
                    replaceable_details.append(len(rows))
                rows.append(row)
            elif row["errors"] and replaceable_details:
                rows[replaceable_details.pop()] = row
    except csv.Error as error:
        raise DatasetQualityError(
            "csv.malformed", "The CSV has malformed quoting or an unsupported field size."
        ) from error
    ordered = sorted(unique.items())
    coverage, quality, can_commit = _report(ordered, context, counts)
    quality["rowErrors"] = sorted(row_errors.values(), key=lambda item: item["code"])
    rows.sort(key=lambda row: row["rowNumber"])
    return {
        "format": "chartly-history-preview",
        "version": 1,
        "sourceHash": hashlib.sha256(encoded).hexdigest(),
        "contentHash": _hash([_bar_facts(bar) for _, bar in ordered]),
        "context": context,
        "mapping": mapping,
        "headers": headers,
        "bars": [bar for _, bar in ordered],
        "rows": rows,
        "rowsTruncated": total_rows > len(rows),
        "rowCount": total_rows,
        "counts": dict(counts),
        "coverage": coverage,
        "quality": quality,
        "canCommit": can_commit,
    }
