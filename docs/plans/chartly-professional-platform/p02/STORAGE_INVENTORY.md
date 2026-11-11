# P02 storage inventory and ownership policy

2 November 2026. Final source inventory. Verification uses disposable files and a separate localhost fixture; installed credential values and journal records were not read. See [architecture](ARCHITECTURE.md), [recovery guide](RECOVERY_GUIDE.md) and [evidence](IMPLEMENTATION_EVIDENCE.md).

## Browser stores

- IndexedDB `ChartlyTraderDB`, schema v2: portfolios, practiceSessions, journalTrades, dailyMoods, brokerAccounts, terminals and profileDestinations. Before reviewed migration these remain authoritative. After commit, the selected local-account source is backend-owned; the original tables remain preserved and exportable. Numeric IDs are scoped to principal and source origin.
- `openalgo-chart-workspaces`, v1, `catalogs`: actual native workspace layouts, pane drawings/studies, templates, active/recent IDs and revisions. Native storage is payload-based, not an image of a layout.
- `openalgo-chart-watchlists`, v1, `catalogs`: lists, entries and active list. `openalgo-chart-drawing-templates`, v1, `catalogs`: templates and drawing defaults. The capture enumerates actual namespace keys. Public package 2.6.7 schemas are validated on migration, native save and restore.
- Legacy native namespace `oa-trading:<legacy-account-key>` is preserved. The new local namespace uses stable principal UID. An old namespace maps to the current one only through explicit migration review. Hydration never overwrites the original native IndexedDB databases.
- Allowlisted preferences: `chartly.combined-selection.v1`, `chartly.customIndicators.manifest.v1`, `oa-trading-script-open`, `oa-trading-script-recent`, safe `oa-trading-script-draft:<name>.oscript`, `oa-agent-model`, and `chartly-theme` mode/color only. Theme execution/app mode is excluded. Original preferences are preserved before account projection. Editor in-memory drafts reset on account switch/restore and flush before logout.
- `chartly-auth`, broker API keys, session state, permissions and guest labels are excluded from ordinary exports. Auth state cannot authorize records. Navigation, price/previous-close and other recomputable caches are excluded.

Sources: [trader schema](../../../../frontend/src/lib/trader/db.ts), [writers](../../../../frontend/src/lib/trader/useTraderData.ts), [capture](../../../../frontend/src/lib/trader/browserSnapshot.ts), [chart adapter](../../../../frontend/src/hooks/useChartWorkspaceCatalog.ts), [persistence boundary](../../../../frontend/src/lib/trader/dataPersistence.ts).

## Active durable store and account access

`LOCAL_DATA_DATABASE_URL` defaults to absolute `<app root>/db/workspaces.db`. Only file-backed SQLite is supported. Its principal/origin-scoped relational tables retain numeric IDs, parent FKs, payloads, book/account identities, immutable aliases, archive state, jobs/source snapshots, idempotency receipts, native catalogs, attachment bytes/checksums and recovery copies. It uses the common NullPool/WAL/cooperative busy policy and FULL durability. Importing the service does not initialize installed workspace records.

The existing user database holds stable `identity_uid` values and hashed/revocable local sessions; password hashes/TOTP are preserved by the additive backed-up migration. Local proof is independent of broker rollover. The API does not accept a body owner, username, numeric user ID, broker token or guest state as authority.

The earlier [P01 domain store](../../../../database/domain_store.py) and [typed repositories](../../../../services/domain/repository.py) remain the canonical normalization seam. Their domain-only archive is explicitly separate from the current workspace ZIP. They are not a competing active UI writer. Raw legacy numbers/timestamps retain provenance; P03 owns subsequent financial normalization and journal semantics.

## Attachments and dataset references

Capture inventories screenshot/chart links. Supported data images and available local blob bytes are embedded; external or unavailable references carry explicit reasons and review decisions. A URL alone is not portable bytes. Byte assets have scoped IDs, safe MIME and checksums. HTTP delivery uses no-store, nosniff, CSP sandbox, with nonimages downloaded; SVG/HTML/script types are rejected. Missing bytes remain missing after restore rather than being guessed or downloaded silently.

Historify uses `HISTORIFY_DATABASE_PATH`, default `db/historify.duckdb`, with its existing write serialization. P02 preserves dataset manifests/references and reports unverified dependencies; bar-file content is excluded. No live DuckDB file is casually copied as a consistent backup.

## Existing backend stores and explicit exclusions

The existing main `DATABASE_URL`, logs, latency, health, sandbox and Historify stores retain their lifecycle owners. The main DB includes auth/settings and feature tables, so a wholesale copy is not an ordinary journal export. Actual configured paths are installation-private and may be checked locally without printing credential-bearing connection strings.

OpenScript run config/running/command files, Python strategy schedules, installed script/indicator code, Flow/runtime state, permissions and logs remain outside portable workspace coverage. These are explicitly named under installed code, runtime activation and unscoped legacy backend exclusions; the ZIP is not an entire installation image. Installation rollback needs a stopped-app filesystem/configuration backup under the existing installation procedure.

The workspace registry includes all saved sources' journal/notes/daily states, current practice session/checkpoint fields, native charts, preferences/drafts, portable and unavailable attachment descriptors, dataset manifests and book/namespace bindings. Future source observations, experiments/research and deployment modules must register schema/dependencies and restore tests before claiming backup coverage. No unavailable dependency is silently substituted.

## Retention and temporary data

Archive retains parents, children, aliases and provenance; archived profiles have copying disabled. Missing rows in compatibility saves become archived, never cascade-deleted. Restore keeps a pre-restore recovery copy. Jobs, original source snapshots and receipts are durable local recovery evidence with no automatic expiry in P02. There is no permanent purge UI. Worker temporary files are private and cleaned on success/error/timeout/cancel; processes are bounded, killed when necessary and reaped. Connections are scoped and NullPool. The measured resource audit is recorded in the evidence.

