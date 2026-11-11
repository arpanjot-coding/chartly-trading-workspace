import pytest


def test_workspace_profile_routes_serve_react_app(tmp_path, monkeypatch):
    flask = pytest.importorskip("flask")
    from blueprints import react_app

    (tmp_path / "index.html").write_text("<main>Chartly</main>", encoding="utf-8")
    monkeypatch.setattr(react_app, "FRONTEND_DIST", tmp_path)

    app = flask.Flask(__name__)
    app.register_blueprint(react_app.react_bp)
    client = app.test_client()

    for path in (
        "/settings",
        "/fundamentals",
        "/fundamentals/",
        "/settings/",
        "/settings/connections",
        "/settings/connections?tab=portfolios",
        "/settings/storage",
        "/settings/storage/",
        "/workspace",
        "/workspace/combined",
        "/workspace/profiles/12",
        "/workspace/profiles/12/journal",
        "/workspace/profiles/12/connections",
        "/workspace/profiles/12/replay",
        "/workspace/profiles/12/settings",
        "/journal",
    ):
        response = client.get(path)
        assert response.status_code == 200, path
        assert b"Chartly" in response.get_data()
