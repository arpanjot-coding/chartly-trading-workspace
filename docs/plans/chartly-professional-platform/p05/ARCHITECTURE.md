# P05 original chart workflow architecture

3 November 2026. Implementation documentation; final browser/integrated acceptance is recorded separately. The original Trading terminal, chart engine, toolbar/rails/grid/dock, drawings, indicators and journal presentation remain the base. [Implementation plan](IMPLEMENTATION_PLAN.md), [source/availability policy](SOURCE_POLICY.md), [API](../../../api/local-chart-workflow.md), [terminal guide](../../../userguide/32-charting-terminal/README.md).

## Context before transport

`chartContext.ts` and `useResolvedChartContext` resolve actual owned profile/run/trade/book records and an optional immutable dataset. Query-supplied names/kinds do not authorize actions. The run must belong to its profile; source/checksum/native interval and UTC window remain pinned. Validated restored aliases may resolve to canonical IDs only when the exact old ID and saved checksum still agree. Missing, conflicting or unavailable context yields a source/import/connect/return action rather than another instrument or an empty chart.

The resolved context carries a generation/key, principal, source origin, independent workspace namespace, profile/run/trade identity, source/window and return path. Changing it replaces the owning workspace; an old asynchronous resolve/load/save cannot populate the new environment. The original unbound legacy chart context is preserved.

## Original terminal, explicit source

`chartSource.ts` creates a private source with exact metadata, bounded native feed/search, frozen calendar and an indicator snapshot provider. It has no broker, order or streaming methods. `TradingTerminal` branches before broker REST/trade/interval/calendar/master/WebSocket/account polling is initialized. The private chart uses its own horizon/calendar, not the wall clock or a fixed IST assumption. Source replacement/disposal aborts outstanding reads.

Source status reports immutable identity, native range, timezone, structural quality/gaps and observed quantity availability. Same-symbol providers and versions remain distinct choices. Connected history/quotes retain the existing adapter separately; unknown delay/freshness is not presented as certified real time. Profile-bound charts remain analysis contexts until account-specific execution capability is established. Existing centralized terminal/dock/replay guards cover the displayed controls and command routes, including keyboard/drag/context menu.

## Scoped workspaces and deliberate sharing

The existing workspace repository and prepared-grid transition remain authoritative. Principal identity is separate from a namespace containing profile, optional run and source version. Named documents retain multi-pane composition/active pane, settings/studies/drawings and sync. The scoped preference envelope keeps unnamed pane/grid/panel/dock settings without inheriting an outgoing global pane. P02 inventories/backups preserve original namespaces.

Copy/import is an explicit configuration action. The selected source/run binding remains authoritative; templates clear incompatible drawings, alerts and comparisons. An original setup is retained. A restored cross-owner namespace is not silently reassigned. The **Preserved chart setups** path allows an explicit copy of an owner-confirmed matching profile/run/verified dataset setup with its drawings; other setups are copied as templates. Actual four-pane/drawing recovery is recorded in the package's browser evidence.

`chartView` retains a dataset/checksum-bound **opening-time chart cursor**. It can restore chart/replay preparation. It cannot restore a simulation cash balance/order/fill ledger, complete a Draft or create journal P&L. P06 owns those semantics.

## Causal study inputs

The private source's requested provider reads only the chosen version/native interval. Warmup is explicit/bounded. Historical `asOf` filters by known native/session close and caps confirmation at publication time. An immutable partial tail never becomes confirmed merely as wall time passes. Daily confirmation uses the declared IANA/session/exception snapshot. Unknown daily calendars, other intervals/sources/variants and adjusted historical values without point-in-time meaning are refused explicitly.

The installed chart engine's managed requested-indicator path supplies the actual replay cutoff; backwards seek invalidates obsolete work. Existing comparison alignment/readout/export logic follows the primary replay prefix. Private comparisons have no WebSocket or repair polling; connected replay retains unsupported point-in-time states where no historical adapter exists. This is source-prefix causality, not certification of an imported provider's market truth.

## Focused chart to append-only journal evidence

The original camera/PNG compositor and a lazy Journal rail panel capture the focused pane. Capture identity is frozen before the asynchronous image; a source/pane/instrument/replay change rejects mixed evidence. Browser-only records keep a reviewed local-storage setup action. An unbound chart chooses a destination explicitly.

`POST /api/local/v1/journal/chart-evidence` reuses authenticated local proof, CSRF, bounded worker dispatch, P03 journal CAS/receipts and P02 assets. The service verifies owned target/book/profile/run relationships, source/checksum/native identity, data-only metadata and a static PNG. Record/review/history, asset and receipt commit in one transaction. The prior generic attachment API is unchanged.

Captures are append-only: up to 20 per target, PNG up to 8 MiB/8,192 pixels per dimension/16,777,216 total pixels, metadata up to 64 KiB, notes up to 4,000 characters and aggregate source-origin image bytes up to 64 MiB. Failed requests retain their reviewed bytes/notes/request ID for explicit retry. No financial record is recalculated by attaching a chart.

Metadata reads avoid selecting/encoding image bytes. Explicit image reads enforce principal/origin scope. Every retained capture is included in supported book/workspace export. Restore checks hashes and actual PNG structure, preserves old evidence, derives current-origin URLs and retains unavailable assets honestly. Dataset manifests remain links: candle bytes use separate dataset bundles.

## Verification and operational limits

Focused coverage includes original source/search/replay/comparison regression, actual installed-engine requested callback/CSV causality, alias recovery, target/metadata/image adversarial cases and full supported export/restore. The independent review reproduced and root fixed animated PNG acceptance, malformed self-consistent restored images and ISO week-date run windows. Six review cases pass.

The defined native preparation budget is 50,000 candles within five seconds. Focused JavaScript samples measured 33.27–115.78 ms, with no network/canvas timing claim; 100 cancelled driver lifetimes left zero active fetches. The actual SQLite capture audit measured 100 successes plus rejection/rollback/replay paths, 558/558 connections opened/closed, handles 239→238, retained traced memory 181,177 bytes and peak 26,911,714 bytes. See [source policy and logs](SOURCE_POLICY.md). Root owns final actual-screen/render and broader compatibility evidence. Real-provider access/licensing, Linux/gunicorn, PostgreSQL, account-specific dispatch and simulation certification are not inferred from these local fixtures.

The matching [HTML diagram](architecture.html) is the editable source for `architecture.png`; root renders and inspects the PNG after documentation settles. Historical P00–P04 gates remain unchanged; P05's final gate attests changed shared code with compatibility evidence.
