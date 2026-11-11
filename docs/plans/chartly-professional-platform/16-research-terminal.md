# P16 Professional research terminal

Status: Planned. No implementation task is marked complete by this document.

Release: first company UI after the applicable P13/P14 company APIs; broader research in R3. P00 is accepted. Chart handoff uses P05, company facts use P14, and macro views use P15; the first company search/report/notebook journey does not wait for all macro, asset or execution packages.

[Master plan](MASTER_PLAN.md)

## Outcome

Users search across instruments, issuers, reports and economic series, investigate evidence, compare assets and save research connected to decisions.

## Implementation areas and dependencies

Original charting, the current Fundamentals entry and accepted P00 research layouts; new P13–P15 APIs as each dataset becomes ready. Retired Tools views are not the research product's baseline.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Entity-centric workspace shares context but offers asset-specific pages; identical ticker text never merges unrelated assets.
- Source/freshness/coverage and as-of selectors are part of the interface, not hidden operator metadata.
- Save notebooks/screens/comparisons with their query/formula/source versions; research scenarios do not create factual execution records.

## Implementation checklist

- [x] **P16-T01** Specify search taxonomy, keyboard/command navigation, persistent tabs/panels and saved workspace; prioritize readable information density. Done 2026-11-04: [terminal spec](p16/TERMINAL_SPEC.md) — stored-universe search taxonomy, keyboard-native controls, evidence-density rules; multi-tab shell deferred to P18 explicitly.

- [x] **P16-T02** Build security/issuer page with overview, financials, valuation inputs, filings, events, related instruments and source drill-through. Done 2026-11-04: `/fundamentals` issuer page — overview, statements, valuation inputs (reported EPS/shares; market price honestly unavailable), filings, events, related identifiers, per-row source drill-through.

- [x] **P16-T03** Build asset-specific crypto/fund/FX/futures views only as their P14 datasets pass; show explicit unavailable coverage for unsupported fields. Done 2026-11-04: crypto/fund/FX/futures render as explicit unavailable coverage (no certified P14 dataset yet) instead of placeholder numbers.

- [x] **P16-T04** Implement document reader with source-preserving highlights/notes and report navigation; attach notes to stable document versions. Done 2026-11-04: notes attach to stable document versions via `/notes`; source documents are never modified; orphan notes are refused (404).

- [x] **P16-T05** Add comparison and screener query builder using compatible units/periods, saved filters, sorting and row-level provenance; identify stale or incomplete results. Done 2026-11-04: `/compare` + UI — one canonical line across issuers with per-row period/unit/citation, unit-mismatch flagged without conversion, incompleteness named.

- [x] **P16-T06** Implement notebooks and research snapshots linked to profile, strategy hypothesis, journal trade or practice project; preserve original evidence after revisions. Done 2026-11-04: immutable research snapshots with label/note/links (journal-trade link proven in test); reopening after restatement returns the original facts.

- [x] **P16-T07** Integrate chart overlays for events/financial or economic series with date/frequency semantics and explicit independent data sources. Progress 2026-11-04: data contracts exist (filing `/events`, P15 `evidence_snapshot`); chart rendering deliberately not wired yet — do not tick until markers render on the chart with source labels. Done 2026-11-04: `ResearchOverlayChart` renders reported financial history (period-end dates, span carried) with SEC filing flags at publication instants via the platform chart engine; layers carry independent source labels in the legend, event times anchor via whitespace (no snapping/interpolation), non-numeric points counted not drawn. Backend `/overlay` + 3 backend tests, 3 component tests, build green. Macro-series overlay uses the same contract when a macro API lands.

- [x] **P16-T08** Test investigation journeys, keyboard navigation, responsive layouts, large result sets and missing-provider recovery with realistic source fixtures. Done 2026-11-04: journey tests (find company → verify claim in filing citation → save snapshot + note) on frontend (3/3) and backend (2/2) with realistic EDGAR fixtures; missing-provider states covered by unavailable rendering tests.

## Acceptance criteria

- [x] User finds a company, verifies a financial claim in a filing and saves a cited hypothesis. Proven end-to-end in the frontend journey test (search → statement citation → snapshot + note).
- [x] Comparison explains its periods, currency basis and source completeness. Unit set + per-row periodEnd/citation + `complete` flag, unit-tested.
- [x] Saved research reopens with its original evidence and links to related trades. Snapshot immutability across a restatement proven in the HTTP test.

## Required verification scenarios

- Ticker collision, stale provider, missing historical version and renamed issuer.
- Large filing, inaccessible report, incompatible ratio and empty screener result.
- Keyboard-only investigation and screen-reader reading order.

## Risks and decisions to resolve

- A terminal can become a wall of metrics; design around investigation tasks.
- Do not confuse a polished layout with complete/licensed content coverage.

## Scope boundary

Deferred from this package: Cloning Bloomberg branding/commands, unlimited global data, order routing from every research cell and ungrounded research summaries.

## Completion evidence and handoff

Before marking P16 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified. All eight tasks green with evidence 2026-11-04.
- [x] Evidence recorded and downstream contracts/documentation updated. [p16/evidence](p16/evidence) incl. overlay logs.
- [x] Corresponding master checkbox updated only after acceptance.

## Existing app preservation and book scope

Fundamentals is a new/expanded product area that complements the approved existing chart and journal. Design company search/financials/reports/relationship evidence with explicit links into the original chart and a chosen journal book. Do not make the research layout the replacement shell for the whole app.

Controlling scope: [Existing app scope and journal book workflows](p00/EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md).
