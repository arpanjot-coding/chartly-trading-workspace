"""Recovery proves exact data/ownership, and rejects archives before activation."""

import hashlib
import json
import stat
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

import pytest

from database.domain_store import create_domain_engine, initialize_store
from services.domain.backup import (
    BackupError,
    build_scope_backup,
    inspect_backup,
    restore_to_new_store,
)
from services.domain.repository import DomainRepository, RepositoryError

DATA = Path(__file__).resolve().parents[1] / "contracts/v1/fixtures"
CORE = json.loads((DATA / "local-core.json").read_text(encoding="utf-8"))
FULL = json.loads((DATA / "full-v1.json").read_text(encoding="utf-8"))
OWNER = "owner_local_001"
WORKSPACE = "workspace_local_001"
AT = "2026-11-02T10:01:00Z"


@pytest.fixture
def scope(tmp_path):
    engine = create_domain_engine(f"sqlite:///{(tmp_path / 'source.db').as_posix()}")
    initialize_store(engine)
    repo = DomainRepository(engine, OWNER, WORKSPACE)
    records = [
        deepcopy(entry)
        for entry in CORE
        if entry["type"] in ("LocalOwner", "Workspace", "Account", "JournalBook", "Profile")
    ]
    records += [
        deepcopy(entry)
        for entry in FULL
        if entry["type"] in ("ManualTrade", "JournalEntry")
        and entry["value"]["id"] in ("manual_trade_001", "entry_manual_001")
    ]
    repo.apply(records)
    yield repo, tmp_path
    engine.dispose()


def rewrite(data, change, *, rehash=True):
    with ZipFile(BytesIO(data)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        snapshot = json.loads(archive.read("domain.json"))
    change(manifest, snapshot)
    content = json.dumps(
        snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()
    if rehash:
        manifest["files"]["domain.json"] = {
            "sha256": hashlib.sha256(content).hexdigest(),
            "bytes": len(content),
        }
    result = BytesIO()
    with ZipFile(result, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("domain.json", content)
    return result.getvalue()


def test_roundtrip_preserves_exact_payloads_revisions_and_historical_aliases(scope):
    repo, folder = scope
    profile = repo.get("Profile", "profile_local_001")
    aliased = {
        **profile,
        "revision": 2,
        "updatedAt": AT,
        "aliases": [{"namespace": "ChartlyTraderDB:origin-a:portfolios", "key": "1"}],
    }
    repo.apply([{"type": "Profile", "value": aliased}], expected_revisions={profile["id"]: 1})
    # Retain a previous route alias even when the current display payload omits it.
    current = {**aliased, "revision": 3, "aliases": []}
    repo.apply([{"type": "Profile", "value": current}], expected_revisions={profile["id"]: 2})
    source = repo.snapshot()
    data = build_scope_backup(repo)
    manifest, _ = inspect_backup(data)
    assert "browserTraderStore" in manifest["excludedModules"]
    assert manifest["includedModules"] == ["domain-core"]
    target = folder / "restored.db"
    receipt = restore_to_new_store(data, target)
    assert receipt["status"] == "prepared" and receipt["activated"] is False
    engine = create_domain_engine(f"sqlite:///{target.as_posix()}")
    try:
        restored = DomainRepository(engine, OWNER, WORKSPACE)
        assert restored.snapshot() == source
        assert restored.by_alias("ChartlyTraderDB:origin-a:portfolios", "1")["revision"] == 3
    finally:
        engine.dispose()
    assert repo.snapshot() == source


def test_backup_contains_only_the_selected_owner_and_workspace(scope):
    repo, _ = scope
    other = DomainRepository(repo.engine, "owner_second_001", "workspace_second_001")
    owner = deepcopy(CORE[0])
    owner["value"]["id"] = "owner_second_001"
    workspace = deepcopy(CORE[1])
    workspace["value"].update(id="workspace_second_001", ownerId="owner_second_001")
    other.apply([owner, workspace])
    _, snapshot = inspect_backup(build_scope_backup(repo))
    assert all(entry["value"].get("ownerId", OWNER) == OWNER for entry in snapshot["records"])
    assert "owner_second_001" not in {entry["value"]["id"] for entry in snapshot["records"]}


def test_existing_database_is_never_overwritten(scope):
    repo, folder = scope
    path = folder / "existing.db"
    path.write_bytes(b"Existing operator data")
    with pytest.raises(BackupError, match="backup.target_exists"):
        restore_to_new_store(build_scope_backup(repo), path)
    assert path.read_bytes() == b"Existing operator data"


def test_checksum_failure_creates_no_target(scope):
    repo, folder = scope
    target = folder / "checksum.db"

    def change(_manifest, snapshot):
        snapshot["records"][0]["value"]["name"] = "Tampered"

    bad = rewrite(build_scope_backup(repo), change, rehash=False)
    with pytest.raises(BackupError, match="backup.checksum_mismatch"):
        restore_to_new_store(bad, target)
    assert not target.exists()


@pytest.mark.parametrize("version", [True, 2, "1"])
def test_unrecognized_version_is_rejected_before_writing(scope, version):
    repo, folder = scope
    target = folder / "version.db"
    bad = rewrite(
        build_scope_backup(repo), lambda manifest, _: manifest.update(formatVersion=version)
    )
    with pytest.raises(BackupError, match="backup.unsupported_version"):
        restore_to_new_store(bad, target)
    assert not target.exists()


def test_scope_tampering_and_broken_references_are_rejected(scope):
    repo, folder = scope

    def wrong_owner(_manifest, snapshot):
        snapshot["records"][-1]["value"]["ownerId"] = "owner_foreign_001"

    with pytest.raises(BackupError, match="backup.scope_mismatch"):
        inspect_backup(rewrite(build_scope_backup(repo), wrong_owner))

    def missing_book(_manifest, snapshot):
        next(entry for entry in snapshot["records"] if entry["type"] == "ManualTrade")["value"][
            "bookId"
        ] = "book_missing_001"

    target = folder / "broken.db"
    with pytest.raises(BackupError, match="backup.invalid_references"):
        restore_to_new_store(rewrite(build_scope_backup(repo), missing_book), target)
    assert not target.exists()


def test_duplicate_record_identity_and_invalid_counts_are_rejected(scope):
    repo, _ = scope

    def duplicate(_manifest, snapshot):
        snapshot["records"].append(deepcopy(snapshot["records"][0]))

    with pytest.raises(BackupError, match="backup.duplicate_identity"):
        inspect_backup(rewrite(build_scope_backup(repo), duplicate))
    with pytest.raises(BackupError, match="backup.invalid_counts"):
        inspect_backup(
            rewrite(
                build_scope_backup(repo),
                lambda manifest, _: manifest["recordCounts"].update(LocalOwner=True),
            )
        )


def test_unknown_module_is_not_silently_ignored(scope):
    repo, _ = scope
    with pytest.raises(BackupError, match="backup.unsupported_modules"):
        inspect_backup(
            rewrite(
                build_scope_backup(repo),
                lambda manifest, _: manifest.update(
                    includedModules=["domain-core", "unknown-module"]
                ),
            )
        )


def test_invalid_archive_members_never_extract_paths(scope):
    repo, folder = scope
    valid = build_scope_backup(repo)
    with ZipFile(BytesIO(valid)) as archive:
        manifest = archive.read("manifest.json")
        content = archive.read("domain.json")
    for name in ["../domain.json", "/domain.json", "nested/domain.json"]:
        result = BytesIO()
        with ZipFile(result, "w") as archive:
            archive.writestr("manifest.json", manifest)
            archive.writestr(name, content)
        with pytest.raises(BackupError, match="backup.invalid_members"):
            inspect_backup(result.getvalue())
    assert not (folder.parent / "domain.json").exists()


def test_symlink_member_is_rejected(scope):
    repo, _ = scope
    with ZipFile(BytesIO(build_scope_backup(repo))) as source:
        manifest = source.read("manifest.json")
        content = source.read("domain.json")
    result = BytesIO()
    with ZipFile(result, "w") as archive:
        archive.writestr("manifest.json", manifest)
        member = ZipInfo("domain.json")
        member.create_system = 3
        member.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(member, content)
    with pytest.raises(BackupError, match="backup.invalid_member"):
        inspect_backup(result.getvalue())


def test_truncated_or_appended_data_is_rejected(scope):
    repo, _ = scope
    data = build_scope_backup(repo)
    for bad in [data[:-10], data + b"unexpected-tail", b"not a zip"]:
        with pytest.raises(BackupError):
            inspect_backup(bad)


def test_snapshot_budget_fails_without_modifying_source(scope):
    repo, _ = scope
    before = repo.snapshot()
    with pytest.raises(RepositoryError, match="storage.snapshot_budget_exceeded"):
        repo.snapshot(max_bytes=1)
    assert repo.snapshot() == before


def test_restore_handles_more_than_one_transaction_batch(scope):
    repo, folder = scope
    sample = repo.get("ManualTrade", "manual_trade_001")
    for start in (0, 1000):
        records = [
            {"type": "ManualTrade", "value": {**sample, "id": f"trade_restore_{i:05d}"}}
            for i in range(start, min(start + 1000, 1001))
        ]
        repo.apply(records)
    original = repo.snapshot()
    target = folder / "large-restored.db"
    receipt = restore_to_new_store(build_scope_backup(repo), target)
    assert receipt["recordCounts"]["ManualTrade"] == 1002
    engine = create_domain_engine(f"sqlite:///{target.as_posix()}")
    try:
        assert DomainRepository(engine, OWNER, WORKSPACE).snapshot() == original
    finally:
        engine.dispose()


def test_failed_staging_never_changes_source_or_returns_activation(scope, monkeypatch):
    repo, folder = scope
    original = repo.snapshot()
    archive = build_scope_backup(repo)
    real_apply = DomainRepository.apply

    def fail_on_trade(self, entries, **kwargs):
        if any(entry["type"] == "ManualTrade" for entry in entries):
            raise RepositoryError("storage.unavailable")
        return real_apply(self, entries, **kwargs)

    monkeypatch.setattr(DomainRepository, "apply", fail_on_trade)
    with pytest.raises(BackupError, match="backup.restore_failed"):
        restore_to_new_store(archive, folder / "interrupted.db")
    assert repo.snapshot() == original
