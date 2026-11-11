"""Bounded domain-core recovery; no browser export, credentials or activation.

Archives are data, never code. Restore creates an isolated new SQLite file and
does not switch the running app to it. Other app stores are explicitly excluded.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import struct
from collections import Counter
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, BadZipFile, ZipFile

from sqlalchemy.exc import SQLAlchemyError

from database.domain_store import TABLES, create_domain_engine, initialize_store
from services.domain.repository import DomainRepository, RepositoryError
from services.domain.validation import RULES, SCHEMA, validate_record, validate_records

MAX_BYTES = 64 * 1024 * 1024
MAX_RECORDS = 100000
EXCLUDED = [
    "browserTraderStore",
    "browserChartCatalogs",
    "attachments",
    "marketDatasets",
    "brokerSecrets",
    "runtimeActivations",
    "otherBackendStores",
    "localPreferences",
]
NAMES = {"manifest.json", "domain.json"}


class BackupError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _json(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def _no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BackupError("backup.duplicate_json_key")
        result[key] = value
    return result


def build_scope_backup(repo: DomainRepository) -> bytes:
    snapshot = repo.snapshot(max_records=MAX_RECORDS, max_bytes=MAX_BYTES - 4096)
    content = _json(snapshot)
    if len(content) > MAX_BYTES:
        raise BackupError("backup.budget_exceeded")
    manifest = {
        "format": "chartly-domain-backup",
        "formatVersion": 1,
        "contractVersion": 1,
        "storeSchemaVersion": 1,
        "createdAt": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "scope": {"ownerId": repo.owner_id, "workspaceId": repo.workspace_id},
        "includedModules": ["domain-core"],
        "excludedModules": EXCLUDED,
        "recordCounts": dict(Counter(entry["type"] for entry in snapshot["records"])),
        "files": {
            "domain.json": {"sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}
        },
    }
    result = BytesIO()
    with ZipFile(result, "w", compression=ZIP_DEFLATED, allowZip64=False) as archive:
        archive.writestr("manifest.json", _json(manifest))
        archive.writestr("domain.json", content)
    data = result.getvalue()
    inspect_backup(data)
    return data


def _validate_references(records):
    index = {entry["value"]["id"]: entry for entry in records}
    # Check cross-partition natural-key uniqueness independently of batching.
    for rule in RULES["unique"]:
        seen = set()
        for entry in records:
            kind, value = entry["type"], entry["value"]
            if kind != rule["type"] or not all(value.get(k) == v for k, v in rule["where"].items()):
                continue
            if rule.get("skipMissing") and not all(field in value for field in rule["fields"]):
                continue
            key = tuple(value.get(field) for field in ["ownerId", "workspaceId", *rule["fields"]])
            if key in seen:
                raise BackupError("backup.invalid_references")
            seen.add(key)
    for start in range(0, len(records), 1000):
        pending = list(records[start : start + 1000])
        subset = {}
        while pending:
            entry = pending.pop()
            kind, value = entry["type"], entry["value"]
            if value["id"] in subset:
                continue
            subset[value["id"]] = entry
            if len(subset) > 10000:
                raise BackupError("backup.reference_budget_exceeded")
            refs = dict(RULES["references"].get(kind, {}))
            if kind != "LocalOwner":
                refs["ownerId"] = "LocalOwner"
            if kind not in ("LocalOwner", "Workspace"):
                refs["workspaceId"] = "Workspace"
            for field in refs:
                raw = value.get(field, [])
                for id in raw if isinstance(raw, list) else [raw]:
                    if id in index and id not in subset:
                        pending.append(index[id])
        if validate_records(list(subset.values())):
            raise BackupError("backup.invalid_references")


def inspect_backup(data: bytes):
    """Validate all input before any target file can be created."""
    if not isinstance(data, bytes) or not 22 <= len(data) <= MAX_BYTES:
        raise BackupError("backup.invalid_size")
    # v1 forbids ZIP64/comments/multidisk. Bound the directory before ZipFile
    # allocates ZipInfo objects for an attacker-controlled number of members.
    end = struct.unpack("<4s4H2LH", data[-22:])
    signature, disk, central_disk, disk_count, count, size, offset, comment = end
    if (
        signature != b"PK\x05\x06"
        or disk
        or central_disk
        or disk_count != 2
        or count != 2
        or comment
        or size > 4096
        or offset + size + 22 != len(data)
    ):
        raise BackupError("backup.invalid_archive")
    try:
        with ZipFile(BytesIO(data), "r") as archive:
            members = archive.infolist()
            if len(members) != 2 or {item.filename for item in members} != NAMES:
                raise BackupError("backup.invalid_members")
            if sum(item.file_size for item in members) > MAX_BYTES:
                raise BackupError("backup.budget_exceeded")
            for item in members:
                if (
                    item.flag_bits & 1
                    or stat.S_ISLNK(item.external_attr >> 16)
                    or item.compress_type not in (ZIP_STORED, ZIP_DEFLATED)
                ):
                    raise BackupError("backup.invalid_member")
            manifest = json.loads(archive.read("manifest.json"), object_pairs_hook=_no_duplicates)
            content = archive.read("domain.json")
    except (
        BadZipFile,
        UnicodeError,
        ValueError,
        RecursionError,
        RuntimeError,
        NotImplementedError,
    ) as error:
        raise BackupError("backup.invalid_archive") from error
    fields = {
        "format",
        "formatVersion",
        "contractVersion",
        "storeSchemaVersion",
        "createdAt",
        "scope",
        "includedModules",
        "excludedModules",
        "recordCounts",
        "files",
    }
    if (
        not isinstance(manifest, dict)
        or set(manifest) != fields
        or manifest["format"] != "chartly-domain-backup"
    ):
        raise BackupError("backup.invalid_manifest")
    if any(
        type(manifest[key]) is not int or manifest[key] != 1
        for key in ("formatVersion", "contractVersion", "storeSchemaVersion")
    ):
        raise BackupError("backup.unsupported_version")
    if (
        not isinstance(manifest["createdAt"], str)
        or len(manifest["createdAt"]) > 32
        or not manifest["createdAt"].endswith("Z")
    ):
        raise BackupError("backup.invalid_manifest")
    try:
        datetime.fromisoformat(manifest["createdAt"])
    except ValueError as error:
        raise BackupError("backup.invalid_manifest") from error
    if manifest["includedModules"] != ["domain-core"] or manifest["excludedModules"] != EXCLUDED:
        raise BackupError("backup.unsupported_modules")
    scope = manifest["scope"]
    if (
        not isinstance(scope, dict)
        or set(scope) != {"ownerId", "workspaceId"}
        or not all(
            isinstance(value, str) and re.fullmatch(SCHEMA["$defs"]["Id"]["pattern"], value)
            for value in scope.values()
        )
    ):
        raise BackupError("backup.invalid_scope")
    files = manifest["files"]
    if (
        not isinstance(files, dict)
        or set(files) != {"domain.json"}
        or not isinstance(files["domain.json"], dict)
        or set(files["domain.json"]) != {"sha256", "bytes"}
    ):
        raise BackupError("backup.invalid_manifest")
    descriptor = files["domain.json"]
    if (
        type(descriptor["bytes"]) is not int
        or descriptor["bytes"] != len(content)
        or descriptor["sha256"] != hashlib.sha256(content).hexdigest()
    ):
        raise BackupError("backup.checksum_mismatch")
    try:
        snapshot = json.loads(content, object_pairs_hook=_no_duplicates)
    except (UnicodeError, ValueError, RecursionError) as error:
        raise BackupError("backup.invalid_json") from error
    if (
        not isinstance(snapshot, dict)
        or set(snapshot) != {"records", "aliases"}
        or not isinstance(snapshot["records"], list)
        or not isinstance(snapshot["aliases"], list)
    ):
        raise BackupError("backup.invalid_payload")
    if not 2 <= len(snapshot["records"]) <= MAX_RECORDS or len(snapshot["aliases"]) > MAX_RECORDS:
        raise BackupError("backup.budget_exceeded")
    ids = set()
    counts = Counter()
    for entry in snapshot["records"]:
        if (
            not isinstance(entry, dict)
            or set(entry) != {"type", "value"}
            or not isinstance(entry["type"], str)
            or entry["type"] not in TABLES
        ):
            raise BackupError("backup.unsupported_record")
        kind, value = entry["type"], entry["value"]
        if validate_record(kind, value):
            raise BackupError("backup.invalid_record")
        if value["id"] in ids:
            raise BackupError("backup.duplicate_identity")
        ids.add(value["id"])
        counts[kind] += 1
        if kind == "LocalOwner":
            valid = value["id"] == scope["ownerId"]
        elif kind == "Workspace":
            valid = value["id"] == scope["workspaceId"] and value["ownerId"] == scope["ownerId"]
        else:
            valid = (
                value["ownerId"] == scope["ownerId"]
                and value["workspaceId"] == scope["workspaceId"]
            )
        if not valid:
            raise BackupError("backup.scope_mismatch")
        if kind == "JournalEntry" and "tradeId" in value:
            raise BackupError("backup.unsupported_record")
    declared_counts = manifest["recordCounts"]
    if (
        not isinstance(declared_counts, dict)
        or any(type(value) is not int or value < 1 for value in declared_counts.values())
        or counts["LocalOwner"] != 1
        or counts["Workspace"] != 1
        or declared_counts != dict(counts)
    ):
        raise BackupError("backup.invalid_counts")
    record_index = {entry["value"]["id"]: entry for entry in snapshot["records"]}
    alias_index = {}
    for alias in snapshot["aliases"]:
        if (
            not isinstance(alias, dict)
            or set(alias) != {"namespace", "key", "id", "type"}
            or not all(
                isinstance(value, str) and 1 <= len(value) <= 500 for value in alias.values()
            )
            or alias["id"] not in ids
            or alias["type"] not in TABLES
            or alias["type"] in ("LocalOwner", "Workspace")
            or record_index[alias["id"]]["type"] != alias["type"]
        ):
            raise BackupError("backup.invalid_alias")
        key = (alias["namespace"], alias["key"])
        if key in alias_index:
            raise BackupError("backup.invalid_alias")
        alias_index[key] = alias
    for entry in snapshot["records"]:
        for alias in entry["value"].get("aliases", []):
            found = alias_index.get((alias["namespace"], alias["key"]))
            if not found or found["id"] != entry["value"]["id"] or found["type"] != entry["type"]:
                raise BackupError("backup.invalid_alias")
    _validate_references(snapshot["records"])
    priorities = {kind: i for i, kind in enumerate(TABLES)}
    snapshot["records"].sort(key=lambda entry: (priorities[entry["type"]], entry["value"]["id"]))
    snapshot["aliases"].sort(key=lambda entry: (entry["namespace"], entry["key"]))
    return manifest, snapshot


def restore_to_new_store(data: bytes, target: Path):
    """Prepare a clean store; never merge/overwrite or activate an installed DB."""
    manifest, snapshot = inspect_backup(data)
    path = Path(target).absolute()
    if path.suffix.lower() != ".db" or "?" in str(path) or "#" in str(path):
        raise BackupError("backup.invalid_target")
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
    except FileExistsError as error:
        raise BackupError("backup.target_exists") from error
    except OSError as error:
        raise BackupError("backup.target_unavailable") from error
    engine = None
    try:
        engine = create_domain_engine(f"sqlite:///{path.as_posix()}")
        initialize_store(engine)
        repo = DomainRepository(
            engine, manifest["scope"]["ownerId"], manifest["scope"]["workspaceId"]
        )
        records = snapshot["records"]
        # Restore by dependency layer; imported historical books retain their
        # identities instead of being offered as new account-book creations.
        for kind in TABLES:
            items = [entry for entry in records if entry["type"] == kind]
            for i in range(0, len(items), 1000):
                # Original revisions are historical, not a new edit. The
                # canonical rows are created at v1, then advanced below.
                batch = items[i : i + 1000]
                initial = [
                    {"type": entry["type"], "value": {**entry["value"], "revision": 1}}
                    for entry in batch
                ]
                repo.apply(initial, _restoring_new_store=True)
                # Restore exact revision counters only in this isolated target.
                table = TABLES[kind]
                with engine.begin() as connection:
                    for entry in batch:
                        value = entry["value"]
                        if value["revision"] != 1:
                            connection.execute(
                                table.update()
                                .where(table.c.id == value["id"])
                                .values(
                                    revision=value["revision"], payload=_json(value).decode("utf-8")
                                )
                            )
        repo.restore_aliases(snapshot["aliases"])
        initialize_store(engine)
        verified = repo.snapshot()
        if _json(verified) != _json(snapshot):
            raise BackupError("backup.verification_failed")
        return {
            "status": "prepared",
            "scope": manifest["scope"],
            "recordCounts": manifest["recordCounts"],
            "archiveSha256": hashlib.sha256(data).hexdigest(),
            "activated": False,
        }
    except (RepositoryError, ValueError, OSError, SQLAlchemyError) as error:
        # A failed staging file is never activated. Preserve it for recovery;
        # do not delete, replace or edit an existing installation's database.
        raise BackupError("backup.restore_failed") from error
    finally:
        if engine is not None:
            engine.dispose()
