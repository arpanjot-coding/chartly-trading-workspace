"""Validate untrusted v1 records before any persistence or dispatch.

JSON Schema and relationship declarations are shared with the frontend. These
checks do not authenticate callers or replace transactional repository constraints.
"""

from __future__ import annotations

import json
import re
from copy import deepcopy
from datetime import datetime
from functools import cache, lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts" / "v1"
SCHEMA = json.loads((CONTRACTS / "schemas/domain.schema.json").read_text(encoding="utf-8"))
RULES = json.loads((CONTRACTS / "rules.json").read_text(encoding="utf-8"))
TIMEZONES = frozenset(json.loads((CONTRACTS / "timezones.json").read_text(encoding="utf-8")))
RECORD_TYPES = frozenset(
    name for name, value in SCHEMA["$defs"].items() if "id" in value.get("properties", {})
)
formats = FormatChecker()


@formats.checks("utc-instant")
def _instant(value: Any) -> bool:
    if not isinstance(value, str):
        return True  # JSON Schema's type keyword owns type errors.
    if not re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z", value
    ):
        return False
    try:
        datetime.fromisoformat(value)
        return True
    except ValueError:
        return False


@formats.checks("iana-timezone")
def _timezone(value: Any) -> bool:
    return not isinstance(value, str) or value in TIMEZONES


@formats.checks("trading-date")
def _date(value: Any) -> bool:
    return not isinstance(value, str) or _instant(value + "T00:00:00Z")


def _issue(code: str, path: str) -> dict[str, str]:
    return {"code": code, "path": path}


def _pointer(part: Any) -> str:
    return str(part).replace("~", "~0").replace("/", "~1")


def _sorted(issues: list[dict[str, str]]) -> list[dict[str, str]]:
    return [_issue(code, path) for path, code in sorted({(x["path"], x["code"]) for x in issues})]


@cache
def _validator(type_name: str) -> Draft202012Validator:
    return Draft202012Validator(
        {"$schema": SCHEMA["$schema"], "$defs": SCHEMA["$defs"], "$ref": f"#/$defs/{type_name}"},
        format_checker=formats,
    )


def validate_record(type_name: str, value: Any) -> list[dict[str, str]]:
    if not isinstance(type_name, str) or type_name not in RECORD_TYPES:
        return [_issue("contract.unknown_type", "")]
    if (
        isinstance(value, dict)
        and "schemaVersion" in value
        and (isinstance(value["schemaVersion"], bool) or value["schemaVersion"] != 1)
    ):
        return [_issue("contract.unsupported_version", "/schemaVersion")]
    issues = []
    for error in _validator(type_name).iter_errors(value):
        path = "".join("/" + _pointer(p) for p in error.absolute_path)
        if error.validator == "required":
            issues.extend(
                _issue("schema.required", path + "/" + _pointer(k))
                for k in error.validator_value
                if k not in error.instance
            )
        elif error.validator == "additionalProperties":
            issues.extend(
                _issue("schema.additionalProperties", path + "/" + _pointer(k))
                for k in error.instance
                if k not in error.schema["properties"]
            )
        else:
            issues.append(_issue("schema." + error.validator, path))
    if issues:
        return _sorted(issues)
    if datetime.fromisoformat(value["updatedAt"]) < datetime.fromisoformat(value["createdAt"]):
        issues.append(_issue("time.reversed", "/updatedAt"))
    if type_name == "Account":
        external = value["kind"] == "external"
        if external != value["mode"].startswith("broker_"):
            issues.append(_issue("account.mode_mismatch", "/mode"))
        for key in ("providerId", "venue", "externalIdentity"):
            if external and key not in value:
                issues.append(_issue("account.identity_required", "/" + key))
            if not external and key in value:
                issues.append(_issue("account.simulated_identity", "/" + key))
    if type_name == "JournalBook":
        if value["kind"] == "manual" and "accountId" in value:
            issues.append(_issue("book.manual_account", "/accountId"))
        if value["kind"] != "manual" and "accountId" not in value:
            issues.append(_issue("book.account_required", "/accountId"))
    if type_name == "CapabilityManifest":
        for key, capability in value["capabilities"].items():
            if capability["state"] == "supported" and not all(
                k in capability for k in ("evidenceId", "verifiedAt")
            ):
                issues.append(_issue("capability.evidence_required", "/capabilities/" + key))
    if (
        type_name == "SourceConnection"
        and value["health"] != "unknown"
        and "observedAt" not in value
    ):
        issues.append(_issue("source.observation_required", "/observedAt"))
    if type_name in ("Listing", "ProviderSymbol") and "validTo" in value:
        if datetime.fromisoformat(value["validTo"]) <= datetime.fromisoformat(value["validFrom"]):
            issues.append(_issue("time.invalid_range", "/validTo"))
    if type_name == "Instrument":
        for field, scale in (("quantityStep", "quantityScale"), ("priceTick", "priceScale")):
            if field not in value and scale not in value:
                continue
            units = (
                decimal_units(value[field], value[scale])
                if field in value and scale in value
                else None
            )
            if units is None or units <= 0:
                issues.append(_issue("decimal.invalid_step", "/" + field))
        if "multiplier" in value and decimal_units(value["multiplier"], 18) <= 0:
            issues.append(_issue("decimal.positive_required", "/multiplier"))
    issues.extend(_record_semantics(type_name, value))
    return _sorted(issues)


def _record_semantics(kind: str, value: dict) -> list[dict[str, str]]:
    issues = []

    def reject(code, field):
        issues.append(_issue(code, "/" + field))

    def at(field):
        return datetime.fromisoformat(value[field])

    if kind == "EventEnvelope":
        if value["contextKind"] in ("account", "paper"):
            for field in ("accountId", "mode", "sourceId"):
                if field not in value:
                    reject("envelope.account_context_required", field)
            if value["contextKind"] == "paper" and "runId" not in value:
                reject("envelope.account_context_required", "runId")
        elif "accountId" in value or "mode" in value or "runId" in value:
            reject("envelope.account_context_forbidden", "contextKind")
    if kind in RULES["ranges"]:
        start, end = RULES["ranges"][kind]
        if at(start) >= at(end):
            reject("time.invalid_range", end)
    if kind in ("DocumentVersion", "FactObservation"):
        if at("publishedAt") > at("availableAt"):
            reject("research.availability_order", "availableAt")
        if at("availableAt") > at("retrievedAt"):
            reject("research.availability_order", "retrievedAt")
    if kind == "FactObservation":
        if value["unit"] == "currency" and "currency" not in value:
            reject("research.currency_required", "currency")
        if value["periodKind"] == "duration" and "periodStart" not in value:
            reject("research.period_start_required", "periodStart")
        if value["periodKind"] == "instant" and "periodStart" in value:
            reject("research.instant_period", "periodStart")
        if "periodStart" in value and value["periodStart"] > value["periodEnd"]:
            reject("time.invalid_range", "periodEnd")
    if kind in ("DerivedMetric", "MetricResult"):
        if ("value" in value) == ("unavailableReason" in value):
            reject("metric.value_or_unavailable", "value")
        if value["unit"] == "currency" and "currency" not in value:
            reject("metric.currency_required", "currency")
        if kind == "MetricResult" and value["sampleSize"] == 0 and "value" in value:
            reject("metric.empty_sample", "value")
    if kind == "OrderIntent":
        for order_type, field in (("limit", "limitPrice"), ("stop", "stopPrice")):
            if value["orderType"] == order_type and field not in value:
                reject("order.price_required", field)
            if field in value and decimal_units(value[field], 18) <= 0:
                reject("decimal.positive_required", field)
        if value["mode"] == "paper_replay" and ("destinationId" in value or "runId" not in value):
            reject("mode.paper_run_required", "runId")
        if value["mode"].startswith("broker_") and (
            "destinationId" not in value or "runId" in value
        ):
            reject("mode.broker_destination_required", "destinationId")
    if kind in ("TradeAggregate", "ManualTrade"):
        if value["status"] == "closed" and "closedAt" not in value:
            reject("trade.close_time_required", "closedAt")
        if value["status"] == "open" and "closedAt" in value:
            reject("trade.open_close_time", "closedAt")
        if "closedAt" in value and at("closedAt") < at("openedAt"):
            reject("time.invalid_range", "closedAt")
        if kind == "TradeAggregate":
            if not value["feesKnown"] and "netPnl" in value:
                reject("trade.unknown_fees", "netPnl")
            if not value["fillIds"]:
                reject("trade.fills_required", "fillIds")
    if kind == "JournalEntry" and ("manualTradeId" in value) == ("tradeId" in value):
        reject("journal.exactly_one_trade", "tradeId")
    if kind == "Experiment" and at("warmupStart") > at("rangeStart"):
        reject("experiment.invalid_warmup", "warmupStart")
    if kind == "EvaluationSplit":
        pairs = [
            ("trainingStart", "trainingEnd", False),
            ("trainingEnd", "validationStart", True),
            ("validationStart", "validationEnd", False),
            ("validationEnd", "holdoutStart", True),
            ("holdoutStart", "holdoutEnd", False),
        ]
        for start, end, allow_equal in pairs:
            if at(start) > at(end) or (not allow_equal and at(start) == at(end)):
                reject("experiment.overlapping_split", end)
    if kind == "SourceCoverage":
        if value["status"] == "complete" and ("evidenceId" not in value or value["gaps"]):
            reject("coverage.unproven_complete", "status")
        for i, gap in enumerate(value["gaps"]):
            if (
                not at("rangeStart")
                <= datetime.fromisoformat(gap["start"])
                < datetime.fromisoformat(gap["end"])
                <= at("rangeEnd")
            ):
                reject("coverage.invalid_gap", f"gaps/{i}")
    if (
        kind == "ReconciliationConflict"
        and value["status"] != "unresolved"
        and "resolutionReceiptId" not in value
    ):
        reject("reconciliation.receipt_required", "resolutionReceiptId")
    if kind == "ScopedQuery" and value["currencyPolicy"] == "converted":
        for field in ("reportingCurrency", "conversionSourceId", "asOf"):
            if field not in value:
                reject("query.conversion_provenance", field)
    return issues


def decimal_units(value: str, scale: int) -> int | None:
    """Exact decimal-to-integer conversion. Never rounds or passes through float."""
    if not isinstance(value, str) or not re.fullmatch(SCHEMA["$defs"]["Decimal"]["pattern"], value):
        return None
    if not isinstance(scale, int) or isinstance(scale, bool) or not 0 <= scale <= 18:
        return None
    whole, _, fraction = value.lstrip("-").partition(".")
    if len(fraction) > scale:
        return None
    return (-1 if value.startswith("-") else 1) * int(whole + fraction.ljust(scale, "0"))


def validate_records(entries: Any) -> list[dict[str, str]]:
    if not isinstance(entries, list):
        return [_issue("collection.array_required", "")]
    if len(entries) > 10000:
        return [_issue("collection.limit", "")]
    issues = []
    for i, entry in enumerate(entries):
        if (
            not isinstance(entry, dict)
            or set(entry) != {"type", "value"}
            or not isinstance(entry["type"], str)
        ):
            issues.append(_issue("collection.entry_invalid", f"/{i}"))
        else:
            issues.extend(
                _issue(e["code"], f"/{i}/value" + e["path"])
                for e in validate_record(entry["type"], entry["value"])
            )
    if issues:
        return _sorted(issues)
    index = {}
    for i, entry in enumerate(entries):
        value = entry["value"]
        if value["id"] in index:
            issues.append(_issue("identity.duplicate_id", f"/{i}/value/id"))
        else:
            index[value["id"]] = (entry["type"], value)
    for i, entry in enumerate(entries):
        kind, value = entry["type"], entry["value"]
        refs = dict(RULES["references"].get(kind, {}))
        if kind != "LocalOwner":
            refs["ownerId"] = "LocalOwner"
        if kind not in ("LocalOwner", "Workspace"):
            refs["workspaceId"] = "Workspace"
        for field, target_type in refs.items():
            targets = value.get(field, [])
            if not isinstance(targets, list):
                targets = [targets]
            for target_id in targets:
                target = index.get(target_id)
                path = f"/{i}/value/{field}"
                if target is None or target[0] != target_type:
                    issues.append(_issue("reference.missing", path))
                    continue
                if target_type != "LocalOwner" and target[1]["ownerId"] != value["ownerId"]:
                    issues.append(_issue("scope.owner_mismatch", path))
                if (
                    target_type not in ("LocalOwner", "Workspace")
                    and target[1]["workspaceId"] != value["workspaceId"]
                ):
                    issues.append(_issue("scope.workspace_mismatch", path))
        if kind == "JournalBook" and "accountId" in value:
            account_entry = index.get(value["accountId"])
            if account_entry and account_entry[0] == "Account":
                account = account_entry[1]
                if (value["kind"] == "connected") != (account["kind"] == "external"):
                    issues.append(_issue("book.account_kind", f"/{i}/value/accountId"))
                if account["currency"] != value["currency"]:
                    issues.append(_issue("book.account_currency", f"/{i}/value/currency"))
        if kind == "Profile" and "primaryBookId" in value and "primaryAccountId" in value:
            book = index.get(value["primaryBookId"])
            if (
                book
                and book[0] == "JournalBook"
                and book[1].get("accountId") != value["primaryAccountId"]
            ):
                issues.append(
                    _issue("profile.account_book_mismatch", f"/{i}/value/primaryAccountId")
                )
        if kind == "Quantity":
            instrument = index.get(value["instrumentId"])
            if instrument and instrument[0] == "Instrument":
                meta = instrument[1]
                if not all(
                    field in meta for field in ("quantityScale", "quantityStep", "quantityUnit")
                ):
                    issues.append(
                        _issue("instrument.economics_unavailable", f"/{i}/value/instrumentId")
                    )
                    continue
                units = decimal_units(value["value"], meta["quantityScale"])
                step = decimal_units(meta["quantityStep"], meta["quantityScale"])
                if value["unit"] != meta["quantityUnit"]:
                    issues.append(_issue("quantity.unit_mismatch", f"/{i}/value/unit"))
                if units is None or units <= 0 or not step or units % step:
                    issues.append(_issue("quantity.invalid_step", f"/{i}/value/value"))
        issues.extend(
            _issue(e["code"], f"/{i}/value" + e["path"])
            for e in _graph_semantics(kind, value, index)
        )
    for rule in RULES["unique"]:
        seen = set()
        for i, entry in enumerate(entries):
            value = entry["value"]
            if entry["type"] != rule["type"] or not all(
                value.get(k) == v for k, v in rule["where"].items()
            ):
                continue
            if rule.get("skipMissing") and not all(field in value for field in rule["fields"]):
                continue
            key = tuple(value.get(k) for k in ("ownerId", "workspaceId", *rule["fields"]))
            if key in seen:
                issues.append(
                    _issue(rule["code"], f"/{i}/value/" + rule.get("errorField", rule["fields"][0]))
                )
            seen.add(key)
    issues.extend(_collection_semantics(entries, index))
    return _sorted(issues)


def _collection_semantics(entries, index):
    issues = []
    positions = {e["value"]["id"]: i for i, e in enumerate(entries)}
    colors = {}
    # Iterative traversal avoids recursion limits on imported dependency graphs.
    for root_id in sorted(index):
        if index[root_id][0] != "ArtifactRevision" or colors.get(root_id):
            continue
        colors[root_id] = 1
        stack = [(root_id, 0)]
        while stack:
            node_id, edge = stack[-1]
            deps = index[node_id][1]["dependencies"]
            if edge >= len(deps):
                colors[node_id] = 2
                stack.pop()
                continue
            stack[-1] = (node_id, edge + 1)
            target_id = deps[edge]["revisionId"]
            if target_id not in index or index[target_id][0] != "ArtifactRevision":
                continue
            if colors.get(target_id) == 1:
                issues.append(
                    _issue(
                        "artifact.dependency_cycle",
                        f"/{positions[node_id]}/value/dependencies/{edge}/revisionId",
                    )
                )
            elif not colors.get(target_id):
                colors[target_id] = 1
                stack.append((target_id, 0))
    windows = {}
    for i, entry in enumerate(entries):
        if entry["type"] != "ProviderSymbol":
            continue
        value = entry["value"]
        key = (value["ownerId"], value["workspaceId"], value["sourceId"], value["symbol"])
        start = datetime.fromisoformat(value["validFrom"])
        end = datetime.fromisoformat(value["validTo"]) if "validTo" in value else None
        for other_start, other_end in windows.get(key, []):
            if (end is None or other_start < end) and (other_end is None or start < other_end):
                issues.append(_issue("symbol.overlapping_alias", f"/{i}/value/validFrom"))
        windows.setdefault(key, []).append((start, end))
    return issues


def _graph_semantics(kind, value, index):
    issues = []

    def reject(code, field):
        issues.append(_issue(code, "/" + field))

    def lookup(field, expected=None):
        result = index.get(value.get(field))
        return result[1] if result and (expected is None or result[0] == expected) else None

    account = lookup("accountId", "Account")
    if account and "mode" in value and account["mode"] != value["mode"]:
        reject("mode.account_mismatch", "mode")
    if account:
        for field in (
            "intentId",
            "commandId",
            "fillId",
            "destinationId",
            "runId",
            "sourceId",
            "correctsFillId",
            "correctsObservationId",
        ):
            target = lookup(field)
            if target and "accountId" in target and target["accountId"] != value["accountId"]:
                reject("scope.account_mismatch", field)
    if kind in ("ExecutionFill", "SourceObservation"):
        source = lookup("sourceId", "SourceConnection")
        if source and source["providerId"] != value["providerId"]:
            reject("source.provider_mismatch", "providerId")
    if kind in ("ExecutionFill", "OrderIntent") and "decisionId" in value:
        decision = lookup("decisionId", "Decision")
        if decision and value["accountId"] not in decision["accountIds"]:
            reject("decision.account_scope", "decisionId")
    if kind == "CapabilityManifest":
        source = lookup("sourceId", "SourceConnection")
        if source:
            if source["adapterVersion"] != value["adapterVersion"]:
                reject("capability.adapter_mismatch", "adapterVersion")
            bound = index.get(source.get("accountId"))
            if bound and bound[0] == "Account" and value["environment"] != bound[1]["mode"]:
                reject("mode.account_mismatch", "environment")
        if value["environment"] == "data_only":
            for key in ("orderSubmit", "orderCancel", "protectiveOrders"):
                if value["capabilities"].get(key, {}).get("state") == "supported":
                    reject("capability.data_only_write", "capabilities/" + key)
    if kind == "ExecutionDestination":
        manifest = lookup("manifestId", "CapabilityManifest")
        if manifest and (
            manifest["sourceId"] != value["sourceId"] or manifest["environment"] != value["mode"]
        ):
            reject("destination.manifest_mismatch", "manifestId")
    if kind in ("JournalEntry", "ManualTrade", "Review"):
        book = lookup("bookId", "JournalBook")
        if book:
            if kind == "ManualTrade" and book["kind"] != "manual":
                reject("journal.manual_book_required", "bookId")
            if kind == "JournalEntry":
                manual = lookup("manualTradeId", "ManualTrade")
                trade = lookup("tradeId", "TradeAggregate")
                if manual and (book["kind"] != "manual" or manual["bookId"] != value["bookId"]):
                    reject("journal.book_mismatch", "manualTradeId")
                if trade and book.get("accountId") != trade["accountId"]:
                    reject("journal.book_mismatch", "tradeId")
            if kind == "Review":
                trade = lookup("tradeId", "TradeAggregate")
                if trade and book.get("accountId") != trade["accountId"]:
                    reject("journal.book_mismatch", "tradeId")
    if kind in ("ExecutionFill", "OrderIntent"):
        instrument = lookup("instrumentId", "Instrument")
        if instrument:
            if not all(
                field in instrument
                for field in (
                    "quantityScale",
                    "quantityStep",
                    "quantityUnit",
                    "priceScale",
                    "priceTick",
                    "multiplier",
                    "calendarId",
                    "timezone",
                )
            ):
                reject("instrument.economics_unavailable", "instrumentId")
                return issues
            units = decimal_units(value["quantity"]["value"], instrument["quantityScale"])
            step = decimal_units(instrument["quantityStep"], instrument["quantityScale"])
            if value["quantity"]["unit"] != instrument["quantityUnit"]:
                reject("quantity.unit_mismatch", "quantity/unit")
            if units is None or units <= 0 or not step or units % step:
                reject("quantity.invalid_step", "quantity/value")
            if kind == "ExecutionFill":
                price = decimal_units(value["price"], instrument["priceScale"])
                tick = decimal_units(instrument["priceTick"], instrument["priceScale"])
                if price is None or price <= 0 or not tick or price % tick:
                    reject("price.invalid_tick", "price")
                if value["currency"] != instrument["quoteCurrency"]:
                    reject("price.currency_mismatch", "currency")
    for field in ("fillIds", "observationIds"):
        if "accountId" in value:
            for target_id in value.get(field, []):
                target = index.get(target_id)
                if target and target[1].get("accountId") != value["accountId"]:
                    reject("scope.account_mismatch", field)
    if kind in ("RunManifest", "Experiment"):
        dataset = lookup("datasetVersionId", "DatasetVersion")
        if dataset:
            if dataset["instrumentId"] != value["instrumentId"]:
                reject("dataset.instrument_mismatch", "instrumentId")
            if (
                not datetime.fromisoformat(dataset["rangeStart"])
                <= datetime.fromisoformat(value["rangeStart"])
                < datetime.fromisoformat(value["rangeEnd"])
                <= datetime.fromisoformat(dataset["rangeEnd"])
            ):
                reject("dataset.range_uncovered", "rangeEnd")
            if dataset["quality"] != "verified":
                reject("dataset.unverified", "datasetVersionId")
        if kind == "RunManifest":
            book = lookup("bookId", "JournalBook")
            if book and (book["kind"] != "paper" or book.get("accountId") != value["accountId"]):
                reject("run.book_mismatch", "bookId")
    if kind in ("IndicatorAttachment", "Experiment", "DeploymentRevision", "ValidationRecord"):
        parameters = lookup("parameterSetId", "ParameterSet")
        if parameters and parameters["artifactRevisionId"] != value["artifactRevisionId"]:
            reject("artifact.parameter_revision_mismatch", "parameterSetId")
        revision = lookup("artifactRevisionId", "ArtifactRevision")
        if (
            revision
            and kind in ("Experiment", "DeploymentRevision")
            and revision["kind"] != "strategy"
        ):
            reject("artifact.strategy_required", "artifactRevisionId")
        if revision and kind == "IndicatorAttachment" and revision["kind"] != "indicator":
            reject("artifact.indicator_required", "artifactRevisionId")
        if kind == "ValidationRecord":
            for experiment_id in value["experimentIds"]:
                target = index.get(experiment_id)
                if (
                    target
                    and target[0] == "Experiment"
                    and any(
                        target[1][k] != value[k] for k in ("artifactRevisionId", "parameterSetId")
                    )
                ):
                    reject("artifact.evidence_mismatch", "experimentIds")
    if kind == "ArtifactRevision":
        project = lookup("projectId", "ArtifactProject")
        if project and (
            project["kind"] != value["kind"] or project["language"] != value["language"]
        ):
            reject("artifact.project_mismatch", "projectId")
        for i, dependency in enumerate(value["dependencies"]):
            target = index.get(dependency["revisionId"])
            if not target or target[0] != "ArtifactRevision":
                reject("reference.missing", f"dependencies/{i}/revisionId")
            elif (
                target[1]["ownerId"] != value["ownerId"]
                or target[1]["workspaceId"] != value["workspaceId"]
            ):
                reject("scope.owner_mismatch", f"dependencies/{i}/revisionId")
            elif (
                target[1]["checksum"] != dependency["checksum"]
                or dependency["revisionId"] == value["id"]
            ):
                reject("artifact.dependency_mismatch", f"dependencies/{i}/checksum")
    if kind == "FactObservation":
        document = lookup("documentVersionId", "DocumentVersion")
        if document and document["issuerId"] != value["issuerId"]:
            reject("research.issuer_mismatch", "documentVersionId")
        if document and datetime.fromisoformat(document["availableAt"]) > datetime.fromisoformat(
            value["availableAt"]
        ):
            reject("research.future_evidence", "documentVersionId")
        previous = lookup("revisesFactId", "FactObservation")
        if previous and any(
            previous[k] != value[k] for k in ("issuerId", "metricId", "periodKind", "periodEnd")
        ):
            reject("research.revision_mismatch", "revisesFactId")
    if kind == "DerivedMetric":
        for fact_id in value["inputFactIds"]:
            target = index.get(fact_id)
            if target and target[0] == "FactObservation":
                if target[1]["issuerId"] != value["issuerId"]:
                    reject("research.issuer_mismatch", "inputFactIds")
                if datetime.fromisoformat(target[1]["availableAt"]) > datetime.fromisoformat(
                    value["availableAt"]
                ):
                    reject("research.future_evidence", "inputFactIds")
    if kind == "Checkpoint":
        run = lookup("runId", "RunManifest")
        if run and not datetime.fromisoformat(run["rangeStart"]) <= datetime.fromisoformat(
            value["playhead"]
        ) <= datetime.fromisoformat(run["rangeEnd"]):
            reject("run.playhead_outside_range", "playhead")
    if kind == "DeploymentRevision":
        destination = lookup("destinationId", "ExecutionDestination")
        if destination and destination["mode"] != value["mode"]:
            reject("mode.account_mismatch", "mode")
    if kind == "NotebookSnapshot":
        for field in ("documentVersionIds", "factIds", "derivedMetricIds"):
            for target_id in value[field]:
                target = index.get(target_id)
                if (
                    target
                    and "availableAt" in target[1]
                    and datetime.fromisoformat(target[1]["availableAt"])
                    > datetime.fromisoformat(value["asOf"])
                ):
                    reject("research.future_evidence", field)
    if kind in ("CommandEnvelope", "EventEnvelope"):
        target = lookup("payloadId", value["payloadType"])
        if not target:
            reject("reference.missing", "payloadId")
        else:
            for key in ("accountId", "mode", "ownerId", "workspaceId"):
                if key in target and target[key] != value.get(key):
                    reject("envelope.scope_mismatch", "payloadId")
            if (
                kind == "EventEnvelope"
                and "accountId" in target
                and value["contextKind"] not in ("account", "paper")
            ):
                reject("envelope.account_context_required", "contextKind")
    return issues


def validate_transition(
    machine: str, before: str, after: str, *, manifest_valid=False, eligible=False, approved=False
):
    if not all(isinstance(value, str) for value in (machine, before, after)):
        return [_issue("transition.unknown_state", "")]
    graph = RULES["stateMachines"].get(machine)
    if graph is None or before not in graph or after not in graph:
        return [_issue("transition.unknown_state", "")]
    if after not in graph[before]:
        return [_issue("transition.forbidden", "")]
    if machine == "run" and after in ("ready", "in_progress") and manifest_valid is not True:
        return [_issue("transition.manifest_required", "")]
    if machine == "arming" and after == "armed" and not (eligible is True and approved is True):
        return [_issue("transition.approval_required", "")]
    return []


def validate_replacement(type_name: str, previous: Any, proposed: Any) -> list[dict[str, str]]:
    issues = validate_record(type_name, previous) + validate_record(type_name, proposed)
    if issues:
        return _sorted(issues)
    if previous == proposed:
        return []  # Idempotent retry, not another revision.
    if type_name in RULES["immutableTypes"]:
        return [_issue("revision.immutable", "")]
    for field in (
        "id",
        "ownerId",
        "workspaceId",
        "createdAt",
        *RULES["immutableFields"].get(type_name, []),
    ):
        if previous.get(field) != proposed.get(field):
            issues.append(_issue("revision.identity_changed", "/" + field))
    if proposed["revision"] != previous["revision"] + 1:
        issues.append(_issue("revision.conflict", "/revision"))
    if datetime.fromisoformat(proposed["updatedAt"]) < datetime.fromisoformat(
        previous["updatedAt"]
    ):
        issues.append(_issue("time.reversed", "/updatedAt"))
    return _sorted(issues)


def require_valid_records(entries: Any) -> list[dict[str, Any]]:
    issues = validate_records(entries)
    if issues:
        raise ValueError({"code": "contract.invalid", "issues": issues})
    return deepcopy(entries)
