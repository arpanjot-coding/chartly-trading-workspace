"""Selected-terminal IPC ownership, clock honesty and read-only resource paths."""

import gc
import json
import tracemalloc
from copy import deepcopy
from datetime import timedelta
from pathlib import PureWindowsPath
from types import SimpleNamespace

import pytest

from services import connector_mt5
from services.connector_adapters import AdapterError, instant

NOW = "2026-11-03T12:00:00Z"
WINDOW = {"from": "2026-11-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"}


class SDK:
    __version__ = "fixture-v1"
    ACCOUNT_TRADE_MODE_DEMO = 0
    ACCOUNT_TRADE_MODE_REAL = 2
    TIMEFRAME_M1 = 1

    def __init__(self):
        self.opened = self.closed = self.gets = 0
        self.initialized = True
        self.connected = True
        self.total = 1
        self.changed = False
        self.identity_reads = 0
        self.fail_symbol = False
        self.historical_orders = []
        self.account = SimpleNamespace(
            login=100001,
            server="Fixture-Demo",
            trade_mode=0,
            currency="GBP",
            name="PRIVATE NAME",
            balance=12345.67,
        )
        self.deals = [
            SimpleNamespace(
                ticket=1001,
                order=1002,
                position_id=1003,
                entry=0,
                reason=0,
                type=2,
                time_msc=1793707200000,
                volume=0.0,
                price=0.0,
                commission=0.0,
                swap=0.0,
                profit=10000.0,
                fee=0.0,
                symbol="",
                comment="PRIVATE-TOKEN",
            )
        ]

    def initialize(self, path, **kwargs):
        assert path == str(PureWindowsPath(connector_mt5.TERMINAL_PATH)) and kwargs == {
            "timeout": 5000
        }
        self.opened += 1
        return self.initialized

    def shutdown(self):
        self.closed += 1

    def terminal_info(self):
        return SimpleNamespace(connected=self.connected, path="C:/Program Files/MetaTrader 5")

    def account_info(self):
        self.identity_reads += 1
        result = deepcopy(self.account)
        if self.changed and self.identity_reads > 1:
            result.login += 1
        return result

    def history_deals_total(self, *_):
        return self.total

    def history_deals_get(self, *_):
        self.gets += 1
        return self.deals

    def history_orders_total(self, *_):
        return len(self.historical_orders)

    def history_orders_get(self, *_):
        return self.historical_orders

    def symbol_info(self, symbol):
        assert symbol == "EURUSD"
        if self.fail_symbol:
            raise RuntimeError("PRIVATE-TOKEN")
        return SimpleNamespace(
            point=0.00001,
            trade_contract_size=100000.0,
            volume_min=0.01,
            volume_max=500.0,
            volume_step=0.01,
            digits=5,
            currency_profit="USD",
        )

    def symbol_info_tick(self, symbol):
        assert symbol == "EURUSD"
        return SimpleNamespace(
            time_msc=int((instant(NOW).timestamp() + 7200) * 1000), bid=1.1, ask=1.10002
        )

    def copy_rates_from_pos(self, symbol, interval, start, count):
        assert (symbol, interval, start, count) == ("EURUSD", 1, 1, 5)
        return [{"time": 1793714100 + index * 60} for index in range(5)]

    def version(self):
        return (500, 6000, "fixture")

    def login(self, *_args, **_kwargs):
        raise AssertionError("Login must not be called")

    order_send = login
    order_check = login
    symbol_select = login


def adapter(sdk=None, checker=None):
    return connector_mt5.MT5Adapter(
        sdk=sdk or SDK(), terminal_checker=checker or (lambda _path: True), clock=lambda: NOW
    )


@pytest.mark.parametrize(
    ("interval", "native_time", "observed"),
    [
        (3600, "2026-11-03T08:00:00Z", "2026-11-03T12:00:00Z"),
        (3600, "2026-11-06T22:00:00Z", "2026-11-08T12:00:00Z"),
        (900, "2026-11-03T09:30:00Z", "2026-11-03T12:00:00Z"),
        (3600, "2026-03-29T01:00:00Z", "2026-10-25T12:00:00Z"),
        (14400, "2026-10-25T02:00:00Z", "2026-11-03T12:00:00Z"),
        (86400, "2026-10-25T21:00:00Z", "2026-11-03T12:00:00Z"),
    ],
)
def test_native_candles_preserve_time_without_a_tick_based_clock_estimate(
    interval, native_time, observed
):
    class StockSDK(SDK):
        def symbol_info(self, symbol):
            assert symbol == "#AAPL.pro"
            return SimpleNamespace(digits=2)

        def symbol_info_tick(self, symbol):
            raise AssertionError("Tick age cannot establish a candle timezone")

        def copy_rates_from_pos(self, symbol, interval, start, count):
            assert (symbol, start, count) == ("#AAPL.pro", 0, 2)
            return [
                {
                    "time": int(instant(native_time).timestamp()),
                    "open": 100.0,
                    "high": 104.0,
                    "low": 99.0,
                    "close": 102.0,
                    "tick_volume": 38,
                }
            ]

    sdk = StockSDK()
    client = connector_mt5.MT5Adapter(
        sdk=sdk, terminal_checker=lambda _path: True, clock=lambda: observed
    )
    rows = client.market_candles("#AAPL.pro", interval, 2)
    assert rows[0]["symbol"] == "#AAPL.pro"
    assert rows[0]["rawProviderOpenTimeMs"] == int(instant(native_time).timestamp()) * 1000
    assert "observedSkewSeconds" not in rows[0]
    assert rows[0]["receivedAt"] == observed
    assert rows[0]["clockPolicy"] == "native-read-only"
    assert rows[0]["utcAlignmentVerified"] is False
    assert sdk.opened == sdk.closed == 1


def test_three_hour_stale_tick_does_not_shift_a_valid_utc_candle():
    class StaleSDK(SDK):
        def symbol_info_tick(self, symbol):
            return SimpleNamespace(time_msc=int((instant(NOW).timestamp() - 10800) * 1000))

        def copy_rates_from_pos(self, symbol, interval, start, count):
            return [
                {
                    "time": int(instant(NOW).timestamp()) - 3600,
                    "open": 1.1,
                    "high": 1.2,
                    "low": 1.0,
                    "close": 1.15,
                    "tick_volume": 5,
                }
            ]

    sdk = StaleSDK()
    rows = adapter(sdk).market_candles("EURUSD", 3600, 2)
    assert rows[0]["rawProviderOpenTimeMs"] == (int(instant(NOW).timestamp()) - 3600) * 1000
    assert rows[0]["timeBasis"] == "provider-epoch-unverified"
    assert "observedSkewSeconds" not in rows[0]
    assert sdk.opened == sdk.closed == 1


def identity():
    return {
        "providerId": "mt5",
        "externalId": "100001",
        "server": "Fixture-Demo",
        "environment": "broker_demo",
        "currency": "GBP",
        "synthetic": False,
    }


def test_selected_existing_terminal_defaults_are_explicit_and_no_secret_is_needed():
    assert connector_mt5.normalize_mt5_configuration({}) == {
        "terminalPath": connector_mt5.TERMINAL_PATH,
        "symbol": "EURUSD",
    }
    sdk = SDK()
    result = adapter(sdk).probe({})
    assert sdk.opened == sdk.closed == 1
    assert result["identity"] == identity()
    assert set(result["permissions"]) == {"accountRead", "accountHistory"}
    assert result["details"]["rawHistory"]["canonicalConversion"] is False
    text = json.dumps(result)
    assert "PRIVATE" not in text and "12345.67" not in text


def test_separate_approved_installations_read_their_own_account(monkeypatch):
    primary = connector_mt5.TERMINAL_PATH
    secondary = "C:/Program Files/Broker B/terminal64.exe"
    monkeypatch.setenv("CHARTLY_MT5_TERMINAL_PATHS", secondary)
    assert (
        connector_mt5.normalize_mt5_configuration(
            {"terminalPath": str(PureWindowsPath(secondary)).lower()}
        )["terminalPath"]
        == secondary
    )

    class TwoTerminals(SDK):
        def initialize(self, path, **kwargs):
            assert self.opened == self.closed and kwargs == {"timeout": 5000}
            self.opened += 1
            self.installation = PureWindowsPath(path).parent
            alternate = self.installation == PureWindowsPath(secondary).parent
            self.account.login = 200002 if alternate else 100001
            self.account.server = "Alternate-Demo" if alternate else "Fixture-Demo"
            return True

        def terminal_info(self):
            return SimpleNamespace(connected=True, path=str(self.installation))

        def symbol_info_tick(self, symbol):
            tick = super().symbol_info_tick(symbol)
            if self.account.login == 200002:
                tick.bid, tick.ask = 1.11, 1.11003
            return tick

    sdk = TwoTerminals()
    client = adapter(sdk)
    account_a = {"configuration": {"terminalPath": primary}, "identity": identity()}
    account_b = {
        "configuration": {"terminalPath": secondary},
        "identity": {**identity(), "externalId": "200002", "server": "Alternate-Demo"},
    }
    assert client.market_quote("EURUSD", account_a)["bid"] == "1.10000"
    assert client.market_quote("EURUSD", account_b)["bid"] == "1.11000"
    assert client.market_quote("EURUSD", account_a)["bid"] == "1.10000"
    with pytest.raises(AdapterError, match="account_identity_mismatch"):
        client.market_quote("EURUSD", {**account_b, "identity": account_a["identity"]})
    sdk.terminal_info = lambda: SimpleNamespace(
        connected=True, path=str(PureWindowsPath(primary).parent)
    )
    with pytest.raises(AdapterError, match="terminal_identity_mismatch"):
        client.market_quote("EURUSD", account_b)
    assert sdk.opened == sdk.closed == 5


@pytest.mark.parametrize(
    "config",
    [
        {"terminalPath": "C:/Other/terminal64.exe"},
        {"terminalPath": "//server/shared/terminal64.exe"},
        {"terminalPath": "terminal64.exe"},
        {"terminalPath": "C:/Program Files/MetaTrader 5/../Other/terminal64.exe"},
        {"login": "100001"},
        {"password": "PRIVATE"},
        {"url": "http://localhost"},
        {"symbol": "https://host"},
        {"symbol": "A" * 81},
        None,
        [],
    ],
)
def test_unreviewed_terminal_and_secret_paths_are_refused(config):
    sdk = SDK()
    with pytest.raises(AdapterError):
        adapter(sdk).probe(config)
    assert sdk.opened == 0


def test_stopped_terminal_does_not_initialize_or_autolaunch():
    sdk = SDK()
    with pytest.raises(AdapterError, match="selected_terminal_not_running"):
        adapter(sdk, lambda _path: False).probe({})
    assert sdk.opened == sdk.closed == 0


def test_terminal_stopping_before_attach_is_rechecked_without_initialization():
    sdk, checks = SDK(), iter([True, False])
    with pytest.raises(AdapterError, match="selected_terminal_not_running"):
        adapter(sdk, lambda _path: next(checks)).probe({})
    assert sdk.opened == 0 and sdk.closed == 1


def test_plaintext_secret_never_becomes_sdk_login_parameters():
    sdk = SDK()
    with pytest.raises(AdapterError, match="existing_session"):
        adapter(sdk).probe({}, "PRIVATE-TOKEN")
    assert sdk.opened == sdk.closed == 0


@pytest.mark.parametrize("failure", ["initialize", "offline", "symbol", "identity"])
def test_failure_paths_always_release_ipc_and_never_leak_native_error_text(failure):
    sdk = SDK()
    if failure == "initialize":
        sdk.initialized = False
    elif failure == "offline":
        sdk.connected = False
    elif failure == "symbol":
        sdk.fail_symbol = True
    else:
        sdk.changed = True
    with pytest.raises(AdapterError) as error:
        adapter(sdk).probe({})
    assert "PRIVATE" not in str(error.value)
    assert sdk.opened == sdk.closed == 1 and len(connector_mt5._ATTACHMENTS) == 0


def test_native_clock_skew_is_disclosed_and_never_auto_corrected_or_certified():
    result = adapter().probe({})
    assert result["details"]["clockPolicy"] == "unverified-provider-epoch"
    sample = result["details"]["marketSample"]
    assert sample["quote"]["observedSkewSeconds"] == 7200
    assert sample["quote"]["utcAlignmentVerified"] is False
    assert sample["bars"]["providerClosedBarCount"] == 5
    assert sample["economics"]["quantityUnit"] == "provider-native-volume"
    assert sample["economics"]["canonicalQuantityMappingVerified"] is False
    assert (
        sample["economics"]["currencyProfit"] == "USD" and result["identity"]["currency"] == "GBP"
    )
    for key in ("marketLive", "marketHistory"):
        assert result["capabilities"][key] == {
            "state": "unknown",
            "reason": "connector.provider_clock_unverified",
        }
        assert key not in result["permissions"]


def test_raw_deals_are_receipt_only_without_closed_trade_or_guessed_currency_conversion():
    sdk = SDK()
    page = adapter(sdk).history({}, identity(), WINDOW)
    assert sdk.opened == sdk.closed == 1
    assert len(page["events"]) == 1
    event = page["events"][0]
    assert event["externalEventId"] == "deal:1001" and event["kind"] == "cashflow"
    assert event["occurredAt"] == NOW and event["timeBasis"] == "receipt-only"
    assert event["payload"]["rawProviderTimeMsc"] == sdk.deals[0].time_msc
    assert "normalizedTrade" not in event and "comment" not in event["payload"]
    assert "PRIVATE" not in json.dumps(page)
    assert (
        page["complete"] is False
        and page["coverage"]["reason"] == "connector.provider_clock_unverified"
    )


def test_history_distinguishes_order_outcomes_from_deals_with_the_same_exact_ticket():
    sdk = SDK()
    ticket = 2**53 + 19
    sdk.deals[0].ticket = ticket
    sdk.deals[0].order = ticket
    sdk.deals[0].position_id = 0
    sdk.historical_orders = [
        SimpleNamespace(
            ticket=ticket + index,
            symbol="EURUSD",
            type=2,
            state=state,
            time_setup=sdk.deals[0].time_msc // 1000 - 3,
            time_done_msc=sdk.deals[0].time_msc,
            position_id=ticket + 1,
            position_by_id=0,
            volume_initial=0.2,
            volume_current=0.1,
            price_open=1.1,
            comment="PRIVATE ORDER COMMENT",
        )
        for index, state in enumerate((3, 2, 6, 5, 4))
    ]
    page = adapter(sdk).history({}, identity(), WINDOW)
    deal, *orders = page["events"]
    assert deal["externalEventId"] == f"deal:{ticket}"
    assert deal["payload"]["order"] == str(ticket) and deal["payload"]["position_id"] == "0"
    assert orders[0]["externalEventId"] == f"order:{ticket}"
    assert [row["status"] for row in orders] == [
        "partial",
        "cancelled",
        "cancelled",
        "rejected",
        "confirmed",
    ]
    assert [row["payload"]["state"] for row in orders] == [3, 2, 6, 5, 4]
    assert all(row["kind"] == "order" and row["timeBasis"] == "receipt-only" for row in orders)
    assert orders[0]["payload"]["position_id"] == str(ticket + 1)
    assert orders[0]["payload"]["position_by_id"] == "0"
    assert orders[0]["payload"]["rawProviderSetupTimeMsc"] == sdk.deals[0].time_msc - 3000
    assert orders[0]["payload"]["rawProviderDoneTimeMsc"] == sdk.deals[0].time_msc
    assert "PRIVATE ORDER COMMENT" not in json.dumps(page)


def test_combined_native_history_splits_before_allocating_over_budget_and_resumes():
    sdk = SDK()
    start = instant(WINDOW["from"])
    early = int((start + timedelta(hours=1)).timestamp() * 1000)
    late = int((start + timedelta(hours=14)).timestamp() * 1000)
    deals = [SimpleNamespace(ticket=10000 + i, type=0, time_msc=early + i) for i in range(120)]
    orders = [
        SimpleNamespace(
            ticket=20000 + i,
            type=0,
            state=4,
            symbol="EURUSD",
            time_setup_msc=late + i - 200,
            time_done_msc=late + i,
            volume_initial=0.2,
            volume_current=0,
            price_open=1.1,
        )
        for i in range(100)
    ]
    fetched = []

    def slice_book(rows, field, lower, upper):
        return [
            row
            for row in rows
            if lower.timestamp() * 1000 <= getattr(row, field) <= upper.timestamp() * 1000
        ]

    def get_book(rows, field, lower, upper):
        fetched.append((lower, upper))
        return slice_book(rows, field, lower, upper)

    sdk.history_deals_total = lambda *bounds: len(slice_book(deals, "time_msc", *bounds))
    sdk.history_orders_total = lambda *bounds: len(slice_book(orders, "time_done_msc", *bounds))
    sdk.history_deals_get = lambda *bounds: get_book(deals, "time_msc", *bounds)
    sdk.history_orders_get = lambda *bounds: get_book(orders, "time_done_msc", *bounds)
    first = adapter(sdk).history({}, identity(), WINDOW)
    assert first["hasMore"] and len(first["events"]) == 120
    assert first["coverage"]["to"] == "2026-11-01T12:00:00Z"
    assert fetched == [(start, start + timedelta(hours=12))] * 2
    second = adapter(sdk).history({}, identity(), WINDOW, first["nextCursor"])
    assert not second["hasMore"] and len(second["events"]) == 100
    assert not first["complete"] and not second["complete"]
    assert second["coverage"]["from"] == first["coverage"]["to"]
    assert len({row["externalEventId"] for row in first["events"] + second["events"]}) == 220


def test_same_native_observation_has_stable_payload_despite_new_receipt_time():
    sdk = SDK()
    first = adapter(sdk).history({}, identity(), WINDOW)["events"][0]
    sdk.identity_reads = 0
    second = connector_mt5.MT5Adapter(
        sdk=sdk, terminal_checker=lambda _: True, clock=lambda: "2026-11-03T12:01:00Z"
    ).history({}, identity(), WINDOW)["events"][0]
    assert (
        first["payload"] == second["payload"]
        and first["externalEventId"] == second["externalEventId"]
    )
    assert first["occurredAt"] != second["occurredAt"]


def test_identity_change_is_rejected_before_history_read():
    sdk = SDK()
    foreign = {**identity(), "externalId": "100002"}
    with pytest.raises(AdapterError, match="identity_changed"):
        adapter(sdk).history({}, foreign, WINDOW)
    assert sdk.gets == 0 and sdk.opened == sdk.closed == 1


def test_dense_history_is_refused_before_allocating_deal_rows():
    sdk = SDK()
    sdk.total = 201
    with pytest.raises(AdapterError, match="too_dense"):
        adapter(sdk).history({}, identity(), WINDOW)
    assert sdk.gets == 0 and sdk.opened == sdk.closed == 1
    sdk.identity_reads = 0
    result = adapter(sdk).probe({})
    assert result["capabilities"]["accountRead"]["state"] == "supported"
    assert result["capabilities"]["accountHistory"]["state"] == "unknown"


def test_history_cursor_is_bound_to_account_and_requested_window():
    window = {"from": "2026-10-27T00:00:00Z", "to": "2026-11-03T00:00:00Z"}
    sdk = SDK()
    first = adapter(sdk).history({}, identity(), window)
    assert first["hasMore"] is True and first["nextCursor"]
    sdk.identity_reads = 0
    second = adapter(sdk).history({}, identity(), window, first["nextCursor"])
    assert second["coverage"]["from"] == first["coverage"]["to"]
    sdk.identity_reads = 0
    with pytest.raises(AdapterError, match="invalid_cursor"):
        adapter(sdk).history(
            {}, {**identity(), "externalId": "100002"}, window, first["nextCursor"]
        )
    with pytest.raises(AdapterError, match="invalid_cursor"):
        adapter(sdk).history({}, identity(), WINDOW, first["nextCursor"])


@pytest.mark.parametrize("cursor", ["x", "A" * 2049, "!", True, "eyJ2ZXJzaW9uIjoxfQ=="])
def test_malformed_cursor_never_reaches_terminal(cursor):
    sdk = SDK()
    with pytest.raises(AdapterError, match="invalid_cursor"):
        adapter(sdk).history({}, identity(), WINDOW, cursor)
    assert sdk.opened == 0


def test_one_hundred_success_failure_and_history_paths_balance_sdk_resources():
    sdk = SDK()
    subject = adapter(sdk)
    gc.collect()
    tracemalloc.start()
    initial, _ = tracemalloc.get_traced_memory()
    for index in range(100):
        sdk.identity_reads = 0
        sdk.fail_symbol = index % 2 == 1
        if sdk.fail_symbol:
            with pytest.raises(AdapterError):
                subject.probe({})
        else:
            subject.probe({})
        sdk.identity_reads = 0
        sdk.fail_symbol = False
        subject.history({}, identity(), WINDOW)
        assert sdk.opened == sdk.closed
        assert len(connector_mt5._ATTACHMENTS) == 0
    gc.collect()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    assert sdk.opened == sdk.closed == 200
    assert current - initial < 1024 * 1024 and peak < 4 * 1024 * 1024
    print(
        json.dumps(
            {
                "audit": "P07_MOCK_MT5_IPC",
                "attempts": sdk.opened,
                "shutdowns": sdk.closed,
                "retainedPythonBytes": current - initial,
                "peakPythonBytes": peak,
            }
        )
    )
