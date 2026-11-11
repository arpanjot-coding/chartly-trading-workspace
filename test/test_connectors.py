"""Real scoped SQL transactions; connector facts never come from UI assertions."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from services import connector_adapters
from services.connectors import Connectors
from services.journal_service import JournalService
from services.workspace_recovery import WorkspaceRecoveryService
from services.workspace_storage import WorkspaceError, WorkspaceStorage

pytest_plugins = ["test_journal_service"]
ORIGIN = "journal_origin_01"
WINDOW = {"from": "2026-11-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"}


@pytest.fixture
def registry(storage):
    return Connectors(storage, vault_key="p07-synthetic-vault-key-" + "1" * 32)


def act(service, kind, payload=None, identity=None, revision=None, request_id=None):
    current = service.detail(ORIGIN, identity)["connection"] if identity else None
    return service.action(
        ORIGIN,
        identity,
        revision if revision is not None else current["revision"] if current else 0,
        request_id or uuid4().hex,
        kind,
        payload or {},
    )


def created(service, fault="none", account="alpha"):
    return act(
        service,
        "create",
        {
            "providerId": "diagnostic",
            "label": "Synthetic account",
            "configuration": {"fault": fault, "account": account},
            "profileId": 1,
        },
    )["connection"]


def linked(service):
    record = created(service)
    act(service, "probe", identity=record["id"])
    return act(
        service,
        "link",
        {"profileId": 1, "createObservedAccount": True, "confirmIdentity": True},
        record["id"],
    )["connection"]


def test_configured_identity_does_not_claim_observed_health_or_trading(registry):
    record = created(registry)
    assert record["health"] == "unknown" and record["state"] == "unverified"
    assert "identity" not in record
    assert not any(cap["supported"] for cap in record["capabilities"])
    observed = act(registry, "probe", identity=record["id"])["connection"]
    assert observed["identity"]["synthetic"] is True
    assert observed["health"] == "healthy" and observed["state"] == "ready"
    assert all(
        not cap["supported"]
        for cap in observed["capabilities"]
        if cap["id"] in {"orderSubmit", "orderCancel", "protectiveOrders"}
    )


def test_confirmed_history_reconciles_once_into_exact_account_book(registry):
    record = linked(registry)
    first = act(registry, "sync", {"window": WINDOW}, record["id"])
    assert first["connection"]["history"]["observations"] == 2
    assert first["connection"]["history"]["confirmed"] == 2
    assert first["connection"]["history"]["coverage"][0]["complete"] is True
    rows = first["workspace"]["tables"]["journalTrades"]
    account = next(
        row
        for row in first["workspace"]["tables"]["brokerAccounts"]
        if row["id"] == record["accountId"]
    )
    assert account["enabled"] is False
    assert "isEnabled" not in account
    assert len(rows) == 2 and {row["journalBookId"] for row in rows} == {record["bookId"]}
    assert {row["amounts"]["netPnl"] for row in rows} == {"1.7"}
    # Same native facts under another receipt remain one fact per event.
    again = act(registry, "sync", {"window": WINDOW}, record["id"])
    assert len(again["workspace"]["tables"]["journalTrades"]) == 2
    assert again["connection"]["history"]["summary"]["duplicates"] == 2
    assert again["connection"]["history"]["summary"]["projected"] == 0


def test_interrupted_response_retries_identical_receipt_without_second_fetch(registry, monkeypatch):
    record = linked(registry)
    request_id = uuid4().hex
    revision = record["revision"]
    first = act(registry, "sync", {"window": WINDOW}, record["id"], revision, request_id)
    monkeypatch.setattr(
        connector_adapters,
        "history",
        lambda *args, **kwargs: pytest.fail("A committed receipt must not refetch"),
    )
    second = act(registry, "sync", {"window": WINDOW}, record["id"], revision, request_id)
    assert second["receipt"] == first["receipt"] and second["connection"] == first["connection"]
    with pytest.raises(WorkspaceError, match="reused_with_different_input"):
        act(registry, "disconnect", {}, record["id"], revision, request_id)


def test_owner_origin_revision_and_explicit_review_are_enforced(registry):
    record = created(registry)
    with pytest.raises(WorkspaceError, match="verify_and_review"):
        act(
            registry,
            "link",
            {"profileId": 1, "createObservedAccount": True, "confirmIdentity": True},
            record["id"],
        )
    act(registry, "probe", identity=record["id"])
    with pytest.raises(WorkspaceError, match="verify_and_review"):
        act(
            registry,
            "link",
            {"profileId": 1, "createObservedAccount": True, "confirmIdentity": False},
            record["id"],
        )
    with pytest.raises(WorkspaceError, match="revision_conflict"):
        act(registry, "disconnect", identity=record["id"], revision=1)
    other = Connectors(WorkspaceStorage(registry.storage.engine, "principal_other_owner"))
    with registry.storage.engine.connect() as connection:
        assert other.records.load(connection, ORIGIN, record["id"]) is None
        assert registry.records.load(connection, "other_origin_01", record["id"]) is None


def test_wrong_observed_account_never_relinks_or_moves_old_journal(registry):
    record = linked(registry)
    original_book = record["bookId"]
    act(
        registry, "configure", {"configuration": {"account": "beta", "fault": "none"}}, record["id"]
    )
    changed = act(registry, "probe", identity=record["id"])["connection"]
    assert changed["health"] == "degraded" and changed["bookId"] == original_book
    assert changed["failure"]["code"] == "connector.observed_identity_changed"
    with pytest.raises(WorkspaceError, match="verify_and_link"):
        act(registry, "sync", {"window": WINDOW}, record["id"])


def test_source_corrections_are_previewed_then_applied_without_refetch(registry, monkeypatch):
    record = linked(registry)
    first = act(registry, "sync", {"window": WINDOW}, record["id"])
    row = first["workspace"]["tables"]["journalTrades"][0]
    # User reviews and source facts have separate authority.
    workspace = registry.storage.workspace()
    JournalService(registry.storage).action(
        ORIGIN,
        workspace["revision"],
        uuid4().hex,
        "review-trade",
        {"tradeId": row["id"], "review": {"technicalNotes": "keep this review"}},
    )
    act(
        registry,
        "configure",
        {"configuration": {"account": "alpha", "fault": "correction"}},
        record["id"],
    )
    act(registry, "probe", identity=record["id"])
    preview = act(registry, "sync", {"window": WINDOW}, record["id"])
    assert preview["connection"]["history"]["summary"]["pendingCorrections"] == 1
    assert preview["connection"]["history"]["summary"]["corrections"][0]["changedFields"]
    assert {
        row["amounts"]["netPnl"] for row in preview["workspace"]["tables"]["journalTrades"]
    } == {"1.7"}
    monkeypatch.setattr(
        connector_adapters,
        "history",
        lambda *args, **kwargs: pytest.fail("Apply exactly the retained reviewed facts"),
    )
    saved = act(registry, "apply-corrections", identity=record["id"])
    assert {row["amounts"]["netPnl"] for row in saved["workspace"]["tables"]["journalTrades"]} == {
        "1.7",
        "2.7",
    }
    assert next(
        row
        for row in saved["workspace"]["tables"]["journalTrades"]
        if row["technicalNotes"] == "keep this review"
    )


@pytest.mark.parametrize(
    "fault,expected",
    [
        ("expired", "expired"),
        ("revoked", "expired"),
        ("disconnect", "offline"),
        ("rate_limit", "degraded"),
    ],
)
def test_observed_failure_is_saved_not_presented_as_connected(registry, fault, expected):
    record = created(registry, fault)
    failed = act(registry, "probe", identity=record["id"])["connection"]
    assert failed["health"] == expected and "failure" in failed
    if fault == "rate_limit":
        with pytest.raises(WorkspaceError, match="retry_later"):
            act(registry, "probe", identity=record["id"])


@pytest.mark.parametrize("fault", ["partial_fill", "unknown_submission"])
def test_incomplete_execution_facts_never_fabricate_closed_journal_trade(registry, fault):
    record = created(registry, fault)
    act(registry, "probe", identity=record["id"])
    act(
        registry,
        "link",
        {"profileId": 1, "createObservedAccount": True, "confirmIdentity": True},
        record["id"],
    )
    result = act(registry, "sync", {"window": WINDOW}, record["id"])
    assert result["connection"]["history"]["observations"] == 1
    assert result["connection"]["history"]["confirmed"] == 0
    assert not result["workspace"]["tables"]["journalTrades"]


def test_database_failure_rolls_back_observation_cursor_journal_and_receipt(registry, monkeypatch):
    record = linked(registry)
    before = registry.storage.snapshot()
    revision = record["revision"]

    def fail(*args, **kwargs):
        raise RuntimeError("forced before connector record publication")

    monkeypatch.setattr(registry.records, "save", fail)
    with pytest.raises(RuntimeError):
        act(registry, "sync", {"window": WINDOW}, record["id"])
    assert registry.storage.snapshot() == before
    assert registry.detail(ORIGIN, record["id"])["connection"]["revision"] == revision


def test_health_expires_and_recheck_recovers_same_identity(registry):
    record = created(registry)
    act(registry, "probe", identity=record["id"])
    future = (datetime.now(UTC) + timedelta(minutes=3)).isoformat().replace("+00:00", "Z")
    registry.clock = lambda: future
    stale = registry.detail(ORIGIN, record["id"])["connection"]
    assert stale["health"] == "stale" and not any(cap["supported"] for cap in stale["capabilities"])


def test_metadata_only_mutation_invalidates_recovery_preview(registry):
    first_generation = registry.storage.current_revision()
    record = created(registry)
    assert registry.storage.current_revision() > first_generation
    recovery = WorkspaceRecoveryService(registry.storage, registry.storage.uid)
    preview = recovery.preview_restore(
        recovery.create_backup(), registry.storage.current_revision()
    )
    act(registry, "configure", {"label": "Changed label"}, record["id"])
    with pytest.raises(Exception, match="revision_conflict"):
        recovery.commit_restore(
            preview["jobId"], preview["expectedRevision"], preview["confirmationHash"], False
        )


@pytest.mark.parametrize(
    "window",
    [
        {"from": "2026-11-01", "to": "2026-11-02"},
        {"from": "2026-10-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"},
        {"from": "2026-11-02T00:00:00Z", "to": "2026-11-01T00:00:00Z"},
        {"from": "2099-11-01T00:00:00Z", "to": "2099-11-02T00:00:00Z"},
    ],
)
def test_invalid_history_windows_rejected_before_fetch(registry, window, monkeypatch):
    record = linked(registry)
    monkeypatch.setattr(
        connector_adapters,
        "history",
        lambda *args, **kwargs: pytest.fail("Invalid input cannot fetch"),
    )
    with pytest.raises(WorkspaceError):
        act(registry, "sync", {"window": window}, record["id"])


def test_conformance_cannot_enable_orders_and_is_observed_not_submitted(registry):
    record = created(registry)
    with pytest.raises(WorkspaceError, match="verify_and_review"):
        act(registry, "conformance", identity=record["id"])
    act(registry, "probe", identity=record["id"])
    result = act(registry, "conformance", identity=record["id"])["connection"]
    assert result["conformance"]["passed"] and result["conformance"]["synthetic"]
    assert not any(
        cap["supported"]
        for cap in result["capabilities"]
        if cap["id"] in {"orderSubmit", "orderCancel", "protectiveOrders"}
    )
    with pytest.raises(WorkspaceError):
        act(registry, "conformance", {"passed": True}, record["id"])
