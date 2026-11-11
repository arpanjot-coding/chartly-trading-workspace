# Settings and connection/data workflow

2 November 2026. Owner: Codex. State: implemented and verified for the configuration/navigation slice below; awaiting user review. P00 remains open.

## Scope agreed from the current conversation

Keep the original application. Workspace owns profile environments and their chart/journal entry points. Workflows owns automations. Strategy Builder will own indicator/strategy projects and their validation. Fundamentals is a separate research workspace with its own data contract; it is still missing.

This slice consolidates configuration that is already implemented. It does not add trading permissions, connect a broker, change credentials, migrate records or certify any connector.

## Exact navigation changes

1. The shared user menu and mobile sheet expose **Settings** and **AI Agent**. Account, developer keys, history and administration stop appearing as unrelated destinations in that menu.
2. `/settings` groups Account & preferences, Connections & Data, Developer API and System & advanced. Existing destinations and controls remain available.
3. `/settings/connections` holds the existing broker configuration form, extracted from Account. It describes the current app-wide broker connection honestly; it is not a universal multi-account registry.
4. A shared Connections & Data navigation connects Brokers, History & data (`/historify`) and Portfolio accounts (`/settings/connections?tab=portfolios`). History retains its existing full-width interface and storage APIs.
5. Portfolio accounts lists existing unarchived profile environments and links to their existing Connections screens. No new accounts or journals are created. Their configuration-only status remains explicit until sync adapters are implemented.
6. Account keeps its existing security/preferences tabs, with Broker removed. Account, Developer API, Admin and History get return links to Settings or Connections & Data. Existing authorization and API checks remain in place.
7. Local users can browse the Settings hub and their profile connection links without a broker. Protected broker/history/account/API surfaces retain their current guards. The hub explains the prerequisite rather than implying data or execution is connected.

## Implementation seams

- `frontend/src/config/navigation.ts`, `hooks/useProfileMenuItems.ts`: one configuration entry across shared headers.
- `pages/settings/SettingsIndex.tsx`, `ConnectionsData.tsx`, `BrokerSettings.tsx`, shared navigation: reuse existing cards, buttons and form components.
- `pages/Profile.tsx`: remove broker-owned state/form/fetch; preserve other tabs and account behavior.
- `pages/Historify.tsx`, `pages/ApiKey.tsx`, `pages/admin/AdminIndex.tsx`: contextual return links.
- `App.tsx`, `blueprints/react_app.py`, `hooks/usePageTitle.ts`: working client navigation and direct/reload routes.

## Verification before checking off this slice

- [x] User menu and mobile navigation lead to one Settings destination.
- [x] Settings hub and profile connection index work without a broker, with empty/loading/error recovery.
- [x] Extracted broker form loads masked configuration, saves only explicit edits, reports failure and retains restart behavior; tests use mocked requests only.
- [x] Account no longer requests broker credentials or displays a Broker tab.
- [x] Broker, History and profile links connect and return correctly; existing authorization boundaries remain.
- [x] Direct Flask routes, focused frontend tests, production build and actual browser paths pass.
- [x] Evidence and remaining limitations recorded; P00 stays open for user review and remaining workflows.

## Verification evidence and limits

Frontend: **60 tests passed across 7 files** with `npx vitest run src/pages/settings src/config/navigation.test.ts src/components/layout/Navbar.test.tsx src/pages/workspace/JournalSeparation.test.tsx src/pages/workspace/CombinedLiveAnalytics.test.tsx src/lib/trader/journalNavigation.test.ts` in `frontend`. This includes actual Account rendering, shared desktop/mobile menu configuration, connection-directory recovery, explicit broker saves/failures/restart guidance, existing broker prerequisite combinations, journal/chart round trips and Combined Analysis selection regression tests.

Backend: **53 tests passed** with `.venv/Scripts/python.exe -m pytest test/test_react_workspace_routes.py test/test_retired_features.py -q --tb=line --basetemp=tmp/pytest-settings-01`. Only the test process set `LOG_FORMAT=%(levelname)s: %(message)s`. Pytest emitted a pre-existing cache-path warning and at-exit strategy logger messages; exit status was zero. Credential APIs and their authorization were not changed.

Focused lint passed for the new settings surfaces, shared connection navigation and navigation configuration/hook. `npm run build` passed and the production frontend was rebuilt. The local app was restarted with its existing environment retained only in process memory; direct `/settings` serving was verified. No credentials or broker configuration were submitted during browser review.

Actual browser paths verified: Settings → Brokers → existing History & data → Portfolio accounts → original profile Connections; shared user menu → Settings; Account → Settings; Developer API → Settings; System & advanced → Settings. The portfolio-directory URL survived a direct reload. At 360px, the Settings hub, shared connection navigation, broker form and profile directory had no page-wide horizontal overflow; the mobile sheet exposed the same Settings entry. The browser viewport was restored to 1280px after review.

Screenshots: [Settings hub](settings-hub.jpg), [Connections & Data directory](connections-data-directory.jpg), [narrow Settings hub](settings-mobile.jpg).

Known limits: existing Account, API, Admin and Historify authentication/broker prerequisites remain; this does not resolve their later local-first capability migration. The app-wide broker configuration is still separate from browser-local profile account records. Profile sync, connected-book ownership migration, research provider connections and automatic history updates remain future adapter/domain work. Service endpoints are labeled Configured rather than falsely claiming measured health. The original chart and journal layout were preserved.

The new Strategy Builder remains unimplemented. Fundamentals has a [first company delivery plan](../p14/IMPLEMENTATION_PLAN.md), with every delivery step unchecked. No global P00 or package task has been marked complete by this slice.

## Development order after this slice

1. Review the original app's consolidated navigation and the already implemented Journal/Combined Analysis paths together.
2. Finish P00 contracts and state specifications for journal book/account ownership and read-only sync, the Strategy Builder workflow, and the first Fundamentals journey. These are parallel product specifications, not an instruction to implement three large systems at once.
3. Execute P01/P02 identity, capability and durable-storage work before depending on shared persisted research, sync or experiments.
4. Implement independently useful vertical slices using the existing detailed package order and dependencies: journal/import/history/chart first; indicator/strategy project and baseline experiments next; certified read-only adapters before execution.
5. Implement the first Fundamentals company slice through P13/P14/P16. Start with company/listing identity, a sourced company overview, annual/quarterly statements and original report links, freshness and saved research. Missing metrics stay unavailable. Yahoo is a candidate requiring a provider/access evaluation, not an existing official integration. Supplier/client relationships, estimates and global coverage require separately verified datasets.

No Fundamentals navigation link should claim a functioning product until its first useful journey and failure states exist. No full package is complete because its menu entry exists.
