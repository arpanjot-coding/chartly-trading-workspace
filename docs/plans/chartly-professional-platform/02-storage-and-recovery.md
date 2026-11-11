# P02 Durable storage migration and recovery

Status: Complete for the published file-backed local SQLite scope. All eight tasks have implementation, test and browser-journey evidence. [Acceptance](p02/P02_ACCEPTANCE.json), [evidence](p02/IMPLEMENTATION_EVIDENCE.md), [detailed implementation](p02/IMPLEMENTATION_PLAN.md), [API](p02/API_AND_ACCOUNT_ACCESS.md), [architecture](p02/ARCHITECTURE.md) and [recovery guide](p02/RECOVERY_GUIDE.md). P03–P22 remain separate work.

Release: R1. Dependencies: [P01](01-domain-and-contracts.md).

[Master plan](MASTER_PLAN.md)

## Outcome

User records survive browser changes, upgrades and restarts, and a full backup restores a working workspace.

## Implementation areas and dependencies

Dexie ChartlyTraderDB; useTraderData; backend SQLite databases; Historify DuckDB; chart workspace import/export.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Local backend relational storage owns journal/accounts/run/research metadata; DuckDB owns historical analytical data. IndexedDB retains drafts/cache and migration staging.
- Keep imported legacy provenance and source-origin identity. No destructive migration or automatic browser clearing before verified transfer.
- Backups have manifest/schema versions/checksums and a consistent snapshot strategy; attachments and selected datasets are included or explicitly excluded.
- Inventory both the trader Dexie DB and the chart library's IndexedDB workspace repository, plus existing backend stores. Preserve original browser data until verified transfer/restore; replace unsafe profile-delete cascades through explicit archive/retention rules.
- Deliver the backup/restore registry and manifests for actual implemented modules. Future research/project/runtime modules must register dependencies and restore tests before their release; they must not block recovery of today's local core or be falsely reported as included.

## Implementation checklist

- [x] **P02-T01** Inventory every storage location, table, attachment and secret; define authoritative versus cache ownership and retention policy.

- [x] **P02-T02** Add transactional repositories and scoped APIs for profiles, accounts, trades/reviews, runs and attachments with validation, revision and concurrency handling.

- [x] **P02-T03** Implement browser export/staging into the backend with stable legacy mapping, resumable migration job and per-table counts/checksums.

- [x] **P02-T04** Build migration preview, duplicate resolution and completion receipt; keep the original browser data and provide safe repeat execution.

- [x] **P02-T05** Create full backup/restore including database relations, chart layouts, notes, practice checkpoints and dataset manifests; isolate credential export policy.

- [x] **P02-T06** Implement soft deletion/archive, retention, restore and referential rules; deleting a run cannot orphan journal provenance.

- [x] **P02-T07** Add visible save progress/failure/retry and dirty-draft recovery; coordinate updates across browser tabs and reject stale overwrites.

- [x] **P02-T08** Exercise interrupted migrations and restore on a clean installation; document backup-before-upgrade and failure rollback/recovery procedures.

## Acceptance criteria

- [x] Clearing browser cache after verified migration does not delete the journal.
- [x] Repeat migration produces the same records, not duplicates.
- [x] Restored records, attachments and analytics match the source fixture.

## Required verification scenarios

- Disk full, locked database, concurrent edit, abrupt stop and corrupt archive.
- Multiple browser origins/profiles importing overlapping records.
- Old schema backup restore and invalid parent/child references.

## Risks and decisions to resolve

- Backend process shutdown during snapshot requires a consistent backup strategy.
- Secrets need separate protection and cannot be included casually in portable reports.

## Scope boundary

Deferred from this package: Cloud sync, multi-tenant hosting and distributed database infrastructure.

## Completion evidence and handoff

Before marking P02 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified.
- [x] Evidence recorded and downstream contracts/documentation updated.
- [x] Corresponding master checkbox updated only after acceptance.

## Foundation revision 2 integration requirement

Include source observations/reconciliation links, source coverage/cursors, immutable code/dependencies, experiment trials/seeds/results and deployment revisions in migration and backup. No silent replacement of unavailable restored dependencies.

See [foundation review](p00/FOUNDATION_REVIEW_V2.md) and P20/P21/P22.

## Existing app preservation and book scope

Preserve each existing journal/profile book identity, annotations, settings, calendar, source bindings and relationships in migration/restore. Do not flatten independent books into one global trade list. Archive/delete must account for active sync, practice runs and deployments.

Controlling scope: [Existing app scope and journal book workflows](p00/EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md).

## Confirmed book ownership

Each connected book belongs to exactly one account; manual records live in separate books. Multiple sources for the same account reconcile within its book. Copying to several accounts creates separate account-specific journal outcomes, never a multi-account book. Preserve existing IDs until migration is defined. See the [original-screen workflow review](p00/ORIGINAL_SCREEN_WORKFLOW_REVIEW.md).

