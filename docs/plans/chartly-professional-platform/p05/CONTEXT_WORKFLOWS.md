# P05 original chart context and workflow implementation

The production chart stays at `/trading`. Its original toolbar, drawing rail, multi-pane grid, studies, search, bottom bar and dock remain the chart interface. P04 saved-data and replay-run links now enter this same terminal. Existing private `/historify/charts?datasetVersionId=…` links redirect here; connected legacy Historify retains its previous guard.

## Context and authority

`frontend/src/lib/trading/chartContext.ts` parses bounded record IDs, immutable dataset IDs, instrument/venue pairs, UTC seconds and allowlisted return routes. Actual profile, run, journal entry, book membership and saved evidence come from the current trader-storage binding. URL profile names and kinds never supply authority. `useResolvedChartContext.ts` waits for the authenticated principal's binding, requests only the selected owned version, aborts superseded requests and rejects stale responses.

A run's profile, symbol, native interval, checksum and inclusive UTC date window remain pinned. Restored dataset IDs are accepted only when the server attests the exact requested old ID and the retained checksum matches. A missing or inconsistent source produces a recovery screen before broker or chart resources initialize. An empty unbound Draft can explicitly acquire its first matching native source; a run with any journal trades, including archived trades, or a non-Draft run requires a new Draft instead. Binding does not change its status or finances.

The unbound connected terminal retains its existing authenticated instance execution model. Every profile-linked chart is analysis only until a future verified account adapter provides authority. A profile destination or connected selection is intent, not an authenticated account capability. A private dataset never inherits execution permission from an API key, Live mode or a profile label.

## Source and execution boundaries

`TradingTerminal.initialize()` selects the immutable branch before broker REST, intervals, session hours, trade feed, WebSockets, order subscriptions or book polling are created. The private branch uses the source's exact native identity, history feed, bounded UTC horizon and declared calendar. No resampling, foreign symbol, inferred tradable tick or account resource is supplied. Observed small prices determine display precision; unknown execution tick remains unknown. Supplied OI and known zero values survive the feed.

For connected profile analysis, price transport remains available while the global account trade feed, order-update subscription and periodic order book poll are not created. Central command guards reject direct execution calls as well as UI paths. Private and profile analysis retain the original DockShell and Orders/Positions/Trades/GTT tabs with read-only empty content and a reason, without mounting `useBlotter`.

The bottom bar and chart axis clock use the exact replay availability time when replay is active, otherwise the immutable source horizon. Historical candles therefore do not display today's clock or session status as their freshness. Connected unbound charts continue to use wall time. The compact source row identifies saved history, native interval, timezone, range, gaps and read-only status.

## Journals, evidence and historical return paths

Run chart links retain profile/run IDs, dataset selection and their replay-project return. Trade links retain actual trade and book IDs and the journal tab/filter return. A trade instrument takes precedence over unrelated profile defaults. Ambiguous connected venues require an explicit instrument selection.

`evidenceId` is resolved only from the selected actual trade or run's `chartEvidence`. Its immutable source/checksum, instrument, native interval and observed view govern reopening; a later profile default cannot replace that source. A run pin remains stronger than conflicting evidence. Reopening does not change the current profile default. The original chart restores observed chart type, timezone, viewport and exact replay availability. This is chart presentation, not a simulated execution checkpoint. The immutable saved image remains the original visual record.

An entry without matching saved history, including a connected-only capture, initially displays a missing-history state before connected provider initialization. Import/choose history and journal return remain available. Opening current connected prices requires an explicit analysis action, retains a persistent current-analysis explanation and grants no execution authority. Saved history outside the trade's unambiguous UTC opening time/day is rejected. A supported native history view focuses the trade time rather than showing unrelated recent candles; date-only records use a UTC day rather than inventing an exchange timezone.

The Journal rail calls the focused terminal's existing PNG capture. The capture key freezes pane, source, symbol, interval, viewport, type, timezone, drawings/studies and replay time/sub-step. A view change while rendering prevents attaching mismatched metadata. The journal agent's evidence panel and backend attachment boundary handle eligible records, revision checks, immutable append, recovery and export; they do not alter trade finances.

## Environments, persistence and recovery

`useChartWorkspaceCatalog.ts` keeps the authenticated account separate from its storage namespace. Original unbound named chart records retain `oa-trading:<principal>`. Bound environments use an encoded principal/profile/optional-run/source/version namespace. Changing profile or source hides the outgoing scope while its native owner cleans up. Renaming a profile does not change identity.

`scopedChartStorage.ts` puts legacy pane preference key names inside a recoverable `chartly.chart.preferences.v1:<scope>` envelope, including layout, sync, active side panel, rail, dock, drawing/study and chart state. Keys and values are allowlisted and bounded; credentials are not part of the envelope. P02 browser/native inventory and backup preserve these envelopes and named workspace catalogs. No new profile scope falls back to global pane preferences. The original keys and IndexedDB records stay intact.

Copy/import is explicit. For a new dataset-bound configuration, `chartWorkspaceTemplate.ts` retains layout and study settings, rebinds the native instrument and interval, and clears copied drawings, alerts and comparisons. A same ticker alone cannot prove provider, currency or adjusted-price equivalence. The source UI explains this before copy. Ordinary reopen of an owned named workspace keeps its original drawings.

P02 restored catalogs from an old principal remain visible in the source dialog's preserved-setup chooser. `chartWorkspaceRecovery.ts` uses only the currently owned workspace inventory, with at most 100 choices. An exact old profile/run scope, server-verified dataset alias and native pane identity can be explicitly restored into the current scope with drawings/studies. Unknown or different provenance copies a sanitized configuration template. Old namespaces and bytes remain unchanged; no recovered environment is automatically assigned.

The chart-only `chartView` record contains version, dataset version/checksum and selected bar opening time. Backend validation confines it to the actual profile/run source and saved window. Reopening resumes the existing workspace replay coordinator at the candle's availability time. This never creates fills, changes a run status or becomes a P06 account checkpoint.

## Lifecycle and verification evidence

`useDatasetChartSource.ts` owns the shared source lifetime. A generation plus microtask cleanup survives React StrictMode effect replay; actual source replacement/unmount disposes its outstanding work. Terminals own chart resources and do not prematurely dispose the source shared by multiple panes. Native comparison feeds have no connected socket or polling, and source-aware search cancels stale work on source/query/close/unmount.

The bounded chart request accepts at most 50,000 candles and at most 16 restored panes. Source/search/capture metadata and histories remain bounded by their typed adapters and server boundary. The resource/performance measurements and actual browser journeys are recorded in the P05 root acceptance evidence, separately from unit tests.

Frontend checks during integration:

- `tmp/p05-final-frontend-regression.log`: 2,262 tests in 201 suites passed, including original terminal/replay/UI, P02 persistence, P03 journal, P04 data and local storage paths.
- `tmp/p05-browser-followup-tests.log`: 101 tests in 8 suites passed after browser review: native chart/axis/bottom clock, recorded evidence source/view handoff, missing history and negative context cases, recovery, Draft binding and original Trading workflows. These overlap the broad run and must not be added to its total.
- `tmp/p05-context-typescript.log`: TypeScript project build passed.
- `tmp/p05-context-biome.log` and `tmp/p05-context-followup-biome.log`: owned production paths and later browser fixes passed scoped Biome.
- `tmp/p05-context-build.log`: Vite production build passed; existing large-chunk/dynamic-import warnings remain.

The fixtures do not call a broker, live provider or real order endpoint. Source, journal and backend evidence have their own additional checks and root acceptance record. P05 completion remains the root's tested gate; this document does not tick milestones or imply unsupported adapters, derived timeframes, live account execution or P06 simulation are implemented.
