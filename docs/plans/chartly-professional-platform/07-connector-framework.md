# P07 Connector framework and certification harness

Status: **Complete within the read-only framework scope, 3 November 2026.** The [detailed ordered implementation plan](p07/IMPLEMENTATION_PLAN.md) preceded implementation. All eight tasks passed implementation, independent review and required verification, including the server-enforced replay history requirement. Existing UI remains the base; provider access and certification boundaries stay explicit. [Implementation evidence](p07/IMPLEMENTATION_EVIDENCE.md), [actual screen review](p07/BROWSER_ACCEPTANCE.md), [independent findings](p07/INDEPENDENT_REVIEW.md), [verification commands](p07/VERIFICATION_COMMANDS.md).

Release: R2 foundation. Dependencies: [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md).

[Master plan](MASTER_PLAN.md)

## Outcome

Each integration declares measurable support and recovers its connection, sync and account state consistently.

## Implementation areas and dependencies

Existing broker adapters/capabilities, auth services, profile connection configuration and strategy reconciliation.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Adapter interfaces separate market data, account history, order execution, research and local bridge transport.
- Backend owns credentials/account scope and measured health. User labels/toggles remain configuration intent.
- Use shared manifests and conformance fixtures; exchange/broker/terminal differences remain in individual adapters.

## Implementation checklist

- [x] **P07-T01** Perform access spikes for one crypto venue, MT5 or accessible retail platform, and an available brokerage; record OS, credentials, demo access, quotas and blocking approvals.

- [x] **P07-T02** Define adapter lifecycle, credential references, capability versions, heartbeats, token refresh and connected/stale/degraded/recovering states.

- [x] **P07-T03** Implement connection registry and read-only setup wizard with verified external account identity, granted scope and exact data/execution capabilities.

- [x] **P07-T04** Build secret storage using appropriate local OS-backed protection or encrypted local vault; redact logs/export and avoid browser secrets.

- [x] **P07-T05** Implement account-scoped history ingestion with cursor/backfill overlap, event deduplication, revision handling and reconnect reconciliation.

- [x] **P07-T06** Create deterministic fake adapter and fault injection for rate limits, disconnects, stale quotes, token expiry, partial fills and unknown submissions.

- [x] **P07-T07** Build conformance suite and capability matrix; require recorded evidence before raising an adapter readiness level.

- [x] **P07-T08** Specify per-adapter subplan template and certification artifacts including supported products, native protection, symbol/quantity rules and version ownership.

## Acceptance criteria

- [x] Configured identity cannot masquerade as observed connection health.
- [x] One fake adapter passes reconnect/deduplication/account-isolation tests.
- [x] Every first real adapter has a documented accessible test environment and support boundary.

## Required verification scenarios

- Expired/revoked secrets, wrong account identity and provider quota responses.
- Reordered/missing/duplicate events and reconnect after extended outage.
- Private data scoping and credential leakage checks.

## Risks and decisions to resolve

- External account/vendor approval can block an adapter; report it without blocking local-core delivery.
- Library abstraction does not certify provider coverage.

## Scope boundary

Deferred from this package: Certifying every broker, hosted credential custody and a generic credential-sharing bridge.

## Completion evidence and handoff

Before marking P07 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified.
- [x] Evidence recorded and downstream contracts/documentation updated.
- [x] Corresponding master checkbox updated only after acceptance.

Accepted evidence includes **1,503 backend tests across 64 files**, **2,419 frontend tests across 220 suites**, final focused correction/journal tests, types/build/static checks, 84 preserved P00 tests, the 104-case forward-gate harness, actual original-screen journeys and independent review. Focused counts overlap the full selections. The original chart remains the base. Replay projects now require owned history before creation; optional session tags, exact source defaults and independent run capital are verified.

MT5 was read-only tested against the authorized running Windows demo terminal, with attachment cleanup and no login/orders/settings changes. Account/raw-history scope is measured; provider-clock alignment and complete deal accounting remain unverified. Kraken proves public reachability only. Brokerage authentication prerequisites and blocked private access are recorded, not certified. The encrypted local vault excludes secrets from exports/restore and resets restored runtime authority. P08–P22 remain open, including provider-family certification, execution, maintained startup synchronization and strategy/research products. Leveraged paper economics and dynamic spreads require the separate [extension plan](p07/REPLAY_COST_AND_LEVERAGE_EXTENSION.md).

## Accepted connection workflow follow-up

The initial evidence above remains historical; it is not overwritten. The [reviewed follow-up](p07/workflow-followup/IMPLEMENTATION_EVIDENCE.md) now supplies a coherent Connections/History hub, visible provider categories including MT5, direct live-profile creation, protected password-free personal-PC storage, broker-independent app-account tools, and actual bounded Kraken public candle ingestion into the original chart. Final compatibility passed **1,581 backend tests / 68 modules** and **2,495 frontend tests / 230 suites**, with browser, ownership, static and resource checks. The [ordered checklist](p07/CONNECTION_WORKFLOW_FOLLOWUP.md) and [architecture](p07/workflow-followup/ARCHITECTURE.md) record the changes.

All requested platform families are [inventoried with their delivery order](provider-connectivity/README.md). Planned/private adapters are not completed by that listing. P08–P22 remain open; MT5 clock/canonical journal conversion, private exchange/broker access, terminal bridges and execution retain their separate acceptance requirements.

## Foundation revision 2 integration requirement

History-only sources are first-class and support P22 independently of execution. Registry distinguishes remote aggregators, direct APIs and local terminal bridges. Declare source history windows/timezone/units, session limits, coverage and reconciliation capabilities.

See [foundation review](p00/FOUNDATION_REVIEW_V2.md) and P20/P21/P22.

## Confirmed book ownership

Each connected book belongs to exactly one account; manual records live in separate books. Multiple sources for the same account reconcile within its book. Copying to several accounts creates separate account-specific journal outcomes, never a multi-account book. Preserve existing IDs until migration is defined. See the [original-screen workflow review](p00/ORIGINAL_SCREEN_WORKFLOW_REVIEW.md).
