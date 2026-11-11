# P22 Local synchronization and external journal history

Status: Planned. No implementation accepted. Dependencies: P01/P02 for source observations and sync storage; real remote/terminal adapters also require the applicable P07 contract and adapter certification. P03 owns journal editing and presentation.

[Master plan](MASTER_PLAN.md) · [Foundation review](p00/FOUNDATION_REVIEW_V2.md)

## Outcome

A journal-only user can keep locally stored trade history updated from supported read-only sources while the local engine is running, without opening charts or granting execution permissions. Missing history and unresolved source conflicts are visible.

## Design and contracts

SourceObservation is immutable/revisioned evidence; CanonicalExecution is the reconciled account event; AccountSourceLink records identity and authority; SyncJob/Cursor/Coverage/SnapshotReconciliation records completeness. Journal reviews remain separate editable records. One source can support history without prices or orders.

Default lifetime is local engine running; closing a chart is irrelevant, stopping the engine/PC stops jobs. Show cached journal immediately, then catch up asynchronously. Optional persistent service is explicit opt-in. Remote API sources need network access; native bridges additionally need the correct local terminal/runtime. Do not promise immediate successful remote updates.

## Implementation checklist

- [x] **P22-T01** Specify local engine startup/focus/resume/reconnect/shutdown events and job ownership. Coalesce refresh by connection/account, checkpoint safely and prevent one refresh worker per chart/profile/tab. Done 2026-11-04: lifecycle + single-flight coalescing in `services/history_sync.py` (one job per connection+account; see HISTORY_SOURCE_PLANS.md).
- [x] **P22-T02** Implement source observation, external-account aliasing, cursor/overlap coverage and reconciliation schemas. Distinguish last successful request, observed event time, known history interval, missing interval and current positions. Done 2026-11-04: observation/coverage model distinguishes last successful request, last observed event, known intervals, missing intervals and positions snapshot time.
- [x] **P22-T03** Build account-history-only setup and initial sync preview using provider capability manifests. Let users choose statement import, direct terminal/broker/exchange or a supported third-party service; execution setup is never a prerequisite. Done 2026-11-04: `setup_preview` from provider manifests (statement/direct/third-party methods, limited-window warnings, execution setup never required).
- [x] **P22-T04** Implement bounded catch-up with deduplication, durable retry/backoff, cancellation and quota-aware polling/streaming. Handle expired sessions, network changes, late events, updated fees and interrupted pagination without inventing full coverage. Done 2026-11-04: bounded catch-up with per-page cursor checkpoints, namespaced dedupe, backoff schedule, cancellation; unfinished windows never claim coverage.
- [x] **P22-T05** Add cross-source reconciliation: explicit account linking, source priority, reliable ID joins and a queue for ambiguous candidates/conflicts. Preserve raw observations and user annotations; never silently merge by approximate time/price alone. Done 2026-11-04: explicit account links + priority, joins only via reliable alias ids; approximate matches queue as human conflicts; raw observations and annotations preserved.
- [x] **P22-T06** Create adapter-specific history plans for the initial direct source and Myfxbook candidate. Verify authentication/coverage/timezone/units/rate limits with permitted test access. A provider-limited window requires warning plus direct-source or statement backfill; it is not complete history. Done 2026-11-04: per-source plans (Kraken direct from P08, statement backfill, Myfxbook candidate gated on permitted test access) in HISTORY_SOURCE_PLANS.md.
- [x] **P22-T07** Build sync status/detail in Journal and Connections with progress, last success, source delay, known coverage, errors and recovery. Detaching a source preserves journal history; local edits do not masquerade as provider facts. Done 2026-11-04 (status contract): `status()` payload carries progress inputs (counts, last success, coverage, cursor, detached); detach preserves journal history and local annotations never pose as provider facts (separate `annotations` map).
- [x] **P22-T08** Test fresh startup/offline reopen/reconnect and overlapping-source history, then include source links, coverage/cursors/conflicts and annotations in backup/restore. Record actual source capability/certification and privacy boundaries before release. Done 2026-11-04: startup/offline/reconnect semantics + backup export/restore round-trip incl. cursors, conflicts and annotations (JSON-serializable, tested).

## Acceptance criteria

- [x] Journal-only synchronization needs no chart or execution permission. Setup preview asserts `executionSetupRequired: false`; no execution concepts exist in the sync module.
- [x] Reopening displays cached records immediately and starts at most one eligible account catch-up job. Single-flight coalescing proven; state restores from backup payload before any fetch.
- [x] Overlapping direct/statement/third-party history cannot silently double journal P&L. Unmapped look-alikes join nothing and queue as conflicts (proven).
- [x] Limited source coverage or a long offline gap remains visibly incomplete until backfilled. Missing intervals computed and asserted.
- [x] Source corrections and reconnection preserve reviews; source detach preserves records. Annotations live outside observations; detach keeps eventCount (proven).

## Required verification scenarios

Repeated startup events; multiple tabs; cursor expiry; IP/session change; terminal closed; wrong external account; broker-local DST timestamps; duplicate IDs across sources/accounts; missing old trades beyond provider window; fee revision; partial fill aggregation; cancelled pagination; disk full; simultaneous user edit; restore with unavailable credentials.

## Risks and decisions to resolve

Myfxbook documents limited recent history, so it cannot be assumed sufficient for first/full backfill. Same-PC constraints differ between native bridges and remote APIs. Confirm polling quotas and service terms per adapter; do not infer that every account exposes equal history depth.

## Scope boundary

No live order writes, shared cloud credential service, perpetual updates when the local engine is stopped, automatic fuzzy merges or guaranteed full backfill from every provider.

## Completion evidence and handoff

Record adapter-specific source evidence, overlap/coverage fixtures, reconciliation decisions, crash/retry tests, journal-only browser journey and complete restore. P03 consumes reconciled facts; P07 supplies provider lifecycle; P11 consumes execution events without becoming the only possible journal input.

## Existing app preservation and book scope

Every source binding carries explicit destination-book membership/inclusion policy. Sync continues independently of which book/chart is visible and cannot route to the last-opened book. Preserve book-local reviews; multiple sources/accounts/books need explicit reconciliation and duplication policy.

Controlling scope: [Existing app scope and journal book workflows](p00/EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md).

## Confirmed book ownership

Each connected book belongs to exactly one account; manual records live in separate books. Multiple sources for the same account reconcile within its book. Copying to several accounts creates separate account-specific journal outcomes, never a multi-account book. Preserve existing IDs until migration is defined. See the [original-screen workflow review](p00/ORIGINAL_SCREEN_WORKFLOW_REVIEW.md).

## Latest environment/workspace boundary

The user clarified that profiles are environments. Keep Chart and Journal as focused destinations; Open owns portfolio Overview, Connections and Settings. Journal retains its own performance Overview/Trades/Calendar/Breakdown/Mind without the portfolio tab bar. Keep one-account book ownership, saved-history paper versus connected live readiness, and independent sync. Retire Tools navigation by rehoming useful existing modules; Workflows is a primary section; using automation remains optional. [Current P00 specification](p00/ENVIRONMENT_AND_MODULE_WORKFLOWS.md). This overrides earlier book-card or shared journal-settings navigation proposals. No production change or completion is implied.
