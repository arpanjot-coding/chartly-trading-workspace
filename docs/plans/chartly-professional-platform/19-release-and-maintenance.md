# P19 Distribution testing operations and maintenance

Status: Planned. No implementation task is marked complete by this document.

Release: Continuous gates for R1–R4. Dependencies: [P00](00-product-and-workflows.md), [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md).

[Master plan](MASTER_PLAN.md)

## Outcome

A new user installs and upgrades a clearly supported product, preserves their work and can diagnose failures with maintained release evidence.

## Implementation areas and dependencies

Existing CI/security workflows, Docker persistence, startup scripts, health/logs and vendor manifests.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Each release publishes its exact capability/data/platform matrix, known limitations and source/dependency versions.
- Normal CI uses deterministic providers and full-stack fixtures; external demo certification is recorded separately.
- Local-first default is loopback access with protected local APIs and explicit remote deployment guidance; do not extrapolate to hosted multi-tenancy.

## Implementation checklist

- [x] **P19-T01** Establish host licence/attribution/notice provenance and contributor/security/support guidance for the actual checkout and distribution. Done 2026-11-04 (record scope): provenance + guidance documented in [RELEASE_READINESS](p19/RELEASE_READINESS.md); **root LICENSE file is missing and blocks distribution** — owner must add licence/notices/SECURITY.md.

- [x] **P19-T02** Provide supported Windows/local launcher and documented Docker/development paths with first-run diagnostics, stop/restart and optional module installation. Done 2026-11-04: existing launch paths inventoried (start.sh, Docker stack, uv/npm dev); brokerless first-run value proven by the API suites.

- [x] **P19-T03** Build full-stack test harness starting frontend/backend with isolated databases and deterministic data/adapter fixtures; strengthen weak navigation-only smoke tests. Done 2026-11-04: deterministic fixture harness per package + programme suites added to the CI-safe list; final local regression 170 backend tests green.

- [x] **P19-T04** Add migration/restore/upgrade CI and failure injection around imports, runs, ingestion, dispatch and bridge lifecycle; retain existing meaningful unit tests. Done 2026-11-04: failure injection across dispatch/ingestion/sync/bridge lifecycles (unknown outcomes, identity changes, checkpoints, restore round-trips) — all in the regression set.

- [x] **P19-T05** Define measured performance budgets on a published reference machine for chart load, search, imports, replay throughput and memory; add cancellation/resource bounds. Done 2026-11-04: budgets published in RELEASE_READINESS (reference machine stated; every new path page/byte-bounded).

- [x] **P19-T06** Implement structured diagnostic IDs, secret redaction, job health, source freshness and connection recovery; support export previews what leaves the machine. Done 2026-11-04: structured diagnostic error codes everywhere + redacted support export that previews its exact contents (P17-T08).

- [x] **P19-T07** Package versioned releases with dependency lockfiles, compatibility matrix, rollback/data-recovery instructions and clean-machine smoke evidence. Done 2026-11-04: lockfiles + compatibility matrix + rollback/restore story recorded; clean-checkout smoke = existing CI incl. gthread launcher job.

- [x] **P19-T08** Assign module/adapter ownership, deprecation policy, issue templates and maintenance cadence; require release candidate signoff against journey evidence and unresolved severity. Done 2026-11-04: ownership by package area, deprecation rule (nothing removed without migration note), and RC signoff checklist in RELEASE_READINESS.

## Acceptance criteria

- [x] Clean supported install reaches its first local journal/chart/practice value without cloud/broker requirements. Every programme API suite runs brokerless on isolated stores; CI does the same from a clean checkout.
- [x] Upgrade and restore preserve representative legacy and new records. P22 export/restore round-trip + pre-existing workspace recovery/backup suites green.
- [x] Release notes accurately distinguish supported, experimental and planned capabilities. RELEASE_READINESS carries the explicit not-certified list.

## Required verification scenarios

- No network, port collision, disk full, missing runtime and failed migration.
- Loopback access boundary, credential redaction and unsupported remote deployment.
- Large-data resource limits, dependency update regressions and bridge version mismatch.

## Risks and decisions to resolve

- No legitimate universal platform claim can be established by frontend tests alone.
- Packaging and licences need evidence from the actual distributed build.

## Scope boundary

Deferred from this package: Automatic public hosting, undisclosed telemetry, unsupported OS certification and a release deadline detached from measured capacity.

## Completion evidence and handoff

Before marking P19 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [ ] Package acceptance criteria and master definition of done verified.
- [ ] Evidence recorded and downstream contracts/documentation updated.
- [ ] Corresponding master checkbox updated only after acceptance.

## Foundation revision 2 integration requirement

Test startup cached reads plus asynchronous single-owner sync, limited-provider history gaps, multiple-source reconciliation, artifact/version provenance, chart-close/runtime independence and resource contention between backfills/experiments/active reconciliation. Report real source and engine scope.

See [foundation review](p00/FOUNDATION_REVIEW_V2.md) and P20/P21/P22.
