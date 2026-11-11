"""Persisted MT5 checkpoints, receipt replay, and origin changes during a read."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from mt5_profile_fixture import linked_profile
from test_connector_mt5 import SDK
from test_local_data_api import snapshot

from services import connector_adapters, connector_mt5
from services.connectors import Connectors
from services.workspace_storage import WorkspaceError, WorkspaceStorage

WINDOW = {"from": "2026-01-01T00:00:00Z", "to": "2026-01-03T00:00:00Z"}


@pytest.fixture
def linked(tmp_path, monkeypatch):
    database = f"sqlite:///{(tmp_path / 'sync.db').as_posix()}"
    storage = WorkspaceStorage(database, "fixture-owner")
    sdk = SDK()
    adapter = connector_mt5.MT5Adapter(sdk=sdk, terminal_checker=lambda _path: True)
    identity = connector_mt5._identity(sdk)
    origin, record = linked_profile(storage, identity, history=True)
    ticket = 2**53 + 101
    sdk.deals[0].ticket = ticket
    sdk.historical_orders = [
        SimpleNamespace(
            ticket=ticket,
            position_id=1003,
            position_by_id=0,
            type=0,
            state=2,
            reason=0,
            time_setup_msc=1793707200000,
            time_done_msc=1793707201000,
            time_expiration=0,
            volume_initial=0.02,
            volume_current=0.02,
            price_open=1.2,
            price_current=1.2,
            sl=0.0,
            tp=0.0,
            symbol="EURUSD",
        )
    ]
    monkeypatch.setattr(connector_adapters, "get_adapter", lambda _provider: adapter)
    yield storage, origin, record, sdk
    storage.engine.dispose()


def sync(service, origin, record, request_id=None, window=WINDOW):
    return service.action(
        origin,
        record["id"],
        record["revision"],
        request_id or uuid4().hex,
        "sync",
        {"window": window},
    )


def test_mt5_checkpoint_resumes_after_reopen_with_no_duplicate_projection(linked):
    storage, origin, record, sdk = linked
    request_id = uuid4().hex
    first = sync(Connectors(storage), origin, record, request_id)
    cursor = first["connection"]["history"]["cursor"]
    assert cursor["nativeCursor"]
    assert cursor["window"] == {
        key: value.replace("Z", ".000000Z") for key, value in WINDOW.items()
    }
    assert sdk.gets == 1

    resumed = Connectors(WorkspaceStorage(storage.engine, storage.uid))
    assert sync(resumed, origin, record, request_id)["receipt"] == first["receipt"]
    assert sdk.gets == 1
    second = sync(resumed, origin, first["connection"], window=cursor["window"])
    assert sdk.gets == 2
    assert not second["connection"]["history"]["cursor"]["nativeCursor"]
    history = resumed.history(origin, record["id"])["history"]
    ticket = str(sdk.deals[0].ticket)
    assert {row["event"]["externalEventId"] for row in history["observations"]} == {
        f"order:{ticket}",
        f"deal:{ticket}",
    }
    assert len(history["observations"]) == 2
    assert all(not coverage["complete"] for coverage in history["coverage"])
    assert not storage.workspace(origin)["tables"]["journalTrades"]
    assert sdk.opened == sdk.closed == 2


def test_switching_workspace_during_mt5_sync_refuses_to_publish(linked, monkeypatch):
    storage, origin, record, sdk = linked
    migration = storage.preview_migration(snapshot("browser_origin_other"))
    resolutions = {issue["id"]: issue["choices"][0] for issue in migration["issues"]}
    other = storage.commit_migration(migration["id"], resolutions, uuid4().hex)["originId"]
    storage.set_active(origin)
    original_read = sdk.history_deals_get

    def switch_during_read(*args):
        rows = original_read(*args)
        storage.set_active(other)
        return rows

    monkeypatch.setattr(sdk, "history_deals_get", switch_during_read)
    service = Connectors(storage)
    with pytest.raises(WorkspaceError, match="connector.observation_context_changed"):
        sync(service, origin, record)
    assert service.history(origin, record["id"])["history"]["total"] == 0
    with pytest.raises(WorkspaceError, match="connector.observation_context_changed"):
        sync(service, origin, record)
    assert sdk.opened == sdk.closed == 1
