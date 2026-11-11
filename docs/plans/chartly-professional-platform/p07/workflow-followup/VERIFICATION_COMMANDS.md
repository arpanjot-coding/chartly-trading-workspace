# Reproducible follow-up checks

3 November 2026. Commands run from the repository root unless frontend is specified. Disposable test data never replaces the installed app databases. A new pytest run needs a fresh literal basetemp beneath `tmp`.

The exact 68-module backend runner preserves the original P07 selection of 64 modules and adds personal workspace, independent personal review, Kraken decoding/transport and Kraken API tests. The original proof log remains unchanged. The final current-source run uses:

```powershell
& '.venv/Scripts/python.exe' tmp/run_connection_workflow_backend.py --basetemp=tmp/connection-workflow-backend-run-4
```

Final result: **1,581 passed, one warning, 68 modules, 408.22 seconds**. [Final proof](evidence/compatibility-regression.log). The first integrated run passed 1,566 cases before the calendar regressions were added; a second passed 1,568 before the additional named-account regressions. Both remain separately archived. Run 3 was interrupted by the stopped session; it is not acceptance proof. No earlier output is substituted for the final run.

The frontend union preserves the original chart/journal/paper/local-data/connection selection and includes the new personal-auth, developer-context/page and actual App route suites. **2,495 tests / 230 suites passed in 79.78 seconds**. [Exact commands](evidence/frontend-verification-command.txt), [full output](evidence/frontend-regression.log), [50-file lint scope](evidence/frontend-biome-scope.txt). Final TypeScript and Biome pass; production build passed in **1.77 seconds**. Only two Historify whitespace corrections followed the full test run; final lint/types/build were repeated, with no behavior change.

Root checks canonical contracts and the accepted P00 workflow models:

```powershell
& '.venv/Scripts/python.exe' contracts/generate_types.py --check
& 'tmp/p01-node/node_modules/node-win-x64/bin/node.exe' --test docs/plans/chartly-professional-platform/p00/workflow.test.mjs docs/plans/chartly-professional-platform/p00/p00-review.test.mjs docs/plans/chartly-professional-platform/p00/dist/model.test.mjs docs/plans/chartly-professional-platform/p00/dist/chartData.test.mjs
& '.venv/Scripts/python.exe' tmp/compile_connection_workflow.py
& '.venv/Scripts/python.exe' tmp/audit_personal_resources.py
& '.venv/Scripts/python.exe' tmp/connection_workflow_main_smoke.py
```

The resource command measures actual native handles and SQL checkouts/checkins against disposable fixtures. [Measurement](evidence/personal-resources.json). Python static checks apply to the explicit new/changed follow-up scope, with compilation of the shared source surface; legacy files receive no unrelated formatter changes. Frontend TypeScript, affected-files Biome and production build run against the final UI. Existing jsdom canvas, Plot2D dynamic-import and large-chunk build warnings remain visible in the logs; actual browser charts supplied rendering evidence.

The new forward-gate harness exercises the expanded full-test selection, archive/hash preservation, follow-up completion and valid actual evidence. It does not write real acceptance or tick checkboxes:

```powershell
& '.venv/Scripts/python.exe' tmp/test_connection_workflow_gate.py
& '.venv/Scripts/python.exe' tmp/test_p07_plan_gate.py
& '.venv/Scripts/python.exe' tmp/p07_doc_links.py
```

Only root may refresh the existing P07 gate after actual integrated acceptance:

```powershell
& '.venv/Scripts/python.exe' tmp/accept_connection_workflow.py --accept-reviewed-connection-workflow --refresh-existing
& '.venv/Scripts/python.exe' tmp/validate_professional_plan.py
```

P00–P06 historical proofs and the initial P07 acceptance/logs remain unchanged. P08–P22 remain open; this workflow repair does not replace their provider and execution work.
