"""Immutable module responses and compatibility for older /trading charts."""

import hashlib
import os
import sys

import pytest

SOURCE = b"export default () => {}\r\n"
VERSION = hashlib.sha256(SOURCE).hexdigest()


@pytest.fixture
def indicators_client(monkeypatch, tmp_path):
    """The blueprint alone, with the session check lifted and a temporary folder."""
    import utils.session as us

    monkeypatch.setattr(us, "check_session_validity", lambda f: f)
    for module in list(sys.modules):
        if module == "blueprints.custom_indicators":
            del sys.modules[module]

    from flask import Flask

    import blueprints.custom_indicators as bp_module

    folder = tmp_path / "indicators"
    folder.mkdir()
    (folder / "demo.js").write_bytes(SOURCE)
    monkeypatch.setattr(bp_module, "INDICATORS_DIR", folder)

    app = Flask(__name__)
    app.register_blueprint(bp_module.custom_indicators_bp)
    yield app.test_client()
    for module in list(sys.modules):
        if module == "blueprints.custom_indicators":
            del sys.modules[module]


def test_a_versioned_module_is_cacheable_for_good(indicators_client):
    indicators_client.get("/custom-indicators/index.json")
    url = f"/custom-indicators/demo.js?v={VERSION}"
    res = indicators_client.get(url)
    assert res.status_code == 200
    assert res.headers["Cache-Control"] == "private, max-age=31536000, immutable"
    assert res.headers["ETag"] == f'"{VERSION}"'
    assert res.mimetype == "text/javascript"
    assert res.data == SOURCE
    assert (
        indicators_client.get(url, headers={"If-None-Match": res.headers["ETag"]}).status_code
        == 304
    )


def test_legacy_timestamp_urls_remain_usable_without_immutable_caching(indicators_client, tmp_path):
    url = "/custom-indicators/demo.js?v=1700000000"
    first = indicators_client.get(url)
    assert first.headers["Cache-Control"] == "private, no-store"
    assert first.data == SOURCE
    changed = SOURCE.replace(b"()", b"(x)")
    (tmp_path / "indicators" / "demo.js").write_bytes(changed)
    assert indicators_client.get(url).data == changed


def test_an_unversioned_module_is_revalidated(indicators_client):
    res = indicators_client.get("/custom-indicators/demo.js")
    assert res.status_code == 200
    assert res.headers["Cache-Control"] == "no-cache"


def test_the_index_is_always_revalidated(indicators_client):
    res = indicators_client.get("/custom-indicators/index.json")
    assert res.status_code == 200
    assert res.headers["Cache-Control"] == "no-cache"
    assert res.get_json() == [
        {"file": "demo.js", "mtime": res.json[0]["mtime"], "version": VERSION}
    ]


def test_exact_source_survives_same_timestamp_edit_and_deletion(indicators_client, tmp_path):
    from flask import Flask

    from blueprints.custom_indicators import custom_indicators_bp

    index = "/custom-indicators/index.json"
    module = "/custom-indicators/demo.js"
    before = indicators_client.get(index).json[0]
    file = tmp_path / "indicators" / "demo.js"
    changed = SOURCE.replace(b"{}", b"[]")
    file.write_bytes(changed)
    os.utime(file, (before["mtime"], before["mtime"]))
    after = indicators_client.get(index).json[0]
    assert after["mtime"] == before["mtime"]
    assert after["version"] != before["version"]
    file.unlink()

    # A new Flask application reads only the persisted archive.
    reopened = Flask(__name__)
    reopened.register_blueprint(custom_indicators_bp)
    client = reopened.test_client()
    assert client.get(index).json == []
    assert client.get(module).status_code == 404
    assert client.get(f"{module}?v={before['version']}").data == SOURCE
    assert client.get(f"{module}?v={after['version']}").data == changed


def test_unknown_or_tampered_hash_never_falls_back_to_current_source(indicators_client, tmp_path):
    indicators_client.get("/custom-indicators/index.json")
    module = "/custom-indicators/demo.js"
    assert indicators_client.get(f"{module}?v={'0' * 64}").status_code == 404
    assert indicators_client.get(f"{module}?v=arbitrary").status_code == 400
    assert indicators_client.get(f"/custom-indicators/other.js?v={VERSION}").status_code == 404
    archived = tmp_path / "indicators" / ".versions" / "demo.js" / f"{VERSION}.js"
    archived.write_bytes(SOURCE + b"changed")
    result = indicators_client.get(f"{module}?v={VERSION}")
    assert result.status_code == 503
    assert "immutable" not in result.headers.get("Cache-Control", "")
