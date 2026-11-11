"""Independent normalized-statement facts, repeat reconciliation and DST cases."""

import csv
import io
from copy import deepcopy
from pathlib import Path

import pytest

from services.journal_import import (
    JournalImportError,
    normalize_statement,
    validate_mapping,
    validate_normalized_event,
)

FIXTURES = Path(__file__).parent / "fixtures" / "p03"
CONTEXT = {
    "provider": "fixture-csv",
    "accountKey": "canonical-account-1",
    "bookId": "book-fixture-1",
    "portfolioId": 1,
    "accountId": 1,
    "currency": "USD",
}
FIELDS = [
    "eventId",
    "eventType",
    "positionId",
    "occurredAt",
    "openedAt",
    "closedAt",
    "symbol",
    "side",
    "quantity",
    "price",
    "entryPrice",
    "exitPrice",
    "grossPnl",
    "commission",
    "swap",
    "fees",
    "netPnl",
    "amount",
    "currency",
    "quantityUnit",
    "riskAmount",
    "orderId",
    "decisionId",
    "strategy",
    "notes",
    "sequence",
]


def mapping(**kwargs):
    return {
        "version": 1,
        "name": "Normalized statement",
        "columns": {field: field for field in FIELDS},
        "timezone": "Europe/London",
        "currency": "USD",
        "quantityUnit": "units",
        "missingCostPolicy": "declared-zero",
        **kwargs,
    }


def statement(*rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue()


def trade(**kwargs):
    return {
        "eventId": "trade-1",
        "eventType": "trade",
        "positionId": "position-1",
        "openedAt": "2026-11-02T09:00:00Z",
        "closedAt": "2026-11-02T10:00:00Z",
        "symbol": "EURUSD",
        "side": "Buy",
        "quantity": "0.5",
        "netPnl": "100",
        "currency": "USD",
        **kwargs,
    }


def normalize(*rows, previous=(), config=None, context=None):
    return normalize_statement(statement(*rows), config or mapping(), context or CONTEXT, previous)


@pytest.mark.parametrize("unit", ["shares", "coins"])
def test_shares_and_coins_mapping_and_source_units_roundtrip_without_conversion(unit):
    config = mapping(quantityUnit=unit)
    assert validate_mapping(config)["quantityUnit"] == unit
    preview = normalize(trade(quantity="0.125"), config=config)
    assert preview["canCommit"], preview["rows"]
    event = preview["events"][0]
    assert validate_normalized_event(event)["quantityUnit"] == unit
    assert event["quantity"] == "0.125"
    assert preview["tradeProjections"][0]["quantityUnit"] == unit
    assert preview["tradeProjections"][0]["amounts"]["quantity"] == "0.125"
    repeated = normalize(trade(quantity="0.125"), config=config, previous=preview["events"])
    assert repeated["counts"]["unchanged"] == 1
    row_unit = normalize(trade(quantity="0.125", quantityUnit=unit))
    assert row_unit["canCommit"] and row_unit["events"][0]["quantityUnit"] == unit


@pytest.mark.parametrize("unit", ["shares", "coins"])
def test_shares_and_coins_price_pnl_still_requires_declared_multiplier(unit):
    row = trade(netPnl="", entryPrice="100", exitPrice="102")
    blocked = normalize(row, config=mapping(quantityUnit=unit))
    assert not blocked["canCommit"]
    accepted = normalize(row, config=mapping(quantityUnit=unit, pnlMultiplier="1"))
    assert accepted["canCommit"], accepted["rows"]
    assert accepted["tradeProjections"][0]["amounts"]["netPnl"] == "1"


def test_summary_costs_raw_lexical_values_and_cashflow_are_exact():
    text = (FIXTURES / "universal-summary.csv").read_text()
    headers = next(csv.reader(io.StringIO(text)))
    config = mapping(columns={field: field for field in headers})
    preview = normalize_statement(text, config, CONTEXT)
    assert preview["canCommit"] and preview["counts"]["insert"] == 2
    projection = preview["tradeProjections"][0]
    assert projection["amounts"] == {
        "grossPnl": "125.5",
        "netPnl": "122",
        "commission": "2",
        "swap": "-1",
        "fees": "0.5",
        "quantity": "0.5",
        "entryPrice": "1.1",
        "exitPrice": "1.11",
        "riskAmount": None,
    }
    assert projection["result"] == "Win" and projection["remainingQuantity"] == "0"
    assert projection["sourceEventKeys"] and projection["realizations"][0]["netPnl"] == "122"
    event = next(event for event in preview["events"] if event["type"] == "trade")
    assert event["source"]["raw"]["grossPnl"] == "125.5000"
    assert event["source"]["raw"]["notes"] == "Fixture source note, retained verbatim"
    totals = preview["totals"]["byCurrency"]["USD"]
    assert (
        totals["netPnl"] == "122"
        and totals["deposits"] == "1000"
        and len(preview["tradeProjections"]) == 1
    )


def test_unchanged_file_and_reordered_overlap_are_idempotent():
    first = normalize(trade(), trade(eventId="trade-2", positionId="position-2", netPnl="-10"))
    again = normalize(
        trade(eventId="trade-2", positionId="position-2", netPnl="-10.000"),
        trade(netPnl="100.0"),
        previous=first["events"],
    )
    assert again["canCommit"] and again["counts"] == {
        "insert": 0,
        "unchanged": 2,
        "correction": 0,
        "conflict": 0,
        "error": 0,
    }
    assert len(again["tradeProjections"]) == 2
    assert again["totals"]["byCurrency"]["USD"]["netPnl"] == "90"


def test_fee_correction_is_explicit_and_does_not_contain_review_annotations():
    initial = normalize(trade(grossPnl="105", commission="5", netPnl="100"))
    corrected = normalize(
        trade(grossPnl="105", commission="7", netPnl="98"), previous=initial["events"]
    )
    assert corrected["canCommit"] and corrected["requiresCorrectionConfirmation"]
    assert corrected["counts"]["correction"] == 1
    assert corrected["rows"][0]["previousHash"] == initial["events"][0]["canonicalHash"]
    assert corrected["tradeProjections"][0]["amounts"]["netPnl"] == "98"
    assert "review" not in corrected["tradeProjections"][0]
    fee = {
        "eventId": "fee-1",
        "eventType": "fee",
        "positionId": "position-1",
        "occurredAt": "2026-11-03T12:00:00Z",
        "commission": "2",
        "currency": "USD",
    }
    adjusted = normalize(fee, previous=corrected["events"])
    assert adjusted["tradeProjections"][0]["amounts"]["netPnl"] == "96"
    assert adjusted["tradeProjections"][0]["realizations"][-1]["kind"] == "fee"
    revised = normalize({**fee, "commission": "3"}, previous=adjusted["events"])
    assert (
        revised["counts"]["correction"] == 1
        and revised["tradeProjections"][0]["amounts"]["netPnl"] == "95"
    )


def test_partial_execution_overlap_closes_remainder_exactly_once():
    entry = {
        "eventId": "e1",
        "eventType": "entry",
        "positionId": "p",
        "occurredAt": "2026-11-02T09:00:00Z",
        "symbol": "TEST",
        "side": "Buy",
        "quantity": "10",
        "price": "100",
        "commission": "2",
        "currency": "USD",
    }
    exit1 = {
        **entry,
        "eventId": "x1",
        "eventType": "exit",
        "occurredAt": "2026-11-02T10:00:00Z",
        "side": "Sell",
        "quantity": "4",
        "price": "110",
        "commission": "1",
    }
    initial = normalize(entry, exit1, config=mapping(pnlMultiplier="1"))
    assert initial["canCommit"]
    partial = initial["tradeProjections"][0]
    assert (
        partial["result"] == "Open"
        and partial["remainingQuantity"] == "6"
        and partial["closedAt"] is None
    )
    assert partial["amounts"]["netPnl"] == "38.2" and partial["realizations"][0]["quantity"] == "4"
    entry2 = {
        **entry,
        "eventId": "e2",
        "occurredAt": "2026-11-02T11:00:00Z",
        "quantity": "5",
        "price": "120",
        "commission": "1",
    }
    exit2 = {
        **exit1,
        "eventId": "x2",
        "occurredAt": "2026-11-02T12:00:00Z",
        "quantity": "11",
        "price": "130",
        "commission": "2",
    }
    complete = normalize(
        exit1, entry2, exit2, config=mapping(pnlMultiplier="1"), previous=initial["events"]
    )
    projected = complete["tradeProjections"][0]
    assert complete["canCommit"] and complete["counts"]["unchanged"] == 1
    assert projected["remainingQuantity"] == "0" and projected["amounts"]["netPnl"] == "264"
    assert [item["netPnl"] for item in projected["realizations"]] == ["38.2", "225.8"]
    again = normalize(exit2, entry2, config=mapping(pnlMultiplier="1"), previous=complete["events"])
    assert (
        again["counts"]["unchanged"] == 2
        and again["tradeProjections"] == complete["tradeProjections"]
    )


def test_source_ids_are_scoped_to_account_and_provider_not_file_or_environment():
    first = normalize(trade())
    other = normalize(trade(), context={**CONTEXT, "accountKey": "account-2", "bookId": "book-2"})
    provider = normalize(trade(), context={**CONTEXT, "provider": "another-provider"})
    assert (
        len(
            {
                first["events"][0]["eventKey"],
                other["events"][0]["eventKey"],
                provider["events"][0]["eventKey"],
            }
        )
        == 3
    )
    profile = normalize(trade(), context={**CONTEXT, "portfolioId": 2}, previous=first["events"])
    assert (
        profile["counts"]["unchanged"] == 1 and profile["tradeProjections"][0]["portfolioId"] == 1
    )
    with pytest.raises(JournalImportError, match="Previous events"):
        normalize(trade(), context={**CONTEXT, "bookId": "foreign-book"}, previous=first["events"])


def test_duplicate_rows_are_counted_once_but_conflicting_ids_block_entire_commit():
    exact = normalize(trade(), trade())
    assert (
        exact["canCommit"] and exact["counts"]["insert"] == 1 and exact["counts"]["unchanged"] == 1
    )
    assert exact["rows"][1]["duplicateOfRow"] == 2
    conflict = normalize(trade(), trade(netPnl="101"))
    assert not conflict["canCommit"] and conflict["counts"]["conflict"] == 2
    assert len(conflict["events"]) == 1 and all(row["errors"] for row in conflict["rows"])


@pytest.mark.parametrize(
    "opened,closed,expected",
    [
        ("2026-11-02T23:30:00-05:00", "2026-11-03T00:30:00-05:00", "2026-11-03T05:30:00.000000Z"),
        ("2026-07-01T23:30:00", "2026-07-02T00:30:00", "2026-07-01T23:30:00.000000Z"),
        ("2026-10-25T01:15:00+01:00", "2026-10-25T01:45:00+00:00", "2026-10-25T01:45:00.000000Z"),
    ],
)
def test_midnight_timezone_and_explicit_dst_offset(opened, closed, expected):
    result = normalize(trade(openedAt=opened, closedAt=closed))
    assert result["canCommit"] and result["tradeProjections"][0]["closedAt"] == expected


@pytest.mark.parametrize(
    "time,code",
    [
        ("2026-03-29T01:30:00", "nonexistent"),
        ("2026-10-25T01:30:00", "ambiguous"),
        ("2026-11-02", "invalid"),
        ("2026-11-02T09:00:00.1234567Z", "invalid"),
        ("2026-02-30T09:00:00Z", "invalid"),
    ],
)
def test_invalid_or_ambiguous_source_time_is_row_error(time, code):
    preview = normalize(trade(openedAt=time))
    assert not preview["canCommit"] and any(
        code in error["code"] for error in preview["rows"][0]["errors"]
    )


def test_fractional_timestamp_sorts_after_same_second_not_before_it():
    first = {
        "eventId": "entry",
        "eventType": "entry",
        "positionId": "p",
        "occurredAt": "2026-11-02T09:00:00Z",
        "symbol": "TEST",
        "side": "Sell",
        "quantity": "2",
        "price": "100",
        "currency": "USD",
    }
    close = {
        **first,
        "eventId": "exit",
        "eventType": "exit",
        "occurredAt": "2026-11-02T09:00:00.5Z",
        "side": "Buy",
        "price": "90",
    }
    preview = normalize(close, first, config=mapping(pnlMultiplier="1"))
    assert preview["canCommit"] and preview["tradeProjections"][0]["amounts"]["netPnl"] == "20"


def test_open_summary_can_later_close_and_zero_risk_is_not_invented():
    opened = normalize(trade(closedAt="", netPnl="", riskAmount="0"))
    assert opened["canCommit"]
    projection = opened["tradeProjections"][0]
    assert projection["amounts"]["netPnl"] is None and projection["amounts"]["riskAmount"] == "0"
    assert projection["result"] == "Open" and projection["remainingQuantity"] == "0.5"
    closed = normalize(trade(netPnl="0", riskAmount="0"), previous=opened["events"])
    assert (
        closed["counts"]["correction"] == 1
        and closed["tradeProjections"][0]["result"] == "Break Even"
    )


def test_multicurrency_cashflows_are_separate_and_never_summed_as_trades():
    rows = [
        trade(netPnl="10"),
        trade(eventId="t2", positionId="p2", currency="EUR", netPnl="20"),
        {
            "eventId": "d",
            "eventType": "deposit",
            "occurredAt": "2026-11-02T08:00:00Z",
            "amount": "1000",
            "currency": "USD",
        },
        {
            "eventId": "w",
            "eventType": "withdrawal",
            "occurredAt": "2026-11-02T08:30:00Z",
            "amount": "-200",
            "currency": "EUR",
        },
        {
            "eventId": "f",
            "eventType": "fee",
            "occurredAt": "2026-11-02T08:45:00Z",
            "fees": "3",
            "currency": "USD",
        },
    ]
    denied = normalize(*rows)
    assert not denied["canCommit"] and any(
        "currency_mismatch" in e["code"] for row in denied["rows"] for e in row["errors"]
    )
    accepted = normalize(*rows, config=mapping(allowMixedCurrencies=True))
    assert (
        accepted["canCommit"]
        and len(accepted["tradeProjections"]) == 2
        and len(accepted["cashflows"]) == 3
    )
    assert accepted["totals"]["byCurrency"]["USD"]["netPnl"] == "7"
    assert accepted["totals"]["byCurrency"]["USD"]["deposits"] == "1000"
    assert accepted["totals"]["byCurrency"]["USD"]["unallocatedFees"] == "-3"
    assert accepted["totals"]["byCurrency"]["EUR"]["withdrawals"] == "-200"


def test_decimal_comma_thousands_and_signed_cost_mapping_are_explicit_and_reusable():
    config = mapping(
        delimiter=";",
        decimalSeparator=",",
        thousandsSeparator=".",
        costConvention="signed",
        pnlMultiplier="1.25",
    )
    row = trade(
        quantity="0,5",
        grossPnl="1.000,1234",
        commission="-2,1234",
        swap="-1,00",
        fees="-0,50",
        netPnl="996,5",
    )
    stream = io.StringIO()
    writer = csv.DictWriter(stream, FIELDS, delimiter=";", lineterminator="\n")
    writer.writeheader()
    writer.writerow(row)
    result = normalize_statement(stream.getvalue(), config, CONTEXT)
    assert result["canCommit"] and result["tradeProjections"][0]["amounts"]["netPnl"] == "996.5"
    assert validate_mapping(result["mapping"]) == result["mapping"]


@pytest.mark.parametrize(
    "patch,code",
    [
        ({"quantity": "0"}, "quantity_invalid"),
        ({"quantity": "-1"}, "quantity_invalid"),
        ({"quantity": "NaN"}, "quantity_invalid"),
        ({"netPnl": "Infinity"}, "netPnl_invalid"),
        ({"netPnl": "1e6"}, "netPnl_invalid"),
        ({"netPnl": "1,234.56"}, "netPnl_invalid"),
        ({"netPnl": "0.1234567890123456789"}, "netPnl_precision"),
        ({"currency": "??"}, "currency_invalid"),
        ({"quantityUnit": "pips"}, "quantityUnit_invalid"),
        ({"riskAmount": "-1"}, "riskAmount_invalid"),
        ({"closedAt": "2026-11-02T08:00:00Z"}, "close_before_open"),
        ({"grossPnl": "100", "commission": "1", "netPnl": "100"}, "netPnl_mismatch"),
    ],
)
def test_malformed_fields_block_commit_with_row_errors(patch, code):
    preview = normalize(trade(**patch))
    assert not preview["canCommit"]
    assert any(code in error["code"] for row in preview["rows"] for error in row["errors"])


@pytest.mark.parametrize(
    "change",
    [
        {"timezone": "not/a-zone"},
        {"timezone": None},
        {"quantityUnit": "shares-ish"},
        {"version": 2},
        {"version": True},
        {"currency": "$"},
        {"costConvention": "guess"},
        {"columns": {"eventId": "eventId"}},
        {"columns": {"eventId": "same", "eventType": "same"}},
        {"columns": {"eventId": "absent", "eventType": "eventType"}},
        {"delimiter": "xx"},
        {"unexpected": "field"},
        {"pnlMultiplier": "0"},
    ],
)
def test_invalid_mapping_rejected_before_normalization(change):
    with pytest.raises(JournalImportError):
        normalize(trade(), config=mapping(**change))


@pytest.mark.parametrize(
    "text",
    [
        "eventId,eventType,eventId\na,trade,b\n",
        "eventId,eventType\na,trade,extra\n",
        'eventId,eventType\n"unterminated,trade\n',
        "eventId,eventType,api_key\na,trade,secret\n",
        "\x00invalid",
        "\ud800",
    ],
)
def test_malformed_csv_and_credentials_are_not_retained(text):
    config = mapping(columns={"eventId": "eventId", "eventType": "eventType"})
    with pytest.raises(JournalImportError):
        normalize_statement(text, config, CONTEXT)


def test_partial_exit_requires_parent_correct_side_quantity_and_contract_economics():
    entry = {
        "eventId": "e",
        "eventType": "entry",
        "positionId": "p",
        "occurredAt": "2026-11-02T09:00:00Z",
        "symbol": "TEST",
        "side": "Buy",
        "quantity": "10",
        "price": "100",
        "currency": "USD",
    }
    exit = {
        **entry,
        "eventId": "x",
        "eventType": "exit",
        "occurredAt": "2026-11-02T10:00:00Z",
        "side": "Sell",
        "price": "110",
    }
    for rows, code in [
        ([exit], "missing_parent"),
        ([entry, {**exit, "quantity": "11"}], "over_closed"),
        ([entry, {**exit, "side": "Buy"}], "exit_side"),
        ([entry, exit], "pnl_unknown"),
    ]:
        result = normalize(*rows)
        assert not result["canCommit"] and any(
            code in error["code"] for error in result["positionErrors"]
        )
    same_time = normalize(
        entry, {**exit, "occurredAt": entry["occurredAt"]}, config=mapping(pnlMultiplier="1")
    )
    assert (
        not same_time["canCommit"]
        and same_time["positionErrors"][0]["code"] == "position.ambiguous_sequence"
    )
    explicit = normalize(
        {**entry, "sequence": "1"},
        {**exit, "occurredAt": entry["occurredAt"], "sequence": "2"},
        config=mapping(pnlMultiplier="1"),
    )
    assert explicit["canCommit"] and explicit["tradeProjections"][0]["amounts"]["netPnl"] == "100"


def test_quoted_newline_and_formula_like_notes_are_data_only_and_inputs_unchanged():
    row = trade(notes='=HYPERLINK("example")\nSecond source line')
    config = mapping()
    context = deepcopy(CONTEXT)
    before = deepcopy((row, config, context))
    result = normalize(row, config=config, context=context)
    assert result["canCommit"] and result["events"][0]["source"]["raw"]["notes"] == row["notes"]
    assert (row, config, context) == before
    assert normalize(row, config=config, context=context) == result


def test_extreme_bounded_decimal_multiplication_never_uses_binary_float():
    large = "9999999999999"
    result = normalize(
        trade(quantity=large, entryPrice="0", exitPrice=large, netPnl=""),
        config=mapping(pnlMultiplier=large),
    )
    assert result["canCommit"]
    from decimal import Decimal, localcontext

    with localcontext() as context:
        context.prec = 200
        expected = format(Decimal(large) ** 3, "f")
    assert result["tradeProjections"][0]["amounts"]["netPnl"] == expected
    too_large = "9999999999999999999999999999999999"
    rejected = normalize(
        trade(quantity=too_large, entryPrice="0", exitPrice=too_large, netPnl=""),
        config=mapping(pnlMultiplier=too_large),
    )
    assert (
        not rejected["canCommit"]
        and rejected["positionErrors"][0]["code"] == "position.amount_budget_exceeded"
    )


def test_zero_net_fee_components_remain_explicit_and_entry_price_pnl_is_rejected():
    fee = {
        "eventId": "fee",
        "eventType": "fee",
        "occurredAt": "2026-11-02T09:00:00Z",
        "commission": "-1",
        "fees": "1",
        "currency": "USD",
    }
    result = normalize(fee)
    assert result["canCommit"] and result["cashflows"][0]["amount"] == "0"
    entry = {
        "eventId": "entry",
        "eventType": "entry",
        "positionId": "p",
        "occurredAt": "2026-11-02T09:00:00Z",
        "symbol": "TEST",
        "side": "Buy",
        "quantity": "1",
        "price": "100",
        "grossPnl": "100",
        "currency": "USD",
    }
    invalid = normalize(entry)
    assert (
        not invalid["canCommit"]
        and invalid["rows"][0]["errors"][0]["code"] == "row.entry_pnl_invalid"
    )


def test_completed_execution_position_cannot_silently_reuse_its_identity():
    entry = {
        "eventId": "entry",
        "eventType": "entry",
        "positionId": "p",
        "occurredAt": "2026-11-02T09:00:00Z",
        "symbol": "TEST",
        "side": "Buy",
        "quantity": "1",
        "price": "100",
        "currency": "USD",
    }
    exit = {
        **entry,
        "eventId": "exit",
        "eventType": "exit",
        "occurredAt": "2026-11-02T10:00:00Z",
        "side": "Sell",
        "price": "110",
    }
    reopened = {**entry, "eventId": "entry-2", "occurredAt": "2026-11-02T11:00:00Z"}
    result = normalize(entry, exit, reopened, config=mapping(pnlMultiplier="1"))
    assert (
        not result["canCommit"]
        and result["positionErrors"][0]["code"] == "position.reopened_identity"
    )


def test_asset_currency_codes_and_stored_event_schema_are_verified():
    result = normalize(trade(currency="USDT"), context={**CONTEXT, "currency": "USDT"})
    event = result["events"][0]
    assert result["canCommit"] and validate_normalized_event(event) == event
    wrapped = {
        **event,
        "id": event["eventKey"],
        "tradeId": 7,
        "bookId": "restored-book",
        "portfolioId": 2,
    }
    assert validate_normalized_event(wrapped) == wrapped
    for change in (
        {"version": 2},
        {"type": "execute-code"},
        {"eventKey": "wrong"},
        {"netPnl": "NaN"},
        {"netPnl": 100},
        {"netPnl": "100.0"},
        {"currency": "ABCDEFGHIJKLM"},
        {"canonicalHash": "wrong"},
        {"id": "wrong"},
        {"quantity": "0"},
        {"closedAt": "2026-11-02T08:00:00.000000Z"},
    ):
        with pytest.raises(JournalImportError):
            validate_normalized_event({**event, **change})
    source = deepcopy(event["source"])
    source["raw"]["password"] = "forbidden"
    with pytest.raises(JournalImportError):
        validate_normalized_event({**event, "source": source})


def test_net_only_statement_preserves_unknown_costs_and_gross_by_default():
    preview = normalize(trade(netPnl="100"), config=mapping(missingCostPolicy="unknown"))
    assert preview["canCommit"]
    amounts = preview["tradeProjections"][0]["amounts"]
    assert amounts["netPnl"] == "100" and all(
        amounts[key] is None for key in ("grossPnl", "commission", "fees", "swap")
    )
    assert preview["totals"]["byCurrency"]["USD"]["grossPnl"] is None
    for event in preview["events"]:
        validate_normalized_event(event)
    revised = normalize(
        trade(netPnl="98"), config=mapping(missingCostPolicy="unknown"), previous=preview["events"]
    )
    assert (
        revised["counts"]["correction"] == 1
        and revised["totals"]["byCurrency"]["USD"]["netPnl"] == "98"
    )
    assert revised["totals"]["byCurrency"]["USD"]["fees"] is None


def test_derived_net_needs_known_costs_or_explicit_zero_declaration():
    row = trade(netPnl="", grossPnl="100")
    unknown = normalize(row, config=mapping(missingCostPolicy="unknown"))
    assert (
        not unknown["canCommit"] and unknown["positionErrors"][0]["code"] == "position.pnl_unknown"
    )
    declared = normalize(row, config=mapping(missingCostPolicy="declared-zero"))
    assert declared["canCommit"] and declared["tradeProjections"][0]["amounts"]["netPnl"] == "100"
    all_known = normalize(
        trade(netPnl="", grossPnl="100", commission="0", swap="0", fees="0"),
        config=mapping(missingCostPolicy="unknown"),
    )
    assert all_known["canCommit"] and all_known["tradeProjections"][0]["amounts"]["netPnl"] == "100"


def test_fee_net_only_retains_unknown_components_and_adjusts_pnl_without_trade_count():
    summary = normalize(trade(), config=mapping(missingCostPolicy="unknown"))
    fee = {
        "eventId": "fee",
        "eventType": "fee",
        "positionId": "position-1",
        "occurredAt": "2026-11-03T10:00:00Z",
        "netPnl": "-2",
        "currency": "USD",
    }
    adjusted = normalize(
        fee, config=mapping(missingCostPolicy="unknown"), previous=summary["events"]
    )
    assert adjusted["canCommit"] and len(adjusted["tradeProjections"]) == 1
    amounts = adjusted["tradeProjections"][0]["amounts"]
    assert amounts["netPnl"] == "98" and amounts["commission"] is None and amounts["fees"] is None


def test_partial_exit_price_is_unknown_when_any_realized_quantity_has_no_price():
    entry = {
        "eventId": "e",
        "eventType": "entry",
        "positionId": "p",
        "occurredAt": "2026-11-02T09:00:00Z",
        "symbol": "TEST",
        "side": "Buy",
        "quantity": "10",
        "price": "100",
        "currency": "USD",
    }
    first = {
        **entry,
        "eventId": "x1",
        "eventType": "exit",
        "occurredAt": "2026-11-02T10:00:00Z",
        "side": "Sell",
        "quantity": "4",
        "price": "",
        "netPnl": "40",
    }
    second = {
        **first,
        "eventId": "x2",
        "occurredAt": "2026-11-02T11:00:00Z",
        "quantity": "6",
        "price": "110",
        "netPnl": "60",
    }
    preview = normalize(entry, first, second, config=mapping(pnlMultiplier="1"))
    assert preview["canCommit"] and preview["tradeProjections"][0]["amounts"]["netPnl"] == "100"
    assert preview["tradeProjections"][0]["amounts"]["exitPrice"] is None


@pytest.mark.parametrize(
    "symbol", ["$SPX", "^GSPC", "/ES", "#US30", "ES=F", "M&M", "BTC-USDT", "白银T+D"]
)
def test_exchange_symbol_prefixes_are_preserved_without_requiring_plain_ascii(symbol):
    preview = normalize(trade(symbol=symbol))
    assert preview["canCommit"] and preview["tradeProjections"][0]["symbol"] == symbol
    validate_normalized_event(preview["events"][0])
