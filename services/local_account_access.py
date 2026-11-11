"""Broker-independent app account proofs over the existing local users.

The dedicated HttpOnly cookie has its own expiry: broker login changes Flask's
session lifetime globally, so the Flask broker cookie cannot own this proof.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import time
from dataclasses import dataclass
from functools import wraps

import pyotp
from flask import current_app, g, jsonify, request, session
from sqlalchemy import delete, insert, select, update
from sqlalchemy.exc import SQLAlchemyError

from database import user_db

COOKIE_NAME = "chartly_local_session"
TOKEN = re.compile(r"^[A-Za-z0-9_-]{43}$")
UID = re.compile(r"^principal_[0-9a-f]{32}$")


class LocalAccessUnavailable(Exception):
    pass


@dataclass(frozen=True)
class LocalPrincipal:
    uid: str
    username: str
    personal: bool = False


def _now():
    return int(time.time())


def _fingerprint(user):
    fields = [
        "identity_uid",
        "password_hash",
        "totp_secret",
        "totp_enabled",
        "totp_required_for_login",
        "totp_required_for_mcp",
        "totp_required_for_password_reset",
    ]
    values = [user[field] for field in fields]
    key = current_app.secret_key
    if not key:
        raise LocalAccessUnavailable("account.secret_unavailable")
    if isinstance(key, str):
        key = key.encode("utf-8")
    return hmac.new(
        key, json.dumps(values, separators=(",", ":")).encode("utf-8"), hashlib.sha256
    ).hexdigest()


def _user(connection, uid):
    return (
        connection.execute(select(user_db.User.__table__).where(user_db.User.identity_uid == uid))
        .mappings()
        .first()
    )


def prepare_local_login(user, password):
    """Fresh password proof; cached broker-login hashes never authorize records."""
    uid = getattr(user, "identity_uid", None)
    if not isinstance(uid, str) or not UID.fullmatch(uid):
        return None
    try:
        with user_db.engine.connect() as connection:
            row = _user(connection, uid)
            if row is None or not user_db._password_matches(row["password_hash"], password):
                return None
            return _fingerprint(row)
    except SQLAlchemyError as error:
        raise LocalAccessUnavailable("account.storage_unavailable") from error


def verify_local_second_factor(user, proof, code):
    """Verify the current factor, not an ORM instance retained across requests."""
    uid = getattr(user, "identity_uid", None)
    if not isinstance(uid, str) or not UID.fullmatch(uid) or not isinstance(proof, str):
        return False
    try:
        with user_db.engine.connect() as connection:
            row = _user(connection, uid)
            if row is None or not hmac.compare_digest(proof, _fingerprint(row)):
                return False
            if not (row["totp_enabled"] and row["totp_required_for_login"]):
                return False
            from database.auth_db import safe_decrypt_token

            secret = safe_decrypt_token(row["totp_secret"]) or row["totp_secret"]
            try:
                return pyotp.TOTP(secret).verify(code)
            except (ValueError, TypeError):
                return False
    except SQLAlchemyError as error:
        raise LocalAccessUnavailable("account.storage_unavailable") from error


def issue_local_account(user, proof, *, second_factor_verified=False):
    """Called only after the password and any required second factor complete."""
    uid = getattr(user, "identity_uid", None)
    if not isinstance(uid, str) or not UID.fullmatch(uid) or not isinstance(proof, str):
        return False
    ttl = current_app.config.get("LOCAL_ACCOUNT_SESSION_SECONDS", 86400)
    if type(ttl) is not int or not 60 <= ttl <= 30 * 86400:
        raise LocalAccessUnavailable("account.invalid_session_lifetime")
    now = _now()
    raw = secrets.token_urlsafe(32)
    try:
        with user_db.engine.begin() as connection:
            row = _user(connection, uid)
            if row is None or not hmac.compare_digest(proof, _fingerprint(row)):
                return False
            if (
                row["totp_enabled"]
                and row["totp_required_for_login"]
                and second_factor_verified is not True
            ):
                return False
            connection.execute(
                delete(user_db.LocalAccountSession).where(
                    (user_db.LocalAccountSession.expires_at <= now)
                    | (user_db.LocalAccountSession.revoked.is_(True))
                )
            )
            connection.execute(
                insert(user_db.LocalAccountSession).values(
                    token_hash=hashlib.sha256(raw.encode()).hexdigest(),
                    user_uid=uid,
                    issued_at=now,
                    expires_at=now + ttl,
                    credential_fingerprint=proof,
                    revoked=False,
                )
            )
        g.local_account_cookie = (raw, ttl)
        g.local_account_cookie_clear = False
        session.pop("chartly_local_guest", None)
        session.pop("chartly_personal_uid", None)
        return True
    except SQLAlchemyError as error:
        raise LocalAccessUnavailable("account.storage_unavailable") from error


def current_local_principal():
    if session.get("pending_totp_user"):
        return None
    raw = request.cookies.get(COOKIE_NAME)
    if not raw or not TOKEN.fullmatch(raw):
        return None
    digest = hashlib.sha256(raw.encode()).hexdigest()
    now = _now()
    sessions = user_db.LocalAccountSession.__table__
    users = user_db.User.__table__
    try:
        with user_db.engine.connect() as connection:
            row = (
                connection.execute(
                    select(
                        users,
                        sessions.c.credential_fingerprint,
                        sessions.c.issued_at,
                        sessions.c.expires_at,
                        sessions.c.revoked,
                    )
                    .join(sessions, users.c.identity_uid == sessions.c.user_uid)
                    .where(sessions.c.token_hash == digest)
                )
                .mappings()
                .first()
            )
            if (
                row is None
                or row["revoked"]
                or type(row["issued_at"]) is not int
                or type(row["expires_at"]) is not int
                or row["issued_at"] > now
                or row["expires_at"] <= now
            ):
                return None
            if isinstance(row["credential_fingerprint"], str) and row["credential_fingerprint"].startswith("p_"):
                from services.local_personal_access import verify_personal_row

                if UID.fullmatch(row["identity_uid"]) and verify_personal_row(connection, row):
                    return LocalPrincipal(uid=row["identity_uid"], username="Local workspace", personal=True)
                return None
            if (
                not isinstance(row["identity_uid"], str)
                or not UID.fullmatch(row["identity_uid"])
                or not isinstance(row["credential_fingerprint"], str)
                or not hmac.compare_digest(row["credential_fingerprint"], _fingerprint(row))
            ):
                return None
            return LocalPrincipal(uid=row["identity_uid"], username=row["username"])
    except SQLAlchemyError as error:
        raise LocalAccessUnavailable("account.storage_unavailable") from error


def revoke_local_account(*, all_devices=False):
    """Logout revokes the bearer server-side even when the broker cookie is gone."""
    raw = request.cookies.get(COOKIE_NAME)
    g.local_account_cookie_clear = True
    g.pop("local_account_cookie", None)
    if not raw or not TOKEN.fullmatch(raw):
        return
    digest = hashlib.sha256(raw.encode()).hexdigest()
    try:
        with user_db.engine.begin() as connection:
            uid = connection.execute(
                select(user_db.LocalAccountSession.user_uid).where(
                    user_db.LocalAccountSession.token_hash == digest
                )
            ).scalar_one_or_none()
            statement = update(user_db.LocalAccountSession).values(revoked=True)
            if all_devices and uid:
                statement = statement.where(user_db.LocalAccountSession.user_uid == uid)
            else:
                statement = statement.where(user_db.LocalAccountSession.token_hash == digest)
            connection.execute(statement)
    except SQLAlchemyError as error:
        raise LocalAccessUnavailable("account.storage_unavailable") from error


def apply_local_account_cookie(response):
    if getattr(g, "local_account_cookie_clear", False):
        response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="Strict")
    pending = getattr(g, "local_account_cookie", None)
    if pending:
        raw, ttl = pending
        response.set_cookie(
            COOKIE_NAME,
            raw,
            max_age=ttl,
            path="/",
            httponly=True,
            samesite="Strict",
            secure=bool(
                current_app.config.get("SESSION_COOKIE_SECURE", False) or request.is_secure
            ),
        )
    return response


def require_local_account(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        try:
            principal = current_local_principal()
        except LocalAccessUnavailable:
            return jsonify(
                {
                    "authenticated": False,
                    "error": {
                        "code": "account.unavailable",
                        "message": "Account access is temporarily unavailable. Retry without discarding your draft.",
                    },
                }
            ), 503
        if principal is None:
            return jsonify(
                {
                    "authenticated": False,
                    "error": {
                        "code": "account.authentication_required",
                        "message": "Sign in to your local app account.",
                    },
                }
            ), 401
        expected_principal = request.headers.get("X-Chartly-Principal")
        if expected_principal is not None and (
            not UID.fullmatch(expected_principal)
            or not hmac.compare_digest(expected_principal, principal.uid)
        ):
            return jsonify(
                {
                    "error": {
                        "code": "account.scope_changed",
                        "message": "The signed-in account changed. Reopen the intended workspace before saving; its draft is retained.",
                        "issues": [],
                    }
                }
            ), 403
        g.local_principal = principal
        return function(*args, **kwargs)

    return wrapped
