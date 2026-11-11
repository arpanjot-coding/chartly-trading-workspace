# Local storage migration, backup and recovery

Use Settings → Storage & recovery. Local account sign-in uses your existing app password and required second factor; it does not need a broker. Keep the app and local backend open on the computer holding the database. This version supports file-backed SQLite.

## First migration

1. Export the preserved browser source before transfer. Keep that JSON outside browser cache. It includes original numeric IDs and raw values, saved chart namespaces, permitted preferences and available screenshot bytes. Authentication and credential stores are excluded.
2. Review browser migration. Check the seven table counts, record ownership and every precision/time, external attachment and chart namespace issue. A manually declared account remains unverified. Choose the intended manual, account or paper book explicitly.
3. Commit the reviewed migration. Wait for the completed receipt and local-engine Saved status. A failed request retains the original databases and staged job. Retry the same review/request; do not clear the browser to fix it.
4. Download a workspace backup ZIP after activation. Verify the journal and selected book, original tabs, chart return link and saved chart namespace list. Switching a saved source is explicit; two origins with overlapping numeric IDs do not overwrite each other or automatically combine their analytics.

Repeat unchanged migration is safe. A changed original source is rejected for review instead of overwriting the active source; export it for reconciliation. That reconciliation/import work belongs to later import packages. Browser-origin identity belongs to the preserved source, not a broker account identity.

## Before upgrading

Download a workspace backup and export any interrupted drafts. Backups include all saved origins for the signed-in local principal. Keep a copy outside the app's storage directory. Retain the preserved original browser export. Stop chart edits, imports and automation activity before any installation-level filesystem copy.

For an entire installation rollback, stop the app and use the installation's existing backup procedure for its data/configuration directories. The workspace ZIP does **not** contain account passwords/TOTP, broker/API credentials, permissions, installed strategy code, market-data bar files, other unscoped backend databases or running processes. Preserve those separately according to their security policy. Do not treat a copied live SQLite `.db` alone as a consistent backup when WAL is active; the app's workspace export takes a transactionally consistent snapshot.

The additive local-user UID upgrade takes a verified SQLite user-database backup before DDL/backfill. IDs, password hashes and TOTP values are retained. If migration fails, startup reports the error and the migration restores its backup; retain the backup and logs. Never delete a user and recreate its numeric ID to regain another principal's workspace.

## Restore and Undo

1. Choose the workspace ZIP under Preview backup ZIP. Preview is read-only with respect to current workspace records. Review origins, table/module counts, unavailable attachment references, dataset/code dependencies and ownership changes.
2. A backup from another local principal requires explicit ownership confirmation. It restores records into the signed-in principal's scope; it never imports login authority or a running strategy.
3. Confirm restore. If another edit or source switch occurred after preview, refresh and preview again. The transaction keeps a durable recovery copy before replacement and returns a completed receipt only after commit.
4. Reopen the journal and selected book. Check notes, counts, analytics and available images. Native chart payloads remain accessible by their preserved/mapped namespaces. Reconnect the chart's original feed separately to render prices; P02 does not fabricate data.
5. To roll back, preview the previous recovery copy using Undo restore, review it and confirm. Undo uses the same validation, revision and atomic restore boundary, including when the previous workspace was empty. The recovery copy remains local to the authenticated principal.

## Failure handling

- **Offline backend / locked or full disk:** keep the draft and retry ID. Resolve the local engine/disk condition and retry. Saved is shown only after backend commit. If the reply was lost after commit, idempotency returns the existing receipt rather than duplicating records.
- **Conflict from another tab:** keep/export the interrupted draft. Reload the saved state, compare it and deliberately reapply the desired change. Retry never silently rebases an old preference draft over restored settings.
- **Interrupted migration:** sign in to the same local principal and resume the staged review. Original browser records remain available. A process stopped before transaction commit leaves no partial migrated records.
- **Interrupted restore:** retry the same staged job/confirmation. A rolled-back transaction leaves prior records; a committed job returns its persisted receipt. Do not infer completion from a partial file or an in-memory spinner.
- **Invalid/corrupt/oversized ZIP:** no replacement occurs. Keep the original file and obtain a valid supported backup. The app rejects unsupported versions, undeclared/duplicate paths, symlinks, checksum/schema/parent failures and size budgets.
- **Cleared derived cache:** use Rebuild derived cache, then reload saved data. The backend is authoritative after activation. This control preserves the original source databases and interrupted drafts. Signing out prevents another account from seeing this account's runtime cache/preferences.
- **Archived records:** restore from the Archived records list. Archiving retains children and provenance; it does not purge data. Archived environments cannot keep copying enabled. No permanent purge UI is provided in P02.

Future modules must register their dependencies, archive schema, ownership and restore tests before claiming workspace backup coverage. See [architecture and supported limits](ARCHITECTURE.md) and [implementation evidence](IMPLEMENTATION_EVIDENCE.md).
