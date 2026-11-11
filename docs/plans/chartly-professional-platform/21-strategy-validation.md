# P21 Strategy experiments and robustness

Status: Planned. No implementation accepted. Dependencies: P01/P02/P04 and the accepted P20 artifact/revision contract. P06 is required only for experiments using its paper engine; existing worker-backed baseline experiments do not wait for the whole discretionary simulator. Evaluation requires no live account.

[Master plan](MASTER_PLAN.md) · [Foundation review](p00/FOUNDATION_REVIEW_V2.md)

Current scope: [Strategy Builder gap review](p00/STRATEGY_BUILDER_GAP_REVIEW.md) · [detailed validation plan](p21/IMPLEMENTATION_PLAN.md). The old portfolio-backtest launcher is removed from Strategy Builder. Its math can be considered for adaptation after validating the strategy experiment contract; it is not a completed strategy stress tester.

## Outcome

A user can inspect whether an explicitly defined strategy result survives different data windows, assumptions and execution conditions, with reproducible trials and honest limitations. Robustness analysis does not certify future profitability.

## Design and contracts

Experiment pins artifact/dependencies/parameters/data/feature availability, engine, instrument/universe, calendar, costs, fill model and seed. TrialGroup, SplitDefinition, Scenario, ValidationRecord and ResultArtifact retain every attempt, including cancellation/failure. Human replay, automated backtest and post-hoc return resampling remain distinct experiment types.

This package owns the automated experiment service, durable jobs, baseline reports and later robustness. P20 owns the Builder UI and artifact lifecycle; P06 owns discretionary paper sessions. They use one declared contract for shared inputs/results, not separate component-state report stores.

Consider existing portfolio rolling-window and resampling calculations as reusable implementation inputs, not separate launcher products in the new builder. A fixed-allocation rolling-window test is not automatically a strategy optimization walk-forward. Match resampling units to assumptions; correlated/overlapping trades cannot be treated as independent without qualification.

## Implementation checklist

- [x] **P21-T01** Define experiment manifests and baseline quality checks: data coverage, warmup, supported units/fill assumptions, causal feature availability, computational budget and comparable benchmark where appropriate. Reject impossible or misleading inputs. Done 2026-11-04: `services/strategy_experiments.py` pinned manifests (canonical `Experiment` records), pre-run quality gates (coverage/warmup/fill timing/sizing/costs/budget), deterministic next-open simulator with exact fee/slippage accounting and report checksums. Benchmark comparison lands with the T07 report.
- [x] **P21-T02** Implement durable bounded experiment jobs, progress/cancellation/restart and result storage, preserving partial results as partial. Existing worker backtests can be a compute adapter, not an independent result store. Keep chart/ingestion/execution responsive. Done 2026-11-04: `services/experiment_jobs.py` scoped durable bundles (idempotent submit, queue bounds, cancel queued, restart requeue without checkpoint claims, partial-data status, failure codes retained).
- [x] **P21-T03** Build train/validation/holdout specification and walk-forward policies. Track training versus evaluation windows, warmup and leakage controls; prevent an edited model from reusing untouched-holdout claims after the holdout has informed selection. Done 2026-11-04: `services/strategy_validation.py` causal walk-forward folds with excluded holdout tail, canonical EvaluationSplit records, contamination claims that renaming cannot reset.
- [x] **P21-T04** Add controlled parameter trials with declared search space, budgets, selection metric and recorded trial count. Preserve rejected/failed candidates; compare parameter stability rather than presenting only the best result. No automatic live promotion. Done 2026-11-04: `services/strategy_trials.py` deterministic bounded grids on validation window, failed trials preserved, stability (min/median/max) reported beside any candidate.
- [x] **P21-T05** Add execution/data stresses for spread, costs, slippage, latency, missed/rejected orders, gaps, calendars and regimes where the model supports them. State whether each scenario reruns causal matching or only transforms existing returns; unsupported microstructure models stay unavailable. Done 2026-11-04: `services/strategy_stress.py` — every scenario reruns causal next-open matching (fees, slippage, fill delay, seeded missed entries, bar gaps) and labels its model; queue/partial-fill microstructure explicitly not modelled.
- [x] **P21-T06** Implement seeded resampling/Monte Carlo with documented units, assumptions and dependence handling. Show outcome distributions, drawdown sensitivity and limitations; generated paths are not probability guarantees. Keep original trials and random seeds reproducible. Done 2026-11-04: seeded iid trade resampling with equity/drawdown percentiles and the independence limitation stated in every result; identical seeds reproduce identical output.
- [x] **P21-T07** Create comparison/robustness report with sample size, OOS scope, turnover/cost sensitivity, concentration, regimes, failed scenarios and data quality. Save cited findings to notebook/journal research and bind the validation record to exact revision/configuration.
- [x] **P21-T08** Implement evidence validity and promotion policy: artifact/dependency/parameter/source/engine changes create new evidence requirements. Support shadow/paper/demo observation through existing contracts; distinguish candidate approval from account eligibility and risk permission.

## Acceptance criteria

- [x] Saved baseline and seeded scenarios are reproducible against pinned inputs. Proven: identical pinned inputs reproduce identical report checksums (T01/T06 tests).
- [x] Holdout/research contamination is visible and never reset by renaming an experiment. Proven: any recorded use blocks untouched-holdout claims (T03 tests).
- [x] Costs/latency stress identifies its actual model rather than implying exchange realism. Every scenario is labelled rerun-causal-next-open with unmodelled microstructure stated (T05).
- [x] Failed/cancelled trials remain visible and cannot be labelled full successful tests. Trial statuses and failure codes persist in job bundles and trial grids (T02/T04).
- [x] A strong report cannot by itself arm an execution account. Promotion ceiling is paper_candidate; account eligibility and risk permission require P11 (T08).

## Required verification scenarios

Future features, revised fundamentals, higher-timeframe lookahead, delisted universe, DST, warmup leakage, split overlap, repeated parameter selection, overfit synthetic strategy, correlated trade resampling, fixed seed reproducibility, missing data, job cancellation, memory/disk limits and changed engine revision.

## Risks and decisions to resolve

Establish initial supported engines and per-engine parity claims. Define resource budgets on measured hardware. Statistical labels require explicit assumptions; avoid a universal strategy-quality score. Provider historical coverage may limit regime or point-in-time studies.

## Scope boundary

No exhaustive institutional execution simulation, unbounded optimization or claim that passing stresses makes a strategy safe/profitable. Options-specific portfolio tests remain separate until their instrument/economics contracts are supported.

## Completion evidence and handoff

Record synthetic ground-truth/leakage fixtures, exact engine/model versions, job recovery tests and complete investigation journeys. P20 deployments reference validation records; P17 orchestrates accepted experiments without duplicating engines; P19 enforces compute budgets.
