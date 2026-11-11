# P01 contract implementation brief

Status: Complete for v1; all eight P01 contract tasks accepted against [implementation evidence](IMPLEMENTATION_EVIDENCE.md). P00 decisions and screen/storyboard baseline remain accepted. Owner: Codex. Baseline: [P00 decisions](../p00/P00_DECISIONS.md), [screen contracts](../p00/P00_SCREEN_CONTRACTS.md) and [P01 checklist](../01-domain-and-contracts.md).

## Implementation boundary

Create versioned, executable domain contracts and independent valid/invalid fixtures before wiring APIs or migrating user records. This package changes no existing broker dispatch path or production storage ownership. P02 owns migration and repository endpoints; P07 owns real adapters. Compatibility mappings preserve legacy records until those packages accept their migrations.

Current priorities and observed gaps: [app state and continuation review](STATE_REVIEW_AND_CONTINUATION.md). P00 is accepted. The work below implements that baseline; it does not reopen the confirmed book ownership or navigation decisions.

## First implementation batch — identity and executable validation

State: Completed and tested, followed by the remaining v1 batches below. Owner: Codex. See [evidence](IMPLEMENTATION_EVIDENCE.md) for exact outputs, supported scope and limits.

1. Inventory the existing profile, journal, chart-workspace, source and account-key shapes. Write the legacy-to-canonical mapping before choosing IDs. Include the trader Dexie store and the chart library's separate IndexedDB workspace store. A profile may reference a book; its existing numeric ID is not automatically the book or account ID.
2. Choose one versioned schema representation and validator error format. `pyproject.toml` already declares JSON Schema and Pydantic packages; the frontend manifest does not declare a direct JSON Schema validator. Inspect installed versions and supported schema/format behavior, then record the smallest compatible choice before adding a dependency. Do not maintain separate handwritten Python and TypeScript schema definitions.
3. Define the minimal local-core records: owner scope, environment/profile, account, JournalBook, source reference, instrument/unit envelope and capability/mode envelope. Validate decimal strings, timestamp semantics and explicit unknown values. Reserve versioned extension boundaries for future asset/provider details; unsupported fields or capabilities cannot imply support.
4. Add relationship validation over a fixture collection. Enforce one active connected book per canonical account, manual-book separation, matching owner/account/source scope and legal references. Document which guarantees P02 must enforce transactionally; record validation cannot replace a database constraint.
5. Run identical positive/negative fixtures through both runtime adapters. Return stable error code and field/reference path. Prove that malformed records, ambiguous legacy identities and unsupported schema versions fail before any consumer receives a valid domain object.

Proposed outputs, confirmed against repository conventions before implementation:

- `contracts/v1/README.md`: supported schema version/dialect, local-core support matrix, ownership, error/unknown-field policy and extension rules.
- `contracts/v1/schemas/`, `contracts/v1/fixtures/` and `contracts/v1/fixture-manifest.json`: machine-readable definitions, independently authored cases and expected acceptance/error paths.
- `services/domain/validation.py` and `frontend/src/lib/domain/validation.ts`: thin validation/compatibility boundaries consuming those definitions, with no storage or broker side effects.
- `test/test_domain_contracts.py` and `frontend/src/lib/domain/validation.test.ts`: both consume the same fixture manifest; include collection-level relationship checks.
- A legacy mapping document under `contracts/v1/`: field origins, aliases, recoverable source payload and unresolved migration classifications for P02.

Required fixtures for this batch: a valid standalone manual book; a connected account with its single active book; another profile referencing that same book; two active books claiming that account; a manual book claiming an external account; cross-owner references; the same native account text at two providers; invalid decimal precision/unit; ambiguous local time; unknown capability; and an unsupported schema version. Archive/reconnect cases must preserve the account/book identity rather than duplicate it.

Batch exit: both runtimes agree on every expected outcome; relationship checks reject the duplicate-book case; mapping examples preserve original IDs/payloads without guessing; validator/tool versions and exact test commands/results are recorded. Run the affected existing journal/replay tests if integration imports change. No new production endpoints, database rename, migration, feature UI or broker dispatch change belongs in this batch. The subsequent v1 batches now complete T01/T07/T08 as recorded in the package evidence; a first-batch result alone would not have completed them.

## Subsequent P01 batches completed for v1

After the first batch passes, extend the same contract set in this order:

1. T02/T03/T04/T06: execution/journal facts, decimal accounting inputs, explicit modes/transitions, envelopes and scoped query semantics. Test partial fills/corrections, cross-account duplicates, forbidden historical-to-live commands, empty selections and unavailable metrics.
2. Complete T01/T05: immutable dataset/run/checkpoint, artifact/revision/dependency/experiment/validation/deployment envelopes and point-in-time research/source-document identity. Define supported shapes and invariants here; P01 does not implement their services. Test edited revisions, incompatible engines/units and research unavailable at the requested historical time.
3. Complete T07/T08: source-observation/sync/coverage/conflict contracts, cross-source canonical execution identity, complete legacy classifications and import/replay/sync/research sequence specifications. Include both browser-store inventories and transaction/backup requirements in the P02 handoff.

Record evidence against each task's full output below. All eight tasks and package acceptance must pass before moving production data to the new contracts.

## Contract decisions

1. Use opaque stable canonical IDs, scoped by local owner/workspace. Preserve legacy numeric IDs as explicit aliases; do not stringify a legacy number and assume global uniqueness.
2. Wire money, quantity, price and ratios as validated decimal strings with explicit currency/unit and allowed precision. Avoid float-only accounting and JavaScript number precision loss. Instrument metadata defines tick/step conversion; never round silently at the identity layer.
3. Instants use timezone-bearing UTC timestamps; trading dates/periods remain separate from instants. Source and display timezone are explicit. Ambiguous local timestamps fail import validation until resolved.
4. Optional/unknown values are absent or explicitly unknown, not default zero. Capability states are supported/unsupported/unknown with versioned evidence; a missing manifest must not enable an action.
5. Dataset versions, run manifests and saved research evidence are immutable. Corrected source data creates a revision; editable user notes have revision/concurrency metadata.
6. Paper replay, paper live, demo broker and live broker are distinct execution environments. A context must bind one allowed authority, instrument and account/run before an executable command can validate.
7. Execution fact identity includes provider/connection/account/external event. Parent decision and child account trades are separate so copied fills do not inflate decision-level observations.
8. Aggregate ownership is explicit; ID shape alone never grants access. Credential references may occur in connection records, actual secrets do not occur in domain events or research snapshots.

## P01 T01 Entity schemas

Proposed implementation areas: `contracts/v1/` for canonical machine-readable schemas and examples; `frontend/src/lib/domain/` and `services/domain/` for typed validation/compatibility boundaries. Confirm naming against existing conventions before creating files. Do not add another database in this task.

Define minimal complete schemas for:

- Owner/workspace and Profile: stable identity, strategy/review scope, currency, timezone, lifecycle and revision.
- Account: external or simulated identity, source references and aliases, demo/live classification, currency and verified identity.
- JournalBook: manual/connected/paper kind; exactly one external account for connected, one simulated account for paper, no external account for manual; one active connected book per canonical account. Reconnection reopens it; archive/migration never guesses identity.
- Asset/Issuer, Instrument, Listing/Contract and ProviderSymbol: economic identity, venue/currency/expiry, quantity/tick units, calendar and alias validity.
- SourceConnection and CapabilityManifest: adapter version, data/account/order/research capabilities, environment, credential reference, measured health timestamp and verification scope.
- ExecutionDestination: account binding, native instrument mapping, risk-policy reference, eligibility and arming intent; observed health remains separate.
- Dataset/DatasetVersion: source/scope, instrument, native interval, price/adjustment basis, timestamp/calendar, checksum, coverage and quality.
- PracticeProject/RunManifest/Checkpoint: hypothesis, pinned dataset/engine, window, cash/cost/fill assumptions, state and ledger position.
- ResearchEntity/DocumentVersion/NotebookSnapshot: source identity, content checksum, publication/availability/retrieval time, stable citation and immutable captured evidence.

For every schema record required versus optional fields, invariants, examples, compatibility version and intended owner. Keep credentials out of examples. Exit: valid samples and invalid missing/mismatched owner/ID/currency/precision cases validate as expected in both runtimes.

## P01 T02 Execution and journal accounting

Specify OrderIntent, ChildCommand, BrokerAcknowledgement, ExecutionFill, FeeAdjustment, CashMovement, TradeAggregate, Decision and Review. Fill includes native IDs/quantity/price/time/currency and optional source correction lineage. A review cannot overwrite fill facts. Cash deposits/withdrawals are not trading profit. Unknown fees/risk remain unknown.

Define netting versus hedging aggregation policy references, partial-close links and account versus decision reporting scope. Do not implement matching or derive broker positions from an unverified acknowledgement. Exit fixtures: scale-in/partial-exit; fee correction; copied decision across two accounts; external event ID collision across accounts; absent close time for an open trade.

## P01 T03 State machines

Provide allowed transitions with rejection reasons for connection configuration/health/eligibility/arming; order submission/ack/partial/fill/cancel/reject/unknown/reconciliation; and run draft/data-needed/ready/in-progress/finished/abandoned. Keep orthogonal states separate; for example a connected account may be unarmed and an acknowledged order may be unfilled.

Unknown submission can resolve to an observed broker state but cannot transition directly to an untracked fresh submit. Run readiness requires a validated immutable manifest; a status label alone cannot establish completion. Exit: transition tests covering both accepted recovery and prohibited shortcuts, including historical intent against a live destination.

## P01 T04 Command and event envelopes

Every envelope includes schema version, event/command ID, correlation/causation identity, owner/workspace scope, account or run, producer/adapter version, occurred/received times and idempotency reference where applicable. Cursor/sequence can be absent if a provider lacks it; document overlap/reconciliation policy instead of inventing ordering certainty.

Define accepted/rejected/unknown command results distinctly and validate account/environment consistency. Test duplicate/out-of-order delivery, cross-account events, timeout with a known external order reference and a request carrying an unsupported schema version. No fixture contains executable credentials.

## P01 T05 Point in time research facts

Define FactObservation, FactRevision and DerivedMetric with entity/instrument, taxonomy/metric identity, unit/currency, instant/duration period, reporting basis, fiscal calendar, source document/citation, published/available/retrieved times and revision/formula provenance. Versioned derivation lists input fact revisions.

Fixtures must include original versus amended filing, duration versus instant facts, non-calendar fiscal year, restated prior period, two currencies, missing denominator and a historical query before publication. User hypotheses and AI text are annotated research, never reported facts.

## P01 T06 Scope and calculation query contracts

Define query DTOs for local owner/profile/account scope, explicit rolling/calendar date bounds, trading timezone, review status, strategy, as-of time, dataset version and stable pagination. Empty account selection means no accounts, not all. Specify decimal serialization and currency policy; conversion requires a dated source reference.

Define statistics inputs/outputs with sample size and null/undefined conditions. Reuse corrected formulas from P03 later; P01 must not invent a universal score. Fixtures cover empty selection, break-even denominator policy, missing currency conversion, DST-crossing bounds and stable cursor ordering with equal timestamps.

## P01 T07 Shared validation and fixtures

Choose one canonical schema representation and verify available Python/TypeScript validation tooling before implementation. Produce runtime-neutral positive/negative fixtures under `contracts/v1/fixtures/`; both validation adapters consume the same cases. Define expected error code/path, not brittle library-specific prose. Document supported schema versions, unknown fields and compatibility/upgrade rules.

Test actual economic and scope invariants, not snapshots that merely duplicate a schema. Required negative cases include invalid decimal precision, quantity unit mismatch, local timestamp without resolved zone, cross-account command, unsupported capability, invalid transition, absent source provenance and future-available research fact. Existing frontend trader/replay tests remain regression inputs, not replacements for this suite.

## P01 T08 Compatibility and handoff

Map each legacy Dexie profile/session/trade/destination field to the new owner, identity, decimal, mode and lifecycle contracts. Preserve raw legacy payload for migration audit; classify fields that cannot be inferred. Missing close time or legacy origin does not authorize fabricated values. Explicitly identify global broker/API assumptions that P07/P11 must wrap.

Write sequence specifications for statement import commit/deduplication, replay command/fill/checkpoint/journal, connector fill/reconciliation and research revision/snapshot. Define transaction boundary expectations without implementing P02 storage prematurely. Handoff to P02 includes schema versions, alias policy, export manifest requirements and all unresolved migration classifications.

## Evidence before ticking P01

All eight v1 tasks now have artifacts and shared valid/invalid tests, recorded in [implementation evidence](IMPLEMENTATION_EVIDENCE.md). No connected account, migration or production release is certified by contract tests alone.

## Revision 2 prerequisite

The v1 schemas and fixtures include the [foundation review](../p00/FOUNDATION_REVIEW_V2.md) additions for artifacts/dependencies/experiments/deployments and source observations/sync/coverage/reconciliation. These declare boundaries; P20/P21/P22 implement their services. Preserve multiple engines through explicit supported parity checks; manual replay, automated backtests and live execution do not share every semantic.

## Existing journal book prerequisite

Use the [existing-app/book scope](../p00/EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md). Ownership direction is confirmed: exactly one account per connected book, separate books for manual records, and distinct practice scope. The user confirmed one active connected book per canonical account. Freeze executable identity, legacy alias/classification, per-book review isolation and cross-source reconciliation schemas against P00 D01–D16; do not reopen the confirmed product ownership rule. Existing profile IDs are compatibility inputs; no forced replacement UI or immediate storage rename is authorized.

## Environment versus book contract

Apply the [current P00 decisions](../p00/P00_DECISIONS.md) and [whole-product blueprint](../p00/APP_WORKFLOW_BLUEPRINT.md). Profile/environment, journal book, account, source, execution runtime and chart document have distinct identities. Preserve original profile entry points; do not flatten environments into books. Journal and chart have focused frames; Open owns management. Implement D01/D08/D09 cardinality and conservative legacy multi-destination classification contracts before P02 migration. Multiple profiles may reference a book; they must not duplicate its canonical executions in Combined Analysis.
