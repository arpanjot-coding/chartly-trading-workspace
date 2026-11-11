"""P21-T02 durable jobs: idempotent submit, lifecycle, restart, partial."""

import pytest

from services.experiment_jobs import ExperimentJobStore
from services.strategy_experiments import run_experiment
from services.strategy_rules import compile_plan
from services.workspace_storage import WorkspaceError, WorkspaceStorage
from test_strategy_experiments import CANDLES, DOC, _manifest

pytest_plugins = ["test_journal_service"]
ORIGIN = "journal_origin_01"
PLAN = compile_plan(DOC)


def _store(storage):
    return ExperimentJobStore(storage)


def _submit(store, request_id="req-00000001"):
    return store.submit(ORIGIN, request_id=request_id, manifest=_manifest(), plan=PLAN)


def test_submit_run_complete_matches_direct_simulator(storage):
    store = _store(storage)
    job = _submit(store)
    assert job["trial"]["status"] == "queued"
    done = store.run_next(ORIGIN, lambda manifest: CANDLES)
    assert done["trial"]["status"] == "completed"
    assert done["report"]["checksum"] == run_experiment(PLAN, CANDLES, _manifest())["checksum"]
    # Durable across a reopened storage handle.
    reopened = ExperimentJobStore(WorkspaceStorage(storage.engine, storage.uid))
    assert reopened.get(ORIGIN, job["id"])["report"] == done["report"]
    assert store.run_next(ORIGIN, lambda manifest: CANDLES) is None


def test_duplicate_submission_is_idempotent(storage):
    store = _store(storage)
    first = _submit(store)
    again = _submit(store)
    assert again["id"] == first["id"]
    assert len(store.list(ORIGIN)) == 1


def test_cancel_queued_and_terminal_states_reject_cancel(storage):
    store = _store(storage)
    job = _submit(store)
    assert store.cancel(ORIGIN, job["id"])["trial"]["status"] == "cancelled"
    with pytest.raises(WorkspaceError):
        store.cancel(ORIGIN, job["id"])
    assert store.run_next(ORIGIN, lambda manifest: CANDLES) is None


def test_restart_recovery_requeues_running_without_checkpoint_claim(storage):
    store = _store(storage)
    job = _submit(store)
    store._set_status(ORIGIN, job["id"], "running")
    recovered = store.recover(ORIGIN)
    assert [row["trial"]["status"] for row in recovered] == ["queued"]
    done = store.run_next(ORIGIN, lambda manifest: CANDLES)
    assert done["trial"]["status"] == "completed"


def test_truncated_data_is_partial_never_completed(storage):
    store = _store(storage)
    _submit(store)
    done = store.run_next(ORIGIN, lambda manifest: CANDLES[:5])
    assert done["trial"]["status"] == "partial"
    assert done["report"]["partialData"] is True


def test_loader_failure_is_recorded_not_hidden(storage):
    store = _store(storage)
    _submit(store)

    def explode(_manifest):
        raise RuntimeError("dataset offline")

    done = store.run_next(ORIGIN, explode)
    assert done["trial"]["status"] == "failed"
    assert "run_failed" in done["trial"]["failureCode"]
    assert done["report"] is None


def test_invalid_manifest_fails_with_quality_codes(storage):
    store = _store(storage)
    store.submit(
        ORIGIN,
        request_id="req-invalid1",
        manifest=_manifest(
            warmupStart="2025-01-01T00:00:00Z",
            rangeStart="2025-01-01T04:00:00Z",
            rangeEnd="2025-01-02T00:00:00Z",
        ),
        plan=PLAN,
    )
    done = store.run_next(ORIGIN, lambda manifest: CANDLES)
    assert done["trial"]["status"] == "failed"
    assert "coverage" in done["trial"]["failureCode"] or "warmup" in done["trial"]["failureCode"]


def test_cross_owner_isolation(storage):
    store = _store(storage)
    job = _submit(store)
    foreign = ExperimentJobStore(WorkspaceStorage(storage.engine, "principal_foreign_owner"))
    assert foreign.list(ORIGIN) == []
    with pytest.raises(WorkspaceError):
        foreign.get(ORIGIN, job["id"])
