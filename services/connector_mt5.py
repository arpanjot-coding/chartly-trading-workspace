"""Read-only IPC attachment to one selected, already-running MT5 terminal.

There is deliberately no login, symbol selection, settings mutation or trading
method. Native timestamp alignment is unverified; raw history remains distinct
from canonical, UTC-aligned account executions.
"""

from __future__ import annotations

import base64
import importlib
import json
import math
import os
import re
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path, PureWindowsPath

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
from services.workspace_storage import WorkspaceError
from utils.keyed_locks import KeyedLocks

TERMINAL_PATH = "C:/Program Files/MetaTrader 5/terminal64.exe"
NATIVE_SYMBOL_PATTERN = re.compile(r"(?=[A-Za-z0-9._#+&-]*[A-Za-z0-9])[A-Za-z0-9._#+&-]{1,80}")
MAX_SNAPSHOT_HISTORY_ROWS = 500
_UNVERIFIED_TIME = "provider-epoch-unverified"
_ATTACHMENTS = KeyedLocks(name="read-only-mt5-attachment")


def _terminal_executable(value):
    if not isinstance(value, str) or not value or len(value) > 260:
        return None
    if any(ord(char) < 32 for char in value):
        return None
    path = PureWindowsPath(value)
    if (
        not path.is_absolute()
        or not re.fullmatch("[a-zA-Z]:", path.drive)
        or path.name.lower() != "terminal64.exe"
        or any(part == ".." or ":" in part for part in path.parts[1:])
    ):
        return None
    return path


def _allowed_terminals():
    paths = {PureWindowsPath(TERMINAL_PATH): TERMINAL_PATH}
    for value in os.getenv("CHARTLY_MT5_TERMINAL_PATHS", "").split(";"):
        path = _terminal_executable(value.strip())
        if path is not None:
            paths.setdefault(path, path.as_posix())
    return paths


def normalize_mt5_configuration(configuration):
    if not isinstance(configuration, dict) or set(configuration) - {"terminalPath", "symbol"}:
        raise AdapterError("connector.invalid_configuration")
    path = _allowed_terminals().get(
        _terminal_executable(configuration.get("terminalPath", TERMINAL_PATH))
    )
    if path is None:
        raise AdapterError("connector.terminal_not_allowlisted")
    symbol = configuration.get("symbol", "EURUSD")
    if not isinstance(symbol, str) or NATIVE_SYMBOL_PATTERN.fullmatch(symbol) is None:
        raise AdapterError("connector.invalid_symbol")
    return {"terminalPath": path, "symbol": symbol}


def _running_terminal(path):
    import psutil

    try:
        expected = Path(path).resolve(strict=True)
    except OSError:
        return False
    matched = False
    for process in psutil.process_iter(["name", "exe"]):
        try:
            if (
                (process.info["name"] or "").lower() == "terminal64.exe"
                and process.info["exe"]
                and Path(process.info["exe"]).resolve() == expected
            ):
                if matched:
                    # The SDK selects an executable path, not a process ID.
                    return False
                matched = True
        except (psutil.AccessDenied, psutil.NoSuchProcess, OSError):
            continue
    return matched


def _text(value, maximum=200):
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > maximum
        or any(ord(char) < 32 for char in value)
    ):
        raise AdapterError("connector.invalid_provider_response", 502)
    return value


def _decimal(value):
    try:
        result = Decimal(str(value))
    except (ValueError, InvalidOperation):
        raise AdapterError("connector.invalid_provider_response", 502) from None
    if not result.is_finite() or abs(result) > Decimal("1e24"):
        raise AdapterError("connector.invalid_provider_response", 502)
    return format(result, "f")


def _native_price(value, digits):
    """Format an MT5 float on the instrument's declared native price grid."""
    text = _decimal(value)
    if type(digits) is not int or not 0 <= digits <= 12:
        return text
    quantum = Decimal(1).scaleb(-digits)
    return format(Decimal(text).quantize(quantum), "f")


def _identity(sdk, account=None):
    if account is None:
        account = sdk.account_info()
    if account is None:
        raise AdapterError("connector.account_unavailable", 403)
    login = getattr(account, "login", None)
    if type(login) is not int or not 0 < login < 10**20:
        raise AdapterError("connector.invalid_provider_response", 502)
    mode = getattr(account, "trade_mode", None)
    if mode == getattr(sdk, "ACCOUNT_TRADE_MODE_DEMO", 0):
        environment = "broker_demo"
    elif mode == getattr(sdk, "ACCOUNT_TRADE_MODE_REAL", 2):
        environment = "broker_live"
    else:
        raise AdapterError("connector.environment_not_supported", 409)
    currency = _text(getattr(account, "currency", None), 12)
    if not re.fullmatch(r"[A-Z][A-Z0-9]{2,11}", currency):
        raise AdapterError("connector.invalid_provider_response", 502)
    return {
        "providerId": "mt5",
        "externalId": str(login),
        "server": _text(getattr(account, "server", None)),
        "environment": environment,
        "currency": currency,
        "synthetic": False,
    }


def _history_total(sdk, kind, start, end):
    count = getattr(sdk, f"history_{kind}_total", None)
    if count is None:
        raise AdapterError("connector.history_unavailable", 503)
    try:
        total = count(start, end)
    except Exception:
        raise AdapterError("connector.history_unavailable", 503) from None
    if type(total) is not int or total < 0:
        raise AdapterError("connector.history_unavailable", 503)
    return total


def _history_rows(sdk, kind, start, end, total, maximum):
    if total > maximum:
        raise AdapterError("connector.history_window_too_dense", 413)
    read = getattr(sdk, f"history_{kind}_get", None)
    if read is None:
        raise AdapterError("connector.history_unavailable", 503)
    try:
        rows = read(start, end)
    except Exception:
        raise AdapterError("connector.history_unavailable", 503) from None
    if not isinstance(rows, (tuple, list)):
        raise AdapterError("connector.history_unavailable", 503)
    if len(rows) > maximum:
        raise AdapterError("connector.response_budget", 413)
    if len(rows) != total:
        raise AdapterError("connector.history_changed_during_read", 409)
    return rows


def _history_slice(sdk, start, end):
    # Narrow the slice before allocating either book. A cursor must never
    # advance past rows excluded by the combined page budget.
    while True:
        deal_count = _history_total(sdk, "deals", start, end)
        order_count = _history_total(sdk, "orders", start, end)
        if deal_count + order_count <= MAX_EVENTS:
            break
        if end - start <= timedelta(seconds=1):
            raise AdapterError("connector.history_window_too_dense", 413)
        end = start + (end - start) / 2
    deals = _history_rows(sdk, "deals", start, end, deal_count, MAX_EVENTS - order_count)
    orders = _history_rows(sdk, "orders", start, end, order_count, MAX_EVENTS - deal_count)
    return end, deals, orders


def _identifier(row, field, *, optional=False):
    value = getattr(row, field, None)
    if optional and value is None:
        return None
    if type(value) is not int or not (0 if optional else 1) <= value < 2**64:
        raise AdapterError("connector.invalid_provider_response", 502)
    return str(value)


def _integer(row, field, *, optional=False):
    value = getattr(row, field, None)
    if optional and value is None:
        return None
    if type(value) is not int or not 0 <= value <= 2**31 - 1:
        raise AdapterError("connector.invalid_provider_response", 502)
    return value


def _raw_time(row, field, *, optional=False):
    value = getattr(row, f"{field}_msc", None)
    if value is None:
        seconds = getattr(row, field, None)
        value = seconds * 1000 if type(seconds) is int else seconds
    if optional and (value is None or type(value) is int and value == 0):
        return None
    if type(value) is not int or not 0 < value < 253402300799000:
        raise AdapterError("connector.invalid_provider_response", 502)
    return value


def _optional_decimal(row, field):
    value = getattr(row, field, None)
    return _decimal(value) if value is not None else None


def _history_symbol(row, *, optional=False):
    symbol = getattr(row, "symbol", "")
    if optional and symbol == "":
        return symbol  # Native cash adjustments can have no instrument.
    return _text(symbol, 80)


def _deal_payload(row):
    return {
        "ticket": _identifier(row, "ticket"),
        "type": _integer(row, "type"),
        "rawProviderTimeMsc": _raw_time(row, "time"),
        "symbol": _history_symbol(row, optional=True),
        **{key: _identifier(row, key, optional=True) for key in ("order", "position_id")},
        **{key: _integer(row, key, optional=True) for key in ("entry", "reason")},
        **{
            key: _optional_decimal(row, key)
            for key in ("volume", "price", "commission", "swap", "profit", "fee")
        },
    }


def _historical_order_payload(row):
    placed = _raw_time(row, "time_setup")
    closed = _raw_time(row, "time_done", optional=True)
    return {
        "ticket": _identifier(row, "ticket"),
        "symbol": _history_symbol(row),
        "type": _integer(row, "type"),
        "state": _integer(row, "state"),
        "reason": _integer(row, "reason", optional=True),
        "position_id": _identifier(row, "position_id", optional=True),
        "position_by_id": _identifier(row, "position_by_id", optional=True),
        "rawProviderSetupTimeMsc": placed,
        "rawProviderDoneTimeMsc": closed,
        "rawProviderTimeMsc": closed or placed,
        "volumeInitialLots": _decimal(getattr(row, "volume_initial", None)),
        "volumeCurrentLots": _decimal(getattr(row, "volume_current", None)),
        "priceOpen": _decimal(getattr(row, "price_open", None)),
    }


def _stamp(value):
    return value.isoformat().replace("+00:00", "Z")


def _snapshot_history_book(sdk, kind, start, end, limit, project):
    coverage = {
        "queryFrom": _stamp(start),
        "queryTo": _stamp(end),
        "status": "unavailable",
        "observedCount": None,
        "returnedCount": 0,
    }
    try:
        total = _history_total(sdk, kind, start, end)
        coverage["observedCount"] = total
        rows = _history_rows(sdk, kind, start, end, total, MAX_SNAPSHOT_HISTORY_ROWS)
        history = [project(row) for row in rows]
    except AdapterError as error:
        coverage["reason"] = error.code
        return [], coverage
    history.sort(key=lambda row: (row["rawProviderTimeMsc"], int(row["ticket"])), reverse=True)
    returned = history[:limit]
    coverage.update(
        status="limited" if total > limit else "read",
        returnedCount=len(returned),
    )
    return returned, coverage


def _market_sample(sdk, symbol, observed):
    result = {"symbol": symbol, "clockPolicy": "unverified-provider-epoch"}
    info = sdk.symbol_info(symbol)
    if info is None:
        result["reason"] = "connector.symbol_unavailable"
        return result
    fields = {
        "point": "point",
        "contractSize": "trade_contract_size",
        "volumeMin": "volume_min",
        "volumeMax": "volume_max",
        "volumeStep": "volume_step",
    }
    result["economics"] = {key: _decimal(getattr(info, field)) for key, field in fields.items()}
    digits = getattr(info, "digits", None)
    if type(digits) is not int or not 0 <= digits <= 18:
        raise AdapterError("connector.invalid_provider_response", 502)
    result["economics"]["digits"] = digits
    result["economics"]["quantityUnit"] = "provider-native-volume"
    result["economics"]["canonicalQuantityMappingVerified"] = False
    result["economics"]["currencyProfit"] = _text(getattr(info, "currency_profit", None), 12)
    tick = sdk.symbol_info_tick(symbol)
    if tick is not None:
        provider_time = getattr(tick, "time_msc", None)
        if type(provider_time) is not int:
            seconds = getattr(tick, "time", None)
            if type(seconds) is not int:
                raise AdapterError("connector.invalid_provider_response", 502)
            provider_time = seconds * 1000
        if not 0 < provider_time < 253402300799000:
            raise AdapterError("connector.invalid_provider_response", 502)
        bid, ask = _decimal(getattr(tick, "bid", None)), _decimal(getattr(tick, "ask", None))
        if Decimal(bid) <= 0 or Decimal(ask) < Decimal(bid):
            raise AdapterError("connector.invalid_provider_response", 502)
        result["quote"] = {
            "bid": bid,
            "ask": ask,
            "rawProviderTimeMsc": provider_time,
            "observedSkewSeconds": round(provider_time / 1000 - instant(observed).timestamp(), 3),
            "receivedAt": observed,
            "utcAlignmentVerified": False,
            "scope": "Current quote only; no historical spread reconstruction.",
        }
    rates = sdk.copy_rates_from_pos(symbol, getattr(sdk, "TIMEFRAME_M1", 1), 1, 5)
    if rates is not None:
        if len(rates) > 5:
            raise AdapterError("connector.response_budget", 413)
        stamps = [int(row["time"]) for row in rates]
        if any(not 0 < value < 253402300799 for value in stamps):
            raise AdapterError("connector.invalid_provider_response", 502)
        result["bars"] = {
            "providerClosedBarCount": len(rates),
            "interval": "M1",
            "rawProviderFirstTime": stamps[0] if stamps else None,
            "rawProviderLastTime": stamps[-1] if stamps else None,
            "utcAlignmentVerified": False,
        }
    return result


def _cursor(identity, window, after):
    value = {"version": 1, "identityHash": checksum(identity), "window": window, "after": after}
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()


def _resume(cursor, identity, window, start, end):
    if cursor is None:
        return start
    if not isinstance(cursor, str) or len(cursor) > 2048:
        raise AdapterError("connector.invalid_cursor")
    try:
        value = json.loads(base64.b64decode(cursor.encode(), altchars=b"-_", validate=True))
        if (
            not isinstance(value, dict)
            or set(value) != {"version", "identityHash", "window", "after"}
            or value["version"] != 1
            or value["identityHash"] != checksum(identity)
            # Saved ledger checkpoints normalize fractional seconds. Bind the
            # cursor to the exact UTC bounds, independent of their spelling.
            or checked_window(value["window"]) != (start, end)
        ):
            raise ValueError()
        after = instant(value["after"])
        if not start < after < end:
            raise ValueError()
        return after
    except (ValueError, TypeError, UnicodeError, AdapterError):
        raise AdapterError("connector.invalid_cursor") from None


class MT5Adapter:
    """Test injection is constructor-only; the production factory supplies none."""

    def __init__(self, sdk=None, terminal_checker=None, clock=None):
        self._sdk = sdk
        self._terminal_checker = terminal_checker or _running_terminal
        self._clock = clock or utc_now

    def describe(self):
        return describe_provider("mt5")

    @contextmanager
    def _attached(self, configuration, secret):
        config = normalize_mt5_configuration(configuration)
        if secret is not None:
            raise AdapterError("connector.terminal_uses_existing_session", 409)
        if not self._terminal_checker(config["terminalPath"]):
            raise AdapterError("connector.selected_terminal_not_running", 409)
        try:
            sdk = self._sdk if self._sdk is not None else importlib.import_module("MetaTrader5")
        except ImportError:
            raise AdapterError("connector.optional_sdk_unavailable", 503) from None
        try:
            with _ATTACHMENTS.hold("selected-terminal", timeout=5):
                try:
                    # Recheck immediately before initialize: no deliberate terminal launch.
                    if not self._terminal_checker(config["terminalPath"]):
                        raise AdapterError("connector.selected_terminal_not_running", 409)
                    # The native binding expects a Windows executable path;
                    # keep portable configuration separators out of its IPC call.
                    if not sdk.initialize(
                        str(PureWindowsPath(config["terminalPath"])), timeout=5000
                    ):
                        raise AdapterError("connector.terminal_attach_failed", 503)
                    terminal = sdk.terminal_info()
                    if terminal is None or getattr(terminal, "connected", False) is not True:
                        raise AdapterError("connector.terminal_offline", 503)
                    installed = getattr(terminal, "path", None)
                    expected = PureWindowsPath(config["terminalPath"]).parent
                    if not isinstance(installed, str) or PureWindowsPath(installed) != expected:
                        raise AdapterError("connector.terminal_identity_mismatch", 409)
                    yield sdk, config
                finally:
                    sdk.shutdown()
        except (AdapterError, WorkspaceError):
            raise
        except Exception:
            raise AdapterError("connector.terminal_read_failed", 503) from None

    @contextmanager
    def _market_attachment(self, configuration, binding):
        with self._attached(
            {**(binding["configuration"] if binding else {}), **configuration}, None
        ) as (sdk, _config):
            if binding and _identity(sdk) != binding["identity"]:
                raise AdapterError("connector.account_identity_mismatch", 409)
            yield sdk
            if binding and _identity(sdk) != binding["identity"]:
                raise AdapterError("connector.account_identity_mismatch", 409)

    def probe(self, configuration, secret=None):
        with self._attached(configuration, secret) as (sdk, config):
            identity = _identity(sdk)
            observed = self._clock()
            end = instant(observed)
            start = end - timedelta(days=1)
            capabilities = capability_results(["accountRead"])
            raw_history = {"available": False, "canonicalConversion": False}
            try:
                sample_end, deals, orders = _history_slice(sdk, start, end)
                raw_history = {
                    "available": True,
                    "sampleCount": len(deals) + len(orders),
                    "dealSampleCount": len(deals),
                    "orderSampleCount": len(orders),
                    "window": {"from": _stamp(start), "to": _stamp(sample_end)},
                    "timeBasis": "provider-epoch-unverified",
                    "canonicalConversion": False,
                }
                capabilities["accountHistory"] = {
                    "state": "supported",
                    "reason": "Bounded raw order and deal observations. UTC coverage and canonical journal conversion remain unverified.",
                }
            except AdapterError as error:
                raw_history["reason"] = error.code
                capabilities["accountHistory"] = {"state": "unknown", "reason": error.code}
            for key in ("marketLive", "marketHistory"):
                capabilities[key] = {
                    "state": "unknown",
                    "reason": "connector.provider_clock_unverified",
                }
            market = _market_sample(sdk, config["symbol"], observed)
            if _identity(sdk) != identity:
                raise AdapterError("connector.identity_changed", 409)
            version = sdk.version()
            if not isinstance(version, (tuple, list)) or len(version) > 5:
                raise AdapterError("connector.invalid_provider_response", 502)
            return {
                "providerId": "mt5",
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
                    "sdkVersion": str(getattr(sdk, "__version__", "unknown"))[:80],
                    "terminalVersion": list(version),
                    "clockPolicy": "unverified-provider-epoch",
                    "rawHistory": raw_history,
                    "marketSample": market,
                    "scope": "Current account identity/currency and bounded raw history; no trading, timestamp calibration or broad journal conversion.",
                },
            }

    # -- market feed reads (candles/quote for charting; still read-only) ----

    _TIMEFRAMES = {
        60: ("TIMEFRAME_M1", 1),
        300: ("TIMEFRAME_M5", 5),
        900: ("TIMEFRAME_M15", 15),
        3600: ("TIMEFRAME_H1", 16385),
        14400: ("TIMEFRAME_H4", 16388),
        86400: ("TIMEFRAME_D1", 16408),
    }

    def _skew_seconds(self, sdk, symbol):
        tick = sdk.symbol_info_tick(symbol)
        if tick is None:
            raise AdapterError("connector.symbol_unavailable", 404)
        provider_time = getattr(tick, "time_msc", None)
        if type(provider_time) is not int:
            seconds = getattr(tick, "time", None)
            if type(seconds) is not int:
                raise AdapterError("connector.invalid_provider_response", 502)
            provider_time = seconds * 1000
        observed = instant(self._clock()).timestamp()
        return tick, round(provider_time / 1000 - observed, 3), provider_time

    def market_quote(self, symbol, binding=None):
        with self._market_attachment({"symbol": symbol}, binding) as sdk:
            info = sdk.symbol_info(symbol)
            if info is None:
                raise AdapterError("connector.symbol_unavailable", 404)
            digits = getattr(info, "digits", None)
            tick, skew, provider_time = self._skew_seconds(sdk, symbol)
            bid = _native_price(getattr(tick, "bid", None), digits)
            ask = _native_price(getattr(tick, "ask", None), digits)
            if Decimal(bid) <= 0 or Decimal(ask) < Decimal(bid):
                raise AdapterError("connector.invalid_provider_response", 502)
            return {
                "symbol": symbol,
                "bid": bid,
                "ask": ask,
                "priceDigits": digits if type(digits) is int else None,
                "rawProviderTimeMsc": provider_time,
                "observedSkewSeconds": skew,
                "receivedAt": self._clock(),
                "utcAlignmentVerified": False,
                "timeBasis": "provider-epoch-unverified",
            }

    def market_candles(self, symbol, interval_seconds, limit, binding=None):
        """Read native bars without guessing a timezone from tick age.

        MetaQuotes documents UTC epochs, but this selected terminal's alignment
        has no native verification yet. Consumers may inspect the raw series
        using a labelled native-time axis. UTC-sensitive use requires separate
        evidence for the terminal, server and historical range.
        """
        if interval_seconds not in self._TIMEFRAMES:
            raise AdapterError("connector.interval_not_supported", 400)
        if type(limit) is not int or not 1 <= limit <= 1000:
            raise AdapterError("connector.invalid_limit", 400)
        name, fallback = self._TIMEFRAMES[interval_seconds]
        with self._market_attachment({"symbol": symbol}, binding) as sdk:
            info = sdk.symbol_info(symbol)
            if info is None:
                raise AdapterError("connector.symbol_unavailable", 404)
            digits = getattr(info, "digits", None)
            rates = sdk.copy_rates_from_pos(symbol, getattr(sdk, name, fallback), 0, limit)
            if rates is None or len(rates) == 0:
                raise AdapterError("connector.market_history_unavailable", 409)
            if len(rates) > limit:
                raise AdapterError("connector.response_budget", 413)
            received = self._clock()
            candles = []
            previous = -1
            for row in rates:
                stamp = int(row["time"])
                if not 0 < stamp < 253402300799 or stamp <= previous:
                    raise AdapterError("connector.invalid_provider_response", 502)
                previous = stamp
                candles.append(
                    {
                        "symbol": symbol,
                        "rawProviderOpenTimeMs": stamp * 1000,
                        "open": _native_price(float(row["open"]), digits),
                        "high": _native_price(float(row["high"]), digits),
                        "low": _native_price(float(row["low"]), digits),
                        "close": _native_price(float(row["close"]), digits),
                        "priceDigits": digits if type(digits) is int else None,
                        "tickVolume": _decimal(float(row["tick_volume"])),
                        "receivedAt": received,
                        "clockPolicy": "native-read-only",
                        "utcAlignmentVerified": False,
                        "timeBasis": "provider-epoch-unverified",
                    }
                )
            return candles

    def market_symbols(self, query="", limit=100, binding=None):
        """Broker-native symbol list for chart search (read-only).

        Broker symbols carry prefixes/suffixes (EURUSDm, GBPUSD.pro,
        #AAPL), so matching is alphanumeric-normalized: typing
        "GBP USD" or "gbpusd" finds the broker's exact native name,
        which is returned unchanged — candle requests must use the
        native spelling, never a normalized guess.
        """
        if not isinstance(query, str) or len(query) > 80:
            raise AdapterError("connector.invalid_query", 400)
        if type(limit) is not int or not 1 <= limit <= 200:
            raise AdapterError("connector.invalid_limit", 400)
        needle = re.sub(r"[^A-Za-z0-9]", "", query).upper()
        lowered = query.strip().lower()
        with self._market_attachment({}, binding) as sdk:
            rows = sdk.symbols_get()
            if rows is None:
                raise AdapterError("connector.symbols_unavailable", 503)
            if len(rows) > 20000:
                raise AdapterError("connector.response_budget", 413)
            matches = []
            for row in rows:
                name = getattr(row, "name", None)
                if not isinstance(name, str) or NATIVE_SYMBOL_PATTERN.fullmatch(name) is None:
                    continue
                description = getattr(row, "description", "")
                if not isinstance(description, str):
                    description = ""
                description = "".join(char for char in description if ord(char) >= 32).strip()[:120]
                normalized = re.sub(r"[^A-Za-z0-9]", "", name).upper()
                if needle:
                    if needle not in normalized and lowered not in description.lower():
                        continue
                    rank = (
                        0
                        if name == query.strip()
                        else 1
                        if normalized == needle
                        else 2
                        if normalized.startswith(needle)
                        else 3
                    )
                else:
                    rank = 0 if getattr(row, "visible", False) is True else 1
                digits = getattr(row, "digits", None)
                matches.append(
                    (
                        rank,
                        # Closest plain spelling first: GBPUSDm before
                        # GBPUSD.pro for a "GBPUSD" search.
                        len(normalized),
                        name,
                        {
                            "symbol": name,
                            "description": description or name,
                            "digits": digits if type(digits) is int else None,
                        },
                    )
                )
            matches.sort(key=lambda item: (item[0], item[1], item[2]))
            return [item[3] for item in matches[:limit]]

    def account_snapshot(
        self, history_days=7, history_limit=200, include_history=True, binding=None
    ):
        """Read account money, open positions, working orders and two history books.

        The native query is padded past the observation time to include raw
        broker-clock rows ahead of wall time. Its bounds describe the query
        sent to the terminal, without claiming verified UTC coverage.
        """
        from services import mt5_reads
        from services.platform_bridge import BridgeError

        if type(history_days) is not int or not 1 <= history_days <= 90:
            raise AdapterError("connector.invalid_window", 400)
        if type(history_limit) is not int or not 1 <= history_limit <= 500:
            raise AdapterError("connector.invalid_limit", 400)
        if type(include_history) is not bool:
            raise AdapterError("request.invalid", 400)
        with self._attached(binding["configuration"] if binding else {}, None) as (sdk, _config):
            account = sdk.account_info()
            if account is None:
                raise AdapterError("connector.account_unavailable", 403)
            identity = _identity(sdk, account)
            if binding and identity != binding["identity"]:
                raise AdapterError("connector.account_identity_mismatch", 409)
            observed = instant(self._clock())
            book_errors = {}

            def read_book(name, read, *args):
                try:
                    return read(sdk, *args)
                except (AdapterError, BridgeError) as exc:
                    book_errors[name] = exc.code
                    return []

            positions = read_book("positions", mt5_reads.read_positions)
            orders = read_book("orders", mt5_reads.read_orders)
            history, historical_orders = [], []
            coverage = None
            if include_history:
                start = observed - timedelta(days=history_days)
                end = observed + timedelta(days=2)
                history, deals_coverage = _snapshot_history_book(
                    sdk, "deals", start, end, history_limit, _deal_payload
                )
                historical_orders, orders_coverage = _snapshot_history_book(
                    sdk, "orders", start, end, history_limit, _historical_order_payload
                )
                for key, result in (
                    ("history", deals_coverage),
                    ("historicalOrders", orders_coverage),
                ):
                    if result["status"] == "unavailable":
                        book_errors[key] = result["reason"]
                coverage = {
                    "utcAlignmentVerified": False,
                    "deals": deals_coverage,
                    "orders": orders_coverage,
                }
            # The terminal can change accounts independently of Chartly.
            if _identity(sdk) != identity:
                raise AdapterError("connector.account_identity_mismatch", 409)
            leverage = getattr(account, "leverage", None)
            return {
                "providerId": "mt5",
                "identity": identity,
                "account": {
                    "balance": _decimal(account.balance),
                    "credit": _decimal(getattr(account, "credit", 0)),
                    "profit": _decimal(account.profit),
                    "equity": _decimal(account.equity),
                    "margin": _decimal(account.margin),
                    "marginFree": _decimal(account.margin_free),
                    "marginLevel": _decimal(account.margin_level),
                    "leverage": leverage if type(leverage) is int else None,
                    "currency": identity["currency"],
                },
                "positions": positions,
                "orders": orders,
                "history": history,
                "historicalOrders": historical_orders,
                "historyDays": history_days,
                "historyLoaded": include_history and "history" not in book_errors,
                "historyCoverage": coverage,
                "bookErrors": book_errors,
                "observedAt": _stamp(observed),
                "timeBasis": _UNVERIFIED_TIME,
            }

    def history(self, configuration, identity, window, cursor=None, secret=None):
        start, end = checked_window(window)
        after = _resume(cursor, identity, window, start, end)
        page_end = min(after + timedelta(days=1), end)
        with self._attached(configuration, secret) as (sdk, _config):
            observed_identity = _identity(sdk)
            if observed_identity != identity:
                raise AdapterError("connector.identity_changed", 409)
            page_end, deals, orders = _history_slice(sdk, after, page_end)
            observed = self._clock()
            events = []
            for deal in deals:
                payload = _deal_payload(deal)
                events.append(
                    {
                        "externalEventId": "deal:" + payload["ticket"],
                        "kind": "fill" if payload["type"] in (0, 1) else "cashflow",
                        "status": "confirmed",
                        "occurredAt": observed,
                        "timeBasis": "receipt-only",
                        "payload": {**payload, "timeBasis": _UNVERIFIED_TIME},
                    }
                )
            for order in orders:
                payload = _historical_order_payload(order)
                events.append(
                    {
                        "externalEventId": "order:" + payload["ticket"],
                        "kind": "order",
                        "status": {
                            2: "cancelled",
                            3: "partial",
                            4: "confirmed",
                            5: "rejected",
                            6: "cancelled",
                        }.get(payload["state"], "unknown"),
                        "occurredAt": observed,
                        "timeBasis": "receipt-only",
                        "payload": {**payload, "timeBasis": _UNVERIFIED_TIME},
                    }
                )
            if _identity(sdk) != identity:
                raise AdapterError("connector.identity_changed", 409)
        more = page_end < end
        return {
            "providerId": "mt5",
            "adapterVersion": VERSION,
            "identity": observed_identity,
            "window": dict(window),
            "cursor": cursor,
            "nextCursor": _cursor(identity, window, _stamp(page_end)) if more else None,
            "events": events,
            "hasMore": more,
            "complete": False,
            "coverage": {
                "from": _stamp(after),
                "to": _stamp(page_end),
                "complete": False,
                "reason": "connector.provider_clock_unverified",
                "timeBasis": "receipt-only",
                "observedAt": observed,
            },
        }
