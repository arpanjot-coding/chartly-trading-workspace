"""Retired endpoints cannot invoke their former broker/data services."""
import json
from pathlib import Path

import pytest
from flask import Flask

from blueprints import react_app
from blueprints.retired_features import retired_features_bp

REGISTRY = json.loads((Path(__file__).parents[1] / 'blueprints/retired_features.json').read_text())


@pytest.fixture
def client(tmp_path, monkeypatch):
    (tmp_path / 'index.html').write_text('<main>Chartly original app</main>')
    monkeypatch.setattr(react_app, 'FRONTEND_DIST', tmp_path)
    app = Flask(__name__)
    app.register_blueprint(react_app.react_bp)
    app.register_blueprint(retired_features_bp)
    return app.test_client()


@pytest.mark.parametrize('path', REGISTRY['pages'])
def test_retired_page_returns_gone(client, path):
    result = client.get(path)
    assert result.status_code == 410
    assert b'feature is unavailable' in result.data


@pytest.mark.parametrize('path', sorted(set(REGISTRY['apiRoutes'])) + ['/api/v1/sip/backtest'])
def test_retired_api_cannot_run(client, path):
    path = path.replace('<int:entry_id>', '42').replace('<path:rest>', 'issuers/example/metrics')
    for method in ('get', 'post', 'put', 'delete'):
        result = getattr(client, method)(path, json={})
        # SIP only exposes GET/POST; other methods cannot execute a service either.
        assert result.status_code in (410, 405)
        if result.status_code == 410:
            assert result.json['status'] == 'error'


@pytest.mark.parametrize('path', ['/workspace', '/workspace/combined', '/flow', '/trading', '/python', '/strategy'])
def test_retained_workspaces_serve_the_original_app(client, path):
    result = client.get(path)
    assert result.status_code == 200
    assert b'Chartly original app' in result.data


def test_old_directory_redirects_to_the_retained_development_entry(client):
    result = client.get('/tools')
    assert result.status_code == 302
    assert result.location == '/workspace'
