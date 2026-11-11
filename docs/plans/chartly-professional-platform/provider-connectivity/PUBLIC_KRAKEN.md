# W07 — bounded Kraken public candles

Plan written before implementation. Status: implemented with focused and actual-public-access evidence; root's integrated screen/package acceptance remains pending. Package owner: provider specialist, integrated review by root. This is public market data, not a private exchange-account connector or P08 completion. [Recorded verification](W07_EVIDENCE.md).

## Provider contract and limits

Kraken publishes public AssetPairs and OHLC endpoints. OHLC contains at most 720 recent entries; older entries cannot be recovered by changing `since`. The final entry represents an unfinished candle and must be excluded from immutable replay imports. Public WebSocket OHLC is a separate live-data capability, outside this finite import slice. [Official OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data), [public WebSocket OHLC](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ohlc).

The first slice supports only native intervals already accepted by the Data Library: 1m, 5m, 15m, 30m, 1h, 4h and D. Weekly/multiweek aggregation and inferred history are not added. Symbol discovery retains the provider's native pair identifier and explicit base/quote/display names. Price and volume text is parsed with exact finite decimals; volume describes base-asset units. Candle timestamps are provider UTC interval opens, separate from fetch receipt time.

## Steps and proof

1. Add fixed-origin bounded HTTP reads, no arbitrary URL, redirect, credential or supplied code. Bound response bytes, instrument count, search results and candle rows; normalize errors and Retry-After without an infinite retry loop. Responses close on success, error and oversized body.
2. Validate discovered pair status and identity. Reject unknown/mismatched response symbols, duplicate/conflicting timestamps, malformed/nonfinite economics, unsupported intervals and future closed candles. Never replace malformed data with zero.
3. Generate CSV, exact mapping and source context on the server. Exclude the unfinished final row. Record fetched-at time, native pair/interval, returned bounds, omitted unfinished row and the provider retention limit. An empty response produces no publishable version.
4. Create an ordinary owned Data Library preview, retaining structural quality/coverage and source provenance. The user reviews the preview, then uses the existing commit policy and immutable version path. Reopening/repreviewing a staged result does not refetch and silently change the reviewed source.
5. Add a source picker to the existing History & data surface. Search/select instrument → select supported interval → fetch preview → inspect actual coverage/quality → commit → open existing chart or return to replay setup. No account login/key form appears.
6. Prove owner/CSRF/revision isolation with actual local API routes and injected HTTP fixtures. Test incomplete/future/oversized/malformed/error responses, precision, excluded last candle, repeated commit, stale owner responses and chart/replay return links. Perform a separate real public access check and record redacted bounds and counts.

The existing chunk-download engine remains appropriate for providers that support historical windows. It must not invent deep Kraken backfill by repeatedly requesting an endpoint whose recent-history limit cannot satisfy those chunks.
