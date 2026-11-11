# Current app state and how to continue

Reviewed 2 November 2026; current checkpoint updated 3 November 2026. This is the execution guide alongside the [master plan](../MASTER_PLAN.md). P00 remains accepted. [P01 contracts](IMPLEMENTATION_EVIDENCE.md), [P02 storage/recovery](../p02/IMPLEMENTATION_EVIDENCE.md), [P03 journal](../p03/IMPLEMENTATION_EVIDENCE.md), [P04 Data Library](../p04/IMPLEMENTATION_EVIDENCE.md), [P05 original chart workflows](../p05/IMPLEMENTATION_EVIDENCE.md), [P06 historical paper sessions](../p06/IMPLEMENTATION_EVIDENCE.md) and [P07 read-only connectors](../p07/IMPLEMENTATION_EVIDENCE.md) are complete within their recorded scopes. P08–P22 remain open, following the dependency order below. The earlier gap analysis is retained as history; current package evidence controls completed seams.

## Decision on the package list

Keep **P00–P22**, their stable IDs and the existing four primary sections: **Workspace → Fundamentals → Strategy Builder → Workflows**. The coverage is sufficient. We need clearer ownership, dependency order and small end-to-end deliveries rather than more packages or another UI rewrite.

Correct three areas of the old plan:

1. Retired Tools/options/SIP products must not return through P17. P17 owns Workflows, deployment operations and optional AI over accepted domain services.
2. P06 owns discretionary historical paper sessions and their ledger. P20 owns project authoring, revisions and builder UI. P21 owns automated experiment jobs, reports and robustness. They share contracts and eligible compute adapters, not competing result stores.
3. Complete local journal and saved-data value without waiting for remote sync, all brokers or copying. The first Fundamentals slice can develop after identity/storage/source contracts, independently of live execution or macro coverage.

## What exists now

### Workspace, chart and journal

The original profile cards and Chart / Journal / Open actions remain. The original terminal has its toolbar, layouts, drawings, indicators, editor/backtest panels and trading dock. Journal separation and chart/management return context are implemented; the journal keeps Overview, Trades, Calendar, Breakdown and optional Mind. Combined Analysis has tested include/exclude, clear-all and saved selection behavior. The four primary tabs and Settings grouping are implemented.

Those are valuable working slices, not a complete account/book platform. At this review checkpoint, trades were browser-owned under `portfolioId`. P02 has since integrated reviewed migration, account-scoped relational compatibility storage, independent book bindings and authenticated APIs while preserving raw source IDs. P03 has since completed manual update/close/partial/correction/history, normalized CSV import/reconciliation, scoped metrics and period reviews. [Current journal evidence](../p03/IMPLEMENTATION_EVIDENCE.md). P02 has replaced profile-delete cascades with retained archive/restore rules.

Chart documents use the chart library's IndexedDB workspace repository, separately from the trader journal DB. P02 now inventories/exports both, including layouts, drawings and source namespaces, and preserves original browser databases during migration/hydration.

The terminal/dock and chart-bound backtest still use legacy app broker/API-key context. A profile label or saved destination does not establish per-account execution authority. Existing layout/indicator/runtime functionality should be adapted, not discarded.

### Paper and historical data

Historify already supplies substantial import, download, catalog and storage functionality. Existing chart replay, clocks, trade locks and backtest primitives also exist and have relevant tests.

P04 now supplies broker-free private CSV import, quality review, immutable source/version identity, native historical charts and exact-version practice Drafts. Finite read-only downloads have saved checkpoints and owner-bound credential checks. Dataset bundles preserve immutable references across restored owners; journal workspace ZIPs retain links rather than candle files. P05 opens those sources in the original full terminal with owned context, isolated layouts/drawings, causal studies, direct chart evidence and recorded-chart return/recovery. P06 adds reviewed explicit economics, deterministic next-native-event orders/costs, durable account/checkpoint/receipt publication, exactly-once paper journal facts, independent branches/reports and cross-owner source recovery. Its current account follows the acknowledged clock; chart-only historical inspection stays separate. Provider-specific conformance remains P07 work.

### Strategy Builder

The top-level destination explicitly says the new builder is unavailable. The chart editor/compiler, indicator registration, historical backtest worker/results and deployment services are reusable. Current inspected backtest outcome state lives in the panel; there is no completed project/revision/experiment/report product behind the new section.

The new project library, revisions/dependency locks, standalone saved-data tests, durable reports, parameter studies, stress testing and candidate handoffs remain implementation work. Removing the old launcher did not remove all shared runtime dependencies; OpenScript still uses shared host/scheduler functions.

### Fundamentals

The navigation and availability page exist. Company search, normalized facts, statements, original reports, saved research and relationship intelligence do not. There is no certified research source or complete canonical research store/query API. Keep unavailable fields honest. Build the first company journey before a broad intelligence dashboard.

### Workflows and connections

Flow and existing runtime/log/approval capabilities remain. Profile Connections explicitly says its account/terminal/copy settings are a local configuration wireframe. App-wide broker credentials and those profile records are separate systems. Universal connector registration, verified history sync, account-specific execution and copying are not established by the screens.

The next integration must bind exact account/environment/revision/capability context and retain existing lifecycle/recovery behavior. Read-only actions can ship before trading actions. Actual provider certification requires its own permitted test access and evidence.

## First issues to fix through the planned work

- **P01/P02:** book/environment/account identity and ownership, durable record APIs, conservative compatibility mapping, full restore and safe archive. Do this before creating new source-linked records or migrating user data.
- **P03 complete / P22 pending:** the standalone lifecycle, normalized statement staging/deduplication/corrections and source observations are implemented. Independent remote history synchronization remains P22 work.
- **P03 analytics complete:** exact native amounts, current-time/IANA scope, realized-exit sample counts, cashflow separation, unknown coverage and annualized-ratio prerequisites are specified and tested. [Calculation policy](../p03/CALCULATION_POLICY.md).
- **P04–P06 complete:** source/version identity, original-chart context/evidence, scoped layout recovery and native causal paper execution/journal outcomes are verified. Their evidence and supported economic limits govern downstream reuse.
- **P20/P21:** one project/revision and experiment/report system behind the Builder, with reusable chart-side controls linked to it.
- **P13/P14/P16:** one sourced company investigation with original evidence and saved research. Broader geography, relationships, macro and asset classes are subsequent source-certified increments.
- **P07/P11/P12/P17:** migrate legacy global broker/mode assumptions before claiming scoped bot execution or copying. Preserve shared schedulers and running-work recovery during host cleanup.

## Delivery order and pass conditions

### 1. P01 — executable contracts

P01 v1 is now implemented and tested; see [evidence](IMPLEMENTATION_EVIDENCE.md). Its [detailed brief](IMPLEMENTATION_PLAN.md) records the delivered scope. Define a minimal versioned local-core contract set and future-capability envelopes, not every global asset model in advance. Prove the same valid/invalid cases in Python and TypeScript. No live dispatch, production endpoints, database replacement or migration belongs in this first step.

Pass: all eight P01 task outputs exist; book/account/source/revision/time/unit invariants have independent negative fixtures; compatibility aliases and ambiguous legacy cases are documented; validators agree. A JSON object schema alone cannot enforce cross-record one-active-book/account uniqueness—include relationship validation.

### 2. P02 + P03 — a reliable standalone journal

Start with current-record export/inventory, backend book/profile/account/review repositories and a recoverable migration preview. Retain original browser data until counts, relationships and restore are verified. Include the existing chart workspace store in backup inventory.

Deliver manual book creation → open/edit/close one trade → review in the original tabs → restart → restore on a clean test installation. Then add one normalized statement import with malformed-row preview, duplicate/correction handling and a receipt.

Pass: no required broker/feed; one active connected book/account enforced where applicable; no orphaned notes or silent reclassification; repeat import/migration is idempotent; independent analytics cases pass. P22 reconciliation foundations may be implemented with fixtures here, but remote sync is not a prerequisite for this local journey.

### 3. P04 + P05 + P06 — saved data to the original chart and paper journal

Reuse Historify and the original terminal. Select one supported, versioned local dataset with instrument economics, range/coverage and quality. Connect run preparation to that dataset and a deterministic paper service. Add costs, next-eligible-event fills, checkpoints and once-only paper journal effects.

Passed within the documented linear native-OHLC scope: source/setup returns to the same run; no execution broker needed for eligible local history; restart preserves clock/orders/positions/cash; historical commands cannot reach real dispatch; the paper trade has expected costs and book provenance. [P06 original-screen acceptance](../p06/BROWSER_ACCEPTANCE.md). Automated strategy-job and real-provider certification remain separate work.

### 4. P20 core + P21 baseline, then robustness — Strategy Builder

Create Indicator/Strategy library, drafts, validated revisions/dependencies and chart attachments. P20's UI calls P21's experiment service for immutable manifests, bounded jobs and saved reports; do not make another chart-component-only result store.

First pass: create → validate → choose dataset → test → save report → close/reopen → inspect a trade in the original chart → return. Then add complete parameter-trial history, chronological evaluation, supported stress scenarios and candidate decisions. Runtime operation is P17; real dispatch is P11. Full package checkboxes stay open while their later required scope remains unfinished.

### Alongside the local-core work after P01/P02 — first Fundamentals journey

P13 provides one verified source adapter, fact/document storage and query contracts; P14 provides supported company financial facts; a thin P16 company/search/report/notebook UI consumes them. Start with the accepted company scope and [first-company plan](../p14/IMPLEMENTATION_PLAN.md).

Pass: supported issuer/listing → sourced statement → original report → saved research → offline reopen; mapped chart/journal links preserve evidence. No mandatory execution account, invented missing values or overwritten snapshots. P15 macro and wider P16 investigation tools do not block the first company slice.

### Alongside eligible services — P07, read-only adapters and P22 sync

After the relevant identity/storage contracts, certify one accessible source at a time. P08/P09/P10 are adapter families, not three unverified dropdowns. MT5 remains the first retail candidate; choose exact provider/test access through P07.

Pass: verified account, read-only capabilities, startup/offline/reconnect behavior, bounded coverage/backfill, duplicate/correction handling and preserved reviews. Journal sync is independent of the current chart/book page. A successful limited response is not full-history proof.

### Then P11 → P12, with P17 operations

Verify one account's demo dispatch, unknown-outcome reconciliation, protective-order support and risk before eligible live writes. Add multi-account copying only after individual account outcomes and divergence recovery pass. Workflows orchestrates accepted sync/data/research/experiment services and separately manages deployment instances; it cannot bypass execution authority.

P18 usability/accessibility and P19 installation, diagnostics, provenance/licensing, tests and recovery apply to every delivery. Keep them as release gates from the start, not an end-of-project repaint or installer task.

P07 now delivers verified read-only setup, account/book linking, encrypted credentials, bounded observations, deduplication/corrections and explicit reconnect in the original UI. MT5 account/raw-history reads were measured against the authorized running demo; its UTC clock and full accounting remain unverified. Public crypto reachability and blocked brokerage authentication are access outcomes, not family certification. Continue P08–P10 through their access-gated subplans; P11 execution and P22 maintained startup sync remain open. Replay creation now requires owned history and optional multi-session tags do not change timezone. [Screen verification](../p07/BROWSER_ACCEPTANCE.md), [independent review](../p07/INDEPENDENT_REVIEW.md).

## Rules for package status

P00 stays complete as the accepted design package. P01–P07 have passed their package gates within recorded scope. Keep P08–P22 master checkboxes open until each package's defined tasks and acceptance pass. Record smaller completed journeys within their owning packages without presenting them as full-package completion. Stable IDs are tracking references, not a rigid numerical schedule. No new P23 package is needed for these corrections.

P02 implements a backup framework and manifests for actual implemented modules. Each future research/project/runtime module must register its own data/dependencies and restore tests before release. Do not wait for nonexistent future data to build local-core recovery, and do not claim a backup covers a module it omits.

## Verification and limits of this review

Source evidence for the current boundaries:

- Journal storage and lifecycle: [trader DB](../../../../frontend/src/lib/trader/db.ts) and [data hooks](../../../../frontend/src/lib/trader/useTraderData.ts).
- Separate chart document storage: [chart workspace catalog](../../../../frontend/src/hooks/useChartWorkspaceCatalog.ts).
- Configured versus integrated profile capabilities: [Connections](../../../../frontend/src/pages/workspace/TraderConnections.tsx) and [paper run form](../../../../frontend/src/pages/workspace/TraderReplay.tsx).
- Current strategy/fundamentals entry points: [Strategy Builder](../../../../frontend/src/pages/StrategyWorkspace.tsx) and [Fundamentals](../../../../frontend/src/pages/Fundamentals.tsx).
- Legacy trading context and current backtest output: [TradingDock](../../../../frontend/src/components/trading/dock/TradingDock.tsx) and [BacktestPanel](../../../../frontend/src/components/trading/BacktestPanel.tsx).

- **208 frontend tests passed across 20 selected files:** navigation, availability pages, settings, journal/chart return, Combined Analysis, script editing/storage, custom indicators, backtest inputs/run/session/off-thread behavior, replay clock/workspace/trading lock.
- **384 backend tests passed across five files:** current React routes, retired-feature behavior, Flow validator/lifecycle guards and indicator cache. Test databases were isolated under `tmp/pytest-state-review-01`; the test process alone used a valid LOG_FORMAT. One pre-existing pytest cache-path warning remained.
- **32 P00 design tests passed.** They certify the accepted fixture model/contracts, not production integration.
- The initial source review found absent canonical domain directories. P01 has since implemented those boundaries; the current production browser models, global broker consumers and availability notices still require their later integration packages. Browser review used the existing empty Personal Portfolio; it did not certify real-provider data, populated live-account analytics, order execution, migrations or restore. Meaningful populated selection/return checks came from isolated tests.

This initial review updated the plan. Subsequent P01 implementation adds tested contract code without changing production data paths. No user records, broker settings, credentials, permissions, orders or deployment activation were changed.

