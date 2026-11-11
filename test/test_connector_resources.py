"""Measured repeated connector SQL/vault/history operations, not real broker calls."""

import gc
import json
import time
import tracemalloc
from uuid import uuid4

import psutil
import pytest
from sqlalchemy import event

from services.connectors import Connectors

pytest_plugins = ["test_journal_service"]
ORIGIN = "journal_origin_01"


@pytest.mark.timeout(180)
def test_repeated_reads_mutations_and_history_release_scoped_resources(storage):
    registry = Connectors(storage)
    record = registry.action(
        ORIGIN,
        None,
        0,
        uuid4().hex,
        "create",
        {"providerId": "diagnostic", "label": "Resource fixture", "configuration": {}},
    )["connection"]
    record = registry.action(ORIGIN, record["id"], record["revision"], uuid4().hex, "probe", {})[
        "connection"
    ]
    record = registry.action(
        ORIGIN,
        record["id"],
        record["revision"],
        uuid4().hex,
        "link",
        {"profileId": 1, "createObservedAccount": True, "confirmIdentity": True},
    )["connection"]
    counts = {"opened": 0, "closed": 0}

    def opened(*args):
        counts["opened"] += 1

    def closed(*args):
        counts["closed"] += 1

    event.listen(storage.engine, "connect", opened)
    event.listen(storage.engine, "close", closed)
    process = psutil.Process()
    descriptor_count = process.num_handles if hasattr(process, "num_handles") else process.num_fds
    initial_handles, initial_rss = descriptor_count(), process.memory_info().rss
    gc.collect()
    tracemalloc.start()
    start = time.monotonic()
    try:
        for _ in range(100):
            record = registry.action(
                ORIGIN,
                record["id"],
                record["revision"],
                uuid4().hex,
                "sync",
                {"window": {"from": "2026-11-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"}},
            )["connection"]
            assert registry.history(ORIGIN, record["id"], 0, 1)["history"]["total"] == 2
            assert (
                registry.detail(ORIGIN, record["id"])["connection"]["revision"]
                == record["revision"]
            )
        gc.collect()
        retained, peak = tracemalloc.get_traced_memory()
        final_handles, final_rss = descriptor_count(), process.memory_info().rss
        measurement = {
            "mutations": 100,
            "historyReads": 100,
            "detailReads": 100,
            **counts,
            "initialHandles": initial_handles,
            "finalHandles": final_handles,
            "initialRss": initial_rss,
            "finalRss": final_rss,
            "retainedPythonBytes": retained,
            "peakPythonBytes": peak,
            "elapsedSeconds": round(time.monotonic() - start, 3),
        }
        print("P07_CONNECTOR_RESOURCE_AUDIT " + json.dumps(measurement))
        assert counts["opened"] == counts["closed"] and final_handles - initial_handles <= 8
        assert retained < 4 * 1024 * 1024
    finally:
        tracemalloc.stop()
        event.remove(storage.engine, "connect", opened)
        event.remove(storage.engine, "close", closed)
