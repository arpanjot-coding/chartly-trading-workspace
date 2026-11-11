"""One write path for custom chart indicator files.

Custom indicators are plain-JS modules in ``strategies/indicators/``,
served read-only by ``blueprints/custom_indicators.py`` and loaded by
the /trading chart. Three writers exist — the Settings manager (local
API), the in-app agent, and external LLMs over MCP — so they share
this store: one name rule, one size limit, atomic replace with a
backup, exactly like ``services/openscript_store.py``.

Trust boundary: an installed indicator runs unsandboxed on the app
origin (that is the documented model — see strategies/indicators/
README.md). This store therefore only enforces *shape* (name, size,
that the file at least claims the indicator contract). Real
validation (descriptor checks, calc on sample bars) happens in the
browser validator and the chart-indicator skill's validate.mjs
before anything should be saved here.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path

MAX_SOURCE_BYTES = 256 * 1024
MAX_LISTED = 200
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\.js$")
EXTENSION = ".js"
VERSION_PATTERN = re.compile(r"[0-9a-f]{64}")

_LOCK = threading.Lock()


class IndicatorInvalid(ValueError):
    """The name or source does not meet the indicator contract shape."""


class IndicatorConflict(Exception):
    """A save was refused because the name is already taken."""


class IndicatorMissing(FileNotFoundError):
    """No indicator is stored under that name."""


@dataclass(frozen=True)
class SavedIndicator:
    file: str
    bytes: int
    replaced: bool


def indicator_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "strategies" / "indicators"


def normalised_name(filename) -> str:
    if not isinstance(filename, str) or not filename.strip():
        raise IndicatorInvalid("An indicator file name is required.")
    name = filename.strip()
    if not name.lower().endswith(EXTENSION):
        name += EXTENSION
    if not SAFE_NAME.match(name) or name.startswith("_"):
        raise IndicatorInvalid(
            "Use letters, digits, dot, dash or underscore, starting with a letter "
            "or digit, at most 64 characters before .js (for example my_sma.js)."
        )
    return name


def validate_source(source) -> str:
    if not isinstance(source, str) or not source.strip():
        raise IndicatorInvalid("The indicator source is empty.")
    if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise IndicatorInvalid("The indicator source exceeds 256 kB.")
    if "export default" not in source or "registerIndicator" not in source:
        raise IndicatorInvalid(
            "The file must default-export the indicator factory and call "
            "registerIndicator (see the templates)."
        )
    return source


def _snapshot(path: Path) -> tuple[bytes, int]:
    if not path.is_file():
        raise IndicatorMissing(path.name)
    try:
        with path.open("rb") as stream:
            payload = stream.read(MAX_SOURCE_BYTES + 1)
            modified = int(os.fstat(stream.fileno()).st_mtime)
    except FileNotFoundError as exc:
        raise IndicatorMissing(path.name) from exc
    if len(payload) > MAX_SOURCE_BYTES:
        raise OSError("The indicator file exceeds the source size limit.")
    return payload, modified


def _atomic_write(target: Path, payload: bytes) -> None:
    staged = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, suffix=".tmp", delete=False) as stream:
            staged = Path(stream.name)
            stream.write(payload)
        staged.replace(target)
    finally:
        if staged is not None:
            staged.unlink(missing_ok=True)


def _version_path(directory: Path, name: str, version: str) -> Path:
    return directory / ".versions" / name / (version + EXTENSION)


def _archive(directory: Path, name: str, payload: bytes) -> str:
    version = hashlib.sha256(payload).hexdigest()
    target = _version_path(directory, name, version)
    if not target.is_file():
        target.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write(target, payload)
    elif _snapshot(target)[0] != payload:
        raise OSError("The saved indicator version failed its content check.")
    return version


def module_index(directory: Path | None = None) -> list[dict]:
    """Pin the exact bytes of existing files before their URLs reach the browser."""
    directory = directory or indicator_dir()
    if not directory.is_dir():
        return []
    modules = []
    for path in sorted(directory.iterdir()):
        if not SAFE_NAME.fullmatch(path.name):
            continue
        try:
            payload, mtime = _snapshot(path)
            version = _archive(directory, path.name, payload)
        except OSError:
            # The chart can still use the other modules if one was removed or
            # its version cannot be persisted while the folder was being read.
            continue
        modules.append({"file": path.name, "mtime": mtime, "version": version})
    return modules


def read_module(filename: str, version: str | None, directory: Path | None = None) -> bytes:
    if not SAFE_NAME.fullmatch(filename):
        raise IndicatorInvalid("Invalid indicator filename")
    directory = directory or indicator_dir()
    if version is None:
        return _snapshot(directory / filename)[0]
    if not VERSION_PATTERN.fullmatch(version):
        raise IndicatorInvalid("Invalid indicator version")
    payload, _ = _snapshot(_version_path(directory, filename, version))
    if hashlib.sha256(payload).hexdigest() != version:
        raise OSError("The saved indicator version failed its content check.")
    return payload


def list_indicators(directory: Path | None = None) -> list[dict]:
    directory = directory or indicator_dir()
    if not directory.is_dir():
        return []
    entries = []
    for path in sorted(directory.iterdir()):
        name = path.name
        if (
            not path.is_file()
            or not name.endswith(EXTENSION)
            or name.startswith(("_", "."))
            or not SAFE_NAME.match(name)
        ):
            continue
        stat = path.stat()
        entries.append({"file": name, "bytes": stat.st_size, "mtime": int(stat.st_mtime)})
        if len(entries) >= MAX_LISTED:
            break
    return entries


# Draft previews for in-browser validation. The app CSP is
# script-src 'self', so the Settings validator cannot import() a data:
# or blob: URL; it stages the draft here and imports the same-origin
# preview URL instead, exactly like the chart loader imports saved
# files. In memory only, short-lived, never written into the folder.
PREVIEW_TTL_SECONDS = 120
MAX_PREVIEWS = 32
_PREVIEWS: dict[str, tuple[str, float]] = {}


def stage_preview(source) -> str:
    text = validate_source(source)
    token = secrets.token_hex(16)
    now = time.time()
    with _LOCK:
        for stale in [key for key, (_, expiry) in _PREVIEWS.items() if expiry <= now]:
            del _PREVIEWS[stale]
        while len(_PREVIEWS) >= MAX_PREVIEWS:
            _PREVIEWS.pop(next(iter(_PREVIEWS)))
        _PREVIEWS[token] = (text, now + PREVIEW_TTL_SECONDS)
    return token


def read_preview(token) -> str:
    if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{32}", token):
        raise IndicatorMissing("preview")
    with _LOCK:
        entry = _PREVIEWS.get(token)
        if entry is None or entry[1] <= time.time():
            _PREVIEWS.pop(token, None)
            raise IndicatorMissing("preview")
        return entry[0]


def read_indicator(filename, directory: Path | None = None) -> dict:
    name = normalised_name(filename)
    directory = directory or indicator_dir()
    path = directory / name
    payload, mtime = _snapshot(path)
    return {
        "file": name,
        "source": payload.decode("utf-8"),
        "bytes": len(payload),
        "mtime": mtime,
    }


def write_indicator(
    filename, source, replace=False, directory: Path | None = None
) -> SavedIndicator:
    name = normalised_name(filename)
    text = validate_source(source)
    payload = text.encode("utf-8")
    directory = directory or indicator_dir()
    with _LOCK:
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / name
        replaced = target.exists()
        if replaced and not replace:
            raise IndicatorConflict(name)
        if replaced:
            previous, _ = _snapshot(target)
            _archive(directory, name, previous)
            _atomic_write(directory / (name + ".bak"), previous)
        _archive(directory, name, payload)
        _atomic_write(target, payload)
    return SavedIndicator(file=name, bytes=len(payload), replaced=replaced)


def delete_indicator(filename, directory: Path | None = None) -> dict:
    name = normalised_name(filename)
    directory = directory or indicator_dir()
    with _LOCK:
        target = directory / name
        previous, _ = _snapshot(target)
        _archive(directory, name, previous)
        _atomic_write(directory / (name + ".bak"), previous)
        target.unlink()
    return {"file": name, "deleted": True, "backup": name + ".bak"}
