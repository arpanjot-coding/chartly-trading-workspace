"""Project/draft/revision storage for the Strategy Builder (P20-T02).

One scoped bundle per project: canonical ArtifactProject, the editable
draft (which may be invalid), immutable ArtifactRevision records with
dependency locks, ParameterSets and the source texts they reference.
Draft saves use compare-and-swap on (bundle revision, draft revision);
a conflict never writes, so neither side loses text. Revisions are
append-only: validation on every save proves previously stored
revisions are byte-identical.
"""

from __future__ import annotations

import json
from copy import deepcopy
from uuid import uuid4

from sqlalchemy import LargeBinary, cast, func, insert, select, update

from database.strategy_artifacts_db import strategy_artifacts
from services.domain.validation import validate_record
from services.strategy_artifacts import (
    RULES_FORMAT,
    SUPPORTED_LANGUAGES,
    ArtifactError,
    build_parameter_set,
    build_project,
    build_revision,
    canonical_rules_text,
    content_checksum,
    resolve_dependencies,
    validate_source_document,
)
from services.workspace_storage import WorkspaceError, digest, dumps, now, opaque, valid_origin

PACKAGE_FORMAT = "chartly-artifact-package-v1"

MAX_BUNDLE_BYTES = 4 * 1024 * 1024
MAX_ORIGIN_BYTES = 32 * 1024 * 1024
MAX_PROJECTS = 500
MAX_SOURCE_BYTES = 512 * 1024
COMPILER_VERSIONS = {"chartly-rules-v1": "chartly-rules-1.0", "openscript": "openscript-existing"}


def _error(code, status=400):
    raise WorkspaceError("artifact." + code, status)


def _new_id(prefix):
    return opaque(prefix, uuid4().hex)


def _diagnostics(language, source):
    if language == RULES_FORMAT:
        if not isinstance(source, dict):
            return ["artifact.source_not_object"]
        return validate_source_document(source)
    if not isinstance(source, str) or not source.strip():
        return ["artifact.source_empty"]
    return []


def _source_text(language, source):
    if language == RULES_FORMAT:
        return canonical_rules_text(source)
    return source


def validate_bundle(value, *, uid, origin):
    if not isinstance(value, dict) or value.get("version") != 1:
        _error("invalid_bundle")
    if value.get("ownerId") != uid or value.get("originId") != origin:
        _error("record_identity_mismatch")
    if type(value.get("revision")) is not int or value["revision"] < 1:
        _error("invalid_bundle_revision")
    project = value.get("project")
    if not isinstance(project, dict) or validate_record("ArtifactProject", project):
        _error("invalid_project_record")
    if project["id"] != value.get("id"):
        _error("record_identity_mismatch")
    draft = value.get("draft")
    if (
        not isinstance(draft, dict)
        or type(draft.get("draftRevision")) is not int
        or draft["draftRevision"] < 1
        or not isinstance(draft.get("diagnostics"), list)
        or "source" not in draft
    ):
        _error("invalid_draft")
    for field, type_name in (
        ("revisions", "ArtifactRevision"),
        ("parameterSets", "ParameterSet"),
        ("attachments", "IndicatorAttachment"),
    ):
        rows = value.get(field, [] if field == "attachments" else None)
        if not isinstance(rows, list) or len(rows) > 1000:
            _error("invalid_bundle")
        for row in rows:
            if not isinstance(row, dict) or validate_record(type_name, row):
                _error("invalid_canonical_record")
    sources = value.get("sources")
    if not isinstance(sources, dict) or len(sources) > 1000:
        _error("invalid_bundle")
    for text in sources.values():
        if not isinstance(text, str) or len(text.encode()) > MAX_SOURCE_BYTES:
            _error("source_budget", 413)
    return value


class StrategyArtifactStore:
    def __init__(self, storage):
        self.storage = storage

    # -- persistence primitives -------------------------------------------
    def _load(self, connection, origin, project_id):
        row = connection.execute(
            select(strategy_artifacts.c.payload).where(
                self.storage.scope(strategy_artifacts, origin),
                strategy_artifacts.c.id == project_id,
            )
        ).first()
        return json.loads(row[0]) if row else None

    def _list(self, connection, origin):
        return [
            json.loads(row[0])
            for row in connection.execute(
                select(strategy_artifacts.c.payload)
                .where(self.storage.scope(strategy_artifacts, origin))
                .order_by(strategy_artifacts.c.id)
            )
        ]

    def _save(self, connection, origin, bundle, *, previous=None):
        bundle = validate_bundle(bundle, uid=self.storage.uid, origin=origin)
        if previous is not None:
            stored = {row["id"]: row for row in previous["revisions"]}
            for row in bundle["revisions"]:
                if row["id"] in stored and stored[row["id"]] != row:
                    _error("revision_immutable", 409)
            if set(stored) - {row["id"] for row in bundle["revisions"]}:
                _error("revision_immutable", 409)
        raw = dumps(bundle)
        if len(raw.encode()) > MAX_BUNDLE_BYTES:
            _error("bundle_budget", 413)
        byte_length = func.length(cast(strategy_artifacts.c.payload, LargeBinary))
        prior = connection.execute(
            select(byte_length).where(
                self.storage.scope(strategy_artifacts, origin),
                strategy_artifacts.c.id == bundle["id"],
            )
        ).scalar()
        total = connection.execute(
            select(func.coalesce(func.sum(byte_length), 0)).where(
                self.storage.scope(strategy_artifacts, origin)
            )
        ).scalar()
        if total - (prior or 0) + len(raw.encode()) > MAX_ORIGIN_BYTES:
            _error("origin_budget", 413)
        if prior is None:
            count = connection.execute(
                select(func.count())
                .select_from(strategy_artifacts)
                .where(self.storage.scope(strategy_artifacts, origin))
            ).scalar()
            if count >= MAX_PROJECTS:
                _error("project_budget", 413)
            connection.execute(
                insert(strategy_artifacts).values(
                    uid=self.storage.uid, origin=origin, id=bundle["id"], payload=raw
                )
            )
        else:
            connection.execute(
                update(strategy_artifacts)
                .where(
                    self.storage.scope(strategy_artifacts, origin),
                    strategy_artifacts.c.id == bundle["id"],
                )
                .values(payload=raw)
            )
        return bundle

    def _origin(self, origin):
        if not valid_origin(origin):
            _error("invalid_origin")
        return origin

    def _workspace_id(self, origin):
        return opaque("workspace", self.storage.uid + "|" + origin)

    def _require(self, connection, origin, project_id):
        bundle = self._load(connection, origin, project_id)
        if bundle is None:
            _error("project_not_found", 404)
        return validate_bundle(bundle, uid=self.storage.uid, origin=origin)

    @staticmethod
    def _cas(bundle, expected_revision, expected_draft_revision=None):
        if bundle["revision"] != expected_revision or (
            expected_draft_revision is not None
            and bundle["draft"]["draftRevision"] != expected_draft_revision
        ):
            _error("draft_conflict", 409)

    # -- public operations --------------------------------------------------
    def create_project(self, origin, *, name, kind, language, source):
        self._origin(origin)
        at = now()
        try:
            project = build_project(
                project_id=_new_id("artifactproject"),
                owner_id=self.storage.uid,
                workspace_id=self._workspace_id(origin),
                at=at,
                name=name,
                kind=kind,
                language=language,
            )
        except ArtifactError as error:
            _error(error.code.removeprefix("artifact."))
        bundle = {
            "version": 1,
            "id": project["id"],
            "ownerId": self.storage.uid,
            "originId": origin,
            "revision": 1,
            "project": project,
            "draft": {
                "source": deepcopy(source),
                "baseRevisionId": None,
                "draftRevision": 1,
                "diagnostics": _diagnostics(language, source),
            },
            "revisions": [],
            "parameterSets": [],
            "attachments": [],
            "sources": {},
            "createdAt": at,
            "updatedAt": at,
        }
        with self.storage.transaction() as connection:
            return deepcopy(self._save(connection, origin, bundle))

    def get_project(self, origin, project_id):
        self._origin(origin)
        with self.storage.transaction() as connection:
            return deepcopy(self._require(connection, origin, project_id))

    def list_projects(self, origin):
        self._origin(origin)
        with self.storage.transaction() as connection:
            return [
                validate_bundle(bundle, uid=self.storage.uid, origin=origin)
                for bundle in self._list(connection, origin)
            ]

    def save_draft(self, origin, project_id, *, expected_revision, expected_draft_revision, source):
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._require(connection, origin, project_id)
            if bundle["project"]["state"] == "archived":
                _error("project_archived", 409)
            self._cas(bundle, expected_revision, expected_draft_revision)
            previous = deepcopy(bundle)
            bundle["draft"] = {
                "source": deepcopy(source),
                "baseRevisionId": bundle["draft"]["baseRevisionId"],
                "draftRevision": bundle["draft"]["draftRevision"] + 1,
                "diagnostics": _diagnostics(bundle["project"]["language"], source),
            }
            bundle["revision"] += 1
            bundle["updatedAt"] = now()
            return deepcopy(self._save(connection, origin, bundle, previous=previous))

    def create_revision(self, origin, project_id, *, expected_revision, dependency_revision_ids=()):
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._require(connection, origin, project_id)
            if bundle["project"]["state"] == "archived":
                _error("project_archived", 409)
            self._cas(bundle, expected_revision)
            language = bundle["project"]["language"]
            source = bundle["draft"]["source"]
            if language == RULES_FORMAT:
                issues = (
                    validate_source_document(source, for_revision=True)
                    if isinstance(source, dict)
                    else ["artifact.source_not_object"]
                )
                if issues:
                    _error("draft_invalid:" + ",".join(issues), 409)
            elif not isinstance(source, str) or not source.strip():
                _error("draft_invalid:artifact.source_empty", 409)
            # Resolve dependency locks across every project in this origin.
            records = {}
            graph = {}
            for other in self._list(connection, origin):
                for row in other.get("revisions", []):
                    records[row["id"]] = row
                    graph[row["id"]] = {
                        "kind": row["kind"],
                        "dependencies": [lock["revisionId"] for lock in row["dependencies"]],
                    }
            dependencies = []
            for dependency_id in dependency_revision_ids:
                record = records.get(dependency_id)
                if record is None:
                    _error("dependency_missing", 404)
                dependencies.append(record)
            candidate_id = _new_id("artifactrevision")
            graph[candidate_id] = {
                "kind": bundle["project"]["kind"],
                "dependencies": list(dependency_revision_ids),
            }
            try:
                resolve_dependencies(graph, candidate_id)
            except ArtifactError as error:
                _error(error.code.removeprefix("artifact."), 409)
            previous = deepcopy(bundle)
            at = now()
            source_id = _new_id("artifactsource")
            source_text = _source_text(language, source)
            if len(source_text.encode()) > MAX_SOURCE_BYTES:
                _error("source_budget", 413)
            try:
                revision = build_revision(
                    revision_id=candidate_id,
                    owner_id=self.storage.uid,
                    workspace_id=self._workspace_id(origin),
                    at=at,
                    project=bundle["project"],
                    source_artifact_id=source_id,
                    source_text=source_text,
                    compiler_version=COMPILER_VERSIONS[language],
                    dependencies=dependencies,
                    validation_receipt_id=_new_id("validationreceipt"),
                )
            except ArtifactError as error:
                _error(error.code.removeprefix("artifact."))
            bundle["sources"][source_id] = source_text
            bundle["revisions"].append(revision)
            if language == RULES_FORMAT:
                defaults = {
                    entry["name"]: entry["default"]
                    for entry in source.get("inputs", [])
                    if isinstance(entry, dict) and "default" in entry
                }
                if defaults:
                    bundle["parameterSets"].append(
                        build_parameter_set(
                            parameter_set_id=_new_id("parameterset"),
                            owner_id=self.storage.uid,
                            workspace_id=self._workspace_id(origin),
                            at=at,
                            revision_id=candidate_id,
                            values=defaults,
                            origin="default",
                        )
                    )
            bundle["draft"]["baseRevisionId"] = candidate_id
            bundle["revision"] += 1
            bundle["updatedAt"] = at
            return deepcopy(self._save(connection, origin, bundle, previous=previous))

    # -- chart attachments (P20-T04 backend) --------------------------------
    def _find_revision(self, bundle, revision_id):
        return next((row for row in bundle["revisions"] if row["id"] == revision_id), None)

    def _find_parameter_set(self, bundle, parameter_set_id):
        return next(
            (row for row in bundle["parameterSets"] if row["id"] == parameter_set_id), None
        )

    def attach_indicator(
        self, origin, project_id, *, expected_revision, revision_id, parameter_set_id, chart_document_id
    ):
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._require(connection, origin, project_id)
            self._cas(bundle, expected_revision)
            if bundle["project"]["kind"] != "indicator":
                _error("attachment_kind_invalid", 409)
            revision = self._find_revision(bundle, revision_id)
            if revision is None:
                _error("revision_not_found", 404)
            parameter_set = self._find_parameter_set(bundle, parameter_set_id)
            if parameter_set is None or parameter_set["artifactRevisionId"] != revision_id:
                _error("parameter_set_mismatch", 409)
            previous = deepcopy(bundle)
            at = now()
            attachment = {
                "schemaVersion": 1,
                "id": _new_id("indicatorattachment"),
                "ownerId": self.storage.uid,
                "workspaceId": self._workspace_id(origin),
                "revision": 1,
                "createdAt": at,
                "updatedAt": at,
                "chartDocumentId": chart_document_id,
                "artifactRevisionId": revision_id,
                "parameterSetId": parameter_set_id,
            }
            if validate_record("IndicatorAttachment", attachment):
                _error("invalid_attachment_record")
            bundle.setdefault("attachments", []).append(attachment)
            bundle["revision"] += 1
            bundle["updatedAt"] = at
            return deepcopy(self._save(connection, origin, bundle, previous=previous))

    def upgrade_attachment(
        self, origin, project_id, *, expected_revision, attachment_id, revision_id, parameter_set_id
    ):
        """Explicit pin move — attachments never upgrade implicitly."""
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._require(connection, origin, project_id)
            self._cas(bundle, expected_revision)
            attachment = next(
                (row for row in bundle.get("attachments", []) if row["id"] == attachment_id), None
            )
            if attachment is None:
                _error("attachment_not_found", 404)
            if self._find_revision(bundle, revision_id) is None:
                _error("revision_not_found", 404)
            parameter_set = self._find_parameter_set(bundle, parameter_set_id)
            if parameter_set is None or parameter_set["artifactRevisionId"] != revision_id:
                _error("parameter_set_mismatch", 409)
            previous = deepcopy(bundle)
            attachment["artifactRevisionId"] = revision_id
            attachment["parameterSetId"] = parameter_set_id
            attachment["revision"] += 1
            attachment["updatedAt"] = now()
            if validate_record("IndicatorAttachment", attachment):
                _error("invalid_attachment_record")
            bundle["revision"] += 1
            bundle["updatedAt"] = attachment["updatedAt"]
            return deepcopy(self._save(connection, origin, bundle, previous=previous))

    def preview_revision(self, origin, project_id, *, revision_id, parameter_set_id, candles, forming_candle=None):
        """Reference-value preview of a stored rules revision on saved data.

        OpenScript revisions are code-only here and fail explicitly;
        their preview belongs to the installed compiler host.
        """
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._require(connection, origin, project_id)
        revision = self._find_revision(bundle, revision_id)
        if revision is None:
            _error("revision_not_found", 404)
        parameter_set = self._find_parameter_set(bundle, parameter_set_id)
        if parameter_set is None or parameter_set["artifactRevisionId"] != revision_id:
            _error("parameter_set_mismatch", 409)
        if revision["language"] != RULES_FORMAT:
            _error("preview_code_only", 409)
        source_text = bundle["sources"].get(revision["sourceArtifactId"])
        if source_text is None:
            _error("source_missing", 409)
        from services.strategy_rules import compile_plan, evaluate_with_forming_bar

        try:
            document = json.loads(source_text)
            plan = compile_plan(document, parameter_set["values"])
        except ArtifactError as error:
            _error(error.code.removeprefix("artifact."))
        except (ValueError, TypeError):
            _error("source_invalid")
        result = evaluate_with_forming_bar(plan, candles, forming_candle)
        return {"planChecksum": plan["checksum"], **result}

    # -- templates, clone, export/import (P20-T05) --------------------------
    def create_from_template(self, origin, template_id):
        from services.strategy_templates import template_document

        found = template_document(template_id)
        if found is None:
            _error("template_not_found", 404)
        document, name, kind = found
        return self.create_project(
            origin, name=name, kind=kind, language=RULES_FORMAT, source=document
        )

    def _remint_bundle(self, bundle, origin, *, name):
        at = now()
        workspace_id = self._workspace_id(origin)
        project = {
            **bundle["project"],
            "id": _new_id("artifactproject"),
            "ownerId": self.storage.uid,
            "workspaceId": workspace_id,
            "revision": 1,
            "createdAt": at,
            "updatedAt": at,
            "name": name,
            "state": "active",
        }
        source_map = {old: _new_id("artifactsource") for old in bundle.get("sources", {})}
        revision_map = {row["id"]: _new_id("artifactrevision") for row in bundle["revisions"]}
        revisions = []
        for row in bundle["revisions"]:
            revisions.append(
                {
                    **row,
                    "id": revision_map[row["id"]],
                    "ownerId": self.storage.uid,
                    "workspaceId": workspace_id,
                    "revision": 1,
                    "createdAt": at,
                    "updatedAt": at,
                    "projectId": project["id"],
                    "sourceArtifactId": source_map[row["sourceArtifactId"]],
                    "dependencies": [
                        {
                            "revisionId": revision_map.get(lock["revisionId"], lock["revisionId"]),
                            "checksum": lock["checksum"],
                        }
                        for lock in row["dependencies"]
                    ],
                }
            )
        parameter_sets = [
            {
                **row,
                "id": _new_id("parameterset"),
                "ownerId": self.storage.uid,
                "workspaceId": workspace_id,
                "revision": 1,
                "createdAt": at,
                "updatedAt": at,
                "artifactRevisionId": revision_map[row["artifactRevisionId"]],
            }
            for row in bundle["parameterSets"]
        ]
        draft = deepcopy(bundle["draft"])
        if draft.get("baseRevisionId") in revision_map:
            draft["baseRevisionId"] = revision_map[draft["baseRevisionId"]]
        return {
            "version": 1,
            "id": project["id"],
            "ownerId": self.storage.uid,
            "originId": origin,
            "revision": 1,
            "project": project,
            "draft": draft,
            "revisions": revisions,
            "parameterSets": parameter_sets,
            # Chart attachments pin the original workspace's charts and
            # are deliberately not carried into a clone or import.
            "attachments": [],
            "sources": {
                source_map[old]: text for old, text in bundle.get("sources", {}).items()
            },
            "createdAt": at,
            "updatedAt": at,
        }

    def clone_project(self, origin, project_id):
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._require(connection, origin, project_id)
            clone = self._remint_bundle(bundle, origin, name=bundle["project"]["name"] + " copy")
            return deepcopy(self._save(connection, origin, clone))

    def export_project(self, origin, project_id):
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._require(connection, origin, project_id)
        package = {
            "format": PACKAGE_FORMAT,
            "exportedAt": now(),
            "project": bundle["project"],
            "draft": bundle["draft"],
            "revisions": bundle["revisions"],
            "parameterSets": bundle["parameterSets"],
            "sources": bundle["sources"],
        }
        package["manifestChecksum"] = digest(package)
        return package

    def import_project(self, origin, package):
        self._origin(origin)
        if not isinstance(package, dict) or package.get("format") != PACKAGE_FORMAT:
            _error("package_format_unsupported")
        checksum = package.get("manifestChecksum")
        payload = {key: value for key, value in package.items() if key != "manifestChecksum"}
        if not isinstance(checksum, str) or digest(payload) != checksum:
            _error("package_corrupt", 409)
        project = package.get("project")
        if not isinstance(project, dict):
            _error("package_corrupt", 409)
        if project.get("language") not in SUPPORTED_LANGUAGES:
            _error("language_unsupported")
        if project.get("kind") not in {"indicator", "strategy"}:
            _error("package_kind_invalid")
        sources = package.get("sources")
        revisions = package.get("revisions")
        if not isinstance(sources, dict) or not isinstance(revisions, list):
            _error("package_corrupt", 409)
        for row in revisions:
            if not isinstance(row, dict) or row.get("kind") != project["kind"]:
                _error("package_kind_invalid", 409)
            text = sources.get(row.get("sourceArtifactId"))
            if not isinstance(text, str) or content_checksum(text) != row.get("checksum"):
                _error("package_corrupt", 409)
        with self.storage.transaction() as connection:
            known = {
                row["id"]
                for other in self._list(connection, origin)
                for row in other.get("revisions", [])
            }
            internal = {row["id"] for row in revisions}
            for row in revisions:
                for lock in row.get("dependencies", []):
                    if lock["revisionId"] not in internal and lock["revisionId"] not in known:
                        _error("dependency_missing", 409)
            imported = self._remint_bundle(package | {"draft": package.get("draft")}, origin, name=project["name"])
            return deepcopy(self._save(connection, origin, imported))

    def archive_project(self, origin, project_id, *, expected_revision):
        self._origin(origin)
        with self.storage.transaction() as connection:
            bundle = self._require(connection, origin, project_id)
            self._cas(bundle, expected_revision)
            previous = deepcopy(bundle)
            bundle["project"] = {
                **bundle["project"],
                "state": "archived",
                "revision": bundle["project"]["revision"] + 1,
                "updatedAt": now(),
            }
            if validate_record("ArtifactProject", bundle["project"]):
                _error("invalid_project_record")
            bundle["revision"] += 1
            bundle["updatedAt"] = bundle["project"]["updatedAt"]
            return deepcopy(self._save(connection, origin, bundle, previous=previous))
