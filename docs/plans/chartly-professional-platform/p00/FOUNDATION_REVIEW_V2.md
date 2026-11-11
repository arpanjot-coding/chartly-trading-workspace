# Chartly integrated foundation review

Scope clarification: [improve the original app in place and preserve independent journal books](EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md). This supersedes replacement-screen or alternate-shell proposals below.

2 November 2026. P00 revision 2: reopened for design. This supersedes the earlier P00 completion decision. The old prototype is a screen/state harness, not an accepted product workflow. Existing checks remain historical evidence of that harness only.

## Conclusion

Chartly should be a modular trading and research workstation with independently useful Journal, Charts, Strategy Lab, Fundamentals and Automation workspaces. These share local records and capabilities. Users should not have to adopt every workspace, trade through Chartly, connect an execution account or configure AI to get value.

The previous plan covered screens better than the lifecycles joining them. In particular, it under-specified strategy creation/testing/deployment, stress testing, external journal synchronization, source overlap, process lifetime and the distinction between a visual chart attachment and a running bot. Those are foundational requirements. They must be resolved before P01 contracts are treated as ready.

This is a design/source review and revised specification, not a claim that the following capabilities are implemented. Six existing backtest/editor/replay test files were run during this review: 71 tests passed. Those results support existing mechanics; they do not validate the integrated product proposed here.

## Product structure

### Journal

A standalone trading record and review product. Inputs: manual records, statement imports, direct read-only account history, supported third-party history services, Chartly simulation and confirmed Chartly-routed executions. Output: reconciled trade facts, user annotations, consistent analytics and review goals. It works without chart data, indicators, bots or live execution.

### Charts

A standalone analysis workspace over a selected source. It supports built-in/custom indicators, drawings and optional research overlays. A user can open a chart without starting a simulator or bot. It can link to a journal trade or a research experiment while preserving the selected source, time and context. Chart data and order destination are separate choices.

### Strategy Lab

One first-class product for creating, explaining, testing and operating trading logic. Sections: Projects, Build, Test, Robustness and Deploy. An indicator and an executable strategy are different artifact types. A bot is a configured deployment of a strategy version, not a third competing copy of the strategy code. Visual rules and code are alternate authoring methods for the supported common model; unsupported custom code need not reverse-convert into visual blocks.

The chart can expose a compact editor/test panel linked to the same project. Opening Strategy Lab shows that project in a fuller workspace, without creating another script store or changing the running version.

### Fundamentals and market intelligence

Company/asset facts, economic series, filings, reports and dated research notebooks. This is distinct from quantitative strategy development but lives under the broader Research experience alongside Strategy Lab. Facts can inform chart overlays and strategies only through explicit data bindings with historical availability semantics.

### Automation

Event-driven orchestration: alerts, schedules, journal/report refresh and eligible execution commands. A workflow can invoke a saved strategy or risk-checked order intent; it must not create its own competing order ledger or bypass strategy/account permission gates. Read-only automations are useful without execution accounts.

### Shared local foundation

Identity and instrument mapping; account/source registry; transactional event and journal records; versioned market/research data; artifact revisions; experiment manifests/results; deployment/runtime state; jobs/sync; credential references; backup/restore; and one searchable activity trail. Separate products mean independent setup and capability requirements, not isolated copies of accounts and trades.

## Foundation gaps and required decisions

### F01 Strategy development was buried under advanced tools

Evidence: P00 v1 has 19 screens for journal/chart/practice/fundamentals but no project editor, strategy builder, experiment queue, robustness report or deployment detail. P17 groups scripts with later advanced-tool migration.

Decision: Strategy Lab becomes a first-class workspace. Preserve the existing editor/compiler/chart integration. Add its product specification before choosing navigation depth. New P20 covers authoring/artifact lifecycle; P21 covers experiment/robustness lifecycle. P17 retains workflow integration and optional AI rather than owning the entire strategy product.

### F02 An indicator alone is not a trading strategy

An indicator computes values/plots/alerts. Its useful tests include reference values, missing-data handling, warmup and repaint/future-data behaviour. P&L backtesting needs entry/exit, position sizing, fees, fills and account assumptions. The existing `runBacktest` explicitly rejects study scripts (`frontend/src/lib/trading/backtestRun.ts:354` onward), a correct distinction to preserve.

Decision: actions depend on artifact type. Indicator: validate, preview, apply to chart, use in strategy. Strategy: validate, simulate/backtest, robustness, create deployment. Visual rule builder adds the missing executable rules around indicator outputs; it does not silently invent them.

### F03 Bot identity and chart attachment were ambiguous

A chart attachment is a view configuration. An executable deployment binds a frozen strategy revision, dependencies, inputs, instrument universe, source, clock, execution environment/account and risk policy. One strategy can have multiple deployments; multiple chart views can inspect one deployment without starting copies.

Decision: Apply indicator never submits orders. Attach bot means link an existing deployment or create a draft deployment, never arm immediately. Closing a chart does not stop a backend deployment. Stop automation, cancel working orders and close positions are separate scoped actions with separate outcomes.

### F04 Mutable scripts could disconnect tested and running logic

Existing deployment identity/settings are substantive (`services/openscript_deployment.py`, `services/openscript_run_config.py`). The plan still lacks a complete cross-module revision and evidence contract. Do not infer that deployment identity alone proves an immutable tested dependency bundle.

Decision: source draft → validated immutable artifact revision → experiment → validation record → deployment revision. Record source/compiled/dependency hashes, compiler/runtime versions and parameters. Editing a draft never replaces a running revision. Upgrade is explicit; affected validation is invalidated or retained against the original revision rather than relabelled current.

### F05 Backtesting, manual replay and robustness were conflated

Manual replay tests discretionary decisions. Automated backtesting evaluates strategy code over a historical event stream. Stress/robustness evaluates sensitivity and uncertainty around a specified experiment. Each needs its own UI and results, with common data/event/accounting contracts where compatible.

Decision: share a versioned Experiment envelope and normalized outputs; do not force every engine into one implementation. Existing browser strategy backtests, Python live runtime and local paper matching need explicit parity fixtures and supported-mode declarations. P06's single authoritative simulator requirement applies to one replay-paper ledger, not a mandate to discard the existing OpenScript strategy engine.

### F06 Robustness was not a release-level workflow

Existing `portfolio/walkforward.py` has rolling allocation-window analysis and Monte Carlo framing, invoked by `services/portfolio_service.py`. That is useful existing work, not proof of a complete arbitrary strategy optimization/out-of-sample platform. Script input controls make sweeps possible, but do not constitute a managed robustness study.

Decision: baseline experiment → declared train/validation/holdout → controlled parameter study → out-of-sample evaluation → cost/latency/gap/regime stress → seeded resampling where assumptions fit → comparative report. Preserve every attempted trial and split policy to expose selection bias. Rolling fixed-allocation windows are labelled accordingly; do not call them nested optimization-and-retraining walk-forward tests.

### F07 Price and fundamental lookahead require one availability contract

Future candles can leak through indicators, higher-timeframe aggregation, comparisons, universe membership or data corrections. Fundamental facts can leak through restatements, publication lag or present-day issuer lists. A UI hiding the right-hand chart is not sufficient.

Decision: every experiment declares event time, availability time, warmup and permitted information. All dependent data must satisfy its as-of boundary. Preserve price adjustment/roll policy and delisted universe membership. Unsupported point-in-time data produces an explicit limitation or refuses the claimed test.

### F08 Journal ingestion must be independent of execution

Trades executed outside Chartly remain first-class records. A user can choose manual, import or read-only sync without ever enabling orders. Direct source ingestion and journal updates must not depend on a chart tab or a broker-execution entitlement.

Decision: introduce P22 Local sync and external history before connected execution work. It shares the same source normalization and journal ledger as P03. Source permissions are separated into account-history, market-data and execution capabilities. A read-only history connection cannot acquire write access because a user opens another module.

### F09 Multiple sources can describe the same underlying trade

MT5, a statement, Myfxbook and Chartly's order log may all describe one account execution with different IDs, timestamps and aggregation. Provider event deduplication alone does not prevent duplicated P&L across providers.

Decision: preserve source observations separately from canonical executions. Establish explicit account identity linking and primary-source policy. Match with reliable external identity where available; ambiguous time/price/quantity matches are reconciliation candidates, not silent merges. User annotations attach to stable canonical records and survive source corrections. Show unresolved conflicts and source coverage.

### F10 Local storage does not imply a local upstream source

MT5 history is read from a terminal; Myfxbook is a remote service; an exchange/broker API is remote. Chartly's data can still remain locally stored while requesting updates from those sources. Same-PC requirements apply to a native terminal bridge; a remote history service does not inherently require that terminal on the same machine as the client.

Verified provider constraint: Myfxbook documents `get-history` as limited to the latest 50 transactions, broker-local timestamps and IP-bound sessions. Its API is a candidate history source, not full-history or execution capability. Long offline gaps may require another source or statement backfill. See [official documentation](https://www.myfxbook.com/api). MT5 exposes interval-based deal history through its terminal integration; see [official function reference](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py).

### F11 App lifetime and sync guarantees were unspecified

“App open” must mean the local engine is running, not that the Journal page happens to be visible. Startup cannot guarantee instantaneous provider results or recover data no longer exposed by a provider.

Decision: show cached records immediately; launch a single account-scoped catch-up job on local-engine startup or reconnect; update the UI as confirmed records arrive. While running, use supported streaming or bounded polling. Trigger refresh on appropriate focus/resume events without starting duplicate jobs. Persist cursor, last successful sync, completeness window, errors and active progress. Shutdown checkpoints safely. Optional background-service operation is explicit opt-in; do not promise continued activity after the engine/PC stops.

### F12 Sync should be incremental and explain completeness

Use source cursor when available; otherwise bounded overlap reads plus idempotent normalization. Corrected fees, late fills, reopened history windows and corporate actions may change old records. Never mark a whole account “up to date” from a successful limited recent-history request.

Decision: account status separates connection health, last successful request, last observed event, known coverage, open-position reconciliation and missing historical intervals. Preserve edits when applying source revisions. Import can fill missing coverage but must join reconciliation. Deleting a connection does not delete its journal history.

### F13 No-code and code need a defined boundary

Options leg construction and algorithmic rule construction are different jobs. The existing Strategy Builder name currently also describes multi-leg options research.

Decision: name the algorithmic surface Rule Builder; name the existing specialist surface Options Builder. Both produce typed/versioned artifacts where applicable. Rule Builder targets a supported subset of the strategy model with explainable execution. Custom code outside that subset remains code-only; no promised arbitrary two-way conversion. Python execution is a trusted local extension boundary, not automatically a security sandbox.

### F14 Automatic workflows need exactly one execution authority

Indicators, scripts, webhooks, timers and AI can all emit requests for the same account. A platform-wide analyzer toggle is insufficient as a cross-module mode contract.

Decision: every action carries explicit source revision, environment, target, capability/risk policy and durable operation identity. Workflow orchestration invokes domain services; strategy runtime emits intents; execution owns dispatch/ack/fills; journal consumes confirmed events. Pause an automation without claiming existing positions are closed. Deduplicate trigger delivery and account for risk reservations across simultaneous producers.

### F15 Strategy results need promotion and rollback policy

A high backtest return is not permission to trade. Data/source changes, fees, instrument mappings and parameters can invalidate old evidence.

Decision: tested candidate → read-only shadow/paper observation → eligible demo → explicit live deployment, each capability-gated and separately versioned. No auto-promotion based on a score. A rollback chooses a prior configuration/revision for future activity and reconciles existing positions; it cannot erase market trades already made. Record start/stop/restart and reconciliation policies.

### F16 Standalone products need a shared object graph, not a universal forced profile

A journal account, script project and fundamental notebook are not interchangeable profiles. A user should not need an artificial live-trading profile to inspect a filing or code an indicator.

Decision: local workspace owns optional domain scopes: journal account/collection, chart view, strategy project, experiment, deployment and notebook. Cross-links are explicit. Profile remains a useful organizational view, not the universal storage owner of every object. P01 must model this before P02 migrates records.

### F17 Resource contention affects the whole local product

Large history backfills, many parameter trials and report extraction can freeze an otherwise responsive chart or delay account sync. “Everything local” is not a scheduling policy.

Decision: durable cancellable jobs with bounded concurrency, memory/disk limits and priorities. Execution/reconciliation have precedence over bulk experiments; UI rendering is isolated from research workers. Backtests save progress/results and cancel without disguising partial output as completed. P19 measures budgets rather than promising unlimited instruments or trials.

### F18 Backup must preserve reproducibility as well as records

Journal, source identities, imports, reconciliation links, artifact revisions, experiment manifests/results/seeds, deployment definitions, notebook evidence and data-version references must be included. A source file alone cannot restore the state that produced a result.

Decision: backup manifest distinguishes included datasets from references requiring re-download and secrets stored separately. Missing restore dependencies make replay/deployment unavailable with clear recovery; never silently fetch new data or swap a strategy version and call it the same run.

## Integrated user journeys

### A Standalone journal with optional synchronization

Create a journal/account identity → enter a manual trade or import history → reconcile → annotate/review → inspect patterns. Optionally add a history source → verify the external account and permissions → preview coverage → initial backfill → source-link reconciliation → automatic catch-up while the local engine runs. Cached journal remains readable offline. No trading key or candle dataset is required.

Startup shows existing records immediately and a visible Refreshing status. Reconnect/backfill updates facts and leaves review notes intact. Duplicate sources are surfaced before analytics count them twice. An incomplete Myfxbook window produces a coverage warning and backfill action. A user can detach the source and keep the journal.

### B Indicator authoring and chart use

Strategy Lab → new Indicator → choose code or supported visual calculation → declare inputs/dependencies → validate syntax/types → compare reference values and missing/warmup behaviour → preview on selected data → save revision → apply to one or more chart views. Rendering does not grant execution authority. Live candle recalculation and historical/replay behaviour are documented. Editing creates a draft; chart attachment explicitly chooses revision or prompts for an upgrade.

### C Indicator to executable strategy

Choose indicator revision → Create strategy using these outputs → add entry, exit, sizing, session and risk rules → validate → inspect signals in a chart → freeze strategy/dependency version → choose historical data/universe/calendar/costs → backtest → inspect trades and assumptions. Only the added trading rules make profit/loss meaningful. Strategy can also be authored directly without first creating a standalone indicator.

### D Strategy experiment and robustness

Choose a frozen strategy → dataset/window → baseline → define train/validation/holdout and hypothesis → bounded parameter trials → reserve untouched holdout → out-of-sample evaluation → stress costs/spread/slippage/delays/missing bars/regimes → suitable seeded resampling → compare distribution and failure modes → save validation record and limitations. Preserve failed and cancelled trials. Show whether stresses rerun matching or merely perturb existing returns; these are different experiments.

### E Strategy to bot deployment

Select validated strategy revision → choose paper-live, broker demo or eligible live environment → instrument/account/source bindings → preview sizing/protection/runtime requirements → arm explicitly → monitor signals/intents/acks/fills → journal records → compare observed versus tested assumptions. Linking the deployment to a chart displays/controls the existing runtime rather than launching a duplicate per chart. Runtime continues only while its required local engine/bridge and source are available. Reconnect reconciles before writes resume.

### F Discretionary replay

Choose project/dataset → manual replay run → paper orders/annotations → checkpoint/resume → journal review. Optional indicator revisions can be attached. No coded strategy is necessary. Optional strategy overlays for comparison are labelled and isolated; a manual decision does not become an automated strategy fill.

### G Fundamental research to decisions

Search asset/issuer/series → verify identity → inspect original facts/report and availability date → save cited notebook → optionally overlay events on chart or attach research to journal/strategy hypothesis. A strategy consuming fundamentals pins provider/feature definition/as-of semantics and missing-data policy. Current facts cannot be retroactively used in a historical test.

### H Workflow orchestration

Choose event/condition → select read-only job or eligible domain command → declare environment/account/revision and approval/risk policy → dry-run/preview → activate → follow one activity trail → inspect confirmed effects in journal/research. A workflow that refreshes the journal or sends a local alert needs no execution scope. Execution changes go through the same account dispatcher as manual and strategy commands.

## Shared contracts required before implementation

1. Workspace owner and optional journal/profile/account scopes; canonical instrument/entity aliases.
2. SourceConnection with distinct history/data/research/execution capabilities and observed health.
3. SourceObservation, CanonicalExecution and reconciliation association/conflict records.
4. SyncJob/Cursor/Coverage/ReconciliationCheckpoint and local-engine lifecycle.
5. CodeArtifact type, immutable Revision, compiler/runtime support and pinned dependency graph.
6. IndicatorAttachment/ChartView versus independent Deployment identity.
7. Strategy model and supported Rule Builder intermediate representation.
8. DatasetVersion and feature availability/adjustment/calendar metadata.
9. Experiment/Trial/Split/Scenario/Seed/Engine manifest and durable results.
10. ValidationRecord linked to exact artifact/data/parameter revisions; no implied profitability certification.
11. Deployment/runtime/target/risk policy, scoped commands/events and activity correlation.
12. Journal facts/reviews, research notebook snapshots and backup dependency manifest.

## Revised development order

P00 revalidation → P01 contracts → P02 durability → P22 local sync/history foundation and P03 standalone journal → P04 datasets → P05 chart integration → P20 indicator/strategy projects → P06 replay and experiment integration → P21 robustness. This establishes a useful independent local research/testing product before broad execution.

P07 connector contracts/read-only access spikes can run alongside this after P01/P02; real P22 adapters depend on them. P08–P10 verify family-specific connections. P11 adds single-account execution; P12 copying follows reconciliation and risk evidence. Strategy bot deployment in P20 becomes executable only through accepted P11 adapters; authoring/backtests do not wait for live execution.

P13–P16 fundamentals/reports remain an independent branch after identity/storage, with source quality first. P17 joins workflows/advanced tools/optional AI to the accepted contracts. P18/P19 run throughout. Keep existing package IDs stable; P20–P22 are inserted by dependencies, not appended as an afterthought.

## What must change in P00 next

Do not add more top-level tabs to the old harness and call it a design. Replace it with three realistic, low-decision end-to-end prototypes:

1. Journal independently: manual/import plus read-only source, visible sync and reconciliation.
2. Strategy research: create indicator → apply to chart → create strategy rules → backtest → robustness → draft deployment.
3. Fundamentals: investigate sourced fact/report → save hypothesis → link to chart/journal/strategy.

Use a coherent shared shell and context; expose advanced controls when relevant. Check normal and failure paths, task completion, back navigation, visible mode, source provenance, dirty drafts and keyboard use. Internal route/state tests remain useful but do not substitute for realistic interaction or user review. Leave P00 open until these journeys are designed and reviewed; no fresh completion claim is made by this document.

## Verification and remaining uncertainty

Source inspected: current P00/master/P01 plans; `ScriptPanel.tsx`, `openscriptFiles.ts`, `openscriptDrafts.ts`; `backtestRun.ts`, `backtestInputs.ts`; `openscript_runner.py`, deployment/config/runner services; `portfolio/walkforward.py`; prior journal/data/execution/automation audit evidence. Browser fixture checks from v1 are historical; this review did not run new live account sync, broker orders or a redesigned user study.

Ran six existing frontend files: `backtestEngine.test.ts`, `backtestInputs.test.ts`, `backtestOffThread.test.ts`, `backtestRun.test.ts`, `openscriptDrafts.test.ts`, `replayTradingLock.test.ts`: 71 tests passed. No claim is made that a unified Strategy Lab, general stress-testing platform, Myfxbook adapter or cross-source journal reconciliation already works.

Provider-specific history coverage, polling quotas, supported rule-language operations and engine parity must be established through the new detailed work packages and fixtures. The protocol choices are design decisions; actual performance, licences and external account eligibility are verified during their respective implementation spikes.
