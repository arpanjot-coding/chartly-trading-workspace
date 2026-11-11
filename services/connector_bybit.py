"""Read-only Bybit v5 account adapter (P08 repeat-per-exchange).

Phase-A fixture pattern: HMAC v5 signing, withdrawal-permission
refusal at probe time, exact-text numbers. Phase B uses the user's
own keys (Bybit testnet/demo trading available).
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

from services.connector_adapters import (
    VERSION,
    AdapterError,
    capability_results,
    checked_window,
    describe_provider,
    utc_now,
)

PROVIDER_ID = "bybit"
HOSTS = {"production": "https://api.bybit.com", "testnet": "https://api-testnet.bybit.com"}
MAX_BYTES = 4 * 1024 * 1024
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")


def normalize_bybit_configuration(configuration):
    if not isinstance(configuration, dict) or set(configuration) - {"environment"}:
        raise AdapterError("connector.invalid_configuration")
    environment = configuration.get("environment", "production")
    if environment not in HOSTS:
        raise AdapterError("connector.invalid_configuration")
    return {"environment": environment}


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


def sign_headers(api_key, api_secret, query, *, timestamp_ms, recv_window="10000"):
    payload = f"{timestamp_ms}{api_key}{recv_window}{query}"
    signature = hmac.new(api_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return {
        "X-BAPI-API-KEY": api_key,
        "X-BAPI-TIMESTAMP": str(timestamp_ms),
        "X-BAPI-RECV-WINDOW": recv_window,
        "X-BAPI-SIGN": signature,
    }


def _invalid(status=502):
    return AdapterError("connector.invalid_provider_response", status)


def _decimal_text(value):
    if not isinstance(value, str) or not _DECIMAL_TEXT.fullmatch(value):
        raise _invalid()
    return value


def map_instruments(payload):
    out = []
    for row in payload.get("result", {}).get("list", []):
        price = row.get("priceFilter", {})
        lot = row.get("lotSizeFilter", {})
        out.append(
            {
                "nativeSymbol": row["symbol"],
                "baseAsset": row.get("baseCoin"),
                "quoteAsset": row.get("quoteCoin"),
                "status": row.get("status"),
                "tickSize": price.get("tickSize"),
                # Spot uses basePrecision as the step; derivatives use qtyStep.
                "quantityStep": lot.get("qtyStep") or lot.get("basePrecision"),
                "minQuantity": lot.get("minOrderQty"),
                "minNotional": lot.get("minOrderAmt"),
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


class BybitAdapter:
    def __init__(self, transport=None, clock=None, wall_ms=None):
        self._transport = transport or _default_transport
        self._clock = clock or utc_now
        self._wall_ms = wall_ms or (lambda: int(time.time() * 1000))

    def describe(self):
        return describe_provider(PROVIDER_ID)

    def _signed_get(self, host, path, params, secret):
        api_key, api_secret = _checked_secret(secret)
        query = urllib.parse.urlencode(list(params.items()))
        headers = sign_headers(api_key, api_secret, query, timestamp_ms=self._wall_ms())
        url = f"{host}{path}" + (f"?{query}" if query else "")
        status, body = self._transport("GET", url, headers)
        if len(body) > MAX_BYTES:
            raise AdapterError("connector.response_budget", 413)
        if status in (401, 403):
            raise AdapterError("connector.credential_rejected", 401)
        if status == 429:
            raise AdapterError("connector.rate_limited", 429)
        if status != 200:
            raise AdapterError("connector.provider_unavailable", 503)
        try:
            parsed = json.loads(body.decode("utf-8"), parse_float=str, parse_int=str)
        except (ValueError, UnicodeDecodeError):
            raise _invalid() from None
        if parsed.get("retCode") not in ("0", 0):
            raise AdapterError("connector.provider_rejected", 400)
        return parsed

    def _identity(self, config, key_info, api_key):
        external = key_info.get("userID") or key_fingerprint(api_key)
        return {
            "providerId": PROVIDER_ID,
            "externalId": str(external),
            "server": HOSTS[config["environment"]].replace("https://", ""),
            "environment": "broker_demo" if config["environment"] == "testnet" else "broker_live",
            "currency": "USD",
            "synthetic": False,
        }

    def probe(self, configuration, secret=None):
        config = normalize_bybit_configuration(configuration)
        api_key, _s = _checked_secret(secret)
        host = HOSTS[config["environment"]]
        key_info = self._signed_get(host, "/v5/user/query-api", {}, secret)["result"]
        permissions = key_info.get("permissions", {})
        if permissions.get("Withdraw"):
            raise AdapterError("connector.withdrawal_permission_must_be_disabled", 403)
        identity = self._identity(config, key_info, api_key)
        balance = self._signed_get(
            host, "/v5/account/wallet-balance", {"accountType": "UNIFIED"}, secret
        )["result"]
        capabilities = capability_results(["accountRead", "accountHistory"])
        for key in ("marketLive", "marketHistory"):
            capabilities[key] = {
                "state": "unknown",
                "reason": "Public market data is keyless on Bybit.",
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
                "accountType": "UNIFIED",
                "balanceAccounts": len(balance.get("list", [])),
                "withdrawalsEnabled": False,
                "scope": "Read-only v5 account/history; Phase B with user keys (testnet available).",
            },
        }

    def history(self, configuration, identity, window, cursor=None, secret=None):
        config = normalize_bybit_configuration(configuration)
        start, end = checked_window(window)
        host = HOSTS[config["environment"]]
        api_key, _s = _checked_secret(secret)
        key_info = self._signed_get(host, "/v5/user/query-api", {}, secret)["result"]
        if self._identity(config, key_info, api_key) != identity:
            raise AdapterError("connector.identity_changed", 409)
        params = {
            "category": "spot",
            "startTime": str(int(start.timestamp() * 1000)),
            "endTime": str(int(end.timestamp() * 1000)),
            "limit": "100",
        }
        if cursor:
            params["cursor"] = cursor
        result = self._signed_get(host, "/v5/execution/list", params, secret)["result"]
        events = []
        for row in result.get("list", []):
            events.append(
                {
                    "externalEventId": f"exec:{row['execId']}",
                    "kind": "fill",
                    "status": "confirmed",
                    "occurredAt": datetime.fromtimestamp(int(row["execTime"]) / 1000, tz=UTC)
                    .isoformat()
                    .replace("+00:00", "Z"),
                    "timeBasis": "provider-utc",
                    "payload": {
                        "symbol": row["symbol"],
                        "side": str(row.get("side", "")).lower(),
                        "quantity": _decimal_text(row["execQty"]),
                        "price": _decimal_text(row["execPrice"]),
                        "fee": _decimal_text(row["execFee"]),
                        "orderId": row.get("orderId"),
                    },
                }
            )
        next_cursor = result.get("nextPageCursor") or None
        return {
            "providerId": PROVIDER_ID,
            "adapterVersion": VERSION,
            "identity": identity,
            "window": dict(window),
            "cursor": cursor,
            "nextCursor": next_cursor,
            "events": events,
            "hasMore": bool(next_cursor),
            "complete": not next_cursor,
            "coverage": {
                "from": window["from"],
                "to": window["to"],
                "complete": not next_cursor,
                "timeBasis": "provider-utc",
                "observedAt": self._clock(),
            },
        }
