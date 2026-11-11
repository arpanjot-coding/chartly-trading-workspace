# Local historical paper-session API

P06, version 1. This API operates one owned historical account over a pinned immutable native dataset. It never calls a broker or matches live quotes. Authentication, local-account proof, CSRF and origin scoping are the same as the [local journal API](local-journal.md). Paper request bodies are limited to 128 KiB; responses are private/no-store. Unknown/duplicate fields and unsupported versions fail closed. [Detailed policy and implementation plan](../plans/chartly-professional-platform/p06/IMPLEMENTATION_PLAN.md).

## Read and mutate

`GET /api/local/v1/paper/session?originId=<origin>&runId=<integer>` returns `{session:null}` for an unprepared owned Draft, or its selected acknowledged session. An absent/foreign run is unavailable, never another account. Session includes revision/status, pinned config/manifest/checkpoint, UTC window/count/cursor/asOf, cash/equity/collateral/available, realized gross/fees/unrealized, orders/positions, recent 100 fills/events, compact report and paper-book/journal IDs. Routine workspace records contain only a server-owned `paper` marker; full ledgers stay in their own scoped table. Its exact decimal-text `startingCash`, when published from the pinned config, supplies that selected paper book's baseline and cannot be changed by generic table saves. Older summaries missing it show unavailable capital rather than use the profile/project balance.

`POST /api/local/v1/paper/action` accepts exactly:

```json
{
  "originId": "browser_origin_example",
  "runId": 1,
  "expectedRevision": 0,
  "requestId": "cmd_stable_reviewed_request",
  "action": "prepare",
  "payload": {}
}
```

Actions are `prepare`, `start`, `pause`, `advance`, `order`, `cancel`, `close`, `finish`, `branch`. `expectedRevision` is the paper-session revision, initially zero, independent of the workspace revision. Every command has a stable receipt. Successful replies contain `{session,workspace,receipt}`; use the returned workspace through the existing owned storage binding. A duplicate returns the committed receipt and latest owned account snapshot without executing twice. An uncertain response must retry the same complete body/ID. After a definite revision conflict, reload/review and explicitly resolve the retained command rather than generating another automatic submission.

Prepare payload is the reviewed config: `version:1`, `instrument:{symbol,exchange,interval,currency,quantityUnit,quantityStep,priceTick,multiplier,quantityScale,priceScale}`, decimal-text `startingCash`, `moneyScale`, `costs:{spreadTicks,slippageTicks,feeBps,feePerFill}`, `policy:{id:'native-ohlc-conservative-v1',gap:'next-observed'}`, and `seed:0`. The service derives `startTime` from actual saved data. Symbol/venue/native interval/currency must match the run and owned source. Quantity unit is `share`, `base_asset`, `contract` or `lot`; scales/ticks/steps/multiplier are explicit assumptions, not inferred from chart display precision. No FX conversion or universal derivative margin is supplied. Known execution prices and command quantities/prices must fit P03's 34-digit/18-decimal fact precision. Preparation rejects nonpositive/greater-than-10^18 prices, impossible calendar clocks, unsupported price basis and insufficient confirmed history.

Start/pause/finish have empty payloads. Advance payload is `{count:1..500}`. Order payload has `side:'buy'|'sell'`, `orderType:'market'|'limit'|'stop'`, decimal-text `quantity`, the required `limitPrice`/`stopPrice`, and optional `stopLoss`/`takeProfit`. Position-specific reductions have `positionId` and `reduceOnly:true`. Convenience close is `{positionId,quantity}` and queues a reduce-only market order for the next eligible event. Cancel is `{orderId}`. Neither a request price nor chart quote becomes fill authority; prices/fees/P&L/market events are server-derived.

Branch payload `{atIndex,name}` chooses an already acknowledged earlier native observation with at least one later event. It creates a new run/book with the same reviewed config and fresh starting cash at that observation's known close. Orders/positions/P&L are not copied. The old run remains intact. The reply's `session.runId` identifies the child and the receipt preserves that identity across retry/recovery.

## Matching, fidelity and finishing

Only a future observed native candle can execute a decision. The initial account is before the first available full candle. Market uses next open, stops use conservative gap/trigger prices, limits respect their cap, and execution costs/tick rounding are explicit. A same-candle stop/target ambiguity selects the protective stop; a new intrabar entry receives no favourable same-bar target assumption. Entry fees are immediately charged and journaled once; each exit adds only its exit costs. Cumulative gross rounding carries residues into later/final partial closes.

The account model is `linear-notional-collateral-v1`: one-times entry notional collateral on both sides; short proceeds are unavailable. It is not exchange margin certification. Missing candles are never invented; declared closures/missing/unknown gaps are recorded, with next-observed execution policy. Immutable incomplete candles do not become confirmed as wall time passes. Daily data requires a supported frozen calendar. No queue, volume-based partial fill, funding, swap, bid/ask history or tick-path accuracy is inferred from OHLC.

Finish cancels pending orders and retains marked open exposure. It never fabricates a closing fill at an already observed price. A zero-trade observation account may finish with its actual coverage and empty-sample ratios. Account-specific broker execution remains separate. Explicit historical markers, including nested basket/leg intents, are rejected at broker order ingress.

## Ledger, reports, comparison and recovery

- `GET /paper/ledger?originId=…&runId=…&offset=0&limit=100` pages immutable events, at most 500 per page.
- `GET /paper/report?originId=…&runId=…` returns `{report,sessionRecord}` for explicit data-only export, including all ledger/fills, assumptions, canonical RunManifest/Checkpoint/MetricResult adapters, coverage, sampled curve, exact tracked drawdown and state/report checksums.
- `GET /paper/compare?originId=…&profileId=…&runIds=1,2` compares at most twenty owned independent accounts. It returns individual reports, `combinedEquity:null`, `pooledMetrics:null` and no currency conversion. An independent branch is not sequential pooled equity.

Session ledger/checkpoint, marker, confirmed journal facts and receipt commit atomically. Restart has no auto-play or broker activation. The installed workspace backup module `paper-sessions` preserves complete state and receipt identities; old archives normalize an empty module. Owner-confirmed restore deliberately rebinds local canonical account/book/principal references, retaining engine state and source provenance. Candle bytes remain in separate P04 dataset bundles; verified aliases/checksums are required before resume. Paper-book JSON export includes matching paper records. [Journal/storage/report details](../plans/chartly-professional-platform/p06/JOURNAL_STORAGE_REPORTS.md).

Budgets include 50,000 native observations, 500 observations per advance, 200 simultaneous active orders/positions, 5,000 order/command identities, 10,000 fills, 40,000 ledger events and a sampled curve capped at 2,048 points. Engine state and per-origin record bytes are bounded; exact budgets and measurements are in package evidence. This local API accepts data only, never supplied executable strategies. P21 owns automated experiment jobs and a separately supported adapter.
