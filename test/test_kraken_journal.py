"""P08-T06 FIFO derivation: exact lots, partial closes, honest skips."""

from services.kraken_journal import derive_closed_trades

INFO = {
    "XXBTZUSD": {"symbol": "BTC/USD", "quoteCurrency": "USD"},
    "XETHZEUR": {"symbol": "ETH/EUR", "quoteCurrency": "EUR"},
}


def _fill(txid, at, side, price, volume, fee="0", pair="XXBTZUSD"):
    return {
        "txid": txid,
        "occurredAt": at,
        "pair": pair,
        "side": side,
        "price": price,
        "volume": volume,
        "fee": fee,
    }


def test_fifo_partial_close_across_two_lots():
    fills = [
        _fill("B2", "2026-11-02T00:00:00.000000Z", "buy", "120", "2", fee="0.4"),
        _fill("B1", "2026-11-01T00:00:00.000000Z", "buy", "100", "1", fee="0.1"),
        _fill("S1", "2026-11-03T00:00:00.000000Z", "sell", "150", "2", fee="0.6"),
    ]
    events, report = derive_closed_trades(
        fills, quote_currency="USD", pair_info=INFO, emit_sell_ids={"S1"}
    )
    assert report["closedTrades"] == 2
    assert report["unmatchedSellQuantity"] == "0"
    first, second = (event["normalizedTrade"] for event in events)
    # Lot B1 fully closed: gross (150-100)*1=50; fees 0.1 + 0.6*1/2=0.4.
    assert first["quantity"] == "1" and first["grossPnl"] == "50"
    assert first["fees"] == "0.4" and first["netPnl"] == "49.6"
    assert first["openedAt"] == "2026-11-01T00:00:00.000000Z"
    # Lot B2 half closed: gross (150-120)*1=30; fees 0.4*1/2 + 0.3 = 0.5.
    assert second["grossPnl"] == "30" and second["fees"] == "0.5"
    assert second["netPnl"] == "29.5"


def test_context_fills_replay_without_emitting_their_closures():
    fills = [
        _fill("B1", "2026-10-01T00:00:00.000000Z", "buy", "100", "2"),
        _fill("S-OLD", "2026-10-02T00:00:00.000000Z", "sell", "110", "1"),
        _fill("S-NEW", "2026-11-04T00:00:00.000000Z", "sell", "130", "1"),
    ]
    events, report = derive_closed_trades(
        fills, quote_currency="USD", pair_info=INFO, emit_sell_ids={"S-NEW"}
    )
    assert [event["externalEventId"] for event in events] == ["S-NEW:close:B1:0"]
    assert report["unmatchedSellQuantity"] == "0"


def test_unmatched_sell_and_foreign_quote_are_reported_not_projected():
    fills = [
        _fill("S1", "2026-11-04T00:00:00.000000Z", "sell", "100", "0.5"),
        _fill("E1", "2026-11-04T01:00:00.000000Z", "buy", "10", "1", pair="XETHZEUR"),
        _fill("E2", "2026-11-04T02:00:00.000000Z", "sell", "12", "1", pair="XETHZEUR"),
    ]
    events, report = derive_closed_trades(
        fills, quote_currency="USD", pair_info=INFO, emit_sell_ids={"S1", "E2"}
    )
    assert events == []
    assert report["unmatchedSellQuantity"] == "0.5"
    assert report["foreignQuoteFills"] == 2


def test_derived_rows_survive_the_real_journal_normalizer():
    """Mirror Connectors._project: CSV-serialize confirmed rows and run
    journal_import.normalize_statement with an identity mapping."""
    import csv
    import io

    from services.journal_import import normalize_statement

    fills = [
        _fill("B1", "2026-11-01T00:00:00.000000Z", "buy", "100", "1", fee="0.1"),
        _fill("S1", "2026-11-02T00:00:00.000000Z", "sell", "150", "1", fee="0.3"),
    ]
    events, _report = derive_closed_trades(
        fills, quote_currency="USD", pair_info=INFO, emit_sell_ids={"S1"}
    )
    rows = [event["normalizedTrade"] for event in events]
    fields = sorted(set().union(*(row.keys() for row in rows)))
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    preview = normalize_statement(
        stream.getvalue(),
        {
            "columns": {field: field for field in fields},
            "timezone": "UTC",
            "decimalSeparator": ".",
            "delimiter": ",",
            "quantityUnit": rows[0]["quantityUnit"],
        },
        {
            "provider": "kraken",
            "accountKey": "account_kraken1",
            "bookId": "book_kraken1",
            "portfolioId": 7,
            "accountId": 4,
            "currency": "USD",
        },
    )
    assert preview["canCommit"] is True, preview
    [projection] = preview["tradeProjections"]
    assert projection["amounts"]["netPnl"] == "49.6"
    assert projection["result"] == "Win"


def test_repeating_fee_allocation_beyond_18dp_is_skipped_exactly():
    fills = [
        _fill("B1", "2026-11-01T00:00:00.000000Z", "buy", "100", "3", fee="1"),
        _fill("S1", "2026-11-02T00:00:00.000000Z", "sell", "100", "1", fee="0"),
    ]
    events, report = derive_closed_trades(
        fills, quote_currency="USD", pair_info=INFO, emit_sell_ids={"S1"}
    )
    # Buy-fee share 1 * 1/3 repeats beyond 18dp: never rounded into the book.
    assert events == []
    assert report["precisionSkips"] == 1
