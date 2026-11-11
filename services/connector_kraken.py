"""Read-only Kraken spot private-account adapter (P08-T02).

Implements the P07 connector duck-type against Kraken's production spot
REST API. There is no Kraken spot sandbox; credentials are expected to be
query-only keys. This module never submits, cancels or modifies an order,
and keeps every provider number as exact text: private JSON is decoded
with numeric literals preserved as strings, never floats.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import threading
import time
import urllib.parse
from datetime import UTC, datetime, timedelta
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

PROVIDER_ID = "kraken"
REST_BASE = "https://api.kraken.com/0"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_BALANCE_ASSETS = 100
MAX_PAGES_PER_STREAM = 40
CLOCK_SKEW_LIMIT_SECONDS = 120
_CURRENCY = re.compile(r"[A-Z][A-Z0-9]{2,11}")
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")
_PRIVATE_ENDPOINTS = {"Balance", "TradesHistory", "ClosedOrders", "Ledgers"}
_CASHFLOW_LEDGER_TYPES = {"deposit", "withdrawal", "transfer"}


def _invalid(status=502):
    return AdapterError("connector.invalid_provider_response", status)


# --------------------------------------------------------------------------
# Configuration and credentials
# --------------------------------------------------------------------------


def normalize_kraken_configuration(configuration):
    if not isinstance(configuration, dict) or set(configuration) - {"quoteCurrency"}:
        raise AdapterError("connector.invalid_configuration")
    currency = configuration.get("quoteCurrency", "USD")
    if not isinstance(currency, str) or not _CURRENCY.fullmatch(currency):
        raise AdapterError("connector.invalid_configuration")
    return {"quoteCurrency": currency}


def _checked_secret(secret):
    if (
        not isinstance(secret, dict)
        or set(secret) != {"apiKey", "apiSecret"}
        or not all(isinstance(secret[key], str) and secret[key] for key in secret)
    ):
        raise AdapterError("connector.credential_required", 409)
    try:
        base64.b64decode(secret["apiSecret"], validate=True)
    except Exception:
        raise AdapterError("connector.credential_invalid", 400) from None
    return secret["apiKey"], secret["apiSecret"]


def key_fingerprint(api_key):
    return "key:" + hashlib.sha256(api_key.encode()).hexdigest()[:24]


# --------------------------------------------------------------------------
# Signing and nonce
# --------------------------------------------------------------------------


def sign_request(path, postdata, nonce, secret_b64):
    """Kraken API-Sign: base64(HMAC-SHA512(path + SHA256(nonce + postdata)))."""
    encoded = (str(nonce) + postdata).encode()
    message = path.encode() + hashlib.sha256(encoded).digest()
    mac = hmac.new(base64.b64decode(secret_b64), message, hashlib.sha512)
    return base64.b64encode(mac.digest()).decode()


_nonce_lock = threading.Lock()
_last_nonce = 0


def next_nonce(now_us=None):
    """Strictly increasing nonce (unix microseconds, process-guarded).

    Microsecond granularity keeps concurrent in-process callers ordered;
    wall-clock regression across processes remains a documented provider
    failure mode and surfaces as a nonce error, never a silent retry.
    """
    global _last_nonce
    candidate = int(now_us if now_us is not None else time.time() * 1_000_000)
    with _nonce_lock:
        _last_nonce = max(candidate, _last_nonce + 1)
        return _last_nonce


# --------------------------------------------------------------------------
# Exact decoding helpers
# --------------------------------------------------------------------------


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def decode_json_exact(content):
    try:
        return json.loads(
            content,
            object_pairs_hook=_unique,
            parse_float=str,
            parse_int=str,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError("constant")),
        )
    except (ValueError, RecursionError, UnicodeError):
        raise _invalid() from None


def _decimal_text(value, *, allow_negative=True):
    if not isinstance(value, str) or not _DECIMAL_TEXT.fullmatch(value):
        raise _invalid()
    if not allow_negative and value.startswith("-"):
        raise _invalid()
    try:
        parsed = Decimal(value)
    except InvalidOperation:
        raise _invalid() from None
    if not parsed.is_finite() or abs(parsed) > Decimal("1e39"):
        raise _invalid()
    return value


def _int_text(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,19}", value):
        raise _invalid()
    return int(value)


def _text(value, maximum=200):
    if (
        not isinstance(value, str)
        or not value
        or len(value) > maximum
        or any(ord(char) < 32 for char in value)
    ):
        raise _invalid()
    return value


def _unix_to_iso(value):
    """Provider unix-seconds text -> exact UTC ISO (microsecond precision)."""
    text = _decimal_text(value, allow_negative=False)
    try:
        parsed = Decimal(text)
    except InvalidOperation:
        raise _invalid() from None
    micros = parsed * 1_000_000
    if micros != micros.to_integral_value():
        # Sub-microsecond provider precision is rejected, never rounded.
        raise _invalid()
    total = int(micros)
    if not 0 < total < 253402300799_000_000:
        raise _invalid()
    stamp = datetime.fromtimestamp(total / 1_000_000, UTC)
    # Rebuild from integer parts so float division cannot drift the value.
    seconds, remainder = divmod(total, 1_000_000)
    stamp = datetime.fromtimestamp(seconds, UTC).replace(microsecond=remainder)
    return stamp.isoformat(timespec="microseconds").replace("+00:00", "Z")


# --------------------------------------------------------------------------
# Transport and provider client
# --------------------------------------------------------------------------


def _production_transport(method, url, headers, body):
    from utils.httpx_client import get_httpx_client

    with get_httpx_client().stream(
        method,
        url,
        headers=headers,
        content=body.encode() if body is not None else None,
        timeout=15,
        follow_redirects=False,
    ) as response:
        data = bytearray()
        for chunk in response.iter_bytes(chunk_size=16384):
            data.extend(chunk)
            if len(data) > MAX_RESPONSE_BYTES:
                raise AdapterError("connector.response_budget", 413)
        return response.status_code, bytes(data)


def _provider_error(errors):
    first = errors[0] if errors and isinstance(errors[0], str) else ""
    if first.startswith(
        ("EAPI:Rate limit exceeded", "EService:Throttled", "EGeneral:Too many requests")
    ):
        raise AdapterError("connector.rate_limited", 429, 30)
    if first.startswith("EGeneral:Permission denied"):
        raise AdapterError("connector.permission_denied", 403)
    if first.startswith(("EAPI:Invalid key", "EAPI:Invalid signature")):
        raise AdapterError("connector.credential_revoked", 403)
    if first.startswith("EAPI:Invalid nonce"):
        raise AdapterError("connector.nonce_rejected", 409)
    if first.startswith("EAPI:Feature disabled"):
        raise AdapterError("connector.provider_access_required", 409)
    raise _invalid()


class KrakenPrivateClient:
    def __init__(self, api_key, api_secret, *, transport=None, nonce_source=None):
        self._api_key = api_key
        self._api_secret = api_secret
        self._transport = transport or _production_transport
        self._nonce_source = nonce_source or next_nonce

    def _call(self, method, url, headers, body):
        try:
            status, content = self._transport(method, url, headers, body)
        except AdapterError:
            raise
        except Exception:
            raise AdapterError("connector.provider_unavailable", 503) from None
        if status == 429:
            raise AdapterError("connector.rate_limited", 429, 30)
        if status != 200:
            raise AdapterError("connector.provider_unavailable", 503)
        if len(content) > MAX_RESPONSE_BYTES:
            raise AdapterError("connector.response_budget", 413)
        value = decode_json_exact(content)
        if not isinstance(value, dict) or not isinstance(value.get("error"), list):
            raise _invalid()
        if value["error"]:
            _provider_error(value["error"])
        result = value.get("result")
        if not isinstance(result, dict):
            raise _invalid()
        return result

    def server_time(self):
        result = self._call("GET", REST_BASE + "/public/Time", {}, None)
        return _int_text(result.get("unixtime"))

    def private(self, endpoint, params=()):
        if endpoint not in _PRIVATE_ENDPOINTS:
            raise AdapterError("connector.endpoint_not_supported", 400)
        nonce = str(self._nonce_source())
        payload = [("nonce", nonce), *params]
        postdata = urllib.parse.urlencode(payload)
        path = "/0/private/" + endpoint
        headers = {
            "API-Key": self._api_key,
            "API-Sign": sign_request(path, postdata, nonce, self._api_secret),
            "Content-Type": "application/x-www-form-urlencoded",
        }
        return self._call("POST", REST_BASE + "/private/" + endpoint, headers, postdata)


# --------------------------------------------------------------------------
# Response decoding into connector events
# --------------------------------------------------------------------------


def _next_cursor(result):
    cursor = result.get("cursor")
    if isinstance(cursor, dict):
        nxt = cursor.get("next")
        if isinstance(nxt, str) and 0 < len(nxt) <= 1024:
            return nxt
    return None


def _side(value):
    if value not in {"buy", "sell"}:
        raise _invalid()
    return value


def decode_trades(result):
    trades = result.get("trades")
    if not isinstance(trades, dict) or len(trades) > 200:
        raise _invalid()
    events = []
    for txid, trade in trades.items():
        if not isinstance(trade, dict):
            raise _invalid()
        events.append(
            {
                "externalEventId": _text(txid, 80),
                "kind": "fill",
                "status": "confirmed",
                "occurredAt": _unix_to_iso(trade.get("time")),
                "timeBasis": "provider",
                "payload": {
                    "nativePair": _text(trade.get("pair"), 40),
                    "side": _side(trade.get("type")),
                    "orderType": _text(trade.get("ordertype"), 40),
                    "price": _decimal_text(trade.get("price")),
                    "cost": _decimal_text(trade.get("cost")),
                    "fee": _decimal_text(trade.get("fee")),
                    "volume": _decimal_text(trade.get("vol"), allow_negative=False),
                    "orderTxId": _text(trade.get("ordertxid"), 80),
                },
            }
        )
    return events, _next_cursor(result)


_ORDER_STATUS = {"closed": "confirmed", "canceled": "cancelled", "expired": "cancelled"}


def decode_closed_orders(result):
    closed = result.get("closed")
    if not isinstance(closed, dict) or len(closed) > 200:
        raise _invalid()
    events = []
    for txid, order in closed.items():
        if not isinstance(order, dict) or not isinstance(order.get("descr"), dict):
            raise _invalid()
        descr = order["descr"]
        native_status = order.get("status")
        if native_status not in _ORDER_STATUS:
            raise _invalid()
        occurred = order.get("closetm", order.get("opentm"))
        events.append(
            {
                "externalEventId": _text(txid, 80),
                "kind": "order",
                "status": _ORDER_STATUS[native_status],
                "occurredAt": _unix_to_iso(occurred),
                "timeBasis": "provider",
                "payload": {
                    "nativePair": _text(descr.get("pair"), 40),
                    "side": _side(descr.get("type")),
                    "orderType": _text(descr.get("ordertype"), 40),
                    "nativeStatus": native_status,
                    "volume": _decimal_text(order.get("vol"), allow_negative=False),
                    "volumeExecuted": _decimal_text(order.get("vol_exec"), allow_negative=False),
                    "cost": _decimal_text(order.get("cost")),
                    "fee": _decimal_text(order.get("fee")),
                    "averagePrice": _decimal_text(order.get("price")),
                },
            }
        )
    return events, _next_cursor(result)


def decode_ledgers(result):
    ledger = result.get("ledger")
    if not isinstance(ledger, dict) or len(ledger) > 200:
        raise _invalid()
    events = []
    skipped = 0
    for entry_id, entry in ledger.items():
        if not isinstance(entry, dict):
            raise _invalid()
        entry_type = entry.get("type")
        if entry_type not in _CASHFLOW_LEDGER_TYPES:
            # Trade/fee/spend/receive ledger rows duplicate TradesHistory
            # economics; T06 decides journal facts from fills, so only true
            # cash movements become observations here. The skip is counted.
            skipped += 1
            continue
        events.append(
            {
                "externalEventId": _text(entry_id, 80),
                "kind": "cashflow",
                "status": "confirmed",
                "occurredAt": _unix_to_iso(entry.get("time")),
                "timeBasis": "provider",
                "payload": {
                    "asset": _text(entry.get("asset"), 20),
                    "ledgerType": entry_type,
                    "amount": _decimal_text(entry.get("amount")),
                    "fee": _decimal_text(entry.get("fee")),
                    "referenceId": _text(entry.get("refid"), 80),
                },
            }
        )
    return events, _next_cursor(result), skipped


def decode_balances(result):
    if not isinstance(result, dict) or len(result) > 500:
        raise _invalid()
    balances = {}
    for asset, amount in result.items():
        balances[_text(asset, 20)] = _decimal_text(amount)
    nonzero = {asset: amount for asset, amount in balances.items() if Decimal(amount) != 0}
    if len(nonzero) > MAX_BALANCE_ASSETS:
        raise AdapterError("connector.response_budget", 413)
    return nonzero


# --------------------------------------------------------------------------
# Adapter cursor (bound to identity + window, per-stream provider cursors)
# --------------------------------------------------------------------------


def _encode_cursor(identity, window, streams):
    value = {"version": 1, "identityHash": checksum(identity), "window": window, "streams": streams}
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()


def _decode_cursor(cursor, identity, window, start, end):
    fresh = {"trades": None, "orders": None, "ledgers": None, "done": []}
    if cursor is None:
        return fresh
    if not isinstance(cursor, str) or len(cursor) > 4096:
        raise AdapterError("connector.invalid_cursor")
    try:
        value = json.loads(base64.b64decode(cursor.encode(), altchars=b"-_", validate=True))
        streams = value["streams"]
        if (
            not isinstance(value, dict)
            or set(value) != {"version", "identityHash", "window", "streams"}
            or value["version"] != 1
            or value["identityHash"] != checksum(identity)
            or checked_window(value["window"]) != (start, end)
            or not isinstance(streams, dict)
            or set(streams) != {"trades", "orders", "ledgers", "done"}
            or not all(
                streams[key] is None or isinstance(streams[key], str)
                for key in ("trades", "orders", "ledgers")
            )
            or not isinstance(streams["done"], list)
            or not set(streams["done"]) <= {"trades", "orders", "ledgers"}
        ):
            raise ValueError()
        return streams
    except (ValueError, TypeError, KeyError, UnicodeError, AdapterError):
        raise AdapterError("connector.invalid_cursor") from None


# --------------------------------------------------------------------------
# Adapter
# --------------------------------------------------------------------------


class KrakenAdapter:
    """Test injection is constructor-only; the production factory supplies none."""

    def __init__(self, transport=None, clock=None, nonce_source=None, instruments_fetcher=None):
        self._transport = transport
        self._clock = clock or utc_now
        self._nonce_source = nonce_source
        self._instruments_fetcher = instruments_fetcher

    def describe(self):
        return describe_provider(PROVIDER_ID)

    def _client(self, secret):
        api_key, api_secret = _checked_secret(secret)
        return KrakenPrivateClient(
            api_key, api_secret, transport=self._transport, nonce_source=self._nonce_source
        )

    def _identity(self, configuration, api_key):
        return {
            "providerId": PROVIDER_ID,
            "externalId": key_fingerprint(api_key),
            "server": "api.kraken.com",
            "environment": "broker_live",
            "currency": configuration["quoteCurrency"],
            "synthetic": False,
        }

    def _pair_info(self):
        """Native pair spelling -> {symbol, quoteCurrency} from AssetPairs."""
        try:
            if self._instruments_fetcher is not None:
                mapped = self._instruments_fetcher()
            else:
                from services.kraken_instruments import fetch_instrument_mapping

                mapped = fetch_instrument_mapping(
                    owner_id="kraken-instruments",
                    workspace_id="kraken-instruments",
                    observed_at=self._clock(),
                )
        except AdapterError:
            raise
        except Exception:
            raise AdapterError("connector.provider_unavailable", 503) from None
        info = {}
        for row in mapped.get("instruments", []):
            instrument = row["instrument"]["value"]
            entry = {
                "symbol": instrument["name"],
                "quoteCurrency": instrument["quoteCurrency"],
            }
            for spelling in row["spellings"]:
                info[spelling] = entry
            # TradesHistory reports the AssetPairs result key/altname; both
            # are in spellings. Also accept the economics native pair.
            info[row["economics"]["nativePair"]] = entry
        return info

    def _checked_clock(self, client):
        provider_time = client.server_time()
        local = instant(self._clock())
        skew = provider_time - local.timestamp()
        if abs(skew) > CLOCK_SKEW_LIMIT_SECONDS:
            raise AdapterError("connector.provider_clock_unverified", 409)
        return provider_time, round(skew, 3)

    def probe(self, configuration, secret=None):
        config = normalize_kraken_configuration(configuration)
        client = self._client(secret)
        api_key, _api_secret = _checked_secret(secret)
        provider_time, skew = self._checked_clock(client)
        balances = decode_balances(client.private("Balance"))
        identity = self._identity(config, api_key)
        capabilities = capability_results(["accountRead"])
        capabilities["marketHistory"] = {
            "state": "unsupported",
            "reason": "Use the Kraken public Data Library source for saved candles.",
        }
        history_detail = {"available": False}
        try:
            end = instant(self._clock())
            start = end - timedelta(days=1)
            page = client.private(
                "TradesHistory",
                [
                    ("start", str(int(start.timestamp()))),
                    ("end", str(int(end.timestamp()))),
                    ("with_cursor", "true"),
                    ("limit", "100"),
                ],
            )
            sample, _cursor = decode_trades(page)
            capabilities["accountHistory"] = {"state": "supported"}
            history_detail = {"available": True, "sampleCount": len(sample)}
        except AdapterError as error:
            capabilities["accountHistory"] = {"state": "unknown", "reason": error.code}
            history_detail["reason"] = error.code
        permissions = [
            key
            for key in ("accountRead", "accountHistory")
            if capabilities[key]["state"] == "supported"
        ]
        return {
            "providerId": PROVIDER_ID,
            "adapterVersion": VERSION,
            "identity": identity,
            "permissions": permissions,
            "observedAt": self._clock(),
            "capabilities": capabilities,
            "details": {
                "scope": "Read-only Kraken spot account observations. Identity is key-scoped; Kraken exposes no account number. Journal projection is limited to the configured quote currency.",
                "quoteCurrency": config["quoteCurrency"],
                "balances": balances,
                "history": history_detail,
                "providerTime": datetime.fromtimestamp(provider_time, UTC)
                .isoformat()
                .replace("+00:00", "Z"),
                "clockSkewSeconds": skew,
                "clockVerified": True,
            },
        }

    def history(self, configuration, identity, window, cursor=None, secret=None):
        config = normalize_kraken_configuration(configuration)
        client = self._client(secret)
        api_key, _api_secret = _checked_secret(secret)
        if identity != self._identity(config, api_key):
            raise AdapterError("connector.identity_changed", 409)
        start, end = checked_window(window)
        self._checked_clock(client)
        streams = _decode_cursor(cursor, identity, window, start, end)
        events = []
        trade_fills = []
        plan = (
            ("trades", "TradesHistory", decode_trades, [("limit", "100")]),
            ("orders", "ClosedOrders", decode_closed_orders, []),
            ("ledgers", "Ledgers", decode_ledgers, []),
        )
        for name, endpoint, decoder, extra in plan:
            if name in streams["done"]:
                continue
            pages = 0
            while len(events) < MAX_EVENTS and pages < MAX_PAGES_PER_STREAM:
                params = [("with_cursor", "true"), *extra]
                if streams[name] is None:
                    # First page of this stream carries the window; later
                    # pages are addressed by the provider cursor alone.
                    params += [
                        ("start", str(int(start.timestamp()))),
                        ("end", str(int(end.timestamp()))),
                    ]
                else:
                    params.append(("cursor", streams[name]))
                decoded = decoder(client.private(endpoint, params))
                if name == "ledgers":
                    page_events, next_cursor, _skipped = decoded
                else:
                    page_events, next_cursor = decoded
                pages += 1
                streams[name] = next_cursor
                if name == "trades":
                    # Keep every decoded fill (including pre-window pages)
                    # as FIFO context for journal derivation below.
                    trade_fills.extend(page_events)
                for event in page_events:
                    if start <= instant(event["occurredAt"]) < end:
                        events.append(event)
                if next_cursor is None:
                    streams["done"].append(name)
                    break
                if not page_events and name != "ledgers":
                    # An empty page with a cursor would spin; treat the
                    # stream as exhausted rather than looping on trust.
                    streams["done"].append(name)
                    break
            if len(events) >= MAX_EVENTS:
                events = events[:MAX_EVENTS]
                break
        complete = set(streams["done"]) == {"trades", "orders", "ledgers"}
        derivation_incomplete = False
        window_sells = {
            fill["externalEventId"]
            for fill in trade_fills
            if fill["payload"]["side"] == "sell" and start <= instant(fill["occurredAt"]) < end
        }
        if window_sells:
            from services.kraken_journal import derive_closed_trades

            trade_events, report = derive_closed_trades(
                [
                    {
                        "txid": fill["externalEventId"],
                        "occurredAt": fill["occurredAt"],
                        "pair": fill["payload"]["nativePair"],
                        "side": fill["payload"]["side"],
                        "price": fill["payload"]["price"],
                        "volume": fill["payload"]["volume"],
                        "fee": fill["payload"]["fee"],
                    }
                    for fill in trade_fills
                ],
                quote_currency=config["quoteCurrency"],
                pair_info=self._pair_info(),
                emit_sell_ids=window_sells,
            )
            if len(events) + len(trade_events) > MAX_EVENTS:
                raise AdapterError("connector.history_window_too_dense", 413)
            events.extend(trade_events)
            # Unmatched sells with provider history still unfetched mean the
            # FIFO context is incomplete; exhausted history means the sells
            # genuinely have no in-account buys and stay unprojected.
            derivation_incomplete = (
                report["unmatchedSellQuantity"] != "0" and "trades" not in streams["done"]
            )
        if derivation_incomplete:
            complete = False
        return {
            "providerId": PROVIDER_ID,
            "adapterVersion": VERSION,
            "identity": identity,
            "window": dict(window),
            "cursor": cursor,
            "nextCursor": None if complete else _encode_cursor(identity, window, streams),
            "events": events,
            "hasMore": not complete,
            "complete": complete,
            "coverage": {
                **window,
                "complete": complete,
                "observedAt": self._clock(),
                **(
                    {
                        "reason": "kraken.fifo_context_incomplete"
                        if derivation_incomplete
                        else "connector.incomplete_page"
                    }
                    if not complete
                    else {}
                ),
            },
        }
