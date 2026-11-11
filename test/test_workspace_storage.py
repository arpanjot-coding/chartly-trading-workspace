"""Real SQLite compatibility migration, contention and retained source checks."""

import base64
import subprocess
import sys
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import NullPool

from database.workspace_storage_db import TABLES, aliases, assets
from services.workspace_storage import WorkspaceError, WorkspaceStorage, validate_snapshot
from services.workspace_worker import run_workspace_action


def source(origin="fixture_origin_01"):
    tables = {name: [] for name in TABLES}
    tables["portfolios"] = [
        {
            "id": 1,
            "name": "Journal fixture",
            "kind": "live",
            "currency": "USD",
            "startingBalance": 10000,
            "createdAt": "2026-11-02T10:00:00Z",
            "updatedAt": "2026-11-02T10:00:00Z",
        }
    ]
    tables["journalTrades"] = [
        {
            "id": 1,
            "portfolioId": 1,
            "origin": "manual",
            "openDate": "2026-11-01",
            "closeDate": "2026-11-01",
            "pair": "EURUSD",
            "direction": "Buy",
            "lots": 0.1,
            "pnl": 12.34,
            "netPnl": 12.34,
            "technicalNotes": "original note",
            "result": "Win",
        }
    ]
    return {
        "format": "chartly-browser-snapshot",
        "version": 1,
        "originId": origin,
        "createdAt": "2026-11-02T10:00:00Z",
        "tables": tables,
        "nativeCatalogs": {
            "openalgo-chart-workspaces": {
                "fixture": {
                    "version": 1,
                    "revision": 0,
                    "workspaces": [],
                    "templates": [],
                    "recentWorkspaceIds": [],
                    "activeWorkspaceId": None,
                    "autosave": True,
                }
            }
        },
        "preferences": {},
        "attachments": {
            "attachment_fixture": {
                "mimeType": "image/png",
                "base64": base64.b64encode(b"fixture attachment bytes").decode(),
                "originalSource": "blob:fixture",
            },
            "missing_fixture": {
                "status": "unavailable",
                "originalSource": "https://example.test/missing.png",
                "reason": "external reference",
            },
        },
        "datasetManifests": [{"id": "data1", "source": "local", "status": "reference-only"}],
    }


def migrate(storage, snapshot=None):
    preview = storage.preview_migration(snapshot or source())
    return storage.commit_migration(
        preview["id"], {i["id"]: i["choices"][0] for i in preview["issues"]}, str(uuid4())
    )


@pytest.fixture
def store(tmp_path):
    service = WorkspaceStorage(
        "sqlite:///" + (tmp_path / "workspace.db").as_posix(), "principal_fixture_owner"
    )
    yield service
    service.engine.dispose()


def test_migration_reopen_idempotency_original_raw_values_and_aliases(store):
    original = source()
    receipt = migrate(store, original)
    assert receipt["status"] == "completed"
    reopened = WorkspaceStorage(store.engine, "principal_fixture_owner")
    assert reopened.workspace()["tables"] == original["tables"]
    assert isinstance(store.engine.pool, NullPool)
    with store.engine.connect() as connection:
        assert len(connection.execute(select(aliases)).all()) == 2
    repeated = deepcopy(original)
    repeated["createdAt"] = "2026-11-02T11:00:00Z"
    assert migrate(store, repeated)["idempotent"] is True
    assert len(store.workspace()["tables"]["journalTrades"]) == 1


def test_workspace_resolves_stored_trade_assets_and_retains_external_references(store):
    original = source()
    trade = original["tables"]["journalTrades"][0]
    trade.update(screenshotUrl="blob:fixture", chartUrl="https://example.test/missing.png")
    migrate(store, original)
    state = store.workspace()
    saved = state["tables"]["journalTrades"][0]
    assert saved["screenshotUrl"] == state["attachments"]["attachment_fixture"]["url"]
    assert saved["chartUrl"] == trade["chartUrl"]
    assert "base64" not in state["attachments"]["attachment_fixture"]


def test_explicit_precision_time_and_ownership_decisions_before_cutover(store):
    snapshot = source()
    snapshot["tables"]["journalTrades"][0]["origin"] = "imported"
    preview = store.preview_migration(snapshot)
    assert preview["originId"] == snapshot["originId"] and set(preview["tableChecksums"]) == set(
        TABLES
    )
    assert len(preview["snapshotHash"]) == 64 and all(
        len(value) == 64 for value in preview["tableChecksums"].values()
    )
    assert {i["kind"] for i in preview["issues"]} == {"precision", "time", "ownership"}
    assert store.context()["setupRequired"]
    with pytest.raises(WorkspaceError, match="unresolved_issues"):
        store.commit_migration(preview["id"], {}, str(uuid4()))
    assert store.context()["setupRequired"]


def test_owner_origin_isolation_and_changed_source_never_overwritten(store):
    migrate(store)
    other = WorkspaceStorage(store.engine, "principal_other_owner")
    assert other.context()["workspaces"] == []
    with pytest.raises(WorkspaceError, match="setup_required"):
        other.workspace("fixture_origin_01")
    migrate(store, source("fixture_origin_02"))
    assert len(store.context()["workspaces"]) == 2
    changed = source()
    changed["tables"]["journalTrades"][0]["pnl"] = 999
    with pytest.raises(WorkspaceError, match="changed_origin_requires_review"):
        migrate(store, changed)
    assert store.workspace("fixture_origin_01")["tables"]["journalTrades"][0]["pnl"] == 12.34


def test_cas_lost_response_replay_and_archive_preserves_parents(store):
    migrate(store)
    state = store.workspace()
    tables = deepcopy(state["tables"])
    tables["journalTrades"][0]["technicalNotes"] = "saved"
    request = str(uuid4())
    response = store.save_tables(state["originId"], tables, state["revision"], request)
    assert store.save_tables(state["originId"], tables, state["revision"], request) == response
    with pytest.raises(WorkspaceError, match="revision_conflict"):
        store.save_tables(state["originId"], tables, state["revision"], str(uuid4()))
    tables = deepcopy(response["tables"])
    tables["portfolios"] = []
    result = store.save_tables(state["originId"], tables, response["revision"], str(uuid4()))
    assert result["tables"]["portfolios"][0]["archivedAt"]
    assert result["tables"]["journalTrades"][0]["technicalNotes"] == "saved"
    with pytest.raises(WorkspaceError, match="reused_with_different_input"):
        store.save_tables(state["originId"], tables, response["revision"], request)


def test_native_cas_does_not_change_table_revision_or_duplicate_attachments(store):
    migrate(store)
    state = store.workspace()
    catalog = source()["nativeCatalogs"]["openalgo-chart-workspaces"]["fixture"]
    catalog["revision"] = 1
    result = store.save_native("workspace", "fixture", catalog, 0, str(uuid4()))
    assert result["catalog"]["revision"] == 1
    assert store.workspace()["revision"] == state["revision"]
    with pytest.raises(WorkspaceError, match="revision_conflict"):
        store.save_native("workspace", "fixture", catalog, 0, str(uuid4()))
    with store.engine.connect() as connection:
        assert len(connection.execute(select(assets)).all()) == 1
    assert store.snapshot()["snapshot"]["attachments"]["missing_fixture"]["status"] == "unavailable"


def test_database_independently_enforces_parent_constraints(store):
    migrate(store)
    with pytest.raises(IntegrityError):
        with store.engine.begin() as connection:
            connection.execute(
                insert(TABLES["journalTrades"]).values(
                    uid=store.uid, origin="fixture_origin_01", id=99, payload="{}", portfolioId=99
                )
            )


def test_imported_unknown_source_facts_are_locked_but_notes_remain_editable(store):
    snapshot = source()
    snapshot["tables"]["journalTrades"][0].update(origin="imported", providerProfit="12.3400")
    migrate(store, snapshot)
    state = store.workspace()
    tables = deepcopy(state["tables"])
    tables["journalTrades"][0]["providerProfit"] = "999"
    with pytest.raises(WorkspaceError, match="source_fact_locked"):
        store.save_tables(state["originId"], tables, state["revision"], "source_request_001")
    tables = deepcopy(state["tables"])
    tables["journalTrades"][0]["technicalNotes"] = "reviewed source"
    assert (
        store.save_tables(state["originId"], tables, state["revision"], "source_request_002")[
            "tables"
        ]["journalTrades"][0]["providerProfit"]
        == "12.3400"
    )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda s: s["tables"]["journalTrades"][0].update(portfolioId=999),
        lambda s: s.update(password="forbidden"),
        lambda s: s["preferences"].update({"auth-token": "forbidden"}),
        lambda s: s["nativeCatalogs"]["openalgo-chart-workspaces"]["fixture"].update(version=999),
        lambda s: s["attachments"]["attachment_fixture"].update(mimeType="text/html"),
    ],
)
def test_rejects_invalid_relationships_secrets_and_native_schema(mutate):
    snapshot = source()
    mutate(snapshot)
    with pytest.raises(WorkspaceError):
        validate_snapshot(snapshot)


def test_real_subprocess_migration_and_reopen(store):
    url = store.engine.url.render_as_string(hide_password=False)
    preview = run_workspace_action(
        url, store.uid, "migration_preview", {"snapshot": source(), "native_target": None}
    )
    receipt = run_workspace_action(
        url,
        store.uid,
        "migration_commit",
        {
            "id": preview["id"],
            "resolutions": {i["id"]: i["choices"][0] for i in preview["issues"]},
            "request_id": str(uuid4()),
        },
    )
    assert receipt["status"] == "completed"
    assert (
        run_workspace_action(url, store.uid, "workspace", {})["tables"]["journalTrades"][0]["pnl"]
        == 12.34
    )
    with pytest.raises(WorkspaceError, match="unsupported_action"):
        run_workspace_action(url, store.uid, "arbitrary-code")


def test_preferences_compare_previous_value_and_do_not_overwrite_newer_draft(store):
    migrate(store)
    first = {"oa-trading-script-draft:fixture.oscript": 'study("saved")'}
    result = store.save_preferences("fixture_origin_01", first, "prefs_request_001", {})
    assert result["preferences"] == first
    with pytest.raises(WorkspaceError, match="revision_conflict"):
        store.save_preferences("fixture_origin_01", {}, "prefs_request_002", {})
    assert store.workspace()["preferences"] == first
    assert store.save_preferences("fixture_origin_01", first, "prefs_request_001", {}) == result


def test_locked_and_full_database_fail_without_partial_write(store):
    migrate(store)
    before = store.workspace()
    with store.engine.connect() as holder:
        holder.exec_driver_sql("BEGIN IMMEDIATE")
        with pytest.raises(WorkspaceError, match="unavailable"):
            store.save_tables(
                before["originId"], before["tables"], before["revision"], "locked_request_001"
            )
        holder.rollback()
    from sqlalchemy import event

    def fill(connection, _record):
        cursor = connection.cursor()
        try:
            count = cursor.execute("PRAGMA page_count").fetchone()[0]
            cursor.execute(f"PRAGMA max_page_count={count}")
        finally:
            cursor.close()

    event.listen(store.engine, "connect", fill)
    tables = deepcopy(before["tables"])
    tables["journalTrades"][0]["technicalNotes"] = "x" * 2_000_000
    try:
        with pytest.raises(WorkspaceError, match="unavailable"):
            store.save_tables(before["originId"], tables, before["revision"], "full_request_001")
    finally:
        event.remove(store.engine, "connect", fill)
    assert store.workspace()["tables"] == before["tables"]


def test_abrupt_process_exit_before_commit_rolls_back_real_storage_transaction(store):
    migrate(store)
    before = store.workspace()
    url = store.engine.url.render_as_string(hide_password=False)
    script = """import os,sys
from services.workspace_storage import WorkspaceStorage
s=WorkspaceStorage(sys.argv[1],sys.argv[2])
with s.transaction() as c:
    state=s._read(c,'fixture_origin_01')
    state['snapshot']['tables']['journalTrades'][0]['technicalNotes']='interrupted'
    s._write(c,state['snapshot'],state['bindings'])
    os._exit(73)
"""
    completed = subprocess.run(
        [sys.executable, "-c", script, url, store.uid], capture_output=True, timeout=20
    )
    assert completed.returncode == 73
    assert store.workspace()["tables"] == before["tables"]
