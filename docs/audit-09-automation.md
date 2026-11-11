# Audit 09 — Automation, AI and operational workflows

Date: 2 November 2026. Method: bounded read-only source inspection. No workflows activated, scripts run, keys accessed, orders submitted or settings changed. No live-provider or end-to-end automation certification is implied.

## Assessment

Chartly contains substantial advanced automation and operational engineering. These surfaces serve a trader who already has a verified execution connection and wants repeatable execution or diagnostics. They should support the journal/chart/practice product, rather than define the first-run experience. The biggest integration issue is that automation runs in the older user/API-key/broker context, while the new profiles, destinations and local journal form a separate product model.

## Section coverage

- **Flow:** visual editor, saved workflows, activation, trigger registration, execution status, approvals and execution logs. Source reviewed: `frontend/src/pages/flow/FlowIndex.tsx`, `FlowEditor.tsx`, `blueprints/flow.py`, `database/flow_db.py`, `services/flow_executor_service.py`.
- **Python strategies:** separate process host, scheduling, stop/start/deletion concurrency controls, logs, shutdown/restore handling. Source reviewed: `blueprints/python_strategy.py` and frontend index/scheduling references. This is user-code hosting, not an isolated historical paper-trading simulator.
- **Strategy module:** guided strategies, runtime controls and execution lifecycle. Detailed fill/recovery assessment belongs to audit 06; these existing mechanisms should be reused rather than replaced by another independent order engine.
- **Platforms and Chartink:** external alert/webhook configuration for TradingView, GoCharting and Chartink. These are alert-trigger integrations, distinct from an MT5/NinjaTrader local data/execution bridge (`frontend/src/pages/Platforms.tsx:10–35`, `:92–96`).
- **AI Agent:** optional model/provider setup, Chartly tool key, conversation surface, explicit trading capability and confirmation flows. Source reviewed: `frontend/src/pages/agent/AgentIndex.tsx`, `AgentChat.tsx`, `components/agent/AgentSetupGate.tsx`, `blueprints/agent.py`.
- **API access and Action Center:** global auto/semi-auto execution mode, pending approvals and broker-response state. Source reviewed: `frontend/src/pages/ApiKey.tsx`, `ActionCenter.tsx`, `blueprints/apikey.py`, `database/action_center_db.py`, `services/action_center_service.py`.
- **Operations:** Admin routes cover freeze quantities, calendars, sessions, security, traffic, latency, diagnostics, model configuration and remote MCP. Logs and Health monitor provide deeper system observations (`frontend/src/pages/admin/AdminIndex.tsx:36–110`, `pages/LogsIndex.tsx`, `pages/HealthMonitor.tsx`). These are maintenance surfaces, not evidence that profile connectors have measured health.

## Five priorities

### 1. Automation execution identity is separate from trading profile identity

Evidence: `blueprints/flow.py:28–33` resolves the API key from the current session username; activation obtains that key (`:526`, `:582`, `:608`) and trigger registration receives it. Flow execution constructs the client using the key (`services/flow_executor_service.py:4974–4977`). Its market subscription owner resolves username/broker from the same credential (`:369–377`). No `profileId`/`portfolioId` reference was found in the inspected Flow, Python-strategy, Agent or Chartink page families or Flow blueprint.

Impact: the user may enter automation from a profile-led product and assume the selected profile's sources, copy destinations and drawdown settings apply. The inspected execution path does not establish that relationship. This is a scope/contract gap, not proof of an authorization vulnerability.

Recommendation: every executable automation has a verified execution binding: profile, account, instrument mapping, environment, allowed capabilities and version. Display it on the workflow card, editor header, run preview, approvals and activity. A workflow without binding remains a draft. Keep legacy automation explicitly labeled until migrated.

Acceptance: moving between profiles never silently changes an activated workflow's account. A run's account can be traced from trigger through command, broker response and journal event. Disabled/unavailable bindings block submission with a recovery action.

### 2. Execution permission is fragmented across global API mode, workflow state and AI settings

Evidence: `frontend/src/pages/ApiKey.tsx:49` initializes the mode as `auto`, and `blueprints/apikey.py:54` also falls back to `auto`. The API page explains that Semi-Auto queues API orders for manual approval (`ApiKey.tsx:203–204`). Flow activation is a separate action (`FlowIndex.tsx:88–103`). AI configuration independently defaults trading disabled (`AgentSetupGate.tsx:58`); AI chat passes its setting (`AgentChat.tsx:111`) and handles confirmation frames (`:119–126`). Backend capability code explicitly narrows the request against server policy (`blueprints/agent.py:2300`, `:2354–2367`).

Impact: “off”, “manual”, “semi-auto”, “analyze” and “approval” can mean different things in different surfaces. New users should not have to infer whether a saved workflow may submit immediately from a setting on a developer key page.

Recommendation: one visible execution summary, with distinct concepts: Read-only / Simulation / Broker execution; Draft / Armed; Approval required / Automatic. Keep backend checks authoritative and preserve AI confirmation controls. Put the relevant current policy beside the activation action; show exactly which routes it covers. Prefer preview/demo-first onboarding before automatic execution.

Acceptance: activation preview shows destination, permissions, approval policy, schedule and order limits; AI trading disabled prevents execution regardless of prompt; historical practice cannot reach these live endpoints. Do not claim the global Semi-Auto switch governs arbitrary Python code unless enforced by its actual execution path.

### 3. Approval, submission and fill need one consistent activity vocabulary

Existing strength: Action Center explicitly models an approved-but-unconfirmed send (`ActionCenter.tsx:78–110`). Its timeout is an investigation prompt, not proof that submission failed. `database/action_center_db.py:284–306` uses a conditional claim so only one caller sends an approved order; `:323–359` returns an approval to pending only under specified never-sent conditions. The page tells the user to inspect the broker book rather than duplicate an unknown order (`ActionCenter.tsx:750`). Preserve this careful behavior.

Gap: the page still has fallback success copy “Order approved and executed” (`ActionCenter.tsx:285`) and top-level tabs/statistics group by approval state (`:521–525`, `:563`), while actual broker state is separate. Approval is not proof of a fill.

Recommendation: activity timeline is Trigger received → Validated → Awaiting approval → Claimed → Submitted → Acknowledged → Partially filled / Filled / Rejected / Cancelled / Unknown. The user can filter by run/decision/account and open the same event from Flow, Agent and Journal. Avoid a generic retry button for uncertain submissions.

Acceptance: a broker response timeout remains Unknown without duplicate submission; one approval produces at most one claim; a rejection is never shown as completed trading; partial fills remain visible until reconciled. Test ambiguous failure and reconnect paths, not just success.

### 4. Scheduling and logs retain regional assumptions

Evidence: `blueprints/python_strategy.py:64` defines Asia/Kolkata; scheduler initialization uses IST (`:312–325`) and timestamps/log names use it (`:564–580`, `:823–825`). Action Center exposes `created_at_ist` and `approved_at_ist` (`ActionCenter.tsx:65`; `services/action_center_service.py:53`). Admin's initial cards are oriented to F&O freeze quantities and a seven-exchange timing catalogue (`AdminIndex.tsx:36–62`).

Impact: global FX/futures users may misread run and approval time, especially around daylight-saving transitions, unless the timezone is explicit. A profile timezone does not automatically control these older services.

Recommendation: persist UTC event times and an explicit schedule timezone/calendar; display profile timezone with an exchange-time alternative. Show next scheduled execution as a concrete date/time/zone before arming, including missed-run behavior. Keep regional features as optional market-specific capabilities.

Acceptance: a London schedule remains tied to London wall time across DST; UTC logs preserve event order; missing holidays/calendar data is visible; late start and stop policies are documented and tested.

### 5. Advanced setup and diagnostics should be contextual and optional

Evidence: Agent setup requires a tested model and a Chartly API key (`AgentSetupGate.tsx:30–32`, `:82–95`); its copy supports a local provider and encrypted storage. `AgentIndex.tsx:61–92` shares a setup gate and loading state across surfaces. Platform webhooks require API-key setup (`Platforms.tsx:92–96`). Admin includes Agent Config and remote MCP (`AdminIndex.tsx:97–110`); logs separately expose health, traffic, security and latency (`LogsIndex.tsx`).

Impact: these are valid advanced jobs, but they can make free journaling look like it requires an AI subscription, API setup or server operation. A configured AI model should remain optional; failed configuration checks should not be mistaken for proof that no model exists (`AgentIndex.tsx:16–18` describes that choice).

Recommendation: Tools → Automate contains Flow, scripts, alert integrations and Approvals. Settings → Advanced contains API access, AI providers, system logs and remote MCP. Show a concise prerequisite list on each tool before setup. A chart/journal error opens a targeted diagnostic view already scoped to the failing subsystem. For AI, show configured-but-unreachable separately from unconfigured, and preserve read-only mode by default.

Acceptance: journal, dataset import and practice can be completed with AI unconfigured; credentials are never required merely to inspect local notes. A failed automation links to its run log, source and execution binding; a support export previews/redacts sensitive material rather than making users copy raw logs.

## Existing engineering to preserve

- Flow keys are encrypted in storage and decrypted through a helper (`database/flow_db.py:59–77`, `:96`, `:266–268`). This source fact does not certify the whole key lifecycle.
- Python host has explicit process and restore concurrency controls, shutdown refusal and durable running-state handling (`blueprints/python_strategy.py:67–118`); scheduling bounds late jobs rather than silently treating all misfires the same (`:255–268`).
- Flow records last execution state and links approvals from its own hub (`FlowIndex.tsx:282–286`, `:661–683`).
- Action Center preserves ambiguous submission state and has a conditional execution claim.
- AI server ownership checks return indistinguishable not-found responses for unavailable conversations (`blueprints/agent.py:14`, `:302`); approval decisions are recorded before run resume (`:2869`). These are useful patterns to extend to normalized profile/run events.
- Diagnostics and health surfaces already exist. Build product recovery entry points to them rather than another monitoring dashboard.

## Target wireframe journey

1. Choose Automate from an existing verified account/profile context.
2. Choose Visual workflow, Script, External alert or AI assistance; show prerequisites and current permissions.
3. Draft logic with a persistent header: profile, account, environment and approval policy.
4. Validate and inspect a dry-run/preview with normalized orders and expected limitations.
5. Arm explicitly; display trigger, next schedule, allowed scope and stop behavior.
6. Inspect one activity timeline. Pending approvals show exact account and command; uncertain sends link to reconciliation.
7. Stop automation independently of closing positions; make that distinction explicit.
8. Reconcile fills into the journal, then review strategy execution against intent.

These are proposed requirements. The complete profile-scoped automation-to-journal journey was not found or executed in this bounded review.
