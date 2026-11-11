# P03 metrics, scope and reporting implementation plan

Owner: P03 metrics agent. State: implemented with focused writer verification; root owns integrated acceptance. Scope: P03-T05, T06 and T07, integrated with the existing journal and Combined Analysis UI. [Exact calculation/reporting policy](CALCULATION_POLICY.md).

## Problems in the current code

Rolling periods anchor to the most recent stored trade, which makes years-old records appear in a current week. Calendar/hour/weekday grouping slices UTC text rather than using the displayed timezone. A contradictory result label can count one trade as both a win and loss. Win rates exclude break-even outcomes without showing that denominator. Missing amounts and costs are silently projected as zero. Mixed currencies inherit profile currency even when a record explicitly differs. Combined profiles synthesize nonannualized per-trade Sharpe ratios; replay computes annualized ratios from only trading days. The generic score ranks trading style and duration without a declared objective.

## Shared scope contract before UI changes

Create `journalAnalytics.ts` with pure timezone/date helpers and `scopeJournalTrades`. A scope explicitly names selected profiles/books, currency, strategy, search, result, direction, reporting timezone, period and injected current time. All pages derive displayed trades and every chart/metric/export from the same result. A day/week drill-through uses the same timezone and set of records. Unknown/local date-only timestamps are retained, labelled as source-local where possible, and never assigned a fabricated UTC hour. Current rolling windows are calendar days ending on the reporting-zone current day, with future records excluded and an explicit deterministic `now` fixture.

## Financial/statistical semantics

Use canonical exact-decimal string fields when provided; retain source strings, add with bounded BigInt decimal arithmetic and project to finite numbers only at the rendering boundary. Invalid canonical decimals never fall back silently to a legacy value. Legacy finite numeric rows remain supported with a precision-provenance label. Realization events represent partial exits on their own realized date; cashflows are separate from trade performance and never counted as profitable trades. Unknown risk/cost data remain unknown; sample/coverage counters describe what contributes.

Closed outcomes are classified by known net P&L sign. Win rate is wins divided by all known closed outcomes including break-even; separately expose decisive win rate if needed. Profit factor is positive net outcomes divided by absolute negative net outcomes, undefined when denominator is zero. Expectancy is known net P&L divided by its included closed outcome count. R uses a finite positive known risk amount; zero and unknown risk are excluded. Period P&L is cumulative journal P&L, not broker equity. Cash deposits/withdrawals are excluded from that line.

Group explicit trade currencies independently. Do not invent FX rates or sum unlike currencies. Account outcomes remain distinct; a separate decision count groups only explicit `decisionId`/`copyGroupId`, never guesses from symbol/time/order similarity. Archive rows never enter current performance.

Remove generic score/radar rankings and duration preferences; preserve the original panels' location for transparent sample/coverage statistics. Annualized ratios require a complete, cashflow-adjusted declared daily return calendar with exactly one observation per expected date and an explicit annualization factor. The existing journal lacks that evidence, so its ratio values remain unavailable with a reason rather than deriving them from trades.

## Files and coordinated ownership

- Own `frontend/src/lib/trader/metrics.ts` and its tests; new `journalAnalytics.ts` and tests; existing `CombinedLiveAnalytics.tsx` and focused tests as needed.
- Root owns `db.ts` canonical optional fields and backend accounting; UI agent owns `TraderJournal.tsx` and hooks. Share API before consumers change; do not edit those files concurrently.
- Preserve P01 immutable schema/fixture artifacts. Existing function signatures remain compatible through optional reporting arguments and added coverage fields.

## Verification before completion

Independent expected fixtures cover exact decimal addition, fees, contradictory labels, break-even denominators, missing/zero/invalid risk, mixed currencies, copied account outcomes/decisions, partial exits, deposits/withdrawals, archive exclusion, future timestamps, old periods, UTC midnight, New York/London DST and date-only source uncertainty. Verify both shared helper scope and existing summary/group/equity functions. Combined Analysis tests prove selected portfolios only, clear/save selection, shared current-time/timezone scope and no synthetic score/ratio. TypeScript and focused Vitest must pass; root performs integrated browser/backup/restart verification.

## Writer verification completed

On 2 November 2026, the focused suite passed **41 tests in 3 files** using the pinned Node 22.23.4 binary. The suite includes direct reconciliation of the regenerated importer worked fixture: 10 source units, 4 exited, 6 still open, 38.2 realized USD net, 1.8 commission, one realized exit and no completed position. Separate cases prove costs remain reportable when independently known despite unknown net P&L, unknown legacy zero-duration placeholders do not become known elapsed durations, and a replay starting baseline cannot be reinterpreted in another currency. Fee adjustments remain a distinct direction bucket and never add a long/short outcome.

Commands run from `frontend`:

```powershell
../tmp/p01-node/node_modules/node-win-x64/bin/node.exe node_modules/vitest/vitest.mjs run src/lib/trader/metrics.test.ts src/lib/trader/journalAnalytics.test.ts src/pages/workspace/CombinedLiveAnalytics.test.tsx
../tmp/p01-node/node_modules/node-win-x64/bin/node.exe node_modules/typescript/bin/tsc -b --pretty false
../tmp/p01-node/node_modules/node-win-x64/bin/node.exe node_modules/@biomejs/biome/bin/biome check src/lib/trader/metrics.ts src/lib/trader/metrics.test.ts src/lib/trader/journalAnalytics.ts src/lib/trader/journalAnalytics.test.ts src/pages/workspace/CombinedLiveAnalytics.tsx src/pages/workspace/CombinedLiveAnalytics.test.tsx
```

TypeScript passed; the final focused Biome check passed without changes or diagnostics. Independent importer review found two accounting defects before integrated acceptance: absent costs were silently zero and partially priced exits produced a fabricated whole-exit average. The importer owner fixed both and added regression cases. Original journal UI review checked shared filters, date/state scope, unknown timestamp labels, chronology guards, quantity-unit labels and exact export sources; root/UI owners complete browser and lifecycle acceptance. This writer verification does not mark the entire P03 package complete.

Final backend correction review added `test/test_journal_metrics_review.py`; all six cases pass. They prove 24-decimal final-total and residual-cost arithmetic, reject fully known contradictory manual money components, reject restored positions whose known remaining quantity contradicts open/closed status, and check an exact microsecond boundary at the end of the New York daylight-saving transition day. Book, currency and strategy scope mismatches roll back. Root fixed the two validation findings in the service/ledger owners' files.
