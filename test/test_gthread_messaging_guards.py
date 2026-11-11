"""Messaging code asks whether eventlet patched the process, never whether it was imported.

Under the gthread worker eventlet stays installed as the fallback, and several
modules used to import it merely to ask about it. Every ``"eventlet" in
sys.modules`` test then took its eventlet branch in a process nothing had
patched, and which path long-running background workers took depended on what
the process happened to import first. ``utils.runtime.is_monkey_patched``
answers the real question without importing eventlet; these tests keep the
messaging and background-worker files on it.
"""

from __future__ import annotations

import ast
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]

MESSAGING_GLOBS = (
    "blueprints/mcp_http.py",
    "blueprints/mcp_oauth.py",
    "mcp/**/*.py",
    "services/agent/**/*.py",
    "blueprints/agent.py",
    "utils/email_utils.py",
    "services/*alert*.py",
    "blueprints/*alert*.py",
)


def _messaging_files() -> list[Path]:
    files: set[Path] = set()
    for pattern in MESSAGING_GLOBS:
        files.update(p for p in REPO.glob(pattern) if p.is_file())
    return sorted(files)


def _is_eventlet_import_test(node: ast.AST) -> bool:
    """``"eventlet..." in sys.modules`` (or ``not in``), in code, not in a string."""
    if not isinstance(node, ast.Compare) or len(node.ops) != 1:
        return False
    if not isinstance(node.ops[0], (ast.In, ast.NotIn)):
        return False
    left, right = node.left, node.comparators[0]
    return (
        isinstance(left, ast.Constant)
        and isinstance(left.value, str)
        and left.value.startswith("eventlet")
        and isinstance(right, ast.Attribute)
        and right.attr == "modules"
        and isinstance(right.value, ast.Name)
        and right.value.id == "sys"
    )


def _imports_eventlet(node: ast.AST) -> bool:
    if isinstance(node, ast.Import):
        return any(alias.name.split(".")[0] == "eventlet" for alias in node.names)
    if isinstance(node, ast.ImportFrom):
        return (node.module or "").split(".")[0] == "eventlet"
    return False


def test_the_scan_covers_the_partition():
    names = {p.relative_to(REPO).as_posix() for p in _messaging_files()}
    for expected in (
        "services/agent/chatgpt_oauth.py",
        "blueprints/mcp_http.py",
        "blueprints/agent.py",
        "utils/email_utils.py",
    ):
        assert expected in names


def test_no_messaging_file_tests_whether_eventlet_was_imported():
    offenders = []
    for path in _messaging_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if _is_eventlet_import_test(node) or _imports_eventlet(node):
                offenders.append(f"{path.relative_to(REPO).as_posix()}:{node.lineno}")
    assert offenders == [], (
        "use utils.runtime.is_monkey_patched() (or utils.real_threading) instead: "
        + ", ".join(offenders)
    )


def _eventlet_installed() -> bool:
    try:
        import importlib.util

        return importlib.util.find_spec("eventlet") is not None
    except (ImportError, ValueError):
        return False


@pytest.mark.skipif(not _eventlet_installed(), reason="eventlet is not installed (Windows dev)")
def test_an_unpatched_eventlet_import_keeps_stdlib_threading(tmp_path):
    """The gthread case: eventlet imported, nothing patched.

    ``utils.runtime`` must report the process unpatched, and
    ``utils.real_threading`` must hand back the stdlib's own primitives, so
    ``threading.enumerate()`` and thread dumps still see background workers.
    """
    body = textwrap.dedent(
        """
        import sys, threading
        import eventlet  # imported, never patched

        from utils import real_threading, runtime
        assert runtime.is_monkey_patched() is False
        assert real_threading.Thread is threading.Thread
        assert isinstance(real_threading.Event(), threading.Event)
        print("OK")
        """
    )
    env = dict(os.environ)
    db = tmp_path / "db"
    db.mkdir()
    env.update(
        {
            "DATABASE_URL": f"sqlite:///{(db / 'chartly.db').as_posix()}",
            "LOG_DIR": str(tmp_path / "log"),
            "API_KEY_PEPPER": "0" * 64,
            "APP_KEY": "test-only-app-key",
            "PYTHONPATH": str(REPO),
        }
    )
    result = subprocess.run(
        [sys.executable, "-c", body],
        cwd=str(REPO),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert "OK" in result.stdout, result.stdout + result.stderr
