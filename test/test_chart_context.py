import copy

import pytest

from services.chart_context import validate_chart_bindings
from services.workspace_storage import WorkspaceError


def _snapshots(source, kind="live"):
    snapshot = {"tables": {"portfolios": [{"id": 2, "kind": kind, "chartSource": source}],
                           "practiceSessions": []}}
    return snapshot, {"snapshot": copy.deepcopy(snapshot)}


def _validate(source, kind="live"):
    snapshot, previous = _snapshots(source, kind)
    previous["snapshot"]["tables"]["portfolios"][0].pop("chartSource")
    validate_chart_bindings(None, snapshot, previous, library=None)


@pytest.mark.parametrize("provider,symbol", [
    ("mt5", "EURUSDm"), ("mt5", "#AAPL.pro"),
    ("kraken", "XBTUSD"), ("hyperliquid", "kBONK"),
])
def test_live_feed_chart_source_is_accepted_for_live_profile(provider, symbol):
    _validate({
        "kind": "live-feed",
        "providerId": provider,
        "providerName": provider,
        "symbol": symbol,
        "exchange": provider.upper(),
        "interval": "15m",
    })


@pytest.mark.parametrize("source,kind", [
    ({"kind": "live-feed", "providerId": "oanda", "providerName": "OANDA",
      "symbol": "EUR_USD", "exchange": "OANDA", "interval": "15m"}, "live"),
    ({"kind": "live-feed", "providerId": "mt5", "providerName": "MT5",
      "symbol": "EURUSD", "exchange": "BINANCE", "interval": "15m"}, "live"),
    ({"kind": "live-feed", "providerId": "mt5", "providerName": "MT5",
      "symbol": "EURUSD", "exchange": "MT5", "interval": "1d"}, "live"),
    ({"kind": "live-feed", "providerId": "binance", "providerName": "Binance",
      "symbol": "BTCUSDT", "exchange": "BINANCE", "interval": "1h"}, "replay"),
])
def test_live_feed_chart_source_rejects_unsupported_or_mismatched(source, kind):
    with pytest.raises(WorkspaceError) as exc:
        _validate(source, kind)
    assert exc.value.code == "chart.invalid_source"
