# Original screens: journal books, chart and sync

Latest user clarification: [profiles are environments; Journal and Chart are focused workspaces, while Open manages the portfolio](ENVIRONMENT_AND_MODULE_WORKFLOWS.md). This supersedes earlier book-card and journal-header proposals below. One account per connected book and separate manual books remain unchanged.

Reviewed 2 November 2026 against the running original app at `http://127.0.0.1:5000/workspace` and its React source. This is a proposed change specification, not an implemented feature or an accepted P00 gate. [Annotated original screenshots](original-screen-review/index.html) accompany this document. [Controlling scope](EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md).

## Ownership decision confirmed by the user

“Each book belongs to exactly one account, with separate books for manual records.”

A connected book has exactly one verified external account identity. An account can have several observations of its history—statement, terminal, API—without creating extra books or counting the same execution twice. Each source must resolve to that same account. Accounts with different logins, servers or environments require separate books; a display name is not sufficient identity. A manual book has no external account binding and holds manual records. Notes and reviews on a connected trade remain allowed; they do not turn the book into a manual ledger.

Recommended first-release constraint, still a proposal: one active connected book per canonical account. If the user reconnects the account through another provider, offer the existing book rather than silently creating another. Multiple books for the same account and transfers between manual/connected books need separate reviewed rules. A manual book must never be silently rebound to an account. Practice uses its own simulated account/run scope and stays separate from external-account results.

Keep existing profile/portfolio IDs as compatibility inputs. Do not migrate data or rename tables during this review. An execution/copy channel and a chart workspace are separate concepts from a journal book: one copied decision can produce fills in several accounts, and each account's fills go to its own book. The chart can inspect a selected book without becoming the owner of its history or a required background worker.

## What the original application already gives us

- The workspace already has useful cards and direct Chart / Journal / Open actions.
- Profile headers already keep name, currency, tabs and an Open chart action together.
- Journal trades, daily moods and practice sessions already filter on `portfolioId`. Keep Overview, Trades, Calendar, Breakdown and optional Mind, including their current visual hierarchy.
- Manual entry, expandable trade details, CSV export and local persistence exist. CSV export is a filtered trade export, not a complete restorable book backup.
- The chart already has the desired toolbar, rails, multi-pane layouts, drawings, indicators, scripts, strategy/backtest panels and trading dock. Keep them.
- The profile-to-chart link already carries a profile ID and name; the terminal displays a back link. Existing symbol/exchange deep links can focus an instrument.
- Connections already offers account identities, terminals and execution/copy settings. The screen itself correctly states that these records are local configuration and that auto-sync is not implemented.

## Screen 01 — Workspace and environment cards

Observed: `/workspace`, `TraderWorkspace.tsx`. The heading is Trading profiles; the two paths are Live trading and Paper & replay. Live cards count destinations and say Not connected when there are none. This makes a valid manual journal look unfinished.

Keep the profile card grid, existing spacing and direct Chart / Journal / Open actions. Each profile is an environment. Live loads eligible connected data; Paper prepares saved history and a simulated account/run. Chart opens the original terminal; Journal opens a focused book; Open manages portfolio Overview, Connections and Settings. Retain existing profile/replay IDs; migration/classification is P01/P02 work, not a label-only conversion.

Each card shows environment name, paper/live context, truthful data readiness and useful results. Resolve its primary account/book explicitly; each connected journal book records one account. Manual journal use retains a clear standalone entry without required feed or broker setup. Combined analytics remains an optional explicit selection view, never the default journal or a replacement book. Execution copy destinations do not become a combined multi-account journal.

Acceptance: selecting A then B opens genuinely separate entries, notes, settings, filters and calendars; both Chart and Journal actions retain the selected identity. No connection prompt blocks a manual book. An account appearing through a second provider is resolved rather than counted twice.

## Screen 02 — Existing creation dialog

Observed: New profile opens a three-step dialog whose first choice is Live trading channel or Replay project. A later Just create the profile route exists, but standalone journaling is hidden behind live-trading language.

Keep the three-step dialog and its visual structure. Live and Paper remain environment choices; refine their data/readiness setup. Name, timezone, currency, defaults and optional mindset remain useful. Offer explicit standalone/manual-journal entry rather than hiding it behind live execution setup. The detailed source-book setup paths below remain available in those appropriate contexts, not as a replacement for all profile creation:

- Manual: review and create; arrive in the existing journal with Log trade and Import manual records. No broker or feed requirement.
- Account: select or verify one existing/new account, or identify it from a supported statement. Then confirm book/account mapping and history range before committing. If verification is unavailable, preserve an explicitly incomplete setup draft; do not invent a connected account or require live-execution permission.
- Practice: retain the existing project/run path, with simulated account and dataset requirements specified in the practice package.

Connected-account currency is sourced from verified account data; reporting currency must not relabel its money. Manual CSV records remain explicitly manual; statements claiming broker history need account and provenance verification. Back/cancel preserves useful draft input, and repeated submit cannot create duplicate books. Do not default users into a fabricated simulator destination to make a book seem ready.

## Screen 03 — Book header and overview

Observed: `/workspace/profiles/1`, `ProfileShell.tsx` and `TraderProfileDetail.tsx`. The header/navigation is already useful. Channel setup currently tells everyone to add a destination, choose its chart data and enable a drawdown guard. Broker balance is the first metric even for a user keeping only manual records.

Keep the management header position and action placement. Its primary tabs become Overview, Connections and Settings; Journal and Chart are shortcuts to focused workspaces. Paper run preparation/list links can live in Overview, preserving existing runs. Show environment mode and authoritative account context. Keep ID-based routes internally. Tailor setup to the environment: saved data/run readiness for Paper, verified account/feed/history for Live, and log/import/review for standalone manual journals. Copy/risk controls remain execution-channel configuration.

Preserve the metric layout. The balance tile needs meaningful type-specific content: Manual records—no broker balance, or the selected account's last verified balance with observation time. Journal closed P&L is separate from balance, equity, deposits and withdrawals. Missing history means partial coverage, not zero activity. A count of saved chart workspaces/templates must say whether it is global or linked to this book; current catalog counts do not establish book ownership.

## Screen 04 — Journal overview and review tabs

Observed: `/workspace/profiles/1/journal`, `TraderJournal.tsx`. Preserve the current dashboard, filters, journal tabs, calendar, breakdown and optional mindset UI. Remove the outer `ProfileHeader` and its portfolio Overview / Journal / Connections / Settings navigation from this page. Replace it with compact book/account/environment identity and Back to Workspace, Open chart and Portfolio details links. The journal's own Overview remains its performance-review tab. Use a focused local-capability-aware frame without inheriting the current full-width broker gate.

Add a compact record-source/history summary alongside the existing description, without another application header: Manual records, or Account label · History through [timestamp] · Partial/Up to date/Needs attention. For account books, a Review sync link opens Connections and Sync now requests an eligible read-only job. Never display a working sync action until its backend exists. Missing broker balance should not make a manual journal appear broken.

Keep the strategy and period filters, but persist them per book and preserve them when returning from the chart. Define whether 1W/1M/3M mean relative to today or the latest trade; the current source anchors to the latest closed trade. Prefer explicit as-of dates, not a silent interpretation. Apply the book's timezone consistently to calendar/day/hour views; source timestamps retain timezone/offset provenance. Blank statistics must distinguish no observations, unknown values and partial history. Changing reporting currency/timezone needs previewed effects rather than relabelling old values.

Acceptance: a trade at a local-day boundary appears on the same day across list/calendar/breakdown; switching books never brings another book's filters or notes into the current view. Manual journals have no Sync pending requirement. Sync corrections update results while keeping reviews.

## Screen 05 — Trades and Log a trade dialog

Observed: existing Trades view has Log trade and Export CSV. Empty-state copy promises future connector records. Source shows expanded details and delete actions, but no trade edit/close workflow. `chartUrl` is an external screenshot link, not an instrument/time handoff into the terminal.

Keep the table, expandable detail and current dialog. On manual books add Import beside the existing actions; support Edit, Close trade and Review in the detail area. The dialog title includes the locked destination, for example Log a trade · London manual. Show replay-run controls only in eligible practice contexts. Do not pre-check an unrecorded plan review as if the user attested to it. Show entry time zone and explicit units; lots are not universal stock/share/crypto sizing.

An open manual trade needs no close timestamp or realised result. Closing it supplies actual close facts. Validate times, units, finite values, fees and optional fields; preserve the draft and explain failed saves. Do not silently redirect a dirty A draft when navigating to B. A successful save opens/highlights that entry in A; cancel leaves records unchanged.

Connected books use Review/Annotate and provenance-aware correction actions; manual financial records belong in manual books. Import account statements through the account-book source workflow. Preserve original broker facts and record overrides explicitly if that capability is later accepted. Keep CSV export; add a separate complete book export/restore in Settings rather than implying CSV restores notes, sources and settings.

Add Open in chart inside a trade's existing expanded detail, carrying book, entry, canonical instrument, time, timeframe and available evidence. Missing venue/contract mapping requests resolution; an EURUSD string alone cannot identify a universal instrument. No historical data means an honest unavailable-state choice, not today's chart presented as the trade's reconstruction.

## Screen 06 — Original chart terminal

Observed: Open chart reached the original terminal with the profile ID/name in its URL and a Back to Personal Portfolio link. Toolbar, rails, scripts, backtest/strategy controls and dock render. This session had no instrument selected; the screenshot contains no candles. This review does not certify data loading or execution.

Preserve the complete terminal layout and chart interactions. Extend the existing back-label area with compact book/account context and a Journal action/menu. Keep the chart workspace/layout identity distinct: changing a book never silently overwrites another saved chart document. Resolve the authoritative book from the ID; a mutable name or `profileKind` query string grants no account privileges.

Opening from a book retains that book. Opening from a journal entry additionally focuses the exact mapped instrument and historical time if coverage permits. The journal return action restores its trade/tab/filter/scroll context through a validated internal return target. Opening a global chart remains supported; its journal action asks for a destination instead of guessing the last opened book.

For manual books, Log to this book opens the existing manual dialog with known instrument/time/context and a chart-evidence link; it does not assert an execution occurred or guess P&L. For account books, capture a note or review confirmed fills; journal financial entries come from verified account history/execution reconciliation. Each copied account has its own child fill and book. An order submission, acknowledgement, partial fill and closed position are different events and must not each become duplicate closed journal trades.

Chart market data, history sync and execution authority are three independent bindings. A read-only sync account never enables order submission. The chart's existing Chart sync control means pane/crosshair/viewport coordination; do not reuse that label for account-history sync. Closing the chart must not stop a local history worker. Replay/live boundaries require server enforcement in the relevant implementation packages, not only a badge or URL.

## Screen 07 — Existing Connections tab

Observed: `/workspace/profiles/1/connections`, `TraderConnections.tsx`. Reusable account identities and terminals exist, but the screen leads with Add destination and “The chart is the master.” There is no read-only journal source, initial history preview, sync receipt or conflict review. On/off and terminal-running flags are stored configuration, not observed health.

Keep the Connections tab, existing page shell and useful account/terminal cards. Add Journal history first for account books, Chart data second, and retain Execution/copy controls in an explicit separate section/channel context. Do not require a copy destination just to fetch chart prices or journal history. A manual book has no account-history binding; its Connections content explains manual/imported records and may offer independent chart data, without offering silent account conversion.

The account-book flow is: choose supported provider → verify the exact account → show locked destination book and account → choose history range/timezone interpretation → preview coverage, duplicates and conflicts → commit import/binding → show receipt and journal entries. Another login routes to a different book creation flow, never into the current one. A second source for the same account reconciles existing events; unknown matches are held for review. Keep account credentials in the backend secret store and expose references/status only.

Each history source shows configured/enabled separately from verified health; last attempt, last success, covered range, current cursor, freshness and action-needed details. Allow Sync now, Pause and Disconnect with precise meanings. Pausing prevents future jobs; disconnecting keeps existing entries and notes. Neither action implies cancelling broker orders or closing positions. The first destination must no longer automatically define journal source and chart source together.

Sync states and recovery:

- Not configured: explain manual use or add a supported history source.
- Configured, not verified: verify account; never show Connected because a row was saved.
- Ready/queued/running: cached journal remains available; show progress only if measured. One job per binding is active, including multiple app windows.
- Needs reconciliation: preview non-conflicting progress and hold ambiguous items without double-counting them; policy for partial commits is explicit.
- Partial/stale: show actual coverage/missing ranges and correction/backfill action. Last success alone does not mean complete history.
- Authentication expired/terminal unavailable/service stopped: retain records and checkpoint; show the specific recovery action. Local terminal providers may require this PC/terminal; a remote API has its own requirements.
- Paused/disconnected: no future scheduled sync; cached book remains readable and exportable.
- Failed/cancelled/restarted: durable operation ID, checkpoint and receipt make retry idempotent; no generic success toast after a failed commit.

On opening the app, load cached books first and ask the local backend to catch up eligible account bindings. Scheduling does not depend on which book/tab/chart is visible. Specify exactly when the local service runs; if it is closed, no collection is promised. Market-data timestamps and completed history coverage are different signals.

## Screen 08 — Existing Settings tab

Observed: settings already stores name, timezone, currency, defaults and mindset preferences. Delete profile permanently cascades journal/session/mood/destination records; there is no complete backup/restore flow in this surface.

Keep the form. Add read-only book type/account identity and separate Archive, Export book and Restore/Import backup actions. Renaming changes presentation, not identity. Account rebinding is not an ordinary setting. Currency/timezone changes require explicit accounting/grouping semantics; broker account currency remains factual. Prefer archive for normal removal; before destructive delete show record/dependency counts and the backup route. Active jobs/deployments need a defined stop/detach/archive policy. Nothing silently reroutes to another book.

## Three connected journeys to review

1. **Manual book:** Workspace → existing creation dialog → Manual book → existing Journal → Log/open/edit/close/review → Open in chart → unchanged terminal → return to the same entry. No account, feed or broker setup blocks record keeping; missing chart data has its own recovery.
2. **One-account book:** Workspace → Account book → verify account A → history preview → reconcile → commit → A Journal. Open chart carries A context. While viewing manual Book B, A's eligible sync still commits only to A. Reopen the app and see the same book/receipt; reconnecting a second provider for A cannot duplicate P&L.
3. **Chart/account handoff:** A Journal entry → exact instrument/time on original terminal → Journal return restores A's entry/filter. Execution-channel copy to account C produces separate child outcomes in C's book; it does not combine C's money into A's journal. No fills are inferred from a chart button press.

## Proposed implementation order after P00 review

1. **Contracts first (P01):** lock Manual versus Account book and single-account ownership; canonical account identity, source-event reconciliation, chart context/return target and persistence/migration contracts. Decide duplicate-book/account policy and practice mapping. Do not infer execution permission from a book.
2. **Durability (P02):** preserve existing IDs and browser data through a tested local-backend migration, per-book backup/restore and job receipts. Preserve independent review records and existing chart workspaces.
3. **Manual book slice (P03, supported by P18):** adapt the existing workspace/dialog/header wording and setup paths; implement original-journal edit/close/review/import and per-book state. Verify two-book isolation and failure recovery.
4. **Chart integration (P05):** compose existing profile and instrument deep-link helpers, add entry/time/evidence and return context, and reuse the manual dialog. Keep toolbar/rails/layout intact. This can be specified now; runtime acceptance depends on the relevant record/data contracts.
5. **History slice (P22/P07 with P03/P04):** read-only source capability and one certified initial adapter, preview/reconciliation, restart-safe worker and original Connections/journal status. Configure-only UI cannot satisfy this slice. Keep later adapters in their scheduled packages.
6. **Execution/copy integration (P11/P12):** distinct channel-to-account routing and per-account journal effects after risk, recovery and adapter checks. This is not a prerequisite for useful manual journals or read-only account books.

Detailed plans and tested slice evidence are required before implementation/acceptance; these are dependencies within the master roadmap, not claims that later packages are completed or a direction to skip P00/P01.

## Acceptance scenarios — all pending implementation

- [ ] **BOOK-01** A and B survive reload with separate records, notes, settings, timezone, filters and statistics.
- [ ] **BOOK-02** Manual book creates/logs/reviews without a broker, account secret or market feed.
- [ ] **BOOK-03** Connected book binds exactly one verified account; account B cannot be added to A's book.
- [ ] **BOOK-04** Existing profile records migrate with stable identity and a reviewed classification; no data loss or unverified binding.
- [ ] **ENTRY-01** Manual open → close → edit/review updates the same entry and consistent metrics; failed save retains draft and destination.
- [ ] **ENTRY-02** Invalid/mixed-unit/timezone imports show actionable errors; retry does not duplicate committed entries.
- [ ] **CHART-01** Original chart opens unchanged from A, resolves correct context and returns to A's selected entry/tab/filter.
- [ ] **CHART-02** Missing instrument mapping/history has explicit recovery; global chart requires a destination for journal effects.
- [ ] **CHART-03** Forged name/kind/account query strings cannot change account binding or execution authority.
- [ ] **SYNC-01** A's startup/manual sync commits only to A while B or another window is open; one job per binding.
- [ ] **SYNC-02** Statement/API overlap, late fees and repeated/corrected events reconcile without duplicated P&L or lost reviews.
- [ ] **SYNC-03** Interrupted jobs resume idempotently with coverage/receipt; partial/auth/offline states remain truthful.
- [ ] **SYNC-04** Pause/disconnect preserves records; chart closure does not stop the running local worker; stopped service promises no updates.
- [ ] **LIFE-01** Export/restore preserves ownership, reviews, provenance and links; archive/delete handles dependencies without rerouting.
- [ ] **COPY-01** One copied decision yields account-specific child outcomes/books; combined analytics avoids counting one strategy observation as several independent decisions.
- [ ] **ACCESS-01** Modified controls work by keyboard at narrow/wide sizes and announce async/error states.

## Evidence and limits

Nine original screenshots were captured from the running app: workspace, creation dialog, book overview, journal overview, Trades, Log a trade, Connections, Settings and chart. Existing sample data contained one empty Personal Portfolio and no replay project. No records, account settings, permissions, orders or connections were saved during this review. Dialogs were cancelled. Calendar/Breakdown structure was inspected in source; populated trade-row behaviour was inspected in source rather than fabricated in the user's book.

Source anchors: `TraderWorkspace.tsx` card and three-step creation; `ProfileShell.tsx:15` chart links; `TraderJournal.tsx:445` trade scope, `:466` moods/sessions, `:682` manual save, `:1996` delete, `:2034` screenshot link; `Trading.tsx:1176` profile back-link context and `:1515` header; `lib/trading/chartLink.ts:26` symbol/exchange parsing; `TraderConnections.tsx:560` local-configuration screen; `TraderProfileDetail.tsx:112` settings and `:152` delete; `useTraderData.ts` IndexedDB writes and cascades; `db.ts` persisted model.

Existing regression check: `vitest run src/lib/trader/metrics.test.ts src/lib/trader/profileModel.test.ts src/pages/workspace/ProfileShell.test.ts src/lib/trading/chartLink.test.ts` from `frontend`: **4 files / 26 tests passed**. These check the current implementation, not the proposed book/sync behaviour. No production source files changed. All P00 tasks and all acceptance scenarios remain unchecked pending implementation evidence and user review.
