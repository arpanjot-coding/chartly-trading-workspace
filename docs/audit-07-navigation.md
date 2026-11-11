# Audit 07 — Navigation, onboarding and profile workflows

Reviewed 2 November 2026. Source inspection only. No application behavior, settings or user records changed. Runtime observations belong to the parent review; a source guard is not by itself proof of the state of an already authenticated browser.

## Assessment

The profile-first reorganization is sensible: Workspace is the home, chart and journal belong to a profile, and replay experiments have their own project type. Most legacy routes remain available rather than being destroyed. However, the navigation still gives global automation greater prominence than the principal learning jobs, while local journals and broker-gated charts/history create a discontinuity. First-use onboarding asks users to classify the infrastructure before it asks what they want to accomplish.

## Section inventory

- Public entry and support: root redirect, FAQ, setup, login, password reset, download, error, rate-limit, not-found, broker authentication (`frontend/src/App.tsx:178–193`).
- Local product core: Workspace, combined live analytics, profile overview/settings, journal, connections, replay runs (`App.tsx:196–214`). `TraderLayout` has no broker guard (`frontend/src/components/layout/Layout.tsx:41`).
- Broker/account books: positions, orders, trades, holdings, search, API key, P&L tracking, leverage, sandbox/analyzer (`App.tsx:215–253`, `:310–312`). `Layout` requires authenticated state and a broker (`Layout.tsx:13–20`).
- Research/tools: portfolio/SIP backtesting, holdings analysis, options chain, volatility, OI, Greeks, GEX, straddle, arbitrage, strategy builder/portfolio (`App.tsx:233–285`). The Tools directory itself is inside the same broker guard (`:254`).
- Automation: platform webhooks, Python strategies, Chartink strategies, guided broker strategies, Flow index/editor and approval center (`App.tsx:286–309`, `:335`, `:357`).
- Advanced operations: admin, quantity freezes, holidays, market timings, diagnostics, MCP, logs, security, traffic, latency, health, account settings, contracts (`App.tsx:313–335`).
- Full-width applications: main chart, playground, AI Agent/configuration, Historify/history charts, Flow editor (`App.tsx:339–358`). These inherit `FullWidthLayout`'s authentication and broker checks (`frontend/src/components/layout/FullWidthLayout.tsx:12–18`).

## Five priorities

### 1. Onboarding should start with the user's job, not Live versus Replay infrastructure

Evidence: profile creation first asks “What kind of channel is this?” and offers “Live trading channel” or “Replay project” (`frontend/src/pages/workspace/TraderWorkspace.tsx:523–563`). The live description promises chart-to-destination trading; the replay description calls it one test portfolio. There is no peer “I only want to journal/import my history” choice. The profile overview's setup checklist is destinations, destination-supplied chart data and drawdown guard (`frontend/src/pages/workspace/TraderProfileDetail.tsx:159–175`). A journal-only user therefore appears unfinished even when they need no connection.

Recommendation: first action choices are Journal my history, Practise a strategy, Explore charts and Connect accounts. Create minimal workspace metadata from that intent; postpone terminal/account/risk concepts. A manual journal should have a successful setup state with no broker. Preserve strict live/practice provenance behind these simpler entry journeys.

Acceptance: on a fresh installation, a person can add or import a trade and reach its review without naming a terminal, enabling copying or buying data. Practice setup explains the required history source before offering Start.

### 2. Navigation hides a core dependency while elevating advanced automation

Evidence: desktop top-level navigation is Workspace / Flow / Tools (`frontend/src/config/navigation.ts:32–36`), repeated in mobile bottom navigation (`:40–44`). History & data is inside the account menu (`:79–84`). Profile chart links enter `/trading`, but chart and Historify source routes are guarded by broker authentication while the profile itself is local (`App.tsx:196`, `:339–355`). Tools is also guarded, even to browse its directory. `useProfileMenuItems` filters only leverage, not the other broker-dependent destinations (`frontend/src/hooks/useProfileMenuItems.ts:29–32`).

Access nuance from parent cross-check: `app.py:505–559` can seed a loopback development session with an app user and broker placeholder. Session status can consequently retain app logged-in state without a working broker token. A successful local chart route is therefore not evidence of a verified execution connection. App identity, chosen broker identity and operational connector health need separate state.

Recommendation: make Data Library a first-class product destination. Keep profile context across Journal / Chart / Practice, and place Automation plus research under Advanced/Tools. Route readiness should reflect the specific action's capabilities: viewing local candles does not require an execution broker. Let users inspect useful tools and see contextual requirements before being sent to account setup.

Acceptance: a local candle import is discoverable from Workspace and chart empty state in one decision; it opens historical charts without requiring a broker connection. A restricted action explains its exact prerequisite and returns users to the original task after setup. Validate these in a clean browser session; the current running session may have local guest/session behavior.

### 3. Profile setup progress confuses configured intent with verified readiness

Evidence: checklist completion is driven by destination count, a selected `isChartDataSource` flag and a `ddGuardEnabled` flag (`TraderProfileDetail.tsx:163–174`), rather than connector health or broker acknowledgements. Creating a live simulator option sets `running: true` and `lastSeenAt: nowIso()` locally (`TraderWorkspace.tsx:291–313`). Replay checklist completion similarly accepts any session with manually stored status Completed (`TraderProfileDetail.tsx:187–195`).

Recommendation: use separate Configured and Verified states. Configuration completion may say “Source selected”; it must not imply “Receiving data”. Simulator readiness must come from an actual simulator instance. A read-only journal needs a different checklist from a live execution workspace. Show the next task and its dependency, not a universal setup score.

Acceptance: stopping the terminal cannot leave it presented as verified/healthy; a planning run cannot count as an executed/reviewed run; each checklist item names whether it tests saved configuration or observed runtime state.

### 4. Settings can silently change interpretation of historical records

Evidence: profile save updates `currency` and replay `startingBalance` directly (`TraderProfileDetail.tsx:115–130`). The journal schema holds profile-level currency; historical net P&L numbers are not converted here. Relabeling USD as GBP can therefore relabel prior records without conversion. Timezone/default symbol/timeframe settings are collected (`:121–127`) but downstream consumers must actually apply them; earlier specialist reviews identify gaps. Save and duplication handlers have no visible error handling in this component (`:112–149`); loading failure can instead resolve to Profile not found (`:91–106`). Profile deletion at least asks confirmation (`:152–155`), a useful protection to preserve.

Recommendation: freeze accounting currency after records exist or provide an explicit migration with original currency/amounts retained and conversion policy explained. Practice capital changes must create a new experiment/version or recalculate a clearly identified run, not rewrite historical assumptions invisibly. Show save-in-progress, saved, failed and retry states; never replace storage errors with not-found messaging.

Acceptance: changing display currency cannot silently alter the economic interpretation of existing trades. Failure to save retains inputs and shows recovery. Changing a default timeframe visibly affects the next relevant chart/run, or the setting is labeled as a future preference.

### 5. Combined analytics scopes are surprising and need an evidence-first hierarchy

Evidence: deselecting all profile IDs falls back to all available profiles (`frontend/src/pages/workspace/CombinedLiveAnalytics.tsx:237–241`). The 1W/1M/3M cutoff anchors to the latest closed trade, not today (`:263–275`); stale history can therefore appear to be a recent period. Default ranking is Score (`:215`, `:298`) and the view includes large metric/leaderboard families before the underlying trade table (`:490–543`, `:625`). The main profile comparison table has minimum width 1180px and horizontal scrolling (`:626–627`). Currency grouping is a strength: accounts are scoped by currency rather than summing incompatible currencies (`:229–236`).

Recommendation: show explicit date range and timezone, allow a true no-profiles-selected state, and distinguish Latest recorded period from Last calendar week/month. Start with scope, sample size, source completeness and net results, then drill into strategy/account decisions. Make mobile default to a compact profile list with expandable details rather than requiring repeated wide-table panning. Keep currency separation.

Acceptance: unchecking all profiles clears the results; Last week uses the documented calendar/rolling definition; every breakdown respects the displayed scope. A 360px viewport supports review of one profile/trade without losing its identifying labels.

## Proposed wireframe/navigation

Global chrome: Workspace · Data Library · Tools, with Account/Settings in a secondary menu. Automation is a Tools capability, not a forced first-use destination.

Workspace first paint: resume recent work; Import trades / Start practice / Open chart; then profiles and an Unreviewed queue. Show one next useful action for each profile. Suppress dense empty analytics until records exist, while explaining what will be measured.

Inside a verified profile: persistent profile selector and context; Overview · Journal · Chart · Practice (where appropriate) · Connections · Settings. The header has a textual Read only / Paper / Historical practice / Broker execution mode and separate source/account selectors. Chart, journal review and practice links preserve this context.

Journal-first entry: choose/import account identity → import preview or manual entry → reconcile → open trade review → see measured patterns. History charts are optional context, not a prerequisite for getting value.

Practice-first entry: choose project/question → choose validated dataset → set run assumptions → start → resume/finish → journal review. Missing data leads to Data Library with a return link to this run.

## Accessibility and responsive strengths to preserve

- Mobile navigation already uses visible labels, 44px minimum targets and `aria-current` (`frontend/src/components/layout/MobileBottomNav.tsx:21–29`).
- Profile creation uses fieldsets/legends, labeled inputs and `aria-pressed` state on choices (`TraderWorkspace.tsx:524–530`). Wizard progress marks the active step with `aria-current="step"` (`:507`).
- Profile tabs are links in a named navigation region (`frontend/src/pages/workspace/ProfileShell.tsx:117`); page titles cover nested profile routes (`frontend/src/hooks/usePageTitle.ts:83–87`).
- Responsive grids exist throughout Workspace and combined analytics. Preserve them while reducing first-use metric density. Keyboard focus, dialog return focus, screen-reader chart alternatives and real mobile chart usability require runtime verification; source classes alone do not certify them.

## Validation boundary

No automated tests or user-session mutations were performed for this specialist review. Recommended end-to-end checks: clean local user journal journey; valid candle import to historical chart without broker; missing-source recovery with return path; keyboard-only creation/review; currency-change behavior with existing records; deselect-all analytics; profile settings persistence failure; 360px and wide-screen navigation continuity.
