"""Measured repeated capture/metadata/asset lifecycles on actual scoped storage."""

import base64
import gc
import hashlib
import json
import time
import tracemalloc
from uuid import uuid4

import psutil
import pytest
from sqlalchemy import event, func, select
from test_chart_evidence import attach, png
from test_journal_service import act, manual

from database.workspace_storage_db import assets
from services.workspace_storage import WorkspaceError

pytest_plugins = ["test_journal_service"]


def handles(process):
    return process.num_handles() if hasattr(process, "num_handles") else process.num_fds()


def test_one_hundred_chart_captures_release_connections_and_avoid_metadata_image_encoding(
    storage, monkeypatch
):
    rows = [
        act(storage, "create-trade", {"trade": manual(storage)})["detail"]["trade"]
        for _ in range(5)
    ]
    content = png()
    expected_hash = hashlib.sha256(base64.b64decode(content)).hexdigest()
    counters = {
        "opened": 0,
        "closed": 0,
        "metadataReads": 0,
        "assetReads": 0,
        "invalidImages": 0,
        "staleWrites": 0,
        "rolledBackPublications": 0,
        "idempotentReplays": 0,
    }
    phase = None
    original_encode = base64.b64encode

    def opened(_dbapi, _record):
        counters["opened"] += 1

    def closed(_dbapi, _record):
        counters["closed"] += 1

    def statement(_connection, _cursor, sql, _parameters, _context, _many):
        if phase == "metadata" and "FROM workspace_assets" in sql:
            assert "workspace_assets.content" not in sql, (
                "Routine metadata must not select PNG bytes"
            )

    def encode(*args, **kwargs):
        assert phase != "metadata", "Routine metadata must not encode PNG bytes"
        return original_encode(*args, **kwargs)

    monkeypatch.setattr(base64, "b64encode", encode)
    event.listen(storage.engine, "connect", opened)
    event.listen(storage.engine, "close", closed)
    event.listen(storage.engine, "before_cursor_execute", statement)
    process = psutil.Process()
    gc.collect()
    initial_handles, initial_rss = handles(process), process.memory_info().rss
    tracemalloc.start()
    before = tracemalloc.get_traced_memory()[0]
    began = time.perf_counter()
    try:
        for index in range(100):
            row = rows[index % len(rows)]
            if index % 10 == 0:
                with pytest.raises(WorkspaceError, match="invalid_image"):
                    attach(storage, row, content="not a PNG")
                counters["invalidImages"] += 1
                with pytest.raises(WorkspaceError, match="revision_conflict"):
                    attach(storage, row, revision=0)
                counters["staleWrites"] += 1
            if index % 25 == 0:
                previous = storage.workspace()
                with monkeypatch.context() as isolated:

                    def fail(*_args):
                        raise RuntimeError("Interrupted receipt publication")

                    isolated.setattr(storage, "_save_receipt", fail)
                    with pytest.raises(RuntimeError, match="Interrupted"):
                        attach(storage, row)
                assert storage.workspace() == previous
                counters["rolledBackPublications"] += 1
            request_id = uuid4().hex
            revision = storage.workspace()["revision"]
            result = attach(
                storage,
                row,
                request_id=request_id,
                revision=revision,
                content=content,
                notes=f"Resource fixture capture {index}",
            )
            if index % 10 == 0:
                repeated = attach(
                    storage,
                    row,
                    request_id=request_id,
                    revision=revision,
                    content=content,
                    notes=f"Resource fixture capture {index}",
                )
                assert repeated == result
                counters["idempotentReplays"] += 1
            phase = "metadata"
            metadata = storage.workspace()
            assert all("base64" not in asset for asset in metadata["attachments"].values())
            counters["metadataReads"] += 1
            phase = "asset"
            blob = storage.attachment(result["result"]["attachmentId"], "journal_origin_01")
            assert blob["mime_type"] == "image/png"
            assert hashlib.sha256(blob["content"]).hexdigest() == expected_hash
            counters["assetReads"] += 1
            phase = None
        with storage.engine.connect() as connection:
            assert connection.execute(select(func.count()).select_from(assets)).scalar_one() == 100
        saved = storage.workspace()["tables"]["journalTrades"]
        assert len(saved) == 5 and all(len(row["chartEvidence"]) == 20 for row in saved)
        del metadata, result, repeated, previous, saved, blob
        gc.collect()
        retained, peak = tracemalloc.get_traced_memory()
        final_handles, final_rss = handles(process), process.memory_info().rss
        assert counters["opened"] == counters["closed"]
        assert final_handles <= initial_handles + 4
        assert retained - before < 8 * 1024 * 1024
        assert peak < 64 * 1024 * 1024
        print(
            "P05_CHART_WORKFLOW_RESOURCE_AUDIT",
            json.dumps(
                {
                    "iterations": 100,
                    **counters,
                    "initialHandles": initial_handles,
                    "finalHandles": final_handles,
                    "initialRss": initial_rss,
                    "finalRss": final_rss,
                    "retainedPythonBytes": retained - before,
                    "peakTracedPythonBytes": peak,
                    "elapsedSeconds": round(time.perf_counter() - began, 6),
                }
            ),
        )
    finally:
        tracemalloc.stop()
        event.remove(storage.engine, "connect", opened)
        event.remove(storage.engine, "close", closed)
        event.remove(storage.engine, "before_cursor_execute", statement)
