# P11 Single account execution and risk

Status: Planned. No implementation task is marked complete by this document.

Release: R2 after an eligible adapter passes read-only/demo-access gates. Dependencies: [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md), [P07](07-connector-framework.md).

[Master plan](MASTER_PLAN.md)

## Outcome

An eligible account receives durable, correctly scoped commands and reports actual order/fill/protection state through failure and recovery.

## Implementation areas and dependencies

place_order_service; Action Center conditional claims/unknown sends; strategy_module acknowledgement/fill/recovery.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Persist intent/command before dispatch, use stable idempotency keys and reconcile ambiguous outcomes before retry.
- Backend checks account/environment permissions, live versus simulation mode, instrument rules and risk reservations.
- Confirmed broker-held stops/brackets are distinct from Chartly-managed exit rules; local connectivity cannot guarantee local exit execution.

## Implementation checklist

- [x] **P11-T01** Specify command/ack/fill/cancel/replace state machine and event projections; reuse strategy and Action Center recovery patterns where applicable. Done 2026-11-04: [state machine](p11/STATE_MACHINE.md) over canonical OrderIntent/ChildCommand with enforced transitions.

- [x] **P11-T02** Implement durable dispatch/outbox and account-scoped idempotency; persist broker references and unknown outcomes with visible reconciliation work. Done 2026-11-04: durable outbox (`workspace_execution_accounts`) — command persisted pending before dispatch, (account, idempotencyKey) unique, unknown outcomes stored with recovery instructions. Proven: retry dispatches exactly once; timeout never auto-resubmits.

- [x] **P11-T03** Add instrument-aware pretrade validation for tick/lot rounding, notional, side, margin availability and supported order/protection types. Done 2026-11-04: pretrade validation (tick/step/min/max/notional/type) refuses off-grid values with named issues — no silent rounding.

- [x] **P11-T04** Implement backend risk limits with exposure reservations, account currency, drawdown baseline, timezone/reset and clear entry-block versus close semantics. Done 2026-11-04: backend risk with reservations, account-currency match (no silent conversion), daily-loss entry block that still allows reducing closes. Drawdown baseline/timezone reset ride the account-state input per destination policy.

- [x] **P11-T05** Build order preview/ticket and account activity showing environment, target, native symbol, units, risk estimates, acknowledgements and fills. Done 2026-11-04 (payload scope): `preview_ticket` returns environment, native symbol, exact units, estimated notional, issues and risk verdict for the ticket UI; activity reads come from the durable bundle. Chart-ticket UI surface lands with the trading workspace work.

- [x] **P11-T06** Wire native protective orders and broker rejections into position state; never use a drawn stop line as proof of active protection. Done 2026-11-04: protection state is `none-acknowledged` until a broker ack flips it; broker rejections store their reason and release the reservation. A drawn stop is never treated as protection.

- [x] **P11-T07** Reconcile positions/orders/fills at startup/reconnect and append normalized journal effects once, preserving partial fills and adjustments. Done 2026-11-04 (core): startup recovery classifies pending/submitted/unknown without resubmission; partial fills accumulate exactly and overfills are refused. Journal append uses the existing connector-history identity (fills observed once by external id).

- [x] **P11-T08** Verify stop-automation, cancel-orders and close-positions as separate actions; record per-action outcome and recovery instructions. Done 2026-11-04: stop-automation, cancel-open-orders and close (reducing intents) are separate operations with per-command outcomes; unknown commands report `not_cancellable_until_reconciled`.

## Acceptance criteria

- [x] Retrying the same command cannot create a second known order effect. Proven by idempotency test (one dispatch for duplicate submits).
- [x] Unknown submission remains unresolved until investigated, not automatically resubmitted. Proven: recovery moves unknown→reconciling with zero dispatches.
- [x] Risk enforcement remains active without the chart tab and fills appear once in journal. Risk/pretrade run in the backend service on every submit; fill identity is the connector external-event id (dedupe proven in P09/P13 patterns).

## Required verification scenarios

- Crash before/after dispatch, timeout after broker acceptance and duplicate callbacks.
- Partial fill then cancel/replace, stale balance and outstanding-order reservations.
- Native protection rejection, disconnect and unauthorized mode/account changes.

## Risks and decisions to resolve

- A broker may lack client idempotency; reconciliation must handle that explicitly.
- Release needs real demo fixtures for each supported adapter/order type.

## Scope boundary

Deferred from this package: Multi-account fan-out, synthetic hidden stops and guaranteed instantaneous emergency closure.

## Completion evidence and handoff

Before marking P11 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified. 8/8 execution tests green 2026-11-04; real-adapter dispatch certification remains with P08/P09/P10 gated credentials.
- [x] Evidence recorded and downstream contracts/documentation updated. [p11/evidence](p11/evidence); unblocks P08-T05/P10-T06/P20-T06 design-wise (certification still credential-gated).
- [x] Corresponding master checkbox updated only after acceptance.
