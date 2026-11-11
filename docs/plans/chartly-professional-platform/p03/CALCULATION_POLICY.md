# Journal statistics and reporting policy

P03 implementation policy, 2 November 2026. These describe the implemented journal statistics, not investment recommendations or broker account equity. The current report always names its profiles/book, currency or asset code, strategy, date range and IANA reporting timezone.

## Source amounts and costs

Canonical amounts are decimal strings. An explicit null is unknown and never falls back to a numeric display projection. The frontend adds decimal strings with bounded integer arithmetic; a finite numeric projection is used for charts/formatting and is not the authoritative source value. Legacy finite numeric inputs retain a separate precision-provenance count. Original raw observations, precise amounts and revisions remain in the journal ledger/export.

For normalized records, commission and fees are positive expenses; swap is signed cashflow, positive for a credit and negative for a charge. Net = gross − commission − fees + swap. Cost = commission + fees − swap. Old numeric-only records retain their previous signed-expense convention, including their original swap sign; they are labelled legacy rather than silently reinterpreted. Import mappings must identify their source convention and may declare absent cost components zero only explicitly. Missing/unknown components leave aggregate component/cost totals unavailable, with known partial totals and coverage counts kept separately.

Deposits and withdrawals are funding transfers, not trade P&L. They do not become wins, losses, realized exits or strategy performance. A standalone or linked fee correction affects journal P&L at its own timestamp, without adding a trade outcome. A fee credit can increase P&L without becoming a winning trade.

Each cash component has its own coverage. Known commission, swap, fees and gross P&L remain reportable even if that exit's net P&L is unknown; that exit is excluded only from net-based outcome denominators. Unknown components do not become zero merely because an entire net outcome was excluded.

## Position and realized-exit units

A position remains open while it has remaining quantity. Each realized partial exit contributes its own known net amount on its exit date; its parent position appears once in the position list. Repeated source files or overlapping source events do not add another exit. Fee-only realization events are adjustments, not exits. The original position's cumulative amount is never added again on top of its realization events.

Completed positions are counted when their actual final close is in scope. Open positions retain their actual status. Realized exits have a separate sample count, so a partially closed open position can contribute realized P&L without being labelled completed. A period/day/week view trims the realization list before every metric, date chart, table P&L and drill-through. Source history outside that scope remains untouched.

Size is reported separately by declared quantity unit. Units, contracts and lots are not added into a single reported volume. Unknown quantities remain unknown. Original decimal sizes remain available even where a display projection would round them.

## Formulas and denominators

- **Net journal P&L:** exact sum of known in-scope realized exit amounts and fee adjustments. Funding is excluded. Unknown P&L observations are excluded with an explicit count; they are not counted as zero or break-even.
- **Wins / losses / break-even:** positive / negative / exactly zero known realized exit amounts. Source result labels cannot make one exit count twice. Fee adjustments are excluded from outcome counts.
- **Win rate:** wins ÷ all known realized exits, including break-even. Decisive win rate, when shown separately, is wins ÷ (wins + losses), and is unavailable without a decisive outcome.
- **Expectancy:** net journal P&L, including in-scope fee adjustments, ÷ known realized exit sample count. It is a descriptive mean for this view, not a forecast. With no exit sample it is displayed in the empty/insufficient-sample context rather than as a prediction.
- **Positive / negative cash outcome totals:** sums of positive and negative known realized amounts and adjustments. The existing gross-profit/loss compatibility fields use these net cash outcomes, not pre-cost price profit.
- **Profit factor:** positive cash outcome total ÷ absolute negative cash outcome total. With positive cash and no negative denominator it is undefined; an empty/no-positive sample has an explicit empty context. It is not silently assigned an infinite success score.
- **Average win / loss:** mean of the positive / absolute negative realized trade exits only. A standalone fee does not become a losing trade for this denominator.
- **R:** a completed whole position's known total realized net P&L, including linked fees, ÷ its finite positive known risk amount. Zero, unknown or invalid risk is excluded. A period slice missing earlier exits cannot claim a whole-position R; hourly/daily groups include R only if the complete position and its adjustments belong to that group. The R sample size is shown separately.
- **Duration:** elapsed offset-aware close minus open time where known. A true zero duration is zero, not missing. A positive legacy source duration can be retained when chronology is unknown, without assigning a timezone to that source.
- **Drawdown:** chronological peak-to-trough movement of known dated journal P&L. Source ordering preserves sub-millisecond timestamps. Unknown chronology prevents a complete drawdown/streak claim; dated plots exclude ambiguous source times and display the coverage limitation.
- **Replay baseline:** a synthetic replay balance requires a declared positive starting baseline and known amounts/funding. Funding changes suppress simple baseline percentage returns and percentage drawdown; no broker equity is invented.
- **Replay currency and scope:** the starting baseline is usable only in its original profile currency. A report in a different code shows its journal P&L without converting or relabelling that baseline. Unknown realized money or chronology suppresses the curve's synthetic equity/percentage claim. A filtered replay balance is starting baseline plus the displayed scoped P&L, not an assertion of the full current account balance.

## Time, filters and currencies

Rolling 1W/1M/3M windows mean 7/30/90 reporting-calendar days ending today in the displayed timezone, not days ending at the most recent stored trade. The clock refreshes while the page is open. Future offset-aware events are excluded. Monday starts reporting weeks. Midnight and daylight-saving transitions use IANA rules. A date-only or unzoned legacy timestamp remains source-local/unknown: all-time known money can be retained with a warning, but bounded periods and date-specific plots cannot guess its reporting instant.

Every performance surface starts from one shared scope: selected profile/book, currency, period/day/week, strategy, search, result, direction and review status where applicable. All metrics, charts, displayed table P&L and filtered exports use that scope. Original full-source exports remain a separately labelled recovery operation. Daily self-reported states retain their declared calendar day and use the displayed date-window filters; they are not silently assigned a fabricated instant.

An explicit record currency/asset code overrides a legacy profile fallback. Distinct codes, including USD, EUR, USDT and BTC, are separate buckets. There are no inferred FX rates or cross-currency sums. Asset quantities/amounts retain exact strings; formatting falls back to the explicit code when it is not a supported fiat formatter.

## Copied decisions, scores and annualized ratios

Account outcomes remain separately counted and summed. Only explicit shared copy/decision identities contribute linked decision counts; unlinked outcomes are not guessed into shared decisions. A global explicit copy group takes priority, then a declared decision ID. Imported provider decision IDs are namespaced by their source; unrelated providers cannot collide solely because they use the same raw label. An overall unique-decision count is unavailable while unlinked outcomes remain.

The former generic performance score, duration preferences, score radar and score rankings are removed. Reports show raw statistics, actual sample sizes and coverage instead. No psychological or trading-skill ranking is inferred.

Sharpe/Sortino are unavailable for ordinary journal trade lists. Computing them requires a complete explicitly declared daily excess-return calendar, known initial equity, cashflow adjustment, exactly one valid observation for every expected date and a declared annualization factor. Sparse trading-day P&L is not a return series; days without trades are not silently invented as complete account observations. The helper uses sample standard deviation for Sharpe and root mean square of negative excess returns for Sortino, with square-root annualization only from that declared complete series. Zero deviation and incomplete samples remain unavailable with a reason.
