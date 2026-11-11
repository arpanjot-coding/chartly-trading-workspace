# P11-T01 — Command state machine and projections

Implemented in `services/execution.py` (2026-11-04). Canonical records:
`OrderIntent` (immutable user intent + idempotency key) →
`ChildCommand` (one dispatchable unit per account/destination).

States and allowed transitions (anything else raises
`execution.transition_invalid`):

- `pending` → submitted | rejected
- `submitted` → acknowledged | rejected | unknown (timeout/ambiguity)
- `acknowledged` → part_filled | filled | cancel_requested | cancelled | unknown
- `part_filled` → filled | cancel_requested | cancelled | unknown
- `cancel_requested` → cancelled | filled | unknown
- `unknown` → reconciling (only exit; broker lookup decides next)
- `reconciling` → acknowledged | part_filled | filled | cancelled | rejected | unknown
- terminal: filled, cancelled, rejected

Projections: per-account bundle (`workspace_execution_accounts`)
holds intents, commands and meta (reserved notional, filled quantity,
broker reason, nativeProtection = `none-acknowledged` until a broker
ack says otherwise, recovery instructions for unknown commands).

Recovery (startup/reconnect): `pending` = safe to dispatch;
`submitted/unknown` = reconcile with broker first — never resubmit;
other open states = refresh from broker. Emergency actions are three
distinct operations: stop automation (disarm only), cancel open
orders (per-command outcomes; unknown commands are reported not
cancellable), close positions (new reducing intents through the same
risk path — entries blocked by limits never blocks a close).

Adapter dispatch is injected per destination; Kraken/Alpaca/MT5 send
functions plug in behind `dispatcher(command, intent)` raising
`DispatchRejected`/`DispatchTimeout`. Real-adapter certification
still needs the gated credentials (P08-T05/T08, P09 demo, P10-T06).
