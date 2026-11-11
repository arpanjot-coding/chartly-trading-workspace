# Adapter subplan template

Copy this into the owning provider package before implementing an adapter. This is a planning template; copying it grants no capability or readiness.

## Identity, ownership and version

Record provider ID/family, maintainer, adapter version, upstream API/SDK version and source-document retrieval date. Define supported operating systems, transport, selected terminal/gateway, account/server/environment identity fields and how each is observed. Distinguish custodian identity from an aggregator source. Preserve canonical account/book IDs and document duplicate-source linking or ambiguous identity conflicts.

## Test access and authority

Record the permitted test environment and account kind, credential/approval prerequisites, actual access outcome and blocking conditions. State whether the evidence is synthetic, public-only, authenticated read-only, demo execution or live execution. Explain credential scope, storage/reference policy, expiry/refresh/revoke, redaction, protected export and key-loss/recovery. Never put a secret or private screenshot in the plan.

## Supported operations and products

List account read/history, market history/live, research and execution separately. For each capability record declared support, observed permission, source evidence/version/date, sample/coverage, unsupported reason and freshness. Specify asset/product/venue/symbol mapping, quote/account currency, quantity unit/step/minimum/maximum, price tick/scales/multiplier, native protective orders and time-in-force only where verified. An unsupported or unknown field remains explicit. P07 does not authorize execution.

## Time, history and reconciliation

Define native timezone/epoch/calendar and how UTC alignment is proven. Separate source occurrence from receipt time; unknown server clocks cannot become complete UTC coverage. Record pagination/cursors, maximum window/page/bytes, historical retention, session behavior, rate/quota limits and backfill overlap. Define native event identities, revisions/corrections, out-of-order/missing records, partial fills, transfers and unknown submissions. Absence from a page never deletes cached history. Only supported confirmed normalized facts may affect the journal.

## Lifecycle and resources

Specify observed health/freshness, heartbeat/on-open checks, offline/stale/degraded/recovering/expired behavior and bounded retries. Every SDK/socket/file/process/DB resource needs success/error/reconnect cleanup. No hidden background scanner or blind order retry is permitted. Define concurrency/account-change fencing, transaction/CAS publication, idempotency and unknown-commit recovery.

## Acceptance and maintenance

Name exact pure/transport/API/integration/browser fixtures, expected negative cases and actual permitted-provider checks. Record full commands/results and redacted evidence. Cover secret leakage, forged/stale evidence, account/environment isolation, crash/restore/Undo, repeated import, rate limits, disconnected terminal, corrections and uncertain submissions. Record resource measurements with bounds and platform limits. State the precise readiness being accepted, remaining limitations and recertification triggers: adapter/upstream/permission/environment/economics/clock changes, stale evidence or a failed regression.
