# P06 reproducible verification

3 November 2026. Run from the repository root unless `frontend` is specified. Fixtures are isolated synthetic local records; do not migrate installed-user records or contact a live provider. Use a new literal pytest `--basetemp` path for another full run. [Recorded results and acceptance evidence](IMPLEMENTATION_EVIDENCE.md).

## Backend integration

```powershell
$env:LOG_FORMAT='[%(levelname)s] %(message)s'
$env:TEMP=(Resolve-Path tmp).Path
$env:TMP=$env:TEMP
& '.venv/Scripts/python.exe' tmp/run_p06_backend.py
```

[The runner](../../../../tmp/run_p06_backend.py) declares the exact **51-file P01–P06 selection**, enforces no duplicate names and records output to `tmp/p06-final-backend-tests.log`. Its final run passed **1,285 tests, one warning, 314.63 seconds**. All twelve new paper suites are registered once in the existing Python 3.12/3.13/3.14 CI matrix; this local run used Windows Python 3.14.7 and does not infer remote CI success.

For an affected paper-only rerun, choose a fresh literal directory:

```powershell
& '.venv/Scripts/python.exe' -m pytest test/test_paper_engine.py test/test_paper_engine_review.py test/test_paper_market.py test/test_paper_sessions.py test/test_paper_sessions_review.py test/test_paper_api.py test/test_paper_broker_boundary.py test/test_paper_resources.py test/test_paper_storage.py test/test_paper_journal.py test/test_paper_journal_context.py test/test_paper_reports.py -q -s --disable-warnings --basetemp=tmp/p06-paper-followup-new-run
```

This is a reproducible follow-up command, not an additional recorded test total. The full backend log contains actual 50,000-observation timing and 100-mutation resource measurements; their limits and measured values are in [implementation evidence](IMPLEMENTATION_EVIDENCE.md).

## Frozen frontend regression

From `frontend`, use supported Node 22.23.4 and the existing workspace temporary directory:

```powershell
$env:TEMP=(Resolve-Path ../tmp).Path
$env:TMP=$env:TEMP
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vitest/vitest.mjs run src/lib/trading src/components/trading src/hooks/useChartWorkspaceCatalog.test.tsx src/hooks/useDatasetChartSource.test.ts src/hooks/useResolvedChartContext.test.ts src/hooks/usePaperSession.test.ts src/hooks/usePaperSession.review.test.ts src/pages/Trading.test.tsx src/pages/Trading.paper.test.tsx src/pages/workspace src/lib/trader src/pages/settings src/lib/domain src/components/layout src/lib/historify src/lib/chart/feeds src/pages/historify src/api/dataLibrary.test.ts src/pages/Login.local.test.tsx src/pages/HistorifyCharts.test.ts src/components/chart/ChartlyChart.test.tsx
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/typescript/bin/tsc -b
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vite/bin/vite.js build
```

The frozen Vitest selection supplied by the chart owner passed **2,375 tests/216 suites in 72.30 seconds**, recorded in `tmp/p06-final-frontend-regression.log`. After final small journal/header/return corrections, the following overlapping checks passed **32 tests/five suites**, **two profile-return tests** and **three journal-instruction assertions**. Final TypeScript/build logs are `tmp/p06-chart-types-final.log` and `tmp/p06-chart-build-final.log` (served build refreshed after the last prose change). Overlapping runs must not be summed into a fabricated unique total. jsdom's missing canvas implementation requires actual browser review for rendering.

```powershell
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vitest/vitest.mjs run src/pages/workspace/JournalPaperBooks.test.tsx src/pages/workspace/JournalSeparation.test.tsx src/pages/workspace/JournalLifecycle.test.tsx src/pages/workspace/PaperRunMetrics.test.tsx src/pages/workspace/TraderReplay.dataset.test.tsx
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vitest/vitest.mjs run src/pages/workspace/ProfileShell.test.ts
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vitest/vitest.mjs run src/pages/workspace/JournalPaperBooks.test.tsx
```

Logs: `tmp/p06-final-journal-card-followup.log`, `tmp/p06-final-profile-shell-followup.log` and `tmp/p06-final-journal-prose-tests.log`.

The chart owner's final scoped Biome command passed **37 files with no fixes**, recorded in `tmp/p06-chart-biome-final.log`:

```powershell
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/@biomejs/biome/bin/biome check src/lib/trader/paperClient.ts src/lib/trader/paperPending.ts src/lib/trader/paperClient.test.ts src/lib/trader/paperPending.test.ts src/lib/trader/paper.fixture.ts src/hooks/usePaperSession.ts src/hooks/usePaperSession.test.ts src/hooks/usePaperSession.review.test.ts src/components/trading/PaperSessionPanel.tsx src/components/trading/PaperSessionPanel.test.tsx src/components/trading/PaperReplayBar.tsx src/components/trading/PaperReplayBar.test.tsx src/components/trading/PaperReportDetails.tsx src/components/trading/PaperReportDetails.test.tsx src/pages/workspace/PaperRunComparison.tsx src/pages/workspace/PaperRunComparison.test.tsx src/pages/Trading.tsx src/pages/Trading.paper.test.tsx src/pages/workspace/TraderReplay.tsx src/lib/trading/workspaceReplay.ts src/lib/trading/workspaceReplay.test.ts src/lib/trading/chartContext.ts src/lib/trading/chartContext.test.ts src/lib/trader/db.ts src/components/trading/RightRail.tsx src/components/trading/dock/ReadonlyTradingDock.tsx src/components/trading/dock/ReadonlyTradingDock.test.tsx src/components/trading/JournalPanel.tsx src/components/trading/JournalPanel.test.tsx src/lib/trading/terminal.ts src/lib/trading/terminal.paperCapture.test.ts src/pages/workspace/TraderReplay.dataset.test.tsx src/pages/workspace/PaperRunMetrics.tsx src/pages/workspace/PaperRunMetrics.test.tsx src/pages/workspace/TraderJournal.tsx src/pages/workspace/JournalPaperBooks.test.tsx src/pages/workspace/ProfileShell.tsx
```

The final single-file journal prose/check assertion changes also passed scoped Biome (`tmp/p06-final-journal-prose-biome.log`, `tmp/p06-final-journal-prose-test-biome.log`). Earlier card-metric follow-ups overlap the final broad selection.

## Strict new Python and explicit legacy scope

The exact current file inventories are retained in `tmp/p06-python-new-scope.txt` (**27 new files**) and `tmp/p06-python-check-scope.txt` (**36 new/shared files**). They include `services/paper_economics.py`, the engine/service/storage/report/journal/broker guard, all twelve tests, current gate helpers and the read-only final browser verifier.

```powershell
$p06NewPython = Get-Content -LiteralPath tmp/p06-python-new-scope.txt
$p06AllPython = Get-Content -LiteralPath tmp/p06-python-check-scope.txt
& 'tmp/p01-format-tools/bin/ruff.exe' check @p06NewPython
& 'tmp/p01-format-tools/bin/ruff.exe' format --check @p06NewPython
& '.venv/Scripts/python.exe' -m py_compile @p06AllPython
& 'tmp/p01-format-tools/bin/ruff.exe' check --output-format concise @p06AllPython
& 'tmp/p01-format-tools/bin/ruff.exe' format --check @p06AllPython
```

New-code lint/format pass in `tmp/p06-final-python-new.log`; all 36 files compile in `tmp/p06-final-python-compile.log`. The last two commands deliberately expose the existing legacy baseline: two UP035 warnings for `typing.Dict`/`typing.Tuple` in `place_order_service.py`, plus whole-file formatting differences in that module and `blueprints/orders.py`. See `tmp/p06-final-python-lint.log`. Additive `app.py`/REST ingress imports are lint-clean. Whole-file legacy cleanup is outside this package's focused changes; do not describe those broad commands as passing.

## Contracts, preserved design and completion gate

```powershell
& '.venv/Scripts/python.exe' contracts/generate_types.py --check
& 'tmp/p01-node/node_modules/node-win-x64/bin/node.exe' --test docs/plans/chartly-professional-platform/p00/workflow.test.mjs docs/plans/chartly-professional-platform/p00/p00-review.test.mjs docs/plans/chartly-professional-platform/p00/dist/model.test.mjs docs/plans/chartly-professional-platform/p00/dist/chartData.test.mjs
& '.venv/Scripts/python.exe' tmp/test_p06_plan_gate.py
```

Recorded results: canonical generated declarations match (`tmp/p06-contract-check.log`); **84 P00 tests pass** (`tmp/p06-p00-regression.log`); **84 forward-gate cases pass** (`tmp/p06-plan-gate-tests.log`). The forward harness supplies synthetic virtual acceptance fixtures and never creates a real gate or changes a checkbox.

The final local documentation audit checks root plans/P06 Markdown plus API index/paper reference and the two public guides. It passed **35 documents/418 links**, including the new chart anchor and real architecture image (`tmp/p06-doc-link-audit.log`). It does not fetch external URLs. Root must repeat link validation after any final acceptance-document additions.

After actual browser/review acceptance and final artifact hashes, root runs:

```powershell
& '.venv/Scripts/python.exe' tmp/validate_professional_plan.py
```

Before that gate exists, source-hash mismatches for changed shared P02–P05 implementation are expected and must not be erased by editing historical evidence. `tmp/build_p06_acceptance_draft.py` writes only a false/pending template in `tmp/p06-acceptance-draft.json`; its `candidate_sources()` must be rerun after every final source/document/evidence edit. P06 requires a real hash-bound P05 compatibility log, all eight task evidence paths with current hashes, browser/review flags exactly true, and all earlier accepted gates/proofs intact. The public chart guide may advance under its explicit current-document exception; historical package prose/evidence/helpers remain strict. P07–P22 remain unchecked.

The gate-only finalizer has been prepared and statically checked without execution. Root alone may run it after reviewing all final evidence and completing root-owned plan edits:

```powershell
& '.venv/Scripts/python.exe' tmp/accept_p06.py --accept-reviewed-p06
```

It requires finalized package evidence logs, parses actual test counts, binds every task/proof to current hashes and writes only `p06/P06_ACCEPTANCE.json`. It never changes plans, checkboxes, historical evidence or copied logs. If root deliberately changes reviewed artifacts after writing the gate, an explicit `--refresh-existing` is required to recompute it before the final validator.

## Original-screen acceptance

Root used the isolated P06 fixture and the real in-app browser to verify and accept preparation, next-event fills, partial/final exit, journal and report return, exact restart, independent branch/comparison, multi-pane acknowledged availability and complete source/account recovery. Final corrected book labels, report samples and actual selected-book chart navigation were accepted after the last build. [Browser journeys](BROWSER_ACCEPTANCE.md), [independent review](INDEPENDENT_REVIEW.md) and [read-only main-app smoke](evidence/main-app-smoke.json) retain the proof. The architecture HTML was rendered through the browser and its PNG inspected by root. No screenshot or unit test substitutes for an unverified journey, and this document changes no gate/checklist.
