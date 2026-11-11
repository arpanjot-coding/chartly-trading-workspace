"""Read-only Binance spot account adapter (P08 repeat-per-exchange).

Same two-phase pattern as Kraken: fixture-verified signing/mapping
here, Phase-B certification with the user's own keys (spot testnet
keys exist and need no funds). Safety rule from the platform spec:
keys with **withdrawals enabled are refused** at probe time via the
API-restrictions endpoint. Numbers decode with float/int literals
preserved as exact text.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from decimal import Decimal

from services.connector_adapters import (
    VERSION,
    AdapterError,
    capability_results,
    checked_window,
    describe_provider,
    instant,
    utc_now,
)

PROVIDER_ID = "binance"
HOSTS = {"production": "https://api.binance.com", "testnet": "https://testnet.binance.vision"}
MAX_BYTES = 4 * 1024 * 1024
_SYMBOL = re.compile(r"[A-Z0-9]{3,24}")
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")


def normalize_binance_configuration(configuration):
    if not isinstance(configuration, dict) or set(configuration) - {"environment", "symbols"}:
        raise AdapterError("connector.invalid_configuration")
    environment = configuration.get("environment", "production")
    if environment not in HOSTS:
        raise AdapterError("connector.invalid_configuration")
    symbols = configuration.get("symbols", ["BTCUSDT"])
    if (
        not isinstance(symbols, list)
        or not 1 <= len(symbols) <= 5
        or not all(isinstance(s, str) and _SYMBOL.fullmatch(s) for s in symbols)
    ):
        raise AdapterError("connector.invalid_configuration")
    return {"environment": environment, "symbols": symbols}


def _checked_secret(secret):
    if (
        not isinstance(secret, dict)
        or set(secret) != {"apiKey", "apiSecret"}
        or not all(isinstance(secret[k], str) and secret[k] for k in secret)
    ):
        raise AdapterError("connector.credential_required", 409)
    return secret["apiKey"], secret["apiSecret"]


def key_fingerprint(api_key):
    return "key:" + hashlib.sha256(api_key.encode()).hexdigest()[:24]


def sign_query(params, secret, *, timestamp_ms):
    query = urllib.parse.urlencode(
        [*params, ("recvWindow", "10000"), ("timestamp", str(timestamp_ms))]
    )
    signature = hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()
    return query + "&signature=" + signature


def _invalid(status=502):
    return AdapterError("connector.invalid_provider_response", status)


def _decimal_text(value):
    if not isinstance(value, str) or not _DECIMAL_TEXT.fullmatch(value):
        raise _invalid()
    return value


def map_exchange_info(payload):
    """Public instrument mapping (live-verifiable without keys)."""
    out = []
    for row in payload.get("symbols", []):
        filters = {f["filterType"]: f for f in row.get("filters", [])}
        price = filters.get("PRICE_FILTER", {})
        lot = filters.get("LOT_SIZE", {})
        notional = filters.get("NOTIONAL") or filters.get("MIN_NOTIONAL") or {}
        out.append(
            {
                "nativeSymbol": row["symbol"],
                "baseAsset": row["baseAsset"],
                "quoteAsset": row["quoteAsset"],
                "status": row["status"],
                "tickSize": price.get("tickSize"),
                "quantityStep": lot.get("stepSize"),
                "minQuantity": lot.get("minQty"),
                "maxQuantity": lot.get("maxQty"),
                "minNotional": notional.get("minNotional"),
                "quantityUnit": "base_asset",
            }
        )
    return out


def _default_transport(method, url, headers, body=None):
    request = urllib.request.Request(url, method=method, headers=headers, data=body)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as error:
        return error.code, error.read(MAX_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError):
        raise AdapterError("connector.provider_unreachable", 503) from None


class BinanceAdapter:
    def __init__(self, transport=None, clock=None, wall_ms=None):
        self._transport = transport or _default_transport
        self._clock = clock or utc_now
        self._wall_ms = wall_ms or (lambda: int(time.time() * 1000))

    def describe(self):
        return describe_provider(PROVIDER_ID)

    def _signed_get(self, host, path, params, secret):
        api_key, api_secret = _checked_secret(secret)
        query = sign_query(list(params.items()), api_secret, timestamp_ms=self._wall_ms())
        status, body = self._transport("GET", f"{host}{path}?{query}", {"X-MBX-APIKEY": api_key})
        if len(body) > MAX_BYTES:
            raise AdapterError("connector.response_budget", 413)
        if status in (401, 403):
            raise AdapterError("connector.credential_rejected", 401)
        if status == 429 or status == 418:
            raise AdapterError("connector.rate_limited", 429)
        if status != 200:
            raise AdapterError("connector.provider_unavailable", 503)
        try:
            parsed = json.loads(body.decode("utf-8"), parse_float=str, parse_int=str)
        except (ValueError, UnicodeDecodeError):
            raise _invalid() from None
        if isinstance(parsed, dict) and "code" in parsed and "msg" in parsed:
            raise AdapterError("connector.provider_rejected", 400)
        return parsed

    def _identity(self, config, account, api_key):
        environment = "broker_demo" if config["environment"] == "testnet" else "broker_live"
        external = account.get("uid") or key_fingerprint(api_key)
        return {
            "providerId": PROVIDER_ID,
            "externalId": str(external),
            "server": HOSTS[config["environment"]].replace("https://", ""),
            "environment": environment,
            "currency": "USD",
            "synthetic": False,
        }

    def probe(self, configuration, secret=None):
        config = normalize_binance_configuration(configuration)
        api_key, _secret = _checked_secret(secret)
        host = HOSTS[config["environment"]]
        restrictions = self._signed_get(host, "/sapi/v1/account/apiRestrictions", {}, secret)
        if restrictions.get("enableWithdrawals") is True:
            raise AdapterError("connector.withdrawal_permission_must_be_disabled", 403)
        account = self._signed_get(host, "/api/v3/account", {}, secret)
        identity = self._identity(config, account, api_key)
        balances = [
            row
            for row in account.get("balances", [])
            if Decimal(_decimal_text(row["free"])) != 0
            or Decimal(_decimal_text(row["locked"])) != 0
        ]
        capabilities = capability_results(
            ["accountRead", "accountHistory"],
            reasons={
                "marketLive": "connector.entitlement_unverified",
                "marketHistory": "connector.entitlement_unverified",
            },
        )
        for key in ("marketLive", "marketHistory"):
            capabilities[key] = {
                "state": "unknown",
                "reason": "Public market data is keyless; entitlement is not what gates it here.",
            }
        return {
            "providerId": PROVIDER_ID,
            "adapterVersion": VERSION,
            "identity": identity,
            "permissions": ["accountRead", "accountHistory"],
            "observedAt": self._clock(),
            "capabilities": capabilities,
            "details": {
                "environment": config["environment"],
                "nonZeroBalances": len(balances),
                "canTradeFlag": bool(account.get("canTrade")),
                "withdrawalsEnabled": False,
                "scope": "Read-only spot account/history. Phase B certifies against the user's keys (testnet available).",
            },
        }

    def history(self, configuration, identity, window, cursor=None, secret=None):
        config = normalize_binance_configuration(configuration)
        if cursor is not None:
            raise AdapterError("connector.invalid_cursor")
        start, end = checked_window(window)
        host = HOSTS[config["environment"]]
        api_key, _s = _checked_secret(secret)
        account = self._signed_get(host, "/api/v3/account", {}, secret)
        if self._identity(config, account, api_key) != identity:
            raise AdapterError("connector.identity_changed", 409)
        events = []
        for symbol in config["symbols"]:
            rows = self._signed_get(
                host,
                "/api/v3/myTrades",
                {
                    "symbol": symbol,
                    "startTime": str(int(start.timestamp() * 1000)),
                    "endTime": str(int(end.timestamp() * 1000)),
                    "limit": "1000",
                },
                secret,
            )
            if not isinstance(rows, list):
                raise _invalid()
            for row in rows:
                events.append(
                    {
                        "externalEventId": f"trade:{symbol}:{row['id']}",
                        "kind": "fill",
                        "status": "confirmed",
                        "occurredAt": datetime.fromtimestamp(int(row["time"]) / 1000, tz=UTC)
                        .isoformat()
                        .replace("+00:00", "Z"),
                        "timeBasis": "provider-utc",
                        "payload": {
                            "symbol": symbol,
                            "side": "buy" if row.get("isBuyer") else "sell",
                            "quantity": _decimal_text(row["qty"]),
                            "price": _decimal_text(row["price"]),
                            "commission": _decimal_text(row["commission"]),
                            "commissionAsset": row.get("commissionAsset"),
                            "orderId": str(row["orderId"]),
                        },
                    }
                )
        events.sort(key=lambda row: row["occurredAt"])
        observed = self._clock()
        return {
            "providerId": PROVIDER_ID,
            "adapterVersion": VERSION,
            "identity": identity,
            "window": dict(window),
            "cursor": cursor,
            "nextCursor": None,
            "events": events,
            "hasMore": False,
            "complete": True,
            "coverage": {
                "from": window["from"],
                "to": window["to"],
                "complete": True,
                "timeBasis": "provider-utc",
                "observedAt": observed,
                "symbols": config["symbols"],
            },
        }
