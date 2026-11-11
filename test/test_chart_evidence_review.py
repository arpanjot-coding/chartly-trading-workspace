"""Independent adversarial image, restored-source and date-window review."""

import base64
import hashlib
from copy import deepcopy
from io import BytesIO
from uuid import uuid4

import pytest
from PIL import Image
from test_chart_evidence import attach, capture, png, trade
from test_data_library import commit, preview
from test_data_library_restore_links import restore_bundle, restored_snapshot

from services.chart_context import run_window
from services.chart_evidence import ChartEvidenceService
from services.data_library import DataLibrary
from services.workspace_recovery import WorkspaceRecoveryError, build_workspace_backup
from services.workspace_storage import WorkspaceError, WorkspaceStorage

pytest_plugins = ["test_journal_service"]


def animated_png():
    stream = BytesIO()
    with (
        Image.new("RGB", (16, 16), "white") as first,
        Image.new("RGB", (16, 16), "black") as second,
    ):
        first.save(
            stream, format="PNG", save_all=True, append_images=[second], duration=100, loop=0
        )
    content = stream.getvalue()
    with Image.open(BytesIO(content)) as image:
        assert image.n_frames == 2
    return base64.b64encode(content).decode()


def test_chart_capture_requires_one_static_png_frame(storage):
    row = trade(storage)
    before = storage.workspace()
    with pytest.raises(WorkspaceError, match="invalid_image"):
        attach(storage, row, content=animated_png())
    assert storage.workspace() == before


def test_recovered_chart_evidence_still_requires_valid_static_png_after_matching_hashes(storage):
    attach(storage, trade(storage))
    source = storage.snapshot()
    for payload in (b"declared PNG is not an image", base64.b64decode(animated_png())):
        changed = deepcopy(source)
        snapshot = changed["workspaces"][0]["snapshot"]
        item = snapshot["tables"]["journalTrades"][0]["chartEvidence"][0]
        attachment = snapshot["attachments"][item["attachmentId"]]
        attachment.update(base64=base64.b64encode(payload).decode(), mimeType="image/png")
        attachment.pop("sha256", None)
        attachment.pop("bytes", None)
        item["imageSha256"] = hashlib.sha256(payload).hexdigest()
        with pytest.raises(WorkspaceRecoveryError):
            build_workspace_backup(storage.uid, changed)


@pytest.mark.parametrize("value", ["2026-W45-1", "2026W451", "2026-11-2"])
def test_run_window_requires_the_documented_calendar_date_format(value):
    with pytest.raises(WorkspaceError, match="invalid_run_window"):
        run_window({"rangeStart": value, "rangeEnd": "2026-11-03"})


def test_restored_run_old_version_alias_accepts_capture_without_rewriting_its_binding(storage):
    original_library = DataLibrary(storage)
    original = commit(original_library, preview(original_library))["version"]
    target_store = WorkspaceStorage(storage.engine, "principal_chart_review_restored")
    target = DataLibrary(target_store)
    before_tables = restored_snapshot(target, original)
    restored = restore_bundle(target, original_library, original)
    origin = target_store.workspace()["originId"]
    run = before_tables["practiceSessions"][0]
    result = ChartEvidenceService(target_store).attach(
        origin,
        target_store.workspace()["revision"],
        uuid4().hex,
        {"kind": "run", "id": run["id"], "profileId": run["portfolioId"]},
        "image/png",
        png(),
        capture(original),
        "Preserved source proof",
    )
    saved = result["workspace"]["tables"]["practiceSessions"][0]
    assert saved["datasetVersionId"] == original["id"]
    assert saved["datasetChecksum"] == original["checksum"]
    assert saved["chartEvidence"][0]["source"]["datasetVersionId"] == restored["id"]
    assert result["workspace"]["tables"]["journalTrades"] == before_tables["journalTrades"]
