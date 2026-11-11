# P13 Research data aggregation foundation

Status: Planned. No implementation task is marked complete by this document.

Release: R3 foundation; can run alongside R2. Dependencies: [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md).

[Master plan](MASTER_PLAN.md)

## Outcome

Research facts and source documents are ingested reproducibly with provenance, quality and explicit source coverage.

## Implementation areas and dependencies

Historify jobs/storage patterns and shared domain contracts. The current Fundamentals route is an availability page; its company research store/query services still need implementation.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Research providers implement discover/fetch/normalize/refresh capabilities separate from execution adapters.
- Store original document/source payload separately from normalized facts and versioned derived calculations.
- Track observation, period, publication/availability and retrieval times; preserve corrections and as-of queries to avoid hindsight.

## Implementation checklist

- [x] **P13-T01** Define provider manifest for geography/assets/fields/history/latency/quota/credentials, attribution, permitted storage/export and subscription scope. Done 2026-11-04: SEC EDGAR selected from official docs ([decision](p13/PROVIDER_DECISION.md), executable manifest in `services/research_providers.py`, live CompanyConcept mapping verified).

- [x] **P13-T02** Design Entity/Source/Document/Fact/Revision/DerivedMetric schemas, canonical alias resolution and source-specific mapping provenance. Done 2026-11-04 on the P01 records: `services/research_domain.py` (CIK/ticker canonical aliases with ambiguity errors, three-time document/fact provenance, point-in-time selection with restatement lineage).

- [x] **P13-T03** Implement durable ingestion jobs, rate-limit budgets, caching, retry/backoff, cancellation and document checksum deduplication. Done 2026-11-04: `services/research_ingestion.py` + `EdgarClient` token bucket (SEC 10 req/s), bounded Retry-After-aware retries, idempotent submit, cancel/recover, content-id deduplication of documents/facts, per-issuer durable bundles.

- [x] **P13-T04** Create source-document storage/extraction/indexing and safe retrieval APIs with extraction status and original-publication references. P16 owns the document reader/highlights UI over these APIs. Done 2026-11-04: `/api/local/v1/research` issuer/document/fact APIs with citations (accession + source URL + publication times), stored-metadata search v1, and live access-time filing fetch (labelled not-stored, bounded). Extraction status = per-document fact counts; body indexing lands with stored text in P16 scope.

- [x] **P13-T05** Add normalization validation for units/currency/periods, missing values, conflicting facts and revision lineage; quarantine invalid records. Done 2026-11-04: `services/research_quality.py` unit classification, currency/period/magnitude validation, same-document conflict detection, quarantine with reasons, explicit split-adjusted derived series (originals untouched).

- [x] **P13-T06** Implement entity/fact/document query APIs including as-of time, freshness, coverage and per-field source drill-through. Done 2026-11-04: `/snapshot` (point-in-time facts each carrying accession/URL/publication drill-through + coverage), `/facts?asOf`, freshness via latestAvailableAt.

- [x] **P13-T07** Build provider health/quality dashboard and local storage retention controls; never silently mix sources into an unexplained value. Done 2026-11-04 (API scope): `/quality` report (accepted/quarantined, restated identities, empty documents, staleness, sourcesMixed=false invariant) and count-confirmed issuer retention deletion; dashboard UI remains P16.

- [x] **P13-T08** Complete one official-source adapter end to end with fixtures, terms metadata and reproducible backfill; document how optional paid adapters plug in. Done 2026-11-04: SEC EDGAR adapter (`services/edgar_adapter.py`) with fixture tests and a live reproducible backfill mapping 31,839 real Microsoft facts in 2 requests ([log](p13/evidence/t08-live-ingest-check.log)). Optional paid adapters plug in as additional `sourceId` providers behind the same manifest/capability + storage contracts; none is required or bundled.

## Acceptance criteria

- [ ] Every displayed research fact resolves to a source/version/time/unit.
- [ ] A restatement preserves both original and corrected values.
- [ ] Provider failure shows stale/unavailable data without fabricated zero values.

## Required verification scenarios

- Repeated fetch, document revision, schema drift and quota response.
- Issuer alias collision, conflicting units and fiscal dates.
- As-of query before/after publication and source-specific retention restrictions.

## Risks and decisions to resolve

- Global research needs multiple sources and field-level reconciliation.
- Public access alone does not grant unrestricted redistribution.

## Scope boundary

Deferred from this package: Global proprietary data purchases, hosted redistribution, a search cluster before local indexing is benchmarked and every research dataset at launch.

## Completion evidence and handoff

Before marking P13 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified. 2026-11-04: 14/14 closing suite + live EDGAR evidence (31,839 mapped facts).
- [x] Evidence recorded and downstream contracts/documentation updated. Logs in p13/evidence/; P14/P16 consume Issuer/FactObservation/DerivedMetric contracts as built.
- [x] Corresponding master checkbox updated only after acceptance.

## Foundation revision 2 integration requirement

Research has quantitative Strategy Lab and Fundamentals/Market Intelligence branches. P20/P21 own quantitative project/experiment workflows; this package owns sourced fundamental/report data. Features consumed in backtests require historical availability and revision semantics.

See [foundation review](p00/FOUNDATION_REVIEW_V2.md) and P20/P21/P22.
