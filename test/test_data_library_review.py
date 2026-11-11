"""Independent persistence and recovery boundary regressions for P04."""

import base64
import hashlib
import json
import zipfile
from copy import deepcopy
from io import BytesIO
from uuid import uuid4

import pytest
from test_data_library import commit, mapping, preview, source
from test_workspace_worker import source as workspace_source

from services.workspace_storage import WorkspaceError, dumps

pytest_plugins = ["test_data_library"]


def bundle_parts(library, version):
    exported = library.export(version["id"])
    with zipfile.ZipFile(BytesIO(base64.b64decode(exported["base64"]))) as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    manifest = json.loads(parts["manifest.json"])
    return parts, manifest


def bundle(parts, manifest):
    stream = BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, value in parts.items():
            archive.writestr(name, dumps(manifest).encode() if name == "manifest.json" else value)
    return base64.b64encode(stream.getvalue()).decode()


def test_query_bounds_do_not_round_away_unsupported_submicrosecond_precision(library):
    version = commit(library, preview(library))["version"]
    with pytest.raises(WorkspaceError, match="invalid_time_bound"):
        library.bars(version["id"], start="1762074000.0000000000000000000000000000000001")


def test_stripping_all_dataset_keys_cannot_unlock_a_practice_session_with_trades(library):
    version = commit(library, preview(library))["version"]
    storage = library.storage
    snapshot = workspace_source()
    job = storage.preview_migration(snapshot)
    storage.commit_migration(job["id"], {}, uuid4().hex)
    state = storage.workspace()
    tables = deepcopy(state["tables"])
    tables["practiceSessions"] = [
        {
            "id": 1,
            "portfolioId": 1,
            "name": "Pinned fixture",
            "status": "Draft",
            "symbol": "EXAMPLE",
            "timeframe": "1m",
            "datasetVersionId": version["id"],
            "datasetChecksum": version["checksum"],
        }
    ]
    storage.save_tables(state["originId"], tables, state["revision"], uuid4().hex)
    state = storage.workspace()
    tables = deepcopy(state["tables"])
    tables["journalTrades"] = [
        {
            "id": 1,
            "portfolioId": 1,
            "sessionId": 1,
            "origin": "replay",
            "pair": "EXAMPLE",
            "direction": "Buy",
            "result": "Win",
            "openDate": "2026-11-02T09:00:00Z",
            "closeDate": "2026-11-02T09:01:00Z",
            "netPnl": 1,
        }
    ]
    storage.save_tables(state["originId"], tables, state["revision"], uuid4().hex)
    state = storage.workspace()
    tables = deepcopy(state["tables"])
    tables["practiceSessions"][0].pop("datasetVersionId")
    tables["practiceSessions"][0].pop("datasetChecksum")
    with pytest.raises(WorkspaceError, match="version_reference_locked"):
        storage.save_tables(state["originId"], tables, state["revision"], uuid4().hex)
    assert storage.workspace()["tables"]["practiceSessions"][0]["datasetVersionId"] == version["id"]


def test_bundle_without_original_csv_still_requires_a_real_source_digest(library):
    version = commit(library, preview(library))["version"]
    parts, manifest = bundle_parts(library, version)
    del parts["source.csv"]
    del manifest["members"]["source.csv"]
    manifest["datasetVersion"]["sourceHash"] = "this-is-not-a-source-hash"
    with pytest.raises(WorkspaceError, match="invalid_bundle"):
        library.preview_bundle(library.catalog()["revision"], bundle(parts, manifest))


def test_one_bar_bundle_cannot_use_boolean_as_its_candle_count(library):
    single = "\n".join(source().splitlines()[:2]) + "\n"
    version = commit(library, preview(library, single))["version"]
    parts, manifest = bundle_parts(library, version)
    manifest["datasetVersion"]["rowCount"] = True
    with pytest.raises(WorkspaceError, match="invalid_bundle"):
        library.preview_bundle(library.catalog()["revision"], bundle(parts, manifest))


def test_bundle_source_mapping_is_validated_instead_of_retaining_unknown_secrets(library):
    version = commit(library, preview(library))["version"]
    parts, manifest = bundle_parts(library, version)
    manifest["sourceMapping"]["credentials"] = "synthetic-do-not-retain"
    before = library.catalog()["revision"]
    with pytest.raises(WorkspaceError, match="invalid_bundle"):
        library.preview_bundle(before, bundle(parts, manifest))
    assert library.catalog()["revision"] == before


def test_failed_metadata_after_file_publication_rolls_back_and_cleans_the_owned_file(
    library, monkeypatch
):
    job = preview(library)
    original = library._link_manifests

    def failure(*_args):
        raise OSError("synthetic failed metadata stage")

    monkeypatch.setattr(library, "_link_manifests", failure)
    with pytest.raises(OSError):
        commit(library, job)
    assert library.catalog()["versions"] == []
    assert list(library.root.glob("version_*.duckdb")) == []
    assert list(library.root.glob("stage-*")) == []
    monkeypatch.setattr(library, "_link_manifests", original)
    assert commit(library, job)["version"]["rowCount"] == 2


def test_identical_crash_orphan_is_adopted_without_overwriting_verified_bytes(library, monkeypatch):
    job = preview(library)
    real_write = library._write_file
    published = []

    def crash_after_publish(version, bars):
        published.append(real_write(version, bars))
        raise OSError("synthetic process stopped after file publication")

    monkeypatch.setattr(library, "_write_file", crash_after_publish)
    with pytest.raises(OSError):
        commit(library, job)
    assert library.catalog()["versions"] == [] and published[0].is_file()
    original_hash = hashlib.sha256(published[0].read_bytes()).hexdigest()
    monkeypatch.setattr(library, "_write_file", real_write)
    restored = commit(library, job)["version"]
    assert hashlib.sha256(published[0].read_bytes()).hexdigest() == original_hash
    assert library.bars(restored["id"])["bars"][0]["close"] == "101.123456789012345678901234"


def test_bundle_restores_are_atomic_when_canonical_projection_is_tampered(library):
    version = commit(library, preview(library))["version"]
    parts, manifest = bundle_parts(library, version)
    bars = json.loads(parts["bars.json"])
    bars[0]["timestamp"] += 10
    parts["bars.json"] = dumps(bars).encode()
    manifest["members"]["bars.json"] = {
        "sha256": hashlib.sha256(parts["bars.json"]).hexdigest(),
        "size": len(parts["bars.json"]),
    }
    with pytest.raises(WorkspaceError, match="invalid_bundle"):
        library.preview_bundle(library.catalog()["revision"], bundle(parts, manifest))
    assert len(library.catalog()["versions"]) == 1
