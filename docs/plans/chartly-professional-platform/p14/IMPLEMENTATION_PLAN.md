# First Fundamentals delivery: company research

2 November 2026. Owner: unassigned. State: implementation specification against the accepted P00 baseline; implementation has not started. All steps remain unchecked. This expands [P14](../14-fundamentals.md) and depends on the applicable P01/P02/P13 identity, storage and source contracts. Follow the [current execution guide](../p01/STATE_REVIEW_AND_CONTINUATION.md); the first company journey can precede macro coverage and connected trading.

## Product boundary and first outcome

Fundamentals is a primary research workspace beside Workspace, Workflows and Strategy Builder. It works without a trading account or live execution permission. Workspace continues to open the existing chart and journal. Workflows may later refresh verified research data. Strategy Builder can consume facts only when their historical availability and dataset contracts support it.

First successful journey: search a company → identify its issuer and listing → inspect a sourced overview → read annual or quarterly statements → open the original report → save a research snapshot → explicitly choose a matching chart or journal note.

Start with listed companies in one explicitly supported provider/universe. Select geography and coverage during the source spike. Estimates, transcripts, supplier/customer graphs and universal cross-asset coverage are separate deliveries.

## FND-01 — verify source access and coverage

- [ ] Evaluate one provider using its documented access route and real public sample responses. Yahoo is the user's candidate; do not treat an unofficial client as an official Yahoo API or silently make an optional development dependency a production adapter.
- [ ] Record dependencies, access/credential requirements, usage/cache rights, supported listings, refresh cadence, limits, source attribution and missing fields.
- [ ] Capture scrubbed fixtures for a supported company, ambiguous names, multiple listings, unknown/delisted identifiers, missing statements, changed units/currency, throttling and network/authentication failure.
- [ ] Publish a support record for the exact verified company, statement, document and quote capabilities. If original reports require a second source, verify that source before claiming a complete report journey.

Gate: repeatable read-only retrieval produces sourced facts and report links, and an unavailable-source path works. No provider is certified by this plan.

## FND-02 — freeze identity and fact contracts

- [ ] Define stable issuer IDs and source-specific mappings, plus distinct listing records with exchange, native symbol and quote currency. A ticker alone is not universal identity.
- [ ] Define each fact's metric/taxonomy, reported value, unit/scaling, currency, period start/end, instant versus duration, fiscal label, source/report reference, fetched time and revision status.
- [ ] Keep missing, zero and provider error separate. Preserve published/available time when known; fetch time cannot establish historical availability.
- [ ] Validate source document URLs and retain provider/document identity and retrieval time. Do not render provider HTML as trusted markup.
- [ ] Define immutable research snapshots and citation references. Refresh must not rewrite evidence already attached to a journal or experiment.

Gate: fixtures round-trip through durable storage without losing source, period, units or missing-value meaning. Use P02 migrations and backup rules rather than making browser storage the only owner of new authoritative research.

## FND-03 — build the connected screens in the original app

- [ ] Add the main Fundamentals destination when it completes a useful research journey. Reuse existing UI components, responsive navigation and the original chart/journal.
- [ ] Search by company name or exact provider symbol, disambiguate issuer/listing and publish the supported universe. Cover idle, loading, results, no results, unsupported and failed/retry states with keyboard selection.
- [ ] Show company identity, selected listing, source and freshness in the header. Overview displays only supported facts; any quotes or valuation inputs retain their own times/currencies.
- [ ] Provide Income, Balance Sheet and Cash Flow views, annual/quarterly selection, explicit periods, units and currency. Unavailable cells never become zero. Do not turn balance-sheet instants into fabricated quarterly duration facts.
- [ ] Provide original report links with source/date. A fact's source action opens its precise report context where supplied; otherwise explain the precision limit.
- [ ] Show cached/stale data honestly. Refresh failure preserves usable saved data and provides a retry. Ratios, growth and TTM remain unavailable until formula/fiscal-calendar tests pass.

Gate: supported and unsupported company journeys work on desktop and narrow screens with source inspection and recovery.

## FND-04 — connect configuration, saved research and chart/journal

- [ ] Put research provider configuration inside Connections & Data. Separate data privileges from execution permissions; research never requires a broker connection.
- [ ] Explicit refresh uses bounded requests, records its outcome and preserves the current company/statement. Automatic refresh while the app is open is a later opt-in capability with schedule and last-result states.
- [ ] Save exactly the viewed facts and provenance. Provide success, unsaved, storage failure and retry states. Reopen saved research offline without presenting it as current data.
- [ ] Open chart resolves a verified listing-to-instrument mapping and target profile. Unsupported mapping stays on the research page with an explanation; never silently open a default ticker.
- [ ] Attach to journal requires an explicit book/trade or note target. Store a research reference, never create a fill or change P&L. Preserve journal filters and both return locations.

Gate: saved research survives restart and backup/restore; chart/journal round trips retain context. No research action submits an order.

## FND-05 — verify and release

- [ ] Adapter tests cover malformed/partial responses, schema changes, timeouts, limits and missing credentials without writing production settings.
- [ ] Normalization tests cover scaling, currencies, duplicate/amended periods, non-calendar fiscal years, duration versus instant facts and unknown publication dates.
- [ ] UI tests cover disambiguation, statement switching, source inspection, stale-cache recovery, explicit refresh, offline snapshots and unmapped chart instruments.
- [ ] Actual browser review covers search → company → statement → report → save → reload, plus chart and journal returns, keyboard use and narrow layout.
- [ ] Document verified coverage, limitations, recovery and evidence. P14's broader tasks remain open until their own acceptance passes.

## Later increments and order

Build in this order: source spike → identity/fact/document fixtures and contracts → storage/cache → search and company overview → statements and reports → saved research → chart/journal handoffs → refresh automation.

Then expand tested formulas/restatements/comparisons and source universes; crypto, funds, FX/rates and futures need their own models. Company relationships require sourced and dated edges with relationship type, evidence and confidence. Missing supplier/client datasets must never be filled with generated claims.
