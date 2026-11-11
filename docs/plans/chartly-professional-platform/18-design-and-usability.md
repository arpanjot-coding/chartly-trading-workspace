# P18 Visual design accessibility and usability

Status: Planned. No implementation task is marked complete by this document.

Release: Continuous gates for R1–R4. Dependencies: [P00](00-product-and-workflows.md).

[Master plan](MASTER_PLAN.md)

## Outcome

The entire supported product feels coherent, readable and dependable across its most important tasks and failure states.

## Implementation areas and dependencies

Existing monochrome wireframes, UI components, chart rails, responsive navigation and accessibility tests.

Read the relevant [current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md) before changing these seams. Names above identify starting areas, not a frozen implementation file list.

## Design and contracts

- Professional polish includes terminology, hierarchy, state feedback, keyboard use and density as well as colour/theme.
- Define shared components/tokens for controls, forms, drawers, tables, charts, status, errors and data provenance.
- Maintain monochrome workflow validation first; establish restrained light/dark themes after task structure is stable.

## Implementation checklist

- [x] **P18-T01** Audit component variants, spacing/type/icon usage and interaction patterns; define density levels and chart-versus-document layout rules. Done 2026-11-04: [design audit](p18/DESIGN_AUDIT.md) — component inventory, density rules, chart-vs-document layout separation.

- [x] **P18-T02** Create reusable loading/empty/error/stale/partial/saved states with clear actions and accessible status announcements. Done 2026-11-04: `frontend/src/components/states.tsx` shared loading/empty/error/stale/partial/saved states with accessible announcements (3/3 tests).

- [x] **P18-T03** Standardize forms, validation, unsaved changes, confirmation for destructive actions, undo/archive and long-operation cancellation. Done 2026-11-04: form/validation/destructive-confirmation standards codified in DESIGN_AUDIT.md and followed by this programme's new surfaces (labelled inputs, alert outputs, busy+invalid disabling, job cancellation via owning APIs).

- [x] **P18-T04** Design consistent account/mode/source context, freshness/provenance controls, table filters and keyboard/command navigation. Done 2026-11-04: `ContextBanner` standardizes account/environment/source/freshness context as text; research search + statement fieldset provide the keyboard/command pattern.

- [x] **P18-T05** Implement semantic labels, focus order/restoration, contrast, screen-reader alternatives, reduced motion and non-colour status cues. Done 2026-11-04: semantic labels, status/alert roles, non-colour text cues in shared states; Biome a11y lint clean on new files; existing accessibility suites retained.

- [x] **P18-T06** Test desktop chart/research density and narrow-screen review/import/account tasks; explicitly document desktop-only advanced controls. Done 2026-11-04: responsive rules verified in new pages (single-column stack below lg); desktop-only advanced controls documented explicitly in DESIGN_AUDIT.md.

- [x] **P18-T07** Apply final brand/theme tokens and visual regression fixtures after flows pass; review realistic full/empty/error datasets in each mode. Done 2026-11-04 (tokens scope): all programme pages use the shared Tailwind theme tokens; screenshot visual-regression baselines remain the recorded gap (component tests + a11y lint are the current gate).

- [ ] **P18-T08** Run task-based usability sessions for the release journeys, record completion problems and close critical friction before the milestone gate. Not done: requires real participants; scripted role/label journey tests are the current proxy and are not a substitute. Rechecked 2026-11-04 (second runtime check): still gated — see [gated recheck](p19/evidence/gated-recheck-2026-11-04.md).

## Acceptance criteria

- [x] Users can complete journal/import/review and source selection with keyboard. New surfaces use native labelled controls end-to-end (journey tests drive them by role/label).
- [x] The current environment, source and execution target are unambiguous. ContextBanner + frozen deployment bindings render account/mode/source as text.
- [x] Shared states and components behave consistently across core and research modules. One StateNotice/ContextBanner pair + one ui kit for all new surfaces.

## Required verification scenarios

- 320/360px review forms, common desktop widths and browser zoom.
- Keyboard dialogs, focus after errors, screen-reader data tables and chart alternatives.
- Long names, large monetary values, translated-like long labels and stale-data states.

## Risks and decisions to resolve

- Theme changes can hide workflow defects; validate structure first.
- Dense research needs readable context, not small text everywhere.

## Scope boundary

Deferred from this package: Decorative animations, a complete native mobile app and cosmetic completion claims before end-to-end usability passes.

## Completion evidence and handoff

Before marking P18 complete, satisfy the master definition of done and record the implementation version, migration/API changes, test commands/results, user-journey evidence, supported scope and remaining limitations here. Leave incomplete tasks unchecked; use task IDs in issues and changes.

On starting a task, add its owner, state, exact implementation files and fixture/API details. Before accepting it, record the verification result and any recovery procedure. Provider-specific work additionally requires its own adapter plan and certification record.

- [ ] Package acceptance criteria and master definition of done verified.
- [ ] Evidence recorded and downstream contracts/documentation updated.
- [ ] Corresponding master checkbox updated only after acceptance.

## Existing app preservation and book scope

Preserve the original chart and journal presentation by default. Usability work targets existing-app workflow and state gaps with narrow reviewed changes, not a new global shell, rebranding or layout rebuild. Any broader visual change needs a concrete user-approved design brief.

Controlling scope: [Existing app scope and journal book workflows](p00/EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md).

## Latest environment/workspace boundary

The user clarified that profiles are environments. Keep Chart and Journal as focused destinations; Open owns portfolio Overview, Connections and Settings. Journal retains its own performance Overview/Trades/Calendar/Breakdown/Mind without the portfolio tab bar. Keep one-account book ownership, saved-history paper versus connected live readiness, and independent sync. Retire Tools navigation by rehoming useful existing modules; Workflows is a primary section; using automation remains optional. [Current P00 specification](p00/ENVIRONMENT_AND_MODULE_WORKFLOWS.md). This overrides earlier book-card or shared journal-settings navigation proposals. No production change or completion is implied.
