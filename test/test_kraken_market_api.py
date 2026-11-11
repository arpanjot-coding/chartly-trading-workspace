"""Cookie/CSRF/owner-bound public source to ordinary immutable history API."""

import json
from uuid import uuid4

import pytest
from flask import g
from test_kraken_market import PAIRS, ROWS, Client, Response
from test_local_data_api import csrf, login

import blueprints.data_library as blueprint
from blueprints.local_data import _engine
from services.workspace_worker import _perform

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/datasets"


@pytest.fixture
def web(api, monkeypatch):
    api.register_blueprint(blueprint.data_library_bp)
    from services import dataset_provider
    from utils import httpx_client

    monkeypatch.setattr(dataset_provider, "capabilities", lambda _uid: {"available": False})
    calls = []

    class PublicClient:
        def stream(self, method, url, **kwargs):
            calls.append((method, url, kwargs))
            result = (
                PAIRS if url.endswith("/AssetPairs") else {"XXBTZUSD": ROWS, "last": ROWS[-1][0]}
            )
            return Response(content=json.dumps({"error": [], "result": result}).encode())

    monkeypatch.setattr(httpx_client, "get_httpx_client", PublicClient)
    # Keep the real allowlisted worker dispatcher and SQL/file services in process
    # so the injected public transport cannot escape into a subprocess/network.
    monkeypatch.setattr(
        blueprint,
        "_run",
        lambda action, arguments=None: _perform(
            _engine().url.render_as_string(hide_password=False),
            g.local_principal.uid,
            action,
            arguments or {},
            None,
        ),
    )
    yield api, calls


def test_public_market_preview_commit_retains_exact_closed_rows_without_broker_auth(web):
    api, calls = web
    with api.test_client() as client:
        assert client.get(BASE + "/sources/kraken/instruments").status_code == 401
        login(client)
        catalog = client.get(BASE).json
        owner = catalog["principalId"]
        headers = {**csrf(client), "X-Chartly-Principal": owner}
        found = client.get(BASE + "/sources/kraken/instruments?q=XBT&limit=5", headers=headers)
        assert found.status_code == 200 and found.json["instruments"][0]["id"] == "XXBTZUSD"
        body = {"expectedRevision": catalog["revision"], "pair": "XXBTZUSD", "interval": "1m"}
        assert client.post(BASE + "/sources/kraken/preview", json=body).status_code == 400
        result = client.post(BASE + "/sources/kraken/preview", json=body, headers=headers)
        assert result.status_code == 200, result.json
        preview = result.json
        assert preview["sourceObservation"]["excludedUnfinished"] == 1
        assert preview["preview"]["counts"]["accepted"] == 2
        committed = client.post(
            BASE + f"/imports/{preview['id']}/commit",
            headers=headers,
            json={
                "expectedRevision": preview["expectedRevision"],
                "requestId": uuid4().hex,
                "policy": "new-version",
                "allowRejectedRows": False,
            },
        )
        assert committed.status_code == 200, committed.json
        version = committed.json["version"]
        assert version["rowCount"] == 2 and version["metadata"]["provider"] == "kraken-public"
        candles = client.get(BASE + f"/versions/{version['id']}/bars", headers=headers)
        assert candles.json["bars"][0]["open"] == ROWS[0][1]
        assert candles.json["bars"][-1]["timestamp"] == ROWS[1][0]
        assert all(call[1].startswith("https://api.kraken.com/0/public/") for call in calls)
        before = len(calls)
        login(client, "other")
        assert client.get(BASE + f"/imports/{preview['id']}").status_code == 404
        denied = client.post(
            BASE + "/sources/kraken/preview",
            json=body,
            headers={**csrf(client), "X-Chartly-Principal": owner},
        )
        assert denied.status_code == 403 and denied.json["error"]["code"] == "account.scope_changed"
        assert len(calls) == before


def test_public_source_does_not_accept_urls_credentials_or_unbounded_queries(web):
    api, calls = web
    with api.test_client() as client:
        login(client)
        for query in ("limit=51", "q=" + "x" * 81, "url=https://outside.test"):
            assert client.get(BASE + "/sources/kraken/instruments?" + query).status_code == 400
        for extra in ({"url": "https://outside.test"}, {"secret": "private"}, {"ownerId": "other"}):
            response = client.post(
                BASE + "/sources/kraken/preview",
                headers=csrf(client),
                json={"expectedRevision": 0, "pair": "XXBTZUSD", "interval": "1m", **extra},
            )
            assert response.status_code == 400
        assert calls == []
