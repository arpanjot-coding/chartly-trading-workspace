from pathlib import Path

import pytest
from dotenv import dotenv_values
from flask import Flask

from blueprints import react_app
from utils import env_check

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def sample_env(tmp_path, monkeypatch):
    (tmp_path / "utils").mkdir()
    env = (ROOT / ".sample.env").read_bytes()
    (tmp_path / ".sample.env").write_bytes(env)
    (tmp_path / ".env").write_bytes(env)
    monkeypatch.setattr(env_check, "__file__", str(tmp_path / "utils" / "env_check.py"))
    monkeypatch.setattr(env_check, "configure_llvmlite_paths", lambda: None)
    monkeypatch.setattr(env_check, "_generate_keys_on_first_run", lambda _path: None)
    monkeypatch.setattr(env_check, "_ensure_fernet_salt", lambda _path: None)
    for key, value in dotenv_values(tmp_path / ".env").items():
        if value is not None:
            monkeypatch.setenv(key, value)


def test_sample_configuration_starts_without_legacy_broker(sample_env):
    env_check.load_and_check_env_variables()


def test_older_sample_callback_is_optional_without_credentials(sample_env, monkeypatch):
    monkeypatch.setenv("REDIRECT_URL", "http://127.0.0.1:5000/<broker>/callback")
    env_check.load_and_check_env_variables()


def test_configured_legacy_broker_still_requires_a_valid_callback(sample_env, monkeypatch):
    monkeypatch.setenv("BROKER_API_KEY", "sample-key")
    monkeypatch.setenv("BROKER_API_SECRET", "sample-secret")
    with pytest.raises(SystemExit) as error:
        env_check.load_and_check_env_variables()
    assert error.value.code == 1

    monkeypatch.setenv("REDIRECT_URL", "http://127.0.0.1:5000/zerodha/callback")
    env_check.load_and_check_env_variables()


def test_unbuilt_frontend_returns_setup_instruction_without_a_redirect(tmp_path, monkeypatch):
    monkeypatch.setattr(react_app, "FRONTEND_DIST", tmp_path)
    app = Flask(__name__)
    app.register_blueprint(react_app.react_bp)
    response = app.test_client().get("/")

    assert response.status_code == 503
    assert response.headers["X-Robots-Tag"] == "noindex"
    assert b"npm run build" in response.data
