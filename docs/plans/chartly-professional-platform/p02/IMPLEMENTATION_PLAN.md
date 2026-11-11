# P02 implementation brief — durable local journal and recovery

2 November 2026. Owner: Codex. The ordered implementation below is complete subject to the recorded package acceptance gate. [Package checklist](../02-storage-and-recovery.md), [evidence](IMPLEMENTATION_EVIDENCE.md), [inventory](STORAGE_INVENTORY.md), [API contract](API_AND_ACCOUNT_ACCESS.md), [architecture](ARCHITECTURE.md) and [recovery procedures](RECOVERY_GUIDE.md) are the maintained references. Preserve the original chart/journal UI throughout.

## 1. Inventory and authority boundary — P02-T01

Trace all original writer/storage seams before cutover: trader Dexie v2, three native chart catalog databases/namespaces, allowlisted preferences/script drafts, screenshot links/bytes, dataset references and backend/runtime/credential stores. Classify each as authoritative, preserved original, derived cache, draft, registry module or named exclusion. Document the installation-local path without exposing connection secrets.

Implemented: browserSnapshot capture, STORAGE_INVENTORY and workspace registry. Source records stay in the browser until that user's explicit migration commits; the install is not silently transferred by an app upgrade. The raw source, original preferences and native catalogs remain preserved afterwards.

## 2. Durable repositories and authenticated APIs — P02-T02

Use file-backed relational SQLite with the common NullPool/cooperative policy, scoped primary/FK columns, immutable legacy aliases, account-book uniqueness, archive rows, jobs and receipts. Bind ownership to verified existing account proof; never accept a posted owner or broker/guest shortcut. Finish stable UID migration with backup/rollback before enabling production routes. Keep broker execution gates separate.

Implemented: canonical P01 repository seam plus the active P02 compatibility store, local account helper, auth upgrade and `/api/local/v1`. Existing profiles, accounts, journal trades/review notes, daily states, practice runs, connections and attachments have transactional retained storage. Future research/experiment/deployment entities are not invented by this package; those packages must register their own data models/modules before release. Source account facts cannot be edited as manual notes. SQLite-only support is explicit.

Exit evidence: real database constraints, scoped access, non-reused identity, TOTP/revocation, CSRF, stale writer rejection, source-fact protection, rollback, reopen and safe HTTP errors pass on disposable files.

## 3. Browser export and staged migration — P02-T03

Capture the seven tables in a browser read transaction; enumerate native namespaces and retain exact v1 payloads. Copy permitted preferences and available screenshot bytes; mark missing external references honestly. Assign a stable origin identity before upload. Server validation persists the unchanged source, hash, per-table counts, issues and expected revision in a durable job. Alias scope is principal/origin/table/numeric ID.

Implemented: browserSnapshot, workspace_storage preview/staging and API routes. Unsupported stores, secrets, nonfinite JSON, invalid parents and oversized data fail before activation. Multiple source origins can reuse numeric IDs without collisions. Unknown time/precision/account facts remain raw rather than guessed.

## 4. Review and atomic activation — P02-T04

Require an explicit allowed decision for every precision/time, ownership, native namespace or unavailable attachment issue. Default each profile to a separate manual book; account and practice books remain separate. Commit only after the preview revision and complete decisions match. Persist aliases, tables, bindings, assets, catalogs and receipt atomically, then fetch the committed workspace before client activation.

Implemented: Settings → Storage & recovery review in the existing app. A repeated unchanged source is idempotent, including a changed export timestamp; a changed source cannot silently overwrite an already migrated origin. Durable summaries reopen interrupted reviews after reload/cache loss. Original databases are never cleared. Declared accounts are labelled unverified.

## 5. Full supported workspace registry and recovery — P02-T05

Take a consistent all-origin read transaction and write a versioned checksummed ZIP for every supported module. Include relations, notes, current practice/checkpoint fields, native chart payloads, preferences/drafts, attachment bytes/unavailable descriptors and dataset manifests. Name credentials, activation, installed code, bar files and legacy backend store exclusions. This is a workspace backup, not an installation image.

Implemented: registry/archive service, authenticated backup/restore routes and UI. Preview validates exact members/paths, versions, checksums, schemas, relations, ownership, missing dependencies and bounds. Commit requires matching confirmation/generation, keeps a durable recovery copy, replaces only the current principal's scope and writes its receipt atomically. Undo follows the same path, including an initially empty installation. Restore advances table/native revisions and disarms runtime flags. Completed receipts and interrupted review IDs are discoverable after restart.

## 6. Archive and retained provenance — P02-T06

Replace compatibility deletes with archive semantics. Keep parent/child records, aliases, source snapshots and notes; an archived environment cannot keep copying enabled. Reopening a record is explicit and does not restore a live permission or runtime. Keep recovery copies until a later deliberate retention/purge design.

Implemented: server-side retained missing rows, archive/reopen controls and labels throughout existing journal/profile/run/connection screens. No permanent purge UI. Browser and backend paths retain child records rather than cascading a profile delete. Source parents and account identity stay constrained by real FKs and service rules.

## 7. Existing UI save and concurrent-tab behavior — P02-T07

Expose browser versus backend authority and saving/saved/failed/conflict/offline states. Retain dirty drafts and stable request IDs. Compare table revisions, native catalog revisions and preference baselines independently. Only use a cached source after current proof/context verifies the same principal and active origin. Clear account projections/in-memory editor caches on switch, retaining original sources and interrupted drafts.

Implemented: compatibility persistence boundary, original useTraderData integration, scoped native adapters/preferences and global status/retry UI. Each journal selector scopes all trade metrics/charts/calendar. Chart and Journal links preserve the book and tab. The original chart's honest no-feed state remains; P02 does not provide a dummy feed or enable live orders.

## 8. Failure, upgrade and installed-screen verification — P02-T08

Exercise locked/full disks, concurrent/stale edits, lost acknowledgements, abrupt exit before commit, corrupt/unsupported archives, invalid parent references, overlapping origins, interrupted restore and ownership rebind. Prove reopening across service instances and a clean target. Verify original UI migration, backup/restore/Undo, archived recovery, cache rebuild and chart/journal return. Document backup-before-upgrade and rollback procedures.

Implemented evidence is in IMPLEMENTATION_EVIDENCE and P02_ACCEPTANCE. Heavy work uses a bounded first-party subprocess boundary rather than real-thread DB calls under eventlet; resource tests check slot release, timeout/cancel reaping, private file cleanup and repeated connection/handle stability. The supported frontend Node build and original P00/P01 regressions are included. Unrun Linux gunicorn/PostgreSQL environments are stated explicitly, not inferred from Windows fixtures.

## Handoff

P03 is next in dependency order. Expand its detailed implementation plan before changing journal capture/edit/close/import semantics. Carry forward stable identity/source aliases, independent books, raw legacy provenance, source-fact immutability, revision/draft behavior and registry recovery. Do not rebuild the chart/journal UI, reopen accepted P00, enable provider execution or mark later packages complete as a side effect of P02.
