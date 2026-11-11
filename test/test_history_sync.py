"""P22: coalescing, coverage honesty, checkpoints, reconciliation, backup."""

import json

from services.history_sync import HistorySync, backoff_seconds, missing_intervals

W = ("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")


def _sync_with_source():
    sync = HistorySync()
    sync.register_source(
        "kraken-main", provider_id="kraken", account_ref="key:abc", capabilities={"history": True}
    )
    return sync


def test_single_flight_coalesces_tabs():
    sync = _sync_with_source()
    first = sync.request_catchup("conn-1", "acct-1", job_id="job-1")
    second = sync.request_catchup("conn-1", "acct-1", job_id="job-2")
    assert first["coalesced"] is False
    assert second["coalesced"] is True
    assert second["id"] == "job-1"
    sync.finish_job("conn-1", "acct-1")
    assert sync.request_catchup("conn-1", "acct-1", job_id="job-3")["coalesced"] is False
    assert backoff_seconds(1) == 5 and backoff_seconds(3) == 20 and backoff_seconds(99) == 300


def test_coverage_gaps_stay_visible_and_pages_checkpoint():
    sync = _sync_with_source()
    pages = [
        {
            "events": [{"externalEventId": "t1", "occurredAt": "2026-10-05T00:00:00Z", "amount": "10"}],
            "nextCursor": "c2",
            "windowCovered": [W[0], "2026-10-15T00:00:00Z"],
        },
        {
            "events": [{"externalEventId": "t1", "occurredAt": "2026-10-05T00:00:00Z", "amount": "10"}],
            "nextCursor": None,
            "windowCovered": ["2026-10-15T00:00:00Z", "2026-10-20T00:00:00Z"],
        },
    ]
    result = sync.run_catchup(
        "kraken-main", lambda cursor: pages.pop(0), window=W, requested_at="2026-11-04T12:00:00Z"
    )
    assert result["ingested"] == 1 and result["duplicates"] == 1
    coverage = result["coverage"]
    assert coverage["completeForWanted"] is False  # Oct 20 -> Nov 1 never fetched
    assert coverage["missingCoverage"] == [["2026-10-20T00:00:00Z", W[1]]]
    assert coverage["lastObservedEventAt"] == "2026-10-05T00:00:00Z"
    assert coverage["lastSuccessfulRequestAt"] == "2026-11-04T12:00:00Z"
    assert missing_intervals([(W[0], W[1])], *W) == []


def test_detach_preserves_history_and_refuses_sync():
    sync = _sync_with_source()
    sync.run_catchup(
        "kraken-main",
        lambda cursor: {"events": [{"externalEventId": "t9", "occurredAt": W[0]}], "nextCursor": None, "windowCovered": list(W)},
        window=W,
        requested_at="2026-11-04T12:00:00Z",
    )
    status = sync.detach_source("kraken-main")
    assert status["eventCount"] == 1  # history preserved
    refused = sync.run_catchup("kraken-main", lambda c: {}, window=W, requested_at=W[0])
    assert refused["status"] == "refused_detached"


def test_cross_source_join_only_on_reliable_ids():
    sync = _sync_with_source()
    sync.register_source(
        "stmt-main", provider_id="statement", account_ref="acct", capabilities={"history": True}
    )
    event = {"externalEventId": "x1", "occurredAt": "2026-10-05T00:00:00Z", "amount": "42"}
    for key in ("kraken-main", "stmt-main"):
        sync.run_catchup(
            key,
            lambda cursor, event=event: {"events": [event], "nextCursor": None, "windowCovered": list(W)},
            window=W,
            requested_at="2026-11-04T12:00:00Z",
        )
    sync.link_accounts("link-1", ["kraken-main", "stmt-main"], priority=["kraken-main", "stmt-main"])
    unmapped = sync.reconcile_link("link-1", alias_map={})
    assert unmapped["joined"] == {}  # look-alikes never auto-merge
    assert len(unmapped["conflicts"]) == 1
    mapped = sync.reconcile_link(
        "link-1",
        alias_map={"kraken-main:x1": "trade-1", "stmt-main:x1": "trade-1"},
    )
    assert mapped["joined"] == {"trade-1": ["kraken-main", "stmt-main"]}
    assert mapped["doubleCounted"] is False


def test_setup_preview_and_backup_round_trip():
    preview = HistorySync.setup_preview(
        {
            "providerId": "myfxbook",
            "historySupported": True,
            "windowLimitDays": 90,
            "methods": ["third_party_service", "statement_import"],
        }
    )
    assert preview["executionSetupRequired"] is False
    assert any("90 days" in warning for warning in preview["warnings"])

    sync = _sync_with_source()
    sync.annotate("kraken-main", "t1", "reviewed with statement")
    sync.run_catchup(
        "kraken-main",
        lambda cursor: {"events": [{"externalEventId": "t1", "occurredAt": W[0]}], "nextCursor": "next-1", "windowCovered": [W[0], W[0]]},
        window=W,
        requested_at="2026-11-04T12:00:00Z",
        max_pages=1,
    )
    exported = json.loads(json.dumps(sync.export_state()))  # backup-serializable
    restored = HistorySync()
    restored.import_state(exported)
    status = restored.status("kraken-main")
    assert status["cursor"] == "next-1"
    assert status["eventCount"] == 1
