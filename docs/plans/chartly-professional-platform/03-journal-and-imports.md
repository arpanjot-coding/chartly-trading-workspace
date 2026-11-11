# P03 Professional journal and trade imports

Status: Complete. All eight tasks and acceptance journeys are implemented and verified in the original app. See [implementation evidence](p03/IMPLEMENTATION_EVIDENCE.md) and the [acceptance record](p03/P03_ACCEPTANCE.json).

Release: R1. Dependencies: [P00](00-product-and-workflows.md), [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md).

[Master plan](MASTER_PLAN.md)

## Outcome

A user imports or records trades, reconciles facts, edits reviews, closes open trades and learns from accurate scoped performance.

## Implementation areas and dependencies

TraderJournal, metrics.ts, useTraderData, CombinedLiveAnalytics and current manual form.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Execution facts and review annotations have separate provenance/revisions. Imported corrections never erase user notes.
- Support manual/import/connector/simulation origins; source-event deduplication is scoped by account and provider.
- Accounting includes partial closes, costs, cashflows and currency. Unknown risk/emotion values remain unknown.

## Implementation checklist

- [x] **P03-T01** Implement trade detail with edit/open/close/review/history actions; allow absent close time for an open trade and preserve explicit source facts.

- [x] **P03-T02** Build CSV statement import mapping, preview, timezone/unit/currency validation, row errors, totals and commit summary; save reusable mapping profiles.

- [x] **P03-T03** Add deterministic event deduplication and repeat-import reconciliation, including corrected fees, partial fills and overlapping statement ranges.

- [x] **P03-T04** Implement unreviewed queue, strategy/setup tags, decision notes, optional mindset entries and direct chart attachment with durable storage.

- [x] **P03-T05** Specify calculation formulas and denominators; fix period anchoring, timezone grouping, break-even rates, sample sizes and inconsistent filter scope.

- [x] **P03-T06** Handle account-level versus decision-level copied trades and multi-currency reporting explicitly; label cumulative journal P&L versus account equity.

- [x] **P03-T07** Replace misleading generic scores with transparent statistics or explicit strategy goals; require complete return series before annualized ratios.

- [x] **P03-T08** Build daily/weekly review with drill-through into included trades; preserve draft edits, archive/undo and full export through P02.

## Acceptance criteria

- [x] Importing the same statement twice does not duplicate trades.
- [x] Open trade can be closed and reviewed later without deletion.
- [x] All views use the displayed account/period/strategy/timezone and show sample size.

## Required verification scenarios

- Midnight/DST, zero/unknown risk, fee-only adjustment and partial exits.
- Long/short, breakeven, deposits, withdrawals and multiple currencies.
- Malformed mapping, duplicate external IDs across accounts and save failure.

## Risks and decisions to resolve

- Trade aggregation rules differ for netting/hedging accounts; retain raw executions.
- Broker-specific import formats need individual mapping fixtures.

## Scope boundary

Deferred from this package: All statement formats at once, automated psychological diagnosis and unsupported performance rankings.

## Completion evidence and handoff

Before marking P03 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified.
- [x] Evidence recorded and downstream contracts/documentation updated.
- [x] Corresponding master checkbox updated only after acceptance.

## Foundation revision 2 integration requirement

P22 owns independent history synchronization. Journal accepts manual/import/direct/third-party/simulated/confirmed-execution inputs without trading setup. Preserve source observations, link accounts explicitly and resolve ambiguous cross-source duplicates before counting P&L; user reviews survive corrections.

See [foundation review](p00/FOUNDATION_REVIEW_V2.md) and P20/P21/P22.

## Existing app preservation and book scope

Preserve TraderJournal presentation and existing Overview/Trades/Calendar/Breakdown/optional Mind surfaces. Add missing edit/close/import/review/sync/recovery behaviour within the existing app. Each entry/import/sync has an explicit destination book independent of the current tab; annotation and analytics scope remain book-specific.

Controlling scope: [Existing app scope and journal book workflows](p00/EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md).

## Confirmed book ownership

Each connected book belongs to exactly one account; manual records live in separate books. Multiple sources for the same account reconcile within its book. Copying to several accounts creates separate account-specific journal outcomes, never a multi-account book. Preserve existing IDs until migration is defined. See the [original-screen workflow review](p00/ORIGINAL_SCREEN_WORKFLOW_REVIEW.md).

## Latest environment/workspace boundary

The user clarified that profiles are environments. Keep Chart and Journal as focused destinations; Open owns portfolio Overview, Connections and Settings. Journal retains its own performance Overview/Trades/Calendar/Breakdown/Mind without the portfolio tab bar. Keep one-account book ownership, saved-history paper versus connected live readiness, and independent sync. Retire Tools navigation by rehoming useful existing modules; Workflows is a primary section; using automation remains optional. [Current P00 specification](p00/ENVIRONMENT_AND_MODULE_WORKFLOWS.md). This overrides earlier book-card or shared journal-settings navigation proposals. No production change or completion is implied.


## Verified P03 completion — 2 November 2026

807 backend tests across 23 files, 448 frontend tests across 39 suites, six import-screen follow-up tests and 52 P00 workflow/review tests passed. TypeScript, production build, targeted Ruff/Biome and generated-contract checks passed. Independent review findings were fixed and covered by regressions. Actual isolated original-app journeys verified browser capture/migration, partial/final close/correction, import, daily/weekly review/drill-through, chart return, archive/Undo and a downloaded full-book export. [Evidence, commands and supported limits](p03/IMPLEMENTATION_EVIDENCE.md).

P02 historical evidence remains unchanged; the P03 gate records current compatible source hashes and a verified storage/recovery regression log. No installed journal was migrated by this work. Universal providers, remote sync, dataset/chart integration and live execution remain in their later packages. P04 Data Library is the next package; detail its implementation slice before coding.
