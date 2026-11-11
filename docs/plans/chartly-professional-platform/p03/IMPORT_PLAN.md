# P03 statement import implementation plan

Owner: import worker. Status: implementation in progress. Scope: P03-T02 and P03-T03, with root-owned authenticated persistence/API and the original journal UI.

## Supported first format

Deliver a documented universal CSV mapping, not a claim that arbitrary broker exports are certified. `mapping.columns` maps canonical fields to actual unique CSV headers. The mapping declares an IANA timezone, quantity unit (`lots`, `units`, `shares`, `contracts`, `coins`), decimal/thousands separators and cost sign convention. Currency is either a mapped uppercase 3–12-character currency/asset code or an explicit default. Provider and account/book destination are supplied by the authenticated caller's trusted server context.

Canonical fields cover stable `eventId`, explicit `eventType`, optional `positionId`, timestamps, symbol/side, quantity/prices, realized gross/net P&L and signed commission/swap/fees, cashflow amount and descriptive strategy/notes. A `trade` row is an explicit position/trade summary with optional close time. `entry` and `exit` rows are raw executions with an explicit shared position ID. `fee` rows adjust an existing position. `deposit` and `withdrawal` rows remain cashflows, separate from trading P&L. A single position cannot mix summary and raw execution modes.

Missing costs remain unknown by default. `missingCostPolicy: declared-zero` is a separate explicit confirmation retained in the mapping and source observation; a sign convention alone never asserts zero. Net-only summaries can retain known net with null gross/cost components. Deriving a net requires known costs or that zero declaration. Canonical realization kinds are `exit` and `fee`; fee rows never add a closed-trade observation. Aggregate exit price requires price coverage of every closed quantity.

## Pure import boundary

`normalize_statement(csv_text, mapping, context, previous_events=())` performs no database, broker, file or network operations. It returns bounded preview rows/errors, normalized events, proposed corrections/duplicates, projections/cashflows, per-currency totals and `canCommit`. Root code persists the preview/source and commits it atomically with an expected workspace revision and idempotency ID. It must recheck server-side destination ownership and never overwrite review annotations from source events.

Every source event retains raw header/value text, row number and source-file hash. Its canonical event key hashes provider, canonical account key and external event ID. Source correction hashes exclude incidental raw formatting, source row position and filename, so an overlapping/reordered statement does not duplicate economics. Different accounts/providers can legitimately reuse external IDs. Conflicting duplicate IDs inside a statement are row errors, not last-row-wins. Repeated unchanged events are unchanged; corrected economic facts require an explicit correction action in the root review/commit flow.

## Validation before commit

1. Bound UTF-8 CSV bytes, rows, headers and individual cells. Reject duplicate/blank headers, malformed quotes, invalid mapping/header references, unexpected structural columns, nonfinite/exponential/ambiguous numbers and control bytes. Never evaluate spreadsheet expressions or supplied code.
2. Convert numeric source text with Decimal only. Preserve normalized decimal strings and raw lexical values. Costs have an explicit convention: signed costs affect P&L directly; positive-cost input subtracts commission/fees while swap stays signed. Reject inconsistent supplied net/gross/cost totals.
3. Parse ISO dates/times with explicit offset or mapping timezone. Reject date-only records without a time, nonexistent local DST times and ambiguous local folds without an explicit offset. Normalize to UTC while retaining original value/timezone. Reject silently lossy timestamp precision.
4. Validate required fields by event type, positive quantity/prices, side, close-after-open, account/currency/unit boundaries and explicit position links. Never infer external IDs or silently merge similar-looking trades.
5. Merge previous canonical events with proposed inserts/corrections by stable key. Recompute affected positions from complete known events, preserving open/partial state, each raw execution and all costs. Reject over-closing, a conflicting entry direction/currency/unit or ambiguous netting/hedging relationship.
6. Keep cashflows separate from realized trading P&L and totals separate by currency. Missing P&L must be explicit or derivable from actual entries/exits, without inventing a contract multiplier; quantity units require a declared positive multiplier to derive price P&L.

## Required fixture and regression evidence

- Quoted commas/newlines and a saved mapping profile reused on a second statement.
- Long/short and breakeven summaries; open summary later closed by correction.
- Partial entries/exits and a later overlapping statement; no duplicated event IDs or closed quantity.
- Fee-only correction and an amended original fee; user-owned reviews are outside importer output.
- Duplicate external IDs within one statement, across accounts and across providers.
- Same file twice and reordered/overlapping unchanged rows.
- Different currencies, deposits/withdrawals and fee-only trading adjustments reported separately.
- Midnight, DST gap/fold, explicit offsets, invalid timezone and microsecond precision limits.
- Decimal comma/thousands mapping, invalid/unknown currency and quantity unit, zero/negative size, NaN/infinity/exponents, malformed mapping, missing parents and row errors preventing commit.
- Input immutability and deterministic output across repeated calls.

The importer worker owns its pure implementation, supported CSV fixtures and tests. Root owns transactional repository integration, correction authorization, source/account/book scope, API/worker registration, backup registration and installed-screen validation. The UI worker owns mapping/review/commit controls in the original journal.
