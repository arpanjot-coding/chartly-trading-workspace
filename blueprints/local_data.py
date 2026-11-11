"""Authenticated local workspace transport, separate from broker execution APIs."""

from __future__ import annotations

import json
import os
from io import BytesIO
from pathlib import Path

from flask import Blueprint, current_app, g, jsonify, request, send_file
from flask_wtf.csrf import CSRFError
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from database.workspace_storage_db import create_workspace_engine
from services.local_account_access import require_local_account
from services.workspace_storage import MAX_BYTES, WorkspaceError, WorkspaceStorage, valid_origin
from utils.keyed_locks import KeyedLocks

local_data_bp = Blueprint("local_data", __name__, url_prefix="/api/local/v1")
_engine_locks = KeyedLocks(name="local-workspace-initialization")
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
DEFAULT_JSON_BYTES = 64 * 1024 * 1024


def configure_local_storage(app):
    """Configure the engine without opening installed user data during imports."""
    default = "sqlite:///" + (Path(app.root_path) / "db" / "workspaces.db").as_posix()
    app.config.setdefault("LOCAL_DATA_DATABASE_URL", os.getenv("LOCAL_DATA_DATABASE_URL", default))
    app.config.setdefault("LOCAL_DATA_MAX_JSON_BYTES", DEFAULT_JSON_BYTES)


def _engine():
    app = current_app._get_current_object()
    configure_local_storage(app)
    with _engine_locks.hold(id(app)):
        cached = app.extensions.get("chartly_workspace_storage")
        url = app.config["LOCAL_DATA_DATABASE_URL"]
        if cached is None:
            from sqlalchemy.engine import make_url

            parsed = make_url(url)
            if (
                parsed.get_backend_name() != "sqlite"
                or not parsed.database
                or parsed.database == ":memory:"
                or parsed.database.startswith("file:")
                or parsed.query
            ):
                raise WorkspaceError("storage.configuration_unavailable", 503)
            database_path = Path(parsed.database).resolve()
            database_path.parent.mkdir(parents=True, exist_ok=True)
            normalized = parsed.set(database=database_path.as_posix()).render_as_string(
                hide_password=False
            )
            cached = {"url": url, "engine": create_workspace_engine(normalized)}
            app.extensions["chartly_workspace_storage"] = cached
        if cached["url"] != url:
            raise WorkspaceError("storage.configuration_changed", 503)
        return cached["engine"]


def _storage():
    return WorkspaceStorage(_engine(), g.local_principal.uid)


def _run(action, arguments=None, payload=None):
    from services.workspace_worker import run_workspace_action

    engine = _engine()  # Resolve relative paths before crossing the process boundary.
    return run_workspace_action(
        engine.url.render_as_string(hide_password=False),
        g.local_principal.uid,
        action,
        arguments or {},
        payload,
    )


def _error(code, status, issues=None):
    if code == "custom_indicator.invalid":
        message = (
            "That indicator file was refused: the name must be plain (for example "
            "my_sma.js) and the source must default-export a factory that calls "
            "registerIndicator, at most 256 kB. Your draft is retained."
        )
    elif code == "custom_indicator.exists":
        message = (
            "An indicator with that file name already exists. Choose a new name, "
            "or open the existing one to edit it; nothing was overwritten."
        )
    elif code == "custom_indicator.missing":
        message = "That custom indicator is not stored on this PC any more. Refresh the list."
    elif code == "custom_indicator.storage_unavailable":
        message = (
            "The indicators folder could not be written. Your draft is retained; "
            "check the strategies/indicators folder and retry."
        )
    elif code == "market.terminal_local_only":
        message = (
            "Open Chartly directly on the same PC as MetaTrader 5 to use its terminal account."
        )
    elif code == "connector.operator_required":
        message = "The local installation operator can use the terminal account."
    elif code == "market.account_changed":
        message = "Sign in to the MT5 account linked to this profile, then refresh."
    elif code == "mt5.profile_binding_required":
        message = "Verify and link an MT5 account in this profile’s Connections."
    elif code == "mt5.profile_binding_changed":
        message = "This workspace’s MT5 account link changed. Reopen the intended profile."
    elif code == "mt5.profile_binding_ambiguous":
        message = "Each live profile can have one linked MT5 account. Use a separate live profile for another account."
    elif code == "connector.terminal_not_allowlisted":
        message = (
            "This MetaTrader 5 installation is not approved in the local Chartly configuration. "
            "Add its terminal64.exe path to CHARTLY_MT5_TERMINAL_PATHS and restart Chartly."
        )
    elif code == "market.terminal_not_running":
        message = (
            "The selected MetaTrader 5 installation is unavailable. "
            "Run one terminal from that installation, sign in there, then retry."
        )
    elif code == "market.terminal_history_unavailable":
        message = (
            "MetaTrader 5 has no candles ready for this instrument and timeframe. "
            "Open its chart in MetaTrader 5 so the terminal can load its history, then retry here."
        )
    elif code == "market.symbol_unknown":
        message = "Choose the exact instrument name from the platform’s symbol search."
    elif code in ("market.credentials_required", "market.account_required"):
        message = (
            "This feed needs your own API credentials for that provider. "
            "Connect them and retry; nothing was fetched."
        )
    elif code == "market.provider_rate_limited":
        message = (
            "The market-data provider is rate-limiting requests right now. "
            "Wait a little and retry; nothing was saved."
        )
    elif code == "market.provider_authentication":
        message = (
            "The market-data provider rejected authentication. Check or renew its credentials."
        )
    elif code == "market.provider_access_denied":
        message = "The provider denied access. Check your market-data entitlement or regional availability."
    elif code in (
        "market.provider_unsupported",
        "market.symbols_unsupported",
        "market.account_unsupported",
    ):
        message = "This market-data provider does not offer the requested capability in Chartly."
    elif isinstance(code, str) and code.startswith("market.provider_"):
        message = (
            "The market-data provider could not be reached or returned "
            "unusable data. Nothing was saved; retry shortly."
        )
    elif code == "dataset.profile_history_required":
        message = (
            "Choose and review your own nonempty saved history before creating a replay project. "
            "Import candles in Data Library, then return to New profile and select that version. "
            "Existing legacy projects are retained."
        )
    elif code == "csrf.invalid":
        message = (
            "The security token is missing or expired. Refresh and retry; your draft is retained."
        )
    elif status == 503:
        message = (
            "Local storage is unavailable. Your draft is retained; retry when the engine is ready."
        )
    elif status == 409:
        message = "The saved data or review has changed. Refresh and review before retrying; keep your draft."
    elif status == 404:
        message = "The requested local record is unavailable."
    elif status == 413:
        message = "This upload exceeds the supported size. Keep the original file and use a smaller snapshot."
    else:
        message = "The local request could not be accepted. Review its fields and retry."
    return jsonify({"error": {"code": code, "message": message, "issues": issues or []}}), status


@local_data_bp.errorhandler(WorkspaceError)
def workspace_error(error):
    return _error(error.code, error.status, error.issues)


@local_data_bp.errorhandler(SQLAlchemyError)
@local_data_bp.errorhandler(OSError)
def storage_unavailable(_error_value):
    return _error("storage.unavailable", 503)


@local_data_bp.errorhandler(RequestEntityTooLarge)
def payload_too_large(_error_value):
    return _error("request.too_large", 413)


@local_data_bp.errorhandler(BadRequest)
def bad_request(_error_value):
    return _error("request.invalid", 400)


@local_data_bp.errorhandler(CSRFError)
def csrf_error(_error_value):
    return _error("csrf.invalid", 400)


def enforce_local_request_limits():
    """Run before global CSRF can parse an untrusted multipart request."""
    if not request.path.startswith("/api/local/v1/"):
        return
    configured = current_app.config.get("LOCAL_DATA_MAX_JSON_BYTES", DEFAULT_JSON_BYTES)
    if type(configured) is not int or not 1024 <= configured <= MAX_BYTES:
        raise WorkspaceError("storage.configuration_unavailable", 503)
    limit = (
        MAX_ARCHIVE_BYTES + 1024 * 1024
        if request.endpoint == "local_data.restore_preview"
        else configured
    )
    if request.path.startswith("/api/local/v1/paper/"):
        limit = min(limit, 128 * 1024)
    if request.path.startswith("/api/local/v1/connectors/"):
        limit = min(limit, 64 * 1024)
    if request.path.startswith("/api/local/v1/deployments"):
        limit = min(limit, 64 * 1024)
    if request.path.startswith(("/api/local/v1/strategy-artifacts/", "/api/local/v1/experiments/")):
        limit = min(limit, 2 * 1024 * 1024)
    request.max_content_length = limit
    request.max_form_memory_size = 1024 * 1024
    request.max_form_parts = 4
    if request.content_length is not None and request.content_length > limit:
        raise RequestEntityTooLarge()


@local_data_bp.before_request
@require_local_account
def local_account_and_limits():
    enforce_local_request_limits()


@local_data_bp.after_request
def private_response(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _query(*allowed):
    if set(request.args) - set(allowed) or any(
        len(request.args.getlist(key)) != 1 for key in request.args
    ):
        raise WorkspaceError("request.unknown_query_field")


def _origin(value, required=False):
    if value is None and not required:
        return None
    if not valid_origin(value):
        raise WorkspaceError("request.invalid_origin")
    return value


def _identifier(value):
    if not valid_origin(value):
        raise WorkspaceError("request.invalid_identity")
    return value


def _revision(value):
    if type(value) is not int or not 0 <= value <= 9_007_199_254_740_991:
        raise WorkspaceError("request.invalid_revision")
    return value


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise WorkspaceError("request.duplicate_json_key")
        result[key] = value
    return result


def _invalid_constant(_value):
    raise ValueError("non-finite JSON number")


def _json(required=(), optional=()):
    if not request.is_json:
        raise WorkspaceError("request.json_required")
    try:
        body = json.loads(
            request.get_data(cache=False),
            object_pairs_hook=_pairs,
            parse_constant=_invalid_constant,
        )
    except (ValueError, UnicodeError, RecursionError) as error:
        raise WorkspaceError("request.invalid_json") from error
    if (
        not isinstance(body, dict)
        or set(body) - set(required) - set(optional)
        or set(required) - set(body)
    ):
        raise WorkspaceError("request.invalid_fields")
    return body


@local_data_bp.get("/context")
def context():
    _query()
    return jsonify(_storage().context())


@local_data_bp.post("/setup")
def setup():
    _query()
    _json()
    return jsonify(_storage().setup())


@local_data_bp.get("/workspace")
def workspace():
    _query("originId")
    return jsonify(_run("workspace", {"origin": _origin(request.args.get("originId"))}))


@local_data_bp.get("/recovery/status")
def recovery_status():
    _query()
    return jsonify(_run("recovery_status"))


@local_data_bp.put("/workspace")
def save_workspace():
    _query("originId")
    body = _json(("expectedRevision", "tables", "requestId"))
    return jsonify(
        _run(
            "save_tables",
            {
                "origin": _origin(request.args.get("originId"), True),
                "tables": body["tables"],
                "expected_revision": _revision(body["expectedRevision"]),
                "request_id": _identifier(body["requestId"]),
            },
        )
    )


@local_data_bp.post("/migrations/preview")
def migration_preview():
    _query()
    body = _json(("snapshot",), ("nativeTargetNamespace",))
    return jsonify(
        _run(
            "migration_preview",
            {"snapshot": body["snapshot"], "native_target": body.get("nativeTargetNamespace")},
        )
    )


@local_data_bp.get("/migrations/<job_id>")
def migration_get(job_id):
    _query()
    result = _run("migration_get", {"id": _identifier(job_id)})
    return jsonify({key: value for key, value in result.items() if key != "snapshot"})


@local_data_bp.post("/migrations/<job_id>/commit")
def migration_commit(job_id):
    _query()
    body = _json(("resolutions", "requestId"))
    return jsonify(
        _run(
            "migration_commit",
            {
                "id": _identifier(job_id),
                "resolutions": body["resolutions"],
                "request_id": _identifier(body["requestId"]),
            },
        )
    )


@local_data_bp.put("/context/active")
def set_active():
    _query()
    body = _json(("originId",))
    return jsonify(_storage().set_active(_origin(body["originId"], True)))


@local_data_bp.put("/preferences")
def save_preferences():
    _query()
    body = _json(("originId", "preferences", "requestId", "expectedPreferences"))
    return jsonify(
        _run(
            "save_preferences",
            {
                "origin": _origin(body["originId"], True),
                "preferences": body["preferences"],
                "request_id": _identifier(body["requestId"]),
                "expected_preferences": body["expectedPreferences"],
            },
        )
    )


@local_data_bp.get("/native/<kind>")
def native_get(kind):
    _query("namespace", "originId")
    result = _run(
        "native",
        {
            "kind": kind,
            "namespace": request.args.get("namespace"),
            "origin": _origin(request.args.get("originId")),
        },
    )
    result["revision"] = result["catalog"]["revision"] if result.get("catalog") else 0
    return jsonify(result)


@local_data_bp.put("/native/<kind>")
def native_put(kind):
    _query()
    body = _json(("originId", "namespace", "catalog", "expectedCatalogRevision", "requestId"))
    result = _run(
        "save_native",
        {
            "kind": kind,
            "namespace": body["namespace"],
            "catalog": body["catalog"],
            "expected_revision": _revision(body["expectedCatalogRevision"]),
            "request_id": _identifier(body["requestId"]),
            "origin": _origin(body["originId"], True),
        },
    )
    result["revision"] = result["catalog"]["revision"]
    return jsonify(result)


@local_data_bp.get("/attachments/<attachment_id>")
def attachment(attachment_id):
    _query("originId")
    asset = _storage().attachment(_identifier(attachment_id), _origin(request.args.get("originId")))
    mime = asset["mime_type"]
    image = mime in {
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/avif",
    }
    response = send_file(
        BytesIO(asset["content"]),
        mimetype=mime if image else "application/octet-stream",
        as_attachment=not image,
        download_name="journal-attachment",
        conditional=False,
        max_age=0,
    )
    response.headers["Content-Security-Policy"] = "sandbox; default-src 'none'"
    return response


@local_data_bp.post("/backups")
def backup():
    _query("originId")
    origin = _origin(request.args.get("originId"))
    if origin is not None and origin not in {
        item["originId"] for item in _storage().context()["workspaces"]
    }:
        raise WorkspaceError("workspace.not_found", 404)
    if request.get_data(cache=False):
        raise WorkspaceError("request.unexpected_body")
    data = _run("backup")
    return send_file(
        BytesIO(data),
        mimetype="application/zip",
        as_attachment=True,
        download_name="chartly-workspace-backup.zip",
        conditional=False,
        max_age=0,
    )


@local_data_bp.post("/restores/preview")
def restore_preview():
    _query()
    if (
        set(request.files) != {"file"}
        or set(request.form) != {"expectedRevision"}
        or len(request.files.getlist("file")) != 1
        or len(request.form.getlist("expectedRevision")) != 1
    ):
        raise WorkspaceError("request.invalid_restore_fields")
    raw_revision = request.form["expectedRevision"]
    if not raw_revision.isascii() or not raw_revision.isdecimal() or len(raw_revision) > 16:
        raise WorkspaceError("request.invalid_revision")
    data = request.files["file"].stream.read(MAX_ARCHIVE_BYTES + 1)
    if len(data) > MAX_ARCHIVE_BYTES:
        raise RequestEntityTooLarge()
    return jsonify(
        _run("restore_preview", {"expected_revision": _revision(int(raw_revision))}, data)
    )


@local_data_bp.get("/restores/<job_id>")
def restore_get(job_id):
    _query()
    return jsonify(_run("restore_get", {"id": _identifier(job_id)}))


@local_data_bp.post("/restores/<job_id>/commit")
def restore_commit(job_id):
    _query()
    body = _json(("expectedRevision", "confirmationHash"), ("confirmOwner",))
    confirmation = body["confirmationHash"]
    if (
        not isinstance(confirmation, str)
        or len(confirmation) != 64
        or any(c not in "0123456789abcdef" for c in confirmation)
        or type(body.get("confirmOwner", False)) is not bool
    ):
        raise WorkspaceError("request.invalid_confirmation")
    return jsonify(
        _run(
            "restore_commit",
            {
                "job_id": _identifier(job_id),
                "expected_revision": _revision(body["expectedRevision"]),
                "confirmation_hash": confirmation,
                "confirm_owner": body.get("confirmOwner", False),
            },
        )
    )


@local_data_bp.post("/restores/copies/<copy_id>/preview")
def undo_preview(copy_id):
    _query()
    body = _json(("expectedRevision",))
    return jsonify(
        _run(
            "undo_preview",
            {
                "copy_id": _identifier(copy_id),
                "expected_revision": _revision(body["expectedRevision"]),
            },
        )
    )
