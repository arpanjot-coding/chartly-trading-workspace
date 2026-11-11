"""Scoped, transactional persistence for the first P02 journal slice.

The actor is supplied by a trusted local-session adapter, never by an API body.
No browser migration, broker access or database initialization occurs on import.
"""

from __future__ import annotations

import json
import re
from copy import deepcopy
from dataclasses import dataclass

from sqlalchemy import and_, delete, insert, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError, OperationalError

from database.domain_store import TABLES, aliases, books, entities, profile_books, store_version
from services.domain.validation import (
    RULES,
    SCHEMA,
    validate_record,
    validate_records,
    validate_replacement,
)


class RepositoryError(Exception):
    def __init__(self, code: str, issues=None):
        super().__init__(code)
        self.code = code
        self.issues = issues or []


@dataclass(frozen=True)
class DomainRepository:
    """Each instance is permanently bound to one trusted actor/workspace."""

    engine: Engine
    owner_id: str
    workspace_id: str

    def __post_init__(self):
        pattern = SCHEMA["$defs"]["Id"]["pattern"]
        if not all(
            isinstance(value, str) and re.fullmatch(pattern, value)
            for value in (self.owner_id, self.workspace_id)
        ):
            raise RepositoryError("storage.invalid_scope")

    def _scope(self, table, kind):
        if kind == "LocalOwner":
            return table.c.id == self.owner_id
        if kind == "Workspace":
            return and_(table.c.id == self.workspace_id, table.c.owner_id == self.owner_id)
        return and_(table.c.owner_id == self.owner_id, table.c.workspace_id == self.workspace_id)

    def _table(self, kind):
        if kind not in TABLES:
            raise RepositoryError("storage.type_unsupported")
        return TABLES[kind]

    def _decode(self, kind, row):
        if row is None:
            return None
        try:
            value = json.loads(row["payload"])
        except (ValueError, TypeError) as error:
            raise RepositoryError("storage.corrupt_record") from error
        if validate_record(kind, value):
            raise RepositoryError("storage.corrupt_record")
        fields = {
            "id": "id",
            "revision": "revision",
            "owner_id": "ownerId",
            "workspace_id": "workspaceId",
        }
        fields.update(
            {
                "Account": {
                    "kind": "kind",
                    "mode": "mode",
                    "provider_id": "providerId",
                    "venue": "venue",
                    "external_identity": "externalIdentity",
                },
                "JournalBook": {"kind": "kind", "state": "state", "account_id": "accountId"},
                "Profile": {
                    "primary_book_id": "primaryBookId",
                    "primary_account_id": "primaryAccountId",
                },
                "ManualTrade": {"book_id": "bookId"},
                "JournalEntry": {"book_id": "bookId", "manual_trade_id": "manualTradeId"},
            }.get(kind, {})
        )
        for column, field in fields.items():
            if column in row and row[column] != value.get(field):
                raise RepositoryError("storage.corrupt_record")
        return value

    def _read(self, connection, kind, id):
        table = self._table(kind)
        row = (
            connection.execute(select(table).where(table.c.id == id, self._scope(table, kind)))
            .mappings()
            .first()
        )
        return self._decode(kind, row)

    def _assert_store(self, connection):
        if (
            connection.execute(
                select(store_version.c.version).where(store_version.c.id == 1)
            ).scalar_one_or_none()
            != 1
        ):
            raise RepositoryError("storage.unsupported_schema")
        if connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() != 1:
            raise RepositoryError("storage.foreign_keys_unavailable")
        if connection.exec_driver_sql("PRAGMA synchronous").scalar_one() < 2:
            raise RepositoryError("storage.durability_unavailable")

    def get(self, kind: str, id: str):
        self._table(kind)
        try:
            with self.engine.connect() as connection:
                self._assert_store(connection)
                return self._read(connection, kind, id)
        except OperationalError as error:
            raise RepositoryError("storage.unavailable") from error

    def list(self, kind: str, *, limit=100, after=None, book_ids=None):
        table = self._table(kind)
        if type(limit) is not int or not 1 <= limit <= 500:
            raise RepositoryError("storage.invalid_page")
        if book_ids is not None and kind not in ("ManualTrade", "JournalEntry"):
            raise RepositoryError("storage.filter_unsupported")
        if book_ids is not None and (
            not isinstance(book_ids, list)
            or len(book_ids) > 500
            or any(not isinstance(id, str) for id in book_ids)
        ):
            raise RepositoryError("storage.invalid_filter")
        if book_ids is not None and not book_ids:
            return []
        statement = select(table).where(self._scope(table, kind)).order_by(table.c.id).limit(limit)
        if after is not None:
            if not isinstance(after, str):
                raise RepositoryError("storage.invalid_page")
            statement = statement.where(table.c.id > after)
        if book_ids is not None:
            if not isinstance(book_ids, list) or any(not isinstance(id, str) for id in book_ids):
                raise RepositoryError("storage.invalid_filter")
            statement = statement.where(table.c.book_id.in_(book_ids))
        try:
            with self.engine.connect() as connection:
                self._assert_store(connection)
                return [self._decode(kind, row) for row in connection.execute(statement).mappings()]
        except OperationalError as error:
            raise RepositoryError("storage.unavailable") from error

    def by_alias(self, namespace: str, key: str):
        if not all(isinstance(value, str) and 1 <= len(value) <= 500 for value in (namespace, key)):
            raise RepositoryError("storage.invalid_alias")
        try:
            with self.engine.connect() as connection:
                self._assert_store(connection)
                row = (
                    connection.execute(
                        select(aliases).where(
                            aliases.c.owner_id == self.owner_id,
                            aliases.c.workspace_id == self.workspace_id,
                            aliases.c.namespace == namespace,
                            aliases.c.legacy_key == key,
                        )
                    )
                    .mappings()
                    .first()
                )
                return (
                    None
                    if row is None
                    else self._read(connection, row["record_type"], row["entity_id"])
                )
        except OperationalError as error:
            raise RepositoryError("storage.unavailable") from error

    def _check_actor(self, kind, value):
        if kind == "LocalOwner":
            allowed = value["id"] == self.owner_id
        elif kind == "Workspace":
            allowed = value["id"] == self.workspace_id and value["ownerId"] == self.owner_id
        else:
            allowed = (
                value["ownerId"] == self.owner_id and value["workspaceId"] == self.workspace_id
            )
        if not allowed:
            raise RepositoryError("storage.scope_denied")
        if kind in ("LocalOwner", "Workspace") and value.get("aliases"):
            raise RepositoryError("storage.alias_scope_unsupported")
        if kind == "JournalEntry" and "tradeId" in value:
            raise RepositoryError("storage.account_ledger_not_implemented")

    def _graph(self, connection, proposed):
        found = {entry["value"]["id"]: entry for entry in proposed}
        pending = list(proposed)
        while pending:
            entry = pending.pop()
            kind, value = entry["type"], entry["value"]
            refs = dict(RULES["references"].get(kind, {}))
            if kind != "LocalOwner":
                refs["ownerId"] = "LocalOwner"
            if kind not in ("LocalOwner", "Workspace"):
                refs["workspaceId"] = "Workspace"
            for field, target_type in refs.items():
                raw = value.get(field, [])
                for target_id in raw if isinstance(raw, list) else [raw]:
                    if target_id in found or target_type not in TABLES:
                        continue
                    target = self._read(connection, target_type, target_id)
                    if target is not None:
                        resolved = {"type": target_type, "value": target}
                        found[target_id] = resolved
                        pending.append(resolved)
            if kind == "JournalBook" and "accountId" in value:
                rows = connection.execute(
                    select(books).where(
                        books.c.owner_id == self.owner_id,
                        books.c.workspace_id == self.workspace_id,
                        books.c.account_id == value["accountId"],
                        books.c.state == "active",
                    )
                ).mappings()
                for row in rows:
                    if row["id"] not in found:
                        resolved = {
                            "type": "JournalBook",
                            "value": self._decode("JournalBook", row),
                        }
                        found[row["id"]] = resolved
                        pending.append(resolved)
        return list(found.values())

    def apply(self, entries, *, expected_revisions=None, _restoring_new_store=False):
        """All records commit together or none do; exact retries have no new effect."""
        if not isinstance(entries, list) or not 1 <= len(entries) <= 1000:
            raise RepositoryError("storage.invalid_batch")
        if expected_revisions is not None and (
            not isinstance(expected_revisions, dict)
            or any(
                not isinstance(key, str)
                or (value is not None and (type(value) is not int or value < 1))
                for key, value in expected_revisions.items()
            )
        ):
            raise RepositoryError("storage.invalid_revision_map")
        proposed = deepcopy(entries)
        expected = dict(expected_revisions or {})
        for entry in proposed:
            if (
                not isinstance(entry, dict)
                or set(entry) != {"type", "value"}
                or not isinstance(entry["type"], str)
            ):
                raise RepositoryError("storage.invalid_entry")
            kind, value = entry["type"], entry["value"]
            self._table(kind)
            issues = validate_record(kind, value)
            if issues:
                raise RepositoryError("contract.invalid", issues)
            self._check_actor(kind, value)
        if len({entry["value"]["id"] for entry in proposed}) != len(proposed):
            raise RepositoryError("storage.duplicate_id")
        try:
            with self.engine.connect() as connection:
                connection.exec_driver_sql("BEGIN IMMEDIATE")
                try:
                    self._assert_store(connection)
                    changes = []
                    for entry in proposed:
                        kind, value = entry["type"], entry["value"]
                        registry = (
                            connection.execute(select(entities).where(entities.c.id == value["id"]))
                            .mappings()
                            .first()
                        )
                        previous = self._read(connection, kind, value["id"])
                        if registry is not None and (
                            previous is None or registry["record_type"] != kind
                        ):
                            raise RepositoryError("storage.identity_conflict")
                        if previous == value:
                            continue
                        token = expected.get(value["id"])
                        if previous is None:
                            if token is not None or value["revision"] != 1:
                                raise RepositoryError("storage.revision_conflict")
                            if (
                                kind == "JournalBook"
                                and "accountId" in value
                                and not _restoring_new_store
                            ):
                                existing_book = connection.execute(
                                    select(books.c.id).where(
                                        books.c.owner_id == self.owner_id,
                                        books.c.workspace_id == self.workspace_id,
                                        books.c.account_id == value["accountId"],
                                    )
                                ).first()
                                if existing_book:
                                    raise RepositoryError("book.reuse_existing")
                        else:
                            if type(token) is not int or token != previous["revision"]:
                                raise RepositoryError("storage.revision_conflict")
                            issues = validate_replacement(kind, previous, value)
                            if issues:
                                raise RepositoryError("contract.invalid", issues)
                        changes.append((kind, value, previous))
                    graph = self._graph(connection, proposed)
                    issues = validate_records(graph)
                    if issues:
                        raise RepositoryError("contract.invalid", issues)
                    related = {entry["value"]["id"]: entry["value"] for entry in graph}
                    for kind, value, previous in changes:
                        if (
                            previous is None
                            and kind in ("ManualTrade", "JournalEntry")
                            and related[value["bookId"]]["state"] == "archived"
                        ):
                            raise RepositoryError("book.archived")
                    priorities = {kind: i for i, kind in enumerate(TABLES)}
                    changes.sort(
                        key=lambda change: (
                            priorities[change[0]],
                            change[1].get("state") != "archived",
                        )
                    )
                    for kind, value, previous in changes:
                        if previous is None:
                            connection.execute(
                                insert(entities).values(
                                    id=value["id"],
                                    record_type=kind,
                                    owner_id=self.owner_id,
                                    workspace_id=None
                                    if kind in ("LocalOwner", "Workspace")
                                    else self.workspace_id,
                                )
                            )
                        self._write(connection, kind, value, previous)
                    connection.commit()
                    return deepcopy(proposed)
                except Exception:
                    connection.rollback()
                    raise
        except IntegrityError as error:
            raise RepositoryError("storage.integrity_conflict") from error
        except OperationalError as error:
            raise RepositoryError("storage.unavailable") from error

    def _write(self, connection, kind, value, previous):
        table = TABLES[kind]
        row = {
            "id": value["id"],
            "record_type": kind,
            "revision": value["revision"],
            "payload": json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False),
        }
        if kind != "LocalOwner":
            row["owner_id"] = self.owner_id
        if kind not in ("LocalOwner", "Workspace"):
            row["workspace_id"] = self.workspace_id
        if kind == "Account":
            row.update(
                kind=value["kind"],
                mode=value["mode"],
                provider_id=value.get("providerId"),
                venue=value.get("venue"),
                external_identity=value.get("externalIdentity"),
            )
        if kind == "JournalBook":
            row.update(
                kind=value["kind"],
                state=value["state"],
                account_id=value.get("accountId"),
                account_kind={"connected": "external", "paper": "simulated"}.get(value["kind"]),
            )
        if kind == "Profile":
            row.update(
                primary_book_id=value.get("primaryBookId"),
                primary_account_id=value.get("primaryAccountId"),
            )
        if kind == "ManualTrade":
            row.update(book_id=value["bookId"], book_kind="manual")
        if kind == "JournalEntry":
            row.update(book_id=value["bookId"], manual_trade_id=value["manualTradeId"])
        if previous is None:
            connection.execute(insert(table).values(**row))
        else:
            result = connection.execute(
                update(table)
                .where(
                    table.c.id == value["id"],
                    self._scope(table, kind),
                    table.c.revision == previous["revision"],
                )
                .values(**row)
            )
            if result.rowcount != 1:
                raise RepositoryError("storage.revision_conflict")
        if kind == "Profile":
            connection.execute(
                delete(profile_books).where(
                    profile_books.c.owner_id == self.owner_id,
                    profile_books.c.workspace_id == self.workspace_id,
                    profile_books.c.profile_id == value["id"],
                )
            )
            for book_id in value.get("bookIds", []):
                connection.execute(
                    insert(profile_books).values(
                        owner_id=self.owner_id,
                        workspace_id=self.workspace_id,
                        profile_id=value["id"],
                        book_id=book_id,
                    )
                )
        for alias in value.get("aliases", []):
            query = select(aliases).where(
                aliases.c.owner_id == self.owner_id,
                aliases.c.workspace_id == self.workspace_id,
                aliases.c.namespace == alias["namespace"],
                aliases.c.legacy_key == alias["key"],
            )
            existing = connection.execute(query).mappings().first()
            if existing:
                if existing["entity_id"] != value["id"] or existing["record_type"] != kind:
                    raise RepositoryError("storage.alias_conflict")
            else:
                connection.execute(
                    insert(aliases).values(
                        owner_id=self.owner_id,
                        workspace_id=self.workspace_id,
                        namespace=alias["namespace"],
                        legacy_key=alias["key"],
                        entity_id=value["id"],
                        record_type=kind,
                    )
                )

    def archive(self, kind, id, *, expected_revision, at):
        previous = self.get(kind, id)
        if previous is None:
            raise RepositoryError("storage.not_found")
        if kind not in ("Profile", "Account", "JournalBook"):
            raise RepositoryError("storage.archive_unsupported")
        value = {
            **previous,
            "state": "archived",
            "revision": previous["revision"] + 1,
            "updatedAt": at,
        }
        return self.apply(
            [{"type": kind, "value": value}], expected_revisions={id: expected_revision}
        )[0]["value"]

    def snapshot(self, *, max_records=100000, max_bytes=64 * 1024 * 1024):
        """One consistent, scoped read; not a backup of browser/other app stores."""
        if (
            type(max_records) is not int
            or not 1 <= max_records <= 100000
            or type(max_bytes) is not int
            or not 1 <= max_bytes <= 64 * 1024 * 1024
        ):
            raise RepositoryError("storage.invalid_snapshot_budget")
        records = []
        historical_aliases = []
        size = 0
        try:
            with self.engine.connect() as connection:
                connection.exec_driver_sql("BEGIN")
                self._assert_store(connection)
                for kind, table in TABLES.items():
                    rows = connection.execute(
                        select(table).where(self._scope(table, kind)).order_by(table.c.id)
                    ).mappings()
                    for row in rows:
                        size += len(row["payload"].encode("utf-8")) + 128
                        if len(records) >= max_records or size > max_bytes:
                            raise RepositoryError("storage.snapshot_budget_exceeded")
                        records.append({"type": kind, "value": self._decode(kind, row)})
                for row in connection.execute(
                    select(aliases)
                    .where(
                        aliases.c.owner_id == self.owner_id,
                        aliases.c.workspace_id == self.workspace_id,
                    )
                    .order_by(aliases.c.namespace, aliases.c.legacy_key)
                ).mappings():
                    item = {
                        "namespace": row["namespace"],
                        "key": row["legacy_key"],
                        "id": row["entity_id"],
                        "type": row["record_type"],
                    }
                    size += len(json.dumps(item, ensure_ascii=False).encode("utf-8"))
                    if size > max_bytes or len(historical_aliases) >= 100000:
                        raise RepositoryError("storage.snapshot_budget_exceeded")
                    historical_aliases.append(item)
                connection.rollback()
        except OperationalError as error:
            raise RepositoryError("storage.unavailable") from error
        if not any(entry["type"] == "LocalOwner" for entry in records) or not any(
            entry["type"] == "Workspace" for entry in records
        ):
            raise RepositoryError("storage.scope_uninitialized")
        return {"records": records, "aliases": historical_aliases}

    def restore_aliases(self, entries):
        """Restore retained aliases after scoped records, without retargeting any."""
        if not isinstance(entries, list) or len(entries) > 100000:
            raise RepositoryError("storage.invalid_alias")
        try:
            with self.engine.connect() as connection:
                connection.exec_driver_sql("BEGIN IMMEDIATE")
                try:
                    self._assert_store(connection)
                    for entry in entries:
                        if (
                            not isinstance(entry, dict)
                            or set(entry) != {"namespace", "key", "id", "type"}
                            or not all(
                                isinstance(entry[field], str) and 1 <= len(entry[field]) <= 500
                                for field in entry
                            )
                        ):
                            raise RepositoryError("storage.invalid_alias")
                        target = self._read(connection, entry["type"], entry["id"])
                        if target is None or entry["type"] in ("LocalOwner", "Workspace"):
                            raise RepositoryError("storage.invalid_alias")
                        found = (
                            connection.execute(
                                select(aliases).where(
                                    aliases.c.owner_id == self.owner_id,
                                    aliases.c.workspace_id == self.workspace_id,
                                    aliases.c.namespace == entry["namespace"],
                                    aliases.c.legacy_key == entry["key"],
                                )
                            )
                            .mappings()
                            .first()
                        )
                        if found:
                            if (
                                found["entity_id"] != entry["id"]
                                or found["record_type"] != entry["type"]
                            ):
                                raise RepositoryError("storage.alias_conflict")
                        else:
                            connection.execute(
                                insert(aliases).values(
                                    owner_id=self.owner_id,
                                    workspace_id=self.workspace_id,
                                    namespace=entry["namespace"],
                                    legacy_key=entry["key"],
                                    entity_id=entry["id"],
                                    record_type=entry["type"],
                                )
                            )
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
        except IntegrityError as error:
            raise RepositoryError("storage.integrity_conflict") from error
        except OperationalError as error:
            raise RepositoryError("storage.unavailable") from error
