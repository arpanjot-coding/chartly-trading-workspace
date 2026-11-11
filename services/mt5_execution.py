"""Explicit demo market orders through the selected local terminal."""

import hashlib
import json
import re
import time
from decimal import Decimal, InvalidOperation
from uuid import uuid4

from sqlalchemy import Column, String, Table, Text, delete, insert, select, update

from database.workspace_storage_db import metadata
from services.connector_adapters import AdapterError
from services.connector_mt5 import MT5Adapter, _identity, _native_price, normalize_mt5_configuration
from services.mt5_binding import profile_mt5_binding
from services.mt5_reads import demo_order_gate
from services.workspace_storage import WorkspaceError, dumps

receipts = Table(
    "workspace_mt5_order_receipts",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("id", String(32), primary_key=True),
    Column("payload", Text, nullable=False),
)
pending_intents = Table(
    "workspace_mt5_pending_intents",
    metadata,
    Column("uid", String(128), primary_key=True),
    Column("account_hash", String(64), primary_key=True),
    Column("request_id", String(32), nullable=False),
)
PREVIEW_SECONDS = 60
DEVIATION_POINTS = 10
MAX_QUOTE_AGE_MS = 15_000
MAX_QUOTE_FUTURE_MS = 2_000
MAX_SPREAD_POINTS = 100
OUTCOMES = {10008: "placed", 10009: "filled", 10010: "partially-filled"}
# Transport/timeout errors and unrecognized codes are deliberately unknown.
REJECTIONS = {
    10004,
    10006,
    10007,
    10013,
    10014,
    10015,
    10016,
    10017,
    10018,
    10019,
    10020,
    10021,
    10022,
    10024,
    10026,
    10027,
    10030,
    10032,
    10033,
    10034,
    10035,
    10040,
    10042,
    10043,
    10044,
    10046,
}


def _decimal(value):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise WorkspaceError("mt5.invalid_instrument", 409) from None
    if not number.is_finite() or not Decimal("1e-12") <= number <= Decimal("1e12"):
        raise WorkspaceError("mt5.invalid_instrument", 409)
    return number


def _fingerprint(identity):
    return hashlib.sha256(dumps(identity).encode()).hexdigest()


def _filling(sdk, info):
    execution = info.trade_exemode
    if execution in (sdk.SYMBOL_TRADE_EXECUTION_REQUEST, sdk.SYMBOL_TRADE_EXECUTION_INSTANT):
        return sdk.ORDER_FILLING_FOK
    if info.filling_mode & 1:
        return sdk.ORDER_FILLING_FOK
    if info.filling_mode & 2:
        return sdk.ORDER_FILLING_IOC
    if execution == sdk.SYMBOL_TRADE_EXECUTION_EXCHANGE:
        return sdk.ORDER_FILLING_RETURN
    raise WorkspaceError("mt5.unsupported_filling", 409)


def _price(sdk, symbol, side, digits, point):
    tick = sdk.symbol_info_tick(symbol)
    if tick is None:
        raise WorkspaceError("mt5.quote_unavailable", 409)
    stamp = getattr(tick, "time_msc", 0)
    if not stamp:
        seconds = getattr(tick, "time", None)
        stamp = seconds * 1000 if type(seconds) is int else None
    now = time.time_ns() // 1_000_000
    if type(stamp) is not int or not now - MAX_QUOTE_AGE_MS <= stamp <= now + MAX_QUOTE_FUTURE_MS:
        raise WorkspaceError("mt5.quote_age_unverified", 409)
    bid = _native_price(tick.bid, digits)
    ask = _native_price(tick.ask, digits)
    spread = _decimal(ask) - _decimal(bid)
    if not 0 <= spread <= point * MAX_SPREAD_POINTS:
        raise WorkspaceError("mt5.quote_spread_unavailable", 409)
    return ask if side == "buy" else bid


def _request(sdk, identity, symbol, side, lots, request_id):
    gate = demo_order_gate(sdk, identity)
    terminal = sdk.terminal_info()
    if not gate["allowed"] or terminal is None or getattr(terminal, "tradeapi_disabled", True):
        raise WorkspaceError("mt5.demo_trade_unavailable", 409)
    info = sdk.symbol_info(symbol)
    if info is None:
        raise WorkspaceError("mt5.quote_unavailable", 409)
    # SYMBOL_TRADE_MODE_LONGONLY=1, SHORTONLY=2, FULL=4.
    if getattr(info, "trade_mode", None) not in (4, 1 if side == "buy" else 2):
        raise WorkspaceError("mt5.symbol_direction_unavailable", 409)
    volume = _decimal(lots)
    minimum, maximum, step = (
        _decimal(getattr(info, field, None))
        for field in ("volume_min", "volume_max", "volume_step")
    )
    if not minimum <= volume <= maximum or volume % step:
        raise WorkspaceError("mt5.volume_grid", 409)
    point = _decimal(info.point)
    price = _price(sdk, symbol, side, info.digits, point)
    request = {
        "action": sdk.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "type": sdk.ORDER_TYPE_BUY if side == "buy" else sdk.ORDER_TYPE_SELL,
        "volume": float(volume),
        "type_filling": _filling(sdk, info),
        "deviation": DEVIATION_POINTS,
        "comment": f"Chartly {request_id[:16]}",
    }
    if info.trade_exemode != sdk.SYMBOL_TRADE_EXECUTION_MARKET:
        request["price"] = float(price)
    return request, price, point, info.digits


def _check(sdk, request):
    result = sdk.order_check(request)
    if result is None or result.retcode != 0:
        code = getattr(result, "retcode", None)
        issues = [{"retcode": code}] if type(code) is int else []
        raise WorkspaceError("mt5.order_check_rejected", 409, issues)


def _assert_identity(sdk, expected):
    if _fingerprint(_identity(sdk)) != expected:
        raise WorkspaceError("mt5.account_changed", 409)


def preview(symbol, side, lots, *, binding=None, storage=None, adapter=None):
    config = normalize_mt5_configuration(
        {**(binding["configuration"] if binding else {}), "symbol": symbol}
    )
    if (
        side not in ("buy", "sell")
        or not isinstance(lots, str)
        or not re.fullmatch(r"[0-9]{1,12}(?:\.[0-9]{1,12})?", lots)
        or Decimal(lots) <= 0
    ):
        raise WorkspaceError("mt5.invalid_order")
    request_id = uuid4().hex
    with (adapter or MT5Adapter())._attached(config, None) as (sdk, _):
        identity = _identity(sdk)
        if binding and identity != binding["identity"]:
            raise WorkspaceError("mt5.account_changed", 409)
        account_hash = _fingerprint(identity)
        if storage is not None:
            with storage.engine.connect() as connection:
                _assert_no_pending(storage, connection, account_hash)
        request, price, _point, _digits = _request(sdk, identity, symbol, side, lots, request_id)
        _assert_identity(sdk, account_hash)
        _check(sdk, request)
        _assert_identity(sdk, account_hash)
    return {
        **({"binding": binding["scope"]} if binding else {}),
        "id": request_id,
        "accountHash": account_hash,
        "accountLabel": f"{identity['server']} · demo · ending {identity['externalId'][-4:]}",
        "symbol": symbol,
        "side": side,
        "lots": lots,
        "price": price,
        "expiresAt": int(time.time()) + PREVIEW_SECONDS,
    }


def _load_receipt(storage, request_id):
    if not re.fullmatch(r"[a-f0-9]{32}", request_id):
        raise WorkspaceError("mt5.receipt_unavailable", 404)
    with storage.engine.connect() as connection:
        payload = connection.execute(
            select(receipts.c.payload).where(storage.scope(receipts), receipts.c.id == request_id)
        ).scalar_one_or_none()
    if payload is None:
        raise WorkspaceError("mt5.receipt_unavailable", 404)
    return json.loads(payload)


def _public_receipt(receipt):
    return {key: value for key, value in receipt.items() if key != "_intent"}


def read_receipt(storage, request_id):
    return _public_receipt(_load_receipt(storage, request_id))


def _pending_scope(storage, account_hash):
    return (storage.scope(pending_intents), pending_intents.c.account_hash == account_hash)


def _assert_no_pending(storage, connection, account_hash):
    pending_id = connection.execute(
        select(pending_intents.c.request_id).where(*_pending_scope(storage, account_hash))
    ).scalar_one_or_none()
    if pending_id is not None:
        raise WorkspaceError("mt5.pending_intent", 409, [{"requestId": pending_id}])


def _save_outcome(storage, initial, outcome):
    request_id = initial["id"]
    account_hash = initial["_intent"]["accountHash"]
    scope = (storage.scope(receipts), receipts.c.id == request_id)
    with storage.transaction() as connection:
        payload = connection.execute(select(receipts.c.payload).where(*scope)).scalar_one()
        if json.loads(payload) != initial:
            return _public_receipt(json.loads(payload))
        connection.execute(update(receipts).where(*scope).values(payload=dumps(outcome)))
        if outcome["state"] != "unknown":
            connection.execute(
                delete(pending_intents).where(
                    *_pending_scope(storage, account_hash),
                    pending_intents.c.request_id == request_id,
                )
            )
    return _public_receipt(outcome)


def _mark_dispatch(storage, initial):
    dispatched = {
        **initial,
        "_intent": {**initial["_intent"], "dispatchStartedAt": int(time.time())},
    }
    with storage.transaction() as connection:
        changed = connection.execute(
            update(receipts)
            .where(
                storage.scope(receipts),
                receipts.c.id == initial["id"],
                receipts.c.payload == dumps(initial),
            )
            .values(payload=dumps(dispatched))
        )
        if changed.rowcount != 1:
            raise WorkspaceError("mt5.preview_expired", 409)
    return dispatched


def _current_binding(storage, review):
    scope = review.get("binding")
    if scope is None:
        return None
    binding = profile_mt5_binding(storage, scope["originId"], scope["profileId"])
    if binding["scope"] != scope or _fingerprint(binding["identity"]) != review["accountHash"]:
        raise WorkspaceError("mt5.profile_binding_changed", 409)
    return binding


def submit(storage, review, *, adapter=None):
    request_id = review["id"]
    symbol, side, lots = (review[key] for key in ("symbol", "side", "lots"))
    account_hash = review["accountHash"]
    initial = {
        "id": request_id,
        "state": "unknown",
        "symbol": symbol,
        "side": side,
        "lots": lots,
        "_intent": {
            "accountHash": account_hash,
            "binding": review.get("binding"),
            "expiresAt": review["expiresAt"],
        },
    }
    receipt = initial.copy()
    scope = (storage.scope(receipts), receipts.c.id == request_id)
    # Claim before checking mutable broker state. A concurrent retry always
    # gets this receipt, including when the quote or terminal login changed.
    with storage.transaction() as connection:
        existing = connection.execute(select(receipts.c.payload).where(*scope)).scalar_one_or_none()
        if existing is not None:
            return _public_receipt(json.loads(existing))
        if time.time() >= review["expiresAt"]:
            raise WorkspaceError("mt5.preview_expired", 409)
        _assert_no_pending(storage, connection, account_hash)
        connection.execute(
            insert(pending_intents).values(
                uid=storage.uid, account_hash=account_hash, request_id=request_id
            )
        )
        connection.execute(
            insert(receipts).values(uid=storage.uid, id=request_id, payload=dumps(initial))
        )
    attempted = False
    refusal = None
    try:
        binding = _current_binding(storage, review)
        config = normalize_mt5_configuration(
            {**(binding["configuration"] if binding else {}), "symbol": symbol}
        )
        with (adapter or MT5Adapter())._attached(config, None) as (sdk, _):
            _assert_identity(sdk, review["accountHash"])
            request, price, point, digits = _request(
                sdk, _identity(sdk), symbol, side, lots, request_id
            )
            reviewed_price = Decimal(review["price"])
            tolerance = point * DEVIATION_POINTS
            if abs(Decimal(price) - reviewed_price) > tolerance:
                raise WorkspaceError("mt5.quote_moved", 409)
            _check(sdk, request)
            initial = _mark_dispatch(storage, initial)
            receipt = initial.copy()
            _current_binding(storage, review)
            if abs(Decimal(_price(sdk, symbol, side, digits, point)) - reviewed_price) > tolerance:
                raise WorkspaceError("mt5.quote_moved", 409)
            if time.time() >= review["expiresAt"]:
                raise WorkspaceError("mt5.preview_expired", 409)
            _assert_identity(sdk, review["accountHash"])
            attempted = True
            try:
                result = sdk.order_send(request)
            except Exception:
                result = None
            code = getattr(result, "retcode", None)
            if type(code) is int:
                receipt["retcode"] = code
                receipt["state"] = OUTCOMES.get(
                    code, "rejected" if code in REJECTIONS else "unknown"
                )
            for key in ("order", "deal"):
                ticket = getattr(result, key, None)
                if type(ticket) is int and ticket > 0:
                    receipt[key] = str(ticket)
    except (WorkspaceError, AdapterError) as error:
        if attempted:
            raise
        refusal = error
        receipt.update(state="rejected", reason=error.code)
    public = _save_outcome(storage, initial, receipt)
    if refusal is not None:
        raise refusal
    return public


def _reconciliation_binding(storage, intent):
    scope = intent.get("binding")
    if not scope:
        raise WorkspaceError("mt5.receipt_binding_unavailable", 409)
    current = profile_mt5_binding(storage, scope["originId"], scope["profileId"])
    if (
        current["scope"]["connectionId"] != scope["connectionId"]
        or _fingerprint(current["identity"]) != intent["accountHash"]
    ):
        raise WorkspaceError("mt5.profile_binding_changed", 409)
    return current


def _history_outcome(sdk, receipt, order_ticket):
    orders = sdk.history_orders_get(ticket=order_ticket)
    if orders is None or len(orders) != 1:
        raise WorkspaceError("mt5.receipt_evidence_unavailable", 409)
    order = orders[0]
    order_type = sdk.ORDER_TYPE_BUY if receipt["side"] == "buy" else sdk.ORDER_TYPE_SELL
    requested = _decimal(receipt["lots"])
    if (
        order.ticket != order_ticket
        or order.comment != f"Chartly {receipt['id'][:16]}"
        or order.symbol != receipt["symbol"]
        or order.type != order_type
        or _decimal(order.volume_initial) != requested
    ):
        raise WorkspaceError("mt5.receipt_evidence_unavailable", 409)
    deals = sdk.history_deals_get(ticket=order_ticket)
    if deals is None or len(deals) > 200:
        raise WorkspaceError("mt5.receipt_evidence_unavailable", 409)
    fills = {}
    deal_type = sdk.DEAL_TYPE_BUY if receipt["side"] == "buy" else sdk.DEAL_TYPE_SELL
    for deal in deals:
        if (
            deal.order != order_ticket
            or deal.symbol != receipt["symbol"]
            or deal.type != deal_type
            or type(deal.ticket) is not int
            or deal.ticket <= 0
            or deal.ticket in fills
        ):
            raise WorkspaceError("mt5.receipt_evidence_unavailable", 409)
        fills[deal.ticket] = _decimal(deal.volume)
    filled = sum(fills.values(), Decimal(0))
    if receipt.get("deal") and receipt["deal"] not in {str(ticket) for ticket in fills}:
        raise WorkspaceError("mt5.receipt_evidence_unavailable", 409)
    if order.state == sdk.ORDER_STATE_FILLED and filled == requested:
        state = "filled"
    elif order.state in (sdk.ORDER_STATE_CANCELED, sdk.ORDER_STATE_EXPIRED) and filled < requested:
        if Decimal(str(order.volume_current)) != requested - filled:
            raise WorkspaceError("mt5.receipt_evidence_unavailable", 409)
        state = "partially-filled" if filled else "canceled"
    elif order.state == sdk.ORDER_STATE_REJECTED and not filled:
        state = "rejected"
    else:
        raise WorkspaceError("mt5.receipt_evidence_unavailable", 409)
    return {
        **receipt,
        "state": state,
        "order": str(order_ticket),
        "dealTickets": [str(ticket) for ticket in sorted(fills)],
        "filledLots": format(filled, "f"),
        "reconciled": True,
    }


def reconcile(storage, request_id, ticket, *, adapter=None):
    receipt = _load_receipt(storage, request_id)
    if receipt["state"] != "unknown":
        return _public_receipt(receipt)
    intent = receipt.get("_intent")
    if intent is None:
        raise WorkspaceError("mt5.receipt_binding_unavailable", 409)
    if "dispatchStartedAt" not in intent:
        if time.time() >= intent["expiresAt"]:
            return _save_outcome(
                storage, receipt, {**receipt, "state": "rejected", "reason": "mt5.preview_expired"}
            )
        raise WorkspaceError("mt5.receipt_evidence_unavailable", 409)
    ticket = ticket or receipt.get("order")
    if not isinstance(ticket, str) or not re.fullmatch(r"[1-9][0-9]{0,19}", ticket):
        raise WorkspaceError("mt5.invalid_order_ticket", 400)
    if int(ticket) > 2**64 - 1 or (receipt.get("order") and receipt["order"] != ticket):
        raise WorkspaceError("mt5.invalid_order_ticket", 400)
    binding = _reconciliation_binding(storage, intent)
    config = normalize_mt5_configuration({**binding["configuration"], "symbol": receipt["symbol"]})
    with (adapter or MT5Adapter())._attached(config, None) as (sdk, _):
        _assert_identity(sdk, intent["accountHash"])
        outcome = _history_outcome(sdk, receipt, int(ticket))
        _assert_identity(sdk, intent["accountHash"])
    if binding != _reconciliation_binding(storage, intent):
        raise WorkspaceError("mt5.profile_binding_changed", 409)
    return _save_outcome(storage, receipt, outcome)
