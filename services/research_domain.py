"""Research entity/fact domain rules (P13-T02).

Builders over the P01 Issuer/DocumentVersion/FactObservation contracts,
canonical alias resolution, and point-in-time fact selection. Every fact
carries its document, citation and three distinct times — published
(when the source released it), available (when it could first be known
here) and retrieved — so as-of queries never use future knowledge and
restatements preserve both values through `revisesFactId`.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from services.domain.validation import validate_record

_CURRENCY_TOKEN = re.compile(r"\b(USD|EUR|GBP|JPY|INR|CHF|CAD|AUD)\b")
_DECIMAL_TEXT = re.compile(r"-?\d+(?:\.\d{1,18})?")


class ResearchError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _fail(code):
    raise ResearchError("research." + code)


def _base(owner_id, workspace_id, at):
    return {
        "schemaVersion": 1,
        "ownerId": owner_id,
        "workspaceId": workspace_id,
        "revision": 1,
        "createdAt": at,
        "updatedAt": at,
    }


def _checked(type_name, record):
    issues = validate_record(type_name, record)
    if issues:
        _fail("canonical_invalid:" + ",".join(sorted({row["code"] for row in issues})))
    return record


def canonical_alias_key(namespace, key):
    if not isinstance(namespace, str) or not isinstance(key, str) or not key:
        _fail("alias_invalid")
    if namespace == "cik":
        if not key.isdigit():
            _fail("alias_invalid")
        return str(int(key))
    if namespace == "ticker":
        return key.upper()
    return key


def build_issuer(*, issuer_id, owner_id, workspace_id, at, name, country, identifiers):
    normalized = []
    seen = set()
    for alias in identifiers:
        entry = {
            "namespace": alias["namespace"],
            "key": canonical_alias_key(alias["namespace"], alias["key"]),
        }
        marker = (entry["namespace"], entry["key"])
        if marker in seen:
            _fail("alias_duplicate")
        seen.add(marker)
        normalized.append(entry)
    if not normalized:
        _fail("issuer_identifier_required")
    return _checked(
        "Issuer",
        {
            **_base(owner_id, workspace_id, at),
            "id": issuer_id,
            "name": name,
            "country": country,
            "identifiers": normalized,
        },
    )


def resolve_issuer(issuers, namespace, key):
    """Exact alias resolution; ambiguity is an error, never a guess."""
    wanted = canonical_alias_key(namespace, key)
    matches = [
        issuer
        for issuer in issuers
        if any(
            alias["namespace"] == namespace and alias["key"] == wanted
            for alias in issuer.get("identifiers", [])
        )
    ]
    if len(matches) > 1:
        _fail("alias_ambiguous")
    return matches[0] if matches else None


def build_document_version(
    *,
    document_id,
    owner_id,
    workspace_id,
    at,
    issuer_id,
    source_id,
    native_document_id,
    checksum,
    published_at,
    available_at,
    retrieved_at,
    source_url,
    amends_document_id=None,
):
    if not (published_at <= available_at <= retrieved_at):
        _fail("document_time_order")
    record = {
        **_base(owner_id, workspace_id, at),
        "id": document_id,
        "issuerId": issuer_id,
        "sourceId": source_id,
        "nativeDocumentId": native_document_id,
        "checksum": checksum,
        "publishedAt": published_at,
        "availableAt": available_at,
        "retrievedAt": retrieved_at,
        "sourceUrl": source_url,
    }
    if amends_document_id:
        record["amendsDocumentId"] = amends_document_id
    return _checked("DocumentVersion", record)


def build_fact_observation(
    *,
    fact_id,
    owner_id,
    workspace_id,
    at,
    issuer_id,
    document_version_id,
    metric_id,
    value,
    unit,
    period_kind,
    period_end,
    fiscal_year,
    fiscal_period,
    reporting_basis,
    citation,
    published_at,
    available_at,
    retrieved_at,
    currency=None,
    period_start=None,
    revises_fact_id=None,
):
    if not isinstance(value, str) or not _DECIMAL_TEXT.fullmatch(value):
        _fail("fact_value_invalid")
    try:
        Decimal(value)
    except InvalidOperation:
        _fail("fact_value_invalid")
    if period_kind == "duration":
        if not period_start or not period_start < period_end:
            _fail("fact_period_invalid")
    elif period_kind == "instant":
        if period_start is not None:
            _fail("fact_period_invalid")
    else:
        _fail("fact_period_invalid")
    if not (published_at <= available_at <= retrieved_at):
        _fail("fact_time_order")
    token = _CURRENCY_TOKEN.search(unit or "")
    if token and currency != token.group(1):
        _fail("fact_currency_mismatch")
    if not isinstance(citation, str) or not citation.strip():
        _fail("fact_citation_required")
    record = {
        **_base(owner_id, workspace_id, at),
        "id": fact_id,
        "issuerId": issuer_id,
        "documentVersionId": document_version_id,
        "metricId": metric_id,
        "value": value,
        "unit": unit,
        "periodKind": period_kind,
        "periodEnd": period_end,
        "fiscalYear": fiscal_year,
        "fiscalPeriod": fiscal_period,
        "reportingBasis": reporting_basis,
        "citation": citation,
        "publishedAt": published_at,
        "availableAt": available_at,
        "retrievedAt": retrieved_at,
    }
    if currency:
        record["currency"] = currency
    if period_start:
        record["periodStart"] = period_start
    if revises_fact_id:
        record["revisesFactId"] = revises_fact_id
    return _checked("FactObservation", record)


def fact_identity(fact):
    return (
        fact["issuerId"],
        fact["metricId"],
        fact["periodKind"],
        fact.get("periodStart"),
        fact["periodEnd"],
        fact["unit"],
    )


def select_facts_as_of(facts, *, as_of, issuer_id=None, metric_id=None):
    """Latest known value per fact identity at `as_of` (point-in-time).

    A fact counts only once available (availableAt <= as_of). Among
    candidates for one identity the greatest availableAt wins; ties
    break by retrievedAt then id, deterministically. Superseded values
    remain in storage — selection never deletes history.
    """
    best = {}
    for fact in facts:
        if issuer_id and fact["issuerId"] != issuer_id:
            continue
        if metric_id and fact["metricId"] != metric_id:
            continue
        if fact["availableAt"] > as_of:
            continue
        key = fact_identity(fact)
        current = best.get(key)
        rank = (fact["availableAt"], fact["retrievedAt"], fact["id"])
        if current is None or rank > (current["availableAt"], current["retrievedAt"], current["id"]):
            best[key] = fact
    return [best[key] for key in sorted(best, key=lambda item: (item[1], item[4]))]
