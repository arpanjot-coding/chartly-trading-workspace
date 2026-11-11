"""Durable bounded experiment jobs (P21-T02).

One scoped bundle per submitted experiment: canonical Experiment +
Trial records, the full pinned manifest and compiled plan, lifecycle
status and — once run — the checksum-sealed report. Submission is
idempotent by client request id. The runner is synchronous and
cooperative: queued -> running -> completed | partial | failed |
cancelled. There is no mid-run checkpoint; after a restart, jobs found
in `running` are honestly requeued and rerun from their pinned inputs
(recover()). Partial data yields a partial result, never a full one.
Candles are supplied by an injected loader keyed to the manifest's
dataset pin, keeping this store independent of dataset internals.
"""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime
from uuid import uuid4

from sqlalchemy import LargeBinary, cast, func, insert, select, update

from database.experiments_db import experiments
from services.domain.validation import validate_record
from services.strategy_artifacts import ArtifactError
from services.strategy_experiments import build_experiment_record, run_experiment, validate_manifest
from services.workspace_storage import WorkspaceError, dumps, now, opaque, valid_origin

MAX_BUNDLE_BYTES = 8 * 1024 * 1024
MAX_ORIGIN_BYTES = 64 * 1024 * 1024
MAX_JOBS_PER_ORIGIN = 500
MAX_ACTIVE_JOBS = 20
MAX_STORED_CURVE_POINTS = 2000
ACTIVE_STATES = {"queued", "running"}


def _error(code, status=400):
    raise WorkspaceError("experiment." + code, status)


def _new_id(prefix):
    return opaque(prefix, uuid4().hex)


def _downsample(curve, maximum=MAX_STORED_CURVE_POINTS):
    if len(curve) <= maximum:
        return curve, False
    step = (len(curve) - 1) / (maximum - 1)
    return [curve[round(index * step)] for index in range(maximum)], True


def _coverage_for(candles, manifest):
    def parse(value):
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    times = [candle["time"] for candle in candles]
    warmup = sum(1 for at in times if manifest["warmupStart"] <= at < manifest["rangeStart"])
    partial = False
    if len(times) >= 2:
        interval = (parse(times[1]) - parse(times[0])).total_seconds()
        if interval > 0:
            expected_end = parse(times[-1]).timestamp() + interval
            partial = expected_end < parse(manifest["rangeEnd"]).timestamp()
    coverage = {
        "firstBarTime": times[0] if times else manifest["rangeEnd"],
        "lastBarTime": manifest["rangeEnd"],
        "warmupBarsAvailable": warmup,
        "totalBars": len(times),
    }
    return coverage, partial


class ExperimentJobStore:
    def __init__(self, storage):
        self.storage = storage

    # -- persistence --------------------------------------------------------
    def _load(self, connection, origin, job_id):
        row = connection.execute(
            select(experiments.c.payload).where(
                self.storage.scope(experiments, origin), experiments.c.id == job_id
            )
        ).first()
        return json.loads(row[0]) if row else None

    def _list(self, connection, origin):
        return [
            json.loads(row[0])
            for row in connection.execute(
                select(experiments.c.payload)
                .where(self.storage.scope(experiments, origin))
                .order_by(experiments.c.id)
            )
        ]

    def _save(self, connection, origin, bundle):
        if (
            validate_record("Experiment", bundle["experiment"])
            or validate_record("Trial", bundle["trial"])
        ):
            _error("invalid_canonical_record")
        raw = dumps(bundle)
        if len(raw.encode()) > MAX_BUNDLE_BYTES:
            _error("bundle_budget", 413)
        byte_length = func.length(cast(experiments.c.payload, LargeBinary))
        prior = connection.execute(
            select(byte_length).where(
                self.storage.scope(experiments, origin), experiments.c.id == bundle["id"]
            )
        ).scalar()
        total = connection.execute(
            select(func.coalesce(func.sum(byte_length), 0)).where(
                self.storage.scope(experiments, origin)
            )
        ).scalar()
        if total - (prior or 0) + len(raw.encode()) > MAX_ORIGIN_BYTES:
            _error("origin_budget", 413)
        if prior is None:
            count = connection.execute(
                select(func.count())
                .select_from(experiments)
                .where(self.storage.scope(experiments, origin))
            ).scalar()
            if count >= MAX_JOBS_PER_ORIGIN:
                _error("job_budget", 413)
            connection.execute(
                insert(experiments).values(
                    uid=self.storage.uid, origin=origin, id=bundle["id"], payload=raw
                )
            )
        else:
            connection.execute(
                update(experiments)
                .where(
                    self.storage.scope(experiments, origin),
                    experiments.c.id == bundle["id"],
                )
                .values(payload=raw)
            )
        return bundle

    def _require(self, connection, origin, job_id):
        bundle = self._load(connection, origin, job_id)
        if bundle is None:
            _error("job_not_found", 404)
        return bundle

    def _origin(self, origin):
        if not valid_origin(origin):
            _error("invalid_origin")
        return origin

    def _workspace_id(self, origin):
        return opaque("workspace", self.storage.uid + "|" + origin)

    # -- lifecycle ------------------------------------------------------------
    def submit(self, origin, *, request_id, manifest, plan):
        self._origin(origin)
        if not isinstance(request_id, str) or not request_id:
            _error("request_id_required")
        at = now()
        with self.storage.transaction() as connection:
            for existing in self._list(connection, origin):
                if existing.get("requestId") == request_id:
                    return deepcopy(existing)
            active = sum(
                1
                for row in self._list(connection, origin)
                if row["trial"]["status"] in ACTIVE_STATES
            )
            if active >= MAX_ACTIVE_JOBS:
                _error("queue_full", 429)
            experiment_id = _new_id("experiment")
            try:
                experiment = build_experiment_record(
                    experiment_id=experiment_id,
                    owner_id=self.storage.uid,
                    workspace_id=self._workspace_id(origin),
                    at=at,
                    manifest=manifest,
                )
            except ArtifactError as error:
                _error(error.code.removeprefix("experiment."))
            trial = {
                "schemaVersion": 1,
                "id": _new_id("trial"),
                "ownerId": self.storage.uid,
                "workspaceId": self._workspace_id(origin),
                "revision": 1,
                "createdAt": at,
                "updatedAt": at,
                "experimentId": experiment_id,
                "parameterSetId": manifest["parameterSetId"],
                "status": "queued",
            }
            bundle = {
                "version": 1,
                "id": experiment_id,
                "ownerId": self.storage.uid,
                "originId": origin,
                "revision": 1,
                "requestId": request_id,
                "experiment": experiment,
                "trial": trial,
                "manifest": deepcopy(manifest),
                "plan": deepcopy(plan),
                "report": None,
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

    def _set_status(self, origin, job_id, status, *, failure_code=None, report=None):
        with self.storage.transaction() as connection:
            bundle = self._require(connection, origin, job_id)
            bundle["trial"] = {
                **bundle["trial"],
                "status": status,
                "revision": bundle["trial"]["revision"] + 1,
                "updatedAt": now(),
                **({"failureCode": failure_code} if failure_code else {}),
            }
            if report is not None:
                bundle["report"] = report
                bundle["trial"]["resultArtifactId"] = _new_id("resultartifact")
            bundle["revision"] += 1
            bundle["updatedAt"] = bundle["trial"]["updatedAt"]
            return deepcopy(self._save(connection, origin, bundle))

    def cancel(self, origin, job_id):
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._require(connection, origin, job_id)
            if bundle["trial"]["status"] != "queued":
                _error("cancel_unavailable", 409)
        return self._set_status(origin, job_id, "cancelled")

    def recover(self, origin):
        """Requeue jobs left `running` by a restart (no checkpoint exists)."""
        self._origin(origin)
        recovered = []
        for bundle in self.list(origin):
            if bundle["trial"]["status"] == "running":
                recovered.append(self._set_status(origin, bundle["id"], "queued"))
        return recovered

    def run_next(self, origin, candle_loader):
        """Run the oldest queued job, if any. Returns its bundle or None."""
        self._origin(origin)
        queued = [
            bundle for bundle in self.list(origin) if bundle["trial"]["status"] == "queued"
        ]
        if not queued:
            return None
        job = sorted(queued, key=lambda row: (row["createdAt"], row["id"]))[0]
        self._set_status(origin, job["id"], "running")
        manifest, plan = job["manifest"], job["plan"]
        try:
            candles = candle_loader(deepcopy(manifest))
            if not isinstance(candles, list) or not candles:
                return self._set_status(
                    origin, job["id"], "failed", failure_code="experiment.coverage_insufficient"
                )
            coverage, partial = _coverage_for(candles, manifest)
            issues = validate_manifest(manifest, plan=plan, coverage=coverage)
            if issues:
                return self._set_status(
                    origin, job["id"], "failed", failure_code=";".join(issues)
                )
            report = run_experiment(plan, candles, manifest)
            curve, downsampled = _downsample(report["equityCurve"])
            if downsampled:
                report = {**report, "equityCurve": curve, "equityCurveDownsampled": True}
            if partial:
                report = {**report, "partialData": True}
            return self._set_status(
                origin, job["id"], "partial" if partial else "completed", report=report
            )
        except WorkspaceError:
            raise
        except Exception as error:  # loader/engine failure stays visible
            return self._set_status(
                origin, job["id"], "failed", failure_code=f"experiment.run_failed:{type(error).__name__}"
            )
