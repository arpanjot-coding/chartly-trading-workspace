# Provider connectivity delivery plan

3 November 2026. This follows the [P07 workflow follow-up](../p07/CONNECTION_WORKFLOW_FOLLOWUP.md). It is a delivery plan, not a claim that listed providers already work. P08–P11 remain separate package gates. The existing local Flask/React application, chart, journal books, P01 contracts, Data Library and encrypted local vault remain the foundation.

## Initial inventory before W07

The P07 registry implements an MT5 read-only attachment, synthetic diagnostics, Kraken public server-time reachability and Zerodha access prerequisites. MT5 has measured account identity and bounded raw deal access; its provider UTC clock and general netting/hedging accounting remain unverified. Kraken server time alone supplies neither candles nor account history.

The `broker/` directory contains 37 legacy provider plugins, chiefly regional brokerages plus Delta Exchange. Those use the older broker-session/auth/API stack. They are reusable source code, not 37 certified account-scoped connections. In particular, Delta has public quote/depth/candle functions and private account/order functions, but reusing them requires review of identity, precision, timestamps, limits and owner isolation. Several market-data helpers convert values through floats/default zero; exact accounting cannot assume those outputs are lossless.

The current private Data Library accepts CSV and bundles, stores immutable versions and feeds the existing chart/replay. Its download adapter uses the current owner's legacy broker authentication and supports only `1m` and `D` through that bridge. It does not yet independently fetch every provider listed below. Existing MT5/NinjaTrader/TradeStation configuration labels are not working network adapters.

The subsequent W07 follow-up adds a real public Kraken source to that same Data Library. Its isolated actual-access result and focused verification are recorded in [W07 evidence](W07_EVIDENCE.md); this does not add private exchange accounts or complete P08.

## Ordered delivery

1. **Useful public data now:** implement the finite [Kraken closed-candle preview](PUBLIC_KRAKEN.md) in the existing Data Library. No exchange account or trading credential is needed. Actual returned coverage and the 720-entry provider limit are visible. This limited follow-up does not complete P08.
2. **P08 crypto:** [Kraken account history, Coinbase and Binance spot, then Bybit/OKX derivatives](CRYPTO.md). Separate public market data from private account events. Expand provider by provider after real read-only/demo evidence.
3. **P09 platforms:** [MT5 accounting/market-data verification, cTrader demo, NT8 AddOn and MT4 bridge](PLATFORMS.md). Desktop attachment and API access are different transports behind the same capability contracts. Hosted bridges are not required for this local application.
4. **P10 brokerages:** [Alpaca paper, IBKR local Gateway and TradeStation SIM](BROKERAGES.md), followed by requested providers with permitted access. Zerodha remains one regional option, not the definition of a brokerage.
5. **P11 execution:** separately certify order intent, exact quantity/tick/currency mapping, native protection, cancellation, partial fills and uncertain outcomes for each account/product/environment. A successful history connector never arms execution, copying or a bot.

## One understandable setup flow

Settings → Connections & Data contains Connections and History & data. A provider catalog groups Brokerages, Crypto exchanges and Desktop platforms; diagnostics stay in advanced tooling. Every provider exposes purpose, transport, setup state, prerequisites and measured capabilities. The UI offers only an action that actually exists:

- **Verify running terminal:** current MT5 read-only attachment.
- **Use market data:** an implemented public source opens the Data Library, retaining the original return path.
- **Connect read-only account:** implemented private API/OAuth with provider-specific required fields and scope.
- **View prerequisites:** a planned or access-blocked integration with no pretend Connect success.

Choose source → verify its actual data/account scope → review the intended profile/book or immutable data version → open journal/chart with return context. Public candles never create an invented account book. Manual books remain independent. Existing account records, terminal settings and copy preferences remain advanced configuration until their capability is actually implemented and verified.

## Completion rule for each provider

Before coding, record official endpoints, environment, products, authentication, permissions, data rights, pagination/retention and test prerequisites. Implement only static allowed destinations and versioned data contracts. Retain native identities, exact quantities/prices, source/receipt times, fees/funding/cashflows and explicit unknowns. Protect vault scope, token refresh/revocation, expected owner and request receipts.

Acceptance requires malformed-response, rate-limit, outage, duplicate/reorder/correction, wrong-account/environment, stale owner/configuration, rollback and restore tests; exact source-to-chart/book return paths; bounded resource measurements; and actual permitted public/demo/read-only access. Fixture results and prerequisites cannot substitute for unavailable private access. [Research corrections](RESEARCH_RECONCILIATION.md) explain why Research.txt is input rather than authority.
