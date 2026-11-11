"""Validate new chart source/cursor intent without authorizing execution."""

import re
from datetime import UTC, date, datetime, timedelta

from services.chart_evidence_validation import keys, seconds
from services.connector_mt5 import NATIVE_SYMBOL_PATTERN
from services.workspace_storage import WorkspaceError

_DIRECT_LIVE_FEEDS = {
    "mt5": {"1m", "5m", "15m", "1h", "4h"},
    "binance": {"1m", "5m", "15m", "1h", "4h", "1d"},
    "bybit": {"1m", "5m", "15m", "1h", "4h", "1d"},
    "coinbase": {"1m", "5m", "15m", "1h", "1d"},
    "okx": {"1m", "5m", "15m", "1h", "4h", "1d"},
    "bitget": {"1m", "5m", "15m", "1h", "4h", "1d"},
    "kraken": {"1m", "5m", "15m", "1h", "4h", "1d"},
    "hyperliquid": {"1m", "5m", "15m", "1h", "4h", "1d"},
}
_CRYPTO_SYMBOL = re.compile(r"[A-Z0-9][A-Z0-9\-_/]{2,23}")
_LIVE_SYMBOL_PATTERNS = {
    "mt5": NATIVE_SYMBOL_PATTERN,
    "hyperliquid": re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,23}"),
}


def _validate_live_feed(item, chosen):
    keys(chosen, ("kind", "providerId", "providerName", "symbol", "exchange", "interval"))
    provider = chosen.get("providerId")
    intervals = _DIRECT_LIVE_FEEDS.get(provider) if isinstance(provider, str) else None
    provider_name = chosen.get("providerName")
    symbol = chosen.get("symbol")
    exchange = chosen.get("exchange")
    interval = chosen.get("interval")
    symbol_pattern = _LIVE_SYMBOL_PATTERNS.get(provider, _CRYPTO_SYMBOL) if intervals else None
    if (
        item.get("kind") != "live"
        or intervals is None
        or not isinstance(provider_name, str)
        or not provider_name.strip()
        or len(provider_name) > 160
        or any(ord(char) < 32 or ord(char) == 127 for char in provider_name)
        or not isinstance(symbol, str)
        or symbol_pattern is None
        or symbol_pattern.fullmatch(symbol) is None
        or exchange != provider.upper()
        or interval not in intervals
    ):
        raise WorkspaceError("chart.invalid_source")


def run_window(run):
    result = []
    for name in ("rangeStart", "rangeEnd"):
        value = run.get(name)
        if not value:
            result.append(None)
            continue
        if not isinstance(value, str) or len(value) != 10:
            raise WorkspaceError("chart.invalid_run_window")
        try:
            day = date.fromisoformat(value)
            if day.isoformat() != value:
                raise ValueError()
            instant = datetime.combine(day, datetime.min.time(), UTC)
            if name == "rangeEnd":
                instant += timedelta(days=1)
            result.append(instant.timestamp())
        except (ValueError, OverflowError) as error:
            raise WorkspaceError("chart.invalid_run_window") from error
    if result[0] is not None and result[1] is not None and result[0] >= result[1]:
        raise WorkspaceError("chart.invalid_run_window")
    return result


def _manifest(snapshot, version):
    manifests = snapshot.setdefault("datasetManifests", [])
    if not any(item.get("id") == version["id"] for item in manifests):
        if len(manifests) >= 10000:
            raise WorkspaceError("dataset.manifest_limit", 413)
        manifests.append(
            {
                key: version[key]
                for key in ("id", "datasetId", "checksum", "rowCount", "start", "end")
            }
        )


def validate_chart_bindings(connection, snapshot, previous, library):
    for name in ("portfolios", "practiceSessions"):
        old_rows = {item["id"]: item for item in previous["snapshot"]["tables"][name]}
        for item in snapshot["tables"][name]:
            old = old_rows.get(item["id"], {})
            chosen = item.get("chartSource") if name == "portfolios" else None
            old_chosen = old.get("chartSource") if name == "portfolios" else None
            if chosen is not None:
                if not isinstance(chosen, dict):
                    raise WorkspaceError("chart.invalid_source")
                if chosen.get("kind") == "connected":
                    keys(chosen, ("kind",))
                elif chosen.get("kind") == "dataset":
                    keys(chosen, ("kind", "versionId", "checksum"))
                elif chosen.get("kind") == "live-feed":
                    _validate_live_feed(item, chosen)
                else:
                    raise WorkspaceError("chart.invalid_source")
                if chosen != old_chosen and chosen["kind"] == "dataset":
                    version = library._version(connection, chosen["versionId"])
                    if chosen["checksum"] != version["checksum"]:
                        raise WorkspaceError("dataset.checksum_mismatch", 409)
                    _manifest(snapshot, version)
            checkpoint = item.get("chartView")
            if checkpoint is None:
                continue
            keys(checkpoint, ("version", "datasetVersionId", "datasetChecksum", "cursorTime"))
            if type(checkpoint["version"]) is not int or checkpoint["version"] != 1:
                raise WorkspaceError("chart.invalid_checkpoint")
            seconds(checkpoint["cursorTime"])
            if (
                checkpoint == old.get("chartView")
                and chosen == old_chosen
                and all(
                    item.get(key) == old.get(key)
                    for key in ("datasetVersionId", "datasetChecksum", "rangeStart", "rangeEnd")
                )
            ):
                continue
            if name == "portfolios":
                if not chosen or chosen.get("kind") != "dataset":
                    raise WorkspaceError("chart.checkpoint_source_mismatch", 409)
                binding = chosen["versionId"], chosen["checksum"]
            else:
                binding = item.get("datasetVersionId"), item.get("datasetChecksum")
            if not all(isinstance(value, str) for value in binding):
                raise WorkspaceError("chart.checkpoint_source_mismatch", 409)
            version = library._version(connection, checkpoint["datasetVersionId"])
            bound = library._version(connection, binding[0])
            if (
                bound["id"] != version["id"]
                or binding[1] != version["checksum"]
                or checkpoint["datasetChecksum"] != version["checksum"]
            ):
                raise WorkspaceError("chart.checkpoint_source_mismatch", 409)
            cursor = checkpoint["cursorTime"]
            if not version["start"] <= cursor <= version["end"]:
                raise WorkspaceError("chart.checkpoint_outside_history", 409)
            if name == "practiceSessions":
                start, end = run_window(item)
                if start is not None and cursor < start or end is not None and cursor >= end:
                    raise WorkspaceError("chart.checkpoint_outside_run", 409)
            _manifest(snapshot, version)
