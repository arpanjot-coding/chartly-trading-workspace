"""Canonical capital remains scoped to each independent paper book."""

from copy import deepcopy
from uuid import uuid4

import pytest
from test_paper_sessions import ORIGIN, act, config

from services.paper_records import validate_records
from services.workspace_recovery import WorkspaceRecoveryService
from services.workspace_storage import WorkspaceError, WorkspaceStorage, validate_snapshot

pytest_plugins = ["test_journal_service", "test_paper_sessions"]


def test_exact_cash_override_is_protected_published_branched_and_restored(paper):
    act(paper, "prepare", config(startingCash="1234.56"))
    current = paper.storage.workspace()
    run = current["tables"]["practiceSessions"][0]
    assert run["startingBalance"] == 1000
    assert run["paper"]["startingCash"] == "1234.56"
    changed = deepcopy(current["tables"])
    changed["practiceSessions"][0]["paper"]["startingCash"] = "9999"
    with pytest.raises(WorkspaceError, match="server_owned"):
        paper.storage.save_tables(ORIGIN, changed, current["revision"], uuid4().hex)
    act(paper, "start")
    act(paper, "advance", {"count": 3})
    child = act(paper, "branch", {"atIndex": 1, "name": "Independent capital"})["session"]
    runs = paper.storage.workspace()["tables"]["practiceSessions"]
    assert {run["paper"]["startingCash"] for run in runs} == {"1234.56"}
    assert child["config"]["startingCash"] == "1234.56"
    source = paper.storage.snapshot()
    invalid = deepcopy(source["snapshot"])
    invalid["tables"]["practiceSessions"][0]["paper"]["startingCash"] = "1000"
    with pytest.raises(WorkspaceError, match="marker_starting_cash_mismatch"):
        validate_records(source["paperSessions"], invalid)
    archive = WorkspaceRecoveryService(paper.storage, paper.storage.uid).create_backup()
    target = WorkspaceStorage(paper.storage.engine, "principal_paper_cash_restored")
    recovery = WorkspaceRecoveryService(target, target.uid)
    preview = recovery.preview_restore(archive, 0)
    recovery.commit_restore(preview["jobId"], 0, preview["confirmationHash"], confirm_owner=True)
    recovered = target.snapshot()
    assert {
        run["paper"]["startingCash"] for run in recovered["snapshot"]["tables"]["practiceSessions"]
    } == {"1234.56"}
    assert {record["config"]["startingCash"] for record in recovered["paperSessions"]} == {
        "1234.56"
    }
    assert paper.storage.snapshot() == source


@pytest.mark.parametrize("invalid", [0, "0", "-1", "1e3", "not-cash"])
def test_paper_cash_marker_rejects_nonpositive_or_nondecimal_values(paper, invalid):
    act(paper, "prepare", config())
    snapshot = paper.storage.snapshot()["snapshot"]
    snapshot["tables"]["practiceSessions"][0]["paper"]["startingCash"] = invalid
    with pytest.raises(WorkspaceError, match="invalid_marker"):
        validate_snapshot(snapshot)
