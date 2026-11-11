"""SEC EDGAR adapter: polite client + canonical mapping (P13-T03/T08).

Fair-access rules are enforced in code: a declared User-Agent is
mandatory, a shared token bucket caps request rate (default SEC's 10/s), bounded retries
honour Retry-After, and responses are decoded with numeric literals
preserved as exact text. Mapping keeps every filed fact; restatements
link through revisesFactId and re-ingestion is idempotent.
"""

from __future__ import annotations

import hashlib
import json
import time

from services.connector_kraken import decode_json_exact
from services.research_domain import (
    ResearchError,
    build_document_version,
    build_fact_observation,
    build_issuer,
    fact_identity,
)
from services.workspace_storage import dumps, opaque

MAX_RESPONSE_BYTES = 16 * 1024 * 1024
MAX_FACTS = 200000
FACT_FORMS = ("10-K", "10-Q", "8-K", "20-F", "40-F", "6-K")
SOURCE_ID = "sourceconnection-edgar"


def _fail(code, status=502):
    raise ResearchError("edgar." + code)


class RateBudget:
    """Token bucket over an injected clock (seconds)."""

    def __init__(self, rate_per_second=10.0, burst=10):
        self.rate = float(rate_per_second)
        self.capacity = float(burst)
        self.tokens = float(burst)
        self._last = None

    def wait_for_token(self, now):
        if self._last is None:
            self._last = now
        self.tokens = min(
            self.capacity, self.tokens + max(0.0, now - self._last) * self.rate
        )
        self._last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return 0.0
        return (1 - self.tokens) / self.rate


def _production_transport(method, url, headers):
    from utils.httpx_client import get_httpx_client

    with get_httpx_client().stream(
        method, url, headers=headers, timeout=30, follow_redirects=False
    ) as response:
        data = bytearray()
        for chunk in response.iter_bytes(chunk_size=16384):
            data.extend(chunk)
            if len(data) > MAX_RESPONSE_BYTES:
                raise ResearchError("edgar.response_budget")
        return response.status_code, dict(response.headers), bytes(data)


class EdgarClient:
    def __init__(
        self,
        *,
        user_agent,
        transport=None,
        clock=time.monotonic,
        sleeper=time.sleep,
        rate_budget=None,
        max_attempts=4,
    ):
        if not isinstance(user_agent, str) or "@" not in user_agent or len(user_agent) < 8:
            _fail("user_agent_required", 400)
        self._user_agent = user_agent
        self._transport = transport or _production_transport
        self._clock = clock
        self._sleeper = sleeper
        self._budget = rate_budget or RateBudget()
        self._max_attempts = max_attempts
        self.requests = 0

    def _get_json(self, url):
        last_status = None
        for attempt in range(self._max_attempts):
            wait = self._budget.wait_for_token(self._clock())
            if wait > 0:
                self._sleeper(wait)
                self._budget.wait_for_token(self._clock())
            self.requests += 1
            try:
                status, headers, body = self._transport(
                    "GET",
                    url,
                    {"User-Agent": self._user_agent, "Accept-Encoding": "gzip, deflate"},
                )
            except ResearchError:
                raise
            except Exception:
                status, headers, body = 503, {}, b""
            if status == 200:
                if len(body) > MAX_RESPONSE_BYTES:
                    _fail("response_budget", 413)
                return decode_json_exact(body)
            last_status = status
            if status in {429, 500, 502, 503, 504} and attempt + 1 < self._max_attempts:
                retry_after = headers.get("Retry-After") or headers.get("retry-after")
                delay = min(8.0, 0.5 * (2**attempt))
                if isinstance(retry_after, str) and retry_after.isdigit():
                    delay = min(30.0, float(retry_after))
                self._sleeper(delay)
                continue
            break
        _fail(f"http_{last_status}", 503 if last_status != 404 else 404)

    @staticmethod
    def padded_cik(cik):
        text = str(cik)
        if not text.isdigit() or len(text) > 10:
            _fail("cik_invalid", 400)
        return text.zfill(10)

    def submissions(self, cik):
        return self._get_json(f"https://data.sec.gov/submissions/CIK{self.padded_cik(cik)}.json")

    def company_facts(self, cik):
        return self._get_json(
            f"https://data.sec.gov/api/xbrl/companyfacts/CIK{self.padded_cik(cik)}.json"
        )

    def company_concept(self, cik, taxonomy, tag):
        return self._get_json(
            f"https://data.sec.gov/api/xbrl/companyconcept/CIK{self.padded_cik(cik)}/{taxonomy}/{tag}.json"
        )


# ---------------------------------------------------------------------------
# Canonical mapping
# ---------------------------------------------------------------------------


def issuer_id_for(cik):
    return opaque("issuer", f"cik:{int(str(cik))}")


def document_id_for(accession):
    return opaque("documentversion", accession)


def _instant_from_acceptance(value, filing_date):
    if isinstance(value, str) and "T" in value:
        text = value if value.endswith("Z") else value + "Z"
        return text
    return f"{filing_date}T23:59:59Z"


_US_STATE_CODES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
    "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
    "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
    "WI", "WY", "DC",
}


def _country(payload):
    """ISO alpha-2 issuer country from SEC incorporation fields.

    SEC uses its own state/country code table; a US state code maps to
    US, any other two-letter code is carried as-is (SEC codes largely
    follow ISO for countries), otherwise the filer base is US-listed.
    """
    code = payload.get("stateOfIncorporation")
    if isinstance(code, str) and len(code) == 2 and code.isalpha() and code.isupper():
        return "US" if code in _US_STATE_CODES else code
    return "US"


def map_submissions(payload, *, owner_id, workspace_id, at, retrieved_at):
    if not isinstance(payload, dict) or "cik" not in payload:
        _fail("submissions_invalid")
    cik = str(payload["cik"])
    identifiers = [{"namespace": "cik", "key": cik}]
    for ticker in payload.get("tickers") or []:
        identifiers.append({"namespace": "ticker", "key": ticker})
    issuer = build_issuer(
        issuer_id=issuer_id_for(cik),
        owner_id=owner_id,
        workspace_id=workspace_id,
        at=at,
        name=payload.get("name") or f"CIK {cik}",
        country=_country(payload),
        identifiers=identifiers,
    )
    recent = (payload.get("filings") or {}).get("recent") or {}
    count = len(recent.get("accessionNumber") or [])
    documents = {}
    for index in range(count):
        form = (recent.get("form") or [""] * count)[index]
        base_form = form[:-2] if form.endswith("/A") else form
        if base_form not in FACT_FORMS:
            continue
        accession = recent["accessionNumber"][index]
        filing_date = (recent.get("filingDate") or [""] * count)[index]
        acceptance = (recent.get("acceptanceDateTime") or [None] * count)[index]
        primary = (recent.get("primaryDocument") or [""] * count)[index]
        published = _instant_from_acceptance(acceptance, filing_date)
        index_row = {
            "accession": accession,
            "form": form,
            "filingDate": filing_date,
            "primaryDocument": primary,
        }
        documents[accession] = build_document_version(
            document_id=document_id_for(accession),
            owner_id=owner_id,
            workspace_id=workspace_id,
            at=at,
            issuer_id=issuer["id"],
            source_id=SOURCE_ID,
            native_document_id=accession,
            checksum=hashlib.sha256(dumps(index_row).encode()).hexdigest(),
            published_at=published,
            available_at=published,
            retrieved_at=retrieved_at,
            source_url=(
                f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                f"{accession.replace('-', '')}/{primary}"
            ),
        )
    return issuer, documents


def _stub_document(accession, fact, *, issuer, owner_id, workspace_id, at, retrieved_at, cik):
    filed = fact.get("filed") or "1970-01-01"
    published = f"{filed}T23:59:59Z"
    return build_document_version(
        document_id=document_id_for(accession),
        owner_id=owner_id,
        workspace_id=workspace_id,
        at=at,
        issuer_id=issuer["id"],
        source_id=SOURCE_ID,
        native_document_id=accession,
        checksum=hashlib.sha256(
            dumps({"accession": accession, "form": fact.get("form"), "filed": filed}).encode()
        ).hexdigest(),
        published_at=published,
        available_at=published,
        retrieved_at=retrieved_at,
        source_url=f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/",
    )


def map_company_facts(payload, *, issuer, documents, owner_id, workspace_id, at, retrieved_at):
    """Returns (facts, stub_documents, stats). Facts are restatement-linked."""
    if not isinstance(payload, dict) or not isinstance(payload.get("facts"), dict):
        _fail("companyfacts_invalid")
    cik = str(payload.get("cik") or "")
    stubs = {}
    raw = []
    truncated = False
    for taxonomy, tags in payload["facts"].items():
        if not isinstance(tags, dict):
            continue
        for tag, entry in tags.items():
            if not isinstance(entry, dict):
                continue
            for unit, items in (entry.get("units") or {}).items():
                for fact in items or []:
                    if len(raw) >= MAX_FACTS:
                        truncated = True
                        break
                    if not isinstance(fact, dict) or "val" not in fact or "end" not in fact:
                        continue
                    raw.append((taxonomy, tag, unit, fact))
    # Deterministic chronological order so restatement links are stable.
    raw.sort(key=lambda item: (item[3].get("filed") or "", item[3].get("accn") or ""))
    facts = []
    previous_by_identity = {}
    skipped = 0
    for taxonomy, tag, unit, fact in raw:
        accession = fact.get("accn")
        if not isinstance(accession, str) or not accession:
            skipped += 1
            continue
        document = documents.get(accession) or stubs.get(accession)
        if document is None:
            document = _stub_document(
                accession,
                fact,
                issuer=issuer,
                owner_id=owner_id,
                workspace_id=workspace_id,
                at=at,
                retrieved_at=retrieved_at,
                cik=cik or "0",
            )
            stubs[accession] = document
        value = fact["val"]
        if not isinstance(value, str):
            skipped += 1
            continue
        metric_id = f"{taxonomy}:{tag}"
        identity_seed = "|".join(
            [
                issuer["id"],
                metric_id,
                unit,
                str(fact.get("start") or ""),
                str(fact["end"]),
                accession,
                value,
            ]
        )
        token = None
        for candidate in ("USD", "EUR", "GBP", "JPY", "INR", "CHF", "CAD", "AUD"):
            if candidate in unit.split("-per-")[0].split("/"):
                token = candidate
                break
        try:
            built = build_fact_observation(
                fact_id=opaque("factobservation", identity_seed),
                owner_id=owner_id,
                workspace_id=workspace_id,
                at=at,
                issuer_id=issuer["id"],
                document_version_id=document["id"],
                metric_id=metric_id,
                value=value,
                unit=unit,
                currency=token,
                period_kind="duration" if fact.get("start") else "instant",
                period_start=fact.get("start"),
                period_end=fact["end"],
                fiscal_year=int(fact["fy"]) if str(fact.get("fy", "")).lstrip("-").isdigit() else 0,
                fiscal_period=str(fact.get("fp") or "FY"),
                reporting_basis="consolidated",
                citation=f"{fact.get('form')} accession {accession}, {taxonomy}:{tag}",
                published_at=document["publishedAt"],
                available_at=document["availableAt"],
                retrieved_at=retrieved_at,
            )
        except ResearchError:
            skipped += 1
            continue
        identity = fact_identity(built)
        previous = previous_by_identity.get(identity)
        if previous is not None and previous["value"] != built["value"]:
            built = {**built, "revisesFactId": previous["id"]}
            from services.domain.validation import validate_record

            if validate_record("FactObservation", built):
                built.pop("revisesFactId")
        previous_by_identity[identity] = built
        facts.append(built)
    return facts, list(stubs.values()), {"skipped": skipped, "truncated": truncated}


def ingest_company(store, client, origin, cik, *, owner_id, workspace_id, at, retrieved_at):
    submissions = client.submissions(cik)
    issuer, documents = map_submissions(
        submissions,
        owner_id=owner_id,
        workspace_id=workspace_id,
        at=at,
        retrieved_at=retrieved_at,
    )
    facts_payload = client.company_facts(cik)
    facts, stubs, map_stats = map_company_facts(
        facts_payload,
        issuer=issuer,
        documents=documents,
        owner_id=owner_id,
        workspace_id=workspace_id,
        at=at,
        retrieved_at=retrieved_at,
    )
    all_documents = list(documents.values()) + stubs
    stats = store.upsert_company(
        origin, issuer=issuer, documents=all_documents, facts=facts
    )
    return {"issuerId": issuer["id"], **stats, **map_stats, "requests": client.requests}
