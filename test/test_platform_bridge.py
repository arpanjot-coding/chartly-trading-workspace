"""P09: bridge pairing/version/heartbeat/queue, terminal states, binding."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from services.mt5_reads import (
    account_mode,
    demo_order_gate,
    normalize_symbol,
    read_orders,
    read_positions,
    reconcile_history,
)
from services.platform_bridge import BoundedQueue, BridgeError, PlatformBridge, negotiate


class Clock:
    def __init__(self):
        self.now = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)

    def __call__(self):
        return self.now.isoformat().replace("+00:00", "Z")

    def advance(self, seconds):
        self.now += timedelta(seconds=seconds)


IDENTITY = {
    "providerId": "mt5",
    "externalId": "100001",
    "server": "Fixture-Demo",
    "environment": "broker_demo",
    "currency": "GBP",
    "synthetic": False,
}


@pytest.fixture
def bridge():
    clock = Clock()
    return PlatformBridge(clock=clock), clock


def _session(bridge):
    code = bridge.create_pairing()["pairingCode"]
    return bridge.redeem_pairing(code, [1])["sessionToken"]


def test_pairing_is_one_time_and_versioned(bridge):
    bridge, clock = bridge
    pairing = bridge.create_pairing()
    token = bridge.redeem_pairing(pairing["pairingCode"], [0, 1])["sessionToken"]
    with pytest.raises(BridgeError) as error:
        bridge.redeem_pairing(pairing["pairingCode"], [1])
    assert error.value.code == "bridge.pairing_invalid"
    with pytest.raises(BridgeError) as error:
        negotiate([99])
    assert error.value.code == "bridge.version_incompatible"
    with pytest.raises(BridgeError) as error:
        bridge.authenticate(token, "demo-order")  # not in default scopes
    assert error.value.code == "bridge.scope_denied"
    expired = bridge.create_pairing()["pairingCode"]
    clock.advance(301)
    with pytest.raises(BridgeError) as error:
        bridge.redeem_pairing(expired, [1])
    assert error.value.code == "bridge.pairing_expired"


def test_terminal_states_and_binding_reverification(bridge):
    bridge, _clock = bridge
    token = _session(bridge)
    terminal = bridge.register_terminal("term-1", "mt5", "C:/Program Files/MetaTrader 5/terminal64.exe")
    assert terminal["state"] == "configured"
    with pytest.raises(BridgeError) as error:
        bridge.bind_account(token, "term-1")
    assert error.value.code == "bridge.terminal_not_authenticated"
    bridge.refresh_terminal("term-1", process_running=True)
    assert bridge.health(token)["terminals"][0]["state"] == "running"
    bridge.refresh_terminal("term-1", process_running=True, probe=lambda: dict(IDENTITY))
    assert bridge.bind_account(token, "term-1")["externalId"] == "100001"
    assert bridge.assert_binding(token, dict(IDENTITY))["server"] == "Fixture-Demo"
    changed = dict(IDENTITY, externalId="200002")
    with pytest.raises(BridgeError) as error:
        bridge.assert_binding(token, changed)
    assert error.value.code == "bridge.identity_changed_reverify"
    assert bridge.health(token)["boundTerminal"] is None  # binding dropped
    bridge.refresh_terminal("term-1", process_running=False)
    assert bridge.health(token)["terminals"][0]["state"] == "configured"


def test_heartbeat_staleness_and_bounded_queue(bridge):
    bridge, clock = bridge
    token = _session(bridge)
    assert bridge.health(token)["state"] == "no-heartbeat"
    bridge.heartbeat(token)
    assert bridge.health(token)["state"] == "healthy"
    clock.advance(31)
    assert bridge.health(token)["state"] == "stale"
    queue = BoundedQueue(maximum=2)
    queue.push({"a": 1})
    queue.push({"b": 2})
    with pytest.raises(BridgeError) as error:
        queue.push({"c": 3})
    assert error.value.code == "bridge.queue_full"
    assert queue.drain(1) == [{"a": 1}]


class FakeSDK:
    def __init__(self, environment_account=True):
        self.account = SimpleNamespace(
            login=100001,
            trade_mode=0,
            margin_mode=2,
            trade_allowed=True,
            trade_expert=True,
            currency="GBP",
        )
        self.terminal = SimpleNamespace(connected=True, trade_allowed=True)

    def account_info(self):
        return self.account

    def terminal_info(self):
        return self.terminal

    def symbol_info(self, symbol):
        return SimpleNamespace(trade_contract_size=100000.0)

    def positions_get(self):
        return [
            SimpleNamespace(
                ticket=555,
                symbol="EURUSD.pro",
                type=0,
                volume=0.10,
                price_open=1.1000,
                price_current=1.1050,
                sl=1.0950,
                tp=0.0,
                profit=50.0,
            )
        ]

    def orders_get(self):
        return []


def test_mt5_reads_mode_positions_and_symbol_candidates():
    sdk = FakeSDK()
    mode = account_mode(sdk)
    assert mode["marginModeName"] == "retail_hedging"
    positions = read_positions(sdk)
    assert positions[0]["volumeLots"] == "0.1"
    assert positions[0]["contractSize"] == "100000"
    assert positions[0]["stopLoss"] == "1.095"
    assert positions[0]["takeProfit"] is None
    symbol = positions[0]["symbol"]
    assert symbol["canonicalCandidate"] == "EURUSD"
    assert symbol["verified"] is False  # suffix stripped: candidate only
    exact = normalize_symbol("GBPUSD")
    assert exact["verified"] is True
    assert read_orders(sdk) == []


def test_demo_gate_and_history_reconciliation():
    sdk = FakeSDK()
    assert demo_order_gate(sdk, IDENTITY)["allowed"] is True
    live = dict(IDENTITY, environment="broker_live")
    gate = demo_order_gate(sdk, live)
    assert gate["allowed"] is False
    assert any("demo" in reason for reason in gate["reasons"])
    sdk.terminal.trade_allowed = False
    assert demo_order_gate(sdk, IDENTITY)["allowed"] is False

    events = [{"externalEventId": "term-1:deal:1"}, {"externalEventId": "term-1:deal:2"}]
    result = reconcile_history(events, ["term-1:deal:1"])
    assert [row["externalEventId"] for row in result["new"]] == ["term-1:deal:2"]
    assert result["duplicates"] == 1
    # Same native deal id on another terminal is a different event.
    other = reconcile_history([{"externalEventId": "term-2:deal:1"}], result["seen"])
    assert len(other["new"]) == 1
