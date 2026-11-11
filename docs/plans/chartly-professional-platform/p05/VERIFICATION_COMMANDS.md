# P05 reproducible verification

3 November 2026. Run from the repository root unless a section specifies `frontend`. These checks use synthetic, isolated local records. No broker login, live order or installed-user migration is needed. Use a fresh literal pytest `--basetemp` directory on repeated runs.

## Backend integration

```powershell
$env:LOG_FORMAT='[%(levelname)s] %(message)s'
$env:TEMP=(Resolve-Path tmp).Path
$env:TMP=$env:TEMP
.venv/Scripts/python.exe tmp/run_p05_backend.py
```

The helper records all 39 test files and the exact command. The integrated run passed **1,071 tests**. Its full output is retained in `evidence/compatibility-regression.log`. Two later validation cases—UTF-8 metadata budgeting and refusing first dataset binding on legacy runs that already have trades—were verified by this affected follow-up, **58 passing tests**, overlapping the integration run:

```powershell
.venv/Scripts/python.exe -m pytest test/test_chart_context.py test/test_chart_evidence.py test/test_data_library_restore_links.py -q -s --disable-warnings --basetemp=tmp/p05-final-binding-followup-run-1
.venv/Scripts/python.exe contracts/generate_types.py --check
```

The five new P05 suites are registered in the existing Python 3.12/3.13/3.14 CI job. Local execution used Python 3.14.7 on Windows; remote CI is not implied.

## Frontend integration and reviewed follow-ups

From `frontend`, use the installed supported Node 22.23.4 binary. Set `TEMP`/`TMP` to the existing workspace `../tmp` directory if the default sandbox temporary directory is unavailable.

```powershell
$env:TEMP=(Resolve-Path ../tmp).Path
$env:TMP=$env:TEMP
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vitest/vitest.mjs run src/lib/trading src/components/trading src/hooks/useChartWorkspaceCatalog.test.tsx src/hooks/useDatasetChartSource.test.ts src/pages/Trading.test.tsx src/pages/workspace src/lib/trader src/pages/settings src/lib/domain src/components/layout src/lib/historify src/lib/chart/feeds src/pages/historify src/api/dataLibrary.test.ts src/pages/Login.local.test.tsx src/pages/HistorifyCharts.test.ts src/components/chart/ChartlyChart.test.tsx
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/typescript/bin/tsc -b
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vite/bin/vite.js build
```

The broad integrated run passed **2,262 tests in 201 suites** before browser/review follow-ups. Final affected commands and results are recorded in [implementation evidence](IMPLEMENTATION_EVIDENCE.md); overlapping runs must not be summed into a fabricated unique total. jsdom's canvas warnings are not rendering proof; actual browser screenshots cover the original chart.

The recorded-chart, timezone, preference-race and original workflow follow-up command is:

```powershell
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vitest/vitest.mjs run src/lib/trading/recordedChartContext.test.ts src/lib/trading/replayClock.test.ts src/components/trading/WorkspaceReplayBar.test.tsx src/pages/Trading.test.tsx src/lib/trader/dataPersistence.test.ts src/lib/trader/chartEvidence.test.ts src/components/trading/ChartEvidenceList.test.tsx src/hooks/useResolvedChartContext.test.ts src/lib/trading/chartContext.test.ts src/lib/trading/chartContext.review.test.ts
```

For the direct journal panel/receipt/recovery seam:

```powershell
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vitest/vitest.mjs run src/lib/trader/chartEvidence.test.ts src/lib/trader/journalClient.test.ts src/lib/trader/dataPersistence.test.ts src/components/trading/ChartEvidenceList.test.tsx src/components/trading/JournalPanel.test.tsx src/components/trading/RightRail.test.tsx src/pages/workspace/JournalSeparation.test.tsx src/pages/workspace/JournalLifecycle.test.tsx src/pages/workspace/JournalOperations.test.tsx src/lib/trader/dataPersistence.indexeddb.test.ts src/lib/trading/chartContext.review.test.ts src/lib/trading/recordedChartContext.test.ts
```

The paused-hydration regression passed 64 tests across five suites:

```powershell
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vitest/vitest.mjs run src/hooks/useWorkspaceAutosave.test.tsx src/pages/Trading.test.tsx src/hooks/useResolvedChartContext.test.ts src/lib/trading/recordedChartContext.test.ts src/lib/trading/workspaceReplay.test.ts
```

Ruff format/check covers the changed Python services, journal blueprint and five P05 tests. Scoped Biome covers changed chart/context/source/panel/persistence production files and new tests. Original large journal files received additive edits without unrelated whole-file formatting. The logs identify the exact checked paths and outcomes.

## Plan and preserved design checks

```powershell
tmp/p01-node/node_modules/node-win-x64/bin/node.exe --test docs/plans/chartly-professional-platform/p00/workflow.test.mjs docs/plans/chartly-professional-platform/p00/p00-review.test.mjs docs/plans/chartly-professional-platform/p00/dist/model.test.mjs docs/plans/chartly-professional-platform/p00/dist/chartData.test.mjs
.venv/Scripts/python.exe tmp/test_p05_plan_gate.py
.venv/Scripts/python.exe tmp/validate_professional_plan.py
```

P00 regression passed **84 tests**. The forward gate harness passed **53 cases**, including rejects for fabricated completion, missing evidence, changed historical packages and checked future tasks. The acceptance validator verifies P00–P05 evidence and current source hashes; P06–P22 remain open. The historical P04 gate harness also passed its **25 cases** unchanged.

## Actual original-screen acceptance

See [browser journeys](BROWSER_ACCEPTANCE.md). The fixture server and helper use only `tmp/p05-ui-fixture`; its two disposable owners, data and password are synthetic. The evidence includes direct PNG capture to the actual journal, source change and recorded return, separate profiles, four-pane/drawing reload, replay availability, large native history and explicit restored-namespace recovery. The fixture is stopped after acceptance. Private state is not inferred from a screenshot alone: server tests cover CAS, scope, hashes, atomic rollback and recovery bytes.
