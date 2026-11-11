"""Actual local transactions and immutable data; financial expectations independently authored."""

from copy import deepcopy
from uuid import uuid4

import pytest
from test_data_library import commit, context, mapping

from services.data_library import DataLibrary
from services.paper_sessions import PaperSessions
from services.workspace_storage import WorkspaceError, WorkspaceStorage

pytest_plugins = ["test_journal_service"]
ORIGIN = "journal_origin_01"


def config(**changes):
    result = {
        "version": 1,
        "instrument": {
            "symbol": "EXAMPLE",
            "exchange": "LOCAL",
            "interval": "1m",
            "currency": "USD",
            "quantityUnit": "share",
            "quantityStep": "1",
            "priceTick": "1",
            "multiplier": "1",
            "quantityScale": 0,
            "priceScale": 0,
        },
        "startingCash": "1000",
        "moneyScale": 2,
        "costs": {"spreadTicks": 0, "slippageTicks": 0, "feeBps": "0", "feePerFill": "0"},
        "policy": {"id": "native-ohlc-conservative-v1", "gap": "next-observed"},
        "seed": 0,
    }
    return {**result, **changes}


def bind_run(storage, *, text=None, metadata=None):
    library = DataLibrary(storage)
    text = text or (
        "timestamp,open,high,low,close,volume\n"
        + "\n".join(
            f"2026-11-02T09:0{i}:00Z,{100 + i * 10},{102 + i * 10},{98 + i * 10},{101 + i * 10},100"
            for i in range(8)
        )
    )
    stage = library.preview_import(
        library.catalog()["revision"], text, mapping(), metadata or context()
    )
    version = commit(library, stage)["version"]
    current = storage.workspace()
    tables = current["tables"]
    tables["portfolios"][0].update(
        kind="replay",
        currency=version["metadata"]["currency"],
        defaultSymbol=version["metadata"]["symbol"],
        defaultTimeframe=version["metadata"]["interval"],
        chartSource={
            "kind": "dataset",
            "versionId": version["id"],
            "checksum": version["checksum"],
        },
    )
    tables["practiceSessions"] = [
        {
            "id": 1,
            "portfolioId": 1,
            "name": "P06 controlled run",
            "symbol": "EXAMPLE",
            "timeframe": "1m",
            "mode": "Replay",
            "market": "Stocks",
            "currency": "USD",
            "startingBalance": 1000,
            "status": "Draft",
            "rangeStart": "2026-11-02",
            "rangeEnd": "2026-11-02",
            "dataSource": "Fixture",
            "datasetVersionId": version["id"],
            "datasetChecksum": version["checksum"],
            "createdAt": "2026-11-03T00:00:00Z",
            "updatedAt": "2026-11-03T00:00:00Z",
        }
    ]
    storage.save_tables(ORIGIN, tables, current["revision"], uuid4().hex)
    return version


@pytest.fixture
def paper(storage):
    bind_run(storage)
    return PaperSessions(storage)


def act(paper, action, payload=None, *, run=1, request_id=None, revision=None):
    session = paper.session(ORIGIN, run)["session"]
    return paper.action(
        ORIGIN,
        run,
        (session["revision"] if session else 0) if revision is None else revision,
        request_id or "cmd_" + uuid4().hex,
        action,
        {} if payload is None else payload,
    )


def ready(paper, **changes):
    return act(paper, "prepare", config(**changes))["session"]


def start(paper, **changes):
    ready(paper, **changes)
    return act(paper, "start")["session"]


def test_prepare_owned_manifest_empty_book_and_exact_native_window(paper):
    assert paper.session(ORIGIN, 1) == {"session": None}
    session = ready(paper)
    assert session["cursorIndex"] == -1 and session["status"] == "ready"
    assert session["cash"] == session["equity"] == "1000"
    assert session["window"]["count"] == 8 and session["fills"] == []
    assert session["manifest"]["startingCash"] == {"value": "1000", "currency": "USD"}
    assert session["manifest"]["mode"] == "paper_replay"
    assert session["checkpoint"]["runId"] == session["manifest"]["id"]
    state = paper.storage.workspace()
    assert any(
        book["kind"] == "paper" and book["id"] == session["bookId"] for book in state["books"]
    )
    assert state["tables"]["journalTrades"] == []
    assert (
        state["tables"]["practiceSessions"][0]["paper"]["window"]["from"]
        == session["window"]["from"]
    )


def test_buy_partial_final_close_projects_once_and_restart_is_exact(paper):
    start(paper)
    queued = act(paper, "order", {"side": "buy", "orderType": "market", "quantity": "2"})
    assert queued["session"]["fills"] == []
    entry = act(paper, "advance", {"count": 1})["session"]
    assert entry["fills"][0]["price"] == "100" and entry["fills"][0]["time"] == entry["asOf"]
    position = entry["positions"][0]
    act(paper, "close", {"positionId": position["id"], "quantity": "1"})
    partial = act(paper, "advance", {"count": 1})["session"]
    assert partial["cash"] == "1010" and partial["positions"][0]["quantity"] == "1"
    restored = PaperSessions(WorkspaceStorage(paper.storage.engine, paper.storage.uid))
    assert restored.session(ORIGIN, 1)["session"] == partial
    act(restored, "close", {"positionId": position["id"], "quantity": "1"})
    request_id = "cmd_" + uuid4().hex
    revision = restored.session(ORIGIN, 1)["session"]["revision"]
    final = act(restored, "advance", {"count": 1}, request_id=request_id, revision=revision)
    again = act(restored, "advance", {"count": 1}, request_id=request_id, revision=revision)
    assert final == again
    assert final["session"]["cash"] == final["session"]["equity"] == "1030"
    rows = final["workspace"]["tables"]["journalTrades"]
    assert len(rows) == 1 and rows[0]["amounts"]["netPnl"] == "30"
    assert rows[0]["remainingQuantity"] == "0" and rows[0]["result"] == "Win"
    assert len(rows[0]["realizations"]) == 2 and len(rows[0]["sourceEventKeys"]) == 3
    assert len(final["workspace"]["journalLedger"]["events"]) == 3


def test_entry_and_exit_costs_are_once_only_and_notes_survive(paper):
    start(paper, costs={"spreadTicks": 0, "slippageTicks": 0, "feeBps": "0", "feePerFill": "1"})
    act(paper, "order", {"side": "buy", "orderType": "market", "quantity": "2"})
    first = act(paper, "advance", {"count": 1})
    row = first["workspace"]["tables"]["journalTrades"][0]
    assert row["amounts"]["netPnl"] == "-1"
    assert row["realizations"][0]["kind"] == "fee" and row["realizations"][0]["quantity"] == "0"
    paper.journal.action(
        ORIGIN,
        first["workspace"]["revision"],
        uuid4().hex,
        "review-trade",
        {
            "tradeId": row["id"],
            "review": {"technicalNotes": "Keep this thesis", "reviewStatus": "reviewed"},
        },
    )
    act(paper, "close", {"positionId": first["session"]["positions"][0]["id"], "quantity": "2"})
    closed = act(paper, "advance", {"count": 1})
    row = closed["workspace"]["tables"]["journalTrades"][0]
    assert row["technicalNotes"] == "Keep this thesis" and row["reviewStatus"] == "reviewed"
    assert (
        row["amounts"]["grossPnl"] == "20"
        and row["amounts"]["commission"] == "2"
        and row["amounts"]["netPnl"] == "18"
    )
    assert closed["session"]["cash"] == "1018"


def test_wrong_owner_scope_missing_run_and_stale_revision_cannot_mutate(paper):
    ready(paper)
    before = paper.storage.snapshot()
    with pytest.raises(WorkspaceError, match="revision_conflict"):
        act(paper, "start", revision=0)
    with pytest.raises(WorkspaceError, match="not_found"):
        paper.action(ORIGIN, 999, 0, uuid4().hex, "prepare", config())
    other = PaperSessions(WorkspaceStorage(paper.storage.engine, "principal_foreign_paper_owner"))
    with pytest.raises(WorkspaceError, match="not_found"):
        other.session(ORIGIN, 1)
    assert paper.storage.snapshot() == before


def test_failed_checkpoint_write_rolls_back_journal_run_and_command_receipt(paper, monkeypatch):
    start(paper)
    act(paper, "order", {"side": "buy", "orderType": "market", "quantity": "2"})
    before = paper.storage.snapshot()
    old = paper.records.save
    monkeypatch.setattr(
        paper.records,
        "save",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("forced checkpoint interruption")),
    )
    request_id = "cmd_" + uuid4().hex
    revision = paper.session(ORIGIN, 1)["session"]["revision"]
    with pytest.raises(RuntimeError, match="checkpoint interruption"):
        act(paper, "advance", {"count": 1}, request_id=request_id, revision=revision)
    assert paper.storage.snapshot() == before
    monkeypatch.setattr(paper.records, "save", old)
    retried = act(paper, "advance", {"count": 1}, request_id=request_id, revision=revision)
    assert (
        len(retried["session"]["fills"]) == 1
        and len(retried["workspace"]["tables"]["journalTrades"]) == 1
    )


def test_branch_is_fresh_account_and_parent_finances_and_history_survive(paper):
    start(paper)
    act(paper, "order", {"side": "sell", "orderType": "market", "quantity": "2"})
    act(paper, "advance", {"count": 3})
    parent = paper.report(ORIGIN, 1)["sessionRecord"]
    branched = act(paper, "branch", {"atIndex": 1, "name": "Separate hypothesis"})
    child = branched["session"]
    assert child["runId"] != 1 and child["parent"]["runId"] == 1
    assert (
        child["cash"] == child["equity"] == "1000"
        and child["positions"] == child["orders"] == child["fills"] == []
    )
    assert child["cursorIndex"] == 0 and child["asOf"] < parent["state"]["asOf"]
    assert child["bookId"] != paper.session(ORIGIN, 1)["session"]["bookId"]
    assert paper.report(ORIGIN, 1)["sessionRecord"]["state"] == parent["state"]
    assert len(branched["workspace"]["tables"]["journalTrades"]) == 1
    compared = paper.compare(ORIGIN, 1, [1, child["runId"]])["comparison"]
    assert compared["combinedEquity"] is None and compared["selectedCount"] == 2


def test_finish_preserves_open_unrealized_and_zero_trade_finish_is_real(paper):
    start(paper)
    act(paper, "order", {"side": "buy", "orderType": "market", "quantity": "1"})
    act(paper, "advance", {"count": 2})
    finished = act(paper, "finish")["session"]
    assert finished["status"] == "finished" and finished["positions"][0]["status"] == "open"
    assert finished["cash"] == "1000" and finished["unrealized"] == "11"
    assert len(finished["fills"]) == 1
    with pytest.raises(WorkspaceError, match="finished"):
        act(paper, "advance", {"count": 1})


@pytest.mark.parametrize(
    "action,payload",
    [
        ("advance", {"count": 0}),
        ("advance", {"count": 501}),
        ("advance", {"count": True}),
        ("order", {"side": "buy", "orderType": "market", "quantity": "1", "price": "1"}),
        ("start", {"cash": "9999"}),
        ([], {}),
    ],
)
def test_untrusted_actions_are_data_only_and_financial_state_is_preserved(paper, action, payload):
    start(paper)
    before = paper.storage.snapshot()
    with pytest.raises(WorkspaceError):
        act(paper, action, payload)
    assert paper.storage.snapshot() == before


def test_config_identity_and_currency_are_verified_not_coerced(paper):
    changed = config()
    changed["instrument"]["symbol"] = "FOREIGN"
    with pytest.raises(WorkspaceError, match="source_mismatch"):
        act(paper, "prepare", changed)
    assert paper.session(ORIGIN, 1) == {"session": None}


def test_generic_workspace_save_cannot_change_managed_run_or_simulator_finances(paper):
    start(paper)
    act(paper, "order", {"side": "buy", "orderType": "market", "quantity": "1"})
    current = act(paper, "advance", {"count": 1})["workspace"]
    for path in ("paper", "startingBalance", "datasetVersionId", "status"):
        tables = deepcopy(current["tables"])
        run = tables["practiceSessions"][0]
        run[path] = None if path == "paper" else "forged"
        with pytest.raises(WorkspaceError):
            paper.storage.save_tables(ORIGIN, tables, current["revision"], uuid4().hex)
    assert paper.storage.workspace()["tables"] == current["tables"]


def test_numeric_uuid_request_ids_are_stable_engine_command_identifiers(paper):
    start(paper)
    result = act(
        paper,
        "order",
        {"side": "buy", "orderType": "market", "quantity": "1"},
        request_id="00000000-0000-0000-0000-000000000001",
    )
    assert len(result["session"]["orders"]) == 1
    assert result["session"]["orders"][0]["status"] == "pending"


def test_pause_before_start_cannot_bypass_lifecycle(paper):
    ready(paper)
    with pytest.raises(WorkspaceError, match="start_required"):
        act(paper, "pause")
    assert paper.session(ORIGIN, 1)["session"]["status"] == "ready"


def test_negative_native_prices_refused_before_a_paper_book_or_ledger(storage):
    metadata = context()
    metadata["allowNegativePrices"] = True
    csv = "timestamp,open,high,low,close,volume\n2026-11-02T09:00:00Z,-100,-98,-102,-99,1\n2026-11-02T09:01:00Z,-100,-98,-102,-99,1"
    bind_run(storage, text=csv, metadata=metadata)
    service = PaperSessions(storage)
    before = storage.snapshot()
    with pytest.raises(WorkspaceError, match="nonpositive_history"):
        ready(service)
    assert storage.snapshot() == before
