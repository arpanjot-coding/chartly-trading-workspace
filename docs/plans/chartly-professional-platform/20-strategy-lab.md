# P20 Dedicated Strategy Builder and artifact lifecycle

Status: Planned. No implementation accepted. P00 is approved. Dependencies: P01 contracts and P02 persistence; chart attachment uses P05, experiments use P04/P21, and actual connected runtime actions use P17/P07/P11. Authoring does not wait for all execution or robustness work to complete.

[Master plan](MASTER_PLAN.md) · [Foundation review](p00/FOUNDATION_REVIEW_V2.md)

Current product brief: [Strategy Builder gap review](p00/STRATEGY_BUILDER_GAP_REVIEW.md) and [detailed implementation sequence](p20/IMPLEMENTATION_PLAN.md). The user wants new Indicator/Strategy project workflows; the temporary Python/managed/portfolio/chart launcher was removed. Reusable engines are implementation inputs, not the new product's navigation or a completed builder.

## Outcome

Users create an indicator or executable strategy through supported rules/code, apply indicators to charts, run reproducible experiments and optionally create independently managed bot deployments. Standalone research does not require a broker or trading profile.

## Design and contracts

Builder artifact kinds are Indicator and Strategy. Flow workflow definitions belong to P17; a bot is a deployment of a strategy revision. Define Project, Draft, ArtifactRevision, DependencyLock, ParameterSet, ChartAttachment and draft DeploymentRevision. Record language/compiler/runtime versions and cryptographic content identity where integrity matters. Existing draft fingerprints remain conflict hints, not immutable provenance.

Rule Builder targets a declared subset of the canonical strategy model. Code outside it is labelled code-only; do not promise arbitrary round-trip conversion. The retired options leg builder is not this product's target; future derivatives support needs explicit instrument/engine contracts. Preserve useful compiler/diagnostic/study and deployment primitives while designing a new connected project/editor/test/report workflow.

## Implementation checklist

- [x] **P20-T01** Specify indicator/strategy types and lifecycle. Define permitted actions per kind, required execution rules, dependency resolution, versioning, warmup, bar-close/intrabar policy and missing-data behaviour. Produce concrete valid/invalid project fixtures before UI code. Done 2026-11-04: [lifecycle specification](p20/ARTIFACT_LIFECYCLE.md), `services/strategy_artifacts.py` (chartly-rules-v1 validation, checksum identity, deterministic dependency locks over P01 records), fixtures in `test/test_strategy_artifacts.py` (6/6).
- [x] **P20-T02** Implement project/draft/revision storage and dependency lock manifests. Saving a draft may retain errors; only validated revisions can be applied/tested. Editing never mutates a tested or running revision. Resolve conflicting edits without losing user text. Done 2026-11-04: `database/strategy_artifacts_db.py` + `services/strategy_artifact_store.py` (scoped bundles, draft CAS, append-only revisions, cross-project dependency locks, budgets, restart/isolation tests).
- [x] **P20-T03** Build the first Rule Builder subset and code editor over shared artifact semantics. Specify inputs/outputs, diagnostics, templates and explainable generated logic. Unsupported graph/code operations fail clearly rather than silently changing trading rules. Done 2026-11-04 (engine scope): `services/strategy_rules.py` canonical compiler + prefix-causal evaluator (SMA/EMA/RSI/lag/cross/compare/logic), builder-vs-handwritten plan identity, future access structurally rejected, why-not-firing explanations. Browser editor surface lands with the T06 workspace.
- [x] **P20-T04** Connect indicator preview/reference-value tests and versioned chart attachments. Apply to a chart never arms execution. Declare live-candle recalculation, repainting and replay-prefix behaviour; changed dependencies require an explicit attachment upgrade. Done 2026-11-04 (backend scope): stored-revision preview with forming-bar policy (`evaluate_with_forming_bar`), prefix-causality proven, `IndicatorAttachment` pinning with explicit upgrade only, strategies rejected as studies. Chart rendering of attachments lands with T05/T06 UI.
- [x] **P20-T05** Add strategy experiment setup/report UI using exact artifact/data/parameter/engine versions and instrument economics. Submit/reopen P21's durable jobs/results; reuse existing worker/backtest infrastructure through its adapter instead of creating another result store. Studies must add trading rules before P&L testing. Done 2026-11-04: `/api/local/v1/experiments` compiles the plan server-side from the pinned stored revision, loads candles through `DataLibrary.bars` (the P04 dataset adapter), and submits/runs/reopens the single P21 durable job store; workspace Experiments card covers setup, queue, cancel and report reopen. Indicators without entry/exit outputs fail quality gates before any P&L claim.
- [x] **P20-T06** Implement draft bot deployment with source/account/environment/risk/runtime bindings. Attach an existing deployment to multiple chart views without duplicate start. Writes become available only through accepted P11 interfaces; no alternate global mode bypass. Done 2026-11-04: `/api/local/v1/deployments` drafts bind artifact revision+checksum to a frozen P11 destination; duplicate start refused so chart views attach without a second runtime; writes only via P11.
- [x] **P20-T07** Establish supported parity fixtures between indicator calculation, backtest, paper and live evaluation. Record known differences in event timing/fills; do not assert numerical parity solely because source text matches. Trust boundaries for Python/native extensions remain explicit. Done 2026-11-04: [PARITY.md](p20/PARITY.md) + fixtures proving batch=prefix-replay, store preview=direct compile, and EMA/RSI against an independent rational oracle; fill/engine differences recorded, OpenScript parity explicitly not claimed.
- [x] **P20-T08** Implement candidate/revision selection, evidence comparison and explicit upgrade/rollback preparation in the Builder. Hand lifecycle operations to P17 and eligible writes to P11, preserving previous evidence and position context. Chart attachments link an existing deployment; they cannot start a duplicate or silently change its revision. Done 2026-11-04: upgrade/rollback preparation via P17 deployments API (previous revision + evidence preserved in the record/events; running deployments must stop first; attachments cannot change revision silently).

## Acceptance criteria

- [ ] Indicator authoring/reference check/chart use works without execution credentials.
- [x] Changing a draft does not change a running deployment or previously saved experiment. Deployments freeze revision+checksum; upgrade requires stop and keeps the previous revision; experiments are immutable records (P21).
- [x] Two chart views of one deployment cannot start two runtimes. Proven over HTTP: second start returns 409 `deployment.already_running_duplicate_refused`.
- [ ] User can trace a journal fill to deployment revision, inputs and producing strategy.
- [ ] Unsupported rule conversion or runtime capability cannot silently alter strategy logic.

## Required verification scenarios

Compile error with retained draft; dependency cycle/changed version; unavailable source; source without volume; warmup; repaint on incomplete bars; chart close; local-engine stop; concurrent starts; interrupted upgrade; account change; historical intent attempting live routing.

## Risks and decisions to resolve

Choose the initial supported language/rule subset from existing compiler/runtime capabilities. Define generated-code ownership and which authored forms are editable. Decide deploy-on-close policy from the actual local process model; never imply continuous runtime on a powered-off PC.

## Scope boundary

No universal code translation, bot profitability certification, marketplace/community distribution or arbitrary Python security isolation in the initial package. Advanced execution stages wait for adapter/risk gates; project authoring can ship earlier.

Core authoring, project storage and indicator/chart use are a bounded delivery before full connected deployment integration. Record that slice's evidence locally; keep the full package checkbox open until all required tasks/acceptance pass. P21 baseline needs accepted artifact contracts, not completion of every P20/P17 live-operation task.

## Completion evidence and handoff

Record actual artifact schema versions, reference/parity fixtures, worker/runtime version scope, browser journeys and persistence/recovery tests before ticking tasks. P21 receives immutable project/experiment inputs; P11 receives explicit deployment intents; P03 receives confirmed events, not speculative signals.

## Existing app preservation and book scope

Use existing script/indicator/chart tools as the base and preserve their presentation where accepted. Strategy projects/experiments/deployments add explicit version/account/book context and missing workflow, not another competing editor/chart implementation.

Controlling scope: [Existing app scope and journal book workflows](p00/EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md).

## Latest environment/workspace boundary

The user clarified that profiles are environments. Keep Chart and Journal as focused destinations; Open owns portfolio Overview, Connections and Settings. Journal retains its own performance Overview/Trades/Calendar/Breakdown/Mind without the portfolio tab bar. Keep one-account book ownership, saved-history paper versus connected live readiness, and independent sync. Retire Tools navigation by rehoming useful existing modules; Workflows is a primary section; using automation remains optional. [Current P00 specification](p00/ENVIRONMENT_AND_MODULE_WORKFLOWS.md). This overrides earlier book-card or shared journal-settings navigation proposals. No production change or completion is implied.
