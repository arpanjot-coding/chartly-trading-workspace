"""Local history synchronization and cross-source reconciliation (P22).

Truth model: raw source observations are preserved verbatim per
source; coverage is a set of *proven* intervals — a window nobody has
successfully fetched stays visibly missing instead of being implied
complete. Catch-up jobs are single-flight per (connection, account):
ten chart tabs produce one worker. Cross-source merges happen only
on reliable identifiers after an explicit account link; look-alikes
(similar time/price) go to a conflict queue for a human. Journal-only
sync needs no execution permission anywhere in this module.
"""

from __future__ import annotations

from copy import deepcopy


def _merge_intervals(intervals):
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def missing_intervals(known, wanted_start, wanted_end):
    gaps = []
    cursor = wanted_start
    for start, end in _merge_intervals(known):
        if end <= wanted_start or start >= wanted_end:
            continue
        if start > cursor:
            gaps.append((cursor, min(start, wanted_end)))
        cursor = max(cursor, end)
    if cursor < wanted_end:
        gaps.append((cursor, wanted_end))
    return gaps


def backoff_seconds(attempt, *, base=5, cap=300):
    return min(cap, base * (2 ** max(0, attempt - 1)))


class HistorySync:
    """In-memory state with export/restore (persistence rides backup)."""

    def __init__(self):
        self._sources = {}  # source_key -> state
        self._jobs = {}  # (connection, account) -> job
        self._links = {}  # link_id -> {sources: [keys], priority: [keys]}
        self._conflicts = []

    # -- sources & coverage (T02/T07) ---------------------------------------

    def register_source(self, key, *, provider_id, account_ref, capabilities):
        self._sources[key] = {
            "key": key,
            "providerId": provider_id,
            "accountRef": account_ref,
            "capabilities": capabilities,
            "detached": False,
            "coverage": [],
            "events": {},  # namespaced external id -> observation
            "lastSuccessfulRequestAt": None,
            "lastObservedEventAt": None,
            "positionsSnapshotAt": None,
            "cursor": None,
            "annotations": {},
        }
        return self.status(key)

    def detach_source(self, key):
        """Detach stops future sync; stored history is preserved."""
        self._sources[key]["detached"] = True
        return self.status(key)

    def status(self, key, *, wanted=None):
        state = self._sources[key]
        result = {
            "source": key,
            "detached": state["detached"],
            "eventCount": len(state["events"]),
            "lastSuccessfulRequestAt": state["lastSuccessfulRequestAt"],
            "lastObservedEventAt": state["lastObservedEventAt"],
            "positionsSnapshotAt": state["positionsSnapshotAt"],
            "knownCoverage": [list(row) for row in _merge_intervals(state["coverage"])],
            "cursor": state["cursor"],
        }
        if wanted:
            result["missingCoverage"] = [
                list(row) for row in missing_intervals(state["coverage"], wanted[0], wanted[1])
            ]
            result["completeForWanted"] = not result["missingCoverage"]
        return result

    # -- single-flight jobs (T01) -------------------------------------------

    def request_catchup(self, connection_id, account_ref, *, job_id):
        key = (connection_id, account_ref)
        existing = self._jobs.get(key)
        if existing and existing["state"] == "running":
            return {**existing, "coalesced": True}
        job = {"id": job_id, "connectionId": connection_id, "accountRef": account_ref, "state": "running"}
        self._jobs[key] = job
        return {**job, "coalesced": False}

    def finish_job(self, connection_id, account_ref, state="completed"):
        job = self._jobs.get((connection_id, account_ref))
        if job:
            job["state"] = state
        return job

    # -- bounded catch-up with checkpoints (T04) ------------------------------

    def run_catchup(self, key, fetcher, *, window, requested_at, max_pages=10, cancel_flag=None):
        """fetcher(cursor) -> {events, nextCursor, windowCovered}.

        The cursor checkpoints after every page; an interruption keeps
        pages already ingested and never claims the rest as covered.
        """
        state = self._sources[key]
        if state["detached"]:
            return {"status": "refused_detached", "ingested": 0}
        cursor = state["cursor"]
        ingested = duplicates = pages = 0
        while pages < max_pages:
            if cancel_flag and cancel_flag():
                return {"status": "cancelled", "ingested": ingested, "duplicates": duplicates, "cursor": cursor}
            page = fetcher(cursor)
            pages += 1
            for event in page["events"]:
                external = f"{key}:{event['externalEventId']}"
                if external in state["events"]:
                    duplicates += 1
                    continue
                state["events"][external] = {**event, "sourceKey": key}
                ingested += 1
                occurred = event.get("occurredAt")
                if occurred and (state["lastObservedEventAt"] is None or occurred > state["lastObservedEventAt"]):
                    state["lastObservedEventAt"] = occurred
            if page.get("windowCovered"):
                state["coverage"] = _merge_intervals([*state["coverage"], tuple(page["windowCovered"])])
            cursor = page.get("nextCursor")
            state["cursor"] = cursor  # durable checkpoint per page
            state["lastSuccessfulRequestAt"] = requested_at
            if cursor is None:
                break
        return {
            "status": "completed" if cursor is None else "page_bound_reached",
            "ingested": ingested,
            "duplicates": duplicates,
            "pages": pages,
            "coverage": self.status(key, wanted=window),
        }

    # -- history-only setup preview (T03) -------------------------------------

    @staticmethod
    def setup_preview(manifest):
        """manifest: {providerId, historySupported, windowLimitDays, methods}"""
        warnings = []
        if not manifest["historySupported"]:
            warnings.append("Provider exposes no account history; use statement import instead.")
        limit = manifest.get("windowLimitDays")
        if limit:
            warnings.append(
                f"Provider history is limited to {limit} days per request/window; older history needs statement or direct-source backfill and stays marked incomplete until then."
            )
        return {
            "providerId": manifest["providerId"],
            "methods": manifest["methods"],
            "executionSetupRequired": False,
            "warnings": warnings,
        }

    # -- cross-source reconciliation (T05) -------------------------------------

    def link_accounts(self, link_id, source_keys, *, priority):
        self._links[link_id] = {"sources": list(source_keys), "priority": list(priority)}

    def reconcile_link(self, link_id, *, alias_map):
        """alias_map: source-namespaced id -> canonical shared id.

        Only alias-mapped ids join. Unmapped events that merely look
        alike (same occurredAt + amount) are queued as conflicts."""
        link = self._links[link_id]
        canonical = {}
        candidates = {}
        for key in link["priority"]:
            for external, event in self._sources[key]["events"].items():
                shared = alias_map.get(external)
                if shared:
                    canonical.setdefault(shared, {"event": event, "sources": []})["sources"].append(key)
                else:
                    fingerprint = (event.get("occurredAt"), str(event.get("amount")))
                    candidates.setdefault(fingerprint, []).append(external)
        conflicts = [
            {"linkId": link_id, "fingerprint": list(fp), "candidates": ids, "reason": "approximate_match_needs_human"}
            for fp, ids in candidates.items()
            if len(ids) > 1
        ]
        self._conflicts = [row for row in self._conflicts if row["linkId"] != link_id] + conflicts
        return {
            "joined": {shared: row["sources"] for shared, row in canonical.items()},
            "conflicts": conflicts,
            "doubleCounted": False,
        }

    def annotate(self, key, external_id, text):
        self._sources[key]["annotations"][f"{key}:{external_id}"] = text

    # -- backup/restore (T08) ----------------------------------------------------

    def export_state(self):
        return deepcopy(
            {
                "sources": {
                    key: {**state, "events": state["events"]}
                    for key, state in self._sources.items()
                },
                "links": self._links,
                "conflicts": self._conflicts,
            }
        )

    def import_state(self, payload):
        self._sources = deepcopy(payload["sources"])
        for state in self._sources.values():
            state["coverage"] = [tuple(row) for row in state["coverage"]]
        self._links = deepcopy(payload["links"])
        self._conflicts = deepcopy(payload["conflicts"])
        self._jobs = {}
