"""Full archive and real, isolated SQLite restore boundaries for P02."""

import base64
import hashlib
import json
import stat
import struct
from copy import deepcopy
from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

import pytest
from sqlalchemy import event, insert

import services.workspace_recovery as recovery
import services.workspace_storage as workspace_storage
from database.workspace_storage_db import jobs
from services.journal_ledger import empty_ledger
from services.workspace_recovery import (
    BackupModule,
    BackupModuleRegistry,
    WorkspaceRecoveryError,
    WorkspaceRecoveryService,
    build_workspace_backup,
    inspect_workspace_backup,
)
from services.workspace_storage import WorkspaceError, WorkspaceStorage
from services.workspace_worker import run_workspace_action

ALICE = "principal_alice_001"
BOB = "principal_bob_00002"
WHEN = "2026-11-02T10:11:12.123Z"


def snapshot(origin="browser_origin_0001", *, missing_attachment=False):
    source = "data:image/png;base64," + base64.b64encode(b"fixture-image-content").decode()
    result = {
        "format": "chartly-browser-snapshot",
        "version": 1,
        "originId": origin,
        "createdAt": WHEN,
        "tables": {
            "portfolios": [
                {"id": 1, "name": "My original book", "type": "live", "archivedAt": None}
            ],
            "practiceSessions": [{"id": 1, "portfolioId": 1, "name": "Practice"}],
            "journalTrades": [
                {
                    "id": 1,
                    "portfolioId": 1,
                    "accountId": 1,
                    "sessionId": 1,
                    "origin": "import",
                    "symbol": "EURUSD",
                    "pnl": 12.34,
                    "notes": "A deliberate raw legacy value",
                    "screenshotUrl": source,
                    "archivedAt": "2026-10-01",
                }
            ],
            "dailyMoods": [{"id": 1, "portfolioId": 1, "mood": "calm"}],
            "brokerAccounts": [
                {
                    "id": 1,
                    "platform": "mt5",
                    "server": "Broker-demo",
                    "externalLogin": "123",
                    "displayName": "Demo",
                    "currency": "USD",
                    "accountKind": "demo",
                }
            ],
            "terminals": [{"id": 1, "assignedAccountId": 1, "name": "MT5 local"}],
            "profileDestinations": [
                {"id": 1, "portfolioId": 1, "accountId": 1, "terminalId": 1, "copyingEnabled": True}
            ],
        },
        "nativeCatalogs": {
            "openalgo-chart-workspaces": {
                "source-user": {
                    "version": 1,
                    "revision": 4,
                    "workspaces": [
                        {
                            "version": 1,
                            "kind": "workspace",
                            "id": "desk-1",
                            "name": "Saved chart desk",
                            "createdAt": 1,
                            "updatedAt": 2,
                            "panes": [
                                {
                                    "id": "pane-1",
                                    "symbol": "EURUSD",
                                    "exchange": "FOREX",
                                    "interval": "5m",
                                    "chartType": "candles",
                                    "chart": {"drawings": [], "indicators": []},
                                    "settings": {},
                                    "volume": True,
                                    "stay": False,
                                    "magnet": "weak",
                                    "comparisons": [],
                                    "comparisonMode": "price",
                                }
                            ],
                            "activePaneId": "pane-1",
                            "layout": {
                                "rows": 1,
                                "columns": 1,
                                "slots": [
                                    {
                                        "paneId": "pane-1",
                                        "row": 0,
                                        "column": 0,
                                        "rowSpan": 1,
                                        "columnSpan": 1,
                                    }
                                ],
                            },
                            "sync": {
                                "crosshair": True,
                                "viewport": False,
                                "symbol": False,
                                "interval": False,
                            },
                        }
                    ],
                    "templates": [
                        {
                            "version": 1,
                            "kind": "indicator-template",
                            "id": "template-1",
                            "name": "My studies",
                            "createdAt": 1,
                            "updatedAt": 2,
                            "indicators": [],
                        }
                    ],
                    "activeWorkspaceId": "desk-1",
                    "recentWorkspaceIds": ["desk-1"],
                    "autosave": True,
                }
            },
            "openalgo-chart-watchlists": {
                "source-user": {
                    "version": 1,
                    "revision": 2,
                    "lists": [
                        {
                            "id": "watch-1",
                            "name": "Forex",
                            "createdAt": 1,
                            "updatedAt": 2,
                            "entries": [{"symbol": "EURUSD", "exchange": "FOREX"}],
                        }
                    ],
                    "activeListId": "watch-1",
                }
            },
            "openalgo-chart-drawing-templates": {
                "source-user": {
                    "version": 1,
                    "revision": 1,
                    "templates": [
                        {
                            "id": "drawing-1",
                            "name": "Levels",
                            "tool": "horizontal-line",
                            "values": {"color": "black"},
                            "createdAt": 1,
                            "updatedAt": 2,
                        }
                    ],
                    "defaults": [
                        {"tool": "horizontal-line", "values": {"color": "black"}, "updatedAt": 2}
                    ],
                }
            },
        },
        "preferences": {
            "chartly.combined-selection.v1": json.dumps(
                {"version": 1, "profileIds": [], "currency": "USD"}
            ),
            "chartly.customIndicators.manifest.v1": json.dumps({"MyIndicator.oscript@1": ["Plot"]}),
            "oa-trading-script-open": "MyIndicator.oscript",
            "oa-trading-script-recent": json.dumps(["MyIndicator.oscript"]),
            "oa-trading-script-draft:MyIndicator.oscript": 'indicator("Fixture"); // restored as text only',
            "chartly-theme": json.dumps(
                {"state": {"mode": "light", "color": "blue"}, "version": 1}
            ),
            "oa-agent-model": "1",
        },
        "attachments": {
            "attachment_image_0001": {
                "mimeType": "image/png",
                "base64": base64.b64encode(b"fixture-image-content").decode(),
                "originalSource": source,
            }
        },
        "datasetManifests": [
            {
                "id": "dataset-1",
                "provider": "local",
                "path": "operator-data/EURUSD.parquet",
                "symbol": "EURUSD",
                "contentSha256": "a" * 64,
            }
        ],
    }
    if missing_attachment:
        result["attachments"]["attachment_unavailable_0002"] = {
            "status": "unavailable",
            "originalSource": "https://example.invalid/screenshot.png",
            "reason": "Remote URL was not downloaded",
        }
    return result


def state(uid=ALICE, origins=2, *, missing_attachment=False):
    workspaces = []
    for index in range(origins):
        saved = snapshot(f"browser_origin_000{index + 1}", missing_attachment=missing_attachment)
        workspaces.append(
            {
                "snapshot": saved,
                "journalLedger": empty_ledger(),
                "paperSessions": [],
                "connectorRecords": [],
                "revision": index + 1,
                "stateRevision": index + 2,
                "bindings": {
                    "books": [{"id": "book_fixture", "kind": "connected", "ownerId": uid}],
                    "bookAssignments": {"journalTrades:1": "book_fixture"},
                    "resolutions": {"legacy-precision": "keep-raw", "trade:1": "account:1"},
                    "archives": {"journalTrades": [1]},
                    "nativeNamespaceMappings": {
                        "openalgo-chart-workspaces": {"current-user": "source-user"}
                    },
                },
            }
        )
    return {
        "principalUid": uid,
        "revision": 3,
        "generation": 3,
        "activeOriginId": workspaces[-1]["snapshot"]["originId"] if workspaces else None,
        "workspaces": workspaces,
    }


def content_without_counters(value):
    """Restore invalidates old CAS counters while preserving their data."""
    if isinstance(value, list):
        return [content_without_counters(item) for item in value]
    if isinstance(value, dict):
        return {
            key: content_without_counters(item)
            for key, item in value.items()
            if key not in {"revision", "stateRevision", "generation"}
        }
    return value


def archive_files(data):
    with ZipFile(BytesIO(data)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def repack(files, *, update_manifest=False, symlink=None):
    files = dict(files)
    if update_manifest:
        manifest = json.loads(files["manifest.json"])
        for name, value in files.items():
            if name != "manifest.json":
                manifest["files"][name] = {
                    "sha256": hashlib.sha256(value).hexdigest(),
                    "bytes": len(value),
                }
        files["manifest.json"] = json.dumps(manifest).encode()
    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name, value in files.items():
            if name == symlink:
                info = ZipInfo(name)
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(info, value)
            else:
                archive.writestr(name, value)
    return output.getvalue()


def change_json(data, path, change, *, repair_checksums=True):
    files = archive_files(data)
    value = json.loads(files[path])
    change(value)
    files[path] = json.dumps(value).encode()
    return repack(files, update_manifest=repair_checksums)


def assert_rejected(data, code=None, status=None):
    with pytest.raises(WorkspaceRecoveryError) as caught:
        inspect_workspace_backup(data)
    if code:
        assert caught.value.code == code
    if status:
        assert caught.value.status == status


def migrate(storage, saved):
    preview = storage.preview_migration(saved)
    choices = {
        issue["id"]: ("account:1" if issue["id"] == "trade:1" else issue["choices"][0])
        for issue in preview["issues"]
    }
    storage.commit_migration(preview["id"], choices, "migration_" + uuid4().hex)


@pytest.fixture
def storage(tmp_path):
    store = WorkspaceStorage("sqlite:///" + (tmp_path / "workspace.sqlite").as_posix(), ALICE)
    yield store
    store.engine.dispose()


def test_archive_roundtrip_retains_every_origin_module_and_raw_value():
    original = state(missing_attachment=True)
    parsed = inspect_workspace_backup(build_workspace_backup(ALICE, original))
    assert parsed["state"]["workspaces"] == original["workspaces"]
    assert parsed["originCount"] == 2
    assert parsed["tableCounts"] == dict.fromkeys(recovery.TABLES, 2)
    assert parsed["moduleCounts"] == {
        "journal": 14,
        "charts": 6,
        "preferences": 14,
        "attachments": 4,
        "datasets": 2,
        "bindings": 2,
        "journal-records": 0,
        "paper-sessions": 0,
        "connectors": 0,
    }
    assert len(parsed["unavailableAttachments"]) == 2
    assert {item["kind"] for item in parsed["unverifiedDependencies"]} == {
        "market-data-files",
        "installed-indicator-code",
    }
    assert "market-data-file-content" in parsed["manifest"]["excludedModules"]
    assert len(archive_files(build_workspace_backup(ALICE, original))) == 11
    assert parsed["state"]["snapshot"]["tables"]["journalTrades"][0]["pnl"] == 12.34


def test_backup_scope_cannot_be_chosen_from_archive_metadata():
    with pytest.raises(WorkspaceRecoveryError, match="scope_denied") as caught:
        build_workspace_backup(BOB, state())
    assert caught.value.status == 403


@pytest.mark.parametrize(
    "mutation,code",
    [
        (
            lambda s: s["workspaces"][0]["snapshot"]["tables"]["journalTrades"][0].update(
                portfolioId=999
            ),
            "recovery.broken_relationship",
        ),
        (
            lambda s: s["workspaces"][0]["snapshot"]["tables"]["portfolios"].append({"id": 1}),
            "recovery.duplicate_record_identity",
        ),
        (
            lambda s: s["workspaces"][0]["snapshot"]["tables"]["journalTrades"][0].update(id=True),
            "recovery.invalid_record_identity",
        ),
        (
            lambda s: s["workspaces"][0]["snapshot"]["tables"]["brokerAccounts"][0].update(
                apiKey="secret"
            ),
            "recovery.credentials_forbidden",
        ),
        (
            lambda s: s["workspaces"][0]["snapshot"]["preferences"].update(
                {"chartly-auth": "secret"}
            ),
            "recovery.preference_forbidden",
        ),
        (
            lambda s: s["workspaces"][0]["snapshot"]["preferences"].update(
                {
                    "chartly-theme": json.dumps(
                        {"state": {"mode": "light", "color": "blue", "appMode": "live"}}
                    )
                }
            ),
            "recovery.invalid_theme",
        ),
        (
            lambda s: s["workspaces"][0]["snapshot"]["tables"]["journalTrades"][0].update(
                pnl=float("nan")
            ),
            "recovery.nonfinite_number",
        ),
        (
            lambda s: s["workspaces"][0]["bindings"]["resolutions"].update(
                {"trade:1": "account:999"}
            ),
            "recovery.invalid_book_resolution",
        ),
        (
            lambda s: s["workspaces"][0]["bindings"]["nativeNamespaceMappings"][
                "openalgo-chart-workspaces"
            ].update({"x": "not-present"}),
            "recovery.invalid_namespace_mapping",
        ),
        (
            lambda s: s["workspaces"][0]["snapshot"].update(createdAt="2026-02-30T10:11:12Z"),
            "recovery.invalid_origin",
        ),
        (lambda s: s.update(generation=4), "recovery.invalid_revision"),
        (
            lambda s: s["workspaces"][0]["snapshot"]["attachments"]["attachment_image_0001"].update(
                mimeType="text/html"
            ),
            "recovery.attachment_type_forbidden",
        ),
        (
            lambda s: s["workspaces"][0]["snapshot"]["attachments"]["attachment_image_0001"].update(
                sha256="a" * 64
            ),
            "recovery.attachment_checksum_mismatch",
        ),
        (
            lambda s: s["workspaces"][0]["snapshot"]["attachments"]["attachment_image_0001"].update(
                originalSource={"not": "a URL"}
            ),
            "recovery.invalid_attachment",
        ),
        (
            lambda s: s["workspaces"][0]["snapshot"]["nativeCatalogs"]["openalgo-chart-workspaces"][
                "source-user"
            ]["workspaces"][0]["layout"]["slots"][0].update(columnSpan=2),
            "recovery.invalid_workspace_layout",
        ),
        (
            lambda s: s["workspaces"][0]["snapshot"]["nativeCatalogs"]["openalgo-chart-workspaces"][
                "source-user"
            ].update(activeWorkspaceId=[]),
            "recovery.invalid_catalogs",
        ),
        (
            lambda s: s["workspaces"][0]["snapshot"]["nativeCatalogs"]["openalgo-chart-workspaces"][
                "source-user"
            ]["workspaces"][0].update(createdAt=10**1000),
            "recovery.invalid_catalog_timestamp",
        ),
        (
            lambda s: s.update(activeOriginId=[]),
            "recovery.invalid_active_origin",
        ),
    ],
)
def test_invalid_payloads_fail_before_archive_or_storage_mutation(mutation, code):
    saved = state()
    mutation(saved)
    with pytest.raises(WorkspaceRecoveryError) as caught:
        build_workspace_backup(ALICE, saved)
    assert caught.value.code == code


@pytest.mark.parametrize(
    "mutate,code",
    [
        (lambda v: v.update(version=True), "recovery.unsupported_version"),
        (lambda v: v["modules"].append("unknown-code"), "recovery.unsupported_modules"),
        (lambda v: v["counts"].update(originCount=True), "recovery.count_mismatch"),
    ],
)
def test_manifest_version_modules_and_typed_counts_are_enforced(mutate, code):
    archive = build_workspace_backup(ALICE, state())
    assert_rejected(change_json(archive, "manifest.json", mutate), code)


def test_all_module_checksums_are_verified_before_loading():
    archive = build_workspace_backup(ALICE, state())
    changed = change_json(
        archive,
        "modules/journal.json",
        lambda value: value["browser_origin_0001"]["journalTrades"][0].update(notes="tampered"),
        repair_checksums=False,
    )
    assert_rejected(changed, "recovery.checksum_mismatch")


def test_strict_json_rejects_duplicates_and_nonfinite_values_even_with_valid_hashes():
    files = archive_files(build_workspace_backup(ALICE, state()))
    files["state.json"] = files["state.json"].replace(
        b'"revision":3', b'"revision":3,"revision":3', 1
    )
    assert_rejected(repack(files, update_manifest=True), "recovery.duplicate_json_key")
    files = archive_files(build_workspace_backup(ALICE, state()))
    files["modules/journal.json"] = files["modules/journal.json"].replace(b"12.34", b"NaN", 1)
    assert_rejected(repack(files, update_manifest=True), "recovery.nonfinite_number")


def test_archive_never_accepts_paths_duplicate_members_links_or_trailing_bytes():
    data = build_workspace_backup(ALICE, state())
    files = archive_files(data)
    renamed = dict(files)
    renamed["../journal.json"] = renamed.pop("modules/journal.json")
    assert_rejected(repack(renamed), "recovery.invalid_archive_members")
    assert_rejected(repack(files, symlink="state.json"), "recovery.invalid_archive_member")
    assert_rejected(data + b"trailing", "recovery.invalid_archive")
    assert_rejected(data[:-1], "recovery.invalid_archive")
    stream = BytesIO()
    with pytest.warns(UserWarning, match="Duplicate name"), ZipFile(stream, "w") as archive:
        for index, (name, value) in enumerate(files.items()):
            archive.writestr("state.json" if index == 0 else name, value)
    assert_rejected(stream.getvalue(), "recovery.invalid_archive_members")


def test_archive_size_and_declared_uncompressed_budgets_are_bounded(monkeypatch):
    data = build_workspace_backup(ALICE, state())
    monkeypatch.setattr(recovery, "MAX_ARCHIVE_BYTES", len(data) - 1)
    assert_rejected(data, "recovery.invalid_archive_size", 413)
    monkeypatch.setattr(recovery, "MAX_ARCHIVE_BYTES", len(data) + 1)
    monkeypatch.setattr(recovery, "MAX_UNCOMPRESSED_BYTES", 1)
    assert_rejected(data, "recovery.archive_budget_exceeded", 413)


def test_writer_includes_manifest_in_the_same_uncompressed_budget_as_reader(monkeypatch):
    original = state()
    data = build_workspace_backup(ALICE, original)
    files = archive_files(data)
    without_manifest = sum(len(value) for name, value in files.items() if name != "manifest.json")
    manifest_size = len(files["manifest.json"])
    monkeypatch.setattr(recovery, "MAX_UNCOMPRESSED_BYTES", without_manifest + manifest_size - 1)
    with pytest.raises(WorkspaceRecoveryError, match="archive_budget_exceeded") as caught:
        build_workspace_backup(ALICE, original)
    assert caught.value.status == 413
    # At the exact total boundary, the writer's archive is accepted by its reader.
    monkeypatch.setattr(recovery, "MAX_UNCOMPRESSED_BYTES", without_manifest + manifest_size)
    inspect_workspace_backup(build_workspace_backup(ALICE, original))


def test_registry_adds_only_trusted_installed_data_modules_and_rejects_collisions():
    registry = BackupModuleRegistry()
    registry.register(BackupModule("research", "researchNotes", "snapshot", lambda value: None))
    saved = state()
    for workspace in saved["workspaces"]:
        workspace["snapshot"]["researchNotes"] = [{"title": "Evidence", "body": "Local note"}]
    archive = build_workspace_backup(ALICE, saved, registry)
    parsed = inspect_workspace_backup(archive, registry)
    assert parsed["state"]["workspaces"] == saved["workspaces"]
    assert parsed["moduleCounts"]["research"] == 2
    assert_rejected(archive)  # Unknown archive modules cannot register their own parser.
    with pytest.raises(WorkspaceRecoveryError):
        registry.register(BackupModule("other", "tables", "snapshot", lambda value: None))
    with pytest.raises(WorkspaceRecoveryError):
        registry.register(BackupModule("../path", "notes", "snapshot", lambda value: None))


def test_real_restore_is_durable_all_origins_scoped_and_preserves_attachments(storage):
    migrate(storage, snapshot())
    migrate(storage, snapshot("browser_origin_0002"))
    service = WorkspaceRecoveryService(storage, ALICE)
    backup = service.create_backup()
    original = inspect_workspace_backup(backup)
    original_tables = [item["snapshot"]["tables"] for item in original["state"]["workspaces"]]
    context = storage.workspace()
    tables = deepcopy(context["tables"])
    tables["journalTrades"][0]["notes"] = "After backup"
    storage.save_tables(context["originId"], tables, context["revision"], "save_" + uuid4().hex)
    revision = storage.current_revision()
    before_preview = storage.snapshot()
    preview = service.preview_restore(backup, revision)
    assert storage.snapshot() == before_preview
    assert preview["originCount"] == 2 and not preview["ownershipChange"]
    # Simulate a browser/server restart: confirmation lives in SQLite, not memory.
    reopened = WorkspaceStorage(storage.engine, ALICE)
    resumed = WorkspaceRecoveryService(reopened, ALICE)
    receipt = resumed.commit_restore(preview["jobId"], revision, preview["confirmationHash"])
    assert receipt["status"] == "completed" and receipt["revision"] > revision
    restored = reopened.snapshot()
    assert [item["snapshot"]["tables"] for item in restored["workspaces"]] == original_tables
    assert reopened.attachment("attachment_image_0001")["content"] == b"fixture-image-content"
    assert all(
        content_without_counters(item["snapshot"]["nativeCatalogs"])
        == content_without_counters(
            original["state"]["workspaces"][index]["snapshot"]["nativeCatalogs"]
        )
        for index, item in enumerate(restored["workspaces"])
    )
    assert (
        resumed.commit_restore(preview["jobId"], revision, preview["confirmationHash"]) == receipt
    )
    previous = reopened.get_recovery_copy(ALICE, receipt["recoveryCopyId"])
    assert previous["workspaces"] == before_preview["workspaces"]
    bob = WorkspaceStorage(storage.engine, BOB)
    with pytest.raises(WorkspaceRecoveryError) as caught:
        WorkspaceRecoveryService(bob, BOB).commit_restore(
            preview["jobId"], revision, preview["confirmationHash"]
        )
    assert caught.value.status == 404


def test_restore_preview_becomes_stale_on_an_inactive_origin_write(storage):
    migrate(storage, snapshot())
    migrate(storage, snapshot("browser_origin_0002"))
    service = WorkspaceRecoveryService(storage, ALICE)
    backup = service.create_backup()
    revision = storage.current_revision()
    preview = service.preview_restore(backup, revision)
    inactive = storage.workspace("browser_origin_0001")
    changed = deepcopy(inactive["tables"])
    changed["portfolios"][0]["name"] = "Changed while preview open"
    storage.save_tables(
        inactive["originId"], changed, inactive["revision"], "change_" + uuid4().hex
    )
    with pytest.raises(WorkspaceRecoveryError, match="revision_conflict"):
        service.commit_restore(preview["jobId"], revision, preview["confirmationHash"])
    assert (
        storage.workspace(inactive["originId"])["tables"]["portfolios"][0]["name"]
        == "Changed while preview open"
    )


def test_wrong_confirmation_and_tampered_staged_payload_cannot_restore(storage):
    migrate(storage, snapshot())
    service = WorkspaceRecoveryService(storage, ALICE)
    preview = service.preview_restore(service.create_backup(), storage.current_revision())
    with pytest.raises(WorkspaceRecoveryError, match="confirmation_mismatch"):
        service.commit_restore(preview["jobId"], preview["expectedRevision"], "wrong")
    job = storage.get_recovery_job(ALICE, preview["jobId"])
    job["payload"]["workspaces"][0]["snapshot"]["tables"]["portfolios"][0]["name"] = "tampered"
    job["payload"]["snapshot"] = deepcopy(job["payload"]["workspaces"][0]["snapshot"])
    storage.save_recovery_job(ALICE, job)
    with pytest.raises(WorkspaceRecoveryError, match="staged_payload_changed"):
        service.commit_restore(
            preview["jobId"], preview["expectedRevision"], preview["confirmationHash"]
        )
    assert storage.workspace()["tables"]["portfolios"][0]["name"] == "My original book"


def test_failed_atomic_restore_rolls_back_rows_modules_recovery_copy_and_receipt(storage):
    migrate(storage, snapshot())
    service = WorkspaceRecoveryService(storage, ALICE)
    saved = state(origins=1)
    saved["workspaces"][0]["snapshot"]["tables"]["portfolios"][0]["name"] = "Replacement"
    archive = build_workspace_backup(ALICE, saved)
    revision = storage.current_revision()
    preview = service.preview_restore(archive, revision)
    before = storage.snapshot()

    def fail_insert(connection, cursor, statement, parameters, context, many):
        if statement.startswith("INSERT INTO workspace_portfolios"):
            raise OSError("simulated disk failure inside transaction")

    event.listen(storage.engine, "before_cursor_execute", fail_insert)
    try:
        with pytest.raises(WorkspaceRecoveryError, match="storage_unavailable"):
            service.commit_restore(preview["jobId"], revision, preview["confirmationHash"])
    finally:
        event.remove(storage.engine, "before_cursor_execute", fail_insert)
    assert storage.snapshot() == before
    assert storage.get_recovery_job(ALICE, preview["jobId"])["status"] == "preview"
    with storage.engine.connect() as connection:
        assert (
            connection.exec_driver_sql("SELECT count(*) FROM workspace_recovery_copies").scalar()
            == 0
        )
    assert (
        service.commit_restore(preview["jobId"], revision, preview["confirmationHash"])["status"]
        == "completed"
    )


def test_cross_principal_restore_requires_explicit_confirmation_and_rebinds_books(storage):
    archive = build_workspace_backup(BOB, state(BOB, origins=1))
    service = WorkspaceRecoveryService(storage, ALICE)
    preview = service.preview_restore(archive, 0)
    assert preview["requiresOwnershipConfirmation"]
    with pytest.raises(WorkspaceRecoveryError, match="owner_confirmation_required"):
        service.commit_restore(preview["jobId"], 0, preview["confirmationHash"])
    receipt = service.commit_restore(
        preview["jobId"], 0, preview["confirmationHash"], confirm_owner=True
    )
    assert receipt["status"] == "completed"
    assert all(book["ownerId"] == ALICE for book in storage.workspace()["books"])
    assert all(BOB not in book["id"] for book in storage.workspace()["books"])
    # A usable Undo can restore even the empty state of a first-install import.
    undo = service.preview_recovery_copy(receipt["recoveryCopyId"], receipt["revision"])
    assert undo["originCount"] == 0
    undone = service.commit_restore(
        undo["jobId"], undo["expectedRevision"], undo["confirmationHash"]
    )
    assert undone["originId"] is None
    assert storage.context()["workspaces"] == []


def test_recovery_copy_undo_returns_previous_book_content_and_active_origin(storage):
    migrate(storage, snapshot())
    service = WorkspaceRecoveryService(storage, ALICE)
    before = storage.snapshot()
    source = state(origins=2)
    preview = service.preview_restore(
        build_workspace_backup(ALICE, source), storage.current_revision()
    )
    receipt = service.commit_restore(
        preview["jobId"], preview["expectedRevision"], preview["confirmationHash"]
    )
    undo = service.preview_recovery_copy(receipt["recoveryCopyId"], storage.current_revision())
    service.commit_restore(undo["jobId"], undo["expectedRevision"], undo["confirmationHash"])
    after = storage.snapshot()
    assert after["activeOriginId"] == before["activeOriginId"]
    assert content_without_counters(
        [item["snapshot"] for item in after["workspaces"]]
    ) == content_without_counters([item["snapshot"] for item in before["workspaces"]])


def test_unavailable_attachment_and_saved_selection_survive_storage_backup_and_restore(storage):
    migrate(storage, snapshot(missing_attachment=True))
    service = WorkspaceRecoveryService(storage, ALICE)
    before = storage.snapshot()
    archive = service.create_backup()
    preview = service.preview_restore(archive, storage.current_revision())
    assert len(preview["unavailableAttachments"]) == 1
    service.commit_restore(
        preview["jobId"], preview["expectedRevision"], preview["confirmationHash"]
    )
    after = storage.snapshot()
    assert after["snapshot"]["attachments"] == before["snapshot"]["attachments"]
    assert after["snapshot"]["preferences"] == before["snapshot"]["preferences"]
    assert after["snapshot"]["datasetManifests"] == before["snapshot"]["datasetManifests"]


def test_restore_invalidates_table_and_native_revisions_held_by_open_clients(storage):
    migrate(storage, snapshot())
    service = WorkspaceRecoveryService(storage, ALICE)
    old = storage.workspace()
    native = storage.native("workspace", "source-user")
    preview = service.preview_restore(service.create_backup(), storage.current_revision())
    service.commit_restore(
        preview["jobId"], preview["expectedRevision"], preview["confirmationHash"]
    )
    current = storage.workspace()
    assert current["revision"] > old["revision"]
    assert current["stateRevision"] > old["stateRevision"]
    with pytest.raises(WorkspaceError, match="revision_conflict"):
        storage.save_tables(old["originId"], old["tables"], old["revision"], "stale_" + uuid4().hex)
    catalog = deepcopy(native["catalog"])
    catalog["revision"] += 1
    with pytest.raises(WorkspaceError, match="revision_conflict"):
        storage.save_native(
            "workspace", "source-user", catalog, native["revision"], "native_stale_" + uuid4().hex
        )


def test_central_directory_budget_checked_before_zipfile_allocation():
    data = bytearray(build_workspace_backup(ALICE, state()))
    tail = list(struct.unpack("<4s4H2LH", data[-22:]))
    tail[5] = 3 * 1024 * 1024
    data[-22:] = struct.pack("<4s4H2LH", *tail)
    assert_rejected(bytes(data), "recovery.invalid_archive")


def test_recovery_status_survives_restart_reports_receipts_and_never_returns_source_content(
    storage,
):
    migrate(storage, snapshot(missing_attachment=True))
    service = WorkspaceRecoveryService(storage, ALICE)
    archive = service.create_backup()
    completed = service.preview_restore(archive, storage.current_revision())
    receipt = service.commit_restore(
        completed["jobId"], completed["expectedRevision"], completed["confirmationHash"]
    )
    pending = service.preview_restore(archive, storage.current_revision())
    migration = storage.preview_migration(snapshot("pending_browser_origin"))
    reopened = WorkspaceStorage(str(storage.engine.url), ALICE)
    try:
        status = reopened.recovery_status()
        assert [item["jobId"] for item in status["restores"]] == [
            pending["jobId"],
            completed["jobId"],
        ]
        assert status["restores"][0]["status"] == "preview"
        assert status["restores"][0]["unavailableAttachments"] == []
        assert status["restores"][0]["unavailableAttachmentCount"] == 1
        assert status["restores"][0]["unverifiedDependencies"] == []
        assert status["restores"][0]["unverifiedDependencyCount"] == 2
        assert status["restores"][0]["previewDetailsTruncated"] is True
        assert status["restores"][1]["status"] == "completed"
        assert status["restores"][1]["receipt"] == receipt
        assert status["migrations"][0]["id"] == migration["id"]
        assert status["migrations"][0]["issues"] == []
        assert status["migrations"][0]["issuesCount"] == len(migration["issues"])
        assert status["migrations"][0]["issuesTruncated"] is True
        assert status["migrations"][1]["status"] == "completed"
        assert status["migrations"][1]["receipt"]["status"] == "completed"
        encoded = json.dumps(status)
        assert "fixture-image-content" not in encoded
        assert base64.b64encode(b"fixture-image-content").decode() not in encoded
        assert "A deliberate raw legacy value" not in encoded
        assert 'indicator(\\"Fixture\\")' not in encoded
        pending_values = [status]
        while pending_values:
            value = pending_values.pop()
            if isinstance(value, dict):
                assert not set(value) & {
                    "snapshot",
                    "payload",
                    "base64",
                    "tables",
                    "nativeCatalogs",
                }
                pending_values.extend(value.values())
            elif isinstance(value, list):
                pending_values.extend(value)
        assert WorkspaceStorage(storage.engine, BOB).recovery_status() == {
            "restores": [],
            "migrations": [],
        }
        assert run_workspace_action(str(storage.engine.url), ALICE, "recovery_status") == status
        resumed = run_workspace_action(
            str(storage.engine.url), ALICE, "restore_get", {"id": pending["jobId"]}
        )
        assert resumed == pending
        restored = run_workspace_action(
            str(storage.engine.url), ALICE, "restore_get", {"id": completed["jobId"]}
        )
        assert restored["receipt"] == receipt and restored["status"] == "completed"
        with pytest.raises(WorkspaceError, match="job.not_found"):
            run_workspace_action(
                str(storage.engine.url), BOB, "restore_get", {"id": pending["jobId"]}
            )
    finally:
        reopened.engine.dispose()


def test_recovery_status_limits_each_job_kind_to_20_newest_scoped_rows(storage):
    migrate(storage, snapshot())
    service = WorkspaceRecoveryService(storage, ALICE)
    archive = service.create_backup()
    revision = storage.current_revision()
    restores = []
    migrations = []
    for index in range(25):
        restores.append(service.preview_restore(archive, revision)["jobId"])
        migrations.append(
            storage.preview_migration(snapshot(f"pending_browser_origin_{index:02d}"))["id"]
        )
    status = storage.recovery_status()
    assert [job["jobId"] for job in status["restores"]] == list(reversed(restores[-20:]))
    assert [job["id"] for job in status["migrations"]] == list(reversed(migrations[-20:]))


def test_recovery_status_projects_summary_in_sql_before_python_json_parse(storage, monkeypatch):
    migrate(storage, snapshot())
    marker = "RAW_SOURCE_SENTINEL_" * 10_000
    storage.save_recovery_job(
        ALICE,
        {
            "id": "large_restore_job",
            "kind": "restore",
            "status": "preview",
            "payload": {"source": marker},
            "preview": {
                "jobId": "large_restore_job",
                "expectedRevision": 1,
                "unavailableAttachments": [{"originalSource": marker} for _ in range(5)],
                "unverifiedDependencies": [{"evidence": marker} for _ in range(3)],
            },
        },
    )
    with storage.transaction() as connection:
        connection.execute(
            insert(jobs).values(
                uid=ALICE,
                id="large_migration_job",
                kind="migration",
                payload=json.dumps(
                    {
                        "id": "large_migration_job",
                        "status": "preview",
                        "snapshot": {"source": marker},
                        "issues": [{"message": marker} for _ in range(4)],
                    }
                ),
            )
        )
    real_loads = json.loads

    def public_only(raw, *args, **kwargs):
        assert "RAW_SOURCE_SENTINEL" not in raw, (
            "Staged source/details reached Python instead of SQL metadata projection"
        )
        return real_loads(raw, *args, **kwargs)

    monkeypatch.setattr(
        workspace_storage, "json", SimpleNamespace(loads=public_only, dumps=json.dumps)
    )
    status = storage.recovery_status()
    assert status["restores"][0]["unavailableAttachmentCount"] == 5
    assert status["restores"][0]["unverifiedDependencyCount"] == 3
    assert status["migrations"][0]["issuesCount"] == 4
    assert len(json.dumps(status)) < 10_000


def test_recovery_status_rejects_oversized_public_metadata_with_structured_413(
    storage, monkeypatch
):
    migrate(storage, snapshot())
    service = WorkspaceRecoveryService(storage, ALICE)
    service.preview_restore(service.create_backup(), storage.current_revision())
    generation = storage.current_revision()
    monkeypatch.setattr(workspace_storage, "MAX_RECOVERY_STATUS_BYTES", 128)
    with pytest.raises(WorkspaceError, match="recovery.status_too_large") as caught:
        storage.recovery_status()
    assert caught.value.status == 413
    assert storage.current_revision() == generation
