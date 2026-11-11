# P03 web journal implementation plan

Owner: p03_ui. State: implemented; integrated browser acceptance is owned by the root agent. The existing Journal remains the base: Overview, Trades, Calendar, Breakdown and optional Mind; its chart and portfolio return links remain intact.

## Ordered delivery

1. **Read and scope before write.** Resolve the current profile and explicit journal book from the existing route. Backend imports and account journals require verified P02 local storage. Manual browser journals retain a compatible edit/review path; a failed backend proof never writes into the browser store. Keep source facts read-only for imported/connector/paper records.
2. **Trade lifecycle.** Add a focused detail/edit/review dialog from the original trade row. Manual trades can be edited, left open without a close timestamp, then closed later. Review annotations remain independently editable for source trades. Show source identity, history and exactly which fields are editable. Validate numeric/date fields before mutation; preserve the form and retry identity on failure. Archive and Undo use retained records.
3. **Capture correction.** Update the original capture form to permit an absent close time for Open, avoid fabricated risk, size and mindset values, and surface asynchronous save errors without clearing input. Persist interrupted manual form/detail drafts under principal/source/book identity; never resurrect another account's draft.
4. **Import journey.** Use a dedicated dialog within Trades with explicit destination book/account, provider name, currency, unit and timezone. Parse one supported normalized CSV mapping with saved mapping profiles. Preview rows, errors, deduplication, corrections, partial exits and totals before confirmation; do not accept a success toast as committed data. Reload the canonical workspace after the completed receipt.
5. **Review journey.** Unreviewed filtering, setup/tags/decision notes and optional mindset use current-book scope. Daily/weekly review notes show the actual included trades, timezone and period. Save durable review annotations with a revision and retained draft. Chart evidence uses explicit URL or permitted uploaded bytes; it never implies a connected market feed.
6. **One visible analytical scope.** Consume the shared metrics agent's scope/time helpers so result, direction, search, period, strategy, book and timezone apply to all views. Replace arbitrary score labels/radar/rankings with transparent sample counts and statistics. Never sum different currencies or infer copied decisions.
7. **Export and recovery.** Offer a complete book JSON export alongside normalized CSV, including annotations/history and source metadata as supported by P02. Explicitly label exports as the selected scope; full workspace backup remains in Settings. Archive Undo, backend retries and cache/restart recovery must preserve both source facts and reviews.

## API and shared-file boundary

Root owns `db.ts`, normalized journal backend, API/worker routes, recovery registration and acceptance evidence. The frontend client will use the agreed local `/api/local/v1/journal` contract with trusted account proof, CSRF, source origin, revisions and stable request IDs. UI owns this plan, `TraderJournal.tsx`, new adjacent journal dialogs, `journalClient.ts` and `useTraderData.ts` plus focused tests. The metrics agent owns shared accounting/time helpers and Combined Analysis.

## Required verification

- Original tabs/book isolation and exact chart/book/tab return still work.
- Manual create/open/edit/close/review/history retains notes and source records through failure/reload.
- Source facts remain disabled in review UI; imported corrections never erase notes.
- CSV mapping errors, duplicate import, corrected fee, partial exit and explicit destination are visible before commit.
- Review filters include exact trades; different currencies remain distinct; zero/unknown risk and mindset remain unknown.
- Archive/Undo, complete export, screenshot bytes, backend failure/draft retry and account switching are exercised with fixtures.
- TypeScript, focused DOM/hook tests and the production build pass; root inspects real isolated browser screens before package completion.

## Implementation and verification handoff — 2 November 2026

The original journal now provides manual create/open/edit/final close/partial exit and individual exit corrections, separate source-owned facts and user reviews, exact native amounts and size units, review history, chart evidence and retained byte attachments. Manual edits require a reason. Final-close profit is the whole position total; a partial exit records only that exit. Unchanged timestamps retain their original precision, while explicit local edits use validated IANA conversion and reject daylight-saving gaps/folds. A migrated known-quantity Open row does not need a pre-existing derived remaining-quantity field to offer partial exit.

The existing reporting UI consumes the shared book/currency/timezone/period/day/week/strategy/search/result/direction/review scope. Newly loaded records advance the reporting clock immediately, so a just-captured Open record does not disappear until the next timer tick. Component totals and displayed CSV preserve exact strings and unknown values. Replay starting balances retain their original currency; a filtered baseline is labelled starting balance plus shown P&L. No unsupported score or annualized return claim remains.

CSV mapping includes units/lots/shares/contracts/coins, explicit missing-cost policy, row/error/correction preview, saved mappings, exact retry identity and durable preview recovery. Imports and period review commits require verified P02 storage. Daily/weekly reviews preserve their actual included entry IDs and permit drill-through. Full-source JSON/CSV and local unsent-draft exports remain separately labelled. Unsubmitted local drafts are stored in the singleton `ChartlyJournalDrafts` IndexedDB, version 1, under principal/origin/book/kind and are not silently uploaded into a server backup. Attachment and request drafts retain their original bytes/body on failure; overflow never purges older work.

Final frontend regression: **39 suites / 448 tests passed**, covering P01 domain contracts, P02 persistence/recovery/account access, the original journal and chart return paths, Combined Analysis, navigation/settings, and P03 lifecycle/import/review/draft/accounting cases. TypeScript and Biome lint over all 11 changed production frontend paths passed. The production Vite build passed with the repository's existing large-chunk and Plot2D import warnings. Exact logs: `tmp/p03-final-frontend-tests.log`, `tmp/p03-final-typescript.log`, `tmp/p03-final-frontend-biome.log`, `tmp/p03-final-build.log`.

Root browser QA already exercised the isolated original UI through browser capture → P02 migration → partial exit → final close → correction with preserved notes/history. The root acceptance record owns the remaining import/evidence/recovery screens and final P03 completion decision; this handoff does not mark the package complete.
