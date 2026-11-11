"""Measured P03 database/process cleanup on disposable local stores."""

import gc
import json
import subprocess
import tempfile
import time
import tracemalloc
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import event
from test_workspace_worker import handle_count, source

import services.workspace_worker as worker
from services.journal_service import JournalService
from services.workspace_storage import WorkspaceError, WorkspaceStorage

UID = "principal_journal_resource_audit"
ORIGIN = "worker_fixture_origin"


@pytest.fixture
def storage(tmp_path):
    store = WorkspaceStorage("sqlite:///" + (tmp_path / "journal-audit.db").as_posix(), UID)
    preview = store.preview_migration(source())
    store.commit_migration(preview["id"], {}, uuid4().hex)
    yield store
    store.engine.dispose()


def mapping():
    fields = (
        "eventId",
        "eventType",
        "positionId",
        "openedAt",
        "closedAt",
        "symbol",
        "side",
        "quantity",
        "netPnl",
        "currency",
    )
    return {
        "version": 1,
        "name": "Resource audit statement",
        "columns": {field: field for field in fields},
        "timezone": "UTC",
        "currency": "USD",
        "quantityUnit": "units",
    }


def statement():
    return (
        ",".join(mapping()["columns"]) + "\n"
        "fill-1,trade,position-1,2026-11-02T09:00:00Z,"
        "2026-11-02T10:00:00Z,EXAMPLE,Buy,2,12.34,USD\n"
    )


def seed(storage):
    service = JournalService(storage)
    state = storage.workspace()
    book = next(book["id"] for book in state["books"] if book["kind"] == "manual")
    created = service.action(
        ORIGIN,
        state["revision"],
        uuid4().hex,
        "create-trade",
        {
            "trade": {
                "portfolioId": 1,
                "journalBookId": book,
                "pair": "EXAMPLE",
                "direction": "Buy",
                "result": "Open",
                "currency": "USD",
                "openDate": "2026-11-02T09:00:00Z",
                "closeDate": "",
                "amounts": {"quantity": "10", "netPnl": None},
            },
        },
    )
    trade_id = created["detail"]["trade"]["id"]
    partial = service.action(
        ORIGIN,
        created["workspace"]["revision"],
        uuid4().hex,
        "partial-close-trade",
        {
            "tradeId": trade_id,
            "quantity": "4",
            "closedAt": "2026-11-02T10:00:00Z",
            "netPnl": "38.2",
        },
    )
    closed = service.action(
        ORIGIN,
        partial["workspace"]["revision"],
        uuid4().hex,
        "close-trade",
        {
            "tradeId": trade_id,
            "patch": {
                "result": "Win",
                "closeDate": "2026-11-02T11:00:00Z",
                "amounts": {"netPnl": "100"},
            },
        },
    )
    assert closed["detail"]["trade"]["remainingQuantity"] == "0"
    preview = service.preview_import(
        ORIGIN, 1, book, "fixture-csv", statement(), mapping(), closed["workspace"]["revision"]
    )
    service.commit_import(preview["id"], preview["expectedRevision"], uuid4().hex, False)
    return service, trade_id, book


def test_100_journal_roundtrips_balance_sqlite_connections_handles_and_retained_memory(
    storage, record_property
):
    service, trade_id, book = seed(storage)
    active = set()
    opened_count = closed_count = 0

    def opened(connection, _record):
        nonlocal opened_count
        opened_count += 1
        active.add(id(connection))

    def closed(connection, _record):
        nonlocal closed_count
        closed_count += 1
        active.remove(id(connection))

    event.listen(storage.engine, "connect", opened)
    event.listen(storage.engine, "close", closed)
    tracing_owned = not tracemalloc.is_tracing()
    try:
        # Warm SQL compilation and encoding caches before recording the baseline.
        service.state(ORIGIN)
        service.detail(ORIGIN, trade_id)
        service.export(ORIGIN, 1, book, "json")
        gc.collect()
        initial_handles = handle_count()
        if tracing_owned:
            tracemalloc.start()
        initial_memory, _ = tracemalloc.get_traced_memory()
        started = time.perf_counter()
        for index in range(100):
            state = service.state(ORIGIN)
            assert not active
            detail = service.detail(ORIGIN, trade_id)
            assert detail["trade"]["amounts"]["netPnl"] == "100" and not active
            reviewed = service.action(
                ORIGIN,
                state["revision"],
                uuid4().hex,
                "review-trade",
                {
                    "tradeId": trade_id,
                    "review": {
                        "technicalNotes": f"Audit review {index}",
                        "reviewStatus": "reviewed",
                    },
                },
            )
            assert not active
            exported = service.export(ORIGIN, 1, book, "csv" if index % 2 else "json")
            assert exported["base64"] and not active
            if index % 10 == 0:
                preview = service.preview_import(
                    ORIGIN,
                    1,
                    book,
                    "fixture-csv",
                    statement(),
                    mapping(),
                    reviewed["workspace"]["revision"],
                )
                assert preview["preview"]["counts"]["unchanged"] == 1 and not active
                repeated = service.commit_import(
                    preview["id"], preview["expectedRevision"], uuid4().hex, False
                )
                assert repeated["result"]["changedEvents"] == 0 and not active
        elapsed = time.perf_counter() - started
        # These are request-local responses, not application caches. Release
        # the final responses before measuring what the service retained.
        del state, detail, reviewed, exported, preview, repeated
        gc.collect()
        final_memory, peak_memory = tracemalloc.get_traced_memory()
        final_handles = handle_count()
        assert not active
        assert opened_count == closed_count and opened_count >= 500
        if initial_handles is not None:
            assert final_handles <= initial_handles + 1
        assert final_memory - initial_memory < 4 * 1024 * 1024
        audit = {
            "iterations": 100,
            "repeatImports": 10,
            "dbConnectionsOpened": opened_count,
            "dbConnectionsClosed": closed_count,
            "initialHandles": initial_handles,
            "finalHandles": final_handles,
            "retainedPythonBytes": final_memory - initial_memory,
            "peakTracedPythonBytes": peak_memory,
            "elapsedSeconds": round(elapsed, 6),
        }
        record_property("journal_resource_audit", json.dumps(audit))
        print("JOURNAL_RESOURCE_AUDIT " + json.dumps(audit))
    finally:
        if tracing_owned:
            tracemalloc.stop()
        event.remove(storage.engine, "connect", opened)
        event.remove(storage.engine, "close", closed)


def test_real_journal_workers_reap_children_remove_payloads_and_release_slots(
    storage, tmp_path, monkeypatch, record_property
):
    _, trade_id, book = seed(storage)
    database_url = str(storage.engine.url)
    original_temporary = tempfile.TemporaryDirectory
    original_launch = subprocess.Popen
    directories = []
    children = []
    waited_pids = []

    def temporary(**kwargs):
        folder = original_temporary(dir=tmp_path, **kwargs)
        directories.append(Path(folder.name))
        return folder

    def launch(*args, **kwargs):
        assert kwargs["stdin"] is subprocess.DEVNULL
        assert kwargs["stdout"] is subprocess.DEVNULL
        assert kwargs["stderr"] is subprocess.DEVNULL
        child = original_launch(*args, **kwargs)
        original_wait = child.wait
        pid = child.pid

        def wait(*args, **kwargs):
            result = original_wait(*args, **kwargs)
            waited_pids.append(pid)
            return result

        child.wait = wait
        children.append(child)
        return child

    monkeypatch.setattr(worker.tempfile, "TemporaryDirectory", temporary)
    monkeypatch.setattr(worker.subprocess, "Popen", launch)

    def run(action, **arguments):
        try:
            return worker.run_workspace_action(database_url, UID, action, arguments)
        finally:
            assert all(not folder.exists() for folder in directories)
            assert all(child.poll() is not None for child in children)

    # Warm process-launch machinery, then discard the test's own process handle.
    run("journal_state", origin=ORIGIN)
    children.clear()
    waited_pids.clear()
    directories.clear()
    gc.collect()
    initial_handles = handle_count()
    started = time.perf_counter()
    for _ in range(8):
        state = run("journal_state", origin=ORIGIN)
        detail = run("journal_detail", origin=ORIGIN, trade_id=trade_id)
        assert detail["trade"]["amounts"]["netPnl"] == "100"
    preview = run(
        "journal_import_preview",
        origin=ORIGIN,
        portfolio_id=1,
        book_id=book,
        provider="fixture-csv",
        csv_text=statement(),
        mapping=mapping(),
        expected_revision=state["revision"],
    )
    resumed = run("journal_import_get", id=preview["id"], origin=ORIGIN)
    assert resumed["status"] == "preview"
    refreshed = run(
        "journal_import_repreview", id=preview["id"], expected_revision=state["revision"]
    )
    request_id = uuid4().hex
    committed = run(
        "journal_import_commit",
        id=refreshed["id"],
        expected_revision=refreshed["expectedRevision"],
        request_id=request_id,
        accept_corrections=False,
    )
    replayed = run(
        "journal_import_commit",
        id=refreshed["id"],
        expected_revision=refreshed["expectedRevision"],
        request_id=request_id,
        accept_corrections=False,
    )
    assert replayed["result"] == committed["result"]
    with pytest.raises(WorkspaceError, match="job_not_found") as missing:
        run("journal_import_get", id=preview["id"], origin="another_origin")
    assert missing.value.status == 404
    for format in ("json", "csv"):
        assert run("journal_export", origin=ORIGIN, portfolio_id=1, book_id=book, format=format)[
            "base64"
        ]
    process_count = len(children)
    assert process_count == 24 and len(waited_pids) == process_count
    assert all(child.returncode == 0 for child in children)
    assert worker._SLOTS.acquire(blocking=False)
    assert worker._SLOTS.acquire(blocking=False)
    try:
        assert not worker._SLOTS.acquire(blocking=False)
    finally:
        worker._SLOTS.release()
        worker._SLOTS.release()
    children.clear()
    gc.collect()
    final_handles = handle_count()
    if initial_handles is not None:
        assert final_handles <= initial_handles + 1
    audit = {
        "processes": process_count,
        "reapedProcesses": len(waited_pids),
        "cleanedTemporaryDirectories": len(directories),
        "initialHandles": initial_handles,
        "finalHandles": final_handles,
        "elapsedSeconds": round(time.perf_counter() - started, 6),
    }
    record_property("journal_worker_resource_audit", json.dumps(audit))
    print("JOURNAL_WORKER_RESOURCE_AUDIT " + json.dumps(audit))
