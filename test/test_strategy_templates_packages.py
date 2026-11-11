"""P20-T05: templates, clone, export/import boundary matrix."""

from copy import deepcopy

import pytest

from services.strategy_artifact_store import StrategyArtifactStore
from services.strategy_rules import compile_plan
from services.strategy_templates import TEMPLATES, list_templates, template_document
from services.workspace_storage import WorkspaceError

pytest_plugins = ["test_journal_service"]
ORIGIN = "journal_origin_01"


def test_every_template_validates_and_compiles():
    assert {row["id"] for row in list_templates()} == {row["id"] for row in TEMPLATES}
    for template in TEMPLATES:
        document, _name, kind = template_document(template["id"])
        assert kind == template["kind"]
        plan = compile_plan(document)
        assert plan["checksum"]


def test_create_from_template_and_clone_remints_identity(storage):
    store = StrategyArtifactStore(storage)
    bundle = store.create_from_template(ORIGIN, "template-sma-cross-strategy")
    bundle = store.create_revision(ORIGIN, bundle["id"], expected_revision=1)
    clone = store.clone_project(ORIGIN, bundle["id"])
    assert clone["id"] != bundle["id"]
    assert clone["project"]["name"].endswith(" copy")
    assert clone["revisions"][0]["id"] != bundle["revisions"][0]["id"]
    assert clone["revisions"][0]["checksum"] == bundle["revisions"][0]["checksum"]
    assert clone["attachments"] == []
    # Editing the clone's draft leaves the original untouched.
    store.save_draft(
        ORIGIN,
        clone["id"],
        expected_revision=clone["revision"],
        expected_draft_revision=clone["draft"]["draftRevision"],
        source=template_document("template-rsi-indicator")[0] | {"kind": "strategy"},
    )
    assert store.get_project(ORIGIN, bundle["id"])["draft"] == bundle["draft"]


def test_export_import_round_trip_remints_identity(storage):
    store = StrategyArtifactStore(storage)
    bundle = store.create_from_template(ORIGIN, "template-rsi-indicator")
    bundle = store.create_revision(ORIGIN, bundle["id"], expected_revision=1)
    package = store.export_project(ORIGIN, bundle["id"])
    imported = store.import_project(ORIGIN, deepcopy(package))
    assert imported["id"] != bundle["id"]
    assert imported["revisions"][0]["id"] != bundle["revisions"][0]["id"]
    assert imported["revisions"][0]["checksum"] == bundle["revisions"][0]["checksum"]
    preview = store.preview_revision(
        ORIGIN,
        imported["id"],
        revision_id=imported["revisions"][0]["id"],
        parameter_set_id=imported["parameterSets"][0]["id"],
        candles=[
            {
                "time": f"2026-11-04T00:{index:02d}:00Z",
                "open": str(value), "high": str(value), "low": str(value),
                "close": str(value), "volume": "1",
            }
            for index, value in enumerate(range(1, 20))
        ],
    )
    assert preview["rows"][-1]["outputs"]["rsi"] == "100"


def test_package_boundary_matrix(storage):
    store = StrategyArtifactStore(storage)
    bundle = store.create_from_template(ORIGIN, "template-rsi-indicator")
    bundle = store.create_revision(ORIGIN, bundle["id"], expected_revision=1)
    package = store.export_project(ORIGIN, bundle["id"])

    with pytest.raises(WorkspaceError, match="package_format_unsupported"):
        store.import_project(ORIGIN, {"format": "pine-script-export"})
    with pytest.raises(WorkspaceError, match="package_format_unsupported"):
        store.import_project(ORIGIN, "not-a-package")

    tampered = deepcopy(package)
    tampered["sources"][next(iter(tampered["sources"]))] += " "
    with pytest.raises(WorkspaceError, match="package_corrupt"):
        store.import_project(ORIGIN, tampered)

    # Re-seal a kind-tampered package: checksum passes, kind check fires.
    from services.workspace_storage import digest

    wrong_kind = deepcopy(package)
    wrong_kind["revisions"][0]["kind"] = "strategy"
    payload = {k: v for k, v in wrong_kind.items() if k != "manifestChecksum"}
    wrong_kind["manifestChecksum"] = digest(payload)
    with pytest.raises(WorkspaceError, match="package_kind_invalid"):
        store.import_project(ORIGIN, wrong_kind)

    missing_dep = deepcopy(package)
    missing_dep["revisions"][0]["dependencies"] = [
        {"revisionId": "artifactrevision_missing000", "checksum": "0" * 64}
    ]
    payload = {k: v for k, v in missing_dep.items() if k != "manifestChecksum"}
    missing_dep["manifestChecksum"] = digest(payload)
    with pytest.raises(WorkspaceError, match="dependency_missing"):
        store.import_project(ORIGIN, missing_dep)


def test_unknown_template_fails_clearly(storage):
    store = StrategyArtifactStore(storage)
    with pytest.raises(WorkspaceError, match="template_not_found"):
        store.create_from_template(ORIGIN, "template-golden-grail")
