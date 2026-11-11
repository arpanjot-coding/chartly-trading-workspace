# P06 original-screen acceptance

3 November 2026. Browser acceptance uses the original app served by the isolated `localhost:5016` fixture, with synthetic `EXAMPLE` candles, accounts and passwords. Test data lives only under `tmp/p06-ui-fixture`. No installed user records were migrated and no broker/provider order was submitted. The installed app at port 5000 was restarted with its existing environment and checked read-only.

## Preparation, next-event fills and original chart

The existing full chart, toolbar, drawing rail, panel rail, grid and dock were retained. On profile 3/run 1, the Paper session panel reviewed Shares, quantity step 1, tick 0.01, multiplier 1, quantity/price/money scales 0/2/2, spread 2 ticks, slippage 1 tick, fee 1 per fill and 10,000 USD starting cash. Preparation produced Ready revision 1 before the first revealed candle; Start did not advance it. A market buy of 2 with protective stop 90 and target 150 remained pending with zero candles and no financial effect.

Advance revealed exactly the first native candle and filled 2 at 100.02 with fee 1. Cash was 9,999, equity 10,000.96, used collateral 200.04 and available collateral 9,798.96. Switching the original chart layout to 2×2 held the grid while applying the cutoff, then all four panes showed one candle at the same 09:01 UTC availability. An actual chart capture and notes were saved through the existing Journal rail; expanding its evidence showed the PNG, source and 09:01 replay view.

Evidence: [reviewed preparation](evidence/prepare-reviewed.png), [pending before first candle](evidence/pending-before-first-bar.png), [acknowledged entry](evidence/acknowledged-entry.png), [four-pane decision](evidence/four-pane-chart-decision.png).

## Restart, partial settlement and finish

A reduce-only close of 1 was queued while the position still held 2. The guarded fixture restart terminated only the task's synthetic server and kept its database. Browser reload recovered revision 5, the identical pending order, 2 at 100.02, cash 9,999, fee 1 and one revealed candle; no playback started automatically.

The next advance filled 1 at 100.98 with fee 1. One share remained; cash 9,998.96, equity 10,000.94 and collateral 100.02 matched the independent calculation. A second close stayed pending until the following advance, then filled 1 at 101.98 with fee 1. The flat account had gross 2.92, fees 3 and cash/equity 9,999.92. Finish revision 9 added no fill. The report showed net −0.08, three observed candles, win rate 0% over one closed position, actual drawdown and source/state/report checksums.

Evidence: [restarted pending close](evidence/restarted-pending-close.png), [partial settlement](evidence/partial-close.png), [saved report](evidence/finished-report.png), [read-only final financial assertions](evidence/browser-financial-verification.json).

## Journal, historical inspection and current-account return

Open run journal selected that run's paper book. Exactly one position row showed 2 shares, Loss −0.08 and weighted exit 101.48. Expanded facts showed gross 2.92, commission 3 and the run name. The selected book's journal tabs and existing review UI stayed intact. Its realized-exit samples are distinct from the report's fully closed-position win-rate sample.

Reopening the saved decision restored one candle/09:01 after the current account had finished at three candles/09:03. The Paper rail explicitly showed a read-only decision view and an Open current paper account link. That link restored the finished account with the original finances and clock. Opening the trade chart without an evidence ID likewise used a read-only trade inspection, focused its entry candle, and retained a Back to journal URL with the selected book, Trades tab and trade ID. Inspection never moved the account or enabled paper/broker execution.

Evidence: [journal facts](evidence/journal-confirmed-facts.png), [recorded decision](evidence/recorded-decision-readonly.png), [trade return](evidence/trade-review-return.png).

## Independent branch, empty results and comparison

An explicit checked acknowledgement created run 2 at earlier observed index 1. The child had its own book, Ready revision 1, 10,000 starting/current cash, no fees/orders/positions/fills, and one known candle at 09:02 in its own 119-observation window. Original run 1 remained finished with −0.08. Finishing the untraded child retained cash 10,000 and zero fills; its saved report showed unavailable empty-sample win rate/profit factor instead of a fictitious zero ratio.

The existing run page selected both accounts and compared separate rows: run 1 cash/equity 9,999.92, gross 2.92, fees 3; branch cash/equity 10,000, gross/fees 0. No pooled equity was shown. Clear run selections removed both selections and the result table. Browser review caught a legacy run-card ratio counting partial settlements; the final cards explicitly load authoritative saved metrics and show the closed-position sample. Book naming/capital review also caught duplicate labels and project-capital substitution; final verification covers distinct run labels and selected-book capital semantics.

Evidence: [fresh child](evidence/fresh-branch.png), [zero-trade report](evidence/zero-trade-report.png), [independent comparison](evidence/independent-comparison.png), [corrected report-backed cards](evidence/corrected-run-card-metrics.png), [selected paper book](evidence/selected-paper-book.png).

## Reviewed cross-owner restore and continuation

The synthetic full workspace backup was frozen at revision 5, before the original pending partial close executed. The target `other` account resumed the saved review in Settings → Storage & recovery. The UI listed `paper-sessions: 1`; explicit ownership confirmation and Restore reviewed backup succeeded, with Undo available. History & data separately resumed and restored the source-A candle bundle. Its canonical version differed from the old owner's ID; checksum and verified old-ID alias matched exactly.

The read-only verification helper compared complete engine state and receipts with the frozen record: identical revision, clock, orders, position, fees and checkpoint state hash; principal/workspace/account/book references were rebound to the target. The target's original chart then opened at revision 5 with one candle, cash 9,999, open quantity 2 and the same pending close. A single advance executed the recovered close once, reproducing 9,998.96 cash, 10,000.94 equity and one remaining share.

Finish revision 7 retained that open share and two fills, without inventing an exit. Its saved report separated realized net −1.04 from unrealized 1.98, fees 2, two observed candles and an unavailable closed-position win rate. Read-only database assertions confirmed the original owner's finished run and independent branch were unchanged after target continuation.

Evidence: [reviewed workspace restore](evidence/reviewed-workspace-restore.png), [restored source](evidence/restored-source.png), [exact recovered account](evidence/restored-exact-account.png), [resumed close](evidence/restored-resume.png), [finished open exposure](evidence/finished-open-exposure.png), [scope/hash/alias verification](evidence/cross-owner-recovery-verification.json), [final independent records](evidence/browser-financial-verification.json).

## Final pass and scope

The final served build passed the corrected card/book review. Explicit Load saved metrics showed run 1 −0.08 USD, 0% and one fully closed position; run 2 retained an unavailable ratio and zero closed positions. The book menu distinguished the original and branch by run name/ID. Selecting run 1 showed its isolated realized P&L and an explicit unavailable starting baseline for the older optional-cash marker, without substituting the project balance. Its header Open chart actually opened run 1 with its selected book, paper panel and journal return context. Automated new-context fixtures additionally verify a 1,000-capital run inside a 10,000-capital project, exact marker validation, cash override/branch/recovery, and source bracket/order facts. Matching, lifecycle, retries, rollback, scope, stale UI responses and owner switching also have independent tests; screenshots do not substitute for those checks. The architecture [HTML](architecture.html) was rendered through the browser and its [PNG](evidence/architecture.png) visually inspected.

The original port-5000 app was reloaded with its preserved environment after the final backend changes. Workspace, Trading, Strategy Builder, Fundamentals and Workflows returned 200. Unauthenticated paper-session reads returned 401 with private/no-store and nosniff headers. [Read-only smoke](evidence/main-app-smoke.json).

The supported model is explicit linear native OHLC simulation. The package does not certify real-provider fills, exchange queue/margin behavior, volume-driven partial fills, funding, FX conversion or automated strategy experiment jobs. P07–P22 stay open. The isolated fixture is stopped after evidence is retained; the original app remains running at port 5000.
