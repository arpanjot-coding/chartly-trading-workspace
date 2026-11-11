# P00 Product scope and workflow specification

Status: **Complete as the product/UI design package, 2 November 2026. All 13 tasks verified and the user explicitly approved the P00 design baseline.** P01 is ready for contract implementation. Production features remain tracked in their own packages.

Owner: Codex. Release: all releases. Dependencies: none.

[Master plan](MASTER_PLAN.md) · [Acceptance/evidence](p00/P00_ACCEPTANCE.md) · [Review layouts and walkthroughs](p00/original-screen-review/index.html#p00-storyboards)

## Outcome

A reviewed product/UI baseline lets users choose standalone journal, original chart, paper practice, strategy research, fundamentals or connected trading without unrelated setup. P00 defines and reviews these workflows; downstream packages implement them.

## Implementation areas and dependencies

Keep the original React chart/journal and current Workspace environment cards as the base. The P00 deliverable is the current design package, not a replacement app or certification of providers/execution.

- [Confirmed product decisions, job stories, route map, object ownership, vocabulary and launch/support matrix](p00/P00_DECISIONS.md).
- [Whole-product screen and handoff blueprint](p00/APP_WORKFLOW_BLUEPRINT.md).
- [46 screen-specific layout/state contracts](p00/P00_SCREEN_CONTRACTS.md) and [machine-readable companion](p00/p00-screen-contracts.json).
- [Original-screen-based review with wireframes and connected walkthroughs](p00/original-screen-review/index.html#p00-storyboards).
- [Task trace, validation, findings and final acceptance](p00/P00_ACCEPTANCE.md); [machine-readable gate](p00/P00_ACCEPTANCE.json).

Read the [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) and the current design package before changing production seams. Earlier standalone prototypes, conflicting module proposals and their withdrawn acceptance remain historical references only.

## Design and contracts

- Four work sections in the user's confirmed order: Workspace, Fundamentals, Strategy Builder, Workflows; directly visible tabs, plus Settings and shared data/activity/recovery surfaces.
- User-confirmed: profiles are environments; one active connected book per account; separate manual books; bot deployments under Workflows with chart/Builder links.
- Preserve original Chart / Journal / Open actions, the original terminal, journal tabs and visual hierarchy. Open owns portfolio Overview / Connections / Settings.
- Separate books/accounts, price/research/history sources, simulated/live execution, project revisions/experiments/deployments and original report evidence.
- Every UI surface has explicit prerequisites, actions, handoffs, error/recovery and keyboard/narrow expectations. Fictional review values are labelled and cannot enter production data.
- Publish bounded R1–R4 support and require per-adapter access/coverage tests before claiming universal integration.

## Implementation checklist

- [x] **P00-T01** Write personas and job stories for manual journal, statement import, historical practice, crypto trading, terminal trading and research-only use; document their first useful outcome.

- [x] **P00-T02** Draw complete navigation and route maps including local versus connected prerequisites, deep-link return paths, module pinning and persistent profile/account scope.

- [x] **P00-T03** Specify first-run setup for each job, including valid no-account and no-feed states; specify removal of universal broker checklists from journal/research-only users for downstream implementation.

- [x] **P00-T04** Annotate the existing Workspace/profile-book, journal, chart and related screens with narrowly scoped workflow/state changes. Create new fundamentals/import/sync detail wireframes only where behaviour genuinely needs them; preserve the original chart and journal presentation.

- [x] **P00-T05** For each screen specify empty/loading/saved/failed/stale/partial/unauthorized states and the next recovery action; include keyboard focus and narrow layouts.

- [x] **P00-T06** Define mode/status vocabulary with examples: historical study, replay paper, demo broker, live broker; configured versus connected; submitted versus filled.

- [x] **P00-T07** Choose the initial support matrix and release evidence required for R1–R4; explicitly separate general architecture support from certified adapter support.

- [x] **P00-T08** Run task-based review of the annotated original-app journeys using representative records; log navigation failures and revise the flows before accepting their implementation specification.

- [x] **P00-T09** Validate the shared object graph and independent Journal, Charts, Strategy Lab, Fundamentals and Automation product boundaries against the eight integrated journeys and 18 gaps.

- [x] **P00-T10** Specify standalone journal history sync, local-engine lifetime, provider coverage, multiple-source reconciliation and annotation-preserving updates; validate offline/startup/reconnect cases.

- [x] **P00-T11** Design indicator versus strategy actions, code/rule authoring, immutable dependencies, chart attachments and independent bot deployment lifecycle with explicit environment/account/risk gates.

- [x] **P00-T12** Specify reproducible experiments, manual replay versus automated tests, out-of-sample/robustness studies, resource limits, evidence validity and causal feature availability.

- [x] **P00-T13** Review three connected journeys using the original app as the UI baseline: independent journal book/import/sync; existing chart/editor-to-strategy/testing/deployment; fundamentals-to-cited-decision. Specify book ownership and exact integration changes. Do not build another replacement shell; obtain user review before acceptance.

## Acceptance criteria

- [x] Every entry journey has a specified start, first useful outcome and recovery path, internally checked against the current design.
- [x] Journal-only and research-only design paths require no execution setup; legacy production guard migration is explicitly downstream work.
- [x] All primary UI surfaces have screen-specific layouts/references and state contracts reviewed internally at the design gate.
- [x] User has reviewed and accepted the three connected original-app-based storyboards and the resulting screen/workflow baseline.

## Required verification scenarios

- Malformed statement row blocks commit; correction and repeat import preserve one receipt and book scope.
- Missing historical data returns to the same run; next-bar paper fills, costs, checkpoint and once-only journal effect are explicit.
- Unknown submission exposes reconciliation, not blind retry; acknowledgement is not a journal fill.
- Research outage preserves cited evidence; a refreshed fact does not rewrite the saved snapshot; chart mapping is exact or unavailable.
- Indicator/strategy and chart/runtime lifetimes remain distinct; tested revisions, parameters and dataset references are immutable.
- Read-only sync/automation deduplicates scope/events and never grants order permission.

## Risks and decisions to resolve

The product placement/book decisions are confirmed. Remaining implementation uncertainty has named downstream owners: P01 identity/state schemas, P02 compatibility/migration, P07 provider access/capabilities and P13 source coverage. These are not unbounded promises or hidden claims of current support. The user accepted the final layout/storyboard baseline. Adapter/schema/migration feasibility remains downstream implementation work.

## Scope boundary

P00 delivers workflow decisions, original-screen annotations, missing-flow wireframes, state contracts, fictional walkthroughs and implementation handoff. It does not implement production sync/import/simulation/research/bots, alter user records or certify integrations. Final visual branding, proprietary data purchases and additional provider commitments are deferred.

## Completion evidence and handoff

See [P00_ACCEPTANCE](p00/P00_ACCEPTANCE.md) for exact checks/findings and [P01 detail](p01/IMPLEMENTATION_PLAN.md) for the next contract work. Existing tested journal separation, Combined Analysis and settings cleanup remain bounded production slices; their evidence does not complete later product features.

- [x] Internal design verification and task evidence recorded for T01–T13.
- [x] Downstream P01 handoff updated to the current decisions and screen contracts.
- [x] Final user review accepted; package acceptance and master definition of done satisfied for this design scope.
- [x] Master P00 checkbox updated after explicit acceptance; P01 is ready, with its implementation tasks still unchecked.

## Historical evidence

The old [product specification](p00/PRODUCT_SPECIFICATION.md), [prototype](p00/index.html), [v1 screen contract](p00/screen-spec.json) and [withdrawn validation](p00/VALIDATION.md) are superseded by this package. The [foundation review](p00/FOUNDATION_REVIEW_V2.md) remains an issue source; its F01–F18 requirements are mapped in current acceptance evidence. The current decisions supersede its earlier suggestions to demote Flow or keep a specialist Options Builder.
