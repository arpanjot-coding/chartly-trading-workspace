"""Worker cleanup, bounded concurrency, and repeatable workspace resource audit."""

import ctypes
import gc
import json
import os
import subprocess
import tempfile
import threading
import time
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import event

import services.workspace_worker as worker
from database.workspace_storage_db import TABLES
from services.workspace_storage import WorkspaceError, WorkspaceStorage, validate_snapshot

UID = "principal_worker_fixture"


def source():
    tables = {name: [] for name in TABLES}
    tables["portfolios"] = [
        {"id": 1, "name": "Resource fixture", "kind": "live", "currency": "USD"}
    ]
    return {
        "format": "chartly-browser-snapshot",
        "version": 1,
        "originId": "worker_fixture_origin",
        "createdAt": "2026-11-02T10:00:00Z",
        "tables": tables,
        "nativeCatalogs": {
            "openalgo-chart-workspaces": {
                "fixture": {
                    "version": 1,
                    "revision": 0,
                    "workspaces": [],
                    "templates": [],
                    "recentWorkspaceIds": [],
                    "activeWorkspaceId": None,
                    "autosave": True,
                }
            }
        },
        "preferences": {},
        "attachments": {},
        "datasetManifests": [],
    }


@pytest.fixture
def storage(tmp_path):
    store = WorkspaceStorage("sqlite:///" + (tmp_path / "worker.sqlite").as_posix(), UID)
    job = store.preview_migration(source())
    store.commit_migration(job["id"], {}, uuid4().hex)
    yield store
    store.engine.dispose()


@pytest.fixture
def worker_sandbox(monkeypatch, tmp_path):
    original = tempfile.TemporaryDirectory
    directories = []

    def isolated(**kwargs):
        result = original(dir=tmp_path, **kwargs)
        directories.append(Path(result.name))
        return result

    monkeypatch.setattr(worker.tempfile, "TemporaryDirectory", isolated)
    monkeypatch.setattr(worker, "_SLOTS", threading.BoundedSemaphore(2))
    return directories


def assert_released_slots():
    assert worker._SLOTS.acquire(blocking=False)
    assert worker._SLOTS.acquire(blocking=False)
    assert not worker._SLOTS.acquire(blocking=False)
    worker._SLOTS.release()
    worker._SLOTS.release()


class FakeChild:
    def __init__(self, argv, *, mode="success", **kwargs):
        self.folder = Path(argv[-1])
        self.killed = False
        self.waited = False
        self.returncode = None if mode == "running" else 7 if mode == "crash" else 0
        if mode == "success":
            (self.folder / "result.json").write_text(
                json.dumps({"value": {"status": "completed"}}), encoding="utf-8"
            )
        elif mode == "error":
            (self.folder / "result.json").write_text(
                json.dumps(
                    {
                        "error": {
                            "code": "storage.revision_conflict",
                            "status": 409,
                            "issues": [{"field": "revision"}],
                        }
                    }
                ),
                encoding="utf-8",
            )
        elif mode == "malformed":
            (self.folder / "result.json").write_text("{", encoding="utf-8")

    def poll(self):
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -9

    def wait(self):
        self.waited = True
        return self.returncode


@pytest.mark.parametrize(
    "mode,code",
    [
        ("success", None),
        ("error", "storage.revision_conflict"),
        ("crash", "worker.interrupted_retry"),
        ("missing", "worker.interrupted_retry"),
    ],
)
def test_worker_reaps_children_cleans_temporary_payload_and_releases_slot(
    monkeypatch, worker_sandbox, mode, code
):
    children = []

    def launch(*args, **kwargs):
        assert kwargs["stdin"] is subprocess.DEVNULL
        assert kwargs["stdout"] is subprocess.DEVNULL
        assert kwargs["stderr"] is subprocess.DEVNULL
        if os.name == "nt":
            assert kwargs["creationflags"] & subprocess.CREATE_NO_WINDOW
        child = FakeChild(*args, mode=mode, **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(worker.subprocess, "Popen", launch)
    if code:
        with pytest.raises(WorkspaceError, match=code):
            worker.run_workspace_action(
                "sqlite:///unused", UID, "workspace", payload=b"private fixture bytes"
            )
    else:
        assert worker.run_workspace_action(
            "sqlite:///unused", UID, "workspace", payload=b"private fixture bytes"
        ) == {"status": "completed"}
    assert all(child.waited for child in children)
    assert all(not directory.exists() for directory in worker_sandbox)
    assert_released_slots()


def test_worker_timeout_kills_and_reaps_child_and_cleans_scope(monkeypatch, worker_sandbox):
    children = []

    def launch(*args, **kwargs):
        child = FakeChild(*args, mode="running", **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(worker.subprocess, "Popen", launch)
    clock = iter((0, 301))
    monkeypatch.setattr(
        worker, "time", SimpleNamespace(monotonic=lambda: next(clock), sleep=time.sleep)
    )
    with pytest.raises(WorkspaceError, match="worker.timeout_retry") as caught:
        worker.run_workspace_action("sqlite:///unused", UID, "backup")
    assert caught.value.status == 503
    assert children[0].killed and children[0].waited
    assert all(not directory.exists() for directory in worker_sandbox)
    assert_released_slots()


def test_worker_cancellation_still_kills_reaps_and_cleans(monkeypatch, worker_sandbox):
    class Cancelled(BaseException):
        pass

    child_holder = []

    def launch(*args, **kwargs):
        child = FakeChild(*args, mode="running", **kwargs)
        child_holder.append(child)
        return child

    def cancel(_seconds):
        raise Cancelled()

    monkeypatch.setattr(worker.subprocess, "Popen", launch)
    monkeypatch.setattr(worker, "time", SimpleNamespace(monotonic=time.monotonic, sleep=cancel))
    with pytest.raises(Cancelled):
        worker.run_workspace_action("sqlite:///unused", UID, "backup")
    assert child_holder[0].killed and child_holder[0].waited
    assert all(not directory.exists() for directory in worker_sandbox)
    assert_released_slots()


def test_worker_rejects_unsupported_action_and_full_slots_before_creating_files(
    monkeypatch, worker_sandbox
):
    def unexpected(*args, **kwargs):
        pytest.fail("Rejected request must not start a process")

    monkeypatch.setattr(worker.subprocess, "Popen", unexpected)
    with pytest.raises(WorkspaceError, match="worker.unsupported_action"):
        worker.run_workspace_action("unused", UID, "exec")
    assert worker._SLOTS.acquire(blocking=False)
    assert worker._SLOTS.acquire(blocking=False)
    try:
        with pytest.raises(WorkspaceError, match="worker.busy_retry") as caught:
            worker.run_workspace_action("unused", UID, "backup")
        assert caught.value.status == 503
    finally:
        worker._SLOTS.release()
        worker._SLOTS.release()
    assert worker_sandbox == []
    assert_released_slots()


@pytest.mark.parametrize("failure", ["launch", "malformed"])
def test_worker_transport_failures_are_structured_and_release_resources(
    monkeypatch, worker_sandbox, failure
):
    children = []

    def launch(*args, **kwargs):
        if failure == "launch":
            raise OSError("simulated process creation failure")
        child = FakeChild(*args, mode="malformed", **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(worker.subprocess, "Popen", launch)
    with pytest.raises(WorkspaceError) as caught:
        worker.run_workspace_action("sqlite:///unused", UID, "workspace")
    assert caught.value.status == 503
    assert caught.value.code.startswith("worker.")
    assert all(child.waited for child in children)
    assert all(not directory.exists() for directory in worker_sandbox)
    assert_released_slots()


def test_real_worker_roundtrip_binary_backup_and_failure_leave_no_temp_directory(
    storage, worker_sandbox
):
    database_url = str(storage.engine.url)
    read = worker.run_workspace_action(database_url, UID, "workspace")
    assert read["originId"] == "worker_fixture_origin"
    archive = worker.run_workspace_action(database_url, UID, "backup")
    assert archive.startswith(b"PK")
    with pytest.raises(WorkspaceError, match="workspace.setup_required"):
        worker.run_workspace_action(database_url, "principal_other_fixture", "workspace")
    assert all(not directory.exists() for directory in worker_sandbox)
    assert_released_slots()


def handle_count():
    if os.name == "nt":
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetCurrentProcess.restype = ctypes.c_void_p
        kernel.GetProcessHandleCount.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        value = ctypes.c_ulong()
        if not kernel.GetProcessHandleCount(kernel.GetCurrentProcess(), ctypes.byref(value)):
            raise ctypes.WinError(ctypes.get_last_error())
        return value.value
    descriptors = Path("/proc/self/fd")
    return len(list(descriptors.iterdir())) if descriptors.exists() else None


def test_100_workspace_native_roundtrips_close_every_db_connection_without_handle_growth(
    storage, record_property
):
    active = set()
    connected = 0
    closed = 0

    def opened(connection, _record):
        nonlocal connected
        connected += 1
        active.add(id(connection))

    def finished(connection, _record):
        nonlocal closed
        closed += 1
        active.remove(id(connection))

    event.listen(storage.engine, "connect", opened)
    event.listen(storage.engine, "close", finished)
    try:
        storage.workspace()
        storage.native("workspace", "fixture")
        gc.collect()
        initial = handle_count()
        started = time.perf_counter()
        for _ in range(100):
            saved = storage.workspace()
            native = storage.native("workspace", "fixture")
            catalog = deepcopy(native["catalog"])
            catalog["revision"] += 1
            storage.save_native("workspace", "fixture", catalog, native["revision"], uuid4().hex)
            assert saved["originId"] == "worker_fixture_origin"
            assert not active
        elapsed = time.perf_counter() - started
        gc.collect()
        final = handle_count()
        assert connected == closed == 302
        if initial is not None:
            assert final <= initial + 1
        audit = {
            "iterations": 100,
            "dbConnectionsOpened": connected,
            "dbConnectionsClosed": closed,
            "initialHandles": initial,
            "finalHandles": final,
            "elapsedSeconds": round(elapsed, 6),
        }
        record_property("workspace_resource_audit", json.dumps(audit))
        print("WORKSPACE_RESOURCE_AUDIT " + json.dumps(audit))
    finally:
        event.remove(storage.engine, "connect", opened)
        event.remove(storage.engine, "close", finished)


def test_large_json_and_native_cpu_work_is_measured_in_an_isolated_store(storage, record_property):
    # The table limit is deliberately exercised without installing these rows.
    large = source()
    large["tables"]["journalTrades"] = [
        {
            "id": index + 1,
            "portfolioId": 1,
            "origin": "manual",
            "pair": "EURUSD",
            "openDate": "2026-11-02",
            "closeDate": "2026-11-02",
            "lots": 0.1,
            "pnl": 1.25,
            "technicalNotes": "Resource measurement only",
        }
        for index in range(99_999)
    ]
    started = time.perf_counter()
    encoded = json.dumps(
        {
            "database_url": str(storage.engine.url),
            "uid": UID,
            "action": "migration_preview",
            "arguments": {"snapshot": large},
        }
    )
    serialization = time.perf_counter() - started
    started = time.perf_counter()
    validate_snapshot(large)
    validation = time.perf_counter() - started
    catalog = {
        "version": 1,
        "revision": 1,
        "lists": [
            {
                "id": "large-list",
                "name": "Synthetic audit list",
                "createdAt": 1,
                "updatedAt": 1,
                "entries": [
                    {"symbol": f"AUDIT{index}", "exchange": "FIXTURE"} for index in range(100_000)
                ],
            }
        ],
        "activeListId": "large-list",
    }
    native_bytes = len(json.dumps(catalog).encode())
    started = time.perf_counter()
    storage.save_native("watchlist", "fixture", catalog, 0, uuid4().hex)
    native_elapsed = time.perf_counter() - started
    audit = {
        "tableRecords": 100_000,
        "requestBytes": len(encoded.encode()),
        "parentJsonSeconds": round(serialization, 6),
        "snapshotValidationSeconds": round(validation, 6),
        "nativeEntries": 100_000,
        "nativeBytes": native_bytes,
        "nativeSaveSeconds": round(native_elapsed, 6),
    }
    record_property("workspace_cpu_audit", json.dumps(audit))
    print("WORKSPACE_CPU_AUDIT " + json.dumps(audit))
