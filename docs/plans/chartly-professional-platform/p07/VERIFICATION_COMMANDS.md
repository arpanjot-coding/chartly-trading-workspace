# P07 reproducible verification

3 November 2026. Run from the repository root unless `frontend` is specified. Use isolated synthetic databases and a fresh literal pytest temporary directory for another full run. The regular test selection needs no private broker credentials or live terminal access. Actual authorized MT5 observations are recorded separately in the adapter evidence, with no login/order calls. [Final results and acceptance evidence](IMPLEMENTATION_EVIDENCE.md).

## Full backend compatibility

```powershell
$env:LOG_FORMAT='[%(levelname)s] %(message)s'
$env:TEMP=(Resolve-Path tmp).Path
$env:TMP=$env:TEMP
& '.venv/Scripts/python.exe' tmp/run_p07_backend.py
```

[The runner](../../../../tmp/run_p07_backend.py) preserves the frozen 51-file P06 selection and adds all thirteen connector suites, refuses duplicate names and uses an explicit process timeout. Final result: **1,503 tests across 64 files, one warning, 446.08 seconds**. [Durable output](evidence/compatibility-regression.log). The test set includes the authoritative required-history creation/transition guard, actual API refusal, disabled observed-account field and preserved legacy migration/restore behavior. All thirteen connector modules are registered once in the Python 3.12/3.13/3.14 CI matrix. Optional [MT5 SDK requirements](../../../../requirements-mt5.txt) remain separate from mocked ordinary CI; actual native reads use the authorized adapter prerequisites.

Targeted checks overlap the full result: [187 native/history review cases](evidence/adapter-review.log), [39 independent ownership/security cases](evidence/backend-independent-followup.log), [one POST/four-GET principal case](evidence/backend-owner-header-followup.log), [30 final history-authority cases](evidence/history-required-focused.log) and [33 paper fixture compatibility cases](evidence/paper-fixture-followup.log). The [failed fixture reproduction](evidence/required-history-fixture-reproduction.log) remains archived; the guard was retained and only the fixture's exact source pin was corrected. Counts are not summed as unique tests.

For an affected connector-only rerun, choose a fresh literal directory:

```powershell
$p07ConnectorTests = Get-ChildItem -LiteralPath test -Filter test_connector*.py -File | ForEach-Object { 'test/' + $_.Name }
& '.venv/Scripts/python.exe' -m pytest @p07ConnectorTests -q -s --disable-warnings --timeout=180 --basetemp=tmp/p07-connector-followup-new-run
```

The 39-test independent command used service review, connector API and local-account access; the single principal case is reproducible as follows:

```powershell
& '.venv/Scripts/python.exe' -m pytest test/test_connector_service_review.py test/test_connector_api.py test/test_local_account_access.py -q -s --basetemp=tmp/p07-independent-review-new-run
& '.venv/Scripts/python.exe' -m pytest test/test_connector_api.py::test_explicit_principal_precondition_prevents_delayed_save_under_new_cookie -q -s --basetemp=tmp/p07-owner-header-new-run
```

These are reproduction commands, not additional results. The current complete run controls final backend acceptance.

## Frozen frontend and copy-only follow-up

From `frontend`, use supported Node 22.23.4:

```powershell
$env:TEMP=(Resolve-Path ../tmp).Path
$env:TMP=$env:TEMP
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vitest/vitest.mjs run src/lib/trading src/components/trading src/hooks/useChartWorkspaceCatalog.test.tsx src/hooks/useDatasetChartSource.test.ts src/hooks/useResolvedChartContext.test.ts src/hooks/usePaperSession.test.ts src/hooks/usePaperSession.review.test.ts src/hooks/useConnections.test.tsx src/pages/Trading.test.tsx src/pages/Trading.paper.test.tsx src/pages/workspace src/lib/trader src/pages/settings src/lib/domain src/components/layout src/components/connections src/lib/historify src/lib/chart/feeds src/pages/historify src/api/dataLibrary.test.ts src/pages/Login.local.test.tsx src/pages/HistorifyCharts.test.ts src/components/chart/ChartlyChart.test.tsx
```

Final result: **2,419 tests/220 suites in 76.96 seconds**, [durable output](evidence/frontend-regression.log). The source run is `tmp/p07-timestamp-frontend-regression.log`; it includes all cookie-owner, IndexedDB/CSRF, native-case, journal-copy, dialog completion and receipt-time disclosure changes. No UI source changed after it began.

The final focused transport/hook/panel selection passed **25 tests/three suites in 6.87 seconds**, overlapping the full union:

```powershell
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vitest/vitest.mjs run src/lib/trader/connectorClient.test.ts src/hooks/useConnections.test.tsx src/components/connections/ConnectorPanel.test.tsx
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/typescript/bin/tsc -b
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vite/bin/vite.js build
```

[Focused output](evidence/frontend-timestamp-followup.log), [final types](evidence/frontend-types.log), [final build](evidence/frontend-build.log). The build completed in **2.09 seconds**. The final **23-file Biome check passed with no fixes**:

```powershell
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/@biomejs/biome/bin/biome check src/components/connections/ConnectorPanel.tsx src/components/connections/ConnectorPanel.test.tsx src/hooks/useConnections.ts src/hooks/useConnections.test.tsx src/lib/trader/connectorClient.ts src/lib/trader/connectorClient.test.ts src/lib/trader/paperCash.ts src/lib/trader/db.ts src/lib/trader/useTraderData.ts src/pages/workspace/TraderWorkspace.tsx src/pages/workspace/TraderWorkspace.creation.test.tsx src/pages/workspace/TraderProfileDetail.tsx src/pages/workspace/TraderReplay.tsx src/pages/workspace/TraderReplay.dataset.test.tsx src/pages/workspace/TraderConnections.tsx src/pages/settings/ConnectionsData.tsx src/pages/Trading.tsx src/pages/Trading.paper.test.tsx src/lib/trader/localStorageClient.ts src/lib/trader/localStorageClient.test.ts src/lib/trader/dataPersistence.ts src/lib/trader/dataPersistence.test.ts src/pages/workspace/TraderJournal.tsx
```

[Durable lint output](evidence/frontend-biome.log). Original source log names are `tmp/p07-ui-timestamp-{tests,types,biome,build}.log`. Earlier 19/21/31-case follow-ups are retained as overlapping evidence, not extra unique totals. Existing chunk/Plot2D and jsdom canvas warnings are retained. Root's actual original-screen pass supplies rendering/workflow evidence.

## Python static scope, schemas and preserved design

Exact lists are `tmp/p07-python-new-scope.txt` (**29 files: eleven production, thirteen tests, five gate/doc helpers**) and `tmp/p07-python-check-scope.txt` (**40 new/shared files**, including the changed local API and paper-session fixture tests):

```powershell
$p07NewPython = Get-Content -LiteralPath tmp/p07-python-new-scope.txt
$p07AllPython = Get-Content -LiteralPath tmp/p07-python-check-scope.txt
& 'tmp/p01-format-tools/bin/ruff.exe' check @p07NewPython
& 'tmp/p01-format-tools/bin/ruff.exe' format --check @p07NewPython
& '.venv/Scripts/python.exe' -m py_compile @p07AllPython
& '.venv/Scripts/python.exe' contracts/generate_types.py --check
& 'tmp/p01-node/node_modules/node-win-x64/bin/node.exe' --test docs/plans/chartly-professional-platform/p00/workflow.test.mjs docs/plans/chartly-professional-platform/p00/p00-review.test.mjs docs/plans/chartly-professional-platform/p00/dist/model.test.mjs docs/plans/chartly-professional-platform/p00/dist/chartData.test.mjs
& '.venv/Scripts/python.exe' tmp/test_p07_plan_gate.py
```

Recorded results: [29-file new-code lint/format](evidence/python-new.log), [40-file compile](evidence/python-compile.log), [canonical declarations](evidence/contract-check.log), [84 P00 tests](evidence/p00-regression.log), and [104 P07 forward-gate cases](evidence/plan-gate-tests.log) pass. Durable [new-code scope](evidence/python-new-scope.txt) and [compile scope](evidence/python-compile-scope.txt) retain exact paths. Shared application code received no unrelated formatting; the forward harness uses virtual synthetic acceptance and writes no real gate. Eight current fixture/runner/smoke scripts also [pass lint/compile](evidence/fixture-helper-checks.log) without execution during documentation checks.

## Final documentation and root publication

Root accepted the [browser workflows](BROWSER_ACCEPTANCE.md), [independent review](INDEPENDENT_REVIEW.md), actual diagram PNG and read-only main-app boundary checks. Recovery is evidenced by scoped SQL/API tests; no browser file-chooser restore is claimed. The read-only link checker covers the 24 root plans, every P07 Markdown file including adapter subplans, public API index/reference and chart/connections guides:

```powershell
& '.venv/Scripts/python.exe' tmp/p07_doc_links.py
```

[Durable audit output](evidence/doc-link-audit.log). It validates local targets and workspace bounds without fetching external URLs. The optional `X-Chartly-Principal` header is an expected-cookie-owner precondition, never an identity selector or a substitute for authentication/CSRF.

`tmp/build_p07_acceptance_draft.py` writes only false/pending metadata to `tmp/p07-acceptance-draft.json`. Root recomputes its dynamic `candidate_sources()` after every writer freezes. The statically checked gate-only finalizer has not been executed by this documentation agent. Root alone may invoke it after its plan/checklist acceptance:

```powershell
& '.venv/Scripts/python.exe' tmp/accept_p07.py --accept-reviewed-p07
& '.venv/Scripts/python.exe' tmp/validate_professional_plan.py
```

The writer requires finalized package logs/docs/access artifacts, a completed UTF-8 full P06/P07 log at most 16 MiB, current proof/artifact hashes and actual original-screen images. It writes only the P07 gate, preserving plans, copied logs and historical P00–P06 evidence. Deliberate later reviewed changes require `--refresh-existing` and another final validator pass. P08–P22 remain open.
