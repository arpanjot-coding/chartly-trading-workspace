"""Flow owner and delivery contracts through Flask with isolated SQLite and stubbed dispatch."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from flask import Flask, request
from sqlalchemy.orm import scoped_session, sessionmaker

from blueprints import flow
from database import flow_db
from database.engine_factory import create_db_engine
from services import local_account_access
from services.local_account_access import LocalPrincipal

OWNER = "principal_" + "a" * 32
OTHER = "principal_" + "b" * 32
SECRET = "fixture-secret"


@pytest.fixture
def flow_app(monkeypatch, tmp_path):
    engine = create_db_engine(f"sqlite:///{(tmp_path / 'flow.db').as_posix()}")
    sessions = scoped_session(sessionmaker(bind=engine))
    monkeypatch.setattr(flow_db, "engine", engine)
    monkeypatch.setattr(flow_db, "db_session", sessions)
    monkeypatch.setattr(flow_db.FlowWorkflow, "query", sessions.query_property(), raising=False)
    monkeypatch.setattr(
        flow_db.FlowWorkflowExecution, "query", sessions.query_property(), raising=False
    )
    flow_db.clear_workflow_cache()
    flow_db.init_db()
    app = Flask(__name__)
    app.config.update(TESTING=True, RATELIMIT_ENABLED=False)
    app.register_blueprint(flow.flow_bp)
    app.teardown_appcontext(lambda _error: sessions.remove())

    def principal():
        owner = request.headers.get("X-Fixture-Account")
        return LocalPrincipal(owner, "Fixture", personal=True) if owner in (OWNER, OTHER) else None

    monkeypatch.setattr(local_account_access, "current_local_principal", principal)
    yield app
    sessions.remove()
    flow_db.clear_workflow_cache()
    engine.dispose()


def _webhook_workflow():
    row = flow_db.create_workflow("Webhook fixture", owner_uid=OWNER)
    row.is_active = True
    row.webhook_enabled = True
    row.webhook_secret = SECRET
    flow_db.db_session.commit()
    result = row.id, f"/flow/webhook/{row.webhook_token}"
    flow_db.db_session.remove()
    return result


def test_workflow_records_and_credentials_are_scoped_to_the_verified_owner(flow_app):
    client = flow_app.test_client()
    owner = {"X-Fixture-Account": OWNER}
    other = {"X-Fixture-Account": OTHER}
    base = "/flow/api/workflows"
    created = client.post(base, json={"name": "Owned workflow"}, headers=owner)
    assert created.status_code == 201
    assert "webhook_secret" not in created.json and "webhook_token" not in created.json
    url = f"{base}/{created.json['id']}"
    assert client.get(base, headers=other).json == []
    assert client.get(url).status_code == 401
    assert client.get(url, headers={**owner, "X-Chartly-Principal": OTHER}).status_code == 403
    assert client.get(url, headers={**owner, "Origin": "https://other.example"}).status_code == 403
    for method, suffix in (
        ("GET", ""),
        ("GET", "/webhook"),
        ("GET", "/executions"),
        ("GET", "/export"),
        ("POST", "/execute"),
        ("POST", "/activate"),
        ("POST", "/webhook/regenerate"),
        ("POST", "/replace"),
        ("PUT", ""),
        ("DELETE", ""),
    ):
        assert client.open(url + suffix, method=method, headers=other).status_code == 404
    assert "webhook_secret" not in client.get(url, headers=owner).json
    changed = client.put(url, json={"name": "Renamed"}, headers=owner)
    assert changed.status_code == 200
    assert "webhook_secret" not in changed.json and "webhook_token" not in changed.json
    reveal = client.get(url + "/webhook", headers=owner)
    assert reveal.status_code == 200 and reveal.json["webhook_secret"]
    assert reveal.headers["Cache-Control"] == "private, no-store"


def test_legacy_workflow_is_preserved_and_explicit_adoption_rotates_credentials(
    flow_app, monkeypatch
):
    from database import user_db
    from scripts import flow_ownership

    row = flow_db.create_workflow("Old graph", nodes=[{"id": "old"}])
    row.is_active = True
    row.webhook_enabled = True
    flow_db.db_session.commit()
    old_id, old_token = row.id, row.webhook_token
    flow_db.db_session.remove()
    with flow_db.engine.begin() as connection:
        connection.exec_driver_sql("DROP INDEX ix_flow_workflows_owner_uid")
        connection.exec_driver_sql("ALTER TABLE flow_workflows DROP COLUMN owner_uid")
    monkeypatch.setattr(flow_ownership, "load_dotenv", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(user_db, "engine", flow_db.engine)
    user_db.User.__table__.create(flow_db.engine)
    with flow_db.engine.begin() as connection:
        connection.execute(
            user_db.User.__table__.insert().values(
                identity_uid=OWNER,
                username="fixture-owner",
                email="owner@example.invalid",
                password_hash="fixture",
                totp_secret="fixture",
            )
        )
    maintenance_app = flow_ownership.create_app()
    assert not list(maintenance_app.url_map.iter_rules())
    cli = maintenance_app.test_cli_runner()
    listed = cli.invoke(args=["flow", "list-legacy"])
    assert listed.exit_code == 0 and f"{old_id}\t'Old graph'" in listed.output
    client = flow_app.test_client()
    owner = {"X-Fixture-Account": OWNER}
    url = f"/flow/api/workflows/{old_id}"
    assert client.get(url, headers=owner).status_code == 404
    assert client.post("/flow/webhook/" + old_token).status_code == 404
    refused = cli.invoke(args=["flow", "adopt", str(old_id), OTHER])
    assert refused.exit_code != 0 and "Local account not found" in refused.output
    accepted = cli.invoke(args=["flow", "adopt", str(old_id), OWNER])
    assert accepted.exit_code == 0, accepted.output
    assert not flow_db.adopt_workflow(old_id, OTHER)
    adopted = client.get(url, headers=owner).json
    assert adopted["nodes"] == [{"id": "old"}]
    assert not adopted["is_active"] and not adopted["webhook_enabled"]
    assert client.get(url + "/webhook", headers=owner).json["webhook_token"] != old_token


def test_worker_rejects_a_key_from_a_different_owner(flow_app, monkeypatch):
    from database import auth_db
    from services import flow_executor_service

    row = flow_db.create_workflow("Owner check", owner_uid=OWNER)
    monkeypatch.setattr(auth_db, "verify_api_key", lambda _key: "another-user")
    monkeypatch.setattr(flow_db, "flow_owner_for_username", lambda _name: OTHER)

    def unexpected_execution(*_args, **_kwargs):
        pytest.fail("A mismatched key reached execution")

    monkeypatch.setattr(flow_executor_service, "create_execution", unexpected_execution)
    result = flow_executor_service.execute_workflow(row.id, api_key="fixture-key")
    assert result["status"] == "error"
    assert "owner" in result["message"]


def test_delivery_claim_returns_pending_then_original_receipt_and_refuses_conflicts(
    flow_app, monkeypatch
):
    workflow_id, url = _webhook_workflow()
    started, release = Event(), Event()
    calls = []
    monkeypatch.setattr(flow, "_execution_blocked", lambda _workflow: None)

    def dispatch(workflow, **_kwargs):
        calls.append(workflow.id)
        started.set()
        assert release.wait(8)
        return {"status": "success", "execution_id": 501}

    monkeypatch.setattr(flow, "_run_or_start", dispatch)
    body = {"secret": SECRET, "event_id": "fixture-001", "message": "approved input"}

    def deliver(payload):
        return flow_app.test_client().post(url, json=payload)

    with ThreadPoolExecutor(max_workers=1) as worker:
        original = worker.submit(deliver, body)
        try:
            assert started.wait(8)
            pending = deliver(body)
            assert pending.status_code == 202 and pending.json["status"] == "pending"
            assert deliver({**body, "message": "different input"}).status_code == 409
        finally:
            release.set()
        completed = original.result(timeout=8)
    assert completed.status_code == 200 and completed.json["execution_id"] == 501
    assert deliver(body).json == completed.json
    assert deliver({**body, "secret": []}).status_code == 401
    assert deliver({"secret": SECRET}).status_code == 400
    assert calls == [workflow_id]
