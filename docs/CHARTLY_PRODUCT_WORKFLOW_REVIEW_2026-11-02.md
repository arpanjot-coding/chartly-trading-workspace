# Chartly: product and workflow review

Review date: 2 November 2026. Purpose: evaluate the existing app against a free, open-source, local-first journal, charting and deliberate-practice product. This is an assessment and proposed workflow specification; it does not implement the proposed features.

## Product conclusion

Chartly has substantial chart infrastructure and a rich journal presentation. Its strongest opportunity is to connect them into one dependable learning loop: bring trade history or market data, study a chart, practise or trade, capture the result, review the decision, and return with a concrete improvement goal.

The current product does not yet complete that loop. Several new profile surfaces describe future connector behavior, while underlying broker tools use a separate global broker/API model. Historical replay is real, but historical paper execution, durable run results and automatic journaling are missing at the integration boundary. The journal can create records and calculate many metrics, but lacks the everyday edit/close/review/recovery lifecycle.

The next milestone should be one excellent, provable end-to-end workflow. Adding more broker names, indicators or analytics panels before that would increase maintenance without resolving the core product gap.

## Evidence and limits

- Ten specialist source reviews cover journal, charts, replay, connections, data/history, execution/risk, navigation/onboarding, research tools, automation/operations, and open-source readiness. Their reports are linked below.
- Parent browser inspection visited Workspace, the existing live profile, Connections, Journal, and Chart. The current profile has no configured destinations and no trades. The chart opened as an empty plotting area; searching EURUSD returned “No matching symbols”. This observation applies to this local session and data configuration, not all supported brokers.
- Connections visibly says its account/terminal/source/copy settings are saved locally and that live orders and auto-sync await the connector phase.
- Source guards for chart and tool routes require authentication and a broker; this browser session nevertheless opens the chart. This is not evidence that a fresh installation can chart without credentials. A separate fresh-session test remains necessary.
- Existing trader metric/model tests passed: 2 files, 19 tests. The replay specialist ran 4 replay test files: 39 tests passed. The data specialist ran 3 historical-feed/timeframe/interval files: 44 tests passed. Total: 102 tests across 9 files. These are focused component/domain checks, not end-to-end broker or fill-quality certification.
- No user trades, profiles, connections or settings were created or deleted during this audit. No broker order was submitted. No app implementation was changed.
- Architecture documents are design intent, not proof that a connector exists or that their market/legal claims are correct. Runtime and source evidence take precedence.

## What the product should promise

“Bring your own trading history and market data. Chart, journal, practise and review locally, with optional connections to your own accounts.”

Free software and free market data are separate promises. Users should receive useful journaling without any price feed. Replay needs suitable historical bars or ticks; trade statements alone cannot reconstruct the market. Real-time and historical coverage depend on the chosen provider and the user's access. Do not imply that every asset, venue or depth of history is available free.

### Four useful entry journeys

1. **I want to journal:** create a workspace → import a statement or add a trade → reconcile → review → inspect patterns. No broker or market-data subscription is required for manual records and journal analytics. Optional chart context requires a suitable dataset.
2. **I want to practise:** create a practice project → select/import history → validate coverage → set simulation assumptions → trade historical bars → save/resume → finish and review automatically journaled fills.
3. **I want to chart:** choose source and instrument → see available history and freshness → annotate and save layout → attach a chart view to a journal entry. Execution is optional.
4. **I want to connect accounts:** choose platform → establish actual connection → verify identity and capabilities → reconcile history → optionally enable one execution destination → demonstrate a demo order lifecycle → optionally configure copying.

All four paths should converge on the same normalized journal and instrument model. None should force a beginner through a broker configuration task that is unrelated to the job they chose.

## Keep the domain concepts separate

- **Workspace/profile:** organizational scope for strategy, notes, reviews and linked accounts. A profile named “Live” is not evidence of a live connection.
- **Account:** one actual execution or imported-history account, with its own currency and external identifiers.
- **Data source:** where prices originate, with instrument mapping, coverage, resolution, freshness and provenance. It can exist without an execution destination.
- **Execution destination:** an account eligible to receive commands, with verified permissions and capabilities. A configured destination is not a connected account.
- **Dataset:** a versioned historical snapshot with timezone, gaps, source, instrument metadata and import validation.
- **Practice run:** immutable configuration plus clock/checkpoint, simulator ledger, costs and results. Independent runs are experiments, not automatically one cumulative account.
- **Journal trade:** execution facts plus editable decision/review annotations. A master decision can have multiple destination fills; reporting needs an explicit choice between decision-level and account-level views.

## Highest-priority workflow gaps

### 1. Make the journal a durable working record

Current evidence: `frontend/src/lib/trader/useTraderData.ts:167` creates trades and `:179` deletes them, with no update API. `frontend/src/pages/workspace/TraderJournal.tsx:703` is the journal creation caller found in the source review. Browser IndexedDB is the journal's store (`frontend/src/lib/trader/db.ts:209`).

Build editable trade details, open-to-closed lifecycle, import preview/deduplication, unreviewed queue, attachments, and full backup/restore. Separate factual execution data from a user's later interpretation. Do not treat a filtered CSV report as a complete backup. Surface save failures and preserve drafts; use archive/undo rather than immediate deletion.

**Acceptance:** import a statement twice without duplicates; correct a trade without recreating it; close an open trade; add a review later; export a full backup and restore all relations and notes into a clean browser or local database.

### 2. Make data availability a visible product state

Current evidence: the main chart constructs a broker-oriented feed (`frontend/src/lib/trading/terminal.ts:7828`); replay run sources are disabled in the planning form (`frontend/src/pages/workspace/TraderReplay.tsx:273`). Selecting a source in profile configuration does not establish a working chart feed. Importantly, Historify already has CSV/Parquet import, durable DuckDB history and a read-only historical feed. Reuse that existing capability; the missing piece is access and integration into the primary journeys, not the basic existence of a candle importer. See the data report for precise implementation references.

Provide a Data library with separate actions for importing market history and importing trade statements. Before any replay, show usable instrument/range/timeframe, timezone, gaps and source limitations. The no-source chart must offer a next action rather than a blank plotting area. Source and execution account remain separate controls.

**Acceptance:** a user with only a valid candle file can chart and start practice without obtaining an API key; a user with only a trade statement can journal but is clearly told why a market replay needs more data.

### 3. Bind profile and run context to the terminal

Current evidence: `frontend/src/pages/workspace/ProfileShell.tsx:15` puts `runId` into chart links, while `frontend/src/pages/Trading.tsx:1176` uses profile information for navigation without restoring run settings.

Resolve the selected profile/run into verified data, symbol, interval, mode and account configuration. Keep names and URL labels as presentation, not authority. A deep link must either open the intended state or explain exactly what is missing.

**Acceptance:** two profiles with different sources and two runs with different windows open their own instrument, dataset and simulation state. Invalid or unrelated IDs cannot enable execution.

### 4. Complete historical paper trading

Current evidence: replay deliberately blocks order actions (`frontend/src/lib/trading/terminal.ts:5964`; `frontend/src/pages/Trading.tsx:634`), while sandbox execution uses current quotes (`sandbox/execution_engine.py:156`). Preserve that live-order block.

Add a simulator driven only by the replay clock, isolated cash/position/order ledger, explicit spread/fees/slippage and same-bar fill policy, saved checkpoint and automatic journal events. Show whether replay uses ticks, lower-timeframe bars or whole-bar steps; do not present OHLC replay as tick-accurate execution. Backward seeking must not silently let a user retain profits while rewinding market state: branch/reset the run or deterministically replay its ledger.

**Acceptance:** refresh/resume restores a run exactly; identical dataset/configuration/actions produce identical results; future bars are inaccessible to the decision and fill engines; no replay order reaches a broker; finish opens a populated review.

### 5. Make connection and copying states truthful

Current evidence: `frontend/src/pages/workspace/TraderConnections.tsx` explicitly describes configuration-only behavior. Its account/terminal toggles are saved intent, not terminal discovery, measured health or acknowledged broker execution.

Use separate labels for Configured, Connecting, Connected read-only, Ready to trade, Armed, Stale and Failed. Start with one reliable read-only connector and history reconciliation; then demo execution; then one live destination; then multi-account fan-out. Show destination-by-destination submitted/acknowledged/partial/filled/rejected/unknown outcomes. Do not automatically retry an unknown outcome as a new trade.

**Acceptance:** terminal restart, disconnect, duplicate event, partial fill and one-destination rejection have visible, recoverable states. A local “running” checkbox never substitutes for a heartbeat.

## Proposed wireframe structure

Keep the black-and-white treatment. The design problem is hierarchy, terminology, state and continuity.

### Workspace

Top: workspace identity and three clear actions — Import trades, Start practice, Open chart. Below: recent work and Resume practice; then profiles/projects and a review queue. Account setup is optional and discoverable. Put zero-data metrics behind a small explanation rather than filling the first screen with dozens of zeros.

### Chart

Header: profile/project, explicit mode, source and execution target. Toolbar: instrument, timeframe, indicators and layout. Left: drawings. Center: chart. Right: Watchlist / Journal / Objects; specialized tools under Advanced. Bottom: data range/timezone/freshness and either replay transport or account books. Show trade controls only for a valid execution mode. “Attach chart” captures the view directly into the scoped journal.

### Journal

Header: profile/account, period, strategy and timezone. Main navigation: Review queue / Trades / Performance / Calendar. Trade drawer: Facts / Decision / Review / Attachments / History. Default view prioritizes unreviewed records and the next useful action. Performance always carries sample size and consistent filtering; optional mindset is separate and explicitly recorded.

### Practice project and run

Project: research question, strategy, dataset coverage and comparable runs. Run preparation: dataset → window → cash and instrument economics → costs and fill assumptions → validation → start. Active run: simulated time, paper ticket, position ledger and save status. Finish: execution results, annotated decisions and a next practice goal. Independent runs get comparison statistics, not a fictitious pooled balance.

### Connections

Separate source setup from execution setup. Read-only defaults; verify platform/account identity, data and order capabilities, last heartbeat and sync cursor. Destination preview shows exact symbol, side, normalized quantity, stop/target behavior and account before arming. Activity and recovery sit beside configuration. Keep speculative evasion/randomization settings out of the beginner workflow.

## Delivery order

1. **Reliable journal:** editable records, statement import, full recovery, visible persistence errors and consistent time/metric definitions. This delivers value without solving paid market data.
2. **Offline chart and practice vertical slice:** validated imported bars → chart → run-bound simulator → checkpoint → journal → review. This is the strongest demonstration of the free product promise.
3. **Read-only platform connection:** one platform, capability discovery, history sync and data provenance using the same normalized objects.
4. **Demo then live execution:** one destination, native supported protection, event reconciliation and failure recovery. Expand copying only after the single-destination lifecycle is demonstrably reliable.
5. **Advanced tooling integration:** preserve existing options, portfolio research, scripts and automation; expose them through user jobs and capabilities rather than making their full breadth the first-use experience.

These are dependency stages, not time estimates. Completion means the acceptance behavior works, not that all screens have been drawn.

## Findings across the remaining app sections

### Onboarding, settings and combined analytics

The current first-run split is Live channel versus Replay project (`frontend/src/pages/workspace/TraderWorkspace.tsx:523`), with no equivalent journal-only job. Its live setup checklist rewards configured destinations, source flags and drawdown flags (`TraderProfileDetail.tsx:163`), rather than verified runtime readiness. First-run success needs to match the chosen job.

Protect historical meaning when editing profile currency or practice starting capital (`TraderProfileDetail.tsx:115`). A display-label change must not relabel historical USD values as GBP without conversion. Combined analytics should allow a genuine empty selection rather than interpreting deselect-all as all profiles (`CombinedLiveAnalytics.tsx:237`); relative periods need actual date bounds. Preserve its existing separation by currency.

Desktop and mobile navigation currently prioritize Workspace / Flow / Tools, while history is in the account menu (`frontend/src/config/navigation.ts:32`, `:79`). Promote Data Library, and retain advanced tools through progressive disclosure. Keyboard, responsive navigation and numerous descriptive labels already exist; this audit is not a complete accessibility conformance test.

### Portfolio research, options and specialist tools

These are substantive capabilities, not mere placeholders. Coverage includes portfolio/SIP backtesting and holdings analysis; option chains, Greeks, OI tracker/range/profile, max pain, straddle/straddle P&L, volatility surface, GEX, strike profile, gamma density, IV smile, arbitrage, strategy construction and saved strategy portfolios. The tools report inventories each family and its data dependencies.

Local Historify-backed portfolio calculations already exist, but access gates impede their data-independent use. Portfolio/SIP result views are not durable research records; saved option strategies use a separate snapshot store rather than the core journal. Treat each research result as dated evidence with assumptions and a link back to a profile, trade or experiment. Capability-gate venues and instruments rather than implying a default regional exchange is universally available. Do not market these portfolio or specialist simulations as the same thing as discretionary replay-paper trading.

Keep useful advanced depth, but group it by job: study a market, test an investment allocation, build an options structure, automate a verified strategy. The main Tools catalogue currently leads with automation (`frontend/src/pages/Tools.tsx:66`); that ordering does not match the stated journal/practice priority.

### Flow, scripts, alerts, AI, approvals and operations

Flow, Python strategies, strategy runtimes and platform webhooks are genuine operational systems. Their identity is still primarily user/API-key/broker, not the profile/run model (`blueprints/flow.py:28`; `services/flow_executor_service.py:4974`). Activation must expose verified account, environment, permissions, approval policy and limits. A profile's saved copy/risk settings must never silently imply control over legacy automation.

Distinguish Read-only/Simulation/Broker mode, Draft/Armed status and Approval-required/Automatic policy. The API configuration falls back to Auto (`blueprints/apikey.py:54`); users need to see the effective policy where they activate an action. Preserve existing AI trading-disabled defaults and server-side permission checks.

Action Center already has careful conditional approval claims and unknown-send handling (`database/action_center_db.py:284`; `frontend/src/pages/ActionCenter.tsx:78`), and the strategy module has acknowledgement repair, partial-fill folding and restart recovery. Reuse those foundations. Approval, submission and fill must have different labels; “approved and executed” fallback wording can overstate an unknown broker outcome (`ActionCenter.tsx:285`).

Python schedules and older event views use IST conventions (`blueprints/python_strategy.py:64`), which need explicit timezone/calendar handling for a global product. Admin, health, logs, diagnostics, security, traffic, latency, MCP and developer access remain optional maintenance surfaces. They should be accessible from context when something fails, without becoming prerequisites for a person's first journal entry.

### Open-source, installation and maintenance

This checkout has no root LICENSE, README, CONTRIBUTING or SECURITY file. That is a distribution-readiness gap in the material reviewed, not a claim about the upstream project's public repository or a legal conclusion about dependencies. Establish the host project's license and attribution chain before presenting the packaged product as ready for open-source distribution.

Existing installation material still centers on broker/cloud setup and contains incomplete download commands. Publish and test the actual local Windows path for journal/import/practice, with supported runtime versions and a clear start/stop/upgrade process. This audit's server launch needed an interactive terminal because noninteractive Werkzeug startup refused to serve; the end-user launcher should handle local startup reliably rather than requiring terminal knowledge.

Recovery must cover both browser journal/profile records and backend databases/history, with a restore drill. Existing CI and security workflows have breadth, but the inspected browser-test job's Vite startup does not itself establish a complete Flask-backed journey. Add full-stack tests for fresh-start journal → backup/restore and imported history → replay paper → resume → automatic journal. Preserve current unit tests while testing the missing seams.

Keep one supported capability matrix: implemented, experimental or planned; platform/OS; data/history; read-only/account sync; demo/live execution; protection and reconnect behavior; last tested version. Vendor documentation in this checkout has version drift, and architecture plans exceed shipped bridge capabilities. A narrow set of verified connectors and a strong adapter contract is more maintainable than a large catalogue of unverified platform promises.

## Platform feasibility checked against vendor documentation

MT5 officially exposes Python IPC with the terminal, historical bars/ticks, account information and `order_send`: [MQL5 Python integration](https://www.mql5.com/en/docs/python_metatrader5), [order_send](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py). This supports the proposed local bridge direction; it does not establish that Chartly has implemented it.

NinjaTrader exposes AddOn account order creation and execution events: [CreateOrder](https://static.ninjatrader.com/support/helpGuides/nt8/createorder.htm), [Execution reference](https://ninjatrader.com/support/helpguides/nt8/execution.htm). cTrader offers distinct live/demo API endpoints and TCP/WebSocket connections: [Connection documentation](https://help.ctrader.com/open-api/connection/).

The engineering implication is to standardize command/event/capability interfaces while keeping platform adapters separate. Having one market feed does not confer execution access to another account, nor guarantee matching symbols, quantities, prices or fills.

## Specialist evidence reports

1. [Journal](audit-01-journal.md)
2. [Charts](audit-02-charts.md)
3. [Replay and paper trading](audit-03-replay.md)
4. [Connections](audit-04-connections.md)
5. [Data and history](audit-05-data.md)
6. [Execution and risk](audit-06-execution.md)
7. [Navigation and onboarding](audit-07-navigation.md)
8. [Research and advanced tools](audit-08-tools.md)
9. [Automation and operations](audit-09-automation.md)
10. [Open-source and maintenance readiness](audit-10-readiness.md)
