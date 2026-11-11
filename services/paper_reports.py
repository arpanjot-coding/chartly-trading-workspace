"""Deterministic paper reports and shared P01 run/checkpoint/metric adapters."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import UTC, datetime
from decimal import ROUND_HALF_EVEN, Decimal, localcontext

from services.domain.validation import validate_record


def _json(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )


def _id(prefix, value):
    return prefix + "_" + hashlib.sha256(value.encode()).hexdigest()[:40]


def state_checksum(state):
    return hashlib.sha256(_json(state).encode()).hexdigest()


def _instant(seconds):
    return (
        datetime.fromtimestamp(seconds, UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _number(value):
    text = format(value, "f")
    return (text.rstrip("0").rstrip(".") if "." in text else text) if value else "0"


def _checked(kind, value):
    issues = validate_record(kind, value)
    if issues:
        from services.workspace_storage import WorkspaceError

        raise WorkspaceError("paper.invalid_" + kind.lower(), issues=issues)
    return value


def canonical_manifest(uid, origin, session, config, dataset, created_at, *, book_id, window=None):
    scope = uid + "|" + origin
    identity = scope + "|" + str(session["id"])
    metadata = dataset["metadata"]
    window = window or {"from": dataset["start"], "lastAvailableAt": dataset["end"] + 1}
    return _checked(
        "RunManifest",
        {
            "schemaVersion": 1,
            "id": _id("paperrun", identity),
            "ownerId": uid,
            "workspaceId": _id("workspace", scope),
            "revision": 1,
            "createdAt": created_at,
            "updatedAt": created_at,
            "projectId": _id("practice", scope + "|" + str(session["portfolioId"])),
            "accountId": _id("paperaccount", identity),
            "bookId": book_id,
            "datasetVersionId": dataset["id"],
            "instrumentId": _id(
                "instrument",
                _json(
                    {
                        "symbol": metadata["symbol"],
                        "exchange": metadata["exchange"],
                        "currency": metadata["currency"],
                        "economics": config["instrument"],
                    }
                ),
            ),
            "mode": "paper_replay",
            "engine": {
                "name": "chartly-paper",
                "version": "1",
                "capabilityId": "paper_linear_native_v1",
            },
            "startingCash": {
                "value": config["startingCash"],
                "currency": config["instrument"]["currency"],
            },
            "rangeStart": _instant(window["from"]),
            "rangeEnd": _instant(window["lastAvailableAt"]),
            "costModelId": _id(
                "papercost", _json({"costs": config["costs"], "moneyScale": config["moneyScale"]})
            ),
            "fillPolicyId": "native_ohlc_conservative_v1",
            "seed": config["seed"],
        },
    )


def canonical_checkpoint(manifest, engine_state, revision, at):
    checksum = state_checksum(engine_state)
    return _checked(
        "Checkpoint",
        {
            "schemaVersion": 1,
            "id": _id("papercheckpoint", manifest["id"] + "|" + str(revision) + "|" + checksum),
            "ownerId": manifest["ownerId"],
            "workspaceId": manifest["workspaceId"],
            "revision": revision,
            "createdAt": at,
            "updatedAt": at,
            "runId": manifest["id"],
            "playhead": _instant(engine_state["asOf"]),
            "ledgerSequence": engine_state["sequence"],
            "stateChecksum": checksum,
            "stateArtifactId": _id("paperstate", checksum),
        },
    )


def build_paper_report(record, session, *, book_id=None):
    """Per-run performance only. A mark is never promoted to a realized exit."""
    from services.paper_engine import summary

    state, config = record["state"], record["config"]
    manifest, checkpoint = deepcopy(record["manifest"]), deepcopy(record["checkpoint"])
    if book_id is not None:
        manifest["bookId"] = book_id
    _checked("RunManifest", manifest)
    _checked("Checkpoint", checkpoint)
    facts = summary(config, state)
    currency = config["instrument"]["currency"]
    positions = state["positions"]
    closed = [position for position in positions if position["status"] == "closed"]
    with localcontext() as context:
        context.prec = 100
        results = [
            Decimal(position["realizedGross"])
            - Decimal(position["entryFee"])
            - Decimal(position["exitFees"])
            for position in closed
        ]
        wins = sum(value > 0 for value in results)
        profit = sum((value for value in results if value > 0), Decimal(0))
        loss = -sum((value for value in results if value < 0), Decimal(0))
        initial = Decimal(config["startingCash"])
        drawdown = Decimal(state["maxDrawdown"])
        drawdown_pct = Decimal(state["maxDrawdownPct"])
        net = Decimal(state["cash"]) - initial
        computed = {
            "realized_net": (_number(net), "currency", 1, None),
            "unrealized_pnl": (state["unrealized"], "currency", 1, None),
            "fees": (state["fees"], "currency", 1, None),
            "win_rate": (
                _number(
                    (Decimal(wins) / len(closed) * 100).quantize(
                        Decimal("0.00000001"), rounding=ROUND_HALF_EVEN
                    )
                )
                if closed
                else None,
                "percent",
                len(closed),
                None if closed else "empty_sample",
            ),
            "profit_factor": (
                _number((profit / loss).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_EVEN))
                if loss
                else None,
                "ratio",
                len(closed),
                "empty_sample" if not closed else "zero_denominator" if not loss else None,
            ),
            "max_drawdown": (_number(drawdown), "currency", len(state["equityCurve"]) + 1, None),
            "max_drawdown_percent": (
                _number(drawdown_pct.quantize(Decimal("0.00000001"), rounding=ROUND_HALF_EVEN)),
                "percent",
                len(state["equityCurve"]) + 1,
                None,
            ),
        }
    metrics = []
    query_id = _id("paperquery", manifest["id"] + "|" + checkpoint["stateChecksum"])
    for name, (value, unit, sample, unavailable) in computed.items():
        metric = {
            "schemaVersion": 1,
            "id": _id("papermetric", query_id + "|" + name),
            "ownerId": manifest["ownerId"],
            "workspaceId": manifest["workspaceId"],
            "revision": max(1, record["revision"]),
            "createdAt": record["updatedAt"],
            "updatedAt": record["updatedAt"],
            "metricId": name,
            "unit": unit,
            "sampleSize": sample,
            "formulaVersion": "paper-linear-report-v1",
            "denominatorPolicy": "completed_positions_only"
            if name in ("win_rate", "profit_factor")
            else "observed_account_state",
            "scope": "account",
            "queryId": query_id,
            **({"currency": currency} if unit == "currency" else {}),
            **({"value": value} if value is not None else {"unavailableReason": unavailable}),
        }
        metrics.append(_checked("MetricResult", metric))
    report = {
        "format": "chartly-paper-report",
        "version": 1,
        "runId": record["runId"],
        "profileId": record["profileId"],
        "name": session.get("name", "Paper session"),
        "status": record["status"],
        "revision": record["revision"],
        "manifest": manifest,
        "checkpoint": checkpoint,
        "source": {
            "datasetVersionId": record["datasetVersionId"],
            "checksum": record["datasetChecksum"],
        },
        "instrument": deepcopy(config["instrument"]),
        "costs": deepcopy(config["costs"]),
        "policy": deepcopy(config["policy"]),
        "seed": config["seed"],
        "currency": currency,
        "startingCash": config["startingCash"],
        "summary": facts,
        "metrics": metrics,
        "coverage": {
            **deepcopy(record["window"]),
            "cursorIndex": state["cursor"],
            "asOf": state["asOf"],
            "observedCount": state["cursor"] + 1,
        },
        "equityCurve": deepcopy(state["equityCurve"]),
        "curveStride": state["curveStride"],
        "orders": deepcopy(state["orders"]),
        "positions": deepcopy(positions),
        "fills": deepcopy(state["fills"]),
        "ledger": deepcopy(state["ledger"]),
        "assumptions": [
            "Native OHLC only; no exchange queue or tick-path certification.",
            "Entry fees are charged immediately; exits include only exit fees.",
            "Short proceeds are not spendable capital; one-times notional collateral model.",
            "Finishing preserves marked open exposure and never fabricates a close.",
            "Drawdown tracks every observed close; its display curve may be sampled. No annualized Sharpe is claimed.",
        ],
        "links": {
            "chart": f"/trading?profileId={record['profileId']}&runId={record['runId']}",
            "journal": f"/workspace/profiles/{record['profileId']}/journal?book={manifest['bookId']}",
        },
        **({"parent": deepcopy(record["parent"])} if record.get("parent") else {}),
    }
    report["checksum"] = hashlib.sha256(_json(report).encode()).hexdigest()
    return report


def compare_paper_reports(reports):
    if (
        not isinstance(reports, list)
        or len(reports) > 100
        or len({report["manifest"]["id"] for report in reports}) != len(reports)
    ):
        from services.workspace_storage import WorkspaceError

        raise WorkspaceError("paper.invalid_comparison")
    return {
        "version": 1,
        "scope": "independent-paper-sessions",
        "runs": deepcopy(reports),
        "combinedEquity": None,
        "combinedEquityUnavailableReason": "independent_accounts",
        "pooledMetrics": None,
        "currencyConversion": "none",
        "selectedCount": len(reports),
    }
