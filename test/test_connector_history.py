"""Independent deterministic history, correction, coverage and accounting fences."""

from copy import deepcopy

import pytest

from services.connector_history import empty_history, merge_history, validate_history
from services.workspace_storage import WorkspaceError

WINDOW = {"from": "2026-11-02T09:00:00Z", "to": "2026-11-02T10:00:00Z"}
CONTEXT = {
    "providerId": "diagnostic",
    "connectionId": "connection_test001",
    "accountKey": "account_test001",
    "receivedAt": "2026-11-02T10:01:00Z",
}


def event(**changes):
    return {
        "externalEventId": "trade-1",
        "revision": 1,
        "kind": "trade",
        "status": "confirmed",
        "occurredAt": "2026-11-02T09:30:00Z",
        "payload": {"ticket": 1, "profit": "2"},
        "normalizedTrade": {
            "eventId": "trade-1",
            "eventType": "trade",
            "positionId": "position-1",
            "openedAt": "2026-11-02T09:10:00Z",
            "closedAt": "2026-11-02T09:30:00Z",
            "symbol": "EXAMPLE",
            "side": "Buy",
            "quantity": "1",
            "entryPrice": "100",
            "exitPrice": "102",
            "grossPnl": "2",
            "commission": "0.2",
            "swap": "0",
            "fees": "0",
            "netPnl": "1.8",
            "currency": "USD",
            "quantityUnit": "shares",
        },
        **changes,
    }


def page(*events, **changes):
    return {
        "providerId": "diagnostic",
        "adapterVersion": "1.0.0",
        "identity": {"externalId": "alpha"},
        "events": list(events),
        "window": deepcopy(WINDOW),
        "cursor": None,
        "nextCursor": None,
        "hasMore": False,
        "complete": True,
        "coverage": {**WINDOW, "complete": True, "observedAt": CONTEXT["receivedAt"]},
        **changes,
    }


def merge(current, value, **context):
    return merge_history(current, value, {**CONTEXT, **context})


def test_first_page_and_repeated_page_are_idempotent_and_inputs_unchanged():
    source, blank = page(event()), empty_history()
    before = deepcopy([source, blank])
    result = merge(blank, source)
    repeat = merge(result["history"], source)
    assert [source, blank] == before
    assert result["summary"] == {
        "inserted": 1,
        "duplicates": 0,
        "corrected": 0,
        "conflicts": 0,
        "observed": 1,
        "complete": True,
    }
    assert len(result["rows"]) == 1
    assert repeat["rows"] == [] and repeat["history"] == result["history"]
    assert repeat["summary"]["duplicates"] == 1
    assert result["history"]["cursor"]["observedThrough"] == "2026-11-02T10:00:00.000000Z"


def test_correction_preserves_earlier_version_and_stale_delivery_does_not_reverse_it():
    first = event()
    initial = merge(None, page(first))["history"]
    revised = deepcopy(first)
    revised["revision"] = 2
    revised["payload"]["profit"] = "3"
    revised["normalizedTrade"].update(grossPnl="3", netPnl="2.8")
    changed = merge(initial, page(revised))
    assert changed["summary"]["corrected"] == 1
    observations = changed["history"]["observations"]
    assert len(observations) == 2
    assert observations[1]["correctsObservationId"] == observations[0]["id"]
    stale = merge(changed["history"], page(first))
    assert stale["rows"] == [] and stale["summary"]["duplicates"] == 1
    assert stale["history"]["confirmed"][0]["netPnl"] == "2.8"


def test_conflicting_same_revision_retains_observation_but_no_fact_or_complete_cursor():
    initial = merge(None, page(event()))["history"]
    conflict = event(payload={"ticket": 1, "profit": "99"})
    result = merge(initial, page(conflict))
    assert result["summary"]["conflicts"] == 1 and result["rows"] == []
    assert len(result["history"]["observations"]) == 2
    assert result["history"]["latest"] == initial["latest"]
    assert result["history"]["cursor"] == initial["cursor"]
    assert result["history"]["coverage"][-1]["reason"] == "conflicting-revision"


def test_native_revision_absent_uses_content_correction_and_old_content_dedupes():
    native = event(kind="fill", normalizedTrade=None)
    native.pop("revision")
    first = merge(None, page(native))["history"]
    corrected = {**native, "payload": {"ticket": 1, "profit": "3"}}
    second = merge(first, page(corrected))["history"]
    assert [value["revision"] for value in second["observations"]] == [1, 2]
    assert "revision" not in second["observations"][0]["event"]
    assert merge(second, page(native))["history"] == second


def test_paginated_incomplete_result_records_data_and_progress_but_not_complete_highwater():
    value = page(
        event(),
        hasMore=True,
        complete=False,
        nextCursor="page-2",
        coverage={**WINDOW, "complete": False},
    )
    result = merge(None, value)
    assert result["history"]["cursor"]["nativeCursor"] == "page-2"
    assert "observedThrough" not in result["history"]["cursor"]
    assert result["history"]["coverage"][0]["complete"] is False
    last = page(cursor="page-2")
    complete = merge(result["history"], last, expectedCursor="page-2")
    assert complete["history"]["cursor"]["nativeCursor"] is None
    assert complete["history"]["cursor"]["observedThrough"] == "2026-11-02T10:00:00.000000Z"
    assert len(complete["history"]["observations"]) == 1


def test_missing_limited_page_never_deletes_seen_records():
    initial = merge(None, page(event()))["history"]
    limited = page(complete=False, coverage={**WINDOW, "complete": False, "reason": "quota"})
    result = merge(initial, limited)
    assert result["history"]["observations"] == initial["observations"]
    assert result["history"]["latest"] == initial["latest"]
    assert result["history"]["confirmed"] == initial["confirmed"]
    assert result["history"]["cursor"] == initial["cursor"]


def test_conflicting_terminal_page_cannot_clear_the_retained_transport_cursor():
    raw = event(kind="fill", normalizedTrade=None, timeBasis="receipt-only")
    initial = merge(
        None,
        page(
            raw,
            complete=False,
            hasMore=True,
            nextCursor="page-2",
            coverage={**WINDOW, "complete": False},
        ),
    )["history"]
    revised = {**raw, "payload": {"ticket": 1, "profit": "99"}}
    result = merge(
        initial,
        page(revised, cursor="page-2", complete=False, coverage={**WINDOW, "complete": False}),
        expectedCursor="page-2",
    )
    assert result["summary"]["conflicts"] == 1
    assert result["history"]["cursor"] == initial["cursor"]
    assert result["rows"] == [] and result["history"]["confirmed"] == []


def test_gaps_do_not_advance_contiguous_highwater_until_backfilled():
    initial = merge(None, page())["history"]
    later_window = {"from": "2026-11-02T11:00:00Z", "to": "2026-11-02T12:00:00Z"}
    later = merge(initial, page(window=later_window, coverage={**later_window, "complete": True}))[
        "history"
    ]
    assert later["cursor"]["observedThrough"] == "2026-11-02T10:00:00.000000Z"
    gap = {"from": "2026-11-02T09:59:00Z", "to": "2026-11-02T11:01:00Z"}
    filled = merge(later, page(window=gap, coverage={**gap, "complete": True}))["history"]
    assert filled["cursor"]["observedThrough"] == "2026-11-02T12:00:00.000000Z"


def test_raw_partial_unknown_and_cashflows_cannot_create_closed_trade_facts():
    values = []
    for index, (kind, status) in enumerate(
        (("fill", "partial"), ("order", "unknown"), ("cashflow", "confirmed"))
    ):
        values.append(
            event(externalEventId=f"native-{index}", kind=kind, status=status, normalizedTrade=None)
        )
    result = merge(None, page(*reversed(values)))
    assert result["rows"] == [] and result["history"]["confirmed"] == []
    assert len(result["history"]["observations"]) == 3


def test_unverified_provider_clock_uses_receipt_only_and_repeated_reads_dedupe():
    raw = event(
        kind="fill",
        normalizedTrade=None,
        timeBasis="receipt-only",
        occurredAt="2026-11-02T12:30:00Z",
    )
    raw.pop("revision")
    first = merge(None, page(raw))
    assert first["history"]["cursor"] is None and first["summary"]["complete"] is False
    observed = first["history"]["observations"][0]
    assert observed["event"]["occurredAt"] == "2026-11-02T10:01:00.000000Z"
    later = merge(first["history"], page(raw), receivedAt="2026-11-02T10:02:00Z")
    assert later["summary"]["duplicates"] == 1 and len(later["history"]["observations"]) == 1
    assert len(later["history"]["coverage"]) == 1
    assert later["history"]["coverage"][0]["reason"] == "provider_clock_unverified"


@pytest.mark.parametrize(
    "change",
    [
        {"accountKey": "another-account"},
        {"providerId": "other-provider"},
        {"connectionId": "connection_other001"},
        {"identity": {"externalId": "wrong"}},
        {"expectedCursor": "not-this-page"},
    ],
)
def test_account_provider_connection_identity_cursor_scope_changes_reject(change):
    initial = merge(None, page(event()))["history"]
    with pytest.raises(WorkspaceError):
        merge(initial, page(event()), **change)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value["events"][0]["payload"].update(password="never-portable"),
        lambda value: value["events"][0].update(occurredAt="2026-11-02T08:00:00Z"),
        lambda value: value["events"][0].update(status="partial"),
        lambda value: value.update(nextCursor="unexpected"),
        lambda value: value.update(events=[event()] * 201),
        lambda value: value["coverage"].update(to="2026-11-02T11:00:00Z"),
        lambda value: value["events"][0].update(revision=True),
        lambda value: value["events"][0].update(payload={"value": float("nan")}),
    ],
)
def test_malformed_or_secret_bearing_pages_reject_without_input_mutation(mutate):
    value = page(event())
    mutate(value)
    with pytest.raises(WorkspaceError):
        merge(None, value)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value["observations"][0]["event"]["payload"].update(profit="999"),
        lambda value: value["confirmed"][0].update(netPnl="999"),
        lambda value: value["latest"].clear(),
        lambda value: value["cursor"].update(observedThrough="2026-11-03T00:00:00Z"),
        lambda value: value["observations"][0].update(accountKey="other"),
    ],
)
def test_restore_validation_reconciles_hashes_scope_projection_and_cursor(mutate):
    value = merge(None, page(event()))["history"]
    mutate(value)
    with pytest.raises(WorkspaceError):
        validate_history(value)
