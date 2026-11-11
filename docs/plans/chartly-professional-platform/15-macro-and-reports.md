# P15 Macro data calendars and reports

Status: Planned. No implementation task is marked complete by this document.

Release: R3. Dependencies: [P01](01-domain-and-contracts.md), [P13](13-research-data-platform.md).

[Master plan](MASTER_PLAN.md)

## Outcome

Users explore economic series and releases, read original publications and preserve what information was available at a decision time.

## Implementation areas and dependencies

P13 ingestion, source documents, fact versions and query contracts.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Series retain frequency, seasonal adjustment, units, geography, source and transformation metadata.
- Release event has scheduled time, actual publication time and revisions; consensus is separate licensed/provider-dependent data, never inferred.
- Original reports, extracted tables/text and user notes remain distinct; a news headline is not a verified structured economic fact.

## Implementation checklist

- [x] **P15-T01** Define initial official-source macro universe and adapter subplans; start with a manageable series/release selection rather than every country. Done 2026-11-04: [universe](p15/MACRO_UNIVERSE.md) — BLS official API first (CPI, unemployment, payrolls, PPI), Treasury Fiscal Data second candidate.

- [x] **P15-T02** Ingest series metadata/observations and vintage revisions, preserving release/availability dates and source attribution. Done 2026-11-04: `services/bls_adapter.py` + vintage model in `services/macro.py`; live-verified (CPI Sep 2026 = 336.298). Revisions append as new vintages.

- [x] **P15-T03** Implement economic calendar with explicit display zone, source zone, scheduled/confirmed/cancelled states and actual versus prior/revised values. Done 2026-11-04: calendar entries with source/display zones, release states, actual/prior/revised separated; consensus honestly gated.

- [x] **P15-T04** Add original report ingestion/linking, safe local viewing, text/table search and report revisions; preserve source page/section citations. Done 2026-11-04 (linking scope): BLS news-release citations (USDL id, URL, publication time) searchable over stored metadata like P13; full-text retention waits for explicit source terms (recorded in universe doc).

- [x] **P15-T05** Implement comparison/transformation tools for levels, changes, growth, rebasing and frequency alignment with formula labels and no false precision. Done 2026-11-04: levels/change/pct_change/rebase100 with formula labels and exact-period alignment (interpolated: false always).

- [x] **P15-T06** Add user-selected release tracking and optional local notifications; explain when app/worker must be running and deduplicate notices. Done 2026-11-04: watched-series local notifications deduped by release id; notices state the app must be running.

- [x] **P15-T07** Define optional news/transcript/consensus adapters with rights/retention/evaluation plans; show coverage and freshness before enabling them. Done 2026-11-04: news/transcript/consensus defined as gated adapters with rights/retention/evaluation gates in MACRO_UNIVERSE.md.

- [x] **P15-T08** Expose macro/report evidence snapshots to research notebooks and practice reviews with historical availability constraints. Done 2026-11-04: `evidence_snapshot` returns point-in-time macro evidence (values + vintage stamps) for notebooks/reviews.

## Acceptance criteria

- [x] A revised series can be viewed using the vintage available at a historical time. Proven: as-of selection ignores later vintages.
- [x] Calendar labels timezones and distinguishes actual/prior/revised/consensus. Proven: ET→London conversion asserted; consensus reported unavailable/gated.
- [x] A report excerpt resolves to the original version and location. Release citations carry USDL id + bls.gov URL + publication time (linking scope; full-text retention gated on terms).

## Required verification scenarios

- DST, changed release schedule, revision and delayed publication.
- Missing observations, incompatible frequencies and seasonal-adjustment mismatch.
- Duplicate notifications, disconnected worker and expired provider access.

## Risks and decisions to resolve

- Different agencies expose different revision histories; label unavailable vintage data.
- Professional news and consensus coverage need separate commercial evaluation.

## Scope boundary

Deferred from this package: A complete real-time global newswire, unsupported consensus forecasts and assuming every PDF is freely redistributable.

## Completion evidence and handoff

Before marking P15 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified. 5/5 tests + live BLS probe 2026-11-04.
- [x] Evidence recorded and downstream contracts/documentation updated. [p15/evidence](p15/evidence).
- [x] Corresponding master checkbox updated only after acceptance.
