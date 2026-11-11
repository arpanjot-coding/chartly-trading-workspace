"""Single-account execution core: state machine, risk, outbox (P11).

Safety invariants, in order:
1. Intent and command are persisted *before* any dispatch.
2. (account, idempotencyKey) is unique — a retry returns the stored
   command and never dispatches twice.
3. A dispatch timeout/ambiguity lands in `unknown` and stays there
   until broker reconciliation resolves it; nothing auto-resubmits.
4. Risk is checked in the backend with exposure reservations held
   from submit until a terminal state; reducing (close) flow stays
   available when new entries are blocked.
5. Broker-held protection is only ever reported from broker
   acknowledgement (`nativeProtection` in command meta), never from
   intent fields alone.

Dispatch itself is an injected callable per destination, so the core
is broker-neutral; adapter wiring supplies the real send.
"""

from __future__ import annotations

import json
from copy import deepcopy
from decimal import Decimal, InvalidOperation

from sqlalchemy import insert, select, update

from database.execution_db import execution_accounts
from services.domain.validation import validate_record
from services.workspace_storage import WorkspaceError, dumps, now, opaque, valid_origin

TRANSITIONS = {
    "pending": {"submitted", "rejected"},
    "submitted": {"acknowledged", "rejected", "unknown"},
    "acknowledged": {"part_filled", "filled", "cancel_requested", "cancelled", "unknown"},
    "part_filled": {"filled", "cancel_requested", "cancelled", "unknown"},
    "cancel_requested": {"cancelled", "filled", "unknown"},
    "unknown": {"reconciling"},
    "reconciling": {"acknowledged", "part_filled", "filled", "cancelled", "rejected", "unknown"},
    "filled": set(),
    "cancelled": set(),
    "rejected": set(),
}
TERMINAL = {"filled", "cancelled", "rejected"}


class DispatchTimeout(Exception):
    """Broker outcome unknown (timeout/ambiguous transport)."""


class DispatchRejected(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def _error(code, status=400):
    raise WorkspaceError("execution." + code, status)


def _decimal(value, code="decimal_invalid"):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        _error(code)
    if not result.is_finite():
        _error(code)
    return result


def transition(command, target, at):
    current = command["status"]
    if target not in TRANSITIONS.get(current, set()):
        _error(f"transition_invalid:{current}->{target}", 409)
    command["status"] = target
    command["updatedAt"] = at
    command["revision"] += 1
    return command


# ---------------------------------------------------------------------------
# Pretrade validation (T03): refuse off-grid values, never round silently
# ---------------------------------------------------------------------------


def pretrade_issues(intent, rules):
    """rules: {tickSize, quantityStep, minQuantity, maxQuantity,
    minNotional, supportedTypes, currency} — all decimal text."""
    issues = []
    quantity = _decimal(intent["quantity"]["value"])
    if intent["orderType"] not in rules["supportedTypes"]:
        issues.append("order_type_unsupported")
    step = _decimal(rules["quantityStep"])
    if step > 0 and quantity % step != 0:
        issues.append("quantity_off_step")
    if quantity < _decimal(rules["minQuantity"]):
        issues.append("quantity_below_minimum")
    if quantity > _decimal(rules["maxQuantity"]):
        issues.append("quantity_above_maximum")
    price = None
    if intent["orderType"] == "limit":
        if not intent.get("limitPrice"):
            issues.append("limit_price_required")
        else:
            price = _decimal(intent["limitPrice"])
    if intent["orderType"] == "stop":
        if not intent.get("stopPrice"):
            issues.append("stop_price_required")
        else:
            price = _decimal(intent["stopPrice"])
    if price is not None:
        tick = _decimal(rules["tickSize"])
        if tick > 0 and price % tick != 0:
            issues.append("price_off_tick")
        if quantity * price < _decimal(rules["minNotional"]):
            issues.append("notional_below_minimum")
    return issues


def order_notional(intent, reference_price=None):
    quantity = _decimal(intent["quantity"]["value"])
    price_text = intent.get("limitPrice") or intent.get("stopPrice") or reference_price
    if price_text is None:
        _error("reference_price_required_for_market_risk", 409)
    return quantity * _decimal(price_text)


# ---------------------------------------------------------------------------
# Risk (T04)
# ---------------------------------------------------------------------------


def risk_check(intent, *, policy, account_state, reference_price=None):
    """policy: {currency, maxOrderNotional, maxExposure, dailyLossLimit}
    account_state: {currency, exposure, reservedNotional, dayPnl,
    positionQuantity (signed, same instrument; entries blocked but
    reducing flow allowed when limits are breached)}"""
    if account_state["currency"] != policy["currency"]:
        return {"allowed": False, "reasons": ["currency_mismatch_no_conversion"]}
    notional = order_notional(intent, reference_price)
    reasons = []
    if notional > _decimal(policy["maxOrderNotional"]):
        reasons.append("order_notional_limit")
    position = _decimal(account_state.get("positionQuantity", "0"))
    quantity = _decimal(intent["quantity"]["value"])
    reducing = (position > 0 and intent["side"] == "sell" and quantity <= position) or (
        position < 0 and intent["side"] == "buy" and quantity <= abs(position)
    )
    if not reducing:
        projected = (
            _decimal(account_state["exposure"])
            + _decimal(account_state["reservedNotional"])
            + notional
        )
        if projected > _decimal(policy["maxExposure"]):
            reasons.append("exposure_limit")
        if _decimal(account_state["dayPnl"]) <= -abs(_decimal(policy["dailyLossLimit"])):
            reasons.append("daily_loss_limit_entries_blocked")
    return {
        "allowed": not reasons,
        "reasons": reasons,
        "notional": format(notional.normalize(), "f"),
        "reducing": reducing,
    }


def preview_ticket(intent, destination, rules, policy, account_state, reference_price=None):
    """Order-ticket preview payload (T05): everything a human confirms.

    Shows environment/mode, native symbol, exact units, estimated
    notional, pretrade issues and the risk verdict. Previewing never
    reserves or dispatches.
    """
    issues = pretrade_issues(intent, rules)
    risk = None
    if not issues:
        risk = risk_check(
            intent, policy=policy, account_state=account_state, reference_price=reference_price
        )
    return {
        "accountId": intent["accountId"],
        "environment": destination["mode"],
        "nativeSymbol": destination["nativeSymbol"],
        "side": intent["side"],
        "orderType": intent["orderType"],
        "quantity": intent["quantity"],
        "limitPrice": intent.get("limitPrice"),
        "stopPrice": intent.get("stopPrice"),
        "currency": policy["currency"],
        "estimatedNotional": risk["notional"] if risk else None,
        "pretradeIssues": issues,
        "risk": risk,
        "protection": "none until the broker acknowledges a native protective order",
        "submittable": not issues and bool(risk and risk["allowed"]),
    }


# ---------------------------------------------------------------------------
# Durable store + outbox service (T02/T06/T07/T08)
# ---------------------------------------------------------------------------


class ExecutionService:
    def __init__(self, storage):
        self.storage = storage

    def _origin(self, origin):
        if not valid_origin(origin):
            _error("origin_invalid")
        return origin

    def _load(self, connection, origin, account_id):
        row = connection.execute(
            select(execution_accounts.c.payload).where(
                self.storage.scope(execution_accounts, origin),
                execution_accounts.c.id == account_id,
            )
        ).first()
        return json.loads(row[0]) if row else None

    def _save(self, connection, origin, bundle):
        for intent in bundle["intents"]:
            if validate_record("OrderIntent", intent):
                _error("invalid_intent_record")
        for command in bundle["commands"]:
            if validate_record("ChildCommand", command):
                _error("invalid_command_record")
        raw = dumps(bundle)
        existing = self._load(connection, origin, bundle["id"])
        if existing is None:
            connection.execute(
                insert(execution_accounts).values(
                    uid=self.storage.uid, origin=origin, id=bundle["id"], payload=raw
                )
            )
        else:
            connection.execute(
                update(execution_accounts)
                .where(
                    self.storage.scope(execution_accounts, origin),
                    execution_accounts.c.id == bundle["id"],
                )
                .values(payload=raw)
            )

    def _bundle(self, connection, origin, account_id):
        return self._load(connection, origin, account_id) or {
            "id": account_id,
            "intents": [],
            "commands": [],
            "meta": {},
        }

    def get_account(self, origin, account_id):
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._load(connection, origin, account_id)
        if bundle is None:
            _error("account_not_found", 404)
        return bundle

    def submit(
        self,
        origin,
        *,
        destination,
        intent,
        rules,
        policy,
        account_state,
        dispatcher,
        reference_price=None,
    ):
        """Persist → validate → risk → reserve → dispatch (once)."""
        self._origin(origin)
        if destination.get("arming") != "armed" or destination.get("eligibility") != "eligible":
            _error("destination_not_armed_or_eligible", 409)
        if intent["accountId"] != destination["accountId"] or intent["mode"] != destination["mode"]:
            _error("intent_destination_mismatch", 409)
        intent = deepcopy(intent)
        if intent.get("destinationId") not in (None, destination["id"]):
            _error("intent_destination_mismatch", 409)
        intent["destinationId"] = destination["id"]
        command_id = opaque("childcommand", intent["accountId"] + "|" + intent["idempotencyKey"])
        with self.storage.transaction() as connection:
            bundle = self._bundle(connection, origin, intent["accountId"])
            existing = next(
                (
                    row
                    for row in bundle["commands"]
                    if row["idempotencyKey"] == intent["idempotencyKey"]
                ),
                None,
            )
            if existing is not None:
                return {"command": deepcopy(existing), "duplicate": True}
            issues = pretrade_issues(intent, rules)
            if issues:
                _error("pretrade_failed:" + ",".join(issues), 422)
            risk = risk_check(
                intent, policy=policy, account_state=account_state, reference_price=reference_price
            )
            if not risk["allowed"]:
                _error("risk_blocked:" + ",".join(risk["reasons"]), 422)
            at = now()
            command = {
                "schemaVersion": 1,
                "id": command_id,
                "ownerId": intent["ownerId"],
                "workspaceId": intent["workspaceId"],
                "revision": 1,
                "createdAt": at,
                "updatedAt": at,
                "intentId": intent["id"],
                "accountId": intent["accountId"],
                "destinationId": destination["id"],
                "mode": intent["mode"],
                "idempotencyKey": intent["idempotencyKey"],
                "status": "pending",
            }
            bundle["intents"].append(deepcopy(intent))
            bundle["commands"].append(command)
            bundle["meta"][command_id] = {
                "reservedNotional": risk["notional"],
                "filledQuantity": "0",
                "nativeProtection": "none-acknowledged",
            }
            self._save(connection, origin, bundle)
        # Dispatch happens only after the pending command is durable.
        return {"command": self._dispatch(origin, command_id, dispatcher), "duplicate": False}

    def _mutate(self, origin, account_id, command_id, fn):
        with self.storage.transaction() as connection:
            bundle = self._bundle(connection, origin, account_id)
            command = next((row for row in bundle["commands"] if row["id"] == command_id), None)
            if command is None:
                _error("command_not_found", 404)
            result = fn(command, bundle)
            self._save(connection, origin, bundle)
            return deepcopy(result if result is not None else command)

    def _dispatch(self, origin, command_id, dispatcher):
        account_id = None
        with self.storage.transaction() as connection:
            rows = connection.execute(
                select(execution_accounts.c.payload).where(
                    self.storage.scope(execution_accounts, origin)
                )
            )
            for row in rows:
                bundle = json.loads(row[0])
                if any(c["id"] == command_id for c in bundle["commands"]):
                    account_id = bundle["id"]
                    command = next(c for c in bundle["commands"] if c["id"] == command_id)
                    intent = next(i for i in bundle["intents"] if i["id"] == command["intentId"])
                    transition(command, "submitted", now())
                    self._save(connection, origin, bundle)
                    break
        if account_id is None:
            _error("command_not_found", 404)
        try:
            outcome = dispatcher(deepcopy(command), deepcopy(intent))
        except DispatchRejected as rejected:
            # Capture now: Python clears the exception name when the
            # except block exits, but apply_reject runs later inside
            # _mutate — referencing `rejected` there raised NameError.
            reason = rejected.reason

            def apply_reject(cmd, bundle):
                transition(cmd, "rejected", now())
                bundle["meta"][cmd["id"]]["brokerReason"] = reason
                bundle["meta"][cmd["id"]]["reservedNotional"] = "0"

            return self._mutate(origin, account_id, command_id, apply_reject)
        except DispatchTimeout:

            def apply_unknown(cmd, bundle):
                transition(cmd, "unknown", now())
                bundle["meta"][cmd["id"]]["recovery"] = (
                    "Do not resubmit. Reconcile against broker orders first."
                )

            return self._mutate(origin, account_id, command_id, apply_unknown)

        def apply_ack(cmd, bundle):
            cmd["nativeOrderId"] = outcome["nativeOrderId"]
            transition(cmd, "acknowledged", now())
            if outcome.get("protectionAcknowledged"):
                bundle["meta"][cmd["id"]]["nativeProtection"] = "broker-acknowledged"

        return self._mutate(origin, account_id, command_id, apply_ack)

    def apply_fill(self, origin, account_id, command_id, *, fill_quantity, intent_quantity):
        def apply(cmd, bundle):
            meta = bundle["meta"][cmd["id"]]
            filled = _decimal(meta["filledQuantity"]) + _decimal(fill_quantity)
            if filled > _decimal(intent_quantity):
                _error("overfill_reported", 409)
            meta["filledQuantity"] = format(filled.normalize(), "f")
            if filled == _decimal(intent_quantity):
                transition(cmd, "filled", now())
                meta["reservedNotional"] = "0"
            elif cmd["status"] in {"acknowledged", "reconciling"}:
                transition(cmd, "part_filled", now())

        return self._mutate(origin, account_id, command_id, apply)

    def request_cancel(self, origin, account_id, command_id, canceller):
        def mark(cmd, bundle):
            transition(cmd, "cancel_requested", now())

        self._mutate(origin, account_id, command_id, mark)
        canceller(command_id)

        def apply(cmd, bundle):
            transition(cmd, "cancelled", now())
            bundle["meta"][cmd["id"]]["reservedNotional"] = "0"

        return self._mutate(origin, account_id, command_id, apply)

    def recover(self, origin, account_id):
        """Startup/reconnect sweep: classify, never auto-resubmit (T07)."""
        bundle = self.get_account(origin, account_id)
        actions = []
        for command in bundle["commands"]:
            if command["status"] == "pending":
                actions.append({"commandId": command["id"], "action": "safe_to_dispatch"})
            elif command["status"] in {"submitted", "unknown"}:

                def to_reconciling(cmd, _bundle, target=command["id"]):
                    if cmd["id"] == target and cmd["status"] == "unknown":
                        transition(cmd, "reconciling", now())

                self._mutate(origin, account_id, command["id"], to_reconciling)
                actions.append(
                    {"commandId": command["id"], "action": "reconcile_with_broker_before_any_retry"}
                )
            elif command["status"] not in TERMINAL:
                actions.append({"commandId": command["id"], "action": "refresh_from_broker"})
        return actions

    # T08: three separate emergency actions with separate outcomes.
    def stop_automation(self, origin, account_id):
        bundle = self.get_account(origin, account_id)
        return {
            "action": "stop_automation",
            "effect": "destination disarmed by caller; open broker orders untouched",
            "openCommands": [
                row["id"] for row in bundle["commands"] if row["status"] not in TERMINAL
            ],
        }

    def cancel_open_orders(self, origin, account_id, canceller):
        bundle = self.get_account(origin, account_id)
        results = []
        for command in bundle["commands"]:
            if command["status"] in {"acknowledged", "part_filled"}:
                self.request_cancel(origin, account_id, command["id"], canceller)
                results.append({"commandId": command["id"], "outcome": "cancelled"})
            elif command["status"] not in TERMINAL:
                results.append(
                    {
                        "commandId": command["id"],
                        "outcome": "not_cancellable_until_reconciled",
                        "status": command["status"],
                    }
                )
        return {"action": "cancel_open_orders", "results": results}
