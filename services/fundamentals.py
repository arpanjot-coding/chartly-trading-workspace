"""Fundamentals statements and derived metrics over stored facts (P14).

Canonical statement lines map to ordered provider concepts (first match
wins, so taxonomy tag churn is explicit data, not code surprises).
Reported facts are never altered: scaling is presentation-only and
labelled, derived values are separate DerivedMetric records citing
their exact input facts, and anything that cannot be computed from
stored facts is unavailable with a reason — never zero.
"""

from __future__ import annotations

from decimal import Decimal, localcontext

from services.domain.validation import validate_record
from services.research_domain import ResearchError, select_facts_as_of

# Canonical line -> (statement, period kind, ordered concept candidates)
STATEMENT_CONCEPTS = {
    "revenue": (
        "income",
        "duration",
        [
            "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
            "us-gaap:Revenues",
            "us-gaap:SalesRevenueNet",
        ],
    ),
    "cost_of_revenue": (
        "income",
        "duration",
        ["us-gaap:CostOfRevenue", "us-gaap:CostOfGoodsAndServicesSold"],
    ),
    "gross_profit": ("income", "duration", ["us-gaap:GrossProfit"]),
    "operating_income": ("income", "duration", ["us-gaap:OperatingIncomeLoss"]),
    "net_income": ("income", "duration", ["us-gaap:NetIncomeLoss"]),
    "eps_diluted": ("income", "duration", ["us-gaap:EarningsPerShareDiluted"]),
    "total_assets": ("balance", "instant", ["us-gaap:Assets"]),
    "current_assets": ("balance", "instant", ["us-gaap:AssetsCurrent"]),
    "cash_and_equivalents": (
        "balance",
        "instant",
        ["us-gaap:CashAndCashEquivalentsAtCarryingValue"],
    ),
    "total_liabilities": ("balance", "instant", ["us-gaap:Liabilities"]),
    "current_liabilities": ("balance", "instant", ["us-gaap:LiabilitiesCurrent"]),
    "stockholders_equity": (
        "balance",
        "instant",
        ["us-gaap:StockholdersEquity", "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    ),
    "operating_cash_flow": (
        "cashflow",
        "duration",
        ["us-gaap:NetCashProvidedByUsedInOperatingActivities"],
    ),
    "capital_expenditures": (
        "cashflow",
        "duration",
        ["us-gaap:PaymentsToAcquirePropertyPlantAndEquipment"],
    ),
    "shares_outstanding": (
        "balance",
        "instant",
        ["dei:EntityCommonStockSharesOutstanding"],
    ),
}
CONCEPT_DEFINITIONS = {
    "revenue": "Revenue from contracts with customers (or legacy revenue tags), as reported.",
    "cost_of_revenue": "Direct costs of revenue, as reported.",
    "gross_profit": "Reported gross profit (never recomputed when absent).",
    "operating_income": "Reported operating income/loss.",
    "net_income": "Reported net income/loss attributable as filed.",
    "eps_diluted": "Reported diluted earnings per share.",
    "total_assets": "Total assets at period end (instant).",
    "current_assets": "Current assets at period end (instant).",
    "cash_and_equivalents": "Cash and equivalents at carrying value (instant).",
    "total_liabilities": "Total liabilities at period end (instant).",
    "current_liabilities": "Current liabilities at period end (instant).",
    "stockholders_equity": "Total stockholders' equity at period end (instant).",
    "operating_cash_flow": "Net cash from operating activities for the period.",
    "capital_expenditures": "Payments to acquire property, plant and equipment.",
    "shares_outstanding": "Common shares outstanding (cover-page, instant).",
}
SCALES = {"units": Decimal(1), "thousands": Decimal(1000), "millions": Decimal(1000000)}


def _fail(code):
    raise ResearchError("fundamentals." + code)


def _span_days(fact):
    from datetime import date

    if fact["periodKind"] != "duration" or not fact.get("periodStart"):
        return None
    return (date.fromisoformat(fact["periodEnd"]) - date.fromisoformat(fact["periodStart"])).days


def classify_span(fact):
    """quarter (~3mo), year (~12mo), ytd (other durations), instant."""
    if fact["periodKind"] == "instant":
        return "instant"
    days = _span_days(fact)
    if days is None:
        return "unknown"
    if 80 <= days <= 100:
        return "quarter"
    if 350 <= days <= 380:
        return "year"
    return "ytd"


def _scaled(value_text, scale_name):
    divisor = SCALES[scale_name]
    if divisor == 1:
        return value_text
    with localcontext() as context:
        context.prec = 50
        scaled = (Decimal(value_text) / divisor).quantize(Decimal("0.001"))
    return format(scaled.normalize(), "f")


def build_statement(facts, *, statement, as_of, span=None, scale="units"):
    """Assemble one statement view from point-in-time selected facts.

    Only exact-period reported facts are placed; a line with no matching
    concept/span is listed under `unavailable` with its reason. Values
    keep reported text; `displayValue` applies the labelled scale.
    """
    if scale not in SCALES:
        _fail("scale_invalid")
    selected = select_facts_as_of(facts, as_of=as_of)
    lines = []
    unavailable = []
    for line, (kind, period_kind, candidates) in STATEMENT_CONCEPTS.items():
        if kind != statement:
            continue
        # Freshest fact wins across all candidate concepts: taxonomy
        # tag churn must never resurrect a dead series (live-found:
        # CostOfRevenue ended 2018 while its successor tag is current).
        matches = [
            fact
            for fact in selected
            if fact["metricId"] in candidates
            and fact["periodKind"] == period_kind
            and (span is None or classify_span(fact) == span)
        ]
        found = (
            max(matches, key=lambda row: (row["periodEnd"], row["availableAt"]))
            if matches
            else None
        )
        if found is None:
            unavailable.append({"line": line, "reason": "no_reported_fact"})
            continue
        # Per-share values are never presentation-scaled (live-found:
        # EPS of 4.92 rendered as 0 under millions scaling).
        line_scale = "units" if "shares" in found["unit"] else scale
        lines.append(
            {
                "line": line,
                "concept": found["metricId"],
                "value": found["value"],
                "displayValue": _scaled(found["value"], line_scale),
                "scale": line_scale,
                "unit": found["unit"],
                "periodKind": found["periodKind"],
                "span": classify_span(found),
                "periodStart": found.get("periodStart"),
                "periodEnd": found["periodEnd"],
                "fiscalYear": found["fiscalYear"],
                "fiscalPeriod": found["fiscalPeriod"],
                "factId": found["id"],
                "documentVersionId": found["documentVersionId"],
                "citation": found["citation"],
                "basis": "reported",
            }
        )
    return {
        "statement": statement,
        "asOf": as_of,
        "span": span,
        "scale": scale,
        "lines": lines,
        "unavailable": unavailable,
        "segmentData": {
            "status": "unavailable",
            "reason": "SEC company-facts APIs return consolidated facts only; segment dimensions are not in this source.",
        },
    }


# ---------------------------------------------------------------------------
# Derived metrics (T03): versioned formulas over cited input facts
# ---------------------------------------------------------------------------

FORMULA_VERSION = "1.0"


def _find(facts, line, *, span=None, period_end=None):
    _kind, period_kind, candidates = STATEMENT_CONCEPTS[line]
    for concept in candidates:
        matches = [
            fact
            for fact in facts
            if fact["metricId"] == concept
            and fact["periodKind"] == period_kind
            and (span is None or classify_span(fact) == span)
            and (period_end is None or fact["periodEnd"] == period_end)
        ]
        if matches:
            return max(matches, key=lambda row: (row["periodEnd"], row["availableAt"]))
    return None


def _ttm(facts, line):
    """Trailing twelve months: reported FY fact preferred, else 4 quarters.

    Returns (value Decimal, input facts, basis) or (None, [], reason).
    YTD spans are never mixed into a TTM sum (double-counting guard).
    """
    year = _find(facts, line, span="year")
    if year is not None:
        return Decimal(year["value"]), [year], "reported_fy"
    _kind, _pk, candidates = STATEMENT_CONCEPTS[line]
    quarters = []
    for concept in candidates:
        quarters = [
            fact
            for fact in facts
            if fact["metricId"] == concept and classify_span(fact) == "quarter"
        ]
        if quarters:
            break
    quarters.sort(key=lambda row: row["periodEnd"])
    last_four = quarters[-4:]
    if len(last_four) < 4:
        return None, [], "missing_input"
    # Quarters must be consecutive-ish: each starts after the prior ends.
    for earlier, later in zip(last_four, last_four[1:], strict=False):
        if not (earlier["periodEnd"] < (later.get("periodStart") or later["periodEnd"])):
            return None, [], "missing_input"
    return sum(Decimal(f["value"]) for f in last_four), last_four, "sum_4q"


def _derived(*, metric_id, formula_id, issuer_id, owner_id, workspace_id, at, value, unit, inputs, available_at, reason=None):
    record = {
        "schemaVersion": 1,
        "id": metric_id,
        "ownerId": owner_id,
        "workspaceId": workspace_id,
        "revision": 1,
        "createdAt": at,
        "updatedAt": at,
        "issuerId": issuer_id,
        "inputFactIds": [row["id"] for row in inputs],
        "formulaId": formula_id,
        "formulaVersion": FORMULA_VERSION,
        "unit": unit,
        "availableAt": available_at,
    }
    if value is not None:
        # Canonical Decimal caps at 18 fractional digits: analytical
        # ratios quantize half-even to that bound (reported money sums
        # are integers and unaffected). Found live on real MSFT ratios.
        with localcontext() as context:
            context.prec = 80
            quantized = value.quantize(Decimal("1e-18"))
        record["value"] = format(quantized.normalize(), "f")
    else:
        record["unavailableReason"] = reason or "missing_input"
    issues = validate_record("DerivedMetric", record)
    if issues:
        _fail("canonical_invalid:" + ",".join(sorted({row["code"] for row in issues})))
    record["basis"] = "calculated"
    return record


def compute_metrics(facts, *, issuer_id, owner_id, workspace_id, at, id_prefix="derivedmetric"):
    """Selected ratios/growth/TTM as DerivedMetric records (or unavailable)."""
    selected = select_facts_as_of(facts, as_of=at)
    available_at = max((row["availableAt"] for row in selected), default=at)
    results = []

    def emit(name, value, unit, inputs, reason=None):
        results.append(
            _derived(
                metric_id=f"{id_prefix}-{name}",
                formula_id=name,
                issuer_id=issuer_id,
                owner_id=owner_id,
                workspace_id=workspace_id,
                at=at,
                value=value,
                unit=unit,
                inputs=inputs,
                available_at=available_at,
                reason=reason,
            )
        )

    with localcontext() as context:
        context.prec = 50
        # Margin family on the latest reported year (fall back to TTM inputs).
        revenue_ttm, rev_inputs, _basis = _ttm(selected, "revenue")
        for name, line in (
            ("gross-margin", "gross_profit"),
            ("operating-margin", "operating_income"),
            ("net-margin", "net_income"),
        ):
            numerator, num_inputs, _b = _ttm(selected, line)
            if revenue_ttm is None or numerator is None:
                emit(name, None, "pure", [], "missing_input")
            elif revenue_ttm == 0:
                emit(name, None, "pure", [], "zero_denominator")
            else:
                emit(name, numerator / revenue_ttm, "pure", rev_inputs + num_inputs)
        # Revenue growth YoY on reported years only.
        years = sorted(
            {
                fact["periodEnd"]: fact
                for fact in selected
                if fact["metricId"] in STATEMENT_CONCEPTS["revenue"][2]
                and classify_span(fact) == "year"
            }.values(),
            key=lambda row: row["periodEnd"],
        )
        if len(years) >= 2:
            prior, current = years[-2], years[-1]
            if Decimal(prior["value"]) == 0:
                emit("revenue-growth-yoy", None, "pure", [], "zero_denominator")
            else:
                emit(
                    "revenue-growth-yoy",
                    (Decimal(current["value"]) - Decimal(prior["value"]))
                    / abs(Decimal(prior["value"])),
                    "pure",
                    [prior, current],
                )
        else:
            emit("revenue-growth-yoy", None, "pure", [], "missing_input")
        # Balance ratios on the latest instant facts (same periodEnd required).
        ca = _find(selected, "current_assets")
        cl = _find(selected, "current_liabilities")
        if ca and cl and ca["periodEnd"] == cl["periodEnd"]:
            if Decimal(cl["value"]) == 0:
                emit("current-ratio", None, "pure", [], "zero_denominator")
            else:
                emit("current-ratio", Decimal(ca["value"]) / Decimal(cl["value"]), "pure", [ca, cl])
        else:
            emit("current-ratio", None, "pure", [], "missing_input")
        equity = _find(selected, "stockholders_equity")
        liabilities = _find(selected, "total_liabilities")
        if equity and liabilities and equity["periodEnd"] == liabilities["periodEnd"]:
            if Decimal(equity["value"]) == 0:
                emit("debt-to-equity", None, "pure", [], "zero_denominator")
            else:
                emit(
                    "debt-to-equity",
                    Decimal(liabilities["value"]) / Decimal(equity["value"]),
                    "pure",
                    [liabilities, equity],
                )
        else:
            emit("debt-to-equity", None, "pure", [], "missing_input")
        # Free cash flow TTM (operating cash flow minus capex payments).
        ocf, ocf_inputs, _b1 = _ttm(selected, "operating_cash_flow")
        capex, capex_inputs, _b2 = _ttm(selected, "capital_expenditures")
        if ocf is None or capex is None:
            emit("free-cash-flow-ttm", None, "USD", [], "missing_input")
        else:
            emit("free-cash-flow-ttm", ocf - capex, "USD", ocf_inputs + capex_inputs)
    return results


def series_history(facts, *, line, as_of):
    """Full reported history for one canonical line (P16-T07 overlay).

    One point per (periodEnd, span) from the point-in-time selection,
    plotted at periodEnd. Duration span is carried per point so a
    chart never silently mixes quarters with years.
    """
    if line not in STATEMENT_CONCEPTS:
        _fail("series_line_unknown")
    _kind, period_kind, candidates = STATEMENT_CONCEPTS[line]
    selected = select_facts_as_of(facts, as_of=as_of)
    # Freshest candidate series wins (same tag-churn rule as statements).
    chosen = None
    for concept in candidates:
        rows = [
            fact
            for fact in selected
            if fact["metricId"] == concept and fact["periodKind"] == period_kind
        ]
        if rows and (
            chosen is None
            or max(r["periodEnd"] for r in rows) > max(r["periodEnd"] for r in chosen[1])
        ):
            chosen = (concept, rows)
    if chosen is None:
        return {"line": line, "concept": None, "spanUsed": None, "points": []}
    concept, rows = chosen
    # One comparable span only: mixing quarters, YTD cumulations and
    # full years into one line produced a meaningless sawtooth
    # (live-found). Prefer quarters, then years; other spans excluded
    # and the chosen span declared in the response.
    by_span = {}
    for row in rows:
        by_span.setdefault(classify_span(row), []).append(row)
    span_used = None
    for preferred in ("quarter", "year", "instant"):
        if len(by_span.get(preferred, [])) >= 2:
            span_used = preferred
            break
    if span_used is None and by_span:
        span_used = max(by_span, key=lambda key: len(by_span[key]))
    rows = by_span.get(span_used, []) if span_used else []
    points = [
        {
            "date": row["periodEnd"],
            "value": row["value"],
            "unit": row["unit"],
            "span": classify_span(row),
            "fiscalYear": row["fiscalYear"],
            "fiscalPeriod": row["fiscalPeriod"],
            "factId": row["id"],
            "citation": row["citation"],
        }
        for row in sorted(rows, key=lambda r: (r["periodEnd"], r["availableAt"]))
    ]
    return {"line": line, "concept": concept, "spanUsed": span_used, "points": points}


def compare_line(bundles, *, line, as_of):
    """Cross-issuer comparison for one canonical line (P16-T05).

    Rows carry their own period, unit and citation; a unit mismatch is
    flagged per row and never converted. Missing data is a named gap,
    so completeness is visible instead of implied.
    """
    if line not in STATEMENT_CONCEPTS:
        _fail("compare_line_unknown")
    kind, _pk, _candidates = STATEMENT_CONCEPTS[line]
    rows = []
    units = set()
    for bundle in bundles:
        statement = build_statement(bundle["facts"], statement=kind, as_of=as_of)
        match = next((row for row in statement["lines"] if row["line"] == line), None)
        if match is None:
            rows.append(
                {
                    "issuerId": bundle["id"],
                    "issuer": bundle["issuer"]["name"],
                    "status": "unavailable",
                    "reason": "no_reported_fact",
                }
            )
            continue
        units.add(match["unit"])
        rows.append(
            {
                "issuerId": bundle["id"],
                "issuer": bundle["issuer"]["name"],
                "status": "available",
                "value": match["value"],
                "unit": match["unit"],
                "periodEnd": match["periodEnd"],
                "span": match["span"],
                "fiscalYear": match["fiscalYear"],
                "citation": match["citation"],
                "factId": match["factId"],
            }
        )
    return {
        "line": line,
        "asOf": as_of,
        "units": sorted(units),
        "comparable": len(units) <= 1,
        "comparabilityNote": (
            "All available rows share one reported unit; periods may still differ per issuer (see periodEnd)."
            if len(units) <= 1
            else "Reported units differ across issuers; values are NOT converted — compare with explicit caution."
        ),
        "rows": rows,
        "complete": all(row["status"] == "available" for row in rows),
    }


def field_coverage(facts, *, as_of):
    """Per-line coverage/definitions for T08 (present vs unavailable)."""
    selected = select_facts_as_of(facts, as_of=as_of)
    present = {row["metricId"] for row in selected}
    fields = []
    for line, (statement, _pk, candidates) in STATEMENT_CONCEPTS.items():
        matched = next((concept for concept in candidates if concept in present), None)
        fields.append(
            {
                "line": line,
                "statement": statement,
                "definition": CONCEPT_DEFINITIONS[line],
                "status": "available" if matched else "unavailable",
                "concept": matched,
                "candidates": candidates,
            }
        )
    return {"asOf": as_of, "fields": fields}
