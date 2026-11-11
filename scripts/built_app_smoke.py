"""Serve the built frontend with isolated local chart and journal data for Playwright."""

import argparse
import os
import signal
from datetime import UTC, datetime, timedelta
from pathlib import Path
from secrets import token_hex
from tempfile import TemporaryDirectory
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
START = datetime(2025, 1, 2, 9, tzinfo=UTC)


def seed_workspace(storage):
    from database.workspace_storage_db import TABLES
    from services.data_library import DataLibrary
    from services.journal_service import JournalService

    tables = {name: [] for name in TABLES}
    tables["portfolios"] = [
        {
            "id": 1,
            "name": "Release smoke portfolio",
            "kind": "live",
            "currency": "USD",
            "startingBalance": 0,
            "createdAt": START.isoformat(),
            "updatedAt": START.isoformat(),
            "timezone": "UTC",
            "defaultSymbol": "EXAMPLE",
            "defaultTimeframe": "1m",
        }
    ]
    snapshot = {
        "format": "chartly-browser-snapshot",
        "version": 1,
        "originId": "built_app_smoke",
        "createdAt": START.isoformat(),
        "tables": tables,
        "nativeCatalogs": {},
        "preferences": {},
        "attachments": {},
        "datasetManifests": [],
    }
    migration = storage.preview_migration(snapshot)
    storage.commit_migration(migration["id"], {}, uuid4().hex)

    library = DataLibrary(storage)
    fields = ["timestamp", "open", "high", "low", "close", "volume"]
    rows = [",".join(fields)]
    for minute in range(48):
        timestamp = (START + timedelta(minutes=minute)).isoformat()
        price = 100 + minute % 12
        rows.append(f"{timestamp},{price},{price + 2},{price - 2},{price + 1},10")
    preview = library.preview_import(
        library.catalog()["revision"],
        "\n".join(rows),
        {
            "version": 1,
            "columns": {name: name for name in fields},
            "timestampFormat": "iso",
            "timezone": "UTC",
            "delimiter": ",",
            "decimalSeparator": ".",
            "timestampMeaning": "open",
        },
        {
            "name": "Release smoke saved history",
            "provider": "built-app-fixture",
            "symbol": "EXAMPLE",
            "exchange": "LOCAL",
            "interval": "1m",
            "currency": "USD",
            "priceBasis": "raw",
            "adjustment": "none",
            "volumeMeaning": "units",
            "allowNegativePrices": False,
            "calendar": {
                "id": "continuous",
                "timezone": "UTC",
                "sessions": [{"weekdays": list(range(7)), "open": "00:00", "close": "24:00"}],
                "exceptions": {},
            },
        },
    )
    version = library.commit_import(preview["id"], preview["expectedRevision"], uuid4().hex)[
        "version"
    ]
    current = storage.workspace()
    current["tables"]["portfolios"][0]["chartSource"] = {
        "kind": "dataset",
        "versionId": version["id"],
        "checksum": version["checksum"],
    }
    storage.save_tables(current["originId"], current["tables"], current["revision"], uuid4().hex)
    current = storage.workspace()
    book = next(book for book in current["books"] if book["kind"] == "manual")
    JournalService(storage).action(
        current["originId"],
        current["revision"],
        uuid4().hex,
        "create-trade",
        {
            "trade": {
                "portfolioId": 1,
                "journalBookId": book["id"],
                "pair": "EXAMPLE",
                "direction": "Buy",
                "result": "Open",
                "openDate": START.isoformat(),
                "closeDate": "",
                "currency": "USD",
                "quantityUnit": "units",
                "amounts": {"quantity": "10", "netPnl": None, "entryPrice": "100"},
                "technicalNotes": "Synthetic chart and journal smoke trade",
                "strategy": "Smoke fixture",
            },
        },
    )


def serve(folder, dist, port):
    # Set disposable paths before importing any Chartly module.
    os.environ.update(
        APP_KEY=token_hex(32),
        API_KEY_PEPPER=token_hex(32),
        FERNET_SALT=token_hex(32),
        CHARTLY_NO_LOGIN="true",
        CHARTLY_MT5_DEMO_ORDERS="false",
        VALID_BROKERS="",
        LOG_FORMAT="[%(levelname)s] %(message)s",
        LOG_DIR=str(folder / "logs"),
        TEMP=str(folder),
        TMP=str(folder),
        TMPDIR=str(folder),
    )
    for name in (
        "DATABASE_URL",
        "SANDBOX_DATABASE_URL",
        "LOGS_DATABASE_URL",
        "LATENCY_DATABASE_URL",
    ):
        os.environ[name] = "sqlite:///" + (folder / f"{name}.db").as_posix()
    workspace_url = "sqlite:///" + (folder / "workspaces.db").as_posix()
    os.environ["LOCAL_DATA_DATABASE_URL"] = workspace_url
    import dotenv

    def disabled_dotenv(*_args, **_kwargs):
        return False

    dotenv.load_dotenv = dotenv.main.load_dotenv = disabled_dotenv
    from flask import Flask
    from flask_wtf import CSRFProtect
    from werkzeug.serving import make_server

    from blueprints import react_app
    from blueprints.auth import auth_bp
    from blueprints.data_library import data_library_bp
    from blueprints.journal import journal_bp
    from blueprints.local_data import (
        configure_local_storage,
        enforce_local_request_limits,
        local_data_bp,
    )
    from blueprints.retired_features import retired_features_bp
    from database import auth_db, user_db
    from services.local_personal_access import _owner, clean_legacy_personal_session
    from services.workspace_storage import WorkspaceStorage

    user_db.Base.metadata.create_all(user_db.engine)
    auth_db.Base.metadata.create_all(auth_db.engine)
    react_app.FRONTEND_DIST = dist
    web = Flask(__name__)
    web.config.update(
        SECRET_KEY=token_hex(32),
        RATELIMIT_ENABLED=False,
        LOCAL_DATA_DATABASE_URL=workspace_url,
    )
    configure_local_storage(web)
    web.before_request(enforce_local_request_limits)
    web.before_request(clean_legacy_personal_session)
    CSRFProtect(web)
    for blueprint in (
        auth_bp,
        local_data_bp,
        journal_bp,
        data_library_bp,
        react_app.react_bp,
        retired_features_bp,
    ):
        web.register_blueprint(blueprint)

    @web.get("/_smoke/ready")
    def ready():
        return "", 204

    @web.teardown_appcontext
    def close_sessions(_error):
        user_db.db_session.remove()
        auth_db.db_session.remove()

    try:
        with web.app_context():
            storage = WorkspaceStorage(workspace_url, _owner()["identity_uid"])
            try:
                seed_workspace(storage)
            finally:
                storage.engine.dispose()
        with make_server("127.0.0.1", port, web) as server:
            print(f"Chartly smoke fixture ready on http://127.0.0.1:{port}", flush=True)
            server.serve_forever()
    finally:
        cached = web.extensions.get("chartly_workspace_storage")
        if cached is not None:
            cached["engine"].dispose()
        user_db.engine.dispose()
        auth_db.engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=ROOT / "frontend" / "dist")
    parser.add_argument("--port", type=int, default=5181)
    parser.add_argument("--work-dir", type=Path)
    args = parser.parse_args()
    dist = args.dist.resolve()
    if not (dist / "index.html").is_file():
        parser.error("Build the frontend or supply a frontend artifact with --dist.")

    def stop(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        with TemporaryDirectory(prefix="chartly-smoke-", dir=args.work_dir) as folder:
            serve(Path(folder).resolve(), dist, args.port)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
