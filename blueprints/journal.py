"""P03 local journal APIs. All authority comes from verified local proof."""

from __future__ import annotations

import base64
import json
from io import BytesIO

from flask import Blueprint, jsonify, request, send_file
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

journal_bp = Blueprint("journal", __name__, url_prefix="/api/local/v1/journal")


@journal_bp.before_request
@require_local_account
def account_boundary():
    enforce_local_request_limits()


@journal_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


MESSAGES = {
    "chart.invalid_evidence": "The captured chart details could not be verified. Capture the current chart again.",
    "chart.invalid_image": "Capture a valid chart PNG image no larger than 8 MiB.",
    "chart.image_budget": "This image is too large. Capture a smaller chart view, up to 8 MiB.",
    "chart.invalid_target": "Choose the journal trade or run to receive this chart.",
    "chart.target_mismatch": "The selected record no longer belongs to this chart environment. Reopen it and choose the destination again.",
    "chart.instrument_mismatch": "Choose a record for the instrument shown on the chart.",
    "chart.source_mismatch": "This chart does not match the run’s saved history. Open the run’s pinned chart and capture it again.",
    "chart.asset_budget": "This saved workspace has reached its chart-image limit. Export its backup before preparing another workspace.",
    "chart.evidence_limit": "This record already has 20 chart captures. Earlier evidence is retained.",
    "chart.evidence_metadata_budget": "The chart notes and view details exceed this record’s limit. Shorten the notes before retrying.",
    "chart.invalid_view_time": "The captured chart time range is invalid. Capture the current chart again.",
    "chart.invalid_timezone": "Choose a supported chart timezone before capturing evidence.",
    "journal.amounts_do_not_reconcile": "Known amounts must reconcile: net P&L = gross P&L − commission − fees + signed swap. Leave genuinely unknown components blank.",
    "journal.correction_reason_required": "Enter a reason for changing recorded execution facts.",
    "journal.correction_changes_position_state": "The corrected quantities change the open/closed status. Confirm that status change before saving.",
    "journal.realized_amount_requires_exit_correction": "Correct the recorded exit to change its realized P&L or costs.",
    "journal.timestamp_offset_required": "Choose an explicit timezone and resolve the trade time before saving.",
    "journal.open_trade_has_close_time": "An open trade must have no close time.",
    "journal.open_pnl_requires_exit": "Record a partial or final exit before entering realized P&L on an open trade.",
    "journal.closed_pnl_required": "A closed trade needs an explicit realized net P&L.",
    "journal.close_before_open": "Exit times must follow the entry and any earlier exits.",
    "journal.exit_exceeds_position": "Exit quantity exceeds the remaining position.",
    "journal.known_quantity_required": "Enter the known position quantity before recording a partial exit.",
    "journal.manual_book_required": "Manual financial edits belong to this environment’s manual book.",
    "trade.source_fact_locked": "Source financial facts are read-only. Correct the statement through reviewed import; your notes are retained.",
    "journal.import_has_errors": "Resolve every statement row and source identity conflict before committing.",
    "journal.corrections_require_confirmation": "Review and explicitly accept source corrections before committing.",
    "journal.invalid_decimal": "Use plain base-10 numbers within the supported precision, without currency symbols or exponent notation.",
    "journal.invalid_attachment": "Choose a supported image/PDF no larger than 8 MiB.",
    "journal.attachment_type_mismatch": "The file contents do not match its declared image/PDF type.",
}


@journal_bp.errorhandler(WorkspaceError)
def journal_error(error):
    response, status = _error(error.code, error.status, error.issues)
    if error.code in MESSAGES:
        value = response.get_json()
        value["error"]["message"] = MESSAGES[error.code]
        response.set_data(json.dumps(value))
    return response, status


@journal_bp.errorhandler(SQLAlchemyError)
@journal_bp.errorhandler(OSError)
def unavailable(_error_value):
    return _error("storage.unavailable", 503)


@journal_bp.errorhandler(CSRFError)
def csrf(_error_value):
    return _error("csrf.invalid", 400)


@journal_bp.errorhandler(RequestEntityTooLarge)
def too_large(_error_value):
    return _error("request.too_large", 413)


@journal_bp.errorhandler(BadRequest)
def bad_request(_error_value):
    return _error("request.invalid", 400)


def _number(value):
    if isinstance(value, str) and len(value) <= 16 and value.isascii() and value.isdecimal():
        value = int(value)
    if not valid_id(value):
        raise WorkspaceError("journal.invalid_numeric_id")
    return value


@journal_bp.get("")
@journal_bp.get("/")
def state():
    _query("originId")
    return jsonify(_run("journal_state", {"origin": _origin(request.args.get("originId"), True)}))


@journal_bp.get("/trades/<int:trade_id>")
def detail(trade_id):
    _query("originId")
    return jsonify(
        _run(
            "journal_detail",
            {"origin": _origin(request.args.get("originId"), True), "trade_id": _number(trade_id)},
        )
    )


@journal_bp.post("/actions")
def action():
    _query()
    body = _json(("originId", "expectedRevision", "requestId", "action", "payload"))
    if not isinstance(body["action"], str) or len(body["action"]) > 50:
        raise WorkspaceError("journal.invalid_action")
    return jsonify(
        _run(
            "journal_action",
            {
                "origin": _origin(body["originId"], True),
                "expected_revision": _revision(body["expectedRevision"]),
                "request_id": _identifier(body["requestId"]),
                "action": body["action"],
                "payload": body["payload"],
            },
        )
    )


@journal_bp.post("/imports/preview")
def import_preview():
    _query()
    body = _json(
        ("originId", "portfolioId", "bookId", "provider", "csvText", "mapping", "expectedRevision"),
        ("accountId",),
    )
    return jsonify(
        _run(
            "journal_import_preview",
            {
                "origin": _origin(body["originId"], True),
                "portfolio_id": _number(body["portfolioId"]),
                "book_id": _identifier(body["bookId"]),
                "provider": body["provider"],
                "csv_text": body["csvText"],
                "mapping": body["mapping"],
                "expected_revision": _revision(body["expectedRevision"]),
                "account_id": _number(body["accountId"])
                if body.get("accountId") is not None
                else None,
            },
        )
    )


@journal_bp.post("/imports/<job_id>/commit")
def import_commit(job_id):
    _query()
    body = _json(("expectedRevision", "requestId", "acceptCorrections"))
    return jsonify(
        _run(
            "journal_import_commit",
            {
                "id": _identifier(job_id),
                "expected_revision": _revision(body["expectedRevision"]),
                "request_id": _identifier(body["requestId"]),
                "accept_corrections": body["acceptCorrections"],
            },
        )
    )


@journal_bp.get("/imports/<job_id>")
def import_get(job_id):
    _query("originId")
    return jsonify(
        _run(
            "journal_import_get",
            {"id": _identifier(job_id), "origin": _origin(request.args.get("originId"), True)},
        )
    )


@journal_bp.post("/imports/<job_id>/repreview")
def import_repreview(job_id):
    _query()
    body = _json(("expectedRevision",))
    return jsonify(
        _run(
            "journal_import_repreview",
            {"id": _identifier(job_id), "expected_revision": _revision(body["expectedRevision"])},
        )
    )


@journal_bp.post("/attachments")
def attachment():
    _query()
    body = _json(("originId", "expectedRevision", "requestId", "tradeId", "mimeType", "base64"))
    return jsonify(
        _run(
            "journal_attachment",
            {
                "origin": _origin(body["originId"], True),
                "expected_revision": _revision(body["expectedRevision"]),
                "request_id": _identifier(body["requestId"]),
                "trade_id": _number(body["tradeId"]),
                "mime_type": body["mimeType"],
                "content_base64": body["base64"],
            },
        )
    )


@journal_bp.post("/chart-evidence")
def chart_evidence():
    _query()
    body = _json(
        ("originId", "expectedRevision", "requestId", "target", "mimeType", "base64", "capture"),
        ("annotations",),
    )
    return jsonify(
        _run(
            "journal_chart_evidence",
            {
                "origin": _origin(body["originId"], True),
                "expected_revision": _revision(body["expectedRevision"]),
                "request_id": _identifier(body["requestId"]),
                "target": body["target"],
                "mime_type": body["mimeType"],
                "content_base64": body["base64"],
                "capture": body["capture"],
                "annotations": body.get("annotations", ""),
            },
        )
    )


@journal_bp.get("/export")
def export():
    _query("originId", "portfolioId", "bookId", "format")
    result = _run(
        "journal_export",
        {
            "origin": _origin(request.args.get("originId"), True),
            "portfolio_id": _number(request.args.get("portfolioId")),
            "book_id": _identifier(request.args.get("bookId")),
            "format": request.args.get("format", "json"),
        },
    )
    return send_file(
        BytesIO(base64.b64decode(result["base64"], validate=True)),
        mimetype=result["mimeType"],
        as_attachment=True,
        download_name=result["filename"],
        conditional=False,
        max_age=0,
    )
