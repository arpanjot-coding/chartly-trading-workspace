"""Portable connector state preserves evidence but never credentials/activation."""

import json
from copy import deepcopy
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from sqlalchemy import select
from test_connector_history import CONTEXT, event, page
from test_connector_storage import AT, ORIGIN, load, make_record, save

from database.connector_vault_db import connector_secrets
from services.connector_history import merge_history
from services.connector_records import ConnectorRecords
from services.connector_vault import ConnectorVault
from services.workspace_recovery import (
    WorkspaceRecoveryError,
    WorkspaceRecoveryService,
    inspect_workspace_backup,
)
from services.workspace_storage import WorkspaceStorage, opaque

pytest_plugins = ["test_journal_service"]


def connected(storage):
    record = make_record(storage, linked=True)
    workspace = storage.workspace()
    book = next(book for book in workspace["books"] if book["id"] == record["link"]["bookId"])
    record["history"] = merge_history(
        None, page(event()), {**CONTEXT, "accountKey": book["accountKey"], "receivedAt": AT}
    )["history"]
    record["observedAt"] = AT
    with storage.transaction() as connection:
        reference = ConnectorVault(storage, master_key="test-key-not-a-real-secret-" * 2).save(
            connection, ORIGIN, record["id"], {"apiKey": "synthetic-never-export-this-value"}, 1
        )
        record.update(credentialRef=reference, credentialGeneration=1)
        record["source"]["credentialRef"] = reference
        ConnectorRecords(storage).save(connection, ORIGIN, record["id"], record)
    return record


def restore(target, archive, *, owner=False):
    service = WorkspaceRecoveryService(target, target.uid)
    preview = service.preview_restore(archive, target.current_revision())
    return service.commit_restore(
        preview["jobId"],
        preview["expectedRevision"],
        preview["confirmationHash"],
        confirm_owner=owner,
    )


def test_backup_contains_connector_module_and_no_ciphertext_or_plaintext_secret(storage):
    record = connected(storage)
    archive = WorkspaceRecoveryService(storage, storage.uid).create_backup()
    with ZipFile(BytesIO(archive)) as zipped:
        assert "modules/connectors.json" in zipped.namelist()
        content = b"\n".join(zipped.read(name) for name in zipped.namelist())
    assert b"synthetic-never-export-this-value" not in content
    assert b"ciphertext" not in content
    parsed = inspect_workspace_backup(archive)
    assert parsed["moduleCounts"]["connectors"] == 1
    assert parsed["state"]["connectorRecords"] == [record]


def test_cross_owner_restore_rebinds_account_book_scope_preserves_raw_history_and_disarms(storage):
    original = connected(storage)
    archive = WorkspaceRecoveryService(storage, storage.uid).create_backup()
    other = WorkspaceStorage(storage.engine, "principal_connector_restore")
    restore(other, archive, owner=True)
    recovered = load(other)
    assert recovered["ownerId"] == other.uid and recovered["originId"] == ORIGIN
    assert (
        recovered["history"] == original["history"]
        and recovered["receipts"] == original["receipts"]
    )
    assert recovered["status"] == "unverified" and recovered["health"] == "unknown"
    assert recovered["requiresVerification"] is True
    assert "credentialRef" not in recovered and "credentialGeneration" not in recovered
    assert "credentialRef" not in recovered["source"]
    assert recovered["link"]["active"] is False
    assert recovered["link"]["bookId"] != original["link"]["bookId"]
    book = next(
        book for book in other.workspace()["books"] if book["id"] == recovered["link"]["bookId"]
    )
    assert recovered["source"]["accountId"] == opaque(
        "account", other.uid + "|account|" + book["accountKey"]
    )
    assert recovered["source"]["workspaceId"] == opaque("workspace", other.uid + "|" + ORIGIN)
    assert recovered["source"]["health"] == "unknown"
    assert load(storage) == original
    with other.engine.connect() as connection:
        assert (
            connection.execute(
                select(connector_secrets).where(connector_secrets.c.uid == other.uid)
            ).first()
            is None
        )


def test_same_owner_restore_and_undo_never_restore_vault_or_activation(storage):
    original = connected(storage)
    recovery = WorkspaceRecoveryService(storage, storage.uid)
    before = recovery.create_backup()
    changed = deepcopy(original)
    changed.update(revision=2, label="Later local label")
    save(storage, changed)
    result = restore(storage, before)
    actual = load(storage)
    assert actual["history"] == original["history"] and actual["health"] == "unknown"
    with storage.engine.connect() as connection:
        assert (
            connection.execute(
                select(connector_secrets).where(connector_secrets.c.uid == storage.uid)
            ).first()
            is None
        )
    preview = recovery.preview_recovery_copy(result["recoveryCopyId"], storage.current_revision())
    recovery.commit_restore(
        preview["jobId"], preview["expectedRevision"], preview["confirmationHash"]
    )
    actual = load(storage)
    assert actual["revision"] == 2 and actual["label"] == "Later local label"
    assert actual["history"] == original["history"] and actual["link"]["active"] is False
    assert "credentialRef" not in actual
    with storage.engine.connect() as connection:
        assert (
            connection.execute(
                select(connector_secrets).where(connector_secrets.c.uid == storage.uid)
            ).first()
            is None
        )


def test_pre_connector_archive_upgrades_empty_module_without_losing_other_modules(storage):
    raw = WorkspaceRecoveryService(storage, storage.uid).create_backup()
    with ZipFile(BytesIO(raw)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    manifest = json.loads(files.pop("manifest.json"))
    removed = "modules/connectors.json"
    files.pop(removed)
    manifest["modules"].remove("connectors")
    manifest["files"].pop(removed)
    manifest["counts"]["moduleCounts"].pop("connectors")
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for name, content in files.items():
            archive.writestr(name, content)
    parsed = inspect_workspace_backup(output.getvalue())
    assert parsed["upgradedModules"] == ["connectors"]
    assert parsed["state"]["connectorRecords"] == []


def test_archive_rejects_history_hash_tampering_or_missing_linked_book(storage):
    connected(storage)
    original = storage.snapshot()
    for mutate in (
        lambda record: record["history"]["observations"][0]["event"]["payload"].update(
            profit="999"
        ),
        lambda record: record["link"].update(bookId="book_missing001"),
    ):
        altered = deepcopy(original)
        altered.pop("connectorRecords")
        mutate(altered["workspaces"][0]["connectorRecords"][0])
        with pytest.raises(WorkspaceRecoveryError):
            from services.workspace_recovery import build_workspace_backup

            build_workspace_backup(storage.uid, altered)
