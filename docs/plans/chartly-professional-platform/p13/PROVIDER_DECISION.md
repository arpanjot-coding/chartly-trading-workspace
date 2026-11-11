# P13-T01/T02 — Provider decision and research domain design

Decided 4 November 2026 from official SEC documentation (retrieved
same day; endpoint shapes additionally verified against live official
JSON). Executable manifest: `services/research_providers.py`.
Domain rules: `services/research_domain.py` over the P01 records
`Issuer`, `DocumentVersion`, `FactObservation`, `DerivedMetric`,
`CapabilityManifest`.

## Decision

**SEC EDGAR is the first (and initially only) fundamentals/document
provider** — free, official, no key, JSON APIs + nightly bulk ZIPs,
with filings as the authoritative documents behind every fact.

| Dimension | Manifest value |
|---|---|
| Geography | US-listed filers + foreign private issuers (20-F/40-F/6-K) |
| Fields | Issuer identity, filing index, XBRL facts (`us-gaap`, `ifrs-full`, `dei`, `srt`) |
| History | Submissions from 1994 (observed); XBRL from mandate-era forms |
| Latency | Submissions <1s typical; XBRL <1min (SEC) |
| Quota | 10 req/s max, declared User-Agent required, no key |
| Attribution | U.S. Securities and Exchange Commission EDGAR |
| Storage | Local caching expected; nightly bulk ZIP is the preferred seed |
| Subscription | None |

Sources: [EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces),
[Accessing EDGAR Data](https://www.sec.gov/os/accessing-edgar-data).

## Binding constraints carried into T03-T08

- `data.sec.gov` sends **no CORS headers** — every call goes through
  the local Flask backend with a declared User-Agent and a shared
  ≤10 req/s budget; the browser never calls SEC directly.
- Company-custom taxonomy facts are excluded by the APIs; missing
  bespoke metrics are coverage gaps, not zeros.
- Facts repeat across filings/amendments: storage keeps every fact;
  current-value selection is point-in-time (`availableAt`) with
  `revisesFactId` lineage — implemented in `research_domain`.
- Frames are cross-company calendar screens only (last-filed best
  fit; fiscal calendars misalign) — not a fundamentals source of truth.
- Full-text search JSON (`efts.sec.gov`) is undocumented; no committed
  contract may depend on it.

## Schema/alias design (T02)

- Identity: CIK (never recycled) primary, ticker alias; canonical
  forms (`cik` unpadded integer text, `ticker` uppercase) with
  ambiguity as an error, never a guess.
- Documents: accession number is `nativeDocumentId`; checksum,
  `publishedAt <= availableAt <= retrievedAt`, amendment links.
- Facts: `taxonomy:tag` metric ids, exact decimal text, unit +
  currency consistency, instant vs duration periods, mandatory
  citation, three-time provenance on every record.
- Derived metrics (P14) will cite `inputFactIds` + formula version;
  unavailable results carry a reason, never a fabricated zero.
