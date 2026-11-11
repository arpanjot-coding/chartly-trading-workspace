# Supported normalized statement format v1

The first P03 importer supports this universal CSV schema with reusable header mappings. It does not certify every broker's native statement layout. The import contains source facts; user review notes and corrections remain separate journal records.

## Mapping and destination

Choose the destination journal book/account explicitly. The server supplies its trusted account/book identity; CSV account labels cannot redirect ownership. `eventId` must be the provider's stable event identity, and `positionId` must identify one unambiguous trade lifecycle. Reusing a completed execution position ID is rejected rather than silently merging another trade.

Required mapping fields are `columns`, `timezone` and an explicit `currency` default or mapped currency column. A saved mapping also contains version1, name, delimiter, decimal/thousands separators, quantity unit and commission/fee sign convention. The UI/repository owns mapping IDs and update timestamps; those metadata fields are stripped before normalization.

Supported currency/asset codes contain3–12 uppercase letters/digits and start with a letter, including USD, EUR, BTC and USDT. Different currencies are rejected against the declared destination unless the user explicitly enables separate-currency reporting. No FX rate or common total is invented.

Quantity units are `units`, `lots`, `shares`, `contracts` and `coins`. These labels preserve the statement's declared unit; they do not convert quantities. A source quantity is positive decimal text. When reported net/gross P&L is unavailable, price-derived P&L requires an explicit positive `pnlMultiplier`, including for shares and coins; the importer never guesses lot size, contract multiplier or tick value from a symbol label.

## Canonical row types

- `trade`: an explicit trade summary. Map symbol, Buy/Sell or Long/Short direction, quantity and openedAt. Closed rows also require closedAt and either reported P&L or prices plus declared multiplier. An absent closedAt means an open position. Nonzero unrealized price P&L cannot masquerade as realized P&L on an open summary; partial exits use execution rows.
- `entry`: an actual opening execution with positionId, occurredAt, symbol, side, quantity and price. Source entry costs remain known and are allocated to closed quantities through the stated FIFO policy.
- `exit`: an actual closing execution with positionId, occurredAt, opposite transaction side and quantity, plus reported P&L or actual price/declared multiplier. Partial exits keep the position open with explicit remaining quantity. Over-closing, missing entry history and implicit reversals are errors.
- `fee`: an explicit commission/fee/swap adjustment with occurredAt. With positionId it adjusts that trade while retaining its own source event and realization time. Without a position it remains an account-level trading adjustment, not a fabricated trade. An amended fee uses the same eventId and becomes an explicit correction.
- `deposit` / `withdrawal`: explicit cash transfer amount, currency and occurredAt. Deposit is positive; withdrawal normalizes to a negative outflow. These do not inflate trade count, win rate or trading P&L. Cashflow fees need their own fee event.

Executions that share a timestamp within one position require distinct integer `sequence` values. Ordering is never inferred from opaque provider IDs or the file's current row order. One position cannot mix a summary row and raw entry/exit mode.

## Money and cost semantics

All canonical source numbers are decimal strings; raw original lexical text remains in source observations. Input allows at most34 significant digits and18 decimal places, rejects exponent/NaN/infinite/ambiguous grouping, and honors the declared decimal/thousands separators. Derived reporting amounts are bounded to40 integer digits and18 decimal places. Excessive values produce row errors before commit.

Canonical accounting is `net = gross - commission - fees + swap`. Commission/fee `costConvention: positive` means positive expenses and negative rebates. `signed` negates signed source cashflows into that same canonical expense convention. **Swap always remains signed cashflow: credit positive, charge negative.** A file whose broker swap field has another meaning must be normalized deliberately first.

`missingCostPolicy: unknown` is the default: absent/blank commission, fees and swap stay null. A net-only statement remains valid with known net and unknown gross/cost components. Deriving a net from gross/prices requires all costs or an explicit `missingCostPolicy: declared-zero` confirmation. The saved mapping and each source observation retain that declaration. Risk is never affected by this policy. Known fee adjustments update net without pretending previously unknown fee components became zero.

Source net/gross/cost totals must agree exactly when every component is known. Missing reported gross can be recovered from reported net plus known costs, without a price-based estimate. Reported P&L remains authoritative; prices/multiplier only supply missing price economics, not an override of provider-reported P&L. Missing risk remains null; explicit zero risk stays zero and cannot yield a made-up R multiple. Aggregate exit price stays unknown if any closed quantity has no reported execution price.

Execution realizations use FIFO entry lots and proportional entry-cost allocation to the closed quantity, rounded half-even to18 decimal places with the exact remainder assigned when the lot is fully consumed. Raw execution fees remain available independently of that realized allocation. Cumulative journal P&L is not a claim of broker cash balance/account equity.

## Time, reconciliation and safety

Map ISO date/time values with an explicit offset or IANA source timezone. Date-only values, nonexistent DST times, ambiguous folds without an offset, invalid calendar dates and more than6 fractional second digits are row errors. Canonical instants are UTC with fixed microsecond precision; original timestamp text/timezone is retained.

Stable event identity is provider + canonical account key + external eventId, independent of filename, row order and display environment. Repeating an unchanged or overlapping statement produces unchanged events, not duplicates. A changed economic fingerprint is a correction requiring review; conflicting duplicates inside one file block the entire import. Imported source facts never overwrite user-owned review annotations.

The pure normalizer caps CSV at8 MiB,20,000 rows,100 columns and64,000 characters per cell; the authenticated app may impose a stricter upload limit. Previous events are bounded and scoped to the selected account/provider/book. Credential-named columns are rejected from portable statement data. CSV formulas/text are retained as text only; exported spreadsheets must escape formula prefixes before opening in spreadsheet applications.

Worked files: [summary and cashflow](../../../../test/fixtures/p03/universal-summary.csv), [partial executions](../../../../test/fixtures/p03/universal-partial.csv), [actual normalized preview](../../../../test/fixtures/p03/preview-example.json). Parent-owned journal APIs persist review/receipt/mapping records and commit only after the expected workspace revision and explicit review match.
