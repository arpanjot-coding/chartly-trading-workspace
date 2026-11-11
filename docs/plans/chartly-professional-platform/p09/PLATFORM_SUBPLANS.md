# P09-T01 — Retail platform subplans

Decided 4 November 2026. One bridge design does not fit all platforms;
each gets its own interface, distribution and certification path.

## MT5 (first, implemented foundation)

- Target OS: Windows (terminal + official `MetaTrader5` Python IPC).
- Interface: attach to the user's already-running, already-logged-in
  terminal. Chartly never logs in, never stores terminal passwords.
- Foundation shipped: P07 read-only adapter (identity, bounded raw
  history, market sample) + P09 bridge (pairing, sessions, terminal
  states, heartbeat, bounded queues) + positions/orders/account-mode
  reads and the demo-order gate.
- Certification still required: a real demo terminal session covering
  login switch, terminal restart, clock-offset measurement and
  protective-order reads. The adapter's single allowlisted install
  path is a recorded limitation until multi-path registration is
  certified the same way.
- Native timestamps remain `provider-epoch-unverified` until the
  broker-server offset is measured per account; canonical journal
  conversion is gated on that measurement.

## NinjaTrader (subplan, not started)

- Target OS: Windows. Interface: a signed AddOn (C#) inside
  NinjaTrader 8 exposing a loopback protocol to the bridge; the ATI
  file interface is rejected (no authentication, weak semantics).
- Distribution: versioned AddOn package with install/uninstall steps;
  certification needs a NinjaTrader sim account.

## cTrader (direct API, not a bridge)

- Interface: cTrader Open API (OAuth + Protobuf over TLS) — a P10-
  style direct adapter reusing the P07 connector framework, not the
  local bridge. Demo accounts available from Spotware/brokers for
  certification.

## MT4 (later, separate)

- Interface: MQL4 Expert Advisor bridge (no official Python API).
  Requires its own EA protocol, signing/distribution story and demo
  certification; explicitly not covered by the MT5 adapter.

## Shared rules

- Configured path ≠ running process ≠ authenticated account: three
  separate states everywhere (`platform_bridge`).
- Account switching invalidates bindings; commands can never follow
  a terminal to a different login silently.
- Demo certification precedes any order path; live execution is P11.
