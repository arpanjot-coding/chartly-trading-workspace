"""Independent candle, timestamp and declared-calendar fixtures for P04."""

import csv
import json
from copy import deepcopy
from io import StringIO
from pathlib import Path

import pytest

import services.dataset_quality as quality
from services.dataset_quality import (
    DatasetQualityError,
    analyze_bars,
    normalize_history,
    validate_context,
    validate_mapping,
)

FIXTURES = Path(__file__).parent / "fixtures/p04"


def mapping(**changes):
    return {
        "version": 1,
        "columns": {key: key for key in ("timestamp", "open", "high", "low", "close", "volume")},
        "timestampFormat": "iso",
        "timestampMeaning": "open",
        "timezone": "UTC",
        **changes,
    }


def context(**changes):
    return {
        "provider": "fixture-csv",
        "symbol": "EXAMPLE",
        "exchange": "FIXTURE",
        "interval": "1m",
        "priceBasis": "raw",
        "adjustment": "none",
        "volumeMeaning": "unknown",
        "allowNegativePrices": False,
        **changes,
    }


def continuous(timezone="UTC"):
    return {
        "id": "declared-continuous",
        "timezone": timezone,
        "sessions": [{"weekdays": list(range(7)), "open": "00:00", "close": "24:00"}],
        "exceptions": {},
    }


def regular(**changes):
    return {
        "id": "declared-rth",
        "timezone": "America/New_York",
        "sessions": [{"weekdays": [0, 1, 2, 3, 4], "open": "09:30", "close": "16:00"}],
        "exceptions": {},
        **changes,
    }


def text(*times, prices=None):
    stream = StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(["timestamp", "open", "high", "low", "close", "volume"])
    for time in times or ("2026-11-02T09:30:00Z",):
        writer.writerow([time, *(prices or ["1", "2", "0", "1.5", ""])])
    return stream.getvalue()


def preview(*times, mapping_changes=None, context_changes=None, prices=None):
    return normalize_history(
        text(*times, prices=prices),
        mapping(**(mapping_changes or {})),
        context(**(context_changes or {})),
    )


def test_documented_fixture_counts_exact_values_missing_volume_and_session_hole():
    source = (FIXTURES / "normalized-history.csv").read_text(encoding="utf-8")
    config = json.loads((FIXTURES / "normalized-history-mapping.json").read_text())
    metadata = json.loads((FIXTURES / "normalized-history-context.json").read_text())
    result = normalize_history(source, config, metadata)
    assert result["canCommit"]
    assert result["counts"]["accepted"] == 3 and result["counts"]["missingExpectedBars"] == 1
    assert result["coverage"]["rangeStart"] == "2026-11-02T14:30:00.000000Z"
    assert result["coverage"]["rangeEnd"] == "2026-11-02T14:33:00.000000Z"
    assert (
        result["coverage"]["volumeKnownRows"] == 2 and result["coverage"]["volumeUnknownRows"] == 1
    )
    assert result["bars"][0]["open"] == "100" and result["bars"][0]["volume"] == "12.5"
    assert result["bars"][1]["volume"] is None and result["bars"][0]["openInterest"] is None
    assert result["quality"]["status"] == "partial"
    assert result["rows"][0]["raw"]["open"] == "100.00"


@pytest.mark.parametrize(
    "interval",
    ["1s", "5s", "15s", "30s", "1m", "2m", "3m", "5m", "10m", "15m", "30m", "1h", "2h", "4h", "D"],
)
def test_supported_native_intervals_are_explicit(interval):
    assert validate_context(context(interval=interval))["interval"] == interval


def test_daily_alias_normalizes_without_treating_months_as_minutes():
    assert validate_context(context(interval="1D"))["interval"] == "D"
    for interval in ("M", "1M", "25m", "0m", [], "1d"):
        with pytest.raises(DatasetQualityError):
            validate_context(context(interval=interval))


@pytest.mark.parametrize(
    "timestamp,format",
    [
        ("1969-12-31T23:59:59.123456Z", "iso"),
        ("-0.876544", "seconds"),
        ("-876.544", "milliseconds"),
    ],
)
def test_pre_epoch_exact_microseconds_never_depend_on_host_local_timestamp(timestamp, format):
    result = preview(timestamp, mapping_changes={"timestampFormat": format})
    assert result["bars"][0]["time"] == "1969-12-31T23:59:59.123456Z"
    assert result["bars"][0]["timestamp"] == -0.876544


def test_units_are_not_guessed_from_numeric_magnitude():
    seconds = preview("1730000000000", mapping_changes={"timestampFormat": "seconds"})
    assert (
        not seconds["canCommit"]
        and seconds["rows"][0]["errors"][0]["code"] == "row.timestamp_range"
    )
    milliseconds = preview("1730000000000", mapping_changes={"timestampFormat": "milliseconds"})
    assert milliseconds["canCommit"]
    assert milliseconds["bars"][0]["time"] == "2024-10-27T03:33:20.000000Z"


@pytest.mark.parametrize(
    "timestamp,format",
    [
        ("2026-11-02T09:30:00.000000001Z", "iso"),
        ("1730000000.0000001", "seconds"),
        ("1730000000000.0001", "milliseconds"),
        ("1e9", "seconds"),
        ("2026-02-30T09:00:00Z", "iso"),
    ],
)
def test_unrepresentable_or_invalid_times_are_rejected_without_truncation(timestamp, format):
    result = preview(timestamp, mapping_changes={"timestampFormat": format})
    assert result["counts"]["rejected"] == 1 and not result["canCommit"]
    assert result["bars"] == []


@pytest.mark.parametrize(
    "timestamp,code",
    [
        ("2026-03-08T02:30:00", "row.timestamp_nonexistent"),
        ("2026-11-01T01:30:00", "row.timestamp_ambiguous"),
    ],
)
def test_naive_dst_gap_and_fold_require_user_resolution(timestamp, code):
    result = preview(timestamp, mapping_changes={"timezone": "America/New_York"})
    assert result["rows"][0]["errors"][0]["code"] == code
    assert not result["canCommit"]


def test_explicit_offsets_distinguish_the_two_dst_folds():
    result = preview("2026-11-01T01:30:00-04:00", "2026-11-01T01:30:00-05:00")
    assert [bar["time"] for bar in result["bars"]] == [
        "2026-11-01T05:30:00.000000Z",
        "2026-11-01T06:30:00.000000Z",
    ]
    assert result["counts"]["accepted"] == 2 and result["counts"]["duplicate"] == 0


def test_naive_iana_conversion_and_trailing_zero_precision_are_explicit():
    result = preview("2026-11-02T09:30:00.123456000", mapping_changes={"timezone": "Asia/Kolkata"})
    assert result["bars"][0]["time"] == "2026-11-02T04:00:00.123456Z"


@pytest.mark.parametrize(
    "prices",
    [
        ["1", "0.5", "0", "1", ""],
        ["1", "2", "1.1", "1.5", ""],
        ["1", "2", "3", "1.5", ""],
        ["", "2", "0", "1", ""],
        ["NaN", "2", "0", "1", ""],
        ["Infinity", "2", "0", "1", ""],
        ["1e0", "2", "0", "1", ""],
        ["1", "2", "0", "1", "-1"],
    ],
)
def test_incoherent_nonfinite_or_missing_ohlc_and_negative_volume_are_rejected(prices):
    result = preview(prices=prices)
    assert result["counts"]["rejected"] == 1 and not result["canCommit"]


def test_negative_prices_need_explicit_instrument_permission_but_zero_does_not():
    negative = ["-2", "-1", "-3", "-2.5", "0"]
    assert not preview(prices=negative)["canCommit"]
    allowed = preview(prices=negative, context_changes={"allowNegativePrices": True})
    assert allowed["canCommit"] and allowed["bars"][0]["close"] == "-2.5"
    assert preview(prices=["0", "0", "0", "0", ""])["canCommit"]


def test_prices_preserve_40_integer_24_fraction_digits_without_decimal_context_rounding():
    amount = "1234567890123456789012345678901234567890.123456789012345678901234"
    result = preview(prices=[amount, amount, amount, amount, "0.125"])
    assert result["bars"][0]["close"] == amount
    assert result["bars"][0]["volume"] == "0.125"
    assert not preview(prices=[amount + "5", amount + "5", amount, amount, ""])["canCommit"]


def test_declared_number_separators_handle_quoted_grouping_and_reject_bad_groups():
    result = preview(
        prices=["1,000.25", "1,002.50", "999.00", "1,001.125", "1,234.5"],
        mapping_changes={"thousandsSeparator": ","},
    )
    assert result["bars"][0]["open"] == "1000.25" and result["bars"][0]["volume"] == "1234.5"
    invalid = preview(
        prices=["1,00.25", "1,002.50", "999.00", "1,001.125", ""],
        mapping_changes={"thousandsSeparator": ","},
    )
    assert not invalid["canCommit"]


def test_tick_count_is_integer_while_fractional_units_are_retained():
    assert not preview(
        prices=["1", "2", "0", "1", "0.5"], context_changes={"volumeMeaning": "ticks"}
    )["canCommit"]
    assert (
        preview(prices=["1", "2", "0", "1", "0.5"], context_changes={"volumeMeaning": "units"})[
            "bars"
        ][0]["volume"]
        == "0.5"
    )


def test_reordered_identical_duplicates_have_stable_numeric_content_hash():
    original = preview("2026-11-02T09:30:00Z", "2026-11-02T09:31:00Z")
    changed_file = preview(
        "2026-11-02T09:31:00Z",
        "2026-11-02T09:30:00Z",
        "2026-11-02T09:30:00Z",
        prices=["1.00", "2.00", "0.00", "1.500", ""],
    )
    assert changed_file["contentHash"] == original["contentHash"]
    assert changed_file["sourceHash"] != original["sourceHash"]
    assert changed_file["counts"]["accepted"] == 2 and changed_file["counts"]["duplicate"] == 1
    assert changed_file["counts"]["reordered"] == 1
    assert changed_file["canCommit"]


def test_conflicting_duplicate_inside_file_blocks_commit_even_with_other_valid_bars():
    source = text("2026-11-02T09:30:00Z") + "2026-11-02T09:30:00Z,1,3,0,2,\n"
    result = normalize_history(source, mapping(), context())
    assert not result["canCommit"] and result["counts"]["conflicts"] == 1
    assert result["counts"]["rejected"] == 1


def test_overlaps_report_unchanged_and_changed_without_choosing_a_merge_policy():
    old = preview("2026-11-02T09:30:00Z", "2026-11-02T09:31:00Z")["bars"]
    source = (
        text("2026-11-02T09:30:00Z")
        + "2026-11-02T09:31:00Z,1,3,0,2,\n2026-11-02T09:32:00Z,1,2,0,1.5,\n"
    )
    result = normalize_history(source, mapping(), context(), old)
    assert (
        result["counts"]["unchanged"]
        == result["counts"]["changed"]
        == result["counts"]["accepted"]
        == 1
    )
    assert result["bars"][1]["close"] == "2" and old[1]["close"] == "1.5"


def test_unknown_calendar_reports_unclassified_gap_and_never_fills_it():
    result = preview("2026-11-02T09:30:00Z", "2026-11-02T09:33:00Z")
    assert len(result["bars"]) == 2 and result["coverage"]["missingExpectedBars"] is None
    assert result["coverage"]["gaps"][0]["classification"] == "unclassified"
    assert result["coverage"]["segmentCount"] == 2


def test_known_continuous_calendar_counts_holes_and_recomputed_merged_quality():
    metadata = context(calendar=continuous())
    gapped = normalize_history(
        text("2026-11-02T09:30:00Z", "2026-11-02T09:33:00Z"), mapping(), metadata
    )
    middle = preview("2026-11-02T09:31:00Z", "2026-11-02T09:32:00Z")["bars"]
    assert gapped["coverage"]["missingExpectedBars"] == 2
    merged = analyze_bars(gapped["bars"] + middle, metadata)
    assert (
        merged["coverage"]["missingExpectedBars"] == 0 and merged["quality"]["status"] == "verified"
    )
    assert merged["coverage"]["segmentCount"] == 1 and len(merged["bars"]) == 4


def test_weekend_and_holiday_closures_are_not_missing_candles():
    result = preview(
        "2026-12-24T15:59:00-05:00",
        "2026-12-28T09:30:00-05:00",
        context_changes={"calendar": regular(exceptions={"2026-12-25": []})},
    )
    assert result["coverage"]["gaps"][0]["classification"] == "market_closed"
    assert result["coverage"]["missingExpectedBars"] == 0
    assert result["coverage"]["segmentCount"] == 1


def test_dst_weekend_session_windows_use_the_actual_local_offsets():
    result = preview(
        "2026-10-30T15:59:00-04:00",
        "2026-11-02T09:30:00-05:00",
        context_changes={"calendar": regular()},
    )
    assert result["coverage"]["missingExpectedBars"] == 0
    assert result["counts"]["outsideSession"] == 0


def test_session_break_and_overnight_windows_have_explicit_anchors():
    lunch = {
        "id": "declared-split",
        "timezone": "UTC",
        "sessions": [
            {"weekdays": [0], "open": "09:30", "close": "11:30"},
            {"weekdays": [0], "open": "13:00", "close": "16:00"},
        ],
        "exceptions": {},
    }
    result = preview(
        "2026-11-02T11:29:00Z", "2026-11-02T13:00:00Z", context_changes={"calendar": lunch}
    )
    assert result["coverage"]["missingExpectedBars"] == 0
    overnight = {
        "id": "declared-overnight",
        "timezone": "UTC",
        "sessions": [{"weekdays": [0], "open": "22:00", "close": "02:00"}],
        "exceptions": {},
    }
    result = preview(
        "2026-11-02T23:59:00Z", "2026-11-03T00:01:00Z", context_changes={"calendar": overnight}
    )
    assert (
        result["counts"]["outsideSession"] == 0 and result["coverage"]["missingExpectedBars"] == 1
    )


def test_daily_dst_days_are_calendar_days_not_fixed_24_hour_holes():
    result = preview(
        "2026-03-07T00:00:00-05:00",
        "2026-03-08T00:00:00-05:00",
        "2026-03-09T00:00:00-04:00",
        context_changes={"interval": "D", "calendar": continuous("America/New_York")},
    )
    assert result["counts"]["gaps"] == 0 and result["coverage"]["missingExpectedBars"] == 0


def test_two_distinct_daily_openings_on_one_declared_date_are_not_verified_as_complete():
    result = preview(
        "2026-11-02T09:30:00-05:00",
        "2026-11-02T10:30:00-05:00",
        context_changes={"interval": "D", "calendar": regular()},
    )
    assert result["canCommit"] and result["counts"]["duplicateDailyDates"] == 1
    assert result["quality"]["status"] == "partial"
    assert any(
        item["code"] == "quality.multiple_daily_labels" for item in result["quality"]["warnings"]
    )


@pytest.mark.parametrize(
    "calendar",
    [
        regular(sessions=[{"weekdays": [True], "open": "09:30", "close": "16:00"}]),
        regular(sessions=[{"weekdays": [0], "open": "09:30", "close": "09:30"}]),
        regular(
            sessions=[
                {"weekdays": [0], "open": "09:30", "close": "12:00"},
                {"weekdays": [0], "open": "11:30", "close": "16:00"},
            ]
        ),
        regular(
            sessions=[
                {"weekdays": [0], "open": "22:00", "close": "02:00"},
                {"weekdays": [1], "open": "01:00", "close": "03:00"},
            ]
        ),
        regular(exceptions={"2026-02-30": []}),
    ],
)
def test_ambiguous_or_overlapping_declared_calendars_fail_before_import(calendar):
    with pytest.raises(DatasetQualityError):
        validate_context(context(calendar=calendar))


def test_outside_session_and_off_grid_times_are_visible_warnings_not_shifted():
    result = preview(
        "2026-11-02T08:00:00-05:00",
        "2026-11-02T09:30:01-05:00",
        context_changes={"calendar": regular()},
    )
    assert result["counts"]["outsideSession"] == 1 and result["counts"]["offGrid"] == 1
    assert result["bars"][1]["time"] == "2026-11-02T14:30:01.000000Z"
    assert result["quality"]["status"] == "partial"


def test_ambiguous_calendar_boundaries_do_not_claim_verified_coverage():
    calendar = {
        "id": "declared-dst-window",
        "timezone": "America/New_York",
        "sessions": [{"weekdays": [6], "open": "01:30", "close": "04:00"}],
        "exceptions": {},
    }
    result = preview("2026-11-01T02:30:00-05:00", context_changes={"calendar": calendar})
    assert result["canCommit"] and result["counts"]["calendarUnclassified"] == 1
    assert result["quality"]["status"] == "partial"


def test_calendar_scan_budget_classifies_unknown_instead_of_iterating_missing_seconds(monkeypatch):
    monkeypatch.setattr(quality, "MAX_CALENDAR_DAYS", 2)
    result = preview(
        "1900-01-01T00:00:00Z",
        "2100-01-01T00:00:00Z",
        context_changes={"calendar": continuous(), "interval": "1s"},
    )
    assert result["coverage"]["unclassifiedGaps"] == 1
    assert result["coverage"]["missingExpectedBars"] is None and len(result["bars"]) == 2


def test_report_caps_never_truncate_canonical_data_or_total_counts(monkeypatch):
    monkeypatch.setattr(quality, "MAX_DETAILS", 2)
    result = preview(
        "2026-11-02T09:30:00Z",
        "2026-11-02T09:33:00Z",
        "2026-11-02T09:36:00Z",
        "2026-11-02T09:39:00Z",
        context_changes={"calendar": continuous()},
    )
    assert len(result["rows"]) == 2 and result["rowsTruncated"]
    assert len(result["bars"]) == 4 and result["counts"]["accepted"] == 4
    assert len(result["coverage"]["gaps"]) == 2 and result["coverage"]["gapCount"] == 3
    assert result["coverage"]["detailsTruncated"]


def test_late_rejections_stay_visible_when_the_preview_detail_budget_is_full(monkeypatch):
    monkeypatch.setattr(quality, "MAX_DETAILS", 2)
    source = (
        text("2026-11-02T09:30:00Z", "2026-11-02T09:31:00Z", "2026-11-02T09:32:00Z")
        + "2026-11-02T09:33:00Z,1,0,2,1,\n"
    )
    result = normalize_history(source, mapping(), context())
    assert result["rowsTruncated"] and len(result["rows"]) == 2
    assert (
        result["rows"][-1]["rowNumber"] == 5
        and result["rows"][-1]["errors"][0]["code"] == "row.ohlc_incoherent"
    )
    assert result["quality"]["rowErrors"] == [
        {
            "code": "row.ohlc_incoherent",
            "message": "Low must not exceed open/close, and high must not be below open/close.",
            "count": 1,
            "firstRowNumbers": [5],
        }
    ]


@pytest.mark.parametrize(
    "field,value",
    [
        ("close", "3"),
        ("open", None),
        ("time", "2026-11-02T09:30:00.000000001Z"),
        ("time", "2026-11-02T09:30:00.000000"),
        ("timestamp", 1),
        ("timestamp", True),
        ("timestamp", float("inf")),
        ("timestamp", 10**1000),
        ("volume", "-1"),
    ],
)
def test_canonical_restores_reject_tampered_prices_times_and_numeric_projections(field, value):
    bars = preview()["bars"]
    bars[0][field] = value
    with pytest.raises(DatasetQualityError):
        analyze_bars(bars, context())


def test_canonical_duplicate_policy_rejects_conflicts_and_collapses_identical_values():
    bars = preview()["bars"]
    assert len(analyze_bars(bars + deepcopy(bars), context())["bars"]) == 1
    conflict = deepcopy(bars[0])
    conflict["close"] = "1.75"
    with pytest.raises(DatasetQualityError, match="conflict"):
        analyze_bars(bars + [conflict], context())


def test_changed_source_calendar_and_roll_metadata_are_retained_without_price_adjustment():
    data = text("2026-11-02T09:30:00Z") + "2026-11-02T09:31:00Z,100,101,99,100,\n"
    result = normalize_history(
        data,
        mapping(),
        context(
            provider="Fixture-CSV",
            symbol="FRONT/FUTURE",
            adjustment="Unadjusted front-month; source-declared roll",
            allowNegativePrices=True,
        ),
    )
    assert result["context"]["provider"] == "fixture-csv"
    assert result["context"]["adjustment"] == "Unadjusted front-month; source-declared roll"
    assert result["bars"][1]["close"] == "100" and result["canCommit"]


@pytest.mark.parametrize(
    "changes",
    [
        {"version": True},
        {"timestampFormat": "auto"},
        {"timestampMeaning": "close"},
        {"timezone": "Invalid/Timezone"},
        {"decimalSeparator": ".", "thousandsSeparator": "."},
        {
            "columns": {
                "timestamp": "timestamp",
                "open": "close",
                "high": "high",
                "low": "low",
                "close": "close",
            }
        },
    ],
)
def test_mapping_never_guesses_missing_or_unsupported_semantics(changes):
    with pytest.raises(DatasetQualityError):
        validate_mapping(mapping(**changes))


def test_source_and_context_are_strict_bounded_private_data_not_code(monkeypatch):
    with pytest.raises(DatasetQualityError):
        validate_context(context(ownerId="someone_else"))
    with pytest.raises(DatasetQualityError):
        validate_context(context(allowNegativePrices="true"))
    with pytest.raises(DatasetQualityError):
        normalize_history(text() + "\ud800", mapping(), context())
    with pytest.raises(DatasetQualityError):
        normalize_history("timestamp,open,high,low,close,volume,password\n", mapping(), context())
    monkeypatch.setattr(quality, "MAX_ROWS", 1)
    with pytest.raises(DatasetQualityError) as caught:
        preview("2026-11-02T09:30:00Z", "2026-11-02T09:31:00Z")
    assert caught.value.status == 413


def test_malformed_csv_header_columns_and_utf8_budget_have_structured_errors(monkeypatch):
    with pytest.raises(DatasetQualityError):
        normalize_history("timestamp,open,open,low,close,volume\n", mapping(), context())
    with pytest.raises(DatasetQualityError):
        normalize_history(
            'timestamp,open,high,low,close,volume\n"unterminated', mapping(), context()
        )
    row = normalize_history(text() + "2026-11-02T09:31:00Z,1,2\n", mapping(), context())
    assert row["counts"]["rejected"] == 1 and row["canCommit"]
    monkeypatch.setattr(quality, "MAX_CSV_BYTES", 10)
    with pytest.raises(DatasetQualityError) as caught:
        preview()
    assert caught.value.status == 413
