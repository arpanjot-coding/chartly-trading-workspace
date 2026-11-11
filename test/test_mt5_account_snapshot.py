"""MT5 Toolbox reads: broker symbol list + account snapshot (fixture SDK)."""

from pathlib import PureWindowsPath
from types import SimpleNamespace
from urllib.parse import urlencode
from uuid import uuid4

import pytest
from mt5_profile_fixture import linked_profile
from test_local_data_api import csrf, login
from test_personal_workspace import open_personal

from blueprints.data_library import data_library_bp
from blueprints.local_data import _engine
from blueprints.market_data import market_data_bp
from services import connector_adapters, market_feeds
from services.connector_adapters import AdapterError
from services.connector_mt5 import (
    MAX_SNAPSHOT_HISTORY_ROWS,
    TERMINAL_PATH,
    MT5Adapter,
    normalize_mt5_configuration,
)
from services.connectors import Connectors
from services.market_feeds import get_account_snapshot, list_symbols
from services.workspace_storage import WorkspaceError, WorkspaceStorage, now

NOW = "2026-11-05T09:00:00Z"
ACCOUNT_PATH = "/api/local/v1/market/account?provider=mt5"
pytest_plugins = ["test_local_data_api"]


class SDK:
    def __init__(self):
        self.account = SimpleNamespace(
            login=115006836,
            server="MetaQuotes-Demo",
            trade_mode=0,
            currency="GBP",
            balance=100000.00,
            credit=0.0,
            profit=-12.50,
            equity=99987.50,
            margin=112.43,
            margin_free=99875.07,
            margin_level=88930.5,
            leverage=500,
            name="PRIVATE NAME",
        )
        self.symbols = [
            SimpleNamespace(name="EURUSD", description="Euro vs US Dollar", digits=5),
            SimpleNamespace(name="GBPUSDm", description="Pound vs US Dollar", digits=5),
            SimpleNamespace(name="GBPUSD.pro", description="Pound vs US Dollar Pro", digits=5),
            SimpleNamespace(name="XAUUSD", description="Gold vs US Dollar", digits=2),
            SimpleNamespace(name="#AAPL", description="Apple Inc", digits=2),
        ]
        self.positions = [
            SimpleNamespace(
                ticket=501,
                symbol="GBPUSDm",
                type=0,
                volume=0.10,
                price_open=1.27000,
                price_current=1.27125,
                sl=0.0,
                tp=0.0,
                profit=-12.50,
            )
        ]
        self.orders = [
            SimpleNamespace(
                ticket=601,
                symbol="EURUSD",
                type=2,
                volume_initial=0.05,
                volume_current=0.05,
                price_open=1.11000,
                sl=0.0,
                tp=0.0,
            )
        ]
        self.deals = [
            SimpleNamespace(
                ticket=701,
                order=700,
                position_id=501,
                entry=0,
                reason=0,
                type=0,
                time_msc=1793870000000,
                volume=0.10,
                price=1.27000,
                commission=0.0,
                swap=0.0,
                profit=0.0,
                fee=0.0,
                symbol="GBPUSDm",
            ),
            SimpleNamespace(
                ticket=702,
                order=703,
                position_id=499,
                entry=1,
                reason=0,
                type=1,
                time_msc=1793860000000,
                volume=0.10,
                price=1.26900,
                commission=-0.35,
                swap=0.0,
                profit=8.20,
                fee=0.0,
                symbol="GBPUSDm",
            ),
        ]
        self.historical_orders = [
            SimpleNamespace(
                ticket=2**53 + 11,
                symbol="GBPUSDm",
                type=2,
                state=2,
                time_setup_msc=1793865000000,
                time_done_msc=1793870000000,
                volume_initial=0.1,
                volume_current=0.05,
                price_open=1.27,
                position_id=2**53 + 17,
                position_by_id=0,
            )
        ]

    def initialize(self, path, **_kwargs):
        return True

    def shutdown(self):
        pass

    def terminal_info(self):
        return SimpleNamespace(connected=True, path="C:/Program Files/MetaTrader 5")

    def account_info(self):
        return self.account

    def symbols_get(self):
        return self.symbols

    def positions_get(self):
        return self.positions

    def orders_get(self):
        return self.orders

    def symbol_info(self, _symbol):
        return SimpleNamespace(trade_contract_size=100000.0, digits=5)

    def history_deals_total(self, *_args):
        return len(self.deals)

    def history_deals_get(self, *_args):
        return self.deals

    def history_orders_total(self, *_args):
        return len(self.historical_orders)

    def history_orders_get(self, *_args):
        return self.historical_orders


def adapter():
    return MT5Adapter(sdk=SDK(), terminal_checker=lambda _path: True, clock=lambda: NOW)


def test_market_symbols_normalized_search_keeps_native_spelling():
    rows = adapter().market_symbols("GBP USD")
    assert [row["symbol"] for row in rows] == ["GBPUSDm", "GBPUSD.pro"]
    rows = adapter().market_symbols("gbpusd")
    assert rows[0]["symbol"] == "GBPUSDm"
    rows = adapter().market_symbols("gold")
    assert [row["symbol"] for row in rows] == ["XAUUSD"]
    assert adapter().market_symbols("nope") == []


def test_market_symbols_via_feed_service():
    out = list_symbols("mt5", "GBPUSD", 10, mt5_adapter_factory=lambda: adapter())
    assert out[0] == {
        "symbol": "GBPUSDm",
        "exchange": "MT5",
        "name": "Pound vs US Dollar",
        "digits": 5,
    }
    with pytest.raises(WorkspaceError) as exc:
        list_symbols("dukascopy", "EUR", 10)
    assert exc.value.code == "market.symbols_unsupported"


def test_account_snapshot_toolbox_shape():
    snap = adapter().account_snapshot(7, 50)
    assert snap["identity"]["externalId"] == "115006836"
    assert snap["identity"]["environment"] == "broker_demo"
    assert snap["account"]["balance"] == "100000.0"
    assert snap["account"]["equity"] == "99987.5"
    assert snap["account"]["marginFree"] == "99875.07"
    assert snap["account"]["leverage"] == 500
    assert snap["account"]["currency"] == "GBP"
    # owner name never leaves the terminal read
    assert "PRIVATE NAME" not in str(snap)
    assert snap["positions"][0]["ticket"] == "501"
    assert snap["positions"][0]["side"] == "buy"
    assert snap["positions"][0]["symbol"]["native"] == "GBPUSDm"
    assert snap["orders"][0]["ticket"] == "601"
    # history newest first
    assert [row["ticket"] for row in snap["history"]] == ["701", "702"]
    assert snap["history"][1]["profit"] == "8.2"
    assert snap["history"][1]["order"] == "703"
    assert snap["history"][1]["position_id"] == "499"
    assert snap["historicalOrders"][0]["ticket"] == str(2**53 + 11)
    assert snap["historicalOrders"][0]["position_id"] == str(2**53 + 17)
    assert snap["historicalOrders"][0]["state"] == 2
    assert snap["historyCoverage"]["utcAlignmentVerified"] is False
    assert snap["timeBasis"] == "provider-epoch-unverified"


def test_account_snapshot_via_feed_service_and_validation():
    snap = get_account_snapshot("mt5", mt5_adapter_factory=lambda: adapter())
    assert snap["providerId"] == "mt5"
    with pytest.raises(WorkspaceError) as exc:
        get_account_snapshot("mt5", mt5_adapter_factory=lambda: adapter(), history_days=0)
    assert exc.value.code == "market.invalid_window"
    with pytest.raises(WorkspaceError) as exc:
        get_account_snapshot("binance")
    assert exc.value.code == "market.account_unsupported"


def test_positions_and_orders_survive_a_dense_history_window():
    sdk = SDK()
    history_calls = []

    def history_total(*_args):
        history_calls.append(True)
        return MAX_SNAPSHOT_HISTORY_ROWS + 1

    sdk.history_deals_total = history_total
    feed = MT5Adapter(sdk=sdk, terminal_checker=lambda _path: True, clock=lambda: NOW)
    current = feed.account_snapshot(include_history=False)
    assert not history_calls
    assert not current["historyLoaded"]
    assert current["historyCoverage"] is None
    assert not current["bookErrors"]
    assert current["positions"][0]["symbol"]["native"] == "GBPUSDm"
    history = feed.account_snapshot()
    assert len(history_calls) == 1
    assert history["positions"] == current["positions"]
    assert history["orders"] == current["orders"]
    assert history["bookErrors"] == {"history": "connector.history_window_too_dense"}
    assert history["historyCoverage"]["deals"]["observedCount"] == MAX_SNAPSHOT_HISTORY_ROWS + 1
    assert history["historyCoverage"]["deals"]["status"] == "unavailable"
    assert history["historyCoverage"]["orders"]["status"] == "read"


def test_small_display_limit_does_not_prevent_a_bounded_history_read():
    sdk = SDK()
    sdk.deals = [
        SimpleNamespace(
            **{**vars(sdk.deals[0]), "ticket": 2**53 + index, "time_msc": 1793870000000 + index}
        )
        for index in range(201)
    ]
    feed = MT5Adapter(sdk=sdk, terminal_checker=lambda _path: True, clock=lambda: NOW)
    history = feed.account_snapshot(history_limit=1)
    assert history["historyLoaded"] is True
    assert [row["ticket"] for row in history["history"]] == [str(2**53 + 200)]
    assert history["historyCoverage"]["deals"] == {
        "queryFrom": "2026-10-29T09:00:00Z",
        "queryTo": "2026-11-07T09:00:00Z",
        "status": "limited",
        "observedCount": 201,
        "returnedCount": 1,
    }


def test_history_book_count_changes_fail_independently_from_cash_and_fills():
    sdk = SDK()
    sdk.history_orders_total = lambda *_: 2
    sdk.deals[0].order = 2**53 + 31
    sdk.deals[0].position_id = 2**53 + 33
    sdk.deals[0].entry = 1
    sdk.deals[0].volume = 0.05
    sdk.deals[0].commission = -0.35
    sdk.deals[0].swap = -0.15
    sdk.deals[0].fee = -0.03
    sdk.deals[1].type = 2
    sdk.deals[1].symbol = ""
    sdk.deals[1].order = 0
    sdk.deals[1].position_id = 0
    sdk.deals[1].profit = 500.0
    feed = MT5Adapter(sdk=sdk, terminal_checker=lambda _path: True, clock=lambda: NOW)
    snapshot = feed.account_snapshot()
    assert snapshot["historicalOrders"] == []
    assert snapshot["bookErrors"] == {"historicalOrders": "connector.history_changed_during_read"}
    fill, cash = snapshot["history"]
    assert fill["order"] == str(2**53 + 31) and fill["position_id"] == str(2**53 + 33)
    assert [fill[field] for field in ("volume", "commission", "swap", "fee")] == [
        "0.05",
        "-0.35",
        "-0.15",
        "-0.03",
    ]
    assert (
        cash["type"] == 2
        and cash["symbol"] == ""
        and cash["order"] == "0"
        and cash["profit"] == "500.0"
    )


def test_snapshot_discards_orders_and_deals_if_account_changes_during_history():
    sdk = SDK()

    def read_history(*_):
        sdk.account.login += 1
        return sdk.historical_orders

    sdk.history_orders_get = read_history
    feed = MT5Adapter(sdk=sdk, terminal_checker=lambda _path: True, clock=lambda: NOW)
    with pytest.raises(AdapterError, match="account_identity_mismatch"):
        feed.account_snapshot()


def test_snapshot_discards_rows_if_terminal_changes_accounts_mid_read():
    sdk = SDK()

    def changed_account():
        sdk.account.login += 1
        return sdk.positions

    sdk.positions_get = changed_account
    feed = MT5Adapter(sdk=sdk, terminal_checker=lambda _path: True, clock=lambda: NOW)
    with pytest.raises(WorkspaceError) as error:
        get_account_snapshot("mt5", mt5_adapter_factory=lambda: feed, include_history=False)
    assert error.value.code == "market.account_changed"
    assert error.value.status == 409


@pytest.fixture
def market_account_api(api, monkeypatch):
    api.register_blueprint(market_data_bp)
    api.register_blueprint(data_library_bp)
    monkeypatch.setattr(market_feeds, "_default_mt5_adapter", adapter)
    return api


def bind_fixture(app, principal):
    identity = adapter().account_snapshot(include_history=False)["identity"]
    with app.app_context():
        origin, _record = linked_profile(WorkspaceStorage(_engine(), principal), identity)
    return ACCOUNT_PATH + "&" + urlencode({"originId": origin, "profileId": 1})


def test_mt5_books_require_local_operator_and_preserve_principal_proof(market_account_api):
    client = market_account_api.test_client()
    assert client.get(ACCOUNT_PATH).status_code == 401

    login(client, "other")
    refused = client.get(ACCOUNT_PATH)
    assert refused.status_code == 403
    assert refused.json["error"]["code"] == "connector.operator_required"

    login(client)
    for options in (
        {"environ_overrides": {"REMOTE_ADDR": "192.0.2.1"}},
        {"headers": {"X-Forwarded-For": "127.0.0.1"}},
        {"headers": {"Origin": "http://other.example"}},
    ):
        denied = client.get(ACCOUNT_PATH, **options)
        assert denied.status_code == 403
        assert denied.json["error"]["code"] == "market.terminal_local_only"

    assert client.get(ACCOUNT_PATH).json["error"]["code"] == "mt5.profile_binding_required"
    principal = client.get("/api/local/v1/context").json["principalId"]
    path = bind_fixture(market_account_api, principal)
    result = client.get(path + "&includeHistory=0")
    assert result.status_code == 200
    assert result.headers["Cache-Control"] == "private, no-store"
    assert result.json["account"]["positions"][0]["symbol"]["native"] == "GBPUSDm"
    assert result.json["account"]["historyLoaded"] is False
    assert client.get(ACCOUNT_PATH + "&includeHistory=maybe").status_code == 400
    assert client.get(path + "&historyDays=--1").status_code == 400
    mismatched = client.get(ACCOUNT_PATH, headers={"X-Chartly-Principal": "principal_" + "0" * 32})
    assert mismatched.json["error"]["code"] == "account.scope_changed"


def test_personal_pc_workspace_can_read_terminal_books(market_account_api, monkeypatch):
    monkeypatch.setenv("CHARTLY_NO_LOGIN", "true")
    client = market_account_api.test_client()
    principal = open_personal(client).json["principal"]
    path = bind_fixture(market_account_api, principal["uid"])
    result = client.get(path, headers={"X-Chartly-Principal": principal["uid"]})
    assert result.status_code == 200
    assert result.json["account"]["orders"][0]["ticket"] == "601"
    assert result.json["account"]["historicalOrders"][0]["ticket"] == str(2**53 + 11)
    assert result.json["account"]["historicalOrders"][0]["position_id"] == str(2**53 + 17)
    assert result.json["account"]["historyLoaded"] is True


def test_profile_snapshot_refuses_another_terminal_account_before_reading_books(
    market_account_api, monkeypatch
):
    client = market_account_api.test_client()
    login(client)
    principal = client.get("/api/local/v1/context").json["principalId"]
    path = bind_fixture(market_account_api, principal)
    sdk = SDK()
    sdk.account.login += 1
    sdk.positions_get = lambda: pytest.fail("Wrong account's positions must not be read")
    monkeypatch.setattr(
        market_feeds,
        "_default_mt5_adapter",
        lambda: MT5Adapter(sdk=sdk, terminal_checker=lambda _: True),
    )
    response = client.get(path)
    assert response.status_code == 409
    assert response.json["error"]["code"] == "market.account_changed"


def test_profile_market_catalog_uses_and_rechecks_the_verified_account(
    market_account_api, monkeypatch
):
    client = market_account_api.test_client()
    login(client)
    principal = client.get("/api/local/v1/context").json["principalId"]
    scope = bind_fixture(market_account_api, principal).split("&", 1)[1]
    path = f"/api/local/v1/market/symbols?provider=mt5&{scope}"
    result = client.get(path)
    assert result.status_code == 200
    assert result.json["symbols"][0]["exchange"] == "MT5"
    assert len(result.json["connectionKey"]) == 64
    assert client.get(path).json["connectionKey"] == result.json["connectionKey"]
    sdk = SDK()

    def changed_account():
        sdk.account.login += 1
        return sdk.symbols

    sdk.symbols_get = changed_account
    monkeypatch.setattr(
        market_feeds,
        "_default_mt5_adapter",
        lambda: MT5Adapter(sdk=sdk, terminal_checker=lambda _: True),
    )
    refused = client.get(path)
    assert refused.status_code == 409
    assert refused.json["error"]["code"] == "market.account_changed"
    assert "symbols" not in refused.json


def test_two_live_profiles_use_separate_mt5_installations(market_account_api, monkeypatch):
    secondary = "C:/Program Files/Broker B/terminal64.exe"
    monkeypatch.setenv("CHARTLY_MT5_TERMINAL_PATHS", secondary)
    client = market_account_api.test_client()
    login(client)
    principal = client.get("/api/local/v1/context").json["principalId"]
    first = adapter().account_snapshot(include_history=False)["identity"]
    second = {**first, "server": "Second-Fixture-Demo", "externalId": "200002"}
    with market_account_api.app_context():
        storage = WorkspaceStorage(_engine(), principal)
        origin, _ = linked_profile(storage, first)
        workspace = storage.workspace(origin)
        tables = workspace["tables"]
        tables["portfolios"].append({**tables["portfolios"][0], "id": 2, "name": "Second desk"})
        storage.save_tables(origin, tables, workspace["revision"], uuid4().hex)
        provider = {**connector_adapters.describe_provider("mt5"), "available": True}
        registry = Connectors(
            storage,
            adapters=SimpleNamespace(
                describe_provider=lambda _: provider,
                normalize_configuration=lambda _, value: normalize_mt5_configuration(value),
                probe=lambda *_: {
                    "identity": second,
                    "adapterVersion": provider["version"],
                    "observedAt": now(),
                    "permissions": ["accountRead"],
                },
            ),
        )
        record = registry.action(
            origin,
            None,
            0,
            uuid4().hex,
            "create",
            {
                "providerId": "mt5",
                "label": "Second terminal",
                "configuration": {"terminalPath": secondary},
            },
        )["connection"]
        record = registry.action(
            origin, record["id"], record["revision"], uuid4().hex, "probe", {}
        )["connection"]

        def link(profile_id):
            return registry.action(
                origin,
                record["id"],
                record["revision"],
                uuid4().hex,
                "link",
                {"profileId": profile_id, "createObservedAccount": True, "confirmIdentity": True},
            )

        with pytest.raises(WorkspaceError, match="mt5.profile_binding_ambiguous"):
            link(1)
        link(2)

    class SelectedTerminal(SDK):
        def initialize(self, path, **_):
            self.installation = PureWindowsPath(path).parent
            if self.installation == PureWindowsPath(secondary).parent:
                self.account.login = int(second["externalId"])
                self.account.server = second["server"]
                self.symbols = [SimpleNamespace(name="EURUSD.pro")]
            else:
                assert self.installation == PureWindowsPath(TERMINAL_PATH).parent
            return True

        def terminal_info(self):
            return SimpleNamespace(connected=True, path=str(self.installation))

    monkeypatch.setattr(
        market_feeds,
        "_default_mt5_adapter",
        lambda: MT5Adapter(sdk=SelectedTerminal(), terminal_checker=lambda _: True),
    )
    base = f"/api/local/v1/market/symbols?provider=mt5&originId={origin}&q=EURUSD"
    first_catalog = client.get(base + "&profileId=1").json
    second_catalog = client.get(base + "&profileId=2").json
    assert [row["symbol"] for row in first_catalog["symbols"]] == ["EURUSD"]
    assert [row["symbol"] for row in second_catalog["symbols"]] == ["EURUSD.pro"]
    assert first_catalog["connectionKey"] != second_catalog["connectionKey"]


def test_profile_snapshot_discards_books_if_connection_is_disconnected_during_read(
    market_account_api, monkeypatch
):
    client = market_account_api.test_client()
    login(client)
    principal = client.get("/api/local/v1/context").json["principalId"]
    with market_account_api.app_context():
        storage = WorkspaceStorage(_engine(), principal)
        identity = adapter().account_snapshot(include_history=False)["identity"]
        origin, record = linked_profile(storage, identity)
    sdk = SDK()

    def read_positions():
        Connectors(storage).action(
            origin, record["id"], record["revision"], uuid4().hex, "disconnect", {}
        )
        return sdk.positions

    sdk.positions_get = read_positions
    monkeypatch.setattr(
        market_feeds,
        "_default_mt5_adapter",
        lambda: MT5Adapter(sdk=sdk, terminal_checker=lambda _: True),
    )
    response = client.get(ACCOUNT_PATH + "&" + urlencode({"originId": origin, "profileId": 1}))
    assert response.status_code == 409
    assert response.json["error"]["code"] == "mt5.profile_binding_required"
    assert "account" not in response.json


def test_native_market_reads_and_import_require_same_pc_but_public_symbols_do_not(
    market_account_api, monkeypatch
):
    import blueprints.data_library as data_blueprint
    import blueprints.market_data as market_blueprint

    client = market_account_api.test_client()
    login(client)
    options = {"environ_overrides": {"REMOTE_ADDR": "192.0.2.1"}}
    monkeypatch.setattr(
        market_feeds, "_default_mt5_adapter", lambda: pytest.fail("Native reader must stay local")
    )
    for route in ("symbols", "quote", "candles"):
        response = client.get(f"/api/local/v1/market/{route}?provider=MT5", **options)
        assert response.status_code == 403
        assert response.json["error"]["code"] == "market.terminal_local_only"
    monkeypatch.setattr(
        data_blueprint, "_run", lambda *_: pytest.fail("Native import must stay local")
    )
    response = client.post(
        "/api/local/v1/datasets/sources/feed/preview",
        json={"expectedRevision": 0, "provider": "mt5", "symbol": "EURUSD", "interval": "1h"},
        headers=csrf(client),
        **options,
    )
    assert response.status_code == 403
    assert response.json["error"]["code"] == "market.terminal_local_only"
    monkeypatch.setattr(market_blueprint, "list_symbols", lambda *_: [{"symbol": "BTCUSD"}])
    response = client.get("/api/local/v1/market/symbols?provider=kraken", **options)
    assert response.status_code == 200
    assert response.json["count"] == 1


def test_snapshot_refuses_bad_limits_at_adapter():
    with pytest.raises(AdapterError):
        adapter().market_symbols("EUR", 0)
    with pytest.raises(AdapterError):
        adapter().account_snapshot(0, 10)
