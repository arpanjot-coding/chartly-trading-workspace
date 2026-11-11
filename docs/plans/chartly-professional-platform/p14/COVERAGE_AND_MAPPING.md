# P14-T01/T02 — Fundamentals coverage and concept mapping

Decided 4 November 2026. Executable map: `services/fundamentals.py`
(`STATEMENT_CONCEPTS`, first matching concept wins per line).

## Initial coverage (SEC EDGAR only)

- Issuers: US-listed filers + foreign private issuers resolved by CIK,
  with ticker aliases from the Submissions API.
- Statements: income, balance sheet, cash flow — canonical lines in
  `STATEMENT_CONCEPTS` with per-field definitions served by
  `/issuers/<id>/coverage`.
- Filing history + source references: every statement line carries
  `factId`, document version and citation (accession + Archives URL);
  filing events expose publication/availability times.

## Normalization rules (T02)

- Instant vs duration is structural (`end`-only vs `start`+`end`) and
  validated at fact construction; spans classify as quarter (~90d),
  year (~365d) or `ytd` (anything else) — YTD facts are never silently
  treated as quarters.
- Tag churn is data: e.g. revenue tries
  `RevenueFromContractWithCustomerExcludingAssessedTax` →
  `Revenues` → `SalesRevenueNet` in declared order (Apple's legacy
  `Revenues` series ends FY2018 — observed live).
- Unit scaling (units/thousands/millions) is presentation-only and
  labelled on every line; stored values are always as reported.
- Segment data: **unavailable in this source** — SEC company-facts
  APIs exclude dimensions/custom taxonomies, statements say so
  explicitly instead of implying consolidated completeness.
- Views: `as-of` (point-in-time by `availableAt`) vs
  `latest-restated`; restatements keep full lineage either way.

## Derived metrics (T03, formula version 1.0)

Gross/operating/net margins, revenue YoY growth (reported years),
current ratio, debt-to-equity, free-cash-flow TTM. TTM prefers a
reported fiscal-year fact, else sums exactly four consecutive
quarters; anything else is `missing_input`. Every result is a
canonical `DerivedMetric` citing input fact ids, or an unavailable
record with reason (`missing_input`, `zero_denominator`, …).

## Events (T05)

Filing events (8-K/10-K/10-Q etc. from the stored index) with
accession, source URL and publication/availability times. Estimates,
transcripts, ownership and news are **capability-gated**: listed as
unavailable with reasons until a provider with those rights exists.
