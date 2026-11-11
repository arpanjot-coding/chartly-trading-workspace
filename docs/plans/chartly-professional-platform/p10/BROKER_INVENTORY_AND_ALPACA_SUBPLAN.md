# P10-T01/T02 — Broker inventory and Alpaca Paper subplan

Decided 4 November 2026.

## Inventory of existing adapters (T01)

The legacy `broker/` tree ships 37 OpenAlgo-heritage Indian broker
plugins (zerodha, fyers, dhan + dhan_sandbox, upstox, angel, kotak,
etc.). Honest assessment for this programme:

- Access: nearly all require a live funded account plus daily
  OAuth/TOTP token ceremonies; none can be certified read-only from
  this machine today. `dhan_sandbox` is the only demo-flavoured entry
  and still needs issued sandbox credentials.
- Maintenance/coverage vary by plugin; they target the legacy order
  routes, not the P07 account-binding contract, so each needs its own
  subplan + certification before any support claim (the connector
  catalog already lists them as `planned`/prerequisites).
- Testability: no fixture suites exist per plugin in the P07 sense.

## Initial representative: Alpaca Paper (T02)

Chosen because it is a real issued-credential demo: free paper
accounts, long-lived API key pair (no daily login ceremony), stable
official REST API, US equities. Subplan:

- Auth: `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY` headers; keys are
  stored through the existing encrypted connector-secret path and are
  account-scoped (paper vs live keys are distinct at Alpaca).
- Token lifecycle: static until user-regenerated at Alpaca; identity
  is the `account_number` from `GET /v2/account`, so key rotation
  keeps the same binding and a different account's keys fail the
  identity check instead of silently rebinding.
- Account selection: exactly one paper account per key pair; the live
  base URL (`api.alpaca.markets`) is refused by construction in this
  package.
- Reads (T03): `/v2/account`, `/v2/positions`,
  `/v2/account/activities` (FILL + cash types incl. dividends — the
  corporate-action cash record; split *share* adjustments arrive as
  activities and remain broker-native until reconciled, T07).
- Instruments (T04): `/v2/assets` mapping keeps native symbol,
  exchange, share units and fractional increments explicit.
- Data (T05): market data entitlement (IEX vs SIP, delayed vs
  real-time) is a *separate* probe; account access reports
  marketLive/marketHistory as `unknown`.
- Orders (T06): none here — P11 owns the demo order lifecycle incl.
  bracket/OTOCO native protection and Alpaca's warning responses.
- Statements (T07): activities are the broker statement feed; fills
  and cash events reconcile into the normalized ledger by
  `activity:` ids (idempotent re-sync). Dividends/fees affect cash
  and holdings research; only FILL rows create executions.

Phase B (user paper keys) certifies probe/history against the real
paper account, exactly like Kraken P08-T08. Per-broker support
levels (T08) are published by the connector catalog: alpaca-paper =
read-only implemented (fixture), legacy brokers = planned.
