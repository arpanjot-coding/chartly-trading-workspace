"""Expose Flow migration commands without starting Chartly's background jobs."""

from pathlib import Path

from dotenv import load_dotenv
from flask import Flask


def create_app():
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

    from blueprints.flow import flow_bp
    from database.flow_db import init_db

    init_db()
    app = Flask(__name__, static_folder=None)
    app.cli.add_command(flow_bp.cli, name="flow")
    return app
