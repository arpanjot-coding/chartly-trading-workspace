# P03 implementation and verification evidence

2 November 2026. The original app's professional journal/import workflow is implemented and verified. Root owns the final package/master checkboxes and `P03_ACCEPTANCE.json`; this evidence distinguishes delivered scope from later connector/data packages.

## Delivered scope

The existing Journal tabs and Chart/portfolio return paths remain the base. Manual capture, open/partial/final close, reasoned corrections, review/history, archive/Undo, normalized CSV mapping/preview/reconciliation, evidence attachments, period reviews, scoped analytics and full-book exports are implemented. Connected books remain account-owned; manual books stay separate. Full-book export includes that book's rows across linked environments, while displayed CSV retains the active profile/filter scope.

Canonical decimal strings/nulls preserve exact money and unknown costs/risk. Partial exits and fee adjustments contribute on their realized dates; funding is separate. Current-time periods, IANA/DST grouping, all displayed filters, currencies, quantity units and account-versus-explicit-decision counts are consistent. Generic scores are removed; annualized ratios require complete declared return evidence. Saved source observations, user reviews and immutable history remain separate. The trusted P02 `journal-records` recovery module includes saved records; unsubmitted IndexedDB drafts require separate explicit export.

## Final automated verification

- **Backend:** 807 tests across 23 files passed in 127.98 seconds. This includes 71 importer tests, 9 API tests plus 2 resource audits, and the 47-case lifecycle/recovery/independent-review subset; these subsets are not added again to the 807 total. [Final backend log](evidence/backend-tests.log).
- **Frontend:** 448 tests across 39 suites passed. A separate final 6-test Journal Operations follow-up passed. TypeScript, production build and final owned-source Biome checks passed. [Frontend log](evidence/frontend-tests.log), [Operations follow-up](evidence/journal-operations.log), [TypeScript](evidence/typescript.log), [build](evidence/production-build.log), [Biome](evidence/frontend-biome.log).
- **P00:** 52 workflow tests passed. [Workflow regression log](evidence/p00-regression.log).
- **Independent findings:** Regressions cover exact 24-decimal final/residual accounting, unknown costs, source corrections, repeat import, book/currency/strategy/DST scope, archive/restore, cross-owner recovery, export coherence, attachment review synchronization, restored timestamp/result invariants and structured malformed-input rollback. [Final 47-test review log](evidence/independent-review.log), [financial review](../../../../test/test_journal_metrics_review.py), [final review](../../../../test/test_journal_final_review.py), [earlier integrity findings](../../../../test/test_journal_review_findings.py).

The API/resource run exercised 100 journal iterations and 10 repeat imports: 533 database connections opened and 533 closed; process handles 262→261. The worker audit launched 24 processes, reaped all 24 and removed all 24 temporary directories; handles 261→262. [Final API/resource log](evidence/resource-audit.log). These are bounded Windows fixture measurements, not a claim of production-scale certification.

## Original-screen journeys

Actual browser interactions used the isolated original-app fixture at `http://localhost:5013`, with local account/storage proof. They did not migrate the user's installed journal or connect a live account.

1. Captured Open `P03TEST` with quantity 10, then exercised the P02 reviewed fixture migration path. Created `DURABLE`, quantity 10, added a partial exit of 4 with net 38.2, and closed the remaining 6 with net 61.8 for a cumulative 100. Corrected the final exit to net 60.8/commission 2.2, producing exact total 99 while retaining notes and history. [Lifecycle screenshot](evidence/partial-and-close.png).
2. Uploaded an actual CSV through the original dialog, mapped/previewed and committed `EXAMPLE` with reported net 50 and commission 0. Unmapped other costs remained unknown. [Import preview](evidence/import-preview.png). The complete downloaded JSON retains the normalized event and original raw CSV observation.
3. Saved both daily and weekly reviews with the three included trade IDs, then exercised included-trade drill-through. [Saved reviews](evidence/saved-period-reviews.png).
4. Set New York reporting time, unreviewed filter and `EXAMPLE` search, opened the existing Chart and returned to the same journal context with those settings preserved. The chart honestly displayed its absent feed/API readiness. [Chart return](evidence/chart-return.png).
5. Archived and restored through Undo, verifying the same stable trade ID. [Archive/Undo](evidence/archive-undo.png).
6. Downloaded the actual full-book JSON and independently checked three trades, two period reviews, one source event, exact 99 corrected position net and retained raw CSV. [Downloaded book export](evidence/browser-book-export.json).

The main app at port 5000 was restarted; Workspace and Settings returned 200. Browser and service evidence cover the original screens and persistence, rather than a separate replacement prototype.

## Scope limits and handoff

No installed-user journal migration, live broker/exchange connection, order execution or market-data purchase occurred. Broker connectors/continuous history sync, provider-specific certification, Strategy Builder/testing, Fundamentals and later packages remain separate work. No Linux deployment or PostgreSQL workspace certification is claimed. Draft export remains separate from committed book/workspace recovery; credentials, runtime activation, installed strategy code and market-data file contents remain excluded from workspace ZIPs.

Preserve P02 historical acceptance hashes/evidence. A completed P03 gate records current changed-source hashes and explicit hashed P02 compatibility regression evidence under the [acceptance contract](ACCEPTANCE_GATE.md); it does not rewrite what P02 originally tested. The [architecture](ARCHITECTURE.md), [API](../../../api/local-journal.md), [calculation policy](CALCULATION_POLICY.md), [supported format](SUPPORTED_STATEMENT_FORMAT.md) and [user guide](../../../userguide/33-trading-journal/README.md) describe the implemented boundary. Root records final acceptance and advances the ordered plan.

## Final label verification

Final original-screen review confirmed 149 USD net, two completed positions, one open position and three realized exits in the synthetic book. Labels for strategy, symbol/side and weekly samples now consistently say exits; Best/Worst exit identify exit statistics. The Trades tab remains the position log. This label-only follow-up passed 18 focused original Journal/Combined tests, TypeScript and the final production build. [Follow-up log](evidence/label-polish.log).
