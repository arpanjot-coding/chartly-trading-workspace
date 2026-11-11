"""A broker flag, old cookie or frontend guest never authorizes durable records."""

import hashlib
from datetime import timedelta

import pyotp
import pytest
from flask import Flask, g, jsonify, session
from sqlalchemy import select, update
from sqlalchemy.orm import scoped_session, sessionmaker

import blueprints.auth as auth
from database import user_db
from database.engine_factory import create_db_engine
from services import local_account_access as local

PASSWORD = "Local fixture password 72!"


@pytest.fixture
def app(tmp_path, monkeypatch):
    engine = create_db_engine(f"sqlite:///{(tmp_path / 'users.db').as_posix()}")
    user_db.Base.metadata.create_all(engine)
    registry = scoped_session(sessionmaker(bind=engine))
    original_query = user_db.Base.__dict__["query"]
    user_db.Base.query = registry.query_property()
    monkeypatch.setattr(user_db, "engine", engine)
    monkeypatch.setattr(user_db, "db_session", registry)
    user_db.username_cache.clear()
    user = user_db.User(
        username="local-user",
        email="local@example.test",
        totp_secret="JBSWY3DPEHPK3PXP",
        is_admin=True,
    )
    user.set_password(PASSWORD)
    registry.add(user)
    registry.commit()
    app = Flask(__name__)
    app.secret_key = "local-access-test-secret-not-for-installation"
    app.config.update(TESTING=True, RATELIMIT_ENABLED=False)
    app.register_blueprint(auth.auth_bp)

    @app.get("/private")
    @local.require_local_account
    def private():
        return jsonify({"uid": g.local_principal.uid, "username": g.local_principal.username})

    @app.post("/broker-expired")
    def expire_broker():
        session.clear()
        app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(seconds=1)
        return jsonify({"broker": "expired"})

    monkeypatch.setattr(
        auth,
        "_try_resume_broker_session",
        lambda _username: pytest.fail("Local sign-in must not contact a broker"),
    )
    import database.auth_db as broker_auth

    monkeypatch.setattr(broker_auth, "log_login_attempt", lambda *_args, **_kwargs: None)
    yield app, registry, user
    registry.remove()
    engine.dispose()
    user_db.Base.query = original_query
    user_db.username_cache.clear()


def login(client, **extra):
    return client.post(
        "/auth/login",
        data={
            "username": "local-user",
            "password": PASSWORD,
            "purpose": "local",
            "next": "/settings/storage",
            **extra,
        },
    )


def test_password_only_local_login_has_no_broker_requirement(app):
    web, _, user = app
    with web.test_client() as client:
        response = login(client)
        assert response.status_code == 200 and response.json["redirect"] == "/settings/storage"
        assert response.json["local_authenticated"] is True
        status = client.get("/auth/local-session")
        assert status.status_code == 200 and status.json["principal"]["uid"] == user.identity_uid
        assert client.get("/private").json["uid"] == user.identity_uid
        with client.session_transaction() as cookie:
            assert not cookie.get("logged_in") and not cookie.get("broker")


def test_cookie_is_httponly_strict_host_only_and_server_holds_hash(app):
    web, registry, _ = app
    with web.test_client() as client:
        response = login(client)
        header = next(
            value
            for value in response.headers.getlist("Set-Cookie")
            if value.startswith(local.COOKIE_NAME + "=")
        )
        assert (
            "HttpOnly" in header
            and "SameSite=Strict" in header
            and "Domain=" not in header
            and "Path=/" in header
        )
        token = client.get_cookie(local.COOKIE_NAME).value
        row = registry.execute(select(user_db.LocalAccountSession)).scalar_one()
        assert row.token_hash == hashlib.sha256(token.encode()).hexdigest()
        assert token not in row.credential_fingerprint


def test_https_local_cookie_is_secure(app):
    web, _, _ = app
    web.config["SESSION_COOKIE_SECURE"] = True
    with web.test_client() as client:
        response = login(client)
        header = next(
            value
            for value in response.headers.getlist("Set-Cookie")
            if value.startswith(local.COOKIE_NAME + "=")
        )
        assert "Secure" in header


def test_broker_expiry_and_flask_cookie_loss_do_not_expire_local_proof(app):
    web, _, _ = app
    with web.test_client() as client:
        login(client)
        client.post("/broker-expired")
        assert client.get("/private").status_code == 200


@pytest.mark.parametrize(
    "values",
    [
        {"user": "local-user"},
        {"logged_in": True, "user": "local-user", "broker": "fixture"},
        {"chartly_local_guest": True},
        {"isLocalGuest": True},
    ],
)
def test_legacy_or_guest_flags_cannot_grant_record_access(app, values):
    web, _, _ = app
    with web.test_client() as client:
        with client.session_transaction() as cookie:
            cookie.update(values)
        response = client.get("/private")
        assert (
            response.status_code == 401
            and response.json["error"]["code"] == "account.authentication_required"
        )


def test_required_second_factor_is_not_bypassed(app, monkeypatch):
    web, registry, user = app
    user.totp_enabled = True
    user.totp_required_for_login = True
    registry.commit()
    with web.test_client() as client:
        assert login(client).json["status"] == "totp_required"
        assert client.get("/private").status_code == 401
        assert client.post("/auth/login/totp", json={"totp_code": "bad"}).status_code == 401
        assert client.get("/private").status_code == 401
        response = client.post(
            "/auth/login/totp", json={"totp_code": pyotp.TOTP(user.totp_secret).now()}
        )
        assert response.status_code == 200 and response.json["redirect"] == "/settings/storage"
        assert client.get("/private").status_code == 200


def test_changed_password_between_factors_invalidates_pending_proof(app, monkeypatch):
    web, registry, user = app
    user.totp_enabled = True
    user.totp_required_for_login = True
    registry.commit()
    monkeypatch.setattr(user_db.User, "verify_totp", lambda *_args: True)
    with web.test_client() as client:
        assert login(client).json["status"] == "totp_required"
        user.set_password("A different current password 82!")
        registry.commit()
        assert client.post("/auth/login/totp", json={"totp_code": "123456"}).status_code == 401
        assert client.get("/private").status_code == 401


@pytest.mark.parametrize("change", ["password", "factor", "deleted", "revoked", "expired"])
def test_changed_or_revoked_authentication_stops_existing_proof(app, change):
    web, registry, user = app
    with web.test_client() as client:
        login(client)
        if change == "password":
            user.set_password("Changed password 83!")
        elif change == "factor":
            user.totp_required_for_login = True
        elif change == "deleted":
            registry.delete(user)
        elif change == "revoked":
            registry.execute(update(user_db.LocalAccountSession).values(revoked=True))
        else:
            registry.execute(update(user_db.LocalAccountSession).values(expires_at=1))
        registry.commit()
        assert client.get("/private").status_code == 401


def test_rename_keeps_uid_and_returns_current_username(app):
    web, registry, user = app
    uid = user.identity_uid
    with web.test_client() as client:
        login(client)
        user.username = "renamed-local-user"
        registry.commit()
        assert client.get("/private").json == {"uid": uid, "username": "renamed-local-user"}


def test_reused_numeric_user_id_never_inherits_deleted_users_principal(app):
    web, registry, user = app
    numeric_id, principal = user.id, user.identity_uid
    with web.test_client() as client:
        login(client)
        registry.delete(user)
        registry.commit()
        replacement = user_db.User(
            id=numeric_id,
            username="replacement",
            email="replacement@example.test",
            totp_secret="JBSWY3DPEHPK3PXP",
        )
        replacement.set_password(PASSWORD)
        registry.add(replacement)
        registry.commit()
        assert replacement.identity_uid != principal
        assert client.get("/private").status_code == 401


def test_cached_broker_password_cannot_authorize_local_records(app, monkeypatch):
    web, registry, user = app
    user.set_password("The current password is different 84!")
    registry.commit()
    monkeypatch.setattr(auth, "authenticate_user", lambda *_args: True)
    with web.test_client() as client:
        assert login(client).status_code == 401
        assert client.get("/private").status_code == 401
        assert client.get_cookie(local.COOKIE_NAME) is None


def test_logout_revokes_cookie_even_without_broker_session(app):
    web, registry, _ = app
    with web.test_client() as client:
        login(client)
        token = client.get_cookie(local.COOKIE_NAME).value
        with client.session_transaction() as cookie:
            cookie.clear()
        assert client.post("/auth/logout").status_code == 200
        assert client.get("/private").status_code == 401
        client.set_cookie(local.COOKIE_NAME, token)
        assert client.get("/private").status_code == 401
        assert registry.execute(select(user_db.LocalAccountSession.revoked)).scalar_one() is True


def test_forged_or_pending_factor_cookie_cannot_bypass_gate(app):
    web, _, _ = app
    with web.test_client() as client:
        client.set_cookie(local.COOKIE_NAME, "a" * 43)
        assert client.get("/private").status_code == 401
        login(client)
        with client.session_transaction() as cookie:
            cookie["pending_totp_user"] = "local-user"
        assert client.get("/private").status_code == 401


@pytest.mark.parametrize(
    "target",
    [
        "https://example.test/",
        "//example.test",
        "/\\example.test",
        "/auth/logout",
        "javascript:alert(1)",
    ],
)
def test_local_return_never_becomes_an_external_or_auth_action(app, target):
    web, _, _ = app
    with web.test_client() as client:
        assert login(client, next=target).json["redirect"] == "/workspace"


def test_cross_site_local_login_is_rejected_before_proof(app):
    web, _, _ = app
    with web.test_client() as client:
        response = client.post(
            "/auth/login",
            data={"username": "local-user", "password": PASSWORD, "purpose": "local"},
            headers={"Sec-Fetch-Site": "cross-site"},
        )
        assert response.status_code == 403 and client.get_cookie(local.COOKIE_NAME) is None
