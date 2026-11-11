"""Read-only TopstepX (ProjectX) account adapter (P09/P10 web path).

ProjectX became exclusive to Topstep in Feb 2026. Auth: POST
/api/Auth/loginKey {userName, apiKey} -> bearer token. Phase-A
fixture pattern; endpoint shapes follow the public ProjectX gateway
API and are Phase-B verified with the user's Topstep API key.
Topstep accounts are prop evaluation/funded simulation accounts, so
identity environment is broker_demo with that stated in details.
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.error
import urllib.request

from services.connector_adapters import (
    VERSION,
    AdapterError,
    capability_results,
    checked_window,
    describe_provider,
    utc_now,
)

PROVIDER_ID = "topstepx"
BASE = "https://api.topstepx.com"
MAX_BYTES = 4 * 1024 * 1024
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")


def normalize_topstepx_configuration(configuration):
    if (
        not isinstance(configuration, dict)
        or set(configuration) - {"accountId", "environment"}
        or configuration.get("environment", "production") != "production"
    ):
        raise AdapterError("connector.invalid_configuration")
    account = configuration.get("accountId")
    if account is not None and (not isinstance(account, int) or account <= 0):
        raise AdapterError("connector.invalid_configuration")
    return {"environment": "production", "accountId": account}


def _checked_secret(secret):
    if (
        not isinstance(secret, dict)
        or set(secret) != {"userName", "apiKey"}
        or not all(isinstance(secret[k], str) and secret[k] for k in secret)
    ):
        raise AdapterError("connector.credential_required", 409)
    return secret["userName"], secret["apiKey"]


def key_fingerprint(api_key):
    return "key:" + hashlib.sha256(api_key.encode()).hexdigest()[:24]


def _invalid(status=502):
    return AdapterError("connector.invalid_provider_response", status)


def _decimal_text(value):
    if isinstance(value, (int, float)):
        value = str(value)
    if not isinstance(value, str) or not _DECIMAL_TEXT.fullmatch(value):
        raise _invalid()
    return value


def map_contracts(payload):
    return [
        {
            "nativeSymbol": row["id"],
            "name": row.get("name"),
            "description": row.get("description"),
            "tickSize": _decimal_text(row["tickSize"]) if row.get("tickSize") is not None else None,
            "tickValue": _decimal_text(row["tickValue"])
            if row.get("tickValue") is not None
            else None,
            "active": bool(row.get("activeContract")),
            "quantityUnit": "contract",
        }
        for row in payload.get("contracts", [])
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


class TopstepXAdapter:
    def __init__(self, transport=None, clock=None):
        self._transport = transport or _default_transport
        self._clock = clock or utc_now

    def describe(self):
        return describe_provider(PROVIDER_ID)

    def _post(self, path, payload, token=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        status, body = self._transport("POST", BASE + path, headers, json.dumps(payload).encode())
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
        if parsed.get("success") is False:
            raise AdapterError("connector.provider_rejected", 400)
        return parsed

    def _login(self, secret):
        user_name, api_key = _checked_secret(secret)
        result = self._post("/api/Auth/loginKey", {"userName": user_name, "apiKey": api_key})
        token = result.get("token")
        if not token:
            raise AdapterError("connector.credential_rejected", 401)
        return token

    def _account(self, config, secret):
        token = self._login(secret)
        accounts = self._post("/api/Account/search", {"onlyActiveAccounts": True}, token).get(
            "accounts", []
        )
        if not accounts:
            raise AdapterError("connector.account_unavailable", 403)
        if config.get("accountId") is not None:
            match = next(
                (r for r in accounts if str(r.get("id")) == str(config["accountId"])), None
            )
            if match is None:
                raise AdapterError("connector.account_unavailable", 403)
            return match, token
        return accounts[0], token

    def _identity(self, account, user_name):
        return {
            "providerId": PROVIDER_ID,
            "externalId": str(account["id"]),
            "server": "api.topstepx.com",
            "environment": "broker_demo",
            "currency": "USD",
            "synthetic": False,
            "accountName": account.get("name"),
            "user": user_name,
        }

    def probe(self, configuration, secret=None):
        config = normalize_topstepx_configuration(configuration)
        user_name, _key = _checked_secret(secret)
        account, token = self._account(config, secret)
        identity = self._identity(account, user_name)
        identity_view = {
            k: v
            for k, v in identity.items()
            if k in ("providerId", "externalId", "server", "environment", "currency", "synthetic")
        }
        positions = self._post(
            "/api/Position/searchOpen", {"accountId": int(account["id"])}, token
        ).get("positions", [])
        capabilities = capability_results(["accountRead", "accountHistory"])
        for key in ("marketLive", "marketHistory"):
            capabilities[key] = {
                "state": "unknown",
                "reason": "CME data entitlement is account-scoped via TopstepX; not probed by account access.",
            }
        return {
            "providerId": PROVIDER_ID,
            "adapterVersion": VERSION,
            "identity": identity_view,
            "permissions": ["accountRead", "accountHistory"],
            "observedAt": self._clock(),
            "capabilities": capabilities,
            "details": {
                "accountName": account.get("name"),
                "balance": _decimal_text(account["balance"])
                if account.get("balance") is not None
                else None,
                "canTradeFlag": bool(account.get("canTrade")),
                "openPositions": len(positions),
                "scope": "Read-only Topstep prop account/history. Environment is prop simulation (evaluation/funded), labelled broker_demo.",
            },
        }

    def history(self, configuration, identity, window, cursor=None, secret=None):
        config = normalize_topstepx_configuration(configuration)
        if cursor is not None:
            raise AdapterError("connector.invalid_cursor")
        start, end = checked_window(window)
        user_name, _key = _checked_secret(secret)
        account, token = self._account(config, secret)
        mine = self._identity(account, user_name)
        mine_view = {k: v for k, v in mine.items() if k in identity}
        if mine_view != identity:
            raise AdapterError("connector.identity_changed", 409)
        trades = self._post(
            "/api/Trade/search",
            {
                "accountId": int(account["id"]),
                "startTimestamp": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "endTimestamp": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            token,
        ).get("trades", [])
        events = []
        for row in trades:
            if row.get("voided"):
                continue
            events.append(
                {
                    "externalEventId": f"trade:{row['id']}",
                    "kind": "fill",
                    "status": "confirmed",
                    "occurredAt": row["creationTimestamp"],
                    "timeBasis": "provider-utc",
                    "payload": {
                        "contractId": row.get("contractId"),
                        "side": "buy" if str(row.get("side")) in ("0", "Buy") else "sell",
                        "quantity": _decimal_text(row["size"]),
                        "price": _decimal_text(row["price"]),
                        "fees": _decimal_text(row.get("fees", "0")),
                        "profitAndLoss": _decimal_text(row["profitAndLoss"])
                        if row.get("profitAndLoss") is not None
                        else None,
                        "orderId": str(row.get("orderId")),
                    },
                }
            )
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
            },
        }
