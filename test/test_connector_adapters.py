"""Read-only factory, deterministic faults and bounded public transport."""

import json
from copy import deepcopy

import pytest

from services import connector_adapters as adapters
from services.connector_adapters import AdapterError

WINDOW = {"from": "2026-11-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"}
NOW = "2026-11-03T12:00:00Z"


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    monkeypatch.setattr(adapters, "utc_now", lambda: NOW)


def diagnostic_page(fault="none", cursor=None):
    identity = adapters.probe("diagnostic", {})["identity"]
    return adapters.history("diagnostic", {"fault": fault}, identity, WINDOW, cursor)


def test_static_factory_catalog_and_no_financial_dispatch_interface():
    descriptions = adapters.provider_catalog()
    assert {row["id"] for row in descriptions} == {"diagnostic", "mt5", "kraken-public", "kraken", "binance", "bybit", "coinbase", "okx", "bitget", "hyperliquid", "topstepx", "alpaca-paper", *adapters.PLATFORM_DIRECTORY}
    for row in descriptions:
        if row["setupState"] == "planned":
            with pytest.raises(AdapterError, match="provider_not_supported"):
                adapters.get_adapter(row["id"])
            assert row["available"] is False and row["reason"]
        else:
            adapter = adapters.get_adapter(row["id"])
            assert not hasattr(adapter, "submit") and not hasattr(adapter, "order_send")
        caps = {value["id"]: value for value in row["capabilities"]}
        assert set(caps) == set(adapters.CAPABILITIES)
        assert not any(
            caps[key]["supported"] for key in ("orderSubmit", "orderCancel", "protectiveOrders")
        )
    descriptions[0]["capabilities"].clear()
    assert adapters.provider_catalog()[0]["capabilities"]


@pytest.mark.parametrize(
    "provider", [None, "", "os", "mt5.order_send", "https://example.test", "../mt5"]
)
def test_factory_does_not_import_caller_supplied_targets(provider):
    with pytest.raises(AdapterError, match="provider_not_supported"):
        adapters.get_adapter(provider)


@pytest.mark.parametrize(
    "config",
    [
        {"url": "http://localhost"},
        {"password": "secret"},
        {"account": "unknown"},
        {"fault": "execute"},
        [],
        None,
    ],
)
def test_diagnostic_configuration_is_data_only_and_allowlisted(config):
    with pytest.raises(AdapterError):
        adapters.normalize_configuration("diagnostic", config)


def test_diagnostic_identity_has_explicit_synthetic_scope_and_no_secret_echo():
    result = adapters.probe("diagnostic", {}, {"token": "private-fixture-marker"})
    assert result["identity"] == {
        "providerId": "diagnostic",
        "externalId": "DIAGNOSTIC-ALPHA",
        "server": "Chartly Diagnostic",
        "environment": "broker_demo",
        "currency": "USD",
        "synthetic": True,
    }
    assert "private-fixture-marker" not in json.dumps(result)
    assert adapters.normalize_configuration("diagnostic", {}) == {
        "account": "alpha",
        "fault": "none",
    }
    assert result["observedAt"] == NOW


@pytest.mark.parametrize(
    "fault,code,status,retry",
    [
        ("disconnect", "connector.offline", 503, None),
        ("expired", "connector.credential_expired", 401, None),
        ("revoked", "connector.credential_revoked", 403, None),
        ("rate_limit", "connector.rate_limited", 429, 30),
    ],
)
def test_controlled_failures_never_retry_automatically(fault, code, status, retry):
    with pytest.raises(AdapterError) as failure:
        adapters.probe("diagnostic", {"fault": fault})
    assert (failure.value.code, failure.value.status, failure.value.retry_after) == (
        code,
        status,
        retry,
    )


def test_stale_quote_is_not_a_live_permission_and_wrong_account_is_observed():
    result = adapters.probe("diagnostic", {"fault": "stale_quote"})
    assert result["details"]["quote"]["stale"] is True
    assert result["capabilities"]["marketLive"]["state"] == "unknown"
    assert "marketLive" not in result["permissions"]
    original = adapters.probe("diagnostic", {})["identity"]
    changed = adapters.probe("diagnostic", {"fault": "wrong_identity"})["identity"]
    assert original["externalId"] != changed["externalId"]
    with pytest.raises(AdapterError, match="identity_changed"):
        adapters.history("diagnostic", {"fault": "wrong_identity"}, original, WINDOW)


def test_repeat_duplicates_reordering_and_revision_corrections_are_deterministic():
    page = diagnostic_page()
    assert page == diagnostic_page()
    assert len(page["events"]) == 2 and page["complete"] is True
    duplicate = diagnostic_page("duplicates")
    assert duplicate["events"][:2] == duplicate["events"][2:]
    assert diagnostic_page("reordered")["events"] == list(reversed(page["events"]))
    revised = diagnostic_page("correction")["events"][0]
    assert (
        revised["externalEventId"] == page["events"][0]["externalEventId"]
        and revised["revision"] == 2
    )
    assert revised["normalizedTrade"]["netPnl"] == "2.7"
    assert page["events"][0]["normalizedTrade"]["netPnl"] == "1.7"


@pytest.mark.parametrize(
    "fault,kind,status",
    [("partial_fill", "fill", "partial"), ("unknown_submission", "order", "unknown")],
)
def test_unconfirmed_outcomes_are_observations_not_closed_trades(fault, kind, status):
    event = diagnostic_page(fault)["events"][0]
    assert (event["kind"], event["status"]) == (kind, status)
    assert "normalizedTrade" not in event and event["payload"]["reconciliationRequired"]
    assert event["payload"]["automaticResubmissions"] == 0


def test_partial_coverage_is_not_fabricated_complete():
    page = diagnostic_page("incomplete")
    assert (
        page["complete"] is False
        and page["coverage"]["complete"] is False
        and page["hasMore"] is True
    )
    next_page = diagnostic_page("incomplete", page["nextCursor"])
    assert next_page["complete"] is False
    assert page["events"][0]["externalEventId"] != next_page["events"][0]["externalEventId"]


@pytest.mark.parametrize(
    "window",
    [
        {"from": "2026-11-01T00:00:00Z", "to": "2026-11-01T00:00:00Z"},
        {"from": "2026-11-01T00:00:00+02:00", "to": "2026-11-02T00:00:00Z"},
        {"from": "2026-11-01T00:00:00.0000001Z", "to": "2026-11-02T00:00:00Z"},
        {"from": "2026-11-01T00:00:00Z", "to": "2027-01-01T00:00:00Z"},
        {"from": "2026-11-01T00:00:00Z", "to": "2026-11-02T00:00:00Z", "url": "http://localhost"},
    ],
)
def test_utc_window_and_budget_are_explicit(window):
    identity = adapters.probe("diagnostic", {})["identity"]
    with pytest.raises(AdapterError):
        adapters.history("diagnostic", {}, identity, window)


def test_diagnostic_complete_rows_pass_existing_p03_financial_normalization():
    import csv
    from io import StringIO

    from services.journal_import import normalize_statement

    rows = [event["normalizedTrade"] for event in diagnostic_page()["events"]]
    stream = StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    mapping = {
        "version": 1,
        "name": "Diagnostic",
        "columns": {key: key for key in rows[0]},
        "timezone": "UTC",
        "delimiter": ",",
        "decimalSeparator": ".",
        "thousandsSeparator": "",
        "costConvention": "positive",
        "quantityUnit": "shares",
        "currency": "USD",
        "pnlMultiplier": "1",
        "allowMixedCurrencies": False,
        "missingCostPolicy": "unknown",
    }
    context = {
        "provider": "diagnostic",
        "accountKey": "account-key",
        "bookId": "book_fixture",
        "portfolioId": 1,
        "currency": "USD",
    }
    result = normalize_statement(stream.getvalue(), mapping, context)
    assert result["canCommit"] is True and len(result["tradeProjections"]) == 2
    assert {row["amounts"]["netPnl"] for row in result["tradeProjections"]} == {"1.7"}


class Response:
    def __init__(self, status=200, data=None):
        self.status_code = status
        self.data = data if data is not None else b'{"error":[],"result":{"unixtime":1793707200}}'
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.closed = True

    def iter_bytes(self, chunk_size):
        assert chunk_size == 4096
        for at in range(0, len(self.data), chunk_size):
            yield self.data[at : at + chunk_size]


class Client:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def stream(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.response


def test_public_time_probe_has_no_private_account_or_market_capabilities(monkeypatch):
    from utils import httpx_client

    response, client = Response(), None
    client = Client(response)
    monkeypatch.setattr(httpx_client, "get_httpx_client", lambda: client)
    result = adapters.probe("kraken-public", {})
    assert response.closed and len(client.calls) == 1
    assert client.calls[0][0:2] == ("GET", "https://api.kraken.com/0/public/Time")
    assert client.calls[0][2] == {"timeout": 10, "follow_redirects": False}
    assert result["permissions"] == [] and result["details"]["accountVerified"] is False
    assert result["identity"]["environment"] == "data_only"
    assert result["identity"]["currency"] == "XXX" and result["details"]["currencyKnown"] is False
    assert all(row["state"] == "unsupported" for row in result["capabilities"].values())


@pytest.mark.parametrize(
    "status,data,code",
    [
        (429, b"private-token", "rate_limited"),
        (302, b"", "public_probe_unavailable"),
        (200, b"invalid-json", "public_probe_unavailable"),
        (200, b"x" * 16385, "response_budget"),
        (200, b'{"error":[],"result":{"unixtime":true}}', "invalid_provider_response"),
    ],
)
def test_public_probe_closes_on_errors_and_never_echoes_body(monkeypatch, status, data, code):
    from utils import httpx_client

    response = Response(status, data)
    monkeypatch.setattr(httpx_client, "get_httpx_client", lambda: Client(response))
    with pytest.raises(AdapterError, match=code) as failure:
        adapters.probe("kraken-public", {})
    assert response.closed and "private-token" not in str(failure.value)


def test_removed_indian_broker_and_unrequested_public_secrets_fail_closed():
    with pytest.raises(AdapterError, match="provider_not_supported"):
        adapters.probe("zerodha", {}, {"token": "never-used"})
    with pytest.raises(AdapterError, match="invalid_configuration"):
        adapters.probe("kraken-public", {}, "never-used")
    with pytest.raises(AdapterError, match="history_not_supported"):
        adapters.history("kraken-public", {}, {}, WINDOW)
