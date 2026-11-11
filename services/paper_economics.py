"""Execution facts must fit the existing exact journal contract before acceptance."""

from decimal import Decimal, localcontext

from services.journal_import import JournalImportError, _number
from services.paper_engine import _quote
from services.workspace_storage import WorkspaceError

DECIMAL_CONVENTION = {"decimalSeparator": ".", "thousandsSeparator": ""}


def journal_decimal(value, field):
    try:
        _number(value, field, DECIMAL_CONVENTION, required=True)
    except JournalImportError as error:
        raise WorkspaceError("paper.journal_precision_unsupported", 409) from error


def execution_prices(config, prices):
    seen = set()
    with localcontext() as context:
        context.prec = 100
        for price in prices:
            if price in seen:
                continue
            seen.add(price)
            for side in ("buy", "sell"):
                number = _quote(config, side, Decimal(price))
                text = format(number, "f")
                text = text.rstrip("0").rstrip(".") if "." in text else text
                journal_decimal(text, "price")


def command_precision(config, payload):
    if "quantity" in payload:
        journal_decimal(payload["quantity"], "quantity")
    prices = [
        payload[name]
        for name in ("limitPrice", "stopPrice", "stopLoss", "takeProfit")
        if name in payload
    ]
    for value in prices:
        journal_decimal(value, "price")
    execution_prices(config, prices)
