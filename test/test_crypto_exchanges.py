"""P08 repeat-per-exchange: Binance, Bybit, Coinbase, OKX, Bitget, Hyperliquid.

Phase-A fixture verification: signing shapes, withdrawal-permission
refusals, identity stability, exact history mapping, instrument maps.
"""

import json

import pytest

from services.connector_adapters import AdapterError
from services.connector_binance import BinanceAdapter, map_exchange_info, sign_query
from services.connector_bitget import BitgetAdapter
from services.connector_bybit import BybitAdapter, sign_headers
from services.connector_coinbase import CoinbaseAdapter
from services.connector_hyperliquid import HyperliquidAdapter, map_meta
from services.connector_okx import OkxAdapter

NOW = "2026-11-04T12:00:00Z"
WINDOW = {"from": "2026-11-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"}
SECRET = {"apiKey": "fixture-key", "apiSecret": "fixture-secret"}
SECRET3 = {**SECRET, "passphrase": "fixture-pass"}


def _json(payload, status=200):
    return status, json.dumps(payload).encode()


# --- Binance ---------------------------------------------------------------


class BinanceTransport:
    def __init__(self, withdrawals=False):
        self.withdrawals = withdrawals
        self.urls = []

    def __call__(self, method, url, headers, body=None):
        assert method == "GET"
        assert headers["X-MBX-APIKEY"] == SECRET["apiKey"]
        self.urls.append(url)
        if "apiRestrictions" in url:
            return _json({"enableWithdrawals": self.withdrawals, "enableReading": True})
        if "/api/v3/account" in url:
            return _json(
                {
                    "uid": 9001,
                    "canTrade": True,
                    "balances": [
                        {"asset": "BTC", "free": "0.50000000", "locked": "0.00000000"},
                        {"asset": "ETH", "free": "0.00000000", "locked": "0.00000000"},
                    ],
                }
            )
        if "/api/v3/myTrades" in url:
            return _json(
                [
                    {
                        "id": 42,
                        "orderId": 7,
                        "price": "67000.00000000",
                        "qty": "0.00100000",
                        "commission": "0.067",
                        "commissionAsset": "USDT",
                        "time": 1793491200000,
                        "isBuyer": True,
                    }
                ]
            )
        raise AssertionError(url)


def test_binance_signing_probe_history_and_withdrawal_refusal():
    query = sign_query([("symbol", "BTCUSDT")], "secret", timestamp_ms=1700000000000)
    assert query.startswith("symbol=BTCUSDT&recvWindow=10000&timestamp=1700000000000&signature=")
    adapter = BinanceAdapter(transport=BinanceTransport(), clock=lambda: NOW, wall_ms=lambda: 1700000000000)
    probe = adapter.probe({}, SECRET)
    assert probe["identity"]["externalId"] == "9001"
    assert probe["details"]["nonZeroBalances"] == 1
    page = adapter.history({}, probe["identity"], WINDOW, secret=SECRET)
    assert page["events"][0]["payload"]["quantity"] == "0.00100000"
    assert page["events"][0]["externalEventId"] == "trade:BTCUSDT:42"
    refusing = BinanceAdapter(transport=BinanceTransport(withdrawals=True), wall_ms=lambda: 1)
    with pytest.raises(AdapterError) as error:
        refusing.probe({}, SECRET)
    assert error.value.code == "connector.withdrawal_permission_must_be_disabled"
    mapped = map_exchange_info(
        {
            "symbols": [
                {
                    "symbol": "BTCUSDT",
                    "baseAsset": "BTC",
                    "quoteAsset": "USDT",
                    "status": "TRADING",
                    "filters": [
                        {"filterType": "PRICE_FILTER", "tickSize": "0.01"},
                        {"filterType": "LOT_SIZE", "stepSize": "0.00001", "minQty": "0.00001", "maxQty": "9000"},
                        {"filterType": "NOTIONAL", "minNotional": "5"},
                    ],
                }
            ]
        }
    )
    assert mapped[0]["tickSize"] == "0.01" and mapped[0]["minNotional"] == "5"


# --- Bybit -----------------------------------------------------------------


class BybitTransport:
    def __call__(self, method, url, headers, body=None):
        assert headers["X-BAPI-SIGN"]
        if "query-api" in url:
            return _json({"retCode": 0, "result": {"userID": "777", "permissions": {"Spot": ["SpotTrade"]}}})
        if "wallet-balance" in url:
            return _json({"retCode": 0, "result": {"list": [{"accountType": "UNIFIED"}]}})
        if "execution/list" in url:
            return _json(
                {
                    "retCode": 0,
                    "result": {
                        "nextPageCursor": "",
                        "list": [
                            {
                                "execId": "e1",
                                "orderId": "o1",
                                "symbol": "BTCUSDT",
                                "side": "Buy",
                                "execQty": "0.002",
                                "execPrice": "67000.5",
                                "execFee": "0.134",
                                "execTime": "1793491200000",
                            }
                        ],
                    },
                }
            )
        raise AssertionError(url)


def test_bybit_probe_and_history():
    headers = sign_headers("k", "s", "category=spot", timestamp_ms=1700000000000)
    assert headers["X-BAPI-TIMESTAMP"] == "1700000000000"
    adapter = BybitAdapter(transport=BybitTransport(), clock=lambda: NOW, wall_ms=lambda: 1700000000000)
    probe = adapter.probe({}, SECRET)
    assert probe["identity"]["externalId"] == "777"
    page = adapter.history({}, probe["identity"], WINDOW, secret=SECRET)
    assert page["events"][0]["payload"]["side"] == "buy"
    assert page["complete"] is True


# --- OKX -------------------------------------------------------------------



class OkxTransport:
    def __init__(self, perm="read_only,trade"):
        self.perm = perm

    def __call__(self, method, url, headers, body=None):
        assert headers["OK-ACCESS-SIGN"] and headers["OK-ACCESS-PASSPHRASE"] == "fixture-pass"
        if "account/config" in url:
            return _json({"code": "0", "data": [{"uid": "555", "perm": self.perm, "acctLv": "2"}]})
        if "account/balance" in url:
            return _json({"code": "0", "data": [{"totalEq": "1000.5"}]})
        if "trade/fills" in url:
            return _json(
                {
                    "code": "0",
                    "data": [
                        {
                            "tradeId": "t1",
                            "ordId": "o1",
                            "instId": "BTC-USDT",
                            "side": "buy",
                            "fillSz": "0.001",
                            "fillPx": "67000",
                            "fee": "-0.067",
                            "feeCcy": "USDT",
                            "ts": "1793491200000",
                            "billId": "b1",
                        }
                    ],
                }
            )
        raise AssertionError(url)


def test_okx_probe_history_and_withdraw_refusal():
    adapter = OkxAdapter(transport=OkxTransport(), clock=lambda: NOW)
    probe = adapter.probe({}, SECRET3)
    assert probe["identity"]["externalId"] == "555"
    page = adapter.history({}, probe["identity"], WINDOW, secret=SECRET3)
    assert page["events"][0]["payload"]["fee"] == "-0.067"
    with pytest.raises(AdapterError) as error:
        OkxAdapter(transport=OkxTransport(perm="read_only,withdraw")).probe({}, SECRET3)
    assert error.value.code == "connector.withdrawal_permission_must_be_disabled"


# --- Bitget ----------------------------------------------------------------


class BitgetTransport:
    def __call__(self, method, url, headers, body=None):
        assert headers["ACCESS-SIGN"]
        if "account/info" in url:
            return _json({"code": "00000", "data": {"userId": "321", "authorities": ["readonly"]}})
        if "account/assets" in url:
            return _json({"code": "00000", "data": [{"coin": "BTC"}]})
        if "trade/fills" in url:
            return _json(
                {
                    "code": "00000",
                    "data": [
                        {
                            "tradeId": "f1",
                            "orderId": "o9",
                            "side": "buy",
                            "size": "0.003",
                            "priceAvg": "66900",
                            "cTime": "1793491200000",
                            "feeDetail": {"totalFee": "-0.2"},
                        }
                    ],
                }
            )
        raise AssertionError(url)


def test_bitget_probe_and_history():
    adapter = BitgetAdapter(transport=BitgetTransport(), clock=lambda: NOW, wall_ms=lambda: 1700000000000)
    probe = adapter.probe({}, SECRET3)
    assert probe["identity"]["externalId"] == "321"
    page = adapter.history({}, probe["identity"], WINDOW, secret=SECRET3)
    assert page["events"][0]["payload"]["fee"] == "-0.2"


# --- Coinbase --------------------------------------------------------------


class CoinbaseTransport:
    def __call__(self, method, url, headers, body=None):
        assert headers["Authorization"] == "Bearer fixture.jwt.token"
        if "brokerage/accounts" in url:
            return _json({"accounts": [{"uuid": "acct-uuid-1", "currency": "BTC"}]})
        if "historical/fills" in url:
            return _json(
                {
                    "fills": [
                        {
                            "trade_id": "cb1",
                            "order_id": "ord1",
                            "product_id": "BTC-USD",
                            "side": "BUY",
                            "size": "0.0005",
                            "price": "67100.25",
                            "commission": "0.2",
                            "trade_time": "2026-11-01T10:00:00Z",
                        }
                    ],
                    "cursor": "",
                }
            )
        raise AssertionError(url)


def test_coinbase_jwt_probe_and_history():
    adapter = CoinbaseAdapter(
        transport=CoinbaseTransport(),
        clock=lambda: NOW,
        jwt_builder=lambda *_a, **_k: "fixture.jwt.token",
    )
    secret = {"keyName": "organizations/x/apiKeys/y", "privateKeyPem": "unused-with-stub"}
    probe = adapter.probe({}, secret)
    assert probe["identity"]["externalId"] == "acct-uuid-1"
    page = adapter.history({}, probe["identity"], WINDOW, secret=secret)
    assert page["events"][0]["payload"]["price"] == "67100.25"
    assert page["complete"] is True


def test_coinbase_real_jwt_structure():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    from services.connector_coinbase import build_jwt

    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    token = build_jwt("org/key", pem, "GET", "/api/v3/brokerage/accounts", now_s=1700000000, nonce="n1")
    import base64

    header, claims, _sig = token.split(".")
    decode = lambda part: json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    assert decode(header)["kid"] == "org/key"
    assert decode(claims)["uri"] == "GET api.coinbase.com/api/v3/brokerage/accounts"
    assert decode(claims)["exp"] - decode(claims)["nbf"] == 120


# --- Hyperliquid -----------------------------------------------------------


class HyperliquidTransport:
    def __call__(self, method, url, headers, body=None):
        assert method == "POST"
        payload = json.loads(body)
        if payload["type"] == "clearinghouseState":
            return _json({"marginSummary": {"accountValue": "1234.56"}, "assetPositions": []})
        if payload["type"] == "userFillsByTime":
            return _json(
                [
                    {
                        "tid": 99,
                        "oid": 12,
                        "coin": "BTC",
                        "side": "B",
                        "sz": "0.01",
                        "px": "67000.5",
                        "fee": "0.3",
                        "closedPnl": "0.0",
                        "time": 1793491200000,
                        "hash": "0xabc",
                    }
                ]
            )
        raise AssertionError(payload)


def test_hyperliquid_address_read_only_and_secret_refused():
    config = {"walletAddress": "0x" + "ab" * 20}
    adapter = HyperliquidAdapter(transport=HyperliquidTransport(), clock=lambda: NOW)
    probe = adapter.probe(config)
    assert probe["identity"]["externalId"] == config["walletAddress"]
    assert probe["details"]["accountValue"] == "1234.56"
    page = adapter.history(config, probe["identity"], WINDOW)
    assert page["events"][0]["payload"]["side"] == "buy"
    with pytest.raises(AdapterError) as error:
        adapter.probe(config, {"apiKey": "no"})
    assert error.value.code == "connector.secret_not_accepted_read_only_by_address"
    assert map_meta({"universe": [{"name": "BTC", "szDecimals": 5}]})[0]["nativeSymbol"] == "BTC"
