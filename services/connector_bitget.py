"""Read-only Bitget v2 spot account adapter (P08 repeat-per-exchange)."""

from __future__ import annotations

import base64
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

PROVIDER_ID = "bitget"
HOST = "https://api.bitget.com"
MAX_BYTES = 4 * 1024 * 1024
_SYMBOL = re.compile(r"[A-Z0-9]{3,24}")
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")


def normalize_bitget_configuration(configuration):
    if (
        not isinstance(configuration, dict)
        or set(configuration) - {"symbols", "environment"}
        or configuration.get("environment", "production") != "production"
    ):
        raise AdapterError("connector.invalid_configuration")
    symbols = configuration.get("symbols", ["BTCUSDT"])
    if (
        not isinstance(symbols, list)
        or not 1 <= len(symbols) <= 5
        or not all(isinstance(s, str) and _SYMBOL.fullmatch(s) for s in symbols)
    ):
        raise AdapterError("connector.invalid_configuration")
    return {"environment": "production", "symbols": symbols}


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


def sign(api_secret, timestamp_ms, method, request_path, body=""):
    message = f"{timestamp_ms}{method}{request_path}{body}"
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
            "nativeSymbol": row["symbol"],
            "baseAsset": row.get("baseCoin"),
            "quoteAsset": row.get("quoteCoin"),
            "status": row.get("status"),
            # Bitget publishes decimal precision, not a tick. The derived
            # tick is exact (10^-precision) and labelled as derived.
            "tickSize": None,
            "tickSizeDerived": (
                "0." + "0" * (int(row["pricePrecision"]) - 1) + "1"
                if str(row.get("pricePrecision", "")).isdigit() and int(row["pricePrecision"]) > 0
                else "1"
                if str(row.get("pricePrecision", "")) == "0"
                else None
            ),
            "pricePrecision": row.get("pricePrecision"),
            "quantityPrecision": row.get("quantityPrecision"),
            "minQuantity": row.get("minTradeAmount"),
            "minNotional": row.get("minTradeUSDT"),
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


class BitgetAdapter:
    def __init__(self, transport=None, clock=None, wall_ms=None):
        self._transport = transport or _default_transport
        self._clock = clock or utc_now
        self._wall_ms = wall_ms or (lambda: int(time.time() * 1000))

    def describe(self):
        return describe_provider(PROVIDER_ID)

    def _signed_get(self, path, params, secret):
        api_key, api_secret, passphrase = _checked_secret(secret)
        query = urllib.parse.urlencode(list(params.items()))
        request_path = path + (f"?{query}" if query else "")
        timestamp = str(self._wall_ms())
        headers = {
            "ACCESS-KEY": api_key,
            "ACCESS-SIGN": sign(api_secret, timestamp, "GET", request_path),
            "ACCESS-TIMESTAMP": timestamp,
            "ACCESS-PASSPHRASE": passphrase,
        }
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
        if parsed.get("code") not in ("00000", 0):
            raise AdapterError("connector.provider_rejected", 400)
        return parsed

    def _identity(self, info, api_key):
        external = info.get("userId") or key_fingerprint(api_key)
        return {
            "providerId": PROVIDER_ID,
            "externalId": str(external),
            "server": "api.bitget.com",
            "environment": "broker_live",
            "currency": "USD",
            "synthetic": False,
        }

    def probe(self, configuration, secret=None):
        config = normalize_bitget_configuration(configuration)
        api_key, _s, _p = _checked_secret(secret)
        info = self._signed_get("/api/v2/spot/account/info", {}, secret)["data"]
        authorities = [str(row).lower() for row in info.get("authorities", [])]
        if any("withdraw" in row for row in authorities):
            raise AdapterError("connector.withdrawal_permission_must_be_disabled", 403)
        identity = self._identity(info, api_key)
        assets = self._signed_get("/api/v2/spot/account/assets", {}, secret)["data"]
        capabilities = capability_results(["accountRead", "accountHistory"])
        for key in ("marketLive", "marketHistory"):
            capabilities[key] = {
                "state": "unknown",
                "reason": "Public market data is keyless on Bitget.",
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
                "assetRows": len(assets),
                "withdrawalsEnabled": False,
                "scope": "Read-only v2 spot account/history; Phase B with user keys.",
            },
        }

    def history(self, configuration, identity, window, cursor=None, secret=None):
        config = normalize_bitget_configuration(configuration)
        if cursor is not None:
            raise AdapterError("connector.invalid_cursor")
        start, end = checked_window(window)
        api_key, _s, _p = _checked_secret(secret)
        info = self._signed_get("/api/v2/spot/account/info", {}, secret)["data"]
        if self._identity(info, api_key) != identity:
            raise AdapterError("connector.identity_changed", 409)
        events = []
        for symbol in config["symbols"]:
            rows = self._signed_get(
                "/api/v2/spot/trade/fills",
                {
                    "symbol": symbol,
                    "startTime": str(int(start.timestamp() * 1000)),
                    "endTime": str(int(end.timestamp() * 1000)),
                    "limit": "100",
                },
                secret,
            )["data"]
            for row in rows:
                events.append(
                    {
                        "externalEventId": f"fill:{symbol}:{row['tradeId']}",
                        "kind": "fill",
                        "status": "confirmed",
                        "occurredAt": datetime.fromtimestamp(int(row["cTime"]) / 1000, tz=UTC)
                        .isoformat()
                        .replace("+00:00", "Z"),
                        "timeBasis": "provider-utc",
                        "payload": {
                            "symbol": symbol,
                            "side": row.get("side"),
                            "quantity": _decimal_text(row["size"]),
                            "price": _decimal_text(row["priceAvg"]),
                            "fee": (row.get("feeDetail") or {}).get("totalFee"),
                            "orderId": row.get("orderId"),
                        },
                    }
                )
        events.sort(key=lambda row: row["occurredAt"])
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
                "observedAt": self._clock(),
                "symbols": config["symbols"],
            },
        }
