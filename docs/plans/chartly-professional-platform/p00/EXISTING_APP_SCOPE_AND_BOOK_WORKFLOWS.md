# Existing app scope and journal book workflows

P00 design was accepted by the user on 2 November 2026. [Current decisions](P00_DECISIONS.md) and [acceptance](P00_ACCEPTANCE.md) take precedence over earlier pending-review wording in the historical scope discussion below.

Current product-wide specification: [App workflow and UI blueprint](APP_WORKFLOW_BLUEPRINT.md). Use it to review all sections and their handoffs. It preserves the original chart/journal and consolidates the latest decisions; no new production UI is introduced by that review.

Strategy Builder scope clarification: the user authorized a new dedicated Indicator/Strategy project experience; the old launcher was removed. This does not authorize replacing the original chart or journal. [Current builder review and ordered plans](STRATEGY_BUILDER_GAP_REVIEW.md).

Latest user clarification: [profiles are environments; Journal and Chart are focused workspaces, while Open manages the portfolio](ENVIRONMENT_AND_MODULE_WORKFLOWS.md). This supersedes earlier book-card and journal-header proposals below. One account per connected book and separate manual books remain unchanged.

2 November 2026. This is the controlling scope clarification for P00 and the development roadmap. It supersedes earlier instructions to build replacement chart/journal screens or adopt the standalone prototype shell.

## Confirmed user intent

Improve the original application in place. The original chart interface and the original journal presentation are the baseline the user wants to keep. Improve workflow, missing behaviour, data continuity and integration around them. Separate replacement applications were not the requested deliverable.

The standalone HTML screens under `p00/dist/` are exploratory artifacts only. They did not replace the production source UI, and are not an accepted design or the target for implementation. Stop extending or polishing that alternate application. Reuse any useful observations about errors or lifecycle, not its replacement shell.

## Conversation decisions to preserve

1. The product is free/open-source and useful without paid data or an execution account; provider coverage and privileges remain explicit.
2. Existing charts and journal contain substantial useful work. The task was to analyse sections and improve the workflows connecting them, initially in black and white.
3. Crypto exchanges, brokerages and retail platforms are connection families to support incrementally through verified capabilities.
4. Fundamental/company research, including evidence-backed company relationships, is an intended expansion. It is not a reason to replace the original chart.
5. Indicator coding, strategies, backtesting, robustness, bot deployments and automations must connect to existing chart/editor/runtime capabilities. Existing implementations are reuse points.
6. Each journal is its own book. A global ledger with an account filter is not an adequate replacement for that independent book model.
7. Journal books can be useful on their own: manual records, statements and read-only history updates are supported journeys independent of Chartly execution.
8. P00 remains open until the revised workflow has been reviewed against the existing app. A navigation harness or passing fixture tests cannot establish accepted product design.

## What to preserve in the original app

### Chart

Preserve the full chart terminal, its opening experience, viewport, toolbar, drawing rail, indicators, layouts, panels, trading dock and existing interaction patterns. Keep `Trading.tsx`, `ChartPane`, the terminal engine and related components as the implementation surface. Do not substitute the standalone Lightweight Charts preview for this terminal.

Changes should resolve missing book/run/source/account context, eligible data access, truthful mode/health and journal/research handoffs. Any visible additions must fit the existing controls and require a small reviewed diff. Do not rearrange the chart merely to fit the separate prototype.

### Journal

Preserve the original journal's overview, trade records, calendar, breakdown, optional mindset presentation and visual hierarchy. Retain the profile-scoped entry flow as the natural starting point for book ownership. Add missing editing/closing/import/review/recovery behaviour within those existing surfaces, not a new replacement ledger.

Current source already scopes journal trades, moods and sessions by profile: `frontend/src/pages/workspace/TraderJournal.tsx:372`, `:445`, `:466–467`. Summary calculations also filter by portfolio ID (`frontend/src/lib/trader/metrics.ts:178–183`). `ProfileShell.tsx:15–29` already builds scoped links to journal and chart. These are foundations to extend rather than discard.

Visual approval is not a claim that every workflow is implemented: trade correction, full recovery, source reconciliation and proper replay/journal wiring remain real engineering tasks from the audit.

## Journal book ownership within a profile environment

The profile/portfolio is the environment, and its journal is a distinct durable book. Existing profile-scoped records provide a compatibility starting point for that mapping, not proof that the entities are identical. Do not rename database tables or migrate IDs before P01/P02 define the mapping. A book has its own lifecycle; it is more than a transient account filter. Chart and Journal open focused workspaces; Open leads to environment management.

Each book needs:

- Stable identity, name, purpose and explicit live-history versus practice context.
- Its own entries, annotations, strategy/setup tags, optional mindset records and review history.
- Its own displayed accounting/timezone policy and explicit handling of source currencies.
- Its own selected sync bindings, inclusion rules, known coverage and source errors.
- Its own performance, calendar and breakdown scope.
- Links to chart views, practice runs, strategy revisions, research snapshots and source evidence without copying unrelated records.
- Archive, export and restore semantics that preserve those links.

Manual books need no connected account. Manual financial entry belongs in a manual book; connected-account statements and sync belong in the book for that verified account. Every manual/import/sync action has one explicit destination book. Starting from inside a book preselects that book; global actions must ask for a destination. Never route new records to whichever book happens to be open when a background job finishes.

User decision confirmed during the original-screen review: each connected journal book belongs to exactly one account; manual records live in separate manual books. Several sources may describe that same account, but different accounts require separate books. Manual books have no external account binding. Keep practice/simulated account scope separate. Recommended initial policy, pending review: one active connected book per canonical account, resolving repeated providers into that book rather than duplicating it.

## Record and source boundaries

Keep canonical account execution facts and source observations distinct from book-specific annotations. A statement, terminal history and third-party service can describe the same execution; they must not create duplicate financial results within a book.

Book membership is explicit. A source/account's data never leaks into other books because of a global API key, shared filter or last-selected page. If later allowing one account in multiple books, define inclusion rules and combined-report deduplication before enabling it. Do not silently create copies or synchronize reviews across independent books.

Corrections to confirmed source facts preserve provenance and book annotations. A user changing a strategy tag, daily note or lesson in Book A must not edit Book B's independent review. Manual financial overrides need explicit original/override history rather than impersonating a broker correction.

Practice runs have their own balances, clocks, datasets and simulated events. Their journal entries belong to the selected practice book/run. Real-history results never silently combine with practice results. Combined analytics are an explicit view over selected books and currencies, not the default journal.

## Workflows to repair in place

### 1 Open and use one book

Existing Workspace/profile list → select Journal on an environment card → its focused book. Open instead leads to portfolio Overview, Connections and Settings; those tabs do not appear inside Journal. The journal name, identity and scope persist across its own tabs and actions. Creating another book produces independent records/settings, not a second view of the same global journal. Book switching preserves dirty drafts and never reassigns an import/run/deployment.

### 2 Manual entry and statement import

Inside manual Book A → add or import manual records → validate timestamps/units/currency → commit to A → inspect the result in the existing Trades view → review through the existing journal presentation. Account statements instead enter the connected book for their verified account, with source reconciliation. Open manual trades can be closed later; notes can be added/corrected without delete-and-recreate. Duplicate import prevention and correction receipts retain target book identity after navigation/restart.

### 3 Read-only journal synchronization

Inside Book A Connections → choose supported history source → verify external account → confirm source-to-book mapping and inclusion policy → initial backfill/reconciliation → journal update. Cached records load first; the local backend performs one eligible catch-up job while running. Last success and known coverage are different states.

Opening Book B or closing the chart cannot redirect or stop A's account-history job. Pausing/disconnecting a source preserves existing book records. Source overlap must be reconciled before counting P&L twice. Provider-limited history requires visible backfill gaps; no promise of instant complete updates.

### 4 Existing chart and journal handoff

Book A → original Open chart action → unchanged chart terminal with explicit book/source/run context → journal capture or confirmed execution association → A's existing journal. The chart already has a book/profile back link; make the underlying binding real.

Opening a journal trade in the chart must carry instrument, timestamp, mode and available evidence. If historical bars or saved chart state are absent, explain that before displaying current prices as if they reconstructed the original trade. A globally opened chart remains usable; its journal action explicitly chooses a book instead of guessing.

### 5 Strategy and practice integration

Use the existing chart script/indicator panels and related strategy tools. Preserve the path write/save/apply on the chart. Add explicit versioned project/test/deployment identity where missing. An indicator calculates; rules define strategy orders; a deployment chooses runtime/account/environment. Attaching a view never starts duplicate bots.

Saved tests and manual replay runs link to an explicit practice book. Strategy code, inputs, dataset/engine versions and costs remain attached to the experiment; results persist and hand off to the correct journal. Stress testing extends the accepted experiment contract, without replacing the chart interface.

### 6 Fundamentals integration

Design this new/expanded area to complement the existing app. Company/asset search resolves canonical identity; overview/financials/report/relationships link back to the original chart and to a chosen book entry or strategy hypothesis. Relationships need type, direction, reporting period, publication availability and exact supporting evidence. Basic Yahoo/yfinance coverage is a candidate input, not proof of a full client/supplier graph or an already-connected provider.

### 7 Automation and execution

Existing Flow/scripts/webhooks/strategy runtimes retain their useful UI and recovery mechanisms. Bind each executable workflow/deployment to its account/environment/risk policy and explicit destination book for confirmed journal effects. A current chart selection or a book's read-only source is never execution authority.

One decision copied to multiple accounts has separate child outcomes. Book views must distinguish strategy decisions from money per account rather than accidentally multiplying the number of independent strategy observations. Unknown broker submissions reconcile before retry. Stopping automation, cancelling orders and closing positions remain distinct actions.

## Failure cases that must be covered

- A startup sync finishes after the user changes books: records still go to the configured book.
- The same account/statement is added to a second book: show policy/conflict; never silently merge or duplicate combined totals.
- An import or save fails: preserve draft, target identity and operation ID; no generic success.
- A source corrects fees or history: execution provenance updates while independent review notes remain intact.
- A chart opens from a replay book: no live write path can be selected implicitly.
- Two charts inspect one deployment: one runtime and one set of execution effects.
- A book is archived/deleted with source jobs/runs/deployments: show dependencies; do not orphan records or redirect execution.
- Backup/restore finds missing data/artifact/source dependencies: preserve IDs and explain unavailable actions without substituting new inputs.
- Different book currencies/timezones: correct grouping and explicit conversion; no relabelling historical money.
- A fundamental report is newer than the research date: historical test cannot use it.

## Decisions to review before implementation

1. Settled by the user: exactly one account per connected book, with separate books for manual records. No multi-account journal books.
2. Whether the same account can be included in several books in the first release, and how combined views deduplicate it.
3. Manual/imported/connected book terminology and how to expose the existing live/practice distinction without forcing execution setup.
4. Source corrections and manual overrides: preserve original account facts and reviews; do not turn connected books into mixed manual/account ledgers. Multiple sources for one account require reconciliation.
5. Minimal additions to the original chart/journal for context, review and sync state. Preserve layout until those concrete changes are reviewed.

These are unresolved contract/design details, not reasons to build a replacement application.

## Revised P00 deliverables

- Annotated walkthroughs of the original Workspace/profile/book, journal and chart routes, showing exact handoff/state changes.
- Book ownership and inclusion rules with worked examples for manual, imported, connected, copied and simulated trades.
- Existing component-to-workflow mapping and narrowly scoped UI changes; no alternate shell.
- New fundamentals screens and integration points considered separately from approved chart/journal presentation.
- Existing-app acceptance scenarios for scope isolation, sync, imports, chart context, practice, strategy identity and recovery.
- User review of the intended changes before P00 completion. Prototype model tests remain exploratory evidence only.

## Verification boundary

Production source was reread for profile-scoped journals, chart links and metrics. Original chart/journal source files were not replaced by the standalone prototype work. Current test evidence belongs to `USER_INTENT_REVIEW_EVIDENCE.md`; it does not certify the proposed book/source/runtime lifecycle as implemented.

## Original-screen review

The [screen-by-screen change specification](ORIGINAL_SCREEN_WORKFLOW_REVIEW.md) and [annotated original screenshots](original-screen-review/index.html) now record the running original UI, the confirmed one-account/manual-book rule, proposed changes and pending acceptance scenarios. No production workflow is certified by this review.
