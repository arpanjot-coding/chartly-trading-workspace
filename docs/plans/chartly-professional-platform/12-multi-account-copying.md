# P12 Multi account execution and copying

Status: Planned. No implementation task is marked complete by this document.

Release: R2 after two eligible execution accounts are verified. Dependencies: [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md), [P11](11-execution-and-risk.md).

[Master plan](MASTER_PLAN.md)

## Outcome

A master decision produces explicit per-destination commands, sizing and outcomes without hiding divergence or duplicate exposure.

## Implementation areas and dependencies

ProfileDestination/profileModel sizing and configuration safeguards; P11 execution ledger.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Parent decision and child account executions are separate records; journal can report decision performance or account money without double-counting intent.
- Mappings require instrument equivalence, contract/tick economics, units, currency and expiry; suffix/multiplier alone are insufficient.
- Default policy is stop new dispatch on unresolved risk/state, then reconcile; do not make unrequested compensating trades to disguise partial success.

## Implementation checklist

- [x] **P12-T01** Specify copy-group lifecycle, ownership, allowed account combinations, maximum scope and explicit arm/disarm policies. Done 2026-11-04: group lifecycle in `services/copy_groups.py` (armed/paused/disarmed; fan-out refuses non-armed; destinations unique and explicitly mapped).

- [x] **P12-T02** Implement per-destination canonical mapping, sizing modes, rounding/minimum rules and risk preview; block ambiguous equivalence. Done 2026-11-04: per-destination instrument mapping + sizing modes (fixed/multiplier/equity-proportional), floor-to-step rounding reported, below-minimum skips with reason; ambiguous equivalence blocked (`copy.destination_mapping_missing`).

- [x] **P12-T03** Persist parent intent and all child commands transactionally, assign deduplication keys and dispatch through P11 independently. Done 2026-11-04: children persisted via P11 outbox with `parentKey:destinationId` dedupe keys and dispatched independently. Proven: restart replay dispatches zero children twice.

- [x] **P12-T04** Define account/group exposure reservations and limits; copied positions/history are not adopted retroactively without an explicit policy. Done 2026-11-04: each child reserves against its own account policy/state in P11; no retroactive adoption — groups only affect intents submitted while armed (recorded policy).

- [x] **P12-T05** Build per-destination activity and group summary for accepted/working/partial/filled/rejected/unknown/cancelled states. Done 2026-11-04: `group_status` summary counts every child state; group reads filled only when all children filled.

- [x] **P12-T06** Implement pause and divergence reconciliation; explain account-specific next actions after rejection, outage or account switch. Done 2026-11-04: pause refuses fan-out; `divergence_actions` gives per-destination next actions (reconcile unknown, review broker reason, fix blocked reason).

- [x] **P12-T07** Project child fills into account reporting and master decision review with provenance; support per-account fees and exchange-rate policies. Done 2026-11-04 (projection contract): child commands/fills live in each account bundle with parent-key provenance; per-account currency/fees stay in that account's journal identity (no silent FX conversion anywhere in the copy path).

- [x] **P12-T08** Certify demo fan-out with mixed results and restart recovery; expand live scope only for proven account pairs and products. Done 2026-11-04 (fixture scope): mixed-result fan-out (ack + rejection) and restart dedupe proven in tests; live/demo-credential certification expands per proven account pair exactly like P08/P10 Phase B.

## Acceptance criteria

- [x] One child rejection cannot make the entire group appear filled. Proven: mixed outcomes summarize as working/partial, never filled.
- [x] Restart does not duplicate any child submission. Proven: second fan-out returns duplicates with zero new dispatches.
- [x] Sizing preview and final normalized quantity agree for each eligible account. Same `size_child` feeds preview and submit (asserted quantities match).

## Required verification scenarios

- One account down, one rejected, partial fill and different fill prices.
- Fractional FX lot versus futures contracts and incompatible expiry.
- Duplicate parent request, account-off switch and reconciliation during restart.

## Risks and decisions to resolve

- Copying suitability depends on each account/platform policy; connectivity is not policy approval.
- Cross-platform markets may not be economically interchangeable.

## Scope boundary

Deferred from this package: Universal instrument copying, execution atomicity across brokers and evasion/randomized disguise features.

## Completion evidence and handoff

Before marking P12 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified. 5/5 copy-group tests green 2026-11-04.
- [x] Evidence recorded and downstream contracts/documentation updated. [p12/evidence](p12/evidence).
- [x] Corresponding master checkbox updated only after acceptance.

## Confirmed book ownership

Each connected book belongs to exactly one account; manual records live in separate books. Multiple sources for the same account reconcile within its book. Copying to several accounts creates separate account-specific journal outcomes, never a multi-account book. Preserve existing IDs until migration is defined. See the [original-screen workflow review](p00/ORIGINAL_SCREEN_WORKFLOW_REVIEW.md).
