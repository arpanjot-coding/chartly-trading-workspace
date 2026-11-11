# Journal separation: implementation slice

Status: implemented and verified, 2 November 2026. P00 remains open. Authorized scope: separate the journal in the original application, keep its existing content/tabs, retain portfolio management behind Open, and test chart/journal return paths.

## Changes to make

1. Remove `ProfileHeader` from `TraderJournal`; add compact Workspace, Chart and Portfolio details links with book identity. Preserve the existing journal section, dashboard, tabs, entry dialog and data scope. Keep its existing local route/layout, so journal access gains no broker gate.
2. Make `ProfileHeader` management navigation Overview / Connections / Settings. Preserve Journal/Chart as shortcuts, and preserve replay-run access as a shortcut and existing overview links.
3. Store journal view selection in its own URL: tab, period, strategy, trade search/result/direction/sort, calendar month/day and expanded trade. Defaults remain unchanged. This preserves selection on reload and chart return without sharing another profile's state.
4. Extend existing chart links with an optional validated journal return target. The target must be this profile's exact journal route; discard external, cross-profile and unrelated destinations. Preserve existing symbol/exchange deep-link handling, run parameters and default portfolio return behaviour.
5. Reuse the chart's existing back-link position. Return to the journal when opened there; provide a small Journal shortcut when opened from the portfolio. Portfolio details carries the journal return state into management so its Journal shortcut restores it.

## Verification before accepting this slice

- Test actual journal rendering without the portfolio tab bar, with all existing journal tabs and optional Mind behaviour.
- Test live and replay management navigation and replay-run access.
- Test Journal → Chart → Journal, portfolio Chart → Journal, and Journal → Portfolio details → Journal with real router transitions and two profile fixtures.
- Test malicious/cross-profile return targets, absent profile context and existing symbol/run parameter preservation.
- Run relevant existing metrics/model/chart-link regressions, production build, and read-only browser walkthrough against the built original app.
- Record precise results and remaining limitations here. Complete only this slice; keep unrelated P00/master tasks unchecked.

## Boundary

This slice changes navigation/view state. It does not implement account sync, change book ownership/storage, add trade editing or reconstruct historical charts. Unsaved trade/mood dialogs and page scroll are not persisted across navigation in this slice; do not claim draft or scroll restoration.

## Completion evidence

- [x] Journal uses compact `JournalNavigation` instead of the portfolio header. Existing dashboard, journal tabs and optional Mind content remain. Local journal routing/layout and persistence are unchanged.
- [x] Portfolio management navigation is Overview / Connections / Settings. Journal and Chart remain shortcuts; replay projects retain a Runs shortcut and existing overview run links.
- [x] Journal tab, period, strategy, trade search/result/direction/sort, selected day/month and expanded trade are represented in the journal URL. Only the same profile's exact journal route is accepted as a return destination.
- [x] Six suites / **43 tests passed**, including 17 new navigation/view-state/integration cases alongside existing metrics/model/profile-link/instrument-link regressions. Integration fixtures use two profiles and actual journal rendering; the chart engine itself is represented by its real extracted navigation component in unit integration tests.
- [x] Targeted lint passed for the new helper/tests, chart navigation and modified profile shell. Production `npm run build` passed TypeScript and Vite, updating the app served on port 5000. Vite emitted large-chunk and unresolved-asset warnings; the build exited successfully.
- [x] Browser walkthrough of the built original app verified Workspace Open → management tabs; Journal has no portfolio tab bar; Calendar / 1W / October 2026 → original chart → same journal view; Portfolio details → Settings → same journal view; reload retention. Original chart controls/rails/dock rendered. No instrument was selected and no data/execution certification is claimed.
- [x] No journal records, accounts, credentials or orders were created/edited during the browser walkthrough. Populated trade/filter/expanded-row, paper profile and cross-profile isolation cases were exercised in the test fixtures.

Test command from `frontend`:

```powershell
.\node_modules\.bin\vitest.cmd run src/lib/trader/journalNavigation.test.ts src/pages/workspace/JournalSeparation.test.tsx src/pages/workspace/ProfileShell.test.ts src/lib/trader/metrics.test.ts src/lib/trader/profileModel.test.ts src/lib/trading/chartLink.test.ts
```

Implementation files: `frontend/src/pages/workspace/ProfileShell.tsx`, `TraderJournal.tsx`, `frontend/src/pages/Trading.tsx`, `frontend/src/components/trading/ChartProfileNavigation.tsx`, `frontend/src/lib/trader/journalNavigation.ts`. Tests: `JournalSeparation.test.tsx` and `journalNavigation.test.ts`. Screenshot: [separated original journal](journal-separation.jpg).

Only this navigation slice is completed. Broader P00 user-review tasks, sync, book/domain migration, Fundamentals, Strategy Lab integration and other roadmap packages remain open.
