# Derivatives subplan (P08-T07) — fixture-scope model, 2026-11-05

## Decision

Derivatives are modelled, not traded. `services/derivative_contracts.py`
maps venue perpetual-contract metadata into one canonical record and
provides pure validators (leverage, margin mode, position mode,
reduce-only). No derivative order can be submitted from anywhere in
the app: dispatch remains behind the P11 execution core and per-venue
Phase-B certification, and the UI exposes no derivative trading
controls (acceptance: "derivative controls appear only for
independently verified product support" — satisfied negatively until
a venue certifies).

## Canonical contract record

`venue, nativeSymbol, kind=perp, settlement (linear|inverse),
baseAsset, quoteAsset, marginAsset, contractSize, quantityUnit
(base_asset|contracts), tickSize, quantityStep, minQuantity,
maxLeverage, fundingIntervalMinutes, expiryMs=null`. All economics
exact decimal text; floats rejected (fixture-verified).

- **Linear** (Binance USDT-M, Bybit linear, Hyperliquid USDC):
  sized in base-asset units, settles in margin asset.
- **Inverse** (Binance COIN-M, Bybit inverse): sized in contracts of
  `contractSize` quote units, settles in base asset. A row claiming
  inverse whose margin asset is not the base asset is refused
  (`derivative.not_inverse`). Linear and inverse are never converted
  into each other.
- Binance max leverage is account-bracket scoped, so records carry
  `maxLeverage: null, maxLeverageSource: "account-brackets"` instead
  of an invented number. Bybit/Hyperliquid publish per-contract
  maxima; non-integral maxima (risk-tier fractions) are skipped with
  `derivative.invalid_leverage` rather than rounded.
- Hyperliquid meta has no price tick; rows are skipped with
  `derivative.tick_unavailable_from_meta` unless the caller enriches
  them from the live book. No tick is ever invented.

## Funding, margin, position mode, reduce-only

- `funding_observation(...)` records funding in the asset actually
  paid (third-currency funding stays unconverted), flagged
  `affectsTradingPnl: False` — same separation as deposits (T06).
- Margin modes: `cross | isolated` only. Position modes: `net`
  (one-way, single side per symbol) vs `hedge` (long+short coexist);
  `position_mode_allows` enforces the net rule purely.
- `check_reduce_only` refuses any intent that would grow or flip a
  position, including from flat; returns the exact resulting signed
  quantity text.
- `check_leverage` refuses leverage above a contract's verified max.

## Live verification (2026-11-05, public endpoints, this machine)

- Binance USDT-M: 682 perpetuals mapped, 21 skipped with reasons;
  BTCUSDT tick 0.10, step 0.001, linear.
- Binance COIN-M: 20 mapped, 0 skipped; BTCUSD_PERP contractSize 100,
  margin BTC, inverse.
- Bybit linear: 837 mapped, 90 skipped (40 non-perp contract types,
  37 non-integral leverage maxima, 13 asset-code rejects); BTC
  maxLeverage 125. Inverse: 22 mapped, 4 skipped; BTC maxLeverage 100.
- Hyperliquid meta: 235 rows all skipped `tick_unavailable_from_meta`
  by design; tick-enriched BTC maps with step 0.00001, maxLeverage 40.
- Fixture tests: `test/test_derivative_contracts.py` (10 passed)
  covering linear/inverse distinction, wrong-shape refusal, funding
  in third currency, leverage bound, reduce-only, net/hedge, float
  rejection.

## Explicit limits (what T07 does NOT claim)

- No funding-history ingestion (needs private keys — Phase B).
- No liquidation/mark-price modelling, no options, no dated futures.
- No derivative execution, margin changes, or leverage changes —
  those require P11 venue certification per venue (T05/T08 class).
- Feeds may carry perp candles for charts/replay (Hyperliquid feed,
  labelled `instrumentKind: perp`); that is market data, not trading.
