# P16-T01 — Research terminal specification (shipped scope)

Decided 4 November 2026; implemented in `/fundamentals`.

## Search taxonomy

One company list searchable by name, ticker or CIK (substring,
case-insensitive) over *stored* issuers — the terminal never implies
universe coverage it has not ingested. Document search covers stored
metadata (accessions, citations, metric ids); full-text body search
arrives only with stored document text (P13 boundary).

## Navigation and density

- Two-pane layout: import + company list (left), investigation
  workspace (right): statements, calculated metrics, compare/value/
  evidence, filings & coverage. All controls are native buttons,
  inputs and selects — fully keyboard reachable with visible focus;
  statement switching is a labelled fieldset.
- Information density rule: every number carries unit + period +
  filing citation in the same row; gaps render as named unavailable
  states in place, never as blank cells.
- Tabs/panels beyond this single workspace (multi-company tab sets,
  saved panel layouts) are deferred with the P18 shell work; the
  workspace itself is durable (issuers, notes, snapshots persist in
  the local store).

## Evidence model

Notes attach to stable document *versions* (the source filing is
never annotated in place). Snapshots freeze the point-in-time fact
selection with label/note/links and are immutable — reopening after a
restatement returns the original evidence. Comparisons state their
unit basis and per-row periods, and flag incompleteness.

## Explicit non-goals in this slice

Chart overlays for events/macro series (T07): the data contracts
exist (`/events`, P15 `evidence_snapshot`) but chart rendering is not
wired here; drawing an unverified overlay would be worse than none.
Asset-class pages beyond equities show unavailable coverage until
their P14 datasets certify.
