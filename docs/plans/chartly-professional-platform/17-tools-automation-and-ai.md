# P17 Workflows, deployment operations and optional AI

Status: Planned. No implementation task is marked complete by this document.

Release: read-only orchestration can ship when its domain service is ready; connected writes require P07/P11; integrated operations gate R4. Dependencies: [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md), plus the specific source/job/runtime capability used.

[Master plan](MASTER_PLAN.md)

## Outcome

Users automate supported jobs and operate versioned strategy deployments with explicit scope, permissions, logs and recovery. Optional AI remains a separately configured consumer of those services.

## Implementation areas and dependencies

Existing Flow editor/list/run logs; OpenScript deployment/runner and shared host scheduler; supported platform alerts, Agent and Action Center. The retired Tools directory and specialist options/SIP products are excluded.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Read-only research tools depend on P04/P13; executable automation additionally depends on P07/P11 and P12 only when copying is selected.
- Strategy research, simulated outcome and broker fill remain different records. Optional AI must cite source evidence and obey capability/approval boundaries.
- Retain substantive existing fill repair, conditional claims, process control and diagnostics instead of replacing them with parallel systems.
- P20 owns strategy artifacts and promotion UI; P21 owns experiment jobs/results; P17 owns operational workflow/deployment lifecycle; P11 alone owns eligible broker dispatch. No duplicate trade or result store is introduced here.

## Implementation checklist

- [x] **P17-T01** Inventory retained Flow/alert/deployment/Agent capabilities and shared host/scheduler dependencies. Assign migration owners and published prerequisites; preserve retired-product boundaries and existing saved work. Done 2026-11-04: [inventory](p17/INVENTORY.md) with owners/prerequisites per surface; retired boundaries and saved work preserved.

- [x] **P17-T02** Integrate deployment operations over the existing versioned runtime: draft/start/stop/upgrade/restart/rollback/reconcile, exact account/source/revision, logs and local-engine requirements. Paper/demo/live capabilities remain explicit; connected writes use P11. Stop does not imply orders cancelled or positions closed. Done 2026-11-04: `services/deployments.py` draft/start/stop/upgrade/rollback/reconcile over exact artifact revision + frozen account/mode binding; stop explicitly does not cancel orders or close positions; writes route through P11 destinations only.

- [x] **P17-T03** Connect supported workflow nodes to journal sync, data ingestion, research refresh, experiment submission and notifications through their owning domain APIs. Retain scoped input/result references and explain unavailable actions; do not duplicate P21 reports, P13 facts or journal executions. Done 2026-11-04: workflow action registry (`journal.sync`, `research.refresh`, `experiment.run`, `notify.local`) dispatching to owning-domain handlers and storing job references — no duplicated ledgers/reports.

- [x] **P17-T04** Bind Flow/scripts/platform alerts to immutable execution account/environment/version and explicit arming/approval policy; preserve legacy labels until migrated. Done 2026-11-04: deployment binding freezes accountId/mode/nativeSymbol at bind time; start requires armed + eligible; legacy Flow/alert labels untouched until migrated (inventory).

- [x] **P17-T05** Unify trigger/approval/submission/fill/reconciliation activity and journaling; correct success wording that overstates acknowledgement as execution. Done 2026-11-04: unified activity feed with honest status wording (`acknowledged — working, not filled`, `unknown — do not resubmit`).

- [x] **P17-T06** Replace implicit schedule timezone assumptions with explicit timezone/calendar, next-run preview and missed-run/stop semantics. Extract or adapt shared Python-host scheduling only after dependency tests and saved-work migration/recovery pass. Done 2026-11-04: explicit IANA-timezone daily schedules with next-run preview and skip/run-once missed semantics (zoneinfo-tested); shared-host extraction deferred behind its stated gate.

- [x] **P17-T07** Integrate optional AI as read-only source-cited research assistance first; require declared tool permissions and existing execution approval policies for writes. Done 2026-11-04: `AiResearchAssistant` read-only over saved snapshot evidence with citations and declared read-only permissions; unconfigured AI reports unavailable and blocks nothing.

- [x] **P17-T08** Provide targeted diagnostics, redacted support export and extension guidance; keep module enablement independent from journal/chart/research-only setup. Done 2026-11-04: redacted support export (secret-shaped keys redacted by meaning at any depth, unknown shapes omitted); module independence asserted in inventory + AI test.

## Acceptance criteria

- [x] Automation header and approval show the actual account and environment. Deployment binding carries accountId + mode immutably from bind time.
- [x] Workflow operations reference durable domain jobs/results without creating another ledger or losing their destination scope. Actions return handler job references only.
- [x] Two chart views cannot start duplicate deployment runtimes; chart closure and stopping a bot have explicit independent effects. Duplicate start refused (`deployment.already_running_duplicate_refused`); stop semantics stated in every stop response.
- [x] AI unconfigured does not prevent any non-AI core workflow. Proven by test: unconfigured assistant returns unavailable, core untouched.

## Required verification scenarios

- Duplicate webhook, DST schedule, script restart and revoked account.
- Unknown broker send and approval under changed mode/version.
- Untrusted source text attempting tool execution and unsupported research claim.

## Risks and decisions to resolve

- User-provided Python is not a security sandbox; document process/trust boundaries.
- AI output needs source grounding and cannot certify numbers without deterministic calculations.

## Scope boundary

Deferred from this package: AI-led autonomous live trading, resurrection of retired Tools/options/SIP products and claims of sandbox isolation without implementation. Advanced job nodes appear only after their underlying service is implemented and verified.

## Completion evidence and handoff

Before marking P17 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified. 6/6 tests green 2026-11-04.
- [x] Evidence recorded and downstream contracts/documentation updated. [p17/evidence](p17/evidence); unblocks P20-T06/T08.
- [x] Corresponding master checkbox updated only after acceptance.

## Foundation revision 2 integration requirement

First-class strategy authoring and robustness belong to P20/P21. This package integrates retained orchestration, runtime operations and optional AI. Workflow triggers invoke shared domain services; they do not bypass mode/risk gates or create another fill ledger. The earlier specialist-tools migration scope is superseded by the user's retirement decision.

See [foundation review](p00/FOUNDATION_REVIEW_V2.md) and P20/P21/P22.

## Latest environment/workspace boundary

The user clarified that profiles are environments. Keep Chart and Journal as focused destinations; Open owns portfolio Overview, Connections and Settings. Journal retains its own performance Overview/Trades/Calendar/Breakdown/Mind without the portfolio tab bar. Keep one-account book ownership, saved-history paper versus connected live readiness, and independent sync. Retire Tools navigation by rehoming useful existing modules; Workflows is a primary section; using automation remains optional. [Current P00 specification](p00/ENVIRONMENT_AND_MODULE_WORKFLOWS.md). This overrides earlier book-card or shared journal-settings navigation proposals. No production change or completion is implied.
