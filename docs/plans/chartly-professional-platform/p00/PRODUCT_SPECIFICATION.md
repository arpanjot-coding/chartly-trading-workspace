# P00 Product and workflow specification

Scope clarification: [improve the original app in place and preserve independent journal books](EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md). This supersedes replacement-screen or alternate-shell proposals below.

Version 1, 2 November 2026. SUPERSEDED as the accepted design baseline; P00 is reopened. Owner: Codex implementation lead. Read [foundation revision 2](FOUNDATION_REVIEW_V2.md) before implementation. These are target behaviours; the linked prototype uses illustrative local fixtures and does not connect to production storage, feeds or accounts.

## Completion boundary

P00 is a specification package. Its deliverables are reviewed journeys, routes, screen wireframes, state rules, vocabulary, launch scope and prototype evidence. Completing P00 does not complete production onboarding or certify an integration. Production changes to broker gates, storage, journal, feeds, simulation and research remain in their respective work packages. Internal prototype walkthrough is evidence of design consistency, not external user research or production E2E testing.

The master plan's functional release gates remain unchanged. Do not mark a production package complete on the strength of this prototype. Destructive changes, migrations and live broker actions are outside this package.

## P00 T01 Users and first useful outcomes

### J01 Manual journal

Person: a trader recording decisions without connecting accounts. Job: when a session ends, record and later review a trade without buying data. Entry: Workspace → Journal → Add trade. Required: local workspace, accounting currency and trading timezone. Optional: account label, chart dataset and mindset. First useful outcome: a saved record with known execution facts and editable review. Open trades have no close timestamp; unknown facts stay blank.

Success: create → open detail → correct a fee → close if needed → save review → see the included record in performance. Recovery: failed save retains the draft; retry uses the same operation identity. Add a label-only manual account without credentials. Never show an incomplete broker checklist as failure for this user.

### J02 Statement import

Person: a trader with existing broker/exchange statements. Job: replace manual reconstruction with reconciled trade history. Entry: Journal → Import trades. Required: file, mapped fields, account identity, source timezone and amounts/currency semantics. No broker login or candle dataset is required. First useful outcome: validated rows committed once, totals reconciled and a review queue.

Flow: choose account/file → map columns → validate → inspect row errors/duplicate and correction counts → commit explicitly → receipt → review. Invalid rows cannot silently disappear. User can fix mapping, replace file, or explicitly exclude named rows; show exclusion count before commit. Cancellation before commit writes nothing. Interrupted commit returns a job receipt that can be queried/retried without duplicates. Store mapping separately from actual credentials.

### J03 Historical practice

Person: a discretionary trader testing a hypothesis without live risk. Entry: Practice → Prepare run. Required: project/question, instrument, immutable usable historical dataset, window, simulated capital/currency, units and fill/cost assumptions. First useful outcome: a run-bound chart and paper ledger with one journaled simulated trade.

Flow: choose project → dataset/window → validate → start → place simulated intent → advance → save/resume → finish → review. Missing data opens Data Library carrying project and run context, then returns to the same draft. Rewinding creates a branch or reconstructs the ledger; never keep profits from a future timeline. Read-only study is available without starting a simulator. P06 owns actual fill behaviour and leakage tests.

### J04 Crypto connection

Person: an exchange user wanting history and charting, optionally execution. Entry: Connections → Crypto. Required for private data: eligible authenticated account and verified scope. Public prices do not require a trading key when the source supports them. First useful outcome: verified account identity/history or a working public source, separately labelled.

Flow: choose eligible adapter → review prerequisites → connect read-only → verify identity/capabilities → sync → open journal/chart. Optional execution is a later explicit step: demo environment → preview → arm eligible account. Missing permissions return to the same setup draft. Never ask for withdrawal permissions. Unsupported products stay unavailable even if another product on that venue is certified.

### J05 Retail platform and brokerage

Person: a terminal or broker user wanting private data/history and optional orders from Chartly. Entry: Connections → Retail platform or Brokerage. First useful outcome: measured connection health, verified account identity and reconciled history. Credentials/bridge are required only for that connection, not the journal.

Flow: select adapter → prerequisites → pair local bridge or authenticate API/gateway → verify account → read-only sync → optional demo execution → eligible live execution. A saved executable path is not proof of running or authenticated status. Terminal restart/login change disarms writes until account identity and orders are reconciled. Multiple terminals have explicit account bindings. A missing supported bridge offers install instructions and returns to the original draft.

### J06 Research only

Person: an analyst investigating companies/assets or economic releases without trading. Entry: Research → search entity/series/report. Required: an available source for the requested data or an existing local research snapshot. Broker and AI configuration are never required. First useful outcome: inspect a sourced fact in its original report and save a cited hypothesis.

Flow: search → select exact issuer/listing/asset → inspect facts and freshness → open source report → add note → save notebook. Unavailable provider offers change source or reopen saved snapshot. Historical view shows only information available by the selected as-of time. Empty coverage says unavailable, not zero. Optional source API keys belong to provider setup and preserve the research return target.

## P00 T02 Navigation and route contract

Global shell contains Workspace, pinned modules and a Modules launcher. Default pins are Journal, Charts and Practice; Research, Data Library and Connections are in the launcher and can be pinned. Research-first setup pins Research and Data Library instead. Pins change navigation preference, never permissions or underlying data. Advanced contains automation/research tools, developer access and diagnostics. Account/settings remains separate from broker accounts.

Persistent context: local owner/workspace ID, optional profile ID, account IDs, project/run ID, source/dataset ID and as-of time. Route IDs resolve through scoped repositories; URL display names do not grant access. Switching profiles asks about dirty work; no silent reassignment of a run, active command or research snapshot. Account filters are distinct from execution targets. Visible scope is repeated near destructive or executable actions.

### Proposed routes and access

- `/workspace`: resume/review queue and job entry. Local-app access only. Existing route retained.
- `/journal`: profile/account chooser or selected journal; legacy redirect migrates to this local index. `/workspace/profiles/:profileId/journal` remains a canonical scoped entry.
- `/workspace/profiles/:profileId/journal/trades/:tradeId`: facts/decision/review/history. Account connection optional; imported facts require valid ownership, not a current broker token.
- `/journal/import?profileId=...&accountId=...`: statement wizard. Safe internal return context only.
- `/data` and `/data/import`: new primary aliases for existing Historify manager/import. `/historify` bookmarks remain supported. No execution broker required.
- `/data/datasets/:datasetId/versions/:versionId`: provenance/quality/coverage; export respects source scope.
- `/charts`: chart chooser/recent views. `/trading?profileId=...&runId=...` preserved as a compatibility route resolving an explicit ChartContext.
- `/practice`: projects/runs index. Existing `/workspace/profiles/:profileId/replay` remains scoped. `/practice/runs/:runId/prepare`, `/practice/runs/:runId`, `/practice/runs/:runId/review` target the same durable run.
- `/connections`, `/connections/new`, `/connections/:connectionId`: shared registry, capabilities and measured status. Existing profile Connections becomes a contextual account/source/destination view.
- `/activity/:intentId`: order or automation activity with per-account outcomes. Read-only inspection never requires execution to be armed.
- `/research`, `/research/entities/:entityId`, `/research/reports/:documentVersionId`, `/research/notebooks/:notebookId`: source-driven local research views. Providers have their own setup permissions; no execution gate.
- Existing tools/Flow/admin routes remain reachable under Advanced with specific prerequisites. Local analytical actions shed blanket broker prerequisites during their migration package.

Return context uses a validated same-app destination and stable IDs, never arbitrary external URLs or secrets. Setup completion resolves and returns to the original task; cancellation preserves its draft. Missing/deleted scope gives a meaningful not-found versus forbidden/storage-error distinction without exposing another owner's records.

## P00 T03 First run and readiness

First paint asks what to do: Journal trades, Import statement, Explore charts, Start practice, Research, Connect accounts. Choose more later; no permanent role. Collect name, accounting currency and timezone only when relevant; use editable suggestions, not fabricated recorded facts. Default mindset collection is off. Examples are clearly identified and cannot enter real analytics.

Readiness is job-specific:

- Journal: workspace writable and valid record fields. No connection/source requirement.
- Local chart: a usable selected dataset and supported chart resolution. Execution permission irrelevant.
- Practice: validated dataset/window plus simulator configuration and writeable run storage. Start unavailable until dependencies are satisfied; explain exact missing item.
- Research: requested source or saved snapshot available; show publication/freshness. No account setup checklist.
- Connected history: verified account identity, read scope and successful sync state.
- Trading: explicit eligible environment/account, supported instrument/order capabilities, reconciliation and backend risk readiness. A chart opening successfully does not establish this.

Migrate current destination/source/drawdown checklist to a connection-specific checklist in P03/P05/P07. P00 specifies this removal; it does not modify the shipped UI before those prerequisites exist.

## P00 T04 Screen wireframes

The [interactive wireframe](index.html) implements these screen structures and illustrative state transitions. The machine-readable companion is [screen-spec.json](screen-spec.json). It does not contact the real app or simulate real fills/financial calculations.

### S01 Workspace

Top: identity, module launcher and context. Main: six entry jobs, recent work/resume and unreviewed queue. Secondary: local storage/backup status and optional connection health. No wall of zero metrics. CTA opens the chosen job with a local workspace; optional module pinning is a preference.

### S02 Journal

Top: profile/account, date range, timezone and strategy. Primary: Add trade / Import trades. Main: review queue or ledger with status/origin. Detail opens S03. Secondary: measured performance and sample size, Calendar; export report distinct from full backup.

### S03 Trade detail and review

Top: instrument, open/closed status, origin and save status. Main tabs: Facts, Decision, Review, Attachments, History. Facts include explicit units/currency/time and optional close values. Review has editable rationale/lesson. Save keeps record identity; archive offers Undo. Chart capture resolves to the matching trade/time/source.

### S04 Statement import

Stepper: file/account → mapping → validation → preview → commit/receipt. Main: row errors and accepted/duplicate/corrected/excluded counts. No commit while unresolved required fields remain. Recovery stays on the mapping/preview, not account login. Receipt links to imported review queue. The prototype's three fixture rows are two valid and one malformed; correction enables commit.

### S05 Data Library

Main catalog: instrument/source/native resolution/coverage/quality/local availability. Actions: Import history, Download from connection, Open chart, Create run. Secondary: selected dataset provenance/detail. When entered from a run, opening/importing data preserves the pending run and offers Return to run.

### S06 Historical import

Stepper: source file → columns/timezone/units/instrument → quality preview → commit. Main errors/gaps/duplicates and overwrite/new-version policy. Show unknown volume distinctly from measured zero. Commit produces an immutable version and links chart or the originating run.

### S07 Chart

Header: profile/run, explicit study/paper/demo/live mode, source and independently identified execution target. Main: symbol/timeframe/study toolbar, drawing rail, plotting canvas. Side: Journal/Watchlist/Objects. Bottom: freshness/coverage/timezone and either replay transport or account activity. No source replaces canvas with actionable source choices. Chart fixture shows layout zones, not fabricated market prices.

### S08 Practice projects

Main: research question/projects and runs labelled Draft/Data needed/Ready/In progress/Finished/Abandoned. Actions Create run, Resume, Compare and Archive. Separate independent experiments; no pooled project equity unless an explicit shared-account design is adopted later.

### S09 Run preparation

Stepper: dataset/version → instrument/window → capital/units → costs/fill assumptions → validation. Missing data leads S05 with return context. Start opens the same run. Data needed, Ready and failed validation have distinct explanations. Draft survives cancellation/restart in production P02/P06.

### S10 Active run

Header: simulated time, dataset version, fidelity, save status and Paper replay. Main chart plus paper ticket and ledger. Controls: advance/pause/save/finish. Restart restores orders/positions/cash/time atomically. The prototype advances an illustrative state only; P06 must implement matching. No broker target selector or live submit path.

### S11 Run review

Main: assumptions/source/version, execution timeline, linked trade reviews and experiment summary. Actions Review trade, Resume if unfinished, Duplicate configuration, Compare. Finished status requires durable evidence, not a manual dropdown. Review labels simulated outcomes.

### S12 Connections

Separate sections for market/research sources, account history and execution destinations. Rows show configured state, measured health, verified account and available capability. Actions Add crypto, Add retail platform, Add brokerage and Add research source. Configured does not say connected. Start read-only; unsupported provider/product choices explain their prerequisites.

### S13 Connection setup

Stepper: provider/path → prerequisites → authentication/pairing → identity/capabilities → sync → optional execution. Never save broker passwords in browser forms or infer running state from a checkbox. Recovery preserves return task; change of verified identity disarms writes. Prototype has no credential fields or live connect call.

### S14 Order preview and activity

Preview identifies paper/demo/live, account, normalized instrument/units/price/risk estimate and protection capability. Activity separates validation, approval, submission, acknowledgement, fill and reconciliation. Unknown outcome shows Check/reconcile account with no resubmit action. P11/P12 own exact lifecycle, backend enforcement and real-world recovery tests.

### S15 Research search

Search entities, instruments, series and reports; type and venue resolve collisions. Main: search/results and saved notebooks. Secondary: source coverage/freshness. A no-source state offers provider setup or saved local snapshot, never Connect trading account.

### S16 Security or asset page

Header: canonical identity, listing/asset class, coverage and as-of time. Main tabs by type: Overview, Financials/asset-specific fundamentals, Events and Reports. Every fact exposes units/period/source. Actions open original report and save hypothesis; unavailable data is not zero. Example issuer is explicitly fictional in the prototype.

### S17 Source report

Header: source document/version/publication/availability and original-source link where permitted. Main: readable report with stable citation anchors. Side: notes/highlights and Save research. Report unavailable offers retry/change source/saved copy if available; preserve requested document context.

### S18 Notebook

Main: hypothesis, cited report/fact snapshots, user notes and linked profile/trade/project. Save has draft/retry/history. Sources changing later do not overwrite snapshot evidence. Hypothesis and AI suggestions are not execution facts.

### S19 Settings and recovery

Main: module pins, display preferences, local storage inventory, full backup/restore and job diagnostics. Account access and execution settings are distinct. Failed restore stops before replacing data; preview scope, schema and counts first. P02/P19 implement durable semantics; prototype demonstrates navigation only.

## P00 T05 State and interaction specification

Every S01–S19 screen uses the following contract. The machine-readable specification enumerates screen-specific recovery text and focus target for all states so no screen silently inherits an irrelevant broker prerequisite.

- **Empty:** state why records/data are absent and show one relevant create/import/select-source action. No fabricated zero performance.
- **Loading:** announce operation and preserve existing context; show progress/cancel for long work, no repeated submission.
- **Saved:** show confirmed persistence and scope. Prototype uses fixture confirmation; production requires authoritative write acknowledgement.
- **Failed:** retain user input and operation identity; show actionable retry or correction. Not-found is not a storage failure.
- **Stale:** retain last known data with timestamp/source; distinguish cached view from executable fresh price.
- **Partial:** name accepted and unresolved scope; show affected rows/accounts/data, not generic success. Imported malformed rows need explicit resolution.
- **Unauthorized:** show missing local/provider permission with reconnect/change-source/return, never send a journal-only user to broker auth. Historical intents cannot escalate to live.

Keyboard rules: native buttons/inputs, visible focus, main heading focused after navigation, errors announced and focused before retry, validation summary links to relevant input, no focus trap, dialogs restore opener focus. Save announcements are noninterrupting. Narrow layouts stack panels, wrap context and actions, retain labels and scope, and avoid horizontal page overflow at 360px. Desktop chart/research canvases may have documented interaction limits but journal/review/import stays usable.

Specific hazards: connection stale/partial disables new live intent until reconciled; unknown submission never exposes Retry order; dirty editor preserves draft or explicitly discards; module pinning never changes permissions; unavailable provider preserves saved research snapshots; data selection returns to the original draft run.

## P00 T06 Vocabulary and authority

- **Workspace:** a local organizational/ownership boundary, not a broker account.
- **Profile:** strategy/session/review scope, not proof of connection or funds.
- **Account:** real or manual/import identity with environment and currency; execution privileges are independent.
- **Historical study:** read-only selected history; no order target.
- **Paper replay:** historical simulator; clock, capital and fills are simulated and run-bound.
- **Paper live:** optional simulator driven by present-day prices; separate from replay and broker demo.
- **Demo broker:** external broker/exchange demo environment, not a local simulated ledger.
- **Live broker:** eligible real execution account. Source price may differ from executable account quote; preview identifies both.
- **Configured:** saved intent only. **Connected:** verified transport/account scope and heartbeat. **Ready:** required capabilities and reconciliation satisfied. **Armed:** explicit write policy enabled; not proof a trade occurred.
- **Submitted:** command sent, outcome may be unknown. **Acknowledged:** provider accepted a reference, not a fill. **Partial/Filled:** confirmed execution quantity. **Unknown:** investigate/reconcile before any resubmission.
- **Risk rule:** declared policy; label whether enforced by Chartly backend or protection confirmed broker-side. Drawn levels are not protection.
- **Dataset version:** immutable historical input and quality metadata. **Fact revision:** a reported or corrected observation with availability time. **Research snapshot:** evidence as saved, not necessarily latest fact.
- **Net journal P&L:** realized recorded trading results under declared accounting. **Account equity:** actual account snapshot including cash/exposure; never invent from manual journal.

## P00 T07 Launch scope and evidence

### R1 Free local core

Release scope: local single-user Windows baseline; manual trades; one documented canonical CSV statement format with mapping; valid CSV/Parquet historical inputs through Historify; read-only chart; deterministic candle-based paper replay; durable journal/run/backup recovery. General instrument schema supports crypto spot, FX and futures identities, but executable simulator products/units must each pass P06 fixtures; unsupported economics are disabled. No certification of a crypto exchange, MT5 bridge, brokerage or paid research source is included.

Evidence: clean install and upgrade, valid/malformed/repeated imports, open/edit/close/review, imported dataset charting, run context, one paper trade, crash/resume, restore counts/results and no live route exposure. Unit passes alone are insufficient.

### R2 Connected platform

Target one verified crypto spot adapter, one retail platform candidate (MT5 first spike) and one eligible brokerage. Concrete providers and products selected by P07 access evidence; no names are pre-certified. Read-only, demo write and live write are separate support levels. Copying requires two eligible verified execution accounts, mapping/risk fixtures and divergence/restart tests.

Evidence: adapter manifest/version, actual test environment, account identity, quota/auth recovery, history reconciliation, allowed order types/protection, unknown submissions, partial fills and deduplication. Architecture support does not advance a readiness label.

### R3 Research terminal

Initial company facts/filings and selected official-source macro series/releases; exact issuer/series universe selected in P13–P15 source subplans. Source documents, revisions, units/as-of, search, compare, notebook and chart/journal links. Non-US filings, crypto on-chain/unlocks, estimates/news/transcripts and other markets are explicit coverage expansions, not implied initial support.

Evidence: original-document drill-through, revision/as-of fixtures, unavailable-source recovery, saved cited research, duplicate/ticker resolution, terms/attribution manifest and clean provider setup without trading auth.

### R4 Integration and maintenance

Supported legacy tools/automation migrate to scoped contracts; optional AI source-cited and permission-bounded. Product polish, accessibility, installer/upgrade/recovery, maintainers and accurate support matrix. No hosted multi-tenant claim without separately tested boundaries.

Evidence: task-based cross-module tests, recovery/fault injection, visual/accessibility review, resource benchmarks on a stated reference machine, release artifacts and documented support limits.

## P00 T08 Prototype review protocol

Use fictional fixture records only. Review paths J01–J06, plus mandatory malformed statement, missing-data return, unknown submission and unavailable-report recovery. Verify expected heading, scope and available recovery action after each step. Test both 360px stacked layout and desktop. Log any observed navigation failures, fix the prototype/spec, then rerun affected paths. Record internal walkthrough versus external participant testing separately.

P00 completion evidence belongs in [VALIDATION.md](VALIDATION.md). Detailed implementation starts at P01 only after the design gate is recorded. These fixtures prove navigation/state intentions, not persistence, pricing, financial calculations, credential safety or actual external connectivity.
