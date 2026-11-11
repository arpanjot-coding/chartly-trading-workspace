"""Independent real-request checks for personal proofs and legacy API ownership."""

from datetime import UTC, datetime, timezone
from uuid import uuid4

import pytest
from flask import jsonify, session
from sqlalchemy import select, update
from test_local_data_api import PASSWORD, csrf, login
from test_personal_workspace import open_personal

import blueprints.apikey as keys
import blueprints.playground as playground
from database import user_db
from services.local_account_access import COOKIE_NAME
from utils.session import check_session_validity

pytest_plugins = ["test_personal_workspace"]
BASE = "/api/local/v1"


@pytest.fixture
def reviewed(personal, monkeypatch):
    personal.register_blueprint(keys.api_key_bp)
    personal.register_blueprint(playground.playground_bp)
    monkeypatch.setattr(keys, "get_api_key_for_tradingview", lambda _: None)
    monkeypatch.setattr(keys, "get_order_mode", lambda _: "auto")
    monkeypatch.setattr(playground, "get_api_key_for_tradingview", lambda _: None)
    monkeypatch.setattr("utils.session.revoke_user_tokens", lambda: None)

    @personal.get("/review/legacy-private")
    @check_session_validity
    def legacy_private():
        return jsonify({"user": session["user"]})

    return personal


@pytest.mark.parametrize("path", ["/apikey", "/apikey/mode"])
def test_personal_session_cannot_mutate_a_named_owners_developer_credentials(
    reviewed, monkeypatch, path
):
    client = reviewed.test_client()
    open_personal(client)
    writes = []
    monkeypatch.setattr(keys, "upsert_api_key", lambda *args: writes.append(args) or 1)
    monkeypatch.setattr(keys, "update_order_mode", lambda *args: writes.append(args) or True)
    result = client.post(path, json={"user_id": "owner", "mode": "semi_auto"}, headers=csrf(client))
    assert result.status_code == 403, result.json
    assert writes == []


@pytest.mark.parametrize("personal_owner", [True, False])
@pytest.mark.parametrize("path", ["/apikey", "/apikey/mode"])
def test_developer_mutations_bind_the_current_session_without_a_client_supplied_owner(
    reviewed, monkeypatch, personal_owner, path
):
    client = reviewed.test_client()
    if personal_owner:
        open_personal(client)
        with client.session_transaction() as state:
            expected = state["user"]
    else:
        login(client)
        expected = "owner"
    writes = []
    monkeypatch.setattr(keys, "upsert_api_key", lambda *args: writes.append(args) or 1)
    monkeypatch.setattr(keys, "update_order_mode", lambda *args: writes.append(args) or True)
    result = client.post(path, json={"mode": "semi_auto"}, headers=csrf(client))
    assert result.status_code == 200, result.json
    assert len(writes) == 1 and writes[0][0] == expected
    assert "__personal_" not in str(result.json)


@pytest.mark.parametrize("patch", [{"revoked": True}, {"expires_at": 1}, {"issued_at": 9999999999}])
def test_invalidated_personal_proof_cannot_authorize_legacy_app_or_private_data(reviewed, patch):
    client = reviewed.test_client()
    uid = open_personal(client).json["principal"]["uid"]
    with user_db.engine.begin() as connection:
        connection.execute(
            update(user_db.LocalAccountSession)
            .where(user_db.LocalAccountSession.user_uid == uid)
            .values(**patch)
        )
    assert client.get(BASE + "/context").status_code == 401
    assert client.get("/review/legacy-private").status_code == 302


@pytest.mark.parametrize(
    "change",
    [
        {"environ_overrides": {"REMOTE_ADDR": "203.0.113.10"}},
        {"headers": {"Host": "foreign.test"}},
        {"headers": {"X-Forwarded-Proto": "http"}},
        {"headers": {"Forwarded": "for=127.0.0.1;host=localhost"}},
        {"headers": {"Sec-Fetch-Site": "cross-site"}},
        {"environ_overrides": {"werkzeug.proxy_fix.orig": {"REMOTE_ADDR": "203.0.113.10"}}},
    ],
)
def test_copied_personal_cookie_cannot_authorize_private_or_legacy_routes(reviewed, change):
    client = reviewed.test_client()
    open_personal(client)
    assert client.get(BASE + "/context", **change).status_code == 401
    assert client.get("/review/legacy-private", **change).status_code == 302


def test_personal_cookie_without_flask_cookie_retains_only_its_own_data_authority(reviewed):
    original = reviewed.test_client()
    identity = open_personal(original).json["principal"]
    transferred = reviewed.test_client()
    transferred.set_cookie(COOKIE_NAME, original.get_cookie(COOKIE_NAME).value)
    context = transferred.get(BASE + "/context")
    assert context.status_code == 200 and context.json["principalId"] == identity["uid"]
    assert transferred.get("/review/legacy-private").status_code == 302
    reply = open_personal(transferred)
    assert reply.status_code == 200 and reply.json["principal"] == identity


def test_named_nonoperator_cannot_attach_native_by_supplying_personal_flags(reviewed):
    client = reviewed.test_client()
    login(client, "other")
    with client.session_transaction() as state:
        state.update(chartly_local_guest=True, chartly_personal_uid="principal_" + "0" * 32)
    response = client.post(
        BASE + "/connectors/action",
        json={
            "originId": "native_review",
            "expectedRevision": 0,
            "requestId": uuid4().hex,
            "action": "create",
            "payload": {"providerId": "mt5", "label": "Terminal", "configuration": {}},
        },
        headers=csrf(client),
    )
    assert response.status_code == 403
    assert response.json["error"]["code"] == "connector.operator_required"


@pytest.mark.parametrize("path", ["/apikey", "/apikey/mode"])
def test_expected_principal_blocks_developer_access_after_cookie_owner_changes(
    reviewed, monkeypatch, path
):
    client = reviewed.test_client()
    uid = open_personal(client).json["principal"]["uid"]
    calls = []
    monkeypatch.setattr(
        keys, "get_api_key_for_tradingview", lambda *args: calls.append(args) or "private"
    )
    monkeypatch.setattr(keys, "upsert_api_key", lambda *args: calls.append(args) or 1)
    monkeypatch.setattr(keys, "update_order_mode", lambda *args: calls.append(args) or True)
    login(client, "other")
    headers = {**csrf(client), "X-Chartly-Principal": uid, "Accept": "application/json"}
    response = client.post(path, json={"mode": "semi_auto"}, headers=headers)
    assert response.status_code == 403, response.json
    if path == "/apikey":
        assert client.get(path, headers=headers).status_code == 403
    assert calls == []


def test_personal_role_elevation_locks_password_free_access(reviewed):
    client = reviewed.test_client()
    uid = open_personal(client).json["principal"]["uid"]
    with user_db.engine.begin() as connection:
        connection.execute(
            update(user_db.User).where(user_db.User.identity_uid == uid).values(is_admin=True)
        )
    assert client.get(BASE + "/context").status_code == 401
    assert open_personal(client).status_code == 503
    with user_db.engine.connect() as connection:
        assert (
            connection.execute(
                select(user_db.User.is_admin).where(user_db.User.identity_uid == uid)
            ).scalar_one()
            is True
        )


def test_personal_profile_metadata_never_reads_global_mail_or_generated_security_secrets(
    reviewed, monkeypatch
):
    client = reviewed.test_client()
    uid = open_personal(client).json["principal"]["uid"]
    monkeypatch.setattr(
        "blueprints.auth.get_smtp_settings",
        lambda: pytest.fail("Personal preferences do not read shared mail credentials"),
    )
    monkeypatch.setattr(
        user_db.User,
        "get_totp_uri",
        lambda _: pytest.fail("Personal preferences do not provision hidden credentials"),
    )
    response = client.get("/auth/profile-data", headers={"X-Chartly-Principal": uid})
    assert response.status_code == 200, response.json
    assert response.json["data"] == {
        "username": "Local workspace",
        "local_guest": True,
        "smtp_settings": None,
        "qr_code": None,
        "totp_secret": None,
    }


@pytest.mark.parametrize(
    "target,expected",
    [
        ("/profile", "/profile"),
        ("/apikey", "/apikey"),
        ("/playground?request=history", "/playground?request=history"),
        ("/apikey/other-owner", "/workspace"),
        ("https://outside.test/apikey", "/workspace"),
    ],
)
def test_named_local_sign_in_preserves_only_exact_account_tool_return_paths(
    reviewed, target, expected
):
    client = reviewed.test_client()
    response = client.post(
        "/auth/login",
        data={"username": "owner", "password": PASSWORD, "purpose": "local", "next": target},
        headers=csrf(client),
    )
    assert response.status_code == 200, response.json
    assert response.json["local_authenticated"] is True
    assert response.json["redirect"] == expected


@pytest.mark.parametrize("path", ["/apikey", "/auth/profile-data", "/playground/api-key"])
def test_genuine_named_local_proof_opens_account_tools_without_legacy_broker_flags(
    reviewed, monkeypatch, path
):
    monkeypatch.setattr("blueprints.auth.get_smtp_settings", lambda: {})
    client = reviewed.test_client()
    login(client)
    uid = client.get(BASE + "/context").json["principalId"]
    response = client.get(path, headers={"Accept": "application/json", "X-Chartly-Principal": uid})
    assert response.status_code == 200, response.json
    with client.session_transaction() as state:
        assert not state.get("logged_in") and not state.get("broker")


def test_named_local_proof_does_not_broaden_the_original_legacy_app_guard(reviewed):
    client = reviewed.test_client()
    login(client)
    response = client.get("/review/legacy-private", headers={"Accept": "application/json"})
    assert response.status_code == 401


def test_named_nonadmin_account_resolves_its_own_key_owner_without_broker_authority(
    reviewed, monkeypatch
):
    client = reviewed.test_client()
    login(client, "other")
    uid = client.get(BASE + "/context").json["principalId"]
    calls = []
    monkeypatch.setattr(
        keys,
        "get_api_key_for_tradingview",
        lambda username: calls.append(("read", username)) or "other-fixture-key",
    )
    monkeypatch.setattr(
        keys, "upsert_api_key", lambda username, _: calls.append(("write", username)) or 1
    )
    headers = {**csrf(client), "Accept": "application/json", "X-Chartly-Principal": uid}
    assert client.get("/apikey", headers=headers).json["api_key"] == "other-fixture-key"
    assert client.post("/apikey", json={}, headers=headers).status_code == 200
    assert client.post("/apikey", json={"user_id": "owner"}, headers=headers).status_code == 403
    assert calls == [("read", "other"), ("write", "other")]
    with client.session_transaction() as state:
        assert not state.get("logged_in") and not state.get("broker")


@pytest.mark.parametrize(
    "path", ["/playground/api-key", "/playground/endpoints", "/playground/collections"]
)
def test_playground_reads_reject_a_stale_expected_principal_before_disclosing_data(
    reviewed, monkeypatch, path
):
    client = reviewed.test_client()
    login(client, "other")
    monkeypatch.setattr(
        playground,
        "get_api_key_for_tradingview",
        lambda _: pytest.fail("Wrong owner cannot read a key"),
    )
    monkeypatch.setattr(
        playground,
        "load_bruno_endpoints",
        lambda **_: pytest.fail("Wrong owner cannot load a catalog"),
    )
    response = client.get(path, headers={"X-Chartly-Principal": "principal_" + "0" * 32})
    assert response.status_code == 403, response.json
