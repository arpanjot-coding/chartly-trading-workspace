"""Strategy Builder artifact domain rules (P20-T01).

Pure constructors/validators over the P01 ArtifactProject/ArtifactRevision/
ParameterSet contracts: chartly-rules-v1 source validation, content
identity, and deterministic dependency resolution. Storage (T02), the
editor (T03) and experiments (P21) build on these rules; nothing here
persists, compiles for execution, or touches an account.
"""

from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation

from services.domain.validation import validate_record

RULES_FORMAT = "chartly-rules-v1"
SUPPORTED_LANGUAGES = {"openscript", RULES_FORMAT}
INPUT_TYPES = {"integer", "decimal", "boolean", "source"}
SOURCE_FIELDS = {"open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4"}
PLOT_TYPES = {"line", "histogram", "marker", "none"}
MISSING_DATA_POLICIES = {"error", "skip-bar"}
_NAME = re.compile(r"[a-z][a-z0-9_]{0,63}")
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d+)?")


class ArtifactError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _fail(code):
    raise ArtifactError("artifact." + code)


def content_checksum(source_text):
    if not isinstance(source_text, str) or not source_text:
        _fail("source_empty")
    return hashlib.sha256(source_text.encode()).hexdigest()


def canonical_rules_text(document):
    """Stable text identity for a rules document (sorted, compact)."""
    return json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _decimal(text):
    if not isinstance(text, str) or not _DECIMAL_TEXT.fullmatch(text):
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def validate_source_document(document, *, for_revision=False):
    """Validate a chartly-rules-v1 document. Returns a list of issue codes.

    Structural authoring rules only; execution semantics arrive with the
    T03 rule engine. `for_revision` additionally requires strategies to
    declare rule groups (a draft may be incomplete, a revision may not).
    """
    issues = []
    if not isinstance(document, dict):
        return ["artifact.source_not_object"]
    if document.get("format") != RULES_FORMAT:
        issues.append("artifact.source_format_unsupported")
    kind = document.get("kind")
    if kind not in {"indicator", "strategy"}:
        issues.append("artifact.kind_invalid")
    inputs = document.get("inputs")
    if not isinstance(inputs, list) or len(inputs) > 64:
        issues.append("artifact.inputs_invalid")
        inputs = []
    seen = set()
    for entry in inputs:
        if not isinstance(entry, dict):
            issues.append("artifact.input_invalid")
            continue
        name = entry.get("name")
        if not isinstance(name, str) or not _NAME.fullmatch(name) or name in seen:
            issues.append("artifact.input_name_invalid")
            continue
        seen.add(name)
        input_type = entry.get("type")
        if input_type not in INPUT_TYPES:
            issues.append("artifact.input_type_invalid")
            continue
        if input_type == "source":
            if entry.get("default") not in SOURCE_FIELDS:
                issues.append("artifact.input_source_invalid")
            continue
        if input_type == "boolean":
            if entry.get("default") not in ("true", "false"):
                issues.append("artifact.input_default_invalid")
            continue
        default = _decimal(entry.get("default"))
        if default is None:
            issues.append("artifact.input_default_invalid")
            continue
        if input_type == "integer" and default != default.to_integral_value():
            issues.append("artifact.input_default_invalid")
            continue
        for bound in ("min", "max"):
            if bound in entry and _decimal(entry[bound]) is None:
                issues.append("artifact.input_bound_invalid")
        low, high = _decimal(entry.get("min", "")), _decimal(entry.get("max", ""))
        if low is not None and default < low:
            issues.append("artifact.input_default_out_of_bounds")
        if high is not None and default > high:
            issues.append("artifact.input_default_out_of_bounds")
        if low is not None and high is not None and low > high:
            issues.append("artifact.input_bound_invalid")
    outputs = document.get("outputs")
    if not isinstance(outputs, list) or not outputs or len(outputs) > 32:
        issues.append("artifact.outputs_invalid")
    else:
        for entry in outputs:
            if (
                not isinstance(entry, dict)
                or not isinstance(entry.get("name"), str)
                or not _NAME.fullmatch(entry.get("name") or "")
                or entry.get("plot") not in PLOT_TYPES
            ):
                issues.append("artifact.output_invalid")
    policy = document.get("policy")
    if not isinstance(policy, dict):
        issues.append("artifact.policy_missing")
    else:
        warmup = policy.get("warmupBars")
        if type(warmup) is not int or not 0 <= warmup <= 100000:
            issues.append("artifact.policy_warmup_invalid")
        if type(policy.get("barCloseOnly")) is not bool:
            issues.append("artifact.policy_bar_close_invalid")
        if policy.get("missingData") not in MISSING_DATA_POLICIES:
            issues.append("artifact.policy_missing_data_invalid")
    rules = document.get("rules")
    if not isinstance(rules, list) or len(rules) > 256:
        issues.append("artifact.rules_invalid")
    elif for_revision and kind == "strategy" and not rules:
        issues.append("artifact.strategy_rules_required")
    return sorted(set(issues))


def resolve_dependencies(revisions, root_id):
    """Deterministic dependency lock order (dependencies first).

    revisions: {revision_id: {"kind": ..., "dependencies": [ids]}}.
    Raises ArtifactError with a stable code on missing/cycle/kind abuse.
    """
    order = []
    state = {}

    def visit(revision_id, chain):
        record = revisions.get(revision_id)
        if record is None:
            _fail("dependency_missing")
        marker = state.get(revision_id)
        if marker == "done":
            return
        if marker == "open":
            _fail("dependency_cycle")
        state[revision_id] = "open"
        for dependency in record.get("dependencies", []):
            if dependency == revision_id:
                _fail("dependency_self")
            target = revisions.get(dependency)
            if target is None:
                _fail("dependency_missing")
            if record.get("kind") == "indicator" and target.get("kind") != "indicator":
                _fail("dependency_kind_invalid")
            visit(dependency, chain + [revision_id])
        state[revision_id] = "done"
        order.append(revision_id)

    visit(root_id, [])
    return order


def _base(owner_id, workspace_id, at):
    return {
        "schemaVersion": 1,
        "ownerId": owner_id,
        "workspaceId": workspace_id,
        "revision": 1,
        "createdAt": at,
        "updatedAt": at,
    }


def _checked(type_name, record):
    issues = validate_record(type_name, record)
    if issues:
        _fail("canonical_invalid:" + ",".join(sorted({row["code"] for row in issues})))
    return record


def build_project(*, project_id, owner_id, workspace_id, at, name, kind, language):
    if language not in SUPPORTED_LANGUAGES:
        _fail("language_unsupported")
    return _checked(
        "ArtifactProject",
        {
            **_base(owner_id, workspace_id, at),
            "id": project_id,
            "name": name,
            "kind": kind,
            "language": language,
            "state": "active",
        },
    )


def build_revision(
    *,
    revision_id,
    owner_id,
    workspace_id,
    at,
    project,
    source_artifact_id,
    source_text,
    compiler_version,
    dependencies,
    validation_receipt_id,
):
    # `dependencies` are the resolved ArtifactRevision records being
    # locked; the canonical lock pins both revision id and content hash.
    locks = []
    for dependency in dependencies:
        if (
            not isinstance(dependency, dict)
            or not isinstance(dependency.get("id"), str)
            or not isinstance(dependency.get("checksum"), str)
        ):
            _fail("dependency_lock_invalid")
        locks.append(
            {"revisionId": dependency["id"], "checksum": dependency["checksum"]}
        )
    return _checked(
        "ArtifactRevision",
        {
            **_base(owner_id, workspace_id, at),
            "id": revision_id,
            "projectId": project["id"],
            "kind": project["kind"],
            "checksum": content_checksum(source_text),
            "sourceArtifactId": source_artifact_id,
            "language": project["language"],
            "compilerVersion": compiler_version,
            "dependencies": locks,
            "validationReceiptId": validation_receipt_id,
        },
    )


def build_parameter_set(*, parameter_set_id, owner_id, workspace_id, at, revision_id, values, origin):
    if not isinstance(values, dict) or not values:
        _fail("parameter_values_invalid")
    for key, value in values.items():
        if not isinstance(key, str) or not _NAME.fullmatch(key):
            _fail("parameter_values_invalid")
        if not isinstance(value, str) or not value:
            _fail("parameter_values_invalid")
    return _checked(
        "ParameterSet",
        {
            **_base(owner_id, workspace_id, at),
            "id": parameter_set_id,
            "artifactRevisionId": revision_id,
            "values": dict(values),
            "origin": origin,
        },
    )


def validate_parameter_values(document, values):
    """Check ParameterSet values against a source document's inputs."""
    issues = []
    declared = {entry["name"]: entry for entry in document.get("inputs", []) if isinstance(entry, dict)}
    for name, raw in (values or {}).items():
        entry = declared.get(name)
        if entry is None:
            issues.append("artifact.parameter_unknown")
            continue
        input_type = entry.get("type")
        if input_type == "source":
            if raw not in SOURCE_FIELDS:
                issues.append("artifact.parameter_invalid")
        elif input_type == "boolean":
            if raw not in ("true", "false"):
                issues.append("artifact.parameter_invalid")
        else:
            value = _decimal(raw)
            if value is None or (input_type == "integer" and value != value.to_integral_value()):
                issues.append("artifact.parameter_invalid")
                continue
            low, high = _decimal(entry.get("min", "")), _decimal(entry.get("max", ""))
            if (low is not None and value < low) or (high is not None and value > high):
                issues.append("artifact.parameter_out_of_bounds")
    return sorted(set(issues))
