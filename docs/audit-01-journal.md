# Audit 01 — Journaling workflow and integrity

Source review: 2 November 2026. Scope: `TraderJournal.tsx`, `lib/trader/db.ts`, `useTraderData.ts`, `metrics.ts`, existing metrics tests and repository searches for journal writers. This is a source audit, not a claim of browser-tested behavior. No application code or personal records were changed.

## Assessment

The journal has a substantial analytical presentation already: Overview, Trades, Calendar, Breakdown and optional Mind; profile isolation; manual execution fields; per-trade notes; daily state; CSV export; strategy and time filters. It correctly distinguishes cumulative live journal P&L from broker equity, and correctly excludes open trades from realized analytics. The central missing product loop is capture → reconcile → enrich → review → learn. Today the implemented loop is primarily create a manual record → browse analytics → delete it. This matters more to credibility than further metric density or visual polish.

## Five highest-priority findings

### 1. A saved trade cannot be corrected, closed or enriched

Evidence: `frontend/src/lib/trader/useTraderData.ts:167` provides `createTrade`; `:179` provides `deleteTrade`; the returned API at `:386` exposes those two, with no trade update operation. In `TraderJournal.tsx:1948` onwards expanded rows are read-only; the action at `:1996` immediately deletes. `:682–759` is an add-only form. The result selector offers Open, yet both timestamps are required (`:2106`, `:2110`), and every trade receives a close date (`:707`).

Impact: a user cannot correct a typo, attach post-session review notes or close a manually logged open trade without deleting and rebuilding it. An excellent journaling system must support review after execution. A completed form is not the end of a trade's lifecycle.

Recommendation: separate immutable execution facts from editable review fields; add a trade detail drawer with Execution, Review and History; allow open trades to have no close date; explicit Close trade action; track revisions for imported facts. Use an Unreviewed queue with a clear next action.

### 2. Journal ingestion is manual; connector/replay origins are schema plans

Evidence: `db.ts:41` declares origins manual/replay/chart/simulator/connector/imported and `:94–98` includes external IDs. Repository searches found `TraderJournal.tsx:703` as the only `data.createTrade` call and `useTraderData.ts:169` as the only non-test `journalTrades.add` writer. Trade log copy explicitly says connectors are future (`TraderJournal.tsx:1870`). There is CSV export (`:321`) but no journal statement/CSV import flow in the reviewed frontend. `:739` labels any manual entry in a replay profile as replay, even if it was not produced by a replay engine.

Impact: a person with hundreds of existing trades cannot receive the intended free journal value without laborious manual reconstruction. A replay-origin label currently identifies profile context, not verified execution provenance.

Recommendation: prioritize statement import as a free, data-independent first-class route. Flow: choose account/profile → upload CSV → map columns/timezone/currency → preview normalized trades and errors → deduplicate → commit → review import summary. Connect broker/terminal events to exactly the same normalization path later. Distinguish manual provenance from replay session context.

### 3. Browser-local storage has no complete recovery path

Evidence: `db.ts:209` creates the named Dexie IndexedDB; `useTraderData.ts:58–96` loads browser tables, with no server journal persistence. `TraderJournal.tsx:321–363` exports selected filtered trade columns only. It omits technical/emotional/other notes, detailed emotion scores, plan checks, session ID, account linkage, timeframe, daily states and profile metadata. No complete journal backup/restore route was found. `:1996` deletes without confirmation or undo, as does daily-state deletion at `:1849`.

Impact: clearing site data, changing browser profile or moving between origins such as localhost and 127.0.0.1 can make the journal unavailable. CSV is a useful report but cannot restore the user's complete work. A misclick can permanently remove a review record.

Recommendation: retain local-first operation but persist an authoritative local backend journal or provide versioned full-workspace backup/restore immediately. Show storage location and last successful backup. Offer Export report separately from Backup all data. Add soft delete/Undo with a recoverable trash. Never describe the current CSV as a backup.

### 4. Time, filters and scoring need stronger semantics

Evidence: `TraderJournal.tsx:74–76` formats form input in browser local time; `:696–697` converts it to UTC; `:79–80` slices UTC dates for daily grouping; `metrics.ts:158–160` also slices timestamps. Closing-hour/weekday breakdowns explicitly use UTC (`TraderJournal.tsx:500–507`), while labels use browser local time (`:107–110`). `TraderPortfolio.timezone` exists (`db.ts:14`) but is not applied in the journal. The 1W/1M/3M cutoff anchors to the latest closed trade rather than today (`TraderJournal.tsx:452–464`), so a stale journal still shows old trades in 1W. Mind aggregates use all profile records (`:476`) rather than the period/strategy selection; mood lists are likewise unfiltered (`:466`).

Metric integrity: `metrics.ts:329–343` scores duration according to arbitrary fixed thresholds, giving 5–240 minute trades the maximum score and penalizing scalps and longer holds regardless of strategy. The overall qualitative label is computed from that heuristic (`TraderJournal.tsx:132–140`). Sharpe/Sortino (`metrics.ts:259–283`) annualize only days containing trades by sqrt(252), which is not a consistently sampled daily equity-return series, especially for crypto. Global win rate excludes break-even trades (`metrics.ts:294`), while symbol side percentages divide by all side trades (`TraderJournal.tsx:1717–1721`).

Recommendation: one profile trading timezone and optional exchange timezone, visible in the global scope bar; standard period dates anchored to today, with a separate explicit Latest activity window; consistent filters across tabs or explicit scope labels; explain win-rate denominator everywhere. Replace evaluative score with transparent metric facts or strategy-specific goals. Label ratios as estimates until cashflows and complete daily returns are modeled.

### 5. Default and failure states can undermine record trust

Evidence: manual form defaults include EURUSD, Breakout, 1 lot, $100 risk, R:R 2, stop 10 and target 20 (`TraderJournal.tsx:397–412`), and both plan/risk booleans start true (`:417–418`). They are saved as facts (`:714–720`, `:735`, `:742–743`). Opting into a mindset check-in saves all four after-trade scores, each initially 3, even when the user never expands the optional after-trade section (`:419–422`, `:744`, `:2223`). `useTraderData.ts:88` captures loading errors, but the journal does not render `data.error`; `TraderJournal.tsx:667` can instead present a profile-not-found state after a storage failure. Save/delete handlers do not surface persistence failure and there is no saving guard against double submission (`:703`, `:1996`).

Recommendation: blank/unknown defaults for facts, require explicit plan yes/no/not-recorded, and distinguish which optional scores were actually entered. Profile defaults may prefill symbol/timeframe but should be clearly editable. Render actionable storage/save errors, preserve draft contents, disable repeated submission while saving, and confirm successful persistence.

## What already works well in the implementation

- Profile-scoped journal routes and data filtering (`TraderJournal.tsx:373–377`, `:445–448`).
- Manual closed-trade outcome is derived from signed Net P&L (`:700–702`), reducing common outcome inconsistencies.
- Optional mindset collection is off unless both profile setting and per-trade consent are enabled (`:702`, `:740–745`); historical values are preserved when daily states are overwritten (`:777–780`).
- Live broker balance, percentage return and percentage drawdown are not invented from manual records (`metrics.ts:213–217`, `:349–365`; tested at `metrics.test.ts:71`).
- R-multiple is omitted without positive known risk (`metrics.ts:672`, test `metrics.test.ts:289`).
- Existing metrics tests cover profile isolation, combined live scope, absent emotions, streaks, directions, daily/grouped performance, costs and empty scores (`metrics.test.ts:49–294`). These tests were inspected, not executed during this audit.
- Cost and price fields are optional, and the interface explicitly states that entered net P&L remains the analytics value (`TraderJournal.tsx:2161`). This is honest, though reconciliation warnings should flag gross/cost/net mismatches rather than silently accepting all combinations.

## Recommended wireframe structure

Persistent journal header: profile switcher, Live/Replay label, account scope, date interval, strategy/tag filters, trading timezone, data coverage/source status. Primary action Add trades opens a choice of Manual, Import statement and Connect account, with only genuinely implemented routes enabled. Backup state should be one click away.

1. Overview: compact P&L, realized R, drawdown and sample size; one main equity/P&L chart; Unreviewed trades and Recent imports with next actions. Do not duplicate every Breakdown metric here.
2. Trades: searchable/filterable ledger; clear status and origin; selecting a trade opens a drawer with execution facts, chart snapshot, setup, plan adherence and notes. Keep unknown facts visibly unknown. Save review without modifying imported execution data.
3. Calendar: day cells in profile trading timezone → daily detail → review queue. Include daily note even on a no-trade day; current daily summaries only create days with closed trades (`metrics.ts:451`).
4. Breakdown: setup/strategy, instrument, direction and session comparisons with sample sizes and net-of-cost expectancy; every cell drills into the exact included trades. Show meaningful minimum samples before ranking an edge.
5. Mind: optional by profile; separate pre-trade observations from retrospective scores, with explicit recorded sample counts. Do not turn correlations into performance diagnoses.

## End-to-end target journeys

**Free manual journal:** create profile → add execution facts or open trade → persist → return after close → fill review with chart snapshot → weekly review → choose one behavior to practice. No broker or paid market data required.

**Statement journal:** create account → import statement with timezone/currency mapping → preview duplicates and errors → reconcile totals → approve → review unreviewed trades → export/backup. Future repeated imports must update partial executions without duplicating trades.

**Replay learning:** choose dataset and date range → create replay session → execute paper orders → events automatically create journal records → finish session → review timeline/chart context → compare repeated runs separately. The reviewed journal currently does not receive this event flow.

## Domain requirements before scaling ingestion

- Normalize execution/deal events separately from a trade aggregate; support partial fills, scale-in/out, fee adjustments and account-specific instrument units.
- Unique source-event key scoped by provider + connection/account + event ID; `externalDealId` is currently an ordinary nonunique index (`db.ts:222–223`), and `createTrade` has no deduplication (`useTraderData.ts:169`).
- Preserve execution currency, account currency and conversion rate/time before combining accounts. The current trade model has no independent currency and simply formats all amounts in profile currency (`db.ts:62–110`).
- Store created/updated timestamps, revision provenance and review status on trades; those lifecycle fields are currently absent from JournalTrade.
- Define deleting a replay session: `useTraderData.ts:159–162` removes only the session, leaving journal references; the run breakdown subsequently calls these records Whole profile (`TraderJournal.tsx:518–521`). Preserve archived session identity or prevent deletion until records are reassigned explicitly.
- Use reactive subscriptions or cross-tab refresh. The hook loads once and after local actions (`useTraderData.ts:94–96`); it does not subscribe to other-tab writes, an eventual issue for a chart tab producing journal trades.

## Suggested delivery order and acceptance criteria

1. Complete manual lifecycle, errors, Undo and full backup/restore. Acceptance: a user creates an Open trade, closes it later, adds review notes, fixes a fee, restores the complete profile into a clean browser and obtains identical analytics.
2. Build CSV import and reconciliation. Acceptance: importing the same statement twice creates no duplicates; invalid rows are explained; imported totals match a statement in the declared currency/timezone.
3. Wire paper/replay events to journal. Acceptance: a partial entry/exit sequence creates one coherent trade, carries its session and chart context, survives restart and remains separate from Live analytics.
4. Align filters/timezone/metric semantics. Acceptance: midnight-crossing trades display and group consistently; period selection has the same scope on every tab; break-even denominator and score assumptions are visible.
5. Add deeper learning workflows only after the records and recovery path are trustworthy.
