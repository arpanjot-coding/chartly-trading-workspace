"""Private immutable file-backed history, independent of broker/account setup."""

import base64
import json
import zipfile
from copy import deepcopy
from io import BytesIO
from uuid import uuid4

import pytest
from sqlalchemy import event, select, update

from database.data_library_db import versions
from services.data_library import DataLibrary
from services.workspace_storage import WorkspaceError, WorkspaceStorage


@pytest.fixture
def library(tmp_path):
    store = WorkspaceStorage(
        "sqlite:///" + (tmp_path / "local.db").as_posix(), "principal_dataset_owner"
    )
    yield DataLibrary(store)
    store.engine.dispose()


def context(provider="local-csv"):
    return {
        "name": "Fixture market history",
        "provider": provider,
        "symbol": "EXAMPLE",
        "exchange": "LOCAL",
        "interval": "1m",
        "currency": "USD",
        "priceBasis": "raw",
        "adjustment": "none",
        "volumeMeaning": "unknown",
        "allowNegativePrices": False,
        "calendar": {"id": "unknown", "timezone": "UTC", "sessions": [], "exceptions": {}},
    }


def mapping():
    return {
        "version": 1,
        "columns": {key: key for key in ("timestamp", "open", "high", "low", "close", "volume")},
        "timestampFormat": "iso",
        "timezone": "UTC",
        "delimiter": ",",
        "decimalSeparator": ".",
        "timestampMeaning": "open",
    }


def source(close="101.123456789012345678901234", bad=False):
    return (
        "timestamp,open,high,low,close,volume\n2026-11-02T09:00:00Z,100,110,90,"
        + close
        + ",\n2026-11-02T09:01:00Z,100,110,90,102,2.25\n"
        + ("2026-11-02T09:02:00Z,100,50,90,102,1\n" if bad else "")
    )


def preview(library, text=None, metadata=None):
    return library.preview_import(
        library.catalog()["revision"], text or source(), mapping(), metadata or context()
    )


def commit(library, job, policy="keep", allow=False, request_id=None):
    return library.commit_import(
        job["id"], job["expectedRevision"], request_id or uuid4().hex, policy, allow
    )


def test_local_import_exact_unknown_volume_immutable_read_and_stable_receipt(library):
    assert library.catalog()["revision"] == 0 and library.catalog()["versions"] == []
    job = preview(library)
    assert "bars" not in job["preview"]
    request = uuid4().hex
    first = commit(library, job, request_id=request)
    again = commit(library, job, request_id=request)
    assert first["version"]["id"] == again["version"]["id"]
    version = first["version"]
    bars = library.bars(version["id"])["bars"]
    assert bars[0]["close"] == "101.123456789012345678901234"
    assert bars[0]["volume"] is None and bars[1]["volume"] == "2.25"
    assert library.bars(version["id"], 1793610000, 1793610000)["bars"] == [bars[0]]
    assert version["metadata"]["sourceId"] and version["checksum"]
    assert "fileHash" not in version and "sourceCsv" not in version


def test_two_sources_same_symbol_and_foreign_uid_cannot_read_job_or_version(library):
    first = commit(library, preview(library))["version"]
    second = commit(library, preview(library, metadata=context("other-source")))["version"]
    assert first["datasetId"] != second["datasetId"] and len(library.catalog()["versions"]) == 2
    other_store = WorkspaceStorage(library.engine, "principal_other_dataset_owner")
    other = DataLibrary(other_store)
    assert other.catalog()["versions"] == []
    with pytest.raises(WorkspaceError, match="not_found"):
        other.detail(first["id"])
    with pytest.raises(WorkspaceError, match="not_found"):
        other.import_job(first["sourceJobId"])


def test_repeated_and_overlapping_imports_publish_no_duplicate_version(library):
    first = commit(library, preview(library))["version"]
    job = preview(library)
    assert job["preview"]["counts"]["unchanged"] == 2
    again = commit(library, job)["version"]
    assert again["id"] == first["id"] and len(library.catalog()["versions"]) == 1


def test_keep_replace_fresh_snapshot_never_modify_original_bytes(library):
    original = commit(library, preview(library))["version"]
    original_bars = library.bars(original["id"])["bars"]
    kept = commit(library, preview(library, source("103")), "keep")["version"]
    assert kept["id"] == original["id"]
    replaced = commit(library, preview(library, source("103")), "replace")["version"]
    assert (
        replaced["id"] != original["id"]
        and library.bars(replaced["id"])["bars"][0]["close"] == "103"
    )
    assert library.bars(original["id"])["bars"] == original_bars
    text = "\n".join(source("105").splitlines()[:2]) + "\n"
    fresh = commit(library, preview(library, text), "new-version")["version"]
    assert fresh["rowCount"] == 1 and len(library.catalog()["versions"]) == 3


def test_rejected_subset_requires_deliberate_consent_and_stale_preview_reopens(library):
    job = preview(library, source(bad=True))
    with pytest.raises(WorkspaceError, match="confirmation"):
        commit(library, job)
    result = commit(library, job, allow=True)
    assert result["version"]["rowCount"] == 2
    stale = preview(library, source("103"))
    library.archive(result["version"]["id"], library.catalog()["revision"], uuid4().hex)
    with pytest.raises(WorkspaceError, match="revision_conflict"):
        commit(library, stale)
    refreshed = library.repreview_import(stale["id"], library.catalog()["revision"])
    assert commit(library, refreshed, "replace")["version"]["rowCount"] == 2


def test_archive_is_reversible_and_exact_pinned_version_remains_readable(library):
    version = commit(library, preview(library))["version"]
    id = version["id"]
    archived = library.archive(id, library.catalog()["revision"], uuid4().hex)
    assert archived["version"]["archivedAt"] and library.bars(id)["bars"]
    restored = library.archive(id, library.catalog()["revision"], uuid4().hex, True)
    assert "archivedAt" not in restored["version"]


def test_bundle_validates_bytes_content_and_rebinds_private_owner(library):
    original = commit(library, preview(library))["version"]
    export = library.export(original["id"])
    with zipfile.ZipFile(BytesIO(base64.b64decode(export["base64"]))) as archive:
        assert set(archive.namelist()) == {"manifest.json", "bars.json", "source.csv"}
        values = {name: archive.read(name) for name in archive.namelist()}
    other = DataLibrary(WorkspaceStorage(library.engine, "principal_bundle_restored_owner"))
    job = other.preview_bundle(0, export["base64"])
    restored = other.commit_bundle(job["id"], 0, uuid4().hex)["version"]
    assert restored["id"] != original["id"] and restored["checksum"] == original["checksum"]
    assert other.bars(restored["id"])["bars"] == library.bars(original["id"])["bars"]
    values["bars.json"] = b"[]"
    stream = BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        for name, value in values.items():
            archive.writestr(name, value)
    with pytest.raises(WorkspaceError, match="invalid_bundle"):
        other.preview_bundle(
            other.catalog()["revision"], base64.b64encode(stream.getvalue()).decode()
        )


def test_old_mt5_clock_conversions_are_quarantined_and_recovery_preserves_bytes(library):
    metadata = context("mt5-terminal")
    observation = {
        "provider": "mt5-terminal",
        "receivedAt": "2026-11-02T12:00:00Z",
        "nativePair": "EXAMPLE",
        "symbol": "EXAMPLE",
        "interval": "1m",
        "returnedFirst": 1793610000,
        "returnedLast": 1793610060,
        "closedRows": 2,
        "excludedUnfinished": 0,
        "maxEntries": 1000,
        "scope": "Broker-server bar times used a measured skew of 7199 seconds.",
    }
    job = library.preview_import(0, source(), mapping(), metadata, source_observation=observation)
    version = commit(library, job)["version"]
    path = library._path(version)
    original_bytes = path.read_bytes()
    assert version["quarantine"]["reason"] == "dataset.time_unverified"
    assert library.detail(version["id"])["checksum"] == version["checksum"]
    assert library.catalog()["versions"][0]["quarantine"] == version["quarantine"]
    with pytest.raises(WorkspaceError, match="dataset.time_unverified"):
        library.bars(version["id"])
    with pytest.raises(WorkspaceError, match="dataset.time_unverified"):
        library.export(version["id"], "csv")
    with library.engine.connect() as connection:
        with pytest.raises(WorkspaceError, match="dataset.time_unverified"):
            library._version(connection, version["id"])
    export = library.export(version["id"], "bundle")
    assert path.read_bytes() == original_bytes
    with zipfile.ZipFile(BytesIO(base64.b64decode(export["base64"]))) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["datasetVersion"]["quarantine"] == version["quarantine"]
        assert manifest["datasetVersion"]["checksum"] == version["checksum"]
    other = DataLibrary(WorkspaceStorage(library.engine, "principal_quarantined_bundle_owner"))
    staged = other.preview_bundle(0, export["base64"])
    assert staged["quarantine"]["reason"] == "dataset.time_unverified"
    restored = other.commit_bundle(staged["id"], 0, uuid4().hex)["version"]
    assert restored["checksum"] == version["checksum"]
    assert restored["quarantine"] == version["quarantine"]
    with pytest.raises(WorkspaceError, match="dataset.time_unverified"):
        other.bars(restored["id"])
    archived = library.archive(version["id"], library.catalog()["revision"], uuid4().hex)
    assert archived["version"]["quarantine"] == version["quarantine"]


def test_manual_mt5_utc_file_without_heuristic_feed_provenance_remains_usable(library):
    version = commit(library, preview(library, metadata=context("mt5-terminal")))["version"]
    assert "quarantine" not in version
    assert len(library.bars(version["id"])["bars"]) == 2


def test_mt5_quarantine_follows_legacy_merged_bars_and_survives_bundle_restore(library):
    original = commit(library, preview(library, metadata=context("mt5-terminal")))["version"]
    changed = library.preview_import(
        library.catalog()["revision"], source("103"), mapping(), context("mt5-terminal")
    )
    descendant = commit(library, changed, policy="replace")["version"]
    assert descendant["baseVersionId"] == original["id"]
    with library.engine.begin() as connection:
        payload = json.loads(
            connection.execute(
                select(versions.c.payload).where(versions.c.id == original["id"])
            ).scalar_one()
        )
        payload["sourceObservation"] = {
            "provider": "mt5-terminal",
            "receivedAt": "2026-11-02T12:00:00Z",
            "nativePair": "EXAMPLE",
            "symbol": "EXAMPLE",
            "interval": "1m",
            "returnedFirst": 1793610000,
            "returnedLast": 1793610060,
            "closedRows": 2,
            "excludedUnfinished": 0,
            "maxEntries": 1000,
            "scope": "Legacy MT5 feed conversion.",
        }
        connection.execute(
            update(versions)
            .where(versions.c.id == original["id"])
            .values(payload=json.dumps(payload))
        )
    assert library.detail(descendant["id"])["quarantine"]["reason"] == "dataset.time_unverified"
    with pytest.raises(WorkspaceError, match="dataset.time_unverified"):
        library.bars(descendant["id"])
    export = library.export(descendant["id"])
    other = DataLibrary(WorkspaceStorage(library.engine, "principal_merged_quarantine_restore"))
    staged = other.preview_bundle(0, export["base64"])
    restored = other.commit_bundle(staged["id"], 0, uuid4().hex)["version"]
    assert restored["checksum"] == descendant["checksum"]
    with pytest.raises(WorkspaceError, match="dataset.time_unverified"):
        other.bars(restored["id"])


def test_corrupt_or_missing_immutable_file_is_visible(library):
    version = commit(library, preview(library))["version"]
    path = library._path(version)
    path.write_bytes(b"broken fixture")
    with pytest.raises(WorkspaceError, match="missing_or_changed"):
        library.bars(version["id"])


def test_file_failure_rolls_back_metadata_and_revision(library, monkeypatch):
    job = preview(library)

    def fail(*args):
        raise OSError("fixture disk failure")

    monkeypatch.setattr(library, "_write_file", fail)
    with pytest.raises(OSError):
        commit(library, job)
    assert library.catalog()["revision"] == 0 and library.catalog()["versions"] == []


@pytest.mark.parametrize(
    "query",
    [
        {"start": "NaN"},
        {"start": "1e500"},
        {"start": True},
        {"limit": False},
        {"limit": 0},
        {"limit": 50001},
        {"start": "3", "end": "2"},
    ],
)
def test_bad_queries_are_bounded(library, query):
    version = commit(library, preview(library))["version"]
    with pytest.raises(WorkspaceError):
        library.bars(version["id"], **query)
