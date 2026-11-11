# P17-T01 — Retained automation inventory and migration owners

Inventoried 4 November 2026 from the working tree.

| Surface | Location | State | Migration owner / prerequisite |
| --- | --- | --- | --- |
| Flow editor | `frontend/src/pages/flow/`, `blueprints/flow.py` | Retained legacy visual workflows | P17 workflow actions (this package) — nodes call owning domain APIs, results stored as references only |
| Agent chat/config | `frontend/src/pages/agent/`, `blueprints/agent.py` | Retained legacy assistant | P17-T07 read-only cited boundary (`services/support_tools.py`); legacy agent keeps its own config until migrated |
| Platform alerts | `blueprints/alerts.py` | Retained | Bind to immutable account/environment at arm time (P17-T04 pattern in deployments) |
| Python strategy host | `blueprints/python_strategy.py`, `strategy_module.py` | Existing versioned runtime | Deployments (`services/deployments.py`) drive it via injected runtime; scheduler extraction only after saved-work migration passes |
| Strategy artifacts/deploy | P20 workspace + `blueprints/strategy_artifacts.py` | Current | Deployment records reference exact artifact revision + checksum |

Boundaries preserved: retired-product routes stay retired; existing
saved flows/alerts keep working under their legacy labels until each
is migrated; nothing here rewrites saved user work. Module enablement
is independent — journal/chart/research-only setups never require
Flow, Agent or AI configuration (proven for AI by test).
