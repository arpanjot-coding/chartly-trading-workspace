# P07 history, storage and recovery integration

The connector framework stores observed history separately from mutable profile configuration and from credentials. An observed account is bound explicitly to an existing connected book; local account labels are not provider identity, health or execution authority. [Ordered plan](IMPLEMENTATION_PLAN.md), [canonical handoffs](../../../../contracts/v1/HANDOFF_SEQUENCES.md).

## Persistence and transaction boundary

`database/connectors_db.py` registers `workspace_connectors` before workspace engine creation. The primary key is owner UID, source origin and connection ID, with a deferred workspace-parent foreign key. `ConnectorRecords.load/list/save` uses the caller's scoped SQLAlchemy connection; it creates no engine, pool, thread or external client. New records are limited to 4 MiB, one origin to 32 MiB and 100 connections, with 5,000 receipts per record. UTF-8 budgets are checked by SQL byte counts, including replacement, without reading every other history payload.

Each record has version, owner/origin/connection identity, revision, provider/version, configuration, runtime status/health, history and stable request receipts. Optional canonical SourceConnection, CapabilityManifest and AccountSourceLink records must validate against P01 and match the record's owner/workspace/provider/version. References to credentials are metadata only; secret-bearing keys, nonfinite/non-JSON values, excessive depth and oversized payloads are rejected.

The trusted service fetches outside the write transaction, then rechecks revision, actual identity, configuration and credential generation before publication. Observation changes, journal normalization/projection, cursor, connection revision and command receipt belong in that one transaction. Metadata-only mutations also advance the principal generation, so a stale workspace restore cannot overwrite a newer connection update. Routine Workspace responses do not query or return complete connector records. Full snapshots and backups do include them.

Generic profile-table saves cannot relabel a linked account's server, native login, currency, environment, platform or broker field and thereby change its existing connected book. Display-name edits remain allowed. Creating a replay profile or changing another profile kind to replay requires an owned, nonempty, unarchived immutable history version/checksum and matching native symbol, interval and currency. A missing, connected-only or invalid source is rejected with actionable `dataset.profile_history_required` guidance, including for an older cached UI or a direct API request. Profiles already stored as replay remain readable and editable without inventing a source, and reviewed migration/restore remain compatible with empty legacy projects. No connection readiness is inferred.

## Pure history merge

`empty_history()` returns version 1 with observations, latest indexes, coverage, conflicts, confirmed normalized rows and no cursor. `merge_history(current, page, context)` returns a new history, newly accepted confirmed rows and counts. Inputs remain untouched. Context is trusted owner-service scope: provider ID, connection ID, canonical account key and receipt UTC time, optionally the expected identity/window/cursor. Adapter pages are limited to 200 events; history retains at most 5,000 immutable observed versions, 1,000 coverage entries and 1,000 conflicts.

Every observation has a deterministic identifier and payload checksum, its native external event ID, occurrence/receipt times and a correction link. Explicit native revisions must progress; conflicting/stale revisions are retained as conflicts rather than overwriting the accepted fact or advancing complete coverage. Providers without a native revision use a local observation revision for distinct content. Seeing an earlier identical native payload again deduplicates it without reverting to that older content.

The latest index and confirmed projection are validated against the complete observed chain during recovery. Content/checksum, owner-service account scope, revision chain, conflict references, derived rows and cursor/coverage consistency are checked before a restored record can publish.

An intermediate page may persist a progressing native cursor, but never complete high-water coverage. Missing/limited pages retain earlier observations and facts; absence is not deletion. Complete coverage advances only over contiguous observed intervals; a later isolated window does not conceal an unobserved gap, and a subsequently completed backfill can join those intervals. Repeated coverage checks update their observed timestamp instead of growing one identical coverage row per retry.

Only an explicitly confirmed, fully closed `trade` event with a normalized P03 row can become a journal candidate. The event ID must match the native observation. Partial fills, uncertain submissions, cashflows and raw terminal deals stay distinct observations. The root service must validate the candidate through the existing P03 exact-decimal normalizer and preserve its accepted account/book event namespace, notes, captures and review history. This framework does not guess MT5 netting/hedging position accounting.

## Unverified provider clocks

The actual MT5 access spike found a provider-time ambiguity. Such events carry `timeBasis: receipt-only`, retain native provider time in their raw payload, and use the service's actual receipt UTC only for observation bookkeeping. They are not asserted to fall within a proven provider UTC window. Their checksum/identifier excludes the changing receipt-only timestamp, so another read of the same native deal does not invent a correction. Complete coverage/high-water advancement and normalized journal conversion are disabled for those events. No guessed timezone offset is applied.

## Full backup, restore and Undo

The installed `connectors` backup module contains records/history/cursors, never the separate encrypted vault. Older workspace archives without it normalize to an empty module through explicit archive upgrade. Module origin sets, record scopes, linked profile/account/book references and observation checksums are checked with the other workspace data before committing.

Every restore—including same-owner restore and Undo—deletes this principal's existing vault rows in the same transaction. Portable opaque credential references/generations are removed. Connections become `unverified`, health `unknown`, and links inactive; canonical AccountSourceLink becomes paused. Source observations, command receipts, actual native identity and history remain provenance, not a grant to resume. Revalidation and explicit linking are required before further reads.

Owner-confirmed cross-owner restore rebinds local owner/workspace/account/book references using the rebuilt connected book's actual account key. Numeric profile/account IDs and native immutable observation identities are preserved within their origin. Original-owner records remain intact. Restoring or Undo never resurrects an encrypted credential or starts polling, trading or a terminal.

## Verification and resources

Independent suites cover real scoped SQLite, source/account isolation, atomic rollback, data-only/secret rejection, UTF-8 budgets, generic identity locks, owned replay data, complete backup/restore/Undo, explicit owner rebind, vault exclusion/deletion and old-archive upgrade. Pure history fixtures cover repeated/reordered data, revisions, stale/conflicting corrections, incomplete pages, gaps/backfill, native absent revisions, partial/unknown events, receipt-only clocks and tampered restored projections.

The focused set initially passed 52 cases; combined connector/P02/P03/P06 storage and recovery regression passed 143 cases. Counts overlap. The final command/output is retained in `tmp/p07-storage-compatibility.log`; root's package evidence controls final integrated acceptance. Only the existing recovery test's empty installed-module fixture/count and ZIP member count were advanced for the added module; historical package evidence was not rewritten.

Descriptor lifetimes are caller-owned context managers. Every local result is consumed synchronously; these modules create no per-request background thread, socket, IPC attachment or persistent collection. History, coverage, conflicts, receipts and JSON memory are explicitly bounded. Native IPC/resource verification belongs to the adapter and integrated service audit; successful local SQLite tests do not certify Linux/gunicorn or an unexercised provider.
