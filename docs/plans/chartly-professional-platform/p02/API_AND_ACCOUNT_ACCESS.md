# P02 implemented API and account-access contract

2 November 2026. Implemented and fixture-tested. This is the compatibility transport for the existing app; future normalized journal/import APIs belong to P03/P04. See [architecture](ARCHITECTURE.md), [evidence](IMPLEMENTATION_EVIDENCE.md) and [recovery guide](RECOVERY_GUIDE.md).

## Local authentication

Existing app password and required TOTP establish a separate hashed, revocable 24-hour local proof. Stable `User.identity_uid` is the principal, never numeric user ID or username. HttpOnly/SameSite Strict host-only cookie `chartly_local_session` is independent of the broker's rollover-aligned Flask lifetime. Logout, password/factor changes, deleted users and expired/revoked proof deny access. Pending TOTP, frontend guest state, broker flags and cached broker password acceptance cannot authorize local records.

`/login?purpose=local&next=/settings/storage` follows existing password/TOTP UI and permits only safe internal return paths. `GET /auth/local-session` returns authenticated principal UID/username or401. Existing trading APIs keep their broker gates. The chart-only local route permits local navigation/catalog access but does not fabricate feed credentials or enable live orders.

## Scoped transport

All routes below use `/api/local/v1`, require current local proof and return private/no-store responses. Mutations use the app's existing CSRF protection. Principal comes from the server helper, never a body/query/header owner. Unknown/duplicate fields and nonfinite JSON are rejected. Errors use `{error:{code,message,issues}}`;400 is invalid input/CSRF,401 missing local proof,404 missing/foreign record,409 stale/reused request or unresolved review,413 a budget limit and503 retryable storage/worker failure. Errors do not include SQL, secrets or raw filesystem details.

- `GET /context`: principalId, setupRequired, activeOriginId, global revision/generation and available origins with table/state revisions. It does not initialize user records from a GET.
- `POST /setup {}`: idempotent principal initialization. No browser source or broker is fabricated; setupRequired remains true until a source is committed.
- `GET /recovery/status`: up to20 scoped durable migration/restore summaries of each kind, newest first, without raw payloads. Reopens interrupted reviews and completed restore receipts/Undo after reload; it never commits a job.
- `GET /workspace?originId=`: original seven tables, table revision, state revision/generation, book summaries/assignments, archive metadata, native catalogs, preferences, attachment URLs/descriptors and dataset manifests. Omitted origin uses the active saved source.
- `PUT /workspace?originId= {expectedRevision,tables,requestId}`: full compatibility table save with table compare-and-set, relation checks, immutable source facts, retained missing rows as archives and durable idempotency receipt. Response is saved only after commit.
- `PUT /context/active {originId}`: explicitly select a source owned by this principal and invalidate outstanding restore previews.
- `POST /migrations/preview {snapshot,nativeTargetNamespace?}`: persist unchanged raw source/hash/counts and issue decisions under a scoped migration job. Snapshot v1 is `chartly-browser-snapshot`, with stable originId, createdAt, seven exact tables, nativeCatalogs, preferences, attachments and datasetManifests.
- `GET /migrations/:id`: resumable scoped preview/status/resolutions/receipt; raw source is retained server-side, not needlessly returned.
- `POST /migrations/:id/commit {resolutions,requestId}`: require every issue's explicit allowed decision. Atomically create aliases, books, rows, assets, catalogs and completion receipt; no silent overwrite of a changed origin. Return the durable receipt, then client reloads context/workspace before activation.
- `GET /native/:kind?namespace=&originId=`: catalog with native revision/generation. Kinds are workspace, watchlist and drawingTemplates. Namespace mapping only follows the reviewed source binding.
- `PUT /native/:kind {originId,namespace,catalog,expectedCatalogRevision,requestId}`: native-schema validation and catalog CAS, independent of journal table revision.
- `PUT /preferences {originId,preferences,expectedPreferences,requestId}`: allowlisted preferences with atomic comparison to previous values. Conflicting restored/editor settings are retained as drafts, not silently rebased.
- `GET /attachments/:id?originId=`: scoped checksum-verified bytes; supported safe images inline, other permitted types as downloads; nosniff/CSP sandbox. Unavailable external references remain explicitly unavailable.
- `POST /backups?originId=`: ZIP for all this principal's saved sources. Optional origin verifies caller context; it does not silently exclude other saved origins. Named registry exclusions are in the manifest.
- `POST /restores/preview`: multipart file and expectedRevision (global generation). Read-only preview includes jobId, confirmationHash, origin/module/table counts, ownership confirmation requirement and unavailable/unverified dependencies.
- `GET /restores/:id`: the full scoped public review/receipt for an interrupted restore. Status lists stay compact; resuming loads all dependency and attachment warnings before confirmation.
- `POST /restores/:id/commit {expectedRevision,confirmationHash,confirmOwner?}`: atomic replacement of only this principal's scope, durable pre-restore recovery copy, revised CAS fences and completed receipt. No runtime activation or credential restore.
- `POST /restores/copies/:id/preview {expectedRevision}`: normal restore preview for Undo, including an initially empty target.

Bulk workspace reads/saves, migration, native/preference validation and ZIP operations run through the fixed first-party worker action list, bounded to two processes. Configuration resolves the SQLite path before passing it to a worker. Timeout/cancel/error cleanup reaps the child and removes temporary files; durable request/job IDs permit uncertain-result retries.

## Identity, revision and retention rules

Every numeric record ID is scoped to principal plus stable source origin. Aliases retain that identity on repeat migration. Each profile receives a manual book even when empty. Connected books derive from declared account identity and have a unique account key; missing/ambiguous identity is explicitly source-scoped and not certified. Paper books bind to the practice session. Journal chart/metric/calendar selection uses one book; manual capture cannot be silently added to a connected book.

Archive keeps records/parents/provenance and disables archived-profile copying. Reopen is explicit in Settings. Imported/source account economic facts cannot be edited as manual review notes. Table CAS, native CAS and preference comparison prevent silent cross-tab overwrites. Restore advances counters beyond open clients' values. Global generation invalidates stale restore previews after edits, preference/native changes or source switching.

Only a successful server commit switches authority. Original browser databases/catalogs are never cleared by migration or hydration. Cache/drafts are bound to verified principal and source. A different account or failed proof cannot fall back to a prior user's cached records. Pending retries preserve request ID and baseline; a lost acknowledgement returns the existing receipt.
