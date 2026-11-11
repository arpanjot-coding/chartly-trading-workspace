"""Password-free personal workspace, restricted to direct same-origin loopback use."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os
import secrets
from urllib.parse import urlsplit
from uuid import uuid4

import pyotp
from flask import current_app, g, request, session
from sqlalchemy import delete, insert, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from database import user_db
from services.local_account_access import (
    LocalAccessUnavailable,
    _fingerprint,
    _now,
    current_local_principal,
)

OWNER_ID = "personal-workspace-v1"
PERSONAL_PREFIX = "p_"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def direct_loopback_request_allowed(*, require_origin=False):
    """Prove a same-origin request reached the app directly on this PC."""
    if request.environ.get("werkzeug.proxy_fix.orig"):
        return False
    try:
        if not ipaddress.ip_address(request.remote_addr or "").is_loopback:
            return False
        host = urlsplit(request.host_url)
    except ValueError:
        return False
    if host.hostname not in LOCAL_HOSTS or host.username or host.password:
        return False
    if any(
        name.lower().startswith("x-forwarded-") or name.lower() in {"forwarded", "x-real-ip"}
        for name in request.headers.keys()
    ):
        return False
    origin = request.headers.get("Origin")
    if origin is not None and origin != request.host_url.rstrip("/"):
        return False
    if require_origin and origin != request.host_url.rstrip("/"):
        return False
    site = request.headers.get("Sec-Fetch-Site")
    if site and site not in ({"same-origin"} if require_origin else {"same-origin", "none"}):
        return False
    return True


def personal_request_allowed(*, bootstrap=False):
    return os.getenv("CHARTLY_NO_LOGIN", "false").lower() == "true" and (
        direct_loopback_request_allowed(require_origin=bootstrap)
    )


def require_local_terminal_operator():
    """Authorize access to private native terminal account data and commands."""
    from services.workspace_storage import WorkspaceError

    if not direct_loopback_request_allowed(
        require_origin=request.method not in {"GET", "HEAD", "OPTIONS"}
    ):
        raise WorkspaceError("market.terminal_local_only", 403)
    principal = g.local_principal
    if principal.personal:
        return
    try:
        with user_db.engine.connect() as connection:
            operator = connection.execute(
                select(user_db.User.is_admin).where(user_db.User.identity_uid == principal.uid)
            ).scalar_one_or_none()
    except SQLAlchemyError:
        raise WorkspaceError("account.unavailable", 503) from None
    if operator is not True:
        raise WorkspaceError("connector.operator_required", 403)


def personal_fingerprint(row):
    return PERSONAL_PREFIX + _fingerprint(row)[:62]


def verify_personal_row(connection, row):
    if not personal_request_allowed():
        return False
    owner = user_db.LocalPersonalOwner.__table__
    saved = connection.execute(select(owner).where(owner.c.id == OWNER_ID)).mappings().first()
    return bool(
        saved
        and saved["user_uid"] == row["identity_uid"]
        and not row["totp_enabled"]
        and row["is_admin"] is False
        and hmac.compare_digest(
            saved["password_digest"], hashlib.sha256(row["password_hash"].encode()).hexdigest()
        )
        and hmac.compare_digest(row["credential_fingerprint"], personal_fingerprint(row))
    )


def _owner():
    owner = user_db.LocalPersonalOwner.__table__
    users = user_db.User.__table__
    # Existing installations gain only this additional table. Named accounts and
    # their credentials/roles/records are never selected as the personal owner.
    owner.create(user_db.engine, checkfirst=True)
    for attempt in range(2):
        try:
            with user_db.engine.begin() as connection:
                uid = connection.execute(
                    select(owner.c.user_uid).where(owner.c.id == OWNER_ID)
                ).scalar_one_or_none()
                if uid is None:
                    suffix = uuid4().hex
                    user = user_db.User(
                        identity_uid="principal_" + suffix,
                        username="__personal_" + suffix,
                        email=suffix + "@personal.chartly.invalid",
                        totp_secret=pyotp.random_base32(),
                        is_admin=False,
                    )
                    user.set_password(secrets.token_urlsafe(64))
                    values = {
                        name: getattr(user, name)
                        for name in (
                            "identity_uid",
                            "username",
                            "email",
                            "password_hash",
                            "totp_secret",
                            "is_admin",
                        )
                    }
                    connection.execute(insert(users).values(**values))
                    uid = user.identity_uid
                    connection.execute(
                        insert(owner).values(
                            id=OWNER_ID,
                            user_uid=uid,
                            password_digest=hashlib.sha256(user.password_hash.encode()).hexdigest(),
                        )
                    )
                row = (
                    connection.execute(select(users).where(users.c.identity_uid == uid))
                    .mappings()
                    .first()
                )
                if row is None:
                    raise LocalAccessUnavailable("account.personal_owner_unavailable")
                saved = (
                    connection.execute(select(owner).where(owner.c.id == OWNER_ID)).mappings().one()
                )
                if (
                    row["totp_enabled"]
                    or row["is_admin"] is not False
                    or not hmac.compare_digest(
                        saved["password_digest"],
                        hashlib.sha256(row["password_hash"].encode()).hexdigest(),
                    )
                ):
                    raise LocalAccessUnavailable("account.personal_locked")
                return dict(row)
        except IntegrityError:
            if attempt:
                raise LocalAccessUnavailable("account.personal_owner_unavailable") from None
    raise LocalAccessUnavailable("account.personal_owner_unavailable")


def bootstrap_personal_workspace():
    if not personal_request_allowed(bootstrap=True):
        return None
    principal = current_local_principal()
    if principal is not None:
        if principal.personal:
            _set_personal_session(_owner())
        return principal
    # A pending named-account second factor is never replaced by personal access.
    if session.get("pending_totp_user"):
        return None
    try:
        row = _owner()
        ttl = current_app.config.get("LOCAL_ACCOUNT_SESSION_SECONDS", 86400)
        if type(ttl) is not int or not 60 <= ttl <= 30 * 86400:
            raise LocalAccessUnavailable("account.invalid_session_lifetime")
        now = _now()
        raw = secrets.token_urlsafe(32)
        with user_db.engine.begin() as connection:
            connection.execute(
                delete(user_db.LocalAccountSession).where(
                    (user_db.LocalAccountSession.expires_at <= now)
                    | user_db.LocalAccountSession.revoked.is_(True)
                )
            )
            oldest = (
                connection.execute(
                    select(user_db.LocalAccountSession.token_hash)
                    .where(user_db.LocalAccountSession.user_uid == row["identity_uid"])
                    .order_by(user_db.LocalAccountSession.issued_at)
                    .limit(65)
                )
                .scalars()
                .all()
            )
            if len(oldest) >= 64:
                connection.execute(
                    delete(user_db.LocalAccountSession).where(
                        user_db.LocalAccountSession.token_hash.in_(oldest[: len(oldest) - 63])
                    )
                )
            connection.execute(
                insert(user_db.LocalAccountSession).values(
                    token_hash=hashlib.sha256(raw.encode()).hexdigest(),
                    user_uid=row["identity_uid"],
                    issued_at=now,
                    expires_at=now + ttl,
                    credential_fingerprint=personal_fingerprint(row),
                    revoked=False,
                )
            )
        g.local_account_cookie = (raw, ttl)
        g.local_account_cookie_clear = False
        _set_personal_session(row)
        from services.local_account_access import LocalPrincipal

        return LocalPrincipal(row["identity_uid"], "Local workspace", personal=True)
    except SQLAlchemyError as error:
        raise LocalAccessUnavailable("account.storage_unavailable") from error


def _set_personal_session(row):
    # Legacy app-only endpoints use this identity too, always paired with the
    # verified personal cookie by is_session_valid. There is no broker slot,
    # administrator role, broker credential or automatic API key.
    for name in ("broker", "api_key", "session_id"):
        session.pop(name, None)
    session["user"] = row["username"]
    session["logged_in"] = False
    session["chartly_local_guest"] = True
    session["chartly_personal_uid"] = row["identity_uid"]
    from utils.session import set_session_login_time

    set_session_login_time()


def clean_legacy_personal_session():
    """Remove old default-admin/broker masquerading; never issue authority on GET."""
    if not session.get("chartly_local_guest"):
        return
    principal = current_local_principal()
    if principal is not None and not principal.personal:
        session.pop("chartly_local_guest", None)
        session.pop("chartly_personal_uid", None)
        return
    if session.get("chartly_personal_uid") and personal_request_allowed():
        return
    for name in (
        "user",
        "logged_in",
        "broker",
        "api_key",
        "session_id",
        "login_time",
        "chartly_local_guest",
        "chartly_personal_uid",
    ):
        session.pop(name, None)
