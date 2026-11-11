"""P02 repository integration against real, isolated SQLite transactions."""

import json
from copy import deepcopy
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest
from sqlalchemy import event, insert, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from database.domain_store import (
    accounts,
    books,
    create_domain_engine,
    entities,
    initialize_store,
    journal_entries,
    manual_trades,
    metadata,
    store_version,
)
from services.domain.repository import DomainRepository, RepositoryError

FIXTURES = Path(__file__).resolve().parents[1] / "contracts/v1/fixtures"
CORE = json.loads((FIXTURES / "local-core.json").read_text(encoding="utf-8"))
FULL = json.loads((FIXTURES / "full-v1.json").read_text(encoding="utf-8"))
OWNER = "owner_local_001"
WORKSPACE = "workspace_local_001"
AT = "2026-11-02T10:01:00Z"


def fixture(id):
    return deepcopy(next(entry for entry in FULL if entry["value"]["id"] == id))


def bootstrap(repo):
    return repo.apply(
        [
            deepcopy(entry)
            for entry in CORE
            if entry["type"] in ("LocalOwner", "Workspace", "Account", "JournalBook", "Profile")
        ]
    )


@pytest.fixture
def store(tmp_path):
    url = f"sqlite:///{(tmp_path / 'domain.db').as_posix()}"
    engine = create_domain_engine(url)
    initialize_store(engine)
    repo = DomainRepository(engine, OWNER, WORKSPACE)
    bootstrap(repo)
    yield engine, repo, url
    engine.dispose()


def write_manual(repo):
    trade = fixture("manual_trade_001")
    entry = fixture("entry_manual_001")
    repo.apply([trade, entry])
    return trade["value"]


def test_persistent_reopen_and_exact_decimal_values(store):
    engine, repo, url = store
    trade = write_manual(repo)
    changed = {
        **trade,
        "revision": 2,
        "updatedAt": AT,
        "netPnl": {"value": "9007199254740993.00000001", "currency": "USD"},
    }
    repo.apply([{"type": "ManualTrade", "value": changed}], expected_revisions={trade["id"]: 1})
    engine.dispose()
    reopened = create_domain_engine(url)
    try:
        initialize_store(reopened)
        assert (
            DomainRepository(reopened, OWNER, WORKSPACE).get("ManualTrade", trade["id"]) == changed
        )
    finally:
        reopened.dispose()


def test_repositories_use_nullpool_and_real_constraints(store):
    engine, _, _ = store
    assert isinstance(engine.pool, NullPool)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        assert connection.exec_driver_sql("PRAGMA synchronous").scalar_one() == 2  # FULL
        assert connection.exec_driver_sql("PRAGMA journal_mode").scalar_one() == "wal"


def test_bound_scope_rejects_foreign_actor_and_hides_reads(store):
    engine, repo, _ = store
    foreign = DomainRepository(engine, "owner_foreign_001", "workspace_foreign_001")
    assert foreign.get("JournalBook", "book_manual_001") is None
    assert foreign.list("Profile") == []
    with pytest.raises(RepositoryError, match="storage.scope_denied"):
        foreign.apply([fixture("book_manual_001")])
    assert repo.get("JournalBook", "book_manual_001")["name"] == "Manual book"


def test_reference_to_foreign_workspace_cannot_be_committed(store):
    engine, repo, _ = store
    second = DomainRepository(engine, OWNER, "workspace_second_001")
    workspace = deepcopy(CORE[1])
    workspace["value"]["id"] = "workspace_second_001"
    second.apply([workspace])
    profile = deepcopy(CORE[5])
    profile["value"].update(id="profile_second_001", workspaceId="workspace_second_001")
    with pytest.raises(RepositoryError, match="contract.invalid"):
        second.apply([profile])
    assert second.get("Profile", "profile_second_001") is None
    assert repo.get("Profile", "profile_local_001") is not None


def test_stale_edit_is_rejected_and_idempotent_retry_has_no_new_effect(store):
    _, repo, _ = store
    trade = write_manual(repo)
    changed = {**trade, "notes": "First saved edit", "revision": 2, "updatedAt": AT}
    command = [{"type": "ManualTrade", "value": changed}]
    repo.apply(command, expected_revisions={trade["id"]: 1})
    repo.apply(command, expected_revisions={trade["id"]: 1})
    stale = {**changed, "notes": "Stale tab overwrites first edit"}
    with pytest.raises(RepositoryError, match="storage.revision_conflict"):
        repo.apply([{"type": "ManualTrade", "value": stale}], expected_revisions={trade["id"]: 1})
    assert repo.get("ManualTrade", trade["id"])["notes"] == "First saved edit"
    assert repo.get("ManualTrade", trade["id"])["revision"] == 2
    assert len(repo.list("JournalEntry")) == 1


def test_missing_parent_and_precision_fail_before_commit(store):
    _, repo, _ = store
    trade = fixture("manual_trade_001")
    trade["value"]["bookId"] = "book_missing_001"
    with pytest.raises(RepositoryError, match="contract.invalid"):
        repo.apply([trade])
    assert repo.get("ManualTrade", "manual_trade_001") is None
    trade = fixture("manual_trade_001")
    trade["value"]["netPnl"] = {"value": 0.1, "currency": "USD"}
    with pytest.raises(RepositoryError, match="contract.invalid"):
        repo.apply([trade])


def test_archive_profile_keeps_its_book_and_trades(store):
    _, repo, _ = store
    write_manual(repo)
    result = repo.archive("Profile", "profile_local_001", expected_revision=1, at=AT)
    assert result["state"] == "archived"
    assert repo.get("JournalBook", "book_manual_001")["state"] == "active"
    assert repo.get("ManualTrade", "manual_trade_001") is not None
    assert repo.get("JournalEntry", "entry_manual_001") is not None


def test_book_archive_reactivate_keeps_identity_and_refuses_new_copy(store):
    _, repo, _ = store
    archived = repo.archive("JournalBook", "book_connected_001", expected_revision=1, at=AT)
    proposed = fixture("book_connected_001")
    proposed["value"]["id"] = "book_connected_002"
    with pytest.raises(RepositoryError, match="book.reuse_existing"):
        repo.apply([proposed])
    reopened = {**archived, "revision": 3, "state": "active"}
    repo.apply([{"type": "JournalBook", "value": reopened}], expected_revisions={archived["id"]: 2})
    assert len(repo.list("JournalBook")) == 2
    assert repo.get("JournalBook", "book_connected_001")["state"] == "active"


def test_archived_book_rejects_new_capture_without_erasing_history(store):
    _, repo, _ = store
    repo.archive("JournalBook", "book_manual_001", expected_revision=1, at=AT)
    with pytest.raises(RepositoryError, match="book.archived"):
        write_manual(repo)
    assert repo.list("ManualTrade") == []


def test_selection_clear_means_no_trades_and_pages_are_scoped(store):
    _, repo, _ = store
    write_manual(repo)
    assert repo.list("ManualTrade", book_ids=[]) == []
    assert repo.list("ManualTrade", book_ids=["book_connected_001"]) == []
    assert len(repo.list("ManualTrade", book_ids=["book_manual_001"])) == 1
    assert repo.list("ManualTrade", after="manual_trade_001") == []


def test_aliases_are_persistent_scoped_and_cannot_retarget(store):
    engine, repo, _ = store
    profile = deepcopy(CORE[5])
    profile["value"].update(
        revision=2,
        updatedAt=AT,
        aliases=[{"namespace": "ChartlyTraderDB:origin-a:portfolios", "key": "1"}],
    )
    repo.apply([profile], expected_revisions={profile["value"]["id"]: 1})
    alias = DomainRepository(engine, OWNER, WORKSPACE).by_alias(
        "ChartlyTraderDB:origin-a:portfolios", "1"
    )
    assert alias["id"] == "profile_local_001"
    assert (
        DomainRepository(engine, "owner_foreign_001", "workspace_foreign_001").by_alias(
            "ChartlyTraderDB:origin-a:portfolios", "1"
        )
        is None
    )
    copy = deepcopy(profile)
    copy["value"].update(id="profile_copy_001", revision=1)
    with pytest.raises(RepositoryError, match="storage.alias_conflict"):
        repo.apply([copy])
    assert repo.get("Profile", "profile_copy_001") is None


def test_failure_after_first_row_rolls_back_entire_batch(store):
    _, repo, _ = store
    first = deepcopy(CORE[5])
    first["value"].update(
        id="profile_batch_001", aliases=[{"namespace": "batch-rollback-test", "key": "same"}]
    )
    second = deepcopy(first)
    second["value"]["id"] = "profile_batch_002"
    with pytest.raises(RepositoryError, match="storage.alias_conflict"):
        repo.apply([first, second])
    assert repo.get("Profile", "profile_batch_001") is None
    assert repo.get("Profile", "profile_batch_002") is None
    assert repo.by_alias("batch-rollback-test", "same") is None


def test_database_alone_rejects_duplicate_active_account_book(store):
    engine, _, _ = store
    book = fixture("book_connected_001")["value"]
    book["id"] = "book_direct_002"
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            insert(entities).values(
                id=book["id"], record_type="JournalBook", owner_id=OWNER, workspace_id=WORKSPACE
            )
        )
        connection.execute(
            insert(books).values(
                id=book["id"],
                record_type="JournalBook",
                owner_id=OWNER,
                workspace_id=WORKSPACE,
                revision=1,
                payload=json.dumps(book),
                kind="connected",
                state="active",
                account_id="account_external_001",
                account_kind="external",
            )
        )
    with engine.connect() as connection:
        assert (
            connection.execute(select(entities.c.id).where(entities.c.id == book["id"])).first()
            is None
        )


def test_database_restricts_account_delete_while_book_exists(store):
    engine, repo, _ = store
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(accounts.delete().where(accounts.c.id == "account_external_001"))
    assert repo.get("Account", "account_external_001") is not None


def test_database_rejects_cross_owner_book_link_without_validator(store):
    engine, _, _ = store
    other = DomainRepository(engine, "owner_second_001", "workspace_second_001")
    owner = deepcopy(CORE[0])
    owner["value"]["id"] = "owner_second_001"
    workspace = deepcopy(CORE[1])
    workspace["value"].update(id="workspace_second_001", ownerId="owner_second_001")
    other.apply([owner, workspace])
    book = fixture("book_connected_001")["value"]
    book.update(
        id="book_foreign_001", ownerId="owner_second_001", workspaceId="workspace_second_001"
    )
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(
            insert(entities).values(
                id=book["id"],
                record_type="JournalBook",
                owner_id=book["ownerId"],
                workspace_id=book["workspaceId"],
            )
        )
        connection.execute(
            insert(books).values(
                id=book["id"],
                record_type="JournalBook",
                owner_id=book["ownerId"],
                workspace_id=book["workspaceId"],
                revision=1,
                payload=json.dumps(book),
                kind="connected",
                state="active",
                account_id="account_external_001",
                account_kind="external",
            )
        )


def test_failed_schema_bootstrap_rolls_back_ddl_and_can_retry(tmp_path):
    engine = create_domain_engine(f"sqlite:///{(tmp_path / 'bootstrap.db').as_posix()}")

    def fail(*_args, **_kwargs):
        raise RuntimeError("Injected schema bootstrap interruption")

    event.listen(journal_entries, "after_create", fail)
    try:
        with pytest.raises(RuntimeError, match="interruption"):
            initialize_store(engine)
    finally:
        event.remove(journal_entries, "after_create", fail)
    assert inspect(engine).get_table_names() == []
    initialize_store(engine)
    assert set(metadata.tables) == set(inspect(engine).get_table_names())
    engine.dispose()


def test_unsupported_schema_is_not_silently_rewritten(store):
    engine, _, _ = store
    with engine.begin() as connection:
        connection.execute(store_version.update().values(version=999))
    with pytest.raises(ValueError, match="storage.unsupported_schema"):
        initialize_store(engine)
    with engine.connect() as connection:
        assert connection.execute(select(store_version.c.version)).scalar_one() == 999


def test_trusted_actor_scope_cannot_be_retargeted_in_place(store):
    _, repo, _ = store
    with pytest.raises(FrozenInstanceError):
        repo.owner_id = "owner_foreign_001"


def test_missing_constraint_is_detected_without_silent_repair(store):
    engine, _, _ = store
    with engine.begin() as connection:
        connection.exec_driver_sql("DROP INDEX uq_domain_active_connected_book")
    with pytest.raises(ValueError, match="storage.incomplete_schema"):
        initialize_store(engine)


def test_corrupt_query_columns_are_detected_before_display(store):
    engine, repo, _ = store
    write_manual(repo)
    new_book = fixture("book_manual_001")
    new_book["value"]["id"] = "book_manual_002"
    repo.apply([new_book])
    corrupted = {**repo.get("ManualTrade", "manual_trade_001"), "bookId": "book_manual_002"}
    with engine.begin() as connection:
        connection.execute(
            manual_trades.update()
            .where(manual_trades.c.id == "manual_trade_001")
            .values(payload=json.dumps(corrupted))
        )
    with pytest.raises(RepositoryError, match="storage.corrupt_record"):
        repo.get("ManualTrade", "manual_trade_001")


def test_store_larger_than_validation_batch_accepts_scoped_edits(store):
    engine, repo, _ = store
    sample = fixture("manual_trade_001")["value"]
    registry_rows = []
    trade_rows = []
    for i in range(10001):
        value = {**sample, "id": f"trade_bulk_{i:05d}"}
        registry_rows.append(
            {
                "id": value["id"],
                "record_type": "ManualTrade",
                "owner_id": OWNER,
                "workspace_id": WORKSPACE,
            }
        )
        trade_rows.append(
            {
                "id": value["id"],
                "record_type": "ManualTrade",
                "owner_id": OWNER,
                "workspace_id": WORKSPACE,
                "revision": 1,
                "payload": json.dumps(value),
                "book_id": "book_manual_001",
                "book_kind": "manual",
            }
        )
    with engine.begin() as connection:
        connection.execute(insert(entities), registry_rows)
        connection.execute(insert(manual_trades), trade_rows)
    value = repo.get("ManualTrade", "trade_bulk_00000")
    edited = {
        **value,
        "revision": 2,
        "updatedAt": AT,
        "notes": "Edited without loading the whole journal",
    }
    repo.apply([{"type": "ManualTrade", "value": edited}], expected_revisions={value["id"]: 1})
    assert repo.get("ManualTrade", value["id"])["notes"] == edited["notes"]


def test_locked_store_returns_failure_and_preserves_data(store, monkeypatch):
    import database

    engine, repo, _ = store
    write_manual(repo)
    value = repo.get("ManualTrade", "manual_trade_001")
    monkeypatch.setattr(database, "LOCK_RETRY_BUDGET_S", 0)
    with engine.connect() as holder:
        holder.exec_driver_sql("BEGIN IMMEDIATE")
        with pytest.raises(RepositoryError, match="storage.unavailable"):
            repo.apply(
                [
                    {
                        "type": "ManualTrade",
                        "value": {
                            **value,
                            "revision": 2,
                            "updatedAt": AT,
                            "notes": "Must not be saved",
                        },
                    }
                ],
                expected_revisions={value["id"]: 1},
            )
        holder.rollback()
    assert repo.get("ManualTrade", value["id"]) == value


@pytest.mark.parametrize(
    "url",
    [
        "sqlite:///:memory:",
        "sqlite://",
        "sqlite:///file:shared?mode=memory&uri=true",
        "postgresql://localhost/not-used",
    ],
)
def test_only_explicit_file_backed_sqlite_is_supported_in_this_slice(url):
    with pytest.raises(ValueError, match="storage.file_sqlite_required"):
        create_domain_engine(url)
