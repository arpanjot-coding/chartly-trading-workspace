"""Market-data feed APIs: keyless crypto/Dukascopy + client-keyed OANDA.

Read-only by construction — this blueprint exposes candles and latest
quotes from ``services.market_feeds``. The OANDA token arrives in a
request header, is used for that single upstream call, and is never
stored, echoed, or logged here. One caller's keyed feed is never
cached for another caller.
"""

from flask import Blueprint, jsonify, request
from flask_wtf.csrf import CSRFError
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from blueprints.local_data import _error, _query, _storage, enforce_local_request_limits
from services.local_account_access import require_local_account
from services.local_personal_access import require_local_terminal_operator
from services.market_feeds import (
    get_account_snapshot,
    get_candles,
    get_quote,
    list_providers,
    list_symbols,
)
from services.market_quotes import MAX_BATCH_SYMBOLS, get_quotes
from services.mt5_binding import profile_mt5_binding
from services.workspace_storage import WorkspaceError, digest

market_data_bp = Blueprint("market_data", __name__, url_prefix="/api/local/v1/market")


@market_data_bp.before_request
def boundary():
    enforce_local_request_limits()
    return require_local_account(lambda: None)()


@market_data_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@market_data_bp.errorhandler(WorkspaceError)
def market_error(error):
    return _error(error.code, getattr(error, "status", 400))


@market_data_bp.errorhandler(SQLAlchemyError)
def storage_error(_value):
    return _error("storage.unavailable", 503)


@market_data_bp.errorhandler(BadRequest)
def bad_request(_value):
    return _error("request.invalid", 400)


@market_data_bp.errorhandler(CSRFError)
def csrf(_value):
    return _error("csrf.invalid", 400)


@market_data_bp.errorhandler(RequestEntityTooLarge)
def too_large(_value):
    return _error("request.too_large", 413)


def _oanda_headers():
    return {
        "oanda_token": request.headers.get("X-OANDA-Token"),
        "oanda_environment": request.headers.get("X-OANDA-Environment", "practice"),
        "oanda_account": request.headers.get("X-OANDA-Account"),
    }


def _provider():
    provider = request.args.get("provider", "").strip().lower()
    if provider == "mt5":
        require_local_terminal_operator()
    return provider


def _query_number(value):
    return int(value) if len(value) <= 16 and value.isascii() and value.isdecimal() else value


def _market_binding(provider, *, required):
    origin = request.args.get("originId")
    profile = request.args.get("profileId")
    if provider != "mt5":
        if not required and (origin is not None or profile is not None):
            raise WorkspaceError("request.unknown_query_field")
        return None
    if not required and origin is None and profile is None:
        # Unscoped history previews still use the default installation.
        return None
    return profile_mt5_binding(_storage(), origin, _query_number(profile or ""))


def _read_market(operation, *args, require_binding=False, **kwargs):
    provider = _provider()
    binding = _market_binding(provider, required=require_binding)
    if binding is not None:
        kwargs["binding"] = binding
    result = operation(provider, *args, **kwargs)
    if binding is None:
        return result, {}
    if _market_binding(provider, required=True) != binding:
        raise WorkspaceError("mt5.profile_binding_changed", 409)
    scope = binding["scope"]
    # Stable across history sync and re-verification, but different when a
    # profile is rebound or moved to a different terminal. No login in the key.
    connection_key = digest(
        [scope["connectionId"], scope["generation"], binding["configuration"].get("terminalPath")]
    )
    return result, {"connectionKey": connection_key}


@market_data_bp.get("/providers")
def providers():
    _query()
    return jsonify({"providers": list_providers()})


@market_data_bp.get("/candles")
def candles():
    _query("provider", "symbol", "interval", "limit", "start", "end", "originId", "profileId")
    args = request.args
    limit = args.get("limit", "100")
    result, connection = _read_market(
        get_candles,
        args.get("symbol", ""),
        args.get("interval", "1h"),
        _query_number(limit),
        start=args.get("start"),
        end=args.get("end"),
        oanda_token=_oanda_headers()["oanda_token"],
        oanda_environment=_oanda_headers()["oanda_environment"],
    )
    return jsonify({"candles": result, "count": len(result), **connection})


@market_data_bp.get("/symbols")
def symbols():
    _query("provider", "q", "limit", "originId", "profileId")
    limit = request.args.get("limit", "100")
    result, connection = _read_market(
        list_symbols,
        request.args.get("q", ""),
        _query_number(limit),
    )
    return jsonify({"symbols": result, "count": len(result), **connection})


@market_data_bp.get("/account")
def account():
    _query("provider", "historyDays", "historyLimit", "includeHistory", "originId", "profileId")
    days = request.args.get("historyDays", "7")
    limit = request.args.get("historyLimit", "200")
    include_history = request.args.get("includeHistory", "1")
    if include_history not in {"0", "1"}:
        raise WorkspaceError("request.invalid", 400)
    result, _connection = _read_market(
        get_account_snapshot,
        history_days=_query_number(days),
        history_limit=_query_number(limit),
        include_history=include_history == "1",
        require_binding=True,
    )
    return jsonify({"account": result})


@market_data_bp.get("/quote")
def quote():
    _query("provider", "symbol", "originId", "profileId")
    headers = _oanda_headers()
    result, connection = _read_market(
        get_quote,
        request.args.get("symbol", ""),
        oanda_token=headers["oanda_token"],
        oanda_environment=headers["oanda_environment"],
        oanda_account=headers["oanda_account"],
    )
    return jsonify({"quote": result, **connection})


@market_data_bp.get("/quotes")
def quotes():
    _query("provider", "symbols")
    symbols = request.args.get("symbols", "")
    if not symbols or len(symbols) > MAX_BATCH_SYMBOLS * 25:
        raise WorkspaceError("market.invalid_limit")
    return jsonify(get_quotes(request.args.get("provider"), symbols.split(",")))
