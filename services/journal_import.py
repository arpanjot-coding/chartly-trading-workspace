"""Pure, bounded statement normalization and explicit event reconciliation.

This module performs no I/O and never executes supplied expressions. Source
economics remain exact decimal strings; review annotations belong to the caller.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import UTC, datetime
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation, localcontext
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MAX_CSV_BYTES = 8 * 1024 * 1024
MAX_ROWS = 20_000
MAX_COLUMNS = 100
MAX_CELL_CHARS = 64_000
MAX_PREVIOUS_EVENTS = 100_000
QUANTUM = Decimal("0.000000000000000001")
EVENT_TYPES = frozenset({"trade", "entry", "exit", "fee", "deposit", "withdrawal"})
SECRET_HEADERS = frozenset(
    {
        "password",
        "passwordhash",
        "apikey",
        "apisecret",
        "clientsecret",
        "accesstoken",
        "refreshtoken",
        "token",
        "authorization",
        "credentials",
        "totpsecret",
        "privatekey",
        "secret",
        "auth",
        "cookie",
        "sessioncookie",
        "appkey",
        "accountauthtag",
        "brokerapikey",
        "__proto__",
        "proto",
        "prototype",
        "constructor",
    }
)
QUANTITY_UNITS = frozenset({"lots", "units", "shares", "contracts", "coins"})
FIELDS = frozenset(
    {
        "eventId",
        "eventType",
        "positionId",
        "occurredAt",
        "openedAt",
        "closedAt",
        "symbol",
        "side",
        "quantity",
        "price",
        "entryPrice",
        "exitPrice",
        "grossPnl",
        "netPnl",
        "commission",
        "swap",
        "fees",
        "amount",
        "currency",
        "quantityUnit",
        "riskAmount",
        "orderId",
        "decisionId",
        "strategy",
        "notes",
        "sequence",
    }
)
MAPPING_FIELDS = frozenset(
    {
        "version",
        "name",
        "columns",
        "timezone",
        "delimiter",
        "decimalSeparator",
        "thousandsSeparator",
        "costConvention",
        "quantityUnit",
        "currency",
        "pnlMultiplier",
        "allowMixedCurrencies",
        "missingCostPolicy",
    }
)
MONEY_FIELDS = ("grossPnl", "netPnl", "commission", "swap", "fees", "riskAmount", "amount")
DECIMAL_FIELDS = MONEY_FIELDS + ("quantity", "price", "entryPrice", "exitPrice")


class JournalImportError(Exception):
    def __init__(self, code: str, message: str = "The statement cannot be accepted.", status=400):
        super().__init__(message)
        self.code = code
        self.status = status


def _canonical(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    )


def _hash(value):
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _decimal_text(value: Decimal):
    if value == 0:
        return "0"
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _rounded(value: Decimal):
    with localcontext() as context:
        context.prec = 200
        return value.quantize(QUANTUM, rounding=ROUND_HALF_EVEN)


def _text(value, field, *, required=False, maximum=500):
    if value is None or value == "":
        if required:
            raise JournalImportError(f"row.{field}_required", f"{field} is required.")
        return None
    if not isinstance(value, str):
        raise JournalImportError(f"row.{field}_invalid", f"{field} must be text.")
    value = value.strip()
    if not value and required:
        raise JournalImportError(f"row.{field}_required", f"{field} is required.")
    if len(value) > maximum or any(ord(char) < 32 and char not in "\n\r\t" for char in value):
        raise JournalImportError(
            f"row.{field}_invalid", f"{field} is too long or contains control bytes."
        )
    return value or None


def validate_mapping(mapping):
    if not isinstance(mapping, dict) or set(mapping) - MAPPING_FIELDS:
        raise JournalImportError("mapping.invalid", "Unsupported mapping fields.")
    result = deepcopy(mapping)
    if type(result.get("version", 1)) is not int or result.get("version", 1) != 1:
        raise JournalImportError("mapping.unsupported_version")
    result["version"] = 1
    columns = result.get("columns")
    if not isinstance(columns, dict) or not columns or set(columns) - FIELDS:
        raise JournalImportError(
            "mapping.invalid_columns", "Map supported canonical fields to CSV headers."
        )
    if "eventId" not in columns or "eventType" not in columns:
        raise JournalImportError(
            "mapping.identity_required", "Map eventId and eventType before importing."
        )
    if any(
        not isinstance(value, str) or not value.strip() or len(value) > 200
        for value in columns.values()
    ):
        raise JournalImportError("mapping.invalid_columns")
    if len(set(columns.values())) != len(columns):
        raise JournalImportError(
            "mapping.reused_column", "A source column cannot mean two different fields."
        )
    result["columns"] = {key: value.strip() for key, value in columns.items()}
    result.setdefault("name", "Universal statement")
    if not isinstance(result["name"], str) or not 1 <= len(result["name"].strip()) <= 120:
        raise JournalImportError("mapping.invalid_name")
    result["name"] = result["name"].strip()
    result.setdefault("delimiter", ",")
    if result["delimiter"] not in (",", ";", "\t", "|"):
        raise JournalImportError("mapping.invalid_delimiter")
    result.setdefault("decimalSeparator", ".")
    result.setdefault("thousandsSeparator", "")
    if (
        result["decimalSeparator"] not in (".", ",")
        or result["thousandsSeparator"] not in ("", ".", ",", " ")
        or result["decimalSeparator"] == result["thousandsSeparator"]
    ):
        raise JournalImportError("mapping.invalid_numeric_convention")
    result.setdefault("costConvention", "positive")
    if result["costConvention"] not in ("positive", "signed"):
        raise JournalImportError("mapping.invalid_cost_convention")
    result.setdefault("missingCostPolicy", "unknown")
    if result["missingCostPolicy"] not in ("unknown", "declared-zero"):
        raise JournalImportError("mapping.invalid_missing_cost_policy")
    result.setdefault("quantityUnit", "units")
    if result["quantityUnit"] not in QUANTITY_UNITS:
        raise JournalImportError("mapping.invalid_quantity_unit")
    if not isinstance(result.get("timezone"), str):
        raise JournalImportError(
            "mapping.timezone_required", "Choose the source timezone explicitly."
        )
    try:
        ZoneInfo(result["timezone"])
    except (ZoneInfoNotFoundError, ValueError, TypeError) as error:
        raise JournalImportError(
            "mapping.invalid_timezone", "Choose a valid IANA timezone."
        ) from error
    if "currency" in result:
        result["currency"] = _currency(result["currency"])
    if "currency" not in columns and not result.get("currency"):
        raise JournalImportError(
            "mapping.currency_required", "Map currency or declare the statement currency."
        )
    if type(result.get("allowMixedCurrencies", False)) is not bool:
        raise JournalImportError("mapping.invalid_currency_policy")
    result.setdefault("allowMixedCurrencies", False)
    if "pnlMultiplier" in result:
        multiplier = _number(
            result["pnlMultiplier"],
            "pnlMultiplier",
            {"decimalSeparator": ".", "thousandsSeparator": ""},
            required=True,
        )
        if multiplier <= 0:
            raise JournalImportError(
                "mapping.invalid_multiplier", "The declared P&L multiplier must be positive."
            )
        result["pnlMultiplier"] = _decimal_text(multiplier)
    return result


def _currency(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9]{2,11}", value.strip()):
        raise JournalImportError(
            "row.currency_invalid",
            "Currency/asset code must contain 3–12 letters or digits, starting with a letter.",
        )
    return value.strip().upper()


def _valid_symbol(value):
    # Exchange/terminal prefixes are data, not executable syntax. Keep common
    # $/^/#/slash qualifiers and Unicode identifiers without HTML/control bytes.
    return (
        isinstance(value, str)
        and re.fullmatch(r"[\w$#./@^][\w.$#:/@ ^!+=%&-]{0,99}", value) is not None
    )


def _number(value, field, mapping, *, required=False):
    if value is None or value == "":
        if required:
            raise JournalImportError(f"row.{field}_required", f"{field} is required.")
        return None
    if not isinstance(value, str) or len(value.strip()) > 100:
        raise JournalImportError(f"row.{field}_invalid", f"{field} must be decimal text.")
    raw = value.strip()
    decimal = mapping["decimalSeparator"]
    thousands = mapping["thousandsSeparator"]
    integer, separator, fraction = raw.partition(decimal)
    if thousands and thousands in integer:
        unsigned = integer.lstrip("+-")
        groups = unsigned.split(thousands)
        if (
            not 1 <= len(groups[0]) <= 3
            or any(len(group) != 3 for group in groups[1:])
            or any(not group.isascii() or not group.isdigit() for group in groups)
        ):
            raise JournalImportError(
                f"row.{field}_ambiguous",
                f"{field} does not match the declared thousands convention.",
            )
        integer = integer.replace(thousands, "")
    normalized = integer + ("." + fraction if separator else "")
    if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?", normalized, flags=re.ASCII):
        raise JournalImportError(
            f"row.{field}_invalid",
            f"{field} must use the declared decimal convention; exponents and nonfinite values are rejected.",
        )
    digits = normalized.lstrip("+-").replace(".", "").lstrip("0")
    if len(digits) > 34 or len(fraction) > 18:
        raise JournalImportError(
            f"row.{field}_precision", f"{field} exceeds supported 34-digit/18-decimal precision."
        )
    try:
        number = Decimal(normalized)
    except InvalidOperation as error:
        raise JournalImportError(f"row.{field}_invalid") from error
    if not number.is_finite():
        raise JournalImportError(f"row.{field}_invalid")
    return number


def _timestamp(value, field, timezone, *, required=False):
    raw = _text(value, field, required=required, maximum=100)
    if not raw:
        return None
    if not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?", raw
    ):
        raise JournalImportError(
            f"row.{field}_invalid",
            f"{field} requires an ISO date and time; use an explicit offset at a DST fold.",
        )
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise JournalImportError(
            f"row.{field}_invalid", f"{field} is not a valid date/time."
        ) from error
    if parsed.tzinfo is None:
        zone = ZoneInfo(timezone)
        candidates = {}
        for fold in (0, 1):
            candidate = parsed.replace(tzinfo=zone, fold=fold).astimezone(UTC)
            if candidate.astimezone(zone).replace(tzinfo=None) == parsed:
                candidates[candidate] = candidate
        if not candidates:
            raise JournalImportError(
                f"row.{field}_nonexistent", f"{field} falls in a nonexistent DST local time."
            )
        if len(candidates) != 1:
            raise JournalImportError(
                f"row.{field}_ambiguous",
                f"{field} is ambiguous at a DST fold; provide an explicit offset.",
            )
        parsed = next(iter(candidates))
    else:
        parsed = parsed.astimezone(UTC)
    # Fixed precision is required for correct lexical chronological sorting.
    return parsed.isoformat(timespec="microseconds").replace("+00:00", "Z")


def _context(context):
    if not isinstance(context, dict):
        raise JournalImportError("context.invalid")
    required = ("provider", "accountKey", "bookId")
    result = {}
    for field in required:
        value = context.get(field)
        if not isinstance(value, str) or not value.strip() or len(value) > 300:
            raise JournalImportError(
                "context.invalid", "The server must select a provider, account and journal book."
            )
        result[field] = value.strip()
    result["provider"] = result["provider"].lower()
    if (
        type(context.get("portfolioId")) is not int
        or not 0 < context["portfolioId"] <= 9_007_199_254_740_991
    ):
        raise JournalImportError("context.invalid")
    result["portfolioId"] = context["portfolioId"]
    if "accountId" in context:
        if type(context["accountId"]) is not int or context["accountId"] <= 0:
            raise JournalImportError("context.invalid")
        result["accountId"] = context["accountId"]
    if context.get("currency"):
        result["currency"] = _currency(context["currency"])
    return result


def _key(kind, context, external_id):
    return kind + "_" + _hash([context["provider"], context["accountKey"], external_id])[:48]


def _event_hash(event):
    return _hash(
        {
            key: value
            for key, value in event.items()
            if key
            not in {
                "source",
                "canonicalHash",
                "portfolioId",
                "accountId",
                "bookId",
                "id",
                "tradeId",
            }
        }
    )


def validate_normalized_event(event):
    """Check a stored canonical source event, including optional local wrappers.

    This verifies data integrity/schema, not provider authenticity or ownership.
    The caller must still bind the stored event to its authenticated book and
    validate parent links. Local IDs deliberately do not change source identity.
    """
    allowed = {
        "version",
        "provider",
        "accountKey",
        "bookId",
        "portfolioId",
        "accountId",
        "eventId",
        "eventKey",
        "type",
        "currency",
        "quantityUnit",
        "source",
        "positionId",
        "positionKey",
        "symbol",
        "side",
        "orderId",
        "decisionId",
        "strategy",
        "notes",
        "sequence",
        "pnlMultiplier",
        "occurredAt",
        "openedAt",
        "closedAt",
        "canonicalHash",
        "id",
        "tradeId",
        *DECIMAL_FIELDS,
    }
    required = {
        "version",
        "provider",
        "accountKey",
        "bookId",
        "portfolioId",
        "eventId",
        "eventKey",
        "type",
        "currency",
        "quantityUnit",
        "source",
        "occurredAt",
        "canonicalHash",
        "commission",
        "swap",
        "fees",
    }
    if (
        not isinstance(event, dict)
        or set(event) - allowed
        or required - set(event)
        or type(event.get("version")) is not int
        or event["version"] != 1
        or event.get("type") not in EVENT_TYPES
    ):
        raise JournalImportError(
            "event.invalid_schema", "Stored source event has an unsupported schema."
        )
    context = _context(event)
    if (
        event["provider"] != context["provider"]
        or event["currency"] != _currency(event["currency"])
        or event["quantityUnit"] not in QUANTITY_UNITS
    ):
        raise JournalImportError("event.invalid_scope")
    event_id = _text(event["eventId"], "eventId", required=True, maximum=300)
    if event_id != event["eventId"] or event["eventKey"] != _key("event", context, event_id):
        raise JournalImportError("event.invalid_identity")
    if (
        "id" in event
        and event["id"] != event["eventKey"]
        or "tradeId" in event
        and (type(event["tradeId"]) is not int or not 0 < event["tradeId"] <= 9_007_199_254_740_991)
    ):
        raise JournalImportError("event.invalid_local_identity")
    if "positionId" in event:
        position_id = _text(event["positionId"], "positionId", required=True, maximum=300)
        if position_id != event["positionId"] or event.get("positionKey") != _key(
            "position", context, position_id
        ):
            raise JournalImportError("event.invalid_position")
    elif "positionKey" in event or event["type"] in ("trade", "entry", "exit"):
        raise JournalImportError("event.invalid_position")
    numeric_mapping = {"decimalSeparator": ".", "thousandsSeparator": ""}
    for field in (*DECIMAL_FIELDS, "pnlMultiplier"):
        if field in event:
            if field in ("commission", "fees", "swap") and event[field] is None:
                continue
            value = _number(event[field], field, numeric_mapping, required=True)
            if _decimal_text(value) != event[field]:
                raise JournalImportError("event.noncanonical_decimal")
            if (
                field in ("quantity", "pnlMultiplier")
                and value <= 0
                or field == "riskAmount"
                and value < 0
            ):
                raise JournalImportError("event.invalid_amount")
    for field in ("occurredAt", "openedAt", "closedAt"):
        if field in event and _timestamp(event[field], field, "UTC", required=True) != event[field]:
            raise JournalImportError("event.noncanonical_timestamp")
    if event["type"] == "trade" and (
        "openedAt" not in event or event.get("closedAt") and event["closedAt"] < event["openedAt"]
    ):
        raise JournalImportError("event.invalid_timestamp_order")
    if event["type"] in ("trade", "entry", "exit"):
        if (
            event.get("side") not in ("Buy", "Sell")
            or not _valid_symbol(event.get("symbol"))
            or "quantity" not in event
        ):
            raise JournalImportError("event.invalid_execution")
    if event["type"] == "entry" and "price" not in event:
        raise JournalImportError("event.invalid_execution")
    if event["type"] in ("deposit", "withdrawal"):
        if (
            "amount" not in event
            or Decimal(event["amount"]) == 0
            or event["type"] == "deposit"
            and Decimal(event["amount"]) < 0
            or event["type"] == "withdrawal"
            and Decimal(event["amount"]) > 0
        ):
            raise JournalImportError("event.invalid_cashflow")
    if "sequence" in event and (
        type(event["sequence"]) is not int or not 0 <= event["sequence"] <= 999999999999999
    ):
        raise JournalImportError("event.invalid_sequence")
    for field in ("orderId", "decisionId", "strategy", "notes"):
        if (
            field in event
            and _text(
                event[field], field, required=True, maximum=20_000 if field == "notes" else 300
            )
            != event[field]
        ):
            raise JournalImportError("event.invalid_text")
    source = event["source"]
    if (
        not isinstance(source, dict)
        or not {"rowNumber", "sourceHash", "timezone", "raw"}.issubset(source)
        or set(source) - {"rowNumber", "sourceHash", "timezone", "raw", "missingCostPolicy"}
        or type(source["rowNumber"]) is not int
        or source["rowNumber"] <= 0
        or not isinstance(source["sourceHash"], str)
        or not re.fullmatch(r"[a-f0-9]{64}", source["sourceHash"])
        or not isinstance(source["raw"], dict)
        or not 1 <= len(source["raw"]) <= MAX_COLUMNS
    ):
        raise JournalImportError("event.invalid_source")
    if source.get("missingCostPolicy", "unknown") not in ("unknown", "declared-zero"):
        raise JournalImportError("event.invalid_source")
    try:
        ZoneInfo(source["timezone"])
    except (TypeError, ValueError, ZoneInfoNotFoundError) as error:
        raise JournalImportError("event.invalid_source") from error
    for header, raw in source["raw"].items():
        if (
            not isinstance(header, str)
            or not header.strip()
            or len(header) > 200
            or re.sub(r"[^a-z0-9]", "", header.lower()) in SECRET_HEADERS
            or not isinstance(raw, str)
            or len(raw) > MAX_CELL_CHARS
            or "\x00" in raw
        ):
            raise JournalImportError("event.invalid_source")
        try:
            raw.encode("utf-8")
        except UnicodeEncodeError as error:
            raise JournalImportError("event.invalid_source") from error
    if not isinstance(event["canonicalHash"], str) or event["canonicalHash"] != _event_hash(event):
        raise JournalImportError("event.hash_mismatch")
    return deepcopy(event)


def _normalize_row(row, mapping, context, row_number, source_hash):
    source = {field: row[header].strip() for field, header in mapping["columns"].items()}
    event_id = _text(source.get("eventId"), "eventId", required=True, maximum=300)
    event_type = _text(source.get("eventType"), "eventType", required=True)
    if event_type not in EVENT_TYPES:
        raise JournalImportError(
            "row.eventType_invalid",
            "Choose trade, entry, exit, fee, deposit or withdrawal explicitly.",
        )
    currency = _currency(source.get("currency") or mapping.get("currency"))
    expected_currency = context.get("currency") or mapping.get("currency")
    if expected_currency and not mapping["allowMixedCurrencies"] and currency != expected_currency:
        raise JournalImportError(
            "row.currency_mismatch",
            "Currency differs from the declared destination; enable explicit separate-currency reporting to import it.",
        )
    event = {
        "version": 1,
        **{key: context[key] for key in ("provider", "accountKey", "bookId", "portfolioId")},
        "eventId": event_id,
        "eventKey": _key("event", context, event_id),
        "type": event_type,
        "currency": currency,
        "quantityUnit": source.get("quantityUnit") or mapping["quantityUnit"],
        "source": {
            "rowNumber": row_number,
            "sourceHash": source_hash,
            "timezone": mapping["timezone"],
            "missingCostPolicy": mapping["missingCostPolicy"],
            "raw": deepcopy(row),
        },
    }
    if context.get("accountId") is not None:
        event["accountId"] = context["accountId"]
    if event["quantityUnit"] not in QUANTITY_UNITS:
        raise JournalImportError("row.quantityUnit_invalid")
    position_id = _text(source.get("positionId"), "positionId", maximum=300)
    if event_type == "trade":
        position_id = position_id or event_id
    if event_type in ("entry", "exit") and not position_id:
        raise JournalImportError(
            "row.positionId_required",
            "Execution rows need an explicit positionId; netting is never guessed.",
        )
    if position_id:
        event["positionId"] = position_id
        event["positionKey"] = _key("position", context, position_id)
    for field in ("orderId", "decisionId", "strategy", "notes"):
        value = _text(source.get(field), field, maximum=20_000 if field == "notes" else 300)
        if value is not None:
            event[field] = value
    if source.get("sequence"):
        if not re.fullmatch(r"[0-9]{1,15}", source["sequence"]):
            raise JournalImportError("row.sequence_invalid")
        event["sequence"] = int(source["sequence"])
    for field in DECIMAL_FIELDS:
        value = _number(source.get(field), field, mapping)
        if value is not None:
            event[field] = _decimal_text(value)
    for field in ("commission", "fees"):
        value = (
            Decimal(event[field])
            if field in event
            else Decimal(0)
            if mapping["missingCostPolicy"] == "declared-zero"
            else None
        )
        event[field] = (
            _decimal_text(-value if mapping["costConvention"] == "signed" else value)
            if value is not None
            else None
        )
    event.setdefault("swap", "0" if mapping["missingCostPolicy"] == "declared-zero" else None)
    if "riskAmount" in event and Decimal(event["riskAmount"]) < 0:
        raise JournalImportError(
            "row.riskAmount_invalid", "Risk can be unknown or zero but cannot be negative."
        )
    if "pnlMultiplier" in mapping and event_type in ("trade", "entry", "exit"):
        event["pnlMultiplier"] = mapping["pnlMultiplier"]
    for field in ("occurredAt", "openedAt", "closedAt"):
        value = _timestamp(source.get(field), field, mapping["timezone"])
        if value:
            event[field] = value
    if event_type == "trade":
        if not event.get("openedAt"):
            raise JournalImportError("row.openedAt_required")
        if event.get("closedAt") and event["closedAt"] < event["openedAt"]:
            raise JournalImportError("row.close_before_open")
        event.setdefault("occurredAt", event.get("closedAt") or event["openedAt"])
    elif not event.get("occurredAt"):
        raise JournalImportError("row.occurredAt_required")
    if event_type in ("trade", "entry", "exit"):
        symbol = _text(source.get("symbol"), "symbol", required=True, maximum=100)
        if not _valid_symbol(symbol):
            raise JournalImportError("row.symbol_invalid")
        event["symbol"] = symbol
        side = source.get("side", "")
        aliases = {
            "Buy": "Buy",
            "buy": "Buy",
            "BUY": "Buy",
            "Long": "Buy",
            "long": "Buy",
            "Sell": "Sell",
            "sell": "Sell",
            "SELL": "Sell",
            "Short": "Sell",
            "short": "Sell",
        }
        if side not in aliases:
            raise JournalImportError(
                "row.side_invalid", "Map a Buy/Sell or Long/Short side explicitly."
            )
        event["side"] = aliases[side]
        if "quantity" not in event or Decimal(event["quantity"]) <= 0:
            raise JournalImportError(
                "row.quantity_invalid", "Execution quantity must be greater than zero."
            )
    if event_type == "entry" and "price" not in event:
        raise JournalImportError(
            "row.price_required", "Entry execution needs its actual execution price."
        )
    if event_type == "entry":
        known = all(event[field] is not None for field in ("commission", "fees", "swap"))
        expected = (
            -Decimal(event["commission"]) - Decimal(event["fees"]) + Decimal(event["swap"])
            if known
            else None
        )
        if (
            "grossPnl" in event
            and Decimal(event["grossPnl"]) != 0
            or "netPnl" in event
            and expected is not None
            and Decimal(event["netPnl"]) != expected
        ):
            raise JournalImportError(
                "row.entry_pnl_invalid",
                "Entry rows may report paid costs but cannot contain realized price P&L.",
            )
    if event_type in ("deposit", "withdrawal"):
        if "amount" not in event or Decimal(event["amount"]) == 0:
            raise JournalImportError("row.amount_required")
        amount = Decimal(event["amount"])
        if event_type == "deposit" and amount < 0:
            raise JournalImportError("row.amount_direction")
        event["amount"] = _decimal_text(amount if event_type == "deposit" else -abs(amount))
        if any(
            event[field] is not None and Decimal(event[field]) != 0
            for field in ("commission", "swap", "fees")
        ):
            raise JournalImportError(
                "row.cashflow_costs_separate",
                "Record cashflow fees separately so cash transfers stay distinct from trading P&L.",
            )
    if event_type == "fee":
        if "grossPnl" in event and Decimal(event["grossPnl"]) != 0:
            raise JournalImportError("row.fee_gross_invalid")
        amounts = _economic_amounts(event, gross=Decimal(0))
        net = amounts["netPnl"]
        if net == 0 and not any(
            event[field] is not None and Decimal(event[field])
            for field in ("commission", "fees", "swap")
        ):
            raise JournalImportError("row.empty_fee")
        event["grossPnl"] = "0"
        event["netPnl"] = _decimal_text(net)
    event["canonicalHash"] = _event_hash(event)
    return event


def _decimal_or_none(value):
    return Decimal(value) if value is not None else None


def _add_or_none(first, second):
    return first + second if first is not None and second is not None else None


def _economic_amounts(event, *, gross=None, require_net=True):
    commission = _decimal_or_none(event.get("commission"))
    swap = _decimal_or_none(event.get("swap"))
    fees = _decimal_or_none(event.get("fees"))
    known = all(value is not None for value in (commission, swap, fees))
    reported_net = _decimal_or_none(event.get("netPnl"))
    if event.get("grossPnl") is not None:
        gross = Decimal(event["grossPnl"])
    elif reported_net is not None:
        # A reported net does not prove that missing fee components were zero.
        gross = reported_net + commission + fees - swap if known else None
    net = gross - commission - fees + swap if gross is not None and known else None
    if reported_net is not None:
        if net is not None and reported_net != net:
            raise JournalImportError(
                "row.netPnl_mismatch",
                "Net P&L differs from gross minus known commission/fees plus signed swap.",
            )
        net = reported_net
    if require_net and net is None:
        raise JournalImportError(
            "position.pnl_unknown",
            "Supply reported net P&L, or known costs/explicit declared-zero policy with reported gross or price/multiplier economics.",
        )
    return {"grossPnl": gross, "commission": commission, "swap": swap, "fees": fees, "netPnl": net}


def _string_amounts(values):
    result = {}
    for key, value in values.items():
        text = _decimal_text(value) if value is not None else None
        if text is not None:
            integer, _, fraction = text.lstrip("-").partition(".")
            if len(integer) > 40 or len(fraction) > 18:
                raise JournalImportError(
                    "position.amount_budget_exceeded",
                    "Derived amounts exceed the supported 40-integer/18-decimal reporting bounds.",
                )
        result[key] = text
    return result


def _sum_amounts(values):
    return {
        field: sum((item[field] for item in values), Decimal(0))
        if all(item[field] is not None for item in values)
        else None
        for field in ("grossPnl", "commission", "swap", "fees", "netPnl")
    }


def _realization(event, amounts, quantity, *, price=None, kind="exit"):
    return {
        "id": event["eventKey"],
        "closedAt": event.get("closedAt") or event["occurredAt"],
        "quantity": _decimal_text(quantity),
        **_string_amounts(amounts),
        "exitPrice": _decimal_text(price) if price is not None else None,
        "kind": kind,
        "sourceEventKey": event["eventKey"],
    }


def _project_position(events):
    summaries = [event for event in events if event["type"] == "trade"]
    executions = [event for event in events if event["type"] in ("entry", "exit")]
    fees = [event for event in events if event["type"] == "fee"]
    if len(summaries) > 1 or summaries and executions:
        raise JournalImportError(
            "position.ambiguous_mode",
            "A position needs one summary or explicit executions, never both.",
        )
    if not summaries and not executions:
        raise JournalImportError(
            "position.missing_parent",
            "A linked fee requires its existing trade/position source events.",
        )
    currencies = {event["currency"] for event in events}
    units = {event["quantityUnit"] for event in events if event["type"] != "fee"}
    symbols = {event["symbol"] for event in events if event.get("symbol")}
    if len(currencies) != 1 or len(units) != 1 or len(symbols) != 1:
        raise JournalImportError(
            "position.scope_mismatch",
            "All events in a position need the same currency, symbol and quantity unit.",
        )
    seed = (
        summaries[0]
        if summaries
        else min(
            (event for event in executions if event["type"] == "entry"),
            key=lambda event: (event["occurredAt"], event.get("sequence", 0), event["eventKey"]),
            default=None,
        )
    )
    if seed is None:
        raise JournalImportError(
            "position.missing_parent",
            "An exit requires its entry history; import the missing source events first.",
        )
    realizations = []
    realized_amounts = []
    total_quantity = Decimal(0)
    closed_quantity = Decimal(0)
    entry_value = Decimal(0)
    exit_value = Decimal(0)
    priced_closed_quantity = Decimal(0)
    opened_at = seed.get("openedAt") or min(
        event["occurredAt"] for event in executions if event["type"] == "entry"
    )
    closed_at = None
    if summaries:
        quantity = Decimal(seed["quantity"])
        total_quantity = quantity
        if seed.get("entryPrice") is not None:
            entry_value = quantity * Decimal(seed["entryPrice"])
        if seed.get("closedAt"):
            gross = None
            if all(key in seed for key in ("entryPrice", "exitPrice", "pnlMultiplier")):
                direction = Decimal(1) if seed["side"] == "Buy" else Decimal(-1)
                gross = _rounded(
                    direction
                    * (Decimal(seed["exitPrice"]) - Decimal(seed["entryPrice"]))
                    * quantity
                    * Decimal(seed["pnlMultiplier"])
                )
            amounts = _economic_amounts(seed, gross=gross)
            realized_amounts.append(amounts)
            realizations.append(
                _realization(
                    seed,
                    amounts,
                    quantity,
                    price=Decimal(seed["exitPrice"]) if "exitPrice" in seed else None,
                    kind="exit",
                )
            )
            closed_quantity = quantity
            closed_at = seed["closedAt"]
            if "exitPrice" in seed:
                exit_value = quantity * Decimal(seed["exitPrice"])
                priced_closed_quantity = quantity
        else:
            costs = _economic_amounts(seed, gross=Decimal(0), require_net=False)
            if (
                costs["grossPnl"] not in (None, Decimal(0))
                or costs["netPnl"] not in (None, Decimal(0))
                and any(costs[field] is None for field in ("commission", "fees", "swap"))
                and seed.get("grossPnl") != "0"
            ):
                raise JournalImportError(
                    "position.open_unrealized_pnl",
                    "An open summary cannot report realized price P&L; import partial exits as explicit executions.",
                )
            if costs["netPnl"] not in (None, Decimal(0)):
                realized_amounts.append(costs)
                realizations.append(_realization(seed, costs, Decimal(0), kind="fee"))
    else:
        by_time = defaultdict(list)
        for event in executions:
            by_time[event["occurredAt"]].append(event)
        if any(
            len(items) > 1
            and (
                any("sequence" not in item for item in items)
                or len({item.get("sequence") for item in items}) != len(items)
            )
            for items in by_time.values()
        ):
            raise JournalImportError(
                "position.ambiguous_sequence",
                "Execution rows with the same timestamp need distinct explicit sequence values.",
            )
        lots = []
        for event in sorted(
            executions,
            key=lambda item: (item["occurredAt"], item.get("sequence", 0), item["eventKey"]),
        ):
            quantity = Decimal(event["quantity"])
            if event["type"] == "entry":
                if total_quantity and total_quantity == closed_quantity:
                    raise JournalImportError(
                        "position.reopened_identity",
                        "A completed position ID cannot be reused for another lifecycle; provide a new explicit position ID.",
                    )
                if event["side"] != seed["side"]:
                    raise JournalImportError(
                        "position.direction_change",
                        "A reversing position needs an explicit new position ID; netting is never inferred.",
                    )
                lots.append(
                    {
                        "quantity": quantity,
                        "price": Decimal(event["price"]),
                        "commission": _decimal_or_none(event["commission"]),
                        "fees": _decimal_or_none(event["fees"]),
                        "swap": _decimal_or_none(event["swap"]),
                        "netCost": _economic_amounts(event, gross=Decimal(0), require_net=False)[
                            "netPnl"
                        ],
                    }
                )
                total_quantity += quantity
                entry_value += quantity * Decimal(event["price"])
                continue
            if event["side"] == seed["side"]:
                raise JournalImportError(
                    "position.exit_side", "Exit side must close the entry direction."
                )
            available = sum((lot["quantity"] for lot in lots), Decimal(0))
            if quantity > available:
                raise JournalImportError(
                    "position.over_closed",
                    "Exit quantity exceeds known open quantity; import missing entries or correct the mapping.",
                )
            needed = quantity
            basis = Decimal(0)
            allocated = {field: Decimal(0) for field in ("commission", "fees", "swap", "netCost")}
            while needed:
                lot = next(lot for lot in lots if lot["quantity"] > 0)
                take = min(needed, lot["quantity"])
                basis += take * lot["price"]
                for field in allocated:
                    if lot[field] is None:
                        allocated[field] = None
                        continue
                    share = (
                        lot[field]
                        if take == lot["quantity"]
                        else _rounded(lot[field] * take / lot["quantity"])
                    )
                    allocated[field] = _add_or_none(allocated[field], share)
                    lot[field] -= share
                lot["quantity"] -= take
                needed -= take
            gross = None
            if "price" in event and "pnlMultiplier" in event:
                direction = Decimal(1) if seed["side"] == "Buy" else Decimal(-1)
                gross = _rounded(
                    direction
                    * (Decimal(event["price"]) * quantity - basis)
                    * Decimal(event["pnlMultiplier"])
                )
            amounts = _economic_amounts(event, gross=gross, require_net=False)
            for field in ("commission", "fees", "swap"):
                amounts[field] = _add_or_none(amounts[field], allocated[field])
            amounts["netPnl"] = _add_or_none(amounts["netPnl"], allocated["netCost"])
            if amounts["netPnl"] is None:
                raise JournalImportError(
                    "position.pnl_unknown",
                    "Entry or exit costs are unknown. Supply reported execution net costs or explicitly declare omitted costs zero before deriving realized P&L.",
                )
            realized_amounts.append(amounts)
            price = Decimal(event["price"]) if "price" in event else None
            realizations.append(_realization(event, amounts, quantity, price=price))
            closed_quantity += quantity
            if price is not None:
                exit_value += quantity * price
                priced_closed_quantity += quantity
            closed_at = event["occurredAt"]
    for event in fees:
        amounts = _economic_amounts(event, gross=Decimal(0))
        realized_amounts.append(amounts)
        realizations.append(_realization(event, amounts, Decimal(0), kind="fee"))
    totals = _sum_amounts(realized_amounts)
    remaining = total_quantity - closed_quantity
    if remaining > 0:
        closed_at = None
    base_amounts = {
        **totals,
        "quantity": total_quantity,
        "entryPrice": _rounded(entry_value / total_quantity)
        if entry_value or "entryPrice" in seed or executions
        else None,
        "exitPrice": _rounded(exit_value / closed_quantity)
        if closed_quantity and priced_closed_quantity == closed_quantity
        else None,
        "riskAmount": Decimal(seed["riskAmount"]) if "riskAmount" in seed else None,
    }
    if not realizations:
        base_amounts["grossPnl"] = None
        base_amounts["netPnl"] = None
        for field in ("commission", "fees", "swap"):
            known = [_decimal_or_none(event.get(field)) for event in events]
            base_amounts[field] = (
                sum(known, Decimal(0)) if all(value is not None for value in known) else None
            )
    result = (
        "Open"
        if remaining
        else "Win"
        if totals["netPnl"] > 0
        else "Loss"
        if totals["netPnl"] < 0
        else "Break Even"
    )
    projection = {
        "positionKey": seed["positionKey"],
        "positionId": seed["positionId"],
        "sourceEventKeys": sorted(event["eventKey"] for event in events),
        "provider": seed["provider"],
        "accountKey": seed["accountKey"],
        "bookId": seed["bookId"],
        "portfolioId": seed["portfolioId"],
        "symbol": seed["symbol"],
        "direction": seed["side"],
        "currency": seed["currency"],
        "quantityUnit": seed["quantityUnit"],
        "openedAt": opened_at,
        "closedAt": closed_at,
        "remainingQuantity": _decimal_text(remaining),
        "closedQuantity": _decimal_text(closed_quantity),
        "result": result,
        "eventType": "trade",
        "amounts": _string_amounts(base_amounts),
        "realizations": sorted(realizations, key=lambda item: (item["closedAt"], item["id"])),
        "costAllocation": "fifo_proportional_18dp_half_even",
    }
    for field in ("accountId", "decisionId", "strategy"):
        if field in seed:
            projection[field] = seed[field]
    return projection


def normalize_statement(csv_text, mapping, context, previous_events=()):
    """Return a deterministic preview. Row errors never permit partial commit.

    ``context`` must come from authenticated root service ownership checks.
    Previous events are normalized records for exactly this provider/account/book.
    The caller retains immutable raw observations and review annotations separately.
    """
    with localcontext() as arithmetic:
        arithmetic.prec = 200
        return _normalize_statement(csv_text, mapping, context, previous_events)


def _normalize_statement(csv_text, mapping, context, previous_events):
    mapping = validate_mapping(mapping)
    context = _context(context)
    try:
        encoded = csv_text.encode("utf-8") if isinstance(csv_text, str) else None
    except UnicodeEncodeError as error:
        raise JournalImportError(
            "statement.invalid_unicode", "CSV must be valid UTF-8 text."
        ) from error
    if encoded is None or len(encoded) > MAX_CSV_BYTES or "\x00" in csv_text:
        raise JournalImportError(
            "statement.invalid_size", "CSV must be text no larger than 8 MiB.", 413
        )
    if not isinstance(previous_events, (list, tuple)) or len(previous_events) > MAX_PREVIOUS_EVENTS:
        raise JournalImportError("statement.previous_events_invalid")
    previous = {}
    for event in previous_events:
        validate_normalized_event(event)
        if (
            not isinstance(event, dict)
            or any(event.get(key) != context[key] for key in ("provider", "accountKey", "bookId"))
            or event.get("eventKey") != _key("event", context, event.get("eventId"))
            or event.get("canonicalHash") != _event_hash(event)
        ):
            raise JournalImportError(
                "statement.previous_scope_invalid",
                "Previous events must be intact and scoped to the selected account/provider/book.",
            )
        if event["eventKey"] in previous:
            raise JournalImportError("statement.previous_duplicate")
        previous[event["eventKey"]] = deepcopy(event)
    source_hash = hashlib.sha256(csv_text.encode("utf-8")).hexdigest()
    stream = io.StringIO(csv_text.lstrip("\ufeff"), newline="")
    reader = csv.DictReader(stream, delimiter=mapping["delimiter"], strict=True)
    try:
        headers = reader.fieldnames
        if (
            not headers
            or len(headers) > MAX_COLUMNS
            or any(not header.strip() or len(header) > 200 for header in headers)
            or len(set(headers)) != len(headers)
        ):
            raise JournalImportError(
                "statement.invalid_headers", "CSV needs unique nonblank headers."
            )
        if any(re.sub(r"[^a-z0-9]", "", header.lower()) in SECRET_HEADERS for header in headers):
            raise JournalImportError(
                "statement.credentials_forbidden",
                "Credential columns are not part of a portable trading statement.",
            )
        if set(mapping["columns"].values()) - set(headers):
            raise JournalImportError(
                "mapping.header_missing", "A mapped column is not present in this statement."
            )
        raw_rows = []
        for row in reader:
            if len(raw_rows) >= MAX_ROWS:
                raise JournalImportError(
                    "statement.too_many_rows",
                    "Import at most 20,000 source rows per statement.",
                    413,
                )
            if not row or all(value == "" or value is None for value in row.values()):
                continue
            if None in row or any(
                value is None or len(value) > MAX_CELL_CHARS for value in row.values()
            ):
                raise JournalImportError(
                    "statement.invalid_row_shape",
                    "Every row must have the declared columns and bounded cell values.",
                )
            raw_rows.append((reader.line_num, row))
    except csv.Error as error:
        raise JournalImportError(
            "statement.malformed_csv", "CSV quotes or field sizes are malformed."
        ) from error
    if not raw_rows:
        raise JournalImportError("statement.empty", "The statement contains no source rows.")
    rows = []
    proposed = {}
    first_rows = {}
    for row_number, raw in raw_rows:
        output = {"rowNumber": row_number, "action": "error", "errors": []}
        try:
            event = _normalize_row(raw, mapping, context, row_number, source_hash)
            key = event["eventKey"]
            output.update(eventKey=key, event=event)
            if key in proposed:
                if proposed[key]["canonicalHash"] == event["canonicalHash"]:
                    output["action"] = "unchanged"
                    output["duplicateOfRow"] = rows[first_rows[key]]["rowNumber"]
                else:
                    output["action"] = "conflict"
                    output["errors"].append(
                        {
                            "code": "row.conflicting_duplicate",
                            "message": "This statement repeats one event ID with different facts.",
                        }
                    )
                    rows[first_rows[key]]["action"] = "conflict"
                    rows[first_rows[key]]["errors"].append(
                        {
                            "code": "row.conflicting_duplicate",
                            "message": "This statement repeats one event ID with different facts.",
                        }
                    )
            else:
                prior = previous.get(key)
                output["action"] = (
                    "insert"
                    if prior is None
                    else "unchanged"
                    if prior["canonicalHash"] == event["canonicalHash"]
                    else "correction"
                )
                if prior:
                    output["previousHash"] = prior["canonicalHash"]
                if prior:
                    # Account facts stay in their original environment when the
                    # same account book is opened through another profile.
                    for field in ("portfolioId", "accountId"):
                        if field in prior:
                            event[field] = prior[field]
                    event["canonicalHash"] = _event_hash(event)
                proposed[key] = prior if prior and output["action"] == "unchanged" else event
                first_rows[key] = len(rows)
        except JournalImportError as error:
            output["errors"].append({"code": error.code, "message": str(error)})
        rows.append(output)
    merged = {**previous, **proposed}
    groups = defaultdict(list)
    cashflows = []
    for event in merged.values():
        if (
            event["type"] in ("deposit", "withdrawal")
            or event["type"] == "fee"
            and not event.get("positionKey")
        ):
            net = event["amount"] if event["type"] in ("deposit", "withdrawal") else event["netPnl"]
            cashflows.append(
                {
                    "id": event["eventKey"],
                    "sourceEventKeys": [event["eventKey"]],
                    "eventType": event["type"],
                    "occurredAt": event["occurredAt"],
                    "currency": event["currency"],
                    "amount": net,
                    "tradingEffect": event["type"] == "fee",
                    "bookId": event["bookId"],
                    "portfolioId": event["portfolioId"],
                    **(
                        {
                            "amounts": {
                                **_string_amounts(_economic_amounts(event, gross=Decimal(0))),
                                "riskAmount": None,
                                "quantity": None,
                                "entryPrice": None,
                                "exitPrice": None,
                            }
                        }
                        if event["type"] == "fee"
                        else {}
                    ),
                }
            )
        else:
            groups[event["positionKey"]].append(event)
    projections = []
    position_errors = []
    for key, events in sorted(groups.items()):
        try:
            projections.append(_project_position(events))
        except JournalImportError as error:
            position_errors.append({"positionKey": key, "code": error.code, "message": str(error)})
            keys = {event["eventKey"] for event in events}
            for row in rows:
                if row.get("eventKey") in keys:
                    row["action"] = "error"
                    row["errors"].append({"code": error.code, "message": str(error)})
    totals = defaultdict(
        lambda: {
            field: Decimal(0)
            for field in (
                "grossPnl",
                "commission",
                "swap",
                "fees",
                "netPnl",
                "deposits",
                "withdrawals",
                "unallocatedFees",
            )
        }
    )
    for projection in projections:
        for field in ("grossPnl", "commission", "swap", "fees", "netPnl"):
            amount = projection["amounts"][field]
            totals[projection["currency"]][field] = _add_or_none(
                totals[projection["currency"]][field], _decimal_or_none(amount)
            )
    for flow in cashflows:
        field = (
            "deposits"
            if flow["eventType"] == "deposit"
            else "withdrawals"
            if flow["eventType"] == "withdrawal"
            else "unallocatedFees"
        )
        totals[flow["currency"]][field] += Decimal(flow["amount"])
        if flow["eventType"] == "fee":
            for component in ("grossPnl", "commission", "swap", "fees", "netPnl"):
                totals[flow["currency"]][component] = _add_or_none(
                    totals[flow["currency"]][component],
                    _decimal_or_none(flow["amounts"][component]),
                )
    counts = Counter(row["action"] for row in rows)
    return {
        "format": "chartly-statement-preview",
        "version": 1,
        "sourceHash": source_hash,
        "mapping": mapping,
        "context": context,
        "headers": headers,
        "rows": rows,
        "events": sorted(merged.values(), key=lambda event: event["eventKey"]),
        "tradeProjections": projections,
        "cashflows": sorted(cashflows, key=lambda flow: (flow["occurredAt"], flow["id"])),
        "totals": {
            "byCurrency": {
                currency: _string_amounts(values) for currency, values in sorted(totals.items())
            },
            "scope": "merged provider/account/book history, not only the uploaded file",
        },
        "counts": {
            key: counts.get(key, 0)
            for key in ("insert", "unchanged", "correction", "conflict", "error")
        },
        "positionErrors": position_errors,
        "canCommit": not position_errors and not any(row["errors"] for row in rows),
        "requiresCorrectionConfirmation": counts["correction"] > 0,
        "calculationPolicy": {
            "moneyScale": 18,
            "rounding": "half_even",
            "costs": "net = gross - commission - fees + signed swap",
            "missingCosts": "unknown unless explicitly declared-zero; reported P&L remains source-authoritative",
            "executionAllocation": "FIFO; explicit position IDs; same-time executions require sequence",
        },
    }
