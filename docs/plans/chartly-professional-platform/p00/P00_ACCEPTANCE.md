# P00 design acceptance and handoff

2 November 2026. Owner: Codex. Status: **complete as a design package**. All T01–T13 are complete. The user explicitly approved the P00 design baseline on 2 November 2026. P01 is ready; its implementation has not started.

## Current deliverables

- [Confirmed decisions, scope, personas, routes, vocabulary and release matrix](P00_DECISIONS.md).
- [Whole-product workflow blueprint](APP_WORKFLOW_BLUEPRINT.md) and [existing original-screen review](original-screen-review/index.html#workflow/workspace).
- [46 screen-specific layouts and 12 state/recovery contracts each](P00_SCREEN_CONTRACTS.md); [machine-readable contracts](p00-screen-contracts.json).
- [Fictional connected-walkthrough model](p00-review-model.mjs) and [design verification cases](p00-review.test.mjs). These are isolated, in-memory examples, not production features or adapter certification.

## Decisions reviewed with the user

The user answered **“Use these decisions”** to: one active connected journal book per account; separate manual books; profiles as environments; bot deployments under Workflows with chart/Strategy Builder links. The original chart and journal presentation, retained Workflows and retired Tools remain previously confirmed scope.

## Task trace

- **P00-T01:** eight job stories with entry, first useful outcome and recovery in P00_DECISIONS.
- **P00-T02:** existing/proposed route map, validated return context, optional pinning and explicit account/book/project/run scope in P00_DECISIONS and each screen contract.
- **P00-T03:** job-specific first use; valid journal/research without execution setup; explicit downstream replacement of legacy broker gates.
- **P00-T04:** preserved original Workspace/chart/journal/Flow screenshots plus specific missing-flow wireframes, fields and table examples in the existing review.
- **P00-T05:** each of 46 surfaces has ready/empty/loading/saved/failed/stale/partial/unauthorized/unsupported/interrupted/dirty/offline behavior, recovery, focus and narrow-layout rules.
- **P00-T06:** mode/status glossary in P00_DECISIONS; unknown-versus-acknowledged-versus-filled walkthrough.
- **P00-T07:** bounded R1A/R1B/R2/R3/R4 scope and certification evidence; exact exchange/broker selection remains an explicitly owned P07 access spike rather than an unverified launch promise.
- **P00-T08:** final internal task-based review and findings/results are recorded below. Earlier v1 replacement-shell checks are historical and are not reused as acceptance.
- **P00-T09:** P00_DECISIONS object ownership and all current cross-section handoffs; independent products stay independent. Foundation gaps F01–F18 are mapped below.
- **P00-T10:** account-scoped sync/correction/coverage/offline/reopen walkthrough, source limits, immutable annotations and read-only authority.
- **P00-T11:** indicator versus strategy, supported code/visual boundary, frozen revisions, chart attachment and account-bound bot lifecycle; chart closing does not stop the bot.
- **P00-T12:** pinned experiment/data/economics, complete trial ledger, held-out availability, labelled stress methods, resource/recovery and immutable research evidence.
- **P00-T13:** the three connected original-app-based storyboards are prepared: book/import/sync; chart/editor/strategy/report/deployment; fundamentals/report/cited research/chart return. The user explicitly accepted the completed layout/storyboard baseline after receiving the final review packet. This is design acceptance, not certification of the unimplemented production flows.

## Foundation-gap closure as design requirements

- F01/F13: dedicated indicator/strategy product; supported visual subset; retired options tools not reintroduced.
- F02/F03/F04/F15: indicator technical checks, explicit trading rules, pinned revisions, chart attachment separate from bot and deliberate promotion/rollback policy.
- F05/F06/F07: replay versus automated tests versus robustness; complete parameter ledger, chronological evaluation and known fact availability; no unsupported model equivalence.
- F08/F09/F10/F11/F12: independent read-only journal ingestion; source observations versus canonical executions; provider coverage; local worker lifetime; overlap/correction/backfill and retained notes.
- F14/F16: one execution authority with explicit scoped requests; profile/book/account/project/research ownership is not conflated.
- F17/F18: bounded durable jobs and complete backup manifests with explicit dependency/secret recovery.

These are specified requirements for P01 and downstream packages, not claims that production implementations are complete.

## Verification record

Automated design checks: `node --test docs/plans/chartly-professional-platform/p00/p00-review.test.mjs` — **32 passed, zero failed**. They cover the one-active-book/account rule, manual/paper binding rejection, identity-preserving import/sync, same-file/source deduplication, missing data and exact run return, next-bar paper fixture arithmetic/checkpoint, immutable experiments/evidence, chart/runtime lifetime, unsupported/unknown actions, fact availability and read-only automation scope. Production trading/accounting/recovery tests remain downstream.

Browser verification in the current original-screen review:

1. **Import:** malformed quantity disabled full commit; correction enabled it; repeat commit retained one receipt (2 inserted, 1 duplicate); book A and its existing review survived the journal handoff.
2. **Sync:** repeated engine-open produced one account job; overlapping source correction changed one execution's net amount from USD 9 to USD 8 and retained its review; limited history remained Partial; offline/reopen retained cached records and cursor.
3. **Paper:** Start was disabled without data; picker returned to P1; buy and sell filled on subsequent fixture bars; costs yielded ending USD 1,008 from 1,000; checkpoint serialization retained state; one paper journal entry was produced.
4. **Strategy:** an Indicator could not produce P&L; strategy/data setup produced E1; draft fast=12 did not rewrite tested r1 fast=10; paper DEP1 stayed running after chart close; Stop was distinct from claiming positions closed.
5. **Fundamentals:** F1 snapshot/note survived outage; refresh produced current F2 without rewriting F1; exact listing mapping and saved-research return were retained.
6. **Unknown submission:** reconciliation yielded acknowledgement with zero journal trades; repeated confirmed-fill observation yielded one account-specific fill and journal record. No resubmit action was offered.
7. **Automation:** scope validation preceded activation; duplicate T1 delivery produced one run; adding an unsupported order node invalidated activation and could not acquire execution capability.

All 46 layout/state controls rendered across six groups. Twelve states on each of WS11, FND03, SB05, AUTO05, SET02 and SH03 were exercised: **72 distinct representative state/recovery combinations**. All 46 × 12 contracts were checked structurally. This is not a claim of manually inspecting 552 screen images.

At 360px, import, statements, saved report, deployment, data catalog and backup wireframes showed no page-wide horizontal overflow after the table-containment correction. Tables retain local scrolling. Browser viewport was restored to 1280px. Browser console had no errors. Script syntax checks passed; roadmap/evidence validator passed with 24 root plans, 23 packages and 189 unique tasks.

Review examples: [Import validation](p00-final-import.jpg), [tested strategy and paper runtime](p00-final-strategy.jpg), [saved research versus refreshed fact](p00-final-research.jpg).

No production app source, live records, credentials, permissions, orders or notifications were changed by this design package.

## Findings corrected in the final design review

- Import preview now classifies same-file duplicates once, with invalid-row precedence. Repeated commit keeps one receipt and record set.
- Journal handoff originally showed a generic manual-book fixture. It now carries the walkthrough's actual book/account and records into the original journal reference.
- Paper order entry is blocked when there is no next historical bar; finish cannot claim a completed open position.
- Edited strategy drafts cannot be presented as the old validated revision. Deployment scope now names its simulated account/ID and running/stopped stage explicitly.
- Reconciliation cannot downgrade a confirmed fill to an acknowledgement. Read-only automation graph edits invalidate its activation.
- Wide tables expanded the narrow review grid. The content column now permits shrinking and tables scroll inside their own region; all affected layouts were retested.

## P01 implementation handoff

The [P01 brief](../p01/IMPLEMENTATION_PLAN.md) now consumes D01–D16 and the current screen contracts rather than the withdrawn v1 prototype. It explicitly includes JournalBook kinds/cardinality, external versus simulated accounts, compatibility aliases, multi-profile book references, conservative attribution/migration and source reconciliation. All eight P01 implementation tasks remain unchecked. Freeze executable schemas and cross-language fixtures before implementing repositories/migrations in P02.

## Acceptance completed

- [x] Final browser walkthrough and layout/state checks recorded.
- [x] P01 handoff and roadmap trace updated against the final decisions.
- [x] User has reviewed the three storyboards and accepted the P00 screen/workflow baseline.
- [x] Only after those checks, mark P00 complete and make P01 ready. No later implementation package is complete by this handoff.

P00-T13 explicitly requires user review before acceptance. The accepted review packet above covers: journal/import/sync, strategy/report/deployment and fundamentals/cited-evidence/chart return. Accepting it completes a design baseline, not the production app or any unimplemented provider feature.

## User acceptance record

The final question identified journal/import/sync, strategy/testing/deployment and Fundamentals/evidence/chart return, linked the completed review, and explicitly distinguished design acceptance from unimplemented production features. The user answered **“Approve P00 design baseline.”** P00 and its master checkbox were then completed; P01 was made ready with all implementation tasks unchecked.

The subsequent explicit main-navigation clarification—Workspace → Fundamentals → Strategy Builder → Workflows, all direct tabs—was recorded in D05 and [implemented with verification](PRIMARY_NAVIGATION_IMPLEMENTATION.md). It refines the accepted baseline without claiming the missing research/strategy features are complete.
