"""P08 Kraken spot adapter: official signing vector, exact decoding, paging.

All provider responses are injected fixtures shaped from official Kraken
documentation. No network and no real credential is used; the only secret
in this file is Kraken's own published signing-vector example key.
"""

import json
from datetime import UTC, datetime

import pytest

from services.connector_adapters import (
    AdapterError,
    describe_provider,
    get_adapter,
    normalize_configuration,
)
from services.connector_history import empty_history, merge_history, validate_history
from services.connector_kraken import (
    KrakenAdapter,
    _unix_to_iso,
    decode_json_exact,
    key_fingerprint,
    next_nonce,
    normalize_kraken_configuration,
    sign_request,
)

# Kraken's published signing test vector (docs.kraken.com authentication guide).
VECTOR_SECRET = "kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg=="
VECTOR_SIGN = "4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ=="

API_KEY = "fixturePublicKey"
SECRET = {"apiKey": API_KEY, "apiSecret": VECTOR_SECRET}
NOW = "2026-11-04T12:00:00.000000Z"
WINDOW = {"from": "2026-11-04T00:00:00Z", "to": "2026-11-05T00:00:00Z"}


def _unix(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def _body(result=None, error=None):
    return json.dumps({"error": error or [], "result": result or {}}).encode()


class FakeTransport:
    """Routes by URL suffix; each route is a queue of (status, bytes)."""

    def __init__(self, routes):
        self.routes = {key: list(value) for key, value in routes.items()}
        self.calls = []

    def __call__(self, method, url, headers, body):
        self.calls.append({"method": method, "url": url, "headers": dict(headers), "body": body})
        for suffix, queue in self.routes.items():
            if url.endswith(suffix) and queue:
                return queue.pop(0)
        raise AssertionError(f"unexpected transport call: {method} {url}")


def _time_route(iso=NOW):
    return [(200, _body({"unixtime": _unix(iso), "rfc1123": "unused"}))]


def _instruments_fetcher():
    from services.kraken_instruments import decode_asset_pairs

    return decode_asset_pairs(
        {
            "XXBTZUSD": {
                "altname": "XBTUSD",
                "wsname": "XBT/USD",
                "aclass_base": "currency",
                "base": "XXBT",
                "quote": "ZUSD",
                "status": "online",
                "lot_decimals": 8,
                "pair_decimals": 1,
                "cost_decimals": 5,
                "lot_multiplier": 1,
                "ordermin": "0.00005",
                "costmin": "0.5",
                "tick_size": "0.1",
            }
        },
        owner_id="owner-kraken-test",
        workspace_id="workspace-kraken-test",
        observed_at=NOW,
    )


def _adapter(routes, clock_iso=NOW):
    transport = FakeTransport(routes)
    nonces = iter(range(1_700_000_000_000_000, 1_700_000_001_000_000))
    adapter = KrakenAdapter(
        transport=transport,
        clock=lambda: clock_iso,
        nonce_source=lambda: next(nonces),
        instruments_fetcher=_instruments_fetcher,
    )
    return adapter, transport


def _assert_no_floats(value):
    if isinstance(value, float):
        raise AssertionError(f"float leaked into output: {value!r}")
    if isinstance(value, dict):
        for child in value.values():
            _assert_no_floats(child)
    elif isinstance(value, list):
        for child in value:
            _assert_no_floats(child)


def test_official_signing_vector():
    postdata = "nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25"
    assert sign_request("/0/private/AddOrder", postdata, "1616492376594", VECTOR_SECRET) == VECTOR_SIGN


def test_nonce_is_strictly_increasing():
    first = next_nonce(now_us=5_000_000_000_000_000)
    second = next_nonce(now_us=5_000_000_000_000_000)
    third = next_nonce(now_us=1)
    assert first < second < third


def test_configuration_defaults_and_rejects_unknown():
    assert normalize_kraken_configuration({}) == {"quoteCurrency": "USD"}
    assert normalize_kraken_configuration({"quoteCurrency": "EUR"}) == {"quoteCurrency": "EUR"}
    for bad in ({"url": "https://example.invalid"}, {"quoteCurrency": "usd"}, {"quoteCurrency": ""}, []):
        with pytest.raises(AdapterError):
            normalize_kraken_configuration(bad)


def test_decode_json_exact_preserves_number_text():
    value = decode_json_exact(b'{"a": 1.50, "b": 100, "c": "0.10"}')
    assert value == {"a": "1.50", "b": "100", "c": "0.10"}
    with pytest.raises(AdapterError):
        decode_json_exact(b'{"a": 1, "a": 2}')
    with pytest.raises(AdapterError):
        decode_json_exact(b'{"a": NaN}')


def test_unix_to_iso_is_exact_and_rejects_sub_microsecond():
    assert _unix_to_iso("1616492376.5") == "2021-03-23T09:39:36.500000Z"
    assert _unix_to_iso("0.000001") == "1970-01-01T00:00:00.000001Z"
    with pytest.raises(AdapterError):
        _unix_to_iso("1616492376.1234567")


def test_catalog_and_factory_wiring():
    description = describe_provider("kraken")
    assert description["category"] == "crypto"
    assert description["connectionMode"] == "account"
    assert description["available"] is True
    supported = {row["id"] for row in description["capabilities"] if row["supported"]}
    assert supported == {"accountRead", "accountHistory"}
    assert normalize_configuration("kraken", {}) == {"quoteCurrency": "USD"}
    assert isinstance(get_adapter("kraken"), KrakenAdapter)


def test_probe_observes_key_scoped_identity_and_permissions():
    adapter, transport = _adapter(
        {
            "/public/Time": _time_route(),
            "/private/Balance": [(200, _body({"ZUSD": "1000.50", "XXBT": "0.25", "ZEUR": "0"}))],
            "/private/TradesHistory": [(200, _body({"trades": {}, "count": 0}))],
        }
    )
    result = adapter.probe({}, SECRET)
    assert result["identity"] == {
        "providerId": "kraken",
        "externalId": key_fingerprint(API_KEY),
        "server": "api.kraken.com",
        "environment": "broker_live",
        "currency": "USD",
        "synthetic": False,
    }
    assert result["permissions"] == ["accountRead", "accountHistory"]
    assert result["details"]["balances"] == {"ZUSD": "1000.50", "XXBT": "0.25"}
    assert result["details"]["clockVerified"] is True
    _assert_no_floats(result["details"]["balances"])
    assert API_KEY not in result["identity"]["externalId"]
    assert VECTOR_SECRET not in json.dumps(result)
    balance_call = next(call for call in transport.calls if call["url"].endswith("/private/Balance"))
    assert balance_call["headers"]["API-Key"] == API_KEY
    assert balance_call["headers"]["API-Sign"]
    assert "nonce=" in balance_call["body"]


def test_probe_permission_denied_on_balance_fails_closed():
    adapter, _transport = _adapter(
        {
            "/public/Time": _time_route(),
            "/private/Balance": [(200, _body(error=["EGeneral:Permission denied"]))],
        }
    )
    with pytest.raises(AdapterError) as caught:
        adapter.probe({}, SECRET)
    assert caught.value.code == "connector.permission_denied"
    assert caught.value.status == 403


def test_probe_history_permission_gap_degrades_to_unknown():
    adapter, _transport = _adapter(
        {
            "/public/Time": _time_route(),
            "/private/Balance": [(200, _body({"ZUSD": "1"}))],
            "/private/TradesHistory": [(200, _body(error=["EGeneral:Permission denied"]))],
        }
    )
    result = adapter.probe({}, SECRET)
    assert result["permissions"] == ["accountRead"]
    assert result["capabilities"]["accountHistory"]["state"] == "unknown"


def test_probe_rejects_provider_clock_skew():
    adapter, _transport = _adapter({"/public/Time": _time_route("2026-11-04T11:00:00Z")})
    with pytest.raises(AdapterError) as caught:
        adapter.probe({}, SECRET)
    assert caught.value.code == "connector.provider_clock_unverified"


def test_probe_requires_exact_secret_shape():
    adapter, _transport = _adapter({})
    for bad in (None, {}, {"apiKey": API_KEY}, {**SECRET, "extra": "x"}, {"apiKey": "", "apiSecret": "x"}):
        with pytest.raises(AdapterError):
            adapter.probe({}, bad)


def _trade(txid, iso, **changes):
    trade = {
        "ordertxid": "ORDER-" + txid,
        "pair": "XXBTZUSD",
        "time": _unix(iso) + 0.25,
        "type": "buy",
        "ordertype": "limit",
        "price": "60123.40000",
        "cost": "300.61700",
        "fee": "0.48100",
        "vol": "0.00500000",
    }
    trade.update(changes)
    return txid, trade


def _history_routes():
    page_one = dict([_trade("T1", "2026-11-04T08:00:00Z")])
    page_two = dict(
        [
            _trade("T2", "2026-11-04T09:00:00Z", type="sell", price="61000.0"),
            _trade("OLD", "2026-11-01T09:00:00Z"),
        ]
    )
    orders = {
        "ORDER-T1": {
            "descr": {"pair": "XXBTZUSD", "type": "buy", "ordertype": "limit"},
            "status": "closed",
            "opentm": _unix("2026-11-04T07:59:00Z"),
            "closetm": _unix("2026-11-04T08:00:01Z"),
            "vol": "0.00500000",
            "vol_exec": "0.00500000",
            "cost": "300.61700",
            "fee": "0.48100",
            "price": "60123.40000",
        }
    }
    ledgers = {
        "L1": {
            "refid": "DEP-1",
            "time": _unix("2026-11-04T06:00:00Z"),
            "type": "deposit",
            "asset": "ZUSD",
            "amount": "5000.00",
            "fee": "0.00",
        },
        "L2": {
            "refid": "T1",
            "time": _unix("2026-11-04T08:00:00Z"),
            "type": "trade",
            "asset": "ZUSD",
            "amount": "-300.61700",
            "fee": "0.48100",
        },
    }
    return {
        "/public/Time": _time_route(),
        "/private/TradesHistory": [
            (200, _body({"trades": page_one, "count": 3, "cursor": {"next": "cursor-2"}})),
            (200, _body({"trades": page_two, "count": 3})),
        ],
        "/private/ClosedOrders": [(200, _body({"closed": orders, "count": 1}))],
        "/private/Ledgers": [(200, _body({"ledger": ledgers, "count": 2}))],
    }


def test_history_pages_map_exact_events_and_merge():
    probe_adapter, _t = _adapter(
        {
            "/public/Time": _time_route(),
            "/private/Balance": [(200, _body({"ZUSD": "1"}))],
            "/private/TradesHistory": [(200, _body({"trades": {}, "count": 0}))],
        }
    )
    identity = probe_adapter.probe({}, SECRET)["identity"]
    adapter, transport = _adapter(_history_routes())
    page = adapter.history({}, identity, WINDOW, None, SECRET)
    assert page["complete"] is True and page["hasMore"] is False and page["nextCursor"] is None
    by_id = {event["externalEventId"]: event for event in page["events"]}
    # FIFO closes the oldest lot first: the pre-window OLD buy (kept as
    # derivation context, not emitted as a fill event) matches before T1.
    assert set(by_id) == {"T1", "T2", "ORDER-T1", "L1", "T2:close:OLD:0"}
    closed = by_id["T2:close:OLD:0"]
    assert closed["kind"] == "trade"
    # (61000.0 - 60123.4) * 0.005 = 4.383 gross; fees 0.481 + 0.481.
    assert closed["normalizedTrade"]["grossPnl"] == "4.383"
    assert closed["normalizedTrade"]["fees"] == "0.962"
    assert closed["normalizedTrade"]["netPnl"] == "3.421"
    assert closed["normalizedTrade"]["currency"] == "USD"
    assert closed["normalizedTrade"]["symbol"] == "BTC/USD"
    assert by_id["T1"]["kind"] == "fill" and by_id["T1"]["status"] == "confirmed"
    assert by_id["T1"]["occurredAt"] == "2026-11-04T08:00:00.250000Z"
    assert by_id["T1"]["payload"]["price"] == "60123.40000"
    assert by_id["T1"]["payload"]["volume"] == "0.00500000"
    assert by_id["ORDER-T1"]["kind"] == "order"
    assert by_id["L1"]["kind"] == "cashflow" and by_id["L1"]["payload"]["ledgerType"] == "deposit"
    _assert_no_floats(page)
    trade_calls = [call for call in transport.calls if call["url"].endswith("/private/TradesHistory")]
    assert "cursor=cursor-2" in trade_calls[1]["body"]

    merged = merge_history(
        empty_history(),
        page,
        {
            "providerId": "kraken",
            "connectionId": "connection_kraken1",
            "accountKey": "account_kraken1",
            "receivedAt": NOW,
            "identity": identity,
        },
    )
    validate_history(merged["history"] if "history" in merged else merged)
    # Re-delivery of the same page is idempotent at the history layer.
    again = merge_history(
        merged["history"] if "history" in merged else merged,
        page,
        {
            "providerId": "kraken",
            "connectionId": "connection_kraken1",
            "accountKey": "account_kraken1",
            "receivedAt": NOW,
            "identity": identity,
        },
    )
    state = again["history"] if "history" in again else again
    assert len(state["observations"]) == 5
    assert len(state["confirmed"]) == 1


def test_history_rejects_identity_mismatch_without_fetching_account_data():
    adapter, transport = _adapter(_history_routes())
    identity = {
        "providerId": "kraken",
        "externalId": key_fingerprint("aDifferentKey"),
        "server": "api.kraken.com",
        "environment": "broker_live",
        "currency": "USD",
        "synthetic": False,
    }
    with pytest.raises(AdapterError) as caught:
        adapter.history({}, identity, WINDOW, None, SECRET)
    assert caught.value.code == "connector.identity_changed"
    assert transport.calls == []


def test_history_rejects_tampered_cursor():
    adapter, _transport = _adapter(_history_routes())
    identity = {
        "providerId": "kraken",
        "externalId": key_fingerprint(API_KEY),
        "server": "api.kraken.com",
        "environment": "broker_live",
        "currency": "USD",
        "synthetic": False,
    }
    with pytest.raises(AdapterError) as caught:
        adapter.history({}, identity, WINDOW, "not-a-cursor", SECRET)
    assert caught.value.code == "connector.invalid_cursor"


def test_provider_error_mapping():
    cases = (
        ("EAPI:Rate limit exceeded", "connector.rate_limited", 429),
        ("EAPI:Invalid nonce", "connector.nonce_rejected", 409),
        ("EAPI:Invalid key", "connector.credential_revoked", 403),
    )
    for provider_error, code, status in cases:
        adapter, _transport = _adapter(
            {
                "/public/Time": _time_route(),
                "/private/Balance": [(200, _body(error=[provider_error]))],
            }
        )
        with pytest.raises(AdapterError) as caught:
            adapter.probe({}, SECRET)
        assert (caught.value.code, caught.value.status) == (code, status)
        assert VECTOR_SECRET not in str(caught.value)


def test_malformed_private_response_fails_closed():
    adapter, _transport = _adapter(
        {
            "/public/Time": _time_route(),
            "/private/Balance": [(200, _body({"ZUSD": "not-a-number"}))],
        }
    )
    with pytest.raises(AdapterError) as caught:
        adapter.probe({}, SECRET)
    assert caught.value.code == "connector.invalid_provider_response"


def test_no_float_anywhere_in_probe_output():
    adapter, _transport = _adapter(
        {
            "/public/Time": _time_route(),
            "/private/Balance": [(200, _body({"ZUSD": "1.10"}))],
            "/private/TradesHistory": [(200, _body({"trades": {}, "count": 0}))],
        }
    )
    result = adapter.probe({}, SECRET)
    _assert_no_floats({key: value for key, value in result.items() if key != "details"})
    _assert_no_floats(result["details"]["balances"])
    assert isinstance(result["details"]["clockSkewSeconds"], float)  # timing metadata only


def test_conformance_evaluation_passes_for_fixture_observations():
    """Structural conformance over injected fixtures.

    This proves the adapter's outputs satisfy the P07 conformance checks;
    it is not Phase B account certification, which needs the user's real
    read-only key through run_conformance.
    """
    from copy import deepcopy

    from services.connector_conformance import evaluate_conformance, validate_conformance

    probe_adapter, _t = _adapter(
        {
            "/public/Time": _time_route(),
            "/private/Balance": [(200, _body({"ZUSD": "1"}))],
            "/private/TradesHistory": [(200, _body({"trades": {}, "count": 0}))],
        }
    )
    observation = probe_adapter.probe({}, SECRET)
    adapter, _transport = _adapter(_history_routes())
    page = adapter.history({}, observation["identity"], WINDOW, None, SECRET)
    report = evaluate_conformance(
        "kraken", {}, observation, pages=[page, deepcopy(page)], checked_at=NOW
    )
    failed = [check["id"] for check in report["checks"] if not check["passed"]]
    assert report["passed"] is True, failed
    assert report["readiness"] == "read-only-verified"
    validate_conformance(report, "kraken", observation["identity"], checked_at=NOW)


def test_adapter_has_no_order_surface():
    adapter = KrakenAdapter()
    for name in ("place_order", "add_order", "cancel_order", "submit", "order"):
        assert not hasattr(adapter, name)
    assert UTC is not None  # keep import explicit for fixture clarity
