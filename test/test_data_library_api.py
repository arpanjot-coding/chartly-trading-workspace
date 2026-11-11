"""Real local-cookie/CSRF/workspace-worker dataset journey on disposable files."""

import json
import zipfile
from io import BytesIO
from uuid import uuid4

import pytest
from test_data_library import context, mapping, source
from test_local_data_api import csrf, login

from blueprints.data_library import data_library_bp

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/datasets"


@pytest.mark.parametrize(
    "target",
    [
        "/historify",
        "/historify?returnTo=%2Fworkspace%2Fprofiles%2F1%2Freplay",
        "/historify/charts?datasetVersionId=version_fixture&returnTo=%2Fhistorify",
        "/trading?profileId=1&datasetVersionId=version_fixture",
    ],
)
def test_local_login_preserves_known_history_and_chart_context(target):
    from blueprints.auth import _local_return

    assert _local_return(target) == target


@pytest.mark.parametrize(
    "target",
    [
        "//outside.example/historify",
        "https://outside.example/historify",
        "/historify/provider-tools",
        "/historify/../api/action",
        "/trading/../auth/logout",
        "/historify/charts/../../auth/logout",
        "/historify/charts/%2e%2e/%2e%2e/auth/logout",
        "/historify/charts/%5cevil",
        "/historify/charts/%0aevil",
    ],
)
def test_local_login_never_expands_to_an_external_or_provider_action(target):
    from blueprints.auth import _local_return

    assert _local_return(target) == "/workspace"


@pytest.fixture
def app(api, monkeypatch):
    api.register_blueprint(data_library_bp)
    from services import dataset_provider

    monkeypatch.setattr(
        dataset_provider,
        "capabilities",
        lambda uid: {"available": False, "reason": "Fixture has no broker."},
    )
    return api


def upload(client):
    response = client.post(
        BASE + "/imports/preview",
        json={
            "expectedRevision": client.get(BASE).json["revision"],
            "csvText": source(),
            "mapping": mapping(),
            "context": context(),
        },
        headers=csrf(client),
    )
    assert response.status_code == 200, response.json
    job = response.json
    body = {
        "expectedRevision": job["expectedRevision"],
        "requestId": uuid4().hex,
        "policy": "keep",
        "allowRejectedRows": False,
    }
    response = client.post(
        BASE + "/imports/" + job["id"] + "/commit", json=body, headers=csrf(client)
    )
    assert response.status_code == 200, response.json
    return response.json, job, body


def test_local_import_chart_bounds_repeat_and_actual_bundle_bytes(app):
    with app.test_client() as client:
        assert client.get(BASE).status_code == 401
        login(client)
        assert client.get(BASE).json["versions"] == []
        response, job, body = upload(client)
        version = response["version"]
        id = version["id"]
        assert not response["catalog"]["capabilities"]["downloads"]["available"]
        resumed = client.get(BASE + "/imports/" + job["id"])
        assert resumed.status_code == 200 and resumed.json["context"]["symbol"] == "EXAMPLE"
        replay = client.post(
            BASE + "/imports/" + job["id"] + "/commit", json=body, headers=csrf(client)
        )
        assert replay.status_code == 200 and replay.json["version"]["id"] == id
        data = client.get(BASE + "/versions/" + id + "/bars?from=1793610000&to=1793610000&limit=10")
        assert data.status_code == 200 and len(data.json["bars"]) == 1
        assert (
            data.json["bars"][0]["close"] == "101.123456789012345678901234"
            and data.json["bars"][0]["volume"] is None
        )
        exported = client.get(BASE + "/versions/" + id + "/export?format=bundle")
        assert (
            exported.status_code == 200 and "attachment" in exported.headers["Content-Disposition"]
        )
        with zipfile.ZipFile(BytesIO(exported.data)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["datasetVersion"]["checksum"] == version["checksum"]
        assert exported.headers["Cache-Control"] == "no-store"
        again, _, _ = upload(client)
        assert again["version"]["id"] == id and len(client.get(BASE).json["versions"]) == 1


def test_foreign_actor_cannot_read_private_preview_version_or_candles(app):
    with app.test_client() as owner:
        login(owner)
        response, job, _ = upload(owner)
    with app.test_client() as other:
        login(other, "other")
        assert other.get(BASE).json["versions"] == []
        for path in (
            "/imports/" + job["id"],
            "/versions/" + response["version"]["id"],
            "/versions/" + response["version"]["id"] + "/bars",
            "/versions/" + response["version"]["id"] + "/export",
        ):
            assert other.get(BASE + path).status_code == 404


def test_unknown_owner_fields_csrf_and_invalid_queries_are_rejected(app):
    with app.test_client() as client:
        login(client)
        assert client.get(BASE + "?ownerId=other").status_code == 400
        assert client.post(BASE + "/imports/preview", json={}).status_code == 400
        for query in ("limit=" + ("9" * 5000), "from=NaN", "limit=0", "ownerId=other"):
            response = client.get(BASE + "/versions/version_fixture/bars?" + query)
            assert response.status_code == 400, response.json
        response = client.post(
            BASE + "/downloads",
            json={
                "expectedRevision": 0,
                "requestId": uuid4().hex,
                "context": context(),
                "mapping": mapping(),
                "startAt": "2026-11-02T00:00:00Z",
                "endAt": "2026-11-03T00:00:00Z",
            },
            headers=csrf(client),
        )
        assert (
            response.status_code == 409
            and response.json["error"]["code"] == "dataset.provider_not_connected"
        )


def test_archive_keeps_exact_version_and_restore_is_idempotent(app):
    with app.test_client() as client:
        login(client)
        response, _, _ = upload(client)
        version = response["version"]
        id = version["id"]
        body = {"expectedRevision": response["catalog"]["revision"], "requestId": uuid4().hex}
        archived = client.post(
            BASE + "/versions/" + id + "/archive", json=body, headers=csrf(client)
        )
        assert archived.status_code == 200 and archived.json["version"]["archivedAt"]
        assert client.get(BASE + "/versions/" + id + "/bars").status_code == 200
        restored = client.post(
            BASE + "/versions/" + id + "/restore",
            json={
                "expectedRevision": archived.json["catalog"]["revision"],
                "requestId": uuid4().hex,
            },
            headers=csrf(client),
        )
        assert restored.status_code == 200 and "archivedAt" not in restored.json["version"]
