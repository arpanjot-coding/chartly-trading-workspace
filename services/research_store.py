"""Durable per-issuer research bundles: Issuer + documents + facts.

Facts are append-only and content-addressed: re-ingesting the same
filing produces duplicate counts, not duplicate rows, and a restated
value links to its predecessor instead of overwriting it.
"""

from __future__ import annotations

import json
from copy import deepcopy

from sqlalchemy import LargeBinary, cast, func, insert, select, update

from database.research_db import research_issuers
from services.domain.validation import validate_record
from services.research_domain import fact_identity, select_facts_as_of
from services.workspace_storage import WorkspaceError, dumps, valid_origin

MAX_BUNDLE_BYTES = 64 * 1024 * 1024  # mega-cap filers: MSFT measures ~26 MiB live
MAX_ORIGIN_BYTES = 1024 * 1024 * 1024
MAX_ISSUERS = 5000


def _error(code, status=400):
    raise WorkspaceError("research." + code, status)


class ResearchStore:
    def __init__(self, storage):
        self.storage = storage

    def _load(self, connection, origin, issuer_id):
        row = connection.execute(
            select(research_issuers.c.payload).where(
                self.storage.scope(research_issuers, origin),
                research_issuers.c.id == issuer_id,
            )
        ).first()
        return json.loads(row[0]) if row else None

    def _list(self, connection, origin):
        return [
            json.loads(row[0])
            for row in connection.execute(
                select(research_issuers.c.payload)
                .where(self.storage.scope(research_issuers, origin))
                .order_by(research_issuers.c.id)
            )
        ]

    def _save(self, connection, origin, bundle):
        if validate_record("Issuer", bundle["issuer"]):
            _error("invalid_issuer_record")
        for row in bundle["documents"]:
            if validate_record("DocumentVersion", row):
                _error("invalid_document_record")
        for row in bundle["facts"]:
            if validate_record("FactObservation", row):
                _error("invalid_fact_record")
        raw = dumps(bundle)
        if len(raw.encode()) > MAX_BUNDLE_BYTES:
            _error("bundle_budget", 413)
        byte_length = func.length(cast(research_issuers.c.payload, LargeBinary))
        prior = connection.execute(
            select(byte_length).where(
                self.storage.scope(research_issuers, origin),
                research_issuers.c.id == bundle["id"],
            )
        ).scalar()
        total = connection.execute(
            select(func.coalesce(func.sum(byte_length), 0)).where(
                self.storage.scope(research_issuers, origin)
            )
        ).scalar()
        if total - (prior or 0) + len(raw.encode()) > MAX_ORIGIN_BYTES:
            _error("origin_budget", 413)
        if prior is None:
            count = connection.execute(
                select(func.count())
                .select_from(research_issuers)
                .where(self.storage.scope(research_issuers, origin))
            ).scalar()
            if count >= MAX_ISSUERS:
                _error("issuer_budget", 413)
            connection.execute(
                insert(research_issuers).values(
                    uid=self.storage.uid, origin=origin, id=bundle["id"], payload=raw
                )
            )
        else:
            connection.execute(
                update(research_issuers)
                .where(
                    self.storage.scope(research_issuers, origin),
                    research_issuers.c.id == bundle["id"],
                )
                .values(payload=raw)
            )
        return bundle

    def _origin(self, origin):
        if not valid_origin(origin):
            _error("invalid_origin")
        return origin

    def upsert_company(self, origin, *, issuer, documents, facts):
        """Merge one company's records; returns merge statistics."""
        self._origin(origin)
        with self.storage.transaction() as connection:
            existing = self._load(connection, origin, issuer["id"]) or {
                "version": 1,
                "id": issuer["id"],
                "issuer": issuer,
                "documents": [],
                "facts": [],
            }
            existing["issuer"] = issuer
            known_documents = {
                (row["nativeDocumentId"], row["checksum"]) for row in existing["documents"]
            }
            stats = {"documents": 0, "facts": 0, "duplicates": 0}
            for row in documents:
                key = (row["nativeDocumentId"], row["checksum"])
                if key in known_documents:
                    stats["duplicates"] += 1
                else:
                    existing["documents"].append(row)
                    known_documents.add(key)
                    stats["documents"] += 1
            known_facts = {row["id"] for row in existing["facts"]}
            for row in facts:
                if row["id"] in known_facts:
                    stats["duplicates"] += 1
                else:
                    existing["facts"].append(row)
                    known_facts.add(row["id"])
                    stats["facts"] += 1
            self._save(connection, origin, existing)
            return stats

    def get_issuer(self, origin, issuer_id):
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._load(connection, origin, issuer_id)
        if bundle is None:
            _error("issuer_not_found", 404)
        return deepcopy(bundle)

    def list_issuers(self, origin):
        self._origin(origin)
        with self.storage.transaction() as connection:
            return [row["issuer"] for row in self._list(connection, origin)]

    def append_snapshot(self, origin, issuer_id, snapshot):
        """Immutable research snapshot (P16-T06): once saved, reopening
        returns the original evidence even after later restatements."""
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._load(connection, origin, issuer_id)
            if bundle is None:
                _error("issuer_not_found", 404)
            snapshots = bundle.setdefault("snapshots", [])
            if any(row["id"] == snapshot["id"] for row in snapshots):
                _error("snapshot_exists", 409)
            snapshots.append(deepcopy(snapshot))
            self._save(connection, origin, bundle)
            return deepcopy(snapshot)

    def append_note(self, origin, issuer_id, note):
        """Document-version note (P16-T04); the source document is
        never modified — notes attach to its stable version id."""
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._load(connection, origin, issuer_id)
            if bundle is None:
                _error("issuer_not_found", 404)
            if not any(
                row["id"] == note["documentVersionId"] for row in bundle["documents"]
            ):
                _error("document_not_found", 404)
            notes = bundle.setdefault("notes", [])
            if any(row["id"] == note["id"] for row in notes):
                _error("note_exists", 409)
            notes.append(deepcopy(note))
            self._save(connection, origin, bundle)
            return deepcopy(note)

    def facts_as_of(self, origin, issuer_id, *, as_of, metric_id=None):
        bundle = self.get_issuer(origin, issuer_id)
        return select_facts_as_of(
            bundle["facts"], as_of=as_of, issuer_id=issuer_id, metric_id=metric_id
        )

    def delete_issuer(self, origin, issuer_id, *, expected_fact_count):
        """Explicit retention control: removes one issuer bundle entirely.

        The caller must state the stored fact count it reviewed; a
        mismatch aborts so retention can never delete unseen data.
        """
        self._origin(origin)
        from sqlalchemy import delete

        with self.storage.transaction() as connection:
            bundle = self._load(connection, origin, issuer_id)
            if bundle is None:
                _error("issuer_not_found", 404)
            if len(bundle["facts"]) != expected_fact_count:
                _error("retention_count_mismatch", 409)
            connection.execute(
                delete(research_issuers).where(
                    self.storage.scope(research_issuers, origin),
                    research_issuers.c.id == issuer_id,
                )
            )
            return {"deleted": issuer_id, "factsRemoved": expected_fact_count}

    def fact_history(self, origin, issuer_id, *, metric_id, unit, period_end):
        """Every filed value for one fact identity, oldest first."""
        bundle = self.get_issuer(origin, issuer_id)
        rows = [
            row
            for row in bundle["facts"]
            if row["metricId"] == metric_id
            and row["unit"] == unit
            and row["periodEnd"] == period_end
        ]
        return sorted(rows, key=lambda row: (row["availableAt"], row["id"]))
