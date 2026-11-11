"""Exactly-once confirmed paper fills into the existing independent journal book.

Only mutates caller-supplied in-memory state inside the authoritative transaction.
It performs no database, price, transport, file or broker work.
"""

from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, localcontext

from services.journal_import import _event_hash, _key, validate_normalized_event
from services.journal_service import REVIEW_FIELDS, _projection, decimal_text, instant
from services.workspace_storage import WorkspaceError, digest, opaque, valid_id

JOURNAL_UNITS = {"share": "shares", "base_asset": "coins", "contract": "contracts", "lot": "lots"}


def _text(value):
    return decimal_text(format(value, "f"))


def _instant(value):
    from datetime import UTC, datetime

    return instant(datetime.fromtimestamp(value, UTC).isoformat())


def paper_book_id(uid, origin, run_id):
    return opaque("book", uid + "|" + origin + "|paper|" + str(run_id))


def _event(record, position, fill, trade_id, book_id):
    context = {"provider": "chartly-paper", "accountKey": record["manifest"]["id"]}
    event_id = fill["id"]
    kind = fill["kind"]
    instrument = record["config"]["instrument"]
    event = {
        "version": 1,
        **context,
        "bookId": book_id,
        "portfolioId": record["profileId"],
        "eventId": event_id,
        "eventKey": _key("event", context, event_id),
        "type": kind,
        "positionId": position["id"],
        "positionKey": _key("position", context, position["id"]),
        "currency": instrument["currency"],
        "quantityUnit": JOURNAL_UNITS[instrument["quantityUnit"]],
        "symbol": instrument["symbol"],
        "side": "Buy" if fill["side"] == "buy" else "Sell",
        "quantity": fill["quantity"],
        "price": fill["price"],
        "commission": fill["fee"],
        "fees": "0",
        "swap": "0",
        "grossPnl": fill["grossPnl"],
        "netPnl": _text(Decimal(fill["grossPnl"]) - Decimal(fill["fee"])),
        "pnlMultiplier": instrument["multiplier"],
        "sequence": fill["sequence"],
        "occurredAt": _instant(fill["time"]),
        "orderId": fill["orderId"],
        "source": {
            "rowNumber": fill["sequence"] + 1,
            "sourceHash": digest(fill),
            "timezone": "UTC",
            "raw": {
                "engine": "chartly-paper-v1",
                "fillId": fill["id"],
                "manifestId": record["manifest"]["id"],
            },
            "missingCostPolicy": "declared-zero",
        },
        "tradeId": trade_id,
    }
    event["id"] = event["eventKey"]
    event["canonicalHash"] = _event_hash(event)
    return validate_normalized_event(event)


def project_paper_positions(state, session, record, *, at):
    if session["id"] != record["runId"] or session["portfolioId"] != record["profileId"]:
        raise WorkspaceError("paper.projection_scope_mismatch")
    ledger = state["journalLedger"]
    trades = state["snapshot"]["tables"]["journalTrades"]
    book_id = record["manifest"]["bookId"]
    fills = record["state"]["fills"]
    events_by_id = {item["id"]: item for item in ledger["events"]}
    trade_ids, applied = [], []
    with localcontext() as arithmetic:
        arithmetic.prec = 100
        for position in record["state"]["positions"]:
            context = {"provider": "chartly-paper", "accountKey": record["manifest"]["id"]}
            position_key = _key("position", context, position["id"])
            existing = next(
                (
                    row
                    for row in trades
                    if row.get("positionKey") == position_key
                    and row.get("sessionId") == session["id"]
                ),
                None,
            )
            trade_id = (
                existing["id"] if existing else max((item["id"] for item in trades), default=0) + 1
            )
            if not valid_id(trade_id):
                raise WorkspaceError("journal.identity_exhausted")
            related = [fill for fill in fills if fill["positionId"] == position["id"]]
            if not related:
                raise WorkspaceError("paper.position_missing_fill")
            confirmed = []
            for fill in related:
                event = _event(record, position, fill, trade_id, book_id)
                previous = events_by_id.get(event["id"])
                if previous is not None and previous != event:
                    raise WorkspaceError("paper.fill_identity_conflict", 409)
                if previous is None:
                    ledger["events"].append(event)
                    events_by_id[event["id"]] = event
                    applied.append(fill["id"])
                confirmed.append((fill, event))
            realized = []
            for fill, event in confirmed:
                if fill["kind"] == "entry":
                    if Decimal(fill["fee"]) == 0:
                        continue
                    realized.append(
                        {
                            "id": event["id"],
                            "kind": "fee",
                            "quantity": "0",
                            "closedAt": event["occurredAt"],
                            "netPnl": event["netPnl"],
                            "grossPnl": "0",
                            "commission": fill["fee"],
                            "fees": "0",
                            "swap": "0",
                            "sourceEventKey": event["id"],
                        }
                    )
                else:
                    realized.append(
                        {
                            "id": event["id"],
                            "kind": "exit",
                            "quantity": fill["quantity"],
                            "closedAt": event["occurredAt"],
                            "exitPrice": fill["price"],
                            "netPnl": event["netPnl"],
                            "grossPnl": fill["grossPnl"],
                            "commission": fill["fee"],
                            "fees": "0",
                            "swap": "0",
                            "sourceEventKey": event["id"],
                        }
                    )
            net = sum((Decimal(item["netPnl"]) for item in realized), Decimal(0))
            gross = sum((Decimal(item["grossPnl"]) for item in realized), Decimal(0))
            fees = sum((Decimal(item["commission"]) for item in realized), Decimal(0))
            exit_qty = Decimal(position["exitQuantity"])
            price = (
                (Decimal(position["exitNotional"]) / exit_qty).quantize(
                    Decimal("0.000000000000000001")
                )
                if exit_qty
                else None
            )
            closed = position["status"] == "closed"
            row = {
                **deepcopy(existing or {}),
                "id": trade_id,
                "portfolioId": record["profileId"],
                "sessionId": session["id"],
                "origin": "simulator",
                "eventType": "trade",
                "journalBookId": book_id,
                "positionKey": position_key,
                "paperManifestId": record["manifest"]["id"],
                "paperPositionId": position["id"],
                "externalId": position["orderId"],
                "sl": float(position["stopLoss"]) if "stopLoss" in position else 0,
                "tp": float(position["takeProfit"]) if "takeProfit" in position else 0,
                "pair": record["config"]["instrument"]["symbol"],
                "direction": "Buy" if position["side"] == "buy" else "Sell",
                "currency": record["config"]["instrument"]["currency"],
                "quantityUnit": JOURNAL_UNITS[record["config"]["instrument"]["quantityUnit"]],
                "openDate": _instant(position["entryTime"]),
                "closeDate": _instant(position["closedTime"]) if closed else "",
                "result": "Open"
                if not closed
                else "Win"
                if net > 0
                else "Loss"
                if net < 0
                else "Break Even",
                "amounts": {
                    "quantity": position["initialQuantity"],
                    "entryPrice": position["entryPrice"],
                    "exitPrice": _text(price) if price is not None else None,
                    "netPnl": _text(net) if realized else None,
                    "grossPnl": _text(gross) if realized else None,
                    "commission": _text(fees),
                    "fees": "0",
                    "swap": "0",
                    "riskAmount": (existing or {}).get("amounts", {}).get("riskAmount"),
                },
                "remainingQuantity": position["quantity"],
                "realizations": realized,
                "sourceEventKeys": [event["id"] for _, event in confirmed],
                "timeframe": record["config"]["instrument"]["interval"],
                "sourceStrategy": "Historical paper",
                "strategy": (existing or {}).get("strategy", "Historical paper"),
                "technicalNotes": (existing or {}).get("technicalNotes", ""),
                "emotionalNotes": (existing or {}).get("emotionalNotes", ""),
                "otherNotes": (existing or {}).get("otherNotes", ""),
                "reviewStatus": (existing or {}).get("reviewStatus", "unreviewed"),
                "reviewRevision": (existing or {}).get("reviewRevision", 0),
                "factRevision": (existing or {}).get("factRevision", 0),
            }
            before = deepcopy(existing)
            ignore = REVIEW_FIELDS | {
                "factRevision",
                "reviewRevision",
                "reviewedAt",
                "journalBookId",
            }
            old_facts = {key: value for key, value in (existing or {}).items() if key not in ignore}
            new_facts = {key: value for key, value in row.items() if key not in ignore}
            changed = old_facts != new_facts
            if changed:
                row["factRevision"] += 1
            _projection(row)
            # Compare after the legacy presentation projection too, otherwise the
            # second identical projection spuriously adds another fact revision.
            changed = existing is None or {
                k: v for k, v in existing.items() if k not in ignore
            } != {k: v for k, v in row.items() if k not in ignore}
            if changed:
                if existing is None:
                    trades.append(row)
                else:
                    existing.clear()
                    existing.update(row)
                state["bindings"].setdefault("resolutions", {})["trade:" + str(trade_id)] = (
                    "paper:" + str(session["id"])
                )
                sequence = (
                    max((item.get("sequence", 0) for item in ledger["history"]), default=0) + 1
                )
                ledger["history"].append(
                    {
                        "id": opaque(
                            "paperhistory",
                            record["manifest"]["id"]
                            + "|"
                            + position["id"]
                            + "|"
                            + digest([event["id"] for _, event in confirmed]),
                        ),
                        "sequence": sequence,
                        "at": at,
                        "action": "paper-fill-projection",
                        "tradeId": trade_id,
                        "bookId": book_id,
                        "runId": session["id"],
                        "before": before,
                        "after": deepcopy(row),
                        "reason": "Confirmed immutable historical paper executions",
                    }
                )
            trade_ids.append(trade_id)
    return {"tradeIds": trade_ids, "appliedFillIds": applied}
