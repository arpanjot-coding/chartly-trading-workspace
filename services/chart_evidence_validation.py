"""Bounded data-only chart evidence, shared by mutation and restored snapshots."""

from __future__ import annotations

import base64
import hashlib
import json
import math
import re
from copy import deepcopy
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from services.workspace_storage import WorkspaceError, valid_origin

MAX_EVIDENCE = 20
MAX_METADATA_BYTES = 64 * 1024
MAX_ORIGIN_ASSET_BYTES = 64 * 1024 * 1024


def keys(value, required, optional=()):
    if (
        not isinstance(value, dict)
        or not set(required) <= set(value)
        or set(value) - set(required) - set(optional)
    ):
        raise WorkspaceError("chart.invalid_evidence")


def text(value, limit=200, empty=False):
    if (
        not isinstance(value, str)
        or len(value) > limit
        or (not empty and not value.strip())
        or any(ord(c) < 32 for c in value)
    ):
        raise WorkspaceError("chart.invalid_evidence")
    return value


def seconds(value):
    if (
        type(value) not in (int, float)
        or not math.isfinite(value)
        or not -62135596800 <= value < 253402300800
    ):
        raise WorkspaceError("chart.invalid_view_time")
    return value


def captured_time(value):
    text(value, 80)
    if not re.search(r"(?:Z|[+-]\d\d:\d\d)$", value):
        raise WorkspaceError("chart.invalid_evidence")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError()
        fraction = re.search(r"[.,](\d+)", value)
        if fraction and len(fraction[1].rstrip("0")) > 6:
            raise ValueError()
        return parsed.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
    except (ValueError, OverflowError) as error:
        raise WorkspaceError("chart.invalid_evidence") from error


def capture_metadata(value):
    keys(value, ("version", "capturedAt", "source", "instrument", "view"))
    if type(value["version"]) is not int or value["version"] != 1:
        raise WorkspaceError("chart.invalid_evidence")
    result = deepcopy(value)
    result["capturedAt"] = captured_time(value["capturedAt"])
    source = result["source"]
    if not isinstance(source, dict):
        raise WorkspaceError("chart.invalid_evidence")
    if source.get("kind") == "dataset":
        keys(source, ("kind", "datasetVersionId", "checksum"), ("provider",))
        if not valid_origin(source["datasetVersionId"]) or not re.fullmatch(
            r"[0-9a-f]{64}", str(source["checksum"])
        ):
            raise WorkspaceError("chart.invalid_evidence")
        if "provider" in source:
            text(source["provider"], 80)
    elif source.get("kind") == "legacy-connected":
        keys(source, ("kind", "provider"))
        text(source["provider"], 80)
    else:
        raise WorkspaceError("chart.invalid_evidence")
    instrument = result["instrument"]
    keys(instrument, ("symbol", "exchange"))
    text(instrument["symbol"], 200)
    text(instrument["exchange"], 100)
    view = result["view"]
    keys(
        view,
        ("interval", "chartType", "timezone"),
        ("visibleFrom", "visibleTo", "replayAsOf", "paneId"),
    )
    for name in ("interval", "chartType", "timezone"):
        text(view[name], 100)
    try:
        ZoneInfo(view["timezone"])
    except (ValueError, ZoneInfoNotFoundError) as error:
        raise WorkspaceError("chart.invalid_timezone") from error
    if ("visibleFrom" in view) != ("visibleTo" in view):
        raise WorkspaceError("chart.invalid_view_time")
    for name in ("visibleFrom", "visibleTo", "replayAsOf"):
        if name in view:
            seconds(view[name])
    if "visibleFrom" in view and view["visibleFrom"] > view["visibleTo"]:
        raise WorkspaceError("chart.invalid_view_time")
    if "paneId" in view:
        text(view["paneId"], 100)
    try:
        if (
            len(
                json.dumps(
                    result, allow_nan=False, ensure_ascii=False, separators=(",", ":")
                ).encode()
            )
            > MAX_METADATA_BYTES
        ):
            raise WorkspaceError("chart.evidence_metadata_budget", 413)
    except (ValueError, TypeError, RecursionError) as error:
        raise WorkspaceError("chart.invalid_evidence") from error
    return result


def evidence_list(value):
    if not isinstance(value, list) or len(value) > MAX_EVIDENCE:
        raise WorkspaceError("chart.evidence_limit", 413)
    seen = set()
    for item in value:
        keys(
            item,
            (
                "id",
                "attachmentId",
                "imageSha256",
                "capturedAt",
                "source",
                "instrument",
                "view",
                "annotations",
            ),
        )
        if (
            not valid_origin(item["id"])
            or not valid_origin(item["attachmentId"])
            or item["id"] in seen
            or not re.fullmatch(r"[0-9a-f]{64}", str(item["imageSha256"]))
        ):
            raise WorkspaceError("chart.invalid_evidence")
        seen.add(item["id"])
        # Notes may contain ordinary newlines, unlike labels/identifiers.
        if (
            not isinstance(item["annotations"], str)
            or len(item["annotations"]) > 4000
            or "\x00" in item["annotations"]
        ):
            raise WorkspaceError("chart.invalid_evidence")
        capture_metadata(
            {
                "version": 1,
                **{key: item[key] for key in ("capturedAt", "source", "instrument", "view")},
            }
        )
    if (
        len(json.dumps(value, allow_nan=False, ensure_ascii=False, separators=(",", ":")).encode())
        > MAX_METADATA_BYTES
    ):
        raise WorkspaceError("chart.evidence_metadata_budget", 413)
    return value


def snapshot_evidence(snapshot, *, require_assets=False):
    for name in ("journalTrades", "practiceSessions"):
        for row in snapshot["tables"][name]:
            if "chartEvidence" not in row:
                continue
            evidence_list(row["chartEvidence"])
            if not require_assets:
                continue
            for item in row["chartEvidence"]:
                asset = snapshot.get("attachments", {}).get(item["attachmentId"])
                if not isinstance(asset, dict):
                    raise WorkspaceError("chart.evidence_asset_missing")
                if asset.get("status") == "unavailable":
                    continue
                try:
                    content = base64.b64decode(asset["base64"], validate=True)
                except (KeyError, ValueError, TypeError) as error:
                    raise WorkspaceError("chart.evidence_asset_missing") from error
                if (
                    asset.get("mimeType") != "image/png"
                    or hashlib.sha256(content).hexdigest() != item["imageSha256"]
                ):
                    raise WorkspaceError("chart.evidence_asset_mismatch")
                from services.chart_evidence import png_bytes

                png_bytes("image/png", asset["base64"])
