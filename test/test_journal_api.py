"""Real proof+CSRF+worker journal paths, isolated from installed data."""

import base64
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import select
from test_local_data_api import csrf, login, migrate, snapshot

from blueprints.journal import journal_bp

pytest_plugins = ["test_local_data_api"]
from database.workspace_storage_db import journal_records

BASE = "/api/local/v1/journal"


@pytest.fixture
def app(api):
    api.register_blueprint(journal_bp)
    return api


def setup(client):
    login(client)
    source = snapshot()
    source["tables"]["journalTrades"] = []
    source["tables"]["portfolios"][0].update(
        currency="USD",
        kind="live",
        startingBalance=1000,
        createdAt="2026-11-02T00:00:00Z",
        updatedAt="2026-11-02T00:00:00Z",
    )
    workspace, _, _ = migrate(client, source)
    return workspace


def create(client, workspace, **extra):
    trade = {
        "portfolioId": 1,
        "journalBookId": workspace["books"][0]["id"],
        "pair": "EXAMPLE",
        "direction": "Buy",
        "result": "Open",
        "openDate": "2026-11-02T09:00:00Z",
        "closeDate": "",
        "currency": "USD",
        "amounts": {"quantity": "10", "netPnl": None},
        **extra,
    }
    body = {
        "originId": workspace["originId"],
        "expectedRevision": workspace["revision"],
        "requestId": str(uuid4()),
        "action": "create-trade",
        "payload": {"trade": trade},
    }
    response = client.post(BASE + "/actions", json=body, headers=csrf(client))
    assert response.status_code == 200, response.json
    return response.json, body


def test_local_proof_and_csrf_are_required_and_body_owner_cannot_grant_access(app):
    with app.test_client() as client:
        assert client.get(BASE + "?originId=browser_origin_one").status_code == 401
        workspace = setup(client)
        body = {
            "originId": workspace["originId"],
            "expectedRevision": workspace["revision"],
            "requestId": str(uuid4()),
            "action": "create-trade",
            "payload": {},
            "ownerId": "other",
        }
        assert client.post(BASE + "/actions", json=body, headers=csrf(client)).status_code == 400
        del body["ownerId"]
        assert client.post(BASE + "/actions", json=body).status_code == 400
        assert client.get(BASE + "?originId=browser_origin_one&ownerId=other").status_code == 400


def test_worker_create_partial_close_review_history_and_exports(app):
    with app.test_client() as client:
        workspace = setup(client)
        created, body = create(client, workspace)
        trade = created["detail"]["trade"]
        id = trade["id"]
        workspace = created["workspace"]
        replay = client.post(BASE + "/actions", json=body, headers=csrf(client))
        assert replay.status_code == 200 and replay.json["result"]["tradeId"] == id
        stale = deepcopy(body)
        stale["requestId"] = str(uuid4())
        assert client.post(BASE + "/actions", json=stale, headers=csrf(client)).status_code == 409
        result = client.post(
            BASE + "/actions",
            json={
                "originId": workspace["originId"],
                "expectedRevision": workspace["revision"],
                "requestId": str(uuid4()),
                "action": "partial-close-trade",
                "payload": {
                    "tradeId": id,
                    "quantity": "4",
                    "closedAt": "2026-11-02T10:00:00Z",
                    "netPnl": "2.25",
                },
            },
            headers=csrf(client),
        )
        assert result.status_code == 200, result.json
        assert result.json["detail"]["trade"]["amounts"]["netPnl"] == "2.25"
        detail = client.get(BASE + f"/trades/{id}?originId={workspace['originId']}")
        assert detail.status_code == 200 and len(detail.json["history"]) == 2
        state = client.get(BASE + "?originId=" + workspace["originId"])
        assert state.status_code == 200 and len(state.json["ledger"]["history"]) == 2
        for format in ("json", "csv"):
            exported = client.get(
                BASE + "/export",
                query_string={
                    "originId": workspace["originId"],
                    "portfolioId": 1,
                    "bookId": trade["journalBookId"],
                    "format": format,
                },
            )
            assert exported.status_code == 200 and exported.headers["Cache-Control"] == "no-store"
            assert "2.25" in exported.get_data(as_text=True)


def test_attachment_upload_integrates_scoped_p02_asset_service(app):
    with app.test_client() as client:
        created, _ = create(client, setup(client))
        workspace = created["workspace"]
        id = created["detail"]["trade"]["id"]
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7mQAAAAASUVORK5CYII="
        )
        body = {
            "originId": workspace["originId"],
            "expectedRevision": workspace["revision"],
            "requestId": str(uuid4()),
            "tradeId": id,
            "mimeType": "image/png",
            "base64": base64.b64encode(png).decode(),
        }
        uploaded = client.post(BASE + "/attachments", json=body, headers=csrf(client))
        assert uploaded.status_code == 200, uploaded.json
        result = client.get(uploaded.json["result"]["url"])
        assert (
            result.status_code == 200
            and result.data == png
            and result.headers["X-Content-Type-Options"] == "nosniff"
        )
        body["requestId"] = str(uuid4())
        body["base64"] = base64.b64encode(b'<svg onload="bad()"/>').decode()
        invalid = client.post(BASE + "/attachments", json=body, headers=csrf(client))
        assert (
            invalid.status_code == 400
            and invalid.json["error"]["code"] == "journal.attachment_type_mismatch"
        )


def test_foreign_actor_cannot_reuse_origin_trade_or_private_import_job(app):
    with app.test_client() as owner:
        created, _ = create(owner, setup(owner))
        origin = created["workspace"]["originId"]
        id = created["detail"]["trade"]["id"]
    with app.test_client() as other:
        login(other, "other")
        assert other.get(BASE + "?originId=" + origin).status_code == 404
        assert other.get(BASE + f"/trades/{id}?originId={origin}").status_code == 404
        response = other.get(
            BASE + "/export",
            query_string={
                "originId": origin,
                "portfolioId": 1,
                "bookId": created["detail"]["trade"]["journalBookId"],
                "format": "json",
            },
        )
        assert response.status_code == 404


def test_invalid_json_financial_and_scope_errors_stay_structured(app):
    with app.test_client() as client:
        workspace = setup(client)
        body = {
            "originId": workspace["originId"],
            "expectedRevision": workspace["revision"],
            "requestId": str(uuid4()),
            "action": "create-trade",
            "payload": {
                "trade": {
                    "portfolioId": 1,
                    "pair": "X",
                    "direction": "Buy",
                    "result": "Open",
                    "openDate": "2026-11-02T09:00",
                }
            },
        }
        response = client.post(BASE + "/actions", json=body, headers=csrf(client))
        assert (
            response.status_code == 400
            and response.json["error"]["code"] == "journal.timestamp_offset_required"
        )
        assert "timezone" in response.json["error"]["message"]
        assert "workspaces.db" not in response.get_data(as_text=True)


def statement_mapping():
    fields = (
        "eventId",
        "eventType",
        "positionId",
        "openedAt",
        "closedAt",
        "symbol",
        "side",
        "quantity",
        "netPnl",
        "commission",
        "currency",
        "strategy",
    )
    return {
        "version": 1,
        "name": "API statement fixture",
        "columns": {field: field for field in fields},
        "timezone": "UTC",
        "currency": "USD",
        "quantityUnit": "units",
    }


def statement_text(net="12.34", commission="0"):
    return (
        ",".join(statement_mapping()["columns"]) + "\n"
        f"fill-1,trade,position-1,2026-11-02T09:00:00Z,"
        f"2026-11-02T10:00:00Z,EXAMPLE,Buy,2,{net},{commission},USD,Opening range\n"
    )


def preview_statement(client, workspace, *, net="12.34", commission="0", provider="fixture-csv"):
    response = client.post(
        BASE + "/imports/preview",
        json={
            "originId": workspace["originId"],
            "portfolioId": 1,
            "bookId": next(book["id"] for book in workspace["books"] if book["kind"] == "manual"),
            "provider": provider,
            "csvText": statement_text(net, commission),
            "mapping": statement_mapping(),
            "expectedRevision": workspace["revision"],
        },
        headers=csrf(client),
    )
    assert response.status_code == 200, response.json
    return response.json


def commit_statement(client, preview, *, accept=False, request_id=None):
    return client.post(
        BASE + f"/imports/{preview['id']}/commit",
        json={
            "expectedRevision": preview["expectedRevision"],
            "requestId": request_id or str(uuid4()),
            "acceptCorrections": accept,
        },
        headers=csrf(client),
    )


def test_worker_csv_preview_resume_repreview_commit_repeat_and_correction_consent(app):
    with app.test_client() as client:
        workspace = setup(client)
        preview = preview_statement(client, workspace)
        assert preview["preview"]["canCommit"]
        assert preview["preview"]["counts"]["insert"] == 1
        resumed = client.get(
            BASE + f"/imports/{preview['id']}",
            query_string={"originId": workspace["originId"]},
        )
        assert resumed.status_code == 200, resumed.json
        assert resumed.json["preview"] == preview["preview"]
        assert "csvText" not in resumed.json
        assert (
            client.get(
                BASE + f"/imports/{preview['id']}",
                query_string={"originId": "another_origin"},
            ).status_code
            == 404
        )

        # A saved mapping changes the journal revision. The old preview must
        # remain reviewable, but cannot commit until the user refreshes it.
        saved = client.post(
            BASE + "/actions",
            json={
                "originId": workspace["originId"],
                "expectedRevision": workspace["revision"],
                "requestId": str(uuid4()),
                "action": "save-mapping",
                "payload": {"mapping": statement_mapping()},
            },
            headers=csrf(client),
        )
        assert saved.status_code == 200, saved.json
        workspace = saved.json["workspace"]
        stale = commit_statement(client, preview)
        assert stale.status_code == 409
        assert stale.json["error"]["code"] == "storage.revision_conflict"
        refreshed = client.post(
            BASE + f"/imports/{preview['id']}/repreview",
            json={"expectedRevision": workspace["revision"]},
            headers=csrf(client),
        )
        assert refreshed.status_code == 200, refreshed.json
        preview = refreshed.json
        request_id = str(uuid4())
        committed = commit_statement(client, preview, request_id=request_id)
        assert committed.status_code == 200, committed.json
        workspace = committed.json["workspace"]
        trade = workspace["tables"]["journalTrades"][0]
        assert trade["amounts"]["netPnl"] == "12.34"
        assert trade["amounts"]["grossPnl"] is None
        assert trade["strategy"] == "Opening range"
        assert len(workspace["journalLedger"]["observations"]) == 1
        replay = commit_statement(client, preview, request_id=request_id)
        assert replay.status_code == 200 and replay.json["result"] == committed.json["result"]

        review = client.post(
            BASE + "/actions",
            json={
                "originId": workspace["originId"],
                "expectedRevision": workspace["revision"],
                "requestId": str(uuid4()),
                "action": "review-trade",
                "payload": {
                    "tradeId": trade["id"],
                    "review": {
                        "technicalNotes": "Keep my decision",
                        "strategy": "My selected strategy",
                        "reviewStatus": "reviewed",
                    },
                },
            },
            headers=csrf(client),
        )
        assert review.status_code == 200, review.json
        repeated_preview = preview_statement(client, review.json["workspace"])
        assert repeated_preview["preview"]["counts"]["unchanged"] == 1
        repeated = commit_statement(client, repeated_preview)
        assert repeated.status_code == 200, repeated.json
        workspace = repeated.json["workspace"]
        assert len(workspace["tables"]["journalTrades"]) == 1
        assert len(workspace["journalLedger"]["observations"]) == 1

        correction = preview_statement(client, workspace, net="11.34", commission="1")
        assert correction["preview"]["requiresCorrectionConfirmation"]
        denied = commit_statement(client, correction)
        assert denied.status_code == 409
        assert denied.json["error"]["code"] == "journal.corrections_require_confirmation"
        accepted = commit_statement(client, correction, accept=True)
        assert accepted.status_code == 200, accepted.json
        workspace = accepted.json["workspace"]
        corrected = workspace["tables"]["journalTrades"][0]
        assert corrected["id"] == trade["id"]
        assert corrected["amounts"]["netPnl"] == "11.34"
        assert corrected["amounts"]["commission"] == "1"
        assert corrected["strategy"] == "My selected strategy"
        assert corrected["technicalNotes"] == "Keep my decision"
        assert corrected["reviewStatus"] == "unreviewed"
        assert len(workspace["journalLedger"]["events"]) == 1
        assert len(workspace["journalLedger"]["observations"]) == 2
        assert {
            observation["sourceEvent"]["netPnl"]
            for observation in workspace["journalLedger"]["observations"]
        } == {"12.34", "11.34"}
        detail = client.get(
            BASE + f"/trades/{trade['id']}", query_string={"originId": workspace["originId"]}
        )
        assert detail.status_code == 200, detail.json
        assert [entry["action"] for entry in detail.json["history"]] == [
            "source-import",
            "review-trade",
            "source-correction",
        ]


def test_import_preview_job_is_private_for_get_repreview_and_commit(app):
    owner = app.test_client()
    workspace = setup(owner)
    preview = preview_statement(owner, workspace)
    other = app.test_client()
    login(other, "other")
    path = BASE + f"/imports/{preview['id']}"
    assert other.get(path, query_string={"originId": workspace["originId"]}).status_code == 404
    response = other.post(
        path + "/repreview",
        json={"expectedRevision": workspace["revision"]},
        headers=csrf(other),
    )
    assert response.status_code == 404, response.json
    response = commit_statement(other, preview)
    assert response.status_code == 404, response.json


def test_source_provider_casing_is_stable_across_repeat_import(app):
    with app.test_client() as client:
        workspace = setup(client)
        first = commit_statement(
            client, preview_statement(client, workspace, provider="Fixture-CSV")
        )
        assert first.status_code == 200, first.json
        repeated = preview_statement(client, first.json["workspace"], provider="Fixture-CSV")
        assert repeated["preview"]["canCommit"], repeated["preview"]["rows"]
        assert repeated["preview"]["counts"]["unchanged"] == 1


def test_query_numeric_id_parsing_is_bounded_and_returns_structured_errors(app):
    with app.test_client() as client:
        workspace = setup(client)
        response = client.get(
            BASE + "/export",
            query_string={
                "originId": workspace["originId"],
                "portfolioId": "9" * 5000,
                "bookId": workspace["books"][0]["id"],
                "format": "json",
            },
        )
        assert response.status_code == 400
        assert response.json["error"]["code"] == "journal.invalid_numeric_id"
