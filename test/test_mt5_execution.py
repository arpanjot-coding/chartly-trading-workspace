import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace
from uuid import uuid4

import pytest
from flask import Flask, jsonify
from flask_wtf.csrf import generate_csrf
from mt5_profile_fixture import linked_profile
from sqlalchemy import insert

from blueprints.local_data import _engine
from blueprints.mt5_execution import mt5_execution_bp
from services import local_account_access, mt5_execution
from services.connector_mt5 import TERMINAL_PATH, MT5Adapter, _identity
from services.connectors import Connectors
from services.mt5_binding import profile_mt5_binding
from services.workspace_storage import WorkspaceError, WorkspaceStorage, dumps


class Terminal:
    SYMBOL_TRADE_EXECUTION_REQUEST = 0
    SYMBOL_TRADE_EXECUTION_INSTANT = 1
    SYMBOL_TRADE_EXECUTION_MARKET = 2
    ORDER_FILLING_FOK = 0
    ORDER_FILLING_IOC = 1
    TRADE_ACTION_DEAL = 1
    ORDER_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    DEAL_TYPE_BUY = 0
    DEAL_TYPE_SELL = 1
    ORDER_STATE_CANCELED = 2
    ORDER_STATE_FILLED = 4
    ORDER_STATE_REJECTED = 5
    ORDER_STATE_EXPIRED = 6

    def __init__(self):
        self.login = 324516
        self.mode = 0
        self.price = 1.12345
        self.check_code = 0
        self.trade_mode = 4
        self.quote_offset_ms = 0
        self.spread = 0.00002
        self.historical_orders = []
        self.historical_deals = []
        self.reply = SimpleNamespace(retcode=10009, order=551, deal=653)
        self.sends = []
        self.checks = []

    def initialize(self, _path, *, timeout):
        return timeout == 5000

    def shutdown(self):
        pass

    def terminal_info(self):
        return SimpleNamespace(
            connected=True,
            trade_allowed=True,
            tradeapi_disabled=False,
            path=TERMINAL_PATH.rsplit("/", 1)[0],
        )

    def account_info(self):
        return SimpleNamespace(
            login=self.login,
            trade_mode=self.mode,
            currency="USD",
            server="Fixture",
            trade_allowed=True,
            trade_expert=True,
        )

    def symbol_info(self, _symbol):
        return SimpleNamespace(
            digits=5,
            point=1e-5,
            volume_min=0.01,
            volume_max=20,
            volume_step=0.01,
            trade_exemode=2,
            trade_mode=self.trade_mode,
            filling_mode=3,
        )

    def symbol_info_tick(self, _symbol):
        return SimpleNamespace(
            ask=self.price,
            bid=self.price - self.spread,
            time_msc=time.time_ns() // 1_000_000 + self.quote_offset_ms,
        )

    def history_orders_get(self, *, ticket):
        return tuple(order for order in self.historical_orders if order.ticket == ticket)

    def history_deals_get(self, *, ticket):
        return tuple(deal for deal in self.historical_deals if deal.order == ticket)

    def order_check(self, request):
        self.checks.append(request.copy())
        return SimpleNamespace(retcode=self.check_code)

    def order_send(self, request):
        self.sends.append(request.copy())
        return self.reply


@pytest.fixture
def terminal():
    sdk = Terminal()
    return sdk, MT5Adapter(sdk=sdk, terminal_checker=lambda _path: True)


@pytest.fixture
def storage(tmp_path):
    return WorkspaceStorage(f"sqlite:///{(tmp_path / 'workspace.db').as_posix()}", "fixture-owner")


@pytest.mark.parametrize(
    ("code", "state"),
    [
        (10009, "filled"),
        (10010, "partially-filled"),
        (10008, "placed"),
        (10012, "unknown"),
        (None, "unknown"),
    ],
)
def test_order_is_checked_and_sent_once_even_after_ambiguous_outcome(
    terminal, storage, code, state
):
    sdk, adapter = terminal
    sdk.reply = SimpleNamespace(retcode=code, order=551) if code is not None else None
    review = mt5_execution.preview("EURUSD.pro", "buy", "0.02", adapter=adapter)
    assert sdk.sends == []
    result = mt5_execution.submit(storage, review, adapter=adapter)
    assert result["state"] == state
    sdk.login = 99999
    assert mt5_execution.submit(storage, review, adapter=adapter) == result
    assert len(sdk.sends) == 1
    assert len(sdk.checks) == 2
    assert sdk.sends[0]["symbol"] == "EURUSD.pro"
    assert sdk.sends[0]["volume"] == 0.02
    assert "price" not in sdk.sends[0]


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ("login", "mt5.account_changed"),
        ("price", "mt5.quote_moved"),
        ("expired", "mt5.preview_expired"),
        ("check", "mt5.order_check_rejected"),
        ("stale", "mt5.quote_age_unverified"),
        ("future", "mt5.quote_age_unverified"),
        ("wide", "mt5.quote_spread_unavailable"),
        ("crossed", "mt5.quote_spread_unavailable"),
        ("close-only", "mt5.symbol_direction_unavailable"),
    ],
)
def test_submit_rechecks_review_scope(terminal, storage, change, code):
    sdk, adapter = terminal
    review = mt5_execution.preview("#AAPL", "sell", "0.01", adapter=adapter)
    if change == "login":
        sdk.login += 1
    elif change == "price":
        sdk.price += 0.01
    elif change == "expired":
        review["expiresAt"] = 0
    elif change == "stale":
        sdk.quote_offset_ms = -10_800_000
    elif change == "future":
        sdk.quote_offset_ms = 10_800_000
    elif change == "wide":
        sdk.spread = 0.01
    elif change == "crossed":
        sdk.spread = -0.00002
    elif change == "close-only":
        sdk.trade_mode = 3
    else:
        sdk.check_code = 10019
    with pytest.raises(WorkspaceError, match=code):
        mt5_execution.submit(storage, review, adapter=adapter)
    assert sdk.sends == []


def test_real_account_and_off_grid_volume_are_refused(terminal):
    sdk, adapter = terminal
    with pytest.raises(WorkspaceError, match="mt5.volume_grid"):
        mt5_execution.preview("EURUSD", "buy", "0.011", adapter=adapter)
    sdk.mode = 2
    with pytest.raises(WorkspaceError, match="mt5.demo_trade_unavailable"):
        mt5_execution.preview("EURUSD", "buy", "0.01", adapter=adapter)
    assert sdk.checks == sdk.sends == []


def test_retry_during_native_send_reads_the_same_attempt(terminal, storage):
    sdk, adapter = terminal
    review = mt5_execution.preview("EURUSD", "buy", "0.01", adapter=adapter)
    entered, release = Event(), Event()
    send = sdk.order_send

    def blocked(request):
        entered.set()
        assert release.wait(5)
        return send(request)

    sdk.order_send = blocked
    with ThreadPoolExecutor(max_workers=1) as pool:
        original = pool.submit(mt5_execution.submit, storage, review, adapter=adapter)
        try:
            assert entered.wait(5)
            sdk.price += 0.01
            pending = mt5_execution.submit(storage, review, adapter=adapter)
            assert pending["state"] == "unknown"
            assert pending["id"] == review["id"]
        finally:
            release.set()
        assert original.result(timeout=5)["state"] == "filled"
    assert mt5_execution.submit(storage, review, adapter=adapter)["state"] == "filled"
    assert len(sdk.sends) == 1


@pytest.mark.parametrize(
    ("final_state", "volumes", "result"),
    [
        (4, [0.01, 0.01], "filled"),
        (2, [0.01], "partially-filled"),
        (2, [], "canceled"),
        (5, [], "rejected"),
    ],
)
def test_lost_reply_recovers_after_restart_only_with_exact_terminal_evidence(
    terminal, storage, final_state, volumes, result
):
    sdk, adapter = terminal
    origin, _ = linked_profile(storage, _identity(sdk))
    binding = profile_mt5_binding(storage, origin, 1)
    review = mt5_execution.preview("EURUSD", "buy", "0.02", binding=binding, adapter=adapter)
    competing = mt5_execution.preview("EURUSD", "sell", "0.02", binding=binding, adapter=adapter)
    sdk.reply = None
    attempt = mt5_execution.submit(storage, review, adapter=adapter)
    assert attempt["state"] == "unknown" and "_intent" not in attempt

    reopened = WorkspaceStorage(storage.engine, storage.uid)
    assert mt5_execution.read_receipt(reopened, review["id"]) == attempt
    with pytest.raises(WorkspaceError, match="mt5.pending_intent") as pending:
        mt5_execution.submit(reopened, competing, adapter=adapter)
    assert pending.value.issues == [{"requestId": review["id"]}]
    with pytest.raises(WorkspaceError, match="mt5.pending_intent"):
        mt5_execution.preview(
            "EURUSD", "sell", "0.02", binding=binding, storage=reopened, adapter=adapter
        )
    order_id = 2**53 + 23
    order = SimpleNamespace(
        ticket=order_id,
        comment="Other order",
        symbol="EURUSD",
        type=sdk.ORDER_TYPE_BUY,
        volume_initial=0.02,
        volume_current=round(0.02 - sum(volumes), 2),
        state=final_state,
    )
    sdk.historical_orders = [order]
    sdk.historical_deals = [
        SimpleNamespace(
            order=order_id,
            ticket=order_id + index + 1,
            symbol="EURUSD",
            type=sdk.DEAL_TYPE_BUY,
            volume=volume,
        )
        for index, volume in enumerate(volumes)
    ]
    with pytest.raises(WorkspaceError, match="mt5.receipt_evidence_unavailable"):
        mt5_execution.reconcile(reopened, review["id"], str(order_id), adapter=adapter)
    assert mt5_execution.read_receipt(reopened, review["id"]) == attempt
    order.comment = sdk.sends[0]["comment"]
    sdk.login += 1
    with pytest.raises(WorkspaceError, match="mt5.account_changed"):
        mt5_execution.reconcile(reopened, review["id"], str(order_id), adapter=adapter)
    sdk.login -= 1
    confirmed = mt5_execution.reconcile(reopened, review["id"], str(order_id), adapter=adapter)
    assert confirmed["state"] == result and confirmed["order"] == str(order_id)
    assert confirmed["dealTickets"] == [str(deal.ticket) for deal in sdk.historical_deals]
    assert mt5_execution.submit(reopened, review, adapter=adapter) == confirmed
    assert len(sdk.sends) == 1
    mt5_execution.preview(
        "EURUSD", "sell", "0.02", binding=binding, storage=reopened, adapter=adapter
    )


def test_expired_pre_dispatch_intent_cannot_send_after_recovery(terminal, storage):
    sdk, adapter = terminal
    review = mt5_execution.preview("EURUSD", "buy", "0.02", adapter=adapter)
    initial = {
        "id": review["id"],
        "state": "unknown",
        "symbol": "EURUSD",
        "side": "buy",
        "lots": "0.02",
        "_intent": {"accountHash": review["accountHash"], "binding": None, "expiresAt": 0},
    }
    with storage.transaction() as connection:
        connection.execute(
            insert(mt5_execution.pending_intents).values(
                uid=storage.uid, account_hash=review["accountHash"], request_id=review["id"]
            )
        )
        connection.execute(
            insert(mt5_execution.receipts).values(
                uid=storage.uid, id=review["id"], payload=dumps(initial)
            )
        )
    recovered = mt5_execution.reconcile(storage, review["id"], None, adapter=adapter)
    assert recovered["state"] == "rejected" and recovered["reason"] == "mt5.preview_expired"
    with pytest.raises(WorkspaceError, match="mt5.preview_expired"):
        mt5_execution._mark_dispatch(storage, initial)
    assert mt5_execution.submit(storage, review, adapter=adapter) == recovered
    assert not sdk.sends
    mt5_execution.preview("EURUSD", "buy", "0.02", storage=storage, adapter=adapter)


def test_loopback_csrf_owner_and_signed_review_bind_submission(monkeypatch, tmp_path, terminal):
    sdk, adapter = terminal
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY="fixture-secret",
        LOCAL_DATA_DATABASE_URL=f"sqlite:///{(tmp_path / 'api.db').as_posix()}",
    )
    app.register_blueprint(mt5_execution_bp)
    app.get("/csrf")(lambda: jsonify({"token": generate_csrf()}))
    principal = SimpleNamespace(uid="principal_" + "a" * 32, personal=True)
    monkeypatch.setattr(local_account_access, "current_local_principal", lambda: principal)
    monkeypatch.setattr(mt5_execution, "MT5Adapter", lambda: adapter)
    client = app.test_client()
    headers = {
        "Origin": "http://localhost",
        "X-Chartly-Principal": principal.uid,
        "X-CSRFToken": client.get("/csrf").json["token"],
    }
    base = "/api/local/v1/mt5-orders"
    order = {"symbol": "EURUSD", "side": "buy", "lots": "0.01"}
    assert (
        client.post(base + "/preview", json=order, headers=headers).json["error"]["code"]
        == "mt5.profile_binding_required"
    )
    with app.app_context():
        workspace = WorkspaceStorage(_engine(), principal.uid)
        origin, connector = linked_profile(workspace, _identity(sdk))
    order.update(originId=origin, profileId=1)
    assert (
        client.post(
            base + "/preview", json=order, headers={**headers, "Origin": "https://other.test"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            base + "/preview", json=order, headers={**headers, "X-CSRFToken": ""}
        ).status_code
        == 400
    )
    sdk.login += 1
    mismatched = client.post(base + "/preview", json=order, headers=headers)
    assert mismatched.json["error"]["code"] == "mt5.account_changed"
    assert sdk.checks == []
    sdk.login -= 1
    result = client.post(base + "/preview", json=order, headers=headers)
    assert result.status_code == 200
    token = result.json["token"]
    assert "accountHash" not in result.json["review"]
    assert result.json["sendAvailable"] is False
    assert "binding" not in result.json["review"]
    assert client.post(base + "/submit", json={"token": token}, headers=headers).status_code == 403
    monkeypatch.setenv("CHARTLY_MT5_DEMO_ORDERS", "true")
    assert (
        client.post(base + "/submit", json={"token": token + "!"}, headers=headers).status_code
        == 400
    )
    original = principal.uid
    principal.uid = "principal_" + "b" * 32
    assert (
        client.post(
            base + "/submit",
            json={"token": token},
            headers={**headers, "X-Chartly-Principal": principal.uid},
        ).status_code
        == 403
    )
    principal.uid = original
    assert sdk.sends == []
    assert (
        client.post(base + "/submit", json={"token": token}, headers=headers).json["receipt"][
            "state"
        ]
        == "filled"
    )
    assert client.post(base + "/submit", json={"token": token}, headers=headers).status_code == 200
    pending = client.post(base + "/preview", json=order, headers=headers).json["token"]
    Connectors(workspace).action(
        origin, connector["id"], connector["revision"], uuid4().hex, "disconnect", {}
    )
    refused = client.post(base + "/submit", json={"token": pending}, headers=headers)
    assert refused.status_code == 409
    assert refused.json["error"]["code"] == "mt5.profile_binding_required"
    receipt_url = base + "/receipts/" + result.json["review"]["id"]
    monkeypatch.delenv("CHARTLY_MT5_DEMO_ORDERS")
    recovered = client.get(receipt_url, headers=headers)
    assert recovered.status_code == 200
    assert recovered.json["receipt"]["state"] == "filled"
    assert recovered.headers["Cache-Control"] == "private, no-store"
    assert client.get(receipt_url, headers={**headers, "X-CSRFToken": ""}).status_code == 400
    principal.uid = "principal_" + "b" * 32
    assert (
        client.get(
            receipt_url, headers={**headers, "X-Chartly-Principal": principal.uid}
        ).status_code
        == 404
    )
    assert len(sdk.sends) == 1
