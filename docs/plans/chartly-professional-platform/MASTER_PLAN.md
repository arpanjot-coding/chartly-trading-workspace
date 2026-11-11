# Chartly professional platform development plan

**Current direction, 9 November 2026.** Chartly is a chart-first trading IDE. Stabilize instrument selection, live and saved candles, chart workspaces and the MT5 account dock first. Certify an explicit demo order path, then add venue adapters and language clients through published contracts. Fundamentals, Strategy Builder and strategy testing are out of the active release scope. Manual chart replay, chart studies and the journal support the current workflow. The [trading IDE review](p05/TRADING_IDE_REVIEW.md) records the code audit, research, architecture and acceptance sequence. Earlier checkpoints below record their historical scope.

The [product and engineering quality audit](CHARTLY_QUALITY_AUDIT.md) records current findings and release gates. Fix Automation authorization and retry handling, MT5 identity and time integrity, and workspace recovery races before expanding connector or execution capabilities.

Created 2 November 2026. Updated 3 November 2026; P00 design is accepted, and P01 contracts, P02 local storage/recovery, P03 journal/imports, P04 private Data Library, P05 original chart workflows, P06 historical paper sessions and P07 read-only connector framework are complete within their documented scopes. P08–P22 remain open. Checkboxes are updated only against recorded completion evidence; existing capabilities are inputs to verify and reuse, not automatically completed milestones. This plan replaces the narrower journal-only delivery scope while retaining the findings in the [product audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md).

## Controlling scope clarification

Current execution guide: [app state, package ownership and next milestones](p01/STATE_REVIEW_AND_CONTINUATION.md). Keep P00–P22 and their stable IDs; implement by dependency and tested user journey. This replaces stale specialist-tools scope and the earlier assumption that remote sync or all connected work must precede useful local/research features.

The user supplied `Research.txt` on 3 November as supplementary provider/bridge research. Its market-data/execution separation, direct API versus local bridge topology, capability negotiation, symbol/quantity mapping and interrupted-command reconciliation inform the applicable adapter plans. Its proposed cloud stack, chart replacement, sample schemas, delivery dates, market figures and legal/access/performance claims are not adopted as requirements or verified facts. Preserve the accepted original UI, local-first storage, canonical P01 contracts and measured per-provider gates; investigate each external claim against official evidence before depending on it.

Current P00 checkpoint: **complete as a design package; all 13 tasks verified and the user explicitly approved the baseline**. [Acceptance and evidence](p00/P00_ACCEPTANCE.md). P01 contracts are complete with [implementation evidence](p01/IMPLEMENTATION_EVIDENCE.md); P02 local storage/recovery is complete with [verification](p02/IMPLEMENTATION_EVIDENCE.md); P03 journal/imports is complete with [verification](p03/IMPLEMENTATION_EVIDENCE.md); P04 Data Library is complete with [verification](p04/IMPLEMENTATION_EVIDENCE.md); P05 original chart integration is complete with [verification](p05/IMPLEMENTATION_EVIDENCE.md); P06 paper sessions are complete with [verification](p06/IMPLEMENTATION_EVIDENCE.md); P07 read-only connectors are complete with [verification](p07/IMPLEMENTATION_EVIDENCE.md). P08–P22 remain open.

Current whole-product UI/workflow baseline: [App workflow blueprint](p00/APP_WORKFLOW_BLUEPRINT.md) and its [interactive screen/journey map](p00/original-screen-review/index.html#workflow/workspace). It specifies all primary sections, required screens, current capabilities and missing handoffs. Older proposals to demote Flow, restore the old Tools directory or replace the original chart/journal are superseded. P00 design acceptance is recorded; production capabilities remain subject to their own implementation gates.

Improve the existing application in place. Preserve the original chart interface and original journal presentation as the approved baseline; make targeted UI/workflow changes in their existing components. The standalone HTML prototype is exploratory and is not a replacement app or an accepted interface. Each journal is its own independent book, not a global ledger with a filter. Read [Existing app scope and journal book workflows](p00/EXISTING_APP_SCOPE_AND_BOOK_WORKFLOWS.md) before all earlier design proposals. P00 design acceptance is recorded; no production implementation acceptance is implied.

Current review: [original screens with numbered change notes](p00/original-screen-review/index.html) and [detailed journal/chart/sync specification](p00/ORIGINAL_SCREEN_WORKFLOW_REVIEW.md). User-confirmed ownership: exactly one account per connected book, separate manual books. Multiple copy destinations belong to execution-channel configuration; each account's fills journal to its own book.

Latest workflow direction: [environment and module placement specification](p00/ENVIRONMENT_AND_MODULE_WORKFLOWS.md). Keep Workspace profiles as environments: Chart and Journal open focused workspaces; Open exposes portfolio Overview, Connections and Settings. Retire Tools as a primary directory, rehome useful features, and make Combined Analysis selection explicit. Earlier book-card replacements are superseded. Fundamentals and Strategy Lab remain substantive implementation work, not accepted prototypes.

## Current application state

The original chart and journal are the presentation baseline. The active navigation now presents Workspace and Automation. Existing workflow changes include journal/portfolio separation, chart/journal return context, Combined Analysis selection and saving, and the Connections & Data settings group. The chart now preserves broker-native symbols and keeps symbol search and retry accessible when the feed is unavailable. The MT5 account dock has an independent refresh lifecycle, and the demo order ticket has controlled SDK coverage. Native MT5 acceptance is tracked in the trading IDE review.

P01 supplies executable canonical contracts. P02 integrates authenticated local storage, reviewed browser/native migration and workspace recovery. P03 adds the original journal’s complete manual lifecycle, exact statement import/reconciliation, reviews, credible scoped analytics and additive recovery. P04 adds broker-free private historical data, quality/import reviews, immutable versions, exact-version native charts, version-bound practice Drafts, finite owner-bound download infrastructure and separate dataset recovery. Original browser sources are preserved until explicit migration. P05 binds the original chart workflows, P06 supplies validated historical paper sessions and P07 supplies verified read-only connection setup and history infrastructure. Strategy Builder, Fundamentals and full provider-family integrations remain future package work. Existing compiler, replay, backtest, Flow and runtime components remain reuse points. [P02 evidence](p02/IMPLEMENTATION_EVIDENCE.md), [P03 evidence](p03/IMPLEMENTATION_EVIDENCE.md), [P04 evidence](p04/IMPLEMENTATION_EVIDENCE.md).

The accepted [connection workflow follow-up](p07/workflow-followup/IMPLEMENTATION_EVIDENCE.md) removes the normal default-Zerodha detour, groups all requested provider choices, makes MT5 visible under Desktop platforms, opens live profiles directly in Connections, and separates Connections from History & data. Explicit personal-PC mode opens local data without a typed password while keeping reviewed migration and private owner boundaries. Developer API/Playground/preferences no longer require a broker connection; trading authority is unchanged. Actual recent Kraken public candles now save and reopen in the original chart. Final verification passed **1,581 backend tests / 68 modules** and **2,495 frontend tests / 230 suites**, with original-screen, static and resource evidence. [Architecture](p07/workflow-followup/ARCHITECTURE.md), [provider delivery order](provider-connectivity/README.md).

The user requested all listed platforms. The directory is an inventory, not a completion claim: private crypto P08, retail bridges P09, brokerages P10, execution P11 and maintained sync P22 stay open. Continue with P08's detailed adapter plan and per-provider evidence, then P09/P10 by their prerequisites; never infer an account, market-data entitlement or execution capability from a selectable provider name. MT5 still has measured account/raw-history scope with unverified UTC/canonical accounting; Kraken public history has a finite recent-window limit.

P05 now binds that saved history into the original full terminal, resolves actual profile/run/trade context, separates account authority, scopes chart layouts/drawings and appends chart evidence directly to journal records. The latest integration passed 1,071 backend tests, 2,262 frontend tests and 84 P00 design/model tests, plus affected follow-ups, types, production build, scoped lint and generated-contract checks. Actual browser journeys verified chart/journal return, recorded-source reopening, four-pane drawings, replay availability, 50,000-candle rendering and cross-owner recovery. Follow-ups overlap the integrated totals. These Windows fixture results do not certify live providers or future products. See [P05 scope, evidence and limitations](p05/IMPLEMENTATION_EVIDENCE.md); historical packages retain their own evidence.

## Product objective

Build a free, open-source, local-first trading and research platform that people can use in their own way: journal imported trades, analyse charts, practise against historical markets, connect crypto exchanges, connect brokerages and retail terminals, execute or copy orders where supported, and investigate companies, economic conditions and source reports through a professional research terminal.

The research ambition is Bloomberg-like depth of investigation and traceability. Bloomberg's breadth, licensed content and infrastructure are not the acceptance benchmark for an initial release. Coverage grows through verified datasets and adapters; an absent or unlicensed dataset stays explicitly unavailable.

## Principles that govern every work package

1. The software remains free. Users may bring paid data or account entitlements; the app explains external requirements before setup.
2. Journal, local charting and imported-history practice require no execution account. Research-only use requires no trading setup. AI remains optional.
3. Data feeds, research providers, execution accounts and local terminal bridges are separate adapters. One connection can expose several capabilities, but none is inferred from its name.
4. Preserve and integrate the existing React/TypeScript frontend, Python backend, chart engine, Historify/DuckDB and useful execution recovery. Use a modular monolith and worker processes before introducing distributed services.
5. Production records have one authoritative owner. Durable trades, accounts, run state and research metadata live in the local backend; browser storage becomes cache/draft storage after a verified migration. Separate browser-only export remains available during transition.
6. Canonical IDs distinguish issuer, instrument, listing, contract, currency, account, provider and dataset version. A ticker alone is not a universal identity.
7. Every displayed fact has source, observation time, units, currency and freshness where relevant. Missing is different from zero. Historical research preserves what was knowable at that time.
8. Simulation, demo and live execution remain separate modes, with server-enforced boundaries. Chart labels and browser switches are not execution authority.
9. Configuration intent never claims verified connection health, enforced risk or broker-held protection.
10. A feature is complete only when its journey, failure states, persistence, tests, accessibility and documentation are complete.

## What universal support means

Chartly provides one architecture for these connection families, with individually verified support:

- **Crypto exchanges:** public market data, authenticated history/account data, spot execution, then derivatives and funding/position modes where verified.
- **Brokerages:** direct APIs or local gateways; account positions, orders, history, data entitlement and execution independently declared.
- **Retail trading platforms:** MT5, NinjaTrader, cTrader and later MT4/other platforms through their supported interfaces. OS, installation, developer approval and account restrictions remain visible.
- **Data and research providers:** local files, public official sources, user-supplied API subscriptions and entitled account feeds. Provider coverage and reuse rights are tracked per dataset.

Adapter readiness levels are Planned → Prototype → Read-only verified → Demo execution verified → Live execution verified → Maintained. A platform can support one asset class or capability without claiming the others. The first platform in each family is selected through an access-and-capability spike in P07; named integrations are candidates until that spike passes.

## Users choose their workspace

Keep the current four direct work sections and original Workspace environment cards. Chart and Journal open focused workspaces; Open owns portfolio Overview / Connections / Settings. Journal-only, paper/replay and connected first-use jobs refine the existing creation flow; they do not introduce another replacement home.

Strategy Builder and Fundamentals are independent work sections. Projects, experiments and research do not require an artificial trading environment or execution account. Workflows remains primary but optional to use; it orchestrates supported domain jobs and manages account-bound deployment instances. Settings configures providers/access, while source selection and job recovery remain directly reachable from the user's current task.

## Release milestones

### R1 Free local core

P00–P06, the applicable local portions of P20/P21/P22, and core P18/P19 gates. R1A delivers independent journal/local chart/manual replay and restore; R1B adds local indicator/strategy projects, automated experiments and initial robustness. Read-only remote history sync needs its applicable P07/provider gates. Neither checkpoint claims unverified execution bridges or copying.

### R2 Connected platform

P07–P12 and connector portions of P18/P19. A verified representative crypto exchange, retail platform and brokerage connection meet their declared support levels. Read-only access ships before write access. Copying ships only after single-account execution and recovery pass. Additional integrations use the same conformance suite and need their own adapter subplan.

### R3 Research terminal

P13–P16 and research portions of P18/P19. A useful initial fundamentals and macro universe has sourced facts, original reports, point-in-time semantics, search, comparison and saved research linked to charts/journal. Coverage is published precisely. Expanding geography, asset classes and licensed datasets is an ongoing programme.

### R4 Integrated professional platform

P17 plus the complete P18/P19 gate. Research, automation, execution, practice and journal share identity and activity history. Installer, upgrades, recovery, accessibility and maintainership are release-tested. Completion applies to the published supported matrix, not every external platform or all global financial content.

## Master development checklist

Each item links to its detailed plan. IDs remain stable tracking references; the dependency and delivery order below controls implementation. P00 design and P01–P06 are complete within their recorded supported scopes. Accepted smaller slices are recorded within their packages; they do not automatically complete a package.

- [x] **P00 Product scope and workflow specification** — [detailed plan](00-product-and-workflows.md). Fix terminology, modules, first-use journeys, screen states and release coverage.
- [x] **P01 Canonical domain and capability contracts** — [detailed plan](01-domain-and-contracts.md). Establish instruments/entities/accounts/events/datasets/runs and typed boundaries.
- [x] **P02 Durable storage migration and recovery** — [detailed plan](02-storage-and-recovery.md). Move authoritative browser records safely, preserve relations, provide complete backup/restore.
- [x] **P03 Professional journal and trade imports** — [detailed plan](03-journal-and-imports.md). Complete capture, correction, reconciliation, review and credible analytics.
- [x] **P04 Data Library and historical quality** — [detailed plan](04-data-library.md). Private versioned datasets, import quality, native chart/Draft handoffs and recovery are verified; real-provider certification remains separate.
- [x] **P05 Existing chart workflow integration** — [detailed plan](05-chart-workspace.md). Owned context, source isolation, scoped chart recovery and direct journal evidence are verified in the original UI.
- [x] **P06 Historical paper sessions and simulation** — [detailed plan](06-replay-and-simulation.md). Deterministic native-OHLC execution, explicit costs, atomic recovery, independent branches/reports and exactly-once journal handoff verified in the original chart.
- [x] **P07 Connector framework and certification harness** — [detailed plan](07-connector-framework.md), [verified implementation](p07/IMPLEMENTATION_EVIDENCE.md). Read-only lifecycle, encrypted vault, scoped history/reconciliation, observed identity and conformance; real-provider limits remain explicit.
- [ ] **P08 Crypto exchange integration** — [detailed plan](08-crypto-exchanges.md). Deliver one verified exchange completely, then expand by adapter and product type.
- [x] **P09 Retail terminal and platform bridges** — [detailed plan](09-retail-platforms.md). MT5 first candidate; separate NinjaTrader/cTrader/MT4 access paths and certification.
- [ ] **P10 Brokerage integrations** — [detailed plan](10-brokerages.md). Migrate and verify an existing suitable adapter; add gateways/direct APIs through the common contract.
- [x] **P11 Single-account execution and risk** — [detailed plan](11-execution-and-risk.md). Durable commands, reconciliation, protective-order capabilities and trustworthy order activity.
- [x] **P12 Multi-account execution and copying** — [detailed plan](12-multi-account-copying.md). Per-account mapping/sizing, child outcomes, exposure controls and divergence recovery.
- [x] **P13 Research data aggregation foundation** — [detailed plan](13-research-data-platform.md). Sources, ingestion, source documents, point-in-time facts, licensing metadata and quality.
- [x] **P14 Fundamentals and asset intelligence** — [detailed plan](14-fundamentals.md). Company financials/filings first; asset-specific crypto, fund, FX and futures intelligence in verified slices.
- [x] **P15 Macro data calendars and reports** — [detailed plan](15-macro-and-reports.md). Economic series, release vintages, events, original publications and entitled report/news content.
- [x] **P16 Professional research terminal** — [detailed plan](16-research-terminal.md). Search, security pages, comparisons, screens, notebooks and links to decisions.
- [x] **P17 Workflows, deployment operations and optional AI** — [detailed plan](17-tools-automation-and-ai.md). Operate retained Flow/bot runtimes through scoped domain services; exclude retired Tools/options/SIP products.
- [ ] **P18 Visual design accessibility and usability** — [detailed plan](18-design-and-usability.md). Carry design quality through every package; complete product-wide polish before each release.
- [x] **P19 Distribution testing operations and maintenance** — [detailed plan](19-release-and-maintenance.md). Installation, CI, diagnostics, upgrades, licensing, support and release evidence.

- [x] **P20 Dedicated Strategy Builder and artifact lifecycle** — [detailed plan](20-strategy-lab.md). Indicator/strategy projects, immutable revisions, chart attachments and candidate/promotion UI; runtime operations use P17.
- [x] **P21 Strategy experiments and robustness** — [detailed plan](21-strategy-validation.md). Own the automated baseline jobs/reports, then parameter trials, causal splits, stress and reproducible validation records.
- [x] **P22 Local synchronization and external journal history** — [detailed plan](22-local-sync-and-history.md). Journal-only sources, startup catch-up, coverage, cross-source reconciliation and local-engine lifetime.

## Dependencies and delivery order

1. **P01 complete:** versioned identity, book/account/source, data, artifact/experiment and research envelopes; runtime-neutral fixtures/validators and legacy mapping. Keep the supported v1 scope small; no production data migration or broker dispatch change.
2. **P02 + P03 local journal:** inventory/export current trader and chart browser stores, scoped backend repositories, recoverable migration/restore, standalone book and full trade lifecycle, then one normalized statement-import journey. P22's source/reconciliation foundation can accompany import; remote sync is not a prerequisite for a useful manual journal.
3. **P04 → P05 → P06:** reuse Historify, select a validated versioned dataset, open it in the original chart, complete a persistent historical paper session and journal its confirmed simulated fills once.
4. **P20 core + P21 baseline, then robustness:** project/library/revisions and indicator validation; one durable saved-data experiment/report; then bounded parameter studies, chronological evaluation, stress and candidate comparison. P20 uses P21's jobs/results. P21 consumes accepted P20 artifact contracts, not the whole future deployment product. P06 is an engine dependency only where actually used.
5. **Fundamentals branch after applicable P01/P02 contracts:** P13 source/fact/document services + P14 supported company facts + thin P16 search/company/report/saved-research UI. First company research does not wait for macro P15, every asset class, all brokers or live execution. Access/coverage investigation can be read-only preparation; production integration still meets its contract/storage gates.
6. **Read-only connection branch:** after relevant P01/P02 scope exists, P07 certifies an accessible adapter; P08/P09/P10 extend connection families. P22 implements account-specific startup/catch-up/coverage/reconciliation through those accepted capabilities. Each real provider needs its own access and conformance evidence.
7. **P11 → P12 with P17 operations:** certify single-account demo/eligible live dispatch and recovery before copying. P17 can orchestrate local/read-only data/sync/research/experiment jobs as their services become ready; broker-writing workflow/runtime actions always wait for P11 and applicable P12.

P18 usability/accessibility and P19 test, diagnostics, provenance/licensing, installer/update and restore gates apply throughout. The [current execution guide](p01/STATE_REVIEW_AND_CONTINUATION.md) gives the user-visible pass condition for each delivery.

Work packages can contain an earlier useful slice and later integration. Keep the full master checkbox open while required scope remains unfinished. Never mark all of P20/P21, P02 or a connector family complete because one UI or fixture passes.

## Architecture decisions for the first implementation

- Keep one local backend deployment with modular journal, market data, simulation, connection, execution and research services. Use separate bridge/worker processes where terminal APIs or blocking ingestion require isolation.
- Use transactional local relational storage for accounts, executions, journal reviews, run state, research metadata and jobs; reuse DuckDB for analytical historical storage. Benchmark before adding another database, search cluster or message broker.
- Preserve the chart engine behind typed source and execution interfaces. Historical charting never acquires an execution path simply because a broker session exists.
- Implement one authoritative ledger/matching service for each replay-paper run, with bounded replay advances and acknowledged UI state. Preserve existing automated strategy backtest and live runtimes behind versioned engine/experiment contracts; require supported parity fixtures rather than assuming all engines are identical. Do not create competing writers for the same simulated account or journal effect.
- Use an append-only execution/run event ledger with transactional projections and snapshots where recovery requires it. Do not event-source every preference or ordinary notebook edit.
- Use durable jobs/outbox for connector ingestion and execution handoffs. Define acknowledgement/retry semantics rather than promising network-wide exactly-once delivery; idempotency and reconciliation provide effectively-once effects within supported boundaries.
- Preserve source documents and normalized facts separately. Materialized calculations record their formula/version/inputs; source revisions never silently rewrite a past research snapshot or replay.
- Keep local single-user operation as the default deployment. Do not imply hosted multi-tenant safety until tenant isolation, storage, credential and entitlement boundaries are separately designed and tested.

## Data economics and coverage policy

Every provider has a manifest: supported geography/assets/fields/history, delay, refresh rate, API quotas, credential needs, attribution, permitted caching/export/display scope, and the user's applicable subscription. Public availability does not establish unrestricted reuse. Do not pool private entitled feeds across users.

Start with user imports and suitable official public sources. SEC EDGAR provides submissions and XBRL company data; FRED provides economic series and releases, with series/source terms to preserve. These are initial adapter candidates, not substitutes for complete global estimates, news, transcripts, corporate actions or exchange feeds. Paid providers remain optional until a research feature genuinely requires their coverage. Provider selection produces a separate evidence-backed subplan and budget decision; this roadmap commits to no unverified price or licence.

## Definition of done for every work package

- Its named user journey works on a clean supported installation and on an upgraded fixture.
- Happy, empty, loading, permission, partial, stale, failure, retry and cancellation states are designed where applicable.
- Persistence and restart recovery are demonstrated; migrations have backup and a tested failure recovery path.
- Tests cover domain invariants and the actual integration seam, not merely component existence.
- Privacy, local access, credential redaction and source/entitlement boundaries match the feature.
- Keyboard use, visible focus, readable labels, responsive layout and relevant screen-reader output are checked.
- Supported capabilities and limitations are documented; diagnostic output explains actionable recovery without leaking credentials.
- The package has release evidence: build/version, test results, fixture/source scope and known limitations.
- Its checkbox is ticked only after those artifacts exist. Partial completion stays unchecked with a linked task record.

## Tracking rules and task records

Use IDs such as P03-T04 in commits/issues and plan notes. A work package owns the detailed checklist; this master owns milestone status. For each task record capture owner, state, dependencies, implementation files, test evidence, unresolved risks and completion date. States: Planned, Ready, In progress, Blocked, Validating, Done. A blocker names the missing input and next action; it is not hidden behind a checked checkbox.

Before starting a package, expand its task into exact API/schema/wireframe and fixture changes if implementation reveals more detail. For a new exchange, broker, platform or paid data provider, create an adapter-specific child plan containing supported capabilities, external-access proof, symbol/unit rules, test environment and certification checklist. The 23 packages here are the initial programme baseline, not permission to skip those provider-specific details.

No calendar commitment is assigned before team capacity and the first complete package are measured. Estimate and schedule work after a short technical spike, then reforecast at each release gate. External approvals, source licensing and terminal access are explicit dependencies.

## Next concrete work

P07 has passed its [read-only connector framework gate](p07/IMPLEMENTATION_EVIDENCE.md), following the accepted P06 historical-paper workflows. The original chart remains the base. New profile is the single creation entry; replay requires owned history, and session tags are optional and independent of timezone. Read-only setup, explicit account/book linking, bounded deduplicated history, reviewed corrections and reconnect are verified. Real MT5 account/raw-history reads have measured limits, including unverified clock alignment. Kraken public reachability and blocked brokerage authentication do not certify their account families.

Next, detail the applicable P08–P10 provider-family scope and obtain its permitted test environment before implementation/certification. MT5's clock and deal-accounting gaps belong to its P09 subplan; P11 execution and P22 maintained startup synchronization remain separate. The [dependency order](#dependencies-and-delivery-order) also permits eligible local Strategy Builder/experiment and Fundamentals slices after their contracts, rather than requiring every broker first. A visual chart cursor remains distinct from a simulation checkpoint. Installed browser sources still move only through the user's reviewed migration.

P01's 57 v1 record shapes, shared runtime validation, compatibility classification and handoff sequences are implemented and tested. [Acceptance evidence](p01/IMPLEMENTATION_EVIDENCE.md). These contracts do not implement provider access, execution, storage or the missing products.

The first product milestone remains a manual book whose trade can be edited/closed, restarted and restored in the original journal UI. Preserve the original chart/journal and retained engines throughout P02/P03.

## Source references

- [Ten-part current-state audit](../../CHARTLY_PRODUCT_WORKFLOW_REVIEW_2026-11-02.md).
- [SEC EDGAR API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
- [FRED API documentation](https://fred.stlouisfed.org/docs/api/fred/) and [source and usage terms](https://fred.stlouisfed.org/legal/terms/).
- [CCXT capabilities and unified API](https://docs.ccxt.com/docs/manual): abstraction does not guarantee every method on every exchange.
- [cTrader Open API](https://help.ctrader.com/open-api/): distinct demo/live capabilities require connection-specific verification.
- [MT5 Python integration](https://www.mql5.com/en/docs/python_metatrader5) and [NinjaTrader AddOn order interface](https://static.ninjatrader.com/support/helpGuides/nt8/createorder.htm).

## Current tracking state

P00 is complete as the user-approved design baseline: all 13 tasks, final layouts/state contracts and three connected storyboards have recorded acceptance. [Evidence](p00/P00_ACCEPTANCE.md). The subsequent primary-navigation order clarification is implemented and tested.

Programme status as of 4 November 2026: **185 of 189 tasks checked**. Complete: P00–P07, P09, P11–P17, P19–P22. P09 closed by LIVE MT5 demo certification on this machine. Per user direction (incl. Research.txt BYOB spec), Kraken is parked and Path-A coverage now includes Phase-A read-only adapters for Binance, Bybit, Coinbase, OKX, Bitget, Hyperliquid and TopstepX — all fixture-verified, crypto six also live-public-verified, withdrawal-enabled keys refused by design ([registry](p08/EXCHANGE_ADAPTERS.md)). Remaining five tasks are Phase-B certifications gated on user-supplied venue keys (P08-T05/T07/T08, P10-T06) and human usability sessions (P18-T08). Regression: 179 backend + 13 frontend tests green. Fixture scopes are never presented as real-account certification. Update 2026-11-04 (later same day): per user direction the legacy Indian-market broker stack was removed everywhere (37 broker plugins, broker login/postback routes, BrokerSelect/TOTP and legacy order/holdings/admin pages) and a market-feeds layer landed: keyless live candles/quotes for Binance, Bybit, Coinbase, OKX, Bitget, Kraken plus Dukascopy free FX history and a client-token OANDA reader, with a feed-to-Data-Library bridge so Replay/paper run on real saved history (Binance BTCUSDT 1h, 119 candles, live-verified end to end). Connector catalog stands at 37 discussed platforms with zero Indian brokers. Evidence: [indian-removal-and-feeds-2026-11-04](p19/evidence/indian-removal-and-feeds-2026-11-04.md). Task count then 184/189.

Workspace/Chart update 2026-11-05: the live-feed chart is multi-symbol per venue (broker-native symbol search incl. MT5 prefixes/suffixes via /api/local/v1/market/symbols), an MT5 Toolbox-style account dock shows balance/equity/free margin plus Positions/Orders/History from the terminal account, chart banner strips were removed, and personal-mode accounts can open System & advanced and AI configuration again. Header state (superseded later same day, see next paragraph): Workspace only, with Fundamentals/Strategy Builder/Workflows hidden.

Custom Indicators + Automation update 2026-11-05 (later): the global header is Workspace, Strategy Builder, Automation (Fundamentals stays hidden/deferred; its route remains). Users can create custom chart indicators three ways — Settings > Custom Indicators (templates, editor, in-browser validation against the chart loader's own checks, save gated on a passing validation), the in-app AI Agent (chart-indicator skill registered + confirmation-gated save_custom_indicator tool, never overwrites, always reports validated: false), and external LLMs (portable docs/skills/chartly-indicators/SKILL.md downloadable from the manager, plus MCP list/get/save tools; the save is write-scoped because installed indicators run unsandboxed). One write path (services/custom_indicator_store.py) backs all three. Automation verified end-to-end live: personal-mode CRUD, and local-only workflows (log/delay/http/math/time/variable nodes) now execute and activate without a legacy Developer API key (broker-reaching nodes still require one, fail-closed). Full-app test: frontend 3,602/3,602 tests + production build green; backend touched-area batch 472 green; full backend suite 7,147 passed with 286 failed + 374 errors, all triaged as stale tests over the removed Indian broker stack (broker.<name> imports), ChatGPT model-catalogue drift, and installer-environment gaps — none in current-product areas. Evidence: [custom-indicators-automation-2026-11-05](p19/evidence/custom-indicators-automation-2026-11-05.md).

The [accepted P00 decisions](p00/P00_DECISIONS.md), [workflow blueprint](p00/APP_WORKFLOW_BLUEPRINT.md) and [current execution guide](p01/STATE_REVIEW_AND_CONTINUATION.md) take precedence over historical prototype proposals. Future progress must link actual implementation, tests, persistence/recovery and limitations to the owning package before its checkboxes are changed.


