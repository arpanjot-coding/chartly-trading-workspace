"""Download state/atomic publication conformance on real scoped SQLite.

The fetcher and candle publisher are deliberate stubs. These prove orchestration
and ownership, not any external provider's data permission or response format.
"""

import gc
import json
import tracemalloc
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import psutil
import pytest
from sqlalchemy import event, insert, select, update

from database.data_library_db import library_states, records
from services.dataset_downloads import (
    DatasetDownloads,
    DownloadFetchError,
    complete_download_chunk,
    retry_after_seconds,
    validate_download_guard,
)
from services.workspace_storage import WorkspaceError, WorkspaceStorage, dumps

CSV = "timestamp,open,high,low,close,volume\n1793491200,10,12,9,11,5\n"
CONTEXT = {
    "provider": "Fixture-Provider",
    "sourceId": "source_fixture",
    "symbol": "EXAMPLE",
    "exchange": "FIXTURE",
    "interval": "1m",
    "priceBasis": "raw",
    "adjustment": "none",
    "volumeMeaning": "units",
    "allowNegativePrices": False,
}
MAPPING = {
    "version": 1,
    "columns": {key: key for key in ("timestamp", "open", "high", "low", "close", "volume")},
    "timezone": "UTC",
    "timestampFormat": "seconds",
    "timestampMeaning": "open",
}


class Clock:
    def __init__(self):
        self.value = datetime(2026, 11, 3, 12, tzinfo=UTC)

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += timedelta(seconds=seconds)


class Library:
    """Real metadata transactions with a stub canonical candle publisher."""

    def __init__(self, url, uid="principal_download_owner"):
        self.storage = WorkspaceStorage(url, uid)
        self.storage.setup()
        self.before_publish = None
        self.after_publish = None
        self.before_preview = None

    def _revision(self, connection):
        return (
            connection.execute(
                select(library_states.c.revision).where(library_states.c.uid == self.storage.uid)
            ).scalar_one_or_none()
            or 0
        )

    def _bump(self, connection):
        revision = self._revision(connection) + 1
        if revision == 1:
            connection.execute(
                insert(library_states).values(uid=self.storage.uid, revision=revision)
            )
        else:
            connection.execute(
                update(library_states)
                .where(library_states.c.uid == self.storage.uid)
                .values(revision=revision)
            )
        return revision

    def _record(self, connection, kind, id):
        value = connection.execute(
            select(records.c.payload).where(
                records.c.uid == self.storage.uid, records.c.kind == kind, records.c.id == id
            )
        ).scalar_one_or_none()
        if value is None:
            raise WorkspaceError("dataset.record_not_found", 404)
        return json.loads(value)

    def _put_record(self, connection, kind, id, payload, version_id=None):
        where = (records.c.uid == self.storage.uid, records.c.kind == kind, records.c.id == id)
        if connection.execute(select(records.c.id).where(*where)).first():
            connection.execute(
                update(records).where(*where).values(payload=dumps(payload), version_id=version_id)
            )
        else:
            connection.execute(
                insert(records).values(
                    uid=self.storage.uid,
                    kind=kind,
                    id=id,
                    payload=dumps(payload),
                    version_id=version_id,
                )
            )

    def revision(self):
        with self.storage.engine.connect() as connection:
            return self._revision(connection)

    def preview_import(self, expected_revision, csv_text, mapping, context, base_version_id=None):
        if self.before_preview:
            self.before_preview()
        if "INVALID" in csv_text:
            raise WorkspaceError("dataset.invalid_rows")
        with self.storage.transaction() as connection:
            assert expected_revision == self._revision(connection)
            identity = "preview_" + uuid4().hex
            self._put_record(connection, "import", identity, {"id": identity, "csvText": csv_text})
            return {"id": identity, "expectedRevision": expected_revision}

    def commit_import(
        self,
        id,
        expected_revision,
        request_id,
        policy="keep",
        allow_rejected_rows=False,
        download_guard=None,
    ):
        if self.before_publish:
            self.before_publish()
        body = {"id": id, "expectedRevision": expected_revision}
        with self.storage.transaction() as connection:
            replay = self.storage._receipt(connection, request_id, "dataset-publish-fixture", body)
            if replay is not None:
                return replay
            if expected_revision != self._revision(connection):
                raise WorkspaceError("storage.revision_conflict", 409)
            validate_download_guard(self, connection, download_guard)
            preview = self._record(connection, "import", id)
            version = {"id": "version_" + uuid4().hex, "csvText": preview["csvText"]}
            self._put_record(connection, "publication", version["id"], version)
            complete_download_chunk(self, connection, download_guard, {"version": version})
            self._bump(connection)
            result = {"version": version}
            self.storage._save_receipt(
                connection, request_id, "dataset-publish-fixture", body, result
            )
        if self.after_publish:
            self.after_publish()
        return result

    def publications(self):
        with self.storage.engine.connect() as connection:
            return list(
                connection.execute(
                    select(records.c.payload).where(
                        records.c.uid == self.storage.uid, records.c.kind == "publication"
                    )
                ).scalars()
            )


@pytest.fixture
def library(tmp_path):
    item = Library("sqlite:///" + (tmp_path / "downloads.db").as_posix())
    yield item
    item.storage.engine.dispose()


@pytest.fixture
def clock():
    return Clock()


def create(engine, **changes):
    return engine.create(
        engine.library.revision(),
        uuid4().hex,
        deepcopy(CONTEXT),
        deepcopy(MAPPING),
        "2026-11-01T00:00:00Z",
        "2026-11-02T00:00:00Z",
        **changes,
    )


def step(engine, id, **changes):
    return engine.step(
        id,
        changes.get("revision", engine.library.revision()),
        changes.get("request_id", uuid4().hex),
    )


def control(engine, id, command):
    return engine.control(id, engine.library.revision(), uuid4().hex, command)


def test_create_repeat_scope_and_frozen_credential_free_context(library, clock):
    engine = DatasetDownloads(library, lambda _: {"csvText": CSV}, clock)
    context = deepcopy(CONTEXT)
    request_id = uuid4().hex
    first = engine.create(
        0, request_id, context, MAPPING, "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"
    )
    second = engine.create(
        0, request_id, CONTEXT, MAPPING, "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"
    )
    assert first == second
    context["symbol"] = "OTHER"
    assert second["job"]["context"]["symbol"] == "EXAMPLE"
    assert second["job"]["context"]["provider"] == "fixture-provider"
    assert len(engine.list()["jobs"]) == 1
    assert "principalUid" not in first["job"] and "lease" not in first["job"]


@pytest.mark.parametrize(
    "context",
    [
        {**CONTEXT, "apiKey": "never-store"},
        {**CONTEXT, "nested": {"authorization": "never-store"}},
        {**CONTEXT, "nested": {"client_secret": "never-store"}},
        {**CONTEXT, "cookie": "never-store"},
        {**CONTEXT, "url": "http://example.test"},
        {**CONTEXT, "callback": {"script": "never-run"}},
    ],
)
def test_metadata_rejects_credentials_urls_or_executable_payloads(library, clock, context):
    engine = DatasetDownloads(library, clock=clock)
    with pytest.raises(WorkspaceError, match="credentials_forbidden"):
        engine.create(
            0, uuid4().hex, context, MAPPING, "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"
        )
    assert engine.list()["jobs"] == []


@pytest.mark.parametrize(
    "start,end,chunk",
    [
        ("2026-11-01T00:00:00", "2026-11-02T00:00:00Z", 86400),
        ("2026-11-03T00:00:00Z", "2026-11-02T00:00:00Z", 86400),
        ("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z", True),
        ("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z", 1),
        ("2024-01-01T00:00:00Z", "2026-11-02T00:00:00Z", 86400),
        ("2026-11-01T00:00:00.0001Z", "2026-11-02T00:00:00Z", 86400),
    ],
)
def test_invalid_or_unbounded_ranges_never_create_a_job(library, clock, start, end, chunk):
    with pytest.raises(WorkspaceError):
        DatasetDownloads(library, clock=clock).create(
            0, uuid4().hex, CONTEXT, MAPPING, start, end, chunk
        )
    assert library.revision() == 0


def test_two_chunks_commit_once_each_and_share_persisted_quota(library, clock):
    calls = []

    def fetch(request):
        calls.append(request)
        return {"csvText": CSV}

    engine = DatasetDownloads(library, fetch, clock)
    job = engine.create(
        0, uuid4().hex, CONTEXT, MAPPING, "2026-11-01T00:00:00Z", "2026-11-03T00:00:00Z"
    )["job"]
    first_request = uuid4().hex
    first_revision = library.revision()
    first = step(engine, job["id"], request_id=first_request)
    assert first["job"]["cursor"] == 1 and first["job"]["status"] == "queued"
    assert len(library.publications()) == 1
    assert (
        calls[0]["startAt"] == "2026-11-01T00:00:00Z"
        and calls[0]["endAt"] == "2026-11-02T00:00:00Z"
    )
    assert calls[0]["principalUid"] == library.storage.uid
    repeated = step(engine, job["id"], revision=first_revision, request_id=first_request)
    assert repeated == first and len(calls) == 1
    waiting = step(engine, job["id"])
    assert waiting["waiting"] and waiting["job"]["status"] == "retry-wait"
    assert len(calls) == 1
    clock.advance(1)
    finished = step(DatasetDownloads(library, fetch, clock), job["id"])
    assert finished["job"]["status"] == "completed" and finished["job"]["cursor"] == 2
    assert len(calls) == len(library.publications()) == 2
    assert calls[-1]["startAt"] == calls[0]["endAt"]
    assert all("versionId" in item for item in finished["job"]["completedChunks"])


def test_foreign_principal_cannot_read_step_or_control_job(library, clock):
    owner = DatasetDownloads(library, lambda _: {"csvText": CSV}, clock)
    job = create(owner)["job"]
    other_library = Library(str(library.storage.engine.url), "principal_download_other")
    other = DatasetDownloads(
        other_library, lambda _: pytest.fail("Foreign request fetched data"), clock
    )
    try:
        assert other.list()["jobs"] == []
        for action in (
            lambda: other.detail(job["id"]),
            lambda: step(other, job["id"]),
            lambda: control(other, job["id"], "cancel"),
        ):
            with pytest.raises(WorkspaceError) as caught:
                action()
            assert caught.value.status == 404
    finally:
        other_library.storage.engine.dispose()
    assert owner.detail(job["id"])["job"]["status"] == "queued"


@pytest.mark.parametrize("command", ["pause", "cancel"])
def test_control_during_fetch_prevents_late_publication(library, clock, command):
    engine = None

    def fetch(request):
        control(engine, request["jobId"], command)
        return {"csvText": CSV}

    engine = DatasetDownloads(library, fetch, clock)
    job = create(engine)["job"]
    result = step(engine, job["id"])
    assert result["job"]["status"] == {"pause": "paused", "cancel": "cancelled"}[command]
    assert result["job"]["cursor"] == 0 and library.publications() == []
    if command == "pause":
        control(engine, job["id"], "resume")
        clock.advance(1)
        engine.fetcher = lambda _: {"csvText": CSV}
        assert step(engine, job["id"])["job"]["status"] == "completed"


def test_cancel_between_quality_preview_and_publication_retains_chunk_without_version(
    library, clock
):
    engine = DatasetDownloads(library, lambda _: {"csvText": CSV}, clock)
    job = create(engine)["job"]
    library.before_publish = lambda: control(engine, job["id"], "cancel")
    result = step(engine, job["id"])
    assert result["job"]["status"] == "cancelled" and result["job"]["hasRetainedChunk"]
    assert library.publications() == []


def test_expired_lease_cannot_publish_and_restart_reuses_private_chunk(library, clock):
    calls = []
    engine = DatasetDownloads(
        library, lambda request: calls.append(request) or {"csvText": CSV}, clock
    )
    job = create(engine)["job"]
    library.before_publish = lambda: clock.advance(91)
    expired = step(engine, job["id"])
    assert expired["job"]["status"] == "running" and expired["job"]["hasRetainedChunk"]
    assert library.publications() == []
    library.before_publish = None
    finished = step(
        DatasetDownloads(library, lambda _: pytest.fail("Retained chunk fetched twice"), clock),
        job["id"],
    )
    assert finished["job"]["status"] == "completed" and len(calls) == 1
    assert len(library.publications()) == 1


def test_stale_publication_retains_csv_for_next_step_without_refetch(library, clock):
    calls = []
    engine = DatasetDownloads(
        library, lambda request: calls.append(request) or {"csvText": CSV}, clock
    )
    job = create(engine)["job"]

    def change_revision():
        with library.storage.transaction() as connection:
            library._bump(connection)

    library.before_publish = change_revision
    stale = step(engine, job["id"])
    assert stale["job"]["status"] == "queued" and stale["job"]["hasRetainedChunk"]
    assert "csvText" not in json.dumps(stale) and "leaseToken" not in json.dumps(stale)
    library.before_publish = None
    assert step(engine, job["id"])["job"]["status"] == "completed"
    assert len(calls) == len(library.publications()) == 1


def test_lost_publication_acknowledgement_does_not_duplicate_chunk(library, clock):
    engine = DatasetDownloads(library, lambda _: {"csvText": CSV}, clock)
    job = create(engine)["job"]
    request_id = uuid4().hex
    revision = library.revision()
    library.after_publish = lambda: (_ for _ in ()).throw(OSError("simulated response loss"))
    response = step(engine, job["id"], request_id=request_id)
    assert response["job"]["status"] == "completed"
    assert len(library.publications()) == 1
    replay = step(engine, job["id"], revision=revision, request_id=request_id)
    assert replay["job"]["status"] == "completed" and len(library.publications()) == 1


def test_rate_limit_deadline_persists_across_instances_and_other_jobs(library, clock):
    calls = []

    def fetch(request):
        calls.append(request)
        raise DownloadFetchError("provider.rate_limited", 429, 30)

    engine = DatasetDownloads(library, fetch, clock)
    first = create(engine)["job"]
    second = create(engine)["job"]
    limited = step(engine, first["id"])
    assert limited["job"]["status"] == "retry-wait"
    assert limited["job"]["nextAttemptAt"] == "2026-11-03T12:00:30Z"
    restarted = DatasetDownloads(library, fetch, clock)
    assert step(restarted, second["id"])["waiting"] and len(calls) == 1
    clock.advance(29)
    assert step(restarted, first["id"])["waiting"] and len(calls) == 1
    clock.advance(1)
    assert step(restarted, first["id"])["job"]["attempt"] == 2 and len(calls) == 2


def test_retry_attempts_are_finite_and_explicit_retry_is_reversible(library, clock):
    engine = DatasetDownloads(
        library, lambda _: (_ for _ in ()).throw(DownloadFetchError("provider.busy", 503)), clock
    )
    job = create(engine)["job"]
    for attempt in range(1, 6):
        result = step(engine, job["id"])
        assert result["job"]["attempt"] == attempt
        assert result["job"]["status"] == ("failed" if attempt == 5 else "retry-wait")
        clock.advance(300)
    control(engine, job["id"], "retry")
    engine.fetcher = lambda _: {"csvText": CSV}
    assert step(engine, job["id"])["job"]["status"] == "completed"


def test_no_adapter_fails_without_network_or_fake_candles(library, clock):
    engine = DatasetDownloads(library, clock=clock)
    job = create(engine)["job"]
    result = step(engine, job["id"])
    assert (
        result["job"]["status"] == "failed"
        and result["job"]["error"]["code"] == "dataset.provider_unavailable"
    )
    assert library.publications() == []


def test_successful_empty_chunk_records_no_fake_version_or_coverage(library, clock):
    engine = DatasetDownloads(library, lambda _: {"csvText": "", "empty": True}, clock)
    job = create(engine)["job"]
    result = step(engine, job["id"])
    assert result["job"]["status"] == "completed"
    assert result["job"]["completedChunks"][0]["empty"] is True
    assert "versionId" not in result["job"]["completedChunks"][0]
    assert library.publications() == []


def test_quality_rejection_never_partially_publishes(library, clock):
    engine = DatasetDownloads(library, lambda _: {"csvText": "INVALID"}, clock)
    job = create(engine)["job"]
    result = step(engine, job["id"])
    assert result["job"]["status"] == "failed" and result["job"]["cursor"] == 0
    assert result["job"]["hasRetainedChunk"] and library.publications() == []


def test_reused_request_with_different_job_or_payload_is_rejected(library, clock):
    engine = DatasetDownloads(library, lambda _: {"csvText": CSV}, clock)
    first = create(engine)["job"]
    second = create(engine)["job"]
    request_id = uuid4().hex
    revision = library.revision()
    step(engine, first["id"], request_id=request_id)
    with pytest.raises(WorkspaceError, match="reused_with_different_input"):
        step(engine, second["id"], revision=revision, request_id=request_id)


def test_retry_after_parses_http_dates_and_bounds_nonfinite_inputs(clock):
    assert retry_after_seconds("Tue, 03 Nov 2026 12:00:20 GMT", clock()) == 20
    assert retry_after_seconds("1.2", clock()) == 2
    assert retry_after_seconds("9999999", clock()) == 86400
    assert retry_after_seconds("-5", clock()) == 0
    for value in (None, True, float("nan"), float("inf"), "invalid"):
        assert retry_after_seconds(value, clock()) is None


def test_old_step_receipt_returns_fresh_job_without_rewinding_progress(library, clock):
    engine = DatasetDownloads(library, lambda _: {"csvText": CSV}, clock)
    job = engine.create(
        0, uuid4().hex, CONTEXT, MAPPING, "2026-11-01T00:00:00Z", "2026-11-03T00:00:00Z"
    )["job"]
    request_id = uuid4().hex
    revision = library.revision()
    assert step(engine, job["id"], request_id=request_id)["job"]["cursor"] == 1
    clock.advance(1)
    assert step(engine, job["id"])["job"]["status"] == "completed"
    replay = step(engine, job["id"], request_id=request_id, revision=revision)
    assert replay["job"]["status"] == "completed" and replay["job"]["cursor"] == 2
    assert len(library.publications()) == 2


def test_explicit_retry_after_bad_provider_data_can_fetch_repaired_chunk(library, clock):
    engine = DatasetDownloads(library, lambda _: {"csvText": "INVALID"}, clock)
    job = create(engine)["job"]
    assert step(engine, job["id"])["job"]["status"] == "failed"
    control(engine, job["id"], "retry")
    clock.advance(1)
    engine.fetcher = lambda _: {"csvText": CSV}
    assert step(engine, job["id"])["job"]["status"] == "completed"
    assert len(library.publications()) == 1


def test_transient_publication_retries_remain_finite_without_fetching_again(library, clock):
    calls = []
    engine = DatasetDownloads(
        library, lambda request: calls.append(request) or {"csvText": CSV}, clock
    )
    job = create(engine)["job"]
    library.before_publish = lambda: (_ for _ in ()).throw(
        WorkspaceError("storage.unavailable", 503)
    )
    for attempt in range(1, 6):
        result = step(engine, job["id"])
        assert result["job"]["attempt"] == attempt
        assert result["job"]["status"] == ("failed" if attempt == 5 else "retry-wait")
        clock.advance(300)
    assert len(calls) == 1 and library.publications() == []


def test_real_library_publication_and_checkpoint_commit_together(tmp_path, clock):
    from services.data_library import DataLibrary

    storage = WorkspaceStorage(
        "sqlite:///" + (tmp_path / "real-download.db").as_posix(), "principal_real_download"
    )
    library = DataLibrary(storage)
    engine = DatasetDownloads(library, lambda _: {"csvText": CSV}, clock)
    try:
        job = engine.create(
            0, uuid4().hex, CONTEXT, MAPPING, "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"
        )["job"]
        result = engine.step(job["id"], library.catalog()["revision"], uuid4().hex)
        assert result["job"]["status"] == "completed", result
        version_id = result["job"]["completedChunks"][0]["versionId"]
        assert len(library.catalog()["versions"]) == 1
        assert library.bars(version_id)["bars"][0]["close"] == "11"
    finally:
        storage.engine.dispose()


def test_real_library_rejects_provider_candles_outside_requested_chunk(tmp_path, clock):
    from services.data_library import DataLibrary

    storage = WorkspaceStorage(
        "sqlite:///" + (tmp_path / "real-window.db").as_posix(), "principal_real_window"
    )
    library = DataLibrary(storage)
    engine = DatasetDownloads(
        library, lambda _: {"csvText": CSV.replace("1793491200", "1793664000")}, clock
    )
    try:
        job = engine.create(
            0, uuid4().hex, CONTEXT, MAPPING, "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"
        )["job"]
        result = engine.step(job["id"], library.catalog()["revision"], uuid4().hex)
        assert result["job"]["status"] == "failed", result
        assert result["job"]["error"]["code"] == "dataset.provider_outside_chunk"
        assert library.catalog()["versions"] == []
    finally:
        storage.engine.dispose()


def test_hundred_finite_jobs_close_connections_and_do_not_keep_in_memory_job_registry(
    library, clock
):
    engine = DatasetDownloads(library, lambda _: {"csvText": CSV}, clock)
    initial = create(engine)["job"]
    step(engine, initial["id"])
    opened = closed = 0

    def connected(*_args):
        nonlocal opened
        opened += 1

    def disconnected(*_args):
        nonlocal closed
        closed += 1

    process = psutil.Process()
    handle_count = process.num_handles if hasattr(process, "num_handles") else process.num_fds
    event.listen(library.storage.engine, "connect", connected)
    event.listen(library.storage.engine, "close", disconnected)
    gc.collect()
    initial_handles = handle_count()
    tracemalloc.start()
    initial_memory, _ = tracemalloc.get_traced_memory()
    try:
        for _ in range(100):
            clock.advance(1)
            job = create(engine)["job"]
            assert step(engine, job["id"])["job"]["status"] == "completed"
        assert len(engine.list()["jobs"]) == 100
        gc.collect()
        final_memory, peak_memory = tracemalloc.get_traced_memory()
        final_handles = handle_count()
    finally:
        tracemalloc.stop()
        event.remove(library.storage.engine, "connect", connected)
        event.remove(library.storage.engine, "close", disconnected)
    assert opened == closed
    assert final_handles <= initial_handles + 4
    assert final_memory - initial_memory < 2_000_000
    print(
        "DATASET_DOWNLOAD_RESOURCE_AUDIT",
        json.dumps(
            {
                "iterations": 100,
                "opened": opened,
                "closed": closed,
                "initialHandles": initial_handles,
                "finalHandles": final_handles,
                "retainedPythonBytes": final_memory - initial_memory,
                "peakTracedBytes": peak_memory,
            }
        ),
    )
