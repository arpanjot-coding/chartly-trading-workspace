"""Historical intents cannot be dispatched to any broker by declared ingress."""

import pytest
from flask import Flask

from utils.paper_intent_guard import historical_intent, reject_historical_broker_intent


@pytest.mark.parametrize(
    "marker",
    [
        {"mode": "paper_replay"},
        {"executionMode": "historical"},
        {"profileKind": "replay"},
        {"runId": 1},
        {"paperRunId": 1},
        {"datasetVersionId": "version_fixture"},
        {"source": {"kind": "dataset"}},
    ],
)
def test_historical_ingress_is_denied_before_dispatch(marker):
    app = Flask(__name__)
    reached = []
    app.before_request(reject_historical_broker_intent)
    app.add_url_rule(
        "/broker-order", "dispatch", lambda: reached.append(True) or {"ok": True}, methods=["POST"]
    )
    with app.test_client() as client:
        response = client.post(
            "/broker-order", json={"symbol": "EXAMPLE", "quantity": "1", **marker}
        )
        assert response.status_code == 403 and reached == []
        assert response.json["code"] == "paper.broker_route_denied"


def test_normal_legacy_order_body_preserves_existing_path_and_live_schema():
    assert not historical_intent(
        {"symbol": "EXAMPLE", "action": "BUY", "quantity": "1", "mode": "analyze"}
    )
    assert not historical_intent(None) and not historical_intent([])


def test_direct_place_order_historical_data_never_reads_broker_auth(monkeypatch):
    import restx_api  # noqa: F401 — initialize the existing namespace/service import graph
    from services import place_order_service as module

    monkeypatch.setattr(
        module, "get_auth_token_broker", lambda *a, **k: pytest.fail("Broker auth read")
    )
    monkeypatch.setattr(
        module, "import_broker_module", lambda *a, **k: pytest.fail("Broker import")
    )
    success, body, status = module.place_order(
        {"mode": "paper_replay", "symbol": "EXAMPLE"}, api_key="fixture-only"
    )
    assert not success and status == 403 and body["code"] == "paper.broker_route_denied"
