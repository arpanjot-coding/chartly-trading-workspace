# Chart workflow audit — specialist 02

Scope: static source review of chart terminal, its React shell, data contract, indicators, drawings, workspace persistence, execution overlays, and profile links. No application changes or live orders. This report does not claim browser interaction or broker/data-provider certification. Evidence is repository-relative file:line.

## Assessment

The chart is a substantial implemented terminal, not a placeholder. Its strongest assets are a chart engine outside React's rendering path, independent panes, a coordinated replay clock, saved workspaces, drawing/object tooling, broad study infrastructure, and order overlays. The product weakness is the handoff from the new profile-first journal/replay surfaces into a terminal that still authenticates and executes against a global broker/API context. The profile label provides reassurance stronger than the actual connection contract.

## Top five findings

### 1. Critical workflow gap: profile context is presentation rather than data/execution binding

ProfileShell.tsx:16-26 creates a chart URL with profileId, runId, profileName and profileKind. Trading.tsx:1177-1183 reads profileId/profileName for the back link. Search of Trading.tsx, ChartPane.tsx and terminal.ts finds no reads of profileKind/runId or profile defaultSymbol/defaultTimeframe. Trading.tsx:907-919 fetches one global API key and WebSocket config, once. TerminalOptions at terminal.ts:844-857 accepts key, URL, container, preferences and callbacks, with no account/profile/data-source binding. terminal.ts:7828-7839 constructs the standard data and trade feeds from that key.

Impact: opening a replay project or a live profile's selected chart data source does not itself establish that project's simulated run or that selected source. This is a functional integration gap, not a typography issue. A trader should never infer the execution target from a profile name that only controls navigation.

Recommended acceptance test: two profiles with different accounts/data sources must open the correct symbol, source and mode; runId must restore the exact replay session; an unknown profile/run must fail before showing execution controls. Backend authorization must resolve IDs rather than trusting query labels.

### 2. High: core charts still have an API-key prerequisite rather than an offline/free data entry path

Trading.tsx:1544 and 1574-1585 gates chart tools/rendering on apiKey/wsUrl and displays “No API key found for charting” with an /apikey link. terminal.ts:7828-7867 establishes the broker-oriented REST feed and supported intervals; no local OHLCV source chooser is provided here. This is different from merely keeping premium market data optional.

Impact: a user with imported history should be able to chart, annotate and rehearse without a broker connection, while a user with only journal trades should know why candles cannot be reconstructed from trade executions.

Proposed wireframe: first chart empty state offers Import historical bars, Use an available free source, Connect my broker/platform. Each option declares market, history coverage, resolution, timezone and limitations before loading. Free source availability must be verified; do not promise unrestricted equities/futures history. Keep dataset import distinct from trade-journal import.

### 3. High: chart replay is a viewing mode that locks trading, not an integrated paper execution run

Trading.tsx:633-653 explicitly describes broker-directed dock actions and blocks them whenever any pane is replaying/picking/loading. ChartPane.tsx:1308-1334 starts chart replay. This is good protection against routing a historical chart click to live execution, but does not fulfill the paper-replay workflow promised by the profile's Open chart link.

Do not remove this protection. Introduce an explicit execution adapter contract: Read only, Simulated live, Replay paper, Broker execution. In replay-paper mode, route order intent exclusively to the replay simulator with runId, dataset ID and deterministic clock. Persist fills and annotations into that run's journal. Retain server-side rejection of live order routes while the active chart is historical.

### 4. Medium-high: chart-to-journal evidence handoff is missing

ChartPane.tsx:1431-1515 offers screenshot download/copy and CSV export; terminal.ts contains screenshot/export infrastructure. RightRail.tsx:31 onward lists watchlist, options, objects, alerts and additional panels, with no journal capture destination. No journal integration is present in Trading.tsx/ChartPane.tsx/terminal.ts.

Impact: a strong journal requires preserving the decision context at entry/exit, not asking users to download a PNG, leave the terminal, locate a trade, and upload it manually.

Proposed action: Add journal note / Attach chart to trade. Capture source provenance, symbol, timezone, interval, cursor/replay timestamp, chart image and optional layout snapshot. Offer a trade/run selector already scoped to the verified profile. Avoid automatically attaching current chart context to an unrelated historical fill.

### 5. Medium: transport status is not data provenance or quote freshness

ChartPane.tsx:1392-1411 shows optional branding and a colored LED with title WebSocket {state}. terminal.ts:7926 onward changes connection status and starts quote fallback on disconnect; terminal.ts:7878-7888 polls and reconciles history. These are useful reliability measures but a connected socket does not establish recent ticks, exchange entitlement, executable prices or history completeness.

Proposed persistent monochrome status row: Source · Market/symbol · Live/Delayed/Historical · Last update timestamp · Available range · Gap count. Use text and icon/shape, not color alone. Show source-specific recovery actions when history is unavailable; retain the existing Try again/Dismiss behavior as a secondary control.

## Implemented strengths worth preserving

- Framework-independent TradingTerminal owns chart/ticks/feed lifecycle (terminal.ts:1-13); React shell is not the per-tick update path.
- REST history cache and interval capability lookup exist (terminal.ts:7828-7867); DataLoadingController has gap/bar-close refresh, 500-bar pages, max empty-page bound and 100,000-bar bound (terminal.ts:7878-7890).
- Linked charts keep crosshair, viewport, symbol and interval separately selectable; defaults avoid unexpected symbol replacement (Trading.tsx:205-236).
- Indicator browser has search, active studies, categories, favorites and recents (IndicatorPickerDialog.tsx:1-20, 40-98). Runtime registry plus built-in lazy tier, custom modules and OpenScript are wired (terminal.ts:3904-3950). The comment mentions 88 built-ins; runtime catalogue count was not measured, so do not publish that as a verified count.
- Drawings, object inventory, undo/redo, magnet, locking, clipboard and per-instrument drawing support are represented by implemented controller paths and focused tests. This is mature scope; prioritize workflow integration over adding another drawing.
- Chart type catalogue includes candles/OHLC, line/area and transformed charts (chartTypes.tsx:34 onward). Synthetic/transformed charts should keep raw-price execution semantics explicit.
- Local account-scoped workspace repository with session-race ownership checks exists (useChartWorkspaceCatalog.ts:65-124). WorkspaceMenu.tsx:136 explains browser-local storage, and export/import exists at :278 and :390-407. Keep this honest local-first messaging.
- Error/loading/empty chart states are durable overlays, not only toasts (ChartStateOverlay.tsx:1-69; chartState.ts:84-114). Their wording is still broker-centric and lacks source-switch affordances.
- One-click default is off and unreadable storage leaves it off (Trading.tsx:163-167, 208-214). Confirmed order tickets route through the terminal feed and assert execution mode (ChartPane.tsx:2264-2290).

## Recommended chart wireframe and flow

1. Enter from a verified trading profile or replay run. Header says profile + mode + execution account(s). A separate labeled source control says where prices come from. The word “account” must not mean both source and execution destination.
2. Main toolbar: Symbol, timeframe, chart type, Indicators, Drawings, Layout. Move quantity, product and order buttons into a trading ticket/dock, or reveal only when the user enables an eligible execution mode. Studying a chart should not require navigating execution-specific controls.
3. Main plot stays large. Left rail is drawing tools; right rail defaults to Watchlist / Journal / Objects / Alerts. Put Script / Strategies / Options / Assistant under an Advanced area or only for relevant instruments. Current sophisticated features remain available without defining the first-use experience.
4. A slim source/status row communicates provenance, freshness, timezone and historical coverage using text. Multi-pane source changes show which pane(s) they affect.
5. Replay opens session setup with dataset, instrument, date range, starting cash and simulation assumptions. Existing replay transport occupies the bottom strip, with persistent “Replay paper — no broker orders” status. Run save/resume is a first-class operation.
6. On a simulated or real fill, add a journal event with the correct run/account provenance. Open the Journal panel to annotate intent, setup and emotions. Chart capture is one click, not a file-download round trip.
7. End session gives Review trades / Resume later / Export backup. Review opens fills alongside the chart at their timestamps and an editable note; it does not reset the chart to today's market.

## Priority and validation

P0: authenticated profile/source/mode/run contract, explicit execution target, correct replay isolation.
P1: local historical-bar entry path, provenance/freshness, one-click journal capture and review handoff.
P2: simplify toolbar and advanced-feature discoverability; preserve existing drawing/study/layout depth.

Focused existing tests were discovered for ChartPane, drawing scope, workspace restore, replay locks, intervals, indicator settings, transformed charts and exports. They were not executed during this read-only audit; their presence is not proof of passing tests or live-provider correctness. Parent audit should combine this report with replay, connections and journal specialists before assigning cross-cutting owners.
