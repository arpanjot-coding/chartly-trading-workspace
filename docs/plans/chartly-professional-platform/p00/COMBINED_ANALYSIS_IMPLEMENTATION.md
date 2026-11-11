# Combined Analysis selection slice

Status: implemented and verified, 2 November 2026. The original Combined Analysis page and analytics are preserved. P00 remains open.

## Implementation contract

- Portfolio checkboxes can include/exclude the final selected portfolio. Clear all means no portfolios selected across currency groups; it never falls back to All.
- Select all selects the current currency group explicitly. Currency changes preserve the portfolio selection across groups, while keeping money totals separate.
- Save selection explicitly persists the chosen portfolio IDs and currency group on this device, alongside the current browser-local journal environment. Reload restores even an empty selection; newly created portfolios never join an explicit saved selection automatically.
- Saved IDs are resolved against available, unarchived live portfolios. Missing IDs are explained and excluded; storage corruption/failure is visible and never reported as saved. No account sync/backend persistence is implied.
- Empty selection keeps the original filters available and replaces results with a selection prompt. All KPIs, equity/drawdown chart, rankings, comparisons, strategy/symbol/side/time/source/account breakdowns, weekly/daily and recent trades derive from the same selected-and-filtered trades.
- Keep live/practice and currency separation, existing calculations and period definitions. Changing date semantics or adding currency conversion is outside this slice.

## Verification to complete

- Actual page tests with two same-currency portfolios with different outcomes, another currency, a practice portfolio and an archived portfolio. Verify every visible results family excludes unselected records and the equity chart uses selected history.
- Test clear-all/last deselection, explicit save/reload, empty save, new/missing portfolios, currency switching and failed/corrupt storage.
- Run existing journal navigation/metrics regressions, targeted lint, production build and browser checks. Record results before marking this slice complete.

## Tools/section cleanup

The user confirmed: keep Flow and reusable strategy/indicator engines; retire the Tools directory and specialist options/legacy features. That separate work is recorded in [Tools retirement evidence](TOOLS_RETIREMENT_IMPLEMENTATION.md).

## Completion evidence

- [x] Inclusion, last deselection, Select all for the current currency, Clear all across currencies, explicit Save selection and reload restoration work in the original UI.
- [x] Explicit empty selections persist; new portfolios do not join an explicit saved view. Missing/archived/practice portfolios are excluded, currency groups stay separate and storage failures retain current choices with an error.
- [x] Actual page fixture tests verify selected-only results throughout KPIs, equity path/history, profile/strategy/symbol/side/time/source/account families and weekly/recent records. Two same-currency accounts with very different results, another currency, a practice account and an archived account are represented; no production test trades were inserted.
- [x] 97 frontend tests passed across 10 suites, including the seven Combined Analysis cases plus retained navigation/journal/metrics/chart/backtest regressions and the strategy entry point. Seven targeted files passed lint. Production TypeScript/Vite build passed.
- [x] Built-app browser check: Clear all → Save selection → reload restored zero checked portfolios and no results; Select all USD → Save selection restored the available real portfolio. Existing data contained one empty live portfolio, so populated multi-account verification belongs to test fixtures.

Selection persistence is browser-local, versioned and explicit. Named multiple saved views, account/device synchronization, currency conversion and revised period semantics remain outside this slice. [Saved selection screenshot](combined-selection.jpg) · [saved empty-state screenshot](combined-empty-selection.jpg).
