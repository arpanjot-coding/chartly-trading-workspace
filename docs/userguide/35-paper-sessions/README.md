# 35 - Historical Paper Sessions

Historical paper sessions let you practise decisions over saved native candles
with a persistent simulated account and its own journal book. The existing
chart, drawings, studies, toolbar and panels remain the workspace. [Chart
controls](../32-charting-terminal/README.md#historical-paper-sessions), [Data
Library](../34-data-library/README.md) and [paper API](../../api/local-paper.md).

## Prepare an Account

Open the intended saved practice run's **Chart**, then **Paper session** on the
right rail. You need a reviewed local storage binding and an owned dataset with
at least two confirmed native candles in the run's saved window. Use the
available storage/source recovery action if either is missing. A profile name
or connected broker key does not supply an execution account.

Review the instrument currency, quantity unit and step, price tick, multiplier,
quantity/price scales, starting cash, spread ticks, slippage ticks and fees.
Currency must match the source; no currency conversion is supplied. Display
precision does not establish an execution tick. Confirm the assumptions before
preparing the session. Its source version/checksum, window, economics and fill
policy then remain pinned.

The supported model uses one-times entry notional collateral for both long and
short positions. Cash includes settled realized results and charged fees;
equity also includes marked open P&L. Short-sale proceeds are unavailable as
spendable cash. Available funds reflect cash, equity and collateral. This is an
educational linear exposure model; exchange margin and instrument-specific
funding rules require separate support.

## Make and Review a Decision

Start the account, then use **Step** to reveal a full native candle. Submit a
market, limit or stop decision through the paper ticket. Step or play forward
to let a future observed candle evaluate it. The server derives execution facts
from the original source OHLC, including when the chart displays a transformed
view. It never accepts a chart quote as fill authority.

Market orders use the next eligible opening price with declared costs. Limits
respect their price cap; stops can fill adversely through opening gaps. Tick
rounding, spread, slippage and fees are explicit. A candle reaching both stop
and target selects the protective stop. An intrabar entry receives no favourable
same-candle target assumption. Missing candles stay gaps, with execution on the
next observed native candle and that policy disclosed.

The panel shows cash, equity, collateral, available funds, pending orders,
positions and recent fills. Pending entries do not reserve capital. The engine
evaluates them in deterministic order and records a rejection when funds are
insufficient. Each entry remains a separate position; submitting an opposite
entry creates another position. Use the selected position's close quantity to
queue a reduce-only partial or full exit for its next eligible observation.

All visible chart panes follow the acknowledged account time. A pending chart
synchronization holds the view before another result is exposed. Visual chart
replay and remembered chart cursors remain preparation features; the paper
account uses its separate persistent clock and commands. Free scrubbing cannot
rewind that account while retaining later finances.

## Restart and Resolve an Uncertain Request

Closing the page stops its client playback loop. Confirmed pending orders,
positions, ledger and account time remain saved. Reopening loads the checkpoint
without automatically playing. Only an explicit advance evaluates another
market event.

If an operation's response is uncertain, use its retained review/retry controls.
The same complete request and stable identity can recover a committed result
without repeating its financial effect. After a definite revision conflict,
reload and review the current account before resolving the retained decision.
Another tab cannot replace an unresolved command silently.

## Finish, Journal and Compare

**Finish paper session** cancels pending orders and retains marked open
exposure. It does not invent a fill at a price already observed. Submit a close
while a later eligible candle remains if you want a realized exit.

**Review saved report** shows the source, pinned assumptions, coverage, costs,
actual fills and realized versus unrealized results. Export report JSON or open
the run's paper journal. Confirmed executions appear once in that book; entry
fees are charged immediately and exits add their own costs. Partial closes
retain currency rounding residues. User notes, reviews and chart captures remain
available as later facts arrive. Observation-only runs may finish with zero
fills and explicit unavailable sample ratios.

Each paper book is labelled with its own run. Its journal baseline uses that
run's pinned starting cash. If an older saved summary lacks verified capital,
inspect the paper account's configuration; the journal shows it unavailable
instead of substituting a project balance. Completed-position report ratios and
the journal's realized-exit samples have separate labels. Source protective
levels and order reference remain visible with the confirmed journal facts.

**Create independent branch** uses an acknowledged earlier candle's close for a
new run/book with fresh starting cash and the same pinned assumptions. Review
that fresh-account meaning first. The original run stays intact; its future
orders, positions and P&L do not travel backward. Project comparisons show
selected independent accounts with their own capital, currency, coverage and
results. They provide no pooled equity or currency conversion.

## Back Up and Restore

Workspace backup includes the complete `paper-sessions` checkpoint/receipt
module alongside the journal and other workspace records. Reviewed cross-owner
restore deliberately rebinds local account and book references while retaining
engine state and source provenance. Use complete workspace restore for a managed
paper account rather than a browser-only run snapshot.

Candle files travel in separate Data Library bundles. Restore that bundle too
when the required history is unavailable; verified aliases/checksums are needed
before resume. Restore and Undo never start playback or connect to a broker.

## Supported Scope

A run uses one native immutable source, one linear instrument and one currency.
The run is bounded to 50,000 observations and each advance to 500. The server
also bounds active orders/positions, command and ledger history, record bytes and
comparison selections. The [API reference](../../api/local-paper.md) gives exact
limits, economics and recovery requirements.

OHLC does not supply a proven intrabar tick path or queue position. The current
engine does not infer volume-dependent partial fills, funding, swaps, FX or
universal derivative margin. Historical intent stays blocked at broker ingress.
Automated strategy experiments require their own supported engine integration.
