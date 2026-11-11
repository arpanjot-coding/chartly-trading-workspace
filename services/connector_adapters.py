"""Static, bounded P07 read-only adapters. No order dispatch or supplied code."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
from copy import deepcopy
from datetime import UTC, datetime, timedelta

VERSION = "p07-read-only-v1"
MAX_EVENTS = 200
CAPABILITIES = (
    "marketHistory",
    "marketLive",
    "accountHistory",
    "accountRead",
    "orderSubmit",
    "orderCancel",
    "protectiveOrders",
    "researchRead",
)
CAPABILITY_LABELS = {
    "marketHistory": "Saved market history",
    "marketLive": "Current quotes",
    "accountHistory": "Account history observations",
    "accountRead": "Account identity and details",
    "orderSubmit": "Order submission",
    "orderCancel": "Order cancellation",
    "protectiveOrders": "Native protective orders",
    "researchRead": "Research data",
}
FAULTS = (
    "none",
    "disconnect",
    "expired",
    "revoked",
    "rate_limit",
    "wrong_identity",
    "stale_quote",
    "duplicates",
    "reordered",
    "correction",
    "incomplete",
    "partial_fill",
    "unknown_submission",
)

# Discovery describes supported connection paths, not a claim that every vendor
# has an implemented/authenticated adapter. Only available adapters can be saved.
PLATFORM_DIRECTORY = {
    "alpaca": (
        "Alpaca",
        "brokerage",
        "Paper/live API access and account-key adapter certification are required.",
    ),
    "ibkr": (
        "Interactive Brokers",
        "brokerage",
        "Retail Web API requires a local Client Portal Gateway and entitled account.",
    ),
    "tradestation": (
        "TradeStation",
        "brokerage",
        "A permitted API application, OAuth account and SIM environment are required.",
    ),
    "tradier": (
        "Tradier",
        "brokerage",
        "An approved developer token and sandbox/account adapter are required.",
    ),
    "schwab": (
        "Charles Schwab / thinkorswim",
        "brokerage",
        "A registered developer application and entitled trading account are required.",
    ),
    "webull": (
        "Webull",
        "brokerage",
        "Account/region-specific official API access must be confirmed.",
    ),
    "tastytrade": (
        "tastytrade",
        "brokerage",
        "Official account API authentication and product support require verification.",
    ),
    "fidelity": (
        "Fidelity",
        "brokerage",
        "An approved connection path must be verified; no direct adapter is available here.",
    ),
    "ig": (
        "IG",
        "brokerage",
        "A permitted API key, demo account and product-specific adapter are required.",
    ),
    "capital-com": (
        "Capital.com",
        "brokerage",
        "Official API/account access and product permissions require verification.",
    ),
    "etoro": (
        "eToro",
        "brokerage",
        "Official third-party API eligibility must be verified for this account.",
    ),
    "plus500": (
        "Plus500",
        "brokerage",
        "An approved third-party connection path must be verified.",
    ),
    "ctrader": (
        "cTrader",
        "desktop",
        "Official OAuth application and demo account access are required; this is a direct API path.",
    ),
    "ninjatrader": (
        "NinjaTrader 8",
        "desktop",
        "A supported local C# AddOn and running terminal are required.",
    ),
    "mt4": (
        "MetaTrader 4",
        "desktop",
        "A separate local MQL4 bridge is required; the MT5 Python API cannot connect MT4.",
    ),
    "tradovate": (
        "Tradovate",
        "desktop",
        "Permitted API access or a separately supported desktop bridge is required.",
    ),
    "rithmic": (
        "Rithmic",
        "desktop",
        "Vendor conformance/data entitlements or an approved terminal integration are required.",
    ),
    "match-trader": (
        "Match-Trader",
        "desktop",
        "The broker/prop firm must permit tenant API access.",
    ),
    "dxtrade": ("DXtrade", "desktop", "The broker/prop firm must permit tenant API access."),
    "tradelocker": (
        "TradeLocker",
        "desktop",
        "Official account/environment API eligibility requires verification.",
    ),
    "quantower": ("Quantower", "desktop", "A separate supported platform integration is required."),
    "sierra-chart": (
        "Sierra Chart",
        "desktop",
        "A separate supported local transport and account adapter are required.",
    ),
    "motivewave": (
        "MotiveWave",
        "desktop",
        "A separate supported platform integration is required.",
    ),
    "snaptrade": (
        "SnapTrade",
        "brokerage",
        "An approved aggregator application, supported accounts and commercial terms are required.",
    ),
    "mesh": (
        "Mesh",
        "brokerage",
        "An approved aggregator application, supported accounts and commercial terms are required.",
    ),
}


class AdapterError(Exception):
    def __init__(self, code, status=400, retry_after=None):
        super().__init__(code)
        self.code = code
        self.status = status
        self.retry_after = retry_after


def utc_now():
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def instant(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z", value
    ):
        raise AdapterError("connector.utc_window_required")
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, OverflowError):
        raise AdapterError("connector.utc_window_required") from None
    if stamp.tzinfo is None or stamp.utcoffset() != timedelta(0):
        raise AdapterError("connector.utc_window_required")
    return stamp


def checked_window(window):
    if not isinstance(window, dict) or set(window) != {"from", "to"}:
        raise AdapterError("connector.invalid_window")
    start, end = instant(window["from"]), instant(window["to"])
    if not start < end or end - start > timedelta(days=31):
        raise AdapterError("connector.window_budget")
    return start, end


def checksum(value):
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
        ).encode()
    ).hexdigest()


def capability_results(supported=(), reasons=None):
    reasons = reasons or {}
    return {
        key: {
            "state": "supported" if key in supported else "unsupported",
            **({"reason": reasons[key]} if key in reasons else {}),
        }
        for key in CAPABILITIES
    }


def _description(
    provider, name, kind, synthetic, environments, supported=(), *, available=True, reason=None
):
    category = (
        "diagnostic"
        if synthetic
        else "desktop"
        if kind == "terminal"
        else "crypto"
        if provider
        in {
            "kraken-public",
            "kraken",
            "binance",
            "bybit",
            "coinbase",
            "okx",
            "bitget",
            "hyperliquid",
        }
        else "brokerage"
    )
    return {
        "id": provider,
        "name": name,
        "version": VERSION,
        "kind": kind,
        "synthetic": synthetic,
        "available": available,
        "category": category,
        "connectionMode": "diagnostic"
        if synthetic
        else "public-data"
        if provider == "kraken-public"
        else "account",
        "setupState": "available" if available else "prerequisites",
        **({"actionHref": "/historify?source=kraken"} if provider == "kraken-public" else {}),
        **({"reason": reason} if reason else {}),
        "environments": list(environments),
        "capabilities": [
            {
                "id": key,
                "label": CAPABILITY_LABELS[key],
                "supported": key in supported,
                **(
                    {"reason": "P07 has no financial dispatch interface."}
                    if key in {"orderSubmit", "orderCancel", "protectiveOrders"}
                    else {}
                ),
            }
            for key in CAPABILITIES
        ],
    }


def describe_provider(provider_id):
    if not isinstance(provider_id, str):
        raise AdapterError("connector.provider_not_supported", 404)
    if provider_id == "diagnostic":
        return _description(
            provider_id,
            "Diagnostic connection (synthetic)",
            "local",
            True,
            ["broker_demo"],
            ["accountRead", "accountHistory", "marketLive", "marketHistory"],
        )
    if provider_id == "mt5":
        available = importlib.util.find_spec("MetaTrader5") is not None
        return _description(
            provider_id,
            "MetaTrader 5 · selected running terminal",
            "terminal",
            False,
            ["broker_demo", "broker_live"],
            ["accountRead", "accountHistory"],
            available=available,
            reason=None
            if available
            else "Install the optional MetaTrader5 Python integration on Windows.",
        )
    if provider_id == "kraken-public":
        return _description(provider_id, "Kraken", "remote", False, ["data_only"])
    if provider_id == "kraken":
        return _description(
            provider_id,
            "Kraken · spot account (read-only)",
            "remote",
            False,
            ["broker_live"],
            ["accountRead", "accountHistory"],
        )
    if provider_id in {"binance", "bybit", "coinbase", "okx", "bitget"}:
        names = {
            "binance": "Binance · spot account (read-only)",
            "bybit": "Bybit · v5 account (read-only)",
            "coinbase": "Coinbase Advanced · account (read-only)",
            "okx": "OKX · v5 account (read-only)",
            "bitget": "Bitget · spot account (read-only)",
        }
        return _description(
            provider_id,
            names[provider_id],
            "remote",
            False,
            ["broker_live", "broker_demo"],
            ["accountRead", "accountHistory"],
        )
    if provider_id == "hyperliquid":
        return _description(
            provider_id,
            "Hyperliquid · wallet (read-only by address)",
            "remote",
            False,
            ["broker_live", "broker_demo"],
            ["accountRead", "accountHistory"],
        )
    if provider_id == "topstepx":
        return _description(
            provider_id,
            "TopstepX / ProjectX · prop account (read-only)",
            "remote",
            False,
            ["broker_demo"],
            ["accountRead", "accountHistory"],
        )
    if provider_id == "alpaca-paper":
        return _description(
            provider_id,
            "Alpaca · paper account (read-only)",
            "remote",
            False,
            ["broker_demo"],
            ["accountRead", "accountHistory"],
        )
    if provider_id in PLATFORM_DIRECTORY:
        name, category, reason = PLATFORM_DIRECTORY[provider_id]
        return {
            **_description(provider_id, name, "remote", False, [], available=False, reason=reason),
            "category": category,
            "setupState": "planned",
        }
    raise AdapterError("connector.provider_not_supported", 404)


def provider_catalog():
    return [
        describe_provider(key)
        for key in (
            "mt5",
            "kraken-public",
            "kraken",
            "binance",
            "bybit",
            "coinbase",
            "okx",
            "bitget",
            "hyperliquid",
            "topstepx",
            "alpaca-paper",
            *PLATFORM_DIRECTORY,
            "diagnostic",
        )
    ]


def normalize_configuration(provider_id, configuration):
    if provider_id == "diagnostic":
        account, fault = _diagnostic_config(configuration)
        return {"account": account, "fault": fault}
    if provider_id == "mt5":
        from services.connector_mt5 import normalize_mt5_configuration

        return normalize_mt5_configuration(configuration)
    if provider_id == "kraken":
        from services.connector_kraken import normalize_kraken_configuration

        return normalize_kraken_configuration(configuration)
    if provider_id == "binance":
        from services.connector_binance import normalize_binance_configuration

        return normalize_binance_configuration(configuration)
    if provider_id == "bybit":
        from services.connector_bybit import normalize_bybit_configuration

        return normalize_bybit_configuration(configuration)
    if provider_id == "coinbase":
        from services.connector_coinbase import normalize_coinbase_configuration

        return normalize_coinbase_configuration(configuration)
    if provider_id == "okx":
        from services.connector_okx import normalize_okx_configuration

        return normalize_okx_configuration(configuration)
    if provider_id == "bitget":
        from services.connector_bitget import normalize_bitget_configuration

        return normalize_bitget_configuration(configuration)
    if provider_id == "hyperliquid":
        from services.connector_hyperliquid import normalize_hyperliquid_configuration

        return normalize_hyperliquid_configuration(configuration)
    if provider_id == "topstepx":
        from services.connector_topstepx import normalize_topstepx_configuration

        return normalize_topstepx_configuration(configuration)
    if provider_id == "alpaca-paper":
        from services.connector_alpaca import normalize_alpaca_configuration

        return normalize_alpaca_configuration(configuration)
    if provider_id in {"kraken-public"}:
        if configuration != {}:
            raise AdapterError("connector.invalid_configuration")
        return {}
    raise AdapterError("connector.provider_not_supported", 404)


def _diagnostic_config(configuration):
    if not isinstance(configuration, dict) or set(configuration) - {"account", "fault"}:
        raise AdapterError("connector.invalid_configuration")
    account, fault = configuration.get("account", "alpha"), configuration.get("fault", "none")
    if account not in {"alpha", "beta"} or fault not in FAULTS:
        raise AdapterError("connector.invalid_configuration")
    return account, fault


def _fault(fault):
    values = {
        "disconnect": ("connector.offline", 503, None),
        "expired": ("connector.credential_expired", 401, None),
        "revoked": ("connector.credential_revoked", 403, None),
        "rate_limit": ("connector.rate_limited", 429, 30),
    }
    if fault in values:
        raise AdapterError(*values[fault])


def _diagnostic_identity(account):
    return {
        "providerId": "diagnostic",
        "externalId": "DIAGNOSTIC-" + account.upper(),
        "server": "Chartly Diagnostic",
        "environment": "broker_demo",
        "currency": "USD",
        "synthetic": True,
    }


class DiagnosticAdapter:
    def describe(self):
        return describe_provider("diagnostic")

    def probe(self, configuration, secret=None):
        account, fault = _diagnostic_config(configuration)
        _fault(fault)
        if fault == "wrong_identity":
            account = "beta" if account == "alpha" else "alpha"
        observed = utc_now()
        supported = ["accountRead", "accountHistory", "marketHistory", "marketLive"]
        capabilities = capability_results(supported)
        if fault == "stale_quote":
            capabilities["marketLive"] = {"state": "unknown", "reason": "connector.quote_stale"}
        return {
            "providerId": "diagnostic",
            "adapterVersion": VERSION,
            "identity": _diagnostic_identity(account),
            "permissions": [key for key in supported if capabilities[key]["state"] == "supported"],
            "observedAt": observed,
            "capabilities": capabilities,
            "details": {
                "synthetic": True,
                "scope": "Deterministic diagnostic fixtures; never real-provider evidence.",
                "quote": {
                    "symbol": "EXAMPLE",
                    "bid": "100",
                    "ask": "100.02",
                    "observedAt": (
                        (instant(observed) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
                        if fault == "stale_quote"
                        else observed
                    ),
                    "stale": fault == "stale_quote",
                },
            },
        }

    def history(self, configuration, identity, window, cursor=None, secret=None):
        account, fault = _diagnostic_config(configuration)
        _fault(fault)
        start, end = checked_window(window)
        observed = self.probe(configuration, secret)["identity"]
        if identity != observed:
            raise AdapterError("connector.identity_changed", 409)
        if cursor not in (None, "diagnostic-page-2"):
            raise AdapterError("connector.invalid_cursor")
        rows = []
        for number in (1, 2):
            opened = f"2026-11-01T{8 + number:02d}:00:00Z"
            closed = f"2026-11-01T{8 + number:02d}:02:00Z"
            event_id = f"diagnostic-{account}-trade-{number}"
            row = {
                "eventId": event_id,
                "eventType": "trade",
                "positionId": f"diagnostic-{account}-position-{number}",
                "openedAt": opened,
                "closedAt": closed,
                "symbol": "EXAMPLE",
                "side": "Buy",
                "quantity": "2",
                "entryPrice": "100",
                "exitPrice": "101.5" if fault == "correction" and number == 1 else "101",
                "grossPnl": "3" if fault == "correction" and number == 1 else "2",
                "commission": "0.2",
                "fees": "0.1",
                "swap": "0",
                "netPnl": "2.7" if fault == "correction" and number == 1 else "1.7",
                "currency": "USD",
                "quantityUnit": "shares",
            }
            rows.append(
                {
                    "externalEventId": event_id,
                    "revision": 2 if fault == "correction" and number == 1 else 1,
                    "kind": "trade",
                    "status": "confirmed",
                    "occurredAt": closed,
                    "payload": deepcopy(row),
                    "normalizedTrade": row,
                }
            )
        if fault == "duplicates":
            rows += deepcopy(rows)
        elif fault == "reordered":
            rows.reverse()
        elif fault in {"partial_fill", "unknown_submission"}:
            unknown = fault == "unknown_submission"
            rows = [
                {
                    "externalEventId": f"diagnostic-{account}-{fault}",
                    "revision": 1,
                    "kind": "order" if unknown else "fill",
                    "status": "unknown" if unknown else "partial",
                    "occurredAt": "2026-11-01T09:01:00Z",
                    "payload": {
                        "synthetic": True,
                        "state": "submission-unknown" if unknown else "partial-fill",
                        "confirmedQuantity": "0" if unknown else "1",
                        "reconciliationRequired": True,
                        "automaticResubmissions": 0,
                    },
                }
            ]
        rows = [row for row in rows if start <= instant(row["occurredAt"]) < end]
        complete, has_more, next_cursor = True, False, None
        if fault == "incomplete":
            rows = rows[:1] if cursor is None else rows[1:]
            complete, has_more, next_cursor = False, True, "diagnostic-page-2"
        return {
            "providerId": "diagnostic",
            "adapterVersion": VERSION,
            "identity": observed,
            "window": deepcopy(window),
            "cursor": cursor,
            "nextCursor": next_cursor,
            "events": rows,
            "hasMore": has_more,
            "complete": complete,
            "coverage": {
                **window,
                "complete": complete,
                "observedAt": utc_now(),
                **({"reason": "connector.incomplete_page"} if not complete else {}),
            },
        }


class KrakenPublicAdapter:
    def describe(self):
        return describe_provider("kraken-public")

    def probe(self, configuration, secret=None):
        if configuration != {} or secret is not None:
            raise AdapterError("connector.invalid_configuration")
        try:
            from utils.httpx_client import get_httpx_client

            with get_httpx_client().stream(
                "GET", "https://api.kraken.com/0/public/Time", timeout=10, follow_redirects=False
            ) as response:
                if response.status_code == 429:
                    raise AdapterError("connector.rate_limited", 429, 30)
                if response.status_code != 200:
                    raise AdapterError("connector.public_probe_unavailable", 503)
                data = bytearray()
                for chunk in response.iter_bytes(chunk_size=4096):
                    data.extend(chunk)
                    if len(data) > 16384:
                        raise AdapterError("connector.response_budget", 413)
                result = json.loads(bytes(data))
            if (
                not isinstance(result, dict)
                or result.get("error") != []
                or not isinstance(result.get("result"), dict)
                or type(result["result"].get("unixtime")) is not int
                or not 0 < result["result"]["unixtime"] < 253402300799
            ):
                raise AdapterError("connector.invalid_provider_response", 502)
        except AdapterError:
            raise
        except Exception:
            raise AdapterError("connector.public_probe_unavailable", 503) from None
        return {
            "providerId": "kraken-public",
            "adapterVersion": VERSION,
            "identity": {
                "providerId": "kraken-public",
                "externalId": "public-clock-service",
                "server": "api.kraken.com",
                "environment": "data_only",
                "currency": "XXX",
                "synthetic": False,
            },
            "permissions": [],
            "observedAt": utc_now(),
            "capabilities": capability_results(),
            "details": {
                "accountVerified": False,
                "currencyKnown": False,
                "scope": "Public server-time reachability only; no account, quotes, history or execution certified.",
                "providerTime": datetime.fromtimestamp(result["result"]["unixtime"], UTC)
                .isoformat()
                .replace("+00:00", "Z"),
            },
        }

    def history(self, configuration, identity, window, cursor=None, secret=None):
        raise AdapterError("connector.history_not_supported", 409)


def get_adapter(provider_id):
    if provider_id == "diagnostic":
        return DiagnosticAdapter()
    if provider_id == "mt5":
        from services.connector_mt5 import MT5Adapter

        return MT5Adapter()
    if provider_id == "kraken-public":
        return KrakenPublicAdapter()
    if provider_id == "kraken":
        from services.connector_kraken import KrakenAdapter

        return KrakenAdapter()
    if provider_id == "binance":
        from services.connector_binance import BinanceAdapter

        return BinanceAdapter()
    if provider_id == "bybit":
        from services.connector_bybit import BybitAdapter

        return BybitAdapter()
    if provider_id == "coinbase":
        from services.connector_coinbase import CoinbaseAdapter

        return CoinbaseAdapter()
    if provider_id == "okx":
        from services.connector_okx import OkxAdapter

        return OkxAdapter()
    if provider_id == "bitget":
        from services.connector_bitget import BitgetAdapter

        return BitgetAdapter()
    if provider_id == "hyperliquid":
        from services.connector_hyperliquid import HyperliquidAdapter

        return HyperliquidAdapter()
    if provider_id == "topstepx":
        from services.connector_topstepx import TopstepXAdapter

        return TopstepXAdapter()
    if provider_id == "alpaca-paper":
        from services.connector_alpaca import AlpacaPaperAdapter

        return AlpacaPaperAdapter()
    raise AdapterError("connector.provider_not_supported", 404)


def probe(provider_id, configuration, secret=None):
    return get_adapter(provider_id).probe(configuration, secret)


def history(provider_id, configuration, identity, window, cursor=None, secret=None):
    return get_adapter(provider_id).history(configuration, identity, window, cursor, secret)
