"""P20-T02 storage: draft CAS, immutable revisions, restart, isolation."""

import pytest

from services.strategy_artifact_store import StrategyArtifactStore
from services.workspace_storage import WorkspaceError, WorkspaceStorage

pytest_plugins = ["test_journal_service"]
ORIGIN = "journal_origin_01"


def _doc(length="14", kind="indicator"):
    return {
        "format": "chartly-rules-v1",
        "kind": kind,
        "inputs": [
            {"name": "length", "type": "integer", "default": length, "min": "1", "max": "500"},
            {"name": "source", "type": "source", "default": "close"},
        ],
        "outputs": [{"name": "value", "plot": "line"}],
        "policy": {"warmupBars": 14, "barCloseOnly": True, "missingData": "skip-bar"},
        "rules": [{"op": "rsi", "input": "source", "length": "length", "output": "value"}],
    }


def _create(store, name="RSI", kind="indicator", source=None):
    return store.create_project(
        ORIGIN, name=name, kind=kind, language="chartly-rules-v1", source=source or _doc(kind=kind)
    )


def test_create_save_draft_and_revision_round_trip(storage):
    store = StrategyArtifactStore(storage)
    bundle = _create(store)
    assert bundle["draft"]["diagnostics"] == []
    bundle = store.save_draft(
        ORIGIN, bundle["id"], expected_revision=1, expected_draft_revision=1, source=_doc("21")
    )
    assert bundle["draft"]["draftRevision"] == 2
    bundle = store.create_revision(ORIGIN, bundle["id"], expected_revision=2)
    [revision] = bundle["revisions"]
    assert revision["kind"] == "indicator"
    assert bundle["draft"]["baseRevisionId"] == revision["id"]
    [parameter_set] = bundle["parameterSets"]
    assert parameter_set["values"] == {"length": "21", "source": "close"}
    assert parameter_set["origin"] == "default"
    reopened = StrategyArtifactStore(WorkspaceStorage(storage.engine, storage.uid))
    assert reopened.get_project(ORIGIN, bundle["id"])["revisions"] == bundle["revisions"]


def test_draft_conflict_retains_both_texts(storage):
    store = StrategyArtifactStore(storage)
    bundle = _create(store)
    saved = store.save_draft(
        ORIGIN, bundle["id"], expected_revision=1, expected_draft_revision=1, source=_doc("21")
    )
    with pytest.raises(WorkspaceError) as caught:
        store.save_draft(
            ORIGIN, bundle["id"], expected_revision=1, expected_draft_revision=1, source=_doc("30")
        )
    assert caught.value.code == "artifact.draft_conflict"
    current = store.get_project(ORIGIN, bundle["id"])
    assert current["draft"]["source"] == saved["draft"]["source"] == _doc("21")


def test_invalid_draft_is_retained_with_diagnostics_but_cannot_revise(storage):
    store = StrategyArtifactStore(storage)
    bad = _doc()
    bad["policy"] = {"warmupBars": -1, "barCloseOnly": True, "missingData": "skip-bar"}
    bundle = _create(store, source=bad)
    assert bundle["draft"]["diagnostics"] == ["artifact.policy_warmup_invalid"]
    with pytest.raises(WorkspaceError) as caught:
        store.create_revision(ORIGIN, bundle["id"], expected_revision=1)
    assert caught.value.code.startswith("artifact.draft_invalid")
    assert store.get_project(ORIGIN, bundle["id"])["draft"]["source"] == bad


def test_revisions_are_append_only_and_locks_span_projects(storage):
    store = StrategyArtifactStore(storage)
    indicator = _create(store)
    indicator = store.create_revision(ORIGIN, indicator["id"], expected_revision=1)
    indicator_revision = indicator["revisions"][0]
    strategy = _create(store, name="Trend", kind="strategy")
    strategy = store.create_revision(
        ORIGIN,
        strategy["id"],
        expected_revision=1,
        dependency_revision_ids=[indicator_revision["id"]],
    )
    [lock] = strategy["revisions"][0]["dependencies"]
    assert lock == {"revisionId": indicator_revision["id"], "checksum": indicator_revision["checksum"]}
    # Editing drafts afterwards never changes stored revisions.
    before = store.get_project(ORIGIN, indicator["id"])["revisions"]
    current = store.get_project(ORIGIN, indicator["id"])
    store.save_draft(
        ORIGIN,
        indicator["id"],
        expected_revision=current["revision"],
        expected_draft_revision=current["draft"]["draftRevision"],
        source=_doc("9"),
    )
    assert store.get_project(ORIGIN, indicator["id"])["revisions"] == before


def _candles(closes):
    return [
        {
            "time": f"2026-11-04T00:{index:02d}:00Z",
            "open": str(value),
            "high": str(value),
            "low": str(value),
            "close": str(value),
            "volume": "10",
        }
        for index, value in enumerate(closes)
    ]


def test_attachment_pins_revision_and_upgrades_only_explicitly(storage):
    store = StrategyArtifactStore(storage)
    bundle = _create(store)
    bundle = store.create_revision(ORIGIN, bundle["id"], expected_revision=1)
    first_revision = bundle["revisions"][0]
    first_params = bundle["parameterSets"][0]
    bundle = store.attach_indicator(
        ORIGIN,
        bundle["id"],
        expected_revision=bundle["revision"],
        revision_id=first_revision["id"],
        parameter_set_id=first_params["id"],
        chart_document_id="chartdoc-main-one",
    )
    [attachment] = bundle["attachments"]
    assert attachment["artifactRevisionId"] == first_revision["id"]
    # A second revision must not move the pin implicitly.
    bundle = store.save_draft(
        ORIGIN,
        bundle["id"],
        expected_revision=bundle["revision"],
        expected_draft_revision=bundle["draft"]["draftRevision"],
        source=_doc("21"),
    )
    bundle = store.create_revision(ORIGIN, bundle["id"], expected_revision=bundle["revision"])
    second_revision = bundle["revisions"][1]
    second_params = bundle["parameterSets"][1]
    assert bundle["attachments"][0]["artifactRevisionId"] == first_revision["id"]
    bundle = store.upgrade_attachment(
        ORIGIN,
        bundle["id"],
        expected_revision=bundle["revision"],
        attachment_id=attachment["id"],
        revision_id=second_revision["id"],
        parameter_set_id=second_params["id"],
    )
    assert bundle["attachments"][0]["artifactRevisionId"] == second_revision["id"]
    assert bundle["attachments"][0]["revision"] == 2


def test_strategy_cannot_attach_as_study_and_preview_matches_engine(storage):
    store = StrategyArtifactStore(storage)
    strategy = _create(store, name="Trend", kind="strategy")
    strategy = store.create_revision(ORIGIN, strategy["id"], expected_revision=1)
    with pytest.raises(WorkspaceError) as caught:
        store.attach_indicator(
            ORIGIN,
            strategy["id"],
            expected_revision=strategy["revision"],
            revision_id=strategy["revisions"][0]["id"],
            parameter_set_id=strategy["parameterSets"][0]["id"],
            chart_document_id="chartdoc-main-one",
        )
    assert caught.value.code == "artifact.attachment_kind_invalid"
    indicator = _create(store)
    indicator = store.create_revision(ORIGIN, indicator["id"], expected_revision=1)
    preview = store.preview_revision(
        ORIGIN,
        indicator["id"],
        revision_id=indicator["revisions"][0]["id"],
        parameter_set_id=indicator["parameterSets"][0]["id"],
        candles=_candles(list(range(1, 21))),
    )
    assert preview["rows"][-1]["outputs"]["value"] == "100"
    assert preview["forming"] is None
    assert preview["planChecksum"]


def test_archive_and_cross_owner_isolation(storage):
    store = StrategyArtifactStore(storage)
    bundle = _create(store)
    bundle = store.archive_project(ORIGIN, bundle["id"], expected_revision=1)
    assert bundle["project"]["state"] == "archived"
    with pytest.raises(WorkspaceError):
        store.save_draft(
            ORIGIN,
            bundle["id"],
            expected_revision=bundle["revision"],
            expected_draft_revision=1,
            source=_doc("5"),
        )
    foreign = StrategyArtifactStore(WorkspaceStorage(storage.engine, "principal_foreign_owner"))
    assert foreign.list_projects(ORIGIN) == []
    with pytest.raises(WorkspaceError):
        foreign.get_project(ORIGIN, bundle["id"])
