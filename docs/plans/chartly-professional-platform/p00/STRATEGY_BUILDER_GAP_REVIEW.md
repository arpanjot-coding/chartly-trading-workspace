# Strategy Builder: missing workflows and revised product boundary

2 November 2026. Status: reviewed against source; design proposal awaiting P00 walkthrough. The new builder is not implemented. This supersedes the temporary launcher for Python Strategies, Managed Strategies, Portfolio Backtesting and the generic chart link. Those launcher entries have been removed from the original app. [Master roadmap](../MASTER_PLAN.md).

## What the user wants

One dedicated Strategy Builder for creating **Indicators** or **Strategies**, with a connected testing and analysis workflow. A user should not need to understand the application's older tools, languages or process hosts to choose the right starting action. Strategy Stress Tester is an investigation within this product, not another disconnected directory.

The original chart remains the main trading/visual-analysis surface. Applying a completed indicator to it is a deliberate handoff after authoring and validation, not what clicking Create indicator does. The original journal remains a book of records/reviews; a thousand optimization trials must not become a thousand journals or contaminate real-account performance. Flow/Workflows orchestrates accepted jobs/events later; it does not replace the builder, test engine or results store.

## Source-based current capability assessment

**Present and reusable, within its existing scope:**

- `components/trading/ScriptPanel.tsx`, `lib/trading/openscriptFiles.ts` and `blueprints/openscript.py`: source editing, compile diagnostics, save/read/list and study-versus-strategy classification. Files are not a complete versioned research-project model.
- `services/openscript_store.py`: coordinated source/program writes and conflict handling. A normalized source hash/backup is useful, but is not by itself an immutable project/dependency/dataset/experiment history.
- `lib/trading/customIndicators.ts` and indicator picker/settings/templates: registration, structural checks and chart application. These are not a standalone indicator validation lab.
- `lib/trading/backtestRun.ts`, worker/protocol/fold modules: a real single-strategy historical run and cancellation/limits. It compiles the source, rejects studies for P&L testing, requests `/history` with an API key, prices instrument facts and returns results. It currently declares a 100,000-bar ceiling. This does not establish a universal saved-data/offline research pipeline.
- `components/trading/BacktestPanel.tsx`: chart-bound inputs and result display. `outcome` is component state; this inspected path does not persist a complete experiment/report when the panel closes or the app restarts.
- `BacktestResultTabs.tsx` / `BacktestChart.tsx`: equity, drawdown and trade views; their data/UI can be extended into report sections without rebuilding the chart engine.
- `services/openscript_deployment.py`, `openscript_run_config.py`, runner/books modules: real deployment identity, duplicate-start protection, settings and runtime/order attribution. These must be integrated into an account/environment/revision contract rather than assumed absent.
- `portfolio/walkforward.py`: fixed-allocation rolling windows and seeded block-return resampling. The function explicitly reruns the same allocation; it is not an existing strategy-parameter training/walk-forward optimizer.

**Important dependency:** `blueprints/openscript_runner.py:428` imports the Python strategy host to reuse its scheduler. Removing the Python launcher is safe; deleting that entire host before extracting/migrating scheduling would break retained execution. Legacy host/API retirement therefore needs a separate dependency migration, not a blanket file delete.

Evidence check: nine existing compiler/editor/indicator/backtest suites passed **126 tests** during this review. This establishes bounded reusable behaviour, not completeness of the proposed builder, market realism, profitability or universal asset support.

## Missing foundation — 16 concrete gaps

### SB-G01 — A project library with two clear artifact kinds

Create Indicator or Create Strategy opens a new project/editor, not `/trading`. The library needs stable IDs, names/descriptions/tags, kind, language/capabilities, draft/validated revision, latest experiment and saved parameter sets. Search, duplicate, archive, import/export and reopen must work locally. A project exists without an account/profile; an eventual chart or paper/live environment is an attachment/target.

### SB-G02 — Durable revisions and dependency identity

Distinguish mutable drafts from immutable validated revisions. A strategy depends on exact indicator revisions, not “the most recently saved file.” Store source/program/compiler/engine hashes or equivalent immutable content identity, inputs, dependency locks and validation results. Renaming or editing cannot rewrite a past report or alter a running bot. Missing versions and dependency cycles need actionable errors.

### SB-G03 — Indicator authoring and technical validation

Specify typed parameters, data series, outputs/plots, overlay/pane placement and supported timeframes. Preview against a selected dataset in a small research view; verify known reference values, warmup/missing bars, live-candle repainting and higher-timeframe availability. An indicator has no P&L by itself. A settings comparison for a pure indicator must name a technical objective, or place that indicator inside explicit strategy rules before measuring trading performance.

### SB-G04 — Executable strategy rules

Define indicator dependencies, entry/exit conditions, long/short eligibility, position sizing, stops/targets, re-entry/pyramiding, session rules and timing. Bar close, next open and intrabar behaviour are not interchangeable. A visual rule builder can initially support a declared subset; arbitrary code need not round-trip into editable blocks. Saving draft code with errors is valid; starting a test with invalid code is not.

### SB-G05 — A saved-data research contract

Select actual instrument/listing/contract, dataset version, interval, period, timezone/calendar, adjustment policy and coverage. Separate evaluation bars from warmup. Surface gaps, duplicate/out-of-order bars, insufficient volume, symbol changes and missing economics. Existing `/history` access is not enough to claim broker-free offline testing: connect Historify/local imports through an explicit adapter and make research access independent of live execution credentials.

Universal architecture does not mean every asset is certified on day one. Tick/point value, quantity steps, contract multiplier, trading currency, FX conversion, fees, spread, funding/swap, margin and corporate actions vary. Require verified facts for the supported initial instrument set; never silently price an unsupported market through an INR/lot fallback and call its monetary report authoritative.

### SB-G06 — Reproducible, bounded experiment jobs

An experiment pins revision/dependencies, parameter set, data version/range, universe, instrument facts, engine, costs/fill policy and seed. Persist queued/running/completed/failed/cancelled/interrupted states, progress, logs and artifacts. Decide whether a particular engine supports checkpoint resume or must rerun deterministically; a browser worker alone is not a durable job service. Closing a chart must not destroy a saved report. Multiple tabs must not submit the same job twice.

### SB-G07 — A complete baseline backtest report

Start with overview and assumptions, then equity/balance/drawdown, trades/order events, costs/exposure, timing/symbol/direction breakdowns and diagnostics. Include sample size, period, net/gross results, return baseline, profit factor, expectancy, win/loss distribution, turnover and costs where supported. State definitions: closed-balance drawdown differs from marked-to-market equity drawdown; an open position is not a closed win/loss. Ratios with missing denominators are unavailable, not invented numbers.

MAE/MFE and intrabar stop ordering require sufficient data and engine support. Show unsupported metrics as unavailable. Selecting a trade opens the exact original chart context with the tested revision, inputs, timestamps and available markers; return restores the report/trade. Export a portable report plus its manifest and machine-readable results.

### SB-G08 — Parameter search with a complete trial ledger

Declare typed parameter ranges/steps/choices and constraints. Estimate trial count, memory/time/storage cost and maximum budget before running. Begin with bounded grid/random trials, reproducible seeds and explicit objective/constraints. Preserve every candidate, failure and rejection; cancellation remains partial. Do not save only the highest-profit trial or silently change the scoring objective midway.

Show performance versus drawdown, trade count, costs and parameter stability. Saving a candidate creates an immutable named parameter set linked to the exact tested revision. The app should help identify settings that remain reasonable across neighbouring values and evaluation periods, not present one in-sample winner as universally best.

### SB-G09 — Time-based out-of-sample and walk-forward evaluation

Define training, validation and held-out periods by timestamp, with warmup and any required gap/purge for overlapping labels/positions. Train/tune only inside the training window; evaluate each selected candidate on its subsequent evaluation window. Record rolling versus expanding windows and the actual covered durations. Market sessions/gaps mean an equally spaced generic splitter is not automatically a calendar-aware trading validator.

If the user sees a holdout result and changes the design based on it, record that the holdout has informed selection; do not restore “untouched” status by duplicating a project. Walk-forward runs must select settings from their own training windows, not choose the final best settings using all history.

### SB-G10 — Strategy stress scenarios, with truthful model labels

Baseline reruns should support the stresses the engine can model: increased commission/spread/slippage, delayed fills, missed/rejected orders, changed liquidity assumptions, gaps and session restrictions. Cost-only return adjustments are useful but must be labelled post-processing; they are not a causal execution rerun.

Market-period/symbol tests, parameter perturbation and dependence-aware seeded resampling answer different questions. Store scenario definitions and show absolute and relative deterioration, drawdown/losing-streak distributions, assumptions and failures. Do not call trade reshuffling a market crash simulation or promise exchange realism from OHLC alone.

### SB-G11 — Comparable experiments and candidate decisions

Choose a baseline and candidates. Show differences in revision, parameters, data/range, engine and economics before rankings. Comparable runs share declared evaluation conditions; incompatible runs can be inspected side by side with visible differences rather than silently scored together. Include rejected candidates and the researcher's explanation. No opaque universal “good strategy” score is required.

### SB-G12 — Indicator/strategy handoffs to the original chart

An Indicator revision + parameter set can be applied to a chosen chart/environment, without starting orders. A Strategy result can show its simulated fills on the original chart. The chart needs artifact/version/parameter context and a return-to-project/report path. Opening another chart cannot silently replace a project's inputs, lose a draft or duplicate a deployment.

### SB-G13 — Paper validation and journal provenance

Promote a candidate explicitly to a compatible paper environment/run, with that simulated account's journal book and dataset/clock. Report simulated outcomes separately from research trials and real history. Journal reviews can link research reports; optimization trial ledgers stay in Research, not account P&L. Event/account/book identity is required before any live deployment work; a successful test never grants execution permission.

### SB-G14 — Research jobs versus automation versus bots

Workflows can later schedule accepted experiment jobs or notify on completion. A bot is an independently managed deployment of an exact strategy revision, not a project type or another chart. Keep logs, stop/cancel/retry semantics, execution reconciliation and account risk boundaries. Retire legacy Python/managed-strategy user surfaces only after their needed host/scheduler functions and existing saved-work migration have an explicit replacement.

### SB-G15 — Recovery, resource limits and code trust

Specify local project/result storage, atomic commits, conflicts across tabs, recovery after crash, dataset dependencies on restore and export excluding secrets. Bound CPU/memory/disk/time/concurrency; retain partial artifacts with partial status. Code execution must have declared filesystem/network/credential permissions and engine limits. A separate Python process is not automatically a security sandbox. Compilation, preview and parameter search must not expose live account credentials.

### SB-G16 — Evidence and usability, not just screen count

Each flow needs empty/loading/invalid/saved/failed/cancelled/interrupted/stale states, keyboard paths, narrow/wide layout and a next recovery action. Test synthetic strategies with known fills/P&L, zero-trade runs, losses, open/partial positions, incorrect units and deliberately leaking features. Verify result calculations independently, not just against another view of the same output. Mark each feature complete only after persistence/recovery and its actual user journey pass.

## Connected screen sequence to review

1. **Project library:** Indicators / Strategies, recent projects, saved revisions and experiments; create the correct artifact kind.
2. **Project editor:** source/rules, inputs/outputs, validation diagnostics and revision history. It does not redirect to a generic chart.
3. **Indicator validation:** dataset, reference values, warmup/repainting diagnostics, preview and explicit Apply to chart. For strategies, proceed to test setup.
4. **Experiment setup:** dataset/range, assumptions/costs, parameters, baseline/split and job budget; start only when required inputs are valid.
5. **Run activity:** durable status/progress/logs, cancel and recovery without losing the project.
6. **Backtest report:** assumptions, overview, equity/drawdown, trades, breakdowns and exact chart drilldown.
7. **Optimization:** search space, objective/constraints, budget, trial table and sensitivity comparison.
8. **Robustness / Stress tester:** causal stresses, OOS/walk-forward and seeded distributions; show what actually ran.
9. **Compare and save candidate:** stable parameter set plus evidence and limitations, attached to the tested revision.
10. **Apply / paper validate:** explicit original-chart or paper-environment handoff. Live deployment remains a later account/risk implementation gate.

These are workflow specifications, not a new substitute application or completed screens. Reuse existing components where their contracts fit, but design the Strategy Builder's own navigation and interactions from the new project workflow.

## Development order

Illustrative walkthrough fixture, not a real market result: create a Moving Average indicator revision; create a crossover strategy with fast/slow instances of that revision; choose an explicitly available saved dataset and next-bar execution assumptions; save the baseline experiment/report. Search fast lengths `[10,20,30]` and slow lengths `[20,40,60]` with `fast < slow`: record nine considered combinations, seven eligible candidates and two rejected combinations. Select candidates using the defined training/evaluation policy, then inspect cost/parameter/OOS stresses. Save a chosen parameter set only after actual reports exist, and explicitly apply it to an original chart or paper run. No winning settings or profit figures are invented for this fixture.

The [P20 implementation plan](../p20/IMPLEMENTATION_PLAN.md) and [P21 validation plan](../p21/IMPLEMENTATION_PLAN.md) detail the sequence and gates. Keep stable roadmap task IDs and dependencies; do not jump directly to optimization UI over unsaved runs.

1. Review this P00 workflow and initial support boundaries; freeze P01 project/data/job/result contracts.
2. Establish durable projects/drafts/revisions and migration/export (P02/P20).
3. Complete indicator authoring → technical validation → original-chart attachment (P20/P05).
4. Complete strategy definition → saved-data baseline job → persisted report (P04/P06/P20/P21).
5. Add comparison and bounded optimization over immutable experiments (P21).
6. Add OOS/walk-forward and actual execution/data stresses (P21), followed by documented resampling.
7. Add candidate/paper/journal integration; connect Workflows only through tested job APIs.
8. Implement live deployment separately after adapter/risk/recovery gates. Replace remaining legacy hosts only with a tested migration.

## Methodology sources and interpretation

The product requirements above are design proposals inferred from the app/user goals. Two external methodological constraints were checked: chronological validation must avoid training on future data; the generic TimeSeriesSplit documentation also requires equally spaced samples for comparable folds and exposes a gap parameter. Our trading-calendar/overlap-aware split contract must therefore be specified separately. [scikit-learn TimeSeriesSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html).

Bailey and coauthors study selection-driven backtest overfitting and explain limitations of ordinary holdout techniques in this setting. This supports recording all tried configurations and separating selection from evaluation; it does not certify a candidate or make our proposed initial validation system a PBO/CSCV implementation. Advanced statistical diagnostics need their own assumptions and verification. [The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf).

## What changed in this review

Removed the four legacy launcher cards from `/strategy-builder`; the page now states that the dedicated builder is not available. No creation/test/optimization controls are presented as functional. Existing user scripts, deployments and data were not deleted; shared backend host extraction is recorded as necessary work. P00, P20 and P21 remain open. The 126 regression tests validate existing pieces only; the new builder and this design still require implementation and user review.

Cleanup verification: the updated StrategyWorkspace entry test passed, both changed source/test files passed lint, and the production TypeScript/Vite build passed. Browser inspection of the built original page found zero links to the four legacy launchers and confirmed the unavailable-builder notice. [Screenshot of the current boundary](strategy-builder-boundary.jpg). No backend host or user strategy data was removed in this review.
