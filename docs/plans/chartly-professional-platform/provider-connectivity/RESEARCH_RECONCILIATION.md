# Research.txt reconciliation

Reviewed 3 November 2026. The user-supplied desktop document is useful scope input. It does not replace the accepted product workflow, existing code/P01 contracts or provider-specific evidence.

## Retained direction

Separate market data from account/history/execution; support user-chosen brokerages, crypto exchanges and desktop platforms; retain explicit capabilities and native symbol/quantity mapping; bind credentials and data to the actual owner/account; keep native risk/protection semantics explicit. These fit the current local application and existing package order.

## Corrections that affect implementation

- A public API is not unlimited historical data. Kraken's recent OHLC endpoint has a 720-entry limit and an unfinished final candle. [Official constraint](https://docs.kraken.com/api-reference/market-data/get-ohlc-data).
- A retail IBKR Web API connection currently starts with the local Client Portal Gateway; institutional/third-party onboarding is separate. Generic cloud OAuth cannot be promised to every retail user. [Current IBKR documentation](https://www.interactivebrokers.com/docs/web-api/getting-started).
- cTrader supports a specific view-only OAuth scope. A journal importer should request `accounts`, not default to full `trading` access. Demo access and its historical quota are documented separately. [Authentication](https://help.ctrader.com/open-api/account-authentication/), [getting started](https://help.ctrader.com/open-api/).
- Topstep currently restricts order transmission to the personal device, allows certain read-only remote support work, offers Practice instead of a separate sandbox and does not allow Live Funded API trading. A general remote order gateway would conflict with the documented scope. [Current Topstep API guide](https://help.topstep.com/en/articles/11187768-topstepx-api-access).
- ProjectX's own notice describes winding down third-party service for most partners through 28 February 2026. That does not prove every broad exclusivity or market-share claim in Research.txt. [ProjectX notice](https://www.projectx.com/index.html).
- Provider account access, market-data entitlements and platform tenant permissions must be checked independently. A local NT8 bridge is not blanket authorization for every prop account or feed. Public crypto endpoints also have quotas, retention and product/jurisdiction differences.
- API paper/demo environments differ. Alpaca paper has its own credentials/feed limitations; Bybit demo is distinct from testnet and lacks some API functionality; TradeStation SIM still needs an account/key. [Alpaca](https://docs.alpaca.markets/us/docs/paper-trading), [Bybit](https://bybit-exchange.github.io/docs/v5/demo), [TradeStation](https://api.tradestation.com/docs/faq/).

## Not adopted

The proposed replacement frontend/chart, cloud gateway, PostgreSQL/Redis/ClickHouse topology, cloud KMS custody and universal companion-agent deployment are not requirements for this local-first follow-up. Their adoption would need a separate justified architecture decision. Existing canonical contracts are not replaced by the document's example JSON schemas.

Unattributed market-size/adoption/latency figures and blanket regulatory conclusions are not accepted as verified facts. Being a technology interface does not itself settle every jurisdiction's legal obligations or grant market-data redistribution rights. No account is connected, credential requested, commercial subscription purchased or order placed by this documentation.
