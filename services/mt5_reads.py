"""MT5 account reads and demo-order gating over an injected SDK (P09).

Positions/orders/account-mode reads complement the P07 read-only
adapter. Volumes stay in native lots with the symbol's contract size
attached; converting lots to canonical units is a display step, never
a silent rewrite. Symbol suffix handling is explicit: a stripped
candidate is returned with `verified: False` until a user or a
verified instrument map confirms it.

The demo-order gate (T06) only *decides* — order submission belongs
to P11 and no `order_send` path exists here.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from services.platform_bridge import BridgeError

# MetaTrader5 ACCOUNT_MARGIN_MODE_* values (documented constants).
MARGIN_MODE_NAMES = {0: "retail_netting", 1: "exchange", 2: "retail_hedging"}
KNOWN_SUFFIXES = (".pro", ".raw", ".ecn", ".m", "_pro", "-pro", ".", "#")


def _decimal(value):
    try:
        result = Decimal(str(value))
    except (ValueError, InvalidOperation):
        raise BridgeError("mt5.invalid_provider_response", 502) from None
    if not result.is_finite():
        raise BridgeError("mt5.invalid_provider_response", 502)
    return format(result.normalize(), "f")


def account_mode(sdk):
    account = sdk.account_info()
    if account is None:
        raise BridgeError("mt5.account_unavailable", 403)
    mode = getattr(account, "margin_mode", None)
    return {
        "marginMode": mode,
        "marginModeName": MARGIN_MODE_NAMES.get(mode, "unknown"),
        "tradeAllowed": bool(getattr(account, "trade_allowed", False)),
        "tradeExpert": bool(getattr(account, "trade_expert", False)),
        "currency": getattr(account, "currency", None),
    }


def normalize_symbol(native):
    """Return native + candidate; suffix stripping is never silent."""
    if not isinstance(native, str) or not native:
        raise BridgeError("mt5.symbol_invalid", 400)
    candidate = native
    stripped = None
    for suffix in sorted(KNOWN_SUFFIXES, key=len, reverse=True):
        if len(native) > len(suffix) and native.lower().endswith(suffix):
            candidate = native[: len(native) - len(suffix)]
            stripped = suffix
            break
    return {
        "native": native,
        "canonicalCandidate": candidate.upper(),
        "suffixStripped": stripped,
        "verified": stripped is None,
        "note": (
            "Exact native symbol."
            if stripped is None
            else "Broker suffix stripped to propose a candidate; confirm against the instrument map before use."
        ),
    }


def read_positions(sdk):
    rows = sdk.positions_get()
    if rows is None:
        raise BridgeError("mt5.positions_unavailable", 503)
    out = []
    for row in rows:
        symbol = getattr(row, "symbol", "")
        info = sdk.symbol_info(symbol) if symbol else None
        out.append(
            {
                "ticket": str(row.ticket),
                "symbol": normalize_symbol(symbol),
                "side": "buy" if row.type == 0 else "sell",
                "volumeLots": _decimal(row.volume),
                "contractSize": _decimal(info.trade_contract_size) if info is not None else None,
                "priceOpen": _decimal(row.price_open),
                "priceCurrent": _decimal(row.price_current),
                "stopLoss": _decimal(row.sl) if getattr(row, "sl", 0) else None,
                "takeProfit": _decimal(row.tp) if getattr(row, "tp", 0) else None,
                "profit": _decimal(row.profit),
                "timeBasis": "provider-epoch-unverified",
            }
        )
    return out


def read_orders(sdk):
    rows = sdk.orders_get()
    if rows is None:
        raise BridgeError("mt5.orders_unavailable", 503)
    return [
        {
            "ticket": str(row.ticket),
            "symbol": normalize_symbol(getattr(row, "symbol", "")),
            "type": row.type,
            "volumeInitialLots": _decimal(row.volume_initial),
            "volumeCurrentLots": _decimal(row.volume_current),
            "priceOpen": _decimal(row.price_open),
            "stopLoss": _decimal(row.sl) if getattr(row, "sl", 0) else None,
            "takeProfit": _decimal(row.tp) if getattr(row, "tp", 0) else None,
            "timeBasis": "provider-epoch-unverified",
        }
        for row in rows
    ]


def reconcile_history(events, seen_external_ids):
    """Split a history page into new vs already-ingested events (T05).

    Deal identity is namespaced by the caller per terminal account, so
    colliding native deal IDs across terminals never dedupe each other.
    """
    seen = set(seen_external_ids)
    fresh, duplicates = [], 0
    for event in events:
        if event["externalEventId"] in seen:
            duplicates += 1
            continue
        seen.add(event["externalEventId"])
        fresh.append(event)
    return {"new": fresh, "duplicates": duplicates, "seen": sorted(seen)}


def demo_order_gate(sdk, identity):
    """Decide whether demo order commands may be *offered* (T06 gate).

    Live accounts are refused in this package regardless of terminal
    permissions; P11 owns any live path. Protective-order support is
    reported from the terminal, not assumed.
    """
    reasons = []
    if identity.get("environment") != "broker_demo":
        reasons.append("account is not a broker demo account")
    account = sdk.account_info()
    terminal = sdk.terminal_info()
    if account is None or terminal is None:
        reasons.append("account or terminal state unavailable")
        return {"allowed": False, "reasons": reasons}
    if not getattr(terminal, "connected", False):
        reasons.append("terminal is not connected")
    if not getattr(terminal, "trade_allowed", False):
        reasons.append("terminal trade_allowed is off")
    if not getattr(account, "trade_allowed", False):
        reasons.append("account trade_allowed is off")
    if not getattr(account, "trade_expert", False):
        reasons.append("account does not permit expert/automated trading")
    return {
        "allowed": not reasons,
        "reasons": reasons,
        "environment": identity.get("environment"),
        "note": "Gate only: submission, sizing and protective-order acknowledgement are P11.",
    }
