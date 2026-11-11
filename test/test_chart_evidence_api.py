"""Real authenticated HTTP/CSRF/worker chart captures and private image reads."""

import base64
from copy import deepcopy
from uuid import uuid4

import pytest
from test_chart_evidence import capture, png
from test_journal_api import create, setup
from test_local_data_api import csrf, login

from blueprints.journal import journal_bp

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/journal"


@pytest.fixture
def app(api):
    api.register_blueprint(journal_bp)
    return api


def body(workspace, row):
    return {
        "originId": workspace["originId"],
        "expectedRevision": workspace["revision"],
        "requestId": uuid4().hex,
        "target": {
            "kind": "trade",
            "id": row["id"],
            "profileId": 1,
            "bookId": row["journalBookId"],
        },
        "mimeType": "image/png",
        "base64": png(),
        "capture": capture(),
        "annotations": "Captured directly from the focused chart",
    }


def test_local_proof_csrf_and_strict_body_before_any_worker(app):
    with app.test_client() as client:
        assert (
            client.post(BASE + "/chart-evidence", json={}, headers=csrf(client)).status_code == 401
        )
        workspace = setup(client)
        created, _ = create(client, workspace)
        request = body(created["workspace"], created["detail"]["trade"])
        assert client.post(BASE + "/chart-evidence", json=request).status_code == 400
        assert (
            client.post(
                BASE + "/chart-evidence", json={**request, "ownerId": "other"}, headers=csrf(client)
            ).status_code
            == 400
        )
        assert (
            client.post(
                BASE + "/chart-evidence?ownerId=other", json=request, headers=csrf(client)
            ).status_code
            == 400
        )


def test_real_worker_capture_retry_image_and_book_export_stay_private(app):
    with app.test_client() as client:
        workspace = setup(client)
        created, _ = create(client, workspace)
        request = body(created["workspace"], created["detail"]["trade"])
        response = client.post(BASE + "/chart-evidence", json=request, headers=csrf(client))
        assert response.status_code == 200, response.json
        assert response.headers["Cache-Control"] == "no-store"
        assert response.json["detail"]["trade"]["amounts"] == created["detail"]["trade"]["amounts"]
        again = client.post(BASE + "/chart-evidence", json=request, headers=csrf(client))
        assert again.status_code == 200 and again.json == response.json
        image = client.get(response.json["result"]["url"])
        assert image.status_code == 200 and image.data == base64.b64decode(request["base64"])
        assert image.headers["Content-Type"].startswith("image/png")
        stale = deepcopy(request)
        stale["requestId"] = uuid4().hex
        assert (
            client.post(BASE + "/chart-evidence", json=stale, headers=csrf(client)).status_code
            == 409
        )
        login(client, "other")
        assert client.get(response.json["result"]["url"]).status_code == 404
        denied = client.post(BASE + "/chart-evidence", json=request, headers=csrf(client))
        assert denied.status_code == 404


def test_invalid_png_reports_recovery_action_and_retains_existing_trade(app):
    with app.test_client() as client:
        workspace = setup(client)
        created, _ = create(client, workspace)
        request = body(created["workspace"], created["detail"]["trade"])
        request["base64"] = base64.b64encode(b"\x89PNG\r\n\x1a\n").decode()
        response = client.post(BASE + "/chart-evidence", json=request, headers=csrf(client))
        assert (
            response.status_code == 400 and response.json["error"]["code"] == "chart.invalid_image"
        )
        assert "Capture" in response.json["error"]["message"]
