# Audit 05 — Historical data, free access and offline workflows

Reviewed 2 November 2026. Source audit plus targeted existing frontend tests. No personal data, broker credentials or application code changed. This report assesses software behavior; it does not certify external provider pricing or data redistribution rights.

## Assessment

Chartly already has a useful local historical-data foundation. Historify uploads CSV/Parquet, downloads broker history, stores bars in DuckDB, maintains a catalog and export formats, and powers a separate full chart over local data. The main product gap is discovery and integration: that valuable foundation is hidden behind broker-oriented navigation and does not act as a selected dataset for a profile replay run. Do not describe local historical charting as nonexistent; connect and strengthen what exists.

## Five priority findings

### 1. Existing local-data value is broker-gated in the source route structure

`frontend/src/App.tsx:339–355` places Historify manager and historical charts inside FullWidthLayout. `frontend/src/components/layout/FullWidthLayout.tsx:14–20` redirects unauthenticated users to login and users without a broker to broker selection. Local journal routes deliberately avoid this gate. Historify upload and local chart reading need a local user/session boundary, but neither inherently needs an execution broker. This is a source finding, not a claim that the currently signed-in runtime was observed redirecting.

Recommendation: make Data Library a first-class local surface reachable from profile, chart empty state and replay setup. A user who has a CSV should be able to import and study it without an execution-account prerequisite. Preserve authorization and local access protections while separating them from broker selection.

### 2. Local-history charts exist but are a separate destination, rather than the profile's usable source

`frontend/src/lib/chart/feeds/historifyFeed.ts:132–175` implements a real read-only DataFeed from the local store. It deliberately omits live subscriptions and depth. `frontend/src/pages/HistorifyCharts.tsx:110–157` constructs the historical feed and custom-timeframe service; `:201–228` resolves catalog deep links to an available interval. `:283–304` renders HistorifyChartPane with this feed. Its page has no execution callback by construction, a good separation to retain.

By contrast, profile chart links point to `/trading` and not this local-data surface (`frontend/src/pages/workspace/ProfileShell.tsx:20–29`). The run uses a free-text dataSource planning field, not a stable dataset identity (`frontend/src/pages/workspace/TraderReplay.tsx:39`, `:79–92`). The chart specialist should own exact Trading run-context wiring conclusions.

Recommendation: one chart shell with a verified source/mode contract. Local historical bars, broker quotes and an optional external provider should be source adapters. Execution is separately Read only / Paper / Broker. A historical dataset must never acquire an order path merely because the user's broker session exists.

### 3. Import accepts a file but does not provide a trustworthy validation/reconciliation workflow

`frontend/src/pages/Historify.tsx:1328–1366` submits the file immediately with symbol, exchange and interval. Its import dialog around `:2860` offers no timezone or column mapping. `blueprints/historify.py:737–809` limits uploads to CSV/Parquet and 100 MB and uses a unique temporary file, which are useful safeguards.

`database/historify_db.py:1672–1768` supports case-insensitive headers and timestamp/date/time/datetime columns, detects milliseconds using the first timestamp, requires volume, coerces OHLC numeric, drops invalid OHLC rows, fills missing/invalid volume with zero, then upserts. It does not show a pre-commit preview, let the user choose timestamp timezone, validate high/low coherence, label missing volume versus zero volume, or show exact row-level errors before committing. Naive datetime strings have no explicit source timezone. Existing data on the same key is overwritten by `ON CONFLICT ... DO UPDATE` at `:694–710`.

Recommendation: upload → map columns and timestamp unit/timezone → preview candles → display accepted/rejected rows, duplicates, gaps and overlaps → choose replace/keep/version policy → commit. Do not silently treat unavailable volume as measured zero; support a nullable/unknown semantic where the market or file has no volume. Do not forbid negative prices categorically, since instrument semantics matter.

### 4. Data keys cannot distinguish sources or immutable replay versions

`database/historify_db.py:231–244` keys market_data only by symbol/exchange/interval/timestamp. Catalog `:261–271` stores first/last timestamps, count and last download time, but no provider/account entitlement scope, dataset version, import checksum, adjustment basis, price basis or quality report. Two users' or providers' bars under the same symbol key can replace one another; a replay rerun after a data correction cannot establish which version produced its result.

This is a local-first application, so it is not evidence of a deployed multi-user leak. It is a concrete limitation if multiple sources/accounts/users are introduced into the same backend.

Recommendation: Dataset + DatasetVersion identities with source, instrument, account/scope if private, native resolution, timezone/calendar, available range, adjustment/roll basis, imported-at, checksum and validation summary. Pin every replay to an immutable version and record transformation rules. Catalog coverage must include interior gaps, not only min/max/count. Keep private entitled feeds scoped rather than assuming every stored bar is globally shareable.

### 5. Global-market framing exceeds the current exchange/time conventions

`database/historify_db.py:1631–1635` supports Indian exchange codes plus GLOBAL_INDEX and CRYPTO; it does not offer distinct general FX, US equities or futures venue identities. Upload validation rejects other exchanges (`services/historify_service.py:924–932`). The UI permits only 1m and D storage (`frontend/src/pages/Historify.tsx` import dialog), while the backend VALID_INTERVALS accepts many native intervals (`services/historify_service.py:870–899`), so import capabilities are inconsistent.

`services/historify_service.py:475–482` turns date windows into timestamps using the host's local timezone. `historifyFeed.ts:20–29`, `:36`, `:63–70` explicitly compensates by padding a day. Server aggregation has hard-coded IST offsets (`database/historify_db.py:1088`, `:1184`). Those conventions may suit the original regional workflow but are not a sufficient global calendar model for FX, crypto, US daylight saving or exchange sessions.

Recommendation: canonical instrument/venue identifiers and source-provided aliases; UTC storage with explicit market/session timezone; instrument calendars; stable daily/weekly bar anchors; validated native interval import rather than forcing all files to 1m/D. Fix server window semantics rather than relying indefinitely on padded queries.

## Strengths to preserve

- Broker history download and local DuckDB persistence already exist (`services/historify_service.py:286` onward); local history is more durable than browser-only cache.
- CSV and Parquet import, sample templates and CSV/TXT/ZIP/Parquet export are implemented.
- Catalog-derived interval availability prevents opening a 1m-only instrument on an unsupported daily series (`HistorifyCharts.tsx:201–228`).
- The local feed is structurally read-only: no live subscription, depth or order callback. This is a sound basis for study and an isolated simulator.
- Background downloads have job progress, retry, pause/cancel and zombie recovery (`services/historify_service.py:1335` onward). These are useful operator tools, best kept behind a simpler user entry.
- The feed surfaces actionable load errors and preserves request cancellation (`historifyFeed.ts:152–170`).

## Proposed Data Library wireframe

Header: Data Library | Import history | Download from my connection.

Catalog rows: Instrument · Source · Native resolution · Coverage · Quality · Local availability. Each row offers Open chart, Create replay and Export. Detail drawer shows provenance, calendar, row count, range, gaps, volume availability and version history. Data source and execution account are never the same unlabeled selector.

Three entry routes:

1. **I have trades**: statement/journal import; this supplies journal facts, not candles.
2. **I have historical prices**: CSV/Parquet import; validate and persist dataset, open chart or start replay.
3. **I have a broker/platform feed**: connect read-only first, inspect capability/history limits, download/cache for permitted personal use; enable execution separately only when supported.

Optional public/provider feeds can be additional adapters after their actual coverage, limits and permissions are verified. Free application software does not imply universally free live exchange feeds or unlimited history. Do not make a paid feed mandatory for manual journal and imported-history practice.

## Acceptance checks

- Fresh local user imports history and opens a chart without selecting an execution broker.
- CSV source timezone, seconds/milliseconds and DST transitions produce expected UTC timestamps; invalid/ambiguous rows appear before commit.
- Two providers for the same instrument can coexist; a pinned replay stays reproducible after another import.
- Data Library shows native versus computed intervals and gaps; unavailable history gives a specific recovery action.
- Paper replay consumes only the selected local version and never sends broker orders.
- Complete local dataset backup/restore restores provenance and versions, rather than exporting only currently displayed bars.

## Validation performed

Ran existing Vitest suites `historifyFeed.test.ts`, `historify/timeframes.test.ts` and `historify/intervals.test.ts`: **3 files, 44 tests passed**. A requested catalog.test.ts path matched no file and contributed no tests. These are unit tests, not proof of a successful full UI import, external entitlement, provider connection or simulation correctness. No new tests or application changes were introduced.
