# Web/cloud platform subplans (Path A) — status 4 Nov 2026

Companion to PLATFORM_SUBPLANS.md (Path B desktop bridges).

## TopstepX / ProjectX — adapter shipped (Phase A)

`services/connector_topstepx.py`: loginKey auth, account search
identity, open positions, trade history (voided excluded), contract
mapping with exact tick size/value. Phase B needs the user's
TopstepX API key. CME market data stays account-entitled — never
redistributed (spec rule 4.2 enforced by design: account-scoped
reads only).

## cTrader Open API — next Path A candidate

OAuth 2.0 app registration + Protobuf/JSON over TLS/WebSocket
(port 5036 JSON mode avoids protobuf codegen for v1). Unlocks
FTMO/FundedNext/Pepperstone/IC Markets without desktop installs.
Needs: Spotware Open API application (client id/secret) + a demo
cTrader account for certification. Volume units are cents-of-unit
in protobuf — mapping must convert explicitly at the adapter edge,
never inside accounting.

## TradeStation — subplan

OAuth 2.0 authorization-code with refresh tokens, REST v3 + NDJSON
streaming. Needs a registered TradeStation developer application and
a SIM account. Futures symbols (`@ES`, `@ESM26`) map at the adapter
edge. No adapter until app credentials exist.

## Interactive Brokers — subplan

Two paths: Client Portal Web API (local gateway + session) or the
newer OAuth Web API. Order warnings ("precautionary messages") must
be confirmed in sequence — the P11 unknown/reconcile model already
fits. Needs an IBKR account + gateway session for certification;
market data strictly per-user entitlement.

## Tradovate / Rithmic — via Path B

Direct Tradovate API needs vendor approval/paid add-on; Rithmic
needs conformance certification + CME licensing. Supported route
today: user runs NinjaTrader 8 locally (Tradovate/Rithmic connected
inside it) and the P09 bridge pattern applies — NinjaTrader AddOn
remains its own subplan (see PLATFORM_SUBPLANS.md). Both stay
`planned` in the connector catalog with these exact reasons.

## SnapTrade / aggregators — decision

Not adopted: per-user SaaS fees and weaker streaming; direct
adapters cover the named brokers. Revisit only if a named broker
has no direct API path.
