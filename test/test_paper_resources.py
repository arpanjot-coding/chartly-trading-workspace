"""Measured bounded DB/DuckDB lifetimes across 100 actual paper mutations."""

import gc
import json
import time
import tracemalloc

import psutil
import pytest
from sqlalchemy import event
from test_paper_sessions import ORIGIN, act, bind_run, config

from services.paper_sessions import PaperSessions

pytest_plugins = ["test_journal_service"]


@pytest.mark.timeout(180)
def test_one_hundred_paper_mutations_and_reads_release_connections(storage):
    csv = "timestamp,open,high,low,close,volume\n" + "\n".join(
        f"2026-11-02T09:{i:02d}:00Z,{100 + i},{102 + i},{98 + i},{101 + i},10" for i in range(60)
    )
    bind_run(storage, text=csv)
    service = PaperSessions(storage)
    counts = {"opened": 0, "closed": 0}

    def opened(*_):
        counts["opened"] += 1

    def closed(*_):
        counts["closed"] += 1

    event.listen(storage.engine, "connect", opened)
    event.listen(storage.engine, "close", closed)
    process = psutil.Process()
    handles = process.num_handles() if hasattr(process, "num_handles") else process.num_fds()
    rss = process.memory_info().rss
    gc.collect()
    tracemalloc.start()
    baseline, _ = tracemalloc.get_traced_memory()
    started = time.perf_counter()
    try:
        act(service, "prepare", config())
        act(service, "start")
        for _ in range(24):
            act(service, "order", {"side": "buy", "orderType": "market", "quantity": "1"})
            filled = act(service, "advance", {"count": 1})["session"]
            position = next(item for item in filled["positions"] if item["status"] == "open")
            act(service, "close", {"positionId": position["id"], "quantity": "1"})
            act(service, "advance", {"count": 1})
        act(service, "pause")
        act(service, "start")
        for _ in range(100):
            service.session(ORIGIN, 1)
            service.ledger(ORIGIN, 1, limit=5)
        final = service.session(ORIGIN, 1)["session"]
        assert final["cash"] == "1024" and len(final["positions"]) == 24
        assert final["cursorIndex"] == 47
        assert counts["opened"] == counts["closed"]
        del filled, final, position
        gc.collect()
        retained, peak = tracemalloc.get_traced_memory()
        assert retained - baseline < 4 * 1024 * 1024
        after_handles = (
            process.num_handles() if hasattr(process, "num_handles") else process.num_fds()
        )
        assert after_handles <= handles + 8
        print(
            "P06_PAPER_RESOURCE_AUDIT",
            json.dumps(
                {
                    "mutations": 100,
                    "sessionReads": 100,
                    "ledgerReads": 100,
                    **counts,
                    "initialHandles": handles,
                    "finalHandles": after_handles,
                    "initialRss": rss,
                    "finalRss": process.memory_info().rss,
                    "retainedPythonBytes": retained - baseline,
                    "peakPythonBytes": peak,
                    "elapsedSeconds": round(time.perf_counter() - started, 3),
                }
            ),
        )
    finally:
        tracemalloc.stop()
        event.remove(storage.engine, "connect", opened)
        event.remove(storage.engine, "close", closed)
