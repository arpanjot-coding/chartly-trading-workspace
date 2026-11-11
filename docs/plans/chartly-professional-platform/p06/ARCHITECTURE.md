# P06 historical paper architecture

The original chart remains the presentation surface. A selected source is a price capability; P06 adds a separate owned simulated account. A profile label, chart quote, saved layout or global broker key does not grant paper or broker authority. [Implementation steps](IMPLEMENTATION_PLAN.md), [API](../../../api/local-paper.md), [journal/recovery/report integration](JOURNAL_STORAGE_REPORTS.md).

## From preparation to acknowledged chart

The original run's Paper session rail requires explicit units, quantity step, price tick, multiplier, scales and costs. The local authenticated/CSRF boundary accepts commands and batch counts, not bars or account state. `PaperSessions` verifies actual run/profile/origin, native source/checksum/restored aliases, UTC opening window, frozen close/publication timing, compatible prices and journal precision. Configuration, manifest, engine version and policy are pinned at preparation.

`paper_market.py` reuses P04's frozen calendars and gap classifier. It emits exact decimal native OHLC plus numeric UTC opening/availability timestamps. `paper_engine.py` is pure and deterministic: no network, database, wall clock, UUID, provider or supplied code. Its distinct positions, reduce-only exits, conservative ambiguity, explicit tick/cost rounding and cumulative partial-close residue are tested independently. The supported account model is one-times linear notional collateral; it makes no exchange-margin or tick-fidelity claim.

`PaperSessions` holds the existing scoped SQLite transaction while computing one bounded operation. Run state, immutable fill/event ledger, checkpoint, marker, P03 journal facts/history and command receipt publish together. A forced failure leaves all prior state intact; repeating a possibly committed request cannot apply its financial effect twice. Data/record files and SQL connections retain their existing bounded worker/context-manager lifetimes.

The frontend retains a stable reviewed command in a private IndexedDB owner/run slot before sending. Its atomic claim prevents tabs from overwriting an uncertain command. Only a successful server snapshot may move the account clock or show a fill; no optimistic account state is created. A paused all-pane ReplayGroup follows the acknowledged UTC availability. The chart stays held until its visible prefix matches that account; an unavailable managed session cannot fall back to full history or a replacement account. Local replay controls cannot rewind the current paper ledger.

## Inspection, branching and return paths

Recorded decisions retain P05's original source/view/availability, separately from a later account checkpoint. Inspection is read-only and links explicitly to the current paper account. Journal review fields and captures survive later fills. Closing a chart stops client advance loops, not a confirmed pending order or durable state; reopening never automatically plays.

An earlier-bar branch is a new independent run/book with fresh starting cash at the selected known close. The original account, financial history and chart evidence remain intact. Future positions/P&L are not carried backward. The branch's source window and all-pane acknowledged clock remain authoritative. Project comparisons show separate accounts and never fabricate combined equity or mixed-currency totals.

## Persistence and recovery

`workspace_paper_sessions` is a scoped installed table, separate from browser preferences and ordinary workspace payloads. `practiceSessions[].paper` is only a compact server-owned marker, including its verified native window. Generic table saves cannot fabricate/edit a managed marker, change its financial config or mark an unexecuted account completed. Original browser sources still require reviewed migration.

The `paper-sessions` backup module preserves complete records, receipts, checkpoints and ledger. Old archives gain an empty module through explicit version-compatible normalization. Full restore/Undo validates bounded data-only engine/canonical references and reconciled finances before publication. Cross-owner restore uses the current owned book mapping and deliberately changes local canonical scope; the engine state hash remains unchanged. Source candle bundles and verified aliases remain P04's separate recovery seam. No restore starts a runtime or connects to a broker.

P03 paper books receive only confirmed simulator facts. Position/fill identities deduplicate projection; entry fees are zero-quantity fee realizations, exits are actual quantity/gross/exit-cost realizations. User review, notes, archive state and image evidence are retained. Immutable financial fields stay source-locked.

Reports embed schema-validated shared RunManifest/Checkpoint/MetricResult adapters, pinned assumptions, observed coverage, actual financial ledger, realized versus unrealized results, sample/denominator semantics and checksums. The equity curve is bounded/sampled; peak/drawdown values are tracked over every processed observation instead of inferred from that sampled curve. P21 automated jobs are not implicitly certified by a manual paper run.

The [editable HTML diagram](architecture.html) is rendered and visually checked as [PNG](evidence/architecture.png). Final package evidence records actual test commands, original-screen journeys, 100-operation resource measurements and the supported environment; it does not infer real-provider, Linux/gunicorn or universal margin certification.
