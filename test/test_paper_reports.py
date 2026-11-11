"""Canonical paper report semantics without pooled or fictional performance."""

from copy import deepcopy

import pytest
from test_paper_journal import advance, close, order, publish
from test_paper_storage import make_record, save_record

from services.domain.validation import validate_record
from services.paper_reports import build_paper_report, compare_paper_reports

pytest_plugins = ["test_journal_service"]


def metric(report, name):
    return next(item for item in report["metrics"] if item["metricId"] == name)


def test_no_fill_report_has_honest_sample_denominators_and_valid_canonical_adapters(storage):
    record, session = make_record(storage)
    report = build_paper_report(record, session)
    assert not validate_record("RunManifest", report["manifest"])
    assert not validate_record("Checkpoint", report["checkpoint"])
    assert all(not validate_record("MetricResult", value) for value in report["metrics"])
    assert metric(report, "win_rate")["unavailableReason"] == "empty_sample"
    assert metric(report, "profit_factor")["unavailableReason"] == "empty_sample"
    assert metric(report, "fees")["value"] == "0"
    assert report["coverage"]["observedCount"] == 0
    assert report["startingCash"] == "10000"
    assert report["manifest"]["startingCash"] == {"currency": "USD", "value": "10000"}


def test_selected_native_window_pins_manifest_availability_end(storage):
    record, _ = make_record(storage)
    assert record["manifest"]["rangeStart"] == "2026-11-02T09:00:00.000Z"
    assert record["manifest"]["rangeEnd"] == "2026-11-02T09:08:00.000Z"


def test_open_position_report_separates_realized_fees_from_unrealized_mark(storage):
    record, session = save_record(storage)
    order(record)
    advance(record, 0, "100", "101")
    publish(storage, record)
    report = build_paper_report(record, session)
    assert report["summary"]["cash"] == "9999"
    assert report["summary"]["equity"] == "10009"
    assert metric(report, "realized_net")["value"] == "-1"
    assert metric(report, "unrealized_pnl")["value"] == "10"
    assert metric(report, "win_rate")["sampleSize"] == 0
    assert report["positions"][0]["status"] == "open"


def test_closed_position_win_rate_counts_position_once_not_entry_fee_or_partial_exits(storage):
    record, session = save_record(storage)
    order(record)
    advance(record, 0)
    publish(storage, record)
    close(record, "4", "partial")
    advance(record, 1, "110", "111")
    publish(storage, record)
    partial = build_paper_report(record, session)
    assert metric(partial, "win_rate")["sampleSize"] == 0
    close(record, "6", "final")
    advance(record, 2, "110", "111")
    publish(storage, record)
    report = build_paper_report(record, session)
    assert metric(report, "win_rate")["sampleSize"] == 1
    assert metric(report, "win_rate")["value"] == "100"
    assert metric(report, "profit_factor")["unavailableReason"] == "zero_denominator"
    assert metric(report, "realized_net")["value"] == "97"
    assert metric(report, "fees")["value"] == "3"


def test_report_identity_and_checksum_survive_database_reload(storage):
    from test_paper_storage import ORIGIN

    from services.paper_records import PaperRecords

    record, session = save_record(storage)
    before = build_paper_report(record, session)
    with storage.engine.connect() as connection:
        reloaded = PaperRecords(storage).load(connection, ORIGIN, 1)
    assert build_paper_report(reloaded, session) == before


def test_report_uses_exact_full_clock_drawdown_not_display_curve_sampling(storage):
    record, session = make_record(storage)
    record["state"].update(maxDrawdown="25", maxDrawdownPct="0.25", curveStride=8)
    report = build_paper_report(record, session)
    assert metric(report, "max_drawdown")["value"] == "25"
    assert metric(report, "max_drawdown_percent")["value"] == "0.25"


def test_comparison_keeps_each_currency_and_capital_independent(storage):
    record, session = make_record(storage)
    first = build_paper_report(record, session)
    second = deepcopy(first)
    second["runId"] = 2
    second["manifest"]["id"] = "paperrun_independent02"
    second["currency"] = "EUR"
    second["startingCash"] = "100000"
    result = compare_paper_reports([first, second])
    assert result["selectedCount"] == 2
    assert result["combinedEquity"] is None and result["pooledMetrics"] is None
    assert result["currencyConversion"] == "none"
    assert [(row["currency"], row["startingCash"]) for row in result["runs"]] == [
        ("USD", "10000"),
        ("EUR", "100000"),
    ]
    assert compare_paper_reports([])["runs"] == []


def test_comparison_rejects_duplicate_run_identity(storage):
    from services.workspace_storage import WorkspaceError

    record, session = make_record(storage)
    report = build_paper_report(record, session)
    with pytest.raises(WorkspaceError, match="comparison"):
        compare_paper_reports([report, report])


def test_report_preserves_parent_branch_identity_and_chart_journal_drilldowns(storage):
    record, session = make_record(storage)
    record["parent"] = {"runId": 99, "cursorIndex": 0, "asOf": 1793610060}
    report = build_paper_report(record, session)
    assert report["parent"] == record["parent"]
    assert "runId=1" in report["links"]["chart"]
    assert record["manifest"]["bookId"] in report["links"]["journal"]
