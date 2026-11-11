# Audit 10 — Open-source and local-first maintenance readiness

Reviewed 2 November 2026. Read-only source inspection of this checkout, not a public-upstream audit, legal opinion or security certification. No application code, credentials or user data changed. No additional tests were run by this reviewer.

## Assessment

The app has serious maintenance foundations: pinned dependency manifests, multi-version CI, frontend tests/builds, backend smoke checks, Docker persistence and detailed subsystem documentation. The free local journal/chart/replay product needs a smaller, tested entry path and clearer release contract. Current installation, storage, documentation and integration boundaries still reflect a larger broker-automation server.

## Five priority findings

### 1. This checkout does not establish a complete open-source distribution contract

The root directory contains no LICENSE, README, CONTRIBUTING or SECURITY file. This is an absence observed in this supplied checkout, not proof that upstream lacks them. `pyproject.toml:1–5` defines project identity and Python requirement but no project license declaration. The frontend uses registry aliases `chartly-charts` → `openalgo-charts@2.6.7` and `chartly-script` → `openalgo-script@0.8.1` (`frontend/package.json:55–57`); the installed packages declare Apache-2.0 in their manifests. Those dependency declarations do not define the license of the host application or replace the need to preserve applicable notices.

Before distributing: provide an authoritative host-app license, attribution/notices inventory, contribution instructions, support scope and vulnerability-reporting contact; verify the actual distribution contents and retained notices. Avoid presenting rename/alias work as ownership of upstream components. Retain the dependency version/integrity information already in `frontend/package-lock.json:6900–6913`.

### 2. Installation guidance does not lead the local no-broker user to first value

`install/README.md:7–15` lists Linux prerequisites, `:17` labels domain/DNS setup required and `:42` labels broker setup required. The download examples around `:64–76` contain bare `wget` and `curl -O` without a URL. These instructions are unsuitable as the front door for a Windows journal user with a CSV and no broker. This does not mean all installation documentation is cloud-only: `DOCKER_README.md` includes Windows instructions and loopback endpoints. The problem is fragmented entry guidance and required-versus-optional scope.

The parent observed that noninteractive `.venv/Scripts/python.exe app.py` raised the Werkzeug production guard, while starting it with a PTY served successfully. The source launch is `app.py:1088–1090`, `:1245`. Treat this as a documented local-launch requirement to resolve, not a reason to weaken production guards. Provide one supported Windows/local launcher, a local Docker route, an optional development route and a separate server deployment guide. Local start must not imply that broker connectivity, MT5 or native bridges have been verified.

Acceptance: a clean supported Windows machine can install, start, stop and reopen the app; add/import journal records; import a historical dataset; and preserve work without a domain, Cloudflare account or broker credentials. Record tested OS/runtime versions and known limitations.

### 3. “Back up the app” is currently several different storage tasks

The journal uses browser IndexedDB (`frontend/src/lib/trader/db.ts:209`) while `.sample.env:54–61` declares multiple SQLite files plus Historify DuckDB. `docker-compose.yaml:14–20` persists backend db/log/strategy/key/tmp paths in volumes, but that cannot back up the browser journal. `frontend/src/pages/workspace/TraderJournal.tsx:321–363` exports selected CSV columns, not full journal/profile/review state. Existing chart workspace import/export is another separate mechanism.

A credible local-first release needs a storage inventory visible to the user and one complete, versioned recovery workflow. Define what is browser-local versus backend-local, which host/port/browser identity owns it, and how to move between machines or browsers. An update must not silently appear to erase a journal because the app origin changed. Back up database relations, chart state, profiles, attachments, practice checkpoints and dataset provenance; keep secrets appropriately separated. Test restore into a clean installation, not only creation of an archive.

### 4. CI breadth is stronger than current product-journey assurance

CI has backend tests across Python 3.12–3.14 (`.github/workflows/ci.yml:37` onward), real server boot smoke stages, frontend build on supported Node majors (`:362` onward), frontend unit/coverage tests (`:388–411`) and Chromium E2E (`:417–437`). Preserve these strengths. Backend lint/format steps are advisory via `continue-on-error` (`:30`, `:33`), as are security-scan commands (`:452`, `:455`), so green CI must not be described as every finding being resolved.

The E2E harness starts Vite only (`frontend/playwright.config.ts:64–70`), whose API/auth routes proxy to localhost:5000 (`frontend/vite.config.ts:35–54`). The E2E CI job shown installs npm/browser and runs tests but does not start the Flask backend in that job. Some tests accept minimal body visibility or conditionally skip a login action if absent (`frontend/e2e/home.spec.ts:6–35`); navigation tests can accept the login form rather than the authenticated destination (`frontend/e2e/navigation.spec.ts:25–58`). These are useful smoke checks but cannot establish import → chart → replay → journal → restore behavior.

Add deterministic full-stack fixtures and a few decisive journeys: fresh no-broker user, journal edit/import/deduplication, local-history access, replay resume and automatic journaling, backup/restore, and execution isolation. Keep live broker certification separate from normal CI and require sandbox/adapter contract fixtures for connector releases. Parent/specialist unit passes remain scoped evidence, not general product certification.

### 5. Dependency and documentation boundaries need an owned capability matrix

`frontend/vendor/README.md:3` describes chart dependency 2.4.5, while the manifest/lock/install resolve 2.6.7. The vendor document correctly warns that package availability does not imply every host control is integrated (`:14–17`); preserve that distinction but generate version/capability references from the shipped build. The frontend also includes a local `chartly: file:..` dependency (`frontend/package.json:55`) and both frontend and Python components participate in the strategy-language stack. These cross-runtime and vendor boundaries need explicit compatibility/upgrade ownership.

Keep a small capability matrix identifying each surface as implemented, configuration-only, experimental or connector-dependent; distinguish upstream engine support from Chartly host integration. Include version compatibility, supported account/asset classes, dataset requirements, how to reproduce regressions and who owns each adapter. Use the current report's findings to replace architecture promises with demonstrable supported paths. No market-size, platform availability or regulatory claim in architecture prose should substitute for current vendor evidence or specialist advice.

## Maintenance strategy

Maintain a stable local core: normalized journal, durable data/run models, read-only chart sources, simulator, import/export/recovery and a small number of complete journeys. Treat broker adapters, automation, options labs and terminal bridges as capability-scoped extensions. Preserve advanced work rather than deleting it, but avoid forcing every new user and contributor to understand it before improving the journal. Each connector multiplies auth, symbol, unit, market-hours, restart and order-state cases; increase coverage only after the contract is testable.

## Release gates for the free core

- Distribution includes a clear host license, applicable notices and reproducible versioned source/build instructions.
- A clean local supported installation reaches journal and imported-history charting without a paid provider or execution broker.
- Journal corrections, imports and recovery preserve IDs, notes, provenance and relationships.
- Dataset versions and replay assumptions make results reproducible; replay orders cannot reach real broker routes.
- A saved run resumes after process/browser restart and automatically produces a reviewable journal record.
- Update/migration and complete restore are exercised on a clean machine/profile.
- Docs identify supported, incomplete and experimental functions accurately; configuration state never claims actual connectivity.
- Startup/stop, local storage, resource limits and failure recovery have actionable user-facing states rather than requiring log archaeology.

These gates describe observable behavior, not a request to delay local reversible development or add approval bureaucracy. No release timeline is estimated here.
