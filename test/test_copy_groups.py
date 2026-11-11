"""P12: sizing, independent fan-out, group status, divergence actions."""

import pytest
from test_execution import ACCOUNT_STATE, POLICY, RULES, intent
from test_journal_api import setup

from services.copy_groups import (
    divergence_actions,
    fan_out,
    group_status,
    preview_group,
    size_child,
)
from services.execution import DispatchRejected, ExecutionService
from services.workspace_storage import WorkspaceError, WorkspaceStorage

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1"


@pytest.fixture
def service(api):
    with api.test_client() as client:
        origin = setup(client)["originId"]
        principal = client.get(BASE + "/context").json["principalId"]
    storage = WorkspaceStorage(api.extensions["chartly_workspace_storage"]["engine"], principal)
    return ExecutionService(storage), origin


def _destination(suffix, account):
    return {
        "id": f"executiondestination-copy{suffix}",
        "accountId": account,
        "mode": "broker_demo",
        "arming": "armed",
        "eligibility": "eligible",
        "nativeSymbol": "XBTUSD",
    }


def _group(state="armed"):
    return {
        "id": "copygroup-main",
        "state": state,
        "destinations": [
            {
                "destination": _destination("a", "account-demo-001"),
                "instrumentId": "instrument-btc-usd",
                "rules": RULES,
                "sizing": {"mode": "multiplier", "multiplier": "1"},
            },
            {
                "destination": _destination("b", "account-demo-002"),
                "instrumentId": "instrument-btc-usd-b",
                "rules": RULES,
                "sizing": {"mode": "proportional_to_equity"},
            },
        ],
    }


def _states():
    return {"account-demo-001": ACCOUNT_STATE, "account-demo-002": ACCOUNT_STATE}


def _policies():
    return {"account-demo-001": POLICY, "account-demo-002": POLICY}


def test_sizing_modes_floor_and_skip_below_minimum():
    sized = size_child("0.010", {"mode": "multiplier", "multiplier": "1.55"}, RULES)
    assert sized["quantity"] == "0.015"  # 0.0155 floored to 0.001 step
    assert sized["appliedRounding"] == "floor_to_step"
    tiny = size_child(
        "0.010",
        {"mode": "proportional_to_equity"},
        RULES,
        parent_equity="100000",
        account_equity="100",
    )
    assert tiny == {"skip": "below_minimum_after_sizing"}


def test_preview_quantities_match_submitted_quantities():
    preview = preview_group(
        _group(),
        intent(),
        account_states=_states(),
        policies=_policies(),
        parent_equity="10000",
        account_equities={"account-demo-002": "20000"},
    )
    quantities = [row["sizing"]["quantity"] for row in preview["destinations"]]
    assert quantities == ["0.01", "0.02"]
    assert all(row["ticket"]["submittable"] for row in preview["destinations"])


def test_group_status_never_filled_on_mixed_results():
    mixed = group_status([{"outcome": "filled"}, {"outcome": "rejected"}])
    assert mixed["state"] == "partial_or_failed"
    assert group_status([{"outcome": "filled"}, {"outcome": "filled"}])["state"] == "filled"
    actions = divergence_actions(
        [
            {"destinationId": "d1", "outcome": "unknown"},
            {"destinationId": "d2", "outcome": "filled"},
        ]
    )
    assert actions[0]["nextAction"] == "reconcile_with_broker_before_any_retry"


def test_fan_out_independent_outcomes_and_restart_dedupe(service):
    service, origin = service
    calls = {"a": 0, "b": 0}

    def ok_a(_c, _i):
        calls["a"] += 1
        return {"nativeOrderId": "broker-a"}

    def reject_b(_c, _i):
        calls["b"] += 1
        raise DispatchRejected("margin unavailable")

    dispatchers = {
        "executiondestination-copya": ok_a,
        "executiondestination-copyb": reject_b,
    }
    kwargs = dict(
        dispatchers=dispatchers,
        account_states=_states(),
        policies=_policies(),
        parent_equity="10000",
        account_equities={"account-demo-002": "10000"},
    )
    first = fan_out(service, origin, _group(), intent(), **kwargs)
    outcomes = {row["destinationId"]: row["outcome"] for row in first["results"]}
    assert outcomes["executiondestination-copya"] == "acknowledged"
    assert outcomes["executiondestination-copyb"] == "rejected"
    assert first["summary"]["state"] == "working"
    # Restart/retry: child idempotency keys dedupe, zero new dispatches.
    second = fan_out(service, origin, _group(), intent(), **kwargs)
    assert all(row.get("duplicate") for row in second["results"])
    assert calls == {"a": 1, "b": 1}


def test_paused_group_and_missing_mapping_are_blocked(service):
    service, origin = service
    with pytest.raises(WorkspaceError) as error:
        fan_out(
            service,
            origin,
            _group(state="paused"),
            intent(),
            dispatchers={},
            account_states=_states(),
            policies=_policies(),
        )
    assert error.value.code == "copy.group_not_armed"
    broken = _group()
    del broken["destinations"][0]["rules"]
    with pytest.raises(WorkspaceError) as error:
        preview_group(broken, intent(), account_states=_states(), policies=_policies())
    assert error.value.code == "copy.destination_mapping_missing"
