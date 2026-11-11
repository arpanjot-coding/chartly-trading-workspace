# P15-T01/T07 — Macro universe, sources and gated additions

Decided 4 November 2026. Official sources only for the core.

## Initial universe (BLS public API v2, no key)

`services/macro.py:SERIES_UNIVERSE` — CPI (`CUSR0000SA0`),
unemployment (`LNS14000000`), nonfarm payrolls (`CES0000000001`),
PPI final demand (`WPSFD4`). Unregistered tier limits (25
queries/day, 10-year windows) are respected by fetching per-series on
demand; a free registered key raises limits and is a config-only
upgrade. Verified live 2026-11-04: CPI Sep 2026 = 336.298.

## Vintages and reports (T02/T04)

Every fetch stamps one `retrievedAt` vintage; revised prints append,
never overwrite. BLS news releases (USDL) are the original reports:
stored as citations {title, release id, bls.gov URL, publication
time} and searched over stored metadata, mirroring P13 stored-
metadata search. Full-text report ingestion waits for a source whose
terms permit local retention of full text (decision recorded, not
assumed). Treasury Fiscal Data (also official, no key) is the second
adapter candidate for rates/debt series.

## Calendar (T03)

Release events carry the source zone (`America/New_York` for BLS
08:30 ET releases), explicit display-zone conversion, and
scheduled/confirmed/cancelled/released states. Actual, prior and
revised are separate fields; **consensus is capability-gated** —
shown unavailable until a licensed source exists.

## Gated additions (T07)

News wires, earnings-call/macro transcripts and consensus estimates
each need: rights/retention terms, freshness/coverage statement and
an evaluation against official prints before enabling. Until then
they appear as unavailable capabilities — the same pattern as P14
estimates/transcripts/ownership/news.

## Tracking limits (T06)

Release notices are generated locally while the app/worker runs and
are deduplicated by release id. Nothing is delivered while the app
is closed — stated in the notice itself.
