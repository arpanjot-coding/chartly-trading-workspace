"""Strict local historical paper API, separate from broker execution."""

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
    enforce_local_request_limits,
)
from services.local_account_access import require_local_account
from services.workspace_storage import WorkspaceError, valid_id

paper_bp = Blueprint("paper", __name__, url_prefix="/api/local/v1/paper")


@paper_bp.before_request
@require_local_account
def account_boundary():
    enforce_local_request_limits()


@paper_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


MESSAGES = {
    "paper.journal_precision_unsupported": "The execution price or quantity exceeds the journal's 34-digit / 18-decimal precision. Review compatible economics or sizing; no financial state changed.",
    "paper.invalid_decimal": "Use plain base-10 numbers, without commas, currency symbols or exponent notation.",
    "paper.invalid_amount": "Review positive quantity, price, tick, multiplier and starting cash within the supported ranges.",
    "paper.economics_scale": "The quantity step and price tick must fit the decimal scales you explicitly reviewed.",
    "paper.money_scale": "Starting cash and per-fill fees must fit the account currency precision.",
    "paper.quantity_step": "Use a quantity that is an exact multiple of this run's declared quantity step.",
    "paper.price_tick": "Use a price that is an exact multiple of this run's declared price tick.",
    "paper.nonpositive_history_unsupported": "This linear paper model requires native prices above zero and no greater than 10^18. Review a compatible saved history window.",
    "paper.noncausal_calendar": "A declared candle closes before its timestamp. Correct the saved source calendar or timestamp mapping before preparing.",
    "paper.saved_history_required": "Choose an owned saved dataset for this run before preparing paper trading.",
    "paper.economics_required": "Review explicit quantity units, step, price tick, multiplier and currency precision.",
    "paper.source_mismatch": "The run, saved dataset and instrument assumptions do not match. Reopen its own history.",
    "paper.currency_conversion_unavailable": "Paper currency must match the saved instrument; currency conversion is unavailable.",
    "paper.calendar_unavailable": "This native history has no supported frozen close-time calendar. Review its calendar before preparing.",
    "paper.confirmed_history_required": "Choose a window with at least two confirmed native candles.",
    "paper.revision_conflict": "This paper session changed in another request. Reload and review before retrying; keep the pending command.",
    "paper.start_required": "Start the prepared paper session before submitting a decision or advancing it.",
    "paper.end_of_history": "There is no next saved candle. Finish and review; no closing fill will be invented.",
    "paper.finished": "This run is finished. Review it or create a separate branch to continue testing.",
    "paper.new_draft_required": "Prepare a new empty Draft; existing journal outcomes cannot be reassigned to another simulation.",
    "paper.branch_next_event_required": "Choose an earlier observed bar with at least one later eligible event.",
    "paper.archived_run": "Restore this archived run and its environment before continuing paper execution.",
}


@paper_bp.errorhandler(WorkspaceError)
def paper_error(error):
    if error.code in MESSAGES:
        return jsonify(
            {"error": {"code": error.code, "message": MESSAGES[error.code], "issues": error.issues}}
        ), error.status
    return _error(error.code, error.status, error.issues)


@paper_bp.errorhandler(SQLAlchemyError)
@paper_bp.errorhandler(OSError)
def unavailable(_error_value):
    return _error("storage.unavailable", 503)


@paper_bp.errorhandler(BadRequest)
def bad_request(_error_value):
    return _error("request.invalid", 400)


@paper_bp.errorhandler(RequestEntityTooLarge)
def too_large(_error_value):
    return _error("request.too_large", 413)


@paper_bp.errorhandler(CSRFError)
def csrf(_error_value):
    return _error("csrf.invalid", 400)


def _integer(value, minimum=0, maximum=9007199254740991):
    if not isinstance(value, str) or len(value) > 16 or not value.isascii() or not value.isdigit():
        raise WorkspaceError("request.invalid_identity")
    number = int(value)
    if not minimum <= number <= maximum:
        raise WorkspaceError("request.invalid_identity")
    return number


def _read_args():
    return {
        "origin": _origin(request.args.get("originId"), True),
        "run_id": _integer(request.args.get("runId"), 1),
    }


@paper_bp.get("/session")
def session():
    _query("originId", "runId")
    return jsonify(_run("paper_session", _read_args()))


@paper_bp.get("/report")
def report():
    _query("originId", "runId")
    return jsonify(_run("paper_report", _read_args()))


@paper_bp.get("/ledger")
def ledger():
    _query("originId", "runId", "offset", "limit")
    return jsonify(
        _run(
            "paper_ledger",
            {
                **_read_args(),
                "offset": _integer(request.args.get("offset", "0")),
                "limit": _integer(request.args.get("limit", "100"), 1, 500),
            },
        )
    )


@paper_bp.get("/compare")
def compare():
    _query("originId", "profileId", "runIds")
    raw = request.args.get("runIds", "")
    if not raw or len(raw) > 340:
        raise WorkspaceError("paper.invalid_comparison")
    return jsonify(
        _run(
            "paper_compare",
            {
                "origin": _origin(request.args.get("originId"), True),
                "profile_id": _integer(request.args.get("profileId"), 1),
                "run_ids": [_integer(value, 1) for value in raw.split(",")],
            },
        )
    )


@paper_bp.post("/action")
def action():
    _query()
    body = _json(("originId", "runId", "expectedRevision", "requestId", "action", "payload"))
    if not valid_id(body["runId"]):
        raise WorkspaceError("paper.invalid_run")
    return jsonify(
        _run(
            "paper_action",
            {
                "origin": _origin(body["originId"], True),
                "run_id": body["runId"],
                "expected_revision": _revision(body["expectedRevision"]),
                "request_id": _identifier(body["requestId"]),
                "action": body["action"],
                "payload": body["payload"],
            },
        )
    )
