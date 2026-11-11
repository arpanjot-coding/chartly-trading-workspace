# P00 revision: environments, focused workspaces and module placement

**Historical revision with superseded passages.** The current [whole-product workflow/UI blueprint](APP_WORKFLOW_BLUEPRINT.md) takes precedence over the older recommendations below to demote Flow or the earlier unimplemented Combined Analysis/journal descriptions. Keep Workflows primary. Review missing journeys across the whole product before more isolated UI changes.

Latest user-confirmed scope: keep Flow as Workflows and retain reusable strategy/indicator engines; retire the Tools directory and specialist options/legacy features. [Implementation evidence](TOOLS_RETIREMENT_IMPLEMENTATION.md) supersedes the earlier keep-all/optional-specialist recommendations below. [Combined Analysis](COMBINED_ANALYSIS_IMPLEMENTATION.md) is also implemented. Fundamentals remains planned.

2 November 2026. This revision follows the user's clarification after the original-screen review. It supersedes proposals to replace Workspace profile cards with journal-book cards or to keep portfolio settings tabs inside the journal. The original chart, journal content and existing implementations remain the base. This is a design specification; no production routes or behaviour have changed.

## 1. The profile is an environment; its journal is a book

Workspace remains the entry point. A named profile/portfolio is a durable environment, with its data source, paper/live mode, account context, chart workspace associations, journal book and configuration. It is not merely a journal filter or a connection row.

The user's existing account-book decision still applies: a connected book records exactly one account, and manual records use separate books. An environment is not the same entity as that book or its account. Proposed first-release mapping: one primary book/account context per environment; existing multi-destination copying stays execution-channel configuration and routes each destination's confirmed fills to its own account book. Do not force a destructive one-profile/one-account database migration or duplicate all books when adding a chart. Legacy multi-destination profiles need explicit migration rules in P01/P02.

Live environment: connect a supported platform/account and independently choose a market-data source; resolve instrument mappings and observed feed health; open the original terminal. Read-only journal synchronization does not require order permission. Data-only use and cached journal access remain valid when execution is unavailable.

Paper environment: select validated saved history/data version, instrument, period and simulated-account assumptions; open the same terminal with a simulation clock and paper execution adapter. Saved candles must be reachable without a live broker login. A completed form is not a working paper ledger; that integration remains implementation work. Optional future paper-on-live-feed use is a separate capability, not an excuse to conflate data source with order mode.

Manual journal use remains supported: its book has no external account binding and can be opened without market data. Keep a clear Journal only/manual-records entry; do not force users to connect an account or pretend their book is an active live-trading environment. Its final placement alongside the Live/Paper profile creation flow needs P00 walkthrough review.

## 2. Three separate actions on the existing profile card

Retain the current Chart / Journal / Open card footer. Their destinations have different purposes:

1. **Chart** opens the original full terminal for that environment. It resolves live feed or saved data, account/mode, chart workspace and selected journal destination. Preserve toolbar, drawings, panes, indicators and dock. Missing data leads to source setup with a return target; it does not open a replacement chart.
2. **Journal** opens the original journal as a focused workspace for that book. It has its own compact book/account/environment identity and only journal content navigation: Overview, Trades, Calendar, Breakdown and optional Mind. Remove the portfolio Overview / Journal / Connections / Settings header from this page. Keep a small Back to Workspace action, Open chart action and Portfolio details link/menu with return context. The journal's own Overview is performance review; it is not the portfolio management overview.
3. **Open** opens portfolio/environment management. Its primary sections are Overview, Connections and Settings. Overview can contain paper run preparation/list links for paper environments; preserve run functionality without forcing Runs or Journal into the management tab bar. A Journal shortcut and Open chart action can remain in the header, but they leave management for the focused workspace.

Do not show the full portfolio tab bar above the journal, duplicate global headers inside the terminal, or replace journal analytics to accomplish this separation. URLs can keep their current profile IDs. A full-width journal frame must be local-capability-aware: do not move it under today's `FullWidthLayout`, which unconditionally checks authenticated/broker state. Browser URL text is context, never execution authority.

## 3. State and handoff contract

Before implementation, specify a context carrying environment ID, book ID, optional canonical account ID, observed source identity, paper/live execution mode, optional paper run/dataset version, and chart document identity. They are distinct fields, not aliases for `profileId`. Existing IDs are compatibility inputs.

- Workspace → Chart/Journal/Open always carries the selected environment and resolves its authoritative stored state.
- Journal entry → Chart adds exact instrument, timeframe, entry time and available evidence. Return restores book, selected entry, tab, filters and position.
- Journal → Portfolio details → return does not change journal ownership or lose a dirty review.
- Missing feed/history → Connections/Data Library → return resumes the requested chart/run.
- Switching environments does not retarget drafts, background sync, deployed strategies or active orders. An already-running strategy stays bound to its original account/environment.
- Chart layouts/drawings are preserved; explicitly link or copy a workspace when appropriate rather than overwriting another environment's saved chart state.
- App startup loads cached data before eligible account-specific history catch-up. A local worker owns its job destination, independent of the currently visible environment or chart.
- Each account-source event is reconciled once into its account book; notes/reviews remain independent of provider facts. Order attempts and fills are different events.

## 4. Combined Analysis: selection that means what it says

Keep `CombinedLiveAnalytics.tsx` and its useful existing metrics. It already has profile inclusion checkboxes, strategy/period filters and currency grouping. Source and a running-app check confirm that unchecking the last selected profile leaves it selected. An empty selected-ID array also falls back to all currency-compatible profiles. Selection lives in component state and changes of currency reset it.

Required changes:

- Explicit portfolio inclusion list with search when needed, Select all and Clear selection. Zero selected shows a helpful selection state and no aggregate results; it never silently means All.
- Persist named analysis selections independently of an individual portfolio. New profiles do not join an explicit saved selection automatically. Archived/unavailable IDs are explained and removed only through a visible resolution.
- Show Included X of Y and the effective date range, timezone, source coverage and filters. Every metric, chart, breakdown, ranking, trade list and export uses that same selection.
- Keep Live and Paper totals separate. Manual records are explicitly included/excluded by the view's declared scope. Cross-environment comparison may be side by side; it must not add simulated money into live totals.
- Keep currencies separate until a verified conversion policy exists. Switching reporting group must not silently replace an explicit portfolio selection. Record an as-of policy: current period definitions anchor to the latest closed trade, which can make stale history look recent.
- Distinguish money per account from strategy decisions. For copied execution, include actual separate account results in financial totals but avoid treating copies as independent strategy observations. Canonical account executions must not be duplicated through overlapping books/providers.

Current browser evidence used one empty portfolio. Multi-profile selection, durable selections, missing IDs and populated metrics require meaningful fixtures/tests during implementation; no such capability is certified by this review.

## 5. Flow: keep its useful engine, demote its navigation

Flow is a visual automation builder: a schedule, alert or webhook starts a graph of conditions/data retrieval/actions. Existing source includes market/account checks, order/position management, waits, notifications and execution logs/approvals. Python strategies are a separate code/process host. Flow is neither the chart indicator editor nor a historical strategy tester.

It is useful for optional repeatable orchestration, but it should not be one of the first three things a new journal/chart user must understand. Recommendation: remove Flow as a primary top-level label; place the existing builder under Automation in an advanced/optional destination. Add context-specific Open automation links where a supported workflow can be bound. Reuse existing saved workflows, graph editing, logs and Action Center; do not delete them as menu cleanup.

The current inspected Flow implementation resolves a session user/API key. It does not establish binding to the newer profile/journal-book model. Before presenting a flow as environment-scoped, add a versioned execution binding with explicit account/environment, permitted actions and book-routing rules. Draft, preview, approved and running states must differ. Editing an indicator or opening a second chart never arms a flow or starts another bot. General journal-sync/fundamental-report workflow templates remain planned unless their actions are implemented and verified; a generic notification/order engine does not prove those integrations exist.

## 6. Remove the Tools directory as a product destination, retain useful modules

The running Tools page lists 24 entries. That is a directory, not a coherent user workflow. Remove its primary nav entry and replace those entry points with the relevant destinations below. This is a disposition plan, not authorization to erase saved strategies, workflows, provider adapters or source files. Preserve deep links and provide a mapped destination/compatibility notice before retiring the directory route.

### Keep and integrate into Strategy Lab / chart development

- Python Strategies (`/python`): reuse editor/process lifecycle, schedules and logs as a distinct Python runtime. It is not automatically an indicator runtime, sandbox or deterministic backtester.
- Strategies (`/strategy`): reuse guided executable strategy configuration and lifecycle; distinguish it from script research and options construction.
- Portfolio Backtester (`/portfolio-backtester`): retain portfolio allocation/rebalancing research; distinguish it from trade-strategy backtests and paper replay.
- Existing chart indicator picker/settings/templates, custom indicators, `ScriptPanel`, `BacktestPanel` and `StrategiesPanel`: preserve them as development and chart-application surfaces. Library search/versioning, experiments, robustness and deployment handoffs are missing integration work, not a reason to create another engine/editor.

### Move to optional Automation

- Flow Automations (`/flow`): visual orchestration.
- Platforms & Alerts (`/platforms`): external alert/webhook adapters; these are not platform account-history bridges.
- Chartink Strategies (`/chartink`): optional provider-specific alert adapter, not universal strategy authoring.

### Keep as portfolio/account analysis

- Portfolio Analyzer (`/portfolio-analyzer`): holdings concentration/co-movement research. Open from a compatible account/environment or analysis view with explicit scope; it is not the journal or the new company fundamentals terminal.

### Group under an optional Derivatives / Options module

These 15 routes remain specialist capabilities, discoverable only where instrument/provider coverage is supported. Do not delete them or promote them as universal market coverage:

- Strategy Builder (`/strategybuilder`): options multi-leg construction, not a generic bot/indicator builder.
- Strategy Portfolio (`/strategybuilder/portfolio`): saved options strategies, not the Workspace environment list.
- Option Chain (`/optionchain`).
- Option Greeks (`/ivchart`).
- OI Tracker (`/oitracker`).
- OI Range (`/oirange`).
- Max Pain (`/maxpain`).
- Straddle Chart (`/straddle`).
- Straddle PnL (`/straddlepnl`).
- Vol Surface (`/volsurface`).
- GEX Dashboard (`/gex`).
- Strike Profile (`/strikeprofile`).
- Gamma Density (`/gammadensity`).
- IV Smile (`/ivsmile`).
- OI Profile (`/oiprofile`).

This group includes two options strategy pages and 13 analytics pages.

### Defer from the universal core / keep optional regional access

- SIP Backtester (`/sip-backtester`): regional investment-contribution research.
- Arbitrage (`/arbitrage`): existing exchange-specific futures spread workflow. It does not prove universal cross-exchange arbitrage.

The [module inventory](MODULE_DISPOSITION.json) maps all 24 current Tools entries exactly once. Advanced system/API/AI settings remain secondary utilities; they must not be conflated with portfolio settings or shown as journal setup requirements.

## 7. Fundamentals and indicator workflows remain explicit product work

**Fundamentals:** a primary company/asset research destination is missing from the current route inventory. Proposed scope: resolve company/instrument → overview → financial statements/ratios → reports/events → evidenced company relationships → original chart or an evidence-linked journal note. Preserve source, units, dates and unavailable states. Reuse relevant holdings-analysis components/data where compatible; that does not make it a complete fundamentals terminal. Initial provider/coverage design belongs to P13/P14, followed by deeper reports/relationships in P15/P16. Do not mount a menu link that only leads to an empty shell and mark it complete.

**Indicators and strategies:** the original chart already exposes indicators, custom indicator loading, script authoring and a backtest panel. The missing user journey is coherent project/library identity and the sequence: create an Indicator or Strategy → edit/validate/save an immutable revision → apply an indicator on the original chart OR test strategy order rules against a specified dataset/cost model → inspect results → robustness/OOS testing → explicitly deploy an eligible bot in a paper/live environment → journal confirmed outcomes. A study has no trades by itself. Python code, OpenScript and custom indicator modules keep explicit compatibility; they do not become interchangeable because they share a Strategy Lab entry point.

Recommended global destinations once their screens work: Workspace, Fundamentals and Strategy Lab, within the existing navbar design. Automation is optional/advanced; Data Library is discoverable from Workspace and paper/data-source setup. Chart and Journal remain context-bound card actions, accessible directly through deep links. This replaces the earlier Workspace / Flow / Tools emphasis without building another application shell.

## 8. P00 finish sequence and exact implementation seams

Do this before P01 contract implementation. Existing roadmap IDs remain unchanged and unchecked; the following items refine their acceptance scope.

- [ ] **P00-A Navigation boundary:** review Card → Chart / Journal / Open and back paths, with paper/live and manual-book examples. Annotate the removal of `ProfileHeader` from the journal; keep its journal-specific content.
- [ ] **P00-B Environment contract:** settle primary-book mapping, legacy multi-destination classification, chart workspace association, account/data/runtime identity, saved-data preparation and manual-journal entry placement. No data migration is performed in P00.
- [ ] **P00-C Module disposition:** review the 24-entry keep/move/defer inventory, standalone Fundamentals scope, Strategy Lab development loop and optional Flow placement. Decide actual initial support, not universal labels.
- [ ] **P00-D Task-based walkthrough:** use representative two-environment/two-book scenarios and concrete failure states; review resulting annotations with the user. Record unresolved issues and acceptance evidence before ticking P00.

Expected later implementation areas: `TraderWorkspace.tsx` card/wizard; `TraderJournal.tsx` header and entry-return state; `ProfileShell.tsx` management tabs; `App.tsx` and capability-aware journal framing; `CombinedLiveAnalytics.tsx` selection semantics/persistence; `navigation.ts` and `Tools.tsx` route retirement; existing chart/script/test/strategy components; Flow/Python backend bindings and book-specific sync jobs. Reuse existing modules. Each slice needs a detailed plan and meaningful tests before implementation/acceptance.

Pending acceptance scenarios include: Journal contains no portfolio Connections/Settings tab bar; Open contains management only; live feed and saved-data paper open the original terminal with correct context; manual book works without a broker; empty Combined selection stays empty; saved selection survives reload and currency-group changes; archived selections resolve explicitly; copied account money and strategy observations are distinguished; Flow preview cannot submit an order; script validation never activates a bot; retiring Tools preserves saved work and navigable compatible links.

## Evidence boundary

Read-only running-app inspection covered Tools (24 listed entries), Flow (existing saved workflow list) and Combined Analysis. The final selected Combined checkbox remained checked after an attempted deselection, matching source. No workflow was activated, source code executed, account connected or persistent record edited. Existing previous regression evidence is 4 files / 26 tests, not evidence that this proposed navigation or environment isolation works. New work in this revision is documentation and annotated review content only. P00 remains open.
