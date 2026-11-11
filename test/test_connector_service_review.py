"""Independent publication, identity and recovery review of the P07 service."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import update
from test_connectors import ORIGIN, WINDOW, act, created, linked

from database.connector_vault_db import connector_secrets
from services import connector_adapters
from services.connectors import Connectors
from services.workspace_recovery import WorkspaceRecoveryService
from services.workspace_storage import WorkspaceError, WorkspaceStorage

pytest_plugins = ["test_journal_service"]


@pytest.fixture
def registry(storage):
    return Connectors(storage, vault_key="independent-p07-synthetic-key-" + "a" * 32)


def test_uncertain_committed_sync_retry_returns_its_updated_owned_journal_workspace(
    registry, monkeypatch
):
    connection = linked(registry)
    request_id = uuid4().hex
    first = act(
        registry, "sync", {"window": WINDOW}, connection["id"], connection["revision"], request_id
    )
    monkeypatch.setattr(
        connector_adapters,
        "history",
        lambda *args, **kwargs: pytest.fail("A committed receipt cannot fetch twice"),
    )
    recovered = act(
        registry, "sync", {"window": WINDOW}, connection["id"], connection["revision"], request_id
    )
    assert recovered["receipt"] == first["receipt"]
    assert recovered["workspace"] == registry.storage.workspace(ORIGIN)
    assert len(recovered["workspace"]["tables"]["journalTrades"]) == 2


def test_ambiguous_observed_account_candidates_require_explicit_selection(registry):
    workspace = registry.storage.workspace()
    tables = deepcopy(workspace["tables"])
    for number, account in enumerate(tables["brokerAccounts"]):
        account.update(
            platform="broker-api",
            server="Chartly Diagnostic",
            externalLogin="DIAGNOSTIC-ALPHA",
            accountKind="demo",
            currency="USD",
            brokerName=f"Legacy provider alias {number}",
        )
    registry.storage.save_tables(ORIGIN, tables, workspace["revision"], uuid4().hex)
    for account in tables["brokerAccounts"]:
        workspace = registry.storage.workspace()
        registry.journal.action(
            ORIGIN,
            workspace["revision"],
            uuid4().hex,
            "create-book",
            {"portfolioId": 1, "accountId": account["id"]},
        )
    connection = created(registry)
    act(registry, "probe", identity=connection["id"])
    before = registry.storage.snapshot()
    with pytest.raises(WorkspaceError, match="ambiguous_account_selection"):
        act(
            registry,
            "link",
            {"profileId": 1, "createObservedAccount": True, "confirmIdentity": True},
            connection["id"],
        )
    assert registry.storage.snapshot() == before
    selected = act(
        registry,
        "link",
        {"profileId": 1, "accountId": 2, "confirmIdentity": True},
        connection["id"],
    )
    assert selected["connection"]["accountId"] == 2
    assert len(selected["workspace"]["tables"]["brokerAccounts"]) == 2


def test_source_response_after_concurrent_configuration_change_cannot_publish(
    registry, monkeypatch
):
    connection = linked(registry)
    original_fetch = connector_adapters.history

    def changed_during_fetch(*args, **kwargs):
        result = original_fetch(*args, **kwargs)
        act(registry, "configure", {"label": "Concurrent reviewed label"}, connection["id"])
        return result

    monkeypatch.setattr(connector_adapters, "history", changed_during_fetch)
    with pytest.raises(WorkspaceError, match="revision_conflict"):
        act(registry, "sync", {"window": WINDOW}, connection["id"], connection["revision"])
    current = registry.detail(ORIGIN, connection["id"])["connection"]
    assert current["label"] == "Concurrent reviewed label"
    assert current["history"]["observations"] == 0 and current["history"]["cursor"] is None
    assert not registry.storage.workspace()["tables"]["journalTrades"]


@pytest.mark.parametrize("failure", ["identity", "stale"])
def test_wrong_or_stale_provider_response_degrades_health_and_keeps_finances(
    registry, monkeypatch, failure
):
    connection = linked(registry)
    original_fetch = connector_adapters.history

    def wrong_response(*args, **kwargs):
        result = original_fetch(*args, **kwargs)
        if failure == "identity":
            result["identity"]["externalId"] = "DIAGNOSTIC-OTHER"
        else:
            result["coverage"]["observedAt"] = "2020-01-01T00:00:00Z"
        return result

    monkeypatch.setattr(connector_adapters, "history", wrong_response)
    result = act(registry, "sync", {"window": WINDOW}, connection["id"])
    current = result["connection"]
    assert current["health"] == "degraded" and current["requiresVerification"] is True
    assert current["history"]["observations"] == 0 and current["history"]["cursor"] is None
    assert not any(value["supported"] for value in current["capabilities"])
    assert not result["workspace"]["tables"]["journalTrades"]


def test_expired_vault_material_does_not_retain_effective_capabilities_or_fetch(
    registry, monkeypatch
):
    connection = created(registry)
    future = (datetime.now(UTC) + timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    act(
        registry,
        "set-secret",
        {"secret": {"apiKey": "only-a-synthetic-value"}, "expiresAt": future},
        connection["id"],
    )
    act(registry, "probe", identity=connection["id"])
    past = (datetime.now(UTC) - timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
    with registry.storage.transaction() as database:
        database.execute(
            update(connector_secrets)
            .where(
                connector_secrets.c.uid == registry.storage.uid,
                connector_secrets.c.connection_id == connection["id"],
            )
            .values(expires_at=past)
        )
    current = registry.detail(ORIGIN, connection["id"])["connection"]
    assert current["credential"]["status"] == "expired"
    assert not any(value["supported"] for value in current["capabilities"])
    monkeypatch.setattr(
        connector_adapters,
        "probe",
        lambda *args, **kwargs: pytest.fail("Expired material cannot reach an adapter"),
    )
    with pytest.raises(WorkspaceError, match="credential_expired"):
        act(registry, "probe", identity=connection["id"])


def test_stale_state_cannot_keep_effective_capabilities_or_a_canonical_history_link_active(
    registry,
):
    connection = linked(registry)
    observed = datetime.fromisoformat(connection["observedAt"].replace("Z", "+00:00"))
    registry.clock = lambda: (observed + timedelta(seconds=121)).isoformat().replace("+00:00", "Z")
    public = registry.detail(ORIGIN, connection["id"])["connection"]
    assert public["health"] == "stale"
    assert not any(value["supported"] for value in public["capabilities"])
    with registry.storage.engine.connect() as database:
        saved = registry.records.load(database, ORIGIN, connection["id"])
    registry._canonical(saved)
    assert saved["source"]["health"] == "degraded"
    assert saved["accountSourceLink"]["state"] == "paused"
    assert saved["link"]["active"] is True
    with pytest.raises(WorkspaceError, match="verify_and_link"):
        act(registry, "sync", {"window": WINDOW}, connection["id"])


def test_restored_connection_requires_recheck_and_link_then_dedupes_its_original_history(registry):
    connection = linked(registry)
    original = act(registry, "sync", {"window": WINDOW}, connection["id"])
    raw = WorkspaceRecoveryService(registry.storage, registry.storage.uid).create_backup()
    other_storage = WorkspaceStorage(registry.storage.engine, "principal_independent_restored")
    other = Connectors(other_storage, vault_key="another-p07-synthetic-key-" + "b" * 32)
    recovery = WorkspaceRecoveryService(other_storage, other_storage.uid)
    review = recovery.preview_restore(raw, 0)
    recovery.commit_restore(
        review["jobId"], review["expectedRevision"], review["confirmationHash"], True
    )
    restored = other.detail(ORIGIN, connection["id"])["connection"]
    assert restored["requiresVerification"] and not restored["active"]
    assert restored["health"] == "unknown" and not any(
        value["supported"] for value in restored["capabilities"]
    )
    with pytest.raises(WorkspaceError, match="verify_and_link"):
        act(other, "sync", {"window": WINDOW}, connection["id"])
    act(other, "probe", identity=connection["id"])
    with pytest.raises(WorkspaceError, match="verify_and_link"):
        act(other, "sync", {"window": WINDOW}, connection["id"])
    act(
        other,
        "link",
        {"profileId": 1, "accountId": restored["accountId"], "confirmIdentity": True},
        connection["id"],
    )
    repeated = act(other, "sync", {"window": WINDOW}, connection["id"])
    assert repeated["connection"]["history"]["summary"]["duplicates"] == 2
    assert repeated["connection"]["history"]["summary"]["projected"] == 0
    assert len(repeated["workspace"]["tables"]["journalTrades"]) == 2
    assert (
        registry.storage.workspace()["tables"]["journalTrades"]
        == original["workspace"]["tables"]["journalTrades"]
    )
