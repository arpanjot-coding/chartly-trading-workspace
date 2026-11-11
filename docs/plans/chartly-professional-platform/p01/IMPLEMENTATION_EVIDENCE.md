# P01 implementation evidence

2 November 2026. Owner: Codex. State: Complete for the declared v1 contract scope. All eight P01 outputs and their acceptance checks are implemented and verified. P00 remains accepted. This records executable contracts, not implemented product services or certified providers.

## Delivered artifacts and task coverage

- **P01-T01:** [canonical v1 schemas](../../../../contracts/v1/schemas/domain.schema.json), [rules](../../../../contracts/v1/rules.json), generated TypeScript declarations and worked related-record collections. Owner/workspace, environment, book/account/source, asset/issuer/listing/contract, datasets/runs, artifacts/experiments/deployments and research identities are explicit. Instrument identity works without trading economics; economic quantity/order checks require the missing metadata. Profile references preserve original entry points and allow several account books/destinations.
- **P01-T02:** manual assertions/memberships, account intents/commands/acknowledgements/fills, native money, fee adjustments, cash movements, account trade aggregates and separate decision/review records. Fixtures include partial fills, account-scoped native IDs, one copied decision, fee corrections and open trades without fabricated close times. This package supplies no matching/P&L algorithm.
- **P01-T03:** shared state graphs and both runtime transition validators. Tests reject blind resubmission of an unknown order, premature Ready and unapproved arming. Connection configuration, measured health, eligibility and arming remain independent; no validation call changes a broker or process.
- **P01-T04:** strict versioned command/event envelopes, correlation/causation, occurrence/receipt time, optional provider cursor/sequence and exact payload scope. Research/data/artifact events remain account-independent. Native provider and canonical account custodian are separate identities. Duplicate and out-of-order cases are represented without a network-wide exactly-once claim.
- **P01-T05:** immutable documents/facts/revisions/derived metrics/notebook snapshots, native currency and fiscal-period semantics. Tests reject invalid dates, missing provenance, impossible availability order, future evidence and revision mutation; amended/zero/native-currency facts remain explicit. The first supported entity shape is an Issuer, not a duplicate portfolio.
- **P01-T06:** explicit selection/query and metric-output contracts, UTC half-open bounds, timezone, native/conversion policy, pagination, formula/sample/scope metadata and unavailable reasons. Empty selection means none. Tests cover empty profit-factor sample, DST bounds, missing dated conversion provenance and no implicit zero/rounding. Actual formulas/analytics remain P03/P21 work.
- **P01-T07:** real Python/TypeScript validators over one schema and relationship declaration set; shared independently expected fixtures; generated-type drift check. Tests cover scope, money/quantity precision, types/versions, unsupported capabilities, missing references, source coverage, immutable evidence, dependency cycles and symbol validity windows. New Python tests and declaration checking are wired into existing CI; frontend CI already collects these tests.
- **P01-T08:** [legacy field/ownership mapping](../../../../contracts/v1/LEGACY_MAPPING.md), conservative executable classifiers/alias adapters in both runtimes, and [import/replay/sync/research/experiment sequences](../../../../contracts/v1/HANDOFF_SEQUENCES.md). All seven trader tables and the separate native chart store are included in the handoff. Raw ambiguous records remain staged; no production record is migrated or guessed into an account.

## Verification record

Final checks passed **522 backend tests across seven files** and **343 frontend tests across 22 files**, including the existing original UI/Flow/retirement seams. Of these, 138 backend and 135 frontend tests cover the new domain/legacy boundaries. The shared manifest contains 112 independently expected domain cases, plus ten shared legacy classification examples. All 57 public record shapes have a worked positive fixture. Final source/fixture hashes are recorded in [P01 acceptance](P01_ACCEPTANCE.json).

The frontend run used repository-supported Node **22.23.4**, and the production TypeScript/Vite build passed on that runtime. Python **3.14.7**, jsonschema **4.26.0**, Ajv **8.20.0** and Vitest **4.1.12** were used. Generated declarations match the canonical schemas; Ruff and Biome checks passed on the new handwritten code. The 32 accepted P00 design tests still pass. The installed default Node 24.19.0 is below the declared engine range and is not the supported-runtime evidence; no system runtime was replaced.

Verification commands:

```powershell
.\.venv\Scripts\python.exe contracts/generate_types.py --check
$env:LOG_FORMAT='%(levelname)s: %(message)s'
.\.venv\Scripts\python.exe -m pytest test/test_domain_contracts.py test/test_domain_legacy.py test/test_react_workspace_routes.py test/test_retired_features.py test/test_flow_workflow_validator.py test/test_flow_lifecycle_guards.py test/test_custom_indicators_cache.py -q --tb=short -o cache_dir=tmp/pytest-cache-p01 --basetemp=tmp/pytest-p01-accepted
```

From `frontend`, run the shared domain tests plus the selected navigation/settings/journal/Combined Analysis/script/indicator/backtest/replay regressions listed in [the state review](STATE_REVIEW_AND_CONTINUATION.md). The supported Node binary is isolated under `tmp/p01-node`; it does not replace the system installation. Run `tsc -b`, `vite build`, and Biome on the four new handwritten TypeScript source/test files. Run Ruff on `services/domain`, `contracts/generate_types.py` and the two new Python tests.

## Limits and handoff

P01 is a bounded local-core contract implementation. The schema can represent metadata for other instrument families; it does not certify their economic engines, historical feeds or execution. Receipt/blob/policy IDs require resolution and content validation by their owning service. The Python/TypeScript contracts do not authenticate requests, make a database transaction or authorize orders. Real adapters and licensing are unchanged.

The production UI still uses existing browser stores and legacy broker context. Next is P02: inventory/export actual stores, implement scoped repositories and transactional constraints, then migration preview/recovery and the standalone journal journey. The original chart/journal UI remains the baseline; P00 is not reopened. Never clear original browser data to make a migration test pass.

Build output retains existing large-chunk/dynamic-import warnings. Some standalone Python runs also reported an existing strategy cleanup logger writing after pytest capture closed; the isolated regression process passed. These are diagnostics, not newly claimed provider/installation certification. CI matrix verification is configured but was not run remotely during this local implementation.
