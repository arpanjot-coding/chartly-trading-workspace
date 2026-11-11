# Connections and saved-data workflow follow-up

3 November 2026. Root accepted the integrated workflows after the final frozen tests and original-screen review. The existing chart engine, chart controls and journal tabs remain the product UI. This follow-up repairs their entry and return paths; it does not certify every provider in the directory.

The [ordered implementation plan](../CONNECTION_WORKFLOW_FOLLOWUP.md) was written before the changes. The original P07 acceptance and its proof logs are preserved under their original paths, with a byte-identical [acceptance archive](../history/P07_ACCEPTANCE_2026-11-03_INITIAL.json). Current-source acceptance is separate.

## Implemented behavior

- Settings → Connections & Data has two sibling destinations: Connections and History & data. Provider selection groups brokerages, crypto exchanges and desktop platforms; diagnostic adapters are collapsed separately. Public provider metadata is visible before a workspace is saved. Private connections still require their actual owner. The normal hub no longer opens the legacy default Zerodha sign-in.
- Live creation reviews the profile and opens its Connections directly. Optional tags, timezone and reporting currency remain. Replay still requires actual saved history and keeps its own capital. Advanced saved terminal/account/copy settings remain available below operational connections; saved configuration is not represented as a running service.
- Explicit personal-PC mode opens a real local-data proof without a typed application password. Its stable, separate installation owner does not adopt an existing administrator or named account. Existing browser profiles retain their reviewed migration path and original copy. History can be imported independently of profile migration.
- Personal bootstrap requires CSRF, an exact same-origin request, direct loopback peer and local Host, with no forwarding/proxy headers. The proof is checked on every request, expires/revokes normally, and locks if the personal owner's credentials, MFA or role change. Expected-principal headers fence delayed requests. Shared/network installs retain named-account authentication.
- Developer API retains key management, REST/WS catalog, request/response editor, stored approval policy and explicit Send. Global Live/Analyze mutation and appearance locks are removed. Broker routing is a read-only observation and remains Unknown if it cannot be read. Keys and private UI state clear across owner changes. The backend derives key ownership from the authenticated session and rejects another client-supplied owner.
- Kraken public spot instruments and recent closed candles enter the existing owned Data Library preview/save flow. Exact decimal values, actual coverage, source receipt, checksum, immutable versions and export/restore provenance are retained. The unfinished final candle is excluded. Explicit seven-day full-day UTC sessions prevent false warnings for 24-hour crypto markets; real missing bars remain gaps.

## Observed access and limits

The actual running MT5 terminal was verified through the revised UI in the disposable workflow fixture. It reported a healthy demo account, displayed with only its last four digits. No password, terminal login, order, cancellation, account linking or financial mutation was submitted. Its existing adapter supports account details and bounded raw deal observations. Provider UTC timing and canonical journal conversion remain unverified; this follow-up does not enable chart prices or execution by guessing those facts.

The browser fetched actual Kraken XBT/USD one-minute data, reviewed 720 closed candles with zero structural warnings after the calendar fix, and saved a new version in the fixture. This is recent public market data, not exchange-account history, unlimited backfill or trading authorization. [Provider access and measured transport evidence](../../provider-connectivity/W07_EVIDENCE.md).

The user requested all listed platforms. The full inventory and delivery order are [recorded here](../../provider-connectivity/README.md). Planned providers expose prerequisites, not a functioning Connect claim. Private crypto integration belongs to P08, terminal bridges to P09, brokerage authentication to P10 and actual execution to P11. These packages remain open. Each still needs its own implementation and permitted test environment; a catalog row is not completion.

## Verification

Final integrated results: **1,581 backend tests / 68 modules in 408.22 seconds** and **2,495 frontend tests / 230 suites in 79.78 seconds**. TypeScript, 50-file Biome, 1.77-second production build, scoped Python checks, canonical contracts, 84 P00 tests, the 131-case follow-up gate harness and preserved 104-case original gate harness pass. [Verification commands](VERIFICATION_COMMANDS.md), [browser acceptance](BROWSER_ACCEPTANCE.md) and [independent review](INDEPENDENT_REVIEW.md). No checklist is accepted from a mockup, passing probe alone or a directory entry.

The final personal-session audit used 100 new clients against disposable SQL stores: one stable installation owner, at most 64 retained session rows, 908 checkouts and 908 checkins, and native handles 225 → 225. [Actual measurement](evidence/personal-resources.json). No installed private data or credentials enter that evidence.
