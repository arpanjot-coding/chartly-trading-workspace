# P05 detailed implementation plan — original chart workflow integration

3 November 2026. This plan was written before implementation, with all eight tasks initially open. Completion checkpoint: all eight are implemented and verified in the [acceptance evidence](IMPLEMENTATION_EVIDENCE.md). It preserves `Trading.tsx`, `ChartPane`, `TradingTerminal`, the existing chart engine, toolbar, rails, grid, panels, dock and opening layout. [Package](../05-chart-workspace.md), [P04 evidence](../p04/IMPLEMENTATION_EVIDENCE.md), [accepted scope](../p00/EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md).

## Discovery and decisions

The original terminal currently uses a global API key, username workspace and pane preferences even when its URL names a profile. Its initializer creates broker/history/session/order resources unconditionally. P04's exact-version native charts are useful but separate from the full terminal; a dataset run link currently loses run identity/window. P04 restored aliases resolve on the server but the frontend rejects a changed canonical ID. Chart PNG capture, durable journal attachments, replay clocks, comparison guards, chart workspace repositories and provider adapters already exist and will be reused.

Keep source, chart environment and execution authority separate. A display name, `profileKind` query or a chart quote never grants order permission. A profile-bound saved-history chart cannot start the broker trade feed, order subscriptions or book polling. Legacy connected mode remains explicitly identified as the instance's existing provider session, without inventing a verified per-profile execution account. Account-specific dispatch certification belongs to P07/P11; deterministic simulated fills/account checkpoints belong to P06. P05 does own persistent chart-view/replay cursor preparation and must not call that a simulation checkpoint.

Use existing local-account APIs and P02/P03 records. Profiles that still live in the original browser source remain preserved; their labels/defaults can inform a read-only chart after loading the actual record, while durable evidence requires the reviewed local-storage binding. No automatic user migration, broker login, external provider call or order is part of verification.

## Ordered tasks and ownership

### P05-T01 — resolve and retain actual chart context

Owner: context implementation agent; root reviews server authority.

- Parse supported profile/run/trade/dataset/window/return links with bounded canonical identifiers. Load actual records through the existing trader binding and exact owned dataset API; ignore supplied profile names/kinds as authority. Reject absent, archived, foreign, conflicting and malformed targets with Import history / Choose saved history / Connect data / Return actions.
- A run must belong to its profile. Its dataset checksum, instrument/native interval and saved UTC window must match; aliases may resolve only when the server identifies the exact requested old ID and the saved checksum still matches. Do not silently switch to current quotes or BHEL when a target is missing.
- Define a typed resolved context: principal and source origin, optional owned profile/book/run/trade, source descriptor, symbol/venue/native interval, UTC window, declared timezone, chart-only replay cursor and return destination. Freeze a context identity/generation so stale async results cannot populate a different environment.
- Run and journal links retain profile/run/trade IDs and selected window, including return navigation. An unbound chart remains usable but asks for an explicit journal destination.
- Tests: forged labels; wrong profile/run; absent dataset; valid/forged restore aliases; checksum/interval mismatch; stale resolve; date/window precision; same-profile and cross-profile return journeys.

### P05-T02 — one original terminal with explicit data sources

Owners: source agent for adapter; context agent for terminal wiring.

- Add a source descriptor/adapter contract supporting immutable private datasets and the existing connected provider. Private sources expose historical reads, instrument search/metadata, native intervals, horizon/calendar/quality and indicator snapshots; they expose no order or live transport methods.
- Branch terminal initialization before broker REST/trade feed, interval/calendar/master calls, WebSocket/order subscriptions, comparison streams or polling are created. Use private UTC horizon and calendar rather than wall clock or IST assumptions. Disposing/replacing the source closes outstanding work and listeners.
- Connect P04 catalog and practice links to the full original terminal. Existing `/historify/charts?datasetVersionId=…` links remain compatible; the connected legacy Historify route stays separate and guarded.
- Fit source selection and compact status into existing chrome: actual source, native resolution/range, timezone, structural gap/quality state, immutable historical data versus connected stream freshness. Unknown delay/freshness remains unknown. Switching source restarts the correctly scoped chart and retains the return path.
- Tests: private mode makes no broker/order calls; source switch during fetch; cancellation/disconnect/retry; old link compatibility; same-symbol/two-source identity; source range/timezone.

### P05-T03 — truthful mode and execution capability in existing controls

Owner: context agent, independently reviewed by root/source agent.

- Preserve toolbar/dock arrangement. Add minimal source/environment status and explain unavailable controls at their existing location.
- Extend centralized terminal/dock/replay action guards so read-only, missing-context and unsupported instruments cannot submit, modify, cancel, flatten, start alerts/strategy execution or bypass through keyboard, one-click, drag or context-menu paths. Local history does not gain execution authority from a profile label or a global API key.
- Connected legacy mode continues through its existing authenticated adapter, identified separately from profile destination configuration. Profile-linked execution remains unavailable until a verified account capability exists. Do not imply that a stored connection setting is a connected account.
- Tests exercise commands directly as well as disabled UI, hotkeys and stale async transitions. No test submits a real order.

### P05-T04 — private environment workspaces and deliberate sharing

Owner: context agent; root verifies P02 recovery compatibility.

- Add an explicit namespace/scope to the existing workspace catalog while retaining the authenticated account separately. Profile/run/source scopes isolate saved documents and unnamed panes, grid/layout/sync/dock/panel preferences and drawing/study state. Hide an outgoing scope immediately while its async owner is cleaned up.
- Preserve the unbound historical workspace namespace and all original IndexedDB sources. Never fall back to a global pane key when opening a new profile scope.
- Provide an explicit copy/import/template path for sharing useful layout/study/drawing configuration across scopes. Copy is deliberate; original documents stay intact. Imported documents cannot overwrite the active source/run binding or silently enable execution.
- Persist multi-pane composition and active pane, source/window and chart-only replay cursor where supported. Restore them after reload; an invalid source or missing dataset yields a recovery action rather than a different source.
- Verify P02 native catalog inventory, workspace backup/restore and cross-tab invalidation preserve the new namespaces. Tests include two profiles, two sources, renamed instruments, stale save completion and conflict/retry.

### P05-T05 — chart-to-journal evidence without file round trips

Owners: journal agent for existing-rail panel/client, root for server/storage.

- Add a lazy Journal panel to the existing right rail. Load the actual scoped book/profile/run and eligible records; show a Storage setup action for preserved browser-only records. Global charts choose a destination explicitly. Selecting a trade/run never changes its financial facts.
- Reuse the focused terminal's PNG capture. Freeze pane/source/symbol/interval/view/replay state before awaiting capture; reject if that identity changes, preventing mismatched image and metadata. One capture/upload is active at a time.
- Add a strict local chart-evidence endpoint alongside the existing unchanged byte attachment API. Its reviewed request contains source origin, expected journal revision/stable request ID, profile/book/trade or run target, PNG and bounded capture metadata: source kind/provider or immutable version/checksum, symbol/venue/interval, timezone/chart type, UTC visible range, captured time, optional replay availability and notes. No supplied code, raw bars or credentials are accepted.
- Server resolves principal/target ownership, book/profile/run relationships and owned dataset/checksum. Append evidence with an immutable attachment ID and structured metadata; derive local attachment URLs from the current origin after restore. Preserve prior evidence/history instead of replacing its only accessible link. Same receipt/body is idempotent; stale revisions preserve the draft for review/retry.
- Store image bytes in the existing P02 asset path and include every historical evidence attachment in scoped journal export and workspace backup/restore. Bound PNG to 8 MiB, metadata to 64 KiB and per-target evidence count; add a conservative aggregate asset budget. Avoid loading/base64-encoding every attachment for routine metadata responses.
- Tests: wrong book/profile/run/principal; edited/bad source/version/checksum; malformed image/metadata; repeat/uncertain commit; archive; concurrent revision; multiple captures; metadata-only reads; export/restore/Undo; object URL/request cleanup. Actual browser: selected chart → intended record → image visible in existing journal, without download/upload.

### P05-T06 — replay availability for studies and comparisons

Owner: source agent; context agent wires the adapter into the original terminal.

- Audit existing replay, indicator feeds, comparisons, exports and trade locks before changing them. Retain existing protections and tests.
- Supply a native immutable history snapshot provider with explicit UTC bar-close/confirmation and warmup semantics. Historical `asOf` never reads the latest broker state; partial/unconfirmed data never masquerades as a confirmed derived candle. Reject unsupported interval, source, instrument, transformed variant and unavailable calendar rather than guessing.
- Verify visible bars, built-in studies, requested multi-timeframe/cross-symbol study inputs, comparisons/readouts and exports follow replay availability. Keep unsupported connected point-in-time requests explicitly unavailable until a certified adapter exists. P05 does not fabricate resampled data or a simulated execution ledger.
- Use adversarial fixtures with future price spikes, unequal/native intervals, missing volume/gaps and source changes. Compare full offline results with the permitted prefix, replay seek/restart and cancellation cleanup. Record the exact supported matrix in documentation.

### P05-T07 — source-aware symbol and venue search

Owner: source agent; context agent integrates source handoff.

- Reuse the existing symbol-search dialog and keyboard ranking. Local results identify provider/version/instrument/venue/native range instead of merging a shared ticker. Eligible connected sources use their existing search adapter and capability state.
- Loading, rejected searches, empty results, unsupported provider/instrument, missing metadata and disconnected sources have clear retry/import/connect actions. Invalidate pending searches on close/unmount/source change; an old request cannot overwrite the current query or leave a spinner indefinitely.
- Changing to another local source/version is explicit and updates the whole resolved source identity. A study/comparison cannot use an expression/venue outside its adapter's supported identity by accident.
- Tests cover Enter/arrow/Escape, input focus, failures/retry, stale completions, two sources with the same ticker, renamed symbols, foreign versions and capability-aware empty states.

### P05-T08 — integrated verification, resource and performance budgets

Owners: all writers for focused checks, root for integration/browser acceptance.

- Preserve original selected-pane toolbar, drawings, indicators, grid and dock behavior. Verify keyboard actions do not steal text entry, and dialogs have labels/focus/recovery. Exercise multiple panes, multiple profiles/tabs, reload, disconnected source and restore.
- Define fixture budgets before measuring: maximum 50,000 native candles/request; one active private source fetch with bounded coalesced consumers; at most 16 restored panes; bounded search results/metadata/evidence; no per-tick React state propagation for candles. On this Windows reference environment target initial 50k native chart preparation within 5 seconds and source/search cancellation within one event turn plus adapter completion, recording measured values and any machine constraints. Measure repeated source/capture lifecycle rather than infer cleanup from passing unit tests.
- Run relevant P01–P04 backend/frontend/old terminal replay tests, source/types/build/scoped lint and generated-contract checks. Test actual original-screen journeys in an isolated fixture, including evidence recovery. Do not migrate installed user records or contact a live provider to manufacture acceptance.
- Independent review follows integration; resolve findings and repeat only affected checks. Apply the repository resource audit to new DB/file/feed/subscription/capture paths; measure 100 repeated operations with balanced cleanup and bounded retained memory.
- Update in-repository architecture/prose, API and guide, CI registration and a P05 acceptance gate. Historical P00–P04 gates/evidence remain unchanged; current shared sources receive a compatibility attestation. Only fully implemented/tested task checkboxes change. P06–P22 remain open.

## Implementation boundaries and coordination

Context agent owns `Trading.tsx`, `ChartPane`, terminal wiring, context resolver/hooks, scoped workspace integration and existing chart/run links. Source agent owns new source/snapshot/catalog helper modules, symbol-search lifecycle and causality tests. Journal agent owns the new lazy journal panel, its typed client/draft integration and right-rail extension. Root owns Python evidence/storage/API/worker changes, recovery/CI/acceptance documentation, integrated review and browser QA. Writers coordinate exported types before touching shared files; no duplicate terminal writer.

The service ABI and detailed file map will be recorded alongside this plan as integration signatures settle. That refines implementation detail without reducing any task or acceptance criterion. A screen alone is not a completed storage, execution or replay capability.
