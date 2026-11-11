"""Owned, transactional historical paper sessions. This service has no broker path."""

from copy import deepcopy
from decimal import Decimal

from services.chart_context import run_window
from services.data_library import DataLibrary
from services.journal_service import JournalService
from services.paper_market import market_window
from services.workspace_storage import (
    WorkspaceError,
    digest,
    dumps,
    now,
    opaque,
    valid_id,
    valid_origin,
)

MAX_RECEIPTS = 5000


def keys(value, required=(), optional=()):
    if (
        not isinstance(value, dict)
        or set(required) - set(value)
        or set(value) - set(required) - set(optional)
    ):
        raise WorkspaceError("paper.invalid_command")


class PaperSessions:
    def __init__(self, storage):
        from services.paper_records import PaperRecords

        self.storage = storage
        self.library = DataLibrary(storage)  # initialize installed tables before the transaction
        self.records = PaperRecords(storage)
        self.journal = JournalService(storage)

    def _target(self, state, run_id, *, archived=False):
        if not valid_id(run_id):
            raise WorkspaceError("paper.invalid_run")
        runs = state["snapshot"]["tables"]["practiceSessions"]
        run = next((row for row in runs if row["id"] == run_id), None)
        profile = next(
            (
                row
                for row in state["snapshot"]["tables"]["portfolios"]
                if run and row["id"] == run["portfolioId"]
            ),
            None,
        )
        if not run or not profile:
            raise WorkspaceError("paper.run_not_found", 404)
        if not archived and (run.get("archivedAt") or profile.get("archivedAt")):
            raise WorkspaceError("paper.archived_run", 409)
        return run

    def _book(self, state, run_id):
        book = next(
            (
                row
                for row in state["bindings"]["books"]
                if row.get("kind") == "paper" and row.get("sessionId") == run_id
            ),
            None,
        )
        if book is None:
            raise WorkspaceError("paper.book_unavailable", 409)
        return book["id"]

    def _bars(self, connection, run, record=None, branch_from=None):
        if not run.get("datasetVersionId") or not run.get("datasetChecksum"):
            raise WorkspaceError("paper.saved_history_required", 409)
        version = self.library._version(connection, run["datasetVersionId"])
        if version["checksum"] != run["datasetChecksum"]:
            raise WorkspaceError("paper.source_mismatch", 409)
        metadata = version["metadata"]
        if metadata["symbol"] != run["symbol"] or metadata["interval"] != run["timeframe"]:
            raise WorkspaceError("paper.source_mismatch", 409)
        if record is not None:
            original = self.library._version(connection, record["datasetVersionId"])
            if original["id"] != version["id"] or record["datasetChecksum"] != version["checksum"]:
                raise WorkspaceError("paper.source_mismatch", 409)
            branch_from = record["window"]["from"]
        raw = self.library._read_bars(version)
        bars, window = market_window(version, run, raw, branch_from=branch_from)
        if record is not None and record["window"] != window:
            raise WorkspaceError("paper.source_window_changed", 409)
        if record is not None:
            engine = record["state"]
            config = record["config"]
            identity = {
                "symbol": metadata["symbol"],
                "exchange": metadata["exchange"],
                "interval": metadata["interval"],
                "currency": metadata.get("currency"),
            }
            if (
                any(config["instrument"].get(key) != value for key, value in identity.items())
                or config["startTime"] != window["from"]
            ):
                raise WorkspaceError("paper.source_mismatch", 409)
            cursor = engine["cursor"]
            if type(cursor) is not int or not -1 <= cursor < len(bars):
                raise WorkspaceError("paper.checkpoint_source_mismatch", 409)
            expected_clock = bars[cursor]["availableAt"] if cursor >= 0 else window["from"]
            expected_bar = (
                {key: value for key, value in bars[cursor].items() if key != "gap"}
                if cursor >= 0
                else None
            )
            if engine["asOf"] != expected_clock or (
                cursor >= 0
                and {key: value for key, value in engine["lastBar"].items() if key != "gap"}
                != expected_bar
            ):
                raise WorkspaceError("paper.checkpoint_source_mismatch", 409)
            for fill in engine["fills"]:
                index = fill["barIndex"]
                if (
                    type(index) is not int
                    or not 0 <= index <= cursor
                    or fill["barTime"] != bars[index]["time"]
                    or fill["time"] != bars[index]["availableAt"]
                ):
                    raise WorkspaceError("paper.fill_source_mismatch", 409)
        return version, bars, window

    def _report(self, record, run, book_id, *, compact=False):
        from services.paper_reports import build_paper_report

        report = build_paper_report(record, run, book_id=book_id)
        return (
            {
                key: value
                for key, value in report.items()
                if key not in {"equityCurve", "orders", "positions", "fills", "ledger"}
            }
            if compact
            else report
        )

    def _public(self, record, run, state):
        if record is None:
            return None
        engine = record["state"]
        book_id = self._book(state, run["id"])
        fields = (
            "cash",
            "equity",
            "collateral",
            "available",
            "realizedGross",
            "fees",
            "unrealized",
            "markPrice",
        )
        return {
            **{
                name: record[name]
                for name in (
                    "version",
                    "originId",
                    "runId",
                    "profileId",
                    "revision",
                    "status",
                    "config",
                    "manifest",
                    "checkpoint",
                    "window",
                )
            },
            **{name: engine.get(name) for name in fields},
            "cursorIndex": engine["cursor"],
            "asOf": engine["asOf"],
            "totalBars": record["window"]["count"],
            "orders": engine["orders"],
            "positions": engine["positions"],
            "fills": engine["fills"][-100:],
            "ledger": engine["ledger"][-100:],
            "report": self._report(record, run, book_id, compact=True),
            "bookId": book_id,
            "journalTradeIds": [
                row["id"]
                for row in state["snapshot"]["tables"]["journalTrades"]
                if row.get("sessionId") == run["id"] and row.get("origin") == "simulator"
            ],
            **({"parent": record["parent"]} if record.get("parent") else {}),
        }

    def session(self, origin, run_id):
        with self.storage.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            state = self.storage._read(connection, origin, full_modules=False)
            run = self._target(state, run_id, archived=True)
            record = self.records.load(connection, origin, run_id)
            return {"session": self._public(record, run, state)}

    def report(self, origin, run_id):
        with self.storage.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            state = self.storage._read(connection, origin, full_modules=False)
            run = self._target(state, run_id, archived=True)
            record = self.records.load(connection, origin, run_id)
            if record is None:
                raise WorkspaceError("paper.not_prepared", 409)
            return {
                "report": self._report(record, run, self._book(state, run_id)),
                "sessionRecord": record,
            }

    def ledger(self, origin, run_id, offset=0, limit=100):
        if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 500:
            raise WorkspaceError("paper.invalid_page")
        with self.storage.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            state = self.storage._read(connection, origin, full_modules=False)
            self._target(state, run_id, archived=True)
            record = self.records.load(connection, origin, run_id)
            if record is None:
                raise WorkspaceError("paper.not_prepared", 409)
            entries = record["state"]["ledger"]
            return {
                "entries": entries[offset : offset + limit],
                "total": len(entries),
                "offset": offset,
                "revision": record["revision"],
            }

    def compare(self, origin, profile_id, run_ids):
        from services.paper_reports import compare_paper_reports

        if (
            not valid_id(profile_id)
            or not isinstance(run_ids, list)
            or not 1 <= len(run_ids) <= 20
            or len(set(run_ids)) != len(run_ids)
        ):
            raise WorkspaceError("paper.invalid_comparison")
        with self.storage.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            state = self.storage._read(connection, origin, full_modules=False)
            reports = []
            for run_id in run_ids:
                run = self._target(state, run_id, archived=True)
                if run["portfolioId"] != profile_id:
                    raise WorkspaceError("paper.comparison_scope", 403)
                record = self.records.load(connection, origin, run_id)
                if record is None:
                    raise WorkspaceError("paper.not_prepared", 409)
                reports.append(self._report(record, run, self._book(state, run_id), compact=True))
            return {"comparison": compare_paper_reports(reports)}

    def _prepare(self, connection, state, origin, run, payload, *, parent=None, first_index=None):
        from services.paper_engine import advance_bar, initial_state, normalize_config
        from services.paper_reports import canonical_manifest

        if run.get("status") != "Draft" or any(
            row.get("sessionId") == run["id"]
            for row in state["snapshot"]["tables"]["journalTrades"]
        ):
            raise WorkspaceError("paper.new_draft_required", 409)
        branch_from = first_index
        version, bars, window = self._bars(connection, run, branch_from=branch_from)
        metadata = version["metadata"]
        if any(
            not Decimal(bar[key]).is_finite()
            or not Decimal(0) < Decimal(bar[key]) <= Decimal("1e18")
            for bar in bars
            for key in ("open", "high", "low", "close")
        ):
            raise WorkspaceError("paper.nonpositive_history_unsupported", 409)
        keys(
            payload,
            ("version", "instrument", "startingCash", "moneyScale", "costs", "policy", "seed"),
            ("startTime",),
        )
        config = deepcopy(payload)
        if not isinstance(config["instrument"], dict):
            raise WorkspaceError("paper.economics_required")
        identity = {
            "symbol": metadata["symbol"],
            "exchange": metadata["exchange"],
            "interval": metadata["interval"],
            "currency": metadata.get("currency"),
        }
        if not identity["currency"] or any(
            value != config["instrument"].get(name) for name, value in identity.items()
        ):
            raise WorkspaceError("paper.source_mismatch", 409)
        profile = next(
            item
            for item in state["snapshot"]["tables"]["portfolios"]
            if item["id"] == run["portfolioId"]
        )
        currency = run.get("currency") or profile.get("currency")
        if currency != identity["currency"]:
            raise WorkspaceError("paper.currency_conversion_unavailable", 409)
        run["currency"] = currency
        config["startTime"] = bars[0]["time"]
        config = normalize_config(config)
        from services.paper_economics import execution_prices, journal_decimal

        journal_decimal(config["startingCash"], "startingCash")
        execution_prices(
            config, (bar[key] for bar in bars for key in ("open", "high", "low", "close"))
        )
        at = now()
        marker = {
            "version": 1,
            "revision": 1,
            "status": "ready",
            "manifestId": opaque("paper_manifest", f"{self.storage.uid}|{origin}|{run['id']}"),
        }
        marker["window"] = {"from": window["from"], "to": window["to"]}
        marker["startingCash"] = config["startingCash"]
        run["paper"] = marker
        run["status"] = "Ready"
        run["updatedAt"] = at
        bindings = self.storage._bindings(
            state["snapshot"],
            state["bindings"].get("resolutions", {}),
            ledger=state["journalLedger"],
        )
        bindings["nativeNamespaceMappings"] = state["bindings"].get("nativeNamespaceMappings", {})
        state["bindings"] = bindings
        book = self._book(state, run["id"])
        manifest = canonical_manifest(
            self.storage.uid, origin, run, config, version, at, book_id=book, window=window
        )
        marker["manifestId"] = manifest["id"]
        engine = initial_state(config)
        record = {
            "version": 1,
            "originId": origin,
            "runId": run["id"],
            "profileId": run["portfolioId"],
            "revision": 1,
            "status": "ready",
            "config": config,
            "manifest": manifest,
            "state": engine,
            "createdAt": at,
            "updatedAt": at,
            "datasetVersionId": version["id"],
            "datasetChecksum": version["checksum"],
            "window": window,
            "receipts": [],
        }
        if parent:
            record["parent"] = parent
            engine, _ = advance_bar(config, engine, bars[0])
            record["state"] = engine
        return record

    def action(self, origin, run_id, expected_revision, request_id, action, payload):
        from services.paper_engine import PaperEngineError

        try:
            result = self._action(origin, run_id, expected_revision, request_id, action, payload)
            return {**result, "workspace": self.storage.workspace(origin)}
        except PaperEngineError as error:
            raise WorkspaceError(error.code, error.status) from error

    def _action(self, origin, run_id, expected_revision, request_id, action, payload):
        from services.paper_engine import advance_bar, apply_command
        from services.paper_journal import project_paper_positions
        from services.paper_reports import canonical_checkpoint

        if (
            not valid_origin(origin)
            or not valid_origin(request_id)
            or not isinstance(payload, dict)
        ):
            raise WorkspaceError("paper.invalid_command")
        if type(expected_revision) is not int or not 0 <= expected_revision <= 9007199254740991:
            raise WorkspaceError("paper.invalid_revision")
        allowed = {
            "prepare",
            "start",
            "pause",
            "advance",
            "order",
            "cancel",
            "close",
            "finish",
            "branch",
        }
        if not isinstance(action, str) or action not in allowed:
            raise WorkspaceError("paper.invalid_action")
        body = {
            "origin": origin,
            "runId": run_id,
            "expectedRevision": expected_revision,
            "action": action,
            "payload": payload,
        }
        input_hash = digest(body)
        with self.storage.transaction() as connection:
            state = self.storage._read(connection, origin, full_modules=False)
            run = self._target(state, run_id)
            record = self.records.load(connection, origin, run_id)
            replay = self.storage._receipt(connection, request_id, "paper", body)
            if replay:
                target_id = replay.get("resultRunId", run_id)
                target = self._target(state, target_id)
                return {
                    "session": self._public(
                        self.records.load(connection, origin, target_id), target, state
                    ),
                    "receipt": replay,
                }
            receipt = next(
                (
                    item
                    for item in (record or {}).get("receipts", [])
                    if item["requestId"] == request_id
                ),
                None,
            )
            if receipt:
                if receipt["inputHash"] != input_hash:
                    raise WorkspaceError("request.idempotency_conflict", 409)
                target_id = receipt.get("resultRunId", run_id)
                target = self._target(state, target_id)
                return {
                    "session": self._public(
                        self.records.load(connection, origin, target_id), target, state
                    ),
                    "receipt": receipt,
                }
            if expected_revision != (record["revision"] if record else 0):
                raise WorkspaceError("paper.revision_conflict", 409)
            if record is None:
                if action != "prepare":
                    raise WorkspaceError("paper.not_prepared", 409)
                record = self._prepare(connection, state, origin, run, payload)
            else:
                if action == "prepare":
                    raise WorkspaceError("paper.already_prepared", 409)
                if len(record["receipts"]) >= MAX_RECEIPTS:
                    raise WorkspaceError("paper.command_budget", 413)
                if record["status"] == "finished" and action != "branch":
                    raise WorkspaceError("paper.finished", 409)
                engine = record["state"]
                config = record["config"]
                if action in ("start", "pause", "finish"):
                    keys(payload)
                    if action == "pause" and record["status"] == "ready":
                        raise WorkspaceError("paper.start_required", 409)
                    if action == "start":
                        self._bars(connection, run, record)
                    record["status"] = {
                        "start": "in_progress",
                        "pause": "paused",
                        "finish": "finished",
                    }[action]
                    if action == "finish":
                        for order in list(engine["orders"]):
                            if order.get("status") in ("pending", "open"):
                                engine, _ = apply_command(
                                    config,
                                    engine,
                                    {
                                        "id": opaque(
                                            "paper_finish", request_id + "|" + order["id"]
                                        ),
                                        "type": "cancel",
                                        "orderId": order["id"],
                                    },
                                )
                    engine["status"] = record["status"]
                elif action == "advance":
                    keys(payload, ("count",))
                    count = payload["count"]
                    if type(count) is not int or not 1 <= count <= 500:
                        raise WorkspaceError("paper.advance_budget")
                    if record["status"] == "ready":
                        raise WorkspaceError("paper.start_required", 409)
                    _, bars, _ = self._bars(connection, run, record)
                    if engine["cursor"] >= len(bars) - 1:
                        raise WorkspaceError("paper.end_of_history", 409)
                    for bar in bars[engine["cursor"] + 1 : engine["cursor"] + count + 1]:
                        engine, _ = advance_bar(config, engine, bar)
                elif action in ("order", "cancel", "close"):
                    if record["status"] not in ("in_progress", "paused"):
                        raise WorkspaceError("paper.start_required", 409)
                    if action != "cancel":
                        _, bars, _ = self._bars(connection, run, record)
                        if engine["cursor"] >= len(bars) - 1:
                            raise WorkspaceError("paper.end_of_history", 409)
                    fields = {
                        "order": (
                            ("side", "orderType", "quantity"),
                            (
                                "limitPrice",
                                "stopPrice",
                                "stopLoss",
                                "takeProfit",
                                "positionId",
                                "reduceOnly",
                            ),
                        ),
                        "cancel": (("orderId",), ()),
                        "close": (("positionId", "quantity"), ()),
                    }
                    keys(payload, *fields[action])
                    if action != "cancel":
                        from services.paper_economics import command_precision

                        command_precision(config, payload)
                    engine, _ = apply_command(
                        config,
                        engine,
                        {**payload, "id": opaque("paper_command", request_id), "type": action},
                    )
                elif action == "branch":
                    keys(payload, ("atIndex", "name"))
                    index = payload["atIndex"]
                    name = payload["name"]
                    if (
                        type(index) is not int
                        or not 0 <= index <= engine["cursor"]
                        or not isinstance(name, str)
                        or not name.strip()
                        or len(name) > 160
                    ):
                        raise WorkspaceError("paper.invalid_branch")
                    _, bars, _ = self._bars(connection, run, record)
                    if index >= len(bars) - 1:
                        raise WorkspaceError("paper.branch_next_event_required", 409)
                    next_id = (
                        max(
                            [row["id"] for row in state["snapshot"]["tables"]["practiceSessions"]]
                            + [0]
                        )
                        + 1
                    )
                    child = {
                        key: deepcopy(value)
                        for key, value in run.items()
                        if key not in ("paper", "chartView", "chartEvidence", "archivedAt")
                    }
                    child.update(
                        id=next_id,
                        name=name.strip(),
                        status="Draft",
                        createdAt=now(),
                        updatedAt=now(),
                    )
                    state["snapshot"]["tables"]["practiceSessions"].append(child)
                    child_config = {
                        key: deepcopy(value) for key, value in config.items() if key != "startTime"
                    }
                    child_record = self._prepare(
                        connection,
                        state,
                        origin,
                        child,
                        child_config,
                        parent={
                            "runId": run_id,
                            "cursorIndex": index,
                            "asOf": bars[index]["availableAt"],
                        },
                        first_index=bars[index]["time"],
                    )
                    child_record["checkpoint"] = canonical_checkpoint(
                        child_record["manifest"],
                        child_record["state"],
                        1,
                        child_record["updatedAt"],
                    )
                    self.records.save(connection, origin, next_id, child_record)
                    record["receipts"].append(
                        {
                            "requestId": request_id,
                            "inputHash": input_hash,
                            "revision": record["revision"],
                            "resultRunId": next_id,
                        }
                    )
                    self.records.save(connection, origin, run_id, record)
                    run["paper"]["startingCash"] = record["config"]["startingCash"]
                    self.journal._save(connection, state, origin)
                    receipt = {"requestId": request_id, "revision": 1, "resultRunId": next_id}
                    self.storage._save_receipt(connection, request_id, "paper", body, receipt)
                    return {"session": self._public(child_record, child, state), "receipt": receipt}
                record["state"] = engine
                record["revision"] += 1
                record["updatedAt"] = now()
            record["state"]["status"] = record["status"]
            record["checkpoint"] = canonical_checkpoint(
                record["manifest"], record["state"], record["revision"], record["updatedAt"]
            )
            run["paper"] = {
                "version": 1,
                "revision": record["revision"],
                "status": record["status"],
                "manifestId": record["manifest"]["id"],
                "window": {"from": record["window"]["from"], "to": record["window"]["to"]},
                "startingCash": record["config"]["startingCash"],
            }
            run["status"] = (
                "Completed"
                if record["status"] == "finished"
                else "Ready"
                if record["status"] == "ready"
                else "In progress"
            )
            run["updatedAt"] = record["updatedAt"]
            project_paper_positions(state, run, record, at=record["updatedAt"])
            record["receipts"].append(
                {"requestId": request_id, "inputHash": input_hash, "revision": record["revision"]}
            )
            self.journal._save(connection, state, origin)
            self.records.save(connection, origin, run_id, record)
            receipt = {
                "requestId": request_id,
                "revision": record["revision"],
                "resultRunId": run_id,
            }
            self.storage._save_receipt(connection, request_id, "paper", body, receipt)
            result = {"session": self._public(record, run, state), "receipt": receipt}
        return result
