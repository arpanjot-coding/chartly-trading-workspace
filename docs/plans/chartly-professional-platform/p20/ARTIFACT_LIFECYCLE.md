# P20-T01 — Artifact types and lifecycle specification

Status: specified 4 November 2026 against the P01 v1 contracts
(`ArtifactProject`, `ArtifactRevision`, `ParameterSet`,
`IndicatorAttachment`, `Experiment`, `DeploymentRevision`). Executable
fixtures and validators: `services/strategy_artifacts.py` +
`test/test_strategy_artifacts.py`. No Builder UI is implied by this
document (SB-01 storage/UI is P20-T02+).

## Kinds and permitted actions

| Action | Indicator | Strategy |
|---|---|---|
| Author/edit draft | yes | yes |
| Validate + create immutable revision | yes | yes |
| Preview on saved data | yes (values/plots) | via experiment only |
| Apply to chart (IndicatorAttachment) | yes | no — strategies attach via deployment (P17/P11), never as studies |
| Run experiment (P21) | no P&L claim; reference-value checks only | yes |
| Deploy as bot | no | later, via DeploymentRevision + P11 only |

Applying an indicator to a chart never arms execution. A strategy gains
trading meaning only through an experiment or an explicitly armed
deployment; a good report never authorizes trading.

## Languages (initial support)

- `openscript` — the existing installed compiler/runtime. Code artifacts
  keep their source text; the Rule Builder does not promise conversion.
- `chartly-rules-v1` — the JSON rule document defined below; the only
  form the Rule Builder authors. Anything outside its declared subset is
  code-only and labelled as such; conversion is never lossy-silent.

## chartly-rules-v1 source document

```json
{
  "format": "chartly-rules-v1",
  "kind": "indicator" | "strategy",
  "inputs": [{"name": "length", "type": "integer", "default": "14",
              "min": "1", "max": "500", "unit": "bars"}],
  "outputs": [{"name": "value", "plot": "line"}],
  "policy": {"warmupBars": 14, "barCloseOnly": true, "missingData": "skip-bar"},
  "rules": [ ... subset operations, validated structurally in T01 ... ]
}
```

- Input types: `integer`, `decimal`, `boolean`, `source` (ohlc field).
  Defaults and bounds are exact decimal text; a default outside its
  bounds is invalid.
- Outputs declare plot intent (`line`, `histogram`, `marker`, `none`).
  A strategy must additionally declare entry/exit rule groups in T03;
  in T01 a strategy document without rule groups is structurally valid
  but cannot become a testable revision (validator reports it).
- Policy is mandatory and explicit: `warmupBars >= 0` (outputs before
  warmup are absent, never zero-filled), `barCloseOnly` (when true the
  artifact may only read closed bars; live-candle recomputation is
  declared, not implied), `missingData` is `error` or `skip-bar`
  (missing volume/fields are never silently replaced with zero).

## Versioning and dependencies

- `ArtifactProject` is the mutable identity (name, kind, language,
  active/archived). Drafts are editable and may be invalid.
- `ArtifactRevision` is immutable once created: content checksum
  (SHA-256 hex of the canonical source text), compiler version,
  dependency locks (exact revision IDs, resolved transitively,
  acyclic), validation receipt. Editing a draft never mutates a
  revision; a dependency upgrade creates a new revision.
- Dependency kind rules: an indicator may depend only on indicators; a
  strategy may depend on indicators and strategies. Cycles and
  self-dependencies are rejected. Resolution order is deterministic
  (depth-first, dependencies before dependents).
- `ParameterSet` is immutable and bound to one revision; editing
  creates another set. Origins: `default`, `manual`, `search_selected`.

## Execution rules declared up front (enforced from T03/T04)

- Future-bar reads are invalid: an artifact may only read bars at or
  before the current bar under its declared bar-close policy.
- Repainting behaviour must be declared (`barCloseOnly: false` means
  outputs may change intrabar and previews label them as such).
- Replay-prefix behaviour: outputs at bar N depend only on bars <= N
  plus declared warmup; parity fixtures (P20-T07) prove it per engine.
