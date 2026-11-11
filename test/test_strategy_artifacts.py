"""P20-T01 fixtures: artifact lifecycle, source validation, dependency locks."""

import pytest

from services.domain.validation import validate_record, validate_records
from services.strategy_artifacts import (
    ArtifactError,
    build_parameter_set,
    build_project,
    build_revision,
    canonical_rules_text,
    content_checksum,
    resolve_dependencies,
    validate_parameter_values,
    validate_source_document,
)

AT = "2026-11-04T12:00:00Z"
OWNER = {"owner_id": "owner-builder-test", "workspace_id": "workspace-builder-test", "at": AT}


def _indicator_doc(**changes):
    doc = {
        "format": "chartly-rules-v1",
        "kind": "indicator",
        "inputs": [
            {"name": "length", "type": "integer", "default": "14", "min": "1", "max": "500", "unit": "bars"},
            {"name": "source", "type": "source", "default": "close"},
        ],
        "outputs": [{"name": "value", "plot": "line"}],
        "policy": {"warmupBars": 14, "barCloseOnly": True, "missingData": "skip-bar"},
        "rules": [{"op": "rsi", "input": "source", "length": "length", "output": "value"}],
    }
    doc.update(changes)
    return doc


def test_valid_indicator_and_strategy_documents():
    assert validate_source_document(_indicator_doc()) == []
    strategy = _indicator_doc(kind="strategy")
    assert validate_source_document(strategy) == []
    assert validate_source_document(strategy, for_revision=True) == []


def test_invalid_documents_report_stable_codes():
    cases = {
        "artifact.source_format_unsupported": _indicator_doc(format="pine"),
        "artifact.kind_invalid": _indicator_doc(kind="bot"),
        "artifact.input_default_out_of_bounds": _indicator_doc(
            inputs=[{"name": "length", "type": "integer", "default": "0", "min": "1"}]
        ),
        "artifact.input_source_invalid": _indicator_doc(
            inputs=[{"name": "source", "type": "source", "default": "vwap"}]
        ),
        "artifact.policy_missing": {k: v for k, v in _indicator_doc().items() if k != "policy"},
        "artifact.policy_missing_data_invalid": _indicator_doc(
            policy={"warmupBars": 0, "barCloseOnly": True, "missingData": "zero-fill"}
        ),
        "artifact.outputs_invalid": _indicator_doc(outputs=[]),
    }
    for code, doc in cases.items():
        assert code in validate_source_document(doc), (code, validate_source_document(doc))
    empty_strategy = _indicator_doc(kind="strategy", rules=[])
    assert validate_source_document(empty_strategy) == []
    assert validate_source_document(empty_strategy, for_revision=True) == [
        "artifact.strategy_rules_required"
    ]


def test_checksum_is_content_identity_not_name_identity():
    text_a = canonical_rules_text(_indicator_doc())
    text_b = canonical_rules_text(_indicator_doc(inputs=list(reversed(_indicator_doc()["inputs"]))))
    assert content_checksum(text_a) != content_checksum(text_b)
    assert content_checksum(text_a) == content_checksum(canonical_rules_text(_indicator_doc()))


def test_records_validate_and_dependency_lock_orders_dependencies_first():
    indicator_project = build_project(
        project_id="project-rsi-one", name="RSI", kind="indicator",
        language="chartly-rules-v1", **OWNER,
    )
    indicator_revision = build_revision(
        revision_id="revision-rsi-one", project=indicator_project,
        source_artifact_id="source-rsi-one",
        source_text=canonical_rules_text(_indicator_doc()),
        compiler_version="chartly-rules-1.0", dependencies=[],
        validation_receipt_id="receipt-rsi-one", **OWNER,
    )
    strategy_project = build_project(
        project_id="project-trend-one", name="Trend", kind="strategy",
        language="chartly-rules-v1", **OWNER,
    )
    strategy_revision = build_revision(
        revision_id="revision-trend-one", project=strategy_project,
        source_artifact_id="source-trend-one",
        source_text=canonical_rules_text(_indicator_doc(kind="strategy")),
        compiler_version="chartly-rules-1.0", dependencies=[indicator_revision],
        validation_receipt_id="receipt-trend-one", **OWNER,
    )
    parameters = build_parameter_set(
        parameter_set_id="params-trend-one", revision_id="revision-trend-one",
        values={"length": "21"}, origin="manual", **OWNER,
    )
    for type_name, record in (
        ("ArtifactProject", indicator_project),
        ("ArtifactRevision", indicator_revision),
        ("ArtifactRevision", strategy_revision),
        ("ParameterSet", parameters),
    ):
        assert validate_record(type_name, record) == []
    entries = [
        {"type": "ArtifactProject", "value": indicator_project},
        {"type": "ArtifactProject", "value": strategy_project},
        {"type": "ArtifactRevision", "value": indicator_revision},
        {"type": "ArtifactRevision", "value": strategy_revision},
        {"type": "ParameterSet", "value": parameters},
    ]
    collection_issues = validate_records(entries)
    assert {row["code"] for row in collection_issues} == {"reference.missing"}
    lock = resolve_dependencies(
        {
            "revision-rsi-one": {"kind": "indicator", "dependencies": []},
            "revision-trend-one": {"kind": "strategy", "dependencies": ["revision-rsi-one"]},
        },
        "revision-trend-one",
    )
    assert lock == ["revision-rsi-one", "revision-trend-one"]


def test_dependency_abuses_are_rejected():
    with pytest.raises(ArtifactError, match="dependency_cycle"):
        resolve_dependencies(
            {
                "a-revision": {"kind": "strategy", "dependencies": ["b-revision"]},
                "b-revision": {"kind": "strategy", "dependencies": ["a-revision"]},
            },
            "a-revision",
        )
    with pytest.raises(ArtifactError, match="dependency_kind_invalid"):
        resolve_dependencies(
            {
                "i-revision": {"kind": "indicator", "dependencies": ["s-revision"]},
                "s-revision": {"kind": "strategy", "dependencies": []},
            },
            "i-revision",
        )
    with pytest.raises(ArtifactError, match="dependency_missing"):
        resolve_dependencies(
            {"s-revision": {"kind": "strategy", "dependencies": ["ghost-revision"]}},
            "s-revision",
        )
    with pytest.raises(ArtifactError, match="dependency_self"):
        resolve_dependencies(
            {"s-revision": {"kind": "strategy", "dependencies": ["s-revision"]}},
            "s-revision",
        )


def test_parameter_values_are_checked_against_declared_inputs():
    doc = _indicator_doc()
    assert validate_parameter_values(doc, {"length": "21", "source": "hlc3"}) == []
    assert validate_parameter_values(doc, {"length": "0"}) == ["artifact.parameter_out_of_bounds"]
    assert validate_parameter_values(doc, {"length": "1.5"}) == ["artifact.parameter_invalid"]
    assert validate_parameter_values(doc, {"unknown": "1"}) == ["artifact.parameter_unknown"]
    with pytest.raises(ArtifactError, match="language_unsupported"):
        build_project(
            project_id="project-x-one", name="X", kind="indicator", language="python", **OWNER
        )
