"""Private local connector setup; P07 intentionally has no trading endpoint."""

from flask import Blueprint, jsonify, request
from flask_wtf.csrf import CSRFError
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from blueprints.local_data import (
    _error,
    _identifier,
    _json,
    _origin,
    _query,
    _revision,
    _run,
    _storage,
    enforce_local_request_limits,
)
from services.connector_adapters import AdapterError
from services.connector_history import data_only
from services.connectors import Connectors
from services.local_account_access import require_local_account
from services.local_personal_access import require_local_terminal_operator
from services.workspace_storage import WorkspaceError

connectors_bp = Blueprint("connectors", __name__, url_prefix="/api/local/v1/connectors")
ACTION_NAMES = {
    "create",
    "probe",
    "link",
    "sync",
    "disconnect",
    "revoke",
    "archive",
    "conformance",
    "configure",
    "set-secret",
    "apply-corrections",
}
MESSAGES = {
    "connector.operator_required": "Only this installation's local operator can attach its shared terminal. Ask the operator to set up that connection.",
    "connector.verify_and_review_required": "Recheck the connection and review the observed account before linking it.",
    "connector.verify_and_link_required": "Recheck the connection and link the observed account before reading its history.",
    "connector.observed_identity_changed": "The terminal is now showing a different account. Restore the original login and recheck this connection.",
    "connector.account_identity_mismatch": "This account's server, login, currency or environment differs from the observed source. Choose the matching account or create one from the verified observation.",
    "connector.ambiguous_account_selection": "More than one saved account matches this observation. Select the intended account explicitly; existing books will stay separate.",
    "connector.provider_unavailable": "This provider is not available for account setup yet. Review its access requirements; no account was connected.",
    "connector.retry_later": "The source has asked us to wait. Keep the saved connection and retry after its displayed wait time.",
    "connector.revision_conflict": "This connection changed in another request. Reload its saved state and review before trying again.",
    "connector.invalid_window": "Choose a past UTC history window of at most seven days. Longer outages can be recovered through successive overlapping windows.",
    "connector.credential_unavailable": "This saved credential cannot be opened with the installation's current vault key. Enter it again; no other credential will be substituted.",
    "connector.credential_expired": "The credential has expired. Replace it and recheck this connection.",
    "connector.credential_revoked": "This credential was revoked. Supply a current read-only credential and recheck the account.",
    "connector.vault_key_unavailable": "The local credential vault key is unavailable. Restore the installation's protected application key before saving credentials.",
    "connector.invalid_command": "Review the connection fields and try again. No trading action is available here.",
}


@connectors_bp.before_request
def boundary():
    enforce_local_request_limits()
    if request.endpoint != "connectors.providers" or request.headers.get("X-Chartly-Principal"):
        return require_local_account(lambda: None)()


@connectors_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@connectors_bp.errorhandler(WorkspaceError)
@connectors_bp.errorhandler(AdapterError)
def connector_error(error):
    if error.code in MESSAGES:
        return jsonify(
            {"error": {"code": error.code, "message": MESSAGES[error.code], "issues": []}}
        ), error.status
    return _error(error.code, error.status)


@connectors_bp.errorhandler(SQLAlchemyError)
@connectors_bp.errorhandler(OSError)
def unavailable(_value):
    return _error("storage.unavailable", 503)


@connectors_bp.errorhandler(BadRequest)
def bad_request(_value):
    return _error("request.invalid", 400)


@connectors_bp.errorhandler(CSRFError)
def csrf(_value):
    return _error("csrf.invalid", 400)


@connectors_bp.errorhandler(RequestEntityTooLarge)
def too_large(_value):
    return _error("request.too_large", 413)


def _integer(value, *, minimum=0, maximum=9007199254740991):
    if not isinstance(value, str) or not value.isascii() or not value.isdigit() or len(value) > 16:
        raise WorkspaceError("request.invalid_identity")
    number = int(value)
    if not minimum <= number <= maximum:
        raise WorkspaceError("request.invalid_identity")
    return number


def _operator_for_native(provider):
    if provider == "mt5":
        require_local_terminal_operator()


@connectors_bp.get("/providers")
def providers():
    _query()
    from services.connector_adapters import provider_catalog

    return jsonify({"providers": provider_catalog()})


@connectors_bp.get("")
@connectors_bp.get("/")
def listing():
    _query("originId", "profileId")
    args = {"origin": _origin(request.args.get("originId"), True)}
    if request.args.get("profileId") is not None:
        args["profile_id"] = _integer(request.args["profileId"], minimum=1)
    return jsonify(_run("connector_list", args))


@connectors_bp.get("/<connection_id>")
def detail(connection_id):
    _query("originId")
    return jsonify(
        _run(
            "connector_detail",
            {
                "origin": _origin(request.args.get("originId"), True),
                "connection_id": _identifier(connection_id),
            },
        )
    )


@connectors_bp.get("/<connection_id>/history")
def history(connection_id):
    _query("originId", "offset", "limit")
    return jsonify(
        _run(
            "connector_history",
            {
                "origin": _origin(request.args.get("originId"), True),
                "connection_id": _identifier(connection_id),
                "offset": _integer(request.args.get("offset", "0")),
                "limit": _integer(request.args.get("limit", "100"), minimum=1, maximum=200),
            },
        )
    )


@connectors_bp.post("/action")
def action():
    _query()
    body = _json(
        ("originId", "expectedRevision", "requestId", "action", "payload"), ("connectionId",)
    )
    name = body["action"]
    if not isinstance(name, str) or name not in ACTION_NAMES:
        raise WorkspaceError("connector.invalid_command")
    origin = _origin(body["originId"], True)
    connection_id = (
        _identifier(body["connectionId"]) if body.get("connectionId") is not None else None
    )
    if (name == "create") != (connection_id is None):
        raise WorkspaceError("connector.invalid_command")
    args = {
        "origin": origin,
        "connection_id": connection_id,
        "expected_revision": _revision(body["expectedRevision"]),
        "request_id": _identifier(body["requestId"]),
        "action": name,
        "payload": body["payload"],
    }
    if name == "set-secret":
        # Never serialize a plaintext credential to the bounded worker's temp request.
        return jsonify(Connectors(_storage()).action(**args))
    data_only(body["payload"], maximum=32768)
    if name == "create":
        _operator_for_native(
            body["payload"].get("providerId") if isinstance(body["payload"], dict) else None
        )
    elif name in {"probe", "sync", "conformance", "configure", "link"}:
        storage = _storage()
        service = Connectors(storage)
        with storage.engine.connect() as connection:
            record = service._load(connection, origin, connection_id)
        _operator_for_native(record["providerId"])
    return jsonify(_run("connector_action", args))
