"""Finite principal-scoped history jobs; one cooperative UTC chunk per step.

No broker credentials or request-supplied code are stored. The application binds
the fetcher to its verified principal. Canonical publication/checkpoint hooks run
inside the library import transaction so cancellation cannot be followed by a
late version publication.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from uuid import uuid4

from sqlalchemy import func, select, update

from database.data_library_db import records
from database.workspace_storage_db import receipts
from services.workspace_storage import WorkspaceError, dumps, valid_origin

MAX_CHUNKS = 512
MAX_SOURCE_BYTES = 4 * 1024 * 1024
LEASE_SECONDS = 90
MAX_ATTEMPTS = 5
QUOTA_SECONDS = 1
TERMINAL = frozenset(("completed", "cancelled", "failed"))
SECRET_KEYS = frozenset(
    (
        "apikey",
        "brokerapikey",
        "apisecret",
        "password",
        "passwordhash",
        "secret",
        "clientsecret",
        "privatekey",
        "totpsecret",
        "credentials",
        "authorization",
        "auth",
        "accountauthtag",
        "cookie",
        "sessioncookie",
        "headers",
        "accesstoken",
        "refreshtoken",
        "authtoken",
        "token",
        "url",
        "endpoint",
        "code",
        "script",
    )
)


def _CLOCK():
    return datetime.now(UTC)


class DownloadFetchError(Exception):
    """A safe adapter result; messages are codes, never raw provider responses."""

    def __init__(self, code="dataset.provider_failed", status=503, retry_after_seconds=None):
        self.code = (
            code
            if isinstance(code, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", code)
            else "dataset.provider_failed"
        )
        self.status = status if type(status) is int and 400 <= status <= 599 else 503
        self.retry_after_seconds = retry_after_seconds
        super().__init__(self.code)


def _iso(value):
    return value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _instant(value):
    if (
        not isinstance(value, str)
        or len(value) > 40
        or not re.search(r"(?:Z|[+-]\d\d:\d\d)$", value)
    ):
        raise WorkspaceError("dataset.invalid_download_time")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise WorkspaceError("dataset.invalid_download_time") from error
    fraction = re.search(r"[.,](\d+)", value)
    if parsed.tzinfo is None or fraction and fraction[1].strip("0"):
        raise WorkspaceError("dataset.download_time_requires_seconds")
    return parsed.astimezone(UTC)


def retry_after_seconds(value, now=None):
    """Parse bounded Retry-After seconds or an RFC HTTP date, without sleeping."""
    if isinstance(value, bool):
        return None
    try:
        seconds = float(value)
    except (TypeError, ValueError, OverflowError):
        try:
            parsed = parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                return None
            seconds = (parsed.astimezone(UTC) - (now or _CLOCK())).total_seconds()
        except (TypeError, ValueError, OverflowError, AttributeError):
            return None
    return min(86400, max(0, math.ceil(seconds))) if math.isfinite(seconds) else None


def _metadata(value):
    if not isinstance(value, dict):
        raise WorkspaceError("dataset.invalid_download_metadata")
    try:
        encoded = dumps(value).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, RecursionError) as error:
        raise WorkspaceError("dataset.invalid_download_metadata") from error
    if len(encoded) > 65536:
        raise WorkspaceError("dataset.download_metadata_too_large", 413)
    pending = [(value, 0)]
    nodes = 0
    while pending:
        item, depth = pending.pop()
        nodes += 1
        if depth > 12 or nodes > 10000:
            raise WorkspaceError("dataset.download_metadata_too_large", 413)
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str) or re.sub(r"[^a-z]", "", key.lower()) in SECRET_KEYS:
                    raise WorkspaceError("dataset.download_credentials_forbidden")
                pending.append((child, depth + 1))
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)
    return deepcopy(value)


def _optional(library, connection, kind, identity):
    try:
        return library._record(connection, kind, identity)
    except WorkspaceError as error:
        if error.code == "dataset.record_not_found" and error.status == 404:
            return None
        raise


def _job(library, connection, identity):
    if not valid_origin(identity):
        raise WorkspaceError("dataset.invalid_download_id")
    result = library._record(connection, "download", identity)
    if result.get("principalUid") != library.storage.uid:
        raise WorkspaceError("dataset.download_not_found", 404)
    return result


def _public(job):
    value = deepcopy(job)
    value.pop("principalUid", None)
    value.pop("pendingChunk", None)
    value.pop("lease", None)
    value["hasRetainedChunk"] = job.get("pendingChunk") is not None
    if job.get("lease"):
        value["leaseExpiresAt"] = job["lease"]["expiresAt"]
    return value


def _response(library, connection, job, **extra):
    return {"job": _public(job), "revision": library._revision(connection), **extra}


def _guard_matches(library, connection, guard):
    if not isinstance(guard, dict) or set(guard) != {
        "jobId",
        "leaseToken",
        "generation",
        "chunkIndex",
    }:
        raise WorkspaceError("dataset.invalid_download_guard")
    job = _job(library, connection, guard["jobId"])
    lease = job.get("lease") or {}
    if (
        job.get("status") != "running"
        or job.get("generation") != guard["generation"]
        or job.get("cursor") != guard["chunkIndex"]
        or lease.get("token") != guard["leaseToken"]
    ):
        raise WorkspaceError("dataset.download_publication_superseded", 409)
    return job


def validate_download_guard(library, connection, guard):
    """Trusted import hook, called in the canonical publication transaction."""
    job = _guard_matches(library, connection, guard)
    lease = job["lease"]
    # Tests and internal callers can bind a deterministic clock to the library.
    now = getattr(library, "_download_clock", _CLOCK)()
    if _instant(lease["expiresAt"]) <= now:
        raise WorkspaceError("dataset.download_lease_expired", 409)
    if not job.get("pendingChunk") or job["pendingChunk"].get("index") != guard["chunkIndex"]:
        raise WorkspaceError("dataset.download_chunk_missing", 409)
    return job


def complete_download_chunk(library, connection, guard, result):
    """Trusted import hook; checkpoint and immutable version commit together."""
    job = validate_download_guard(library, connection, guard)
    version = result.get("version", {})
    version_id = version.get("id") if isinstance(version, dict) else None
    if not isinstance(version_id, str) or not version_id:
        raise WorkspaceError("dataset.download_version_missing")
    now = getattr(library, "_download_clock", _CLOCK)()
    _advance(library, connection, job, now, version_id=version_id)


def _advance(library, connection, job, now, *, version_id=None, empty=False):
    pending = job["pendingChunk"]
    checkpoint = {
        "index": job["cursor"],
        "startAt": pending["startAt"],
        "endAt": pending["endAt"],
        "completedAt": _iso(now),
        "empty": empty,
    }
    if version_id:
        checkpoint["versionId"] = version_id
    if pending.get("sourceHash"):
        checkpoint["sourceHash"] = pending["sourceHash"]
    job["completedChunks"].append(checkpoint)
    job["cursor"] += 1
    job.update(
        status="completed" if job["cursor"] == job["chunkCount"] else "queued",
        pendingChunk=None,
        lease=None,
        nextAttemptAt=None,
        attempt=0,
        error=None,
        updatedAt=_iso(now),
    )
    library._put_record(connection, "download", job["id"], job)


class DatasetDownloads:
    def __init__(self, library, fetcher=None, clock=None):
        self.library = library
        self.storage = library.storage
        self.fetcher = fetcher
        self.clock = clock or _CLOCK
        # An instance binding, not a process-wide registry; publication hooks use
        # the same clock as the service that owns the lease.
        self.library._download_clock = self.clock

    def _now(self):
        value = self.clock()
        if not isinstance(value, datetime) or value.tzinfo is None:
            raise ValueError("Download clock must return an aware datetime")
        return value.astimezone(UTC).replace(microsecond=0)

    def _cas(self, connection, revision):
        if type(revision) is not int or revision != self.library._revision(connection):
            raise WorkspaceError("storage.revision_conflict", 409)

    def _save(self, connection, job):
        self.library._bump(connection)
        self.library._put_record(connection, "download", job["id"], job)

    def _replay(self, connection, response):
        # The receipt fixes the request's outcome; the job projection is fresh
        # so replaying an earlier successful chunk cannot visually rewind it.
        return _response(
            self.library, connection, _job(self.library, connection, response["job"]["id"])
        )

    def _finish_receipt(self, connection, request_id, body, result):
        existing = self.storage._receipt(connection, request_id, "dataset-download-step", body)
        if existing is None:
            self.storage._save_receipt(
                connection, request_id, "dataset-download-step", body, result
            )
        elif existing.get("pending"):
            connection.execute(
                update(receipts)
                .where(
                    receipts.c.uid == self.storage.uid,
                    receipts.c.request_id == request_id,
                    receipts.c.operation == "dataset-download-step",
                )
                .values(response=dumps(result))
            )
        else:
            return self._replay(connection, existing)
        return result

    def detail(self, id):
        with self.storage.engine.connect() as connection:
            return _response(self.library, connection, _job(self.library, connection, id))

    def list(self):
        with self.storage.engine.connect() as connection:
            values = connection.execute(
                select(records.c.payload)
                .where(records.c.uid == self.storage.uid, records.c.kind == "download")
                .order_by(func.json_extract(records.c.payload, "$.createdAt").desc(), records.c.id)
                .limit(100)
            ).scalars()
            jobs = []
            for value in values:
                job = json.loads(value)
                if job.get("principalUid") == self.storage.uid:
                    jobs.append(_public(job))
            return {"jobs": jobs, "revision": self.library._revision(connection)}

    def create(
        self, expected_revision, request_id, context, mapping, start_at, end_at, chunk_seconds=86400
    ):
        context, mapping = _metadata(context), _metadata(mapping)
        if callable(getattr(self.library, "_context", None)):
            from services.dataset_quality import validate_mapping

            context = self.library._context(context)
            mapping = self.library._quality_call(validate_mapping, mapping)
        provider = context.get("provider")
        if not isinstance(provider, str) or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}", provider
        ):
            raise WorkspaceError("dataset.invalid_download_provider")
        context["provider"] = provider.lower()
        start, end = _instant(start_at), _instant(end_at)
        if (
            type(chunk_seconds) is not int
            or not 60 <= chunk_seconds <= 31 * 86400
            or not start < end
            or end - start > timedelta(days=366)
        ):
            raise WorkspaceError("dataset.invalid_download_range")
        chunks = math.ceil((end - start).total_seconds() / chunk_seconds)
        if chunks > MAX_CHUNKS:
            raise WorkspaceError("dataset.download_chunk_budget", 413)
        body = {
            "expectedRevision": expected_revision,
            "context": context,
            "mapping": mapping,
            "startAt": _iso(start),
            "endAt": _iso(end),
            "chunkSeconds": chunk_seconds,
        }
        with self.storage.transaction() as connection:
            replay = self.storage._receipt(connection, request_id, "dataset-download-create", body)
            if replay is not None:
                return self._replay(connection, replay)
            self._cas(connection, expected_revision)
            now = _iso(self._now())
            job = {
                "id": "download_" + uuid4().hex,
                "principalUid": self.storage.uid,
                **{
                    key: body[key]
                    for key in ("context", "mapping", "startAt", "endAt", "chunkSeconds")
                },
                "chunkCount": chunks,
                "cursor": 0,
                "completedChunks": [],
                "status": "queued",
                "generation": 0,
                "lease": None,
                "pendingChunk": None,
                "nextAttemptAt": None,
                "attempt": 0,
                "error": None,
                "createdAt": now,
                "updatedAt": now,
            }
            self._save(connection, job)
            result = _response(self.library, connection, job)
            self.storage._save_receipt(
                connection, request_id, "dataset-download-create", body, result
            )
            return result

    def control(self, id, expected_revision, request_id, command):
        if command not in ("pause", "resume", "cancel", "retry"):
            raise WorkspaceError("dataset.invalid_download_control")
        body = {"id": id, "expectedRevision": expected_revision, "command": command}
        with self.storage.transaction() as connection:
            replay = self.storage._receipt(connection, request_id, "dataset-download-control", body)
            if replay is not None:
                return self._replay(connection, replay)
            self._cas(connection, expected_revision)
            job = _job(self.library, connection, id)
            status = job["status"]
            if status == "completed" or status == "cancelled" and command != "cancel":
                raise WorkspaceError("dataset.download_terminal", 409)
            if (
                command == "pause"
                and status not in ("queued", "running", "retry-wait", "paused")
                or command == "resume"
                and status != "paused"
                or command == "retry"
                and status != "failed"
            ):
                raise WorkspaceError("dataset.download_invalid_transition", 409)
            job["generation"] += 1
            job["lease"] = None
            job["status"] = (
                "paused" if command == "pause" else "cancelled" if command == "cancel" else "queued"
            )
            job["updatedAt"] = _iso(self._now())
            if command == "retry":
                job.update(attempt=0, nextAttemptAt=None, error=None, pendingChunk=None)
            self._save(connection, job)
            result = _response(self.library, connection, job)
            self.storage._save_receipt(
                connection, request_id, "dataset-download-control", body, result
            )
            return result

    def _claim(self, id, expected_revision, request_id, body):
        with self.storage.transaction() as connection:
            replay = self.storage._receipt(connection, request_id, "dataset-download-step", body)
            if replay is not None and not replay.get("pending"):
                return None, self._replay(connection, replay)
            job = _job(self.library, connection, id)
            now = self._now()
            if replay is None:
                self._cas(connection, expected_revision)
            elif job["cursor"] > replay["chunkIndex"] or job["status"] in TERMINAL | {"paused"}:
                return None, self._finish_receipt(
                    connection, request_id, body, _response(self.library, connection, job)
                )
            if job["status"] in TERMINAL | {"paused"}:
                raise WorkspaceError("dataset.download_not_runnable", 409)
            lease = job.get("lease") or {}
            if (
                job["status"] == "running"
                and lease.get("expiresAt")
                and _instant(lease["expiresAt"]) > now
            ):
                if replay is not None:
                    return None, _response(
                        self.library, connection, job, pending=True, chunkIndex=job["cursor"]
                    )
                raise WorkspaceError("dataset.download_busy", 409)
            if job.get("nextAttemptAt") and _instant(job["nextAttemptAt"]) > now:
                result = _response(self.library, connection, job, waiting=True)
                return None, self._finish_receipt(connection, request_id, body, result)
            needs_fetch = job.get("pendingChunk") is None
            if needs_fetch:
                quota_id = (
                    "quota_" + hashlib.sha256(job["context"]["provider"].encode()).hexdigest()[:40]
                )
                quota = _optional(self.library, connection, "download-quota", quota_id)
                if quota and _instant(quota["nextAllowedAt"]) > now:
                    job.update(
                        status="retry-wait",
                        nextAttemptAt=quota["nextAllowedAt"],
                        updatedAt=_iso(now),
                        lease=None,
                    )
                    self._save(connection, job)
                    result = _response(self.library, connection, job, waiting=True)
                    return None, self._finish_receipt(connection, request_id, body, result)
                self.library._put_record(
                    connection,
                    "download-quota",
                    quota_id,
                    {
                        "id": quota_id,
                        "provider": job["context"]["provider"],
                        "nextAllowedAt": _iso(now + timedelta(seconds=QUOTA_SECONDS)),
                    },
                )
            job["attempt"] += 1
            job["generation"] += 1
            job.update(
                status="running",
                lease={
                    "token": uuid4().hex,
                    "requestId": request_id,
                    "expiresAt": _iso(now + timedelta(seconds=LEASE_SECONDS)),
                },
                nextAttemptAt=None,
                error=None,
                updatedAt=_iso(now),
            )
            self._save(connection, job)
            placeholder = _response(
                self.library, connection, job, pending=True, chunkIndex=job["cursor"]
            )
            if replay is None:
                self.storage._save_receipt(
                    connection, request_id, "dataset-download-step", body, placeholder
                )
            return deepcopy(job), None

    def _guard(self, job):
        return {
            "jobId": job["id"],
            "leaseToken": job["lease"]["token"],
            "generation": job["generation"],
            "chunkIndex": job["cursor"],
        }

    def _finish(self, id, request_id, body):
        with self.storage.transaction() as connection:
            return self._finish_receipt(
                connection,
                request_id,
                body,
                _response(self.library, connection, _job(self.library, connection, id)),
            )

    def _failure(self, job, error, request_id, body):
        with self.storage.transaction() as connection:
            try:
                current = _guard_matches(self.library, connection, self._guard(job))
            except WorkspaceError:
                return self._finish_receipt(
                    connection,
                    request_id,
                    body,
                    _response(self.library, connection, _job(self.library, connection, job["id"])),
                )
            now = self._now()
            retryable = error.status == 429 or error.status >= 500
            delay = retry_after_seconds(error.retry_after_seconds, now)
            if delay is None:
                delay = min(300, 2 ** max(0, current["attempt"] - 1))
            delay = max(1, delay)
            current.update(
                status="retry-wait"
                if retryable and current["attempt"] < MAX_ATTEMPTS
                else "failed",
                lease=None,
                nextAttemptAt=_iso(now + timedelta(seconds=delay))
                if retryable and current["attempt"] < MAX_ATTEMPTS
                else None,
                error={"code": error.code, "status": error.status},
                updatedAt=_iso(now),
            )
            if error.status == 429:
                quota_id = (
                    "quota_"
                    + hashlib.sha256(current["context"]["provider"].encode()).hexdigest()[:40]
                )
                quota = _optional(self.library, connection, "download-quota", quota_id)
                next_allowed = max(
                    now + timedelta(seconds=delay),
                    _instant(quota["nextAllowedAt"]) if quota else now,
                )
                self.library._put_record(
                    connection,
                    "download-quota",
                    quota_id,
                    {
                        "id": quota_id,
                        "provider": current["context"]["provider"],
                        "nextAllowedAt": _iso(next_allowed),
                    },
                )
            self._save(connection, current)
            return self._finish_receipt(
                connection, request_id, body, _response(self.library, connection, current)
            )

    def step(self, id, expected_revision, request_id):
        body = {"id": id, "expectedRevision": expected_revision}
        job, replay = self._claim(id, expected_revision, request_id, body)
        if replay is not None:
            return replay
        try:
            pending = job.get("pendingChunk")
            if pending is None:
                start = _instant(job["startAt"]) + timedelta(
                    seconds=job["chunkSeconds"] * job["cursor"]
                )
                end = min(_instant(job["endAt"]), start + timedelta(seconds=job["chunkSeconds"]))
                if self.fetcher is None:
                    raise DownloadFetchError("dataset.provider_unavailable", 409)
                fetched = self.fetcher(
                    {
                        "jobId": id,
                        "principalUid": self.storage.uid,
                        "context": deepcopy(job["context"]),
                        "mapping": deepcopy(job["mapping"]),
                        "startAt": _iso(start),
                        "endAt": _iso(end),
                        "attempt": job["attempt"],
                    }
                )
                if (
                    not isinstance(fetched, dict)
                    or not isinstance(fetched.get("csvText"), str)
                    or type(fetched.get("empty", False)) is not bool
                ):
                    raise DownloadFetchError("dataset.invalid_provider_response", 502)
                try:
                    source = fetched["csvText"].encode("utf-8")
                except UnicodeError as error:
                    raise DownloadFetchError("dataset.invalid_provider_response", 502) from error
                if len(source) > MAX_SOURCE_BYTES:
                    raise DownloadFetchError("dataset.provider_chunk_too_large", 413)
                pending = {
                    "index": job["cursor"],
                    "startAt": _iso(start),
                    "endAt": _iso(end),
                    "csvText": fetched["csvText"],
                    "sourceHash": hashlib.sha256(source).hexdigest(),
                    "empty": fetched.get("empty", False),
                }
                with self.storage.transaction() as connection:
                    current = _guard_matches(self.library, connection, self._guard(job))
                    if _instant(current["lease"]["expiresAt"]) <= self._now():
                        raise WorkspaceError("dataset.download_lease_expired", 409)
                    current.update(pendingChunk=pending, updatedAt=_iso(self._now()))
                    self._save(connection, current)
                    job = deepcopy(current)
            if pending.get("empty"):
                with self.storage.transaction() as connection:
                    current = validate_download_guard(self.library, connection, self._guard(job))
                    _advance(self.library, connection, current, self._now(), empty=True)
                    self.library._bump(connection)
                return self._finish(id, request_id, body)
            with self.storage.engine.connect() as connection:
                revision = self.library._revision(connection)
            preview = self.library.preview_import(
                revision, pending["csvText"], job["mapping"], job["context"]
            )
            coverage = preview.get("preview", {}).get("coverage", {})
            first, last = coverage.get("rangeStart"), coverage.get("rangeEnd")
            if first and last:
                first = datetime.fromisoformat(first.replace("Z", "+00:00")).astimezone(UTC)
                last = datetime.fromisoformat(last.replace("Z", "+00:00")).astimezone(UTC)
                if first < _instant(pending["startAt"]) or last >= _instant(pending["endAt"]):
                    raise DownloadFetchError("dataset.provider_outside_chunk", 409)
            commit_request = (
                "download-chunk_"
                + hashlib.sha256(f"{id}|{job['cursor']}".encode()).hexdigest()[:40]
            )
            self.library.commit_import(
                preview["id"],
                preview["expectedRevision"],
                commit_request,
                policy="keep",
                allow_rejected_rows=False,
                download_guard=self._guard(job),
            )
            return self._finish(id, request_id, body)
        except DownloadFetchError as error:
            return self._failure(job, error, request_id, body)
        except WorkspaceError as error:
            if error.code in (
                "dataset.download_publication_superseded",
                "dataset.download_lease_expired",
            ):
                return self._finish(id, request_id, body)
            if error.code in ("storage.revision_conflict", "dataset.revision_conflict"):
                with self.storage.transaction() as connection:
                    try:
                        current = _guard_matches(self.library, connection, self._guard(job))
                    except WorkspaceError:
                        return self._finish_receipt(
                            connection,
                            request_id,
                            body,
                            _response(self.library, connection, _job(self.library, connection, id)),
                        )
                    current.update(
                        status="queued",
                        lease=None,
                        updatedAt=_iso(self._now()),
                        error={"code": error.code, "status": 409},
                    )
                    self._save(connection, current)
                return self._finish(id, request_id, body)
            return self._failure(
                job, DownloadFetchError(error.code, error.status), request_id, body
            )
        except Exception:
            return self._failure(
                job, DownloadFetchError("dataset.provider_failed", 503), request_id, body
            )
