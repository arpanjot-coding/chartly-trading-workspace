# Chartly whole-product workflow and UI blueprint

2 November 2026. P00 design baseline explicitly accepted by the user on 2 November 2026. No production feature or adapter certification is implied.

This is the current product-level screen/workflow inventory. It consolidates the conversation; older notes that propose demoting Flow, keeping the old Tools launcher or replacing the chart/journal are historical and superseded. The interactive map is in the [existing original-screen review](original-screen-review/index.html#workflow/workspace).

## What the application needs

Four direct work tabs in the confirmed order—Workspace, Fundamentals, Strategy Builder, Workflows—plus Settings. Shared pickers, jobs/activity and backup/recovery connect them. The app needs complete user journeys and coherent records, not more menu labels.

UI below means pages, tabs, dialogs, panels and drawers. Each item does not require its own route. Screen IDs are review references, not accepted implementation tasks.

## Source-backed status vocabulary

- **Working slice:** a bounded existing change has verification evidence; the entire product is not complete.
- **Keep and connect / Improve existing:** the screen exists and remains the baseline, with the stated workflow gap.
- **Reuse components:** useful editor/engine/UI pieces exist, but the integrated product screen is missing.
- **Configuration only:** saved setup exists without the claimed end-to-end runtime.
- **Missing:** the required product screen/flow is not implemented.

## Product rules

1. Preserve the original chart and journal presentation. Add workflow context and missing behavior in those screens.
2. A profile/portfolio is an environment inside Workspace; a journal book is a record owner; an account is an external or simulated identity. They are not aliases.
3. Each connected book belongs to exactly one account; manual records use separate books. Copy destinations each journal their own account fills.
4. Users may use just journal, chart, paper trading, strategy research or fundamentals. Optional modules cannot impose unrelated broker or AI setup.
5. Market data, account-history access and execution permission are separate. Saved configuration is not observed health.
6. Manual replay, automated backtests, optimization trials and running bots have separate lifecycles and records.
7. A saved research/project/report revision is not rewritten when newer data or code arrives.
8. Closing a chart changes a view, not a running bot or local sync destination. Closing the local engine stops local workers unless a separate background service is explicitly enabled.
9. All cross-section links carry authoritative entity/account/book/dataset/revision context and preserve the return location. Unsupported mapping gets a recovery action, not a default ticker.
10. No feature or P00 milestone is complete merely because a route, tab, form, backend utility or review screen exists.

## Most important missing pieces

- **Book/account/environment ownership:** The journal UI is good, but it is still profile-scoped persistence; the independent book model and migration rules are unfinished.
- **The whole trade lifecycle:** Open/edit/close/correct, statement import, read-only sync and annotation-preserving reconciliation need connected screens and backend behavior.
- **Data selection and paper truth:** Saved candles, exact instrument identity, version/coverage and a durable simulated account must connect to the original chart.
- **The Strategy Builder product:** A library, editor, saved experiments/reports, parameter studies, robustness and candidate handoff are absent as one product despite reusable engines.
- **The Fundamentals product:** Search, company pages, statements, reports, research notes and sourced relationships have no complete implementation.
- **Runtime/account scope:** Existing chart dock and Flow resolve legacy global contexts; portfolio configuration does not establish per-account authority or copying.
- **Durability and recovery:** Books, chart layouts, sources, research, projects, jobs/results and backups need coherent ownership and restore guarantees.
- **UI states and discoverability:** Every screen needs useful first-use, pending, partial, error, stale, offline, permission and return paths; missing controls must lead to recovery.

## Workspace

Manage environments; use the original chart and independent journal books for actual trading, practice and review.

Chart and Journal are focused destinations. Open manages the environment through Overview, Connections and Settings.

### WS01 — Workspace home and environments

**Improve existing · Page · Core**

Current base: /workspace · TraderWorkspace.tsx.

**UI contents:**

- Keep the current profile cards and Chart / Journal / Open actions.
- Show Live, Paper or journal-only intent, source readiness and the relevant book/account identity.
- Keep Combined Analysis as an explicit cross-portfolio action.

**User actions:** Create environment; Open Chart, Journal or portfolio management; Resume the last relevant workspace.

**Connects to:** WS02 Create an environment or standalone book, WS03 Open: portfolio/environment management, WS04 Original chart terminal, WS08 Independent journal books and book setup, WS13 Combined Analysis.

**Unfinished workflow:** Manual journal entry into the product and truthful live/paper readiness are not complete.

### WS02 — Create an environment or standalone book

**Improve existing · Dialog / short flow · Core**

Current base: Existing New profile dialog; current persisted types are live/replay.

**UI contents:**

- Keep the existing creation dialog styling.
- Offer the user jobs: Journal only, Paper/replay, or Connected trading.
- Ask only for the book, account or dataset fields required by that job; show what will actually be created.

**User actions:** Create a manual book without a broker; Prepare a paper environment; Configure a connected environment.

**Connects to:** WS03 Open: portfolio/environment management, WS06 Paper/replay setup and run library, WS08 Independent journal books and book setup, SET02 Connections and account/provider setup.

**Unfinished workflow:** Journal-only is a required first-use path, not currently a distinct persisted profile type. Define migration before changing ownership.

### WS03 — Open: portfolio/environment management

**Improve existing · Page with three existing tabs · Core**

Current base: /workspace/profiles/:id · TraderProfileDetail.tsx / ProfileShell.tsx.

**UI contents:**

- Overview: identity, account/book, observed balances, readiness and running-task shortcuts.
- Connections: this environment’s data/account/terminal bindings.
- Settings: defaults, timezone, limits and archive; Chart and Journal remain shortcuts out of management.

**User actions:** Resolve missing setup; Open the existing chart or book; Prepare/resume paper runs.

**Connects to:** WS04 Original chart terminal, WS06 Paper/replay setup and run library, WS08 Independent journal books and book setup, SET02 Connections and account/provider setup, AUTO05 Strategy bot deployments and operations.

**Unfinished workflow:** The navigation separation is implemented; readiness and balance labels still need to be backed by observed scoped data.

### WS04 — Original chart terminal

**Keep and connect · Existing full terminal · Core**

Current base: /trading?profileId=:id · Trading.tsx / ChartPane.

**UI contents:**

- Keep the existing toolbar, chart grid, drawings, watchlist, indicator controls, right rail and bottom dock.
- Add source/account/mode/readiness and instrument context within the existing controls.
- Use contextual links to Fundamentals, journal evidence and a Strategy Builder project.

**User actions:** Search/change instrument and timeframe; Apply a built-in or validated custom indicator; Open research, log/review a trade, or inspect a report’s trade.

**Connects to:** WS05 Orders, positions and execution context, WS07 Paper session in the original chart, WS09 Journal review workspace, SB02 Indicator/strategy authoring, SB06 Saved performance report and trade drilldown, FND02 Company/asset overview, SH01 Instrument, source and saved-data picker.

**Unfinished workflow:** The terminal exists. Research, dataset, project revision and book handoffs are not all connected; opening the chart must not start a bot.

### WS05 — Orders, positions and execution context

**Keep and connect · Existing chart dock / order dialogs · Connected**

Current base: TradingDock.tsx; Orders / Positions / Trades / GTT.

**UI contents:**

- Keep the existing order/position/trade views and chart-side order tools.
- Show the actual selected account, demo/live state, connection health and command outcome.
- Present risk, sizing, protective-order support and copying destinations only when supported.

**User actions:** Preview an eligible order; Inspect working orders and confirmed fills; Modify/cancel/close with explicit account context.

**Connects to:** WS04 Original chart terminal, WS09 Journal review workspace, AUTO04 Runs, logs, approvals and recovery, SET02 Connections and account/provider setup.

**Unfinished workflow:** The dock currently uses legacy global broker/app mode. Profile labels do not establish per-account execution authority. Multi-account execution/copying requires later verified contracts.

### WS06 — Paper/replay setup and run library

**Configuration only · Run list + setup flow · Core**

Current base: TraderReplay.tsx and profile Overview run shortcuts.

**UI contents:**

- Keep existing run cards/creation controls; distinguish manual replay from automated testing.
- Select a real saved dataset, instrument, range, timezone, starting balance and simulation costs.
- Show coverage errors, warmup and resume/checkpoint status before enabling Start.

**User actions:** Select saved history; Create a paper run; Resume or inspect an existing run.

**Connects to:** SH01 Instrument, source and saved-data picker, WS07 Paper session in the original chart, SB05 Backtest setup and experiment jobs.

**Unfinished workflow:** Current run creation stores a source description and Draft state. It does not prove a dataset-bound persistent paper ledger.

### WS07 — Paper session in the original chart

**Keep and connect · Original chart replay controls + session summary · Core**

Current base: Trading.tsx / WorkspaceReplayBar; existing replay mechanics.

**UI contents:**

- Keep chart presentation and replay controls.
- Make the simulation clock, available data, paper orders/positions and session book visible.
- Show completed-run results and restart/resume behavior.

**User actions:** Step/play/pause history; Place supported paper orders; Review session trades and journal.

**Connects to:** WS04 Original chart terminal, WS06 Paper/replay setup and run library, WS09 Journal review workspace.

**Unfinished workflow:** Visual replay exists; deterministic paper fills, durable session/account state and once-only journal ingestion need an integrated verification journey.

### WS08 — Independent journal books and book setup

**Missing · Book selector / focused book entry · Core**

Current base: Existing profile Journal actions are the starting surface.

**UI contents:**

- Each connected book names exactly one account; manual books have no external account binding.
- Show book identity and source/sync coverage without requiring a chart or execution setup.
- Open the existing journal presentation, not a new replacement ledger.

**User actions:** Create/open a manual book; Bind a connected book to one verified account; Import a statement or configure read-only sync.

**Connects to:** WS09 Journal review workspace, WS11 Statement import and validation, WS12 Read-only journal sync and reconciliation.

**Unfinished workflow:** Current journal persistence is profile-scoped. A distinct durable book/account model and existing multi-destination migration are still required.

### WS09 — Journal review workspace

**Keep and connect · Existing focused journal and tabs · Core**

Current base: /workspace/profiles/:id/journal · TraderJournal.tsx.

**UI contents:**

- Preserve Overview, Trades, Calendar, Breakdown and optional Mind.
- Keep book identity, filters, trade details, notes and performance charts.
- Add source/coverage and review actions in the existing hierarchy; keep portfolio management behind Open.

**User actions:** Filter and review this book; Open a trade’s chart/research/strategy evidence; Log, edit or close a trade.

**Connects to:** WS10 Capture, edit, close and review a trade, WS11 Statement import and validation, WS12 Read-only journal sync and reconciliation, WS04 Original chart terminal, FND08 Saved research and decision notebook, SB06 Saved performance report and trade drilldown.

**Unfinished workflow:** Separation and chart/management return filters are tested. Complete book ownership, source reconciliation and the full trade lifecycle remain unfinished.

### WS10 — Capture, edit, close and review a trade

**Improve existing · Existing dialog + expanded trade detail · Core**

Current base: TraderJournal.tsx / useTraderData.ts.

**UI contents:**

- Lock the destination book/account and show timezone and asset-appropriate quantity units.
- Keep open-trade facts separate from close facts and realized P&L.
- Keep source facts separate from user notes, screenshots, setup tags and review choices.

**User actions:** Save an open or completed manual trade; Edit/correct or close the same record; Attach chart/research evidence and review.

**Connects to:** WS09 Journal review workspace, WS04 Original chart terminal, FND08 Saved research and decision notebook.

**Unfinished workflow:** Manual creation/deletion and review fields exist; the data hook has no complete update/close lifecycle. Preserve drafts on save failure.

### WS11 — Statement import and validation

**Missing · Connected import flow · Core**

Current base: New flow beside existing Log trade; reuse journal components.

**UI contents:**

- Choose a book/account, source file and timezone/units mapping.
- Preview valid rows, row errors, duplicates, corrections and source coverage before commit.
- Show a durable import result and reversible/recoverable correction path.

**User actions:** Upload/select a statement; Map and validate fields; Commit valid records or resolve issues.

**Connects to:** WS08 Independent journal books and book setup, WS09 Journal review workspace, WS12 Read-only journal sync and reconciliation.

**Unfinished workflow:** A market-candle CSV upload and journal CSV export are not a trade-statement import workflow.

### WS12 — Read-only journal sync and reconciliation

**Missing · Book source panel + activity/conflict views · Core**

Current base: Profile Connections currently stores configuration only.

**UI contents:**

- Show the account/source binding, history coverage, last successful sync and current job.
- Show new/corrected records and ambiguous cross-source matches without discarding notes.
- Provide retry, backfill/import and conflict resolution; cached journal remains readable offline.

**User actions:** Connect a supported read-only history source; Sync while the local engine is running; Resolve gaps, duplicate candidates and corrections.

**Connects to:** SET02 Connections and account/provider setup, SH02 Activity, jobs and notifications, WS11 Statement import and validation, WS09 Journal review workspace.

**Unfinished workflow:** Needs real adapters, cursors, account identity and canonical executions. A chart tab need not stay open; closing the local engine stops updates.

### WS13 — Combined Analysis

**Working slice · Existing analytics page · Core**

Current base: /workspace/combined · CombinedLiveAnalytics.tsx.

**UI contents:**

- Keep selection, clear-all and explicit Save selection.
- Keep currency groups and the same portfolio selection behind every displayed result.
- Add coverage, duplicate-account/source protection and live/paper comparison rules as their contracts mature.

**User actions:** Choose portfolios; Save/reopen a selection; Review selected metrics and return to an individual portfolio.

**Connects to:** WS01 Workspace home and environments, WS09 Journal review workspace.

**Unfinished workflow:** Selection/empty/save behavior and selected-only results are tested. Canonical account deduplication, named comparison sets and broader analytics semantics remain separate work.

## Fundamentals

Research companies and assets, inspect original evidence and carry decisions into charts and journal reviews.

Research is usable without an execution account. Company facts, quotes, macro data and relationship intelligence each need verified source coverage.

### FND01 — Research home, search and saved lists

**Missing · New research page using existing app components · Core**

Current base: /fundamentals now has an availability notice; company search/source service is not implemented.

**UI contents:**

- Search company/asset names with issuer/listing disambiguation.
- Show saved lists and recently researched entities.
- Expose supported coverage and source availability rather than a fake populated dashboard.

**User actions:** Find an issuer/listing; Reopen saved research; Compare supported entities.

**Connects to:** FND02 Company/asset overview, FND07 Screener and company comparison, FND08 Saved research and decision notebook.

**Unfinished workflow:** A direct navigation destination now exists; the functional research workflow is absent. Yahoo is a source candidate, not a connected certified provider.

### FND02 — Company/asset overview

**Missing · Company page / tabs · Core**

Current base: New Fundamentals surface.

**UI contents:**

- Header: issuer and selected listing, source, as-of time and freshness.
- Center: sourced business description and supported headline facts; asset-specific layouts later.
- Tabs: Statements, Metrics, Reports, Events and later Relationships; explicit Chart and Save research actions.

**User actions:** Inspect a company; Change listing without changing issuer facts; Open a mapped original chart.

**Connects to:** FND03 Financial statements, FND04 Metrics, valuation and comparison definitions, FND05 Filings, original reports and source detail, FND06 Earnings and corporate events, WS04 Original chart terminal, FND08 Saved research and decision notebook.

**Unfinished workflow:** No fundamentals data model or page exists. Missing fields stay unavailable; fetching current facts does not make them historical backtest inputs.

### FND03 — Financial statements

**Missing · Company tab / period selector · Core**

Current base: New Income / Balance Sheet / Cash Flow views.

**UI contents:**

- Annual/quarterly periods, fiscal labels, units, scaling and currency.
- Reported values with source drilldown and missing-cell explanations.
- Restated versus as-reported selection only when supported by stored revisions.

**User actions:** Switch statements and periods; Inspect the original fact/report; Save a sourced view.

**Connects to:** FND02 Company/asset overview, FND05 Filings, original reports and source detail, FND08 Saved research and decision notebook.

**Unfinished workflow:** Normalization and report provenance are absent; duration and instant facts must not be treated interchangeably.

### FND04 — Metrics, valuation and comparison definitions

**Missing · Company tab / explanatory detail · Research expansion**

Current base: New Fundamentals metrics view.

**UI contents:**

- Supported reported/calculated ratios and growth with formula definitions.
- Period, price timestamp, currency and input citations for each calculation.
- Unavailable denominators, negative earnings and unsupported TTM shown honestly.

**User actions:** Inspect metric inputs; Compare consistent periods/entities; Record a research observation.

**Connects to:** FND03 Financial statements, FND07 Screener and company comparison, FND08 Saved research and decision notebook.

**Unfinished workflow:** Do not populate attractive metric tiles until their source/period/formula tests pass.

### FND05 — Filings, original reports and source detail

**Missing · Company tab + source inspector · Core**

Current base: New report index and fact-source panel.

**UI contents:**

- Document type, publication time, provider and original link.
- Fact-to-document references and revision/amendment context.
- Freshness, unavailable documents and refresh failure recovery.

**User actions:** Open an original report; Inspect a fact’s origin; Cite evidence in saved research.

**Connects to:** FND03 Financial statements, FND08 Saved research and decision notebook, SH02 Activity, jobs and notifications.

**Unfinished workflow:** An overview feed alone may not supply original filings. Verify report access separately rather than inventing citations.

### FND06 — Earnings and corporate events

**Missing · Company calendar / event detail · Research expansion**

Current base: New sourced event view.

**UI contents:**

- Dated earnings, dividends, splits and relevant announcements where covered.
- Separate announced/estimated/confirmed events and display source/timezone.
- Link to reports, chart timestamps and saved notes.

**User actions:** Inspect an event; Set a supported reminder; Open related chart/report.

**Connects to:** FND05 Filings, original reports and source detail, WS04 Original chart terminal, AUTO02 Visual automation builder.

**Unfinished workflow:** Events and estimates need their own coverage and revision contract; no universal calendar exists.

### FND07 — Screener and company comparison

**Missing · Research list / comparison workspace · Research expansion**

Current base: New Fundamentals surface.

**UI contents:**

- A declared supported universe and consistent metric/period filters.
- Side-by-side facts with source, currency and missing-value treatment.
- Saved criteria and explicit inclusion; avoid an opaque universal quality score.

**User actions:** Filter supported entities; Compare selected companies; Save a research list.

**Connects to:** FND01 Research home, search and saved lists, FND02 Company/asset overview, FND08 Saved research and decision notebook.

**Unfinished workflow:** Needs normalized facts and real universe coverage before the screening UI can make truthful comparisons.

### FND08 — Saved research and decision notebook

**Missing · Research note + immutable evidence snapshot · Core**

Current base: New local research records; references into existing journal.

**UI contents:**

- Notes, thesis, linked entities, reports and captured facts with source dates.
- Distinguish saved evidence from refreshed current data.
- Choose the destination book/trade/note when attaching research.

**User actions:** Save/reopen a snapshot; Attach a citation to a journal review; Return to the exact researched company or chart.

**Connects to:** FND02 Company/asset overview, FND05 Filings, original reports and source detail, WS09 Journal review workspace, WS04 Original chart terminal.

**Unfinished workflow:** There is no durable research notebook/snapshot workflow. A research note never creates a trade fill.

### FND09 — Company relationships

**Missing · Later relationship explorer · Research expansion**

Current base: New evidence-backed research expansion.

**UI contents:**

- Supplier/customer/ownership edges with type, source, date and evidence.
- Inspect relationships without treating inference as reported fact.
- Show changes over time and distinguish verified relationships from unavailable coverage.

**User actions:** Explore a sourced relationship; Inspect evidence; Open the related company.

**Connects to:** FND02 Company/asset overview, FND05 Filings, original reports and source detail, FND08 Saved research and decision notebook.

**Unfinished workflow:** This is part of the Bloomberg-like vision. A company overview source does not establish a complete customer/supplier graph.

### FND10 — Market intelligence, economic calendar and reports

**Missing · Market overview + macro/report detail · Research expansion**

Current base: New Fundamentals research expansion.

**UI contents:**

- Supported macro series, economic releases and original economic reports.
- Release time, observation period, revisions, source and freshness; original links for any licensed news/report coverage.
- Watchlists, dated events and chart overlays only where their data is supported.

**User actions:** Inspect a macro series or release; Open an original report; Save research or configure a supported reminder.

**Connects to:** FND05 Filings, original reports and source detail, FND08 Saved research and decision notebook, WS04 Original chart terminal, AUTO02 Visual automation builder.

**Unfinished workflow:** Price history alone supplies neither macro fundamentals nor news. Each dataset and calendar needs a source, coverage and revision contract.

### FND11 — Asset-specific fundamentals

**Missing · Asset pages with distinct data models · Research expansion**

Current base: New crypto / fund / FX-rates / futures research increments.

**UI contents:**

- Crypto: supply, issuance/unlocks and supported network/funding data with methodology.
- Funds: holdings, NAV and distributions; FX/rates: relevant economic series and rate context.
- Futures: contract, expiry/roll and term structure. Retain source, date, units and missing-data rules throughout.

**User actions:** Choose a supported asset type; Inspect its relevant fundamentals; Open the matching original chart or cited research.

**Connects to:** FND01 Research home, search and saved lists, FND08 Saved research and decision notebook, FND10 Market intelligence, economic calendar and reports, WS04 Original chart terminal.

**Unfinished workflow:** Universal architecture does not make one company-ratio template suitable for every asset class. Verify and release each asset model separately.

## Strategy Builder

Create indicators or executable strategies, test them, inspect evidence and deliberately apply validated work to charts or paper environments.

Indicator and Strategy are the two artifact kinds. A bot is a deployment of a strategy revision. Backtests, optimization trials and real trades remain different records.

### SB01 — Project library

**Missing · Dedicated Strategy Builder page · Core**

Current base: /strategy-builder currently says the new builder is unavailable.

**UI contents:**

- Create Indicator or Create Strategy; search and reopen saved projects.
- Show drafts, validated revisions, parameter sets and latest experiment.
- Import/export, duplicate and archive without exposing legacy tool hosts.

**User actions:** Create/open a project; Resume an experiment; Open a saved report.

**Connects to:** SB02 Indicator/strategy authoring, SB05 Backtest setup and experiment jobs, SB06 Saved performance report and trade drilldown.

**Unfinished workflow:** The old launchers were removed. A new project library is not implemented.

### SB02 — Indicator/strategy authoring

**Reuse components · Project editor · Core**

Current base: Existing ScriptPanel, compiler and source store are reuse points.

**UI contents:**

- Left: project files/dependencies; center: code or supported visual rules.
- Right: typed parameters, plots and strategy settings; bottom: diagnostics/preview.
- Draft/revision status and save/conflict recovery. Keep chart-side editing linked to the same project.

**User actions:** Save a draft; Validate and freeze a revision; Preview an indicator or define executable strategy rules.

**Connects to:** SB03 Indicator preview and validation, SB04 Strategy rules and trading assumptions, SB05 Backtest setup and experiment jobs, WS04 Original chart terminal.

**Unfinished workflow:** Current chart scripts are not a durable versioned project/dependency library. Arbitrary code need not round-trip into visual blocks.

### SB03 — Indicator preview and validation

**Reuse components · Editor preview / diagnostics · Core**

Current base: Existing custom indicator registration and chart application.

**UI contents:**

- Selected dataset, typed inputs, overlay/pane outputs and reference values.
- Warmup, missing bars, higher-timeframe availability and repaint behavior.
- Show validation outcome and exact revision/parameters.

**User actions:** Preview output; Validate reference behavior; Apply to an original chart or use in a strategy.

**Connects to:** SB02 Indicator/strategy authoring, SB04 Strategy rules and trading assumptions, WS04 Original chart terminal.

**Unfinished workflow:** An indicator has no trading P&L on its own. Add explicit strategy rules before performance testing.

### SB04 — Strategy rules and trading assumptions

**Missing · Editor rules/settings panels · Core**

Current base: Reuse compiler and executable-strategy classification.

**UI contents:**

- Entry/exit conditions, indicator dependencies, sizing, stops/targets and session rules.
- Bar-close/next-open timing and supported fill policy.
- Instrument economics, cost assumptions and clear validation errors.

**User actions:** Build supported visual rules or code; Validate execution semantics; Configure a baseline test.

**Connects to:** SB02 Indicator/strategy authoring, SB05 Backtest setup and experiment jobs.

**Unfinished workflow:** A configurable collection of indicators is not yet an executable strategy.

### SB05 — Backtest setup and experiment jobs

**Reuse components · Test setup + durable job view · Core**

Current base: Existing chart-bound BacktestPanel / worker / backtestRun.

**UI contents:**

- Pin revision, parameters, instrument, dataset version, range and warmup.
- Set costs, fill assumptions and resource budget.
- Show queued/running/completed/failed/cancelled/interrupted states and recovery.

**User actions:** Choose saved data; Run/cancel a bounded experiment; Reopen its report after leaving the chart.

**Connects to:** SH01 Instrument, source and saved-data picker, SH02 Activity, jobs and notifications, SB06 Saved performance report and trade drilldown.

**Unfinished workflow:** The reusable chart-bound engine is not a standalone offline dataset/job/report product.

### SB06 — Saved performance report and trade drilldown

**Reuse components · Persistent experiment report · Core**

Current base: Existing equity/drawdown/trade result components.

**UI contents:**

- Overview/assumptions, equity/drawdown, trades, costs/exposure, breakdowns and diagnostics.
- Exact manifest, dataset range, engine and revision identity.
- Click a simulated trade to inspect its original-chart context; return to the same report.

**User actions:** Inspect a baseline result; Export/reopen results; Compare or start a bounded validation study.

**Connects to:** WS04 Original chart terminal, SB07 Parameter optimization and candidate ledger, SB08 Out-of-sample and stress testing, SB09 Compare, save and promote a candidate.

**Unfinished workflow:** Current inspected result state is chart component state; durable reproducible reports and complete metric definitions are missing.

### SB07 — Parameter optimization and candidate ledger

**Missing · Experiment study configuration + results · Core**

Current base: New builder study workflow; reuse validated run engine.

**UI contents:**

- Parameter ranges/constraints, trial estimate and budget.
- Every candidate, rejection/failure and scoring objective.
- Performance/drawdown/cost/sample-size tradeoffs and parameter stability.

**User actions:** Run bounded grid/random search; Inspect all attempted trials; Save a parameter set against its exact revision.

**Connects to:** SB06 Saved performance report and trade drilldown, SB08 Out-of-sample and stress testing, SB09 Compare, save and promote a candidate.

**Unfinished workflow:** Existing parameter inputs and portfolio allocation analytics do not implement strategy optimization.

### SB08 — Out-of-sample and stress testing

**Missing · Validation study + comparative report · Core**

Current base: P21 robustness work; existing pieces have narrower scope.

**UI contents:**

- Chronological train/validation/holdout and walk-forward definitions.
- Supported cost/slippage/latency/market-period stresses and seeded resampling.
- Scenario assumptions, degradation, failures and absolute results; distinguish execution reruns from return transformations.

**User actions:** Define a study; Compare baseline and scenarios; Record limitations and candidate decisions.

**Connects to:** SB06 Saved performance report and trade drilldown, SB07 Parameter optimization and candidate ledger, SB09 Compare, save and promote a candidate.

**Unfinished workflow:** No complete arbitrary-strategy stress/walk-forward product exists; do not relabel fixed-allocation analytics as one.

### SB09 — Compare, save and promote a candidate

**Missing · Candidate decision / explicit handoff · Core**

Current base: New builder candidate workflow.

**UI contents:**

- Compare revision, data, costs and trial conditions before ranking.
- Save a selected parameter set and the researcher’s explanation.
- Separate Apply indicator, Inspect trades, Create paper run and Prepare bot deployment actions.

**User actions:** Apply a validated indicator to a chosen chart; Test a strategy in a paper environment; Prepare an eligible account-bound deployment.

**Connects to:** WS04 Original chart terminal, WS06 Paper/replay setup and run library, AUTO05 Strategy bot deployments and operations.

**Unfinished workflow:** Promotion is explicit and reversible at draft stage. A good backtest never grants live execution permission.

## Workflows

Automate repeatable tasks and operate their runs with explicit scope, logs and recovery.

Keep Flow. It orchestrates triggers and actions; it is not an indicator editor or a substitute strategy tester.

### AUTO01 — Workflow library and useful templates

**Keep and connect · Existing list page · Core**

Current base: /flow · FlowIndex.tsx.

**UI contents:**

- Keep saved workflow cards, import/export and active/draft state.
- Group supported templates by user job: alerts, data refresh, reports and eligible trading actions.
- Show bound environment/account and last run without claiming unsupported actions are ready.

**User actions:** Create/open a workflow; Duplicate/import a workflow; Inspect recent runs.

**Connects to:** AUTO02 Visual automation builder, AUTO04 Runs, logs, approvals and recovery.

**Unfinished workflow:** The engine/list exists. Research refresh and journal-sync templates require real underlying actions.

### AUTO02 — Visual automation builder

**Keep and connect · Existing Flow graph editor · Core**

Current base: /flow/editor/:id · FlowEditor.tsx.

**UI contents:**

- Keep node palette, graph canvas, node settings and execution logs.
- Define trigger, inputs, conditions, action capabilities and target scope.
- Link supported saved project/jobs instead of copying strategy code into another engine.

**User actions:** Build a schedule/event workflow; Validate its graph and bindings; Preview/test before activating.

**Connects to:** AUTO03 Test, permissions and activation, AUTO04 Runs, logs, approvals and recovery, SET02 Connections and account/provider setup.

**Unfinished workflow:** Existing global user/API-key binding must evolve into explicit environment/account/project revision bindings.

### AUTO03 — Test, permissions and activation

**Improve existing · Builder test/activation flow · Core**

Current base: Existing Flow validation and lifecycle guards are reuse points.

**UI contents:**

- Show resolved account/environment, exact action permissions and expected effects.
- Separate read-only preview from real action execution.
- Make schedules, webhook credentials, approvals and activation status clear.

**User actions:** Validate/test safely; Choose enabled scope; Activate or keep a draft.

**Connects to:** AUTO02 Visual automation builder, AUTO04 Runs, logs, approvals and recovery.

**Unfinished workflow:** A generic Play button cannot hide execution authority or pretend an unimplemented read-only preview is a dry run.

### AUTO04 — Runs, logs, approvals and recovery

**Keep and connect · Existing run/detail/approval surfaces · Core**

Current base: Flow run logs and ActionCenter are reuse points.

**UI contents:**

- Trigger, scope, each step’s result, outputs and timestamps.
- Failure, partial outcome, retry/cancel and current approval queue.
- Link account fills to their book and research/data jobs to their own artifacts.

**User actions:** Inspect a run; Resolve approvals/failures; Retry only supported idempotent steps.

**Connects to:** AUTO01 Workflow library and useful templates, AUTO02 Visual automation builder, WS09 Journal review workspace, SH02 Activity, jobs and notifications.

**Unfinished workflow:** Need one visible execution history with step outcomes. Retrying an unknown trading submission must not duplicate an order.

### AUTO05 — Strategy bot deployments and operations

**Reuse components · Runtime/deployment detail; linked from profile and builder · Connected**

Current base: Existing StrategiesPanel / OpenScript deployment and runner services.

**UI contents:**

- Frozen strategy revision, parameters, instrument/source and paper/demo/live account.
- Running/stopped/error state, logs and account risk settings.
- Separate Stop bot, Cancel orders and Close positions; closing a chart does not control backend lifetime.

**User actions:** Prepare a deployment from a candidate; Explicitly start/stop eligible runtime; Inspect its account activity and journal.

**Connects to:** SB09 Compare, save and promote a candidate, WS03 Open: portfolio/environment management, WS05 Orders, positions and execution context, WS09 Journal review workspace, AUTO04 Runs, logs, approvals and recovery.

**Unfinished workflow:** User-confirmed navigation home: Workflows → Deployments, with contextual Builder/profile/chart links. This is a separate runtime type, not a Flow graph. Existing runtimes and scheduler dependencies must be migrated safely.

## Settings

Configure account preferences, connection providers, developer access and the application without burying the daily trading/research jobs.

Global provider setup belongs here. Portfolio-specific bindings remain behind that environment’s Open → Connections. Using a dataset should open a shared picker directly from the task.

### SET01 — Account and application preferences

**Working slice · Existing settings pages / tabs · Core**

Current base: /settings and /profile.

**UI contents:**

- Keep account/security, alerts, appearance, email and existing system controls.
- Make global versus portfolio settings clear.
- Provide optional account setup and a return to the current work.

**User actions:** Change relevant preferences; Manage account security; Return to Settings or the previous work.

**Connects to:** SET02 Connections and account/provider setup, SET04 Developer API and integration access, SET05 System, diagnostics and optional AI.

**Unfinished workflow:** Configuration grouping is implemented. Some legacy controls still depend on a broker/app session; local-first access needs capability-specific migration.

### SET02 — Connections and account/provider setup

**Improve existing · Connections & Data tabs + connector setup flow · Core**

Current base: /settings/connections and profile Connections.

**UI contents:**

- Choose connection purpose: account history, market data, research data or execution.
- Show provider/platform, observed status, supported permissions and account identity.
- Separate global connection registration from per-environment source/account bindings.

**User actions:** Connect a supported crypto exchange, brokerage or terminal bridge; Grant only needed supported capabilities; Map an account/source to the intended environment/book.

**Connects to:** WS03 Open: portfolio/environment management, WS12 Read-only journal sync and reconciliation, SH01 Instrument, source and saved-data picker, FND01 Research home, search and saved lists.

**Unfinished workflow:** Current app-wide broker credential form and browser-local profile account records are separate. Grouped navigation is not a universal connector implementation.

### SET03 — Market history and data management

**Keep and connect · Existing Historify UI + coverage/source details · Core**

Current base: /historify · Historify.tsx / DuckDB services.

**UI contents:**

- Keep watchlist/download jobs, schedules, catalog and CSV/Parquet import/export.
- Add source, instrument identity, range, interval, quality and dataset version.
- Provide task-specific Open in chart / Use in replay / Use in backtest links.

**User actions:** Import/download entitled data; Inspect gaps and version/coverage; Select an existing dataset for the current task.

**Connects to:** SH01 Instrument, source and saved-data picker, WS04 Original chart terminal, WS06 Paper/replay setup and run library, SB05 Backtest setup and experiment jobs.

**Unfinished workflow:** Storage/import/download capabilities exist. Verified reusable datasets, broker-free local use and exact context handoffs still need integration.

### SET04 — Developer API and integration access

**Working slice · Existing developer key controls · Core**

Current base: /apikey.

**UI contents:**

- Keep developer access key management separate from broker credentials.
- Explain which scripts/webhooks/integrations use this access.
- Keep approval-mode and authorized integration configuration reachable.

**User actions:** Inspect/manage authorized developer access; Configure supported integrations; Return to Settings.

**Connects to:** AUTO02 Visual automation builder, AUTO04 Runs, logs, approvals and recovery.

**Unfinished workflow:** The page exists. Per-client least-privilege access and universal adapter setup are not established by one developer key.

### SET05 — System, diagnostics and optional AI

**Working slice · Existing admin and Agent configuration pages · Core**

Current base: /admin /agent/config and diagnostic/monitoring routes.

**UI contents:**

- Keep market calendars/timings, diagnostics, monitoring and applicable access controls.
- Keep optional AI provider/model configuration and its explicit permissions.
- Expose backup/restore, storage health and maintenance through the shared recovery surface.

**User actions:** Diagnose a failed job/connection; Configure optional assistance; Open local backup/recovery.

**Connects to:** SH02 Activity, jobs and notifications, SH03 Backup, restore and storage recovery.

**Unfinished workflow:** Administrative controls exist; an assistant is optional and never the source of invented market or company facts.

## Shared surfaces

Provide reusable task-level pickers and recovery tools across every section.

These are dialogs, drawers or shared pages reached from the user’s current task. They are not another top-level Tools directory.

### SH01 — Instrument, source and saved-data picker

**Missing · Shared task-aware picker · Core**

Current base: Reuse existing instrument search and Historify catalog.

**UI contents:**

- Resolve the exact instrument/listing/contract and requested data capability.
- Show saved/live options, coverage, freshness, entitlement and compatibility.
- Keep the requested chart/replay/experiment context when setup or download is needed.

**User actions:** Choose compatible data; Import/download missing history; Return to the same pending task.

**Connects to:** WS04 Original chart terminal, WS06 Paper/replay setup and run library, SB05 Backtest setup and experiment jobs, FND02 Company/asset overview, SET02 Connections and account/provider setup, SET03 Market history and data management.

**Unfinished workflow:** A free-text data-source label is not a dataset selection. A trading account is not mandatory for eligible local-data tasks.

### SH02 — Activity, jobs and notifications

**Improve existing · Shared activity drawer / linked job details · Core**

Current base: Reuse Historify jobs, Flow logs, diagnostics; unify ownership.

**UI contents:**

- Scoped queued/running/failed/stale work with last successful outcome.
- Source/account/book/project/run identity and a route to the owning section.
- Progress, supported cancel/retry, interrupted recovery and actionable notifications.

**User actions:** Track a sync, download, research refresh or experiment; Inspect the owning job; Recover without losing the original task.

**Connects to:** WS12 Read-only journal sync and reconciliation, SET03 Market history and data management, SB05 Backtest setup and experiment jobs, FND05 Filings, original reports and source detail, AUTO04 Runs, logs, approvals and recovery.

**Unfinished workflow:** Different modules have partial job/log UIs. They do not yet form one durable cross-module activity trail.

### SH03 — Backup, restore and storage recovery

**Missing · Shared settings recovery flow · Core**

Current base: Existing journal CSV export and backend databases are incomplete pieces.

**UI contents:**

- Choose a complete local backup with data/dependency manifest; exclude secrets by default.
- Validate a restore, show conflicts and offer recovery before replacing records.
- Include books, environments, chart layouts, research, projects and results under a defined policy.

**User actions:** Export a full backup; Validate/restore on a clean installation; Recover an interrupted migration.

**Connects to:** WS01 Workspace home and environments, WS08 Independent journal books and book setup, SB01 Project library, FND08 Saved research and decision notebook, SET05 System, diagnostics and optional AI.

**Unfinished workflow:** A filtered trade CSV is not a complete backup. Durable ownership and migration rules are foundational P01/P02 work.

## End-to-end journeys


### Journal only: record and improve trading done elsewhere

WS01 Workspace home and environments → WS02 Create an environment or standalone book → WS08 Independent journal books and book setup → WS10 Capture, edit, close and review a trade → WS09 Journal review workspace

A manual book is useful without chart data, a broker connection, bots or AI. Chart drilldown is optional.

Recovery requirement: preserve the book/account/project/dataset and return target; report missing data, permission or incomplete outcomes explicitly.

Optional branches: WS04 Original chart terminal.

### Connected journal: import, catch up and reconcile

WS08 Independent journal books and book setup → SET02 Connections and account/provider setup → WS12 Read-only journal sync and reconciliation → WS09 Journal review workspace

One account’s source observations reconcile into its book; duplicate candidates and corrections preserve user notes. Statement import is an alternative initial source or a backfill when needed.

Recovery requirement: preserve the book/account/project/dataset and return target; report missing data, permission or incomplete outcomes explicitly.

Optional branches: WS11 Statement import and validation.

### Discretionary paper/replay: learn from saved history

WS01 Workspace home and environments → WS06 Paper/replay setup and run library → SH01 Instrument, source and saved-data picker → WS07 Paper session in the original chart → WS09 Journal review workspace

The original chart runs a dataset-bound paper session, saves its fills once and resumes after restart.

Recovery requirement: preserve the book/account/project/dataset and return target; report missing data, permission or incomplete outcomes explicitly.

### Build an indicator and use it on the original chart

SB01 Project library → SB02 Indicator/strategy authoring → SB03 Indicator preview and validation → WS04 Original chart terminal

An exact validated indicator revision and parameter set attach to the chosen chart without submitting orders.

Recovery requirement: preserve the book/account/project/dataset and return target; report missing data, permission or incomplete outcomes explicitly.

### Build, test, stress and paper-validate a strategy

SB01 Project library → SB02 Indicator/strategy authoring → SB04 Strategy rules and trading assumptions → SH01 Instrument, source and saved-data picker → SB05 Backtest setup and experiment jobs → SB06 Saved performance report and trade drilldown → SB08 Out-of-sample and stress testing → SB09 Compare, save and promote a candidate → WS06 Paper/replay setup and run library → WS09 Journal review workspace

The candidate has saved reproducible evidence; research trials stay outside real-account journal P&L. Parameter search is a separate optional study, not a mandatory way to manufacture a winner.

Recovery requirement: preserve the book/account/project/dataset and return target; report missing data, permission or incomplete outcomes explicitly.

Optional branches: SB07 Parameter optimization and candidate ledger.

### Research a company and retain the decision evidence

FND01 Research home, search and saved lists → FND02 Company/asset overview → FND03 Financial statements → FND05 Filings, original reports and source detail → FND08 Saved research and decision notebook

Research is useful on its own. Optional chart and journal links retain the decision evidence; unsupported company relationships remain unavailable.

Recovery requirement: preserve the book/account/project/dataset and return target; report missing data, permission or incomplete outcomes explicitly.

Optional branches: WS04 Original chart terminal; WS09 Journal review workspace.

### Automate a supported task and recover failures

AUTO01 Workflow library and useful templates → AUTO02 Visual automation builder → AUTO03 Test, permissions and activation → AUTO04 Runs, logs, approvals and recovery → SH02 Activity, jobs and notifications

The task runs with explicit capabilities, visible outcomes and supported recovery; activation never invents missing actions.

Recovery requirement: preserve the book/account/project/dataset and return target; report missing data, permission or incomplete outcomes explicitly.

### Connected discretionary trading

SET02 Connections and account/provider setup → WS03 Open: portfolio/environment management → WS04 Original chart terminal → WS05 Orders, positions and execution context → WS12 Read-only journal sync and reconciliation → WS09 Journal review workspace

Eligible account-specific fills reach their own books. No strategy project or bot is required. Copying follows verified single-account execution.

Recovery requirement: preserve the book/account/project/dataset and return target; report missing data, permission or incomplete outcomes explicitly.

### Prepare and operate an account-bound strategy bot

SB09 Compare, save and promote a candidate → SET02 Connections and account/provider setup → AUTO05 Strategy bot deployments and operations → AUTO04 Runs, logs, approvals and recovery → WS12 Read-only journal sync and reconciliation → WS09 Journal review workspace

A strategy candidate becomes a separately configured deployment after capability and account/risk checks. The chart is an optional view; it does not control the runtime lifetime.

Recovery requirement: preserve the book/account/project/dataset and return target; report missing data, permission or incomplete outcomes explicitly.

Optional branches: WS04 Original chart terminal; WS05 Orders, positions and execution context.

## Shared screen state contract

For every screen above, specify first-use/empty, loading, saved, unsaved, partial, failed/retry, stale/offline, unauthorized/unsupported and interrupted/recovery states as applicable. Include keyboard/narrow layout, preserving drafts and returning from setup. Cancellation and destructive changes must identify their exact scope.

Examples: missing chart data opens SH01 and returns to the requested instrument; expired sync keeps cached journal entries and offers reauthentication/backfill; failed backtest preserves the pinned manifest and logs; missing fundamentals keeps supported source-backed fields without fabricating the rest.

## Accepted placement decisions

1. User-confirmed primary tab order: Workspace, Fundamentals, Strategy Builder, Workflows. All four remain directly visible; Settings and shared resources stay contextual.
2. Use the current Chart / Journal / Open model. Add a first-use Journal only job without forcing it to be a live trading account.
3. Start Fundamentals with sourced company overview, statements and original reports; treat relationship intelligence and other asset classes as staged expansions.
4. User-confirmed runtime placement: Workflows → Deployments, linked from a strategy candidate, profile Overview and chart. A deployment is not converted into a Flow graph.
5. Apply the confirmed one-active-connected-book/account rule and conservative legacy classification in P00_DECISIONS. P01/P02 implement identity, migration and chart-workspace association contracts without guessing old record ownership.

## Order of work

1. Use the accepted screen/journey map and confirmed book/environment/runtime decisions as the baseline for implementation.
2. Retain the accepted original-screen layouts and walkthroughs as implementation acceptance criteria; apply the documented state/recovery and regression checks to each delivered feature.
3. Freeze P01 identities/capabilities and implement P02 durable migration/restore. These prevent each module creating a different account, instrument or trade model.
4. Complete journal lifecycle/import and the saved-data → original chart → persistent paper session → journal loop using P03/P04/P05/P06/P22, with real read-only adapters behind P07 gates.
5. Build Strategy Builder from the project/editor baseline into saved experiments and reports, then optimization/stress/candidate promotion through P20/P21. Reuse working engine components.
6. After identity/storage/source contracts, deliver the first company research slice through P13/P14/P16. It can develop independently of execution; broader relationships/asset coverage follow verified datasets.
7. Certify account-specific execution and later copying through P07–P12. Integrate supported research/sync/experiment actions and runtime operations through P17.

This is a dependency sequence, not an instruction to defer all Fundamentals design until every broker is connected. Layout proposals for all primary sections belong in P00 now; implementation ships in bounded, tested journeys.

## Related detailed plans and evidence

- [Original-app scope and confirmed book rules](EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md).
- [Journal separation implementation](JOURNAL_SEPARATION_IMPLEMENTATION.md) and [Combined Analysis evidence](COMBINED_ANALYSIS_IMPLEMENTATION.md).
- [Settings / Connections & Data evidence](SETTINGS_AND_DATA_WORKFLOW.md).
- [Strategy Builder gap review](STRATEGY_BUILDER_GAP_REVIEW.md), [P20](../p20/IMPLEMENTATION_PLAN.md), [P21](../p21/IMPLEMENTATION_PLAN.md).
- [First Fundamentals implementation plan](../p14/IMPLEMENTATION_PLAN.md).
- [Current P00 decisions](P00_DECISIONS.md), [layout/state contracts](P00_SCREEN_CONTRACTS.md) and [final acceptance gate](P00_ACCEPTANCE.md).
- [Review-artifact checks and remaining decisions](APP_WORKFLOW_REVIEW_EVIDENCE.md).
- [Master roadmap](../MASTER_PLAN.md).

Inventory: 6 review groups (5 primary/configuration groups plus shared surfaces), 46 screens/panels/flows, 9 end-to-end journeys. This inventory adds no completed milestones.
