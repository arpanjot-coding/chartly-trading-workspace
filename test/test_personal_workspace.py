"""Actual cookie/CSRF/SQL boundaries for account-free personal PC data."""

from uuid import uuid4

import pytest
from sqlalchemy import func, select, update
from test_local_data_api import csrf, login

from blueprints.connectors import connectors_bp
from blueprints.data_library import data_library_bp
from database import user_db
from services.local_personal_access import clean_legacy_personal_session

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1"


@pytest.fixture
def personal(api, monkeypatch):
    monkeypatch.setenv("CHARTLY_NO_LOGIN", "true")
    api.register_blueprint(connectors_bp)
    api.register_blueprint(data_library_bp)
    api.before_request(clean_legacy_personal_session)
    from services import dataset_provider

    monkeypatch.setattr(
        dataset_provider,
        "capabilities",
        lambda uid: {"available": False, "reason": "No broker required."},
    )
    return api


def open_personal(client, **kwargs):
    headers = {**csrf(client), "Origin": "http://localhost", "Sec-Fetch-Site": "same-origin"}
    headers.update(kwargs.pop("headers", {}))
    return client.post("/auth/local-workspace", json={}, headers=headers, **kwargs)


def test_personal_entry_opens_real_saved_history_without_account_or_broker(personal, monkeypatch):
    import database.auth_db as broker_auth

    monkeypatch.setattr(
        broker_auth, "upsert_api_key", lambda *_: pytest.fail("No automatic developer key")
    )
    client = personal.test_client()
    status = client.get("/auth/local-session")
    assert status.status_code == 401 and status.json["personalModeAvailable"] is True
    assert (
        client.post(
            "/auth/local-workspace", json={}, headers={"Origin": "http://localhost"}
        ).status_code
        == 400
    )
    opened = open_personal(client)
    assert opened.status_code == 200, opened.json
    identity = opened.json["principal"]
    assert identity["personal"] is True and identity["username"] == "Local workspace"
    assert opened.headers["Cache-Control"] == "private, no-store"
    assert "HttpOnly" in opened.headers.get("Set-Cookie", "")
    assert client.get("/auth/local-session").json["principal"] == identity
    assert client.get(BASE + "/datasets").status_code == 200
    from test_data_library_api import upload

    saved, _, _ = upload(client)
    assert saved["version"]["rowCount"] > 0
    with client.session_transaction() as state:
        assert "broker" not in state and "api_key" not in state
    with user_db.engine.connect() as connection:
        admin = connection.execute(
            select(user_db.User.is_admin).where(user_db.User.identity_uid == identity["uid"])
        ).scalar_one()
        assert admin is False
    api_status = client.get("/auth/session-status").json
    assert api_status["local_guest"] is True and api_status["broker"] is None
    assert api_status["logged_in"] is False and api_status["api_key"] is None


def test_personal_identity_is_stable_and_does_not_adopt_an_existing_named_user(personal):
    first, second = personal.test_client(), personal.test_client()
    uid = open_personal(first).json["principal"]["uid"]
    assert open_personal(second).json["principal"]["uid"] == uid
    with user_db.engine.connect() as connection:
        assert (
            connection.execute(
                select(func.count()).select_from(user_db.LocalPersonalOwner)
            ).scalar_one()
            == 1
        )
        names = (
            connection.execute(
                select(user_db.User.username).where(user_db.User.identity_uid == uid)
            )
            .scalars()
            .all()
        )
        assert names[0] not in {"owner", "other", "chartly"}
    named = personal.test_client()
    login(named)
    owner = named.get(BASE + "/context").json["principalId"]
    reply = open_personal(named)
    assert reply.json["principal"]["uid"] == owner and reply.json["principal"]["personal"] is False
    assert owner != uid


@pytest.mark.parametrize(
    "change",
    [
        {"headers": {"Origin": "http://evil.example"}},
        {"headers": {"Sec-Fetch-Site": "cross-site"}},
        {"headers": {"Sec-Fetch-Site": "none"}},
        {"headers": {"Forwarded": "for=127.0.0.1"}},
        {"headers": {"X-Forwarded-For": "127.0.0.1"}},
        {"headers": {"X-Forwarded-Host": "localhost"}},
        {"headers": {"X-Real-IP": "127.0.0.1"}},
        {"environ_overrides": {"REMOTE_ADDR": "198.51.100.8"}},
        {"headers": {"Host": "evil.example", "Origin": "http://evil.example"}},
    ],
)
def test_personal_bootstrap_refuses_remote_proxy_and_foreign_origins(personal, change):
    client = personal.test_client()
    result = open_personal(client, **change)
    assert result.status_code in {400, 403}, result.json
    assert client.get(BASE + "/context").status_code == 401
    with user_db.engine.connect() as connection:
        assert (
            connection.execute(
                select(func.count()).select_from(user_db.LocalPersonalOwner)
            ).scalar_one()
            == 0
        )


def test_personal_mode_flag_and_request_body_are_not_client_authority(personal, monkeypatch):
    client = personal.test_client()
    monkeypatch.setenv("CHARTLY_NO_LOGIN", "false")
    assert client.get("/auth/local-session").json["personalModeAvailable"] is False
    assert open_personal(client).status_code == 403
    monkeypatch.setenv("CHARTLY_NO_LOGIN", "true")
    response = client.post(
        "/auth/local-workspace",
        json={"principalId": "owner"},
        headers={**csrf(client), "Origin": "http://localhost"},
    )
    assert response.status_code == 400
    with client.session_transaction() as state:
        state["pending_totp_user"] = "owner"
    assert open_personal(client).status_code == 403


def test_personal_proof_is_local_only_and_stale_owner_headers_still_fail(personal):
    client = personal.test_client()
    open_personal(client)
    assert (
        client.get(BASE + "/context", environ_overrides={"REMOTE_ADDR": "198.51.100.7"}).status_code
        == 401
    )
    assert (
        client.get(BASE + "/context", headers={"Origin": "http://evil.example"}).status_code == 401
    )
    assert (
        client.get(BASE + "/context", headers={"X-Forwarded-For": "127.0.0.1"}).status_code == 401
    )
    assert (
        client.get(
            BASE + "/context", headers={"X-Chartly-Principal": "principal_" + "0" * 32}
        ).status_code
        == 403
    )
    assert client.get(BASE + "/context").status_code == 200


def test_legacy_guest_admin_and_default_broker_are_not_personal_proof(personal):
    client = personal.test_client()
    with client.session_transaction() as state:
        state.update(
            user="owner",
            logged_in=True,
            chartly_local_guest=True,
            broker="zerodha",
            session_id="old-admin-session",
        )
    assert client.get(BASE + "/context").status_code == 401
    with client.session_transaction() as state:
        assert "user" not in state and "broker" not in state and "session_id" not in state
    uid = open_personal(client).json["principal"]["uid"]
    owner = personal.test_client()
    login(owner)
    assert owner.get(BASE + "/context").json["principalId"] != uid


@pytest.mark.parametrize("security", ["password", "totp"])
def test_personal_bootstrap_does_not_bypass_newly_enabled_account_security(personal, security):
    client = personal.test_client()
    uid = open_personal(client).json["principal"]["uid"]
    with user_db.engine.begin() as connection:
        patch = (
            {"password_hash": "changed-by-account-security"}
            if security == "password"
            else {"totp_enabled": True}
        )
        connection.execute(
            update(user_db.User).where(user_db.User.identity_uid == uid).values(**patch)
        )
    assert client.get(BASE + "/context").status_code == 401
    assert open_personal(client).status_code == 503


def test_personal_native_setup_remains_read_only_and_metadata_is_public(personal, monkeypatch):
    client = personal.test_client()
    catalog = client.get(BASE + "/connectors/providers")
    assert catalog.status_code == 200
    assert {row["category"] for row in catalog.json["providers"]} == {
        "brokerage",
        "crypto",
        "desktop",
        "diagnostic",
    }
    assert any(row["id"] == "mt5" for row in catalog.json["providers"])
    uid = open_personal(client).json["principal"]["uid"]
    assert client.post(BASE + "/setup", json={}, headers=csrf(client)).status_code == 200
    from flask import g

    import blueprints.connectors as blueprint

    def worker(action, args):
        assert g.local_principal.uid == uid and g.local_principal.personal is True
        assert action == "connector_action" and args["action"] == "create"
        return {"readOnlySetup": True}

    monkeypatch.setattr(blueprint, "_run", worker)
    response = client.post(
        BASE + "/connectors/action",
        json={
            "originId": "personal_native_setup",
            "expectedRevision": 0,
            "requestId": uuid4().hex,
            "action": "create",
            "payload": {"providerId": "mt5", "label": "Terminal", "configuration": {}},
        },
        headers=csrf(client),
    )
    assert response.status_code == 200 and response.json["readOnlySetup"] is True
