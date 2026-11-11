# Legacy preservation and classification

P01 maps contracts without changing records. P02 must implement export, preview, protected staging, stable aliases, atomic commits and verified recovery. The installed source is [trader DB v2](../../frontend/src/lib/trader/db.ts), its [data hooks](../../frontend/src/lib/trader/useTraderData.ts) and the separate [chart-workspace adapter](../../frontend/src/hooks/useChartWorkspaceCatalog.ts).

## Export scope and identity

Preserve the seven Dexie tables, original records/field names, DB schema version, browser origin, a persistent export-origin ID, export version, counts and content hashes. Multiple exports from the same origin reuse that origin identity. Different browser stores must not collapse equal numeric IDs. `legacy_alias`/`legacyAlias` produces `ChartlyTraderDB:<origin-id>:<table>` plus the exact safe integer key. The origin ID is a random persisted namespace without `:`, not an account credential, email or broker identity. P02 assigns random canonical IDs once per alias and retains the map across retries.

The raw source remains in migration staging/audit, separate from canonical events. Preserve all unknown legacy fields there; do not silently discard them or relax canonical schemas to accept arbitrary payloads. Staging/backup privacy rules apply to URLs, terminal paths, personal notes and attachments. Existing secret references remain references; credential export needs its own protected policy.

## portfolios → Profile plus explicit book associations

- `id`, name and timestamps map through the alias; name remains display text. `kind` (`live`/`replay`) is legacy intent, not verified execution mode. Current `needsClassification` remains a warning, not an identity proof.
- Currency/timezone, strategyTags, sessionLabel, defaultSymbol/defaultTimeframe, emotionTrackingEnabled and archivedAt are preserved preferences. Resolve timezone validity; never turn a display symbol into an Instrument ID without a provider/venue mapping.
- StartingBalance/legacyStartingBalance remain raw user values. A live profile's starting balance is not an observed deposit/equity history. A practice balance becomes canonical money only after decimal/currency review and validated run preparation.
- Profile-scoped explicit manual trades map to a separate manual book associated with that environment. Account-attributed source records map only after canonical account verification. One legacy profile can therefore require several book associations; no multi-account book is fabricated. Retain old profile/chart/journal URLs through aliases.

## practiceSessions → PracticeProject and pending run preparation

`id`, portfolioId, name, mode, market, symbol, timeframe, dataSource, rangeStart/rangeEnd, status, startingBalance, notes and timestamps all survive staging. Free-text dataSource, legacy Ready/Completed labels and the legacy mode names Replay/Backtest/Practice do not establish a dataset version, account ledger or completed experiment. Resolve instrument, timezone/range, source version, costs/engine and account/book before creating a RunManifest. Backtest research belongs to P21, not a guessed discretionary session.

## journalTrades → ManualTrade or verified account facts, then JournalEntry

- Keep id, portfolioId, optional sessionId/accountId, origin and all external identity fields. `externalId`, externalOrderId/externalPositionId/externalDealId retain their original namespace. Equal IDs from separate sources/accounts are not duplicates by themselves.
- Preserve openDate/closeDate and duration raw. A missing close time stays missing; Open cannot gain a fabricated close. Resolve calendar date versus instant and DST ambiguities before normalization.
- Preserve pair/timeframe, direction/lots, strategy/setup/tags, entryPrice/exitPrice, sl/tp, rr/riskAmount/rMultiple and result. Direction maps Buy/Sell only when explicitly known; “lots” without instrument contract size is not base quantity. Result and ratios are legacy assertions until P03's declared formulas recompute them.
- Preserve pnl/netPnl/grossPnl, commission/swap/fees/pips with their original presence. JavaScript numbers may already have lost precision. P02 must show conversion candidates with raw values and precision uncertainty; P01 never converts an imprecise float into certified decimal accounting. Unknown fees never become zero.
- Keep emotionalNotes, technicalNotes, otherNotes, emotion scores, preTradeState, conviction/plan/risk flags, rating and screenshot/chart URLs with the original trade/book mapping. Book reviews cannot overwrite source facts. Inline/blob attachments require a scoped attachment manifest/checksum; browser URLs alone are not portable backups.
- The classifier accepts only explicit unbound manual records as manual. Replay/simulator records need practice mapping; attributed connector/import/chart records need verified accounts. Missing/contradictory origin, mixed session/account bindings and invalid parents stay unresolved. Preview must disclose exclusions before any commit.

## dailyMoods → book-specific optional journal annotations

Retain id, portfolioId, date, state, mood/energy/stress scores, sleep/diet/caffeine/exercise and notes. These are user-authored local records, not account execution facts. The profile-to-manual/connected book preview must choose their review scope; do not duplicate private notes into every account book. Disabling Mind keeps history recoverable.

## brokerAccounts / terminals / profileDestinations

Keep every configured field and alias. Platform, brokerName, server, externalLogin and accountKind are candidate identity inputs; labels `prop`, enabled or copyingEnabled do not prove demo/live mode, account identity or execution eligibility. Currency and suffixes need adapter verification. Multiple sources/terminals for one verified account reconnect to its existing canonical account/book.

Terminal paths, discoverySource, lastSeenAt/running and assignedAccountId remain observed/configuration context, not a guaranteed active bridge. Preserve secretRef without resolving/exporting its secret in a domain payload.

Destination fields (portfolio/account/terminal IDs, copyExistingPositions, chart-data-source selection, suffix override, lot scaling/caps/noise/delay, comment policy, drawdown caps/reset and pausedReason) remain configuration intent. P07/P11/P12 validate their units, mode, risk and supported capabilities before any arming. Migration defaults every new execution authority to disarmed; it cannot start a process or resume a broker action from a browser checkbox.

## Separate chart workspace store

The installed library owns revisioned workspace/template catalogs through `createIndexedDbWorkspaceStorage` and `WorkspaceRepository`, namespaced `oa-trading:<legacy-account-key>`. Preserve complete native catalogs, workspaces, templates, recent/active IDs, autosave, drawings, pane/study attachments and revision numbers. Do not rename its account key into a broker account ID. P02 must inventory the installed library's actual DB/store version and related watchlist/drawing storage, export through its documented API and retain a native restore payload plus checksum.

`ChartDocumentReference` records the native namespace/document ID/catalog revision and optional canonical profile/book references. The canonical metadata is not a substitute for the native layout payload. Import to a clean installation must verify both layers.

## Non-browser seams retained for later owners

Legacy global auth broker/API-key, `appMode`, TradingDock/history requests, shared Python host/scheduler and OpenScript deployment files stay intact. P07/P11/P17 must migrate those bindings deliberately; a profile's connection settings cannot silently retarget a running deployment. Historify datasets/DuckDB and existing backend DBs enter P02's wider inventory; this mapping claims no complete backup of them.
