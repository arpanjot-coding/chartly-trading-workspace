# P14-T06/T07 — Asset-class intelligence subplans

Status: subplans only (2026-11-04). No data source is connected for
these classes yet; every field below is `unavailable` in the product
until its adapter is certified. Company-style ratios are never
invented for non-company assets.

## Crypto intelligence (T06)

Fields (each needs its own named source + methodology before display):
total/circulating supply, issuance schedule/inflation, scheduled
unlocks (date, amount, recipient class), staking yield inputs,
funding rates (per venue, timestamped), on-chain activity (active
addresses, fees, hash rate where applicable). Rules: supply figures
cite block height/time; unlock calendars cite the project document;
funding is venue-specific and never averaged silently across venues.
Candidate sources require the same P13 manifest treatment (terms,
quota, history) before any adapter work.

## Funds/ETFs (T07a)

Fields: NAV/price premium-discount, AUM, expense ratio, holdings
(as-of date + reporting lag), distributions, tracking index.
Holdings are point-in-time documents (N-PORT via EDGAR is a candidate
official source); stale holdings must display their report date.

## FX and rates (T07b)

Fields: spot/reference rates with fixing source+time, policy rates,
yield curve tenors. Macro series themselves belong to P15; this
subplan covers only instrument-level reference data and calendars
(holiday/fixing calendars per currency).

## Futures (T07c)

Fields: contract specs (tick, multiplier, expiry calendar), first
notice/last trade dates, roll methodology for continuous series
(explicitly versioned — a continuous contract is a derived dataset,
never raw history), open interest, settlement vs last price.

## Shared gate

Each class starts only with: named source + terms manifest (P13
pattern), coverage statement, and fixtures proving units/calendars.
Until then the UI shows these datasets as unavailable.
