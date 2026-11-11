# P04 Data Library and historical quality

Status: Complete, 3 November 2026, for the private local Data Library and finite download infrastructure. All eight tasks passed the [detailed implementation plan](p04/IMPLEMENTATION_PLAN.md), [recorded verification](p04/IMPLEMENTATION_EVIDENCE.md) and [acceptance gate](p04/P04_ACCEPTANCE.json). Real-provider certification remains P07 work; simulation execution remains P06 work. P05 chart workflow integration is next.

Release: R1. Dependencies: [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md).

[Master plan](MASTER_PLAN.md)

## Outcome

Users discover, import, validate and reuse historical datasets without an execution connection.

## Implementation areas and dependencies

The existing Historify header, chart/grid/pane and Workspace practice form remain the UI base. Private data uses `data_library_db.py`, `data_library.py`, `dataset_quality.py`, `dataset_downloads.py`, `dataset_provider.py`, the local dataset blueprint/worker and the typed Data Library client/feed. Existing global provider tools stay separately guarded; they are not relabelled as private stores. See the [architecture](p04/ARCHITECTURE.md).

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Reuse DuckDB and the existing chart machinery behind private versioned Dataset APIs; do not expose shared legacy history as private data.
- Dataset identity includes provider/private scope/instrument/resolution/price basis/adjustments/calendar; versions are immutable once used by a run.
- Trade statement import and market-history import are different flows and explain their different outcomes.

## Implementation checklist

- [x] **P04-T01** Expose Data Library through local-app access and profile/chart/practice return paths; remove execution-account prerequisites from local data operations.

- [x] **P04-T02** Add import staging with column mapping, timestamp units/timezone, instrument metadata, volume meaning and supported native intervals.

- [x] **P04-T03** Validate OHLC coherence, ordering, duplicate timestamps, timezone ambiguity and gaps; show accepted/rejected/changed rows before commit.

- [x] **P04-T04** Introduce source-scoped dataset/version keys, checksums, coverage segments, quality reports and keep/replace/new-version conflict policies.

- [x] **P04-T05** Use UTC storage plus explicit exchange/session calendars; replace host-local and fixed-IST window/aggregation assumptions.

- [x] **P04-T06** Provide catalog/detail with coverage/resolution/quality/local size and Open chart/Create run/Export actions, retaining selected context.

- [x] **P04-T07** Integrate broker/provider downloads as durable cancellable jobs with quota-aware retry and resumable checkpoints.

- [x] **P04-T08** Add dataset retention, backup links and dependency checks so removing history never silently breaks a saved run.

## Acceptance criteria

- [x] Valid imported history opens without selecting an execution broker.
- [x] Two sources for the same symbol coexist and a saved run retains its version.
- [x] An import report explains rejected rows, gaps and timestamp conversion.

## Required verification scenarios

- Seconds/milliseconds, naive time, DST, invalid candles and unavailable volume.
- Negative-price instruments, market breaks and continuous-contract rolls.
- Interrupted import, overlapping sources, cancellation and referenced-version deletion.

## Risks and decisions to resolve

- Quality checks must account for genuine market calendars rather than treating every missing minute as corruption.
- Source permissions and private account data must remain attached to stored datasets.

## Scope boundary

Deferred from this package: Unlimited free global history, automatic source blending without provenance and always-on cloud ingestion.

## Completion evidence and handoff

All eight tasks passed the recorded local/native-history scope on 3 November 2026. The evidence links above contain implementation files, API/migration boundaries, current hashes, tests, browser journeys, resource checks and recovery procedures. Download lifecycle and owner-bound adapter behavior are fixture-verified; real-provider conformance is explicitly deferred to P07. Simulation execution remains P06. No future package checkbox is changed.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified.
- [x] Evidence recorded and downstream contracts/documentation updated.
- [x] Corresponding master checkbox updated only after acceptance.
