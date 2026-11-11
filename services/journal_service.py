"""Account-scoped journal lifecycle, source reconciliation and review history.

All mutations share the workspace transaction/CAS/receipt boundary. Nothing in
this module talks to a broker, fetches a URL or starts supplied source code.
"""

from __future__ import annotations

import base64
import csv
import hashlib
import json
import re
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation, localcontext
from io import StringIO
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, insert, literal_column, select, update

from database.workspace_storage_db import TABLES, assets, jobs
from services.journal_ledger import empty_ledger, validate_ledger
from services.workspace_storage import (
    WorkspaceError,
    WorkspaceStorage,
    digest,
    dumps,
    now,
    opaque,
    valid_id,
    valid_origin,
    validate_snapshot,
)

MONEY_FIELDS = (
    "netPnl",
    "grossPnl",
    "commission",
    "swap",
    "fees",
    "riskAmount",
    "quantity",
    "entryPrice",
    "exitPrice",
)
LEGACY = {
    "netPnl": "netPnl",
    "grossPnl": "grossPnl",
    "commission": "commission",
    "swap": "swap",
    "fees": "fees",
    "riskAmount": "riskAmount",
    "quantity": "lots",
    "entryPrice": "entryPrice",
    "exitPrice": "exitPrice",
}
REVIEW_FIELDS = {
    "strategy",
    "setup",
    "tags",
    "rating",
    "chartUrl",
    "screenshotUrl",
    "preTradeState",
    "conviction",
    "planConfirmed",
    "riskDefined",
    "emotion",
    "emotionalNotes",
    "technicalNotes",
    "otherNotes",
    "notes",
    "reviewStatus",
    "decisionId",
    "copyGroupId",
}
MAX_IMAGE_BYTES = 8 * 1024 * 1024


def decimal_text(value, *, optional=False, positive=False):
    if value is None and optional:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise WorkspaceError("journal.invalid_decimal")
    text = str(value)
    if len(text) > 80 or not re.fullmatch(r"-?(?:0|[1-9][0-9]{0,39})(?:\.[0-9]{1,24})?", text):
        raise WorkspaceError("journal.invalid_decimal")
    try:
        number = Decimal(text)
    except InvalidOperation as error:
        raise WorkspaceError("journal.invalid_decimal") from error
    if not number.is_finite() or positive and number <= 0:
        raise WorkspaceError("journal.invalid_quantity")
    text = format(number, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if number == 0 else text


def exact_sum(values):
    with localcontext() as context:
        context.prec = 100
        return decimal_text(format(sum((Decimal(value) for value in values), Decimal(0)), "f"))


def validate_money_identity(amounts):
    fields = ("netPnl", "grossPnl", "commission", "swap", "fees")
    if any(amounts.get(field) is None for field in fields):
        return
    with localcontext() as context:
        context.prec = 100
        if Decimal(amounts["netPnl"]) != Decimal(amounts["grossPnl"]) - Decimal(
            amounts["commission"]
        ) - Decimal(amounts["fees"]) + Decimal(amounts["swap"]):
            raise WorkspaceError("journal.amounts_do_not_reconcile")


def instant(value):
    if (
        not isinstance(value, str)
        or len(value) > 80
        or not re.search(r"(?:Z|[+-]\d\d:\d\d)$", value)
    ):
        raise WorkspaceError("journal.timestamp_offset_required")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise WorkspaceError("journal.invalid_timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise WorkspaceError("journal.timestamp_offset_required")
    fraction = re.search(r"T\d\d:\d\d:\d\d\.(\d+)", value)
    if fraction and len(fraction[1]) > 6 and any(char != "0" for char in fraction[1][6:]):
        raise WorkspaceError("journal.timestamp_precision_unsupported")
    return parsed.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def safe_text(value, limit=20000):
    if not isinstance(value, str) or len(value) > limit or "\x00" in value:
        raise WorkspaceError("journal.invalid_text")
    return value


def _currency(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Z][A-Z0-9]{2,11}", value):
        raise WorkspaceError("journal.invalid_currency")
    return value


def _amounts(row):
    supplied = row.get("amounts", {})
    if not isinstance(supplied, dict) or set(supplied) - set(MONEY_FIELDS):
        raise WorkspaceError("journal.invalid_amounts")
    return {
        name: decimal_text(
            supplied[name] if name in supplied else row.get(LEGACY[name]),
            optional=True,
            positive=name in ("quantity", "entryPrice", "exitPrice"),
        )
        for name in MONEY_FIELDS
    }


def _review(value):
    if not isinstance(value, dict) or set(value) - REVIEW_FIELDS:
        raise WorkspaceError("journal.invalid_review")
    value = deepcopy(value)
    for field in (
        "strategy",
        "setup",
        "emotionalNotes",
        "technicalNotes",
        "otherNotes",
        "notes",
        "decisionId",
        "copyGroupId",
    ):
        if field in value:
            safe_text(value[field], 20000 if field.endswith("Notes") or field == "notes" else 500)
    for field in ("chartUrl", "screenshotUrl"):
        if field in value and value[field] is not None:
            text = safe_text(value[field], 5000)
            if text and not text.startswith(
                ("https://", "http://", "/trading?", "/api/local/v1/attachments/")
            ):
                raise WorkspaceError("journal.invalid_evidence_url")
    if "tags" in value and (
        not isinstance(value["tags"], list)
        or len(value["tags"]) > 30
        or any(not isinstance(tag, str) or not 1 <= len(tag) <= 100 for tag in value["tags"])
    ):
        raise WorkspaceError("journal.invalid_tags")
    for field in ("planConfirmed", "riskDefined"):
        if field in value and type(value[field]) is not bool:
            raise WorkspaceError("journal.invalid_review")
    for field in ("rating", "conviction"):
        if (
            field in value
            and value[field] is not None
            and (type(value[field]) not in (int, float) or not 0 <= value[field] <= 100)
        ):
            raise WorkspaceError("journal.invalid_review")
    if "emotion" in value:
        if value["emotion"] is not None and (
            not isinstance(value["emotion"], dict)
            or set(value["emotion"]) - {"fomo", "patience", "discipline", "confidence"}
            or any(
                type(score) not in (int, float) or not 0 <= score <= 100
                for score in value["emotion"].values()
            )
        ):
            raise WorkspaceError("journal.invalid_review")
    if "reviewStatus" in value and value["reviewStatus"] not in ("reviewed", "unreviewed"):
        raise WorkspaceError("journal.invalid_review")
    return value


def _projection(row):
    amounts = row["amounts"]
    for field, legacy in LEGACY.items():
        if amounts.get(field) is not None:
            row[legacy] = float(amounts[field])
        elif legacy in ("netPnl", "lots"):
            row[legacy] = 0
        else:
            row.pop(legacy, None)
    row["pnl"] = row.get("netPnl", 0)
    risk = amounts.get("riskAmount")
    net = amounts.get("netPnl")
    row["rMultiple"] = (
        float(Decimal(net) / Decimal(risk))
        if net is not None and risk is not None and Decimal(risk) > 0
        else None
    )
    if row.get("result") != "Open":
        row["result"] = (
            "Win"
            if Decimal(net or "0") > 0
            else "Loss"
            if Decimal(net or "0") < 0
            else "Break Even"
        )
    if row.get("closeDate"):
        row["duration"] = max(
            0,
            int(
                (
                    datetime.fromisoformat(row["closeDate"].replace("Z", "+00:00"))
                    - datetime.fromisoformat(row["openDate"].replace("Z", "+00:00"))
                ).total_seconds()
                / 60
            ),
        )
    else:
        row["duration"] = 0
    return row


class JournalService:
    def __init__(self, storage: WorkspaceStorage):
        self.storage = storage

    def state(self, origin):
        with self.storage.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            state = self.storage._read(connection, origin, full_modules=False)
            pending = []
            fields = (
                "id",
                "expectedRevision",
                "createdAt",
                "status",
                "bookId",
                "portfolioId",
                "provider",
            )
            columns = [
                func.json_extract(
                    jobs.c.payload,
                    ("$." + field)
                    if field not in ("bookId", "portfolioId", "provider")
                    else ("$.context." + field),
                )
                for field in fields
            ]
            for values in connection.execute(
                select(*columns)
                .where(
                    jobs.c.uid == self.storage.uid,
                    jobs.c.kind == "journal-import",
                    func.json_extract(jobs.c.payload, "$.originId") == origin,
                )
                .order_by(literal_column("rowid").desc())
                .limit(20)
            ):
                pending.append(dict(zip(fields, values, strict=True)))
            return {
                "originId": origin,
                "revision": state["revision"],
                "books": state["bindings"]["books"],
                "ledger": state["journalLedger"],
                "imports": pending,
            }

    def import_job(self, id, origin=None):
        job = self.storage.get_job(id, "journal-import")
        if origin is not None and origin != job["originId"]:
            raise WorkspaceError("storage.job_not_found", 404)
        return {
            key: value
            for key, value in job.items()
            if key
            in ("id", "originId", "expectedRevision", "createdAt", "status", "preview", "receipt")
        }

    def repreview_import(self, id, expected_revision):
        job = self.storage.get_job(id, "journal-import")
        context = job["context"]
        return self.preview_import(
            job["originId"],
            context["portfolioId"],
            context["bookId"],
            context["provider"],
            job["csvText"],
            job["mapping"],
            expected_revision,
            context.get("accountId"),
        )

    def _trade(self, state, id):
        if not valid_id(id):
            raise WorkspaceError("journal.invalid_trade_id")
        row = next(
            (row for row in state["snapshot"]["tables"]["journalTrades"] if row["id"] == id), None
        )
        if row is None:
            raise WorkspaceError("journal.trade_not_found", 404)
        return row

    def _book(self, state, book_id, portfolio_id=None):
        if portfolio_id is not None and not valid_id(portfolio_id):
            raise WorkspaceError("journal.invalid_profile")
        book = next((book for book in state["bindings"]["books"] if book["id"] == book_id), None)
        if (
            book is None
            or portfolio_id is not None
            and portfolio_id not in book.get("profileIds", [])
        ):
            raise WorkspaceError("journal.book_not_found", 404)
        return book

    def _trade_book(self, state, trade):
        return state["bindings"]["bookAssignments"].get(str(trade["id"]))

    def _detail(self, state, id):
        trade = deepcopy(self._trade(state, id))
        ledger = state["journalLedger"]
        trade["journalBookId"] = self._trade_book(state, trade)
        preserved = [
            {**deepcopy(row), "provenance": "preserved-browser-history"}
            for row in trade.get("history", [])
            if isinstance(row, dict)
        ]
        return {
            "trade": trade,
            "review": next((row for row in ledger["reviews"] if row.get("tradeId") == id), {}),
            "history": preserved + [row for row in ledger["history"] if row.get("tradeId") == id],
            "executions": [
                row
                for row in ledger["events"]
                if row.get("tradeId") == id
                or row.get("eventKey") in trade.get("sourceEventKeys", [])
            ],
            "observations": [
                row
                for row in ledger["observations"]
                if row.get("sourceEvent", {}).get("eventKey") in trade.get("sourceEventKeys", [])
            ],
        }

    def detail(self, origin, trade_id):
        with self.storage.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            return self._detail(
                self.storage._read(connection, origin, full_modules=False), trade_id
            )

    def _history(self, state, trade, before, action, reason=""):
        history = {
            "id": "history_" + uuid4().hex,
            "at": now(),
            "action": action,
            "tradeId": trade["id"],
            "bookId": self._trade_book(state, trade),
            "before": deepcopy(before),
            "after": deepcopy(trade),
            "reason": safe_text(reason, 2000),
        }
        self._append_history(state, history)

    def _append_history(self, state, record):
        if "_historySequence" not in state:
            state["_historySequence"] = max(
                [row.get("sequence", 0) for row in state["journalLedger"]["history"]] + [0]
            )
        state["_historySequence"] += 1
        record["sequence"] = state["_historySequence"]
        state["journalLedger"]["history"].append(record)

    def _manual(self, state, value, previous=None):
        if not isinstance(value, dict):
            raise WorkspaceError("journal.invalid_trade")
        if "chartEvidence" in value and value.get("chartEvidence") != (previous or {}).get(
            "chartEvidence"
        ):
            raise WorkspaceError("chart.evidence_server_owned", 409)
        row = deepcopy(previous or {})
        row.update(deepcopy(value))
        supplied = value.get("amounts", {})
        if not isinstance(supplied, dict):
            raise WorkspaceError("journal.invalid_amounts")
        row["amounts"] = {**(previous or {}).get("amounts", {}), **supplied}
        for key, legacy in LEGACY.items():
            if legacy in value and key not in supplied:
                row["amounts"][key] = decimal_text(value[legacy], optional=True)
        for field in ("history", "id", "factRevision", "reviewRevision", "reviewedAt"):
            row.pop(field, None)
        if previous:
            row["id"] = previous["id"]
        elif any(
            row.get(key)
            for key in (
                "sourceEventKeys",
                "positionKey",
                "externalOrderId",
                "externalPositionId",
                "externalDealId",
                "realizations",
            )
        ):
            raise WorkspaceError("journal.source_provenance_is_server_owned")
        if (
            row.get("origin") not in (None, "manual")
            or row.get("accountId")
            or row.get("sessionId")
        ):
            raise WorkspaceError("journal.manual_book_required")
        if not valid_id(row.get("portfolioId")):
            raise WorkspaceError("journal.invalid_profile")
        profile = next(
            (
                item
                for item in state["snapshot"]["tables"]["portfolios"]
                if item["id"] == row["portfolioId"] and not item.get("archivedAt")
            ),
            None,
        )
        if profile is None:
            raise WorkspaceError("journal.profile_not_found", 404)
        row["origin"] = "manual"
        row["eventType"] = "trade"
        row["currency"] = _currency(row.get("currency", profile.get("currency")))
        row["pair"] = safe_text(row.get("pair", ""), 200).strip()
        if not row["pair"] or row.get("direction") not in ("Buy", "Sell"):
            raise WorkspaceError("journal.symbol_direction_required")
        row["openDate"] = instant(row.get("openDate"))
        if row.get("sourceTimezone"):
            try:
                ZoneInfo(row["sourceTimezone"])
            except (ZoneInfoNotFoundError, TypeError, ValueError) as error:
                raise WorkspaceError("journal.invalid_timezone") from error
        row["amounts"] = _amounts(row)
        validate_money_identity(row["amounts"])
        row["quantityUnit"] = row.get("quantityUnit", "lots")
        if row["quantityUnit"] not in ("lots", "units", "shares", "contracts", "coins"):
            raise WorkspaceError("journal.invalid_quantity_unit")
        if row.get("result") == "Open":
            if row.get("closeDate"):
                raise WorkspaceError("journal.open_trade_has_close_time")
            if not row.get("realizations") and row["amounts"]["netPnl"] not in (None, "0"):
                raise WorkspaceError("journal.open_pnl_requires_exit")
            if not row.get("realizations"):
                row["amounts"]["netPnl"] = None
            row["closeDate"] = ""
            row["remainingQuantity"] = (
                row.get("remainingQuantity")
                if row.get("realizations")
                else row["amounts"]["quantity"]
            )
        else:
            row["closeDate"] = instant(row.get("closeDate"))
            if row["closeDate"] < row["openDate"]:
                raise WorkspaceError("journal.close_before_open")
            if row["amounts"]["netPnl"] is None:
                raise WorkspaceError("journal.closed_pnl_required")
            row["remainingQuantity"] = "0"
        book = next(
            (
                book
                for book in state["bindings"]["books"]
                if book["kind"] == "manual" and row["portfolioId"] in book.get("profileIds", [])
            ),
            None,
        )
        if book is None or row.get("journalBookId") not in (None, book["id"]):
            raise WorkspaceError("journal.manual_book_required")
        row["journalBookId"] = book["id"]
        row.update(_review({key: val for key, val in row.items() if key in REVIEW_FIELDS}))
        for key in REVIEW_FIELDS:
            if row.get(key, "") is None:
                row.pop(key, None)
        for field, default in [
            ("timeframe", ""),
            ("strategy", ""),
            ("rr", 0),
            ("sl", 0),
            ("tp", 0),
            ("emotionalNotes", ""),
            ("technicalNotes", ""),
            ("otherNotes", ""),
        ]:
            row.setdefault(field, default)
        row["reviewStatus"] = row.get("reviewStatus", "unreviewed")
        row["factRevision"] = (previous or {}).get("factRevision", 0) + 1
        row["reviewRevision"] = (previous or {}).get("reviewRevision", 0)
        if previous and previous.get("reviewedAt"):
            row["reviewedAt"] = previous["reviewedAt"]
        return _projection(row)

    def _save(self, connection, state, origin):
        state["snapshot"] = validate_snapshot(state["snapshot"])
        try:
            validate_ledger(state["journalLedger"], state["snapshot"])
        except ValueError as error:
            raise WorkspaceError(str(error), 413 if "budget" in str(error) else 400) from error
        bindings = self.storage._bindings(
            state["snapshot"],
            state["bindings"].get("resolutions", {}),
            ledger=state["journalLedger"],
        )
        bindings["nativeNamespaceMappings"] = state["bindings"].get("nativeNamespaceMappings", {})
        self.storage._write(connection, state["snapshot"], bindings, module_change=False)
        self.storage._write_journal_ledger(
            connection, origin, state["journalLedger"], state["snapshot"]
        )
        state["bindings"] = bindings

    def action(self, origin, expected_revision, request_id, action, payload):
        if not isinstance(payload, dict):
            raise WorkspaceError("journal.invalid_action")
        try:
            dumps(payload).encode("utf-8")
        except UnicodeError as error:
            raise WorkspaceError("journal.invalid_text") from error
        body = {
            "origin": origin,
            "expectedRevision": expected_revision,
            "action": action,
            "payload": payload,
        }
        with self.storage.transaction() as connection:
            replay = self.storage._receipt(connection, request_id, "journal", body)
            if replay is not None:
                receipt = replay
            else:
                state = self.storage._read(connection, origin, full_modules=False)
                if type(expected_revision) is not int or state["revision"] != expected_revision:
                    raise WorkspaceError("storage.revision_conflict", 409)
                result = self._apply(state, action, payload)
                self._save(connection, state, origin)
                receipt = {"result": result}
                if result.get("tradeId"):
                    receipt["detail"] = self._detail(state, result["tradeId"])
                self.storage._save_receipt(connection, request_id, "journal", body, receipt)
        return {**receipt, "workspace": self.storage.workspace(origin)}

    def _apply(self, state, action, payload):
        tables = state["snapshot"]["tables"]
        ledger = state["journalLedger"]
        if action == "create-book":
            if set(payload) != {"portfolioId", "accountId"}:
                raise WorkspaceError("journal.invalid_action")
            if not valid_id(payload["portfolioId"]) or not valid_id(payload["accountId"]):
                raise WorkspaceError("journal.invalid_destination")
            if not any(
                row["id"] == payload["portfolioId"] and not row.get("archivedAt")
                for row in tables["portfolios"]
            ) or not any(
                row["id"] == payload["accountId"] and not row.get("archivedAt")
                for row in tables["brokerAccounts"]
            ):
                raise WorkspaceError("journal.destination_not_found", 404)
            link = {"id": f"book-link:{payload['portfolioId']}:{payload['accountId']}", **payload}
            if not any(row["id"] == link["id"] for row in ledger["bookLinks"]):
                ledger["bookLinks"].append(link)
            bindings = self.storage._bindings(
                state["snapshot"], state["bindings"].get("resolutions", {}), ledger=ledger
            )
            book = next(
                book
                for book in bindings["books"]
                if book["kind"] == "connected"
                and book.get("accountId") == payload["accountId"]
                and payload["portfolioId"] in book["profileIds"]
            )
            return {"bookId": book["id"]}
        if action == "save-mapping":
            from services.journal_import import validate_mapping

            supplied = payload.get("mapping")
            if not isinstance(supplied, dict):
                raise WorkspaceError("journal.invalid_mapping")
            try:
                mapping = validate_mapping(
                    {
                        key: value
                        for key, value in supplied.items()
                        if key not in ("id", "updatedAt", "createdAt", "provider")
                    }
                )
            except Exception as error:
                if hasattr(error, "code"):
                    raise WorkspaceError(
                        "journal.invalid_mapping",
                        400,
                        [{"code": error.code, "message": str(error)}],
                    ) from error
                raise
            mapping = {
                **mapping,
                "id": str(payload.get("mapping", {}).get("id") or "mapping_" + uuid4().hex),
                "updatedAt": now(),
            }
            previous = next(
                (item for item in ledger["mappings"] if item["id"] == mapping["id"]), None
            )
            if previous:
                previous.update(mapping)
            else:
                ledger["mappings"].append(mapping)
            return {"mapping": mapping}
        if action == "review-period":
            return self._period_review(state, payload)
        if action == "create-trade":
            if set(payload) != {"trade"}:
                raise WorkspaceError("journal.invalid_action")
            trade = self._manual(state, payload["trade"])
            trade["id"] = max([row["id"] for row in tables["journalTrades"]] + [0]) + 1
            if not valid_id(trade["id"]):
                raise WorkspaceError("journal.identity_exhausted")
            tables["journalTrades"].append(trade)
            state["bindings"] = self.storage._bindings(
                state["snapshot"], state["bindings"].get("resolutions", {}), ledger=ledger
            )
            self._history(state, trade, None, "create")
            return {"tradeId": trade["id"]}
        if action not in (
            "update-trade",
            "close-trade",
            "partial-close-trade",
            "correct-realization",
            "review-trade",
            "archive-trade",
            "restore-trade",
        ):
            raise WorkspaceError("journal.unknown_action")
        trade = self._trade(state, payload.get("tradeId"))
        if trade.get("archivedAt") and action != "restore-trade":
            raise WorkspaceError("journal.trade_archived", 409)
        before = deepcopy(trade)
        if action in ("archive-trade", "restore-trade"):
            if set(payload) != {"tradeId"}:
                raise WorkspaceError("journal.invalid_action")
            if action == "archive-trade":
                trade["archivedAt"] = now()
            else:
                trade.pop("archivedAt", None)
        elif action == "review-trade":
            if set(payload) - {"tradeId", "review"}:
                raise WorkspaceError("journal.invalid_action")
            review = _review(payload.get("review"))
            trade.update(review)
            for key in REVIEW_FIELDS:
                if trade.get(key, "") is None:
                    trade.pop(key, None)
            trade["reviewRevision"] = trade.get("reviewRevision", 0) + 1
            if review.get("reviewStatus") == "reviewed":
                trade["reviewedAt"] = now()
            record = {
                "id": "review:" + str(trade["id"]),
                "tradeId": trade["id"],
                "bookId": self._trade_book(state, trade),
                "revision": trade["reviewRevision"],
                "reviewedFactRevision": trade.get("factRevision", 0),
                "updatedAt": now(),
                "fields": {key: trade[key] for key in REVIEW_FIELDS if key in trade},
            }
            prior = next((row for row in ledger["reviews"] if row["id"] == record["id"]), None)
            if prior:
                prior.update(record)
            else:
                ledger["reviews"].append(record)
        else:
            if trade.get("origin", "manual") != "manual":
                raise WorkspaceError("trade.source_fact_locked", 409)
            if action == "partial-close-trade":
                self._partial_close(trade, payload)
            elif action == "correct-realization":
                self._correct_realization(trade, payload)
            else:
                if set(payload) - {"tradeId", "patch", "reason"} or not isinstance(
                    payload.get("patch"), dict
                ):
                    raise WorkspaceError("journal.invalid_action")
                patch = payload["patch"]
                if set(patch) & {
                    "id",
                    "portfolioId",
                    "journalBookId",
                    "origin",
                    "accountId",
                    "sessionId",
                    "positionKey",
                    "sourceEventKeys",
                    "realizations",
                    "remainingQuantity",
                    "factRevision",
                    "reviewRevision",
                }:
                    raise WorkspaceError("journal.identity_is_immutable")
                if action == "close-trade" and trade.get("result") != "Open":
                    raise WorkspaceError("journal.position_already_closed", 409)
                updated = self._manual(state, patch, trade)
                if action == "close-trade":
                    if updated.get("result") == "Open":
                        raise WorkspaceError("journal.close_requires_closed_state")
                    existing = trade.get("realizations", [])
                    if existing and (
                        any(
                            updated.get(key) != trade.get(key)
                            for key in ("pair", "direction", "currency", "quantityUnit")
                        )
                        or updated["openDate"] != instant(trade["openDate"])
                        or any(
                            updated["amounts"].get(key) != trade.get("amounts", {}).get(key)
                            for key in ("quantity", "entryPrice")
                        )
                    ):
                        raise WorkspaceError("journal.realized_entry_facts_locked", 409)
                    self._rewrite_final_exit(trade, updated, append=True)
                elif trade.get("realizations"):
                    financial_change = any(
                        before.get(key) != updated.get(key)
                        for key in set(before) | set(updated)
                        if key
                        not in REVIEW_FIELDS | {"factRevision", "reviewRevision", "reviewedAt"}
                    )
                    if financial_change and not safe_text(payload.get("reason", ""), 2000).strip():
                        raise WorkspaceError("journal.correction_reason_required")
                    if updated["result"] == "Open":
                        for key in ("netPnl", "grossPnl", "commission", "swap", "fees"):
                            if updated["amounts"].get(key) != trade["amounts"].get(key):
                                raise WorkspaceError(
                                    "journal.realized_amount_requires_exit_correction", 409
                                )
                        self._recalculate_realizations(updated)
                        if updated["result"] != "Open":
                            raise WorkspaceError(
                                "journal.choose_closed_state_for_fully_exited_position", 409
                            )
                    else:
                        self._rewrite_final_exit(trade, updated, append=False)
                    _projection(updated)
                changed_facts = any(
                    before.get(key) != updated.get(key)
                    for key in set(before) | set(updated)
                    if key not in REVIEW_FIELDS | {"factRevision", "reviewRevision", "reviewedAt"}
                )
                updated["factRevision"] = before.get("factRevision", 0) + int(changed_facts)
                if changed_facts and before.get("reviewStatus") == "reviewed":
                    updated["reviewStatus"] = "unreviewed"
                changed_review = any(before.get(key) != updated.get(key) for key in REVIEW_FIELDS)
                if changed_review:
                    updated["reviewRevision"] = before.get("reviewRevision", 0) + 1
                    review_record = {
                        "id": "review:" + str(trade["id"]),
                        "tradeId": trade["id"],
                        "bookId": self._trade_book(state, trade),
                        "revision": updated["reviewRevision"],
                        "reviewedFactRevision": updated["factRevision"],
                        "updatedAt": now(),
                        "fields": {key: updated[key] for key in REVIEW_FIELDS if key in updated},
                    }
                    prior = next(
                        (row for row in ledger["reviews"] if row["id"] == review_record["id"]), None
                    )
                    if prior:
                        prior.update(review_record)
                    else:
                        ledger["reviews"].append(review_record)
                trade.clear()
                trade.update(updated)
        self._history(state, trade, before, action, payload.get("reason", ""))
        return {"tradeId": trade["id"]}

    def _rewrite_final_exit(self, previous, updated, append):
        quantity = updated["amounts"].get("quantity")
        existing = deepcopy(previous.get("realizations", []))
        if quantity is None:
            if existing:
                raise WorkspaceError("journal.known_quantity_required")
            return
        prefix = existing if append else existing[:-1]
        with localcontext() as context:
            context.prec = 100
            last_quantity = Decimal(quantity) - sum(
                (Decimal(row["quantity"]) for row in prefix), Decimal(0)
            )
            if last_quantity <= 0:
                raise WorkspaceError("journal.exit_exceeds_position")
            if any(instant(row["closedAt"]) > updated["closeDate"] for row in prefix):
                raise WorkspaceError("journal.close_before_earlier_exit")
            final_net = decimal_text(
                format(
                    Decimal(updated["amounts"]["netPnl"])
                    - sum((Decimal(row["netPnl"]) for row in prefix), Decimal(0)),
                    "f",
                )
            )
            residuals = {}
            for key in ("grossPnl", "commission", "swap", "fees"):
                values = [row.get(key) for row in prefix]
                total = updated["amounts"].get(key)
                residuals[key] = (
                    decimal_text(
                        format(
                            Decimal(total) - sum((Decimal(value) for value in values), Decimal(0)),
                            "f",
                        )
                    )
                    if total is not None and all(value is not None for value in values)
                    else None
                )
        updated["realizations"] = [
            *prefix,
            {
                "id": "exit_" + uuid4().hex if append or not existing else existing[-1]["id"],
                "kind": "exit",
                "closedAt": updated["closeDate"],
                "quantity": decimal_text(format(last_quantity, "f")),
                "netPnl": final_net,
                **residuals,
                "exitPrice": updated["amounts"].get("exitPrice"),
            },
        ]
        updated["remainingQuantity"] = "0"

    def _recalculate_realizations(self, trade):
        if trade["amounts"].get("quantity") is None:
            raise WorkspaceError("journal.known_quantity_required")
        exits = sorted(
            trade["realizations"], key=lambda item: (instant(item["closedAt"]), item["id"])
        )
        with localcontext() as context:
            context.prec = 100
            remaining = Decimal(trade["amounts"]["quantity"]) - sum(
                (Decimal(row["quantity"]) for row in exits), Decimal(0)
            )
        if remaining < 0:
            raise WorkspaceError("journal.exit_exceeds_position")
        if any(instant(row["closedAt"]) < instant(trade["openDate"]) for row in exits):
            raise WorkspaceError("journal.close_before_open")
        trade["realizations"] = exits
        for key in ("netPnl", "grossPnl", "commission", "swap", "fees"):
            values = [row.get(key) for row in exits]
            trade["amounts"][key] = (
                exact_sum(values) if all(value is not None for value in values) else None
            )
        trade["remainingQuantity"] = decimal_text(format(remaining, "f"))
        trade["result"] = "Open" if remaining > 0 else "Break Even"
        trade["closeDate"] = "" if remaining > 0 else instant(exits[-1]["closedAt"])
        _projection(trade)

    def _correct_realization(self, trade, payload):
        if (
            set(payload) - {"tradeId", "realizationId", "patch", "reason", "confirmStatusChange"}
            or not isinstance(payload.get("patch"), dict)
            or type(payload.get("confirmStatusChange", False)) is not bool
        ):
            raise WorkspaceError("journal.invalid_action")
        if not safe_text(payload.get("reason", ""), 2000).strip():
            raise WorkspaceError("journal.correction_reason_required")
        allowed = {
            "quantity",
            "closedAt",
            "netPnl",
            "grossPnl",
            "commission",
            "swap",
            "fees",
            "exitPrice",
        }
        if set(payload["patch"]) - allowed:
            raise WorkspaceError("journal.invalid_realization_patch")
        exit = next(
            (
                row
                for row in trade.get("realizations", [])
                if row["id"] == payload.get("realizationId")
            ),
            None,
        )
        if exit is None:
            raise WorkspaceError("journal.realization_not_found", 404)
        was_open = trade.get("result") == "Open"
        for key, value in payload["patch"].items():
            exit[key] = (
                instant(value)
                if key == "closedAt"
                else decimal_text(
                    value, optional=key not in ("quantity", "netPnl"), positive=key == "quantity"
                )
            )
        validate_money_identity(exit)
        self._recalculate_realizations(trade)
        if was_open != (trade["result"] == "Open") and not payload.get("confirmStatusChange"):
            raise WorkspaceError("journal.correction_changes_position_state", 409)
        trade["factRevision"] = trade.get("factRevision", 0) + 1
        if trade.get("reviewStatus") == "reviewed":
            trade["reviewStatus"] = "unreviewed"

    def _partial_close(self, trade, payload):
        if set(payload) - {
            "tradeId",
            "quantity",
            "closedAt",
            "netPnl",
            "grossPnl",
            "commission",
            "swap",
            "fees",
            "exitPrice",
            "reason",
        }:
            raise WorkspaceError("journal.invalid_action")
        if trade.get("result") != "Open":
            raise WorkspaceError("journal.position_already_closed", 409)
        amounts = _amounts(trade)
        remaining = trade.get("remainingQuantity") or amounts["quantity"]
        if remaining is None:
            raise WorkspaceError("journal.known_quantity_required")
        quantity = decimal_text(payload.get("quantity"), positive=True)
        closed_at = instant(payload.get("closedAt"))
        if closed_at < instant(trade["openDate"]) or any(
            closed_at < instant(row["closedAt"]) for row in trade.get("realizations", [])
        ):
            raise WorkspaceError("journal.close_before_open")
        with localcontext() as context:
            context.prec = 100
            left = Decimal(remaining) - Decimal(quantity)
        if left < 0:
            raise WorkspaceError("journal.exit_exceeds_position")
        realization = {
            "id": "exit_" + uuid4().hex,
            "kind": "exit",
            "closedAt": closed_at,
            "quantity": quantity,
            "netPnl": decimal_text(payload.get("netPnl")),
            **{
                key: decimal_text(payload.get(key), optional=True)
                for key in ("grossPnl", "commission", "swap", "fees", "exitPrice")
            },
        }
        validate_money_identity(realization)
        trade.setdefault("realizations", []).append(realization)
        trade["amounts"] = amounts
        for field in ("netPnl", "grossPnl", "commission", "swap", "fees"):
            values = [row.get(field) for row in trade["realizations"]]
            amounts[field] = (
                exact_sum(values) if all(value is not None for value in values) else None
            )
        trade["remainingQuantity"] = decimal_text(format(left, "f"))
        trade["factRevision"] = trade.get("factRevision", 0) + 1
        trade["closeDate"] = closed_at if left == 0 else ""
        trade["result"] = "Open" if left > 0 else "Break Even"
        if trade.get("reviewStatus") == "reviewed":
            trade["reviewStatus"] = "unreviewed"
        _projection(trade)

    def _period_review(self, state, payload):
        allowed = {
            "portfolioId",
            "bookId",
            "period",
            "startDate",
            "timezone",
            "notes",
            "goals",
            "includedTradeIds",
            "currency",
            "strategy",
            "filters",
        }
        if set(payload) - allowed or payload.get("period") not in ("day", "week"):
            raise WorkspaceError("journal.invalid_period_review")
        self._book(state, payload.get("bookId"), payload.get("portfolioId"))
        try:
            start = datetime.strptime(payload["startDate"], "%Y-%m-%d").date()
            timezone = ZoneInfo(payload["timezone"])
        except (ValueError, KeyError, TypeError, ZoneInfoNotFoundError) as error:
            raise WorkspaceError("journal.invalid_period_review") from error
        if (
            payload["startDate"] != start.isoformat()
            or payload["period"] == "week"
            and start.weekday() != 0
        ):
            raise WorkspaceError("journal.invalid_period_review")
        end = start + timedelta(days=7 if payload["period"] == "week" else 1)
        currency = _currency(
            payload.get("currency")
            or next(
                row["currency"]
                for row in state["snapshot"]["tables"]["portfolios"]
                if row["id"] == payload["portfolioId"]
            )
        )
        strategy = safe_text(payload.get("strategy", "All"), 500)
        if "filters" in payload and (
            not isinstance(payload["filters"], dict)
            or set(payload["filters"]) - {"q", "result", "direction", "period", "review"}
            or any(
                not isinstance(value, str) or len(value) > 500
                for value in payload["filters"].values()
            )
        ):
            raise WorkspaceError("journal.invalid_period_review")
        ids = payload.get("includedTradeIds")
        if (
            not isinstance(ids, list)
            or len(ids) > 10000
            or any(not valid_id(id) for id in ids)
            or len(set(ids)) != len(ids)
        ):
            raise WorkspaceError("journal.invalid_period_review")
        facts = []
        for id in ids:
            trade = self._trade(state, id)
            if (
                trade["portfolioId"] != payload["portfolioId"]
                or self._trade_book(state, trade) != payload["bookId"]
                or trade.get("archivedAt")
            ):
                raise WorkspaceError("journal.review_scope_mismatch")
            if (
                trade.get("currency", currency) != currency
                or strategy != "All"
                and trade.get("strategy") != strategy
            ):
                raise WorkspaceError("journal.review_scope_mismatch")
            times = [item["closedAt"] for item in trade.get("realizations", [])] or [
                trade.get("closeDate") or trade.get("openDate")
            ]
            try:
                dates = [
                    datetime.fromisoformat(instant(value).replace("Z", "+00:00"))
                    .astimezone(timezone)
                    .date()
                    for value in times
                ]
            except WorkspaceError as error:
                raise WorkspaceError("journal.review_time_unknown") from error
            if not any(start <= date < end for date in dates):
                raise WorkspaceError("journal.review_scope_mismatch")
            facts.append(
                {
                    "tradeId": id,
                    "factRevision": trade.get("factRevision", 0),
                    "snapshotHash": digest(trade),
                }
            )
        record = {
            **payload,
            "currency": currency,
            "strategy": strategy,
            "notes": safe_text(payload.get("notes", "")),
            "goals": safe_text(payload.get("goals", ""), 4000),
            "id": opaque(
                "period",
                f"{payload['bookId']}|{payload['period']}|{start}|{payload['timezone']}|{currency}|{strategy}",
            ),
            "updatedAt": now(),
            "facts": facts,
        }
        previous = next(
            (
                row
                for row in state["journalLedger"]["periodReviews"]
                if row.get("bookId") == payload["bookId"]
                and row.get("period") == payload["period"]
                and row.get("startDate") == payload["startDate"]
                and row.get("timezone") == payload["timezone"]
                and row.get("currency", currency) == currency
                and row.get("strategy", "All") == strategy
            ),
            None,
        )
        if previous:
            record["id"] = previous["id"]
        record["revision"] = (previous or {}).get("revision", 0) + 1
        self._append_history(
            state,
            {
                "id": "history_" + uuid4().hex,
                "periodReviewId": record["id"],
                "bookId": payload["bookId"],
                "at": now(),
                "action": "review-period",
                "before": deepcopy(previous),
                "after": deepcopy(record),
            },
        )
        if previous:
            previous.update(record)
        else:
            state["journalLedger"]["periodReviews"].append(record)
        return {"periodReview": record}

    def attachment(
        self, origin, expected_revision, request_id, trade_id, mime_type, content_base64
    ):
        if (
            mime_type
            not in ("image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf")
            or not isinstance(content_base64, str)
            or len(content_base64) > ((MAX_IMAGE_BYTES + 2) // 3) * 4
        ):
            raise WorkspaceError("journal.invalid_attachment")
        try:
            content = base64.b64decode(content_base64, validate=True)
        except ValueError as error:
            raise WorkspaceError("journal.invalid_attachment") from error
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise WorkspaceError("journal.attachment_too_large", 413)
        # Reject MIME spoofing before serving anything inline.
        signatures = {
            "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
            "image/jpeg": content.startswith(b"\xff\xd8\xff"),
            "image/gif": content.startswith((b"GIF87a", b"GIF89a")),
            "image/webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP",
            "application/pdf": content.startswith(b"%PDF-"),
        }
        if not signatures[mime_type]:
            raise WorkspaceError("journal.attachment_type_mismatch")
        body = {
            "origin": origin,
            "expectedRevision": expected_revision,
            "tradeId": trade_id,
            "mimeType": mime_type,
            "sha256": hashlib.sha256(content).hexdigest(),
        }
        with self.storage.transaction() as connection:
            replay = self.storage._receipt(connection, request_id, "journal-attachment", body)
            if replay is not None:
                receipt = replay
            else:
                state = self.storage._read(connection, origin, full_modules=False)
                if state["revision"] != expected_revision or type(expected_revision) is not int:
                    raise WorkspaceError("storage.revision_conflict", 409)
                trade = self._trade(state, trade_id)
                if trade.get("archivedAt"):
                    raise WorkspaceError("journal.trade_archived", 409)
                before = deepcopy(trade)
                id = "attachment_" + uuid4().hex
                url = f"/api/local/v1/attachments/{id}?originId={origin}"
                trade["screenshotUrl"] = url
                trade["reviewRevision"] = trade.get("reviewRevision", 0) + 1
                review_record = next(
                    (
                        row
                        for row in state["journalLedger"]["reviews"]
                        if row.get("tradeId") == trade_id
                    ),
                    None,
                )
                if review_record is None:
                    review_record = {
                        "id": "review:" + str(trade_id),
                        "tradeId": trade_id,
                        "bookId": self._trade_book(state, trade),
                        "reviewedFactRevision": trade.get("factRevision", 0),
                    }
                    state["journalLedger"]["reviews"].append(review_record)
                review_record.update(
                    revision=trade["reviewRevision"],
                    updatedAt=now(),
                    fields={key: trade[key] for key in REVIEW_FIELDS if key in trade},
                )
                self._history(state, trade, before, "attach-evidence")
                self._save(connection, state, origin)
                connection.execute(
                    insert(assets).values(
                        uid=self.storage.uid,
                        origin=origin,
                        id=id,
                        mime_type=mime_type,
                        content=content,
                        source=url,
                        sha256=body["sha256"],
                    )
                )
                receipt = {
                    "result": {"attachmentId": id, "url": url},
                    "detail": self._detail(state, trade_id),
                }
                self.storage._save_receipt(
                    connection, request_id, "journal-attachment", body, receipt
                )
        return {**receipt, "workspace": self.storage.workspace(origin)}

    def _import_context(self, state, portfolio_id, book_id, account_id, provider):
        if not isinstance(provider, str) or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}", provider
        ):
            raise WorkspaceError("journal.invalid_provider")
        provider = provider.lower()
        book = self._book(state, book_id, portfolio_id)
        profile = next(
            (
                row
                for row in state["snapshot"]["tables"]["portfolios"]
                if row["id"] == portfolio_id and not row.get("archivedAt")
            ),
            None,
        )
        if profile is None:
            raise WorkspaceError("journal.profile_not_found", 404)
        if book["kind"] == "paper":
            raise WorkspaceError("journal.statement_requires_manual_or_account_book")
        account = next(
            (
                row
                for row in state["snapshot"]["tables"]["brokerAccounts"]
                if row["id"] == book.get("accountId") and not row.get("archivedAt")
            ),
            None,
        )
        if book["kind"] == "connected" and (
            account is None or account_id not in (None, account["id"])
        ):
            raise WorkspaceError("journal.destination_mismatch")
        if book["kind"] == "manual" and account_id is not None:
            raise WorkspaceError("journal.destination_mismatch")
        account_key = book.get("accountKey")
        if not account_key:
            preserved = {
                event["accountKey"]
                for event in state["journalLedger"]["events"]
                if event.get("bookId") == book_id and event.get("accountKey")
            }
            if len(preserved) > 1:
                raise WorkspaceError("journal.ambiguous_restored_source_namespace", 409)
            account_key = (
                next(iter(preserved))
                if preserved
                else "manual:" + digest([state["snapshot"]["originId"], portfolio_id])
            )
        return {
            "provider": provider,
            "accountKey": account_key,
            "bookId": book_id,
            "portfolioId": portfolio_id,
            **({"accountId": account["id"]} if account else {}),
            "currency": _currency(account.get("currency") if account else profile.get("currency")),
        }

    def preview_import(
        self,
        origin,
        portfolio_id,
        book_id,
        provider,
        csv_text,
        mapping,
        expected_revision,
        account_id=None,
    ):
        from services.journal_import import JournalImportError, normalize_statement

        if not isinstance(csv_text, str):
            raise WorkspaceError("journal.invalid_text")
        try:
            source_bytes = csv_text.encode("utf-8")
        except UnicodeError as error:
            raise WorkspaceError("journal.invalid_text") from error
        if len(source_bytes) > 4 * 1024 * 1024:
            raise WorkspaceError("journal.csv_too_large", 413)
        if not isinstance(mapping, dict):
            raise WorkspaceError("journal.invalid_mapping")
        config = {
            key: value
            for key, value in mapping.items()
            if key not in ("id", "updatedAt", "createdAt", "provider")
        }
        with self.storage.transaction() as connection:
            state = self.storage._read(connection, origin, full_modules=False)
            if type(expected_revision) is not int or state["revision"] != expected_revision:
                raise WorkspaceError("storage.revision_conflict", 409)
            context = self._import_context(state, portfolio_id, book_id, account_id, provider)
            provider = context["provider"]
            previous = [
                row
                for row in state["journalLedger"]["events"]
                if row.get("provider") == provider
                and row.get("accountKey") == context["accountKey"]
            ]
            try:
                preview = normalize_statement(csv_text, config, context, previous)
            except JournalImportError as error:
                raise WorkspaceError(
                    "journal.invalid_statement",
                    error.status,
                    [{"code": error.code, "message": str(error)}],
                ) from error
            others = [
                row
                for row in state["journalLedger"]["events"]
                if row.get("provider") != provider
                and row.get("accountKey") == context["accountKey"]
            ]
            for row in preview["rows"]:
                event = row.get("event")
                if event and any(old.get("eventId") == event["eventId"] for old in others):
                    row["action"] = "conflict"
                    row.setdefault("errors", []).append(
                        {
                            "code": "source.cross_source_identity",
                            "message": "This account already has that external ID under another source. Reuse its source mapping or explicitly reconcile the source identity before counting it again.",
                        }
                    )
                    preview["canCommit"] = False
            id = "journal_import_" + uuid4().hex
            job = {
                "id": id,
                "kind": "journal-import",
                "originId": origin,
                "expectedRevision": expected_revision,
                "context": context,
                "createdAt": now(),
                "status": "preview",
                "preview": preview,
                "csvText": csv_text,
                "mapping": config,
            }
            self.storage._principal(connection, True)
            connection.execute(
                insert(jobs).values(
                    uid=self.storage.uid, id=id, kind="journal-import", payload=dumps(job)
                )
            )
        return {"id": id, "expectedRevision": expected_revision, "preview": preview}

    def _import_projection(self, state, projection, context):
        tables = state["snapshot"]["tables"]
        key = projection["positionKey"]
        old = next(
            (
                row
                for row in tables["journalTrades"]
                if row.get("positionKey") == key
                and self._trade_book(state, row) == context["bookId"]
            ),
            None,
        )
        id = old["id"] if old else max([row["id"] for row in tables["journalTrades"]] + [0]) + 1
        if not valid_id(id):
            raise WorkspaceError("journal.identity_exhausted")
        row = {
            **{field: old[field] for field in REVIEW_FIELDS if old and field in old},
            "id": id,
            "portfolioId": projection.get("portfolioId", context["portfolioId"]),
            "origin": "imported",
            "journalBookId": context["bookId"],
            "positionKey": key,
            "externalId": projection.get("positionId", key),
            "pair": projection.get("symbol", ""),
            "direction": projection.get("direction", "Buy"),
            "openDate": projection.get("openedAt") or projection.get("occurredAt"),
            "closeDate": projection.get("closedAt") or "",
            "result": projection.get("result", "Open"),
            "currency": projection["currency"],
            "quantityUnit": projection.get("quantityUnit", "units"),
            "amounts": deepcopy(projection["amounts"]),
            "realizations": deepcopy(projection.get("realizations", [])),
            "remainingQuantity": projection.get("remainingQuantity", "0"),
            "sourceEventKeys": projection.get("sourceEventKeys", []),
            "eventType": projection.get("eventType", "trade"),
            "timeframe": old.get("timeframe", "") if old else "",
            "strategy": old.get("strategy", "Imported") if old else "Imported",
            "rr": old.get("rr", 0) if old else 0,
            "sl": old.get("sl", 0) if old else 0,
            "tp": old.get("tp", 0) if old else 0,
            "emotionalNotes": old.get("emotionalNotes", "") if old else "",
            "technicalNotes": old.get("technicalNotes", "") if old else "",
            "otherNotes": old.get("otherNotes", "") if old else "",
            "factRevision": old.get("factRevision", 0) if old else 0,
            "reviewRevision": old.get("reviewRevision", 0) if old else 0,
            "reviewStatus": old.get("reviewStatus", "unreviewed") if old else "unreviewed",
        }
        if context.get("accountId"):
            row["accountId"] = context["accountId"]
        source_strategy = projection.get("strategy") or "Imported"
        row["sourceStrategy"] = source_strategy
        if (
            not old
            or not old.get("strategy")
            or old.get("strategy") == old.get("sourceStrategy", "Imported")
        ):
            row["strategy"] = source_strategy
        if projection.get("decisionId"):
            row["sourceDecisionId"] = opaque(
                "csv-decision", context["provider"] + "|" + projection["decisionId"]
            )
            if (
                not old
                or not old.get("decisionId")
                or old.get("decisionId") == old.get("sourceDecisionId")
            ):
                row["decisionId"] = row["sourceDecisionId"]
        elif (
            old
            and old.get("sourceDecisionId")
            and old.get("decisionId") == old.get("sourceDecisionId")
        ):
            row.pop("decisionId", None)
        if projection.get("copyGroupId"):
            row["sourceCopyGroupId"] = projection["copyGroupId"]
            if (
                not old
                or not old.get("copyGroupId")
                or old.get("copyGroupId") == old.get("sourceCopyGroupId")
            ):
                row["copyGroupId"] = row["sourceCopyGroupId"]
        elif (
            old
            and old.get("sourceCopyGroupId")
            and old.get("copyGroupId") == old.get("sourceCopyGroupId")
        ):
            row.pop("copyGroupId", None)
        if projection.get("cashflowAmount") is not None:
            row["cashflowAmount"] = projection["cashflowAmount"]
        if old and old.get("archivedAt"):
            row["archivedAt"] = old["archivedAt"]
        if old and old.get("reviewedAt"):
            row["reviewedAt"] = old["reviewedAt"]
        row["openDate"] = instant(row["openDate"])
        if row["closeDate"]:
            row["closeDate"] = instant(row["closeDate"])
        row["amounts"] = {
            field: decimal_text(value, optional=True) for field, value in row["amounts"].items()
        }
        _projection(row)
        old_facts = {
            field: value
            for field, value in (old or {}).items()
            if field
            not in REVIEW_FIELDS | {"reviewedAt", "reviewRevision", "factRevision", "journalBookId"}
        }
        new_facts = {
            field: value
            for field, value in row.items()
            if field
            not in REVIEW_FIELDS | {"reviewedAt", "reviewRevision", "factRevision", "journalBookId"}
        }
        changed = old is None or digest(old_facts) != digest(new_facts)
        if changed:
            row["factRevision"] += 1
            if old:
                row["reviewStatus"] = "unreviewed"
            if old:
                old.clear()
                old.update(row)
            else:
                tables["journalTrades"].append(row)
            state["bindings"].setdefault("resolutions", {})["trade:" + str(id)] = (
                "account:" + str(context["accountId"]) if context.get("accountId") else "manual"
            )
            state["bindings"] = self.storage._bindings(
                state["snapshot"], state["bindings"]["resolutions"], ledger=state["journalLedger"]
            )
            self._history(
                state,
                row,
                deepcopy(old_facts) if old_facts else None,
                "source-correction" if old_facts else "source-import",
            )
        return id, changed

    def commit_import(self, id, expected_revision, request_id, accept_corrections=False):
        if type(accept_corrections) is not bool:
            raise WorkspaceError("journal.invalid_confirmation")
        body = {
            "id": id,
            "expectedRevision": expected_revision,
            "acceptCorrections": accept_corrections,
        }
        with self.storage.transaction() as connection:
            replay = self.storage._receipt(connection, request_id, "journal-import", body)
            if replay is not None:
                receipt = replay
            else:
                record = connection.execute(
                    select(jobs.c.payload).where(
                        jobs.c.uid == self.storage.uid,
                        jobs.c.id == id,
                        jobs.c.kind == "journal-import",
                    )
                ).first()
                if record is None:
                    raise WorkspaceError("journal.import_not_found", 404)
                job = json.loads(record[0])
                origin = job["originId"]
                if job["status"] == "completed":
                    receipt = job["receipt"]
                else:
                    state = self.storage._read(connection, origin, full_modules=False)
                    if (
                        type(expected_revision) is not int
                        or state["revision"] != expected_revision
                        or job["expectedRevision"] != expected_revision
                    ):
                        raise WorkspaceError("storage.revision_conflict", 409)
                    preview = job["preview"]
                    if not preview["canCommit"]:
                        raise WorkspaceError("journal.import_has_errors", 409)
                    corrections = sum(row["action"] == "correction" for row in preview["rows"])
                    if corrections and not accept_corrections:
                        raise WorkspaceError("journal.corrections_require_confirmation", 409)
                    context = job["context"]
                    self._import_context(
                        state,
                        context["portfolioId"],
                        context["bookId"],
                        context.get("accountId"),
                        context["provider"],
                    )
                    event_map = {
                        row.get("eventKey"): row for row in state["journalLedger"]["events"]
                    }
                    changed_events = []
                    for row in preview["rows"]:
                        event = row.get("event")
                        if event is None or row["action"] == "unchanged":
                            continue
                        event = {**deepcopy(event), "id": event["eventKey"]}
                        previous = event_map.get(event["eventKey"])
                        if previous:
                            previous.clear()
                            previous.update(event)
                        else:
                            state["journalLedger"]["events"].append(event)
                            event_map[event["eventKey"]] = event
                        changed_events.append(event["eventKey"])
                        state["journalLedger"]["observations"].append(
                            {
                                "id": "observation_" + uuid4().hex,
                                "bookId": context["bookId"],
                                "at": now(),
                                "batchId": id,
                                "sourceHash": preview["sourceHash"],
                                "action": row["action"],
                                "sourceEvent": deepcopy(event),
                            }
                        )
                    projection_changes = 0
                    for projection in preview["tradeProjections"]:
                        trade_id, changed = self._import_projection(state, projection, context)
                        projection_changes += int(changed)
                        for key in projection["sourceEventKeys"]:
                            if key in event_map:
                                event_map[key]["tradeId"] = trade_id
                    for cashflow in preview.get("cashflows", []):
                        amount = cashflow["amount"]
                        kind = cashflow["eventType"]
                        projection = {
                            **cashflow,
                            "positionKey": cashflow["id"],
                            "openedAt": cashflow["occurredAt"],
                            "closedAt": cashflow["occurredAt"],
                            "symbol": kind.upper(),
                            "direction": "Buy",
                            "result": "Break Even",
                            "remainingQuantity": "0",
                            "cashflowAmount": amount,
                            "amounts": cashflow.get("amounts")
                            or {
                                "netPnl": amount,
                                "grossPnl": None,
                                "commission": None,
                                "swap": None,
                                "fees": None,
                                "riskAmount": None,
                                "quantity": None,
                                "entryPrice": None,
                                "exitPrice": None,
                            },
                        }
                        trade_id, changed = self._import_projection(state, projection, context)
                        projection_changes += int(changed)
                        for key in cashflow["sourceEventKeys"]:
                            if key in event_map:
                                event_map[key]["tradeId"] = trade_id
                    batch = {
                        "id": id,
                        "bookId": context["bookId"],
                        "createdAt": now(),
                        "sourceHash": preview["sourceHash"],
                        "provider": context["provider"],
                        "mapping": job["mapping"],
                        "counts": preview["counts"],
                        "totals": preview["totals"],
                        "correctionsAccepted": accept_corrections,
                        "changedEventKeys": changed_events,
                    }
                    if not any(
                        item.get("sourceHash") == preview["sourceHash"] and "csvText" in item
                        for item in state["journalLedger"]["batches"]
                    ):
                        batch["csvText"] = job["csvText"]
                    state["journalLedger"]["batches"].append(batch)
                    self._save(connection, state, origin)
                    receipt = {
                        "originId": origin,
                        "result": {
                            "counts": preview["counts"],
                            "totals": preview["totals"],
                            "changedEvents": len(changed_events),
                            "changedPositions": projection_changes,
                            "batchId": id,
                        },
                    }
                    job["status"] = "completed"
                    job["receipt"] = receipt
                    connection.execute(
                        update(jobs)
                        .where(jobs.c.uid == self.storage.uid, jobs.c.id == id)
                        .values(payload=dumps(job))
                    )
                self.storage._save_receipt(connection, request_id, "journal-import", body, receipt)
        return {**receipt, "workspace": self.storage.workspace(receipt["originId"])}

    def export(self, origin, portfolio_id, book_id, format="json"):
        if format not in ("json", "csv"):
            raise WorkspaceError("journal.invalid_export_format")
        with self.storage.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            state = self.storage._read(connection, origin)
            book = self._book(state, book_id, portfolio_id)
            rows = [
                deepcopy(row)
                for row in state["snapshot"]["tables"]["journalTrades"]
                if self._trade_book(state, row) == book_id
            ]
            ids = {row["id"] for row in rows}
            runs = [
                deepcopy(row)
                for row in state["snapshot"]["tables"]["practiceSessions"]
                if row.get("portfolioId") == portfolio_id and book.get("sessionId") == row["id"]
            ]
            run_ids = {row["id"] for row in runs}
            ledger = empty_ledger()
            for field, values in state["journalLedger"].items():
                if field == "version":
                    continue
                ledger[field] = [
                    row
                    for row in values
                    if row.get("bookId") == book_id
                    or row.get("tradeId") in ids
                    or row.get("runId") in run_ids
                    or field == "mappings"
                ]
            exported = {
                "format": "chartly-journal-export",
                "version": 1,
                "originId": origin,
                "portfolioId": portfolio_id,
                "bookId": book_id,
                "createdAt": now(),
                "revision": state["revision"],
                "trades": rows,
                "runs": runs,
                "ledger": ledger,
                "attachments": state["snapshot"]["attachments"],
            }
            if book["kind"] == "paper":
                exported["paperSessions"] = [
                    deepcopy(record)
                    for record in state.get("paperSessions", [])
                    if record["runId"] in run_ids
                ]
            # Keep assets from other books out of a scoped export.
            sources = {row.get(key) for row in rows for key in ("screenshotUrl", "chartUrl")}
            evidence_ids = {
                item["attachmentId"]
                for row in [*rows, *runs]
                for item in row.get("chartEvidence", [])
            }
            exported["attachments"] = {
                id: item
                for id, item in exported["attachments"].items()
                if id in evidence_ids
                or item.get("originalSource") in sources
                or any(f"/attachments/{id}?" in (source or "") for source in sources)
            }
        if format == "json":
            return {
                "mimeType": "application/json",
                "filename": "chartly-journal.json",
                "base64": base64.b64encode((dumps(exported) + "\n").encode()).decode(),
            }
        stream = StringIO(newline="")
        writer = csv.writer(stream)
        headers = [
            "id",
            "eventType",
            "positionKey",
            "openDate",
            "closeDate",
            "pair",
            "direction",
            "currency",
            "quantityUnit",
            *MONEY_FIELDS,
            "remainingQuantity",
            "reviewStatus",
            "strategy",
            "setup",
            "tags",
            "technicalNotes",
            "emotionalNotes",
            "otherNotes",
            "decisionId",
            "copyGroupId",
            "chartUrl",
            "screenshotUrl",
            "archivedAt",
            "realizationsJson",
            "historyJson",
            "sourceEventKeysJson",
        ]
        writer.writerow(headers)

        def safe_cell(value, numeric=False):
            text = "" if value is None else str(value)
            if numeric and re.fullmatch(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?", text):
                return text
            return (
                "'" + text if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else text
            )

        for row in rows:
            values = {
                **row,
                **row.get("amounts", {}),
                "tags": dumps(row.get("tags", [])),
                "realizationsJson": dumps(row.get("realizations", [])),
                "historyJson": dumps(
                    [item for item in ledger["history"] if item.get("tradeId") == row["id"]]
                ),
                "sourceEventKeysJson": dumps(row.get("sourceEventKeys", [])),
            }
            writer.writerow(
                [
                    safe_cell(
                        values.get(header), header in {*MONEY_FIELDS, "remainingQuantity", "id"}
                    )
                    for header in headers
                ]
            )
        return {
            "mimeType": "text/csv",
            "filename": "chartly-journal.csv",
            "base64": base64.b64encode(stream.getvalue().encode("utf-8-sig")).decode(),
        }
