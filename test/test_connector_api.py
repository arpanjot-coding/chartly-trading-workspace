"""Real local proof/CSRF/worker boundaries and secret writes outside temp workers."""

from uuid import uuid4

import pytest
from test_journal_api import setup
from test_local_data_api import csrf, login

from blueprints.connectors import connectors_bp

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/connectors"


@pytest.fixture
def app(api, monkeypatch):
    monkeypatch.setenv("APP_KEY", "p07-private-api-fixture-key-" + "8" * 32)
    api.register_blueprint(connectors_bp)
    return api


def action(client, origin, name, payload, connection=None):
    body = {
        "originId": origin,
        "expectedRevision": connection["revision"] if connection else 0,
        "requestId": uuid4().hex,
        "action": name,
        "payload": payload,
    }
    if connection:
        body["connectionId"] = connection["id"]
    return client.post(BASE + "/action", json=body, headers=csrf(client)), body


def test_private_setup_probe_link_sync_and_current_workspace_replay(app):
    with app.test_client() as client:
        catalog = client.get(BASE + "/providers")
        assert catalog.status_code == 200
        assert {row["category"] for row in catalog.json["providers"]} == {"brokerage", "crypto", "desktop", "diagnostic"}
        assert client.get(BASE).status_code == 401
        workspace = setup(client)
        origin = workspace["originId"]
        assert client.get(BASE + "/providers").status_code == 200
        result, _ = action(
            client,
            origin,
            "create",
            {
                "providerId": "diagnostic",
                "label": "HTTP synthetic",
                "configuration": {},
                "profileId": 1,
            },
        )
        assert result.status_code == 200, result.json
        record = result.json["connection"]
        assert (
            "no-store" in result.headers["Cache-Control"]
            and result.headers["X-Content-Type-Options"] == "nosniff"
        )
        result, _ = action(client, origin, "probe", {}, record)
        assert result.status_code == 200, result.json
        record = result.json["connection"]
        result, _ = action(
            client,
            origin,
            "link",
            {"profileId": 1, "createObservedAccount": True, "confirmIdentity": True},
            record,
        )
        assert result.status_code == 200, result.json
        record = result.json["connection"]
        result, body = action(
            client,
            origin,
            "sync",
            {"window": {"from": "2026-11-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"}},
            record,
        )
        assert result.status_code == 200, result.json
        assert len(result.json["workspace"]["tables"]["journalTrades"]) == 2
        duplicate = client.post(BASE + "/action", json=body, headers=csrf(client))
        assert (
            duplicate.status_code == 200 and duplicate.json["workspace"] == result.json["workspace"]
        )
        assert (
            client.get(BASE + f"/{record['id']}/history?originId={origin}&limit=1").json["history"][
                "total"
            ]
            == 2
        )


def test_strict_fields_csrf_size_and_secrets_not_queued_to_temp_worker(app, monkeypatch):
    with app.test_client() as client:
        origin = setup(client)["originId"]
        base_body = {
            "originId": origin,
            "expectedRevision": 0,
            "requestId": uuid4().hex,
            "action": "create",
            "payload": {"providerId": "diagnostic", "label": "Secret API", "configuration": {}},
        }
        assert client.post(BASE + "/action", json=base_body).status_code == 400
        assert (
            client.post(
                BASE + "/action", json={**base_body, "ownerId": "foreign"}, headers=csrf(client)
            ).status_code
            == 400
        )
        assert (
            client.post(
                BASE + "/action",
                data='{"action":"create","action":"probe"}',
                content_type="application/json",
                headers=csrf(client),
            ).status_code
            == 400
        )
        record = client.post(BASE + "/action", json=base_body, headers=csrf(client)).json[
            "connection"
        ]
        import blueprints.connectors as blueprint

        def forbidden(*args, **kwargs):
            pytest.fail("No plaintext credential can enter the temporary request worker")

        monkeypatch.setattr(blueprint, "_run", forbidden)
        response, _ = action(
            client,
            origin,
            "set-secret",
            {"secret": {"apiKey": "p07-secret-http-synthetic"}},
            record,
        )
        assert response.status_code == 200, response.json
        assert "p07-secret-http-synthetic" not in response.get_data(as_text=True)
        secret_elsewhere = {
            **base_body,
            "payload": {**base_body["payload"], "configuration": {"apiKey": "must-not-be-queued"}},
        }
        assert (
            client.post(BASE + "/action", json=secret_elsewhere, headers=csrf(client)).status_code
            == 400
        )
        large = {**base_body, "payload": {"x": "x" * (70 * 1024)}}
        assert client.post(BASE + "/action", json=large, headers=csrf(client)).status_code == 413


def test_another_owner_cannot_read_or_mutate_private_connection(app):
    owner, other = app.test_client(), app.test_client()
    origin = setup(owner)["originId"]
    result, _ = action(
        owner,
        origin,
        "create",
        {"providerId": "diagnostic", "label": "Private", "configuration": {}},
    )
    record = result.json["connection"]
    login(other, "other")
    assert other.get(BASE + f"/{record['id']}?originId={origin}").status_code in (404, 409)
    response, _ = action(other, origin, "probe", {}, record)
    assert response.status_code in (404, 409)


def test_native_terminal_requires_verified_local_operator_before_attachment(app, monkeypatch):
    with app.test_client() as client:
        origin = setup(client)["originId"]
        login(client, "other")
        import blueprints.connectors as blueprint

        monkeypatch.setattr(
            blueprint,
            "_run",
            lambda *args, **kwargs: pytest.fail(
                "Nonoperator must not attach shared native terminal"
            ),
        )
        response, _ = action(
            client, origin, "create", {"providerId": "mt5", "label": "Native", "configuration": {}}
        )
        assert response.status_code == 403


def test_explicit_principal_precondition_prevents_delayed_save_under_new_cookie(app, monkeypatch):
    with app.test_client() as client:
        origin = setup(client)["originId"]
        owner_id = client.get("/api/local/v1/context").json["principalId"]
        login(client, "other")
        import blueprints.connectors as blueprint

        monkeypatch.setattr(
            blueprint,
            "_run",
            lambda *args, **kwargs: pytest.fail("A stale owner cannot reach a mutation worker"),
        )
        headers = {**csrf(client), "X-Chartly-Principal": owner_id}
        response = client.post(
            BASE + "/action",
            json={
                "originId": origin,
                "expectedRevision": 0,
                "requestId": uuid4().hex,
                "action": "create",
                "payload": {
                    "providerId": "diagnostic",
                    "label": "Old owner's form",
                    "configuration": {},
                },
            },
            headers=headers,
        )
        assert (
            response.status_code == 403
            and response.json["error"]["code"] == "account.scope_changed"
        )
        # An old tab must not receive the new cookie owner's private read results,
        # even if its local authentication store has not heard about the switch.
        for path in (
            "/providers",
            f"?originId={origin}",
            f"/old_connection?originId={origin}",
            f"/old_connection/history?originId={origin}",
        ):
            read = client.get(BASE + path, headers={"X-Chartly-Principal": owner_id})
            assert read.status_code == 403
            assert read.json["error"]["code"] == "account.scope_changed"
            assert read.headers["Cache-Control"] == "private, no-store"
