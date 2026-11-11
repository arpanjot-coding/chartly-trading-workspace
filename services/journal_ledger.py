"""P03 record kinds and restore validation, independent of API/runtime code."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from datetime import datetime
from decimal import Decimal, localcontext

MAX_LEDGER_BYTES = 64 * 1024 * 1024
MAX_LEDGER_NODES = 1_000_000

FIELDS = (
    "events",
    "observations",
    "reviews",
    "history",
    "periodReviews",
    "mappings",
    "batches",
    "bookLinks",
)
KINDS = {name: name for name in FIELDS}
AMOUNT_FIELDS = {
    "netPnl",
    "grossPnl",
    "commission",
    "swap",
    "fees",
    "riskAmount",
    "quantity",
    "entryPrice",
    "exitPrice",
}


def _decimal(value, nullable=True):
    if value is None and nullable:
        return None
    if (
        not isinstance(value, str)
        or len(value) > 80
        or not re.fullmatch(r"-?(?:0|[1-9][0-9]{0,39})(?:\.[0-9]{1,24})?", value)
    ):
        raise ValueError("journal.invalid_decimal")
    return Decimal(value)


def _instant(value):
    if not isinstance(value, str) or not re.search(r"(?:Z|[+-]\d\d:\d\d)$", value):
        raise ValueError("journal.invalid_timestamp")
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("journal.invalid_timestamp") from error
    if date.tzinfo is None:
        raise ValueError("journal.invalid_timestamp")
    fraction = re.search(r"[.,](\d+)", value)
    if fraction and len(fraction[1].rstrip("0")) > 6:
        raise ValueError("journal.timestamp_precision_unsupported")
    return date


def _projection(row):
    if "amounts" not in row and "factRevision" not in row:
        return
    amounts = row.get("amounts")
    if not isinstance(amounts, dict) or set(amounts) - AMOUNT_FIELDS:
        raise ValueError("journal.invalid_amounts")
    for value in amounts.values():
        _decimal(value)

    def money_identity(values):
        if all(
            values.get(field) is not None
            for field in ("netPnl", "grossPnl", "commission", "fees", "swap")
        ):
            with localcontext() as context:
                context.prec = 100
                if Decimal(values["netPnl"]) != Decimal(values["grossPnl"]) - Decimal(
                    values["commission"]
                ) - Decimal(values["fees"]) + Decimal(values["swap"]):
                    raise ValueError("journal.amounts_do_not_reconcile")

    if row.get("origin", "manual") == "manual":
        money_identity(amounts)
    for field in ("entryPrice", "exitPrice", "quantity"):
        number = _decimal(amounts.get(field))
        if number is not None and (
            number < 0 or number == 0 and row.get("eventType", "trade") == "trade"
        ):
            raise ValueError("journal.invalid_positive_amount")
    if _decimal(amounts.get("riskAmount")) is not None and Decimal(amounts["riskAmount"]) < 0:
        raise ValueError("journal.invalid_risk")
    if not isinstance(row.get("currency"), str) or not re.fullmatch(
        r"[A-Z][A-Z0-9]{2,11}", row["currency"]
    ):
        raise ValueError("journal.invalid_currency")
    if row.get("eventType", "trade") not in ("trade", "deposit", "withdrawal", "fee") or row.get(
        "reviewStatus", "unreviewed"
    ) not in ("unreviewed", "reviewed"):
        raise ValueError("journal.invalid_projection")
    if row.get("direction") not in ("Buy", "Sell") or row.get("result") not in (
        "Open",
        "Win",
        "Loss",
        "Break Even",
    ):
        raise ValueError("journal.invalid_projection")
    opened = _instant(row.get("openDate"))
    if row["result"] == "Open":
        if row.get("closeDate"):
            raise ValueError("journal.invalid_projection")
    elif _instant(row.get("closeDate")) < opened or amounts.get("netPnl") is None:
        raise ValueError("journal.invalid_projection")
    elif row.get("eventType", "trade") == "trade":
        net = Decimal(amounts["netPnl"])
        expected = "Win" if net > 0 else "Loss" if net < 0 else "Break Even"
        if row["result"] != expected:
            raise ValueError("journal.result_amount_mismatch")
    for field in ("technicalNotes", "emotionalNotes", "otherNotes", "strategy", "pair"):
        if field in row and not isinstance(row[field], str):
            raise ValueError("journal.invalid_projection")
    for field in ("factRevision", "reviewRevision"):
        if field in row and (type(row[field]) is not int or row[field] < 0):
            raise ValueError("journal.invalid_projection")
    exits = row.get("realizations", [])
    if not isinstance(exits, list) or len(exits) > 100000:
        raise ValueError("journal.invalid_realizations")
    seen = set()
    for item in exits:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("id"), str)
            or item["id"] in seen
            or item.get("kind", "exit") not in ("exit", "fee")
        ):
            raise ValueError("journal.invalid_realizations")
        seen.add(item["id"])
        quantity = _decimal(item.get("quantity"), False)
        if (
            quantity < 0
            or item.get("kind", "exit") == "exit"
            and quantity == 0
            or _instant(item.get("closedAt")) < opened
        ):
            raise ValueError("journal.invalid_realizations")
        _decimal(item.get("netPnl"), False)
        for key in ("grossPnl", "commission", "swap", "fees", "exitPrice"):
            if key in item:
                _decimal(item[key])
        if row.get("origin", "manual") == "manual":
            money_identity(item)
    remaining = _decimal(row.get("remainingQuantity"))
    if remaining is not None and remaining < 0:
        raise ValueError("journal.invalid_remaining_quantity")
    if remaining is not None and (
        row["result"] == "Open" and remaining == 0 or row["result"] != "Open" and remaining != 0
    ):
        raise ValueError("journal.invalid_position_state")
    if exits:
        exit_times = [
            _instant(item["closedAt"]) for item in exits if item.get("kind", "exit") == "exit"
        ]
        if row["result"] != "Open" and exit_times and _instant(row["closeDate"]) != max(exit_times):
            raise ValueError("journal.final_exit_time_mismatch")
        with localcontext() as context:
            context.prec = 100
            total = sum((Decimal(item["netPnl"]) for item in exits), Decimal(0))
            if _decimal(amounts.get("netPnl")) != total:
                raise ValueError("journal.realized_total_mismatch")
            quantity = _decimal(amounts.get("quantity"))
            if (
                quantity is not None
                and remaining is not None
                and quantity - sum((Decimal(item["quantity"]) for item in exits), Decimal(0))
                != remaining
            ):
                raise ValueError("journal.remaining_quantity_mismatch")


def empty_ledger():
    return {"version": 1, **{name: [] for name in FIELDS}}


def validate_ledger(value, snapshot=None):
    if (
        not isinstance(value, dict)
        or set(value) != {"version", *FIELDS}
        or type(value.get("version")) is not int
        or value["version"] != 1
    ):
        raise ValueError("journal.invalid_ledger")
    if (
        any(not isinstance(value[name], list) for name in FIELDS)
        or sum(len(value[name]) for name in FIELDS) > 250000
    ):
        raise ValueError("journal.ledger_budget_exceeded")
    pending = [(value, 0)]
    nodes = 0
    while pending:
        item, depth = pending.pop()
        nodes += 1
        if nodes > MAX_LEDGER_NODES or depth > 40:
            raise ValueError("journal.ledger_budget_exceeded")
        if isinstance(item, dict):
            pending.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
    try:
        if (
            len(
                json.dumps(
                    value, ensure_ascii=False, allow_nan=False, separators=(",", ":")
                ).encode()
            )
            > MAX_LEDGER_BYTES
        ):
            raise ValueError("journal.ledger_budget_exceeded")
    except (TypeError, RecursionError) as error:
        raise ValueError("journal.invalid_ledger") from error
    trade_ids = {row["id"] for row in snapshot["tables"]["journalTrades"]} if snapshot else None
    profiles = {row["id"] for row in snapshot["tables"]["portfolios"]} if snapshot else None
    accounts = {row["id"] for row in snapshot["tables"]["brokerAccounts"]} if snapshot else None
    if snapshot:
        for row in snapshot["tables"]["journalTrades"]:
            _projection(row)
    for name in FIELDS:
        ids = set()
        for item in value[name]:
            if (
                not isinstance(item, dict)
                or not isinstance(item.get("id"), str)
                or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}", item["id"])
                or item["id"] in ids
            ):
                raise ValueError("journal.invalid_record_identity")
            ids.add(item["id"])
            if name == "events":
                from services.journal_import import JournalImportError, validate_normalized_event

                try:
                    validate_normalized_event(item)
                except JournalImportError as error:
                    raise ValueError("journal.invalid_source_event:" + error.code) from error
            if "tradeId" in item and (
                type(item["tradeId"]) is not int
                or not 0 < item["tradeId"] <= 9007199254740991
                or trade_ids is not None
                and item["tradeId"] not in trade_ids
            ):
                raise ValueError("journal.missing_trade")
            if name == "bookLinks" and (
                any(
                    type(item.get(field)) is not int or not 0 < item[field] <= 9007199254740991
                    for field in ("portfolioId", "accountId")
                )
                or snapshot is not None
                and (item["portfolioId"] not in profiles or item["accountId"] not in accounts)
            ):
                raise ValueError("journal.invalid_book_link")
            if name == "periodReviews" and (
                type(item.get("portfolioId")) is not int
                or not 0 < item["portfolioId"] <= 9007199254740991
                or not isinstance(item.get("includedTradeIds"), list)
                or any(
                    type(id) is not int
                    or not 0 < id <= 9007199254740991
                    or trade_ids is not None
                    and id not in trade_ids
                    for id in item["includedTradeIds"]
                )
                or snapshot is not None
                and item["portfolioId"] not in profiles
            ):
                raise ValueError("journal.invalid_period_review")
    return deepcopy(value)


def rebind_ledger(value, book_map):
    """Change only local book references; raw observations retain original proof."""
    value = deepcopy(value)

    def walk(item):
        if isinstance(item, dict):
            for key, child in item.items():
                if key == "bookId" and isinstance(child, str) and child in book_map:
                    item[key] = book_map[child]
                elif key not in ("raw", "before", "after", "sourceEvent"):
                    walk(child)
        elif isinstance(item, list):
            for child in item:
                walk(child)

    walk(value)
    return value
