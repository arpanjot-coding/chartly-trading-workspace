# P00 screen layout and state contracts

2 November 2026. Design-only: fictional fixtures, no provider calls or production writes. This is the current companion to the [whole-product blueprint](APP_WORKFLOW_BLUEPRINT.md) and [decisions](P00_DECISIONS.md). The old v1 replacement-shell screen specification is historical.

Each UI surface below has a concrete wireframe/reference, exact scope/prerequisites, primary actions, handoffs, 12 state/recovery expectations and focus/narrow-layout rules. The existing review renders these alongside the original screens; it does not replace the chart or journal.

## Shared interaction contract

Use semantic headings, labelled fields, native keyboard controls and visible focus. Navigation focuses the target heading; validation focuses its summary then row/field. Saving preserves the action focus and announces status. Dialog dismissal returns to its trigger. Failed save never clears a draft. At narrow widths stack secondary panes and scroll tables within their own region. Never hide the selected account/book/mode or make color the sole status indicator.

## Current screen contracts

### WS01 — Workspace home and environments

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Keep the current profile cards and Chart / Journal / Open actions.; Show Live, Paper or journal-only intent, source readiness and the relevant book/account identity.; Keep Combined Analysis as an explicit cross-portfolio action..

Visible controls/fixtures: Context: Profiles / books / last work; Card actions: Chart · Journal · Open.

Actions: Create environment; Open Chart, Journal or portfolio management; Resume the last relevant workspace. Connects to WS02, WS03, WS04, WS08, WS13.

- **ready:** Workspace home and environments: correct scope resolved. Next: Create environment.
- **empty:** No records in this scope. Offer the appropriate create/log/import or data-setup action without forcing a broker.
- **loading:** Loading Workspace home and environments for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Keep cached entries and show coverage/as-of time. Do not claim live data or complete history.
- **partial:** Show missing coverage, invalid rows or unresolved source/account mapping; do not aggregate guessed or duplicated records.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### WS02 — Create an environment or standalone book

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Keep the existing creation dialog styling.; Offer the user jobs: Journal only, Paper/replay, or Connected trading.; Ask only for the book, account or dataset fields required by that job; show what will actually be created..

Visible controls/fixtures: Job: Journal only | Paper/replay | Connected trading; Name: Manual notes; Book/account: New manual book · no external account; Currency / timezone: USD / UTC.

Actions: Create a manual book without a broker; Prepare a paper environment; Configure a connected environment. Connects to WS03, WS06, WS08, SET02.

- **ready:** Create an environment or standalone book: correct scope resolved. Next: Create a manual book without a broker.
- **empty:** No records in this scope. Offer the appropriate create/log/import or data-setup action without forcing a broker.
- **loading:** Loading Create an environment or standalone book for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Keep cached entries and show coverage/as-of time. Do not claim live data or complete history.
- **partial:** Show missing coverage, invalid rows or unresolved source/account mapping; do not aggregate guessed or duplicated records.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### WS03 — Open: portfolio/environment management

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Overview: identity, account/book, observed balances, readiness and running-task shortcuts.; Connections: this environment’s data/account/terminal bindings.; Settings: defaults, timezone, limits and archive; Chart and Journal remain shortcuts out of management..

Visible controls/fixtures: Management tabs: Overview · Connections · Settings; Shortcuts: Open chart · Journal · Runs when relevant.

Actions: Resolve missing setup; Open the existing chart or book; Prepare/resume paper runs. Connects to WS04, WS06, WS08, SET02, AUTO05.

- **ready:** Open: portfolio/environment management: correct scope resolved. Next: Resolve missing setup.
- **empty:** No records in this scope. Offer the appropriate create/log/import or data-setup action without forcing a broker.
- **loading:** Loading Open: portfolio/environment management for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Keep cached entries and show coverage/as-of time. Do not claim live data or complete history.
- **partial:** Show missing coverage, invalid rows or unresolved source/account mapping; do not aggregate guessed or duplicated records.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### WS04 — Original chart terminal

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Keep the existing toolbar, chart grid, drawings, watchlist, indicator controls, right rail and bottom dock.; Add source/account/mode/readiness and instrument context within the existing controls.; Use contextual links to Fundamentals, journal evidence and a Strategy Builder project..

Visible controls/fixtures: Context strip: Environment A · source D1 · chart document C1; Optional account/book: Account A / book A · execution eligibility separate; Handoff: Exact instrument/time + return to originating journal or report.

Actions: Search/change instrument and timeframe; Apply a built-in or validated custom indicator; Open research, log/review a trade, or inspect a report’s trade. Connects to WS05, WS07, WS09, SB02, SB06, FND02, SH01.

- **ready:** Original chart terminal: correct scope resolved. Next: Search/change instrument and timeframe.
- **empty:** No records in this scope. Offer the appropriate create/log/import or data-setup action without forcing a broker.
- **loading:** Loading Original chart terminal for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Keep cached entries and show coverage/as-of time. Do not claim live data or complete history.
- **partial:** Show missing coverage, invalid rows or unresolved source/account mapping; do not aggregate guessed or duplicated records.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### WS05 — Orders, positions and execution context

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Keep the existing order/position/trade views and chart-side order tools.; Show the actual selected account, demo/live state, connection health and command outcome.; Present risk, sizing, protective-order support and copying destinations only when supported..

Visible controls/fixtures: Selected account: Account A · Demo; Execution eligibility: Observed capability/risk checks required.

Actions: Preview an eligible order; Inspect working orders and confirmed fills; Modify/cancel/close with explicit account context. Connects to WS04, WS09, AUTO04, SET02.

- **ready:** Orders, positions and execution context: correct scope resolved. Next: Preview an eligible order.
- **empty:** No records in this scope. Offer the appropriate create/log/import or data-setup action without forcing a broker.
- **loading:** Loading Orders, positions and execution context for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Account reconciliation/feed state is stale. Show last observation; disable new writes until eligibility is rechecked.
- **partial:** Intent I1 is Unknown. Show Reconcile / Inspect account; no Resubmit. Acknowledgement alone creates no journal fill.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### WS06 — Paper/replay setup and run library

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Keep existing run cards/creation controls; distinguish manual replay from automated testing.; Select a real saved dataset, instrument, range, timezone, starting balance and simulation costs.; Show coverage errors, warmup and resume/checkpoint status before enabling Start..

Visible controls/fixtures: Run: P1 · Draft; Instrument / data: BTC/USD spot / no dataset selected; Range / clock: 2026-10-01 10:00–10:05 / UTC; Balance / economics: USD 1,000 / 1 unit / USD 1 fee per side; Primary action: Choose saved data; Start disabled until ready.

Actions: Select saved history; Create a paper run; Resume or inspect an existing run. Connects to SH01, WS07, SB05.

- **ready:** Paper/replay setup and run library: correct scope resolved. Next: Select saved history.
- **empty:** Run P1 is Draft with no dataset. Start is unavailable; Choose saved data opens SH01 with return=P1.
- **loading:** Loading Paper/replay setup and run library for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Keep cached entries and show coverage/as-of time. Do not claim live data or complete history.
- **partial:** Coverage/quality/economic assumptions are incomplete. Explain each missing requirement and preserve run P1.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### WS07 — Paper session in the original chart

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Keep chart presentation and replay controls.; Make the simulation clock, available data, paper orders/positions and session book visible.; Show completed-run results and restart/resume behavior..

Visible controls/fixtures: Mode: Paper replay · simulated account P1; Clock / dataset: 10:02 UTC / D1; Paper balance: USD 1,008 after fixture trade T1.

Actions: Step/play/pause history; Place supported paper orders; Review session trades and journal. Connects to WS04, WS06, WS09.

- **ready:** Paper session in the original chart: correct scope resolved. Next: Step/play/pause history.
- **empty:** No records in this scope. Offer the appropriate create/log/import or data-setup action without forcing a broker.
- **loading:** Loading Paper session in the original chart for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Keep cached entries and show coverage/as-of time. Do not claim live data or complete history.
- **partial:** Show missing coverage, invalid rows or unresolved source/account mapping; do not aggregate guessed or duplicated records.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### WS08 — Independent journal books and book setup

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Each connected book names exactly one account; manual books have no external account binding.; Show book identity and source/sync coverage without requiring a chart or execution setup.; Open the existing journal presentation, not a new replacement ledger..

Visible controls/fixtures: Entry: Journal only · local storage; Book choice: Manual notes or the verified account’s existing book.

Actions: Create/open a manual book; Bind a connected book to one verified account; Import a statement or configure read-only sync. Connects to WS09, WS11, WS12.

- **ready:** Independent journal books and book setup: correct scope resolved. Next: Create/open a manual book.
- **empty:** No records in this scope. Offer the appropriate create/log/import or data-setup action without forcing a broker.
- **loading:** Loading Independent journal books and book setup for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Keep cached entries and show coverage/as-of time. Do not claim live data or complete history.
- **partial:** An existing active book already owns this account. Offer Open existing book; do not create an overlapping ledger.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### WS09 — Journal review workspace

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Preserve Overview, Trades, Calendar, Breakdown and optional Mind.; Keep book identity, filters, trade details, notes and performance charts.; Add source/coverage and review actions in the existing hierarchy; keep portfolio management behind Open..

Visible controls/fixtures: Book context: Manual notes / no execution account; Tabs: Overview · Trades · Calendar · Breakdown · optional Mind; Source status: Optional history coverage, separate from journal contents.

Actions: Filter and review this book; Open a trade’s chart/research/strategy evidence; Log, edit or close a trade. Connects to WS10, WS11, WS12, WS04, FND08, SB06.

- **ready:** Journal review workspace: correct scope resolved. Next: Filter and review this book.
- **empty:** No records in this scope. Offer the appropriate create/log/import or data-setup action without forcing a broker.
- **loading:** Loading Journal review workspace for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Keep cached entries and show coverage/as-of time. Do not claim live data or complete history.
- **partial:** Show missing coverage, invalid rows or unresolved source/account mapping; do not aggregate guessed or duplicated records.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### WS10 — Capture, edit, close and review a trade

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Lock the destination book/account and show timezone and asset-appropriate quantity units.; Keep open-trade facts separate from close facts and realized P&L.; Keep source facts separate from user notes, screenshots, setup tags and review choices..

Visible controls/fixtures: Locked destination: Manual notes / manual book; Open facts: BTC/USD · Buy · 1 unit · open time with timezone; Close facts: Optional until closed; do not invent P&L; Review: Notes, setup, screenshot and unrecorded checklist choices.

Actions: Save an open or completed manual trade; Edit/correct or close the same record; Attach chart/research evidence and review. Connects to WS09, WS04, FND08.

- **ready:** Capture, edit, close and review a trade: correct scope resolved. Next: Save an open or completed manual trade.
- **empty:** No records in this scope. Offer the appropriate create/log/import or data-setup action without forcing a broker.
- **loading:** Loading Capture, edit, close and review a trade for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Keep cached entries and show coverage/as-of time. Do not claim live data or complete history.
- **partial:** Show missing coverage, invalid rows or unresolved source/account mapping; do not aggregate guessed or duplicated records.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### WS11 — Statement import and validation

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Choose a book/account, source file and timezone/units mapping.; Preview valid rows, row errors, duplicates, corrections and source coverage before commit.; Show a durable import result and reversible/recoverable correction path..

Visible controls/fixtures: Stepper: Book/account → mapping → validation → preview → receipt; Destination: Demo account A / book A; Mapping: Quantity unit + UTC timestamps + net USD; Commit: Blocked while required row errors remain.

Actions: Upload/select a statement; Map and validate fields; Commit valid records or resolve issues. Connects to WS08, WS09, WS12.

- **ready:** Statement import and validation: correct scope resolved. Next: Upload/select a statement.
- **empty:** No records in this scope. Offer the appropriate create/log/import or data-setup action without forcing a broker.
- **loading:** Loading Statement import and validation for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Import receipt records exact accepted/skipped/error counts and links the destination book. Repeat commit has the same effect, not duplicate P&L.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Keep cached entries and show coverage/as-of time. Do not claim live data or complete history.
- **partial:** Rows: 1 valid, 1 existing duplicate, 1 missing quantity. Full commit is blocked; fix row 3 or disclose an explicit exclusion.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### WS12 — Read-only journal sync and reconciliation

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Show the account/source binding, history coverage, last successful sync and current job.; Show new/corrected records and ambiguous cross-source matches without discarding notes.; Provide retry, backfill/import and conflict resolution; cached journal remains readable offline..

Visible controls/fixtures: Source / account: Read-only source / verified account A; Coverage: Recent window only · backfill needed; Lifetime: Single account-scoped job while local engine runs.

Actions: Connect a supported read-only history source; Sync while the local engine is running; Resolve gaps, duplicate candidates and corrections. Connects to SET02, SH02, WS11, WS09.

- **ready:** Read-only journal sync and reconciliation: correct scope resolved. Next: Connect a supported read-only history source.
- **empty:** No records in this scope. Offer the appropriate create/log/import or data-setup action without forcing a broker.
- **loading:** Loading Read-only journal sync and reconciliation for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Checkpoint the last successful cursor/coverage and canonical changes; preserve notes. Do not call a limited response full history.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Keep cached entries and show coverage/as-of time. Do not claim live data or complete history.
- **partial:** Only a recent history window is known. Keep cached entries, mark coverage incomplete and offer statement/alternate-source backfill.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### WS13 — Combined Analysis

Scope: Selected environment/book or explicit Workspace scope.

Prerequisites: Local storage available; data/account prerequisites depend on the chosen job.

Layout: Keep selection, clear-all and explicit Save selection.; Keep currency groups and the same portfolio selection behind every displayed result.; Add coverage, duplicate-account/source protection and live/paper comparison rules as their contracts mature..

Visible controls/fixtures: Selection: Explicit portfolio IDs · clear all means none; Reporting: Same selection for every result; separate currencies.

Actions: Choose portfolios; Save/reopen a selection; Review selected metrics and return to an individual portfolio. Connects to WS01, WS09.

- **ready:** Combined Analysis: correct scope resolved. Next: Choose portfolios.
- **empty:** No portfolios selected means no result metrics/charts. Offer explicit selection; never silently revert to All.
- **loading:** Loading Combined Analysis for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the destination and any draft. Explain validation/storage/source failure and retry only the affected operation.
- **stale:** Keep cached entries and show coverage/as-of time. Do not claim live data or complete history.
- **partial:** Show missing coverage, invalid rows or unresolved source/account mapping; do not aggregate guessed or duplicated records.
- **unauthorized:** Keep local/manual work available. Reauthenticate only the requested source or choose an allowed book/environment.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### FND01 — Research home, search and saved lists

Scope: Issuer/listing or immutable research snapshot, not an execution account.

Prerequisites: A supported source or saved snapshot; no broker/execution setup.

Layout: Search company/asset names with issuer/listing disambiguation.; Show saved lists and recently researched entities.; Expose supported coverage and source availability rather than a fake populated dashboard..

Visible controls/fixtures: Search: Aster; Universe: Declared supported company/listing coverage; Saved work: Lists and research snapshots.

Actions: Find an issuer/listing; Reopen saved research; Compare supported entities. Connects to FND02, FND07, FND08.

- **ready:** Research home, search and saved lists: correct scope resolved. Next: Find an issuer/listing.
- **empty:** No supported result/fact/document. Offer supported search/source configuration or saved research; never fill missing metrics.
- **loading:** Loading Research home, search and saved lists for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the company, period, selected report and saved research. Show source/storage error and explicit retry.
- **stale:** Display cached source time and saved evidence separately from current data; a failed refresh never rewrites the snapshot.
- **partial:** Display supported fields and their sources; mark unavailable documents/metrics/relationships. Do not fabricate the rest.
- **unauthorized:** Explain source entitlement/access. Offer another supported source or saved evidence; do not send the user through execution login.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### FND02 — Company/asset overview

Scope: Issuer/listing or immutable research snapshot, not an execution account.

Prerequisites: A supported source or saved snapshot; no broker/execution setup.

Layout: Header: issuer and selected listing, source, as-of time and freshness.; Center: sourced business description and supported headline facts; asset-specific layouts later.; Tabs: Statements, Metrics, Reports, Events and later Relationships; explicit Chart and Save research actions..

Visible controls/fixtures: Issuer / listing: Aster Robotics / AST · XTEST · USD; Source / freshness: Filing F1 · fetched 2026-10-01 · illustrative; Tabs: Overview · Statements · Metrics · Reports · Events; Actions: Save research · Open mapped chart.

Actions: Inspect a company; Change listing without changing issuer facts; Open a mapped original chart. Connects to FND03, FND04, FND05, FND06, WS04, FND08.

- **ready:** Company/asset overview: correct scope resolved. Next: Inspect a company.
- **empty:** No supported result/fact/document. Offer supported search/source configuration or saved research; never fill missing metrics.
- **loading:** Loading Company/asset overview for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the company, period, selected report and saved research. Show source/storage error and explicit retry.
- **stale:** Display cached source time and saved evidence separately from current data; a failed refresh never rewrites the snapshot.
- **partial:** Display supported fields and their sources; mark unavailable documents/metrics/relationships. Do not fabricate the rest.
- **unauthorized:** Explain source entitlement/access. Offer another supported source or saved evidence; do not send the user through execution login.
- **unsupported:** Listing has no verified chart instrument mapping. Explain the mismatch and keep the issuer page; do not open a default ticker.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### FND03 — Financial statements

Scope: Issuer/listing or immutable research snapshot, not an execution account.

Prerequisites: A supported source or saved snapshot; no broker/execution setup.

Layout: Annual/quarterly periods, fiscal labels, units, scaling and currency.; Reported values with source drilldown and missing-cell explanations.; Restated versus as-reported selection only when supported by stored revisions..

Visible controls/fixtures: View: Income | Balance sheet | Cash flow; Periods: Annual / quarterly; units and currency visible.

Actions: Switch statements and periods; Inspect the original fact/report; Save a sourced view. Connects to FND02, FND05, FND08.

- **ready:** Financial statements: correct scope resolved. Next: Switch statements and periods.
- **empty:** No supported result/fact/document. Offer supported search/source configuration or saved research; never fill missing metrics.
- **loading:** Loading Financial statements for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the company, period, selected report and saved research. Show source/storage error and explicit retry.
- **stale:** Display cached source time and saved evidence separately from current data; a failed refresh never rewrites the snapshot.
- **partial:** One reported line is unavailable or an instant/duration mismatch exists. Display supported facts; do not invent zero/TTM.
- **unauthorized:** Explain source entitlement/access. Offer another supported source or saved evidence; do not send the user through execution login.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### FND04 — Metrics, valuation and comparison definitions

Scope: Issuer/listing or immutable research snapshot, not an execution account.

Prerequisites: A supported source or saved snapshot; no broker/execution setup.

Layout: Supported reported/calculated ratios and growth with formula definitions.; Period, price timestamp, currency and input citations for each calculation.; Unavailable denominators, negative earnings and unsupported TTM shown honestly..

Visible controls/fixtures: Metric: Revenue growth · calculated only from comparable periods; Inputs: Exact fact revisions and period/currency; Missing denominator: Unavailable with reason; Definition: Formula and source-input inspector.

Actions: Inspect metric inputs; Compare consistent periods/entities; Record a research observation. Connects to FND03, FND07, FND08.

- **ready:** Metrics, valuation and comparison definitions: correct scope resolved. Next: Inspect metric inputs.
- **empty:** No supported result/fact/document. Offer supported search/source configuration or saved research; never fill missing metrics.
- **loading:** Loading Metrics, valuation and comparison definitions for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the company, period, selected report and saved research. Show source/storage error and explicit retry.
- **stale:** Display cached source time and saved evidence separately from current data; a failed refresh never rewrites the snapshot.
- **partial:** Display supported fields and their sources; mark unavailable documents/metrics/relationships. Do not fabricate the rest.
- **unauthorized:** Explain source entitlement/access. Offer another supported source or saved evidence; do not send the user through execution login.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### FND05 — Filings, original reports and source detail

Scope: Issuer/listing or immutable research snapshot, not an execution account.

Prerequisites: A supported source or saved snapshot; no broker/execution setup.

Layout: Document type, publication time, provider and original link.; Fact-to-document references and revision/amendment context.; Freshness, unavailable documents and refresh failure recovery..

Visible controls/fixtures: Source inspector: Fact → exact document/version → original source; Unavailable state: Cached snapshot remains readable.

Actions: Open an original report; Inspect a fact’s origin; Cite evidence in saved research. Connects to FND03, FND08, SH02.

- **ready:** Filings, original reports and source detail: correct scope resolved. Next: Open an original report.
- **empty:** No supported result/fact/document. Offer supported search/source configuration or saved research; never fill missing metrics.
- **loading:** Loading Filings, original reports and source detail for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the company, period, selected report and saved research. Show source/storage error and explicit retry.
- **stale:** Display cached source time and saved evidence separately from current data; a failed refresh never rewrites the snapshot.
- **partial:** Display supported fields and their sources; mark unavailable documents/metrics/relationships. Do not fabricate the rest.
- **unauthorized:** Explain source entitlement/access. Offer another supported source or saved evidence; do not send the user through execution login.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### FND06 — Earnings and corporate events

Scope: Issuer/listing or immutable research snapshot, not an execution account.

Prerequisites: A supported source or saved snapshot; no broker/execution setup.

Layout: Dated earnings, dividends, splits and relevant announcements where covered.; Separate announced/estimated/confirmed events and display source/timezone.; Link to reports, chart timestamps and saved notes..

Visible controls/fixtures: Event: Fictional earnings release; Status / date: Announced vs estimated / timezone explicit; Evidence: Original announcement reference; Actions: Open report · chart timestamp · supported reminder.

Actions: Inspect an event; Set a supported reminder; Open related chart/report. Connects to FND05, WS04, AUTO02.

- **ready:** Earnings and corporate events: correct scope resolved. Next: Inspect an event.
- **empty:** No supported result/fact/document. Offer supported search/source configuration or saved research; never fill missing metrics.
- **loading:** Loading Earnings and corporate events for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the company, period, selected report and saved research. Show source/storage error and explicit retry.
- **stale:** Display cached source time and saved evidence separately from current data; a failed refresh never rewrites the snapshot.
- **partial:** Display supported fields and their sources; mark unavailable documents/metrics/relationships. Do not fabricate the rest.
- **unauthorized:** Explain source entitlement/access. Offer another supported source or saved evidence; do not send the user through execution login.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### FND07 — Screener and company comparison

Scope: Issuer/listing or immutable research snapshot, not an execution account.

Prerequisites: A supported source or saved snapshot; no broker/execution setup.

Layout: A declared supported universe and consistent metric/period filters.; Side-by-side facts with source, currency and missing-value treatment.; Saved criteria and explicit inclusion; avoid an opaque universal quality score..

Visible controls/fixtures: Universe / filters: Supported company set / stated metric periods; Comparison: Selected issuers, currency and source coverage; Missing data: Shown explicitly; no universal score.

Actions: Filter supported entities; Compare selected companies; Save a research list. Connects to FND01, FND02, FND08.

- **ready:** Screener and company comparison: correct scope resolved. Next: Filter supported entities.
- **empty:** No supported result/fact/document. Offer supported search/source configuration or saved research; never fill missing metrics.
- **loading:** Loading Screener and company comparison for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the company, period, selected report and saved research. Show source/storage error and explicit retry.
- **stale:** Display cached source time and saved evidence separately from current data; a failed refresh never rewrites the snapshot.
- **partial:** Display supported fields and their sources; mark unavailable documents/metrics/relationships. Do not fabricate the rest.
- **unauthorized:** Explain source entitlement/access. Offer another supported source or saved evidence; do not send the user through execution login.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### FND08 — Saved research and decision notebook

Scope: Issuer/listing or immutable research snapshot, not an execution account.

Prerequisites: A supported source or saved snapshot; no broker/execution setup.

Layout: Notes, thesis, linked entities, reports and captured facts with source dates.; Distinguish saved evidence from refreshed current data.; Choose the destination book/trade/note when attaching research..

Visible controls/fixtures: Research: Aster Robotics · decision note N1; Evidence: Snapshot F1 · immutable facts/report references; Destination: Optional journal book/trade target chosen explicitly; Save state: Saved evidence stays separate from refreshed current facts.

Actions: Save/reopen a snapshot; Attach a citation to a journal review; Return to the exact researched company or chart. Connects to FND02, FND05, WS09, WS04.

- **ready:** Saved research and decision notebook: correct scope resolved. Next: Save/reopen a snapshot.
- **empty:** No supported result/fact/document. Offer supported search/source configuration or saved research; never fill missing metrics.
- **loading:** Loading Saved research and decision notebook for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the company, period, selected report and saved research. Show source/storage error and explicit retry.
- **stale:** Refresh failed. Reopen snapshot F1 with its original sources/times and a Stale label; note draft and citations remain unchanged.
- **partial:** Display supported fields and their sources; mark unavailable documents/metrics/relationships. Do not fabricate the rest.
- **unauthorized:** Explain source entitlement/access. Offer another supported source or saved evidence; do not send the user through execution login.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### FND09 — Company relationships

Scope: Issuer/listing or immutable research snapshot, not an execution account.

Prerequisites: A supported source or saved snapshot; no broker/execution setup.

Layout: Supplier/customer/ownership edges with type, source, date and evidence.; Inspect relationships without treating inference as reported fact.; Show changes over time and distinguish verified relationships from unavailable coverage..

Visible controls/fixtures: Relationship: Issuer A → customer/supplier/ownership edge → Issuer B; Evidence: Source document, date, relationship type and confidence; Unavailable: No supported edge dataset; do not invent a connection.

Actions: Explore a sourced relationship; Inspect evidence; Open the related company. Connects to FND02, FND05, FND08.

- **ready:** Company relationships: correct scope resolved. Next: Explore a sourced relationship.
- **empty:** No supported result/fact/document. Offer supported search/source configuration or saved research; never fill missing metrics.
- **loading:** Loading Company relationships for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the company, period, selected report and saved research. Show source/storage error and explicit retry.
- **stale:** Display cached source time and saved evidence separately from current data; a failed refresh never rewrites the snapshot.
- **partial:** Display supported fields and their sources; mark unavailable documents/metrics/relationships. Do not fabricate the rest.
- **unauthorized:** Explain source entitlement/access. Offer another supported source or saved evidence; do not send the user through execution login.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### FND10 — Market intelligence, economic calendar and reports

Scope: Issuer/listing or immutable research snapshot, not an execution account.

Prerequisites: A supported source or saved snapshot; no broker/execution setup.

Layout: Supported macro series, economic releases and original economic reports.; Release time, observation period, revisions, source and freshness; original links for any licensed news/report coverage.; Watchlists, dated events and chart overlays only where their data is supported..

Visible controls/fixtures: Market view: Supported macro series / release calendar / reports; Observation vs release: Period, publication time and revisions kept separately; Source: Original report and last refresh; Actions: Save research · inspect series · supported reminder.

Actions: Inspect a macro series or release; Open an original report; Save research or configure a supported reminder. Connects to FND05, FND08, WS04, AUTO02.

- **ready:** Market intelligence, economic calendar and reports: correct scope resolved. Next: Inspect a macro series or release.
- **empty:** No supported result/fact/document. Offer supported search/source configuration or saved research; never fill missing metrics.
- **loading:** Loading Market intelligence, economic calendar and reports for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the company, period, selected report and saved research. Show source/storage error and explicit retry.
- **stale:** Display cached source time and saved evidence separately from current data; a failed refresh never rewrites the snapshot.
- **partial:** Display supported fields and their sources; mark unavailable documents/metrics/relationships. Do not fabricate the rest.
- **unauthorized:** Explain source entitlement/access. Offer another supported source or saved evidence; do not send the user through execution login.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### FND11 — Asset-specific fundamentals

Scope: Issuer/listing or immutable research snapshot, not an execution account.

Prerequisites: A supported source or saved snapshot; no broker/execution setup.

Layout: Crypto: supply, issuance/unlocks and supported network/funding data with methodology.; Funds: holdings, NAV and distributions; FX/rates: relevant economic series and rate context.; Futures: contract, expiry/roll and term structure. Retain source, date, units and missing-data rules throughout..

Visible controls/fixtures: Asset type: Crypto | Fund | FX/rates | Futures; Relevant fields: Supply/issuance | holdings/NAV | macro/rates | expiry/term structure; Methodology: Units, timing, source and coverage; Unavailable: No generic company ratio fallback.

Actions: Choose a supported asset type; Inspect its relevant fundamentals; Open the matching original chart or cited research. Connects to FND01, FND08, FND10, WS04.

- **ready:** Asset-specific fundamentals: correct scope resolved. Next: Choose a supported asset type.
- **empty:** No supported result/fact/document. Offer supported search/source configuration or saved research; never fill missing metrics.
- **loading:** Loading Asset-specific fundamentals for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep the company, period, selected report and saved research. Show source/storage error and explicit retry.
- **stale:** Display cached source time and saved evidence separately from current data; a failed refresh never rewrites the snapshot.
- **partial:** Display supported fields and their sources; mark unavailable documents/metrics/relationships. Do not fabricate the rest.
- **unauthorized:** Explain source entitlement/access. Offer another supported source or saved evidence; do not send the user through execution login.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SB01 — Project library

Scope: Project/revision/parameter set/experiment, independent of live account.

Prerequisites: Writable project storage; supported compiler and exact dataset/economics when testing.

Layout: Create Indicator or Create Strategy; search and reopen saved projects.; Show drafts, validated revisions, parameter sets and latest experiment.; Import/export, duplicate and archive without exposing legacy tool hosts..

Visible controls/fixtures: Create: Indicator | Strategy; Library: Search / draft / validated revision / latest experiment.

Actions: Create/open a project; Resume an experiment; Open a saved report. Connects to SB02, SB05, SB06.

- **ready:** Project library: correct scope resolved. Next: Create/open a project.
- **empty:** No project, valid revision, experiment or candidate yet. Offer Create/Validate/Choose data according to this view.
- **loading:** Loading Project library for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Preserve draft or pinned manifest and diagnostics. Compile/data/job errors do not become completed results.
- **stale:** Keep old results against their original revision/data; show that the current draft or assumptions differ.
- **partial:** Retain all completed/failed/rejected/cancelled trials and supported metrics; do not call partial studies complete.
- **unauthorized:** Code/data capability is unavailable. Offer supported mode/source or reopen saved results; no live broker is required for local research.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SB02 — Indicator/strategy authoring

Scope: Project/revision/parameter set/experiment, independent of live account.

Prerequisites: Writable project storage; supported compiler and exact dataset/economics when testing.

Layout: Left: project files/dependencies; center: code or supported visual rules.; Right: typed parameters, plots and strategy settings; bottom: diagnostics/preview.; Draft/revision status and save/conflict recovery. Keep chart-side editing linked to the same project..

Visible controls/fixtures: Artifact kind: Indicator or Strategy · chosen at project creation; Left: Files and exact dependency revisions; Center: Code / supported visual-rule subset; Right: Typed parameters and plot/rule settings; Bottom: Diagnostics and preview.

Actions: Save a draft; Validate and freeze a revision; Preview an indicator or define executable strategy rules. Connects to SB03, SB04, SB05, WS04.

- **ready:** Indicator/strategy authoring: correct scope resolved. Next: Save a draft.
- **empty:** No project, valid revision, experiment or candidate yet. Offer Create/Validate/Choose data according to this view.
- **loading:** Loading Indicator/strategy authoring for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Preserve draft or pinned manifest and diagnostics. Compile/data/job errors do not become completed results.
- **stale:** Keep old results against their original revision/data; show that the current draft or assumptions differ.
- **partial:** Retain all completed/failed/rejected/cancelled trials and supported metrics; do not call partial studies complete.
- **unauthorized:** Code/data capability is unavailable. Offer supported mode/source or reopen saved results; no live broker is required for local research.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SB03 — Indicator preview and validation

Scope: Project/revision/parameter set/experiment, independent of live account.

Prerequisites: Writable project storage; supported compiler and exact dataset/economics when testing.

Layout: Selected dataset, typed inputs, overlay/pane outputs and reference values.; Warmup, missing bars, higher-timeframe availability and repaint behavior.; Show validation outcome and exact revision/parameters..

Visible controls/fixtures: Artifact: Indicator r1; fast=10 / slow=20; Data: D1 / warmup and interval specified; Checks: Reference values, missing bars, repaint/higher-timeframe availability; Actions: Validate · apply revision to chart · use in strategy.

Actions: Preview output; Validate reference behavior; Apply to an original chart or use in a strategy. Connects to SB02, SB04, WS04.

- **ready:** Indicator preview and validation: correct scope resolved. Next: Preview output.
- **empty:** No project, valid revision, experiment or candidate yet. Offer Create/Validate/Choose data according to this view.
- **loading:** Loading Indicator preview and validation for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Preserve draft or pinned manifest and diagnostics. Compile/data/job errors do not become completed results.
- **stale:** Keep old results against their original revision/data; show that the current draft or assumptions differ.
- **partial:** Retain all completed/failed/rejected/cancelled trials and supported metrics; do not call partial studies complete.
- **unauthorized:** Code/data capability is unavailable. Offer supported mode/source or reopen saved results; no live broker is required for local research.
- **unsupported:** Indicator-only artifact cannot produce P&L. Offer technical validation or Create strategy with explicit rules.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SB04 — Strategy rules and trading assumptions

Scope: Project/revision/parameter set/experiment, independent of live account.

Prerequisites: Writable project storage; supported compiler and exact dataset/economics when testing.

Layout: Entry/exit conditions, indicator dependencies, sizing, stops/targets and session rules.; Bar-close/next-open timing and supported fill policy.; Instrument economics, cost assumptions and clear validation errors..

Visible controls/fixtures: Dependencies: Indicator r1 pinned; Entry / exit: Declared long/short rules; Sizing / protection: Explicit units, stops/targets and eligibility; Timing / costs: Bar close signal, next-bar fill, declared fees.

Actions: Build supported visual rules or code; Validate execution semantics; Configure a baseline test. Connects to SB02, SB05.

- **ready:** Strategy rules and trading assumptions: correct scope resolved. Next: Build supported visual rules or code.
- **empty:** No project, valid revision, experiment or candidate yet. Offer Create/Validate/Choose data according to this view.
- **loading:** Loading Strategy rules and trading assumptions for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Preserve draft or pinned manifest and diagnostics. Compile/data/job errors do not become completed results.
- **stale:** Keep old results against their original revision/data; show that the current draft or assumptions differ.
- **partial:** Retain all completed/failed/rejected/cancelled trials and supported metrics; do not call partial studies complete.
- **unauthorized:** Code/data capability is unavailable. Offer supported mode/source or reopen saved results; no live broker is required for local research.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SB05 — Backtest setup and experiment jobs

Scope: Project/revision/parameter set/experiment, independent of live account.

Prerequisites: Writable project storage; supported compiler and exact dataset/economics when testing.

Layout: Pin revision, parameters, instrument, dataset version, range and warmup.; Set costs, fill assumptions and resource budget.; Show queued/running/completed/failed/cancelled/interrupted states and recovery..

Visible controls/fixtures: Manifest: Strategy r1 + parameters + data D1 + engine v1; Range / warmup: Evaluation range separate from warmup; Budget: Trial/time/memory/disk/concurrency limits; Jobs: Queued → running → completed/failed/cancelled/interrupted.

Actions: Choose saved data; Run/cancel a bounded experiment; Reopen its report after leaving the chart. Connects to SH01, SH02, SB06.

- **ready:** Backtest setup and experiment jobs: correct scope resolved. Next: Choose saved data.
- **empty:** No project, valid revision, experiment or candidate yet. Offer Create/Validate/Choose data according to this view.
- **loading:** Loading Backtest setup and experiment jobs for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Preserve draft or pinned manifest and diagnostics. Compile/data/job errors do not become completed results.
- **stale:** Keep old results against their original revision/data; show that the current draft or assumptions differ.
- **partial:** Retain all completed/failed/rejected/cancelled trials and supported metrics; do not call partial studies complete.
- **unauthorized:** Code/data capability is unavailable. Offer supported mode/source or reopen saved results; no live broker is required for local research.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Experiment E1 stopped unexpectedly. Preserve manifest/logs/results and offer only engine-supported resume or deterministic rerun.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SB06 — Saved performance report and trade drilldown

Scope: Project/revision/parameter set/experiment, independent of live account.

Prerequisites: Writable project storage; supported compiler and exact dataset/economics when testing.

Layout: Overview/assumptions, equity/drawdown, trades, costs/exposure, breakdowns and diagnostics.; Exact manifest, dataset range, engine and revision identity.; Click a simulated trade to inspect its original-chart context; return to the same report..

Visible controls/fixtures: Report: Experiment E1 / strategy r1 / data D1; Summary: Start USD 1,000; gross 10; costs 2; net 8; end 1,008; Tabs: Overview/assumptions · equity/drawdown · trades · costs · diagnostics.

Actions: Inspect a baseline result; Export/reopen results; Compare or start a bounded validation study. Connects to WS04, SB07, SB08, SB09.

- **ready:** Saved performance report and trade drilldown: correct scope resolved. Next: Inspect a baseline result.
- **empty:** No project, valid revision, experiment or candidate yet. Offer Create/Validate/Choose data according to this view.
- **loading:** Loading Saved performance report and trade drilldown for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Preserve draft or pinned manifest and diagnostics. Compile/data/job errors do not become completed results.
- **stale:** Keep old results against their original revision/data; show that the current draft or assumptions differ.
- **partial:** Retain all completed/failed/rejected/cancelled trials and supported metrics; do not call partial studies complete.
- **unauthorized:** Code/data capability is unavailable. Offer supported mode/source or reopen saved results; no live broker is required for local research.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SB07 — Parameter optimization and candidate ledger

Scope: Project/revision/parameter set/experiment, independent of live account.

Prerequisites: Writable project storage; supported compiler and exact dataset/economics when testing.

Layout: Parameter ranges/constraints, trial estimate and budget.; Every candidate, rejection/failure and scoring objective.; Performance/drawdown/cost/sample-size tradeoffs and parameter stability..

Visible controls/fixtures: Grid: Fast [10,20,30], slow [20,40,60]; require fast < slow; Ledger: 9 considered / 7 valid / 2 rejected; Objective / budget: Declared before running; retain every attempt.

Actions: Run bounded grid/random search; Inspect all attempted trials; Save a parameter set against its exact revision. Connects to SB06, SB08, SB09.

- **ready:** Parameter optimization and candidate ledger: correct scope resolved. Next: Run bounded grid/random search.
- **empty:** No project, valid revision, experiment or candidate yet. Offer Create/Validate/Choose data according to this view.
- **loading:** Loading Parameter optimization and candidate ledger for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Preserve draft or pinned manifest and diagnostics. Compile/data/job errors do not become completed results.
- **stale:** Keep old results against their original revision/data; show that the current draft or assumptions differ.
- **partial:** 9 grid combinations considered, 7 valid and 2 rejected by fast < slow. Keep all trial states; no fabricated winner.
- **unauthorized:** Code/data capability is unavailable. Offer supported mode/source or reopen saved results; no live broker is required for local research.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SB08 — Out-of-sample and stress testing

Scope: Project/revision/parameter set/experiment, independent of live account.

Prerequisites: Writable project storage; supported compiler and exact dataset/economics when testing.

Layout: Chronological train/validation/holdout and walk-forward definitions.; Supported cost/slippage/latency/market-period stresses and seeded resampling.; Scenario assumptions, degradation, failures and absolute results; distinguish execution reruns from return transformations..

Visible controls/fixtures: Split: Chronological train / validation / held-out evaluation; Leakage controls: Warmup / availability / any required gap; Stress: Cost/fill reruns vs labelled return transformations; Result: Baseline, degradation, failures and supported confidence limits.

Actions: Define a study; Compare baseline and scenarios; Record limitations and candidate decisions. Connects to SB06, SB07, SB09.

- **ready:** Out-of-sample and stress testing: correct scope resolved. Next: Define a study.
- **empty:** No project, valid revision, experiment or candidate yet. Offer Create/Validate/Choose data according to this view.
- **loading:** Loading Out-of-sample and stress testing for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Preserve draft or pinned manifest and diagnostics. Compile/data/job errors do not become completed results.
- **stale:** Keep old results against their original revision/data; show that the current draft or assumptions differ.
- **partial:** A scenario is unsupported or a holdout was exposed. Record the limitation and selection history; do not label it untouched.
- **unauthorized:** Code/data capability is unavailable. Offer supported mode/source or reopen saved results; no live broker is required for local research.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SB09 — Compare, save and promote a candidate

Scope: Project/revision/parameter set/experiment, independent of live account.

Prerequisites: Writable project storage; supported compiler and exact dataset/economics when testing.

Layout: Compare revision, data, costs and trial conditions before ranking.; Save a selected parameter set and the researcher’s explanation.; Separate Apply indicator, Inspect trades, Create paper run and Prepare bot deployment actions..

Visible controls/fixtures: Compare: Revision, data, period, fees and engine differences first; Candidate: Named parameter set + evidence + limitations; Actions: Apply indicator | inspect test trades | create paper run | prepare bot.

Actions: Apply a validated indicator to a chosen chart; Test a strategy in a paper environment; Prepare an eligible account-bound deployment. Connects to WS04, WS06, AUTO05.

- **ready:** Compare, save and promote a candidate: correct scope resolved. Next: Apply a validated indicator to a chosen chart.
- **empty:** No project, valid revision, experiment or candidate yet. Offer Create/Validate/Choose data according to this view.
- **loading:** Loading Compare, save and promote a candidate for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Preserve draft or pinned manifest and diagnostics. Compile/data/job errors do not become completed results.
- **stale:** Keep old results against their original revision/data; show that the current draft or assumptions differ.
- **partial:** Retain all completed/failed/rejected/cancelled trials and supported metrics; do not call partial studies complete.
- **unauthorized:** Code/data capability is unavailable. Offer supported mode/source or reopen saved results; no live broker is required for local research.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### AUTO01 — Workflow library and useful templates

Scope: Workflow run or exact account-bound deployment.

Prerequisites: Valid graph/runtime configuration and explicitly supported scoped capabilities.

Layout: Keep saved workflow cards, import/export and active/draft state.; Group supported templates by user job: alerts, data refresh, reports and eligible trading actions.; Show bound environment/account and last run without claiming unsupported actions are ready..

Visible controls/fixtures: Library: Saved workflows / supported templates / last result; Scope: Environment/account/project binding visible.

Actions: Create/open a workflow; Duplicate/import a workflow; Inspect recent runs. Connects to AUTO02, AUTO04.

- **ready:** Workflow library and useful templates: correct scope resolved. Next: Create/open a workflow.
- **empty:** No workflow, run or deployment yet. Offer a draft or supported template; do not imply activation.
- **loading:** Loading Workflow library and useful templates for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep step logs and operation identity. Retry only supported idempotent steps; reconcile ambiguous order outcomes first.
- **stale:** Show last observed runtime/source state with timestamp, not a green Running claim from saved configuration.
- **partial:** Show each step/approval/child-account outcome. Stop does not imply cancel or close completed market activity.
- **unauthorized:** Explain the exact missing action capability/account permission. Read-only work remains separate from order access.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### AUTO02 — Visual automation builder

Scope: Workflow run or exact account-bound deployment.

Prerequisites: Valid graph/runtime configuration and explicitly supported scoped capabilities.

Layout: Keep node palette, graph canvas, node settings and execution logs.; Define trigger, inputs, conditions, action capabilities and target scope.; Link supported saved project/jobs instead of copying strategy code into another engine..

Visible controls/fixtures: Left: Supported trigger/action palette; Center: Existing Flow graph canvas; Right: Node inputs, scope and capability requirements; Bottom: Validation and run logs.

Actions: Build a schedule/event workflow; Validate its graph and bindings; Preview/test before activating. Connects to AUTO03, AUTO04, SET02.

- **ready:** Visual automation builder: correct scope resolved. Next: Build a schedule/event workflow.
- **empty:** No workflow, run or deployment yet. Offer a draft or supported template; do not imply activation.
- **loading:** Loading Visual automation builder for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep step logs and operation identity. Retry only supported idempotent steps; reconcile ambiguous order outcomes first.
- **stale:** Show last observed runtime/source state with timestamp, not a green Running claim from saved configuration.
- **partial:** Show each step/approval/child-account outcome. Stop does not imply cancel or close completed market activity.
- **unauthorized:** Explain the exact missing action capability/account permission. Read-only work remains separate from order access.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### AUTO03 — Test, permissions and activation

Scope: Workflow run or exact account-bound deployment.

Prerequisites: Valid graph/runtime configuration and explicitly supported scoped capabilities.

Layout: Show resolved account/environment, exact action permissions and expected effects.; Separate read-only preview from real action execution.; Make schedules, webhook credentials, approvals and activation status clear..

Visible controls/fixtures: Resolved target: Account A / book A / read-only history; Permission: account-history only; no order capability; Preview: Supported dry-run only; no hidden writes; Activation: Explicit schedule/webhook scope and observed prerequisites.

Actions: Validate/test safely; Choose enabled scope; Activate or keep a draft. Connects to AUTO02, AUTO04.

- **ready:** Test, permissions and activation: correct scope resolved. Next: Validate/test safely.
- **empty:** No workflow, run or deployment yet. Offer a draft or supported template; do not imply activation.
- **loading:** Loading Test, permissions and activation for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep step logs and operation identity. Retry only supported idempotent steps; reconcile ambiguous order outcomes first.
- **stale:** Show last observed runtime/source state with timestamp, not a green Running claim from saved configuration.
- **partial:** Show each step/approval/child-account outcome. Stop does not imply cancel or close completed market activity.
- **unauthorized:** Explain the exact missing action capability/account permission. Read-only work remains separate from order access.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### AUTO04 — Runs, logs, approvals and recovery

Scope: Workflow run or exact account-bound deployment.

Prerequisites: Valid graph/runtime configuration and explicitly supported scoped capabilities.

Layout: Trigger, scope, each step’s result, outputs and timestamps.; Failure, partial outcome, retry/cancel and current approval queue.; Link account fills to their book and research/data jobs to their own artifacts..

Visible controls/fixtures: Run: Operation identity, trigger and destination; Actions: Inspect / supported cancel-retry / approvals; Unknown order: Reconcile; do not duplicate submit.

Actions: Inspect a run; Resolve approvals/failures; Retry only supported idempotent steps. Connects to AUTO01, AUTO02, WS09, SH02.

- **ready:** Runs, logs, approvals and recovery: correct scope resolved. Next: Inspect a run.
- **empty:** No workflow, run or deployment yet. Offer a draft or supported template; do not imply activation.
- **loading:** Loading Runs, logs, approvals and recovery for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep step logs and operation identity. Retry only supported idempotent steps; reconcile ambiguous order outcomes first.
- **stale:** Show last observed runtime/source state with timestamp, not a green Running claim from saved configuration.
- **partial:** Show each step/approval/child-account outcome. Stop does not imply cancel or close completed market activity.
- **unauthorized:** Explain the exact missing action capability/account permission. Read-only work remains separate from order access.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### AUTO05 — Strategy bot deployments and operations

Scope: Workflow run or exact account-bound deployment.

Prerequisites: Valid graph/runtime configuration and explicitly supported scoped capabilities.

Layout: Frozen strategy revision, parameters, instrument/source and paper/demo/live account.; Running/stopped/error state, logs and account risk settings.; Separate Stop bot, Cancel orders and Close positions; closing a chart does not control backend lifetime..

Visible controls/fixtures: Revision / target: Strategy r1 / params v1 / Account A Demo; Data / instruments: Pinned mapping and eligible sources; State: Draft / running / stopped / error; chart visibility independent; Separate controls: Stop bot | Cancel orders | Close positions.

Actions: Prepare a deployment from a candidate; Explicitly start/stop eligible runtime; Inspect its account activity and journal. Connects to SB09, WS03, WS05, WS09, AUTO04.

- **ready:** Strategy bot deployments and operations: correct scope resolved. Next: Prepare a deployment from a candidate.
- **empty:** No workflow, run or deployment yet. Offer a draft or supported template; do not imply activation.
- **loading:** Loading Strategy bot deployments and operations for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep step logs and operation identity. Retry only supported idempotent steps; reconcile ambiguous order outcomes first.
- **stale:** Show last observed runtime/source state with timestamp, not a green Running claim from saved configuration.
- **partial:** Show each step/approval/child-account outcome. Stop does not imply cancel or close completed market activity.
- **unauthorized:** Explain the exact missing action capability/account permission. Read-only work remains separate from order access.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Runtime stopped with local engine/bridge. Reconcile original account before writes resume; chart open/close never starts a second deployment.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SET01 — Account and application preferences

Scope: Global configuration or explicitly selected provider/account; profile bindings stay contextual.

Prerequisites: Applicable local/app/admin privileges; configuration never establishes observed adapter health.

Layout: Keep account/security, alerts, appearance, email and existing system controls.; Make global versus portfolio settings clear.; Provide optional account setup and a return to the current work..

Visible controls/fixtures: Account tabs: Account · Alerts · System · Theme · SMTP · TOTP; Settings hub: Account, Connections & Data, Developer API, System, optional AI.

Actions: Change relevant preferences; Manage account security; Return to Settings or the previous work. Connects to SET02, SET04, SET05.

- **ready:** Account and application preferences: correct scope resolved. Next: Change relevant preferences.
- **empty:** No provider/credential/dataset configuration. Offer only the relevant setup; preserve local work.
- **loading:** Loading Account and application preferences for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep unsaved explicit edits and display server/validation errors; do not announce success before persistence acknowledgement.
- **stale:** Distinguish saved configuration from current process configuration and measured health; explain restart requirements.
- **partial:** Show which credentials/capabilities/datasets loaded or validated and which did not; do not activate missing capabilities.
- **unauthorized:** Explain exact account/admin/provider prerequisite. Do not remove unrelated journal or research access.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SET02 — Connections and account/provider setup

Scope: Global configuration or explicitly selected provider/account; profile bindings stay contextual.

Prerequisites: Applicable local/app/admin privileges; configuration never establishes observed adapter health.

Layout: Choose connection purpose: account history, market data, research data or execution.; Show provider/platform, observed status, supported permissions and account identity.; Separate global connection registration from per-environment source/account bindings..

Visible controls/fixtures: Purpose: Market data | account history | research | execution; Family: Crypto exchange | brokerage | retail terminal | data provider; Identity / capabilities: Observed account identity and granted scope; Next: Bind to environment/book; preserve original return task.

Actions: Connect a supported crypto exchange, brokerage or terminal bridge; Grant only needed supported capabilities; Map an account/source to the intended environment/book. Connects to WS03, WS12, SH01, FND01.

- **ready:** Connections and account/provider setup: correct scope resolved. Next: Connect a supported crypto exchange, brokerage or terminal bridge.
- **empty:** No provider/credential/dataset configuration. Offer only the relevant setup; preserve local work.
- **loading:** Loading Connections and account/provider setup for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep unsaved explicit edits and display server/validation errors; do not announce success before persistence acknowledgement.
- **stale:** Distinguish saved configuration from current process configuration and measured health; explain restart requirements.
- **partial:** Show which credentials/capabilities/datasets loaded or validated and which did not; do not activate missing capabilities.
- **unauthorized:** Explain exact account/admin/provider prerequisite. Do not remove unrelated journal or research access.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SET03 — Market history and data management

Scope: Global configuration or explicitly selected provider/account; profile bindings stay contextual.

Prerequisites: Applicable local/app/admin privileges; configuration never establishes observed adapter health.

Layout: Keep watchlist/download jobs, schedules, catalog and CSV/Parquet import/export.; Add source, instrument identity, range, interval, quality and dataset version.; Provide task-specific Open in chart / Use in replay / Use in backtest links..

Visible controls/fixtures: Keep existing Historify: Watchlist · schedules · jobs · catalog/import-export; Dataset details: Source, instrument, timezone, interval, quality/version; Actions: Open chart | use in replay | use in backtest.

Actions: Import/download entitled data; Inspect gaps and version/coverage; Select an existing dataset for the current task. Connects to SH01, WS04, WS06, SB05.

- **ready:** Market history and data management: correct scope resolved. Next: Import/download entitled data.
- **empty:** No provider/credential/dataset configuration. Offer only the relevant setup; preserve local work.
- **loading:** Loading Market history and data management for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep unsaved explicit edits and display server/validation errors; do not announce success before persistence acknowledgement.
- **stale:** Distinguish saved configuration from current process configuration and measured health; explain restart requirements.
- **partial:** Show which credentials/capabilities/datasets loaded or validated and which did not; do not activate missing capabilities.
- **unauthorized:** Explain exact account/admin/provider prerequisite. Do not remove unrelated journal or research access.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SET04 — Developer API and integration access

Scope: Global configuration or explicitly selected provider/account; profile bindings stay contextual.

Prerequisites: Applicable local/app/admin privileges; configuration never establishes observed adapter health.

Layout: Keep developer access key management separate from broker credentials.; Explain which scripts/webhooks/integrations use this access.; Keep approval-mode and authorized integration configuration reachable..

Visible controls/fixtures: Access: Developer key, separately from broker credentials; Consumers: Scripts, webhooks and authorized integrations; Controls: Existing reveal/copy/regenerate and approval settings; Recovery: Expired access explains reauthentication without abandoning current task.

Actions: Inspect/manage authorized developer access; Configure supported integrations; Return to Settings. Connects to AUTO02, AUTO04.

- **ready:** Developer API and integration access: correct scope resolved. Next: Inspect/manage authorized developer access.
- **empty:** No provider/credential/dataset configuration. Offer only the relevant setup; preserve local work.
- **loading:** Loading Developer API and integration access for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep unsaved explicit edits and display server/validation errors; do not announce success before persistence acknowledgement.
- **stale:** Distinguish saved configuration from current process configuration and measured health; explain restart requirements.
- **partial:** Show which credentials/capabilities/datasets loaded or validated and which did not; do not activate missing capabilities.
- **unauthorized:** Explain exact account/admin/provider prerequisite. Do not remove unrelated journal or research access.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SET05 — System, diagnostics and optional AI

Scope: Global configuration or explicitly selected provider/account; profile bindings stay contextual.

Prerequisites: Applicable local/app/admin privileges; configuration never establishes observed adapter health.

Layout: Keep market calendars/timings, diagnostics, monitoring and applicable access controls.; Keep optional AI provider/model configuration and its explicit permissions.; Expose backup/restore, storage health and maintenance through the shared recovery surface..

Visible controls/fixtures: System: Calendars, timings, diagnostics, monitoring and applicable access controls; Optional AI: Provider/model/configuration and explicit permissions; Recovery: Storage health, complete backup/restore and maintenance.

Actions: Diagnose a failed job/connection; Configure optional assistance; Open local backup/recovery. Connects to SH02, SH03.

- **ready:** System, diagnostics and optional AI: correct scope resolved. Next: Diagnose a failed job/connection.
- **empty:** No provider/credential/dataset configuration. Offer only the relevant setup; preserve local work.
- **loading:** Loading System, diagnostics and optional AI for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep unsaved explicit edits and display server/validation errors; do not announce success before persistence acknowledgement.
- **stale:** Distinguish saved configuration from current process configuration and measured health; explain restart requirements.
- **partial:** Show which credentials/capabilities/datasets loaded or validated and which did not; do not activate missing capabilities.
- **unauthorized:** Explain exact account/admin/provider prerequisite. Do not remove unrelated journal or research access.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SH01 — Instrument, source and saved-data picker

Scope: Original task + its book/account/project/run/data IDs.

Prerequisites: Capability-specific storage/source access; preserve the originating task.

Layout: Resolve the exact instrument/listing/contract and requested data capability.; Show saved/live options, coverage, freshness, entitlement and compatibility.; Keep the requested chart/replay/experiment context when setup or download is needed..

Visible controls/fixtures: Return task: Paper run P1 / BTC/USD spot; Requirements: 1-minute UTC bars; requested range + warmup; Primary action: Choose D1 and return to P1; never switch instrument silently.

Actions: Choose compatible data; Import/download missing history; Return to the same pending task. Connects to WS04, WS06, SB05, FND02, SET02, SET03.

- **ready:** Instrument, source and saved-data picker: correct scope resolved. Next: Choose compatible data.
- **empty:** Nothing compatible is available. Offer import/source setup or restore dependency resolution, then return to the same task.
- **loading:** Loading Instrument, source and saved-data picker for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Dataset D1 is selected for run P1. Return to that run and range; leave another open environment unchanged.
- **failed:** Keep selection, manifest and return context. Retry the affected read/validation/job without retargeting.
- **stale:** Show cached coverage or job last-observed time and explain what may be unavailable.
- **partial:** Expose missing datasets, manifest entries or job outcomes; do not silently substitute versions or infer success.
- **unauthorized:** Explain the exact dependency or capability. Offer a compatible allowed resource or safe return without unrelated execution setup.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SH02 — Activity, jobs and notifications

Scope: Original task + its book/account/project/run/data IDs.

Prerequisites: Capability-specific storage/source access; preserve the originating task.

Layout: Scoped queued/running/failed/stale work with last successful outcome.; Source/account/book/project/run identity and a route to the owning section.; Progress, supported cancel/retry, interrupted recovery and actionable notifications..

Visible controls/fixtures: Activity: Scope, correlation identity, progress and last successful outcome; Actions: Open owner / supported cancel/retry / resolve interrupted work.

Actions: Track a sync, download, research refresh or experiment; Inspect the owning job; Recover without losing the original task. Connects to WS12, SET03, SB05, FND05, AUTO04.

- **ready:** Activity, jobs and notifications: correct scope resolved. Next: Track a sync, download, research refresh or experiment.
- **empty:** Nothing compatible is available. Offer import/source setup or restore dependency resolution, then return to the same task.
- **loading:** Loading Activity, jobs and notifications for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep selection, manifest and return context. Retry the affected read/validation/job without retargeting.
- **stale:** Show cached coverage or job last-observed time and explain what may be unavailable.
- **partial:** Expose missing datasets, manifest entries or job outcomes; do not silently substitute versions or infer success.
- **unauthorized:** Explain the exact dependency or capability. Offer a compatible allowed resource or safe return without unrelated execution setup.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

### SH03 — Backup, restore and storage recovery

Scope: Original task + its book/account/project/run/data IDs.

Prerequisites: Capability-specific storage/source access; preserve the originating task.

Layout: Choose a complete local backup with data/dependency manifest; exclude secrets by default.; Validate a restore, show conflicts and offer recovery before replacing records.; Include books, environments, chart layouts, research, projects and results under a defined policy..

Visible controls/fixtures: Flow: Export → validate manifest → preview restore → commit/recover; Conflicts: Show owner/version/dependency issues before replacement; Secrets: Excluded unless separately authorized credential recovery exists.

Actions: Export a full backup; Validate/restore on a clean installation; Recover an interrupted migration. Connects to WS01, WS08, SB01, FND08, SET05.

- **ready:** Backup, restore and storage recovery: correct scope resolved. Next: Export a full backup.
- **empty:** Nothing compatible is available. Offer import/source setup or restore dependency resolution, then return to the same task.
- **loading:** Loading Backup, restore and storage recovery for this scope. Keep return context; disable duplicate mutations, with cancel/back available.
- **saved:** Expected production behavior: announce saved only after authoritative persistence; retain stable IDs and link to the owning record.
- **failed:** Keep selection, manifest and return context. Retry the affected read/validation/job without retargeting.
- **stale:** Show cached coverage or job last-observed time and explain what may be unavailable.
- **partial:** Restore manifest lacks dataset D1. Restore available records and mark dependent reruns unavailable; request the exact dependency, not latest data.
- **unauthorized:** Explain the exact dependency or capability. Offer a compatible allowed resource or safe return without unrelated execution setup.
- **unsupported:** Explain the unsupported instrument/source/action or contract version. Offer a supported alternative without guessing data or permissions.
- **interrupted:** Preserve the last durable state and draft/operation identity. Reopen the owning task and offer supported recovery, not a new duplicate operation.
- **dirty:** If edits exist, keep a draft bound to this scope. Prompt before abandoning it; a scope switch cannot retarget it. Read-only views have no edit draft.
- **offline:** Keep available local/cached records readable. Mark remote freshness and queue or defer only supported work; do not submit hidden writes.

Focus: entry → Screen heading; dialog title for an opened modal; failed → Error summary then offending field/row; partial → Coverage/validation summary; saved → Keep current action focus with polite save status; handoff → Target heading or expanded record; Back restores origin/filter context.

Narrow layout: Stack secondary content; preserve explicit scope and primary action; tables scroll within their region; labels remain accessible. Keep original chart/journal responsive patterns.

## Data and evidence boundary

The same contract JSON drives the review wireframes and state controls. Numeric values are labelled fictional design fixtures. The one-trade report uses price 100 → 110, one unit, USD 1 commission per side, gross 10, costs 2, net 8 and ending cash 1,008 from 1,000. This arithmetic is not a market-performance claim. Missing providers/credentials and live execution remain downstream work.
