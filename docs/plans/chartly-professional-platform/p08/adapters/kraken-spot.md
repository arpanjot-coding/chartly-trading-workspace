# P08 adapter subplan: Kraken spot (private account, read-only first)

Status: T01 subplan. Written before implementation, 4 November 2026. This
document grants no capability. It follows the
[adapter subplan template](../../p07/adapters/SUBPLAN_TEMPLATE.md) and the
[P08 crypto sequence](../../provider-connectivity/CRYPTO.md). Public Kraken
candles already shipped as W07 are a separate Data Library source and are not
this adapter.

## Identity, ownership and version

- Provider ID: `kraken` (private account). The existing `kraken-public`
  catalog entry stays data-only and unchanged.
- Adapter version (to implement): `p08-kraken-spot-v1`. Family: crypto
  exchange, cash spot only.
- Upstream: Kraken Spot REST `/0/public` + `/0/private` and Spot WebSocket
  v2. Official documentation retrieved 4 November 2026 from
  `docs.kraken.com` / `support.kraken.com` (links inline below).
- Transport: fixed origins only - `https://api.kraken.com/0/` REST,
  `wss://ws.kraken.com/v2` public, `wss://ws-auth.kraken.com/v2` private.
  No user-entered base URL, no redirects.
- Account identity: Kraken's API exposes no stable numeric account ID. The
  observed identity is therefore key-scoped: `externalId` = fingerprint of
  the public API key (hash, never the key itself), `server` =
  `api.kraken.com`, `environment` = `broker_live` (the only spot
  environment that exists, see test access). Consequences: one API key maps
  to one connection and one linked book; two keys for the same underlying
  Kraken account are two identities and must not both link to one book
  (ambiguity is surfaced, not merged). User-confirmed label is display only.
- Wallet scope: primary spot wallet only. Earn/staking/tokenized balance
  suffixes (`.B/.F/.S/.M/.T`) are observed and reported, never traded or
  journaled as positions.

## Test access and authority

- **There is no official Kraken spot sandbox or demo.** Both production and
  "beta" WebSocket endpoints run on the production engine; the only API
  testing-environment article is derivatives-only and its public demo was
  decommissioned. Sources: [WS introduction](https://docs.kraken.com/exchange/guides/websockets/introduction),
  [API testing environment (Derivatives)](https://support.kraken.com/articles/360024809011-api-testing-environment-derivatives).
- Evidence phases, in order. Each phase's evidence class is recorded
  separately; a later phase never borrows an earlier phase's claim.
  - **Phase A (public-only, no account):** server time, AssetPairs, WS
    public channels, book checksum, heartbeat/status behaviour.
  - **Phase B (authenticated read-only):** the user's own Kraken account
    with a key restricted to `Query Funds`, `Query Open Orders & Trades`,
    `Query Closed Orders & Trades`, `Query Ledger Entries`, plus
    `Access WebSocket API` for T04. `Withdraw Funds`, `Deposit Funds`,
    `Create & Modify Orders`, `Cancel/Close Orders`, `Earn` and
    `Export Data` must be absent. IP restriction and key expiry are
    recommended at setup. [API key permissions](https://docs.kraken.com/exchange/guides/rest/api-keys).
  - **Phase C (execution):** not in P08. Order submission, cancel/amend and
    `validate=true` probing belong to P11 with a separate trading key.
- **Blocker (named):** Phase B acceptance requires the user's Kraken
  account and read-only key. Signing, mapping, pagination and journal
  projection are built and fixture-tested before that; fixture results are
  never presented as account verification.
- Credentials: stored only through the existing encrypted connector vault
  (`apiKey` + `apiSecret` fields, owner-bound, in-process `set-secret`
  only). Secrets never enter worker files, logs, fixtures, screenshots or
  this plan. Revocation/expiry surfaces as `EGeneral:Permission denied` or
  auth failure and degrades the connection; it never retries blindly.

## Supported operations and products (targets for this subplan)

| Capability | Target state | Notes |
|---|---|---|
| accountRead | read-only-verified (after Phase B) | Balance via `POST /0/private/Balance`, exact decimal strings. |
| accountHistory | read-only-verified (after Phase B) | TradesHistory + ClosedOrders + Ledgers, cursor paging. |
| marketHistory | unsupported here | Served by the existing `kraken-public` Data Library source. |
| marketLive | T04 decision below | WS public ticker/trade/ohlc for chart freshness; no entitlement implied. |
| orderSubmit / orderCancel / protectiveOrders | unsupported | P11 only. Conformance `no-order-dispatch` must keep passing. |
| researchRead | unsupported | No research dataset in this adapter. |

- Products: cash spot pairs with AssetPairs `status == online` at mapping
  time. Margin fields are informational; the adapter never sends leverage
  parameters. Margin trading, futures/perps, Earn and staking are separate
  subplans (T07 does not reuse this one).
- Symbol mapping: REST pairs use `altname`/`wsname` (for example `XBTUSD`,
  `XBT/USD`); WS v2 uses `BTC/USD`. Both spellings map to one canonical P01
  `Instrument` (base/quote explicit) with a `Listing` per venue symbol.
  Economics, from AssetPairs / WS `instrument`:
  `priceTick = tick_size`, `quantityStep = 10^-lot_decimals`,
  minimum quantity `ordermin` (base), minimum cost `costmin` (quote),
  `pair_decimals`/`cost_decimals`/`lot_decimals` bound display and input
  validation. Delisted or status-changed pairs keep their historical
  mapping; absence from a later AssetPairs response never rewrites history.
  [Tradable asset pairs](https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs),
  [WS instrument](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/instrument).
- Fees: per-fill `fee` values from TradesHistory are the accounting truth.
  AssetPairs `fees`/`fees_maker` are deprecated (always empty since
  Sep 2026) and must not be used; schedule display, if ever shown, comes
  from `TradeVolume`. [Trade volume](https://docs.kraken.com/api-reference/account-data/get-trade-volume).

## Time, history and reconciliation

- Clock: `GET /0/public/Time` gives unix seconds; WS v2 uses RFC3339 UTC;
  REST history windows use unix seconds. `occurredAt` is the provider event
  time, `receivedAt` is local receipt; the two are never conflated. Nonce
  generation needs a sane local clock (see signing).
- Signing (fixture-verified before any live call):
  `API-Sign = base64(HMAC-SHA512(path + SHA256(nonce + postdata), b64decode(secret)))`.
  Kraken publishes a worked test vector; the adapter's signer must
  reproduce it exactly in unit tests. Nonce is strictly increasing per key
  (unix-ms based, `max(now_ms, last+1)`), persisted per connection so a
  restart cannot reuse a nonce. [Authentication](https://docs.kraken.com/exchange/guides/rest/authentication).
- Pagination: cursor paging (`with_cursor`/`cursor`) for ClosedOrders,
  TradesHistory and Ledgers; `ofs` is deprecated and not implemented.
  Page sizes: 50 default (TradesHistory `limit` up to 100). History pages
  feed the existing connector history merge (max 200 events per adapter
  page) with the registry's <=7d sync windows and suggested-window overlap.
- Rate budget: private history calls are budgeted at **+4** counter cost
  (conservative; official docs disagree between +2 and +4 - unresolved
  probe U4 below) against a per-key counter of 15-20. The adapter paces
  requests, honours `EAPI:Rate limit exceeded` and `EService:Throttled`
  with bounded backoff, and never parallelises private history calls.
  [Rate limits](https://docs.kraken.com/exchange/guides/rest/ratelimits).
- Event identity: Kraken trade txid, order txid and ledger entry id are
  the `externalEventId`s (txid is unique across open and closed orders).
  Re-fetched history that changes a payload advances the connector
  revision/correction chain; absence from a page never deletes stored
  history. Coverage is `complete` only for windows actually returned;
  Kraken states no numeric API retention limit (probe U3), so deep-history
  completeness is never claimed from paging alone.
- Exactness: private JSON is decoded preserving numeric text
  (`parse_float`/`parse_int` to string form); floats never enter payloads,
  accounting or journal rows. Amounts beyond the P01/journal 18-fraction-
  digit bound fail closed as an explicit conflict on that event, never
  rounded. Raw provider strings are preserved in the observation payload.
- Journal projection (T06 seam, decided here): only confirmed closed
  `normalizedTrade` rows reach a book, per the existing connector
  projection. V1 supports **one quote currency per linked book** (chosen at
  link time) because the journal seam rejects rows whose currency differs
  from the account currency. Trades in other quote currencies, and trades
  whose fee is charged in a third currency, are stored as observations
  with an explicit unsupported-projection reason - never FX-converted,
  never silently dropped. Deposits/withdrawals/transfers from Ledgers are
  cashflow observations, kept separate from trading profit. A fill is not
  a closed position; position closure follows the journal's FIFO rules.

## Lifecycle and resources

- Probe: public Time + signed Balance; verifies key permissions
  behaviourally (a key missing a required permission fails the probe with
  the provider error recorded). Observed identity is immutable once
  linked (existing registry rule).
- Streams (T04): private token from `GetWebSocketsToken` (15-minute life,
  fresh token per connection, API key never sent over WS). Heartbeat
  about 1/sec when idle; 5s message-deadline; reconnect with exponential
  backoff and jitter (well under the ~150 attempts/10 min/IP limit);
  re-subscribe everything after reconnect and treat the new snapshot as
  authoritative - deltas are never merged across a gap. Book integrity is
  CRC32 (top-10); checksum failure forces resubscribe. Executions/balances
  `sequence` gaps force REST cross-check (`QueryOrders`/`OpenOrders`).
  Private stream data stays owner-scoped; a leakage test is required.
  [Reconnection](https://docs.kraken.com/exchange/guides/websockets/reconnection),
  [WS authentication](https://docs.kraken.com/exchange/guides/websockets/authentication).
- No hidden background polling: sync runs through the existing explicit
  connector actions and suggested windows. No order retry exists to blind.

## Acceptance and maintenance

Fixtures first (hand-authored from official docs, no real account data):

- Signing: published test vector; wrong-secret and tampered-body negatives.
- Decoding: Balance/TradesHistory/ClosedOrders/Ledgers sample shapes;
  duplicate keys, oversized body, non-JSON, provider `error` arrays.
- Pagination: multi-page cursor walks, duplicate/reordered pages, page
  re-delivery after correction, empty windows.
- Economics: precision/min-notional rejections from live-shaped
  AssetPairs; >18dp amounts fail closed; delisted pair history preserved.
- Journal: FIFO closure with quote-currency fee; third-currency fee and
  foreign-quote trades observed-not-projected; deposit/withdrawal kept
  out of PnL; repeat sync is idempotent (`repeat-read-deduplication`).
- Failure modes: rate-limit and throttled responses, nonce regression
  after restart, permission revocation mid-sync, clock skew, stale stream
  and reconnect, wrong-key/wrong-account link attempt, secret-redaction
  scan over logs and error payloads.

Actual-access checks: Phase A live public check (no account); Phase B
read-only account check once the user supplies a key (balances, bounded
history window, repeat sync, revoke key and observe degradation). The
adapter is accepted at **read-only-verified** only after Phase B plus the
existing connector conformance suite passes against it. Execution levels
stay unverified until P11. Recertification triggers: Kraken API/changelog
changes (cursor deprecations, fee-field changes), permission-model
changes, pair-economics changes, clock/pagination behaviour changes, or a
failed regression.

### Unresolved probes (resolve during implementation, record outcomes)

- U1: `validate=true` depth/response - P11 probe, out of P08 scope.
- U2: WS channel name `balance` vs `balances`, heartbeat automatic vs
  subscribe - resolve with a Phase A public connection.
- U3: API history retention depth before export is required - measure in
  Phase B; publish the measured bound, not an assumed one.
- U4: Private history counter cost +2 vs +4 - budget +4 until measured.
- U5: Whether `sequence` on executions/balances is strictly gapless -
  treat any non-increment as a gap regardless.
- U6: Live no-service jurisdiction list - read at setup-copy time from
  Kraken's licensed/regulated page; the app shows prerequisites, it does
  not geoblock on its own list.
