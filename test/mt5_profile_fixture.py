"""Create a linked MT5 profile through the actual workspace and connector services."""

from types import SimpleNamespace
from uuid import uuid4

from test_local_data_api import snapshot

from services import connector_adapters
from services.connector_mt5 import normalize_mt5_configuration
from services.connectors import Connectors
from services.workspace_storage import now


def linked_profile(storage, identity, *, history=False):
    source = snapshot()
    source["tables"]["journalTrades"] = []
    source["tables"]["portfolios"][0].update(kind="live", currency=identity["currency"])
    migration = storage.preview_migration(source)
    resolutions = {issue["id"]: issue["choices"][0] for issue in migration["issues"]}
    origin = storage.commit_migration(migration["id"], resolutions, uuid4().hex)["originId"]
    provider = {**connector_adapters.describe_provider("mt5"), "available": True}
    adapters = SimpleNamespace(
        describe_provider=lambda _: provider,
        normalize_configuration=lambda _, config: normalize_mt5_configuration(config),
        probe=lambda *_: {
            "identity": identity,
            "adapterVersion": provider["version"],
            "observedAt": now(),
            "permissions": ["accountRead", "accountHistory"] if history else ["accountRead"],
        },
    )
    service = Connectors(storage, adapters=adapters)
    record = service.action(
        origin,
        None,
        0,
        uuid4().hex,
        "create",
        {"providerId": "mt5", "label": "Fixture", "configuration": {}},
    )["connection"]
    record = service.action(origin, record["id"], record["revision"], uuid4().hex, "probe", {})[
        "connection"
    ]
    record = service.action(
        origin,
        record["id"],
        record["revision"],
        uuid4().hex,
        "link",
        {"profileId": 1, "confirmIdentity": True, "createObservedAccount": True},
    )["connection"]
    return origin, record
