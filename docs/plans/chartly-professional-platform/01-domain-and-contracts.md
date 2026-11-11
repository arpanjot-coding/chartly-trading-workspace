# P01 Canonical domain and capability contracts

Status: Complete for the bounded v1 contract scope, 2 November 2026. All eight task outputs and acceptance checks are implemented and tested. Owner: Codex. [Implementation evidence](p01/IMPLEMENTATION_EVIDENCE.md) and [recorded acceptance](p01/P01_ACCEPTANCE.json). P00 remains accepted; product services and providers are not certified by this package.

Preparation: [expanded implementation brief](p01/IMPLEMENTATION_PLAN.md), including field semantics, task-by-task outputs, valid/invalid fixture cases and compatibility handoff. Implement and validate these contracts before changing production data paths.

Current next step: [P02 durable storage implementation](p02/IMPLEMENTATION_PLAN.md). The [P01 brief](p01/IMPLEMENTATION_PLAN.md) and [state/continuation review](p01/STATE_REVIEW_AND_CONTINUATION.md) record the implementation boundary. The original UI and user records remain unchanged.

Release: R1 foundation, extended for R2/R3. Dependencies: [P00](00-product-and-workflows.md).

[Master plan](MASTER_PLAN.md)

## Outcome

Journal, charts, accounts, simulation and research refer to the same economic entities and preserve source identity.

## Implementation areas and dependencies

contracts/v1 schemas/rules/shared fixtures; services/domain validation/legacy boundaries; generated frontend domain declarations and validators; existing trader/chart models as compatibility inputs.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Define Asset, Issuer, Instrument, Listing, Contract and ProviderSymbol separately; include venue, currency, expiry, multiplier, tick size, quantity unit/step and calendar.
- Use stable internal IDs and provider aliases with validity windows. Do not use ticker text as a cross-source primary key.
- Define source capabilities separately for bars/ticks/depth/history/account sync/order types/protection and research fields; unknown and unsupported are distinct.

## Implementation checklist

- [x] **P01-T01** Write versioned schemas for owner/environment/profile, JournalBook/account, source connection, destination, instrument/data/version, practice run, artifact/experiment/deployment and research identity. Include relationship validation and explicit supported v1 scope.

- [x] **P01-T02** Define execution facts, orders, fills, cash movements and trade aggregates independently from journal decisions/reviews; model fees, native amounts and conversion provenance.

- [x] **P01-T03** Define account/execution modes, order lifecycle, reconciliation states and run lifecycle as explicit state machines with allowed transitions.

- [x] **P01-T04** Specify connector commands/events with owner/account scope, idempotency key, correlation ID, sequence/cursor, external IDs and received/event timestamps.

- [x] **P01-T05** Specify research facts with period, units, fiscal calendar, reporting basis, published/available/retrieved times, source document and revision identity.

- [x] **P01-T06** Define query scopes and calculation contracts: currency policy, timezone, review status, as-of time, dataset version and pagination.

- [x] **P01-T07** Create cross-language contract fixtures and validation shared by API boundaries; define schema-version compatibility and migration errors.

- [x] **P01-T08** Document ownership boundaries and adapters from existing records; produce sequence specifications for import, replay fill, connector fill and research revision.

## Acceptance criteria

- [x] One listing can map to different provider symbols without collisions.
- [x] Partial fills and copied decisions are representable without duplicated strategy observations.
- [x] All API/event contracts have valid and invalid fixtures and version rules.

## Required verification scenarios

- FX fractional lots, integer futures contracts, crypto precision and expired contracts.
- Dual listings, ticker reuse, stock split and reporting currency changes.
- Duplicate/out-of-order events and unknown capability manifests.

## Risks and decisions to resolve

- Overgeneralizing can delay delivery; implement needed fields while reserving extension points.
- Calendar, lot and currency assumptions must not leak from regional legacy modules.

## Scope boundary

Deferred from this package: A global security master purchase or a wholesale rewrite of existing broker modules.

## Completion evidence and handoff

Before marking P01 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified.
- [x] Evidence recorded and downstream contracts/documentation updated.
- [x] Corresponding master checkbox updated only after acceptance.

## Revision 2 required contract additions

Implemented in v1: artifact projects/revisions and embedded dependency locks, attachments, experiments/trials/splits/scenarios/validation, deployment identity, source observations/canonical links, account-source jobs/cursors/coverage/conflicts and native engine references. Profiles remain optional trading environments; research and authoring do not require them. Shared fixtures cover these shapes and boundaries. P20/P21/P22 still own actual services, engine support and reconciliation.

## Existing app preservation and book scope

Model JournalBook explicitly using existing profile/portfolio IDs as compatibility inputs. Separate book-specific entry/review membership from canonical account/source facts. Apply the confirmed rule: exactly one account per connected book, with separate manual books and separate practice scope. Define canonical account identity, same-account source reconciliation, duplicate-book policy and combined-report deduplication before implementation.

Controlling scope: [Existing app scope and journal book workflows](p00/EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md).

## Latest environment/workspace boundary

The user clarified that profiles are environments. Keep Chart and Journal as focused destinations; Open owns portfolio Overview, Connections and Settings. Journal retains its own performance Overview/Trades/Calendar/Breakdown/Mind without the portfolio tab bar. Keep one-account book ownership, saved-history paper versus connected live readiness, and independent sync. Retire Tools navigation by rehoming useful existing modules; Workflows is a primary section; using automation remains optional. [Current P00 specification](p00/ENVIRONMENT_AND_MODULE_WORKFLOWS.md). This overrides earlier book-card or shared journal-settings navigation proposals. No production change or completion is implied.
