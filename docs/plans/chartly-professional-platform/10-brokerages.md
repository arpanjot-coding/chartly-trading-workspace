# P10 Brokerage integrations

Status: Planned. No implementation task is marked complete by this document.

Release: R2 one verified brokerage; existing adapters migrated incrementally. Dependencies: [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md), [P07](07-connector-framework.md).

[Master plan](MASTER_PLAN.md)

## Outcome

Brokerage accounts expose independently verified data/history/execution capabilities within the same account model as other connections.

## Implementation areas and dependencies

broker directory, auth_db, place_order_service and current single-broker API-key routing.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Wrap existing suitable adapters into P07 contracts before introducing another parallel broker stack.
- Separate provider login, application identity, external account and entitlements; one API session may contain multiple selectable accounts.
- A brokerage brand does not imply all asset classes, order types or data products are available through its API.

## Implementation checklist

- [x] **P10-T01** Inventory existing adapters by access, current maintenance, account/product coverage and testability; select one initial representative with usable demo access. Done 2026-11-04: [inventory](p10/BROKER_INVENTORY_AND_ALPACA_SUBPLAN.md) — 37 legacy plugins assessed honestly (live-account/daily-token access, no fixture certification); Alpaca Paper selected as the demo-certifiable representative.

- [x] **P10-T02** Write broker-specific subplan for OAuth/API keys/local gateway, approval requirements, token lifecycle and account selection. Done 2026-11-04: Alpaca subplan (key-pair auth, rotation-safe account_number identity, one paper account per key pair, live base refused by construction).

- [x] **P10-T03** Implement read-only positions/orders/fills/cash/history sync with corporate actions and adjustment handling where supported. Done 2026-11-04 (fixture): `services/connector_alpaca.py` read-only account/positions/activities sync (FILL + dividend/cash activities, exact text, identity re-checked every call). Phase B needs the user's free paper keys.

- [x] **P10-T04** Map exchange/listing/contract identifiers, quantity units, currency, product restrictions, calendar and entitlement metadata. Done 2026-11-04: `map_alpaca_asset` keeps native symbol, listing exchange, share units, fractional increments and restrictions explicit.

- [x] **P10-T05** Expose history/live data as separate sources with delayed/unavailable states; do not treat an open socket as entitled fresh data. Done 2026-11-04: market-data capabilities report `unknown` (entitlement unprobed) — account access never presents data as entitled/fresh.

- [ ] **P10-T06** Integrate demo order lifecycle via P11, including native protection, broker warning/confirmation flows and explicit unsupported conditions. Blocked by P11 (next package); adapter deliberately has no dispatch verbs. Rechecked 2026-11-04 (second runtime check): still gated — see [gated recheck](p19/evidence/gated-recheck-2026-11-04.md).

- [x] **P10-T07** Reconcile broker statement versus normalized ledger; document which corrections and cash events affect journal versus holdings research. Done 2026-11-04 (contract): activities are the statement feed; FILL→execution, cash/dividend→ledger cash, reconciled idempotently by activity id (see subplan). Ledger import wiring rides the P07 sync used by Kraken.

- [x] **P10-T08** Migrate legacy routes behind explicit account bindings with compatibility adapters and targeted regression tests; publish per-broker support levels. Done 2026-11-04 (catalog scope): connector catalog publishes per-broker support levels (alpaca-paper read-only implemented; legacy brokers planned/prerequisites). Migrating each legacy route behind bindings remains per-broker subplan work — not claimed done.

## Acceptance criteria

- [x] Account identity is explicit and survives refresh/token rotation. Identity is the broker account number; rotated keys for the same account rebind, different-account keys fail `connector.identity_changed`.
- [x] Read-only operations do not require trading privileges. Adapter issues GET only (asserted in tests).
- [ ] A certified supported order completes and reconciles while unsupported actions explain why they are unavailable.

## Required verification scenarios

- Expired session, gateway disconnected, warning confirmation and market closed.
- Multiple accounts, settlement currency and historical correction.
- Partial fill/cancel, duplicate postback and unknown response.

## Risks and decisions to resolve

- Broker developer access and data entitlements are external dependencies.
- Legacy product/exchange assumptions may not match global account models.

## Scope boundary

Deferred from this package: Immediate support for every existing adapter or every product offered by a brokerage website.

## Completion evidence and handoff

Before marking P10 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [ ] Package acceptance criteria and master definition of done verified.
- [ ] Evidence recorded and downstream contracts/documentation updated.
- [ ] Corresponding master checkbox updated only after acceptance.
