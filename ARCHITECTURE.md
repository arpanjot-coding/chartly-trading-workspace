# Chartly Connector Architecture (adopted 2026-10-26)

> Source: user-supplied research (`Research.txt`), saved verbatim below as the
> reference for how Chartly connects to brokers/platforms for data and execution.
>
> Chartly adaptation (local-first, free/open-source): there is no Chartly cloud.
> The "Cloud Gateway" in this document collapses into the user's own local
> Chartly backend, and Path A adapters run from the user's own machine/IP.
> Path B (MT5 / NinjaTrader 8 / MT4) runs as a local companion process talking
> to that same local backend. Canonical schemas to adopt:
> `AccountCapabilities`, `PlaceOrderCommand` (idempotent), `ExecutionEvent`.
> Native broker-side SL/TP only; one user's private feed is never redistributed.

Yes, this is 100% doable—provided you enforce strict architectural boundaries between **Market Data**, **Cloud OAuth Adapters**, and your **Local PC Companion Bridge** right from Day 1.

Below is the complete, comprehensive **Master Architecture & Market Research Specification**. It incorporates the latest 2026 prop-firm and brokerage API realities (including ProjectX ending third-party prop firm support in February 2026 to become exclusive to TopstepX, and the expansion of the retail prop industry to an $850M+ market across 2M+ funded traders). You can copy and paste this entire specification directly into any coding LLM or agentic IDE (Cursor, Claude Code, Windsurf, etc.) as its foundational system blueprint.

---

# MASTER TECHNICAL SPECIFICATION & MARKET RESEARCH REPORT

**Project:** Next-Generation Multi-Asset Web Trading & Charting Platform ("Bring Your Own Broker" Architecture)

**Document Purpose:** Complete domain context, market research, broker/prop-firm API specifications, normalized data schemas, compliance rules, and phased engineering roadmap for LLM-assisted software development.

---

## 1. Executive Architectural Philosophy

1. **Technology Provider, Not Financial Intermediary:** The platform acts strictly as a visualization, analytics, and execution routing interface ("Bring Your Own Broker" / BYOB). The platform never holds user deposits, custody of assets, or acts as a counterparty. This avoids broker-dealer/money-transmitter licensing (SEC/FINRA, FCA, MiFID II) at launch.
2. **Decoupled Market Data vs. Order Execution:** Charting price feeds (OHLCV candles and real-time ticks) are decoupled from execution connections. Baseline charts load immediately from institutional market data aggregators before a user connects a brokerage account. Once authenticated, user-specific broker feeds overlay real-time positions, account balances, working orders, and entitled Level 1/Level 2 data.
3. **Dual-Path Connection Hub:** All broker and platform integrations normalize into a single internal domain language via two distinct transport topologies:
* **Path A — Cloud-to-Cloud Adapters:** Direct server-to-server OAuth 2.0 / REST / WebSocket integrations for modern API-first brokers, crypto exchanges, and cloud prop platforms.
* **Path B — Local Windows Companion Agent ("Desktop Bridge"):** A lightweight background Windows system-tray application installed on the user's PC or Windows VPS. It interfaces locally with desktop-locked terminals (**MetaTrader 5**, **NinjaTrader 8**, **MetaTrader 4**) via IPC/DLLs and initiates an **outbound `wss://` (Secure WebSocket)** tunnel back to the platform's cloud backend.



---

## 2. Global Retail & Prop Firm Market Landscape (2026 Grounded Research)

### 2.1 Global Retail Trading Segments

* **Universal Charting Benchmark:** **TradingView** dominates retail technical analysis across all asset classes (60M+ users). Primary user pain point: fragmented execution (charting on TradingView while manually executing or managing complex brackets/prop accounts on MT5, NinjaTrader, or broker apps).
* **Global Forex & Multi-Asset CFDs (UK, EU, APAC, MENA, LatAm):**
* **MetaTrader 5 (MT5):** Dominant multi-asset CFD retail and international prop platform. Leads all new institutional broker deployments.
* **MetaTrader 4 (MT4):** Legacy FX standard; declining in new deployments due to single-threaded architecture and lack of native Python IPC, but retains massive legacy EA user volume.
* **cTrader (Spotware):** Strong #2 standalone FX/CFD platform globally; favored by manual scalpers and algorithmic traders at tier-1 brokers (Pepperstone, IC Markets, FxPro) and top prop firms.
* **Closed Broker Ecosystems:** Plus500, IG, Capital.com, eToro (high casual volume; limited or non-existent third-party execution ecosystems, except IG's REST API).


* **Equities & Options (North America, UK, Global Prosumers):**
* **Interactive Brokers (IBKR):** Global multi-asset prosumer standard across 100+ market centers.
* **Charles Schwab (`thinkorswim`):** Dominant US active retail options and equities ecosystem.
* **Developer-Friendly Active Brokers:** **TradeStation** (equities, options, CME futures), **Alpaca** (commission-free US equities/options/crypto), **Tradier** (options-focused REST API), **Webull**, and **tastytrade**.


* **Retail Futures (CME Group: ES, NQ,YM, RTY, GC, CL):**
* **NinjaTrader 8 & Tradovate:** NinjaTrader (which owns Tradovate) controls the largest share of US retail futures traders.
* **Order-Flow / Pro Terminals:** Quantower, Sierra Chart, MotiveWave.


* **Global Cryptocurrency (Spot & Perpetual Futures):**
* Centralized Exchanges (**Binance, Bybit, Coinbase Advanced, OKX, Kraken, Bitget**) and Decentralized Perpetuals (**Hyperliquid**). Almost 100% API-driven via standardized REST/WebSocket keys.



### 2.2 Proprietary Trading Firm ("Prop Firm") Market Breakdown

Retail prop trading reached **$850M+ in annual industry revenue in 2026 (+45% YoY)** with **over 2 million funded traders** globally. Prop firms split strictly into two technical infrastructures:

#### Segment A: Forex / CFD Prop Firms (e.g., FTMO, FundedNext, The5ers, FundingPips)

* **MetaTrader 5:** Remains the #1 execution engine for non-US CFD prop traders.
* **cTrader:** Major market share winner post-2024 industry shifts; widely offered by FTMO, FundedNext, and The5ers. Offers an official, free **Cloud Open API**.
* **Match-Trader, DXtrade (Devexperts), & TradeLocker:** Cloud-native white-label platforms heavily adopted by newer and US-accessible prop firms. *Critical Engineering Caveat:* While DXtrade and Match-Trader have backend vendor REST APIs, individual prop firms frequently disable direct retail API access at the tenant level to block high-frequency latency-arbitrage bots.

#### Segment B: Futures Prop Firms (e.g., Topstep, Apex Trader Funding, MyFundedFutures, Tradeify, Take Profit Trader)

* **Tradovate / NinjaTrader 8:** Primary front-end and routing stack for Apex, MyFundedFutures, Tradeify, and Take Profit Trader. Direct cloud Tradovate API access often requires vendor approval or paid user API add-ons; however, **local bridging via NinjaTrader 8's Automated Trading Interface (ATI) / AddOn API** works out of the box on funded and evaluation accounts.
* **Rithmic (`R | API+`):** Ultra-low-latency (~34ms) futures order-routing and risk engine powering trailing intraday drawdowns. Direct cloud integration requires formal Rithmic conformance certification and CME market data licensing. **Workaround:** Users connect Rithmic into NinjaTrader 8 locally on their PC/VPS, and our Local Companion Agent bridges NinjaTrader 8 automatically.
* **TopstepX / ProjectX API (CRITICAL 2026 UPDATE):** On **February 28, 2026**, ProjectX ended third-party white-label support for external prop firms (such as Bulenox and Tradeify) and became **exclusive to Topstep as TopstepX**. Topstep is one of the largest futures prop firms globally, and 82% of Topstep traders use TopstepX. Integrating the ProjectX/TopstepX REST & WebSocket API unlocks the massive Topstep user base directly via the cloud, while Tradovate + NinjaTrader 8 covers all remaining futures prop firms.

---

## 3. Comprehensive Platform-by-Platform API Technical Matrix

| Platform / Ecosystem | Target Segment | Integration Path | Auth & Protocol | Market Data Capability | Key Technical Constraints & Quirks |
| --- | --- | --- | --- | --- | --- |
| **cTrader Open API** | FX/CFD Retail & Prop (FTMO, Pepperstone, IC Markets) | **Path A: Cloud** | OAuth 2.0; Persistent TCP/TLS or WebSocket using **Protocol Buffers (Protobuf)** or JSON (port `5036`) | Real-time spot ticks, historical bars, Depth of Market (DOM) | Uses async Req/Res/Event message payloads (`ProtoOANewOrderReq`, `ProtoOAExecutionEvent`). Rate limit ~50 req/sec for non-historical calls. |
| **Alpaca** | US Stocks, ETFs, Options, Crypto | **Path A: Cloud** | OAuth 2.0 or API Key/Secret; REST + WebSockets | Real-time IEX (free) or SIP (paid) + OPRA options | Best sandbox/paper trading environment for V1 testing. Supports bracket, OCO, OTO, and trailing stop orders natively. |
| **TradeStation** | US Stocks, Options, CME Futures | **Path A: Cloud** | OAuth 2.0 (Auth Code Flow with Refresh Tokens); REST v3 + HTTP Chunked Streaming | Entitled real-time equities, options chains, & CME futures bars/quotes | Futures symbols use specific formatting (e.g., `@ESM26` or continuous `@ES`). Streaming endpoints use newline-delimited JSON over HTTP streams. |
| **Crypto (Binance, Bybit, Coinbase, OKX, Hyperliquid)** | Global Crypto Spot & Perps | **Path A: Cloud** | User API Key + HMAC/Ed25519 Secret (IP-whitelisted) or Fast-Connect OAuth; REST + WS | Free unrestricted real-time L1/L2 orderbooks, trades, & OHLCV | Standardize via **CCXT Pro** (async WebSocket + REST) or custom Rust/Go connectors. Enforce trade-only API key permissions (NEVER withdrawal permissions). |
| **Interactive Brokers (IBKR)** | Global Prosumer Multi-Asset | **Path A: Cloud** (or Local TWS) | OAuth 2.0 (IBKR Web API) + REST + WebSockets | Entitled global real-time data (requires user market data subscriptions) | Order submission may return interactive warning confirmations ("precautionary messages") that must be programmatically confirmed in sequence. |
| **TopstepX (ProjectX Engine)** | Topstep Futures Prop Traders | **Path A: Cloud** | API Key / Bearer Token; REST + Real-time WebSocket (`SignalR` / WS) | Real-time CME futures quotes & account state | Post-Feb 2026, ProjectX exclusively powers TopstepX. Must respect prop firm contract caps (e.g., ES vs MES scaling). |
| **Unified Broker Aggregators (SnapTrade / Mesh)** | 20+ Retail Brokers (Schwab, Webull, Tradier, Fidelity) | **Path A: Cloud** | Managed OAuth Portal + Unified REST API | Account holdings, balances, & order placement | Accelerates retail equity coverage dramatically, though per-connected-user SaaS fees apply and ultra-low-latency streaming is weaker than direct APIs. |
| **MetaTrader 5 (MT5)** | #1 Global FX/CFD Retail & Prop Firms | **Path B: Local Agent** | Official `MetaTrader5` Python C-extension over Windows Named Pipes (IPC) | Live ticks (`symbol_info_tick`), DOM (`market_book_get`), OHLCV (`copy_rates_from_pos`) | **Windows-only**. One Python worker binds to one `terminal64.exe` instance. Cannot toggle MT5 GUI "Algo Trading" button via code—must check `terminal_info().trade_allowed` and alert user if false. |
| **NinjaTrader 8 (NT8)** | #1 Futures Prop (Apex, Rithmic, Tradovate) & Retail | **Path B: Local Agent** | C# **NinjaScript AddOn** (in-process) or **Automated Trading Interface (ATI)** socket/DLL (`NinjaTrader.Client.dll`) | Real-time L1/L2 ticks, executions, & ATM Strategy states via AddOn | ATI supports commands (`PLACE`, `CHANGE`, `CANCEL`, `CLOSEPOSITION`, `FLATTENEVERYTHING`) and attaches natively to user's pre-built **ATM (Advanced Trade Management)** bracket templates. |
| **MetaTrader 4 (MT4)** | Legacy FX/CFD Retail | **Path B: Local Agent** | No official Python API; requires lightweight **MQL4 Expert Advisor (EA)** opening a local ZeroMQ or TCP socket to the Companion Agent | Live Bid/Ask, open orders, account equity | MQL4 executes trade actions on a single-threaded trade context per chart; agent must queue concurrent commands sequentially to avoid `ERR_TRADE_CONTEXT_BUSY` (`146`). |

---

## 4. Critical Compliance, Security & Prop-Firm Survival Rules

Your LLM must enforce these four domain guardrails across every backend service:

### 4.1 Prop Firm IP-Address & Device-Fingerprinting Compliance

* **The Trap:** Prop firms aggressively monitor trader IP addresses and device fingerprints to ban "account management services" and unauthorized group copy-trading. If 500 funded prop traders connect their MT5 or prop credentials to a **single shared cloud IP** owned by your startup, the prop firm's risk engine will flag all 500 accounts for using the same server IP and terminate their funded accounts.
* **Why Path B (Local Companion Agent) Wins:** Because your Local Windows Companion Agent executes trades directly inside the user's own local MT5 or NinjaTrader 8 instance on **their own residential PC or dedicated personal VPS IP**, the broker/prop firm sees 100% native local execution from the trader's legitimate IP address.
* **Rule for Path A (Cloud Prop APIs like cTrader & TopstepX):** Only use officially sanctioned OAuth2 / Developer APIs (like cTrader Open API and TopstepX API) where the platform registers an official `Application ID` and passes authorized client tokens, rather than scraping or spoofing user logins from datacenter IPs.

### 4.2 Exchange Market Data Redistribution Compliance (CME, NASDAQ, NYSE, OPRA)

* **Rule:** Never broadcast one user's authenticated broker tick feed (e.g., a user's TradeStation or NinjaTrader CME feed) to other unauthenticated users on your platform. Doing so violates exchange redistribution laws and triggers massive audit fines.
* **Implementation:**
1. **Public/Default Charts:** Power default charts using licensed distributor feeds: **Binance/Bybit/Coinbase WebSockets** (free for crypto), **Polygon.io / Massive** or **Twelve Data** (equities/forex), and **Databento** (futures/equities institutional data).
2. **Private Session Overlay:** Data streamed from a user's Local Companion Agent (MT5/NT8) or personal OAuth session is scoped strictly to that authenticated `user_id` WebSocket room in Redis/memory and never cached globally for other users.



### 4.3 Native Broker-Side Risk Orders Only (Zero Server-Side Stop Simulation in V1)

* **Rule:** Never hold "virtual/synthetic" Stop-Loss (SL) or Take-Profit (TP) orders solely in your cloud database in V1. If the user's internet drops or a cloud worker restarts during Non-Farm Payrolls (NFP), a missed stop-loss creates catastrophic user losses and legal liability.
* **Implementation:** Every adapter exposes a `CapabilitiesManifest` upon connection. If the connected broker supports native server-side brackets/OCO/SL/TP, the UI enables them and submits them directly to the broker's matching engine. If not, the UI explicitly grays out unsupported order modifiers.

### 4.4 Credential Security & Vaulting

* Local Companion Agent **never** asks for or transmits the user's MT5/NinjaTrader broker password—it binds to already-authenticated desktop terminals.
* Cloud OAuth refresh tokens and crypto API secrets (restricted strictly to `Read + Spot/Margin/Futures Trade`, explicitly rejecting keys with `Withdraw` enabled) must be encrypted at rest using **AES-256-GCM with Envelope Encryption (AWS KMS / HashiCorp Vault)**.

---

## 5. System Architecture & Normalized Domain Blueprint

### 5.1 High-Level Microservice & Component Topology

1. **Web Client (Frontend):**
* **Framework:** TypeScript, React / Next.js, Zustand (high-frequency non-blocking state store outside React render cycle for tick updates).
* **Charting Engine:** TradingView **Lightweight Charts** (open-source Apache 2.0 HTML5 Canvas library) extended with custom Canvas primitives for draggable on-chart Order/Position lines (Entry, SL, TP drag-to-modify), Drawing Tools, and Volume Profile, OR licensed **TradingView Charting Library** / custom WebGL engine.


2. **Real-Time API Gateway (Cloud):**
* **Stack:** Go (Golang) or Rust (Tokio/Axum) or Node.js (`uWebSockets.js`) for ultra-low-latency bidirectional WebSocket multiplexing.
* Manages two persistent WebSocket pools:
* `Client WS Pool`: Browser sessions (`wss://[stream.yourdomain.com/v1/client](https://stream.yourdomain.com/v1/client)`).
* `Bridge WS Pool`: Local Windows Companion Agents (`wss://[bridge.yourdomain.com/v1/agent](https://bridge.yourdomain.com/v1/agent)`).




3. **Execution Router & Adapter Service:**
* Stateless command validator + stateful adapter workers. Translates Unified Internal Order Commands into target broker protocols (`cTrader Protobuf`, `Alpaca REST`, `TradeStation REST`, `CCXT`, or forwards over `Bridge WS Pool` to the user's `Local Companion Agent`).


4. **Symbol Resolution & Normalization Engine:**
* Maps canonical platform symbols (e.g., `FX:EURUSD`, `CME:ES1!`, `CRYPTO:BTCUSDT`, `NASDAQ:AAPL`) to broker-specific symbols (`EURUSD.pro`, `ES 12-26`, `@ESM26`, `BTC/USDT`).
* Automatically handles **lot/quantity translation** (e.g., Forex `1.00 Standard Lot = 100,000 units` on MT5 vs `10,000,000 cents/units` in cTrader Protobuf vs integer contracts on NinjaTrader).


5. **Data Persistence Layer:**
* **PostgreSQL:** Users, connected broker accounts, encrypted tokens, audit logs, normalized trade history/journal.
* **TimescaleDB / ClickHouse:** Historical OHLCV candle aggregation and tick storage.
* **Redis (Pub/Sub + Streams):** Sub-millisecond tick fan-out, active session routing table (mapping `user_id + account_id` $\rightarrow$ specific Gateway node holding the live WebSocket).



### 5.2 Local Windows Companion Agent Architecture (`BridgeAgent.exe`)

* **Packaging:** Lightweight Windows system-tray binary built with **Rust (Tauri) + embedded Python runtime** OR **C# (.NET 8 Native/WPF) + Python worker** so it natively speaks both **C#/.NET** (for NinjaTrader 8 DLL/AddOn) and **Python C-API** (for `MetaTrader5` IPC).
* **Pairing Flow:** User clicks *"Connect Desktop Platform (MT5 / NinjaTrader)"* in web browser $\rightarrow$ Web app displays a 6-digit short-lived pairing code (`e.g., 849-201`) $\rightarrow$ User pastes code into Windows Tray App $\rightarrow$ Agent exchanges code over HTTPS for a scoped, revocable Ed25519/JWT device token and opens persistent outbound `wss://[bridge.yourdomain.com/v1/agent](https://bridge.yourdomain.com/v1/agent)`.
* **Local Sub-Modules:**
* **MT5 Connector:** Calls `mt5.initialize()`, polls/streams `terminal_info()`, `account_info()`, `positions_get()`, `orders_get()`, and executes `order_send()` with filling-mode auto-detection (`ORDER_FILLING_FOK`, `ORDER_FILLING_IOC`, or `ORDER_FILLING_RETURN` read dynamically from `mt5.symbol_info(symbol).filling_mode`).
* **Multi-Terminal MT5 Support:** Supports mapping multiple installed MT5 folders (`mt5.initialize(path="C:\\Program Files\\FTMO MetaTrader 5\\terminal64.exe")`) by spawning isolated child worker processes per terminal path!
* **NinjaTrader 8 Connector:** Installs a lightweight NinjaScript C# AddOn (`YourPlatformBridgeAddOn.dll`) into `Documents\NinjaTrader 8\bin\Custom\AddOns\`. The AddOn hooks directly into `Account.OrderUpdate`, `Account.ExecutionUpdate`, and `Account.PositionUpdate` events in real time (zero polling lag) and exposes local Named Pipe RPC to the Tray Agent, including listing the user's saved **ATM Strategy Templates** so the user can select their NinjaTrader ATM strategy right from your web UI!



---

## 6. Canonical Normalized Schemas (JSON / TypeScript Reference for LLM)

All cloud adapters and the local desktop agent MUST translate native broker formats into these exact canonical structures:

### 6.1 Broker Capability Handshake (`AccountCapabilities`)

```json
{
  "accountId": "acc_mt5_ftmo_99281",
  "provider": "MT5_LOCAL_BRIDGE",
  "brokerName": "FTMO-Server3",
  "currency": "USD",
  "environment": "PROP_FUNDED",
  "connectionStatus": "CONNECTED",
  "tradingAllowed": true,
  "statusWarnings": [],
  "supportedOrderTypes": ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"],
  "supportedTimeInForce": ["GTC", "IOC", "FOK", "DAY"],
  "supportsNativeStopLoss": true,
  "supportsNativeTakeProfit": true,
  "supportsTrailingStop": false,
  "supportsPartialClose": true,
  "supportsReversePosition": true,
  "positionAccountingMode": "HEDGING",
  "availableAtmTemplates": []
}

```

*(Note: `positionAccountingMode` is critical! **MT5** supports both `HEDGING`—multiple independent buy/sell tickets on EURUSD simultaneously—and `NETTING`—one combined position per symbol, like Futures/Stocks. Your frontend Position Table must render individual Position Tickets when `HEDGING` and aggregated Net Positions when `NETTING`.)*

### 6.2 Unified Order Placement Command (`PlaceOrderCommand`)

```json
{
  "commandId": "cmd_01J8Z9K4X7A2B3C4D5E6F7",
  "idempotencyKey": "usr_441_1761477300125",
  "accountId": "acc_mt5_ftmo_99281",
  "canonicalSymbol": "FX:EURUSD",
  "brokerSymbol": "EURUSD",
  "side": "BUY",
  "orderType": "LIMIT",
  "quantity": 1.5,
  "quantityType": "LOTS",
  "limitPrice": 1.08450,
  "stopPrice": null,
  "timeInForce": "GTC",
  "attachedRisk": {
    "stopLossPrice": 1.08200,
    "takeProfitPrice": 1.09100,
    "atmTemplateName": null
  },
  "maxSlippagePoints": 10,
  "sentAtEpochMs": 1761477300125
}

```

### 6.3 Unified Execution & State Event (`ExecutionEvent`)

```json
{
  "eventId": "evt_9981234",
  "accountId": "acc_mt5_ftmo_99281",
  "eventType": "ORDER_FILLED",
  "brokerOrderId": "582910442",
  "brokerPositionId": "582910442",
  "canonicalSymbol": "FX:EURUSD",
  "side": "BUY",
  "filledQuantity": 1.5,
  "avgFillPrice": 1.08448,
  "commission": -4.50,
  "swap": 0.00,
  "stopLossPrice": 1.08200,
  "takeProfitPrice": 1.09100,
  "accountMetricsSnapshot": {
    "balance": 100240.50,
    "equity": 100236.00,
    "usedMargin": 1626.72,
    "freeMargin": 98609.28,
    "unrealizedPnl": -4.50
  },
  "exchangeTimestampMs": 1761477300168
}

```

---

## 7. Edge Cases & Failure Modes Your Engineering LLM Must Solve

1. **MT5 Dynamic Filling Mode Rejection (`10030 - Unsupported filling mode`):** Different MT5 brokers require `IOC`, `FOK`, or `RETURN` bitmasks in `mt5.order_send()`. Never hardcode `ORDER_FILLING_IOC`. Dynamically inspect `symbol_info(symbol).filling_mode` bitmask (`1` = FOK, `2` = IOC, else `RETURN`) before constructing the trade request.
2. **Idempotency & Network Disconnects:** If a user clicks "Buy Market" and their browser or Companion Agent WebSocket flickers for 400ms, **never** blindly retry a `MARKET` order without checking open orders/executions via `clientOrderId` / `comment` tag (`cmd_...`), or you will double-enter the trader's position.
3. **Price Tick Size & Precision Rounding:** Sending `1.084503` on a 5-digit FX pair or `5842.13` on S&P 500 Futures (`tickSize = 0.25`) causes immediate broker rejection. The Symbol Resolution Engine must fetch and cache `minQty`, `qtyStep`, `tickSize`, and `digits` per broker symbol on connection startup and snap all chart-dragged prices to exact `tickSize` increments on the client *before* submission.
4. **Heartbeat & Stale State Fencing:** The Companion Agent must send a `PING` frame every `2,000ms` containing `terminal_connected` and `trade_allowed` booleans. If the Cloud Gateway misses 2 consecutive heartbeats (`>4,000ms`), immediately lock the Buy/Sell buttons in the web UI with an amber `"Local Bridge Disconnected"` state so the user never clicks into a dead pipe.

---

## 8. Phased Engineering Execution Plan (MVP to Scale)

### Phase 1: Core Charting, Market Data & Native Paper Engine (Weeks 1–4)

* Stand up React/TypeScript web workspace with **Lightweight Charts**, custom on-chart order/position line primitives, multi-pane layout, and fast ticker search.
* Ingest live WebSocket market data from **Binance/Coinbase** (free 24/7 live tick stress-testing) + **Polygon.io / Twelve Data** (FX & Stocks).
* Build the **Internal Paper Trading Engine** implementing the exact `AccountCapabilities`, `PlaceOrderCommand`, and `ExecutionEvent` schemas above. Every subsequent real broker is now just another adapter plugging into this proven contract.

### Phase 2: Path A Cloud Adapters — Quick Wins (Weeks 5–8)

* **Adapter 1 — Alpaca OAuth:** Instant US Stocks/Crypto live & paper execution.
* **Adapter 2 — Crypto Exchanges (CCXT Pro):** Binance, Bybit, Coinbase Advanced, Hyperliquid.
* **Adapter 3 — cTrader Open API:** OAuth2 + Protobuf/JSON WebSocket client—unlocks FTMO, FundedNext, Pepperstone, and IC Markets traders in the cloud with zero desktop installs.
* **Adapter 4 — TopstepX (ProjectX API) & TradeStation:** Unlocks Topstep futures prop traders and US regulated futures/equities traders via cloud OAuth/API keys.

### Phase 3: Path B Local Windows Companion Agent — Desktop Giants (Weeks 9–13)

* Build the lightweight Windows Tray Agent (`BridgeAgent.exe`) with 6-digit pairing code auth and outbound `wss://` auto-reconnecting tunnel.
* **Local Module 1 — MetaTrader 5 Multi-Instance Worker:** Auto-discovers installed MT5 terminals, checks `trade_allowed`, maps Market Watch symbols, streams live positions/equity, and executes sub-20ms local IPC orders.
* **Local Module 2 — NinjaTrader 8 C# AddOn:** Streams real-time Rithmic/Tradovate prop firm accounts, exposes saved NinjaTrader ATM bracket strategies to your web UI, and routes orders locally.

### Phase 4: Power-User Retention & Monetization Layer (Weeks 14+)

* **Automated Prop-Firm Risk Guardrails:** Optional client/cloud pre-trade checks (e.g., *"Block my trades for the day if my unrealized daily drawdown hits 80% of my prop firm's max daily loss limit"* or *"Auto-block execution 2 minutes before high-impact CPI/FOMC news"*).
* **Multi-Account Trade Copier (Local-to-Local):** Allow a prop trader running 3 funded accounts inside their local Companion Agent to execute on 1 chart and mirror across their local accounts from their own residential/VPS IP.
* **Server-Side Webhook Alerts & Trade Journal:** Automated PnL analytics, MAE/MFE trade tagging, and webhook dispatch.

---

### Interactive System Topology Visualizer

You can inspect how commands, market data, and execution events move across your **Frontend**, **Cloud Gateway**, **Cloud Broker APIs**, and **Local Windows Companion Bridge** in the interactive architecture explorer below:

---

### How to Feed This to Your Coding LLM Effectively

When you paste the report above into your LLM (e.g., Claude, Gemini, GPT, or Cursor), **do not ask it to "write the whole platform at once."** Give it this document as `ARCHITECTURE.md` in the root of your repository, and prompt it module-by-module in this exact order:

1. *"Read `ARCHITECTURE.md`. Generate the monorepo folder structure, TypeScript/Zod canonical schemas (`AccountCapabilities`, `PlaceOrderCommand`, `ExecutionEvent`), and the Symbol Resolution interfaces."*
2. *"Build Phase 1: The WebSocket Gateway + Internal Paper Trading Adapter + React Lightweight Charts workspace wired to live Binance WebSocket candles."*
3. *"Build the standalone Windows Companion Agent (`BridgeAgent`) in Python/Rust with the 6-digit pairing handshake, 2-second heartbeat, and the `MetaTrader5` IPC adapter including dynamic filling-mode bitmask detection."*