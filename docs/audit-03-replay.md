# Replay, paper trading and backtesting audit

Audit date: 2 November 2026. Scope: source inspection plus targeted automated tests. No broker orders, database mutations, or live account actions were performed. This is a workflow audit, not certification of the third-party simulation engine.

## Main conclusion

The app has real chart replay mechanics and a real scripted backtesting integration, but it does **not yet deliver historical paper trading as an end-to-end product**. Three different concepts sit beside one another: browser-local run planning records, chart-only playback, and a server-side sandbox filled from present-day market quotes. Connecting those is the highest-value work for the stated free journaling and practice promise.

## What exists

- Replay projects have named runs, market, symbol, timeframe, dates, starting balance, editable status and manually linked journal trades (`frontend/src/pages/workspace/TraderReplay.tsx:65`, `:120`, `:143`, `:184`). Records live in Dexie/IndexedDB (`frontend/src/lib/trader/db.ts:31`, `:200`, `:212`).
- The project honestly states runs are planning records until a feed is connected (`TraderReplay.tsx:124`). All actual source choices are currently disabled; the only selectable source is “No data feed connected yet” (`:273`).
- Chart replay supports picking a start, play/pause, speeds, step backward/forward, seeking and focused/all-chart scope. A coordinator synchronizes availability times, protects against stale async responses and restores live state (`frontend/src/lib/trading/workspaceReplay.ts:69`, `:145`, `:205`, `:277`, `:380`).
- Chart data is paused during preparation and playback; the terminal uses a displayed prefix rather than the future raw history for legend and volume (`frontend/src/lib/trading/terminal.ts:1718`, `:1949`, `:5829`, `:5875`). Finer historical candles can form larger candles, with whole-bar fallback when unavailable (`:5679`, `:5838`, `:6258`).
- Live order entry is deliberately blocked during replay across chart and dock routes (`terminal.ts:5964`, `:5979`; `frontend/src/pages/Trading.tsx:634`). This is a strong existing protection to preserve.
- Scripted strategies can be compiled and backtested over fetched history, on a worker where supported, with instrument metadata, trades/equity/markers and stopped-run diagnostics (`frontend/src/lib/trading/backtestRun.ts:354`, `:372`, `:427`, `:442`; `frontend/src/lib/trading/backtestFold.ts:73`).
- Server sandbox execution has conditional database fill claims to avoid duplicate fills (`sandbox/execution_engine.py:49`) and a quote-range consistency check (`:96`). These are substantive engineering foundations.

## Ranked workflow gaps

### P0: Historical paper trading has no order ledger tied to the replay clock

The chart's replay mode refuses orders rather than routing them to an isolated historical account (`terminal.ts:5964-6015`). The sandbox uses current quote/tick events (`sandbox/execution_engine.py:156`; `sandbox/websocket_execution_engine.py:394`, `:544`), and is not driven by the chart playhead. A user therefore cannot currently choose a past date, trade that historical market, and receive automatically recorded fills in the project's journal.

**Wireframe requirement:** the top strip must show “Historical practice”, project/run name, simulated date/time, source and fidelity. A paper-only ticket beside the chart must show simulated balance, quantity, risk, entry and native simulator stop/target. These tickets must never call a broker route. Closing a position should append one normalized trade automatically, then offer optional annotations.

### P0: “Chart” from a run does not open that run

`ProfileShell.tsx:15-25` creates a URL with `profileId` and `runId`, but the chart page reads the profile only for its back link (`Trading.tsx:1176-1184`). Searching the chart source shows no consumer of `runId`. Consequently the run's symbol, timeframe, date window, starting balance and source do not initialize chart replay. The user creates a run and then enters a general chart workspace.

**Requirement:** a run should resolve its record, validate the source's history coverage, load its symbol/window, initialize the simulator and checkpoint the same run ID. Replace generic “Chart” with “Prepare data” when unavailable, “Start run” when ready and “Resume run” once a checkpoint exists.

### P1: Progress and results are not durable run artifacts

`PracticeSession` stores planning metadata and status, but no playhead, dataset version/hash, simulator ledger, execution settings or checkpoint (`db.ts:31-47`). Replay exit explicitly warns that the playhead is lost (`frontend/src/components/trading/WorkspaceReplayBar.tsx:223`). Backtest outcomes reside in React state (`frontend/src/components/trading/BacktestPanel.tsx:285`) and the backtester returns its report without saving a project/session record (`backtestRun.ts:442`). Journal association is manual (`TraderJournal.tsx:705`, `:2098`).

**Requirement:** persist immutable run configuration, source coverage, script/version where relevant, fill policy, costs, ledger events and resumable playhead. Offer a clear “Finish and review” action that produces a journal review; a refresh or navigation should not destroy practice progress.

### P1: Status can promise readiness or completion without evidence

Statuses are freely changed through a select (`TraderReplay.tsx:184-195`) and saved verbatim (`useTraderData.ts:151-155`). Date ordering is not validated; balance coercion replaces zero with the project's default (`TraderReplay.tsx:65-85`). A “Completed” run can have no data, no execution and no trades.

**Requirement:** derive readiness from validated data coverage and simulator preparation. Distinguish “planned”, “data needed”, “ready”, “in progress”, “finished”, and “abandoned”; completing a zero-trade observation run should still preserve elapsed coverage and an explicit explanation. Offer edit/duplicate actions for configuration, not deletion/recreation as the practical way to amend it.

### P1: Deleting a run leaves journal references behind

`useTraderData.ts:159-163` deletes only `practiceSessions`. Journal records keep their optional `sessionId` (`db.ts:64`) and the journal resolves run names by lookup (`TraderJournal.tsx:518`, `:532`, `:1949`). The card's delete action is immediate (`TraderReplay.tsx:203-210`). Trades can remain while their run context disappears.

**Requirement:** archive runs by default; retain their provenance for journal records. If permanent deletion is offered, show impacted trade counts and explicitly preserve/detach or delete dependent records inside one transaction.

### P1: Independent experiments are combined into a misleading project account

Each run has an independent starting balance, but the project displays a single balance and win rate calculated over all project trades using the project's baseline (`TraderReplay.tsx:39-43`, `:105-109`; `metrics.ts:178-207`). A run card substitutes its own baseline (`TraderReplay.tsx:136-140`). Combining independent runs into one equity curve can imply a sequential account history that never occurred.

**Requirement:** the project overview should compare experiments: run count, trade count, expectancy/R, drawdown, sample and date coverage. Keep balance/equity inside each run. Any pooled trade statistics must say “pooled across independent runs”; avoid a project account balance unless runs explicitly share one sequential ledger.

## Simulation credibility requirements

These are required design decisions, not claims that the app already satisfies them:

1. Clearly separate **visual replay**, **historical paper trading**, **live paper trading**, and **scripted backtest**. Current “Replay / Backtest / Practice” metadata suggests different execution modes while creating the same planning record (`TraderReplay.tsx:17`, `:252`).
2. State fidelity for every run: ticks, bid/ask, smaller candles or displayed OHLC bars. Smaller-candle replay is not tick replay. Whole-bar fallback is intentional but currently quiet (`terminal.ts:6258`). Display it beside the clock.
3. Define when a decision becomes executable. Never fill at the same completed candle close using information revealed only by that close unless this is an explicitly selected assumption. Define same-bar stop/target ambiguity and gap behavior.
4. Use instrument-specific tick size, contract multiplier, quantity units, account currency and FX conversion. The backtester has a documented fallback contract of INR, point value 1 and default tick/lot (`backtestRun.ts:181-192`); fallback results must remain visibly provisional for international products.
5. Define spread, fees, swaps/funding, slippage, partial fills and liquidity limits. The current sandbox fills MARKET at ask/bid when present, otherwise LTP (`execution_engine.py:520-529`), and limit at the limit price on LTP crossing (`:531-541`). Its WebSocket adapter sets bid and ask equal to LTP (`websocket_execution_engine.py:544-548`), so it does not simulate spread on that path. Quote consistency is not an age guarantee; its own comment acknowledges missing timestamps (`execution_engine.py:108-111`).
6. Use one UTC event clock with a chosen display zone. Availability timing is timezone-aware and handles DST (`replayTiming.ts:13`, `:51`), but the replay label formatter hardcodes IST (`replayClock.ts:17`). The global market/profile timezone should control the displayed clock.
7. Scrubbing backward must have explicit semantics: observation-only seeking, rollback to checkpoint, or branching into a new experiment. Existing replay supports step-back/seek (`workspaceReplay.ts:282-288`), but a future paper ledger cannot simply retain fills from the later time.
8. Verify future isolation for indicators, comparisons, drawings, data exports, watchlists, quote/depth panes and agent context. Prefix ownership and alert pausing are good existing mechanisms, but this review did not certify every secondary surface or the external chart/script package internals.

## Proposed end-to-end wireframe workflow

1. **Replay project overview:** strategy hypothesis, setup rules, runs list and comparison. Primary action: “New practice run”.
2. **Run setup:** market/instrument, dataset source (imported candles, available public source, user's broker history), coverage preview, interval, dates, display zone, initial account and risk/cost model. Source choices should expose actual availability and requirements.
3. **Data check:** bar count, first/last timestamp, gaps, fidelity and entitlement/source description. Only then enable “Start”. No broker needed when a usable imported or free dataset exists.
4. **Practice workspace:** persistent project/run breadcrumb, simulated time/fidelity strip, chart, paper ticket, positions/orders, fills and compact journal note drawer. Keep play/pause/step near the chart; never show a live execution destination in the paper ticket.
5. **Pause/resume:** autosaved clock, drawings and ledger; resume opens exactly that run. Disclose any dataset revision rather than silently changing past results.
6. **Finish and review:** final results, trade list with chart snapshots, rule adherence and notes, automatically stored in this run's journal. Distinguish practice-derived and manually entered outcomes.
7. **Compare:** compare independently seeded runs and optionally duplicate configuration into a new instrument/window. Do not sum independent initial balances into an apparent account.

## Validation

Executed `npm run test:run -- src/lib/trading/workspaceReplay.test.ts src/lib/trading/replayTradingLock.test.ts src/lib/trading/replayTiming.test.ts src/lib/trading/terminalReplayCleanup.test.ts` in `frontend`: **4 files and 39 tests passed**. These validate coordinator/lifecycle/lock/timing behaviors; they do not establish realistic historical paper fills, broker connectivity, source entitlements or end-to-end replay-to-journal integration.

## Recommended implementation order

First build one complete imported-candle historical practice loop: validated dataset → run initialization → isolated simulator ledger → checkpoint/resume → automatic journal trade → review. Then add source adapters and global instrument metadata. Preserve the existing live-order locks. Scripted backtest persistence and comparable experiments can share the same durable run envelope, with explicit simulator/version provenance.
