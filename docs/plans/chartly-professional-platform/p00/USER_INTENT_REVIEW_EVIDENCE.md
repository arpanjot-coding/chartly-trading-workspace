# Existing-app scope correction: verification

Date: 2 November 2026.

The [scope clarification](EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md) controls the roadmap. Improve the original application in place, preserve its chart and journal presentation, and specify each journal as an independent book. The standalone prototype is exploratory and is not an accepted replacement UI.

## Changes recorded

- Updated the master roadmap and affected work packages to require reuse of the existing components and targeted workflow changes.
- Replaced P00's replacement-screen direction with annotated journeys through the existing application.
- Recorded book identity, explicit import/sync destinations, book-local reviews, chart handoffs, isolation and recovery requirements.
- Initially left ownership open; the subsequent original-screen review records the user decision: exactly one account per connected book, with separate manual books. Duplicate-book/account policy remains a review detail.
- Kept P00 open, P01's design dependency unresolved, and all roadmap task checkboxes unchecked.

This correction changes planning documents and the exploratory prototype's status label. It does not implement the proposed production workflows or replace the original chart/journal source files.

## Existing source checks

Command, run from `frontend`:

```powershell
.\node_modules\.bin\vitest.cmd run src/lib/trader/metrics.test.ts src/lib/trader/profileModel.test.ts src/pages/workspace/ProfileShell.test.ts
```

Result: **3 test files passed; 21 tests passed**. These existing tests cover the current metrics/profile model and profile-scoped chart links. They do not prove that the proposed independent-book lifecycle, imports, sync or runtime context are implemented.

The plan validator reports 24 root Markdown files, 23 linked work packages, 189 unique tasks, all tasks unchecked, P00 reopened and P01 not ready. This is documentation consistency evidence only.

## Remaining P00 acceptance

Review the original screens with annotated changes for journal books and synchronization, chart/editor/strategy handoffs, and fundamentals integration. Settle book inclusion rules, specify acceptance scenarios, and review the intended changes with the user before completing P00. No new runtime or browser verification of the original application is claimed by this record.

## Subsequent original-screen review

The [original-screen specification](ORIGINAL_SCREEN_WORKFLOW_REVIEW.md) now records a read-only walkthrough of nine original views and the user's confirmed ownership rule: exactly one account per connected book, with separate manual books. Its [screenshot review](original-screen-review/index.html) contains 36 numbered notes tied to the original UI. Browser checks verified all nine images load, each screen has four matching markers/notes, and the review has no horizontal overflow at the default desktop viewport. This checks the review document, not proposed product functionality.

The subsequent regression command also included `src/lib/trading/chartLink.test.ts`: **4 files / 26 tests passed**. No records, accounts or orders were saved during the original-app walkthrough. Full details and limits are in that specification. P00 remains open and the acceptance scenarios remain unchecked.

## Latest environment/module clarification

The user clarified that Workspace profiles are environments. Journal and Chart should open as focused workspaces; Open should manage portfolio Overview, Connections and Settings. Earlier book-card replacement proposals have been superseded in the [current specification](ENVIRONMENT_AND_MODULE_WORKFLOWS.md) and relevant roadmap packages. One account per connected journal book, with separate manual books, remains the ownership rule.

Additional running-app review covered Tools, Flow and Combined Analysis. Tools listed 24 entries; the [disposition inventory](MODULE_DISPOSITION.json) maps each registry route exactly once. Combined Analysis's final selected checkbox remained checked after attempted deselection, matching the current source. No workflows, orders or persistent records were changed.

The updated screenshot review contains 12 original views and 48 numbered notes. All 12 image/screen transitions, matching markers/notes and default-desktop horizontal overflow checks passed. Documentation links and unchecked roadmap state passed validation. The 26 regression tests above are previous implementation evidence; they were not rerun for documentation-only changes and do not certify the proposed navigation, paper-data integration or environment isolation. P00 remains open.
