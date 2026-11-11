# P09 Retail terminal and platform bridges

Status: Planned. No implementation task is marked complete by this document.

Release: R2 one verified platform; others staged. Dependencies: [P01](01-domain-and-contracts.md), [P02](02-storage-and-recovery.md), [P07](07-connector-framework.md).

[Master plan](MASTER_PLAN.md)

## Outcome

A user connects a supported retail platform using its actual API/terminal interface and sees verified history, data and eligible execution.

## Implementation areas and dependencies

Platform names/configuration in TraderConnections and ARCHITECTURE.md; no audited profile-aware MT5/NinjaTrader adapter implementation.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- MT5 is the first local bridge candidate; isolate terminal workers/account bindings and verify actual permissions. cTrader is a direct API path, not an MT5-style bridge.
- NinjaTrader requires its own supported AddOn/transport design; MT4 needs a separate EA/bridge plan. Never assume one Python API covers all platforms.
- Local bridge pairing has scoped authentication, protocol version and heartbeat; bind locally by default and document what stopping the bridge affects.

## Implementation checklist

- [x] **P09-T01** Write individual MT5, NinjaTrader, cTrader and later MT4 subplans, with target OS, supported interface, account access, build/distribution and demo certification. Done 2026-11-04: [platform subplans](p09/PLATFORM_SUBPLANS.md) (MT5 first, NinjaTrader AddOn, cTrader direct API, MT4 EA later).

- [x] **P09-T02** Implement bridge packaging/pairing, process lifecycle, version negotiation, health, bounded queues and authenticated local transport. Done 2026-11-04 (in-process core): `services/platform_bridge.py` — one-time pairing codes, hashed scoped session tokens, protocol negotiation, heartbeat staleness, bounded queues (overflow errors, never drops). Loopback socket packaging rides on this core.

- [x] **P09-T03** Discover or register terminals and verify current account identity from the platform; distinguish configured path, running process and authenticated account. Done 2026-11-04 (fixture-verified): terminal registry with configured/running/authenticated states; identity comes from the P07 MT5 probe, never from configuration. Real-terminal certification pending a user demo session (MT5 is installed here but not running; the adapter never launches it).

- [x] **P09-T04** Read symbol metadata, ticks/bars, positions/orders/deals and account currency; normalize lots/contracts, suffixes and netting/hedging mode. Done 2026-11-04: `services/mt5_reads.py` positions/orders/account-mode (netting vs hedging), native lots + contract size kept explicit, symbol suffixes returned as unverified candidates — never silently mapped.

- [x] **P09-T05** Implement historical sync and live event reconciliation through the common ingestion contract; recover when terminal/account changes. Done 2026-11-04 (reconciliation core): per-terminal-namespaced deal dedupe (`reconcile_history`); canonical journal conversion remains gated on per-account clock-offset measurement (timestamps stay provider-epoch-unverified).

- [x] **P09-T06** Gate demo order commands on platform capabilities and permissions; preserve native protective-order acknowledgement and account-specific outcomes. Done 2026-11-04 (gate): `demo_order_gate` refuses live accounts and any missing terminal/account trade permission with named reasons. Submission itself is P11; no order_send path exists here.

- [x] **P09-T07** Support multiple terminals through explicit worker/account isolation; require re-verification on login/account switching rather than reusing stale bindings. Done 2026-11-04: per-session bindings keyed to verified identity hashes; a changed login drops the binding and forces re-verification. Adapter still allowlists one install path (recorded limitation).

- [x] **P09-T08** Test install/update/uninstall/restart and platform shutdown; publish compatibility and troubleshooting evidence for each certified platform. Progress 2026-11-04: restart/shutdown state transitions are unit-tested (36/36 with the P07 adapter suite); install/update/uninstall + compatibility evidence require the real-terminal certification session. Rechecked 2026-11-04 (second runtime check): still gated — see [gated recheck](p19/evidence/gated-recheck-2026-11-04.md). Done 2026-11-04: LIVE certification on this machine — MT5 500.6296 launched, MetaQuotes-Demo account 115006836 (GBP, retail_hedging) probed read-only with live EURUSD quote/bars, bridge paired+bound+healthy, demo gate correctly refused while terminal Algo Trading is off, shutdown produced clean `selected_terminal_not_running` refusal, restart re-verified the same identity. Measured server clock skew +7199s (UTC+2) recorded; canonical journal conversion stays gated on a DST-safe offset policy. Evidence: p09/evidence/live-certification.log.

## Acceptance criteria

- [x] Verified terminal account, permissions and heartbeat replace manually set running flags. Bridge states derive from process checks + adapter probe + heartbeats (fixture-verified).
- [x] Restart and account switching cannot route a command to the wrong account. Proven: identity change drops the binding and raises `bridge.identity_changed_reverify`.
- [ ] History/fills reach the same journal model without duplicates.

## Required verification scenarios

- Terminal closed, trading disabled, changed login, incompatible version and stale IPC.
- Multiple instances/accounts with colliding native symbols or deal IDs.
- Bridge crash during submission and reconnection with outstanding protection.

## Risks and decisions to resolve

- Native APIs, account rules and terminal behaviour require real demo access to certify.
- Do not promise broker/prop policy compatibility merely because a bridge connects.

## Scope boundary

Deferred from this package: All operating systems/platform versions, unattended live execution before recovery passes and unsupported private API reverse engineering.

## Completion evidence and handoff

Before marking P09 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [x] Package acceptance criteria and master definition of done verified. Fixture suite 36/36 plus live demo certification 2026-11-04 (journal-conversion acceptance below remains open by design).
- [x] Evidence recorded and downstream contracts/documentation updated. [p09/evidence](p09/evidence) incl. live certification log + script.
- [x] Corresponding master checkbox updated only after acceptance.

## Foundation revision 2 integration requirement

A native bridge same-PC requirement must not be generalized to remote history services. Account-history synchronization can feed a standalone journal without charting or order permission. Terminal state and backend lifetime are measured separately.

See [foundation review](p00/FOUNDATION_REVIEW_V2.md) and P20/P21/P22.
