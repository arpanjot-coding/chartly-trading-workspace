# P04 implementation and acceptance evidence

Accepted 3 November 2026. All eight P04 tasks are complete within the supported private local/native-history scope. The original chart, journal and four primary navigation sections remain the base. [Acceptance gate and current source hashes](P04_ACCEPTANCE.json), [implementation plan](IMPLEMENTATION_PLAN.md), [architecture](ARCHITECTURE.md), [API](../../../api/local-datasets.md), [user guide](../../../userguide/34-data-library/README.md).

## Delivered behavior

History & data now opens a private local Data Library without an execution broker. CSV paste/file mapping stages exact decimals, explicit units/timezones/native intervals, frozen session calendars, overlap policies and human-readable quality reports before publication. Rejected rows need deliberate accepted-subset consent. Same-symbol providers retain separate identities. Published versions, content checksums and prior bytes are immutable; missing volume remains unknown. Source rejection evidence remains separate from the published/merged version's recomputed quality.

The existing chart/grid/pane reads one owned version and checksum at its native interval, starts in its declared calendar timezone, preserves saved preferences and returns to the selected library/profile context. Shared pane requests are bounded, serialized, coalesced and abort-aware. Practice handoff pins that version/checksum to a durably saved Draft; it does not start a simulator or claim a completed backtest.

Finite downloads use the exact local owner's connected history credential, persisted chunks/quota/retries/leases and cancellation generation. Provider calls occur outside database transactions; version publication and checkpoint advancement commit together. A revoked/changed binding or paused/cancelled lease cannot publish late data. Processing is an explicit bounded next-chunk action, with no new always-running collector.

Archive retains bytes and saved references, with restore to the catalog. Separate checksummed dataset bundles validate canonical candles and optional source evidence before rebuilding private files. Validated old-version proofs preserve practice/trade/history links through owner A→B→C restores without rewriting those records; an existing native version ID always wins. P02 workspace ZIPs keep manifest links and continue to exclude candle files. There is no permanent purge in this package.

## Automated verification

Exact commands and collection timing are recorded in [verification commands](VERIFICATION_COMMANDS.md). Follow-up subsets overlap the broader totals and are not added to them.

- **1,008 backend tests in 34 files passed** in 190.16 seconds, with one dependency warning. The suite covers P01 contracts/domain backup, local identity/access, P02 repositories/migration/recovery/workers, P03 manual/import/review/analytics/resources, P04 quality/storage/HTTP/provider/download/recovery/resources and existing Historify/history behavior. [Full compatibility log](evidence/compatibility-regression.log).
- **66 backend follow-up tests passed** in 29.60 seconds after the final local-return hardening. This is the current API/local-access/library/restore-link subset, including malformed/encoded return paths, real authenticated HTTP worker/file responses and cross-owner recovery. It overlaps the integrated total. [Follow-up log](evidence/backend-followup.log).
- **445 frontend tests across 43 suites passed**, including account/storage, journal/Workspace, local routing/login, Data Library mapping/recovery, exact-version feed and chart-widget behavior. **52 tests across 8 suites passed** after the final profile-help wording change; these overlap the broader total. [Frontend regression](evidence/frontend-regression.log), [follow-up](evidence/frontend-help-followup.log).
- **84 P00 workflow/review/model/chart-data tests passed**. Generated canonical domain types match their schemas. TypeScript, 13 changed production frontend paths under Biome, scoped Python Ruff and the production build passed. [P00 log](evidence/p00-regression.log), [build](evidence/frontend-build.log), [source checks](evidence/source-checks.log). The build retains existing Plot2D dynamic-import and bundle-size warnings.
- **25 forward acceptance-gate cases passed**: missing/incomplete P04 work, absent proof, wrong hashes and attempts to rewrite historical evidence are rejected. All eight P04 backend modules are registered in the CI Python 3.12/3.13/3.14 matrix; remote CI has not been run here. [Gate tests](evidence/plan-gate-tests.log).

The integrated backend suite includes 81 pure quality cases, 34 finite-download cases, 20 independent provider cases, eight independent integrity/recovery review cases and seven restored-link cases. These focused counts are subsets, not additional tests to add to 1,008. The [quality policy](QUALITY_POLICY.md), [download plan](DOWNLOAD_PLAN.md) and [frontend record](UI_PLAN.md) describe their boundaries.

## Actual original-screen journeys

Browser checks used a disposable local account/database at localhost:5014 with synthetic EXAMPLE candles. No installed user journal was migrated, provider contacted or order submitted.

1. Opened History & data through local sign-in without a broker. Pasted 31 source rows; the review showed 30 valid candles and the invalid OHLC row/reason. Publication stayed disabled until accepted-subset consent.
2. Published two EXAMPLE/LOCAL sources independently. Both remain in the catalog, with the second source retaining its original one-row rejection report. [Catalog/detail proof](evidence/library-two-sources.png).
3. Opened the second immutable version in the existing chart: **30 bars, latest close 130.00, 09:29 UTC**, with the original toolbar/drawings/indicators and native 1m resolution. A four-pane layout loaded the same exact data in every pane. [Original chart](evidence/native-chart.png), [four panes](evidence/four-native-charts.png).
4. Returned to the same selected version/profile. Created a replay environment through the original Workspace form, reviewed/migrated only the synthetic fixture's two profiles, then created **Pinned 1m source B**. The original practice form locked symbol/native interval/source; the saved status remains Draft. Reload preserved the Draft and its chart link. [Practice proof](evidence/practice-draft.png).
5. Dataset detail reported **one saved reference**. Archiving hid the active catalog row while retaining bytes/reference; its original chart still loaded 30 bars. Restore returned it to the catalog. [Archived reference](evidence/archived-reference.png).
6. Signed out and signed back in. Login returned to the exact dataset-version query and replay-profile context; source report and one saved reference remained. [Returned detail](evidence/returned-library.png).
7. Downloads explicitly explained unavailable provider access while local imports/charting remained available. Actual CSV/ZIP response bytes, checksums, tamper rejection, cancellation/retry/restart and cross-owner recovery were verified through real HTTP/service tests; native browser download/file-picker automation was not used as evidence for those assertions.

The architecture HTML was rendered to [PNG](architecture.png) and visually inspected. Browser evidence is a fixture acceptance record, not replacement UI or production market data.

## Resources and recovery

In the final integrated **100-cycle service audit**, SQLite opens/closes were **623/623**, DuckDB **204/204**, and handles **278→278**. It covered 11 cancelled jobs, one provider-failure path and a DuckDB exception. Retained traced Python memory was 46,432 bytes (peak 799,504); RSS was 253,480,960→254,205,952 bytes. No active connection or temporary stage directory remained. The separate 100-job orchestration audit recorded **901/901** SQLite opens/closes, handles **279→279**, retained 33,676 bytes and peak 577,488. [Current measurements](evidence/compatibility-regression.log).

On a stale revision, retain input and re-preview. On an uncertain commit acknowledgement, retry with the same request ID. For a missing/changed candle file, restore its separate verified dataset bundle; do not imply that the journal ZIP contains it. Interrupted identical file publication is adopted only after content verification. New owned files are cleaned on metadata rollback. Archive remains reversible, and dataset aliases cannot silently rebind an existing native identity.

## Runtime, limits and next work

Verified locally on Windows, Python 3.14.7, Node 22.23.4, SQLite metadata and immutable DuckDB candle files. The existing app was launched on loopback port 5000 with its existing configuration. Workspace, History & data and Storage & recovery returned 200; the unauthenticated private dataset API returned 401. [App smoke](evidence/app-smoke.log). No authentication bypass was enabled for this launch.

CSV is bounded to 8 MiB/50,000 candles. Catalog pages contain at most 100 versions; per-principal limits are 2,000 versions and 5,000 retained records. Quality is structural, not a certification of market truth or source rights. Missing calendars remain explicitly unclassified. Native intervals only: no silent resampling, currency conversion, adjustment, continuous-contract synthesis or source blending.

The existing read-only provider bridge currently supports 1m/daily history only. Its legacy adapter may already replace absent open interest with zero; the bridge cannot recover unknown information after that loss. Real-provider permissions, optional-field conformance, licensing, Linux/gunicorn and PostgreSQL certification are not claimed by these Windows fixture tests. P07 owns provider-specific certification. P05 owns broader original-chart context/evidence integration; P06 owns validated simulation and confirmed paper-fill journaling. P05–P22 remain unchecked.

Historical P00–P03 acceptance records are unchanged. The P04 gate reattests current shared implementation sources using the recorded compatibility run, while preserving earlier package evidence.
