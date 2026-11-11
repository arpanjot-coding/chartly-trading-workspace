# P04 original-screen frontend implementation

3 November 2026. Owner: P04 UI agent; acceptance: root. State: implemented and accepted after integrated tests and actual browser journeys. [Final evidence](IMPLEMENTATION_EVIDENCE.md). This work extends the existing Historify manager, read-only chart pane and Workspace practice form.

## Ordered changes

1. Add a typed local client for `/api/local/v1/datasets`, preserving verified account/CSRF, strict errors, request IDs and revisions. Reads never use a broker key or legacy global store as fallback.
2. Keep the original History & data header, Settings placement, UI controls and table/card presentation. Default `/historify` becomes the private library. Preserve connected legacy provider tools at `/historify/provider-tools` behind their broker guard.
3. Add paste/file CSV input, explicit source/instrument/native interval/timezone/volume/economics mapping, human-readable quality/row reports, accepted-subset consent and immutable merge/new-version choices. Retain failed inputs and uncertain commit identity. Stage source can be reopened/re-previewed after reload.
4. Show source/version, checksum, local coverage, quality, bytes and dependencies in catalog/detail. Archive retains bytes; restore and export are explicit. Explain that candle bundles are separate from journal workspace backups.
5. Add exact-version chart mode to the existing Historify chart route. Reuse chart grid, pane, drawings, indicators and replay controls. Native interval metadata must not masquerade as `1m` data. Private mode does not request API-key session calendars or combine same-symbol providers.
6. Preserve validated return context. A version can prefill the existing practice form; creating a record remains Draft with explicit version/checksum. P06 owns execution readiness.

## Implemented boundaries

- `frontend/src/api/dataLibrary.ts` owns the typed local transport. Catalog pagination fences both principal and revision. Mutation bodies keep their request ID and reviewed revision after an uncertain acknowledgement.
- `frontend/src/pages/historify/DataLibrary.tsx`, `DataLibraryImport.tsx` and `DataLibraryRecovery.tsx` own catalog/detail, CSV review, bundle recovery and durable provider job controls. Import/source reports retain the original rejection counts even when the published valid subset passes structural checks. Downloads expose an explicit bounded chunk action and credential capability supplied by the server.
- CSV column mapping handles quoted header delimiters and escaped quotes, comma/semicolon/tab/pipe files, point/comma decimals and IANA source timezones. Custom sessions and closures remain declared data; quality does not claim market accuracy or fabricate missing candles.
- `frontend/src/lib/historify/dataLibraryDrafts.ts` reuses the existing bounded per-principal draft engine under a dedicated origin/book scope. Preview IDs, reviewed form input and uncertain commit identities survive reload. The server retains staged CSV/bundle source; the small bundle draft does not duplicate its binary payload.
- `frontend/src/pages/historify/DatasetVersionChart.tsx` reuses the original chart grid/pane with exact owner/version persistence keys. Native interval, actual data horizon and volume availability are explicit. New private charts start in the declared calendar timezone (UTC fallback); saved chart timezone preferences retain precedence. Legacy global chart defaults remain unchanged.
- `frontend/src/lib/chart/feeds/datasetVersionFeed.ts` validates the exact checksum and native instrument/interval. A per-feed serial queue coalesces identical concurrent windows, accepts at most 17 consumers, handles per-consumer aborts and disposes on version/page exit. Each request is bounded to the dataset maximum of 50,000 candles. It holds no module-global data cache and does not resample.
- `TraderReplay.tsx` prefills the original practice form from the immutable version and creates a bound Draft only. Live/archived profile return contexts require choosing an eligible replay profile. Bound Drafts cannot be labeled completed through the P04 form.
- `FullWidthLayout.tsx` and `Login.tsx` preserve allowlisted local destination path/query after sign-in. Provider tools retain their original connected guard. No new primary navigation section was introduced.

## Verification

Focused client, normalization/feed, catalog/import/recovery, return-path, local access and practice-handoff tests; existing Historify chart helpers and routes remain covered. TypeScript, targeted Biome and production build run on the supported Node runtime. Root verifies actual screens and data journeys using an isolated fixture. No real provider call, live execution or user-data migration is performed by frontend tests.

Evidence is recorded in `tmp/p04-ui-regression.log`, `tmp/p04-ui-timezone-tests.log`, `tmp/p04-ui-typescript.log`, `tmp/p04-ui-biome.log` and `tmp/p04-ui-build.log`, with final logs copied into `evidence/`. Root subsequently accepted import/source separation, UTC/native/four-pane chart reads, sign-in/return context, durable bound Drafts and archive/restore. Frontend implementation alone was not used as package completion evidence.

Latest frontend regression: **445 tests across 43 suites passed** on 3 November 2026. TypeScript passed; targeted Biome checked 13 production files cleanly; the production Vite build passed with the existing chunk-size warning. Root's actual-screen testing additionally found and drove fixes for local sign-in return context and private chart timezone initialization.
