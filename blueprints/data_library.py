"""Local Data Library routes: verified principal, bounded workers and no execution gate."""

import base64
import json
from io import BytesIO

from flask import Blueprint, g, jsonify, request, send_file
from flask_wtf.csrf import CSRFError
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from blueprints.local_data import (
    _error,
    _identifier,
    _json,
    _query,
    _revision,
    _run,
    enforce_local_request_limits,
)
from services.local_account_access import require_local_account
from services.local_personal_access import require_local_terminal_operator
from services.workspace_storage import WorkspaceError

data_library_bp = Blueprint("data_library", __name__, url_prefix="/api/local/v1/datasets")


@data_library_bp.before_request
@require_local_account
def boundary():
    enforce_local_request_limits()


@data_library_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@data_library_bp.errorhandler(WorkspaceError)
def invalid(error):
    response, status = _error(error.code, error.status, error.issues)
    messages = {
        "dataset.kraken_no_closed_candles": "Kraken returned no closed candles for this pair. Choose another pair or retry later; nothing was saved.",
        "dataset.kraken_rate_limited": "Kraken asked us to wait. Retry this explicit preview later; no automatic collector was started.",
        "dataset.kraken_unavailable": "Kraken public data is temporarily unavailable. CSV import and saved history remain available.",
        "dataset.kraken_instrument_unavailable": "This Kraken spot pair is no longer available. Refresh the instrument search and choose an online pair.",
        "dataset.kraken_invalid_response": "The public response could not be verified. No guessed candles were saved; retry later or use a source file.",
        "dataset.kraken_invalid_candle": "Kraken returned candle values that could not be verified. Nothing was staged; retry later or import a source file.",
        "dataset.kraken_future_closed_candle": "The returned candle timing could not be verified against UTC. Nothing was staged; retry later or use saved history.",
        "dataset.kraken_instrument_mismatch": "The returned public candles do not match the selected instrument. Refresh the source and choose the pair again.",
        "dataset.kraken_response_budget": "The public response exceeds this source's supported budget. Saved history is unchanged.",
        "dataset.revision_conflict": "The Data Library changed. Preview the retained source again before publishing; your draft is preserved.",
        "dataset.rejected_rows_require_confirmation": "Review the rejected rows and explicitly accept publishing only the valid rows.",
        "dataset.file_missing_or_changed": "This saved history file is missing or has changed. Restore its dataset bundle; workspace journal backups do not contain candle files.",
        "dataset.import_has_errors": "Resolve conflicting or invalid source rows before publishing a history version.",
        "dataset.invalid_bundle": "This dataset bundle could not be verified. Keep the original file and use an unmodified exported bundle.",
        "dataset.provider_not_connected": "Connect the current local account’s history provider before downloading. CSV import and saved charts work independently.",
        "dataset.feed_time_unverified": "MetaTrader 5 bar times could not be aligned safely to UTC from the measured terminal offset. Nothing was staged; use an intraday interval or import verified history.",
        "dataset.feed_no_closed_candles": "This feed returned no closed candles to stage. Choose another symbol, interval or window; nothing was saved.",
        "dataset.feed_invalid_candle": "This feed returned candle values or timestamps that could not be verified. Nothing was staged.",
        "dataset.feed_provider_not_supported": "This provider cannot be downloaded into saved history here. Choose a supported chart-data provider.",
        "dataset.feed_interval_not_supported": "This feed does not support the selected interval. Choose another interval; Chartly will not approximate it.",
    }
    message = messages.get(error.code)
    if not message and error.issues and error.status == 400:
        message = error.issues[0].get("message")
    if message:
        value = response.get_json()
        value["error"]["message"] = message
        response.set_data(json.dumps(value))
    return response, status


@data_library_bp.errorhandler(SQLAlchemyError)
@data_library_bp.errorhandler(OSError)
def unavailable(error):
    return _error("dataset.storage_unavailable", 503)


@data_library_bp.errorhandler(CSRFError)
def csrf(error):
    return _error("csrf.invalid", 400)


@data_library_bp.errorhandler(BadRequest)
def bad_request(error):
    return _error("request.invalid", 400)


@data_library_bp.errorhandler(RequestEntityTooLarge)
def oversized(error):
    return _error("request.too_large", 413)


def _result(action, arguments=None):
    value = _run(action, arguments)
    from services.dataset_provider import capabilities

    if action == "dataset_catalog":
        value["capabilities"]["downloads"] = capabilities(g.local_principal.uid)
    elif "catalog" in value:
        value["catalog"]["capabilities"]["downloads"] = capabilities(g.local_principal.uid)
    return jsonify(value)


def _bounded_int(value, default, maximum=50000):
    if value is None:
        return default
    if not isinstance(value, str) or not value.isascii() or not value.isdecimal() or len(value) > 6:
        raise WorkspaceError("dataset.invalid_query")
    value = int(value)
    if value > maximum:
        raise WorkspaceError("dataset.invalid_query")
    return value


@data_library_bp.get("/sources/kraken/instruments")
def kraken_instruments():
    _query("q", "limit")
    return _result(
        "dataset_kraken_instruments",
        {
            "query": request.args.get("q", ""),
            "limit": _bounded_int(request.args.get("limit"), 50, 50),
        },
    )


@data_library_bp.post("/sources/kraken/preview")
def kraken_preview():
    _query()
    body = _json(("expectedRevision", "pair", "interval"))
    return _result(
        "dataset_kraken_preview",
        {
            "expected_revision": _revision(body["expectedRevision"]),
            "pair": body["pair"],
            "interval": body["interval"],
        },
    )


@data_library_bp.post("/sources/feed/preview")
def feed_preview():
    _query()
    body = _json(
        ("expectedRevision", "provider", "symbol", "interval"),
        ("limit", "start", "end"),
    )
    if isinstance(body["provider"], str) and body["provider"].strip().lower() == "mt5":
        require_local_terminal_operator()
    return _result(
        "dataset_feed_preview",
        {
            "expected_revision": _revision(body["expectedRevision"]),
            "provider": body["provider"],
            "symbol": body["symbol"],
            "interval": body["interval"],
            "limit": body.get("limit", 500),
            "start": body.get("start"),
            "end": body.get("end"),
        },
    )


@data_library_bp.get("")
@data_library_bp.get("/")
def catalog():
    _query("offset")
    return _result("dataset_catalog", {"offset": _bounded_int(request.args.get("offset"), 0, 2000)})


@data_library_bp.get("/versions/<id>")
def detail(id):
    _query()
    return _result("dataset_detail", {"id": _identifier(id)})


@data_library_bp.get("/versions/<id>/bars")
def bars(id):
    _query("from", "to", "limit")
    return _result(
        "dataset_bars",
        {
            "id": _identifier(id),
            "start": request.args.get("from"),
            "end": request.args.get("to"),
            "limit": _bounded_int(request.args.get("limit"), 5000),
        },
    )


@data_library_bp.post("/imports/preview")
def preview():
    _query()
    body = _json(("expectedRevision", "csvText", "mapping", "context"), ("baseVersionId",))
    return _result(
        "dataset_preview",
        {
            "expected_revision": _revision(body["expectedRevision"]),
            "csv_text": body["csvText"],
            "mapping": body["mapping"],
            "context": body["context"],
            "base_version_id": _identifier(body["baseVersionId"])
            if body.get("baseVersionId")
            else None,
        },
    )


@data_library_bp.get("/imports/<id>")
def import_job(id):
    _query()
    return _result("dataset_import_get", {"id": _identifier(id)})


@data_library_bp.post("/imports/<id>/repreview")
def repreview(id):
    _query()
    body = _json(("expectedRevision",))
    return _result(
        "dataset_repreview",
        {"id": _identifier(id), "expected_revision": _revision(body["expectedRevision"])},
    )


@data_library_bp.post("/imports/<id>/commit")
def commit(id):
    _query()
    body = _json(("expectedRevision", "requestId", "policy", "allowRejectedRows"))
    return _result(
        "dataset_commit",
        {
            "id": _identifier(id),
            "expected_revision": _revision(body["expectedRevision"]),
            "request_id": _identifier(body["requestId"]),
            "policy": body["policy"],
            "allow_rejected_rows": body["allowRejectedRows"],
        },
    )


@data_library_bp.post("/versions/<id>/archive")
@data_library_bp.post("/versions/<id>/restore")
def archive(id):
    _query()
    body = _json(("expectedRevision", "requestId"))
    return _result(
        "dataset_archive",
        {
            "id": _identifier(id),
            "expected_revision": _revision(body["expectedRevision"]),
            "request_id": _identifier(body["requestId"]),
            "restore": request.path.endswith("/restore"),
        },
    )


@data_library_bp.get("/versions/<id>/export")
def export(id):
    _query("format")
    value = _run(
        "dataset_export", {"id": _identifier(id), "format": request.args.get("format", "bundle")}
    )
    return send_file(
        BytesIO(base64.b64decode(value["base64"])),
        mimetype=value["mimeType"],
        as_attachment=True,
        download_name=value["filename"],
        max_age=0,
    )


@data_library_bp.post("/bundles/preview")
def bundle_preview():
    _query()
    body = _json(("expectedRevision", "base64"))
    return _result(
        "dataset_bundle_preview",
        {"expected_revision": _revision(body["expectedRevision"]), "base64_data": body["base64"]},
    )


@data_library_bp.get("/bundles/<id>")
def bundle_job(id):
    _query()
    return _result("dataset_bundle_get", {"id": _identifier(id)})


@data_library_bp.post("/bundles/<id>/repreview")
def bundle_repreview(id):
    _query()
    body = _json(("expectedRevision",))
    return _result(
        "dataset_bundle_repreview",
        {"id": _identifier(id), "expected_revision": _revision(body["expectedRevision"])},
    )


@data_library_bp.post("/bundles/<id>/commit")
def bundle_commit(id):
    _query()
    body = _json(("expectedRevision", "requestId"))
    return _result(
        "dataset_bundle_commit",
        {
            "id": _identifier(id),
            "expected_revision": _revision(body["expectedRevision"]),
            "request_id": _identifier(body["requestId"]),
        },
    )


@data_library_bp.post("/downloads")
def download_create():
    _query()
    body = _json(
        ("expectedRevision", "requestId", "context", "mapping", "startAt", "endAt"),
        ("chunkSeconds",),
    )
    from services.dataset_provider import capabilities

    capability = capabilities(g.local_principal.uid)
    if not capability["available"]:
        raise WorkspaceError("dataset.provider_not_connected", 409)
    context = body["context"]
    if (
        not isinstance(context, dict)
        or context.get("provider") != capability["provider"]
        or context.get("interval") not in capability["intervals"]
    ):
        raise WorkspaceError("dataset.provider_binding_mismatch", 409)
    return _result(
        "dataset_download_create",
        {
            "expected_revision": _revision(body["expectedRevision"]),
            "request_id": _identifier(body["requestId"]),
            "context": context,
            "mapping": body["mapping"],
            "start_at": body["startAt"],
            "end_at": body["endAt"],
            "chunk_seconds": body.get("chunkSeconds", 86400),
        },
    )


@data_library_bp.get("/downloads/<id>")
def download_detail(id):
    _query()
    return _result("dataset_download_get", {"id": _identifier(id)})


@data_library_bp.post("/downloads/<id>/step")
def download_step(id):
    _query()
    body = _json(("expectedRevision", "requestId"))
    return _result(
        "dataset_download_step",
        {
            "id": _identifier(id),
            "expected_revision": _revision(body["expectedRevision"]),
            "request_id": _identifier(body["requestId"]),
        },
    )


@data_library_bp.post("/downloads/<id>/control")
def download_control(id):
    _query()
    body = _json(("expectedRevision", "requestId", "command"))
    return _result(
        "dataset_download_control",
        {
            "id": _identifier(id),
            "expected_revision": _revision(body["expectedRevision"]),
            "request_id": _identifier(body["requestId"]),
            "command": body["command"],
        },
    )
