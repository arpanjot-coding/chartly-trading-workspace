# P19 — Release readiness record

Compiled 4 November 2026 from the actual checkout.

## Provenance and guidance (T01)

- Project: `chartly` 2.0.2.9 (`pyproject.toml`), OpenAlgo-heritage
  local trading platform, maintained in this checkout.
- **Licence gap:** no `LICENSE` file exists at the repository root.
  Distribution must not proceed until the owner adds the licence and
  third-party notices — recorded here, not papered over. Contributor/
  security guidance rides the existing `.github` (dependabot,
  security workflow); a `SECURITY.md` is still owed with the licence.

## Launch paths (T02)

Existing and documented: `start.sh`, Docker (`Dockerfile`,
`docker-compose.yaml`, `DOCKER_README.md`, docker-build scripts),
local dev via `uv sync` + `npm --prefix frontend ci`. First-run
value (local account → workspace → journal/chart/practice) needs no
cloud or broker (proven by every API suite here running brokerless).

## Test harness (T03/T04)

- Backend: pytest suites per package with deterministic fixtures
  (fake EDGAR/BLS/Kraken/Alpaca/MT5 transports), isolated SQLite per
  test via `--basetemp` + tmp engines. New programme suites added to
  `.github/workflows/ci.yml` CI-safe list (2026-11-04).
- Failure injection in place: dispatch timeout→unknown, duplicate
  callbacks/idempotent retries, identity-change refusal, interrupted
  pagination checkpoints, restore round-trips (P22), workspace
  recovery suites (pre-existing).
- Frontend: Vitest + Testing Library journeys by role/label; Biome
  lint (incl. a11y rules) on touched files; production build green.
- The real-server gthread smoke already exists in CI.

## Performance budgets (T05)

Reference: this Windows dev machine (Python 3.14.7, Node 24.19).
Budgets (CI-enforced where noted): per-test timeout 60s in CI;
programme backend suites complete in ≤5s each locally; frontend
production build ~1.5s; bounded payloads everywhere (request limits
per blueprint: connectors/deployments 64KB, artifacts/experiments
2MB, research bundle 16MB/origin 256MB). Chart-load/replay budgets
remain owned by the pre-existing perf suites; no new unbounded loops
were added (all ingestion/sync paths are page-bounded).

## Diagnostics and privacy (T06)

Structured error codes (`execution.*`, `research.*`, `connector.*`,
`bridge.*`, `deployment.*`, `copy.*`) on every refusal; support
export (`services/support_tools.py`) redacts secret-shaped fields by
meaning and previews exactly what leaves the machine. Job health
surfaces: ingestion jobs, experiment jobs, sync status payloads,
deployment reconcile.

## Packaging (T07)

Lockfiles present: `uv.lock`, `frontend/package-lock.json`.
Compatibility: Python ≥3.12 (CI matrix 3.12–3.14), Node 24 LTS-line,
Windows-local or Docker. Rollback = previous git revision + workspace
backup/restore (P02/P22-tested); data formats are additive JSON
bundles, older readers ignore unknown keys where applicable.
Clean-machine smoke evidence = CI clean-checkout runs + gthread
launcher smoke (existing).

## Ownership and cadence (T08)

Owners = package areas: connectors (P07–P10), execution (P11/P12),
research (P13–P16), automation (P17/P20/P21), platform (P18/P19/P22).
Deprecation: legacy broker plugins stay `planned` in the catalog
until individually certified; nothing is removed without a migration
note in the owning package file. Release-candidate signoff requires:
journey evidence per package (this plan tree), zero unchecked
acceptance criteria claimed as shipped, and the gated list below
either certified or explicitly out of the release notes.

## Not certified for release (honest exclusions)

Kraken real-account Phase B (P08-T08), Kraken execution (P08-T05),
derivatives (P08-T07), MT5 real-terminal certification (P09-T08),
Alpaca live/demo orders (P10-T06), chart overlays (P16-T07),
task-based usability sessions (P18-T08), licence file (T01 above).
Release notes must list these as planned/experimental, not supported.
