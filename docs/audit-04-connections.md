# Review 04 — Connections, market data and desktop platforms

Date: 2 November 2026. Method: read-only source inspection. No broker authentication, live orders, credentials, new accounts or terminal launches were attempted. Recommendations below are design proposals, not implemented behavior. Parent audit separately inspected the running UI.

## Verdict

The new profile Connections surface is a useful configuration model, not a connector implementation. Existing broker infrastructure is real, but it belongs to the older API-key/broker architecture. These two systems must be joined through an explicit account-aware backend before profile configuration can determine the chart feed, execution account, synchronized journal or protection state.

## What is already good

- Accounts are reusable identities; terminals and per-profile execution destinations are represented separately (`frontend/src/lib/trader/db.ts:134`, `:152`, `:168`). Browser records contain a secret reference field rather than a password field.
- New destinations default to copying off (`frontend/src/lib/trader/profileModel.ts:183`). Disabling an account pauses copying across its destinations (`frontend/src/lib/trader/useTraderData.ts:239`).
- Account ownership conflicts across armed profiles are checked transactionally (`frontend/src/lib/trader/useTraderData.ts:330`; `frontend/src/lib/trader/profileModel.ts:134`).
- Risk-increasing setting changes have an explicit classification helper (`frontend/src/lib/trader/profileModel.ts:89`), and destination fields receive basic validation (`:49`). This is a useful foundation for a later execution preflight.
- The page clearly discloses its configuration status (`frontend/src/pages/workspace/TraderConnections.tsx:598`). That honest disclosure should remain while the system is incomplete.

## Five highest-priority gaps

### 1. Configuration state is presented with operational words

Evidence: `TraderConnections.tsx:188` shows “Copy on/off”; `:754` shows terminal “On/Off”; `:770` updates `running` and `lastSeenAt` directly from a browser switch. `useTraderData.ts:274` and `:284` only write IndexedDB terminal records. `profileModel.ts:43` defines active copying as a configuration flag plus account enabled status; it does not require a bridge heartbeat, authenticated session, capabilities or broker acknowledgement. `TraderConnections.tsx:598–600` explicitly says live orders and sync await a future phase.

Implication: users can configure an account, mark a terminal “On”, and see “Copy on” without any measured connectivity. The notice prevents a literal claim of implementation, but state labels still teach a false operational model.

Proposal: separate **Configured / Verified / Disconnected / Stale / Error** status from **Trading disabled / Ready / Armed** intent. A backend heartbeat should own observed terminal status. A user should never manufacture “last seen” by clicking a switch. Until real connectivity exists, say “Copying configured” and “Terminal registered”.

### 2. The selected chart source is attached to an execution destination

Evidence: `db.ts:175` stores `isChartDataSource` on `ProfileDestination`. `TraderConnections.tsx:419` resolves it from destinations and suppresses it when the broker account is disabled. `profileModel.ts:150` automatically assigns the first eligible destination as source. `TraderConnections.tsx:954` presents a selected source as the next step toward charting. In contrast, `Trading.tsx:901–923` obtains one global API key and WS URL, shared by all panes, without a profile-source lookup. `services/history_service.py:287–300` already distinguishes database history from broker API history, which is a useful lower-level seam.

Implication: the conceptual model makes data access depend on creating an execution destination, even for a user who only wants charts or offline replay. Selecting a source in Connections does not prove the chart uses that source.

Proposal: a first-class **Data connection** independent of **Execution account**. A profile chooses public/permitted feed, user-owned historical dataset, or broker-entitled feed. Trading can remain disabled while data stays active. Each chart displays the actual source, instrument identity, freshness and coverage. Missing history should lead to import/download/choose-source actions.

### 3. MT5/NinjaTrader support exists as a plan and schema, not an adapter

Evidence: `TraderConnections.tsx:52–60` lists MT5, NinjaTrader and TradeStation. `:734` explicitly calls discovery future work. `:471–478` registers paths and account IDs only. Repository searches for `MetaTrader5`, `import MetaTrader`, `NinjaTrader.Client`, canonical `PlaceOrderCommand` and `ExecutionEvent` returned no implementation in the inspected Python/C#/TypeScript source. The `broker/` directory contains existing Indian brokerage integrations and DeltaExchange; no MT5 or NinjaTrader adapter folder was present. `ARCHITECTURE.md:5–12` describes local-first adaptation and canonical schemas **to adopt**.

Implication: platform names should not be counted as supported integrations. A terminal path is not proof that its account, live data or trading permission is available.

Proposal: connector support registry distinguishing **Available / Preview / Planned** and capabilities per connector. Build one end-to-end local read-only adapter first: bind terminal → verify account identity → load available symbols → fetch bars/history → sync fills → reconcile journal. Add demo execution only after that loop works. Parent should use current vendor documentation to verify platform-specific transport and restrictions; this review does not assert those from memory.

### 4. Global broker services do not consume profile destination IDs

Evidence: `services/place_order_service.py:27–39` dynamically imports broker modules; `:203–221` calls one broker's `place_order_api`; `:367–381` resolves a broker through API key or explicit token/broker. `services/history_service.py:312–325` follows the same pattern for history. New browser accounts and destinations are saved through `useTraderData.ts:211–220` and `:309–357`. No connection from these IndexedDB identities to the service calls was found in this scope. `frontend/src/stores/brokerStore.ts:3–8` is a global broker manifest with exchange/leverage fields, not per-account execution capabilities.

Implication: profile destinations cannot yet be treated as multi-account order routes. Receiving prices from one account does not establish authority, instrument equivalence or reliable execution on another.

Proposal: backend-owned connection/account IDs; canonical instrument mapping; adapter-specific quantity/tick/lot constraints; idempotent command and event correlation; per-account capability manifest; acknowledged order/fill states. A copy preview should show actual destination symbol, quantity, estimated risk, supported protection and per-account outcome. Reconnect reconciliation must distinguish already-sent commands from new commands.

### 5. Risk UI is ahead of measurable risk enforcement and overcomplicates setup

Evidence: `TraderConnections.tsx:274–290` exposes flat/equity-ratio/smart sizing, unlimited caps when zero, while `profileModel.ts:49–85` only validates values. `:298–310` exposes randomized delay and lot noise and correctly warns about account rules. `db.ts:174–200` stores risk preferences, not observed equity, drawdown basis, symbol contract metadata or a guard enforcement acknowledgement. `isDestinationCopyActive` does not consult these.

Implication: a checked drawdown guard cannot currently protect an account; “smart” sizing has no visible calculable contract. Advanced behavior creates cognitive load before the trader has verified a connection.

Proposal: start with one instrument, fixed valid size, account identity, current status, native protection capability and explicit armed state. Put advanced policies behind a later section. Show guard status as **Not implemented / Configured / Enforced / Triggered**, with basis, reset time and action. Do not label a configured cap as active protection. Delay/noise should not be a core product proposition.

## Proposed connection wireframe and journey

1. **Choose purpose:** “Get chart data”, “Import trade history”, or “Enable execution”. These purposes can share one verified connector but must remain separate permissions/capabilities.
2. **Choose source/platform:** list only implemented connections as connectable. Keep planned platforms visibly unavailable. Offer local historical data for practice without an execution account.
3. **Verify:** backend discovers terminal or authenticates an API; displays platform, masked account identity, demo/live flag, available markets, current connection and last observed event. A manual identity entry is labelled registration, not connection.
4. **Choose data for this profile:** source, symbol mapping, timeframe coverage, freshness and storage availability. “Open chart” is enabled when chart data is ready, regardless of trading being disabled.
5. **Optional destinations:** select verified accounts, review per-account size/risk/protection and instrument mapping. Save paused. Simulate the fan-out before live arming.
6. **Operate and recover:** compact profile banner shows “Data ready · 2 of 3 accounts ready · trading paused”. Errors have one clear action: reconnect, fix mapping, refresh history or reconcile fills.

Suggested page composition: top connection summary with measured states; main data-source panel; execution destination list; expandable advanced controls; activity/reconciliation log. Reusable account and terminal management belongs in a separate connection library reachable from this page, rather than requiring every beginner to understand three entity types immediately.

## Acceptance gates

- A data-only user opens a populated chart without registering a copying destination.
- Switching profile data changes the actual history/stream provider and visible source label.
- Stopping a terminal produces a measured stale/disconnected state; the browser cannot set observed health.
- Read-only history sync creates deduplicated journal records with account and external-fill provenance.
- A demo account route accepts one explicit command and displays broker-acknowledged status; retries do not duplicate execution.
- Multi-account preview shows equivalent instrument/size or blocks unsupported mappings; one failed destination has a clear reconciliable outcome.
- Configured risk is never presented as enforced risk before a backend confirms enforcement.

No automated tests were run by this review. Existing model tests are in `frontend/src/lib/trader/profileModel.test.ts`; passing configuration tests cannot establish real connector functionality.
