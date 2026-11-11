"""Private local Strategy Builder API (P20 workspace backend).

Authoring and preview only: applying an indicator never arms execution
and no order endpoint exists here. All state changes carry explicit
bundle/draft revision tokens so concurrent edits fail closed.
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
    _revision,
    _storage,
    enforce_local_request_limits,
)
from services.local_account_access import require_local_account
from services.strategy_artifact_store import MAX_SOURCE_BYTES, StrategyArtifactStore
from services.strategy_artifacts import ArtifactError
from services.strategy_templates import list_templates
from services.workspace_storage import WorkspaceError

strategy_artifacts_bp = Blueprint(
    "strategy_artifacts", __name__, url_prefix="/api/local/v1/strategy-artifacts"
)
ACTION_NAMES = {
    "create",
    "create-from-template",
    "save-draft",
    "create-revision",
    "attach",
    "upgrade-attachment",
    "clone",
    "export",
    "import",
    "archive",
    "preview",
}
MESSAGES = {
    "artifact.draft_conflict": "This draft changed in another tab or request. Your editor text is retained — reload the saved draft, compare, then save again explicitly.",
    "artifact.draft_invalid": "This draft cannot become a revision yet. Fix the listed diagnostics; the draft itself is saved.",
    "artifact.project_archived": "This project is archived. Clone it to keep editing; saved revisions stay readable.",
    "artifact.attachment_kind_invalid": "Only indicators can be applied to a chart. Strategies run through experiments or deployments, never as chart studies.",
    "artifact.preview_code_only": "This revision is code-only for the rules preview. Use the code editor's compiler preview; nothing was converted or changed.",
    "artifact.package_corrupt": "This package does not match its checksum or contains altered sources. Nothing was imported.",
    "artifact.dependency_missing": "A required indicator/strategy revision is missing here. Import or create that dependency first.",
}


@strategy_artifacts_bp.before_request
def boundary():
    enforce_local_request_limits()
    return require_local_account(lambda: None)()


@strategy_artifacts_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@strategy_artifacts_bp.errorhandler(WorkspaceError)
@strategy_artifacts_bp.errorhandler(ArtifactError)
def artifact_error(error):
    status = getattr(error, "status", 400)
    if error.code in MESSAGES:
        return jsonify(
            {"error": {"code": error.code, "message": MESSAGES[error.code], "issues": []}}
        ), status
    return _error(error.code, status)


@strategy_artifacts_bp.errorhandler(SQLAlchemyError)
@strategy_artifacts_bp.errorhandler(OSError)
def unavailable(_value):
    return _error("storage.unavailable", 503)


@strategy_artifacts_bp.errorhandler(BadRequest)
def bad_request(_value):
    return _error("request.invalid", 400)


@strategy_artifacts_bp.errorhandler(CSRFError)
def csrf(_value):
    return _error("csrf.invalid", 400)


@strategy_artifacts_bp.errorhandler(RequestEntityTooLarge)
def too_large(_value):
    return _error("request.too_large", 413)


def _store():
    return StrategyArtifactStore(_storage())


def _summary(bundle):
    project = bundle["project"]
    return {
        "id": bundle["id"],
        "revision": bundle["revision"],
        "name": project["name"],
        "kind": project["kind"],
        "language": project["language"],
        "state": project["state"],
        "updatedAt": bundle["updatedAt"],
        "draftRevision": bundle["draft"]["draftRevision"],
        "diagnostics": bundle["draft"]["diagnostics"],
        "revisionCount": len(bundle["revisions"]),
    }


@strategy_artifacts_bp.get("/templates")
def templates():
    _query()
    return jsonify({"templates": list_templates()})


@strategy_artifacts_bp.get("")
@strategy_artifacts_bp.get("/")
def listing():
    _query("originId")
    origin = _origin(request.args.get("originId"), True)
    return jsonify({"projects": [_summary(row) for row in _store().list_projects(origin)]})


@strategy_artifacts_bp.get("/<project_id>")
def detail(project_id):
    _query("originId")
    origin = _origin(request.args.get("originId"), True)
    return jsonify({"project": _store().get_project(origin, _identifier(project_id))})


def _text(payload, field, maximum=200):
    value = payload.get(field)
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise WorkspaceError("artifact.invalid_command")
    return value


def _source(payload):
    source = payload.get("source")
    if isinstance(source, str) and len(source.encode()) > MAX_SOURCE_BYTES:
        raise WorkspaceError("artifact.source_budget", 413)
    if not isinstance(source, (str, dict)):
        raise WorkspaceError("artifact.invalid_command")
    return source


@strategy_artifacts_bp.post("/action")
def action():
    _query()
    body = _json(
        ("originId", "expectedRevision", "action", "payload"),
        ("projectId", "expectedDraftRevision"),
    )
    name = body["action"]
    if not isinstance(name, str) or name not in ACTION_NAMES:
        raise WorkspaceError("artifact.invalid_command")
    payload = body["payload"]
    if not isinstance(payload, dict):
        raise WorkspaceError("artifact.invalid_command")
    origin = _origin(body["originId"], True)
    expected = _revision(body["expectedRevision"])
    project_id = _identifier(body["projectId"]) if body.get("projectId") is not None else None
    creates = name in {"create", "create-from-template", "import"}
    if creates != (project_id is None):
        raise WorkspaceError("artifact.invalid_command")
    store = _store()

    if name == "create":
        bundle = store.create_project(
            origin,
            name=_text(payload, "name"),
            kind=_text(payload, "kind", 40),
            language=_text(payload, "language", 60),
            source=_source(payload),
        )
        return jsonify({"project": bundle})
    if name == "create-from-template":
        return jsonify({"project": store.create_from_template(origin, _text(payload, "templateId", 120))})
    if name == "import":
        package = payload.get("package")
        if not isinstance(package, dict):
            raise WorkspaceError("artifact.invalid_command")
        return jsonify({"project": store.import_project(origin, package)})
    if name == "save-draft":
        expected_draft = body.get("expectedDraftRevision")
        if type(expected_draft) is not int:
            raise WorkspaceError("artifact.invalid_command")
        return jsonify(
            {
                "project": store.save_draft(
                    origin,
                    project_id,
                    expected_revision=expected,
                    expected_draft_revision=expected_draft,
                    source=_source(payload),
                )
            }
        )
    if name == "create-revision":
        dependencies = payload.get("dependencyRevisionIds", [])
        if not isinstance(dependencies, list) or not all(
            isinstance(item, str) for item in dependencies
        ):
            raise WorkspaceError("artifact.invalid_command")
        return jsonify(
            {
                "project": store.create_revision(
                    origin,
                    project_id,
                    expected_revision=expected,
                    dependency_revision_ids=dependencies,
                )
            }
        )
    if name == "attach":
        return jsonify(
            {
                "project": store.attach_indicator(
                    origin,
                    project_id,
                    expected_revision=expected,
                    revision_id=_identifier(payload.get("revisionId")),
                    parameter_set_id=_identifier(payload.get("parameterSetId")),
                    chart_document_id=_identifier(payload.get("chartDocumentId")),
                )
            }
        )
    if name == "upgrade-attachment":
        return jsonify(
            {
                "project": store.upgrade_attachment(
                    origin,
                    project_id,
                    expected_revision=expected,
                    attachment_id=_identifier(payload.get("attachmentId")),
                    revision_id=_identifier(payload.get("revisionId")),
                    parameter_set_id=_identifier(payload.get("parameterSetId")),
                )
            }
        )
    if name == "clone":
        return jsonify({"project": store.clone_project(origin, project_id)})
    if name == "export":
        return jsonify({"package": store.export_project(origin, project_id)})
    if name == "archive":
        return jsonify(
            {"project": store.archive_project(origin, project_id, expected_revision=expected)}
        )
    if name == "preview":
        candles = payload.get("candles")
        if not isinstance(candles, list) or len(candles) > 5000:
            raise WorkspaceError("artifact.invalid_command")
        forming = payload.get("formingCandle")
        if forming is not None and not isinstance(forming, dict):
            raise WorkspaceError("artifact.invalid_command")
        return jsonify(
            store.preview_revision(
                origin,
                project_id,
                revision_id=_identifier(payload.get("revisionId")),
                parameter_set_id=_identifier(payload.get("parameterSetId")),
                candles=candles,
                forming_candle=forming,
            )
        )
    raise WorkspaceError("artifact.invalid_command")
