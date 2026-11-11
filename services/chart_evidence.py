"""Append chart captures through the existing scoped journal/assets transaction."""

from __future__ import annotations

import base64
import hashlib
from copy import deepcopy
from io import BytesIO
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, insert, select

from database.workspace_storage_db import assets
from services.chart_evidence_validation import (
    MAX_EVIDENCE,
    MAX_ORIGIN_ASSET_BYTES,
    capture_metadata,
    evidence_list,
    keys,
)
from services.data_library import DataLibrary
from services.journal_service import MAX_IMAGE_BYTES, REVIEW_FIELDS, JournalService
from services.workspace_storage import WorkspaceError, now, valid_id, valid_origin


def png_bytes(mime_type, content_base64):
    if (
        mime_type != "image/png"
        or not isinstance(content_base64, str)
        or len(content_base64) > ((MAX_IMAGE_BYTES + 2) // 3) * 4
    ):
        raise WorkspaceError("chart.invalid_image")
    try:
        content = base64.b64decode(content_base64, validate=True)
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise WorkspaceError("chart.image_budget", 413)
        with Image.open(BytesIO(content)) as image:
            if (
                image.format != "PNG"
                or getattr(image, "n_frames", 1) != 1
                or not 1 <= image.width <= 8192
                or not 1 <= image.height <= 8192
                or image.width * image.height > 16_777_216
            ):
                raise WorkspaceError("chart.invalid_image")
            image.verify()
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        raise WorkspaceError("chart.invalid_image") from error
    return content


class ChartEvidenceService:
    def __init__(self, storage):
        self.storage = storage
        self.journal = JournalService(storage)

    def attach(
        self,
        origin,
        expected_revision,
        request_id,
        target,
        mime_type,
        content_base64,
        capture,
        annotations="",
    ):
        if not valid_origin(origin):
            raise WorkspaceError("chart.invalid_target")
        keys(target, ("kind", "id", "profileId"), ("bookId",))
        if (
            target["kind"] not in ("trade", "run")
            or not valid_id(target["id"])
            or not valid_id(target["profileId"])
        ):
            raise WorkspaceError("chart.invalid_target")
        capture = capture_metadata(capture)
        if not isinstance(annotations, str) or len(annotations) > 4000 or "\x00" in annotations:
            raise WorkspaceError("chart.invalid_evidence")
        content = png_bytes(mime_type, content_base64)
        image_hash = hashlib.sha256(content).hexdigest()
        body = {
            "originId": origin,
            "expectedRevision": expected_revision,
            "target": deepcopy(target),
            "capture": deepcopy(capture),
            "annotations": annotations,
            "mimeType": mime_type,
            "sha256": image_hash,
        }
        # Scoped dataset metadata is initialized before opening the journal write transaction.
        library = DataLibrary(self.storage) if capture["source"]["kind"] == "dataset" else None
        with self.storage.transaction() as connection:
            receipt = self.storage._receipt(connection, request_id, "chart-evidence", body)
            if receipt is None:
                state = self.storage._read(connection, origin, full_modules=False)
                if type(expected_revision) is not int or expected_revision != state["revision"]:
                    raise WorkspaceError("storage.revision_conflict", 409)
                tables = state["snapshot"]["tables"]
                profile = next(
                    (
                        row
                        for row in tables["portfolios"]
                        if row["id"] == target["profileId"] and not row.get("archivedAt")
                    ),
                    None,
                )
                if profile is None:
                    raise WorkspaceError("journal.profile_not_found", 404)
                if target["kind"] == "trade":
                    row = self.journal._trade(state, target["id"])
                    book_id = self.journal._trade_book(state, row)
                    self.journal._book(state, target.get("bookId", book_id), target["profileId"])
                    if target.get("bookId", book_id) != book_id:
                        raise WorkspaceError("chart.target_mismatch", 409)
                    run = next(
                        (
                            item
                            for item in tables["practiceSessions"]
                            if item["id"] == row.get("sessionId")
                        ),
                        None,
                    )
                else:
                    row = next(
                        (item for item in tables["practiceSessions"] if item["id"] == target["id"]),
                        None,
                    )
                    if row is None:
                        raise WorkspaceError("chart.run_not_found", 404)
                    run = row
                    if "bookId" in target:
                        book = self.journal._book(state, target["bookId"], target["profileId"])
                        if book.get("kind") != "paper" or book.get("sessionId") != row["id"]:
                            raise WorkspaceError("chart.target_mismatch", 409)
                if (
                    row.get("portfolioId") != target["profileId"]
                    or row.get("archivedAt")
                    or run
                    and (run.get("portfolioId") != target["profileId"] or run.get("archivedAt"))
                ):
                    raise WorkspaceError("chart.target_mismatch", 409)
                source = capture["source"]
                if library:
                    version = library._version(connection, source["datasetVersionId"])
                    metadata = version["metadata"]
                    if version["checksum"] != source["checksum"]:
                        raise WorkspaceError("dataset.checksum_mismatch", 409)
                    if (
                        capture["instrument"]["symbol"],
                        capture["instrument"]["exchange"],
                        capture["view"]["interval"],
                    ) != (metadata["symbol"], metadata["exchange"], metadata["interval"]):
                        raise WorkspaceError("dataset.instrument_or_interval_mismatch", 409)
                    if "provider" in source and source["provider"] != metadata["provider"]:
                        raise WorkspaceError("chart.source_mismatch", 409)
                    source.update(datasetVersionId=version["id"], provider=metadata["provider"])
                if run and run.get("datasetVersionId"):
                    if not library:
                        raise WorkspaceError("chart.source_mismatch", 409)
                    bound = library._version(connection, run["datasetVersionId"])
                    if (
                        bound["id"] != version["id"]
                        or run.get("datasetChecksum") != version["checksum"]
                    ):
                        raise WorkspaceError("chart.source_mismatch", 409)
                if (row.get("symbol") if target["kind"] == "run" else row.get("pair")) != capture[
                    "instrument"
                ]["symbol"]:
                    raise WorkspaceError("chart.instrument_mismatch", 409)
                previous = deepcopy(row)
                items = deepcopy(row.get("chartEvidence", []))
                if len(items) >= MAX_EVIDENCE:
                    raise WorkspaceError("chart.evidence_limit", 413)
                total = connection.execute(
                    select(func.coalesce(func.sum(func.length(assets.c.content)), 0)).where(
                        self.storage.scope(assets, origin)
                    )
                ).scalar_one()
                if total + len(content) > MAX_ORIGIN_ASSET_BYTES:
                    raise WorkspaceError("chart.asset_budget", 413)
                attachment_id = "attachment_" + uuid4().hex
                evidence_id = "chart_" + uuid4().hex
                item = {
                    "id": evidence_id,
                    "attachmentId": attachment_id,
                    "imageSha256": image_hash,
                    **{
                        key: deepcopy(capture[key])
                        for key in ("capturedAt", "source", "instrument", "view")
                    },
                    "annotations": annotations,
                }
                items.append(item)
                evidence_list(items)
                row["chartEvidence"] = items
                url = f"/api/local/v1/attachments/{attachment_id}?originId={origin}"
                if target["kind"] == "trade":
                    row["screenshotUrl"] = url
                    row["reviewRevision"] = row.get("reviewRevision", 0) + 1
                    review = next(
                        (
                            record
                            for record in state["journalLedger"]["reviews"]
                            if record.get("tradeId") == row["id"]
                        ),
                        None,
                    )
                    if review is None:
                        review = {
                            "id": "review:" + str(row["id"]),
                            "tradeId": row["id"],
                            "bookId": self.journal._trade_book(state, row),
                            "reviewedFactRevision": row.get("factRevision", 0),
                        }
                        state["journalLedger"]["reviews"].append(review)
                    review.update(
                        revision=row["reviewRevision"],
                        updatedAt=now(),
                        fields={key: row[key] for key in REVIEW_FIELDS if key in row},
                    )
                    self.journal._history(state, row, previous, "attach-chart-evidence")
                else:
                    row["updatedAt"] = now()
                    self.journal._append_history(
                        state,
                        {
                            "id": "history_" + uuid4().hex,
                            "runId": row["id"],
                            "at": now(),
                            "action": "attach-chart-evidence",
                            "before": previous,
                            "after": deepcopy(row),
                        },
                    )
                self.journal._save(connection, state, origin)
                connection.execute(
                    insert(assets).values(
                        uid=self.storage.uid,
                        origin=origin,
                        id=attachment_id,
                        mime_type="image/png",
                        content=content,
                        source=url,
                        sha256=image_hash,
                    )
                )
                receipt = {
                    "result": {"evidenceId": evidence_id, "attachmentId": attachment_id, "url": url}
                }
                if target["kind"] == "trade":
                    receipt["detail"] = self.journal._detail(state, row["id"])
                self.storage._save_receipt(connection, request_id, "chart-evidence", body, receipt)
        return {**receipt, "workspace": self.storage.workspace(origin)}
