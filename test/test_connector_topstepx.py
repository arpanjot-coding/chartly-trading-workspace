"""TopstepX/ProjectX read-only adapter (fixture transport)."""

import json

from services.connector_topstepx import TopstepXAdapter, map_contracts

NOW = "2026-11-04T12:00:00Z"
WINDOW = {"from": "2026-11-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"}
SECRET = {"userName": "trader@example.test", "apiKey": "fixture-key"}


class Transport:
    def __call__(self, method, url, headers, body=None):
        assert method == "POST"
        payload = json.loads(body)
        if url.endswith("/api/Auth/loginKey"):
            assert payload == {"userName": SECRET["userName"], "apiKey": SECRET["apiKey"]}
            return 200, json.dumps({"token": "tok-1", "success": True}).encode()
        assert headers["Authorization"] == "Bearer tok-1"
        if url.endswith("/api/Account/search"):
            return 200, json.dumps(
                {
                    "accounts": [
                        {"id": 12345, "name": "TOPSTEPXSIM12345", "balance": 50250.75, "canTrade": True}
                    ],
                    "success": True,
                }
            ).encode()
        if url.endswith("/api/Position/searchOpen"):
            return 200, json.dumps({"positions": [], "success": True}).encode()
        if url.endswith("/api/Trade/search"):
            return 200, json.dumps(
                {
                    "trades": [
                        {
                            "id": 88,
                            "accountId": 12345,
                            "contractId": "CON.F.US.MES.Z26",
                            "creationTimestamp": "2026-11-01T15:30:00Z",
                            "price": 5842.25,
                            "profitAndLoss": None,
                            "fees": 0.62,
                            "side": 0,
                            "size": 1,
                            "voided": False,
                            "orderId": 999,
                        },
                        {
                            "id": 89,
                            "contractId": "CON.F.US.MES.Z26",
                            "creationTimestamp": "2026-11-01T15:31:00Z",
                            "price": 5840.0,
                            "fees": 0.0,
                            "side": 1,
                            "size": 1,
                            "voided": True,
                            "orderId": 1000,
                        },
                    ],
                    "success": True,
                }
            ).encode()
        raise AssertionError(url)


def test_topstepx_probe_history_and_contracts():
    adapter = TopstepXAdapter(transport=Transport(), clock=lambda: NOW)
    probe = adapter.probe({}, SECRET)
    assert probe["identity"]["externalId"] == "12345"
    assert probe["identity"]["environment"] == "broker_demo"
    assert probe["details"]["balance"] == "50250.75"
    page = adapter.history({}, probe["identity"], WINDOW, secret=SECRET)
    assert len(page["events"]) == 1  # voided trade excluded
    assert page["events"][0]["payload"]["price"] == "5842.25"
    assert page["events"][0]["payload"]["quantity"] == "1"
    contracts = map_contracts(
        {
            "contracts": [
                {
                    "id": "CON.F.US.MES.Z26",
                    "name": "MESZ26",
                    "description": "Micro E-mini S&P 500",
                    "tickSize": 0.25,
                    "tickValue": 1.25,
                    "activeContract": True,
                }
            ]
        }
    )
    assert contracts[0]["tickSize"] == "0.25"
    assert contracts[0]["quantityUnit"] == "contract"
