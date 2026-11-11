# P18-T01/T03/T06/T07 — Design audit and standards

Audited 4 November 2026 against the shipped UI kit.

## Component inventory (T01)

`frontend/src/components/ui/` carries the shadcn-style kit (button,
card, input, label, select, table, tabs, dialog, alert-dialog,
skeleton, empty-state, page-loader, sonner…). Rules adopted:

- Density: document/research surfaces use `text-sm` rows with
  tabular citations; chart surfaces keep their own canvas density and
  never borrow document tables inside the chart frame.
- One primary action per card; destructive actions always go through
  `alert-dialog` confirmation; long operations expose progress +
  cancellation through their owning job APIs (ingestion, experiments).
- Forms: every input has a `Label htmlFor`; validation errors render
  in `role="alert"` outputs; submit buttons disable on busy *and* on
  invalid input, with the reason visible in text.

## Shared states (T02/T05, shipped)

`components/states.tsx`: `StateNotice` (loading/empty/error/stale/
partial/saved — announced via status/alert, text labels so meaning
never depends on colour) and `ContextBanner` (account/environment/
source/freshness as text). New surfaces from this programme
(Fundamentals, StrategyWorkspace, ConnectorPanel) already follow the
label + alert-output pattern; legacy pages migrate as touched.

## Responsive scope (T06)

Research/journal/import tasks work at narrow widths (single-column
stack via `lg:` breakpoints). Explicitly desktop-first: multi-pane
chart layouts, Flow editor canvas, terminal-bridge tooling (MT5 is
Windows-desktop by nature). This is stated here rather than implied
by breakage.

## Theme (T07)

Brand/theme tokens live in the Tailwind CSS-variable theme already
used by every page in this programme; no page ships hard-coded brand
colours. Visual-regression *fixtures* (screenshot baselines) are not
yet in place — recorded as the remaining T07 gap; current protection
is component tests + Biome a11y lint on touched files.
