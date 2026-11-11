# P10 — brokerage account sequence

Brokerages are a provider category, not a Zerodha-specific route. Existing regional plugins remain compatibility code while each account-scoped integration proves its own authentication, permissions, identity, products and data entitlement.

## 1. Alpaca paper

Start with Trading API paper credentials and the distinct paper endpoint. An email-created paper-only account is available broadly; its market-data entitlement is limited to IEX rather than the complete consolidated US market. Do not confuse Trading API paper access with the different Broker API partner sandbox. [Paper prerequisites and simulation limits](https://docs.alpaca.markets/us/docs/paper-trading), [API families and authentication](https://docs.alpaca.markets/us/docs/authentication).

First implement account identity/currency, balances, positions, closed/native order and fill observations with pagination. Keep stock/option/crypto product capabilities explicit. Add entitled market data separately, recording feed identity and adjustments. Reconcile partial fills, fees, corporate actions, cancellations and activity events; paper results do not certify live fill quality. Prove owner/environment mismatch, key replacement, throttling and retry/restore. P11 later certifies individual native order/protection types in paper before any live account.

## 2. Interactive Brokers

For retail/individual Web API access, the current documented entry is Client Portal Gateway, a local Java program handling authenticated requests. Third-party institutional integration has a separate approval path; do not advertise generic cloud OAuth onboarding for every retail account. [Current official prerequisites](https://www.interactivebrokers.com/docs/web-api/getting-started).

Choose one first transport—local Web API Gateway or a separately planned TWS API—and test a permitted paper account. Record session/reauthentication requirements and data subscriptions. Discover actual accounts and contract IDs; do not map by ticker alone. Separate forex, equities, options and futures quantity/currency/expiry semantics. Account reporting/transactions and entitled market data need independent coverage. P11 must model order warnings/confirmations and uncertain outcomes explicitly, without blindly approving every warning.

## 3. TradeStation SIM

API access requires a TradeStation account/key; its official FAQ directs funded account holders to request that key. SIM uses a separate base URL and simulated accounts/fills. It is not a credential-free public paper service. [API key prerequisites](https://api.tradestation.com/docs/faq/), [SIM versus live](https://api.tradestation.com/docs/fundamentals/sim-vs-live/).

Implement OAuth/token lifecycle and account identity first, then read-only positions/orders/fills and entitled market history. Verify equity/option/futures native symbol mapping, session calendars, streaming reconnection and history pagination. Keep SIM environment immutable for the connection. Require a real SIM/key test before showing Connect as working. Later P11 tests do not infer live execution behavior from instant SIM fills.

## Further brokerages and regional reuse

Tradier, Schwab, tastytrade and other requested brokerages need an individual prerequisite/product/permission subplan when selected. Aggregators such as SnapTrade/Mesh are optional commercial dependencies with their own supported-account scope; they are not required for the free local baseline. Review existing Zerodha and other regional plugin code through the same account-scoped boundary rather than making users select a global broker to use local journals or public data.

## Shared acceptance

Every connection identifies exact account and environment before linking a book. Market data entitlement, account-read permission and execution permission remain separate. Tests cover OAuth state/redirect validation, refresh/revocation, account switches, option/futures contract identity, precise cashflow/fee handling, duplicate/reordered/corrected history, stale owner/configuration publication and credential-free restore. Certification records the actual provider, account type, products, supported OS/transport, test sample and remaining limitations. No unavailable credential or approval is replaced with synthetic success.
