"""Bounded process isolation for archive and bulk workspace CPU work.

No supplied code is executed. Child processes use the same scoped service and
durable receipts. A disconnected request may safely retry the same operation.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

_SLOTS = threading.BoundedSemaphore(2)
_ACTIONS = frozenset(
    {
        "migration_preview",
        "migration_commit",
        "migration_get",
        "workspace",
        "backup",
        "restore_preview",
        "restore_commit",
        "undo_preview",
        "save_tables",
        "native",
        "save_native",
        "save_preferences",
        "journal_state",
        "journal_detail",
        "journal_action",
        "journal_import_preview",
        "journal_import_commit",
        "journal_import_get",
        "journal_import_repreview",
        "journal_attachment",
        "journal_chart_evidence",
        "journal_export",
        "dataset_catalog",
        "dataset_kraken_instruments",
        "dataset_kraken_preview",
        "dataset_feed_preview",
        "dataset_detail",
        "dataset_bars",
        "dataset_preview",
        "dataset_import_get",
        "dataset_repreview",
        "dataset_commit",
        "dataset_archive",
        "dataset_export",
        "dataset_bundle_preview",
        "dataset_bundle_get",
        "dataset_bundle_repreview",
        "dataset_bundle_commit",
        "dataset_download_create",
        "dataset_download_step",
        "dataset_download_control",
        "dataset_download_get",
        "recovery_status",
        "restore_get",
        "paper_session",
        "paper_action",
        "paper_report",
        "paper_ledger",
        "paper_compare",
        "connector_list",
        "connector_detail",
        "connector_history",
        "connector_action",
    }
)


def _perform(database_url, uid, action, arguments, payload):
    from services.workspace_recovery import WorkspaceRecoveryService
    from services.workspace_storage import WorkspaceStorage

    storage = WorkspaceStorage(database_url, uid)
    try:
        if action.startswith("connector_"):
            from services.connectors import Connectors

            service = Connectors(storage)
            if action == "connector_action" and arguments.get("action") == "set-secret":
                raise ValueError("Credentials cannot cross the temporary worker request boundary")
            return {
                "connector_list": service.list,
                "connector_detail": service.detail,
                "connector_history": service.history,
                "connector_action": service.action,
            }[action](**arguments)
        if action.startswith("paper_"):
            from services.paper_sessions import PaperSessions

            paper = PaperSessions(storage)
            return {
                "paper_session": paper.session,
                "paper_action": paper.action,
                "paper_report": paper.report,
                "paper_ledger": paper.ledger,
                "paper_compare": paper.compare,
            }[action](**arguments)
        if action.startswith("dataset_"):
            from services.data_library import DataLibrary

            library = DataLibrary(storage)
            if action in {"dataset_kraken_instruments", "dataset_kraken_preview"}:
                from services import kraken_market

                return (
                    kraken_market.instruments(**arguments)
                    if action == "dataset_kraken_instruments"
                    else kraken_market.preview(library, **arguments)
                )
            if action == "dataset_feed_preview":
                from services import feed_market

                return feed_market.preview(library, **arguments)
            if action.startswith("dataset_download_"):
                from services.dataset_downloads import DatasetDownloads
                from services.dataset_provider import fetch_owner_history

                downloads = DatasetDownloads(library, fetcher=fetch_owner_history)
                methods = {
                    "dataset_download_create": downloads.create,
                    "dataset_download_step": downloads.step,
                    "dataset_download_control": downloads.control,
                    "dataset_download_get": downloads.detail,
                }
                value = methods[action](**arguments)
                return {**value, "catalog": library.catalog()} if isinstance(value, dict) else value
            methods = {
                "dataset_catalog": library.catalog,
                "dataset_detail": library.detail,
                "dataset_bars": library.bars,
                "dataset_preview": library.preview_import,
                "dataset_import_get": library.import_job,
                "dataset_repreview": library.repreview_import,
                "dataset_commit": library.commit_import,
                "dataset_archive": library.archive,
                "dataset_export": library.export,
                "dataset_bundle_preview": library.preview_bundle,
                "dataset_bundle_get": library.bundle_job,
                "dataset_bundle_repreview": library.repreview_bundle,
                "dataset_bundle_commit": library.commit_bundle,
            }
            return methods[action](**arguments)
        if action.startswith("journal_"):
            if action == "journal_chart_evidence":
                from services.chart_evidence import ChartEvidenceService

                return ChartEvidenceService(storage).attach(**arguments)
            from services.journal_service import JournalService

            journal = JournalService(storage)
            methods = {
                "journal_state": journal.state,
                "journal_detail": journal.detail,
                "journal_action": journal.action,
                "journal_import_preview": journal.preview_import,
                "journal_import_commit": journal.commit_import,
                "journal_import_get": journal.import_job,
                "journal_import_repreview": journal.repreview_import,
                "journal_attachment": journal.attachment,
                "journal_export": journal.export,
            }
            return methods[action](**arguments)
        if action == "migration_preview":
            return storage.preview_migration(**arguments)
        if action == "migration_commit":
            return storage.commit_migration(**arguments)
        if action == "save_tables":
            return storage.save_tables(**arguments)
        if action == "workspace":
            return storage.workspace(**arguments)
        if action == "migration_get":
            return {
                key: value
                for key, value in storage.get_job(arguments["id"], "migration").items()
                if key != "snapshot"
            }
        if action == "native":
            return storage.native(**arguments)
        if action == "save_native":
            return storage.save_native(**arguments)
        if action == "save_preferences":
            return storage.save_preferences(**arguments)
        if action == "recovery_status":
            return storage.recovery_status(**arguments)
        if action == "restore_get":
            job = storage.get_recovery_job(uid, arguments["id"])
            result = {**job["preview"], "status": job["status"]}
            if "receipt" in job:
                result["receipt"] = job["receipt"]
            return result
        recovery = WorkspaceRecoveryService(storage, uid)
        if action == "backup":
            return recovery.create_backup()
        if action == "restore_preview":
            return recovery.preview_restore(payload, **arguments)
        if action == "restore_commit":
            return recovery.commit_restore(**arguments)
        if action == "undo_preview":
            return recovery.preview_recovery_copy(**arguments)
        raise ValueError("Unsupported workspace action")
    finally:
        storage.engine.dispose()


def run_workspace_action(database_url, principal_uid, action, arguments=None, payload=None):
    from services.workspace_storage import WorkspaceError

    if action not in _ACTIONS:
        raise WorkspaceError("worker.unsupported_action")
    if not _SLOTS.acquire(blocking=False):
        raise WorkspaceError("worker.busy_retry", 503)
    try:
        with tempfile.TemporaryDirectory(prefix="chartly-workspace-") as directory:
            folder = Path(directory)
            (folder / "request.json").write_text(
                json.dumps(
                    {
                        "database_url": database_url,
                        "uid": principal_uid,
                        "action": action,
                        "arguments": arguments or {},
                    }
                ),
                encoding="utf-8",
            )
            if payload is not None:
                (folder / "payload.bin").write_bytes(payload)
            options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
            child = subprocess.Popen(
                [sys.executable, "-m", "services.workspace_worker", str(folder)],
                cwd=Path(__file__).resolve().parents[1],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                **options,
            )
            try:
                deadline = time.monotonic() + 300
                while child.poll() is None:
                    if time.monotonic() >= deadline:
                        raise WorkspaceError("worker.timeout_retry", 503)
                    # eventlet patches sleep; no DB or Flask context crosses a thread.
                    time.sleep(0.02)
                if child.returncode != 0 or not (folder / "result.json").is_file():
                    raise WorkspaceError("worker.interrupted_retry", 503)
                result = json.loads((folder / "result.json").read_text(encoding="utf-8"))
                if "error" in result:
                    error = result["error"]
                    raise WorkspaceError(error["code"], error["status"], error.get("issues"))
                return (
                    (folder / "result.bin").read_bytes()
                    if result.get("binary")
                    else result["value"]
                )
            finally:
                if child.poll() is None:
                    child.kill()
                child.wait()
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        raise WorkspaceError("worker.transport_failure_retry", 503) from error
    finally:
        _SLOTS.release()


def _main(folder):
    from services.workspace_recovery import WorkspaceRecoveryError
    from services.workspace_storage import WorkspaceError

    folder = Path(folder)
    request = json.loads((folder / "request.json").read_text(encoding="utf-8"))
    try:
        if request["action"] not in _ACTIONS:
            raise WorkspaceError("worker.unsupported_action")
        value = _perform(
            request["database_url"],
            request["uid"],
            request["action"],
            request["arguments"],
            (folder / "payload.bin").read_bytes() if (folder / "payload.bin").exists() else None,
        )
        if isinstance(value, bytes):
            (folder / "result.bin").write_bytes(value)
            result = {"binary": True}
        else:
            result = {"value": value}
    except (WorkspaceError, WorkspaceRecoveryError) as error:
        result = {
            "error": {
                "code": error.code,
                "status": error.status,
                "issues": getattr(error, "issues", []),
            }
        }
    except Exception:
        result = {"error": {"code": "worker.storage_failure_retry", "status": 503}}
    temporary = folder / "result.pending"
    temporary.write_text(json.dumps(result), encoding="utf-8")
    os.replace(temporary, folder / "result.json")


if __name__ == "__main__":
    _main(sys.argv[1])
