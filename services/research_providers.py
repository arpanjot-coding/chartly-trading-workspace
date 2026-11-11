"""Provider manifest for SEC EDGAR, the first P13 official source.

Terms/metadata are from official SEC documentation retrieved
2026-11-04 (EDGAR APIs page + Accessing EDGAR Data). The manifest is
data: ingestion budgets, identity rules and mapping provenance read
from here so provider limits live in exactly one place.
"""

from __future__ import annotations

from services.domain.validation import validate_record
from services.research_domain import ResearchError

EDGAR_PROVIDER = {
    "providerId": "sec-edgar",
    "name": "SEC EDGAR (official)",
    "adapterVersion": "p13-edgar-v1",
    "environment": "data_only",
    "geography": ["US-listed filers", "foreign private issuers (20-F/40-F/6-K)"],
    "assetClasses": ["equity", "fund"],
    "fields": [
        "issuer identity (CIK, tickers, exchanges, former names, SIC, fiscal year end)",
        "filing index (form, filing/report dates, accession, primary document)",
        "XBRL facts (us-gaap, ifrs-full, dei, srt; non-custom taxonomies only)",
    ],
    "history": "Submissions index observed from 1994; XBRL facts from mandate era forms 10-K/10-Q/8-K/20-F/40-F/6-K",
    "latency": "Submissions typically <1s after dissemination; XBRL APIs <1min (SEC docs)",
    "quota": {"maxRequestsPerSecond": 10, "credentials": "none", "userAgentRequired": True},
    "attribution": "Source: U.S. Securities and Exchange Commission EDGAR",
    "storage": "Local caching expected by SEC fair-access guidance; bulk ZIPs republished nightly (~3am ET) are the preferred seed",
    "export": "Public filings data; keep attribution and source URLs with exported facts",
    "subscription": "none (free public APIs, no key)",
    "transport": {
        "hosts": ["data.sec.gov", "www.sec.gov"],
        "cors": "data.sec.gov sends no CORS headers — all calls go through the local backend, never the browser",
    },
    "identity": {
        "primary": "cik (never recycled; zero-padded to 10 digits in API paths)",
        "aliases": ["cik", "ticker"],
    },
    "mapping": {
        "document": "accessionNumber -> nativeDocumentId; filed datetime -> publishedAt/availableAt",
        "fact": "taxonomy:tag -> metricId; units key -> unit; start/end -> duration, end-only -> instant; fy/fp -> fiscalYear/fiscalPeriod",
        "dedupe": "(metricId, unit, periodStart, periodEnd): keep every filing's fact; current selection prefers latest filed (amendments restate via revisesFactId)",
        "caveats": [
            "Company-custom taxonomy facts are excluded by the APIs — bespoke metrics are absent by design",
            "Frames pick one last-filed best-fit fact per entity; fiscal calendars misalign across companies",
            "Tag churn across taxonomy years needs alias mapping per concept",
        ],
    },
    "endpoints": {
        "tickers": "https://www.sec.gov/files/company_tickers.json",
        "submissions": "https://data.sec.gov/submissions/CIK{10-digit}.json",
        "companyFacts": "https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit}.json",
        "companyConcept": "https://data.sec.gov/api/xbrl/companyconcept/CIK{10-digit}/{taxonomy}/{tag}.json",
        "frames": "https://data.sec.gov/api/xbrl/frames/{taxonomy}/{tag}/{unit}/{period}.json",
        "bulk": ["https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip"],
    },
    "docs": [
        "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
        "https://www.sec.gov/os/accessing-edgar-data",
    ],
}


def build_capability_manifest(*, manifest_id, owner_id, workspace_id, at, verified_at, evidence_id):
    record = {
        "schemaVersion": 1,
        "id": manifest_id,
        "ownerId": owner_id,
        "workspaceId": workspace_id,
        "revision": 1,
        "createdAt": at,
        "updatedAt": at,
        "sourceId": "sourceconnection-edgar",
        "environment": EDGAR_PROVIDER["environment"],
        "adapterVersion": EDGAR_PROVIDER["adapterVersion"],
        "capabilities": {
            "researchRead": {
                "state": "supported",
                "verifiedAt": verified_at,
                "evidenceId": evidence_id,
            },
            "marketHistory": {"state": "unsupported"},
            "accountRead": {"state": "unsupported"},
            "orderSubmit": {"state": "unsupported"},
        },
    }
    issues = validate_record("CapabilityManifest", record)
    if issues:
        raise ResearchError(
            "research.canonical_invalid:" + ",".join(sorted({row["code"] for row in issues}))
        )
    return record
