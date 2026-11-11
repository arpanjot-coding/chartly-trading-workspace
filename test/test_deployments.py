"""P17: deployment lifecycle, schedules, workflow actions, AI, redaction."""

from datetime import UTC, datetime

import pytest
from test_journal_api import setup

from services.deployments import (
    DeploymentService,
    activity_feed,
    next_run,
    run_workflow_action,
)
from services.support_tools import AiResearchAssistant, redact, support_export
from services.workspace_storage import WorkspaceError, WorkspaceStorage

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1"
DESTINATION = {
    "id": "executiondestination-demo1",
    "accountId": "account-demo-001",
    "mode": "broker_demo",
    "arming": "armed",
    "eligibility": "eligible",
    "nativeSymbol": "XBTUSD",
}
REV1 = {"revisionId": "artifactrevision-v1", "checksum": "a" * 16}
REV2 = {"revisionId": "artifactrevision-v2", "checksum": "b" * 16}


class Runtime:
    def __init__(self):
        self.state = "stopped"
        self.starts = 0

    def start(self, _dep):
        self.starts += 1
        self.state = "running"

    def stop(self, _dep):
        self.state = "stopped"

    def probe(self, _dep):
        return self.state


@pytest.fixture
def service(api):
    with api.test_client() as client:
        origin = setup(client)["originId"]
        principal = client.get(BASE + "/context").json["principalId"]
    storage = WorkspaceStorage(api.extensions["chartly_workspace_storage"]["engine"], principal)
    runtime = Runtime()
    return DeploymentService(storage, runtime), origin, runtime


def test_lifecycle_binding_upgrade_rollback_and_stop_semantics(service):
    service, origin, runtime = service
    dep = service.create(origin, artifact_revision=REV1, destination=DESTINATION, label="BTC demo")
    assert dep["binding"]["accountId"] == "account-demo-001"
    started = service.start(origin, dep["id"])
    assert started["state"] == "running"
    with pytest.raises(WorkspaceError) as error:  # two views can't double-start
        service.start(origin, dep["id"])
    assert error.value.code == "deployment.already_running_duplicate_refused"
    assert runtime.starts == 1
    stopped = service.stop(origin, dep["id"])
    assert "NOT cancelled" in stopped["stopSemantics"]
    upgraded = service.upgrade(origin, dep["id"], REV2)
    assert upgraded["artifactRevision"] == REV2
    rolled = service.rollback(origin, dep["id"])
    assert rolled["artifactRevision"] == REV1
    runtime.state = "running"  # drift: runtime says running, record says draft
    reconciled = service.reconcile(origin, dep["id"])
    assert reconciled["driftCorrected"] is True
    assert reconciled["deployment"]["state"] == "running"


def test_disarmed_destination_cannot_start(service):
    service, origin, _runtime = service
    disarmed = dict(DESTINATION, arming="disarmed")
    dep = service.create(origin, artifact_revision=REV1, destination=disarmed, label="x")
    with pytest.raises(WorkspaceError) as error:
        service.start(origin, dep["id"])
    assert error.value.code == "deployment.destination_not_armed_or_eligible"


def test_schedule_timezones_and_missed_runs():
    after = datetime(2026, 11, 4, 14, 0, tzinfo=UTC)  # 09:00 EST
    schedule = {"kind": "daily", "at": "08:30", "timezone": "America/New_York", "missed": "skip"}
    nxt = next_run(schedule, after=after)
    assert nxt.isoformat().startswith("2026-11-05T08:30")
    catchup = next_run(dict(schedule, missed="run_once", at="08:45"), after=after)
    assert catchup.isoformat().startswith("2026-11-04T08:45")


def test_workflow_actions_reference_domain_jobs_and_wording_is_honest():
    out = run_workflow_action(
        "experiment.run", {"experimentId": "e1"}, {"experiment.run": lambda p: {"jobId": "job-7"}}
    )
    assert out == {"action": "experiment.run", "status": "submitted", "reference": {"jobId": "job-7"}}
    missing = run_workflow_action("research.refresh", {}, {})
    assert missing["status"] == "unavailable"
    feed = activity_feed(
        [{"id": "c1", "status": "acknowledged", "updatedAt": "2026-11-04T12:00:00Z"}]
    )
    assert "not filled" in feed[0]["wording"]


def test_ai_unconfigured_is_harmless_and_configured_is_read_only():
    snapshot = {
        "facts": [
            {
                "metricId": "us-gaap:Revenues",
                "value": "246000000000",
                "unit": "USD",
                "periodEnd": "2025-06-30",
                "citation": "10-K/A accession 0000950170-26-000020",
            }
        ]
    }
    plain = AiResearchAssistant()
    assert plain.answer("Revenue?", snapshot)["status"] == "unavailable"
    seen = {}

    def model(question, evidence):
        seen["evidence"] = evidence
        return "Revenue was 246000000000 USD."

    assistant = AiResearchAssistant(model=model)
    result = assistant.answer("Revenue?", snapshot)
    assert result["writesPerformed"] is False
    assert result["citations"] == ["10-K/A accession 0000950170-26-000020"]
    assert seen["evidence"][0]["value"] == "246000000000"
    assert assistant.declared_permissions == ["read:snapshots", "read:facts"]


def test_support_export_redacts_every_secret_spelling():
    bundle = support_export(
        versions={"app": "1.0"},
        counts={"issuers": 3},
        states={
            "apiSecret": "x",
            "nested": {"APCA-API-SECRET-KEY": "y", "session_id": "z", "fine": "ok"},
            "list": [{"refreshToken": "t"}],
        },
    )
    states = bundle["states"]
    assert states["apiSecret"] == "[redacted]"
    assert states["nested"]["APCA-API-SECRET-KEY"] == "[redacted]"
    assert states["nested"]["session_id"] == "[redacted]"
    assert states["nested"]["fine"] == "ok"
    assert states["list"][0]["refreshToken"] == "[redacted]"
    # Long-form/unenumerated spellings still fail closed.
    assert redact({"krakenApiSecretKey": "s"})["krakenApiSecretKey"] == "[redacted]"
    assert redact({"x": object()})["x"].endswith("omitted]")
