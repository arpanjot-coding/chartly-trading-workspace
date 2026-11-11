# Tools retirement and section organization

Subsequent correction: the temporary Strategy Builder launcher was rejected and removed. The [dedicated Indicator/Strategy workflow review](STRATEGY_BUILDER_GAP_REVIEW.md) supersedes its entry-point design below. Historical retirement/test evidence remains valid for that earlier slice; the new builder is not implemented.

Status: implemented and verified, 2 November 2026. User-confirmed removal scope: keep Flow and reusable strategy/indicator engines; retire the Tools directory and specialist options/legacy features.

## Concrete changes

- Remove the generic Tools page/registry and specialist options/region-specific pages, their exclusive frontend dependencies, dedicated backend blueprints and SIP REST namespace. Keep shared chart/strategy/automation APIs and reusable calculation/rendering modules where retained runtime source still imports them.
- Preserve Flow, Python strategy hosting, guided strategy runtime, original chart/indicators/scripts/backtest engine, Historify and journal data. Preserve all database files and saved account/workflow/strategy records; retirement is not data deletion.
- Create a Strategy Builder entry point using the existing card components to reach retained chart scripting, Python, managed strategies and portfolio backtesting. It is a development entry point, not a claim that versioned projects, unified testing or deployment contracts are complete.
- Rename the Flow navigation label to Workflows. Use Workspace / Workflows / Strategy Builder as currently functional primary sections. Fundamentals remains a separate planned development section; no empty research shell is marked implemented.
- Old specialist pages receive an explicit retirement response; old API endpoints return 410 instead of invoking retired code. The former Tools directory redirects to the new Strategy Builder entry point.
- Before removal, generate a source/dependency manifest and a checked local ZIP containing removed source and modified registration files. Verify all resolved removal paths remain inside this workspace. Do not recursively delete directories or touch database/user data.

## Verification required

TypeScript/build and retained module tests; navbar/Strategy Builder destinations; Combined Analysis/journal regression tests; Python syntax/dependency checks; Flask retirement route tests; live original-app walkthrough after build/restart. Run focused backend tests for retained engines and shared calculations as appropriate. Record any server-restart limitation explicitly; source removal alone does not prove old in-memory endpoints are gone.

The manifest records the exact removed source, retained shared modules and recovery archive hash. This bounded retirement does not complete P00, the full Strategy Builder or Fundamentals.

## Completion evidence

- [x] Tools directory/registry, 18 specialist page routes plus two old options-builder aliases, 13 dedicated backend blueprints, their exclusive dependencies and the SIP namespace were retired. The source manifest lists 113 removed source files, plus seven archived SIP-only test files.
- [x] Shared chart/Flow/strategy dependencies were retained through a conservative dependency walk. In particular generic option chain/Greeks APIs, chart-side option selection, reusable payoff rendering, strategy runtime/Python hosting and existing AI calculation dependencies remain. A small historical-tenor helper was relocated from the removed IV-chart service to the shared Greeks module, preserving its timezone contract tests.
- [x] Local recovery archive verified with ZIP CRC checks; its current SHA-256 and exact removed/retained paths are in [RETIREMENT_MANIFEST.json](RETIREMENT_MANIFEST.json). [Source recovery ZIP](retirement-source-recovery.zip) contains source, not a database backup. No database file/table or account/journal/workflow record was deleted.
- [x] 393 backend tests passed: retirement routing (410 responses rather than executing old APIs), retained routes, expiry/timezone math, Flow validator/lifecycle guards and custom indicator caching. Tests use the existing isolated-database harness. The successful command sets a valid test-only logging format and a workspace temp directory because the host's default log format/temp permissions prevented initial setup. A pytest-cache warning remained; tests passed.
- [x] 97 frontend tests passed, including navigation, the retained Strategy Builder entry point, original journal, selected-only Combined Analysis, chart-side option selection and chart backtesting. Production build passed; existing asset/chunk warnings remain.
- [x] Runtime import scan found no retained backend module importing a removed module. Backend source parsed successfully. The verified local workspace app was restarted to apply backend registration changes; its original environment was retained in memory without writing secrets to a file.
- [x] Browser verification after restart: new Strategy Builder entry reached existing chart/Python/managed/portfolio-test destinations; Workflows retained the existing saved Flow workflow with no execution; `/ivchart` showed retirement; `/tools` redirected to `/strategy-builder`; Combined Analysis saved/reloaded correctly.

Commands: frontend tests are listed in the Combined Analysis evidence; backend:

```powershell
$env:LOG_FORMAT='%(levelname)s: %(message)s'
.\.venv\Scripts\python.exe -m pytest test/test_retired_features.py test/test_react_workspace_routes.py test/test_option_expiry_timezone_contract.py test/test_flow_workflow_validator.py test/test_flow_lifecycle_guards.py test/test_custom_indicators_cache.py -q --tb=line --basetemp=tmp/pytest-retirement-01
```

Current functional navigation is Workspace / Workflows / Strategy Builder. Strategy Builder is an entry point to reused engines, not a completed unified author/test/deploy product. Fundamentals still requires its own detailed implementation plan and provider-backed functionality; no empty Fundamentals shell was marked complete. P00 remains open.
