# P04 reproducible verification commands

Run from the repository root on the recorded Windows/Python environment unless stated otherwise. Test data is isolated under workspace `tmp`; no provider credential or live endpoint is required. Counts and limits are in [acceptance evidence](IMPLEMENTATION_EVIDENCE.md).

```powershell
$env:LOG_FORMAT='[%(levelname)s] %(message)s'
$env:TEMP=(Resolve-Path tmp).Path
$env:TMP=$env:TEMP
.venv/Scripts/python.exe -m pytest `
  test/test_domain_contracts.py test/test_domain_legacy.py `
  test/test_domain_repository.py test/test_domain_backup.py `
  test/test_local_account_access.py test/test_user_identity_migration.py `
  test/test_local_data_api.py test/test_workspace_storage.py `
  test/test_workspace_recovery.py test/test_workspace_worker.py `
  test/test_navigation_update.py test/test_retired_features.py `
  test/test_flow_workflow_validator.py test/test_flow_lifecycle_guards.py `
  test/test_custom_indicators_cache.py test/test_journal_import.py `
  test/test_journal_service.py test/test_journal_api.py `
  test/test_journal_recovery.py test/test_journal_metrics_review.py `
  test/test_journal_review_findings.py test/test_journal_final_review.py `
  test/test_journal_resource_audit.py test/test_dataset_quality.py `
  test/test_data_library.py test/test_data_library_api.py `
  test/test_dataset_downloads.py test/test_dataset_provider.py `
  test/test_data_library_review.py test/test_data_library_resources.py `
  test/test_data_library_restore_links.py test/test_historify_custom_timeframes.py `
  test/test_historify_id_sequences.py test/test_history_service_source_validation.py `
  -q -s --disable-warnings --basetemp=tmp/p04-final-backend-run-1
```

The accepted full run collected 1,008 tests before four additional malformed-return cases were added. The current follow-up ran:

```powershell
.venv/Scripts/python.exe -m pytest test/test_data_library_api.py `
  test/test_local_account_access.py test/test_data_library.py `
  test/test_data_library_restore_links.py -q -s --disable-warnings `
  --basetemp=tmp/p04-final-followup-run-1
.venv/Scripts/python.exe contracts/generate_types.py --check
.venv/Scripts/python.exe tmp/test_p04_plan_gate.py
```

Use a new literal `--basetemp` directory if reproducing on the same machine; never delete an unchecked computed directory. The recorded backend follow-up passed 66 tests. Formatting after those runs changed whitespace/import ordering only.

Frontend commands ran from `frontend`, using the installed supported Node binary:

```powershell
New-Item -ItemType Directory -Path '../tmp/p04-vitest-temp' -Force | Out-Null
$env:TEMP=(Resolve-Path '../tmp/p04-vitest-temp').Path
$env:TMP=$env:TEMP
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vitest/vitest.mjs run src/lib/trader src/pages/workspace src/pages/settings src/lib/domain src/components/layout src/pages/Login.local.test.tsx src/pages/HistorifyCharts.test.ts src/lib/historify src/lib/chart/feeds src/pages/historify src/api/dataLibrary.test.ts src/hooks/useChartWorkspaceCatalog.test.ts src/components/chart/ChartlyChart.test.tsx
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vitest/vitest.mjs run src/pages/workspace src/lib/trader/profileSetup.test.ts
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/typescript/bin/tsc -b
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/vite/bin/vite.js build
& '../tmp/p01-node/node_modules/node-win-x64/bin/node.exe' node_modules/@biomejs/biome/bin/biome check src/api/dataLibrary.ts src/lib/historify/dataLibraryDrafts.ts src/lib/historify/dataLibraryNavigation.ts src/lib/chart/feeds/datasetVersionFeed.ts src/pages/historify/DataLibrary.tsx src/pages/historify/DataLibraryImport.tsx src/pages/historify/DataLibraryRecovery.tsx src/pages/historify/DatasetVersionChart.tsx src/components/historify/HistorifyChartPane.tsx src/components/chart/ChartlyChart.tsx src/pages/workspace/TraderReplay.tsx src/components/layout/FullWidthLayout.tsx src/pages/Login.tsx
```

The follow-up's explicit `profileSetup.test.ts` path matched no additional file; its 52 tests belong to the eight Workspace suites. The broader command passed 445 tests in 43 suites. The label-only `TraderWorkspace.tsx` follow-up preserves its existing formatting and was not whole-file reformatted under the scoped Biome check.

P00 regression from root:

```powershell
tmp/p01-node/node_modules/node-win-x64/bin/node.exe --test docs/plans/chartly-professional-platform/p00/workflow.test.mjs docs/plans/chartly-professional-platform/p00/p00-review.test.mjs docs/plans/chartly-professional-platform/p00/dist/model.test.mjs docs/plans/chartly-professional-platform/p00/dist/chartData.test.mjs
```

This covered 84 tests. Current source hashes and the full compatibility log are checked by `.venv/Scripts/python.exe tmp/validate_professional_plan.py`. The final gate is created only after the isolated browser journeys, source checks and documentation are accepted.
