"""Durable research ingestion jobs (P13-T03).

Bounded, idempotent company ingestions over the EDGAR adapter.
Partial results (truncated fact sets) are stored as partial, failures
keep their codes, and restart recovery requeues `running` jobs —
re-ingestion is checksum/idempotent so reruns never duplicate facts.
"""

from __future__ import annotations

import json
from copy import deepcopy
from uuid import uuid4

from sqlalchemy import func, insert, select, update

from database.research_db import research_ingestion_jobs
from services.edgar_adapter import ingest_company
from services.research_domain import ResearchError
from services.workspace_storage import WorkspaceError, dumps, now, opaque, valid_origin

MAX_ACTIVE = 10
MAX_JOBS = 1000


def _error(code, status=400):
    raise WorkspaceError("ingestion." + code, status)


class ResearchIngestionJobs:
    def __init__(self, storage, research_store):
        self.storage = storage
        self.research_store = research_store

    def _load(self, connection, origin, job_id):
        row = connection.execute(
            select(research_ingestion_jobs.c.payload).where(
                self.storage.scope(research_ingestion_jobs, origin),
                research_ingestion_jobs.c.id == job_id,
            )
        ).first()
        return json.loads(row[0]) if row else None

    def _list(self, connection, origin):
        return [
            json.loads(row[0])
            for row in connection.execute(
                select(research_ingestion_jobs.c.payload)
                .where(self.storage.scope(research_ingestion_jobs, origin))
                .order_by(research_ingestion_jobs.c.id)
            )
        ]

    def _save(self, connection, origin, bundle):
        raw = dumps(bundle)
        exists = connection.execute(
            select(func.count())
            .select_from(research_ingestion_jobs)
            .where(
                self.storage.scope(research_ingestion_jobs, origin),
                research_ingestion_jobs.c.id == bundle["id"],
            )
        ).scalar()
        if not exists:
            total = connection.execute(
                select(func.count())
                .select_from(research_ingestion_jobs)
                .where(self.storage.scope(research_ingestion_jobs, origin))
            ).scalar()
            if total >= MAX_JOBS:
                _error("job_budget", 413)
            connection.execute(
                insert(research_ingestion_jobs).values(
                    uid=self.storage.uid, origin=origin, id=bundle["id"], payload=raw
                )
            )
        else:
            connection.execute(
                update(research_ingestion_jobs)
                .where(
                    self.storage.scope(research_ingestion_jobs, origin),
                    research_ingestion_jobs.c.id == bundle["id"],
                )
                .values(payload=raw)
            )
        return bundle

    def _origin(self, origin):
        if not valid_origin(origin):
            _error("invalid_origin")
        return origin

    def _require(self, connection, origin, job_id):
        bundle = self._load(connection, origin, job_id)
        if bundle is None:
            _error("job_not_found", 404)
        return bundle

    def submit_company(self, origin, *, request_id, cik):
        self._origin(origin)
        if not isinstance(request_id, str) or not request_id:
            _error("request_id_required")
        at = now()
        with self.storage.transaction() as connection:
            jobs = self._list(connection, origin)
            for existing in jobs:
                if existing.get("requestId") == request_id:
                    return deepcopy(existing)
            if sum(1 for row in jobs if row["status"] in {"queued", "running"}) >= MAX_ACTIVE:
                _error("queue_full", 429)
            bundle = {
                "version": 1,
                "id": opaque("ingestionjob", uuid4().hex),
                "requestId": request_id,
                "kind": "edgar-company",
                "cik": str(cik),
                "status": "queued",
                "stats": None,
                "failureCode": None,
                "revision": 1,
                "createdAt": at,
                "updatedAt": at,
            }
            return deepcopy(self._save(connection, origin, bundle))

    def get(self, origin, job_id):
        self._origin(origin)
        with self.storage.transaction() as connection:
            return deepcopy(self._require(connection, origin, job_id))

    def list(self, origin):
        self._origin(origin)
        with self.storage.transaction() as connection:
            return self._list(connection, origin)

    def _set(self, origin, job_id, status, *, stats=None, failure_code=None):
        with self.storage.transaction() as connection:
            bundle = self._require(connection, origin, job_id)
            bundle["status"] = status
            if stats is not None:
                bundle["stats"] = stats
            bundle["failureCode"] = failure_code
            bundle["revision"] += 1
            bundle["updatedAt"] = now()
            return deepcopy(self._save(connection, origin, bundle))

    def cancel(self, origin, job_id):
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._require(connection, origin, job_id)
            if bundle["status"] != "queued":
                _error("cancel_unavailable", 409)
        return self._set(origin, job_id, "cancelled")

    def recover(self, origin):
        self._origin(origin)
        return [
            self._set(origin, row["id"], "queued")
            for row in self.list(origin)
            if row["status"] == "running"
        ]

    def run_next(self, origin, client, *, owner_id, workspace_id, at=None):
        self._origin(origin)
        queued = [row for row in self.list(origin) if row["status"] == "queued"]
        if not queued:
            return None
        job = sorted(queued, key=lambda row: (row["createdAt"], row["id"]))[0]
        self._set(origin, job["id"], "running")
        stamp = at or now()
        try:
            stats = ingest_company(
                self.research_store,
                client,
                origin,
                job["cik"],
                owner_id=owner_id,
                workspace_id=workspace_id,
                at=stamp,
                retrieved_at=stamp,
            )
            status = "partial" if stats.get("truncated") else "completed"
            return self._set(origin, job["id"], status, stats=stats)
        except (ResearchError, WorkspaceError) as error:
            return self._set(origin, job["id"], "failed", failure_code=error.code)
        except Exception as error:  # unexpected adapter failure stays visible
            return self._set(
                origin, job["id"], "failed", failure_code=f"ingestion.run_failed:{type(error).__name__}"
            )
