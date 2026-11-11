"""Measured cleanup on real private SQLite and DuckDB data, without providers."""

import gc
import json
import time
import tracemalloc
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import duckdb
import psutil
import pytest
from sqlalchemy import event
from test_data_library import commit, context, mapping, preview
from test_workspace_worker import handle_count

from services.dataset_downloads import DatasetDownloads, DownloadFetchError
from services.workspace_storage import WorkspaceError

pytest_plugins = ["test_data_library"]


@pytest.mark.timeout(120)
def test_100_dataset_queries_exports_cancel_and_failure_release_connections_handles_memory(
    library, monkeypatch, record_property
):
    version = commit(library, preview(library))["version"]
    sql_active = set()
    duck_active = set()
    sql_opened = sql_closed = duck_opened = duck_closed = 0

    def opened(connection, _record):
        nonlocal sql_opened
        sql_opened += 1
        assert id(connection) not in sql_active
        sql_active.add(id(connection))

    def closed(connection, _record):
        nonlocal sql_closed
        sql_closed += 1
        sql_active.remove(id(connection))

    real_connect = duckdb.connect

    class OwnedConnection:
        def __init__(self, inner):
            self.inner = inner
            self.closed = False

        def __getattr__(self, name):
            return getattr(self.inner, name)

        def close(self):
            nonlocal duck_closed
            assert not self.closed
            self.inner.close()
            self.closed = True
            duck_closed += 1
            duck_active.remove(id(self))

    def connected(*args, **kwargs):
        nonlocal duck_opened
        inner = real_connect(*args, **kwargs)
        name = str(args[0] if args else kwargs.get("database", ""))
        if not name or not Path(name).resolve().is_relative_to(library.root.resolve()):
            return inner
        result = OwnedConnection(inner)
        duck_active.add(id(result))
        duck_opened += 1
        return result

    def assert_idle():
        assert not sql_active and not duck_active
        assert not list(library.root.glob("stage-*"))

    now = datetime(2026, 11, 3, 10, tzinfo=UTC)
    calls = []

    def unavailable(_request):
        calls.append("fetch")
        raise DownloadFetchError("fixture.provider_unavailable", 503)

    downloads = DatasetDownloads(library, fetcher=unavailable, clock=lambda: now)
    event.listen(library.engine, "connect", opened)
    event.listen(library.engine, "close", closed)
    monkeypatch.setattr(duckdb, "connect", connected)
    tracing_owned = not tracemalloc.is_tracing()
    try:
        library.catalog()
        library.detail(version["id"])
        library.bars(version["id"])
        library.export(version["id"], "csv")
        library.export(version["id"], "bundle")
        assert_idle()
        gc.collect()
        if tracing_owned:
            tracemalloc.start()
        initial_memory, _ = tracemalloc.get_traced_memory()
        initial_handles = handle_count()
        initial_rss = psutil.Process().memory_info().rss
        started = time.perf_counter()
        for index in range(100):
            assert library.catalog()["versions"][0]["id"] == version["id"]
            assert library.detail(version["id"])["checksum"] == version["checksum"]
            assert library.bars(version["id"])["bars"][0]["close"] == "101.123456789012345678901234"
            assert library.export(version["id"], "csv" if index % 2 else "bundle")["base64"]
            with pytest.raises(WorkspaceError):
                library.bars("version_unknown_fixture")
            if index % 10 == 0:
                job = downloads.create(
                    library.catalog()["revision"],
                    uuid4().hex,
                    context(),
                    mapping(),
                    "2026-11-02T09:00:00Z",
                    "2026-11-02T09:01:00Z",
                    60,
                )["job"]
                result = downloads.control(
                    job["id"], library.catalog()["revision"], uuid4().hex, "cancel"
                )
                assert result["job"]["status"] == "cancelled"
                with pytest.raises(WorkspaceError):
                    downloads.step(job["id"], library.catalog()["revision"], uuid4().hex)
            if index == 50:
                job = downloads.create(
                    library.catalog()["revision"],
                    uuid4().hex,
                    context(provider="fixture-resource-failure"),
                    mapping(),
                    "2026-11-02T09:00:00Z",
                    "2026-11-02T09:01:00Z",
                    60,
                )["job"]
                result = downloads.step(job["id"], library.catalog()["revision"], uuid4().hex)
                assert result["job"]["status"] == "retry-wait"
                assert result["job"]["error"]["code"] == "fixture.provider_unavailable"
                downloads.control(job["id"], library.catalog()["revision"], uuid4().hex, "cancel")
                # Exercise a DuckDB exception after a connection/file was opened.
                with pytest.raises(ValueError):
                    library._write_file({"id": "version_resourcefailure"}, [{"time": "not-a-time"}])
                assert not (library.root / "version_resourcefailure.duckdb").exists()
            assert_idle()
        gc.collect()
        retained_memory, peak_memory = tracemalloc.get_traced_memory()
        final_handles = handle_count()
        final_rss = psutil.Process().memory_info().rss
        report = {
            "iterations": 100,
            "sqliteOpened": sql_opened,
            "sqliteClosed": sql_closed,
            "duckdbOpened": duck_opened,
            "duckdbClosed": duck_closed,
            "initialHandles": initial_handles,
            "finalHandles": final_handles,
            "retainedPythonBytes": retained_memory - initial_memory,
            "peakTracedPythonBytes": peak_memory,
            "initialRss": initial_rss,
            "finalRss": final_rss,
            "elapsedSeconds": time.perf_counter() - started,
            "cancelledJobs": 11,
            "providerFailureCalls": len(calls),
        }
        print("DATASET_RESOURCE_AUDIT " + json.dumps(report, sort_keys=True))
        for name, value in report.items():
            record_property(name, value)
        assert sql_opened == sql_closed and duck_opened == duck_closed and duck_opened >= 200
        assert retained_memory - initial_memory < 4 * 1024 * 1024
        assert final_rss - initial_rss < 96 * 1024 * 1024
        if initial_handles is not None and final_handles is not None:
            assert final_handles <= initial_handles + 8
        assert calls == ["fetch"]
        assert_idle()
    finally:
        event.remove(library.engine, "connect", opened)
        event.remove(library.engine, "close", closed)
        if tracing_owned and tracemalloc.is_tracing():
            tracemalloc.stop()
