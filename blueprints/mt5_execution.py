"""Local operator order preview and submission for MT5 demo accounts."""

import os

from flask import Blueprint, current_app, g, jsonify, request
from flask_wtf.csrf import CSRFError, validate_csrf
from itsdangerous import BadSignature, URLSafeSerializer
from sqlalchemy.exc import SQLAlchemyError
from wtforms.validators import ValidationError

from blueprints.local_data import _error, _json, _query, _storage, enforce_local_request_limits
from services import mt5_execution
from services.connector_adapters import AdapterError
from services.local_account_access import require_local_account
from services.local_personal_access import require_local_terminal_operator
from services.mt5_binding import profile_mt5_binding
from services.workspace_storage import WorkspaceError

mt5_execution_bp = Blueprint("mt5_execution", __name__, url_prefix="/api/local/v1/mt5-orders")
MESSAGES = {
    "mt5.demo_send_disabled": "Demo submission is disabled on this installation.",
    "mt5.invalid_order": "Enter a valid direction and volume in lots.",
    "mt5.invalid_instrument": "Check the volume and the MT5 instrument settings.",
    "mt5.volume_grid": "Enter a lot size within this symbol's minimum, maximum and volume step.",
    "mt5.demo_trade_unavailable": "This ticket requires a demo account with trading and Python API trading enabled in MT5.",
    "mt5.quote_unavailable": "MT5 did not return a quote for this symbol. Check the symbol in MT5.",
    "mt5.quote_age_unverified": "The MT5 quote is stale or its time could not be verified. Wait for a fresh quote and check again.",
    "mt5.quote_spread_unavailable": "The MT5 spread is crossed or exceeds the demo limit. Wait for a valid spread.",
    "mt5.symbol_direction_unavailable": "MT5 does not allow a new market order in this direction on this symbol.",
    "mt5.unsupported_filling": "This instrument does not offer a supported market order fill policy.",
    "mt5.order_check_rejected": "MT5 did not accept the order check. Review the market session, lot size and account permissions.",
    "mt5.account_changed": "The terminal is signed in to a different account. Sign in to the account linked in this profile’s Connections and review again.",
    "mt5.quote_moved": "The quote moved. Review a new price before submitting.",
    "mt5.preview_expired": "This review expired. Check the order again.",
    "mt5.invalid_preview": "This order review is invalid for the current workspace.",
    "mt5.receipt_unavailable": "No saved receipt is available yet. Check the MT5 terminal for the order comment before submitting again.",
    "mt5.pending_intent": "This account has a demo order with an unresolved outcome. Reconcile that receipt first.",
    "mt5.invalid_order_ticket": "Enter the exact MT5 order ticket associated with this receipt.",
    "mt5.receipt_binding_unavailable": "This receipt has no saved account binding for automatic reconciliation. Review its order comment in MT5.",
    "mt5.receipt_evidence_unavailable": "MT5 has no matching final order and deal history yet. Check the order ticket in Toolbox and try again.",
    "connector.selected_terminal_not_running": "Open the MT5 terminal on this computer and sign in there.",
}


@mt5_execution_bp.before_request
@require_local_account
def boundary():
    enforce_local_request_limits()
    require_local_terminal_operator()
    if request.headers.get("X-Chartly-Principal") != g.local_principal.uid:
        raise WorkspaceError("account.scope_changed", 403)
    # Protect the money-moving endpoint even on installs that disable global CSRF.
    try:
        validate_csrf(request.headers.get("X-CSRFToken"))
    except ValidationError as error:
        raise CSRFError(str(error)) from None


@mt5_execution_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "private, no-store"
    return response


@mt5_execution_bp.errorhandler(WorkspaceError)
@mt5_execution_bp.errorhandler(AdapterError)
def rejected(error):
    if error.code not in MESSAGES:
        return _error(error.code, error.status)
    return jsonify(
        {
            "error": {
                "code": error.code,
                "message": MESSAGES[error.code],
                "issues": getattr(error, "issues", None) or [],
            }
        }
    ), error.status


@mt5_execution_bp.errorhandler(CSRFError)
def csrf(_error_value):
    return _error("csrf.invalid", 400)


@mt5_execution_bp.errorhandler(SQLAlchemyError)
def storage_failed(_error_value):
    return _error("storage.unavailable", 503)


def _serializer():
    return URLSafeSerializer(current_app.secret_key, salt="chartly-mt5-order-review-v1")


def _sending_enabled():
    return os.getenv("CHARTLY_MT5_DEMO_ORDERS", "false").lower() == "true"


@mt5_execution_bp.post("/preview")
def preview():
    _query()
    body = _json(("symbol", "side", "lots"), ("originId", "profileId"))
    storage = _storage()
    origin = body.pop("originId", None)
    profile = body.pop("profileId", None)
    binding = profile_mt5_binding(storage, origin, profile)
    review = mt5_execution.preview(**body, binding=binding, storage=storage)
    if binding != profile_mt5_binding(storage, origin, profile):
        raise WorkspaceError("mt5.profile_binding_changed", 409)
    token = _serializer().dumps({"owner": g.local_principal.uid, "review": review})
    return jsonify(
        {
            "review": {
                key: value for key, value in review.items() if key not in {"accountHash", "binding"}
            },
            "token": token,
            "sendAvailable": _sending_enabled(),
        }
    )


@mt5_execution_bp.post("/submit")
def submit():
    _query()
    if not _sending_enabled():
        raise WorkspaceError("mt5.demo_send_disabled", 403)
    token = _json(("token",))["token"]
    if not isinstance(token, str) or len(token) > 4096:
        raise WorkspaceError("mt5.invalid_preview", 400)
    try:
        payload = _serializer().loads(token)
    except BadSignature:
        raise WorkspaceError("mt5.invalid_preview", 400) from None
    if payload["owner"] != g.local_principal.uid:
        raise WorkspaceError("mt5.invalid_preview", 403)
    if "binding" not in payload["review"]:
        raise WorkspaceError("mt5.profile_binding_required", 409)
    return jsonify({"receipt": mt5_execution.submit(_storage(), payload["review"])})


@mt5_execution_bp.get("/receipts/<request_id>")
def receipt(request_id):
    _query()
    return jsonify({"receipt": mt5_execution.read_receipt(_storage(), request_id)})


@mt5_execution_bp.post("/receipts/<request_id>/reconcile")
def reconcile(request_id):
    _query()
    ticket = _json((), ("orderTicket",)).get("orderTicket")
    return jsonify({"receipt": mt5_execution.reconcile(_storage(), request_id, ticket)})
