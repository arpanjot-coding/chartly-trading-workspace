# P20-T07 — Supported parity and known differences

Established 4 November 2026. Fixtures: `test/test_strategy_parity.py`.
Parity is claimed only where a fixture proves it; identical source text
alone never implies identical results across engines.

## Proven parity (chartly-rules-v1 engine)

| Pair | Claim | Fixture |
|---|---|---|
| Batch evaluation vs bar-by-bar prefix replay | For every prefix length, the last row of prefix evaluation equals that bar in full-series evaluation, for all bundled templates. This is the live closed-bar mode. | `test_prefix_replay_matches_batch_for_all_templates` |
| Stored-revision preview vs direct compilation | Preview through the artifact store (stored source + stored ParameterSet) equals compiling the same document/values directly. Catches parameter-plumbing drift. | `test_store_preview_matches_direct_evaluation` |
| Engine vs independent arithmetic | SMA/EMA/RSI outputs match a from-first-principles rational (Fraction) recomputation, including Wilder seeding/smoothing, within the declared 12-decimal display rounding. | `test_ema_rsi_match_independent_rational_oracle` |
| Forming-bar handling | `barCloseOnly` artifacts ignore the forming candle; intrabar artifacts label its outputs provisional. Historical rows never change when later bars arrive. | T03/T04 tests + prefix fixture |

## Known differences (explicitly not parity)

- **Backtest fills vs paper/live fills.** The simulator fills at the
  next bar's open with declared slippage/fees. Paper and live fills
  will differ by spread, latency, partial fills and venue behaviour;
  P11 owns that reconciliation. Similar PnL across modes is not
  evidence of fill parity.
- **OHLC ambiguity.** Intrabar path (which of high/low came first,
  tick sequence) is not represented; bar-close-only artifacts avoid
  the question, intrabar artifacts accept it.
- **Display rounding.** Indicator outputs are rounded half-even to 12
  decimal places for display/research. Accounting never uses these
  rounded values.
- **OpenScript (code-only).** The existing OpenScript compiler/runtime
  is a separate engine. No numerical parity with chartly-rules-v1 is
  claimed or implied; conversion between languages is never silent.
- **Python/native extensions.** The rules engine executes no Python
  and loads no native code. Existing Python strategy hosting keeps its
  own trust boundary and is outside these fixtures.
