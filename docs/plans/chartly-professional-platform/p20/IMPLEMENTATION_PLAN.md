# P20 detailed plan — dedicated Indicator / Strategy Builder

Status: implementation planned against the accepted P00 design; no Builder feature milestone is implemented or accepted. [Current gap review](../p00/STRATEGY_BUILDER_GAP_REVIEW.md) controls this brief. [P20 package](../20-strategy-lab.md) · [P21 validation](../p21/IMPLEMENTATION_PLAN.md). The original chart/journal remain the presentation baseline; this new builder gets its own connected project workflow.

## Package ownership and eligible first delivery

P20 owns the project/revision/library/editor/indicator and candidate UI. P21 owns durable automated experiment jobs, baseline reports, parameter trials and robustness; P20's test/report screens call those services. P06 owns discretionary paper sessions and offers a compute adapter only where supported. P17 owns runtime operations; P11 owns eligible dispatch. These milestones describe connected user screens, not duplicate backend implementations.

Start SB-01–SB-03 and indicator/chart attachment once their P01/P02/P05 contracts are ready. SB-04/SB-05 deliver one saved experiment through P21 before SB-06/SB-07 optimization/stress. Do not wait for all live deployment tasks to make the project/editor useful; do not mark the whole package complete after that first slice.

## Contracts to settle before writing feature UI

- `Project`: stable ID, Indicator/Strategy kind, display metadata, supported language, archive state, draft reference. A research project does not need an execution account.
- `Draft`: editable source/rule document, typed input/output schema, base revision, diagnostics and concurrency token. Saving invalid code retains work but cannot mark it ready.
- `ArtifactRevision`: immutable source/program, compiler/runtime identity, kind, dependency locks, input/output declarations, validation receipt and content identity. Renaming a project does not rename its evidence.
- `ParameterSet`: immutable typed values, owning revision, provenance (default/manual/search-selected), units and compatibility. Editing creates another set.
- `DatasetReference`: canonical instrument/contract, exact source/version/range, bar schema/timezone/calendar/adjustments, coverage and integrity identity; references instrument economics separately.
- `Experiment`: immutable revision/dependencies/parameters/data/engine/economics/assumptions manifest plus a durable job ID. Reports point at a completed or explicitly partial experiment.
- `Candidate`: revision + parameter set + selected evidence IDs + authored decision/limitations. It does not authorize trading.
- `ChartAttachment` and later `Deployment`: independently identified view/execution relationships. Applying an indicator cannot start a deployment.

Proposed API boundaries: project CRUD/archive; draft read/save with conflict token; validate/create/list revision; list/resolve dataset references; submit/list/cancel jobs; retrieve manifests/artifacts; compare experiments; save candidate; attach a revision to a chosen chart/environment. Exact paths/error schemas belong to P01 before implementation. No mutable project name or browser URL is an execution binding.

## Milestone SB-01 — Library, drafts and revisions

- [x] Define schemas and worked fixtures for an indicator, a strategy depending on it, invalid draft, changed dependency and concurrent edit. Choose initial language support from the installed compiler; do not promise a Python/no-code interchange that does not exist. Done 2026-11-04 (P20-T01): [ARTIFACT_LIFECYCLE.md](ARTIFACT_LIFECYCLE.md) + `services/strategy_artifacts.py` + `test/test_strategy_artifacts.py`. Languages: `openscript` (existing compiler, code-only) and `chartly-rules-v1` (Rule Builder JSON subset). Concurrent-edit conflict handling itself lands with T02 storage.
- [ ] Build the library with Indicator/Strategy filters, search, create, duplicate, archive and reopen. Create opens an editor for that artifact rather than the chart page. Progress 2026-11-04: `/strategy-builder` workspace ships create (blank/template), open/edit, clone, archive, export/import and synthetic-check preview; kind filters/search and rename remain.
- [x] Persist drafts atomically and surface saving/saved/failed/conflict states. Both tabs retain text when a revision conflict occurs; resolution is explicit. Done 2026-11-04: CAS store + `/api/local/v1/strategy-artifacts` + workspace page conflict flow (editor text retained, explicit reload), proven in API and UI tests.
- [x] Create immutable revisions only after validation. Keep invalid drafts. Import existing scripts by explicit snapshot/mapping without silently changing active deployments or deleting their source. Backend done 2026-11-04 (P20-T02 store + T05 package import); browser flows land with the workspace UI.
- [x] Add complete project export/restore with dependency checks and no secrets. Done 2026-11-04: checksum-sealed `chartly-artifact-package-v1` export/import with content-hash verification, dependency presence checks and identity reminting (`test_strategy_templates_packages.py`).
- **Gate:** create both kinds without a broker; restart and reopen; reproduce previous revisions after edits; recover failed writes; duplicate/archive cannot rewrite saved experiments. No later milestone starts on a throwaway file-only store.

## Milestone SB-02 — Indicator authoring and validation

- [ ] Editor: inputs with type/default/bounds/units, data-series requirements, outputs/plots, pane/overlay, source/rules and precise compiler diagnostics. Preserve useful existing editor interactions.
- [x] Decide the first supported rule/visual subset; keep unsupported source code-only rather than lossy conversion. Templates must be actual valid programs, not labels without behaviour. Subset decided and implemented 2026-11-04 (chartly-rules-v1 engine, P20-T03); templates are real compilable programs (`services/strategy_templates.py`, boundary-tested with clone/export/import).
- [ ] Add dataset-backed preview, warmup/nonfinite/missing-value visibility and value inspection. Distinguish closed-bar versus current-bar output and supported higher-timeframe alignment.
- [ ] Reference tests compare against independently specified expected values. A study's settings can be compared technically; trading P&L requires an explicit strategy wrapper with entry/exit/sizing rules.
- [ ] Explicit Apply to chart selects an original chart/environment and pins revision/parameters. Changed dependencies need an explicit upgrade.
- **Gate:** create → validate → save revision → preview → apply → reopen the same revision from the original chart. Known-value, missing-volume, warmup, repainting and future-data fixtures pass. Applying never submits an order.

## Milestone SB-03 — Strategy authoring

- [ ] Define dependency selection, entry/exit conditions, timing, order types supported by the initial simulator, sizing, stop/target semantics, side/re-entry and session restrictions.
- [ ] Display parameter origins and units. Distinguish changing indicator inputs from overriding strategy risk or execution assumptions.
- [ ] Validate no-order strategies, unavailable outputs, cycles, inconsistent units, impossible sizing and unsupported constructs before run submission. Retain the draft and location of the error.
- [ ] Save an immutable strategy revision with its indicator revisions; dependency upgrades create another revision.
- **Gate:** hand-computed synthetic strategies produce known signals/order intentions; future-bar reads are rejected or explicitly unsupported. Editing a dependency leaves previous strategy revisions/test inputs unchanged.

## Milestone SB-04 — Local data and a persistent baseline experiment

- [ ] Connect saved/imported history through a versioned dataset adapter, separate from live broker authorization. Specify initial instruments, intervals and economic facts, including supported units/currency/calendar.
- [ ] Experiment setup pins revision, parameters, range/warmup, source, engine, starting capital, costs and fill assumptions. Preflight reports missing coverage or unsupported assumptions rather than starting a misleading run.
- [ ] Add durable job metadata/artifacts and queue limits before scaling the browser worker to batches. Persist cancellation/failure/interruption and support measured progress. Resume only where a real checkpoint is supported; otherwise rerun pinned inputs.
- [ ] Worker/backtest-engine reuse is behind the experiment contract; no UI component is the authoritative report store. Refuse verified monetary claims when contract/economics are unknown.
- **Gate:** save job → close chart/reload app → retrieve the same manifest and report. Missing dataset, duplicate submission, cancellation, out-of-space and worker crash preserve recoverable state. A small known-fill fixture independently verifies results.

## Milestone SB-05 — Report, comparison and chart drilldown

- [ ] Present assumptions/data quality and run status before results. Build Overview, Equity/Drawdown, Trades, Breakdown and Diagnostics from one immutable artifact set.
- [ ] Specify metric definitions, baselines, annualization and unavailable-value behaviour. Retain open positions, rejected/partial events and costs without claiming OHLC resolves unsupported intrabar details.
- [ ] Compare chosen experiments with a manifest difference view. Ranking requires comparable evaluation conditions and a declared objective.
- [ ] A trade drilldown opens the original terminal at its mapped instrument/time with correct run markers and returns to the report/trade/filter. A global chart must not silently replace the experiment instrument.
- [ ] Export manifests, machine-readable trade/curve data and a readable report; imports retain attribution and explain missing dependencies.
- **Gate:** zero-trade, losing, open-position, cost-heavy, cancelled/partial and unsupported-fact fixtures stay truthful across all views/export. Report data and conclusions survive restart.

## Milestone SB-06 — Parameter optimization

- [ ] Implement bounded search-space/job/trial contracts from P21 before a leaderboard UI. Start with finite grid/random search; conditional constraints and engine compatibility are explicit.
- [ ] Estimate trial count and budget. Persist every parameter vector/status/seed/result reference; retries do not count twice and cancelled candidates remain partial.
- [ ] Apply training/evaluation policies and show objective plus risk/trade-count/cost constraints. Include sensitivity/nearby-parameter comparison, not just best net P&L.
- [ ] Save an immutable candidate parameter set with exact revision and evidence. Changing the objective or inspecting a holdout changes the research record.
- **Gate:** seeded repeatability, invalid ranges, exhausted budgets, interrupted batches, tied objectives and a deliberately overfit fixture. No optimization action changes a chart's active settings or deploys live code implicitly.

## Milestone SB-07 — Robustness / Stress Tester

- [ ] Implement P21's chronological splits and walk-forward candidate selection, then supported execution/data stresses. Keep return transformations distinct from causal reruns.
- [ ] Add parameter perturbation, multi-period/instrument evaluation where instrument economics are supported, and later seeded dependence-aware resampling.
- [ ] Reports show baseline/scenario definitions, sample size, failed trials, deterioration and distributions with supported metric assumptions. No universal pass score or probability-of-profit label.
- **Gate:** known stress increases costs correctly; unsupported latency/intrabar scenarios stay unavailable; altered split/seed/data/version changes experiment identity; holdout use cannot be erased by renaming.

## Milestone SB-08 — Candidate → chart/paper → later deployment

- [ ] Pick a saved candidate and explicitly target an original chart or compatible paper environment. Record target, versions, parameters and accepted evidence.
- [ ] Paper validation has its own clock/account/ledger/book. Optimization trials remain research results; only intentionally promoted simulated outcomes reach the selected paper journal.
- [ ] Workflows may call tested job APIs and notify on completion, with resource/account capabilities explicit. It does not implement another experiment engine.
- [ ] Before retiring Python/managed hosts, extract scheduling/process functions shared by OpenScript, migrate saved settings/deployments with rollback and preserve running-position reconciliation. No legacy-host deletion is part of a launcher cleanup.
- [ ] Live bot lifecycle follows P07/P11/P12 and accepted book/account contracts: explicit arm/start/upgrade/stop, one runtime per deployment, revision evidence and confirmed journal events.
- **Gate:** paper/live separation, duplicate chart/deployment views, saved-result attribution, source outage, interrupted upgrade and stopped local service. Live permission is never inferred from a good report.

## Required pre-implementation review for each milestone

Before changing production feature code: record exact files/adapters, schema/migration, request/response fixtures, supported capabilities, page/state transitions, failure recovery, acceptance tests and rollback. A staged milestone can complete independently; none of the unchecked milestones above is satisfied by this plan or by the current unavailable-builder page.
