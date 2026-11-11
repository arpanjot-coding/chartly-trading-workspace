"""Portable verified dataset references across private-owner bundle restores."""

from copy import deepcopy
from uuid import uuid4

import pytest
from test_data_library import commit, context, preview
from test_data_library_review import bundle, bundle_parts
from test_workspace_worker import source as workspace_source

from services.data_library import DataLibrary
from services.workspace_storage import WorkspaceError, WorkspaceStorage, opaque

pytest_plugins = ["test_data_library"]


def other_owner(library, uid):
    return DataLibrary(WorkspaceStorage(library.engine, uid))


def restored_snapshot(library, version):
    snapshot = workspace_source()
    snapshot["tables"]["practiceSessions"] = [
        {
            "id": 1,
            "portfolioId": 1,
            "name": "Preserved version reference",
            "status": "Draft",
            "symbol": "EXAMPLE",
            "timeframe": "1m",
            "datasetVersionId": version["id"],
            "datasetChecksum": version["checksum"],
        }
    ]
    snapshot["tables"]["journalTrades"] = [
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
            "technicalNotes": "Preserve this historical review during dataset recovery.",
        }
    ]
    job = library.storage.preview_migration(snapshot)
    library.storage.commit_migration(job["id"], {"legacy-precision": "keep-raw"}, uuid4().hex)
    return deepcopy(library.storage.workspace()["tables"])


def restore_bundle(target, source, version):
    exported = source.export(version["id"])
    job = target.preview_bundle(target.catalog()["revision"], exported["base64"])
    return target.commit_bundle(job["id"], job["expectedRevision"], uuid4().hex)["version"]


def test_cross_owner_restore_resolves_preserved_p02_reference_without_mutating_practice(library):
    original = commit(library, preview(library))["version"]
    target = other_owner(library, "principal_dataset_restored_owner")
    before = restored_snapshot(target, original)
    with pytest.raises(WorkspaceError, match="not_found"):
        target.detail(original["id"])
    restored = restore_bundle(target, library, original)
    assert restored["id"] != original["id"] and restored["checksum"] == original["checksum"]
    detail = target.detail(original["id"])
    bars = target.bars(original["id"])
    assert detail["id"] == restored["id"] and detail["resolvedFromVersionId"] == original["id"]
    assert bars["versionId"] == restored["id"] and bars["resolvedFromVersionId"] == original["id"]
    assert bars["bars"] == library.bars(original["id"])["bars"]
    assert any(
        item["kind"] == "practice-draft" and item["id"] == 1 for item in detail["dependencies"]
    )
    assert target.storage.workspace()["tables"] == before
    untouched = other_owner(library, "principal_dataset_unrelated_owner")
    with pytest.raises(WorkspaceError, match="not_found"):
        untouched.detail(original["id"])
    with pytest.raises(WorkspaceError, match="not_found"):
        untouched.bars(original["id"])


def test_portable_alias_proof_survives_another_full_bundle_roundtrip(library):
    original = commit(library, preview(library))["version"]
    second = other_owner(library, "principal_dataset_second_owner")
    second_version = restore_bundle(second, library, original)
    _parts, manifest = bundle_parts(second, second_version)
    aliases = manifest.get("versionAliases", [])
    assert {
        "id": original["id"],
        "datasetId": original["datasetId"],
        "checksum": original["checksum"],
    } in aliases
    assert all(
        set(item) == {"id", "datasetId", "checksum"}
        and item["id"] == opaque("version", item["datasetId"] + "|" + item["checksum"])
        for item in aliases
    )
    third = other_owner(library, "principal_dataset_third_owner")
    before = restored_snapshot(third, original)
    third_version = restore_bundle(third, second, second_version)
    assert len({original["id"], second_version["id"], third_version["id"]}) == 3
    for old_id in (original["id"], second_version["id"]):
        assert third.detail(old_id)["id"] == third_version["id"]
        assert third.bars(old_id)["bars"] == library.bars(original["id"])["bars"]
    assert third.storage.workspace()["tables"] == before
    assert any(item["id"] == 1 for item in third.detail(third_version["id"])["dependencies"])


def test_restore_rejects_original_version_id_that_does_not_prove_dataset_and_content(library):
    original = commit(library, preview(library))["version"]
    parts, manifest = bundle_parts(library, original)
    manifest["datasetVersion"]["id"] = opaque("version", "forged-dataset|" + original["checksum"])
    before = library.catalog()["revision"]
    with pytest.raises(WorkspaceError, match="invalid_bundle"):
        library.preview_bundle(before, bundle(parts, manifest))
    assert library.catalog()["revision"] == before


@pytest.mark.parametrize("change", ["id", "checksum"])
def test_restore_rejects_forged_or_mismatched_ancestor_alias_proof(library, change):
    original = commit(library, preview(library))["version"]
    parts, manifest = bundle_parts(library, original)
    alias = {key: original[key] for key in ("id", "datasetId", "checksum")}
    if change == "id":
        alias["id"] = opaque("version", "forged-alias")
    else:
        alias["checksum"] = "0" * 64
        alias["id"] = opaque("version", alias["datasetId"] + "|" + alias["checksum"])
    manifest["versionAliases"] = [alias]
    with pytest.raises(WorkspaceError, match="invalid_bundle"):
        library.preview_bundle(library.catalog()["revision"], bundle(parts, manifest))


def test_current_owner_native_version_identity_wins_over_a_valid_same_content_alias(library):
    original = commit(library, preview(library))["version"]
    target = other_owner(library, "principal_dataset_native_owner")
    native = commit(target, preview(target, metadata=context("owned-original-source")))["version"]
    assert native["checksum"] == original["checksum"]
    before = restored_snapshot(target, native)
    parts, manifest = bundle_parts(library, original)
    manifest["versionAliases"] = [{key: native[key] for key in ("id", "datasetId", "checksum")}]
    job = target.preview_bundle(target.catalog()["revision"], bundle(parts, manifest))
    restored = target.commit_bundle(job["id"], job["expectedRevision"], uuid4().hex)["version"]
    assert restored["id"] != native["id"]
    assert target.detail(native["id"])["id"] == native["id"]
    assert target.detail(native["id"])["metadata"]["provider"] == "owned-original-source"
    assert any(item["id"] == 1 for item in target.detail(native["id"])["dependencies"])
    assert not any(item["id"] == 1 for item in target.detail(restored["id"])["dependencies"])
    assert target.storage.workspace()["tables"] == before


def test_portable_aliases_have_an_explicit_budget_instead_of_silent_truncation(library):
    original = commit(library, preview(library))["version"]
    parts, manifest = bundle_parts(library, original)
    manifest["versionAliases"] = [
        {
            "id": opaque("version", f"dataset_{index}|" + original["checksum"]),
            "datasetId": f"dataset_{index}",
            "checksum": original["checksum"],
        }
        for index in range(1001)
    ]
    with pytest.raises(WorkspaceError, match="invalid_bundle"):
        library.preview_bundle(library.catalog()["revision"], bundle(parts, manifest))
