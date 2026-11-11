# P14 Fundamentals and asset intelligence

Status: Planned. No implementation task is marked complete by this document.

Release: R3 company slice first; other assets staged. Dependencies: [P01](01-domain-and-contracts.md), [P13](13-research-data-platform.md).

[Master plan](MASTER_PLAN.md)

[First company delivery: detailed plan](p14/IMPLEMENTATION_PLAN.md). Specification only: source/access spike, sourced overview/statements/reports, saved research and original-chart/journal handoffs. No provider is certified by this plan.

## Outcome

Users investigate financial statements and asset-specific fundamentals, inspect original reports and compare consistent measures.

## Implementation areas and dependencies

P13 entity/fact/document APIs; existing holdings/portfolio research provides links but not a complete fundamentals platform.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Start with a defined issuer universe and official filings such as SEC EDGAR, then add sources for other jurisdictions through separate subplans.
- Financial facts keep taxonomy, period, currency, consolidation basis, fiscal calendar, amendments and source context.
- Each asset class has its own model: issuer statements, fund holdings/NAV, crypto supply/token economics, FX macro drivers and futures contract/term structure.

## Implementation checklist

- [x] **P14-T01** Define initial coverage and mapping for issuer/listings, financial statements, filing history and source report links. Done 2026-11-04: [coverage/mapping](p14/COVERAGE_AND_MAPPING.md) with ordered concept fallbacks for tag churn.

- [x] **P14-T02** Build financial-statement normalization for duration versus instant facts, fiscal quarters/years, unit scaling and consolidated versus segment data. Done 2026-11-04: `services/fundamentals.py` statement assembly (instant/duration spans classified, labelled presentation scaling, segment data explicitly unavailable for this source).

- [x] **P14-T03** Implement formulas for selected ratios/growth/TTM with versioned inputs and missing-value rules; distinguish reported versus calculated facts. Done 2026-11-04: versioned DerivedMetric formulas (margins, YoY growth, current ratio, debt/equity, FCF-TTM) citing input facts; missing inputs produce unavailable records, never zeros.

- [x] **P14-T04** Preserve restatements/corporate actions and historical availability; add as-reported versus latest-restated views. Done 2026-11-04: as-reported (`view=as-of`) vs latest-restated statement views over preserved restatement lineage; split-adjusted share series remain explicit derivations (P13-T05).

- [x] **P14-T05** Add earnings/corporate-event data with explicit source and timing; estimates, transcripts, ownership and news remain capability-gated provider additions. Done 2026-11-04: filing events API with accession/source/timing; estimates/transcripts/ownership/news returned as capability-gated unavailable.

- [x] **P14-T06** Create crypto intelligence subplan for supply/circulation/issuance/unlocks/funding/on-chain fields; record methodology and source coverage rather than inventing company-like ratios. Done 2026-11-04: [crypto subplan](p14/ASSET_CLASS_SUBPLANS.md) — fields/methodology/coverage gates; no source connected, nothing synthesized.

- [x] **P14-T07** Create subsequent fund/ETF, FX/rates and futures intelligence subplans with relevant units, calendars, roll/expiry and historical coverage. Done 2026-11-04: fund/ETF, FX/rates and futures subplans with units, calendars and roll rules in ASSET_CLASS_SUBPLANS.md.

- [x] **P14-T08** Publish per-field coverage/definitions and link facts/charts/reports into P16 comparisons and journal research snapshots. Done 2026-11-04 (API scope): per-field `/coverage` definitions + availability, statements/metrics carry document citations for P16 drill-through; journal research snapshots link when P16 lands.

## Acceptance criteria

- [x] A financial fact can be inspected against its original filing and units. Proven: statement lines carry factId + accession citation; HTTP journey test drills to the filing.
- [x] Quarter/year/TTM calculations handle fiscal calendars without double-counting periods. Proven: span classification + TTM prefers reported FY, else exactly four consecutive quarters; YTD spans never enter TTM.
- [x] Asset-specific missing datasets are clearly unavailable rather than synthesized. Segment data, estimates/transcripts/ownership/news and all T06/T07 classes report unavailable with reasons.

## Required verification scenarios

- Amended filings, duplicate taxonomy facts, different currencies and non-calendar fiscal years.
- Shares split, negative earnings, missing denominator and changed issuer identifiers.
- Point-in-time comparison and crypto metric methodology revision.

## Risks and decisions to resolve

- Global issuer/estimate coverage usually requires additional source evaluation.
- Standardized ratios can conceal accounting differences; retain definitions and basis.

## Scope boundary

Deferred from this package: Universal company coverage, unsupported analyst consensus, automatic investment recommendations and a single universal fundamental score.

## Completion evidence and handoff

Before marking P14 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified. Backend 4/4, frontend 2/2, lint clean, build green (2026-11-04).
- [x] Evidence recorded and downstream contracts/documentation updated. Logs in [p14/evidence](p14/evidence); thin P16 journey ships in `/fundamentals` (P16-T02 itself stays open for valuation inputs and related instruments).
- [x] Corresponding master checkbox updated only after acceptance.
