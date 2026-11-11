# P08 Crypto exchange integration

Status: In progress. P08-T01 is complete (4 November 2026): Kraken spot selected as the first adapter with an official-evidence [subplan](p08/adapters/kraken-spot.md) and [package implementation plan](p08/IMPLEMENTATION_PLAN.md). T02-T08 remain open; T05 is blocked by P11 and T07 requires a separate derivatives subplan.

Release: R2 initial spot adapter; derivatives incrementally. Dependencies: [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md), [P07](07-connector-framework.md).

[Master plan](MASTER_PLAN.md)

## Outcome

A user connects an eligible exchange, imports history, charts entitled/public data and trades supported products with truthful account state.

## Implementation areas and dependencies

Existing crypto broker modules and capability filtering; common P07 registry and event contract.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Evaluate existing/native adapters and CCXT per required capability; do not replace a working adapter merely to standardize dependency names.
- Model spot, margin and derivatives as distinct account/product capabilities; base/quote/settlement currency and quantity precision are explicit.
- Execution permission is optional. Do not request withdrawal privileges; mark keys whose permissions cannot be verified accordingly.

## Implementation checklist

- [x] **P08-T01** Create the selected exchange subplan with official API evidence, available sandbox/demo, supported region/account products and maintained rate limits. Done 2026-11-04: [Kraken spot subplan](p08/adapters/kraken-spot.md) (no spot sandbox exists; read-only key model, cursor paging, rate budget +4 conservative, probes U2-U6 named) and [implementation plan](p08/IMPLEMENTATION_PLAN.md).

- [x] **P08-T02** Implement credentials/permission verification and read-only balance/orders/fills/history ingestion with stable exchange/account event identity. Done 2026-11-04 within fixture scope: `services/connector_kraken.py` + secret-entry UI + structural conformance (see [progress log](p08/IMPLEMENTATION_PLAN.md)). Remaining limit: Phase B acceptance against the user's real read-only key is pending and gates T08 certification, not this implementation.

- [x] **P08-T03** Map asset pairs, tick/quantity/notional filters, fees and symbol changes into canonical instruments; validate orders before submission. Done 2026-11-04: `services/kraken_instruments.py` maps AssetPairs to validated P01 Instrument/Listing records (1,276 live pairs mapped, 194 skipped with explicit reasons) and provides the pure pre-trade filter validator P11 will reuse. Per-fill fees come from TradesHistory (T02); AssetPairs fee fields are deprecated and unused. Nothing is submitted.

- [x] **P08-T04** Connect public/authenticated data streams with sequence/gap recovery, REST snapshots and freshness labels; prevent private stream leakage. Done 2026-11-04 within protocol scope: `services/kraken_streams.py` decoders, CRC32 book (official vector + live feed verified), sequence/freshness trackers, private executions/balances as owner-scoped observations. Remaining limit: live socket lifecycle wiring into the chart/runtime is a separate integration slice; REST remains the accounting authority.

- [ ] **P08-T05** Implement spot demo/sandbox lifecycle through P11, including cancel/replace and unknown outcome reconciliation; do not infer fill from acknowledgement. Rechecked 2026-11-04 (second runtime check): still gated — see [gated recheck](p19/evidence/gated-recheck-2026-11-04.md).

- [x] **P08-T06** Reconcile trade/fee/transfer history into journal accounting and preserve deposit/withdrawal events separately from trading profit. Done 2026-11-04: `services/kraken_journal.py` exact FIFO derivation wired into history sync; derived rows pass the real `normalize_statement` projection; deposits/withdrawals stay cashflow observations outside PnL. Limits: one quote currency per book, >18dp portions skipped explicitly, sells without in-account buys stay unprojected.

- [x] **P08-T07** Add derivatives only with explicit linear/inverse contract, funding, leverage, margin, reduce-only and hedge/net position-mode fixtures. Done 2026-11-05 within fixture scope: `services/derivative_contracts.py` canonical perp model (Binance USDT-M/COIN-M, Bybit linear/inverse, Hyperliquid) with pure leverage/margin-mode/position-mode/reduce-only validators and funding-as-cashflow observations; live public mapping verified (682+20 Binance, 837+22 Bybit, HL tick-refusal by design); no derivative execution or UI controls enabled. See [DERIVATIVES_SUBPLAN.md](p08/DERIVATIVES_SUBPLAN.md).

- [ ] **P08-T08** Certify first adapter, publish coverage/limits and repeat the same checklist for each additional exchange instead of claiming all library venues. Rechecked 2026-11-04 (second runtime check): still gated — see [gated recheck](p19/evidence/gated-recheck-2026-11-04.md). Progress 2026-11-04: repeat-per-exchange adapters shipped Phase A for Binance, Bybit, Coinbase, OKX, Bitget, Hyperliquid (+TopstepX web-prop) with withdrawal-permission refusals and live public-instrument verification for all six crypto venues — see [EXCHANGE_ADAPTERS.md](p08/EXCHANGE_ADAPTERS.md). Certification (Phase B private reads) still gated per venue on user keys; per user instruction 2026-11-04, Kraken is parked while other venues proceed.

## Acceptance criteria

- [ ] Read-only connection provides correct account data without enabling execution.
- [ ] Spot orders satisfy venue filters and reconcile exactly once.
- [ ] Derivative controls appear only for independently verified product support.

## Required verification scenarios

- Precision/min-notional rejection, 24/7 boundaries and stale stream.
- Funding/fee in third currency, duplicate fills and delisted pair.
- Rate limiting, clock skew, permission revocation and missing acknowledgement.

## Risks and decisions to resolve

- Exchange access and test environments vary by region/account.
- Derivative accounting cannot reuse spot cash assumptions.

## Scope boundary

Deferred from this package: Every exchange, prediction markets, staking/DeFi execution and universal derivatives support in the first crypto release.

## Completion evidence and handoff

Before marking P08 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [ ] Package acceptance criteria and master definition of done verified.
- [ ] Evidence recorded and downstream contracts/documentation updated.
- [ ] Corresponding master checkbox updated only after acceptance.
