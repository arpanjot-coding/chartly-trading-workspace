# P06 Historical paper sessions and simulation

Status: Complete within the supported linear native-OHLC scope, 3 November 2026. The [detailed ordered implementation plan](p06/IMPLEMENTATION_PLAN.md) preceded implementation. All eight tasks passed implementation, regression tests, independent review and original-screen recovery journeys. The existing chart UI remains the base. [Implementation evidence](p06/IMPLEMENTATION_EVIDENCE.md), [browser acceptance](p06/BROWSER_ACCEPTANCE.md), [independent review](p06/INDEPENDENT_REVIEW.md), [verification commands](p06/VERIFICATION_COMMANDS.md).

Release: R1. Dependencies: [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md), [P03](03-journal-and-imports.md), [P04](04-data-library.md), [P05](05-chart-workspace.md).

[Master plan](MASTER_PLAN.md)

## Outcome

A historical paper session has reproducible fills, durable progress and automatically journaled outcomes that the user can review.

## Implementation areas and dependencies

workspaceReplay, replay clock/lock tests, terminal replay and sandbox accounting/recovery patterns.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- One authoritative simulator accepts normalized commands and market events from the run clock only; live quote polling is not a replay feed.
- Run manifest pins dataset/engine versions, start capital, instrument economics, costs, fill policy, seeds and available resolution.
- Use backend pure matching/accounting with bounded advance batches and transactional ledger/checkpoints; chart playback renders acknowledged state.

## Implementation checklist

- [x] **P06-T01** Specify matching/accounting for initial market/limit/stop orders, buy/sell, partial close, cancellation and bracket behavior using explicit units.

- [x] **P06-T02** Define conservative OHLC ambiguity rules, next-eligible-event execution, spread/slippage/fee policy and data-gap behavior; label fidelity and unsupported cases.

- [x] **P06-T03** Create run service with validated preparation, deterministic clock, ledger, position/cash projections, command IDs and lifecycle transitions.

- [x] **P06-T04** Wire run-specific chart controls and paper ticket to the simulator; reject broker routes for historical intents at the server boundary.

- [x] **P06-T05** Persist checkpoints and ledger atomically; recover pending advances after crash and resume exact open orders/positions/playhead.

- [x] **P06-T06** Define rewind as deterministic reconstruction or an explicit branched experiment; never retain future P&L after rewinding market state.

- [x] **P06-T07** Project confirmed simulated fills once into the journal; finish/review displays costs, source version, assumptions and linked chart decisions.

- [x] **P06-T08** Publish durable paper-session assumptions/results and chart/journal drilldowns through the shared run/report contract; compare independent sessions without fictitious pooled equity. P21 owns automated strategy experiment jobs/results and consumes this engine only through an explicitly supported adapter.

## Acceptance criteria

- [x] Repeated inputs/actions on a pinned dataset produce identical results.
- [x] Restart resumes cash, orders, positions and playhead exactly.
- [x] Historical orders cannot reach any broker route and journal effects are deduplicated.

## Required verification scenarios

- Same-bar stop/target ambiguity, price gaps, insufficient cash and rounding.
- Crash between ledger/projection/checkpoint writes and duplicate advance requests.
- Rewind, future-bar leakage through indicators and missing lower-timeframe data.

## Risks and decisions to resolve

- Current sandbox fills from live quotes; reuse accounting selectively, not its market clock.
- OHLC data cannot prove intra-bar execution sequence; show assumptions prominently.

## Scope boundary

Deferred from this package: Exchange queue simulation, universal derivative margin models and claims of tick accuracy from candle files.

## Completion evidence and handoff

Accepted: 1,285 backend tests across 51 files, 2,375 frontend tests across 216 suites, focused final journal/navigation cases, types, production build, scoped static checks, canonical contracts, P00 regression and P06 gate cases. The actual original-screen fixture verified next-event costs, four-pane cutoff, chart capture, exact restart, partial/final closes, per-run journal, recorded/current chart returns, fresh branches, independent comparisons and reviewed cross-owner source/account restore. See the evidence links above and the hash-bound P06 acceptance record.

The local app is running at port 5000 with the final build. Installed records were not migrated. Supported economics remain explicit one-times linear collateral and native OHLC; queue/tick fidelity, exchange margin/funding/FX, real providers and automated P21 jobs are outside this package. P07–P22 remain open.

Before marking P06 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified.
- [x] Evidence recorded and downstream contracts/documentation updated.
- [x] Corresponding master checkbox updated only after acceptance.

## Foundation revision 2 integration requirement

The one-authority rule governs each replay-paper ledger. It does not require replacing existing browser OpenScript backtesting or the Python live engine. P20 pins artifacts; P21 owns robustness. Shared experiment/output contracts and explicit parity fixtures govern supported engines. Manual decisions and automated strategy fills remain distinct.

See [foundation review](p00/FOUNDATION_REVIEW_V2.md) and P20/P21/P22.
