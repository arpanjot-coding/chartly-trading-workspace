"""P20-T06/T08 HTTP: deployment drafts, duplicate-start, upgrade/rollback."""

import pytest
from test_journal_api import setup
from test_local_data_api import csrf

from blueprints.deployments import deployments_bp

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/deployments"
DESTINATION = {
    "id": "executiondestination-demo1",
    "accountId": "account-demo-001",
    "mode": "broker_demo",
    "arming": "armed",
    "eligibility": "eligible",
    "nativeSymbol": "XBTUSD",
}


@pytest.fixture
def app(api):
    api.register_blueprint(deployments_bp)
    return api


def test_deployment_draft_lifecycle_over_http(app):
    with app.test_client() as client:
        origin = setup(client)["originId"]
        headers = csrf(client)

        def act(action, payload=None, deployment_id=None):
            body = {"originId": origin, "action": action, "payload": payload or {}}
            if deployment_id:
                body["deploymentId"] = deployment_id
            return client.post(BASE + "/action", json=body, headers=headers)

        created = act(
            "create",
            {
                "artifactRevision": {"revisionId": "artifactrevision-v1", "checksum": "a" * 16},
                "destination": DESTINATION,
                "label": "Draft bot",
            },
        )
        assert created.status_code == 201, created.json
        deployment = created.json["deployment"]
        assert deployment["state"] == "draft"
        assert deployment["binding"]["mode"] == "broker_demo"
        assert act("start", deployment_id=deployment["id"]).json["deployment"]["state"] == "running"
        duplicate = act("start", deployment_id=deployment["id"])
        assert duplicate.status_code == 409
        assert duplicate.json["error"]["code"] == "deployment.already_running_duplicate_refused"
        stopped = act("stop", deployment_id=deployment["id"]).json["deployment"]
        assert "NOT cancelled" in stopped["stopSemantics"]
        upgraded = act(
            "upgrade",
            {"artifactRevision": {"revisionId": "artifactrevision-v2", "checksum": "b" * 16}},
            deployment["id"],
        ).json["deployment"]
        assert upgraded["artifactRevision"]["revisionId"] == "artifactrevision-v2"
        rolled = act("rollback", deployment_id=deployment["id"]).json["deployment"]
        assert rolled["artifactRevision"]["revisionId"] == "artifactrevision-v1"
        listed = client.get(BASE + f"?originId={origin}").json
        assert len(listed["deployments"]) == 1
