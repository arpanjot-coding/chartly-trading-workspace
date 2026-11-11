# Zerodha brokerage access subplan

Owner: Chartly maintainers. Provider candidate `zerodha`, P07 framework version `p07-read-only-v1`. The existing legacy plugin remains separate. The P07 candidate reports unavailable authenticated access and cannot produce a fake account identity or elevated readiness. [Access summary](../evidence/provider-access-preflight.json).

An unauthenticated request to the documented profile endpoint returned HTTP 400. This proves endpoint reachability only. No private credential/account call was made and no brokerage account was verified. A permitted developer app, active account, provider login/2FA and registered callback are prerequisites for authenticated testing. [Official introduction](https://kite.trade/docs/connect/v3/) and [authentication/profile documentation](https://kite.trade/docs/connect/v3/user/) describe those requirements and the observed provider user identity. Refresh/session claims require actual provider approval and evidence; they must not be inferred from the existing app's global broker key.

The documented [orders and trades surface](https://kite.trade/docs/connect/v3/orders/) exposes daily orders/executions. Its daily trade response cannot certify long-history backfill or complete lifetime journal coverage. P10 must pin native products, symbols/units, session/quotas, actual account grants, historical availability and reconciliation before promoting support. Account read/history must remain independent of order authority.

This is a recorded blocked access spike, not an authenticated or demo-execution certificate. Do not reuse synthetic diagnostic evidence for this provider. No key, token, private identity or account activity is included in this document.
