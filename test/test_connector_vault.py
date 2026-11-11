"""Actual ciphertext/scoping/rotation/expiry and portable-backup leakage checks."""

from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import select, update

from database.connector_vault_db import connector_secrets
from services.connector_vault import ConnectorVault
from services.connectors import Connectors
from services.workspace_recovery import WorkspaceRecoveryService
from services.workspace_storage import WorkspaceError

pytest_plugins = ["test_journal_service"]
ORIGIN = "journal_origin_01"
KEY = "p07-synthetic-vault-key-" + "1" * 32
SECRET = "synthetic-read-only-secret-never-export-31b7"


def record(storage):
    return {"id": "connection_vault_001", "providerId": "diagnostic", "credentialGeneration": 1}


def test_ciphertext_scope_key_loss_and_tampering_fail_closed(storage):
    vault = ConnectorVault(storage, master_key=KEY)
    item = record(storage)
    with storage.transaction() as connection:
        item["credentialRef"] = vault.save(connection, ORIGIN, item["id"], {"apiKey": SECRET}, 1)
    with storage.engine.connect() as connection:
        row = connection.execute(select(connector_secrets)).mappings().one()
        assert SECRET not in row["ciphertext"]
        assert vault.load(connection, ORIGIN, item) == {"apiKey": SECRET}
        with pytest.raises(WorkspaceError, match="credential_unavailable"):
            ConnectorVault(storage, master_key="a-different-installation-key-" + "2" * 32).load(
                connection, ORIGIN, item
            )
        with pytest.raises(WorkspaceError, match="credential_missing"):
            vault.load(connection, "different_origin_01", item)
        changed = {**item, "credentialGeneration": 2}
        with pytest.raises(WorkspaceError, match="credential_missing"):
            vault.load(connection, ORIGIN, changed)
    with storage.transaction() as connection:
        connection.execute(update(connector_secrets).values(ciphertext="corrupt"))
    with (
        storage.engine.connect() as connection,
        pytest.raises(WorkspaceError, match="credential_unavailable"),
    ):
        vault.load(connection, ORIGIN, item)


def test_revoke_and_expiry_are_not_usable(storage):
    vault = ConnectorVault(storage, master_key=KEY)
    item = record(storage)
    with storage.transaction() as connection:
        item["credentialRef"] = vault.save(connection, ORIGIN, item["id"], {"apiSecret": SECRET}, 1)
        vault.revoke(connection, ORIGIN, item["id"])
    with (
        storage.engine.connect() as connection,
        pytest.raises(WorkspaceError, match="credential_revoked"),
    ):
        vault.load(connection, ORIGIN, item)
    with storage.transaction() as connection:
        vault.save(connection, ORIGIN, item["id"], {"apiSecret": SECRET}, 1)
        connection.execute(update(connector_secrets).values(expires_at="2000-01-01T00:00:00Z"))
    with (
        storage.engine.connect() as connection,
        pytest.raises(WorkspaceError, match="credential_expired"),
    ):
        vault.load(connection, ORIGIN, item)


def test_secret_receipt_is_keyed_and_not_in_record_response_or_backup(storage):
    registry = Connectors(storage, vault_key=KEY)
    first = registry.action(
        ORIGIN,
        None,
        0,
        uuid4().hex,
        "create",
        {"providerId": "diagnostic", "label": "Vault fixture", "configuration": {}},
    )["connection"]
    request_id = uuid4().hex
    result = registry.action(
        ORIGIN,
        first["id"],
        first["revision"],
        request_id,
        "set-secret",
        {"secret": {"apiKey": SECRET}},
    )
    duplicate = registry.action(
        ORIGIN,
        first["id"],
        first["revision"],
        request_id,
        "set-secret",
        {"secret": {"apiKey": SECRET}},
    )
    assert (
        duplicate["receipt"] == result["receipt"]
        and duplicate["connection"]["credential"]["generation"] == 1
    )
    assert SECRET not in str(result) and SECRET not in str(storage.snapshot())
    archive = WorkspaceRecoveryService(storage, storage.uid).create_backup()
    assert SECRET.encode() not in archive
    with pytest.raises(WorkspaceError, match="reused_with_different_input"):
        registry.action(
            ORIGIN,
            first["id"],
            first["revision"],
            request_id,
            "set-secret",
            {"secret": {"apiKey": SECRET + "changed"}},
        )


@pytest.mark.parametrize(
    "secret",
    [
        {},
        {"unknown": SECRET},
        {"apiKey": ""},
        {"apiKey": "x" * 4097},
        {"apiKey": {"nested": "bad"}},
    ],
)
def test_unbounded_or_unsupported_secret_never_persists(storage, secret):
    vault = ConnectorVault(storage, master_key=KEY)
    with storage.transaction() as connection, pytest.raises(WorkspaceError, match="invalid_secret"):
        vault.save(connection, ORIGIN, "connection_vault_001", secret, 1)
