# P08 — crypto exchange sequence

All stages begin with market data and read-only account history. Execution requires P11 certification. Public availability is distinct from permitted access in the user's jurisdiction and account/product entitlements.

## 1. Kraken spot

First deliver [W07 public closed candles](PUBLIC_KRAKEN.md). Then add a distinct private source with user-supplied view/history permissions, encrypted owner-bound credentials, actual account identity, balances, native fills, fees and ledger cashflows. Preserve trade/order/ledger identifiers and pagination; a fill is not automatically a closed position. Reconcile corrections and incomplete coverage before journal publication. Required proof: real permitted read-only account, expired/revoked/wrong-permission keys, duplicate/reordered history and cashflow/fee fixtures. Private endpoints and permissions must be verified in a dedicated adapter subplan before implementation. [Kraken account endpoints](https://docs.kraken.com/api-reference/account-data/get-trades-history).

## 2. Coinbase Advanced Trade

Implement public product/candle data, then a private portfolio-scoped account reader. Public and authenticated methods share the API family, but private methods require their documented authentication; do not infer an authenticated account from public prices. Account selection must preserve portfolio scope rather than merging all portfolios into one book. Validate candles, fills, commission, pagination, token/key expiry and partial fills separately. Obtain the user's permitted account access before claiming private verification. [REST endpoint separation](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api), [portfolio scope](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/guides/portfolios).

## 3. Binance spot

Add public instruments/filters/candles and then authenticated read-only account/trade history. Regional products/endpoints are explicit adapter variants, not a user-entered base URL or interchangeable credential environment. Preserve tick/step/minimum-notional filters and quote/base quantity distinctions. Test request-weight throttling, timestamp/nonce rejection, pagination and delisted instruments. Derivatives are a later model with funding, contract multiplier and position-mode rules. [Official spot market endpoints](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints).

## 4. Bybit and OKX

Use separate demo credentials/environment, then prove read-only account identity, instrument economics and history before derivatives reporting. Funding, margin, fees, liquidation and hedged/net positions need their own fixtures; spot bookkeeping cannot be reused blindly. Bybit demo has a distinct account/user ID and incomplete API coverage; public streams use the main public service while demo private streams are separate. It is not interchangeable with testnet. [Bybit demo limitations](https://bybit-exchange.github.io/docs/v5/demo), [OKX API/demo reference](https://www.okx.com/docs-v5/en/#overview-demo-trading-services).

## Later coverage and common gate

Evaluate Delta Exchange legacy code as a reuse candidate with a new scoped/conformance wrapper. Bitget and Hyperliquid follow concrete user demand and their own access/product/subaccount/signing review; no integration exists merely because a general-purpose library lists the exchange. A unified library may reduce transport work but does not certify permissions, accounting, rate limits or instrument semantics.

Each provider records product/environment coverage, exact decimal mapping, private account identity, retention windows, pagination, stale/reconnect behavior, public/demo evidence and explicit unsupported cases. Store withdrawal/transfer permissions as unsupported; do not enable financial dispatch through a read-only importer. Revalidate provider terms and data usage before release.
