"""P20 workspace HTTP boundary: auth, templates, draft CAS, preview, export."""

from copy import deepcopy
from uuid import uuid4

import pytest
from test_journal_api import setup
from test_local_data_api import csrf

from blueprints.strategy_artifacts import strategy_artifacts_bp

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/strategy-artifacts"


@pytest.fixture
def app(api):
    api.register_blueprint(strategy_artifacts_bp)
    return api


def action(client, origin, name, payload, project=None, draft_revision=None):
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
    return client.post(BASE + "/action", json=body, headers=csrf(client)), body


def _candles(count):
    return [
        {
            "time": f"2026-11-04T00:{index:02d}:00Z",
            "open": str(value), "high": str(value), "low": str(value),
            "close": str(value), "volume": "1",
        }
        for index, value in enumerate(range(1, count + 1))
    ]


def test_workspace_http_lifecycle(app):
    with app.test_client() as client:
        assert client.get(BASE).status_code == 401
        workspace = setup(client)
        origin = workspace["originId"]
        templates = client.get(BASE + "/templates")
        assert templates.status_code == 200, templates.json
        assert {row["id"] for row in templates.json["templates"]} >= {"template-rsi-indicator"}

        result, _ = action(
            client, origin, "create-from-template", {"templateId": "template-rsi-indicator"}
        )
        assert result.status_code == 200, result.json
        assert "no-store" in result.headers["Cache-Control"]
        project = result.json["project"]
        assert project["project"]["kind"] == "indicator"

        listing = client.get(BASE + f"?originId={origin}").json["projects"]
        assert [row["id"] for row in listing] == [project["id"]]

        source = deepcopy(project["draft"]["source"])
        source["inputs"][0]["default"] = "21"
        result, _ = action(
            client, origin, "save-draft", {"source": source}, project, draft_revision=1
        )
        assert result.status_code == 200, result.json
        project = result.json["project"]
        # Stale draft token fails closed and changes nothing.
        conflict, _ = action(
            client, origin, "save-draft", {"source": source}, project, draft_revision=1
        )
        assert conflict.status_code == 409
        assert conflict.json["error"]["code"] == "artifact.draft_conflict"

        result, _ = action(client, origin, "create-revision", {}, project)
        assert result.status_code == 200, result.json
        project = result.json["project"]
        revision = project["revisions"][0]
        params = project["parameterSets"][0]

        result, _ = action(
            client,
            origin,
            "preview",
            {
                "revisionId": revision["id"],
                "parameterSetId": params["id"],
                "candles": _candles(30),
            },
            project,
        )
        assert result.status_code == 200, result.json
        assert result.json["rows"][-1]["outputs"]["rsi"] == "100"

        result, _ = action(client, origin, "export", {}, project)
        package = result.json["package"]
        result, _ = action(client, origin, "import", {"package": package})
        assert result.status_code == 200, result.json
        assert result.json["project"]["id"] != project["id"]

        result, _ = action(client, origin, "archive", {}, project)
        assert result.status_code == 200, result.json
        assert result.json["project"]["project"]["state"] == "archived"
        assert uuid4().hex  # keep import explicit for fixture parity


def test_workspace_http_rejects_unknown_action_and_bad_origin(app):
    with app.test_client() as client:
        workspace = setup(client)
        origin = workspace["originId"]
        result, _ = action(client, origin, "create", {"name": "X"}, None)
        assert result.status_code == 400
        bogus = client.post(
            BASE + "/action",
            json={
                "originId": origin,
                "expectedRevision": 0,
                "action": "place-order",
                "payload": {},
            },
            headers=csrf(client),
        )
        assert bogus.status_code == 400
        assert client.get(BASE + "?originId=nope").status_code == 400
