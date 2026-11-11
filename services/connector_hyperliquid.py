"""Read-only Hyperliquid account adapter (P08 repeat-per-exchange).

Hyperliquid account reads are keyless by wallet address — the info
API serves clearinghouse state and fills for any address. This
adapter therefore accepts **no secret at all** (a supplied secret is
refused): read-only is guaranteed by construction, not by key scope.
Trading would require wallet signing (EIP-712) and is out of scope.
"""

from __future__ import annotations

import json
import re
import urllib.error
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

PROVIDER_ID = "hyperliquid"
HOSTS = {
    "production": "https://api.hyperliquid.xyz",
    "testnet": "https://api.hyperliquid-testnet.xyz",
}
MAX_BYTES = 4 * 1024 * 1024
_ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}")
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")


def normalize_hyperliquid_configuration(configuration):
    if not isinstance(configuration, dict) or set(configuration) - {"environment", "walletAddress"}:
        raise AdapterError("connector.invalid_configuration")
    environment = configuration.get("environment", "production")
    address = configuration.get("walletAddress", "")
    if environment not in HOSTS or not _ADDRESS.fullmatch(address):
        raise AdapterError("connector.invalid_configuration")
    return {"environment": environment, "walletAddress": address.lower()}


def _refuse_secret(secret):
    if secret is not None:
        raise AdapterError("connector.secret_not_accepted_read_only_by_address", 409)


def _invalid(status=502):
    return AdapterError("connector.invalid_provider_response", status)


def _decimal_text(value):
    if not isinstance(value, str) or not _DECIMAL_TEXT.fullmatch(value):
        raise _invalid()
    return value


def map_meta(payload):
    return [
        {
            "nativeSymbol": row["name"],
            "baseAsset": row["name"],
            "quoteAsset": "USDC",
            "sizeDecimals": row.get("szDecimals"),
            "maxLeverage": row.get("maxLeverage"),
            "quantityUnit": "base_asset",
        }
        for row in payload.get("universe", [])
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


class HyperliquidAdapter:
    def __init__(self, transport=None, clock=None):
        self._transport = transport or _default_transport
        self._clock = clock or utc_now

    def describe(self):
        return describe_provider(PROVIDER_ID)

    def _info(self, host, payload):
        body = json.dumps(payload).encode()
        status, raw = self._transport(
            "POST", host + "/info", {"Content-Type": "application/json"}, body
        )
        if len(raw) > MAX_BYTES:
            raise AdapterError("connector.response_budget", 413)
        if status == 429:
            raise AdapterError("connector.rate_limited", 429)
        if status != 200:
            raise AdapterError("connector.provider_unavailable", 503)
        try:
            return json.loads(raw.decode("utf-8"), parse_float=str, parse_int=str)
        except (ValueError, UnicodeDecodeError):
            raise _invalid() from None

    def _identity(self, config):
        return {
            "providerId": PROVIDER_ID,
            "externalId": config["walletAddress"],
            "server": HOSTS[config["environment"]].replace("https://", ""),
            "environment": "broker_demo" if config["environment"] == "testnet" else "broker_live",
            "currency": "USD",
            "synthetic": False,
        }

    def probe(self, configuration, secret=None):
        _refuse_secret(secret)
        config = normalize_hyperliquid_configuration(configuration)
        host = HOSTS[config["environment"]]
        state = self._info(host, {"type": "clearinghouseState", "user": config["walletAddress"]})
        if not isinstance(state, dict) or "marginSummary" not in state:
            raise _invalid()
        identity = self._identity(config)
        capabilities = capability_results(["accountRead", "accountHistory"])
        for key in ("marketLive", "marketHistory"):
            capabilities[key] = {"state": "unknown", "reason": "Public info API is keyless."}
        return {
            "providerId": PROVIDER_ID,
            "adapterVersion": VERSION,
            "identity": identity,
            "permissions": ["accountRead", "accountHistory"],
            "observedAt": self._clock(),
            "capabilities": capabilities,
            "details": {
                "environment": config["environment"],
                "accountValue": _decimal_text(state["marginSummary"]["accountValue"]),
                "openPositions": len(state.get("assetPositions", [])),
                "auth": "none — address-scoped public reads; no secret accepted",
                "scope": "Read-only by construction. Trading (wallet signing) is out of scope.",
            },
        }

    def history(self, configuration, identity, window, cursor=None, secret=None):
        _refuse_secret(secret)
        config = normalize_hyperliquid_configuration(configuration)
        if cursor is not None:
            raise AdapterError("connector.invalid_cursor")
        if self._identity(config) != identity:
            raise AdapterError("connector.identity_changed", 409)
        start, end = checked_window(window)
        host = HOSTS[config["environment"]]
        rows = self._info(
            host,
            {
                "type": "userFillsByTime",
                "user": config["walletAddress"],
                "startTime": int(start.timestamp() * 1000),
                "endTime": int(end.timestamp() * 1000),
            },
        )
        if not isinstance(rows, list):
            raise _invalid()
        events = [
            {
                "externalEventId": f"fill:{row['tid']}",
                "kind": "fill",
                "status": "confirmed",
                "occurredAt": datetime.fromtimestamp(int(row["time"]) / 1000, tz=UTC)
                .isoformat()
                .replace("+00:00", "Z"),
                "timeBasis": "provider-utc",
                "payload": {
                    "symbol": row["coin"],
                    "side": "buy" if row.get("side") == "B" else "sell",
                    "quantity": _decimal_text(row["sz"]),
                    "price": _decimal_text(row["px"]),
                    "fee": _decimal_text(row["fee"]),
                    "closedPnl": _decimal_text(row["closedPnl"]),
                    "orderId": str(row["oid"]),
                    "hash": row.get("hash"),
                },
            }
            for row in rows
        ]
        return {
            "providerId": PROVIDER_ID,
            "adapterVersion": VERSION,
            "identity": identity,
            "window": dict(window),
            "cursor": cursor,
            "nextCursor": None,
            "events": events,
            "hasMore": False,
            "complete": len(rows) < 2000,
            "coverage": {
                "from": window["from"],
                "to": window["to"],
                "complete": len(rows) < 2000,
                "reason": None
                if len(rows) < 2000
                else "provider 2000-fill page bound hit; narrow the window",
                "timeBasis": "provider-utc",
                "observedAt": self._clock(),
            },
        }
