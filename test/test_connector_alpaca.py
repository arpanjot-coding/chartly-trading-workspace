"""P10: Alpaca Paper read-only adapter (fixture transport)."""

import json

import pytest

from services.connector_adapters import (
    AdapterError,
    describe_provider,
    get_adapter,
    normalize_configuration,
    provider_catalog,
)
from services.connector_alpaca import AlpacaPaperAdapter, map_alpaca_asset

NOW = "2026-11-04T12:00:00Z"
SECRET = {"apiKey": "PKFIXTUREKEY", "apiSecret": "fixture-secret"}
WINDOW = {"from": "2026-11-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"}
ACCOUNT = {
    "account_number": "PA3FICTIONAL1",
    "status": "ACTIVE",
    "currency": "USD",
    "cash": "9750.25",
    "buying_power": "19500.50",
}
ACTIVITIES = [
    {
        "id": "20261101000000000::fill-1",
        "activity_type": "FILL",
        "transaction_time": "2026-11-01T14:35:00.123456Z",
        "symbol": "AAPL",
        "qty": "2",
        "price": "230.10",
        "side": "buy",
        "order_id": "order-1",
    },
    {
        "id": "20261101000000001::div-1",
        "activity_type": "DIV",
        "date": "2026-11-01",
        "symbol": "AAPL",
        "net_amount": "0.52",
        "per_share_amount": "0.26",
    },
]


class Transport:
    def __init__(self):
        self.calls = []

    def __call__(self, method, url, headers):
        assert method == "GET"  # read-only adapter: no other verbs exist
        assert headers["APCA-API-KEY-ID"] == SECRET["apiKey"]
        self.calls.append(url)
        if "/v2/account/activities" in url:
            return 200, json.dumps(ACTIVITIES).encode()
        if url.endswith("/v2/positions"):
            return 200, b"[]"
        if url.endswith("/v2/account"):
            return 200, json.dumps(ACCOUNT).encode()
        raise AssertionError(url)


@pytest.fixture
def adapter():
    return AlpacaPaperAdapter(transport=Transport(), clock=lambda: NOW)


def test_catalog_registration_and_configuration():
    ids = [row["id"] for row in provider_catalog()]
    assert "alpaca-paper" in ids
    description = describe_provider("alpaca-paper")
    assert description["environments"] == ["broker_demo"]
    assert normalize_configuration("alpaca-paper", {}) == {"feed": "iex", "environment": "paper"}
    with pytest.raises(AdapterError):
        normalize_configuration("alpaca-paper", {"environment": "live"})
    assert isinstance(get_adapter("alpaca-paper"), AlpacaPaperAdapter)


def test_probe_identity_and_honest_capabilities(adapter):
    result = adapter.probe({}, SECRET)
    assert result["identity"]["externalId"] == "PA3FICTIONAL1"
    assert result["identity"]["environment"] == "broker_demo"
    assert result["capabilities"]["accountRead"]["state"] == "supported"
    assert result["capabilities"]["accountHistory"]["state"] == "supported"
    # T05: account access never implies entitled market data.
    assert result["capabilities"]["marketLive"]["state"] == "unknown"
    assert result["details"]["cash"] == "9750.25"


def test_history_maps_fills_and_cash_exactly(adapter):
    identity = adapter.probe({}, SECRET)["identity"]
    page = adapter.history({}, identity, WINDOW, secret=SECRET)
    assert page["complete"] is True
    fill, div = page["events"]
    assert fill["kind"] == "fill"
    assert fill["payload"]["quantity"] == "2"
    assert fill["payload"]["price"] == "230.10"
    assert fill["occurredAt"] == "2026-11-01T14:35:00.123456Z"
    assert div["kind"] == "cashflow"
    assert div["payload"]["netAmount"] == "0.52"
    with pytest.raises(AdapterError) as error:
        adapter.history({}, identity, WINDOW, cursor="bogus", secret=SECRET)
    assert error.value.code == "connector.invalid_cursor"
    with pytest.raises(AdapterError) as error:
        adapter.probe({}, None)
    assert error.value.code == "connector.credential_required"


def test_asset_mapping_keeps_units_explicit():
    mapped = map_alpaca_asset(
        {
            "symbol": "AAPL",
            "name": "Apple Inc",
            "exchange": "NASDAQ",
            "class": "us_equity",
            "status": "active",
            "tradable": True,
            "fractionable": True,
            "min_order_size": "1",
            "min_trade_increment": "0.000000001",
        }
    )
    assert mapped["quantityUnit"] == "shares"
    assert mapped["exchange"] == "NASDAQ"
    assert mapped["fractionable"] is True
