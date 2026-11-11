"""Independent adapter-to-ledger checks using only an injected native SDK."""

from copy import deepcopy

import pytest
from test_connector_mt5 import NOW, SDK, adapter, identity

from services import connector_adapters, connector_conformance
from services.connector_adapters import AdapterError
from services.connector_history import merge_history
from services.connector_mt5 import MT5Adapter

WINDOW = {"from": "2026-11-01T00:00:00Z", "to": "2026-11-03T00:00:00Z"}
CONTEXT = {
    "providerId": "mt5",
    "connectionId": "connection_review001",
    "accountKey": "account_review001",
    "identity": identity(),
    "receivedAt": NOW,
}


def merge(current, page):
    return merge_history(
        current,
        page,
        {**CONTEXT, "window": page["window"], "expectedCursor": page["cursor"]},
    )


@pytest.mark.parametrize("prior_verified_checkpoint", [False, True])
def test_native_pages_preserve_actual_partial_coverage_and_finish_transport_only(
    prior_verified_checkpoint,
):
    current = None
    if prior_verified_checkpoint:
        previous = {"from": "2026-10-30T00:00:00Z", "to": "2026-10-31T00:00:00Z"}
        current = merge(
            None,
            {
                "providerId": "mt5",
                "adapterVersion": "p07-read-only-v1",
                "identity": identity(),
                "window": previous,
                "cursor": None,
                "nextCursor": None,
                "hasMore": False,
                "complete": True,
                "events": [],
                "coverage": {**previous, "complete": True, "observedAt": NOW},
            },
        )["history"]
    highwater = (current or {}).get("cursor", {}).get("observedThrough")
    sdk = SDK()
    subject = adapter(sdk)
    first_page = subject.history({}, identity(), WINDOW)
    first = merge(current, first_page)
    assert first["history"]["cursor"]["nativeCursor"] == first_page["nextCursor"]
    assert first["history"]["coverage"][-1]["to"] == "2026-11-02T00:00:00.000000Z"
    assert first["history"]["cursor"].get("observedThrough") == highwater

    last_page = subject.history({}, identity(), WINDOW, first_page["nextCursor"])
    final = merge(first["history"], last_page)
    assert last_page["hasMore"] is False and last_page["complete"] is False
    assert final["history"]["cursor"]["nativeCursor"] is None
    assert final["history"]["cursor"]["window"] == {
        "from": "2026-11-01T00:00:00.000000Z",
        "to": "2026-11-03T00:00:00.000000Z",
    }
    assert final["history"]["cursor"].get("observedThrough") == highwater
    assert final["history"]["coverage"][-1] == {
        "from": "2026-11-02T00:00:00.000000Z",
        "to": "2026-11-03T00:00:00.000000Z",
        "complete": False,
        "reason": "provider_clock_unverified",
        "observedAt": "2026-11-03T12:00:00.000000Z",
    }
    assert len(final["history"]["observations"]) == 1
    assert final["rows"] == [] and final["history"]["confirmed"] == []
    assert sdk.opened == sdk.closed == 2


def test_native_history_identity_is_rechecked_after_read_before_any_page_can_publish():
    sdk = SDK()
    sdk.changed = True
    with pytest.raises(AdapterError, match="identity_changed"):
        adapter(sdk).history({}, identity(), WINDOW)
    assert sdk.gets == 1 and sdk.opened == sdk.closed == 1


def test_saved_checkpoint_can_resume_native_cursor_with_equivalent_canonical_utc_strings():
    sdk = SDK()
    subject = adapter(sdk)
    first_page = subject.history({}, identity(), WINDOW)
    saved = merge(None, first_page)["history"]
    canonical_window = saved["cursor"]["window"]
    assert canonical_window != WINDOW
    resumed = subject.history({}, identity(), canonical_window, first_page["nextCursor"])
    assert resumed["coverage"]["from"] == first_page["coverage"]["to"]
    final = merge(saved, resumed)
    assert final["history"]["cursor"]["nativeCursor"] is None
    assert final["history"]["cursor"].get("observedThrough") is None
    assert final["rows"] == [] and sdk.opened == sdk.closed == 2


def test_native_payload_correction_keeps_both_observations_without_journal_projection():
    sdk = SDK()
    subject = adapter(sdk)
    first_page = subject.history({}, identity(), WINDOW)
    first = merge(None, first_page)
    old_deals = deepcopy(sdk.deals)
    sdk.deals[0].profit = 9000.0
    changed = merge(first["history"], subject.history({}, identity(), WINDOW))
    assert changed["summary"]["corrected"] == 1
    observations = changed["history"]["observations"]
    assert [value["revision"] for value in observations] == [1, 2]
    assert observations[1]["correctsObservationId"] == observations[0]["id"]
    assert all("revision" not in value["event"] for value in observations)
    assert changed["rows"] == [] and changed["history"]["confirmed"] == []
    sdk.deals = old_deals
    repeated_old_fact = merge(changed["history"], subject.history({}, identity(), WINDOW))
    assert repeated_old_fact["summary"]["duplicates"] == 1
    assert repeated_old_fact["history"]["latest"] == changed["history"]["latest"]
    assert len(repeated_old_fact["history"]["observations"]) == 2
    assert sdk.opened == sdk.closed == 3


def test_conformance_cannot_combine_one_accounts_probe_with_another_accounts_history(
    monkeypatch,
):
    class SwitchedSDK(SDK):
        def shutdown(self):
            super().shutdown()
            self.account.login += 1

    sdk = SwitchedSDK()
    original = connector_adapters.get_adapter
    monkeypatch.setattr(connector_adapters, "utc_now", lambda: NOW)
    monkeypatch.setattr(
        connector_adapters,
        "get_adapter",
        lambda provider: (
            MT5Adapter(sdk=sdk, terminal_checker=lambda _: True, clock=lambda: NOW)
            if provider == "mt5"
            else original(provider)
        ),
    )
    result = connector_conformance.run_conformance("mt5", {})
    assert result["passed"] is False and result["readiness"] == "prototype"
    assert result["checks"] == [
        {
            "id": "read-only-observation",
            "passed": False,
            "reason": "connector.identity_changed",
        }
    ]
    assert result["sample"] == {"pages": 0, "eventCount": 0}
    assert "identityHash" not in result and "100001" not in str(result)
    assert sdk.opened == sdk.closed == 2 and sdk.gets == 1
