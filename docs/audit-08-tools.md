# Audit 08 — Research tools, options lab and strategy construction

Reviewed 2 November 2026. Source inspection only; no broker requests, orders, user-data changes or new tests. Coverage includes the tool registry and page entry/data flows for portfolio backtest/SIP/analyzer, Option Chain, IV Chart, OI Tracker/Range/Profile, Max Pain, Straddle Chart/PnL, Vol Surface, GEX, Strike Profile, Gamma Density, IV Smile, Arbitrage and Strategy Builder/Portfolio. Representative backend routes, storage and pricing-source services were inspected. This is not numerical certification of every analytical model or live-provider compatibility testing.

## Assessment

These are real analytical and execution integrations, not just empty screens. They are valuable specialist modules, but should support the journal/chart/practice journey rather than define it. Their coverage and assumptions are not globally interchangeable: some are expressly Indian cash-equity research; others derive options analytics from a connected broker's instruments, expiries, premiums and OI. Keep those strengths and label the prerequisites instead of implying universal free coverage.

## Family inventory and source evidence

- **Portfolio Backtester:** weighted allocation, rebalance rules, benchmark, itemized charges, broker/local history, result page and tearsheet. `frontend/src/pages/PortfolioBacktester.tsx:38`, `:59`, `:141`, `:156`, `:173`; `portfolio/data.py:289` accepts explicitly `db`/`api` and reads Historify at `:328`. Its backend explicitly limits holdings to NSE/BSE cash equity/ETFs (`restx_api/portfolio.py:33`, `:37`). This is useful offline research with populated local history; it is not the historical manual-order simulator.
- **SIP Backtester:** contribution frequency, step-up, timing and benchmark/cost choices. `frontend/src/pages/SipBacktester.tsx:35`, `:53`, `:94`, `:109`, `:128`. It offers local Historify and broker data (`:325–326`), while current exchange/cost model is Indian equity. This belongs under regional allocation research rather than the generic replay label.
- **Portfolio Analyzer:** actual broker holdings combined with historical risk/concentration analysis. It correctly distinguishes today's holdings backcast from the account's realized performance in its source explanation (`frontend/src/pages/PortfolioAnalyzer.tsx:1–11`); account/API prerequisite and NIFTY benchmark are at `:73–94`. Currency display is explicitly INR (`:36`). It needs a holdings connection; it is not a replacement journal.
- **Option Chain:** broker/API-key and shared live-chain orchestration (`frontend/src/pages/OptionChain.tsx:543`, `:608`), with broker-supported venue selection (`:586`). This supplies instrument selection and pricing context to option execution/research.
- **IV/Greeks and volatility:** IV Chart has IV/delta/theta/vega/gamma series (`frontend/src/pages/IVChart.tsx:39`); IV Smile and Vol Surface have their own analytical API routes (`blueprints/ivsmile.py:24`, `blueprints/vol_surface.py:19`). Surface explicitly needs broker/session data (`vol_surface.py:21–29`). Price-only candle import cannot reconstruct a full expired option chain and its historical OI.
- **OI family:** OI Tracker and Max Pain share authenticated routes (`blueprints/oitracker.py:25`, `:77`); OI Profile adds limited supported intervals (`blueprints/oiprofile.py:98–122`). OI Range is a separate strike-range view; all use capability-derived option venues. Useful specialist views, but prerequisites include valid OI, expiry and contract metadata, not just OHLCV.
- **Gamma family:** GEX uses Black-76-derived gamma and the convention call exposure minus put exposure (`services/gex_service.py:2–6`, `:25–28`, `:100`, `:124`); Gamma Density models intraday and expiry horizons (`services/gamma_density_service.py:13–19`, `:46`, `:262–277`). Strike Profile is a strike/expiry exposure view. These are model-derived exposures, not direct observation of every dealer's position. The sign convention, units, inputs and approximation should be visible in the analytical explanation.
- **Straddle family:** Straddle Chart fetches broker-backed series (`blueprints/straddle_chart.py:20–30`); Straddle PnL has a separate simulation endpoint (`blueprints/custom_straddle.py:21–33`). Do not confuse an automatic straddle-adjustment simulation with a generic replay paper account. Keep its entry/cost/adjustment assumptions attached to its output.
- **Arbitrage:** explicitly NFO/MCX universe (`frontend/src/pages/Arbitrage.tsx:191`, `:428`), with a real basket-order call (`:398`). That is executable specialist functionality, not harmless journal analysis. A two-leg basket should show each leg's actual outcome and resulting residual exposure; a spread opportunity does not establish atomic fill certainty.
- **Strategy Builder / Portfolio:** real broker chain/expiry/margin/quote integrations, normalized saved identity hydration and an execution dialog (`frontend/src/pages/StrategyBuilder.tsx:120–132`, `:699–705`, `:1174–1278`, `:1613–1654`, `:1868`). Saved leg snapshots are server-persisted as JSON in strategy portfolio storage (`database/strategy_portfolio_db.py:43–52`, `:113–159`). Portfolio has MyTrades and Simulation watchlists, not profile practice-run ledgers (`frontend/src/api/strategy-portfolio.ts:3`; `StrategyPortfolio.tsx:287–319`). A saved simulated option basket is distinct from a replay run and distinct from verified fills.

## Five workflow priorities

### 1. Local historical research is unnecessarily coupled to trading access

Even after selecting local history, the portfolio/SIP frontend requires an API key (`PortfolioBacktester.tsx:174–176`; `SipBacktester.tsx:85–87`). Routes also sit behind broker-gated Layout (`frontend/src/App.tsx:215` and `frontend/src/components/layout/Layout.tsx:13–22`). Backend does support choosing local data separately (`portfolio/data.py:328`).

Separate local-app authentication from broker connection. Data-library research should require a usable dataset, not an execution account. Retain broker requirements only for operations that genuinely need account data or live provider calls. API authentication alone is not inherently a paid-data dependency; explain those separately.

### 2. The catalogue leads with automation rather than the core user job

`frontend/src/pages/Tools.tsx:68` orders Automate before Core trading and Options Lab. Its first description says “Start here when you want Chartly to act for you” (`:13`). Meanwhile the product's desired first outcome is journaling, chart study or practice.

Use “Research” as supporting navigation with tasks: Compare allocations, Inspect options, Build a strategy. Put automation in an explicit advanced area. Keep existing specialist routes, but each tool entry should explain market support, required source and whether it can submit orders. Capability matching should determine availability, not a blanket “tools available” count.

### 3. Tools do not carry research context back to the core journal

Searches across portfolio results/analyzer, Strategy Builder/Portfolio and GEX found no `traderDb`, `profileId`, `runId` or journal handoff. Strategy Portfolio separately stores scenario snapshots; the journal uses another model. Users must mentally reconnect research, decisions and outcomes.

Add “Save research to profile” and “Attach to trade” using immutable evidence snapshots: instrument/expiry, source timestamp, model settings, scenario legs, intended risk and rationale. A hypothetical output must remain labeled research; a MyTrades watchlist entry is not automatically a verified broker execution. Only normalized execution events create factual fills.

### 4. Research results need durable experiment identity and reproducibility

Portfolio and SIP stores explicitly retain only the latest result in memory (`frontend/src/stores/portfolioBacktestStore.ts:4–8`, `:17`; `sipBacktestStore.ts:4–8`, `:17`). The anti-staleness motivation is sound, but refresh destroys the current experiment and a direct result link cannot recover it.

Persist an explicitly dated experiment containing inputs, dataset version, engine/model version and results. Display the saved run's time and coverage rather than silently refreshing its interpretation. Allow Compare runs and Attach research. Keep backtests separate from live account equity.

### 5. Shared capability and analytical state should replace repeated defaults

`frontend/src/hooks/useSupportedExchanges.ts:36–39` falls back to a broad venue set while capabilities load, and `:105–109` chooses NFO/NSE defaults even if no appropriate venue exists. Each options page separately resets underlying/expiry and handles discovery; e.g. GEX retains defaults on underlying-fetch failure (`GEXDashboard.tsx:86–117`) and clears expiry failures without a persistent explanation (`:123–149`).

Use a shared research context: source/account, eligible instrument, expiry, snapshot freshness and capability reason. Distinguish “loading capabilities” from “no supported market”; show a recovery action for expired login, unavailable chain or missing OI. Do not present assumed defaults as discovered provider support. Each computed panel should identify inputs and limitations; a model with invalid premiums should not appear as an authoritative market fact merely because a curve can be drawn.

## Proposed supporting research journey

Profile or journal review → choose research question → select eligible source/dataset → inspect coverage/model assumptions → run research → save dated experiment → attach rationale and chart evidence to a planned trade or practice goal → execute in an explicit mode → import/reconcile actual outcomes → review the original hypothesis.

Wireframe: one scope strip (profile, source, instrument, expiry/date); one principal research view; an adjacent Interpretation/Notes area; one Save research action. Execution is a separate explicit ticket. Advanced numeric controls remain expandable. Options pages can retain separate deep links while sharing scope and saved evidence.

## Acceptance gates

1. A user with local equity history can run supported portfolio/SIP research without connecting a live broker, with missing data clearly listed.
2. A broker with no eligible option venue sees a clear unavailable state rather than a default NFO request.
3. Saving and reopening an experiment restores exact assumptions, dataset identity and results.
4. Research attaches to the selected profile/trade without becoming a factual fill.
5. Every execution-capable research tool identifies mode and destination, and reports per-leg outcomes.
6. Market-specific labels and models remain explicit; global support is not inferred from a generic tool title.
