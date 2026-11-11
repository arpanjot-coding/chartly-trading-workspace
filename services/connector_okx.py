"""Read-only OKX v5 account adapter (P08 repeat-per-exchange).

HMAC signing with passphrase; keys whose permission string includes
withdraw are refused at probe. Demo trading uses the same host with
the `x-simulated-trading: 1` header — modelled as environment=demo.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
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

PROVIDER_ID = "okx"
HOST = "https://www.okx.com"
MAX_BYTES = 4 * 1024 * 1024
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")


def normalize_okx_configuration(configuration):
    if not isinstance(configuration, dict) or set(configuration) - {"environment"}:
        raise AdapterError("connector.invalid_configuration")
    environment = configuration.get("environment", "production")
    if environment not in {"production", "demo"}:
        raise AdapterError("connector.invalid_configuration")
    return {"environment": environment}


def _checked_secret(secret):
    if (
        not isinstance(secret, dict)
        or set(secret) != {"apiKey", "apiSecret", "passphrase"}
        or not all(isinstance(secret[k], str) and secret[k] for k in secret)
    ):
        raise AdapterError("connector.credential_required", 409)
    return secret["apiKey"], secret["apiSecret"], secret["passphrase"]


def key_fingerprint(api_key):
    return "key:" + hashlib.sha256(api_key.encode()).hexdigest()[:24]


def sign(api_secret, timestamp, method, request_path, body=""):
    message = f"{timestamp}{method}{request_path}{body}"
    mac = hmac.new(api_secret.encode(), message.encode(), hashlib.sha256)
    return base64.b64encode(mac.digest()).decode()


def _invalid(status=502):
    return AdapterError("connector.invalid_provider_response", status)


def _decimal_text(value):
    if not isinstance(value, str) or not _DECIMAL_TEXT.fullmatch(value):
        raise _invalid()
    return value


def map_instruments(payload):
    return [
        {
            "nativeSymbol": row["instId"],
            "baseAsset": row.get("baseCcy"),
            "quoteAsset": row.get("quoteCcy"),
            "status": row.get("state"),
            "tickSize": row.get("tickSz"),
            "quantityStep": row.get("lotSz"),
            "minQuantity": row.get("minSz"),
            "quantityUnit": "base_asset",
        }
        for row in payload.get("data", [])
    ]


def _default_transport(method, url, headers, body=None):
    request = urllib.request.Request(url, method=method, headers=headers, data=body)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as error:
        return error.code, error.read(MAX_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError):
        raise AdapterError("connector.provider_unreachable", 503) from None


class OkxAdapter:
    def __init__(self, transport=None, clock=None):
        self._transport = transport or _default_transport
        self._clock = clock or utc_now

    def describe(self):
        return describe_provider(PROVIDER_ID)

    def _signed_get(self, path, params, secret, *, demo=False):
        api_key, api_secret, passphrase = _checked_secret(secret)
        query = urllib.parse.urlencode(list(params.items()))
        request_path = path + (f"?{query}" if query else "")
        timestamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        headers = {
            "OK-ACCESS-KEY": api_key,
            "OK-ACCESS-SIGN": sign(api_secret, timestamp, "GET", request_path),
            "OK-ACCESS-TIMESTAMP": timestamp,
            "OK-ACCESS-PASSPHRASE": passphrase,
        }
        if demo:
            headers["x-simulated-trading"] = "1"
        status, body = self._transport("GET", HOST + request_path, headers)
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
        if parsed.get("code") not in ("0", 0):
            raise AdapterError("connector.provider_rejected", 400)
        return parsed

    def _identity(self, config, account_config, api_key):
        external = account_config.get("uid") or key_fingerprint(api_key)
        return {
            "providerId": PROVIDER_ID,
            "externalId": str(external),
            "server": "www.okx.com",
            "environment": "broker_demo" if config["environment"] == "demo" else "broker_live",
            "currency": "USD",
            "synthetic": False,
        }

    def probe(self, configuration, secret=None):
        config = normalize_okx_configuration(configuration)
        api_key, _s, _p = _checked_secret(secret)
        demo = config["environment"] == "demo"
        account_config = self._signed_get("/api/v5/account/config", {}, secret, demo=demo)["data"][
            0
        ]
        if "withdraw" in str(account_config.get("perm", "")).lower():
            raise AdapterError("connector.withdrawal_permission_must_be_disabled", 403)
        identity = self._identity(config, account_config, api_key)
        balance = self._signed_get("/api/v5/account/balance", {}, secret, demo=demo)["data"]
        capabilities = capability_results(["accountRead", "accountHistory"])
        for key in ("marketLive", "marketHistory"):
            capabilities[key] = {
                "state": "unknown",
                "reason": "Public market data is keyless on OKX.",
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
                "accountLevel": account_config.get("acctLv"),
                "balanceRows": len(balance),
                "withdrawalsEnabled": False,
                "scope": "Read-only v5 account/history; Phase B with user keys (demo mode available).",
            },
        }

    def history(self, configuration, identity, window, cursor=None, secret=None):
        config = normalize_okx_configuration(configuration)
        demo = config["environment"] == "demo"
        start, end = checked_window(window)
        api_key, _s, _p = _checked_secret(secret)
        account_config = self._signed_get("/api/v5/account/config", {}, secret, demo=demo)["data"][
            0
        ]
        if self._identity(config, account_config, api_key) != identity:
            raise AdapterError("connector.identity_changed", 409)
        params = {
            "instType": "SPOT",
            "begin": str(int(start.timestamp() * 1000)),
            "end": str(int(end.timestamp() * 1000)),
            "limit": "100",
        }
        if cursor:
            params["after"] = cursor
        rows = self._signed_get("/api/v5/trade/fills", params, secret, demo=demo)["data"]
        events = [
            {
                "externalEventId": f"fill:{row['tradeId']}",
                "kind": "fill",
                "status": "confirmed",
                "occurredAt": datetime.fromtimestamp(int(row["ts"]) / 1000, tz=UTC)
                .isoformat()
                .replace("+00:00", "Z"),
                "timeBasis": "provider-utc",
                "payload": {
                    "symbol": row["instId"],
                    "side": row.get("side"),
                    "quantity": _decimal_text(row["fillSz"]),
                    "price": _decimal_text(row["fillPx"]),
                    "fee": _decimal_text(row["fee"]),
                    "feeCurrency": row.get("feeCcy"),
                    "orderId": row.get("ordId"),
                },
            }
            for row in rows
        ]
        next_cursor = rows[-1]["billId"] if len(rows) == 100 and rows[-1].get("billId") else None
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
