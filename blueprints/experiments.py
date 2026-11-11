"""Private local strategy experiment jobs (P20-T05 over the P21 core).

Submission pins an exact stored artifact revision + parameter set +
dataset version; the plan is compiled server-side from stored source,
never accepted from the client. Running a job is an explicit action —
nothing executes in the background and no result can arm an account.
"""

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

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
    _storage,
    enforce_local_request_limits,
)
from services.data_library import DataLibrary
from services.experiment_jobs import ExperimentJobStore
from services.local_account_access import require_local_account
from services.strategy_artifact_store import StrategyArtifactStore
from services.strategy_artifacts import RULES_FORMAT, ArtifactError
from services.strategy_rules import compile_plan
from services.workspace_storage import WorkspaceError

experiments_bp = Blueprint(
    "experiments", __name__, url_prefix="/api/local/v1/experiments"
)
ACTION_NAMES = {"submit", "run-next", "cancel", "recover"}
MESSAGES = {
    "experiment.engine_code_only": "This revision is code-only for the rules experiment engine. Nothing was converted; use a chartly-rules revision for saved experiments.",
    "experiment.queue_full": "Too many experiments are already queued. Run or cancel some before submitting more.",
    "experiment.cancel_unavailable": "Only a queued experiment can be cancelled. Running and finished jobs keep their recorded state.",
}


@experiments_bp.before_request
def boundary():
    enforce_local_request_limits()
    return require_local_account(lambda: None)()


@experiments_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@experiments_bp.errorhandler(WorkspaceError)
@experiments_bp.errorhandler(ArtifactError)
def experiment_error(error):
    status = getattr(error, "status", 400)
    if error.code in MESSAGES:
        return jsonify(
            {"error": {"code": error.code, "message": MESSAGES[error.code], "issues": []}}
        ), status
    return _error(error.code, status)


@experiments_bp.errorhandler(SQLAlchemyError)
@experiments_bp.errorhandler(OSError)
def unavailable(_value):
    return _error("storage.unavailable", 503)


@experiments_bp.errorhandler(BadRequest)
def bad_request(_value):
    return _error("request.invalid", 400)


@experiments_bp.errorhandler(CSRFError)
def csrf(_value):
    return _error("csrf.invalid", 400)


@experiments_bp.errorhandler(RequestEntityTooLarge)
def too_large(_value):
    return _error("request.too_large", 413)


def _unix(iso):
    try:
        return str(int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()))
    except (ValueError, AttributeError) as error:
        raise WorkspaceError("experiment.invalid_range") from error


def _exact(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        return format(Decimal(str(value)).normalize(), "f")
    except InvalidOperation:
        return None


def make_candle_loader(storage):
    """Resolve pinned dataset bars into simulator candles (exact text)."""

    def load(manifest):
        result = DataLibrary(storage).bars(
            manifest["datasetVersionId"],
            _unix(manifest["warmupStart"]),
            _unix(manifest["rangeEnd"]),
            50000,
        )
        candles = []
        for bar in result["bars"]:
            candle = {"time": bar["time"]}
            for field in ("open", "high", "low", "close", "volume"):
                text = _exact(bar.get(field))
                if text is not None:
                    candle[field] = text
            candles.append(candle)
        return candles

    return load


def _summary(bundle):
    return {
        "id": bundle["id"],
        "status": bundle["trial"]["status"],
        "artifactRevisionId": bundle["experiment"]["artifactRevisionId"],
        "createdAt": bundle["createdAt"],
        "updatedAt": bundle["updatedAt"],
        "failureCode": bundle["trial"].get("failureCode"),
    }


@experiments_bp.get("")
@experiments_bp.get("/")
def listing():
    _query("originId")
    origin = _origin(request.args.get("originId"), True)
    return jsonify(
        {"jobs": [_summary(row) for row in ExperimentJobStore(_storage()).list(origin)]}
    )


@experiments_bp.get("/<job_id>")
def detail(job_id):
    _query("originId")
    origin = _origin(request.args.get("originId"), True)
    return jsonify(
        {"job": ExperimentJobStore(_storage()).get(origin, _identifier(job_id))}
    )


def _text(payload, field, maximum=200):
    value = payload.get(field)
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise WorkspaceError("experiment.invalid_command")
    return value


def _submit(origin, payload):
    storage = _storage()
    artifacts = StrategyArtifactStore(storage)
    bundle = artifacts.get_project(origin, _identifier(payload.get("projectId")))
    revision_id = _identifier(payload.get("revisionId"))
    parameter_set_id = _identifier(payload.get("parameterSetId"))
    revision = next((row for row in bundle["revisions"] if row["id"] == revision_id), None)
    if revision is None:
        raise WorkspaceError("artifact.revision_not_found", 404)
    parameter_set = next(
        (row for row in bundle["parameterSets"] if row["id"] == parameter_set_id), None
    )
    if parameter_set is None or parameter_set["artifactRevisionId"] != revision_id:
        raise WorkspaceError("artifact.parameter_set_mismatch", 409)
    if revision["language"] != RULES_FORMAT:
        raise WorkspaceError("experiment.engine_code_only", 409)
    import json as _json_module

    source_text = bundle["sources"].get(revision["sourceArtifactId"])
    document = _json_module.loads(source_text)
    plan = compile_plan(document, parameter_set["values"])
    starting = payload.get("startingCash")
    if not isinstance(starting, dict):
        raise WorkspaceError("experiment.invalid_command")
    manifest = {
        "artifactRevisionId": revision_id,
        "parameterSetId": parameter_set_id,
        "datasetVersionId": _identifier(payload.get("datasetVersionId")),
        "instrumentId": _identifier(payload.get("instrumentId")),
        "costModelId": "costmodel-spot-v1",
        "fillPolicyId": "fillpolicy-next-open-1",
        "warmupStart": _text(payload, "warmupStart", 40),
        "rangeStart": _text(payload, "rangeStart", 40),
        "rangeEnd": _text(payload, "rangeEnd", 40),
        "startingCash": {
            "value": _text(starting, "value", 40),
            "currency": _text(starting, "currency", 12),
        },
        "costModel": {
            "feeBps": _text(payload, "feeBps", 20),
            "slippageBps": _text(payload, "slippageBps", 20),
        },
        "fillPolicy": {
            "timing": "next-bar-open",
            "sizing": {"mode": "fixed-fraction", "fraction": _text(payload, "fraction", 20)},
        },
        "quantityStep": _text(payload, "quantityStep", 40),
        "quantityScale": payload.get("quantityScale"),
        "entryOutput": _text(payload, "entryOutput", 80),
        "exitOutput": _text(payload, "exitOutput", 80),
        "seed": payload.get("seed"),
    }
    job = ExperimentJobStore(storage).submit(
        origin,
        request_id=_identifier(payload.get("requestId")),
        manifest=manifest,
        plan=plan,
    )
    return {"job": job}


@experiments_bp.post("/action")
def action():
    _query()
    body = _json(("originId", "action", "payload"), ("jobId",))
    name = body["action"]
    if not isinstance(name, str) or name not in ACTION_NAMES:
        raise WorkspaceError("experiment.invalid_command")
    payload = body["payload"]
    if not isinstance(payload, dict):
        raise WorkspaceError("experiment.invalid_command")
    origin = _origin(body["originId"], True)
    store = ExperimentJobStore(_storage())
    if name == "submit":
        return jsonify(_submit(origin, payload))
    if name == "run-next":
        job = store.run_next(origin, make_candle_loader(_storage()))
        return jsonify({"job": job})
    if name == "recover":
        return jsonify({"jobs": [_summary(row) for row in store.recover(origin)]})
    if name == "cancel":
        return jsonify({"job": store.cancel(origin, _identifier(body.get("jobId")))})
    raise WorkspaceError("experiment.invalid_command")
