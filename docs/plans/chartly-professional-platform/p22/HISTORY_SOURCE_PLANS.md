# P22-T01/T06 — Engine lifecycle and per-source history plans

Decided 4 November 2026.

## Engine lifecycle (T01)

Events: `startup` (restore state, show cached records immediately),
`focus/resume` (request catch-up — coalesced per connection+account),
`reconnect` (resume from checkpointed cursor), `shutdown` (jobs stop;
checkpoints and coverage persist). One running job per
(connection, account) regardless of how many charts/tabs ask.

## Direct source: Kraken (initial, P08)

Auth: query-only API key (Phase B pending user's key). Coverage:
cursor-paged TradesHistory/Ledgers since account start (provider
retention applies); timestamps are provider UTC; units exact text.
Rate budget handled in the adapter (+4 counter model). Catch-up
checkpoints after each page; a partially fetched window is reported
as covered only up to the last completed page.

## Statement import

Existing statement/journal import paths remain the backfill method
for windows a provider cannot serve. Imported rows are observations
of source `statement`, joined to direct sources only through the
explicit alias map (T05) — never by time/price similarity.

## Myfxbook candidate

Third-party account-history service. Assessment: history access is
tied to Myfxbook account linking and their API terms; coverage is
whatever the linked account reports and can lag the broker. It is a
*supported-method candidate* in setup previews with its window
warning, but no adapter is certified until permitted test access
verifies auth, timezone basis, units and rate limits. A
Myfxbook-limited window is never presented as complete history —
statement/direct backfill remains the completion path.

## Privacy boundary

All sync state (events, cursors, conflicts, annotations) stays in
the local workspace store and in user-initiated backups. Nothing is
uploaded anywhere by this package.
