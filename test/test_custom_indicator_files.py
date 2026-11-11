"""Custom indicator store + local file API journey on a disposable dir."""

import hashlib

import pytest
from test_local_data_api import csrf, login

from blueprints.custom_indicator_files import custom_indicator_files_bp
from services import custom_indicator_store as store

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/custom-indicators"
SOURCE = (
    "export default function ({ registerIndicator }) {\n"
    "  registerIndicator({ id: 'x', name: 'X', calc: (bars) => ({}) })\n"
    "}\n"
)


def test_store_roundtrip_conflict_and_backup(tmp_path):
    saved = store.write_indicator("my_sma", SOURCE, directory=tmp_path)
    assert saved.file == "my_sma.js" and saved.replaced is False
    with pytest.raises(store.IndicatorConflict):
        store.write_indicator("my_sma.js", SOURCE, directory=tmp_path)
    store.write_indicator("my_sma.js", SOURCE + "// v2\n", replace=True, directory=tmp_path)
    assert (tmp_path / "my_sma.js.bak").exists()
    assert store.read_indicator("my_sma.js", directory=tmp_path)["source"].endswith("// v2\n")
    assert [row["file"] for row in store.list_indicators(directory=tmp_path)] == ["my_sma.js"]
    store.delete_indicator("my_sma.js", directory=tmp_path)
    assert store.list_indicators(directory=tmp_path) == []
    with pytest.raises(store.IndicatorMissing):
        store.read_indicator("my_sma.js", directory=tmp_path)


def test_managed_write_and_delete_archive_revisions_even_without_indexing(tmp_path):
    name = "custom.js"
    old = SOURCE.encode()
    updated = (SOURCE + "// updated").encode()
    store.write_indicator(name, old.decode(), directory=tmp_path)
    store.write_indicator(name, updated.decode(), replace=True, directory=tmp_path)
    store.delete_indicator(name, directory=tmp_path)
    for payload in (old, updated):
        version = hashlib.sha256(payload).hexdigest()
        assert store.read_module(name, version, tmp_path) == payload
    assert store.module_index(tmp_path) == []


def test_failed_publish_releases_staged_file_and_keeps_current_source(tmp_path, monkeypatch):
    from pathlib import Path

    name = "study.js"
    store.write_indicator(name, SOURCE, directory=tmp_path)
    original_replace = Path.replace

    def reject_current_publish(path, target):
        if target == tmp_path / name:
            raise PermissionError("simulated busy active file")
        return original_replace(path, target)

    monkeypatch.setattr(Path, "replace", reject_current_publish)
    with pytest.raises(PermissionError):
        store.write_indicator(name, SOURCE + "// new", replace=True, directory=tmp_path)
    assert store.read_indicator(name, tmp_path)["source"] == SOURCE
    assert not list(tmp_path.rglob("*.tmp"))


@pytest.mark.parametrize(
    "name", ["../evil.js", "a/b.js", "_hidden.js", ".hidden.js", "x" * 70 + ".js", ""]
)
def test_store_rejects_unsafe_names(name, tmp_path):
    with pytest.raises(store.IndicatorInvalid):
        store.write_indicator(name, SOURCE, directory=tmp_path)


def test_store_rejects_non_indicator_source(tmp_path):
    with pytest.raises(store.IndicatorInvalid):
        store.write_indicator("plain.js", "console.log('hi')", directory=tmp_path)


@pytest.fixture
def app(api, monkeypatch, tmp_path):
    api.register_blueprint(custom_indicator_files_bp)
    monkeypatch.setattr(store, "indicator_dir", lambda: tmp_path)
    return api


def test_api_journey_requires_local_account_then_crud(app):
    client = app.test_client()
    assert client.get(BASE).status_code in (401, 403)
    login(client)
    assert client.get(BASE).json == {"count": 0, "indicators": []}

    created = client.post(BASE, json={"filename": "my_sma", "source": SOURCE}, headers=csrf(client))
    assert created.status_code == 201, created.json
    assert created.json["saved"] == {
        "file": "my_sma.js",
        "bytes": len(SOURCE.encode()),
        "replaced": False,
    }
    again = client.post(
        BASE, json={"filename": "my_sma.js", "source": SOURCE}, headers=csrf(client)
    )
    assert again.status_code == 409
    assert again.json["error"]["code"] == "custom_indicator.exists"

    listing = client.get(BASE).json
    assert listing["count"] == 1 and listing["indicators"][0]["file"] == "my_sma.js"
    detail = client.get(BASE + "/my_sma.js").json
    assert detail["indicator"]["source"] == SOURCE

    updated = client.put(
        BASE + "/my_sma.js", json={"source": SOURCE + "// v2\n"}, headers=csrf(client)
    )
    assert updated.status_code == 200, updated.json
    assert client.get(BASE + "/my_sma.js").json["indicator"]["source"].endswith("// v2\n")

    bad = client.post(BASE, json={"filename": "../evil.js", "source": SOURCE}, headers=csrf(client))
    assert bad.status_code == 400
    assert bad.json["error"]["code"] == "custom_indicator.invalid"

    removed = client.delete(BASE + "/my_sma.js", headers=csrf(client))
    assert removed.status_code == 200, removed.json
    assert client.get(BASE).json["count"] == 0
    assert client.get(BASE + "/my_sma.js").status_code == 404


def test_api_preview_stages_module_without_writing_a_file(app, tmp_path):
    client = app.test_client()
    login(client)
    staged = client.post(BASE + "/preview", json={"source": SOURCE}, headers=csrf(client))
    assert staged.status_code == 201, staged.json
    url = staged.json["preview"]["url"]
    assert url.startswith(BASE + "/preview/") and url.endswith(".js")
    module = client.get(url)
    assert module.status_code == 200
    assert module.mimetype == "text/javascript"
    assert module.get_data(as_text=True) == SOURCE
    # Nothing was installed: the folder and the listing stay empty.
    assert client.get(BASE).json["count"] == 0
    assert list(tmp_path.glob("*.js")) == []
    unknown = client.get(BASE + "/preview/" + "0" * 32 + ".js")
    assert unknown.status_code == 404


def test_api_serves_llm_skill(app):
    client = app.test_client()
    login(client)
    response = client.get(BASE + "/skill")
    assert response.status_code == 200
    text = response.get_data(as_text=True)
    assert "name: chartly-indicators" in text
    assert "registerIndicator" in text
