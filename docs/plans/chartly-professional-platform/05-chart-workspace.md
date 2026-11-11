# P05 Existing chart workflow integration

Status: Complete within the supported P05 scope, 3 November 2026. The [detailed ordered implementation plan](p05/IMPLEMENTATION_PLAN.md) preceded coding. All eight tasks, acceptance journeys and checks now have [implementation evidence](p05/IMPLEMENTATION_EVIDENCE.md) and a [current-source acceptance manifest](p05/P05_ACCEPTANCE.json). The original chart UI remains the base.

Release: R1. Dependencies: [P00](00-product-and-workflows.md), [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md), [P04](04-data-library.md).

[Master plan](MASTER_PLAN.md)

## Outcome

Every chart opens the intended source, instrument and mode, and captures decision context directly into the journal.

## Implementation areas and dependencies

Trading.tsx, ChartPane/terminal, workspace repositories, indicator/drawing infrastructure and Historify feed.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Resolve a verified ChartContext from profile/run/account/dataset IDs; presentation query labels cannot authorize orders.
- Source adapter and execution adapter are independent. Read-only historical sources have no live command interface.
- Keep high-frequency chart updates outside React rendering and preserve proven drawing/indicator/layout functionality.

## Implementation checklist

- [x] **P05-T01** Implement context resolver and deep-link validation that loads profile defaults or exact run dataset/window/checkpoint; return actionable missing-source states.

- [x] **P05-T02** Unify local historical and connected feeds behind source selection; display source, data delay/freshness, available range, timezone and gap status.

- [x] **P05-T03** Preserve the current toolbar/dock and chart opening layout; add only the minimal reviewed context/status needed to distinguish paper/demo/live mode and execution account from chart prices.

- [x] **P05-T04** Scope workspace persistence by user/profile where intended; define shared template versus profile-specific layout/drawing behavior and migration.

- [x] **P05-T05** Add Journal panel and attach-chart action storing image/view metadata, source version, timestamp and annotations against the correct trade/run.

- [x] **P05-T06** Audit indicator calculations and multi-timeframe/comparison behavior during replay; ensure visible and derived series obey simulated availability.

- [x] **P05-T07** Complete symbol search across local catalog and eligible providers with instrument/venue identity and capability-aware empty states.

- [x] **P05-T08** Validate multi-pane restoration, keyboard controls, chart loading/error recovery and large-history rendering against defined performance budgets.

## Acceptance criteria

- [x] Different profile/run links restore their own source and window.
- [x] A chart snapshot attaches to its intended journal entry without a download/upload round trip.
- [x] No source gives a clear import/connect/open-local action instead of a blank canvas.

## Required verification scenarios

- Source switch during load, stale async response and disconnected feed.
- Workspace restart, multiple profiles/tabs and renamed instruments.
- Replay with indicators/comparisons and unsupported instrument order controls.

## Risks and decisions to resolve

- Existing global API-key assumptions must be isolated behind a legacy adapter.
- Synthetic chart prices must not silently become executable market prices.

## Scope boundary

Deferred from this package: Replacing the chart library, adding indicator counts for marketing and full mobile execution parity before usability testing.

## Completion evidence and handoff

Before marking P05 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified.
- [x] Evidence recorded and downstream contracts/documentation updated.
- [x] Corresponding master checkbox updated only after acceptance.

## Existing app preservation and book scope

Preserve the original Trading/ChartPane/terminal UI and opening experience. Improve context resolution, source/run/account binding and journal/research handoff in place. Do not substitute the standalone chart preview or reorganize toolbars/rails/dock without a concrete user-reviewed need.

Controlling scope: [Existing app scope and journal book workflows](p00/EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md).

## Confirmed book ownership

Each connected book belongs to exactly one account; manual records live in separate books. Multiple sources for the same account reconcile within its book. Copying to several accounts creates separate account-specific journal outcomes, never a multi-account book. Preserve existing IDs until migration is defined. See the [original-screen workflow review](p00/ORIGINAL_SCREEN_WORKFLOW_REVIEW.md).

## Latest environment/workspace boundary

The user clarified that profiles are environments. Keep Chart and Journal as focused destinations; Open owns portfolio Overview, Connections and Settings. Journal retains its own performance Overview/Trades/Calendar/Breakdown/Mind without the portfolio tab bar. Keep one-account book ownership, saved-history paper versus connected live readiness, and independent sync. Retire Tools navigation by rehoming useful existing modules; Workflows is a primary section; using automation remains optional. [Current P00 specification](p00/ENVIRONMENT_AND_MODULE_WORKFLOWS.md). This overrides earlier book-card or shared journal-settings navigation proposals. No production change or completion is implied.

## Accepted P05 checkpoint

All eight tasks are implemented and tested in the original app. Owned source/profile/run/trade context, execution isolation, private chart workspaces, deliberate restored-layout recovery, direct journal PNG evidence and recorded-chart returns are verified. See [task/file evidence and supported limits](p05/IMPLEMENTATION_EVIDENCE.md), [12 actual-screen journeys](p05/BROWSER_ACCEPTANCE.md), [reproducible commands](p05/VERIFICATION_COMMANDS.md), [source/study matrix](p05/SOURCE_POLICY.md) and [architecture](p05/ARCHITECTURE.md).

The broad checks passed 1,071 backend tests, 2,262 frontend tests and 84 P00 design/model tests. Later affected runs passed 58 backend checks, 115 context checks, 114 journal checks, 64 hydration checks, 34 search/accessibility checks and 23 final preference checks; these overlap. Types, production build, scoped static checks, generated contracts, independent review and resource/50k history checks passed. The manifest records actual logs and hashes. The original app was restarted on port 5000; synthetic fixture processes/tabs were closed.

No destructive schema/user migration was added. Workspace/book recovery includes all chart images; candle bundles remain separate. P05 supports native immutable data and chart replay preparation, with explicit unsupported MTF/provider states. It does not certify live adapters or implement a simulation ledger. P06–P22 remain open; P06 is next and requires a detailed execution/checkpoint/journal-projection plan before coding.
