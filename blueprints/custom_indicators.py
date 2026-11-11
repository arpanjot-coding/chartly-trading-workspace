"""
Custom Chart Indicators Blueprint.

Serves the user's own indicator modules from ``strategies/indicators`` to the
/trading chart, which imports each one at runtime and hands it the charting
library's registration API.

Why they are served rather than bundled: ``frontend/dist`` is built by CI from
what is in the repository, so anything compiled into the bundle has to be
committed first. User indicators are deliberately gitignored, which means a
bundled one would be wiped by the next ``git pull``. Loading them over HTTP at
runtime keeps them outside the build entirely, so they need no Node.js, no
rebuild, and survive an upgrade untouched.

The folder sits under ``strategies/`` because that is already the home for user
authored content and is the path Docker keeps on a named volume
(``chartly_strategies:/app/strategies``), so indicators persist across
container rebuilds for free.
"""

import re
from pathlib import Path

from flask import Blueprint, Response, jsonify, request

from services import custom_indicator_store as store
from utils.logging import get_logger
from utils.session import check_session_validity

logger = get_logger(__name__)

custom_indicators_bp = Blueprint("custom_indicators_bp", __name__, url_prefix="/custom-indicators")

INDICATORS_DIR = Path("strategies") / "indicators"

# An older chart uses a modification timestamp as the current-file alias.
_LEGACY_VERSION = re.compile(r"-?[0-9]{1,20}")


def _module_dir() -> Path:
    """The indicators directory, resolved against the app's working directory."""
    return INDICATORS_DIR.resolve()


@custom_indicators_bp.route("/index.json", methods=["GET"])
@check_session_validity
def index():
    """List the exact active content revisions, with mtime for older charts."""
    response = jsonify(store.module_index(_module_dir()))
    # Always revalidated: the list is what tells the chart a file was added,
    # removed or edited, so a cached copy would hide exactly those changes.
    response.headers["Cache-Control"] = "no-cache"
    return response


@custom_indicators_bp.route("/<path:filename>", methods=["GET"])
@check_session_validity
def module(filename: str):
    """Serve one indicator module as an ES module.

    The explicit mimetype matters: a dynamic ``import()`` refuses any response
    that is not a JavaScript MIME type, and the default guess for an unknown
    file would fail the import with an opaque error.
    """
    requested = request.args.get("v")
    legacy = requested is not None and _LEGACY_VERSION.fullmatch(requested) is not None
    version = None if legacy else requested
    try:
        payload = store.read_module(filename, version, _module_dir())
    except store.IndicatorInvalid as exc:
        return jsonify({"error": str(exc)}), 400
    except store.IndicatorMissing:
        return jsonify({"error": "Indicator version unavailable"}), 404
    except OSError:
        logger.exception("Could not load custom indicator %s", filename)
        return jsonify({"error": "Indicator storage unavailable"}), 503

    response = Response(payload, mimetype="text/javascript")
    response.headers["X-Content-Type-Options"] = "nosniff"
    if version is not None:
        response.headers["Cache-Control"] = "private, max-age=31536000, immutable"
        response.set_etag(version)
        response.make_conditional(request)
    elif legacy:
        response.headers["Cache-Control"] = "private, no-store"
    else:
        response.headers["Cache-Control"] = "no-cache"
    return response
