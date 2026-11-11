# P00 product decisions and implementation boundary

2 November 2026. Current design baseline. The user explicitly confirmed D01–D04 in this conversation. This specifies the product; it does not certify unimplemented adapters, data, orders or persistence.

## Decisions

1. **D01 Books:** one active connected book per canonical account, with separate manual books. Reconnecting an account offers its existing book. Archive/reactivate the same book; do not create overlapping active copies. Tags and saved views provide alternate analyses without duplicating the ledger.
2. **D02 Manual books:** a manual book has no external account binding. Manual corrections and research notes are allowed on connected records, but imported/source facts retain their provenance. A manual book cannot silently become a connected book.
3. **D03 Environments:** profiles/portfolios are environments inside Workspace. Their Chart / Journal / Open actions remain. Open retains Overview / Connections / Settings. Journal keeps its original tabs and focused navigation. Fundamentals, strategy projects and notebooks do not need an artificial trading profile.
4. **D04 Operations:** Workflows stays a primary section. Bot deployments are managed under Workflows → Deployments with contextual links from the original chart, Strategy Builder and profile Overview. A deployment is a distinct runtime type, not a Flow graph or a second copy of its source.
5. **D05 Navigation:** the user subsequently confirmed the exact primary order **Workspace → Fundamentals → Strategy Builder → Workflows**, directly visible rather than putting Strategy Builder under More. Desktop and mobile use the same order; Settings stays in the shared menu. Shared data selection, jobs/activity and recovery are contextual surfaces, not a revived Tools directory. Persist optional quick-access pins separately from access permissions; no core section disappears because a user changes a pin.
6. **D06 First use:** ask which job the user wants when they choose New/Open: journal only, paper/replay or connected trading. Keep the current Workspace/profile visual base. Do not replace it with a new six-card home. Fundamentals and Strategy Builder can start directly from their own primary sections.
7. **D07 Data and execution:** market-data access, account history, research and execution are independent capabilities. A terminal can provide several, but the UI never infers them from the provider name. Local records and eligible saved-data tasks work without execution setup.
8. **D08 Migration:** preserve current numeric IDs as compatibility aliases. Existing profile-scoped manual trades become a separate manual book associated with that environment; verified account-attributed records are routed only after identity validation. Unattributed/mixed records require a classification preview, not a guessed account assignment. Preserve notes, attachments, chart layouts, filters and source observations. No migration occurs in P00.
9. **D09 Multi-account/copying:** an environment may have several execution destinations but at most one primary journal destination per active account context. Each destination's confirmed fills route to that account's own book. A selected chart account and a copy group are distinct; changing the visible chart never retargets an existing operation.
10. **D10 Archive/delete:** archive detaches a view or disables future use; it does not erase executions or books. Removing a provider retains source/history evidence. Book/account purge requires an explicit scoped recovery/export policy in P02, rather than the current profile-delete cascade.
11. **D11 Strategy lifecycle:** mutable draft → immutable validated revision/dependencies → pinned experiment → candidate/validation record → separately configured deployment. Indicator attachment is a view; backtest trials are research records; bot/account fills are execution records.
12. **D12 Authoring:** initially support the existing script/compiler path and a declared visual-rule subset. Unsupported code remains code-only; no promise of arbitrary two-way conversion. Python host/scheduler reuse remains behind the scenes until its dependency migration is complete.
13. **D13 Research:** first company slice is sourced identity/overview, supported reported statements, original filings/report links and saved research. Derived ratios/TTM require separate formula tests. Customer/supplier graphs, estimates, news/transcripts and other asset classes ship only with verified coverage.
14. **D14 Unknown outcomes:** an ambiguous live submission offers reconciliation and account inspection, not blind resubmission. Acknowledged is not filled. Only confirmed account executions enter its canonical ledger and journal aggregation.
15. **D15 Local lifetime:** cached reads open immediately. One account-scoped catch-up job runs while the local engine is running; changing pages does not start duplicate workers. Closing the engine stops local work unless a separately enabled background service exists. No promise of immediate upstream completeness.
16. **D16 Recovery and promotion:** drafts preserve their destination/return context. Restores pin their original data/code references; missing dependencies remain unavailable. Promotion to paper/demo/live is explicit and capability-gated; a backtest score cannot grant execution permission.

## Object ownership for P01

The local installation/owner owns profiles, books, account identities, chart documents, projects, research and jobs. A Profile references its primary book/account, chart documents and optional data/run/execution bindings. It does not own all global research or reusable projects.

- **Book:** manual, connected or paper. Connected → exactly one canonical external account; paper → exactly one simulated account. Manual has no external account. Trade membership and user annotations belong to the book, while source observations/canonical account executions retain their distinct identities.
- **Account:** canonical platform/provider + server/venue + external identity + demo/live classification; display names are not identity. Reconciliation must verify mappings across providers.
- **Source:** capability manifest, credential reference, scope and measured health. Source observations are separate from canonical executions and user edits.
- **Dataset version:** exact instrument/listing/contract, interval, calendar/timezone, adjustment/price basis, coverage, quality and immutable content identity.
- **Chart document:** saved layout/drawings/attachments and view context; it references data and optional account/run/book, without owning worker lifetime.
- **Project/revision/experiment:** artifact kind and dependencies, frozen source/parameters, dataset/economics/engine/seed manifest, durable job states and reports.
- **Deployment:** frozen revision and parameter set + account/environment/source/instruments + risk/permission/runtime configuration; editing a draft never changes a running deployment.
- **Issuer/listing/fact/document/snapshot:** economic entity and instrument mapping, sourced units/periods and published/available/retrieved times, immutable evidence references. Unknown publication time cannot be used to claim point-in-time backtest support.
- **Job/activity:** destination scope, correlation/idempotency identity, progress/outcome and supported recovery. Each domain remains the owner of its durable records.

P01 must turn these into executable schemas/state machines with cross-language fixtures. P02 owns durable repository migration and restore. P00 does not introduce a second production store.

## People, jobs and first useful outcomes

1. **Independent journal user:** opens New → Journal only, creates a manual book, logs/reviews one trade. Success is a saved record and correct book analytics. No provider, candle feed or execution key is required. Storage failure preserves the draft and offers retry/export.
2. **Statement importer:** selects the destination book/account, maps a file's units/timezone and previews row issues/duplicates. Success is one import receipt and correct records in that book. Invalid rows block full commit; explicit exclusion is disclosed and logged. Reimport is idempotent within the source/account identity.
3. **History-sync user:** binds a read-only source to the verified account's existing book. Success is a cached journal plus visible history coverage and last-result state. Expiry/offline/limited history never erases records; offer reconnect/backfill and reconciliation.
4. **Discretionary practice user:** chooses a paper environment/run and saved dataset. Success is one simulated fill saved once, a restartable session and its own paper journal. Missing history opens the shared picker and returns to that exact run.
5. **Crypto/terminal/broker user:** connects supported data/history capabilities first, then explicitly configures any eligible execution account. Success starts with verified identity/read-only data; actual order capability is certified separately. Unknown submission remains under reconciliation.
6. **Indicator/strategy author:** creates an Indicator or Strategy project without an execution account. Success is a validated revision or saved reproducible baseline report. Failed compile/data validation preserves the draft/manifest and offers correction; an indicator alone has no P&L report.
7. **Research-only user:** searches a supported issuer/listing, reads sourced statements and saves a cited research snapshot. Success does not require a chart, portfolio or trading account. On outage, show saved evidence as stale and offer retry/configuration without inventing metrics.
8. **Automation operator:** creates a supported trigger/action workflow, validates its exact capabilities and activates deliberately. Success is a traceable scoped run and recoverable outcome. Read-only tasks do not acquire order permissions; stop, cancel orders and close positions remain distinct.

## Routes and context

Existing production routes remain compatibility inputs. Missing routes below are design targets, not active features.

- Workspace `/workspace`; existing environment `/workspace/profiles/:profileId`; journal `/workspace/profiles/:profileId/journal`; management `/connections`, `/settings`, `/replay` retain their current profile-relative aliases.
- Existing original chart `/trading` keeps supported profile/instrument/return query links. Future canonical context resolves stored book/account/run/dataset/revision IDs; browser strings never authorize execution.
- Journal-only entry targets a canonical book route `/workspace/books/:bookId`; old journal URLs resolve their mapped book. P02 must preserve old links and ambiguous legacy cases through classification, not redirects to a guessed book.
- Fundamentals `/fundamentals` → `/fundamentals/entities/:entityId` with explicit listing and view query; saved research `/fundamentals/research/:snapshotId`.
- Strategy Builder `/strategy-builder` → `/strategy-builder/projects/:projectId` with build/test views; reports `/strategy-builder/experiments/:experimentId`; study/candidate IDs remain durable references.
- Workflows `/flow` and `/flow/editor/:id` stay compatible. Proposed deployments `/flow/deployments/:deploymentId`; operations link to their owning run/job/account rather than changing a global broker selection.
- Settings `/settings`, Connections & Data `/settings/connections`, original market history `/historify`, Account `/profile`, Developer `/apikey`, System `/admin` remain.

The return context is an internal validated route plus source view/filter/selected-record IDs. Preserve origin and draft identity when visiting data/setup. Resolve a deleted/archived/forbidden target with explanation and safe return, never another user's records. Journal and experiment links pin the correct instrument/time/revision; absence of a verified mapping cannot silently open a default symbol.

## Vocabulary and visible truth

- **Historical study:** inspecting saved prices/facts; no account execution implied.
- **Paper replay:** simulated account and historical clock. **Paper on live data** is a separate later capability.
- **Broker demo:** provider-hosted demo account, distinct from local paper. **Live broker:** a verified real account, still requiring eligible permissions and risk checks before writes.
- **Configured:** saved intent only. **Connected:** observed adapter health with timestamp. **History current through:** known coverage boundary; **Partial:** missing intervals or provider limits remain.
- **Draft / Validated revision:** editable intent versus frozen artifact evidence. **Applied to chart:** visual attachment. **Running deployment:** backend process bound to its original account and version.
- **Submitted / Acknowledged / Part-filled / Filled / Rejected / Cancelled / Unknown:** distinct order states. Cancel-requested does not mean cancelled. Acknowledged does not mean profitable, executed or journaled.
- **Saved:** authoritative persistence acknowledgement. **Unsaved / Interrupted / Stale / Unavailable:** explicit recovery states. Zero differs from missing, including fees, fundamental metrics and observations.

## Bounded launch/support matrix

This is release scope, not current support certification. Each real adapter requires its own access proof and conformance evidence.

- **R1A free local core:** manual books; normalized trade-statement import; original chart over validated local OHLCV; saved paper session and restore; book analytics. Initial simulator verification uses one unlevered BTC/USD spot instrument with explicit units, USD accounting and declared fees/fill policy. Additional instruments require their economic/calendar fixture set. Manual imported records can retain other asset labels without claiming universal price-to-P&L calculation.
- **R1B strategy research:** existing supported script dialect, indicator/strategy projects, pinned local-data baseline reports, bounded parameter studies and declared initial robustness. No arbitrary Python visual conversion or universal engine parity. No bot order permission is implied.
- **R2 connected platform:** certify one crypto, one Windows MT5 terminal bridge and one accessible brokerage adapter in P07–P10. Start with read-only account/history and data capability, then independently verify demo/live writes. MT5 is the first retail candidate; other platforms remain staged. Exact exchange/broker is selected by the P07 access spike against the user's accessible test environment; no unavailable provider is promised. Copying follows verified single-account execution/recovery.
- **R3 company research:** first universe is US listed common-share issuers with verified identity/listing mapping, reported statements and original filings. SEC is the first official filing candidate; Yahoo/yfinance is an optional overview candidate subject to access/coverage/usage evaluation. Missing fields and unsupported point-in-time history remain explicit. Macro, relationship intelligence, estimates and other asset classes are later certified datasets.
- **R4 integrated operation:** supported source refresh/experiment/report actions in Workflows, account-bound bot operations, optional AI, installer/update/recovery/accessibility and maintenance evidence across the published support matrix. No claim of every broker, country or dataset.

Required evidence per release: real supported journeys; deterministic domain/calculation fixtures; compatibility/migration/full restore; offline/restart/error cases; keyboard/narrow layouts; diagnostics without secrets; published coverage and limitations. Candidate labels advance only after adapter-specific tests, not because a vendor appears in a dropdown.

## Source constraints checked for this design

- Myfxbook documents a limited recent-history window, IP-bound sessions and broker-local transaction times. Therefore its successful refresh cannot establish complete account history; backfill/import and explicit coverage remain required. It is a remote service, not a same-PC terminal bridge. [Official API documentation](https://www.myfxbook.com/api).
- MT5's Python history-deal interface retrieves deals over a specified interval or by ticket/position through its terminal integration. The local bridge must report account/terminal identity and errors rather than claiming a connection from saved configuration. [Official function documentation](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py).
- SEC documents submissions and XBRL company data without an API key and does not provide browser CORS support. This design therefore assigns filing retrieval/cache to a compliant backend adapter. [Official SEC API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
- The yfinance project states its unofficial relationship to Yahoo and directs users to data usage terms. It remains an evaluated optional adapter, not a certified free commercial data entitlement or a supplier/client relationship source. [Project documentation](https://ranaroussi.github.io/yfinance/).

## P01 handoff and open implementation work

Product placement and first-use rules above are decided; implementation feasibility is explicitly scoped to downstream spikes. P01 must define executable identity/cardinality, scope, decimal/time, capability, event and revision contracts. P02 must preview and recover migration. P03/P22 implement trade lifecycle/import/reconciliation; P04–P06 dataset-to-chart/paper; P20/P21 strategy research; P13–P16 Fundamentals; P07–P12 certified connected operations; P17 orchestration. P18/P19 verification applies throughout.

P00 design gate accepted by the user on 2 November 2026 after review of the screen-specific layouts/state contracts and three connected storyboards. Next: P01 executable contracts. Production behavior is not certified by the design walkthrough.
