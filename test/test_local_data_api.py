"""Local-cookie authorization, CSRF and scoped durable APIs on disposable stores."""

import base64
from copy import deepcopy
from io import BytesIO

import pytest
from flask import Flask
from flask_wtf.csrf import CSRFProtect
from sqlalchemy import func, select
from sqlalchemy.orm import scoped_session, sessionmaker

import blueprints.auth as auth
from blueprints.local_data import (
    configure_local_storage,
    enforce_local_request_limits,
    local_data_bp,
)
from database import user_db
from database.engine_factory import create_db_engine
from database.workspace_storage_db import TABLES, principals
from services import local_account_access

PASSWORD = "Local API fixture password 85!"
BASE = "/api/local/v1"


@pytest.fixture
def api(tmp_path, monkeypatch):
    engine = create_db_engine(f"sqlite:///{(tmp_path / 'users.db').as_posix()}")
    user_db.Base.metadata.create_all(engine)
    registry = scoped_session(sessionmaker(bind=engine))
    original_query = user_db.Base.__dict__["query"]
    user_db.Base.query = registry.query_property()
    monkeypatch.setattr(user_db, "engine", engine)
    monkeypatch.setattr(user_db, "db_session", registry)
    user_db.username_cache.clear()
    for name in ("owner", "other"):
        user = user_db.User(
            username=name,
            email=name + "@example.test",
            totp_secret="JBSWY3DPEHPK3PXP",
            is_admin=name == "owner",
        )
        user.set_password(PASSWORD)
        registry.add(user)
    registry.commit()
    web = Flask(__name__)
    web.config.update(
        TESTING=True,
        SECRET_KEY="local-api-test-secret",
        RATELIMIT_ENABLED=False,
        LOCAL_DATA_DATABASE_URL=f"sqlite:///{(tmp_path / 'workspaces.db').as_posix()}",
    )
    configure_local_storage(web)
    web.before_request(enforce_local_request_limits)
    CSRFProtect(web)
    web.register_blueprint(auth.auth_bp)
    web.register_blueprint(local_data_bp)
    monkeypatch.setattr(
        auth,
        "_try_resume_broker_session",
        lambda *_: pytest.fail("Local APIs must not require a broker"),
    )
    import database.auth_db as broker_auth

    monkeypatch.setattr(broker_auth, "log_login_attempt", lambda *_args, **_kwargs: None)
    yield web
    registry.remove()
    user_db.Base.query = original_query
    user_db.username_cache.clear()
    engine.dispose()
    if "chartly_workspace_storage" in web.extensions:
        web.extensions["chartly_workspace_storage"]["engine"].dispose()


def csrf(client):
    return {"X-CSRFToken": client.get("/auth/csrf-token").json["csrf_token"]}


def login(client, username="owner"):
    response = client.post(
        "/auth/login",
        data={
            "username": username,
            "password": PASSWORD,
            "purpose": "local",
            "next": "/settings/storage",
        },
        headers=csrf(client),
    )
    assert response.status_code == 200, response.json
    return response


def mutate(client, path, body=None, method="POST", **kwargs):
    return client.open(BASE + path, method=method, json=body, headers=csrf(client), **kwargs)


def snapshot(origin="browser_origin_one"):
    tables = {name: [] for name in TABLES}
    tables["portfolios"] = [{"id": 1, "name": "Original Journal", "mode": "live"}]
    tables["journalTrades"] = [
        {"id": 1, "portfolioId": 1, "symbol": "EURUSD", "origin": "manual", "profit": 12.25}
    ]
    return {
        "format": "chartly-browser-snapshot",
        "version": 1,
        "originId": origin,
        "createdAt": "2026-11-02T12:00:00.000Z",
        "tables": tables,
        "nativeCatalogs": {},
        "preferences": {},
        "attachments": {},
        "datasetManifests": [],
    }


def migrate(client, source=None, request_id="migration_request_one"):
    response = mutate(client, "/migrations/preview", {"snapshot": source or snapshot()})
    assert response.status_code == 200, response.json
    preview = response.json
    resolutions = {issue["id"]: issue["choices"][0] for issue in preview["issues"]}
    response = mutate(
        client,
        f"/migrations/{preview['id']}/commit",
        {"resolutions": resolutions, "requestId": request_id},
    )
    assert response.status_code == 200, response.json
    receipt = response.json
    state = client.get(BASE + "/workspace?originId=" + receipt["originId"])
    assert state.status_code == 200, state.json
    return state.json, preview, resolutions


def test_unsigned_or_broker_only_sessions_cannot_open_local_api(api):
    with api.test_client() as client:
        with client.session_transaction() as session:
            session.update(user="owner", logged_in=True, broker="fixture", isLocalGuest=True)
        response = client.get(BASE + "/context")
        assert response.status_code == 401
        assert response.json["error"]["code"] == "account.authentication_required"
        assert response.headers["Cache-Control"] == "no-store"
        assert "chartly_workspace_storage" not in api.extensions


def test_real_cookie_context_get_does_not_create_principal_and_setup_is_idempotent(api):
    with api.test_client() as client:
        login(client)
        response = client.get(BASE + "/context")
        assert response.status_code == 200 and response.json["setupRequired"] is True
        engine = api.extensions["chartly_workspace_storage"]["engine"]
        with engine.connect() as connection:
            assert (
                connection.execute(select(func.count()).select_from(principals)).scalar_one() == 0
            )
        first = mutate(client, "/setup", {}).json
        second = mutate(client, "/setup", {}).json
        assert first == second and second["workspaces"] == [] and second["activeOriginId"] is None
        with engine.connect() as connection:
            assert (
                connection.execute(select(func.count()).select_from(principals)).scalar_one() == 1
            )


def test_mutations_require_current_csrf_even_with_valid_local_cookie(api):
    with api.test_client() as client:
        login(client)
        for headers in ({}, {"X-CSRFToken": "forged"}):
            response = client.post(BASE + "/setup", json={}, headers=headers)
            assert response.status_code == 400
            assert response.json["error"]["code"] == "csrf.invalid"
        assert mutate(client, "/setup", {}).status_code == 200
        with client.session_transaction() as session:
            session.clear()  # Broker expiry can discard Flask's CSRF cookie.
        assert client.get(BASE + "/context").status_code == 200
        assert client.post(BASE + "/setup", json={}).status_code == 400
        assert mutate(client, "/setup", {}).status_code == 200


@pytest.mark.parametrize(
    "path,body",
    [
        ("/setup", {"ownerId": "other"}),
        ("/context/active", {"originId": "browser_origin_one", "principalId": "other"}),
    ],
)
def test_client_cannot_supply_owner_or_unknown_fields(api, path, body):
    with api.test_client() as client:
        login(client)
        response = mutate(client, path, body, method="PUT" if path.endswith("active") else "POST")
        assert (
            response.status_code == 400
            and response.json["error"]["code"] == "request.invalid_fields"
        )
        assert client.get(BASE + "/context?ownerId=other").status_code == 400


def test_migration_returns_connected_workspace_and_retry_does_not_duplicate_trades(api):
    with api.test_client() as client:
        login(client)
        state, preview, resolutions = migrate(client)
        assert state["originId"] == "browser_origin_one" and len(state["books"]) == 1
        assert state["books"][0]["kind"] == "manual"
        assert state["bookAssignments"]["journalTrades:1"] == state["books"][0]["id"]
        replay = mutate(
            client,
            f"/migrations/{preview['id']}/commit",
            {"resolutions": resolutions, "requestId": "migration_request_one"},
        )
        assert replay.status_code == 200 and replay.json["originId"] == state["originId"]
        assert len(client.get(BASE + "/workspace").json["tables"]["journalTrades"]) == 1
        fetched = client.get(BASE + "/migrations/" + preview["id"])
        assert fetched.status_code == 200 and "snapshot" not in fetched.json
        status = client.get(BASE + "/recovery/status")
        assert status.status_code == 200 and status.json["migrations"][0]["id"] == preview["id"]
        assert "snapshot" not in status.json["migrations"][0]
        tables = deepcopy(state["tables"])
        tables["journalTrades"][0]["profit"] = 25.5
        response = mutate(
            client,
            "/workspace?originId=browser_origin_one",
            {
                "tables": tables,
                "expectedRevision": state["revision"],
                "requestId": "save_request_one",
            },
            method="PUT",
        )
        assert (
            response.status_code == 200
            and response.json["tables"]["journalTrades"][0]["profit"] == 25.5
        )
        stale = mutate(
            client,
            "/workspace?originId=browser_origin_one",
            {
                "tables": state["tables"],
                "expectedRevision": state["revision"],
                "requestId": "save_request_stale",
            },
            method="PUT",
        )
        assert (
            stale.status_code == 409 and stale.json["error"]["code"] == "storage.revision_conflict"
        )


def test_replay_creation_requires_owned_history_but_keeps_migrated_empty_projects(api):
    from uuid import uuid4

    from test_data_library import commit, preview

    from services.data_library import DataLibrary
    from services.workspace_storage import WorkspaceStorage

    with api.test_client() as client:
        login(client)
        original = snapshot()
        original["tables"]["portfolios"][0].update(kind="replay", currency="USD")
        state, _, _ = migrate(client, original)
        tables = deepcopy(state["tables"])
        tables["portfolios"][0]["name"] = "Retained legacy empty project"
        retained = mutate(
            client,
            "/workspace?originId=" + state["originId"],
            {"tables": tables, "expectedRevision": state["revision"], "requestId": uuid4().hex},
            method="PUT",
        )
        assert retained.status_code == 200, retained.json
        state = client.get(BASE + "/workspace").json
        assert "chartSource" not in state["tables"]["portfolios"][0]
        for source in (
            None,
            {},
            {"kind": "connected"},
            {"kind": "dataset", "versionId": "missing_owned_version"},
            {"kind": "dataset", "versionId": "missing_owned_version", "checksum": "0" * 64},
        ):
            tables = deepcopy(state["tables"])
            profile = {**tables["portfolios"][0], "id": 2, "name": "New replay project"}
            if source is not None:
                profile["chartSource"] = source
            tables["portfolios"].append(profile)
            denied = mutate(
                client,
                "/workspace?originId=" + state["originId"],
                {"tables": tables, "expectedRevision": state["revision"], "requestId": uuid4().hex},
                method="PUT",
            )
            assert denied.status_code == 409, denied.json
            assert denied.json["error"]["code"] == "dataset.profile_history_required"
            assert "Import candles in Data Library" in denied.json["error"]["message"]
            assert client.get(BASE + "/workspace").json == state
        principal = client.get(BASE + "/context").json["principalId"]
        library = DataLibrary(
            WorkspaceStorage(api.extensions["chartly_workspace_storage"]["engine"], principal)
        )
        version = commit(library, preview(library))["version"]
        state = client.get(BASE + "/workspace").json
        tables = deepcopy(state["tables"])
        tables["portfolios"].append(
            {
                **tables["portfolios"][0],
                "id": 2,
                "name": "Verified history project",
                "defaultSymbol": version["metadata"]["symbol"],
                "defaultTimeframe": version["metadata"]["interval"],
                "chartSource": {
                    "kind": "dataset",
                    "versionId": version["id"],
                    "checksum": version["checksum"],
                },
            }
        )
        created = mutate(
            client,
            "/workspace?originId=" + state["originId"],
            {"tables": tables, "expectedRevision": state["revision"], "requestId": uuid4().hex},
            method="PUT",
        )
        assert created.status_code == 200, created.json
        assert len(created.json["tables"]["portfolios"]) == 2
        assert (
            created.json["tables"]["portfolios"][1]["chartSource"]["checksum"]
            == version["checksum"]
        )


def test_foreign_workspace_jobs_and_attachments_have_no_cross_owner_access(api):
    with api.test_client() as owner:
        login(owner)
        _, preview, _ = migrate(owner)
    with api.test_client() as other:
        login(other, "other")
        assert other.get(BASE + "/context").json["workspaces"] == []
        assert other.get(BASE + "/recovery/status").json == {"restores": [], "migrations": []}
        assert other.get(BASE + "/migrations/" + preview["id"]).status_code == 404
        assert (
            other.get(
                BASE + "/attachments/attachment_unknown?originId=browser_origin_one"
            ).status_code
            == 404
        )
        assert (
            mutate(
                other, "/context/active", {"originId": "browser_origin_one"}, method="PUT"
            ).status_code
            == 404
        )
        assert mutate(other, "/backups?originId=browser_origin_one").status_code == 404


def test_native_revision_preferences_and_safe_attachment_delivery(api):
    source = snapshot()
    source["attachments"] = {
        "attachment_document": {
            "mimeType": "application/pdf",
            "base64": base64.b64encode(b"<script>untrusted</script>").decode(),
            "originalSource": "blob:fixture",
        }
    }
    source["tables"]["journalTrades"][0]["screenshotUrl"] = "blob:fixture"
    with api.test_client() as client:
        login(client)
        state, _, _ = migrate(client, source)
        url = state["tables"]["journalTrades"][0]["screenshotUrl"]
        response = client.get(url)
        assert response.status_code == 200 and response.data == b"<script>untrusted</script>"
        assert response.mimetype == "application/octet-stream"
        assert response.headers["Content-Disposition"].startswith("attachment;")
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Content-Security-Policy"].startswith("sandbox;")
        initial = client.get(
            BASE + "/native/workspace?originId=browser_origin_one&namespace=current"
        )
        assert initial.status_code == 200 and initial.json["revision"] == 0
        body = {
            "originId": state["originId"],
            "namespace": "current",
            "catalog": {
                "version": 1,
                "revision": 1,
                "workspaces": [],
                "templates": [],
                "recentWorkspaceIds": [],
                "activeWorkspaceId": None,
                "autosave": True,
            },
            "expectedCatalogRevision": 0,
            "requestId": "native_request_one",
        }
        saved = mutate(client, "/native/workspace", body, method="PUT")
        assert saved.status_code == 200 and saved.json["revision"] == 1, saved.json
        body["requestId"] = "native_request_stale"
        assert mutate(client, "/native/workspace", body, method="PUT").status_code == 409
        preferences = mutate(
            client,
            "/preferences",
            {
                "originId": state["originId"],
                "preferences": {
                    "chartly.combined-selection.v1": '{"version":1,"profileIds":[1],"currency":"USD"}'
                },
                "expectedPreferences": {},
                "requestId": "preference_request_one",
            },
            method="PUT",
        )
        assert preferences.status_code == 200, preferences.json
        stale_preferences = mutate(
            client,
            "/preferences",
            {
                "originId": state["originId"],
                "preferences": {},
                "expectedPreferences": {},
                "requestId": "preference_request_stale",
            },
            method="PUT",
        )
        assert stale_preferences.status_code == 409
        assert (
            client.get(BASE + "/workspace").json["preferences"]["chartly.combined-selection.v1"]
            == '{"version":1,"profileIds":[1],"currency":"USD"}'
        )


def test_backup_restore_and_undo_use_confirmed_scoped_worker_jobs(api):
    with api.test_client() as client:
        login(client)
        state, _, _ = migrate(client)
        backup = mutate(client, "/backups?originId=" + state["originId"])
        assert backup.status_code == 200 and backup.mimetype == "application/zip"
        context = client.get(BASE + "/context").json
        preview = client.post(
            BASE + "/restores/preview",
            data={
                "file": (BytesIO(backup.data), "backup.zip"),
                "expectedRevision": str(context["revision"]),
            },
            headers=csrf(client),
        )
        assert preview.status_code == 200, preview.json
        review = preview.json
        resumed = client.get(BASE + "/restores/" + review["jobId"])
        assert (
            resumed.status_code == 200
            and resumed.json["confirmationHash"] == review["confirmationHash"]
        )
        assert "payload" not in resumed.json
        body = {
            "expectedRevision": review["expectedRevision"],
            "confirmationHash": review["confirmationHash"],
            "confirmOwner": False,
        }
        restored = mutate(client, f"/restores/{review['jobId']}/commit", body)
        assert restored.status_code == 200 and restored.json["activated"] is True
        replay = mutate(client, f"/restores/{review['jobId']}/commit", body)
        assert replay.status_code == 200 and replay.json == restored.json
        recovered = client.get(BASE + "/recovery/status")
        assert (
            recovered.status_code == 200
            and recovered.json["restores"][0]["receipt"] == restored.json
        )
        undo = mutate(
            client,
            f"/restores/copies/{restored.json['recoveryCopyId']}/preview",
            {"expectedRevision": restored.json["revision"]},
        )
        assert undo.status_code == 200 and undo.json["jobId"]


def test_duplicate_json_and_over_limit_upload_fail_before_worker(api, monkeypatch):
    with api.test_client() as client:
        login(client)
        response = client.post(
            BASE + "/setup",
            data='{"a":1,"a":2}',
            content_type="application/json",
            headers=csrf(client),
        )
        assert (
            response.status_code == 400
            and response.json["error"]["code"] == "request.duplicate_json_key"
        )
        api.config["LOCAL_DATA_MAX_JSON_BYTES"] = 1024
        response = client.post(
            BASE + "/setup", data="x" * 1025, content_type="application/json", headers=csrf(client)
        )
        assert response.status_code == 413 and response.json["error"]["code"] == "request.too_large"
        assert client.get_cookie(local_account_access.COOKIE_NAME) is not None


def test_restore_body_limit_precedes_csrf_multipart_parsing(api):
    with api.test_client() as client:
        login(client)
        response = client.post(
            BASE + "/restores/preview",
            content_type="multipart/form-data; boundary=fixture",
            environ_overrides={"CONTENT_LENGTH": str(258 * 1024 * 1024)},
        )
        assert response.status_code == 413
        assert response.json["error"]["code"] == "request.too_large"


def test_locked_storage_returns_safe_retry_error_without_exposing_paths(api):
    with api.test_client() as client:
        login(client)
        assert client.get(BASE + "/context").status_code == 200
        engine = api.extensions["chartly_workspace_storage"]["engine"]
        with engine.connect() as connection:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            try:
                response = mutate(client, "/setup", {})
            finally:
                connection.rollback()
        assert response.status_code == 503
        assert response.json["error"]["code"] == "storage.unavailable"
        assert "draft" in response.json["error"]["message"]
        assert "workspaces.db" not in response.get_data(as_text=True)
        assert mutate(client, "/setup", {}).status_code == 200
