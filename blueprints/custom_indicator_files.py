"""Local custom-indicator file API (create/edit/delete + LLM skill).

The chart serves indicator modules read-only from
``/custom-indicators/*``; this blueprint is the verified local
account's write path into the same folder, via
``services.custom_indicator_store`` — the one write path shared with
the agent tool and the MCP server. ``GET /skill`` serves the portable
SKILL.md a user can hand to their own LLM (Claude Code, Codex,
Cursor, ChatGPT) so it writes indicators in this format.
"""

from pathlib import Path

from flask import Blueprint, Response, jsonify
from flask_wtf.csrf import CSRFError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from blueprints.local_data import _error, _json, _query, enforce_local_request_limits
from services import custom_indicator_store as store
from services.local_account_access import require_local_account
from services.workspace_storage import WorkspaceError

custom_indicator_files_bp = Blueprint(
    "custom_indicator_files", __name__, url_prefix="/api/local/v1/custom-indicators"
)

_SKILL_PATH = (
    Path(__file__).resolve().parents[1]
    / "docs"
    / "skills"
    / "chartly-indicators"
    / "SKILL.md"
)


@custom_indicator_files_bp.before_request
def boundary():
    enforce_local_request_limits()
    return require_local_account(lambda: None)()


@custom_indicator_files_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@custom_indicator_files_bp.errorhandler(WorkspaceError)
def indicator_error(error):
    return _error(error.code, getattr(error, "status", 400))


@custom_indicator_files_bp.errorhandler(BadRequest)
def bad_request(_value):
    return _error("request.invalid", 400)


@custom_indicator_files_bp.errorhandler(CSRFError)
def csrf(_value):
    return _error("csrf.invalid", 400)


@custom_indicator_files_bp.errorhandler(RequestEntityTooLarge)
def too_large(_value):
    return _error("request.too_large", 413)


def _run(operation):
    try:
        return operation()
    except store.IndicatorInvalid as exc:
        raise WorkspaceError("custom_indicator.invalid", 400) from exc
    except store.IndicatorConflict as exc:
        raise WorkspaceError("custom_indicator.exists", 409) from exc
    except store.IndicatorMissing as exc:
        raise WorkspaceError("custom_indicator.missing", 404) from exc
    except OSError as exc:
        raise WorkspaceError("custom_indicator.storage_unavailable", 503) from exc


@custom_indicator_files_bp.get("")
@custom_indicator_files_bp.get("/")
def listing():
    _query()
    items = _run(lambda: store.list_indicators())
    return jsonify({"indicators": items, "count": len(items)})


@custom_indicator_files_bp.get("/skill")
def skill():
    _query()
    if not _SKILL_PATH.is_file():
        raise WorkspaceError("custom_indicator.missing", 404)
    return Response(
        _SKILL_PATH.read_text(encoding="utf-8"),
        mimetype="text/markdown; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="chartly-indicators-SKILL.md"'},
    )


@custom_indicator_files_bp.post("/preview")
def stage_preview():
    _query()
    body = _json(("source",))
    token = _run(lambda: store.stage_preview(body["source"]))
    return jsonify(
        {
            "preview": {
                "url": f"/api/local/v1/custom-indicators/preview/{token}.js",
                "expiresInSeconds": store.PREVIEW_TTL_SECONDS,
            }
        }
    ), 201


@custom_indicator_files_bp.get("/preview/<token>")
def preview_module(token):
    # Served same-origin so the browser may import() it under the app CSP
    # (script-src 'self'); the session cookie rides along automatically.
    _query()
    bare = token[: -len(".js")] if token.endswith(".js") else token
    source = _run(lambda: store.read_preview(bare))
    return Response(source, mimetype="text/javascript; charset=utf-8")


@custom_indicator_files_bp.get("/<name>")
def detail(name):
    _query()
    return jsonify({"indicator": _run(lambda: store.read_indicator(name))})


@custom_indicator_files_bp.post("")
@custom_indicator_files_bp.post("/")
def create():
    _query()
    body = _json(("filename", "source"), ("replace",))
    saved = _run(
        lambda: store.write_indicator(
            body["filename"], body["source"], replace=body.get("replace") is True
        )
    )
    return jsonify(
        {"saved": {"file": saved.file, "bytes": saved.bytes, "replaced": saved.replaced}}
    ), 201


@custom_indicator_files_bp.put("/<name>")
def update(name):
    _query()
    body = _json(("source",))
    saved = _run(lambda: store.write_indicator(name, body["source"], replace=True))
    return jsonify(
        {"saved": {"file": saved.file, "bytes": saved.bytes, "replaced": saved.replaced}}
    )


@custom_indicator_files_bp.delete("/<name>")
def remove(name):
    _query()
    return jsonify({"removed": _run(lambda: store.delete_indicator(name))})
