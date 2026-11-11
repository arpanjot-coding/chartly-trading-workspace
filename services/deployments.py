"""Deployment lifecycle, schedules and workflow actions (P17).

A deployment binds one immutable strategy-artifact revision to one
execution destination (account + environment + mode, copied at bind
time and never re-pointed). Starting requires an armed, eligible
destination; two runtimes for the same deployment can never both be
running; stopping a deployment never implies orders were cancelled
or positions closed — those are P11 actions with their own outcomes.
The runtime itself is injected (`probe`/`start`/`stop` callables), so
this module owns lifecycle truth, not process management.
"""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import insert, select, update

from database.execution_db import deployments
from services.workspace_storage import WorkspaceError, dumps, now, opaque, valid_origin

STATES = {"draft", "running", "stopped", "error"}


def _error(code, status=400):
    raise WorkspaceError("deployment." + code, status)


class DeploymentService:
    def __init__(self, storage, runtime):
        self.storage = storage
        self.runtime = runtime  # object with start(dep), stop(dep), probe(dep)->state

    def _origin(self, origin):
        if not valid_origin(origin):
            _error("origin_invalid")
        return origin

    def _load(self, connection, origin, deployment_id):
        row = connection.execute(
            select(deployments.c.payload).where(
                self.storage.scope(deployments, origin), deployments.c.id == deployment_id
            )
        ).first()
        return json.loads(row[0]) if row else None

    def _save(self, connection, origin, record):
        raw = dumps(record)
        if self._load(connection, origin, record["id"]) is None:
            connection.execute(
                insert(deployments).values(
                    uid=self.storage.uid, origin=origin, id=record["id"], payload=raw
                )
            )
        else:
            connection.execute(
                update(deployments)
                .where(self.storage.scope(deployments, origin), deployments.c.id == record["id"])
                .values(payload=raw)
            )

    def _get(self, connection, origin, deployment_id):
        record = self._load(connection, origin, deployment_id)
        if record is None:
            _error("not_found", 404)
        return record

    def create(self, origin, *, artifact_revision, destination, label):
        """artifact_revision: {revisionId, checksum}; destination is the
        P11 ExecutionDestination dict — account/mode are frozen here."""
        self._origin(origin)
        record = {
            "id": opaque(
                "deployment", f"{artifact_revision['revisionId']}|{destination['id']}|{now()}"
            ),
            "label": label,
            "state": "draft",
            "artifactRevision": dict(artifact_revision),
            "previousRevision": None,
            "binding": {
                "destinationId": destination["id"],
                "accountId": destination["accountId"],
                "mode": destination["mode"],
                "nativeSymbol": destination["nativeSymbol"],
            },
            "arming": destination.get("arming", "disarmed"),
            "eligibility": destination.get("eligibility", "unknown"),
            "createdAt": now(),
            "updatedAt": now(),
            "events": [{"at": now(), "event": "created", "detail": "draft"}],
        }
        with self.storage.transaction() as connection:
            self._save(connection, origin, record)
        return deepcopy(record)

    def _mutate(self, origin, deployment_id, event, fn):
        with self.storage.transaction() as connection:
            record = self._get(connection, origin, deployment_id)
            result = fn(record)
            record["updatedAt"] = now()
            record["events"].append({"at": now(), "event": event, "detail": record["state"]})
            self._save(connection, origin, record)
            return deepcopy(result if result is not None else record)

    def start(self, origin, deployment_id):
        def begin(record):
            if record["state"] == "running":
                _error("already_running_duplicate_refused", 409)
            if record["arming"] != "armed" or record["eligibility"] != "eligible":
                _error("destination_not_armed_or_eligible", 409)
            self.runtime.start(deepcopy(record))
            record["state"] = "running"

        return self._mutate(origin, deployment_id, "started", begin)

    def stop(self, origin, deployment_id):
        def halt(record):
            if record["state"] != "running":
                _error("not_running", 409)
            self.runtime.stop(deepcopy(record))
            record["state"] = "stopped"

        stopped = self._mutate(origin, deployment_id, "stopped", halt)
        return {
            **stopped,
            "stopSemantics": "Deployment runtime stopped. Open broker orders were NOT cancelled and positions were NOT closed; use the execution actions for those.",
        }

    def upgrade(self, origin, deployment_id, new_revision):
        def apply(record):
            if record["state"] == "running":
                _error("stop_before_upgrade", 409)
            record["previousRevision"] = record["artifactRevision"]
            record["artifactRevision"] = dict(new_revision)
            record["state"] = "draft"

        return self._mutate(origin, deployment_id, "upgraded", apply)

    def rollback(self, origin, deployment_id):
        def apply(record):
            if record["state"] == "running":
                _error("stop_before_rollback", 409)
            if not record["previousRevision"]:
                _error("no_previous_revision", 409)
            record["artifactRevision"], record["previousRevision"] = (
                record["previousRevision"],
                record["artifactRevision"],
            )
            record["state"] = "draft"

        return self._mutate(origin, deployment_id, "rolled_back", apply)

    def reconcile(self, origin, deployment_id):
        with self.storage.transaction() as connection:
            record = self._get(connection, origin, deployment_id)
        actual = self.runtime.probe(deepcopy(record))
        drift = actual != record["state"]
        if drift:

            def apply(row, actual=actual):
                row["state"] = actual if actual in STATES else "error"

            record = self._mutate(origin, deployment_id, "reconciled", apply)
        return {"deployment": record, "driftCorrected": drift, "runtimeState": actual}

    def list(self, origin):
        self._origin(origin)
        with self.storage.transaction() as connection:
            rows = connection.execute(
                select(deployments.c.payload)
                .where(self.storage.scope(deployments, origin))
                .order_by(deployments.c.id)
            )
            return [json.loads(row[0]) for row in rows]


# ---------------------------------------------------------------------------
# Explicit schedules (T06)
# ---------------------------------------------------------------------------


def next_run(schedule, *, after):
    """schedule: {kind: daily, at: 'HH:MM', timezone: IANA, missed: skip|run_once}
    `after` is an aware datetime. Returns the next run instant (aware)."""
    if schedule.get("kind") != "daily":
        _error("schedule_kind_unsupported", 422)
    zone = ZoneInfo(schedule["timezone"])
    hour, minute = (int(part) for part in schedule["at"].split(":"))
    local = after.astimezone(zone)
    candidate = datetime.combine(local.date(), time(hour, minute), tzinfo=zone)
    if candidate <= local:
        if schedule.get("missed") == "run_once" and (local - candidate) <= timedelta(hours=1):
            return candidate  # due now, once
        candidate += timedelta(days=1)
    return candidate


# ---------------------------------------------------------------------------
# Workflow actions over owning domain APIs (T03) + honest wording (T05)
# ---------------------------------------------------------------------------

WORKFLOW_ACTIONS = {
    "journal.sync": "Connector history sync (P07/P22) — returns a sync job reference",
    "research.refresh": "EDGAR ingestion submit (P13) — returns an ingestion job reference",
    "experiment.run": "Experiment submission (P21) — returns an experiment reference",
    "notify.local": "Local notification (P15 pattern) — delivered only while the app runs",
}

STATUS_WORDING = {
    "pending": "queued — not sent yet",
    "submitted": "sent — awaiting broker acknowledgement (not executed)",
    "acknowledged": "acknowledged by broker — working, not filled",
    "part_filled": "partially filled",
    "filled": "filled",
    "cancel_requested": "cancel requested — not yet confirmed cancelled",
    "cancelled": "cancelled",
    "rejected": "rejected by broker",
    "unknown": "outcome unknown — reconciliation required, do not resubmit",
    "reconciling": "being reconciled against broker records",
}


def run_workflow_action(action, payload, handlers):
    """Dispatch to the owning domain handler; store only references."""
    if action not in WORKFLOW_ACTIONS:
        return {"action": action, "status": "unavailable", "reason": "unknown workflow action"}
    handler = handlers.get(action)
    if handler is None:
        return {
            "action": action,
            "status": "unavailable",
            "reason": WORKFLOW_ACTIONS[action] + "; no handler configured in this workspace",
        }
    reference = handler(payload)
    return {"action": action, "status": "submitted", "reference": reference}


def activity_feed(commands, deployment_events=()):
    rows = [
        {
            "kind": "command",
            "id": row["id"],
            "status": row["status"],
            "wording": STATUS_WORDING.get(row["status"], row["status"]),
            "at": row["updatedAt"],
        }
        for row in commands
    ]
    rows += [
        {
            "kind": "deployment",
            "id": row.get("deploymentId"),
            "status": row["event"],
            "wording": row["event"],
            "at": row["at"],
        }
        for row in deployment_events
    ]
    return sorted(rows, key=lambda row: row["at"])
