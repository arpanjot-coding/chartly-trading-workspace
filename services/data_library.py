"""Principal-owned immutable history over DuckDB; no broker prerequisite or order path."""

from __future__ import annotations

import base64
import csv
import hashlib
import json
import os
import re
import tempfile
import zipfile
from contextlib import closing
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from decimal import Decimal, localcontext
from io import BytesIO, StringIO
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, insert, or_, select, update

from database.data_library_db import datasets, library_states, records, versions
from database.workspace_storage_db import TABLES, metadata, states
from services.workspace_storage import WorkspaceError, digest, dumps, now, opaque, valid_origin

MAX_VERSIONS = 2000
MAX_RECORDS = 5000
MAX_BUNDLE_BYTES = 64 * 1024 * 1024


def _time_quarantine(version):
    observation = version.get("sourceObservation")
    inherited = version.get("timeQuarantine") or version.get("quarantine")
    if (
        isinstance(inherited, dict)
        and inherited.get("reason") == "dataset.time_unverified"
        or isinstance(observation, dict)
        and observation.get("provider") == "mt5-terminal"
        and version.get("metadata", version.get("context", {})).get("provider") == "mt5-terminal"
    ):
        return {
            "reason": "dataset.time_unverified",
            "timeBasis": "tick-derived-unverified",
            "message": (
                "This MT5 import used an unverified clock conversion. "
                "Keep its recovery bundle and reimport history with verified UTC times before use."
            ),
        }
    return None


def _file_hash(path):
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(65536), b""):
            hasher.update(block)
    return hasher.hexdigest()


def _id(value):
    if not valid_origin(value):
        raise WorkspaceError("dataset.invalid_identity")
    return value


def _source_observation(value, context):
    """Bounded public-source provenance, never an account capability certificate."""
    from services.dataset_downloads import _metadata

    value = _metadata(value)
    fields = {
        "provider",
        "receivedAt",
        "nativePair",
        "symbol",
        "interval",
        "returnedFirst",
        "returnedLast",
        "closedRows",
        "excludedUnfinished",
        "maxEntries",
        "scope",
    }
    if set(value) != fields or any(
        not isinstance(value.get(key), str) or not 1 <= len(value[key]) <= 500
        for key in ("provider", "receivedAt", "nativePair", "symbol", "interval", "scope")
    ):
        raise WorkspaceError("dataset.invalid_source_observation")
    if any(value[key] != context[key] for key in ("provider", "symbol", "interval")):
        raise WorkspaceError("dataset.invalid_source_observation")
    if any(
        type(value[key]) is not int
        for key in (
            "returnedFirst",
            "returnedLast",
            "closedRows",
            "excludedUnfinished",
            "maxEntries",
        )
    ):
        raise WorkspaceError("dataset.invalid_source_observation")
    if not (
        0 < value["returnedFirst"] <= value["returnedLast"] < 253402300799
        and 1 <= value["closedRows"] <= value["maxEntries"] <= 50000
        and 0 <= value["excludedUnfinished"] <= value["maxEntries"]
        and value["closedRows"] + value["excludedUnfinished"] <= value["maxEntries"] + 1
    ):
        raise WorkspaceError("dataset.invalid_source_observation")
    try:
        stamp = datetime.fromisoformat(value["receivedAt"].replace("Z", "+00:00"))
        if not value["receivedAt"].endswith("Z") or stamp.utcoffset() != timedelta(0):
            raise ValueError()
    except (TypeError, ValueError, OverflowError) as error:
        raise WorkspaceError("dataset.invalid_source_observation") from error
    return value


class DataLibrary:
    def __init__(self, storage):
        self.storage = storage
        self.uid = storage.uid
        self.engine = storage.engine
        database = Path(self.engine.url.database).resolve()
        self.root = database.parent / "data-library" / hashlib.sha256(self.uid.encode()).hexdigest()
        metadata.create_all(self.engine, tables=[library_states, datasets, versions, records])

    def _init(self, connection):
        self.storage._principal(connection, True)
        if (
            connection.execute(
                select(library_states.c.uid).where(library_states.c.uid == self.uid)
            ).first()
            is None
        ):
            connection.execute(insert(library_states).values(uid=self.uid, revision=0))

    def _revision(self, connection):
        return (
            connection.execute(
                select(library_states.c.revision).where(library_states.c.uid == self.uid)
            ).scalar_one_or_none()
            or 0
        )

    def _check_revision(self, connection, expected):
        if type(expected) is not int or expected != self._revision(connection):
            raise WorkspaceError("dataset.revision_conflict", 409)

    def _bump(self, connection):
        self._init(connection)
        connection.execute(
            update(library_states)
            .where(library_states.c.uid == self.uid)
            .values(revision=library_states.c.revision + 1)
        )
        return self._revision(connection)

    def _record(self, connection, kind, id):
        row = connection.execute(
            select(records.c.payload).where(
                records.c.uid == self.uid, records.c.kind == kind, records.c.id == _id(id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise WorkspaceError("dataset.record_not_found", 404)
        return json.loads(row)

    def _put_record(self, connection, kind, id, payload, version_id=None):
        _id(id)
        terms = (records.c.uid == self.uid, records.c.kind == kind, records.c.id == id)
        if len(dumps(payload).encode()) > MAX_BUNDLE_BYTES:
            raise WorkspaceError("dataset.record_too_large", 413)
        exists = connection.execute(select(records.c.id).where(*terms)).first()
        if exists:
            connection.execute(
                update(records).where(*terms).values(payload=dumps(payload), version_id=version_id)
            )
        else:
            count = connection.execute(
                select(records.c.id).where(records.c.uid == self.uid).limit(MAX_RECORDS + 1)
            ).all()
            if len(count) >= MAX_RECORDS:
                raise WorkspaceError("dataset.record_limit", 413)
            connection.execute(
                insert(records).values(
                    uid=self.uid, kind=kind, id=id, payload=dumps(payload), version_id=version_id
                )
            )

    def _version(self, connection, id, *, allow_quarantined=False):
        row = connection.execute(
            select(versions.c.payload).where(versions.c.uid == self.uid, versions.c.id == _id(id))
        ).scalar_one_or_none()
        if row is None:
            alias = connection.execute(
                select(records.c.payload).where(
                    records.c.uid == self.uid,
                    records.c.kind == "restore-alias",
                    records.c.id == opaque("alias", id),
                )
            ).scalar_one_or_none()
            if alias:
                alias = json.loads(alias)
                row = connection.execute(
                    select(versions.c.payload).where(
                        versions.c.uid == self.uid, versions.c.id == alias["versionId"]
                    )
                ).scalar_one_or_none()
                if row and json.loads(row)["checksum"] != alias["checksum"]:
                    raise WorkspaceError("dataset.alias_checksum_mismatch", 409)
            if row is None:
                raise WorkspaceError("dataset.version_not_found", 404)
        version = json.loads(row)
        quarantine = self._time_quarantine(connection, version)
        if quarantine:
            if not allow_quarantined:
                raise WorkspaceError("dataset.time_unverified", 409)
            version["quarantine"] = quarantine
        return version

    def _time_quarantine(self, connection, version):
        """Include bars inherited through a legacy merge without changing its file."""
        if version.get("metadata", {}).get("provider") != "mt5-terminal":
            return _time_quarantine(version)
        visited = set()
        while version:
            quarantine = _time_quarantine(version)
            if quarantine:
                return quarantine
            parent = version.get("baseVersionId")
            if not parent:
                return None
            if parent in visited:
                raise WorkspaceError("dataset.invalid_version_lineage", 409)
            visited.add(parent)
            if len(visited) > MAX_VERSIONS:
                raise WorkspaceError("dataset.invalid_version_lineage", 409)
            row = connection.execute(
                select(versions.c.payload).where(
                    versions.c.uid == self.uid, versions.c.id == parent
                )
            ).scalar_one_or_none()
            version = json.loads(row) if row else None
        return None

    def _alias_proofs(self, connection, version_id):
        native = (
            select(versions.c.id)
            .where(
                versions.c.uid == records.c.uid,
                versions.c.id == func.json_extract(records.c.payload, "$.id"),
            )
            .exists()
        )
        return [
            json.loads(raw)
            for raw in connection.execute(
                select(records.c.payload).where(
                    records.c.uid == self.uid,
                    records.c.kind == "restore-alias",
                    records.c.version_id == version_id,
                    ~native,
                )
            ).scalars()
        ]

    def _link_aliases(self, connection, version, proofs):
        for proof in proofs:
            if proof["id"] == version["id"]:
                continue
            if connection.execute(
                select(versions.c.id).where(
                    versions.c.uid == self.uid, versions.c.id == proof["id"]
                )
            ).first():
                continue
            alias_id = opaque("alias", proof["id"])
            old = connection.execute(
                select(records.c.payload).where(
                    records.c.uid == self.uid,
                    records.c.kind == "restore-alias",
                    records.c.id == alias_id,
                )
            ).scalar_one_or_none()
            if old and json.loads(old)["checksum"] != version["checksum"]:
                raise WorkspaceError("dataset.alias_checksum_mismatch", 409)
            self._put_record(
                connection,
                "restore-alias",
                alias_id,
                {
                    "id": proof["id"],
                    "datasetId": proof["datasetId"],
                    "checksum": version["checksum"],
                    "versionId": version["id"],
                },
                version["id"],
            )

    def _path(self, version):
        # Never accept or restore a caller-provided path.
        id = _id(version["id"])
        if not id.startswith("version_") or not id[8:].isalnum():
            raise WorkspaceError("dataset.invalid_identity")
        target = (self.root / (id + ".duckdb")).resolve()
        if not target.is_relative_to(self.root.resolve()) or target.is_symlink():
            raise WorkspaceError("dataset.file_unavailable", 503)
        return target

    def _dependencies(self, connection, id):
        result = []
        ids = {id, *[proof["id"] for proof in self._alias_proofs(connection, id)]}
        table = TABLES["practiceSessions"]
        for origin, payload in connection.execute(
            select(table.c.origin, table.c.payload).where(
                table.c.uid == self.uid,
                func.json_extract(table.c.payload, "$.datasetVersionId").in_(ids),
            )
        ):
            value = json.loads(payload)
            if value.get("datasetVersionId") in ids:
                result.append(
                    {
                        "kind": "practice-draft",
                        "originId": origin,
                        "id": value["id"],
                        "profileId": value.get("portfolioId"),
                        "name": value.get("name", "Practice draft"),
                        "archived": bool(value.get("archivedAt")),
                    }
                )
        for name in ("portfolios", "practiceSessions", "journalTrades"):
            table = TABLES[name]
            captures = (
                func.json_each(table.c.payload, "$.chartEvidence").table_valued("value").alias()
            )
            capture_match = (
                select(1)
                .select_from(captures)
                .where(func.json_extract(captures.c.value, "$.source.datasetVersionId").in_(ids))
                .exists()
            )
            for origin, payload in connection.execute(
                select(table.c.origin, table.c.payload).where(
                    table.c.uid == self.uid,
                    or_(
                        func.json_extract(table.c.payload, "$.chartSource.versionId").in_(ids),
                        func.json_extract(table.c.payload, "$.chartView.datasetVersionId").in_(ids),
                        capture_match,
                    ),
                )
            ):
                value = json.loads(payload)
                if (value.get("chartSource") or {}).get("versionId") in ids or (
                    value.get("chartView") or {}
                ).get("datasetVersionId") in ids:
                    result.append(
                        {
                            "kind": "chart-view",
                            "originId": origin,
                            "id": value["id"],
                            "profileId": value.get(
                                "portfolioId", value["id"] if name == "portfolios" else None
                            ),
                            "name": value.get("name", "Chart view"),
                            "archived": bool(value.get("archivedAt")),
                        }
                    )
                for item in value.get("chartEvidence", []):
                    if item["source"].get("datasetVersionId") in ids:
                        result.append(
                            {
                                "kind": "chart-evidence",
                                "originId": origin,
                                "id": item["id"],
                                "recordId": value["id"],
                                "profileId": value.get("portfolioId"),
                                "name": value.get("name", value.get("pair", "Chart capture")),
                                "archived": bool(value.get("archivedAt")),
                            }
                        )
        return result

    def _public_version(self, connection, value):
        result = {
            key: deepcopy(item)
            for key, item in value.items()
            if key not in ("fileHash", "sourceCsv", "sourceMapping")
        }
        result["dependencies"] = self._dependencies(connection, value["id"])
        quarantine = self._time_quarantine(connection, value)
        if quarantine:
            result["quarantine"] = quarantine
        result["backup"] = {
            "format": "chartly-dataset-bundle",
            "separateFromWorkspaceZip": True,
            "exportHref": f"/api/local/v1/datasets/versions/{value['id']}/export?format=bundle",
        }
        return result

    def catalog(self, offset=0):
        if type(offset) is not int or not 0 <= offset <= MAX_VERSIONS:
            raise WorkspaceError("dataset.invalid_query")
        with self.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            values = [
                json.loads(row)
                for row in connection.execute(
                    select(versions.c.payload)
                    .where(versions.c.uid == self.uid)
                    .order_by(
                        func.json_extract(versions.c.payload, "$.createdAt").desc(), versions.c.id
                    )
                    .offset(offset)
                    .limit(101)
                ).scalars()
            ]
            has_more = len(values) > 100
            values = values[:100]
            public = []
            for item in values:
                value = self._public_version(connection, item)
                for name in ("coverage", "quality"):
                    value[name] = {
                        key: entry
                        for key, entry in value[name].items()
                        if key not in ("gaps", "segments", "rows")
                    }
                public.append(value)
            jobs = []
            fields = (
                "id",
                "status",
                "createdAt",
                "expectedRevision",
                "context",
                "kind",
                "nextAttemptAt",
                "attempt",
                "cursor",
                "chunkCount",
                "startAt",
                "endAt",
                "error",
                "generation",
                "versionId",
            )
            columns = [
                records.c.kind
                if field == "kind"
                else func.json_extract(records.c.payload, "$." + field)
                for field in fields
            ]
            for row in connection.execute(
                select(*columns)
                .where(
                    records.c.uid == self.uid,
                    records.c.kind.in_(("history-import", "bundle-import", "download")),
                )
                .order_by(records.c.id.desc())
                .limit(100)
            ):
                job = dict(zip(fields, row, strict=True))
                if job.get("context"):
                    job["context"] = json.loads(job["context"])
                if isinstance(job.get("error"), str) and job["error"].startswith("{"):
                    job["error"] = json.loads(job["error"])
                jobs.append(job)
            return {
                "principalId": self.uid,
                "revision": self._revision(connection),
                "versions": sorted(public, key=lambda value: value["createdAt"], reverse=True),
                "jobs": jobs,
                "nextOffset": offset + 100 if has_more else None,
                "capabilities": {
                    "providerDownloads": False,
                    "downloads": {
                        "available": False,
                        "reason": "A current owner-bound provider connection is required for downloads.",
                    },
                    "nativeBarsOnly": True,
                    "permanentPurge": False,
                    "workspaceZipContainsCandles": False,
                },
            }

    def detail(self, id):
        with self.engine.connect() as connection:
            connection.exec_driver_sql("BEGIN")
            value = self._public_version(
                connection, self._version(connection, id, allow_quarantined=True)
            )
            if value["id"] != id:
                value["resolvedFromVersionId"] = id
            return value

    def _read_bars(self, version, start=None, end=None, limit=50000, *, allow_quarantined=False):
        import duckdb

        if not allow_quarantined and _time_quarantine(version):
            raise WorkspaceError("dataset.time_unverified", 409)
        path = self._path(version)
        if not path.is_file() or _file_hash(path) != version["fileHash"]:
            raise WorkspaceError("dataset.file_missing_or_changed", 409)
        try:
            with closing(
                duckdb.connect(
                    str(path), read_only=True, config={"threads": 1, "memory_limit": "128MB"}
                )
            ) as connection:
                rows = connection.execute(
                    "SELECT time,open,high,low,close,volume,open_interest FROM bars WHERE (? IS NULL OR timestamp_us>=?) AND (? IS NULL OR timestamp_us<=?) ORDER BY timestamp_us LIMIT ?",
                    [start, start, end, end, limit],
                ).fetchall()
        except duckdb.Error as error:
            raise WorkspaceError("dataset.file_unavailable", 503) from error
        result = []
        for time, open, high, low, close, volume, oi in rows:
            date = datetime.fromisoformat(time.replace("Z", "+00:00"))
            microseconds = (date - datetime(1970, 1, 1, tzinfo=UTC)) // timedelta(microseconds=1)
            stamp = (
                microseconds // 1_000_000
                if microseconds % 1_000_000 == 0
                else microseconds / 1_000_000
            )
            result.append(
                {
                    "time": time,
                    "timestamp": stamp,
                    "open": open,
                    "high": high,
                    "low": low,
                    "close": close,
                    "volume": volume,
                    "openInterest": oi,
                }
            )
        return result

    def bars(self, id, start=None, end=None, limit=5000):
        def bound(value):
            if value is None:
                return None
            try:
                text = str(value)
                if len(text) > 80 or not re.fullmatch(r"-?\d{1,12}(?:\.\d{1,40})?", text):
                    raise ValueError()
                if "." in text and len(text.split(".", 1)[1].rstrip("0")) > 6:
                    raise ValueError()
                number = Decimal(text)
                if not number.is_finite() or abs(number) > 253402300799:
                    raise ValueError()
                with localcontext() as decimal_context:
                    decimal_context.prec = 100
                    micros = number * 1000000
                if micros != micros.to_integral_value():
                    raise ValueError()
                return int(micros)
            except (ValueError, ArithmeticError) as error:
                raise WorkspaceError("dataset.invalid_time_bound") from error

        start, end = bound(start), bound(end)
        if (
            type(limit) is not int
            or not 1 <= limit <= 50000
            or start is not None
            and end is not None
            and start > end
        ):
            raise WorkspaceError("dataset.invalid_query")
        with self.engine.connect() as connection:
            version = self._version(connection, id)
        return {
            "versionId": version["id"],
            **({"resolvedFromVersionId": id} if version["id"] != id else {}),
            "checksum": version["checksum"],
            "bars": self._read_bars(version, start, end, limit),
        }

    @staticmethod
    def _quality_call(function, *args):
        try:
            return function(*args)
        except ValueError as error:
            raise WorkspaceError(
                getattr(error, "code", "dataset.invalid_input"),
                getattr(error, "status", 400),
                [{"code": error.code, "message": str(error)}] if hasattr(error, "code") else [],
            ) from error

    def _context(self, context):
        from services.dataset_quality import validate_context

        value = self._quality_call(validate_context, context)
        value["sourceId"] = opaque("source", self.uid + "|" + value["provider"].lower())
        value["instrumentId"] = opaque("instrument", value["exchange"] + "|" + value["symbol"])
        return value

    def _dataset_id(self, context):
        identity = {
            key: context.get(key)
            for key in (
                "sourceId",
                "instrumentId",
                "interval",
                "priceBasis",
                "adjustment",
                "currency",
                "volumeMeaning",
                "allowNegativePrices",
                "calendar",
            )
        }
        return opaque("dataset", self.uid + "|" + digest(identity))

    def _import_public(self, job):
        result = {
            key: deepcopy(value)
            for key, value in job.items()
            if key
            in (
                "id",
                "status",
                "expectedRevision",
                "createdAt",
                "versionId",
                "receipt",
                "baseVersionId",
                "sourceObservation",
            )
        }
        if "preview" in job:
            result["preview"] = {
                key: deepcopy(value) for key, value in job["preview"].items() if key != "bars"
            }
        result["context"] = deepcopy(job["context"])
        result["mapping"] = deepcopy(job["mapping"])
        quarantine = _time_quarantine(job)
        if quarantine:
            result["quarantine"] = quarantine
        return result

    def preview_import(
        self,
        expected_revision,
        csv_text,
        mapping,
        context,
        base_version_id=None,
        source_observation=None,
    ):
        from services.dataset_quality import normalize_history

        context = self._context(context)
        if source_observation is not None:
            source_observation = _source_observation(source_observation, context)
        dataset_id = self._dataset_id(context)
        with self.storage.transaction() as connection:
            self._init(connection)
            self._check_revision(connection, expected_revision)
            base = None
            if base_version_id:
                base = self._version(connection, base_version_id)
                if base["datasetId"] != dataset_id:
                    raise WorkspaceError("dataset.source_identity_mismatch", 409)
            else:
                logical = connection.execute(
                    select(datasets.c.payload).where(
                        datasets.c.uid == self.uid, datasets.c.id == dataset_id
                    )
                ).scalar_one_or_none()
                if logical:
                    base = self._version(connection, json.loads(logical)["latestVersionId"])
            previous = self._read_bars(base) if base else []
            preview = self._quality_call(normalize_history, csv_text, mapping, context, previous)
            job = {
                "id": "history_import_" + uuid4().hex,
                "kind": "history-import",
                "status": "staged",
                "expectedRevision": expected_revision,
                "createdAt": now(),
                "context": context,
                "mapping": preview["mapping"],
                "csvText": csv_text,
                "baseVersionId": base["id"] if base else None,
                "preview": preview,
                **(
                    {"sourceObservation": source_observation}
                    if source_observation is not None
                    else {}
                ),
            }
            self._put_record(connection, "history-import", job["id"], job)
        return self._import_public(job)

    def import_job(self, id):
        with self.engine.connect() as connection:
            return self._import_public(self._record(connection, "history-import", id))

    def repreview_import(self, id, expected_revision):
        with self.engine.connect() as connection:
            job = self._record(connection, "history-import", id)
        return self.preview_import(
            expected_revision,
            job["csvText"],
            job["mapping"],
            job["context"],
            job.get("baseVersionId"),
            source_observation=job.get("sourceObservation"),
        )

    def _write_file(self, version, bars):
        import duckdb

        self.root.mkdir(parents=True, exist_ok=True)
        path = self._path(version)
        if path.exists():
            # A terminated worker may have published bytes before SQLite committed.
            # Adopt only an identical verified orphan; never delete an unknown file.
            candidate = {**version, "fileHash": _file_hash(path)}
            if digest(self._read_bars(candidate)) != digest(bars):
                raise WorkspaceError("dataset.unregistered_file_conflict", 409)
            version.update(fileHash=candidate["fileHash"], sizeBytes=path.stat().st_size)
            return None
        with tempfile.TemporaryDirectory(prefix="stage-", dir=self.root) as temporary:
            target = Path(temporary) / "candles.duckdb"
            with closing(
                duckdb.connect(str(target), config={"threads": 1, "memory_limit": "128MB"})
            ) as connection:
                connection.execute(
                    "CREATE TABLE bars(timestamp_us BIGINT PRIMARY KEY,time VARCHAR,open VARCHAR,high VARCHAR,low VARCHAR,close VARCHAR,volume VARCHAR,open_interest VARCHAR)"
                )
                epoch = datetime(1970, 1, 1, tzinfo=UTC)
                rows = []
                for bar in bars:
                    parsed = datetime.fromisoformat(bar["time"].replace("Z", "+00:00"))
                    microseconds = (parsed - epoch) // timedelta(microseconds=1)
                    rows.append(
                        [
                            microseconds,
                            bar["time"],
                            bar["open"],
                            bar["high"],
                            bar["low"],
                            bar["close"],
                            bar.get("volume"),
                            bar.get("openInterest"),
                        ]
                    )
                connection.execute("BEGIN TRANSACTION")
                connection.executemany("INSERT INTO bars VALUES(?,?,?,?,?,?,?,?)", rows)
                connection.execute("COMMIT")
                connection.execute("CHECKPOINT")
            os.replace(target, path)
        version["fileHash"] = _file_hash(path)
        version["sizeBytes"] = path.stat().st_size
        return path

    def _link_manifests(self, connection, version):
        manifest = {
            key: version[key] for key in ("id", "datasetId", "checksum", "rowCount", "start", "end")
        }
        manifest.update(
            kind="dataset-version-reference",
            fileContent="separate-dataset-bundle",
            exportHref=f"/api/local/v1/datasets/versions/{version['id']}/export?format=bundle",
        )
        for origin, raw in connection.execute(
            select(states.c.origin, states.c.snapshot_meta).where(states.c.uid == self.uid)
        ):
            meta = json.loads(raw)
            values = meta.setdefault("datasetManifests", [])
            if not any(item.get("id") == version["id"] for item in values):
                if len(values) >= 10000:
                    raise WorkspaceError("dataset.manifest_limit", 413)
                values.append(manifest)
                connection.execute(
                    update(states)
                    .where(states.c.uid == self.uid, states.c.origin == origin)
                    .values(snapshot_meta=dumps(meta), state_revision=states.c.state_revision + 1)
                )

    def commit_import(
        self,
        id,
        expected_revision,
        request_id,
        policy="keep",
        allow_rejected_rows=False,
        download_guard=None,
        record_kind="history-import",
    ):
        from services.dataset_quality import analyze_bars

        if (
            policy not in ("keep", "replace", "new-version")
            or type(allow_rejected_rows) is not bool
        ):
            raise WorkspaceError("dataset.invalid_confirmation")
        body = {
            "id": id,
            "expectedRevision": expected_revision,
            "policy": policy,
            "allowRejectedRows": allow_rejected_rows,
        }
        created_file = None
        try:
            with self.storage.transaction() as connection:
                self._init(connection)
                replay = self.storage._receipt(connection, request_id, "dataset-import", body)
                if replay is not None:
                    receipt = replay
                else:
                    self._check_revision(connection, expected_revision)
                    job = self._record(connection, record_kind, id)
                    if job["status"] == "completed":
                        receipt = job["receipt"]
                    else:
                        if job["expectedRevision"] != expected_revision:
                            raise WorkspaceError("dataset.revision_conflict", 409)
                        if download_guard:
                            from services.dataset_downloads import validate_download_guard

                            validate_download_guard(self, connection, download_guard)
                        preview = job["preview"]
                        if not preview.get("canCommit"):
                            raise WorkspaceError("dataset.import_has_errors", 409)
                        if preview["counts"].get("rejected", 0) and not allow_rejected_rows:
                            raise WorkspaceError("dataset.rejected_rows_require_confirmation", 409)
                        old = (
                            self._read_bars(self._version(connection, job["baseVersionId"]))
                            if job.get("baseVersionId") and policy != "new-version"
                            else []
                        )
                        merged = {bar["time"]: bar for bar in old}
                        for bar in preview["bars"]:
                            if policy != "keep" or bar["time"] not in merged:
                                merged[bar["time"]] = bar
                        analysis = self._quality_call(
                            analyze_bars, list(merged.values()), job["context"]
                        )
                        context = job["context"]
                        dataset_id = self._dataset_id(context)
                        version_id = opaque("version", dataset_id + "|" + analysis["contentHash"])
                        existing = connection.execute(
                            select(versions.c.payload).where(
                                versions.c.uid == self.uid, versions.c.id == version_id
                            )
                        ).scalar_one_or_none()
                        if existing:
                            version = self._version(connection, version_id)
                            self._read_bars(version, limit=1)
                        else:
                            count = len(
                                connection.execute(
                                    select(versions.c.id)
                                    .where(versions.c.uid == self.uid)
                                    .limit(MAX_VERSIONS + 1)
                                ).all()
                            )
                            if count >= MAX_VERSIONS:
                                raise WorkspaceError("dataset.version_limit", 413)
                            bars = analysis["bars"]
                            version = {
                                "id": version_id,
                                "datasetId": dataset_id,
                                "name": context.get("name") or context["symbol"],
                                "metadata": context,
                                "checksum": analysis["contentHash"],
                                "sourceHash": preview["sourceHash"],
                                "rowCount": len(bars),
                                "start": bars[0]["timestamp"],
                                "end": bars[-1]["timestamp"],
                                "quality": analysis["quality"],
                                "coverage": analysis["coverage"],
                                "createdAt": now(),
                                "baseVersionId": job.get("baseVersionId"),
                                "policy": policy,
                                "sourceJobId": id,
                                "sourceRecordKind": record_kind,
                                "sourceMapping": job["mapping"],
                                **(
                                    {"sourceObservation": deepcopy(job["sourceObservation"])}
                                    if job.get("sourceObservation")
                                    else {}
                                ),
                                **(
                                    {"timeQuarantine": deepcopy(job["timeQuarantine"])}
                                    if job.get("timeQuarantine")
                                    else {}
                                ),
                                "importReport": {
                                    "counts": preview["counts"],
                                    "quality": preview["quality"],
                                    "sourceHash": preview["sourceHash"],
                                    "policy": policy,
                                    "baseVersionId": job.get("baseVersionId"),
                                },
                            }
                            created_file = self._write_file(version, bars)
                            logical = {
                                "id": dataset_id,
                                "latestVersionId": version_id,
                                "metadata": context,
                                "updatedAt": now(),
                            }
                            found = connection.execute(
                                select(datasets.c.id).where(
                                    datasets.c.uid == self.uid, datasets.c.id == dataset_id
                                )
                            ).first()
                            if found:
                                connection.execute(
                                    update(datasets)
                                    .where(datasets.c.uid == self.uid, datasets.c.id == dataset_id)
                                    .values(payload=dumps(logical))
                                )
                            else:
                                connection.execute(
                                    insert(datasets).values(
                                        uid=self.uid, id=dataset_id, payload=dumps(logical)
                                    )
                                )
                            connection.execute(
                                insert(versions).values(
                                    uid=self.uid,
                                    id=version_id,
                                    dataset_id=dataset_id,
                                    payload=dumps(version),
                                )
                            )
                            self._link_manifests(connection, version)
                        if job.get("restoreAliases"):
                            self._link_aliases(connection, version, job["restoreAliases"])
                        self._bump(connection)
                        receipt = {"version": self._public_version(connection, version)}
                        job.update(status="completed", versionId=version_id, receipt=receipt)
                        self._put_record(connection, record_kind, id, job, version_id)
                        if download_guard:
                            from services.dataset_downloads import complete_download_chunk

                            complete_download_chunk(self, connection, download_guard, receipt)
                    self.storage._save_receipt(
                        connection, request_id, "dataset-import", body, receipt
                    )
        except BaseException:
            if created_file is not None and created_file.is_relative_to(self.root.resolve()):
                created_file.unlink(missing_ok=True)
            raise
        return {**receipt, "catalog": self.catalog()}

    def archive(self, id, expected_revision, request_id, restore=False):
        if type(restore) is not bool:
            raise WorkspaceError("dataset.invalid_confirmation")
        body = {"id": id, "expectedRevision": expected_revision, "restore": restore}
        with self.storage.transaction() as connection:
            self._init(connection)
            receipt = self.storage._receipt(connection, request_id, "dataset-archive", body)
            if receipt is None:
                self._check_revision(connection, expected_revision)
                version = self._version(connection, id, allow_quarantined=True)
                if restore:
                    version.pop("archivedAt", None)
                else:
                    version["archivedAt"] = now()
                connection.execute(
                    update(versions)
                    .where(versions.c.uid == self.uid, versions.c.id == version["id"])
                    .values(payload=dumps(version))
                )
                self._bump(connection)
                receipt = {"version": self._public_version(connection, version)}
                self.storage._save_receipt(connection, request_id, "dataset-archive", body, receipt)
        return {**receipt, "catalog": self.catalog()}

    def export(self, id, format="bundle"):
        if format not in ("csv", "bundle"):
            raise WorkspaceError("dataset.invalid_export_format")
        with self.engine.connect() as connection:
            version = self._version(connection, id, allow_quarantined=format == "bundle")
        bars = self._read_bars(version, allow_quarantined=format == "bundle")
        if format == "csv":
            stream = StringIO(newline="")
            writer = csv.writer(stream)
            writer.writerow(["timestamp", "open", "high", "low", "close", "volume", "openInterest"])
            for bar in bars:
                writer.writerow(
                    [
                        bar["time"],
                        bar["open"],
                        bar["high"],
                        bar["low"],
                        bar["close"],
                        bar.get("volume"),
                        bar.get("openInterest"),
                    ]
                )
            content = stream.getvalue().encode("utf-8-sig")
            mime = "text/csv"
            suffix = "csv"
        elif format == "bundle":
            payload = dumps(bars).encode()
            manifest = {
                "format": "chartly-dataset-bundle",
                "version": 1,
                "datasetVersion": {
                    key: version[key]
                    for key in (
                        "id",
                        "datasetId",
                        "name",
                        "metadata",
                        "checksum",
                        "sourceHash",
                        "rowCount",
                        "quality",
                        "coverage",
                        "createdAt",
                    )
                },
                "sourceMapping": version.get("sourceMapping", {}),
                "members": {
                    "bars.json": {
                        "sha256": hashlib.sha256(payload).hexdigest(),
                        "size": len(payload),
                    }
                },
            }
            if version.get("sourceObservation"):
                manifest["datasetVersion"]["sourceObservation"] = deepcopy(
                    version["sourceObservation"]
                )
            quarantine = _time_quarantine(version)
            if quarantine:
                manifest["datasetVersion"]["quarantine"] = quarantine
            with self.engine.connect() as connection:
                job = self._record(
                    connection,
                    version.get("sourceRecordKind", "history-import"),
                    version["sourceJobId"],
                )
                manifest["versionAliases"] = [
                    {key: proof[key] for key in ("id", "datasetId", "checksum")}
                    for proof in self._alias_proofs(connection, version["id"])
                ]
            source = job.get("csvText", "").encode()
            if source:
                manifest["members"]["source.csv"] = {
                    "sha256": hashlib.sha256(source).hexdigest(),
                    "size": len(source),
                }
            stream = BytesIO()
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("manifest.json", dumps(manifest))
                archive.writestr("bars.json", payload)
                if source:
                    archive.writestr("source.csv", source)
            content = stream.getvalue()
            mime = "application/zip"
            suffix = "zip"
        else:
            raise WorkspaceError("dataset.invalid_export_format")
        return {
            "filename": id + "." + suffix,
            "mimeType": mime,
            "base64": base64.b64encode(content).decode(),
        }

    def preview_bundle(self, expected_revision, base64_data):
        from services.dataset_quality import analyze_bars, validate_mapping

        if not isinstance(base64_data, str) or len(base64_data) > MAX_BUNDLE_BYTES:
            raise WorkspaceError("dataset.bundle_too_large", 413)
        try:
            content = base64.b64decode(base64_data, validate=True)
            with zipfile.ZipFile(BytesIO(content)) as archive:
                members = archive.infolist()
                names = [item.filename for item in members]
                if len(names) != len(set(names)) or set(names) not in (
                    {"manifest.json", "bars.json"},
                    {"manifest.json", "bars.json", "source.csv"},
                ):
                    raise ValueError("members")
                if (
                    sum(item.file_size for item in members) > MAX_BUNDLE_BYTES
                    or archive.getinfo("manifest.json").file_size > 262144
                ):
                    raise ValueError("budget")
                manifest = json.loads(archive.read("manifest.json"))
                if (
                    manifest.get("format") != "chartly-dataset-bundle"
                    or type(manifest.get("version")) is not int
                    or manifest["version"] != 1
                    or not isinstance(manifest.get("members"), dict)
                    or set(manifest["members"]) != set(names) - {"manifest.json"}
                ):
                    raise ValueError("format")
                raw = {name: archive.read(name) for name in manifest["members"]}
                for name, value in raw.items():
                    check = manifest["members"][name]
                    if (
                        check.get("size") != len(value)
                        or check.get("sha256") != hashlib.sha256(value).hexdigest()
                    ):
                        raise ValueError("checksum")
            original = manifest["datasetVersion"]
            if (
                not isinstance(original, dict)
                or type(original.get("rowCount")) is not int
                or not 1 <= original["rowCount"] <= 50000
            ):
                raise ValueError("row count")
            _id(original["id"])
            _id(original["datasetId"])
            if any(
                not isinstance(original.get(key), str)
                or not re.fullmatch(r"[a-f0-9]{64}", original[key])
                for key in ("checksum", "sourceHash")
            ):
                raise ValueError("hash")

            def proof(value):
                if not isinstance(value, dict) or set(value) != {"id", "datasetId", "checksum"}:
                    raise ValueError("alias proof")
                _id(value["id"])
                _id(value["datasetId"])
                if value["checksum"] != original["checksum"] or value["id"] != opaque(
                    "version", value["datasetId"] + "|" + value["checksum"]
                ):
                    raise ValueError("version identity checksum")
                return {key: value[key] for key in ("id", "datasetId", "checksum")}

            aliases = manifest.get("versionAliases", [])
            if not isinstance(aliases, list) or len(aliases) > 1000:
                raise ValueError("alias budget")
            restore_aliases = [
                proof({key: original[key] for key in ("id", "datasetId", "checksum")})
            ] + [proof(value) for value in aliases]
            if len({value["id"] for value in aliases}) != len(aliases):
                raise ValueError("duplicate aliases")
            restored_mapping = validate_mapping(manifest.get("sourceMapping"))
            source_observation = None
            context = self._context(original["metadata"])
            if original.get("sourceObservation") is not None:
                source_observation = _source_observation(original["sourceObservation"], context)
            analysis = self._quality_call(analyze_bars, json.loads(raw["bars.json"]), context)
            if (
                analysis["contentHash"] != original["checksum"]
                or len(analysis["bars"]) != original["rowCount"]
            ):
                raise ValueError("content checksum")
            source = raw.get("source.csv", b"").decode("utf-8")
            if (
                len(source.encode()) > 8 * 1024 * 1024
                or source
                and hashlib.sha256(raw["source.csv"]).hexdigest() != original["sourceHash"]
            ):
                raise ValueError("source checksum")
        except (
            WorkspaceError,
            ValueError,
            KeyError,
            TypeError,
            UnicodeError,
            zipfile.BadZipFile,
            RuntimeError,
            NotImplementedError,
            RecursionError,
        ) as error:
            raise WorkspaceError("dataset.invalid_bundle") from error
        with self.storage.transaction() as connection:
            self._init(connection)
            self._check_revision(connection, expected_revision)
            preview = {
                **analysis,
                "context": context,
                "sourceHash": original["sourceHash"],
                "canCommit": True,
                "counts": {
                    "accepted": len(analysis["bars"]),
                    "rejected": 0,
                    "changed": 0,
                    "unchanged": 0,
                },
                "rows": [],
            }
            job = {
                "id": "bundle_import_" + uuid4().hex,
                "kind": "bundle-import",
                "status": "staged",
                "createdAt": now(),
                "expectedRevision": expected_revision,
                "context": context,
                "mapping": restored_mapping,
                "csvText": source,
                "preview": preview,
                "restoredFromVersionId": original["id"],
                "restoreAliases": restore_aliases,
                **(
                    {"timeQuarantine": _time_quarantine(original)}
                    if _time_quarantine(original)
                    else {}
                ),
                **(
                    {"sourceObservation": source_observation}
                    if source_observation is not None
                    else {}
                ),
            }
            self._put_record(connection, "bundle-import", job["id"], job)
        return self._import_public(job)

    def bundle_job(self, id):
        with self.engine.connect() as connection:
            return self._import_public(self._record(connection, "bundle-import", id))

    def repreview_bundle(self, id, expected_revision):
        with self.storage.transaction() as connection:
            self._init(connection)
            self._check_revision(connection, expected_revision)
            job = self._record(connection, "bundle-import", id)
            job.update(
                id="bundle_import_" + uuid4().hex,
                status="staged",
                expectedRevision=expected_revision,
                createdAt=now(),
            )
            job.pop("receipt", None)
            job.pop("versionId", None)
            self._put_record(connection, "bundle-import", job["id"], job)
        return self._import_public(job)

    def commit_bundle(self, id, expected_revision, request_id):
        return self.commit_import(
            id, expected_revision, request_id, "new-version", False, record_kind="bundle-import"
        )


DataLibraryService = DataLibrary
