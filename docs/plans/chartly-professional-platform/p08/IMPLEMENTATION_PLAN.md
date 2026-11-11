# P08 implementation plan

Written 4 November 2026 (P08-T01). Owner package: [P08 crypto exchanges](../08-crypto-exchanges.md).
First adapter: [Kraken spot subplan](adapters/kraken-spot.md). P00-P07 are
complete within their recorded scopes; this package starts from the P07
connector framework as-is. Checkboxes in the P08 plan move only against
recorded evidence in this folder.

## Starting seams (verified in source, 4 Nov 2026)

- Registry/lifecycle/vault/history-merge/conformance exist and are
  provider-agnostic: `services/connectors.py`, `services/connector_vault.py`,
  `services/connector_history.py`, `services/connector_conformance.py`,
  adapter factory in `services/connector_adapters.py`.
- Public Kraken data exists separately: `services/kraken_market.py`
  (Data Library preview) and the `kraken-public` catalog probe. Neither is
  a private account adapter.
- Journal projection accepts only confirmed closed `normalizedTrade` rows
  via `services/journal_import.py`; the MT5 adapter emits raw observations
  only, so Kraken is the first real end-to-end journal projection.
- Frontend `ConnectorPanel` gives any `connectionMode: "account"` provider
  create/probe/link/sync, but there is no secret-entry UI yet
  (`connectorClient.ts` has no `set-secret` action).
- Legacy `broker/` plugins (incl. Delta) use floats and a global session;
  nothing from them is reused for accounting.

## Task sequence

- **T01 (this document + Kraken subplan):** official-evidence subplan,
  environment truth (no spot sandbox), credential/permission model,
  rate limits, unresolved probes U2-U6. Done when this folder is linked
  from the P08 plan.
- **T02 credentials + read-only ingestion:** new
  `services/connector_kraken.py` (signing with the published test vector,
  persisted monotonic nonce, exact-text JSON decoding, fixed-origin
  bounded HTTP); branches in `connector_adapters.py`
  (`describe_provider`/`normalize_configuration`/`get_adapter`/`provider_catalog`);
  probe = Time + Balance with key-scoped identity; history = cursor-paged
  TradesHistory/ClosedOrders/Ledgers mapped to connector events; frontend
  `set-secret` action + apiKey/apiSecret form in the existing panel.
  Fixture tests first; Phase B real-key acceptance when the user supplies
  a read-only key (blocker named in the subplan).
- **T03 instrument mapping + validation:** AssetPairs/WS-instrument to
  canonical Instrument/Listing (tick, step, ordermin, costmin, status,
  XBT/BTC aliasing); a pure pre-trade validator (pure function, reused by
  P11 later). No order is submitted anywhere in P08.
- **T04 streams:** WS v2 public freshness for the chart plus private
  executions/balances as observation sources, with the subplan's
  reconnect/snapshot/checksum rules and an owner-leakage test. Scope is
  confirmed against P05 chart seams before coding; REST remains the
  history authority.
- **T05 spot order lifecycle:** depends on P11 (durable commands,
  unknown-outcome reconciliation). Recorded here as blocked-by-P11; P08
  does not implement submission. `validate=true` probing is a P11 task.
- **T06 journal reconciliation:** closed-trade `normalizedTrade` rows
  (single quote currency per book), fee handling, deposits/withdrawals as
  cashflows outside PnL, correction flow through the existing review
  path. Ends with the conformance suite passing against the adapter.
- **T07 derivatives:** separate subplan required (Kraken Futures demo was
  decommissioned; Bybit/OKX have their own demo paths per CRYPTO.md).
  Not started by this plan; no spot code is stretched to cover it.
- **T08 certification:** Kraken spot accepted at read-only-verified with
  published coverage/limits (pairs scope, 7d sync windows, measured
  retention, one-quote-currency projection limit). Coinbase and Binance
  each get their own subplan and repeat T02-T06/T08; nothing about them
  is claimed by Kraken's evidence.

## Gates per task

Same as P01-P07: focused backend tests, affected frontend tests,
typecheck/build/lint for touched frontend files, connector conformance
where applicable, evidence file per accepted slice
(`p08/IMPLEMENTATION_EVIDENCE.md` on package acceptance), and the master
checkbox only after package acceptance. Backend test invocation in this
environment: `.venv\Scripts\python.exe -m pytest <files> -q -p no:cacheprovider --basetemp=tmp\<name>`.

## Progress log

- 2026-11-04, T01 complete: subplan + this plan (user confirmed: start
  fresh, Kraken first). Baseline before coding: existing Kraken public
  tests 27/27 pass ([log](evidence/t01-baseline-kraken-public-tests.log)).
- 2026-11-04, T02 backend slice implemented (task stays open):
  `services/connector_kraken.py` (official signing vector, monotonic
  microsecond nonce, exact-text JSON decoding, bounded fixed-origin
  transport, Balance/TradesHistory/ClosedOrders/Ledgers cursor paging,
  key-scoped identity, per-call server-clock verification) wired into
  `services/connector_adapters.py` as provider `kraken`
  (accountRead/accountHistory only; order capabilities unsupported).
  Events merge idempotently through `connector_history`. Tests:
  `test/test_connector_kraken.py` 18/18 ([log](evidence/t02-kraken-adapter-tests.log));
  adapter regression incl. intentional catalog-set update 54/54
  ([log](evidence/t02-adapter-regression-tests.log)); wider connector
  suite 137 tests with only that catalog assertion changed. Ruff is
  declared in pyproject but no ruff/uv binary is available in this
  environment; `py_compile` passes (lint rerun still owed).
  Still open in T02: frontend `set-secret` form, conformance run against
  the adapter, and Phase B acceptance with the user's real read-only key.

- 2026-11-04, T02 complete (fixture scope) and T03 complete: frontend
  secret entry (non-retained `set-secret` path, Kraken read-only guidance
  at the point of use, Verify gated on a stored credential), structural
  conformance evaluation passing over injected adapter fixtures, and
  `services/kraken_instruments.py` canonical mapping + pure pre-trade
  validator. Frontend: 33/33 focused tests, Biome clean, production
  build passes. Backend combined Kraken/connector suite: 175/175
  ([log](evidence/t02-t03-backend-tests.log)). Live Phase A check:
  1,276 real AssetPairs mapped to valid canonical records, 194 skipped
  with explicit reasons (125 not online, 63 canonical-pattern limits such
  as two-letter asset codes, 6 identity) - [log](evidence/t03-live-assetpairs-check.log).
  Two live-found bugs fixed with regression tests: quantity step now
  honours lot_multiplier, and observed times are normalised to canonical
  millisecond instants (microsecond clock values initially invalidated
  every live record).

- 2026-11-04, T04 complete (protocol scope) and T06 complete:
  `services/kraken_streams.py` (official CRC32 vector 3310070434, live
  public ticker+book verified against the real feed, sequence/freshness
  trackers, private executions/balances decoders) and
  `services/kraken_journal.py` (exact FIFO closed-trade derivation with
  pre-window context replay, wired into `history()`; derived rows pass
  the real journal normalizer end to end). Stage gate: 202/202 backend
  tests across Kraken/connector suites
  ([log](evidence/t04-t06-backend-tests.log),
  [live WS log](evidence/t04-live-public-ws-check.log)). FIFO correctly
  matched an in-window sell to a pre-window buy in tests. Remaining P08:
  T05 (blocked by P11), T07 (own derivatives subplan), T08 (Phase B with
  the user's read-only key, then repeat per exchange).

## Blockers and open inputs

1. Phase B real read-only Kraken key (user-supplied) for T02/T06/T08
   acceptance. Fixtures proceed without it.
2. T05 waits for P11; T07 waits for a derivatives subplan + test access.
3. Probes U2-U6 in the Kraken subplan resolve during T02/T04.
