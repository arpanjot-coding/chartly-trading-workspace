"""Actual authenticated local HTTP, CSRF and bounded worker paper journey."""

from copy import deepcopy
from uuid import uuid4

import pytest
from test_data_library import context, mapping
from test_journal_api import setup
from test_local_data_api import csrf, login
from test_paper_sessions import config

from blueprints.data_library import data_library_bp
from blueprints.paper import paper_bp

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/paper"


@pytest.fixture
def app(api):
    api.register_blueprint(data_library_bp)
    api.register_blueprint(paper_bp)
    return api


def prepare_fixture(client):
    workspace = setup(client)
    csv = "timestamp,open,high,low,close,volume\n2026-11-02T09:00:00Z,100,102,98,101,10\n2026-11-02T09:01:00Z,110,112,108,111,10\n2026-11-02T09:02:00Z,120,122,118,121,10"
    base = "/api/local/v1/datasets"
    staged = client.post(
        base + "/imports/preview",
        json={
            "expectedRevision": client.get(base).json["revision"],
            "csvText": csv,
            "mapping": mapping(),
            "context": context(),
        },
        headers=csrf(client),
    )
    assert staged.status_code == 200, staged.json
    job = staged.json
    saved = client.post(
        base + f"/imports/{job['id']}/commit",
        json={
            "expectedRevision": job["expectedRevision"],
            "requestId": uuid4().hex,
            "policy": "keep",
            "allowRejectedRows": False,
        },
        headers=csrf(client),
    )
    assert saved.status_code == 200, saved.json
    version = saved.json["version"]
    tables = workspace["tables"]
    tables["practiceSessions"] = [
        {
            "id": 1,
            "portfolioId": 1,
            "name": "HTTP paper",
            "mode": "Replay",
            "market": "Stocks",
            "symbol": "EXAMPLE",
            "timeframe": "1m",
            "currency": "USD",
            "startingBalance": 1000,
            "status": "Draft",
            "rangeStart": "2026-11-02",
            "rangeEnd": "2026-11-02",
            "datasetVersionId": version["id"],
            "datasetChecksum": version["checksum"],
            "createdAt": "2026-11-03T00:00:00Z",
            "updatedAt": "2026-11-03T00:00:00Z",
        }
    ]
    saved = client.put(
        "/api/local/v1/workspace?originId=" + workspace["originId"],
        json={
            "tables": tables,
            "expectedRevision": workspace["revision"],
            "requestId": uuid4().hex,
        },
        headers=csrf(client),
    )
    assert saved.status_code == 200, saved.json
    return workspace["originId"]


def action(client, origin, kind, payload=None, revision=None, request_id=None):
    current = client.get(BASE + f"/session?originId={origin}&runId=1").json["session"]
    body = {
        "originId": origin,
        "runId": 1,
        "requestId": request_id or "cmd_" + uuid4().hex,
        "expectedRevision": (current["revision"] if current else 0)
        if revision is None
        else revision,
        "action": kind,
        "payload": payload or {},
    }
    return client.post(BASE + "/action", json=body, headers=csrf(client)), body


def test_private_auth_csrf_strict_commands_and_no_cache(app):
    with app.test_client() as client:
        assert client.get(BASE + "/session?originId=browser_origin_one&runId=1").status_code == 401
        origin = prepare_fixture(client)
        body = {
            "originId": origin,
            "runId": 1,
            "requestId": uuid4().hex,
            "expectedRevision": 0,
            "action": "prepare",
            "payload": config(),
        }
        assert client.post(BASE + "/action", json=body).status_code == 400
        assert (
            client.post(
                BASE + "/action", json={**body, "ownerId": "other"}, headers=csrf(client)
            ).status_code
            == 400
        )
        assert (
            client.get(BASE + f"/session?originId={origin}&runId=1&ownerId=other").status_code
            == 400
        )
        assert (
            client.post(BASE + "/action?broker=live", json=body, headers=csrf(client)).status_code
            == 400
        )
        response = client.post(BASE + "/action", json=body, headers=csrf(client))
        assert response.status_code == 200, response.json
        assert (
            response.headers["Cache-Control"] == "no-store"
            and response.headers["X-Content-Type-Options"] == "nosniff"
        )
        retry = client.post(BASE + "/action", json=body, headers=csrf(client))
        assert retry.status_code == 200 and retry.json == response.json


def test_actual_worker_fills_resume_report_and_other_owner_denial(app):
    with app.test_client() as client:
        origin = prepare_fixture(client)
        response, _ = action(client, origin, "prepare", config())
        assert response.status_code == 200, response.json
        response, _ = action(client, origin, "start")
        assert response.status_code == 200, response.json
        response, _ = action(
            client, origin, "order", {"side": "buy", "orderType": "market", "quantity": "2"}
        )
        assert response.status_code == 200 and response.json["session"]["fills"] == []
        response, body = action(client, origin, "advance", {"count": 1})
        assert response.status_code == 200, response.json
        assert response.json["session"]["fills"][0]["price"] == "100"
        retry = client.post(BASE + "/action", json=body, headers=csrf(client))
        assert retry.json == response.json
        stale = deepcopy(body)
        stale["requestId"] = uuid4().hex
        assert client.post(BASE + "/action", json=stale, headers=csrf(client)).status_code == 409
        report = client.get(BASE + f"/report?originId={origin}&runId=1")
        assert report.status_code == 200 and report.json["report"]["checkpoint"]["stateChecksum"]
        ledger = client.get(BASE + f"/ledger?originId={origin}&runId=1&limit=1")
        assert ledger.status_code == 200 and len(ledger.json["entries"]) == 1
        login(client, "other")
        assert client.get(BASE + f"/session?originId={origin}&runId=1").status_code == 404
        assert client.post(BASE + "/action", json=body, headers=csrf(client)).status_code == 404


def test_paper_payload_budget_and_numeric_query_do_not_enter_engine(app):
    with app.test_client() as client:
        origin = prepare_fixture(client)
        assert client.get(BASE + f"/session?originId={origin}&runId=1.0").status_code == 400
        assert client.get(BASE + f"/ledger?originId={origin}&runId=1&limit=501").status_code == 400
        assert (
            client.post(
                BASE + "/action",
                data=b"x" * (128 * 1024 + 1),
                content_type="application/json",
                headers=csrf(client),
            ).status_code
            == 413
        )
