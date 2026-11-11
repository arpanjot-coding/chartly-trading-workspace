"""Read-only Alpaca Paper brokerage adapter (P10).

Implements the P07 connector duck-type against Alpaca's paper Trading
API. Paper is a real, free, credential-issued demo environment, so this
is the P08 two-phase pattern again: fixture-verified mapping here,
Phase-B certification with the user's own paper keys. The adapter never
submits/cancels orders (P11) and refuses the live base URL outright —
`environment` is fixed to paper in this package. Numbers arrive from
Alpaca as JSON strings and stay exact text.
"""

from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from services.connector_adapters import (
    MAX_EVENTS,
    VERSION,
    AdapterError,
    capability_results,
    checked_window,
    checksum,
    describe_provider,
    instant,
    utc_now,
)

PROVIDER_ID = "alpaca-paper"
PAPER_BASE = "https://paper-api.alpaca.markets"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
_CURRENCY = re.compile(r"[A-Z][A-Z0-9]{2,11}")
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")
_FILL = "FILL"
_CASH_TYPES = {"CSD", "CSW", "DIV", "DIVNRA", "INT", "JNLCASH", "FEE"}


def normalize_alpaca_configuration(configuration):
    if (
        not isinstance(configuration, dict)
        or set(configuration) - {"feed", "environment"}
        or configuration.get("environment", "paper") != "paper"
    ):
        raise AdapterError("connector.invalid_configuration")
    feed = configuration.get("feed", "iex")
    if feed not in {"iex", "sip"}:
        raise AdapterError("connector.invalid_configuration")
    return {"feed": feed, "environment": "paper"}


def _checked_secret(secret):
    if (
        not isinstance(secret, dict)
        or set(secret) != {"apiKey", "apiSecret"}
        or not all(isinstance(secret[key], str) and secret[key] for key in secret)
    ):
        raise AdapterError("connector.credential_required", 409)
    return secret["apiKey"], secret["apiSecret"]


def _invalid(status=502):
    return AdapterError("connector.invalid_provider_response", status)


def _decimal_text(value):
    if not isinstance(value, str) or not _DECIMAL_TEXT.fullmatch(value):
        raise _invalid()
    try:
        Decimal(value)
    except InvalidOperation:
        raise _invalid() from None
    return value


def _default_transport(method, url, headers):
    request = urllib.request.Request(url, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        return error.code, error.read(MAX_RESPONSE_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError):
        raise AdapterError("connector.provider_unreachable", 503) from None


def map_alpaca_asset(payload):
    """Map one Alpaca asset to instrument metadata (T04).

    US equities trade in shares (fractional where flagged); the native
    symbol is kept verbatim and the exchange/listing are explicit.
    """
    if not isinstance(payload, dict):
        raise _invalid()
    symbol = payload.get("symbol")
    if not isinstance(symbol, str) or not symbol:
        raise _invalid()
    return {
        "nativeSymbol": symbol,
        "name": payload.get("name"),
        "exchange": payload.get("exchange"),
        "assetClass": payload.get("class"),
        "status": payload.get("status"),
        "tradable": bool(payload.get("tradable")),
        "fractionable": bool(payload.get("fractionable")),
        "quantityUnit": "shares",
        "currency": "USD",
        "minOrderSize": _decimal_text(payload["min_order_size"])
        if payload.get("min_order_size") is not None
        else None,
        "minTradeIncrement": _decimal_text(payload["min_trade_increment"])
        if payload.get("min_trade_increment") is not None
        else None,
    }


class AlpacaPaperAdapter:
    """Test injection is constructor-only; production supplies transport."""

    def __init__(self, transport=None, clock=None):
        self._transport = transport or _default_transport
        self._clock = clock or utc_now

    def describe(self):
        return describe_provider(PROVIDER_ID)

    def _get(self, path, secret, params=None):
        api_key, api_secret = _checked_secret(secret)
        query = ("?" + urllib.parse.urlencode(params)) if params else ""
        status, body = self._transport(
            "GET",
            PAPER_BASE + path + query,
            {"APCA-API-KEY-ID": api_key, "APCA-API-SECRET-KEY": api_secret},
        )
        if len(body) > MAX_RESPONSE_BYTES:
            raise AdapterError("connector.response_budget", 413)
        if status in (401, 403):
            raise AdapterError("connector.credential_rejected", 401)
        if status == 429:
            raise AdapterError("connector.rate_limited", 429)
        if status != 200:
            raise AdapterError("connector.provider_unavailable", 503)
        try:
            return json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise _invalid() from None

    def _identity(self, account):
        if not isinstance(account, dict):
            raise _invalid()
        number = account.get("account_number")
        status = account.get("status")
        currency = account.get("currency")
        if (
            not isinstance(number, str)
            or not number
            or status != "ACTIVE"
            or not isinstance(currency, str)
            or not _CURRENCY.fullmatch(currency)
        ):
            raise AdapterError("connector.account_unavailable", 403)
        return {
            "providerId": PROVIDER_ID,
            "externalId": number,
            "server": "paper-api.alpaca.markets",
            "environment": "broker_demo",
            "currency": currency,
            "synthetic": False,
        }

    def probe(self, configuration, secret=None):
        normalize_alpaca_configuration(configuration)
        account = self._get("/v2/account", secret)
        identity = self._identity(account)
        observed = self._clock()
        positions = self._get("/v2/positions", secret)
        if not isinstance(positions, list) or len(positions) > MAX_EVENTS:
            raise _invalid()
        capabilities = capability_results(
            ["accountRead"],
            reasons={
                "marketLive": "connector.entitlement_unverified",
                "marketHistory": "connector.entitlement_unverified",
            },
        )
        capabilities["marketLive"] = {
            "state": "unknown",
            "reason": "An open data entitlement is not probed by account access; feed/plan checks are separate (T05).",
        }
        capabilities["marketHistory"] = dict(capabilities["marketLive"])
        history_state = "unknown"
        sample = 0
        try:
            end = instant(observed)
            start = end - timedelta(days=1)
            activities = self._activities(secret, start, end)
            sample = len(activities)
            history_state = "supported"
        except AdapterError:
            pass
        if history_state == "supported":
            capabilities["accountHistory"] = {"state": "supported"}
        if self._identity(self._get("/v2/account", secret)) != identity:
            raise AdapterError("connector.identity_changed", 409)
        return {
            "providerId": PROVIDER_ID,
            "adapterVersion": VERSION,
            "identity": identity,
            "permissions": [
                key
                for key in ("accountRead", "accountHistory")
                if capabilities[key]["state"] == "supported"
            ],
            "observedAt": observed,
            "capabilities": capabilities,
            "details": {
                "environment": "paper",
                "positionsObserved": len(positions),
                "historySampleCount": sample,
                "cash": _decimal_text(account.get("cash", "0")),
                "buyingPower": _decimal_text(account.get("buying_power", "0")),
                "scope": "Paper account identity/positions/history reads only; no order dispatch (P11) and the live API is refused by construction.",
            },
        }

    def _activities(self, secret, start, end, page_token=None):
        params = {
            "activity_types": ",".join(sorted({_FILL, *_CASH_TYPES})),
            "after": start.isoformat().replace("+00:00", "Z"),
            "until": end.isoformat().replace("+00:00", "Z"),
            "direction": "asc",
            "page_size": 100,
        }
        if page_token:
            params["page_token"] = page_token
        rows = self._get("/v2/account/activities", secret, params)
        if not isinstance(rows, list) or len(rows) > 100:
            raise _invalid()
        return rows

    def _cursor(self, identity, window, page_token):
        value = {
            "version": 1,
            "identityHash": checksum(identity),
            "window": window,
            "page": page_token,
        }
        return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()

    def _resume(self, cursor, identity, window):
        if cursor is None:
            return None
        try:
            value = json.loads(base64.b64decode(cursor.encode(), altchars=b"-_", validate=True))
            if (
                not isinstance(value, dict)
                or value.get("version") != 1
                or value.get("identityHash") != checksum(identity)
                or value.get("window") != window
                or not isinstance(value.get("page"), str)
            ):
                raise ValueError()
            return value["page"]
        except (ValueError, TypeError, UnicodeError):
            raise AdapterError("connector.invalid_cursor") from None

    def history(self, configuration, identity, window, cursor=None, secret=None):
        normalize_alpaca_configuration(configuration)
        start, end = checked_window(window)
        page_token = self._resume(cursor, identity, window)
        account = self._get("/v2/account", secret)
        if self._identity(account) != identity:
            raise AdapterError("connector.identity_changed", 409)
        rows = self._activities(secret, start, end, page_token)
        observed = self._clock()
        events = []
        for row in rows:
            if not isinstance(row, dict):
                raise _invalid()
            activity_id = row.get("id")
            kind = row.get("activity_type")
            when = row.get("transaction_time") or row.get("date")
            if not isinstance(activity_id, str) or not activity_id or not isinstance(when, str):
                raise _invalid()
            payload = {"activityType": kind, "symbol": row.get("symbol")}
            for key, field in (
                ("quantity", "qty"),
                ("price", "price"),
                ("netAmount", "net_amount"),
                ("perShareAmount", "per_share_amount"),
            ):
                value = row.get(field)
                payload[key] = _decimal_text(value) if value is not None else None
            payload["side"] = row.get("side")
            payload["orderId"] = row.get("order_id")
            events.append(
                {
                    "externalEventId": "activity:" + activity_id,
                    "kind": "fill" if kind == _FILL else "cashflow",
                    "status": "confirmed",
                    "occurredAt": when,
                    "timeBasis": "provider-utc",
                    "payload": payload,
                }
            )
        more = len(rows) == 100
        next_token = rows[-1]["id"] if more else None
        return {
            "providerId": PROVIDER_ID,
            "adapterVersion": VERSION,
            "identity": identity,
            "window": dict(window),
            "cursor": cursor,
            "nextCursor": self._cursor(identity, window, next_token) if more else None,
            "events": events,
            "hasMore": more,
            "complete": not more,
            "coverage": {
                "from": window["from"],
                "to": window["to"],
                "complete": not more,
                "timeBasis": "provider-utc",
                "observedAt": observed,
            },
        }
