# Audit 06 — Execution, copying and risk credibility

Source review, 2 November 2026. No orders were submitted, credentials read, user records changed or application code edited. This review traces the existing general order path and selected strategy-recovery code; it is not a certification of any broker adapter or a full trading-safety audit.

## Assessment

The repository contains real broker execution infrastructure, not merely chart mockups. However, the new profile destination/copy controls are a separate local configuration model that has not been wired into that infrastructure. Treating those controls as operating risk protection or multi-account execution would overstate the current product. The interface already discloses this limitation; preserve and strengthen it.

Price data makes analysis possible. It does not establish authority or ability to trade every other account. Each destination needs its own authenticated connection, tradable instrument mapping, quantity and price rules, permissions, supported order types, margin checks and execution lifecycle. Different accounts can fill at different prices, fill partially, reject, disconnect or remain in an unknown submission state. The product should show this explicitly without burdening the initial journal-only workflow.

## Five priorities

### 1. The destination model does not control the actual execution path

Evidence: `frontend/src/pages/workspace/TraderConnections.tsx:598–600` calls this a configuration wireframe and says no live orders or auto-sync run until connectors exist. Saving reports “No connector order was sent” at `:171`. `frontend/src/lib/trader/useTraderData.ts:309–359` validates and persists destinations solely in IndexedDB. Searches of `services/`, `restx_api/` and `database/` found no use of ProfileDestination/profileDestinations/copyingEnabled.

The actual generic write path resolves one API key to an auth token and broker (`services/place_order_service.py:367–375`); `database/auth_db.py:1205–1216` selects the current user's auth record and returns its token/broker. Direct internal token/broker calls are also supported (`place_order_service.py:379–381`). None of that establishes a profile-specific multi-destination router.

Consequence: “Copy on”, “destinations copying” and “Start copying now” (`TraderConnections.tsx:189`, `:576`, `:882`) express saved intent, despite sounding operational. Change their current-build wording to “Copy configured” / “Enable when connected”, or pair the state immediately with “Not executing — connector unavailable”. Later distinguish configured, connected, eligible, armed and actively receiving events.

### 2. Risk limits are configuration, not server-enforced protection

Evidence: `frontend/src/lib/trader/db.ts:173–198` stores sizing, total-lot/position caps and drawdown policy. `profileModel.ts:49–85` checks input ranges; `:88–132` detects risk-increasing edits; `:137–148` prevents one account being armed from another profile. These are valuable configuration safeguards. But no backend consumer of these destination records was found. The account-off check in `useTraderData.ts:327` is a browser transaction check, not an execution permission boundary.

Consequence: a displayed drawdown guard cannot yet promise to prevent an order, flatten an account or survive a browser closing. Before enabling connector execution, enforce limits authoritatively at dispatch using current account exposure, reservations for outstanding orders, explicit currency and a defined drawdown baseline/reset timezone. Show whether the policy blocks new entries, cancels pending orders or closes exposure. Avoid describing an emergency action as instantaneous or guaranteed.

### 3. Multi-account commands need durable per-destination outcomes and uncertain-state handling

Evidence: the general place-order schema (`restx_api/schemas.py:22–48`) has no client command/idempotency key, profile or account destination ID. The general service dispatches to a broker module at `place_order_service.py:221`; an exception becomes a generic error at `:241–258`; a successful acknowledgement returns an order ID at `:261–285`. This endpoint's interface does not provide durable submission deduplication or an explicit “broker outcome unknown” response. This is narrower than claiming no reconciliation exists anywhere.

Substantial reconciliation does exist in the separate strategy module: append-only acknowledgement repair and exact ownership checks (`services/strategy_module/ack_reconciliation.py:57–115`), fill-event deduplication (`order_events.py:17–26`) and cumulative fill folding (`:621–689`), plus restart recovery (`recovery.py:385` onward). Reuse these concepts rather than replacing them with browser retries.

Recommendation: persist a parent intent and per-destination child command before dispatch; use stable deduplication keys and account-scoped external IDs. Keep accepted/working/partial/filled/rejected/cancelled/unknown distinct. A timeout after submission must trigger reconciliation before resubmission. One account's success must not make the whole copy group appear successful. Define the policy for divergence rather than silently retrying into double exposure.

### 4. Suffix plus multiplier is insufficient instrument and risk normalization

Evidence: `ProfileDestination` contains symbolSuffixOverride, lotScalingMode, lotScalingFactor and maxLotCap (`db.ts:176–180`). `defaultDestination` uses flat scaling 1 (`profileModel.ts:187–190`). The existing generic schema forbids fractional quantities outside crypto (`restx_api/schemas.py:6–18`), and uses existing exchange/product conventions (`:22–36`). That is reasonable for the current broker universe but not a universal MT5 FX-lot or futures-contract model. The `broker/` directory currently contains the existing regional and crypto adapter set; no MT5/NinjaTrader/TradeStation adapter directory was present in this review.

Recommendation: resolve a canonical instrument to each destination's native instrument and show contract size, tick size/value, volume minimum/step, currency, expiration and allowed order types. Explicitly convert risk and units; do not silently round a fractional FX lot into integer units or copy one futures contract as one FX lot. Require confirmation of ambiguous mappings and block unsupported instruments. Preview planned quantity and estimated risk per account using destination metadata, with estimates labeled.

### 5. Broker protection and local automation must be separate concepts

Evidence: existing strategy risk is evaluated on the local tick decision path (`services/strategy_module/engine.py:1–11`) and dispatched as market exits (`order_dispatch.py:45–47`). The engine explicitly handles the case where risk fires without broker authorization and records that positions remain open (`engine.py:154–176`). These are honest recovery mechanisms, but they do not turn a local stop rule into a broker-held protective order. `ARCHITECTURE.md` adopts native broker-side SL/TP as a planned connector principle; that plan is not proof of implementation.

Recommendation: capability-gate native bracket/OCO/SL/TP in the new connector path and show confirmed broker protection separately from “Chartly-managed exit rule”. A local agent, backend crash, feed outage or expired session affects those two mechanisms differently. Display protective-order acknowledgement and failures per destination. Never reuse a visual stop line as proof that a broker protective order exists.

## Proposed monochrome execution wireframe

Keep execution optional. A journal user can ignore this entire surface.

1. **Connection setup:** account identity → authenticated/read-only connection → verified capabilities/instrument metadata → optional execution permission. Show terminal/bridge heartbeat and account identity from the actual connection, not a manually toggled “running” flag.
2. **Profile destination list:** Account | Connection | Instrument mapping | Sizing | Protection | Armed. Text states, not color alone. An account can be a data source without being an execution destination.
3. **Order preview:** intent and source instrument above; per-account rows show native symbol, quantity/unit, order type, price rounding, estimated risk, native protection and eligibility/error reason. Explicitly identify live vs demo vs local simulator.
4. **Activity drawer:** one parent intent expands to each destination's command and chronological acknowledgements/fills. Show partial success and unknown outcomes prominently, with reconciliation progress and a clear next action.
5. **Account reconciliation:** authoritative broker positions/orders versus Chartly expected state; explain divergences before enabling new copying after reconnect. An emergency action operates on an explicitly identified account scope and reports completion per account.
6. **Journal handoff:** append confirmed execution events once; preserve account/provenance IDs and partial fills; keep review annotations editable. Decide explicitly whether profile analytics show the master decision once or each copied account's financial result. Do not count a copied decision as several independent strategy observations without labeling it.

## Release acceptance criteria

- A profile's destination intent is resolved and authorized by the backend; query labels and browser switches cannot pick unauthorized accounts.
- Retrying the same intent cannot duplicate a destination order. Ambiguous network timeouts stay unknown until reconciled.
- Rejecting one destination produces a visible partial group outcome and no unrequested rollback trade elsewhere.
- Partial fill followed by cancellation survives reconnect/restart with correct remaining exposure and journal P&L.
- Symbol suffix collisions, fractional lot steps, expiry mismatches and incompatible product types block dispatch with actionable errors.
- Risk checks reserve outstanding exposure and enforce the intended baseline, session timezone and reset behavior.
- Confirmed broker-held protection remains distinguishable from local automation; unsupported protection cannot be represented as active.
- Disconnect/reconnect reconciles outstanding orders and positions before copying resumes; disabling copying does not falsely claim existing positions were closed.
- Replay-paper order intent can never enter the broker write path.
- Replayed duplicate execution events do not duplicate journal records or performance totals.

## What to preserve

Default-off copying, account-off overriding destination settings, risk-change review, single-profile ownership checks, current configuration disclaimers, explicit live/sandbox routing and the strategy module's acknowledgement/fill/recovery work are strong foundations. Build the user workflow on top of them. Defer delay/lot-noise/comment controls from the normal setup path until core correctness is complete; their presence adds complexity without completing connection, execution or journaling.

## Verification limits

Static source tracing and scoped repository searches only. No adapter conformance tests, live or demo broker submission, outage experiment or automated test run was performed for this report. Missing wiring describes the inspected profile destination path, not every specialized strategy or order subsystem in the repository.
