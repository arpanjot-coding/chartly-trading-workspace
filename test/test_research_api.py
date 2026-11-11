"""P13-T04 HTTP: document/citation APIs, access-time fetch, ingestion flow."""

import json

import pytest
from test_edgar_adapter import FACTS, SUBMISSIONS
from test_journal_api import setup
from test_local_data_api import csrf

import blueprints.research as research_module
from blueprints.research import research_bp
from services.edgar_adapter import EdgarClient

pytest_plugins = ["test_local_data_api"]
BASE = "/api/local/v1/research"


class FakeEdgarClient(EdgarClient):
    def __init__(self):
        ticks = iter([float(i) for i in range(100)])
        responses = {
            "submissions": [(200, SUBMISSIONS)],
            "companyfacts": [(200, FACTS)],
        }

        def transport(method, url, headers):
            if "/Archives/" in url:
                return 200, {}, b"<html>fixture filing body</html>"
            key = "submissions" if "/submissions/" in url else "companyfacts"
            status, payload = responses[key].pop(0)
            return status, {}, json.dumps(payload).encode()

        super().__init__(
            user_agent="ChartlyTest admin@example.test",
            transport=transport,
            clock=lambda: next(ticks),
            sleeper=lambda delay: None,
        )


@pytest.fixture
def app(api, monkeypatch):
    api.register_blueprint(research_bp)
    monkeypatch.setattr(research_module, "make_edgar_client", FakeEdgarClient)
    return api


def _ingest(client, origin):
    submitted = client.post(
        BASE + "/ingestion/action",
        json={
            "originId": origin,
            "action": "submit",
            "payload": {"requestId": "req-research-001", "cik": "789019"},
        },
        headers=csrf(client),
    )
    assert submitted.status_code == 200, submitted.json
    ran = client.post(
        BASE + "/ingestion/action",
        json={"originId": origin, "action": "run-next", "payload": {}},
        headers=csrf(client),
    )
    assert ran.status_code == 200, ran.json
    assert ran.json["job"]["status"] == "completed"
    return ran.json["job"]


def test_document_citation_search_and_content_flow(app):
    with app.test_client() as client:
        assert client.get(BASE + "/issuers").status_code == 401
        origin = setup(client)["originId"]
        job = _ingest(client, origin)
        assert job["stats"]["facts"] == 3

        issuers = client.get(BASE + f"/issuers?originId={origin}").json["issuers"]
        assert len(issuers) == 1
        issuer_id = issuers[0]["id"]
        detail = client.get(BASE + f"/issuers/{issuer_id}?originId={origin}").json
        assert detail["factCount"] == 3 and detail["documentCount"] == 3

        documents = client.get(
            BASE + f"/issuers/{issuer_id}/documents?originId={origin}"
        ).json
        assert documents["page"]["total"] == 3
        first = documents["documents"][0]
        assert first["citation"]["accession"] == first["nativeDocumentId"]
        assert first["citation"]["sourceUrl"].startswith("https://www.sec.gov/Archives/")

        content = client.get(
            BASE + f"/issuers/{issuer_id}/documents/{first['id']}/content?originId={origin}"
        ).json
        assert content["accessTime"] == "live-from-sec-not-stored"
        assert "fixture filing body" in content["text"]

        facts = client.get(
            BASE
            + f"/issuers/{issuer_id}/facts?originId={origin}&metricId=us-gaap:Revenues&asOf=2026-01-01T00:00:00Z"
        ).json["facts"]
        assert [row["value"] for row in facts] == ["245122000000"]

        search = client.get(
            BASE + f"/issuers/{issuer_id}/search?originId={origin}&q=revenues"
        ).json
        assert search["scope"] == "stored-metadata-v1"
        assert search["hits"][0] == {"kind": "metric", "metricId": "us-gaap:Revenues"}

        missing = client.get(
            BASE + f"/issuers/issuer_unknown-0001?originId={origin}"
        )
        assert missing.status_code == 404
