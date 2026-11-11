"""P20-T05 experiments HTTP: pin, submit, run, reopen durable report."""

from uuid import uuid4

import pytest
from test_journal_api import setup
from test_local_data_api import csrf
from test_strategy_experiments import CANDLES, DOC

import blueprints.experiments as experiments_module
from blueprints.experiments import experiments_bp
from blueprints.strategy_artifacts import strategy_artifacts_bp

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/experiments"
ARTIFACTS = "/api/local/v1/strategy-artifacts"


@pytest.fixture
def app(api, monkeypatch):
    api.register_blueprint(strategy_artifacts_bp)
    api.register_blueprint(experiments_bp)
    monkeypatch.setattr(
        experiments_module, "make_candle_loader", lambda storage: (lambda manifest: CANDLES)
    )
    return api


def artifact_action(client, origin, name, payload, project=None, draft_revision=None):
    body = {
        "originId": origin,
        "expectedRevision": project["revision"] if project else 0,
        "action": name,
        "payload": payload,
    }
    if project:
        body["projectId"] = project["id"]
    if draft_revision is not None:
        body["expectedDraftRevision"] = draft_revision
    return client.post(ARTIFACTS + "/action", json=body, headers=csrf(client))


def experiment_action(client, origin, name, payload, job_id=None):
    body = {"originId": origin, "action": name, "payload": payload}
    if job_id:
        body["jobId"] = job_id
    return client.post(BASE + "/action", json=body, headers=csrf(client))


def test_submit_run_and_reopen_report(app):
    with app.test_client() as client:
        assert client.get(BASE).status_code == 401
        origin = setup(client)["originId"]
        created = artifact_action(
            client,
            origin,
            "create",
            {
                "name": "Cross check",
                "kind": "strategy",
                "language": "chartly-rules-v1",
                "source": DOC,
            },
        )
        assert created.status_code == 200, created.json
        project = created.json["project"]
        revised = artifact_action(client, origin, "create-revision", {}, project)
        assert revised.status_code == 200, revised.json
        project = revised.json["project"]
        revision = project["revisions"][0]
        params = project["parameterSets"][0]

        submitted = experiment_action(
            client,
            origin,
            "submit",
            {
                "requestId": uuid4().hex,
                "projectId": project["id"],
                "revisionId": revision["id"],
                "parameterSetId": params["id"],
                "datasetVersionId": "datasetversion-0001",
                "instrumentId": "instrument-kraken-btc-usd",
                "warmupStart": "2026-01-01T00:00:00Z",
                "rangeStart": "2026-01-01T02:00:00Z",
                "rangeEnd": "2026-01-01T07:00:00Z",
                "startingCash": {"value": "1200", "currency": "USD"},
                "feeBps": "0",
                "slippageBps": "0",
                "fraction": "1",
                "quantityStep": "1",
                "quantityScale": 0,
                "entryOutput": "entry",
                "exitOutput": "exit",
                "seed": 42,
            },
        )
        assert submitted.status_code == 200, submitted.json
        job = submitted.json["job"]
        assert job["trial"]["status"] == "queued"

        ran = experiment_action(client, origin, "run-next", {})
        assert ran.status_code == 200, ran.json
        assert ran.json["job"]["trial"]["status"] == "completed"
        assert ran.json["job"]["report"]["endingEquity"] == "1500"

        detail = client.get(BASE + f"/{job['id']}?originId={origin}")
        assert detail.status_code == 200
        assert detail.json["job"]["report"]["checksum"] == ran.json["job"]["report"]["checksum"]
        listing = client.get(BASE + f"?originId={origin}").json["jobs"]
        assert [row["status"] for row in listing] == ["completed"]


def test_cancel_and_unknown_action(app):
    with app.test_client() as client:
        origin = setup(client)["originId"]
        bogus = client.post(
            BASE + "/action",
            json={"originId": origin, "action": "arm-live", "payload": {}},
            headers=csrf(client),
        )
        assert bogus.status_code == 400
