# Domain handoffs and transaction boundaries

These are implementation contracts for the owning packages. P01 supplies executable record/reference validation; it does not claim the following services already run.

## Statement import → canonical book → review (P02/P03/P22)

1. Resolve trusted local owner/workspace and destination book. A manual import retains manual assertions; an account statement requires the exact verified account identity/source mapping.
2. Stage immutable raw input, field/time/unit mappings, source observations, row-level issues, checksum and declared coverage. Preserve drafts and return context. Preview duplicates, conflicts, precision uncertainty and excluded rows; a rejected row cannot disappear behind a success count.
3. Normalize records under v1, resolve aliases and validate the complete affected reference graph. Deduplicate within source/account identity; a new source must reconcile against canonical account executions rather than insert another copy. Ambiguous amount/time matches stay conflicts.
4. In one transaction, recheck revisions/active-book uniqueness, commit observations/facts/membership, alias map, import idempotency receipt and outbox items. A retry returns the original receipt. An interruption before commit creates no half-book; an interruption after commit must recover from the same receipt.
5. Project book analytics and independent user reviews from accepted memberships only. Fees/corrections create attributable facts; notes remain on their original book. Report actual rows/coverage and unresolved conflicts. Preserve the browser export until counts/hashes/relations and restore have passed.

## Paper command → fill → checkpoint → journal (P04/P05/P06)

1. Resolve a verified dataset version, instrument economics, simulated account/book, engine support and immutable RunManifest. No live destination belongs to historical mode.
2. Validate command/envelope identity, run/account/mode, idempotency and lifecycle. Advance only through causal supported market events; P06 defines fills/costs and OHLC ambiguity. This contract does not assume parity with every automated or live engine.
3. Atomically append confirmed simulated events, update run ledger/projections/checkpoint and enqueue the journal effect. A checkpoint references the exact run/ledger sequence and state artifact; it cannot retain future equity after a rewind.
4. Project each canonical simulated execution into that account's paper book once. The original chart/journal link pins run/instrument/event time. Restart/retry reconstructs the same state; a new scenario or rewind branch has explicit identity and separate results.

## Connector observation → reconciliation → journal (P07/P11/P22)

1. Bind the exact observed provider/account/environment and versioned capabilities. Configuration, health, history permission and order permission remain independent. Startup catch-up belongs to one account/source job, not each mounted page.
2. Receive immutable raw observation/envelope, native cursor when available and occurrence/receipt times. Delivery may be repeated or out of order. A successful response proves only its observed coverage; absence from a limited page never deletes cached history.
3. Commit raw observations, durable cursor/coverage/conflicts and canonical reconciliation links transactionally. One account execution may have several observations. Corrections preserve earlier versions. Outbox retries cannot duplicate a fill or journal membership.
4. Submitted/acknowledged/part-filled/filled are separate. Unknown broker outcomes enter reconciliation with their correlation/native IDs; never blindly retry a new submission. Only confirmed execution facts affect canonical fills/journals. P11 owns risk, arming and dispatch; contract validity cannot grant them.
5. Apply fills to the existing active account book; reconnect finds that book. Preserve reviews during source replacement, reimport and account relinking. Expose stale/partial/failed coverage and actionable recovery.

## Research revision → derived metric → snapshot (P13/P14/P16)

1. Resolve Issuer/Listing/provider aliases and permitted source capabilities without requiring an execution account or trading profile. Instrument economics can remain unavailable for research identity.
2. Store the original DocumentVersion and source checksum/citation with published/available/retrieved times. Extract FactObservations with units/currency, instant/duration periods, fiscal basis and original versus amended identity. An amendment creates another version; it cannot rewrite a prior snapshot.
3. Compute only supported deterministic formulas, pin input fact versions and publish availability no earlier than the newest input. Missing/zero denominators yield explicit unavailable results. Different currencies/bases cannot be pooled implicitly.
4. Commit the document/fact batch and ingestion receipt atomically. A saved NotebookSnapshot pins evidence IDs/checksum and its as-of time; future-available evidence is rejected. Keep user/AI annotations distinct from reported facts.
5. Resolve chart/journal links through verified instrument/book mappings and preserve the snapshot/return route. Missing mappings remain unavailable; no default symbol replaces the requested company.

## Experiments and deployment handoff (P20/P21/P17/P11)

Freeze the validated artifact, dependency locks, parameter set, dataset, engine, economics and chronological evaluation policy. P21's durable job/result receipt owns progress, cancellation and partial/failure status; P20 renders it. Invalid/changed dependencies, data or parameters require new evidence. Indicator attachment never creates a strategy result or starts a runtime. A deployment revision is separately configured and stays disarmed until P11's actual permission/risk checks pass. Workflows operates one identified instance independently of chart-view lifetime.
