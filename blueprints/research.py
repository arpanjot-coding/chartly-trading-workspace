"""Private local research document APIs (P13-T04).

Stored documents/facts are served from the local research store with
their citations. Filing body text is fetched live from SEC at access
time through the polite EDGAR client and is never silently cached as
if it were a stored document version. Search v1 covers stored
metadata (accessions, citations, metric ids); full-text body indexing
arrives with stored document text in a later slice.
"""

import os

from flask import Blueprint, jsonify, request
from flask_wtf.csrf import CSRFError
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from blueprints.local_data import (
    _error,
    _identifier,
    _json,
    _origin,
    _query,
    _storage,
    enforce_local_request_limits,
)
from services.edgar_adapter import EdgarClient
from services.local_account_access import require_local_account
from services.research_domain import ResearchError
from services.research_ingestion import ResearchIngestionJobs
from services.research_store import ResearchStore
from services.workspace_storage import WorkspaceError, now, opaque

research_bp = Blueprint("research", __name__, url_prefix="/api/local/v1/research")
MAX_CONTENT_BYTES = 4 * 1024 * 1024
MESSAGES = {
    "research.issuer_not_found": "That company is not in the local research store yet. Run an ingestion for its CIK first.",
    "research.document_not_found": "That filing version is not stored locally.",
}


@research_bp.before_request
def boundary():
    enforce_local_request_limits()
    return require_local_account(lambda: None)()


@research_bp.after_request
def private(response):
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@research_bp.errorhandler(WorkspaceError)
@research_bp.errorhandler(ResearchError)
def research_error(error):
    status = getattr(error, "status", 400)
    if error.code in MESSAGES:
        return jsonify(
            {"error": {"code": error.code, "message": MESSAGES[error.code], "issues": []}}
        ), status
    return _error(error.code, status)


@research_bp.errorhandler(SQLAlchemyError)
@research_bp.errorhandler(OSError)
def unavailable(_value):
    return _error("storage.unavailable", 503)


@research_bp.errorhandler(BadRequest)
def bad_request(_value):
    return _error("request.invalid", 400)


@research_bp.errorhandler(CSRFError)
def csrf(_value):
    return _error("csrf.invalid", 400)


@research_bp.errorhandler(RequestEntityTooLarge)
def too_large(_value):
    return _error("request.too_large", 413)


def make_edgar_client():
    user_agent = os.environ.get("CHARTLY_EDGAR_USER_AGENT", "ChartlyLocalResearch admin@localhost")
    return EdgarClient(user_agent=user_agent)


def _store():
    return ResearchStore(_storage())


def _jobs():
    storage = _storage()
    return ResearchIngestionJobs(storage, ResearchStore(storage))


def _page(values):
    try:
        limit = int(request.args.get("limit", "100"))
        offset = int(request.args.get("offset", "0"))
    except ValueError:
        raise WorkspaceError("research.invalid_page") from None
    if not 1 <= limit <= 500 or offset < 0:
        raise WorkspaceError("research.invalid_page")
    return values[offset : offset + limit], {"total": len(values), "limit": limit, "offset": offset}


def _document_view(document):
    return {
        **document,
        "citation": {
            "accession": document["nativeDocumentId"],
            "sourceUrl": document["sourceUrl"],
            "publishedAt": document["publishedAt"],
            "availableAt": document["availableAt"],
        },
    }


@research_bp.get("/issuers")
def issuers():
    _query("originId")
    origin = _origin(request.args.get("originId"), True)
    return jsonify({"issuers": _store().list_issuers(origin)})


@research_bp.get("/issuers/<issuer_id>")
def issuer_detail(issuer_id):
    _query("originId")
    origin = _origin(request.args.get("originId"), True)
    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    return jsonify(
        {
            "issuer": bundle["issuer"],
            "documentCount": len(bundle["documents"]),
            "factCount": len(bundle["facts"]),
        }
    )


@research_bp.get("/issuers/<issuer_id>/documents")
def documents(issuer_id):
    _query("originId", "limit", "offset", "q")
    origin = _origin(request.args.get("originId"), True)
    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    rows = sorted(
        bundle["documents"], key=lambda row: (row["publishedAt"], row["id"]), reverse=True
    )
    query = (request.args.get("q") or "").lower()
    if query:
        rows = [
            row
            for row in rows
            if query in row["nativeDocumentId"].lower() or query in row["sourceUrl"].lower()
        ]
    page, meta = _page(rows)
    return jsonify({"documents": [_document_view(row) for row in page], "page": meta})


@research_bp.get("/issuers/<issuer_id>/documents/<document_id>")
def document_detail(issuer_id, document_id):
    _query("originId", "limit", "offset")
    origin = _origin(request.args.get("originId"), True)
    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    document = next(
        (row for row in bundle["documents"] if row["id"] == _identifier(document_id)), None
    )
    if document is None:
        raise WorkspaceError("research.document_not_found", 404)
    facts = [row for row in bundle["facts"] if row["documentVersionId"] == document["id"]]
    page, meta = _page(sorted(facts, key=lambda row: (row["metricId"], row["periodEnd"])))
    return jsonify({"document": _document_view(document), "facts": page, "page": meta})


@research_bp.get("/issuers/<issuer_id>/documents/<document_id>/content")
def document_content(issuer_id, document_id):
    """Fetch filing text live from SEC at access time (never cached here)."""
    _query("originId")
    origin = _origin(request.args.get("originId"), True)
    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    document = next(
        (row for row in bundle["documents"] if row["id"] == _identifier(document_id)), None
    )
    if document is None:
        raise WorkspaceError("research.document_not_found", 404)
    client = make_edgar_client()
    url = document["sourceUrl"]
    if not url.startswith("https://www.sec.gov/Archives/"):
        raise WorkspaceError("research.document_url_unsupported", 409)
    wait = client._budget.wait_for_token(client._clock())
    if wait > 0:
        client._sleeper(wait)
        client._budget.wait_for_token(client._clock())
    client.requests += 1
    status, _headers, body = client._transport(
        "GET", url, {"User-Agent": client._user_agent, "Accept-Encoding": "gzip, deflate"}
    )
    if status != 200:
        raise WorkspaceError("edgar.http_" + str(status), 503)
    truncated = len(body) > MAX_CONTENT_BYTES
    text = body[:MAX_CONTENT_BYTES].decode("utf-8", errors="replace")
    return jsonify(
        {
            "documentId": document["id"],
            "sourceUrl": url,
            "fetchedAt": now(),
            "accessTime": "live-from-sec-not-stored",
            "truncated": truncated,
            "text": text,
        }
    )


@research_bp.get("/issuers/<issuer_id>/facts")
def facts(issuer_id):
    _query("originId", "asOf", "metricId", "limit", "offset")
    origin = _origin(request.args.get("originId"), True)
    as_of = request.args.get("asOf") or now()
    rows = _store().facts_as_of(
        origin, _identifier(issuer_id), as_of=as_of, metric_id=request.args.get("metricId")
    )
    page, meta = _page(rows)
    return jsonify({"facts": page, "asOf": as_of, "page": meta})


@research_bp.get("/issuers/<issuer_id>/search")
def search(issuer_id):
    """Stored-metadata search (v1): accessions, citations, metric ids."""
    _query("originId", "q", "limit", "offset")
    origin = _origin(request.args.get("originId"), True)
    query = (request.args.get("q") or "").strip().lower()
    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    hits = []
    if query:
        for row in bundle["documents"]:
            if query in row["nativeDocumentId"].lower() or query in row["sourceUrl"].lower():
                hits.append({"kind": "document", "document": _document_view(row)})
        metrics = sorted(
            {row["metricId"] for row in bundle["facts"] if query in row["metricId"].lower()}
        )
        hits.extend({"kind": "metric", "metricId": metric} for metric in metrics)
    page, meta = _page(hits)
    return jsonify({"hits": page, "scope": "stored-metadata-v1", "page": meta})


@research_bp.get("/issuers/<issuer_id>/snapshot")
def snapshot(issuer_id):
    """Point-in-time entity snapshot with per-fact source drill-through."""
    _query("originId", "asOf")
    origin = _origin(request.args.get("originId"), True)
    as_of = request.args.get("asOf") or now()
    store = _store()
    bundle = store.get_issuer(origin, _identifier(issuer_id))
    documents = {row["id"]: row for row in bundle["documents"]}
    selected = store.facts_as_of(origin, _identifier(issuer_id), as_of=as_of)
    enriched = []
    for fact in selected:
        document = documents.get(fact["documentVersionId"])
        enriched.append(
            {
                **fact,
                "source": {
                    "documentVersionId": fact["documentVersionId"],
                    "accession": document["nativeDocumentId"] if document else None,
                    "sourceUrl": document["sourceUrl"] if document else None,
                    "publishedAt": document["publishedAt"] if document else None,
                },
            }
        )
    available_documents = [row for row in bundle["documents"] if row["availableAt"] <= as_of]
    return jsonify(
        {
            "issuer": bundle["issuer"],
            "asOf": as_of,
            "generatedAt": now(),
            "coverage": {
                "documentsAvailable": len(available_documents),
                "documentsStored": len(bundle["documents"]),
                "factsSelected": len(enriched),
                "latestAvailableAt": max(
                    (row["availableAt"] for row in bundle["facts"]), default=None
                ),
            },
            "facts": enriched,
        }
    )


@research_bp.get("/issuers/<issuer_id>/quality")
def quality(issuer_id):
    _query("originId", "asOf")
    origin = _origin(request.args.get("originId"), True)
    from services.research_quality import quality_report

    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    return jsonify(quality_report(bundle, as_of=request.args.get("asOf") or now()))


@research_bp.get("/issuers/<issuer_id>/statements/<kind>")
def statement(issuer_id, kind):
    _query("originId", "asOf", "span", "scale", "view")
    if kind not in {"income", "balance", "cashflow"}:
        raise WorkspaceError("research.statement_invalid")
    origin = _origin(request.args.get("originId"), True)
    view = request.args.get("view", "as-of")
    if view not in {"as-of", "latest-restated"}:
        raise WorkspaceError("research.view_invalid")
    as_of = now() if view == "latest-restated" else (request.args.get("asOf") or now())
    from services.fundamentals import build_statement

    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    result = build_statement(
        bundle["facts"],
        statement=kind,
        as_of=as_of,
        span=request.args.get("span"),
        scale=request.args.get("scale", "units"),
    )
    return jsonify({"issuer": bundle["issuer"], "view": view, **result})


@research_bp.get("/issuers/<issuer_id>/metrics")
def metrics(issuer_id):
    _query("originId", "asOf")
    origin = _origin(request.args.get("originId"), True)
    as_of = request.args.get("asOf") or now()
    from services.fundamentals import compute_metrics

    store = _store()
    bundle = store.get_issuer(origin, _identifier(issuer_id))
    results = compute_metrics(
        bundle["facts"],
        issuer_id=bundle["id"],
        owner_id=store.storage.uid,
        workspace_id=opaque("workspace", store.storage.uid + "|" + origin),
        at=as_of,
    )
    return jsonify({"issuer": bundle["issuer"], "asOf": as_of, "metrics": results})


@research_bp.get("/issuers/<issuer_id>/coverage")
def coverage(issuer_id):
    _query("originId", "asOf")
    origin = _origin(request.args.get("originId"), True)
    from services.fundamentals import field_coverage

    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    result = field_coverage(bundle["facts"], as_of=request.args.get("asOf") or now())
    result["gatedCapabilities"] = [
        {
            "capability": name,
            "status": "unavailable",
            "reason": "capability-gated provider addition; no source configured",
        }
        for name in ("estimates", "transcripts", "ownership", "news")
    ]
    return jsonify({"issuer": bundle["issuer"], **result})


@research_bp.get("/issuers/<issuer_id>/events")
def events(issuer_id):
    """Filing events with explicit source/timing; gated feeds stay gated."""
    _query("originId", "limit", "offset")
    origin = _origin(request.args.get("originId"), True)
    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    rows = [
        {
            "kind": "filing",
            "time": row["publishedAt"],
            "availableAt": row["availableAt"],
            "accession": row["nativeDocumentId"],
            "sourceUrl": row["sourceUrl"],
            "documentVersionId": row["id"],
        }
        for row in sorted(
            bundle["documents"], key=lambda r: (r["publishedAt"], r["id"]), reverse=True
        )
    ]
    page, meta = _page(rows)
    return jsonify(
        {
            "events": page,
            "page": meta,
            "gated": ["estimates", "transcripts", "ownership", "news"],
        }
    )


@research_bp.get("/issuers/<issuer_id>/overlay")
def overlay(issuer_id):
    """Chart overlay data (P16-T07): financial series + filing events.

    Date semantics are explicit: financial points plot at period end,
    filing markers at publication instant. Layers state their own
    independent sources; nothing is interpolated or resampled."""
    _query("originId", "line", "asOf")
    origin = _origin(request.args.get("originId"), True)
    from services.fundamentals import series_history

    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    as_of = request.args.get("asOf") or now()
    series = series_history(
        bundle["facts"], line=request.args.get("line") or "revenue", as_of=as_of
    )
    events = [
        {
            "time": row["publishedAt"],
            "label": row["nativeDocumentId"],
            "sourceUrl": row["sourceUrl"],
            "documentVersionId": row["id"],
        }
        for row in sorted(bundle["documents"], key=lambda r: r["publishedAt"])
        if row["availableAt"] <= as_of
    ]
    return jsonify(
        {
            "issuer": bundle["issuer"],
            "asOf": as_of,
            "series": series,
            "events": events,
            "semantics": {
                "seriesDates": "period end (fiscal period close), span carried per point",
                "eventDates": "filing publication instant (SEC acceptance)",
                "interpolated": False,
                "sources": [
                    "SEC EDGAR company facts (stored, point-in-time selected)",
                    "SEC EDGAR filing index (stored documents)",
                ],
            },
        }
    )


@research_bp.get("/compare")
def compare():
    _query("originId", "issuerIds", "line", "asOf")
    origin = _origin(request.args.get("originId"), True)
    ids = [row for row in (request.args.get("issuerIds") or "").split(",") if row]
    if not 2 <= len(ids) <= 8:
        raise WorkspaceError("research.compare_issuers_invalid")
    from services.fundamentals import compare_line

    store = _store()
    bundles = [store.get_issuer(origin, _identifier(row)) for row in ids]
    return jsonify(
        compare_line(
            bundles,
            line=request.args.get("line") or "",
            as_of=request.args.get("asOf") or now(),
        )
    )


@research_bp.post("/issuers/<issuer_id>/notes")
def add_note(issuer_id):
    body = _json(("originId", "documentVersionId", "text"), ())
    origin = _origin(body["originId"], True)
    text = body["text"]
    if not isinstance(text, str) or not text.strip() or len(text) > 4000:
        raise WorkspaceError("research.note_invalid")
    note = {
        "id": opaque(
            "researchnote", f"{issuer_id}|{body['documentVersionId']}|{now()}|{text[:64]}"
        ),
        "documentVersionId": _identifier(body["documentVersionId"]),
        "text": text,
        "createdAt": now(),
    }
    return jsonify(_store().append_note(origin, _identifier(issuer_id), note)), 201


@research_bp.get("/issuers/<issuer_id>/notes")
def list_notes(issuer_id):
    _query("originId")
    origin = _origin(request.args.get("originId"), True)
    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    return jsonify({"notes": bundle.get("notes", [])})


@research_bp.post("/issuers/<issuer_id>/snapshots")
def save_snapshot(issuer_id):
    body = _json(("originId", "label"), ("asOf", "note", "links"))
    origin = _origin(body["originId"], True)
    label = body["label"]
    if not isinstance(label, str) or not label.strip() or len(label) > 200:
        raise WorkspaceError("research.snapshot_label_invalid")
    store = _store()
    bundle = store.get_issuer(origin, _identifier(issuer_id))
    as_of = body.get("asOf") or now()
    selected = store.facts_as_of(origin, _identifier(issuer_id), as_of=as_of)
    snapshot_record = {
        "id": opaque("researchsnapshot", f"{issuer_id}|{label}|{now()}"),
        "label": label,
        "note": body.get("note"),
        "links": body.get("links") or [],
        "asOf": as_of,
        "savedAt": now(),
        "issuer": bundle["issuer"],
        "facts": selected,
        "immutable": True,
    }
    return jsonify(store.append_snapshot(origin, _identifier(issuer_id), snapshot_record)), 201


@research_bp.get("/issuers/<issuer_id>/snapshots")
def list_snapshots(issuer_id):
    _query("originId")
    origin = _origin(request.args.get("originId"), True)
    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    rows = [
        {key: row.get(key) for key in ("id", "label", "note", "links", "asOf", "savedAt")}
        | {"factCount": len(row["facts"])}
        for row in bundle.get("snapshots", [])
    ]
    return jsonify({"snapshots": rows})


@research_bp.get("/issuers/<issuer_id>/snapshots/<snapshot_id>")
def get_snapshot(issuer_id, snapshot_id):
    _query("originId")
    origin = _origin(request.args.get("originId"), True)
    bundle = _store().get_issuer(origin, _identifier(issuer_id))
    match = next(
        (row for row in bundle.get("snapshots", []) if row["id"] == _identifier(snapshot_id)),
        None,
    )
    if match is None:
        raise WorkspaceError("research.snapshot_not_found", 404)
    return jsonify(match)


@research_bp.post("/retention/action")
def retention_action():
    _query()
    body = _json(("originId", "action", "payload"), ())
    if body["action"] != "delete-issuer":
        raise WorkspaceError("research.invalid_command")
    payload = body["payload"]
    if not isinstance(payload, dict) or type(payload.get("expectedFactCount")) is not int:
        raise WorkspaceError("research.invalid_command")
    origin = _origin(body["originId"], True)
    return jsonify(
        _store().delete_issuer(
            origin,
            _identifier(payload.get("issuerId")),
            expected_fact_count=payload["expectedFactCount"],
        )
    )


@research_bp.post("/ingestion/action")
def ingestion_action():
    _query()
    body = _json(("originId", "action", "payload"), ("jobId",))
    name = body["action"]
    if name not in {"submit", "run-next", "cancel", "recover"}:
        raise WorkspaceError("ingestion.invalid_command")
    payload = body["payload"]
    if not isinstance(payload, dict):
        raise WorkspaceError("ingestion.invalid_command")
    origin = _origin(body["originId"], True)
    jobs = _jobs()
    if name == "submit":
        cik = payload.get("cik")
        request_id = payload.get("requestId")
        if not isinstance(cik, str) or not cik.isdigit():
            raise WorkspaceError("ingestion.invalid_command")
        return jsonify({"job": jobs.submit_company(origin, request_id=request_id, cik=cik)})
    if name == "run-next":
        storage = _storage()
        job = jobs.run_next(
            origin,
            make_edgar_client(),
            owner_id=storage.uid,
            workspace_id=opaque("workspace", storage.uid + "|" + origin),
        )
        return jsonify({"job": job})
    if name == "recover":
        return jsonify({"jobs": jobs.recover(origin)})
    return jsonify({"job": jobs.cancel(origin, _identifier(body.get("jobId")))})


@research_bp.get("/ingestion")
def ingestion_list():
    _query("originId")
    origin = _origin(request.args.get("originId"), True)
    return jsonify({"jobs": _jobs().list(origin)})
