# P21 detailed plan — research validity, search and stress testing

Status: implementation planned against the accepted P00 baseline; all implementation features below remain unaccepted. [Gap review](../p00/STRATEGY_BUILDER_GAP_REVIEW.md) · [Builder milestones](../p20/IMPLEMENTATION_PLAN.md) · [P21 package](../21-strategy-validation.md).

## Package ownership and first delivery

Use the [current execution guide](../p01/STATE_REVIEW_AND_CONTINUATION.md). P21 owns the automated experiment service, bounded jobs and saved baseline reports before later robustness. It consumes P20's artifact contract without waiting for the whole Builder/deployment package. P06 is required only when the selected engine adapter uses it; it is not a universal gate before existing worker-backed baseline tests. P20 renders the UI; P17 may later orchestrate the same jobs. No feature is accepted by this update.

## Baseline and comparison contract

Every experiment pins artifact/dependency revisions, parameters, data/instrument facts, warmup/evaluation timestamps, calendar, engine, capital/cost/fill rules, random seed, job status and artifact integrity. A stored report never reads a project's current mutable code to reconstruct what was tested.

Choose the initial asset/engine support matrix before setting defaults. Costs may include commission/spread/slippage and, where supported, financing/funding, borrow and currency conversion. Unknown inputs do not become zero costs. The report distinguishes realised balance from marked-to-market equity and open from closed trades. Corporate-action/roll/fill assumptions are named where relevant, and unsupported economics block authoritative monetary results.

- [ ] Build independently calculated fixtures: known wins/losses, open position, fees, zero trades, unavailable facts and changed dataset.
- [ ] Specify metric definitions and denominators; ratios/annualization with inadequate data remain unavailable.
- [ ] Compare only declared-compatible runs by default. Display manifest differences and changed inputs before allowing a ranking.

## Search and candidate selection

`SearchDefinition` contains typed ranges/steps/choices, conditional constraints, budget, selection objective and risk/sample constraints. `Trial` records candidate vector, seed, input manifest, status, logs and result reference, including failed/rejected trials. A candidate is not “best” outside its stated objective, constraints, dataset and evaluation policy.

- [ ] Implement finite grid and seeded random search first; report projected trial count and resource budget. Unsupported parameters/engines fail preflight.
- [ ] Select on the training/validation policy, not the held-out result. Keep all tried vectors and tie-breaking deterministic.
- [ ] Show objective versus drawdown/cost/trade count and neighbouring parameter stability. Save the selected vector as a separate immutable parameter set.
- [ ] Recalculate only changed experiment identities; a cache key must include engine/data/dependencies/economics, not just source filename.
- [ ] Test stopped/failed trials, deterministic reruns, resource exhaustion, constraints and a synthetic overfit strategy.

## Chronological evaluation and walk-forward

`SplitDefinition` stores timestamp windows, training versus evaluation roles, rolling/expanding policy, warmup and any necessary overlap gap/purge. Trading calendars and missing sessions need explicit duration logic. A generic row-count split is not sufficient evidence that time or position/label overlap is respected.

- [ ] Implement a fixed chronological train/validation/holdout workflow before walk-forward tuning. Preserve what the researcher has already inspected.
- [ ] For each walk-forward fold, optimize only inside its training window and evaluate its selected settings on the following evaluation window. Aggregate only defined evaluation observations; do not double-count overlapping evaluation windows.
- [ ] Make window boundaries, data availability, warmup and exclusions inspectable. Fundamental features, if added later, must use publication availability and historical revisions.
- [ ] Mark holdout exposure after it informs selection. A new project name or branch does not recreate untouched evidence.
- [ ] Test deliberately future-leaking signals, higher-timeframe alignment, overlapping positions/labels, gaps/DST, revised features and interrupted folds.

## Stress scenario ladder

Keep scenario types explicit so users understand what was tested:

1. **Parameter sensitivity:** rerun nearby parameter sets and identify fragile isolated peaks versus broader stable regions.
2. **Period/instrument scenarios:** rerun eligible periods/symbols with their correct facts; save selection/coverage rather than implying a survivor-only universe is complete history.
3. **Causal execution stresses:** rerun supported matching/evaluation with changed costs, spread/slippage, delays, rejection/missed-fill rules or data gaps. OHLC may not identify actual intrabar ordering/liquidity; unsupported realism remains unavailable.
4. **Return-level sensitivity:** explicitly labelled transformations of existing outcomes. Useful for some cost analyses, but not a substitute for rerunning changed order/position decisions.
5. **Seeded resampling:** only after the return/trade sampling unit and dependence assumptions are defined. Block-based return resampling or trade-order resampling are separate experiments, with seeds/block sizes and adequate sample requirements.

- [ ] `ScenarioDefinition` and exact supported engine fields are versioned. A failed scenario remains failed, not a baseline copy.
- [ ] Show baseline versus scenario changes, distributions/quantiles where justified, sample size and omitted assumptions. Avoid a universal profitability or safety badge.
- [ ] Verify independent cost/fill fixtures, reproducible seeds, insufficient-sample handling and correlation/overlap assumptions.

## Jobs, persistence and reporting

- [ ] Queue/budget trial groups; keep interactive charting and ingestion responsive. Concurrency/memory/disk/time limits are enforced, not labels.
- [ ] Persist queued/running/completed/failed/cancelled/interrupted states and result artifacts. Retry is idempotent; resume uses a real checkpoint or is an explicit pinned rerun.
- [ ] Save baseline, split, trials, scenarios, comparison and authored candidate decision as an exportable research bundle. Restore checks for missing datasets/engines without silently substituting today's source.
- [ ] Report screens use one authoritative stored run; selected-trade chart handoff returns to the same report/filter. Partial reports do not read as completed tests.
- [ ] Paper/live promotion references evidence IDs but uses independent environment/account/risk authorization. Background automations call accepted job APIs; they do not bypass those boundaries.

## Methodological boundary

The following source checks informed this design, not a claim that a library automatically implements the required financial validation:

- TimeSeriesSplit documents temporal ordering, gap samples and the equally spaced sample condition for comparable folds. The app still needs its own calendar/overlap contract. [Official documentation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html).
- Bailey et al. explain selection-driven backtest overfitting and limits of ordinary holdout methods. Recording trials and OOS exposure is a design consequence; PBO/CSCV or other advanced diagnostics are separate, assumption-dependent extensions requiring dedicated tests. [Original paper](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf).

No current fixed-allocation rolling-window/bootstrap function is accepted as the completed strategy optimizer/stress tester. Adapting any reusable math requires the manifest, engine and statistical contracts above.
