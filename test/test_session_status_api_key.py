"""The SPA needs the Chartly API key even when the broker token expired.

No-login/local sessions can be authenticated with a named broker slot before
any broker token exists. Tools and the chart still need the user's Chartly API
key, so /auth/session-status must not drop it on the broker-expired branch.
"""

import os
import sys
from pathlib import Path

from flask import Flask

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEST_DB = Path(__file__).resolve().parents[1] / "tmp" / "test_session_status_api_key.db"
TEST_DB.parent.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("DATABASE_URL", f"sqlite:///{TEST_DB.as_posix()}")
os.environ.setdefault("API_KEY_PEPPER", "a" * 64)

from blueprints.auth import auth_bp  # noqa: E402


def test_session_status_broker_expired_includes_api_key(monkeypatch):
    monkeypatch.setattr("database.auth_db.get_auth_token", lambda _user: None)
    monkeypatch.setattr(
        "database.auth_db.get_api_key_for_tradingview", lambda _user: "chartly-key"
    )

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(auth_bp)

    with app.test_client() as client:
        with client.session_transaction() as flask_session:
            flask_session["user"] = "chartly"
            flask_session["logged_in"] = True
            flask_session["broker"] = "zerodha"

        response = client.get("/auth/session-status")

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["broker_session_expired"] is True
    assert payload["api_key"] == "chartly-key"
    assert payload["local_guest"] is False


def test_session_status_reports_local_guest(monkeypatch):
    monkeypatch.setattr("database.auth_db.get_auth_token", lambda _user: None)
    monkeypatch.setattr(
        "database.auth_db.get_api_key_for_tradingview", lambda _user: "chartly-key"
    )

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(auth_bp)

    with app.test_client() as client:
        with client.session_transaction() as flask_session:
            flask_session["user"] = "chartly"
            flask_session["logged_in"] = True
            flask_session["broker"] = "zerodha"
            flask_session["chartly_local_guest"] = True

        response = client.get("/auth/session-status")

    assert response.status_code == 200
    assert response.get_json()["local_guest"] is True
