"""Every scoped session under database/ is released by the teardown sweep.

Under the gthread worker request threads are pooled and never exit, so a
scoped session the per-request sweep does not know about stays open on its
thread from one request to the next: a connection held, and an identity map
that can be a day's master contract re-download out of date. Under eventlet
each request's greenlet took its sessions with it. The sweep
(utils.db_sessions.remove_all_scoped_sessions) covers a fixed list plus every
loaded broker master-contract module; this tripwire keeps the list complete.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock

from utils import db_sessions

REPO = Path(__file__).resolve().parents[1]


def _scoped_sessions_in(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = []
    for node in tree.body:
        if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Call):
            continue
        func = node.value.func
        called = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
        if called != "scoped_session":
            continue
        for target in node.targets:
            if isinstance(target, ast.Name):
                names.append(target.id)
    return names


def test_every_database_scoped_session_is_swept():
    listed = set(db_sessions.SCOPED_SESSION_MODULES)
    missing = []
    for path in sorted((REPO / "database").glob("*.py")):
        module = f"database.{path.stem}"
        for attr in _scoped_sessions_in(path):
            if (module, attr) not in listed:
                missing.append(f"{module}.{attr}")
    assert missing == [], (
        "Add these to utils/db_sessions.SCOPED_SESSION_MODULES so pooled "
        f"request threads release them: {missing}"
    )


def test_broker_master_contract_sessions_are_found_by_name(monkeypatch):
    # Plugin-free source checkouts must still prove the runtime discovery rule.
    master = ModuleType("broker.fixture.database.master_contract_db")
    master.db_session = Mock()
    other = ModuleType("broker.fixture.database.other")
    other.db_session = Mock()
    for module in (master, other):
        monkeypatch.setitem(sys.modules, module.__name__, module)
    monkeypatch.setattr(db_sessions, "_broker_scan", (None, ()))

    db_sessions.remove_all_scoped_sessions()

    master.db_session.remove.assert_called_once_with()
    other.db_session.remove.assert_not_called()

    # Validate the attribute convention for any installed plugins as well.
    for path in (REPO / "broker").glob("*/database/master_contract_db.py"):
        assert "db_session" in _scoped_sessions_in(path), path
