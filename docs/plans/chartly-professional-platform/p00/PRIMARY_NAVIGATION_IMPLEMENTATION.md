# Four direct primary sections

2 November 2026. Implemented after the user's explicit navigation-order clarification. P00 design remains accepted; this does not complete the Strategy Builder or Fundamentals implementations.

The original app now uses **Workspace → Fundamentals → Strategy Builder → Workflows** on desktop and mobile. The main-navigation More dropdown and its breakpoint-hiding behavior were removed. Settings and optional AI remain in the shared user menu.

Implementation: shared navigation config; Navbar; four-column mobile bottom navigation; client and direct Flask `/fundamentals` routes; title mapping; a truthful Fundamentals availability page with Workspace return. No research provider, generated company data or research functionality is claimed by the new entry.

Verification:

- 62 frontend tests passed across 9 files, including current nav order/active state, no More control, Fundamentals return, settings and existing journal/chart/Combined Analysis regressions.
- Direct Flask route test passed for Workspace, Settings, Fundamentals including trailing slash, and existing profile/book paths. Existing pytest cache-path/shutdown logging messages remain; test exit status was zero.
- Focused lint and production TypeScript/Vite build passed. The backend was restarted with its existing environment and no credential edits.
- Browser navigation reached Fundamentals and Strategy Builder directly. Fundamentals reloaded successfully from its own URL; its unfinished research state was explicit.
- At 768, 1024 and 1280px all four desktop labels fit with no More button or page overflow. At 360 and 320px all four mobile labels fit in the same order, also without page overflow. Temporary viewport overrides were reset.

All tests use the bounded implemented scope; the new nav entry is not P14 research acceptance. No trading records, credentials or execution permissions were changed.

[Running original-app screenshot](primary-navigation.jpg). Direct Workflows and Strategy Builder navigation also reached their existing pages with the correct active tab.
