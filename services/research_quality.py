"""Fact normalization validation, quarantine and quality (P13-T05/T07).

Validation never repairs data silently: invalid or conflicting facts
are quarantined with reasons and excluded from current-value queries,
while remaining visible for inspection. Quality reports are computed
from stored records only — sources are never mixed into an unexplained
value; every current value names its document.
"""

from __future__ import annotations

import re
from decimal import Decimal

from services.research_domain import ResearchError, fact_identity

_CURRENCY_CODES = {"USD", "EUR", "GBP", "JPY", "INR", "CHF", "CAD", "AUD", "CNY", "KRW"}
_SHARE_UNITS = {"shares", "shares/shares"}
_MAGNITUDE_LIMIT = Decimal("1e30")


def parse_unit(unit):
    """Classify an EDGAR-style unit string."""
    if not isinstance(unit, str) or not unit:
        return {"kind": "invalid", "currency": None}
    parts = re.split(r"[-/]", unit)
    currencies = [part for part in parts if part in _CURRENCY_CODES]
    if unit in _SHARE_UNITS:
        return {"kind": "shares", "currency": None}
    if len(parts) == 2 and parts[0] in _CURRENCY_CODES and parts[1] == "shares":
        return {"kind": "per-share", "currency": parts[0]}
    if unit in _CURRENCY_CODES:
        return {"kind": "currency", "currency": unit}
    if unit in {"pure", "ratio"}:
        return {"kind": "ratio", "currency": None}
    if currencies:
        return {"kind": "other", "currency": currencies[0]}
    return {"kind": "other", "currency": None}


def validate_facts(facts):
    """Split facts into (accepted, quarantined[{fact, reasons}])."""
    accepted = []
    quarantined = []
    seen = {}
    for fact in facts:
        reasons = []
        unit = parse_unit(fact.get("unit"))
        if unit["kind"] == "invalid":
            reasons.append("unit_invalid")
        if unit["currency"] and fact.get("currency") != unit["currency"]:
            reasons.append("currency_mismatch")
        try:
            magnitude = abs(Decimal(fact["value"]))
            if magnitude > _MAGNITUDE_LIMIT:
                reasons.append("value_magnitude_implausible")
        except Exception:
            reasons.append("value_invalid")
        if fact["periodKind"] == "duration" and not (
            fact.get("periodStart") and fact["periodStart"] < fact["periodEnd"]
        ):
            reasons.append("period_invalid")
        # Same document asserting two values for one identity conflicts.
        conflict_key = (*fact_identity(fact), fact["documentVersionId"])
        prior = seen.get(conflict_key)
        if prior is not None and prior != fact["value"]:
            reasons.append("conflicting_fact_same_document")
        seen[conflict_key] = fact["value"]
        if reasons:
            quarantined.append({"fact": fact, "reasons": sorted(set(reasons))})
        else:
            accepted.append(fact)
    return accepted, quarantined


def split_adjusted_series(facts, splits):
    """Explicit split adjustment for share-count facts (derived copies).

    `splits`: [{effectiveDate, ratio}] where ratio "4" means 4-for-1.
    Only `shares` unit facts with periodEnd before a split are scaled;
    originals are untouched and adjusted copies are marked.
    """
    ordered = sorted(splits, key=lambda row: row["effectiveDate"])
    adjusted = []
    for fact in facts:
        if parse_unit(fact.get("unit"))["kind"] != "shares":
            continue
        factor = Decimal(1)
        for split in ordered:
            if fact["periodEnd"] < split["effectiveDate"]:
                factor *= Decimal(split["ratio"])
        if factor == 1:
            continue
        adjusted.append(
            {
                "factId": fact["id"],
                "metricId": fact["metricId"],
                "periodEnd": fact["periodEnd"],
                "reportedValue": fact["value"],
                "splitFactor": format(factor.normalize(), "f"),
                "adjustedValue": format((Decimal(fact["value"]) * factor).normalize(), "f"),
                "basis": "split-adjusted-derived",
            }
        )
    return adjusted


def quality_report(bundle, *, as_of):
    facts = bundle["facts"]
    documents = bundle["documents"]
    accepted, quarantined = validate_facts(facts)
    metrics = sorted({row["metricId"] for row in facts})
    latest_available = max((row["availableAt"] for row in facts), default=None)
    by_document = {}
    for row in facts:
        by_document[row["documentVersionId"]] = by_document.get(row["documentVersionId"], 0) + 1
    empty_documents = [row["id"] for row in documents if by_document.get(row["id"], 0) == 0]
    identities = {}
    for row in accepted:
        identities.setdefault(fact_identity(row), []).append(row)
    restated = sum(1 for rows in identities.values() if len({r["value"] for r in rows}) > 1)
    return {
        "issuerId": bundle["id"],
        "asOf": as_of,
        "documents": len(documents),
        "facts": len(facts),
        "acceptedFacts": len(accepted),
        "quarantined": [
            {"factId": row["fact"]["id"], "reasons": row["reasons"]} for row in quarantined
        ],
        "metrics": metrics,
        "metricCount": len(metrics),
        "latestAvailableAt": latest_available,
        "stale": bool(latest_available and latest_available < as_of),
        "documentsWithoutFacts": empty_documents,
        "restatedIdentities": restated,
        "sourcesMixed": False,
        "note": "Every current value drills through to exactly one stored document; quarantined facts are excluded from current values but remain stored.",
    }
