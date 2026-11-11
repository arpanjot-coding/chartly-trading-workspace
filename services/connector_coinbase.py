"""Read-only Coinbase Advanced Trade adapter (P08 repeat-per-exchange).

Auth is CDP JWT (ES256): key name + EC private key PEM. The token is
built per request with the documented `uri` claim. Read-only use
still depends on the key's own permissions at Coinbase — portfolio
keys can be created view-only there; Phase B verifies with user keys.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
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

PROVIDER_ID = "coinbase"
HOST = "api.coinbase.com"
BASE = f"https://{HOST}"
MAX_BYTES = 4 * 1024 * 1024
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")


def normalize_coinbase_configuration(configuration):
    if (
        not isinstance(configuration, dict)
        or set(configuration) - {"productId", "environment"}
        or configuration.get("environment", "production") != "production"
    ):
        raise AdapterError("connector.invalid_configuration")
    product = configuration.get("productId", "BTC-USD")
    if not isinstance(product, str) or not re.fullmatch(r"[A-Z0-9]{2,12}-[A-Z0-9]{2,12}", product):
        raise AdapterError("connector.invalid_configuration")
    return {"environment": "production", "productId": product}


def _checked_secret(secret):
    if (
        not isinstance(secret, dict)
        or set(secret) != {"keyName", "privateKeyPem"}
        or not all(isinstance(secret[k], str) and secret[k] for k in secret)
    ):
        raise AdapterError("connector.credential_required", 409)
    return secret["keyName"], secret["privateKeyPem"]


def key_fingerprint(key_name):
    return "key:" + hashlib.sha256(key_name.encode()).hexdigest()[:24]


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def build_jwt(key_name, private_key_pem, method, path, *, now_s, nonce=None):
    """Coinbase CDP JWT: ES256 over header.claims with `uri` binding."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    header = {
        "alg": "ES256",
        "kid": key_name,
        "nonce": nonce or secrets.token_hex(16),
        "typ": "JWT",
    }
    claims = {
        "sub": key_name,
        "iss": "cdp",
        "nbf": now_s,
        "exp": now_s + 120,
        "uri": f"{method} {HOST}{path}",
    }
    signing_input = (
        _b64url(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + _b64url(json.dumps(claims, separators=(",", ":")).encode())
    )
    # Coinbase PEMs are often stored with literal \n escapes.
    pem = private_key_pem.replace("\\n", "\n").encode()
    try:
        key = serialization.load_pem_private_key(pem, password=None)
    except Exception:
        raise AdapterError("connector.credential_invalid", 400) from None
    der = key.sign(signing_input.encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return signing_input + "." + _b64url(raw)


def _invalid(status=502):
    return AdapterError("connector.invalid_provider_response", status)


def _decimal_text(value):
    if not isinstance(value, str) or not _DECIMAL_TEXT.fullmatch(value):
        raise _invalid()
    return value


def map_products(payload):
    out = []
    for row in payload.get("products", []):
        increment = row.get("price_increment")
        out.append(
            {
                "nativeSymbol": row["product_id"],
                "baseAsset": row.get("base_currency_id"),
                "quoteAsset": row.get("quote_currency_id"),
                "status": row.get("status"),
                "tickSize": increment,
                "quantityStep": row.get("base_increment"),
                "minNotional": row.get("quote_min_size"),
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


class CoinbaseAdapter:
    def __init__(self, transport=None, clock=None, wall_s=None, jwt_builder=None):
        self._transport = transport or _default_transport
        self._clock = clock or utc_now
        self._wall_s = wall_s or (lambda: int(time.time()))
        self._jwt = jwt_builder or build_jwt

    def describe(self):
        return describe_provider(PROVIDER_ID)

    def _get(self, path, params, secret):
        key_name, pem = _checked_secret(secret)
        query = urllib.parse.urlencode(list(params.items()))
        token = self._jwt(key_name, pem, "GET", path, now_s=self._wall_s())
        url = BASE + path + (f"?{query}" if query else "")
        status, body = self._transport("GET", url, {"Authorization": f"Bearer {token}"})
        if len(body) > MAX_BYTES:
            raise AdapterError("connector.response_budget", 413)
        if status in (401, 403):
            raise AdapterError("connector.credential_rejected", 401)
        if status == 429:
            raise AdapterError("connector.rate_limited", 429)
        if status != 200:
            raise AdapterError("connector.provider_unavailable", 503)
        try:
            return json.loads(body.decode("utf-8"), parse_float=str, parse_int=str)
        except (ValueError, UnicodeDecodeError):
            raise _invalid() from None

    def _identity(self, accounts, key_name):
        first = accounts[0] if accounts else {}
        external = first.get("uuid") or key_fingerprint(key_name)
        return {
            "providerId": PROVIDER_ID,
            "externalId": str(external),
            "server": HOST,
            "environment": "broker_live",
            "currency": "USD",
            "synthetic": False,
        }

    def probe(self, configuration, secret=None):
        normalize_coinbase_configuration(configuration)
        key_name, _pem = _checked_secret(secret)
        accounts = self._get("/api/v3/brokerage/accounts", {"limit": "49"}, secret).get(
            "accounts", []
        )
        identity = self._identity(accounts, key_name)
        capabilities = capability_results(["accountRead", "accountHistory"])
        for key in ("marketLive", "marketHistory"):
            capabilities[key] = {
                "state": "unknown",
                "reason": "Public market products are keyless on Coinbase.",
            }
        return {
            "providerId": PROVIDER_ID,
            "adapterVersion": VERSION,
            "identity": identity,
            "permissions": ["accountRead", "accountHistory"],
            "observedAt": self._clock(),
            "capabilities": capabilities,
            "details": {
                "accounts": len(accounts),
                "auth": "CDP JWT (ES256), per-request uri-bound",
                "scope": "Read-only Advanced Trade accounts/fills. Create view-only CDP keys for read-only guarantees; Phase B with user keys.",
            },
        }

    def history(self, configuration, identity, window, cursor=None, secret=None):
        config = normalize_coinbase_configuration(configuration)
        start, end = checked_window(window)
        key_name, _pem = _checked_secret(secret)
        accounts = self._get("/api/v3/brokerage/accounts", {"limit": "49"}, secret).get(
            "accounts", []
        )
        if self._identity(accounts, key_name) != identity:
            raise AdapterError("connector.identity_changed", 409)
        params = {
            "product_id": config["productId"],
            "start_sequence_timestamp": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end_sequence_timestamp": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "limit": "100",
        }
        if cursor:
            params["cursor"] = cursor
        payload = self._get("/api/v3/brokerage/orders/historical/fills", params, secret)
        events = []
        for row in payload.get("fills", []):
            events.append(
                {
                    "externalEventId": f"fill:{row['trade_id']}",
                    "kind": "fill",
                    "status": "confirmed",
                    "occurredAt": row["trade_time"],
                    "timeBasis": "provider-utc",
                    "payload": {
                        "symbol": row.get("product_id"),
                        "side": str(row.get("side", "")).lower(),
                        "quantity": _decimal_text(row["size"]),
                        "price": _decimal_text(row["price"]),
                        "commission": _decimal_text(row.get("commission", "0")),
                        "orderId": row.get("order_id"),
                    },
                }
            )
        next_cursor = payload.get("cursor") or None
        if next_cursor == "":
            next_cursor = None
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
                "productId": config["productId"],
            },
        }
