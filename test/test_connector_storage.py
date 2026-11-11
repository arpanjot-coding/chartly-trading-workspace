"""Scoped connector persistence, immutable account identity and data-only budgets."""

from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import event

from services.connector_history import empty_history
from services.connector_records import ConnectorRecords, validate_record
from services.journal_service import JournalService
from services.workspace_storage import WorkspaceError, WorkspaceStorage, opaque

pytest_plugins = ["test_journal_service"]
ORIGIN = "journal_origin_01"
AT = "2026-11-03T10:00:00.000Z"


def make_record(storage, *, linked=False):
    record = {
        "version": 1,
        "id": "connection_test001",
        "ownerId": storage.uid,
        "originId": ORIGIN,
        "revision": 1,
        "providerId": "diagnostic",
        "adapterVersion": "1.0.0",
        "createdAt": AT,
        "updatedAt": AT,
        "configuration": {"account": "alpha"},
        "status": "unverified",
        "health": "unknown",
        "history": empty_history(),
        "receipts": [],
    }
    if linked:
        workspace = storage.workspace()
        result = JournalService(storage).action(
            ORIGIN,
            workspace["revision"],
            uuid4().hex,
            "create-book",
            {"portfolioId": 1, "accountId": 1},
        )
        book_id = result["result"]["bookId"]
        book = next(book for book in result["workspace"]["books"] if book["id"] == book_id)
        record.update(
            status="linked",
            health="healthy",
            identity={
                "externalId": "111",
                "server": "fixture-server",
                "currency": "USD",
                "environment": "broker_demo",
            },
            link={"profileId": 1, "accountId": 1, "bookId": book_id, "active": True},
        )
        record["source"] = {
            "schemaVersion": 1,
            "id": "source_test001",
            "ownerId": storage.uid,
            "workspaceId": opaque("workspace", storage.uid + "|" + ORIGIN),
            "revision": 1,
            "createdAt": AT,
            "updatedAt": AT,
            "providerId": record["providerId"],
            "adapterVersion": record["adapterVersion"],
            "kind": "local",
            "configurationState": "configured",
            "health": "healthy",
            "observedAt": AT,
            "accountId": opaque("account", storage.uid + "|account|" + book["accountKey"]),
        }
    return record


def save(storage, record):
    with storage.transaction() as connection:
        ConnectorRecords(storage).save(connection, ORIGIN, record["id"], record)


def load(storage, identity="connection_test001"):
    with storage.engine.connect() as connection:
        return ConnectorRecords(storage).load(connection, ORIGIN, identity)


def test_connector_table_exists_before_first_transaction_and_owner_origin_scope(storage):
    record = make_record(storage)
    save(storage, record)
    assert load(storage) == record
    other = WorkspaceStorage(storage.engine, "principal_other_owner")
    with storage.engine.connect() as connection:
        assert ConnectorRecords(other).load(connection, ORIGIN, record["id"]) is None
        assert ConnectorRecords(storage).load(connection, "another_origin_01", record["id"]) is None
        assert ConnectorRecords(storage).list(connection, ORIGIN) == [record]


def test_routine_workspace_never_reads_connector_history(storage):
    save(storage, make_record(storage))
    statements = []

    def observed(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(storage.engine, "before_cursor_execute", observed)
    try:
        result = storage.workspace()
    finally:
        event.remove(storage.engine, "before_cursor_execute", observed)
    assert "connectorRecords" not in result
    assert not any("workspace_connectors" in statement for statement in statements)
    assert storage.snapshot()["connectorRecords"] == [make_record(storage)]


def test_scope_write_and_record_rollback_do_not_publish_half_state(storage):
    record = make_record(storage)
    with pytest.raises(RuntimeError):
        with storage.transaction() as connection:
            ConnectorRecords(storage).save(connection, ORIGIN, record["id"], record)
            raise RuntimeError("forced before checkpoint publication")
    assert load(storage) is None
    foreign = deepcopy(record)
    foreign["ownerId"] = "principal_foreign_owner"
    with pytest.raises(WorkspaceError, match="record_identity_mismatch"):
        save(storage, foreign)
    assert load(storage) is None


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value.update(apiKey="never-portable"),
        lambda value: value["configuration"].update(password="never-portable"),
        lambda value: value.update(health="a switch says connected"),
        lambda value: value.update(revision=True),
        lambda value: value.update(history={}),
        lambda value: value.update(configuration={"x": float("nan")}),
        lambda value: value.update(
            receipts=[{"requestId": "one", "inputHash": "a" * 64, "revision": 2}]
        ),
        lambda value: value.update(
            link={"profileId": 1, "accountId": 1, "bookId": "invalid", "active": True}
        ),
    ],
)
def test_restore_record_rejects_secrets_invalid_identity_state_and_receipts(storage, mutate):
    record = make_record(storage)
    mutate(record)
    with pytest.raises(WorkspaceError):
        validate_record(record)


def test_canonical_source_must_match_record_scope_and_provider(storage):
    record = make_record(storage, linked=True)
    validate_record(record)
    for field, replacement in (
        ("ownerId", "principal_foreign_owner"),
        ("providerId", "other-provider"),
        ("workspaceId", "workspace_foreign_01"),
    ):
        changed = deepcopy(record)
        changed["source"][field] = replacement
        with pytest.raises(WorkspaceError):
            validate_record(changed)


def test_linked_declared_identity_cannot_be_changed_by_generic_table_save(storage):
    record = make_record(storage, linked=True)
    save(storage, record)
    before = storage.workspace()
    for key, value in (
        ("externalLogin", "222"),
        ("server", "different"),
        ("currency", "GBP"),
        ("accountKind", "live"),
        ("brokerName", "renamed-provider"),
        ("platform", "mt5"),
    ):
        tables = deepcopy(before["tables"])
        tables["brokerAccounts"][0][key] = value
        with pytest.raises(WorkspaceError, match="linked_account_identity_locked"):
            storage.save_tables(ORIGIN, tables, before["revision"], uuid4().hex)
    tables = deepcopy(before["tables"])
    tables["brokerAccounts"][0]["displayName"] = "My readable label"
    storage.save_tables(ORIGIN, tables, before["revision"], uuid4().hex)
    assert load(storage) == record


def test_utf8_replacement_budget_does_not_load_all_other_ledgers(storage, monkeypatch):
    from services import connector_records
    from services.workspace_storage import dumps

    record = make_record(storage)
    save(storage, record)
    record["label"] = "界" * 500
    monkeypatch.setattr(connector_records, "MAX_ORIGIN_BYTES", len(dumps(record).encode()) - 1)
    with pytest.raises(WorkspaceError, match="origin_budget"):
        save(storage, record)
    assert "label" not in load(storage)


@pytest.mark.parametrize("bad", ["foreign", "checksum", "symbol", "interval", "currency"])
def test_new_replay_profile_with_history_requires_owned_compatible_source(storage, bad):
    from test_data_library import commit, preview

    from services.data_library import DataLibrary

    library = DataLibrary(storage)
    version = commit(library, preview(library))["version"]
    if bad == "foreign":
        foreign = WorkspaceStorage(storage.engine, "principal_foreign_dataset")
        foreign_library = DataLibrary(foreign)
        version = commit(foreign_library, preview(foreign_library))["version"]
    tables = storage.workspace()["tables"]
    profile = {
        **tables["portfolios"][0],
        "id": 2,
        "name": "Replay",
        "kind": "replay",
        "defaultSymbol": "EXAMPLE",
        "defaultTimeframe": "1m",
        "currency": "USD",
        "chartSource": {
            "kind": "dataset",
            "versionId": version["id"],
            "checksum": version["checksum"],
        },
    }
    if bad == "checksum":
        profile["chartSource"]["checksum"] = "0" * 64
    if bad == "symbol":
        profile["defaultSymbol"] = "OTHER"
    if bad == "interval":
        profile["defaultTimeframe"] = "1h"
    if bad == "currency":
        profile["currency"] = "GBP"
    tables["portfolios"].append(profile)
    with pytest.raises(WorkspaceError):
        storage.save_tables(ORIGIN, tables, storage.workspace()["revision"], uuid4().hex)
    assert len(storage.workspace()["tables"]["portfolios"]) == 1


def test_legacy_empty_replay_profile_is_retained_but_new_valid_history_binding_persists(storage):
    from test_data_library import commit, preview

    from services.data_library import DataLibrary

    original = storage.snapshot()["snapshot"]
    original["tables"]["portfolios"].append(
        {**original["tables"]["portfolios"][0], "id": 2, "kind": "replay"}
    )
    storage = WorkspaceStorage(storage.engine, "principal_legacy_empty_replay")
    migration = storage.preview_migration(original)
    storage.commit_migration(migration["id"], {}, uuid4().hex)
    tables = storage.workspace()["tables"]
    tables["portfolios"][1]["name"] = "Retained legacy replay"
    storage.save_tables(ORIGIN, tables, storage.workspace()["revision"], uuid4().hex)
    version = commit(DataLibrary(storage), preview(DataLibrary(storage)))["version"]
    tables = storage.workspace()["tables"]
    tables["portfolios"].append(
        {
            **tables["portfolios"][0],
            "id": 3,
            "kind": "replay",
            "defaultSymbol": "EXAMPLE",
            "defaultTimeframe": "1m",
            "chartSource": {
                "kind": "dataset",
                "versionId": version["id"],
                "checksum": version["checksum"],
            },
        }
    )
    result = storage.save_tables(ORIGIN, tables, storage.workspace()["revision"], uuid4().hex)
    assert result["tables"]["portfolios"][1]["name"] == "Retained legacy replay"
    assert "chartSource" not in result["tables"]["portfolios"][1]
    assert result["tables"]["portfolios"][2]["chartSource"]["versionId"] == version["id"]


@pytest.mark.parametrize(
    "source",
    [
        None,
        {},
        {"kind": "connected"},
        {"kind": "live"},
        {"kind": "dataset", "versionId": "missing_owned_version"},
        {"kind": "dataset", "versionId": "missing_owned_version", "checksum": "0" * 64},
    ],
)
def test_new_replay_profile_cannot_omit_or_substitute_its_required_history(storage, source):
    before = storage.workspace()
    tables = deepcopy(before["tables"])
    profile = {**tables["portfolios"][0], "id": 2, "kind": "replay"}
    if source is not None:
        profile["chartSource"] = source
    tables["portfolios"].append(profile)
    with pytest.raises(WorkspaceError, match="dataset.profile_history_required"):
        storage.save_tables(ORIGIN, tables, before["revision"], uuid4().hex)
    assert storage.workspace() == before


@pytest.mark.parametrize("state", ["archived", "empty"])
def test_new_replay_profile_requires_nonempty_unarchived_owned_history(storage, state):
    from test_data_library import commit, preview

    from services.data_library import DataLibrary

    library = DataLibrary(storage)
    version = commit(library, preview(library))["version"]
    if state == "archived":
        library.archive(version["id"], library.catalog()["revision"], uuid4().hex)
    else:
        from sqlalchemy import update

        from database.data_library_db import versions
        from services.workspace_storage import dumps

        # A restored/corrupt manifest must not make an empty version a new-project source.
        with storage.transaction() as connection:
            connection.execute(
                update(versions)
                .where(versions.c.uid == storage.uid, versions.c.id == version["id"])
                .values(payload=dumps({**version, "rowCount": 0}))
            )
    before = storage.workspace()
    tables = deepcopy(before["tables"])
    tables["portfolios"].append(
        {
            **tables["portfolios"][0],
            "id": 2,
            "kind": "replay",
            "defaultSymbol": version["metadata"]["symbol"],
            "defaultTimeframe": version["metadata"]["interval"],
            "chartSource": {
                "kind": "dataset",
                "versionId": version["id"],
                "checksum": version["checksum"],
            },
        }
    )
    with pytest.raises(WorkspaceError, match="dataset.profile_history_required"):
        storage.save_tables(ORIGIN, tables, before["revision"], uuid4().hex)
    assert storage.workspace() == before


def test_existing_live_profile_cannot_become_replay_until_its_owned_history_is_pinned(storage):
    from test_data_library import commit, preview

    from services.data_library import DataLibrary

    before = storage.workspace()
    tables = deepcopy(before["tables"])
    tables["portfolios"][0]["kind"] = "replay"
    with pytest.raises(WorkspaceError, match="dataset.profile_history_required"):
        storage.save_tables(ORIGIN, tables, before["revision"], uuid4().hex)
    assert storage.workspace() == before

    library = DataLibrary(storage)
    version = commit(library, preview(library))["version"]
    current = storage.workspace()
    tables = deepcopy(current["tables"])
    tables["portfolios"][0].update(
        kind="replay",
        defaultSymbol=version["metadata"]["symbol"],
        defaultTimeframe=version["metadata"]["interval"],
        chartSource={
            "kind": "dataset",
            "versionId": version["id"],
            "checksum": version["checksum"],
        },
    )
    accepted = storage.save_tables(ORIGIN, tables, current["revision"], uuid4().hex)
    assert accepted["tables"]["portfolios"][0]["kind"] == "replay"
    assert accepted["tables"]["portfolios"][0]["chartSource"]["versionId"] == version["id"]
