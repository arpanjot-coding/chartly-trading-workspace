# P05 implementation and acceptance evidence

3 November 2026. **P05 complete within the supported scope below.** All eight tasks were accepted only after implementation, focused/integrated tests, independent review and actual original-screen journeys. The [ordered implementation plan](IMPLEMENTATION_PLAN.md) preceded coding; [acceptance manifest](P05_ACCEPTANCE.json) records current source/evidence hashes. This package extends the original app and original chart UI. It does not replace the terminal, original journal tabs or main navigation.

## Delivered workflow

The existing `/trading` terminal resolves actual owned environment/run/trade/book context before starting transports. Saved data and connected prices use explicit source adapters. A saved-history chart uses its declared instrument, native interval, calendar, UTC horizon and quality; it creates no broker or execution resources. Profile charts remain analysis contexts until verified account dispatch exists. Query labels never authorize orders. P04 private chart links open this same original terminal.

The original chart grid, toolbar, drawing tools, indicator browser, search, rails and dock remain available. Source, environment and account authority are independent. Local source/version and missing-history states have explicit choose/import/connect/return actions. Existing connected unbound trading retains its legacy authority path. No global API key is repurposed as proof of a profile's execution account.

Named and unnamed chart state is isolated by principal/profile/run/source. Deliberate import/copy preserves original documents, keeps active source authority and clears unproven drawing/alert/comparison provenance. Owner-confirmed restored catalogs can be explicitly recovered with drawings when the exact profile/run and verified dataset alias/native identity match. The version-bound `chartView` resumes chart preparation; it is not a P06 balance/order/fill checkpoint.

The original Journal rail captures the focused pane directly to an existing owned trade or run. The image, immutable source/view/replay metadata and notes append atomically with history and a stable receipt. The target's finances are unchanged. Retry retains the original bytes/body; conflict recovery requires explicit record review. Historical captures remain accessible in the original journal, supported book export and full workspace restore. Recorded-chart links resolve stored evidence authority, so a later profile default cannot replace the captured source. PNG and data-only metadata limits are enforced at the server boundary.

See [context/workspace details](CONTEXT_WORKFLOWS.md), [source and study matrix](SOURCE_POLICY.md), [journal contract](JOURNAL_EVIDENCE_INTEGRATION.md), [API](../../../api/local-chart-workflow.md), [architecture](ARCHITECTURE.md) and its rendered [diagram](architecture.png).

## Task acceptance map

- **P05-T01:** `chartContext.ts`, `useResolvedChartContext.ts`, `services/chart_context.py` and original profile/run/trade links resolve real records, ownership, aliases/checksums, native identity and UTC windows. Forged labels, missing/foreign/conflicting targets, source changes and stale completions have focused tests. Actual profile/run/journal-return journeys are recorded separately.
- **P05-T02:** `chartSource.ts`, `useDatasetChartSource.ts`, native feed and the original terminal branch select immutable data before any broker initialization. Source status and chooser preserve declared metadata. Private driver cancellation, StrictMode lifetime and comparison transport absence are tested.
- **P05-T03:** Existing centralized terminal, dock and replay guards reject read-only execution commands, including direct command/hotkey/drag/context-menu paths. Read-only dock presentation retains its original tabs without `useBlotter`, account feed or book polling. A Live label does not enable One-Click or account orders.
- **P05-T04:** Existing native repository/catalog, scoped preference envelope, template helper and preserved-setup chooser isolate environments and retain original namespaces. Tests exercise private scopes, stale/conflicting saves, recovery and clearing incompatible drawings. Actual four-pane/Trend Line reload, second-profile isolation and cross-owner restoration passed.
- **P05-T05:** `JournalPanel.tsx`, `ChartEvidenceList.tsx`, typed client and `services/chart_evidence*.py` reuse original PNG composition and P02/P03 storage/CAS/receipt/assets. Tests cover exact target/book/principal, mutation refusal, PNG/metadata limits, idempotency, concurrent conflict, rollback, historical exports and byte recovery. Actual chart → journal → recorded chart → same journal entry passed.
- **P05-T06:** Installed-engine `ReplayController`/requested-indicator tests prove `asOf` reaches the immutable provider; requested plots, SMA and CSV contain only the revealed prefix, including backward seek. Native close/publication/calendar rules and unsupported MTF/symbol/variant/PIT requests are explicit. No current broker history substitutes for old availability.
- **P05-T07:** The existing symbol dialog retains keyboard/focus/ranking and distinguishes source identity. Query/source/close/unmount cancellation fences stale results; failure/retry and missing capability states are tested. The source picker visibly keeps same-symbol providers separate. An accessible description was added without changing layout.
- **P05-T08:** Broad regression, affected follow-ups, independent review, resource measurements, actual chart rendering, scoped static checks/build, generated contracts, API/guide/architecture and the acceptance validator supply the final package proof. Final status and logs below control completion.

## Recorded checks

The full backend integration passed **1,071 tests in 39 files**, one warning, 340.79 seconds. It includes P01–P04 contract/storage/access/journal/data/recovery regressions and all five new P05 backend suites. The full log is `evidence/compatibility-regression.log`. A later **58-test** affected run passed the final UTF-8 metadata and legacy-run binding hardening. Those cases overlap the integration run; counts are not added as distinct tests.

The broad frontend integration passed **2,262 tests in 201 suites** in 95.48 seconds, covering original terminal/replay/chart UI plus P02–P04 paths. Subsequent browser/review changes received focused affected checks: **115/10** context/alias/recorded-view tests/suites, **114/12** journal/persistence/review checks, **64/5** paused replay-hydration checks, **34/2** search/accessibility checks and the final **23/2** preference-failure/retry/real-IndexedDB checks. These overlap and must not be summed. Durable logs are in `evidence/`; the final production build includes every follow-up. jsdom canvas limitations remain explicit; real original-screen rendering is verified separately.

P00 design/model regression passed **84 tests**. The P05 forward acceptance harness passed **53 adversarial cases**; the unchanged historical P04 gate harness passed **25 cases**. Generated canonical types match the schemas. TypeScript, production Vite build and changed-path Ruff/Biome checks passed; production build retains existing large-chunk/dynamic-import warnings. Local runtime was Windows, Python 3.14.7 and supported Node 22.23.4.

The new evidence/context/resource suites are registered once in the existing Python 3.12/3.13/3.14 CI matrix. CI configuration validation is local; no remote CI run is claimed.

## Resource and performance proof

The defined preparation budget is **50,000 native candles within 5,000 ms** on this reference environment. Recorded focused samples were 33.27–115.78 ms. The latest stored sample is 54.88 ms. This measures native JavaScript data preparation, not network plus canvas latency. One hundred cancelled driver lifetimes started/closed 100 fetches and left zero active. The real browser separately rendered the 50,000-candle fixture and SMA.

The integrated SQLite audit completed 100 evidence publications across five targets, 100 metadata reads and 100 asset reads, ten invalid images, ten stale writes, four forced atomic rollbacks and ten idempotent receipt replays. Connections opened/closed **558/558**. Handles were **276→278**; RSS **217,083,904→249,753,600 bytes**; retained traced Python memory **171,639 bytes**, peak **26,902,860 bytes**, elapsed 42.84 seconds. The standalone audit also balanced 558/558 connections, handles 239→238, retained 181,177 bytes and peak 26,911,714 bytes. These bounded observations do not claim flat allocator RSS or zero production leaks.

Routine workspace/journal metadata reads assert no asset-byte SELECT or base64 encoding. Explicit image/backup/export paths alone load bytes. PNGs are static, at most 8 MiB, 8,192 pixels per edge and 16,777,216 decoded pixels. Each target has at most 20 captures and 64 KiB total UTF-8 metadata; new captures respect the origin's 64 MiB asset budget. Source fetch consumers, panes, search pages/results, retained receipts/draft identities and preference keys are bounded. Existing workers, scoped sessions, abort controllers and panel cleanup remain authoritative.

## Independent findings and resolution

Independent review reproduced three backend gaps and verified fixes: animated PNGs accepted as static evidence, malformed restored images with self-consistent hashes and ISO week-date run windows. Six adversarial review cases passed. Additional root review hardened UTF-8 byte accounting and blocked first dataset binding on a legacy run with existing trades.

Frontend review and actual browser testing led to fixes for profile analysis starting global account resources, StrictMode source disposal, unproven template drawings, wall-clock/private timezone display, recorded source/view restoration, explicit missing trade history, cross-owner preserved scopes, URL bounds overriding stored evidence, canonical evidence on old-alias runs, recorded-pane focus, multi-pane replay restore timing, paused named-layout hydration and automatic preference-save concurrency/status recovery. Every resolved finding has a focused regression; final current-source evidence is in the acceptance manifest.

## Recovery and compatibility

No new database table or destructive installed migration is introduced. Profiles/runs gain optional validated `chartSource`/`chartView`; entries/runs gain append-only server-managed `chartEvidence`. Existing attachment behavior and old browser/native sources are preserved. Workspace ZIPs retain image bytes and every capture; candle files remain in separate P04 dataset bundles. Old IDs are followed only through validated owner-bound alias proof, with matching checksums/native identity. Restored missing references stay visible and recoverable.

The actual cross-owner helper verified unchanged old native namespace data and byte-identical trade/run images before browser recovery. The original owners' records were preserved. The current-owner journal reconstructs asset URLs and book identity; it does not reuse an old deployment hostname. See [browser evidence](BROWSER_ACCEPTANCE.md) and [verification commands](VERIFICATION_COMMANDS.md).

Historical P00–P04 gate JSON, historical prose/evidence and old gate helpers remain unchanged. P05 reattests current shared implementation files and a real full compatibility log. P06–P22 remain unchecked.

## Supported scope and next package

P05 supports owned native immutable history, chart-only replay preparation, same-source native requested studies and explicit refusal elsewhere. It does not certify external data authenticity/licensing, live providers, account-specific execution, derived-timeframe research, full mobile parity, Linux/gunicorn or PostgreSQL behavior. Existing legacy connected functionality remains on its existing adapter; these local fixtures make no new certification claim.

P06 owns deterministic paper balances/orders/fills, stress and replay execution behavior, durable simulation checkpoints and exactly-once journal projection. Strategy Builder and Fundamentals remain later packages. P05's chart cursor and evidence never pretend those products are implemented.
