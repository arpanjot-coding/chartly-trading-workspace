"""Independent P06 source/clock preparation and late-receipt review."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from test_paper_sessions import ORIGIN, act, bind_run, config, start

from services.paper_market import market_window
from services.paper_sessions import PaperSessions
from services.workspace_storage import WorkspaceError
from utils.paper_intent_guard import historical_intent

pytest_plugins = ["test_journal_service"]


def test_paper_can_resume_and_submit_after_crossing_a_native_data_gap(storage):
    csv = "timestamp,open,high,low,close,volume\n2026-11-02T09:00:00Z,100,102,98,101,1\n2026-11-02T09:02:00Z,120,122,118,121,1\n2026-11-02T09:03:00Z,130,132,128,131,1\n2026-11-02T09:04:00Z,140,142,138,141,1"
    bind_run(storage, text=csv)
    service = PaperSessions(storage)
    start(service)
    act(service, "order", {"side": "buy", "orderType": "market", "quantity": "1"})
    crossed = act(service, "advance", {"count": 2})["session"]
    assert crossed["cursorIndex"] == 1
    assert any(event["type"] == "gap" for event in crossed["ledger"])
    act(service, "close", {"positionId": crossed["positions"][0]["id"], "quantity": "1"})
    resumed = act(service, "advance", {"count": 1})["session"]
    assert resumed["cash"] == "1030" and resumed["positions"][0]["status"] == "closed"


def test_zero_history_is_unavailable_before_a_paper_account_is_created(storage):
    csv = "timestamp,open,high,low,close,volume\n2026-11-02T09:00:00Z,0,1,0,1,1\n2026-11-02T09:01:00Z,1,2,0,1,1"
    bind_run(storage, text=csv)
    service = PaperSessions(storage)
    before = storage.snapshot()
    with pytest.raises(WorkspaceError):
        act(service, "prepare", config())
    assert service.session(ORIGIN, 1) == {"session": None}
    assert storage.snapshot() == before


def test_prices_beyond_the_engine_bound_are_rejected_during_preparation(storage):
    large = "10000000000000000000"
    csv = f"timestamp,open,high,low,close,volume\n2026-11-02T09:00:00Z,{large},{large},{large},{large},1\n2026-11-02T09:01:00Z,{large},{large},{large},{large},1"
    bind_run(storage, text=csv)
    service = PaperSessions(storage)
    before = storage.snapshot()
    with pytest.raises(WorkspaceError):
        act(service, "prepare", config())
    assert storage.snapshot() == before


def test_execution_price_precision_must_fit_confirmed_journal_facts_before_preparation(storage):
    # This valid P04 price is inside the engine's magnitude bound, but its 36
    # significant digits exceed P03's supported normalized execution precision.
    price = "100000000000000000.123456789012345678"
    csv = f"timestamp,open,high,low,close,volume\n2026-11-02T09:00:00Z,{price},{price},{price},{price},1\n2026-11-02T09:01:00Z,{price},{price},{price},{price},1"
    bind_run(storage, text=csv)
    service = PaperSessions(storage)
    settings = config(startingCash="1000000000000000000")
    settings["instrument"].update(priceTick="0.000000000000000001", priceScale=18)
    before = storage.snapshot()
    with pytest.raises(WorkspaceError):
        act(service, "prepare", settings)
    assert storage.snapshot() == before


def test_daily_candle_cannot_be_prepared_after_its_own_declared_close():
    def at(day):
        return datetime(2026, 11, day, 23, tzinfo=UTC).timestamp()

    version = {
        "start": at(2),
        "end": at(3),
        "createdAt": "2026-11-05T00:00:00Z",
        "metadata": {
            "interval": "D",
            "adjustment": "none",
            "priceBasis": "raw",
            "calendar": {
                "id": "declared",
                "timezone": "UTC",
                "sessions": [{"weekdays": list(range(7)), "open": "09:00", "close": "17:00"}],
                "exceptions": {},
            },
        },
    }
    bars = [
        {"timestamp": at(day), "open": "100", "high": "102", "low": "98", "close": "101"}
        for day in (2, 3)
    ]
    with pytest.raises(WorkspaceError):
        market_window(version, {"rangeStart": "2026-11-02", "rangeEnd": "2026-11-03"}, bars)


def test_historical_basket_leg_is_rejected_before_any_broker_schema_can_strip_it():
    assert historical_intent(
        {"orders": [{"symbol": "EXAMPLE", "mode": "paper_replay", "quantity": "1"}]}
    )
    assert historical_intent({"legs": [{"symbol": "EXAMPLE", "runId": 1}]})


def test_late_repeated_advance_returns_current_ack_without_reexecuting_fills(storage):
    bind_run(storage)
    service = PaperSessions(storage)
    start(service)
    act(service, "order", {"side": "buy", "orderType": "market", "quantity": "1"})
    before = service.session(ORIGIN, 1)["session"]["revision"]
    request_id = "late_" + uuid4().hex
    committed = act(service, "advance", {"count": 1}, revision=before, request_id=request_id)
    later = act(service, "advance", {"count": 1})
    repeated = act(service, "advance", {"count": 1}, revision=before, request_id=request_id)
    assert repeated["receipt"] == committed["receipt"]
    assert repeated["session"] == later["session"]
    assert (
        len(repeated["session"]["fills"]) == 1
        and len(repeated["workspace"]["tables"]["journalTrades"]) == 1
    )


def test_branch_does_not_trade_at_its_already_observed_first_open(storage):
    bind_run(storage)
    service = PaperSessions(storage)
    start(service)
    act(service, "order", {"side": "buy", "orderType": "market", "quantity": "1"})
    act(service, "advance", {"count": 4})
    child = act(service, "branch", {"atIndex": 1, "name": "Independent earlier account"})["session"]
    assert child["cash"] == "1000" and child["orders"] == child["fills"] == child["positions"] == []
    assert child["cursorIndex"] == 0 and child["config"]["startTime"] < child["asOf"]
    act(service, "start", run=child["runId"])
    act(
        service,
        "order",
        {"side": "buy", "orderType": "market", "quantity": "1"},
        run=child["runId"],
    )
    next_event = act(service, "advance", {"count": 1}, run=child["runId"])["session"]
    assert next_event["fills"][0]["price"] == "120"
    assert next_event["fills"][0]["barTime"] >= child["asOf"]
