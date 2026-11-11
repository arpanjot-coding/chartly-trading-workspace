# P09 — desktop and retail platforms

This sequence extends the existing application and P01 contracts. It does not require the hosted gateway, replacement chart or cloud credential custody proposed in Research.txt.

## 1. MetaTrader 5

Retain the existing selected-running-terminal read-only attachment. Extend terminal discovery with explicit selected paths and separate bounded workers per terminal only after its scope/resource plan is approved. Never log in, change account, select symbols or place orders merely to discover a connection.

Before claiming market-history support, resolve provider UTC alignment with verified evidence rather than subtracting an observed offset. Bind native symbol economics, quote/profit/account currencies, contract multiplier, volume step and tick. Before broad journal accounting, implement netting/hedging position identity, partial closes, reversals, commission/swap/fees and deposits/withdrawals as distinct facts. Verify repeated/reordered/corrected history and terminal/account switches. Existing raw receipt-only observations remain valid provenance without being relabelled as UTC-aligned executions. [Current adapter evidence](../p07/adapters/mt5.md), [official Python integration](https://www.mql5.com/en/docs/python_metatrader5).

## 2. cTrader Open API

Create a provider application and valid redirect, then use a demo account and OAuth `accounts` scope for view-only access. The separate `trading` scope is not requested by a journal importer. Authorize each actual account after application authentication; newly created accounts require renewed user authorization. Bind broker/server, native account ID, environment, deposit currency and symbol/volume scale.

Implement bounded history and reconnect/token refresh with old-owner/configuration fences; keep secrets out of callback logs. Verify fills/positions, candle UTC/intervals and the documented separate historical rate limit before display or publication. [Authentication/scopes](https://help.ctrader.com/open-api/account-authentication/), [demo and limits](https://help.ctrader.com/open-api/).

## 3. NinjaTrader 8

Build a small C# NinjaScript AddOn proof against an authorized running desktop and simulation account. Use account/order/execution/position events for read-only observations and the documented historical bars interface where entitled. A local bridge requires bounded versioned messages, authenticated local pairing, explicit account selection, replay/simulation identity, native instrument/expiry/tick mapping and disconnect/backfill reconciliation.

Do not treat ATI order commands as a complete historical-account API or assume one installed terminal grants every underlying broker/data entitlement. Validate the actual connected feed and its historical coverage. Futures rollovers, ATM strategy semantics and execution stay separate later work. [AddOn/account/data API](https://developer.ninjatrader.com/docs/desktop/add_on), [data connection requirements](https://ninjatrader.com/support/helpguides/nt8/connecting.htm).

## 4. MetaTrader 4

No bridge exists in this repository. Prototype a minimal read-only MQL4 EA/script export or authenticated local channel with a demo account. Review terminal permissions and queue ownership explicitly. WebRequest is synchronous, requires URL allowlisting and cannot run in Strategy Tester; offline fixtures are needed for reproducible bridge tests. Reconcile MT4 ticket/order history and costs before claiming closed-trade accounting. [Official MQL4 WebRequest constraints](https://docs.mql4.com/common/webrequest).

## Conditional futures/prop platforms

Tradovate requires its permitted API/account/data access and separate endpoint/environment checks. TopstepX requires its own subscription/link/key and currently provides Practice accounts rather than a separate sandbox. Its published policy distinguishes allowed remote read-only analytics from prohibited remote order routing, and excludes Live Funded API trading. Build no generic hosted execution route from Research.txt. Confirm the exact product/account policy again before integration. [Topstep API access](https://help.topstep.com/en/articles/11187768-topstepx-api-access), [ProjectX authentication](https://gateway.docs.projectx.com/docs/getting-started/authenticate/authenticate-api-key/).

Tenant-controlled platforms such as DXtrade, Match-Trader and TradeLocker require verified end-user API permission for the specific firm, not merely a vendor API brochure. Treat access as prerequisites until demonstrated; never use desktop bridging to evade a provider restriction.
