"""Real owned preview/publication using controlled bounded public HTTP responses."""

import json
from copy import deepcopy
from datetime import UTC, datetime
from io import BytesIO
from uuid import uuid4
from zipfile import ZipFile

import pytest
from test_data_library import commit

from services import kraken_market as market
from services.data_library import DataLibrary
from services.workspace_storage import WorkspaceError, WorkspaceStorage

NOW = datetime(2026, 11, 3, 12, tzinfo=UTC)
PAIRS = {
    "XXBTZUSD": {
        "altname": "XBTUSD",
        "wsname": "XBT/USD",
        "aclass_base": "currency",
        "status": "online",
    },
    "XETHZUSD": {
        "altname": "ETHUSD",
        "wsname": "ETH/USD",
        "aclass_base": "currency",
        "status": "online",
    },
}
ROWS = [
    [
        1793610000 + index * 60,
        "100.123456789012345678901234",
        "110",
        "90",
        "102",
        "101",
        "0.123456789012345678901234",
        index,
    ]
    for index in range(3)
]


@pytest.fixture
def library(tmp_path):
    store = WorkspaceStorage(
        f"sqlite:///{(tmp_path / 'market.db').as_posix()}", "principal_market_owner"
    )
    yield DataLibrary(store)
    store.engine.dispose()


class Provider:
    def __init__(self):
        self.calls = []
        self.pairs = deepcopy(PAIRS)
        self.result = {"XXBTZUSD": deepcopy(ROWS), "last": ROWS[-1][0]}

    def __call__(self, endpoint, params):
        self.calls.append((endpoint, params))
        return deepcopy(self.pairs if endpoint == "AssetPairs" else self.result)


def stage(library, provider):
    return market.preview(
        library,
        library.catalog()["revision"],
        "XXBTZUSD",
        "1m",
        fetcher=provider,
        clock=lambda: NOW,
    )


def test_public_instrument_search_is_bounded_and_does_not_fabricate_private_accounts():
    provider = Provider()
    provider.pairs["HALTED"] = {**PAIRS["XXBTZUSD"], "status": "cancel_only"}
    result = market.instruments("xbt", 1, fetcher=provider)
    assert result["instruments"] == [
        {"id": "XXBTZUSD", "symbol": "XBT/USD", "base": "XBT", "quote": "USD", "alias": "XBTUSD"}
    ]
    assert result["matched"] == 1 and result["sourceId"] == "kraken-public"
    assert set(result["intervals"]) == {"1m", "5m", "15m", "30m", "1h", "4h", "D"}
    assert provider.calls == [("AssetPairs", {})]
    assert "account" not in result and "credential" not in result


def test_closed_exact_candles_use_existing_preview_commit_reopen_and_bundle(library):
    provider = Provider()
    preview = stage(library, provider)
    assert preview["preview"]["canCommit"] is True
    assert preview["preview"]["counts"]["accepted"] == 2
    observation = preview["sourceObservation"]
    assert observation["closedRows"] == 2 and observation["excludedUnfinished"] == 1
    assert observation["returnedLast"] == ROWS[1][0] and observation["maxEntries"] == 720
    assert preview["context"]["symbol"] == "XBT/USD" and preview["context"]["currency"] == "USD"
    assert library.import_job(preview["id"])["sourceObservation"] == observation
    replayed = library.repreview_import(preview["id"], preview["expectedRevision"])
    assert replayed["sourceObservation"] == observation and len(provider.calls) == 2
    result = commit(library, replayed)
    version = result["version"]
    assert version["rowCount"] == 2 and version["sourceObservation"] == observation
    bars = library.bars(version["id"])["bars"]
    assert bars[0]["open"] == ROWS[0][1] and bars[0]["volume"] == ROWS[0][6]
    assert bars[-1]["timestamp"] == ROWS[1][0]
    content = library.export(version["id"], "bundle")
    import base64

    with ZipFile(BytesIO(base64.b64decode(content["base64"]))) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    assert manifest["datasetVersion"]["sourceObservation"] == observation
    other = DataLibrary(WorkspaceStorage(library.engine, "principal_market_restored"))
    restored_review = other.preview_bundle(0, content["base64"])
    restored = other.commit_bundle(restored_review["id"], 0, uuid4().hex)["version"]
    assert restored["sourceObservation"] == observation
    assert restored["rowCount"] == 2 and restored["id"] != version["id"]
    repeated = commit(library, stage(library, provider))
    assert repeated["version"]["id"] == version["id"]
    assert len(library.catalog()["versions"]) == 1


def test_malformed_public_provenance_cannot_break_a_restored_review(library):
    import base64

    version = commit(library, stage(library, Provider()))["version"]
    content = library.export(version["id"], "bundle")
    with ZipFile(BytesIO(base64.b64decode(content["base64"]))) as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    manifest = json.loads(members["manifest.json"])
    manifest["datasetVersion"]["sourceObservation"]["returnedFirst"] = "invalid-time"
    members["manifest.json"] = json.dumps(manifest).encode()
    stream = BytesIO()
    with ZipFile(stream, "w") as archive:
        for name, value in members.items():
            archive.writestr(name, value)
    with pytest.raises(WorkspaceError, match="invalid_bundle"):
        library.preview_bundle(
            library.catalog()["revision"], base64.b64encode(stream.getvalue()).decode()
        )


@pytest.mark.parametrize(
    "change",
    [
        lambda value: value.update(result={"OTHER": ROWS}),
        lambda value: value["result"].update(XXBTZUSD=ROWS[:1]),
        lambda value: value["result"]["XXBTZUSD"][0].__setitem__(1, "NaN"),
        lambda value: value["result"]["XXBTZUSD"][0].__setitem__(1, "0"),
        lambda value: value["result"]["XXBTZUSD"][1].__setitem__(0, ROWS[0][0]),
        lambda value: value["result"]["XXBTZUSD"][0].__setitem__(2, "1"),
        lambda value: value["result"].update(XXBTZUSD=ROWS * 241),
    ],
)
def test_malformed_or_empty_market_response_cannot_stage_a_preview(library, change):
    provider = Provider()
    state = {"result": provider.result}
    change(state)
    provider.result = state["result"]
    with pytest.raises(WorkspaceError):
        stage(library, provider)
    assert not library.catalog()["jobs"] and not library.catalog()["versions"]


def test_future_closed_candles_and_stale_library_revision_are_rejected(library):
    provider = Provider()
    with pytest.raises(WorkspaceError, match="future_closed_candle"):
        market.preview(
            library,
            0,
            "XXBTZUSD",
            "1m",
            fetcher=provider,
            clock=lambda: datetime(2026, 11, 1, tzinfo=UTC),
        )
    provider.calls.clear()
    with pytest.raises(WorkspaceError, match="revision_conflict"):
        market.preview(library, 1, "XXBTZUSD", "1m", fetcher=provider)
    assert provider.calls == []


@pytest.mark.parametrize("pair,interval", [(None, "1m"), ("XXBTZUSD", []), ("XXBTZUSD", "1w")])
def test_invalid_intent_never_fetches(library, pair, interval):
    provider = Provider()
    with pytest.raises(WorkspaceError):
        market.preview(library, 0, pair, interval, fetcher=provider)
    assert not provider.calls


class Response:
    def __init__(self, status=200, content=None):
        self.status_code = status
        self.content = (
            content if content is not None else json.dumps({"error": [], "result": PAIRS}).encode()
        )
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.closed = True

    def iter_bytes(self, chunk_size):
        assert chunk_size == 16384
        for offset in range(0, len(self.content), chunk_size):
            yield self.content[offset : offset + chunk_size]


class Client:
    def __init__(self, response):
        self.response, self.calls = response, []

    def stream(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.response


@pytest.mark.parametrize(
    "status,content",
    [
        (429, b"PRIVATE"),
        (302, b"PRIVATE"),
        (200, b"not-json"),
        (200, b'{"error":[],"error":[],"result":{}}'),
        (200, b"x" * (market.MAX_BYTES + 1)),
    ],
    ids=["rate-limit", "redirect", "bad-json", "duplicate-key", "oversized"],
)
def test_bounded_shared_http_response_closes_on_all_failures(monkeypatch, status, content):
    from utils import httpx_client

    response = Response(status, content)
    client = Client(response)
    monkeypatch.setattr(httpx_client, "get_httpx_client", lambda: client)
    with pytest.raises(WorkspaceError) as error:
        market.fetch_public("AssetPairs", {})
    assert response.closed and "PRIVATE" not in str(error.value)
    assert client.calls == [
        (
            "GET",
            "https://api.kraken.com/0/public/AssetPairs",
            {"params": {}, "timeout": 10, "follow_redirects": False},
        )
    ]


def test_unknown_endpoint_cannot_turn_public_fetcher_into_a_proxy():
    with pytest.raises(WorkspaceError, match="invalid_request"):
        market.fetch_public("https://outside.example/private", {})


def test_provider_json_rate_limit_is_not_disguised_as_a_malformed_candle(monkeypatch):
    from utils import httpx_client

    response = Response(content=b'{"error":["EAPI:Rate limit exceeded"],"result":{}}')
    monkeypatch.setattr(httpx_client, "get_httpx_client", lambda: Client(response))
    with pytest.raises(WorkspaceError, match="kraken_rate_limited") as error:
        market.fetch_public("OHLC", {"pair": "XXBTZUSD", "interval": 1})
    assert error.value.status == 429 and response.closed


def test_measured_full_public_window_allows_720_closed_rows_plus_unfinished():
    instrument = market.decode_instruments(PAIRS)[1]
    rows = [[ROWS[0][0] + index * 60, *ROWS[0][1:]] for index in range(721)]
    text, observation = market.decode_candles({"XXBTZUSD": rows}, instrument, "1m", NOW)
    assert observation["closedRows"] == 720 and observation["excludedUnfinished"] == 1
    assert len(text.splitlines()) == 721


@pytest.mark.parametrize("missing", [False, True], ids=["continuous-tuesday", "actual-gap"])
def test_public_calendar_covers_every_day_and_reports_only_actual_missing_rows(library, missing):
    provider = Provider()
    start = int(datetime(2026, 11, 3, tzinfo=UTC).timestamp())
    rows = [[start + index * 60, *ROWS[0][1:]] for index in range(721)]
    if missing:
        del rows[360]
    provider.result = {"XXBTZUSD": rows, "last": rows[-1][0]}
    staged = stage(library, provider)
    report = staged["preview"]
    assert report["counts"]["accepted"] == 720 - int(missing)
    for key in ("outsideSession", "offGrid", "calendarUnclassified"):
        assert report["counts"][key] == 0
    assert report["coverage"]["missingExpectedBars"] == int(missing)
    assert report["coverage"]["unclassifiedGaps"] == 0
    assert {item["code"] for item in report["quality"]["warnings"]} == (
        {"quality.missing_expected"} if missing else set()
    )
    assert staged["context"]["calendar"]["sessions"] == [
        {"weekdays": list(range(7)), "open": "00:00", "close": "24:00"}
    ]
    saved = commit(library, staged)["version"]
    assert saved["quality"]["status"] == ("partial" if missing else "verified")
    assert saved["coverage"]["missingExpectedBars"] == int(missing)


def test_public_response_resources_are_bounded_across_repeated_success_and_failure(monkeypatch):
    import gc
    import tracemalloc

    import psutil

    from utils import httpx_client

    class RepeatedClient:
        def __init__(self):
            self.opened = self.closed = 0

        def stream(self, *_args, **_kwargs):
            owner = self
            status = 429 if self.opened % 3 == 0 else 200
            self.opened += 1

            class ManagedResponse(Response):
                def __exit__(self, *_):
                    super().__exit__()
                    owner.closed += 1

            return ManagedResponse(status)

    client = RepeatedClient()
    monkeypatch.setattr(httpx_client, "get_httpx_client", lambda: client)
    process = psutil.Process()
    handles = process.num_handles() if hasattr(process, "num_handles") else process.num_fds()
    gc.collect()
    tracemalloc.start()
    baseline, _ = tracemalloc.get_traced_memory()
    for _ in range(120):
        try:
            market.fetch_public("AssetPairs", {})
        except WorkspaceError as error:
            assert error.code == "dataset.kraken_rate_limited"
    gc.collect()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    after = process.num_handles() if hasattr(process, "num_handles") else process.num_fds()
    assert client.opened == client.closed == 120
    assert after <= handles + 4 and current - baseline < 1024 * 1024 and peak < 4 * 1024 * 1024
    print(
        json.dumps(
            {
                "audit": "W07_PUBLIC_RESPONSES",
                "opened": client.opened,
                "closed": client.closed,
                "handlesBefore": handles,
                "handlesAfter": after,
                "retainedPythonBytes": current - baseline,
                "peakPythonBytes": peak,
            }
        )
    )
