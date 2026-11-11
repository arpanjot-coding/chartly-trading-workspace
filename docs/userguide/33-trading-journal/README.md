# Trading journal and statement imports

The Journal works in the original Workspace alongside the existing Chart. Each profile is an environment. Choose its Journal to review trading; use Open for portfolio Overview, Connections and Settings. The Journal keeps its Overview, Trades, Calendar, Breakdown and optional Mind tabs. You can journal without a live broker feed.

## Choose the book and storage first

A connected book belongs to exactly one account. Manual entries use a separate manual book. Choose the intended book before importing, reviewing or opening a trade. Combined Analysis lets you select the profiles to include, clear all and save that selection; currencies stay separate.

Durable journal/import operations require the verified local account and local storage engine. Use Settings → Storage & Recovery to review/migrate an existing browser source when needed. Existing browser-only manual journals retain compatible capture/edit/review, but broker/imported facts are not editable as manual data. If the local engine disconnects, backend journal edits stop and your form remains a draft; the app does not move those edits into a different store.

## Record, close and correct a manual position

1. Choose the manual book and Add manual trade. Enter the symbol, direction and known execution facts. Select the input timezone deliberately. Leave unknown size, risk or costs blank. Open positions have no close time or realized P&L.
2. Save and inspect the trade's detail/history. Use Review for strategy/setup, tags, plan/decision notes, optional mindset and chart evidence. Mark reviewed when finished. These annotations remain separate from execution facts.
3. Use Partial exit for a known quantity closed now. Enter this exit's net P&L, time and known costs. Remaining quantity stays open; each exit contributes to the period in which it occurred.
4. Use Close position for the final exit. Enter the cumulative total realized P&L/costs for the whole position, including earlier exits. The app calculates the last exit's residual and prevents double counting. Review the resulting remaining quantity and history.
5. Use Correct exit to fix a particular recorded exit, or edit the whole closed total when appropriate. Give a reason. A quantity correction that changes the position from open to closed or back requires the explicit status-change confirmation. Prior facts remain in history. Imported facts must be corrected through a reviewed statement import.

Known net/gross/cost values must agree: net = gross − commission − fees + signed swap. Swap is positive for a credit and negative for a charge. Unknown costs remain unknown. Risk zero/blank does not produce an R multiple. Source times without a usable timezone stay labelled unknown until explicitly resolved; the application does not silently assign them midnight in a guessed timezone.

## Import a statement and reconcile it

Choose the explicit destination book/account, provider label, reporting currency, quantity unit and source timezone in Import statement. Load one supported normalized CSV and map its columns, or select a saved mapping. The app currently supports the documented [normalized statement format](../../plans/chartly-professional-platform/p03/SUPPORTED_STATEMENT_FORMAT.md), rather than every broker's native file format. App CSV uploads are limited to4MiB UTF-8.

Inspect preview errors, source identities, insert/unchanged/correction counts and per-currency totals before committing. Missing/blank costs default to unknown; choose declared zero only when the statement's meaning supports that declaration. Partial executions need an explicit shared position ID. Review and explicitly accept economic corrections; they preserve the previous source observations and your notes. Repeating the same or overlapping source events does not add duplicate trades. Similar-looking trades from different sources are not automatically merged.

If interrupted, reopen the retained statement review on the same account/source. A stale review can re-preview its retained file against current saved state before you confirm. After an uncertain response, keep the retained retry identity and reload/check the saved result before creating another request. A failure leaves source records and draft input available.

## Read the scope before the statistics

Choose book, currency/asset code, period, strategy, timezone and any search/result/direction/review filters. All journal metrics, charts, calendars, displayed P&L and filtered exports use that scope. Rolling periods end today in the reporting timezone. Day/week review links drill into the same scope; weeks start Monday. Unknown source times cannot be assigned to a reporting day by guesswork.

Realized exits, completed positions and still-open positions are different counts. A partial exit can contribute profit while its position remains open. Break-even exits stay in the win-rate denominator. Deposits/withdrawals are funding, while fee-only adjustments affect net P&L without becoming a losing trade. Quantity units and currencies are separate; no FX conversion is implied. Linked decision counts require explicit decision/copy identities and never remove separate account outcomes.

The line shows cumulative journal P&L. A replay baseline is a scoped model in its original currency, not connected broker equity. Unknown amounts/time limit equity/drawdown/streak claims. Coverage and sample counts explain the included data. Generic performance scores are removed, and annualized ratios remain unavailable without a complete declared cashflow-adjusted daily return series. [Detailed formulas](../../plans/chartly-professional-platform/p03/CALCULATION_POLICY.md).

## Review, evidence and return paths

Use the unreviewed filter and each row's detail/review/history actions. Attach the chart URL or a supported image/PDF up to8MiB. Chart links preserve the environment/book/trade and journal return context. A chart still needs its configured feed/API for prices; creating a journal or evidence link does not connect market data or enable trading.

Daily/weekly review records notes/goals plus the actual included trade IDs, timezone and fact revisions. Open an included trade to investigate it. Later source corrections retain the review history and indicate the changed fact/review state. Archive removes a row from current performance; Undo/restore retains its facts and history.

## Export and recover

Filtered CSV exports the displayed selected rows and exact amounts. Full-book JSON preserves committed source/review/history, permitted evidence and archived entries. Full-book CSV retains normalized amounts and realization/history/source ID columns; use JSON for full raw observations and evidence. These full-book downloads are separate from the selected filter view. Use Settings → Storage & Recovery for the full workspace ZIP, reviewed restore and Undo. The trusted backup registry includes saved journal records and permitted evidence, while credentials, runtime activation, installed strategy code and market-data file contents remain excluded.

Unsaved trade/import/review/evidence forms are IndexedDB drafts on this browser, scoped by local principal, source and book. **Export drafts separately** before clearing browser storage or moving computers; they are not in committed book exports or workspace ZIPs. Server-retained pending import reviews survive engine restart but are not a replacement for exporting unsaved browser work. Draft/attachment budgets are enforced without silently deleting earlier input. [Recovery guide](../../plans/chartly-professional-platform/p02/RECOVERY_GUIDE.md).

P03 adds these local journal workflows. Broker/exchange connectors, automatic history sync, live execution, strategy testing and Fundamentals remain later packages. Existing account configuration and chart missing-feed messages show the actual current readiness.
