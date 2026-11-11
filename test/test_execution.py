"""P11: state machine, pretrade, risk, idempotent outbox, recovery."""

import pytest
from test_journal_api import setup

from services.execution import (
    DispatchRejected,
    DispatchTimeout,
    ExecutionService,
    pretrade_issues,
    preview_ticket,
    risk_check,
    transition,
)
from services.workspace_storage import WorkspaceError, WorkspaceStorage

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1"
AT = "2026-11-04T12:00:00Z"
RULES = {
    "tickSize": "0.01",
    "quantityStep": "0.001",
    "minQuantity": "0.001",
    "maxQuantity": "1000",
    "minNotional": "10",
    "supportedTypes": ["market", "limit", "stop"],
    "currency": "USD",
}
POLICY = {
    "currency": "USD",
    "maxOrderNotional": "5000",
    "maxExposure": "10000",
    "dailyLossLimit": "250",
}
ACCOUNT_STATE = {
    "currency": "USD",
    "exposure": "1000",
    "reservedNotional": "500",
    "dayPnl": "0",
    "positionQuantity": "0",
}
DESTINATION = {
    "id": "executiondestination-demo1",
    "accountId": "account-demo-001",
    "mode": "broker_demo",
    "arming": "armed",
    "eligibility": "eligible",
    "nativeSymbol": "XBTUSD",
}


def intent(**changes):
    base = {
        "schemaVersion": 1,
        "id": "orderintent-fixture01",
        "ownerId": "owner-execution-tt",
        "workspaceId": "workspace-execution",
        "revision": 1,
        "createdAt": AT,
        "updatedAt": AT,
        "accountId": "account-demo-001",
        "instrumentId": "instrument-btc-usd",
        "mode": "broker_demo",
        "side": "buy",
        "orderType": "limit",
        "quantity": {"value": "0.010", "unit": "base_asset"},
        "limitPrice": "60000.00",
        "idempotencyKey": "ticket-001",
    }
    base.update(changes)
    return base


def test_state_machine_rejects_illegal_transitions():
    command = {"status": "pending", "revision": 1}
    transition(command, "submitted", AT)
    transition(command, "acknowledged", AT)
    with pytest.raises(WorkspaceError) as error:
        transition(command, "pending", AT)
    assert "transition_invalid" in error.value.code


def test_pretrade_refuses_off_grid_without_rounding():
    assert pretrade_issues(intent(), RULES) == []
    assert "price_off_tick" in pretrade_issues(intent(limitPrice="60000.005"), RULES)
    assert "quantity_off_step" in pretrade_issues(
        intent(quantity={"value": "0.0105", "unit": "base_asset"}), RULES
    )
    no_price = intent()
    del no_price["limitPrice"]
    assert "limit_price_required" in pretrade_issues(no_price, RULES)


def test_risk_blocks_entries_but_allows_reducing_close():
    breached = dict(ACCOUNT_STATE, dayPnl="-300", positionQuantity="0.010")
    entry = risk_check(intent(), policy=POLICY, account_state=breached)
    assert entry["allowed"] is False
    closing = risk_check(intent(side="sell"), policy=POLICY, account_state=breached)
    assert closing["allowed"] is True
    assert closing["reducing"] is True
    foreign = risk_check(intent(), policy=POLICY, account_state=dict(ACCOUNT_STATE, currency="GBP"))
    assert foreign["reasons"] == ["currency_mismatch_no_conversion"]


def test_preview_ticket_shows_environment_units_and_verdict():
    preview = preview_ticket(intent(), DESTINATION, RULES, POLICY, ACCOUNT_STATE)
    assert preview["environment"] == "broker_demo"
    assert preview["nativeSymbol"] == "XBTUSD"
    assert preview["estimatedNotional"] == "600"
    assert preview["submittable"] is True
    bad = preview_ticket(intent(limitPrice="60000.005"), DESTINATION, RULES, POLICY, ACCOUNT_STATE)
    assert bad["submittable"] is False
    assert bad["pretradeIssues"] == ["price_off_tick"]


@pytest.fixture
def service(api):
    with api.test_client() as client:
        origin = setup(client)["originId"]
        principal = client.get(BASE + "/context").json["principalId"]
    storage = WorkspaceStorage(
        api.extensions["chartly_workspace_storage"]["engine"], principal
    )
    return ExecutionService(storage), origin


def _submit(service, origin, dispatcher, **intent_changes):
    return service.submit(
        origin,
        destination=DESTINATION,
        intent=intent(**intent_changes),
        rules=RULES,
        policy=POLICY,
        account_state=ACCOUNT_STATE,
        dispatcher=dispatcher,
    )


def test_idempotent_submit_dispatches_exactly_once(service):
    service, origin = service
    calls = []

    def dispatcher(command, _intent):
        calls.append(command["id"])
        assert command["status"] == "submitted"  # durable before dispatch
        return {"nativeOrderId": "broker-9"}

    first = _submit(service, origin, dispatcher)
    second = _submit(service, origin, dispatcher)
    assert first["duplicate"] is False
    assert second["duplicate"] is True
    assert first["command"]["status"] == "acknowledged"
    assert first["command"]["nativeOrderId"] == "broker-9"
    assert len(calls) == 1


def test_timeout_lands_unknown_and_recovery_never_resubmits(service):
    service, origin = service
    calls = []

    def flaky(_command, _intent):
        calls.append(1)
        raise DispatchTimeout()

    result = _submit(service, origin, flaky)
    assert result["command"]["status"] == "unknown"
    actions = service.recover(origin, "account-demo-001")
    assert actions == [
        {"commandId": result["command"]["id"], "action": "reconcile_with_broker_before_any_retry"}
    ]
    bundle = service.get_account(origin, "account-demo-001")
    assert bundle["commands"][0]["status"] == "reconciling"
    assert len(calls) == 1  # recovery did not dispatch again


def test_rejection_releases_reservation_and_partial_fills_accumulate(service):
    service, origin = service
    with pytest.raises(WorkspaceError):
        _submit(service, origin, lambda c, i: {"nativeOrderId": "x"}, limitPrice="60000.005")

    rejected = _submit(
        service, origin,
        lambda c, i: (_ for _ in ()).throw(DispatchRejected("insufficient funds")),
        idempotencyKey="ticket-002",
        id="orderintent-fixture02",
    )
    assert rejected["command"]["status"] == "rejected"
    bundle = service.get_account(origin, "account-demo-001")
    meta = bundle["meta"][rejected["command"]["id"]]
    assert meta["reservedNotional"] == "0"
    assert meta["brokerReason"] == "insufficient funds"

    filled = _submit(
        service, origin,
        lambda c, i: {"nativeOrderId": "broker-10", "protectionAcknowledged": True},
        idempotencyKey="ticket-003",
        id="orderintent-fixture03",
    )
    command_id = filled["command"]["id"]
    partial = service.apply_fill(
        origin, "account-demo-001", command_id, fill_quantity="0.004", intent_quantity="0.010"
    )
    assert partial["status"] == "part_filled"
    done = service.apply_fill(
        origin, "account-demo-001", command_id, fill_quantity="0.006", intent_quantity="0.010"
    )
    assert done["status"] == "filled"
    bundle = service.get_account(origin, "account-demo-001")
    # Protection is broker-acknowledged state, never inferred from intent.
    assert bundle["meta"][command_id]["nativeProtection"] == "broker-acknowledged"


def test_cancel_and_emergency_actions_are_separate(service):
    service, origin = service
    order = _submit(
        service, origin,
        lambda c, i: {"nativeOrderId": "broker-11"},
        idempotencyKey="ticket-004",
        id="orderintent-fixture04",
    )
    stopped = service.stop_automation(origin, "account-demo-001")
    assert order["command"]["id"] in stopped["openCommands"]
    cancelled = []
    outcome = service.cancel_open_orders(
        origin, "account-demo-001", lambda cid: cancelled.append(cid)
    )
    assert outcome["results"] == [{"commandId": order["command"]["id"], "outcome": "cancelled"}]
    assert cancelled == [order["command"]["id"]]
    bundle = service.get_account(origin, "account-demo-001")
    assert bundle["commands"][0]["status"] == "cancelled"
