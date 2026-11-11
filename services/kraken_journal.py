"""Derive closed journal trades from Kraken spot fills (P08-T06).

Pure FIFO lot matching for cash spot (long-only: a sell closes earlier
buys of the same pair). Only pairs quoted in the book's configured
currency produce journal trades; every fill remains a stored observation
regardless. Deposits/withdrawals are cashflow observations and never
enter trading profit. All math is exact Decimal text; a portion whose
amounts exceed the journal's 18-fraction-digit bound is skipped with an
explicit reason instead of being rounded.
"""

from __future__ import annotations

from collections import deque
from decimal import Decimal, InvalidOperation, localcontext


def _decimal(text):
    try:
        return Decimal(text)
    except (InvalidOperation, TypeError):
        return None


def _amount_text(value):
    """Exact plain text, or None beyond the journal's 18dp bound."""
    text = format(value.normalize(), "f")
    fraction = text.partition(".")[2]
    if len(fraction) > 18:
        return None
    return text


def derive_closed_trades(fills, *, quote_currency, pair_info, emit_sell_ids):
    """FIFO-match fills into closed-trade connector events.

    fills: [{txid, occurredAt, pair, side, price, volume, fee}] with exact
    decimal strings, any order. pair_info: native pair spelling ->
    {symbol, quoteCurrency}. Returns (events, report) where report counts
    unmatched sell quantity, foreign-quote fills and precision skips.
    Only sells whose txid is in `emit_sell_ids` produce events, so callers
    can replay older context fills without re-emitting their closures.
    """
    report = {"unmatchedSellQuantity": "0", "foreignQuoteFills": 0, "precisionSkips": 0}
    unmatched = Decimal(0)
    events = []
    lots = {}
    with localcontext() as context:
        context.prec = 60
        ordered = sorted(fills, key=lambda fill: (fill["occurredAt"], fill["txid"]))
        for fill in ordered:
            info = pair_info.get(fill["pair"])
            if info is None or info["quoteCurrency"] != quote_currency:
                report["foreignQuoteFills"] += 1
                continue
            quantity = _decimal(fill["volume"])
            price = _decimal(fill["price"])
            fee = _decimal(fill["fee"])
            if quantity is None or price is None or fee is None or quantity <= 0:
                report["precisionSkips"] += 1
                continue
            book = lots.setdefault(info["symbol"], deque())
            if fill["side"] == "buy":
                book.append(
                    {
                        "txid": fill["txid"],
                        "openedAt": fill["occurredAt"],
                        "remaining": quantity,
                        "volume": quantity,
                        "price": price,
                        "fee": fee,
                    }
                )
                continue
            # Sell: consume FIFO lots, one closed trade per matched portion.
            remaining = quantity
            portion_index = 0
            while remaining > 0 and book:
                lot = book[0]
                portion = min(remaining, lot["remaining"])
                buy_fee = lot["fee"] * portion / lot["volume"]
                sell_fee = fee * portion / quantity
                gross = (price - lot["price"]) * portion
                total_fees = buy_fee + sell_fee
                texts = {
                    "quantity": _amount_text(portion),
                    "entryPrice": _amount_text(lot["price"]),
                    "exitPrice": _amount_text(price),
                    "grossPnl": _amount_text(gross),
                    "fees": _amount_text(total_fees),
                    "netPnl": _amount_text(gross - total_fees),
                }
                if any(text is None for text in texts.values()):
                    report["precisionSkips"] += 1
                elif fill["txid"] in emit_sell_ids:
                    event_id = f"{fill['txid']}:close:{lot['txid']}:{portion_index}"
                    row = {
                        "eventId": event_id,
                        "eventType": "trade",
                        "positionId": f"kraken-{lot['txid']}-{fill['txid']}-{portion_index}",
                        "openedAt": lot["openedAt"],
                        "closedAt": fill["occurredAt"],
                        "symbol": info["symbol"],
                        "side": "Buy",
                        "quantity": texts["quantity"],
                        "entryPrice": texts["entryPrice"],
                        "exitPrice": texts["exitPrice"],
                        "grossPnl": texts["grossPnl"],
                        "commission": "0",
                        "fees": texts["fees"],
                        "swap": "0",
                        "netPnl": texts["netPnl"],
                        "currency": quote_currency,
                        "quantityUnit": "coins",
                    }
                    events.append(
                        {
                            "externalEventId": event_id,
                            "kind": "trade",
                            "status": "confirmed",
                            "occurredAt": fill["occurredAt"],
                            "timeBasis": "provider",
                            "payload": dict(row),
                            "normalizedTrade": row,
                        }
                    )
                portion_index += 1
                lot["remaining"] -= portion
                remaining -= portion
                if lot["remaining"] == 0:
                    book.popleft()
            if remaining > 0 and fill["txid"] in emit_sell_ids:
                unmatched += remaining
    report["unmatchedSellQuantity"] = _amount_text(unmatched) or "0"
    report["closedTrades"] = len(events)
    return events, report
