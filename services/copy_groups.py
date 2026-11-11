"""Multi-account copy groups over the P11 execution core (P12).

A copy group fans one parent intent out to explicitly mapped
destinations. Every child is an independent P11 command with its own
idempotency key (`parentKey:destinationId`), its own pretrade/risk
verdict and its own outcome — a rejection in one account can never
make the group look filled, and a restart replays nothing because
child keys dedupe in the durable outbox.

Sizing is exact and previewable: the quantity shown in the preview is
the quantity submitted (step rounding is floor-only and reported;
below-minimum results skip the destination with a reason instead of
sending a zero or bumped-up order). Instrument equivalence is never
guessed: each destination carries its own instrument mapping/rules.
"""

from __future__ import annotations

from copy import deepcopy
from decimal import ROUND_FLOOR, Decimal

from services.execution import preview_ticket
from services.workspace_storage import WorkspaceError

SIZING_MODES = ("fixed", "multiplier", "proportional_to_equity")


def _error(code, status=400):
    raise WorkspaceError("copy." + code, status)


def _decimal(value):
    return Decimal(str(value))


def size_child(parent_quantity, sizing, rules, *, parent_equity=None, account_equity=None):
    """Return {quantity, appliedRounding} or {skip: reason}."""
    mode = sizing["mode"]
    if mode not in SIZING_MODES:
        _error("sizing_mode_unsupported", 422)
    base = _decimal(parent_quantity)
    if mode == "fixed":
        raw = _decimal(sizing["quantity"])
    elif mode == "multiplier":
        raw = base * _decimal(sizing["multiplier"])
    else:
        if parent_equity is None or account_equity is None:
            return {"skip": "equity_inputs_missing"}
        if _decimal(parent_equity) <= 0:
            return {"skip": "parent_equity_not_positive"}
        raw = base * _decimal(account_equity) / _decimal(parent_equity)
    step = _decimal(rules["quantityStep"])
    if step <= 0:
        _error("quantity_step_invalid", 422)
    steps = (raw / step).to_integral_value(rounding=ROUND_FLOOR)
    quantity = steps * step
    if quantity < _decimal(rules["minQuantity"]):
        return {"skip": "below_minimum_after_sizing"}
    if quantity > _decimal(rules["maxQuantity"]):
        return {"skip": "above_maximum_after_sizing"}
    return {
        "quantity": format(quantity.normalize(), "f"),
        "appliedRounding": "floor_to_step" if quantity != raw else "none",
        "rawQuantity": format(raw.normalize(), "f"),
    }


def validate_group(group):
    if group.get("state") not in {"armed", "paused", "disarmed"}:
        _error("group_state_invalid", 422)
    destinations = group.get("destinations") or []
    if not destinations:
        _error("group_empty", 422)
    seen = set()
    for row in destinations:
        destination_id = row["destination"]["id"]
        if destination_id in seen:
            _error("destination_duplicated", 422)
        seen.add(destination_id)
        if not row.get("instrumentId") or not row.get("rules"):
            _error("destination_mapping_missing", 422)  # ambiguous equivalence blocked
    return group


def preview_group(group, parent_intent, *, account_states, policies, parent_equity=None, account_equities=None, reference_price=None):
    validate_group(group)
    rows = []
    for entry in group["destinations"]:
        destination = entry["destination"]
        sized = size_child(
            parent_intent["quantity"]["value"],
            entry["sizing"],
            entry["rules"],
            parent_equity=parent_equity,
            account_equity=(account_equities or {}).get(destination["accountId"]),
        )
        if "skip" in sized:
            rows.append(
                {"destinationId": destination["id"], "accountId": destination["accountId"], "skipped": sized["skip"]}
            )
            continue
        child = _child_intent(parent_intent, entry, sized["quantity"])
        rows.append(
            {
                "destinationId": destination["id"],
                "accountId": destination["accountId"],
                "sizing": sized,
                "ticket": preview_ticket(
                    child,
                    destination,
                    entry["rules"],
                    policies[destination["accountId"]],
                    account_states[destination["accountId"]],
                    reference_price,
                ),
            }
        )
    return {"groupId": group["id"], "state": group["state"], "destinations": rows}


def _child_intent(parent_intent, entry, quantity):
    destination = entry["destination"]
    child = deepcopy(parent_intent)
    child["id"] = parent_intent["id"] + "-" + destination["id"].rsplit("-", 1)[-1]
    child["accountId"] = destination["accountId"]
    child["instrumentId"] = entry["instrumentId"]
    child["mode"] = destination["mode"]
    child["quantity"] = {"value": quantity, "unit": parent_intent["quantity"]["unit"]}
    child["idempotencyKey"] = parent_intent["idempotencyKey"] + ":" + destination["id"]
    child.pop("destinationId", None)
    return child


def fan_out(service, origin, group, parent_intent, *, dispatchers, account_states, policies, parent_equity=None, account_equities=None, reference_price=None):
    """Dispatch children independently through P11; collect outcomes."""
    validate_group(group)
    if group["state"] != "armed":
        _error("group_not_armed", 409)
    results = []
    for entry in group["destinations"]:
        destination = entry["destination"]
        account_id = destination["accountId"]
        sized = size_child(
            parent_intent["quantity"]["value"],
            entry["sizing"],
            entry["rules"],
            parent_equity=parent_equity,
            account_equity=(account_equities or {}).get(account_id),
        )
        if "skip" in sized:
            results.append({"destinationId": destination["id"], "outcome": "skipped", "reason": sized["skip"]})
            continue
        child = _child_intent(parent_intent, entry, sized["quantity"])
        try:
            submitted = service.submit(
                origin,
                destination=destination,
                intent=child,
                rules=entry["rules"],
                policy=policies[account_id],
                account_state=account_states[account_id],
                dispatcher=dispatchers[destination["id"]],
                reference_price=reference_price,
            )
            results.append(
                {
                    "destinationId": destination["id"],
                    "outcome": submitted["command"]["status"],
                    "commandId": submitted["command"]["id"],
                    "duplicate": submitted["duplicate"],
                    "quantity": sized["quantity"],
                }
            )
        except WorkspaceError as error:
            results.append(
                {"destinationId": destination["id"], "outcome": "blocked", "reason": error.code}
            )
    return {"groupId": group["id"], "results": results, "summary": group_status(results)}


def group_status(results):
    """Group state derived from children; filled only if *all* filled."""
    outcomes = [row["outcome"] for row in results if row["outcome"] != "skipped"]
    counts = {}
    for outcome in outcomes:
        counts[outcome] = counts.get(outcome, 0) + 1
    if outcomes and all(outcome == "filled" for outcome in outcomes):
        state = "filled"
    elif any(outcome in {"acknowledged", "part_filled", "submitted"} for outcome in outcomes):
        state = "working"
    elif any(outcome == "unknown" for outcome in outcomes):
        state = "attention_unknown"
    elif outcomes:
        state = "partial_or_failed"
    else:
        state = "no_eligible_destinations"
    return {"state": state, "counts": counts}


def divergence_actions(results):
    """Per-destination next actions after mixed outcomes (T06)."""
    actions = []
    for row in results:
        outcome = row["outcome"]
        if outcome in {"filled", "acknowledged", "part_filled"}:
            action = "none"
        elif outcome == "unknown":
            action = "reconcile_with_broker_before_any_retry"
        elif outcome == "blocked":
            action = "fix_reason_then_submit_manually"
        elif outcome == "rejected":
            action = "review_broker_reason"
        elif outcome == "skipped":
            action = "review_sizing"
        else:
            action = "refresh_from_broker"
        actions.append({"destinationId": row["destinationId"], "outcome": outcome, "nextAction": action})
    return actions
