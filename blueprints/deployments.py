"""Deployment draft/lifecycle APIs (P20-T06/T08 over P17 core).

The local runtime here is a process-local lifecycle tracker: it owns
start/stop state for draft validation and duplicate-start refusal.
Real strategy processes attach behind the same runtime interface;
order writes always go through P11 destinations, never this API.
"""

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
from services.deployments import DeploymentService
from services.local_account_access import require_local_account
from services.workspace_storage import WorkspaceError

deployments_bp = Blueprint("deployments", __name__, url_prefix="/api/local/v1/deployments")


class LocalRuntime:
    """Process-local runtime states; durable truth is the record."""

    def __init__(self):
        self.states = {}

    def start(self, deployment):
        self.states[deployment["id"]] = "running"

    def stop(self, deployment):
        self.states[deployment["id"]] = "stopped"

    def probe(self, deployment):
        return self.states.get(deployment["id"], "stopped")


_RUNTIME = LocalRuntime()


def _service():
    return DeploymentService(_storage(), _RUNTIME)


@deployments_bp.before_request
def boundary():
    enforce_local_request_limits()
    return require_local_account(lambda: None)()


@deployments_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@deployments_bp.errorhandler(WorkspaceError)
def deployment_error(error):
    return _error(error.code, getattr(error, "status", 400))


@deployments_bp.errorhandler(SQLAlchemyError)
@deployments_bp.errorhandler(OSError)
def unavailable(_value):
    return _error("storage.unavailable", 503)


@deployments_bp.errorhandler(BadRequest)
def bad_request(_value):
    return _error("request.invalid", 400)


@deployments_bp.errorhandler(CSRFError)
def csrf(_value):
    return _error("csrf.invalid", 400)


@deployments_bp.errorhandler(RequestEntityTooLarge)
def too_large(_value):
    return _error("request.too_large", 413)


@deployments_bp.get("")
def list_deployments():
    _query("originId")
    origin = _origin(request.args.get("originId"), True)
    return jsonify({"deployments": _service().list(origin)})


@deployments_bp.post("/action")
def deployment_action():
    body = _json(("originId", "action", "payload"), ("deploymentId",))
    origin = _origin(body["originId"], True)
    action = body["action"]
    payload = body["payload"]
    service = _service()
    if action == "create":
        record = service.create(
            origin,
            artifact_revision=payload["artifactRevision"],
            destination=payload["destination"],
            label=payload.get("label", "Deployment"),
        )
        return jsonify({"deployment": record}), 201
    deployment_id = _identifier(body.get("deploymentId") or "")
    if action == "start":
        return jsonify({"deployment": service.start(origin, deployment_id)})
    if action == "stop":
        return jsonify({"deployment": service.stop(origin, deployment_id)})
    if action == "upgrade":
        return jsonify(
            {"deployment": service.upgrade(origin, deployment_id, payload["artifactRevision"])}
        )
    if action == "rollback":
        return jsonify({"deployment": service.rollback(origin, deployment_id)})
    if action == "reconcile":
        return jsonify(service.reconcile(origin, deployment_id))
    raise WorkspaceError("deployment.action_unsupported", 400)
