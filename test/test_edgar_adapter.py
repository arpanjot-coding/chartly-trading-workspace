"""P13-T03/T08: polite client, canonical EDGAR mapping, durable ingestion."""

import json

import pytest

from services.edgar_adapter import EdgarClient, RateBudget, ingest_company
from services.research_domain import ResearchError
from services.research_ingestion import ResearchIngestionJobs
from services.research_store import ResearchStore
from services.workspace_storage import WorkspaceStorage

pytest_plugins = ["test_journal_service"]
ORIGIN = "journal_origin_01"
AT = "2026-11-04T12:00:00Z"
LATER = "2027-01-01T12:00:00Z"
OWNER = {"owner_id": "owner-research-tt", "workspace_id": "workspace-research"}

SUBMISSIONS = {
    "cik": 789019,
    "name": "MICROSOFT CORP",
    "tickers": ["MSFT"],
    "stateOfIncorporationDescription": "Washington",
    "filings": {
        "recent": {
            "accessionNumber": ["0000950170-25-000010", "0000950170-26-000020", "0000950170-26-000099"],
            "form": ["10-K", "10-K/A", "8-K"],
            "filingDate": ["2025-10-30", "2026-02-01", "2026-03-01"],
            "acceptanceDateTime": [
                "2025-10-30T16:15:00.000Z",
                "2026-02-01T17:00:00.000Z",
                "2026-03-01T17:00:00.000Z",
            ],
            "primaryDocument": ["msft-10k.htm", "msft-10ka.htm", "msft-8k.htm"],
        }
    },
}
FACTS = {
    "cik": 789019,
    "entityName": "MICROSOFT CORP",
    "facts": {
        "us-gaap": {
            "Revenues": {
                "units": {
                    "USD": [
                        {
                            "start": "2024-07-01", "end": "2025-06-30", "val": 245122000000,
                            "accn": "0000950170-25-000010", "fy": 2025, "fp": "FY",
                            "form": "10-K", "filed": "2025-10-30",
                        },
                        {
                            "start": "2024-07-01", "end": "2025-06-30", "val": 246000000000,
                            "accn": "0000950170-26-000020", "fy": 2025, "fp": "FY",
                            "form": "10-K/A", "filed": "2026-02-01",
                        },
                    ]
                }
            },
            "Assets": {
                "units": {
                    "USD": [
                        {
                            "end": "2025-06-30", "val": 512163000000,
                            "accn": "0000950170-25-000010", "fy": 2025, "fp": "FY",
                            "form": "10-K", "filed": "2025-10-30",
                        }
                    ]
                }
            },
        }
    },
}


def _transport(responses):
    calls = []

    def transport(method, url, headers):
        calls.append(url)
        key = "submissions" if "/submissions/" in url else "companyfacts"
        status, payload = responses[key].pop(0)
        return status, {}, json.dumps(payload).encode()

    return transport, calls


def _client(transport, **kwargs):
    return EdgarClient(
        user_agent="ChartlyTest admin@example.test",
        transport=transport,
        clock=kwargs.pop("clock", lambda: 0.0),
        sleeper=kwargs.pop("sleeper", lambda delay: None),
        **kwargs,
    )


def test_user_agent_is_mandatory_and_rate_budget_math():
    with pytest.raises(ResearchError, match="user_agent_required"):
        EdgarClient(user_agent="anonymous")
    budget = RateBudget(rate_per_second=10, burst=2)
    assert budget.wait_for_token(0.0) == 0.0
    assert budget.wait_for_token(0.0) == 0.0
    assert budget.wait_for_token(0.0) == pytest.approx(0.1)
    assert budget.wait_for_token(0.1) == 0.0


def test_retry_honours_429_then_succeeds():
    transport, calls = _transport(
        {"submissions": [(429, {}), (200, SUBMISSIONS)], "companyfacts": [(200, FACTS)]}
    )
    sleeps = []
    ticks = iter([0.0, 0.0, 1.0, 1.0, 2.0, 2.0])
    client = _client(transport, clock=lambda: next(ticks), sleeper=sleeps.append)
    payload = client.submissions("789019")
    assert payload["name"] == "MICROSOFT CORP"
    assert len(calls) == 2 and sleeps  # retried after a backoff


def test_ingest_maps_restates_and_dedupes(storage):
    store = ResearchStore(storage)
    transport, _calls = _transport(
        {
            "submissions": [(200, SUBMISSIONS), (200, SUBMISSIONS)],
            "companyfacts": [(200, FACTS), (200, FACTS)],
        }
    )
    ticks = iter([float(i) for i in range(40)])
    client = _client(transport, clock=lambda: next(ticks))
    stats = ingest_company(store, client, ORIGIN, "789019", at=LATER, retrieved_at=LATER, **OWNER)
    assert stats["facts"] == 3 and stats["duplicates"] == 0
    bundle = store.get_issuer(ORIGIN, stats["issuerId"])
    assert {"namespace": "cik", "key": "789019"} in bundle["issuer"]["identifiers"]
    history = store.fact_history(
        ORIGIN, stats["issuerId"], metric_id="us-gaap:Revenues", unit="USD", period_end="2025-06-30"
    )
    assert [row["value"] for row in history] == ["245122000000", "246000000000"]
    assert history[1]["revisesFactId"] == history[0]["id"]
    live = store.facts_as_of(ORIGIN, stats["issuerId"], as_of="2026-01-01T00:00:00Z", metric_id="us-gaap:Revenues")
    assert live[0]["value"] == "245122000000"
    # Second ingest of identical payloads: all duplicates, no growth.
    again = ingest_company(store, client, ORIGIN, "789019", at=LATER, retrieved_at=LATER, **OWNER)
    assert again["facts"] == 0 and again["duplicates"] > 0
    assert len(store.get_issuer(ORIGIN, stats["issuerId"])["facts"]) == 3


def test_durable_job_lifecycle_and_recovery(storage):
    jobs = ResearchIngestionJobs(storage, ResearchStore(storage))
    job = jobs.submit_company(ORIGIN, request_id="req-edgar-001", cik="789019")
    assert jobs.submit_company(ORIGIN, request_id="req-edgar-001", cik="789019")["id"] == job["id"]
    transport, _calls = _transport(
        {"submissions": [(200, SUBMISSIONS)], "companyfacts": [(200, FACTS)]}
    )
    ticks = iter([float(i) for i in range(40)])
    client = _client(transport, clock=lambda: next(ticks))
    done = jobs.run_next(ORIGIN, client, at=LATER, **OWNER)
    assert done["status"] == "completed" and done["stats"]["facts"] == 3
    reopened = ResearchIngestionJobs(
        WorkspaceStorage(storage.engine, storage.uid), ResearchStore(storage)
    )
    assert reopened.get(ORIGIN, job["id"])["status"] == "completed"
    queued = jobs.submit_company(ORIGIN, request_id="req-edgar-002", cik="789019")
    assert jobs.cancel(ORIGIN, queued["id"])["status"] == "cancelled"
