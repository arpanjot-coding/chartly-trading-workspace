"""Pure, bounded, revision-preserving account-history reconciliation.

This module fetches nothing and writes nothing. The owning service publishes its
result with journal facts and a command receipt in one scoped transaction.
"""

from __future__ import annotations

import hashlib
import json
import math
from copy import deepcopy
from datetime import UTC, datetime

MAX_PAGE = 200
MAX_OBSERVATIONS = 5000
MAX_CONFLICTS = 1000
MAX_COVERAGE = 1000
MAX_PAYLOAD_BYTES = 16 * 1024
SECRET_KEYS = {
    "password",
    "passwordhash",
    "secret",
    "apikey",
    "apisecret",
    "accesstoken",
    "refreshtoken",
    "authtoken",
    "clientsecret",
    "authorization",
    "credentials",
    "totpsecret",
    "investorpassword",
}


def _error(code, status=400):
    from services.workspace_storage import WorkspaceError

    raise WorkspaceError("connector." + code, status)


def data_only(value, *, maximum=4 * 1024 * 1024):
    stack = [(value, 0)]
    nodes = 0
    while stack:
        item, depth = stack.pop()
        nodes += 1
        if depth > 32 or nodes > 200_000:
            _error("data_budget", 413)
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str) or key in {"__proto__", "prototype", "constructor"}:
                    _error("invalid_data")
                folded = "".join(character for character in key.lower() if character.isalnum())
                if folded in SECRET_KEYS:
                    _error("secret_field")
                stack.append((child, depth + 1))
        elif isinstance(item, list):
            stack.extend((child, depth + 1) for child in item)
        elif isinstance(item, str):
            if len(item) > 100_000 or "\x00" in item:
                _error("invalid_data")
        elif isinstance(item, float):
            if not math.isfinite(item):
                _error("invalid_data")
        elif item is not None and not isinstance(item, (int, bool)):
            _error("invalid_data")
    try:
        raw = json.dumps(
            value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode()
    except (TypeError, ValueError, RecursionError, UnicodeError):
        _error("invalid_data")
    if len(raw) > maximum:
        _error("data_budget", 413)
    return raw


def checksum(value):
    return hashlib.sha256(data_only(value)).hexdigest()


def _text(value, maximum=500):
    return isinstance(value, str) and 0 < len(value) <= maximum and "\x00" not in value


def instant(value):
    if not _text(value, 80):
        _error("invalid_history_time")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            _error("history_timezone_required")
        return parsed.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
    except (ValueError, OverflowError) as error:
        from services.workspace_storage import WorkspaceError

        if isinstance(error, WorkspaceError):
            raise
        _error("invalid_history_time")


def empty_history():
    return {
        "version": 1,
        "observations": [],
        "latest": {},
        "cursor": None,
        "coverage": [],
        "conflicts": [],
        "confirmed": [],
    }


def _scope(context):
    if not isinstance(context, dict) or any(
        not _text(context.get(key)) for key in ("providerId", "connectionId", "accountKey")
    ):
        _error("history_scope_required")
    return {key: context[key] for key in ("providerId", "connectionId", "accountKey")}


def _content(event):
    return {
        key: event[key]
        for key in (
            "externalEventId",
            "revision",
            "kind",
            "status",
            "occurredAt",
            "payload",
            "normalizedTrade",
            "timeBasis",
        )
        if key in event and not (key == "occurredAt" and event.get("timeBasis") == "receipt-only")
    }


def _validate_event(event):
    allowed = {
        "externalEventId",
        "revision",
        "kind",
        "status",
        "occurredAt",
        "payload",
        "normalizedTrade",
        "timeBasis",
    }
    if (
        not isinstance(event, dict)
        or set(event) - allowed
        or not _text(event.get("externalEventId"))
    ):
        _error("invalid_history_event")
    if "revision" in event and (
        type(event["revision"]) is not int or not 1 <= event["revision"] <= 9007199254740991
    ):
        _error("invalid_history_event")
    if event.get("kind") not in {
        "trade",
        "fill",
        "order",
        "cashflow",
        "fee",
        "balance",
    } or event.get("status") not in {"confirmed", "partial", "unknown", "rejected", "cancelled"}:
        _error("invalid_history_event")
    if event.get("timeBasis", "provider") not in {"provider", "receipt-only"} or not isinstance(
        event.get("payload"), dict
    ):
        _error("invalid_history_event")
    instant(event.get("occurredAt"))
    normalized = event.get("normalizedTrade")
    if normalized is not None and (
        not isinstance(normalized, dict)
        or normalized.get("eventId") != event["externalEventId"]
        or normalized.get("eventType") != "trade"
        or not normalized.get("closedAt")
        or event["kind"] != "trade"
        or event["status"] != "confirmed"
        or event.get("timeBasis") == "receipt-only"
    ):
        _error("unconfirmed_journal_fact")
    data_only(event, maximum=MAX_PAYLOAD_BYTES)


def validate_history(value):
    if not isinstance(value, dict) or value.get("version") != 1:
        _error("invalid_history")
    if set(value) - {
        "version",
        "scope",
        "observations",
        "latest",
        "cursor",
        "coverage",
        "conflicts",
        "confirmed",
    }:
        _error("invalid_history")
    for key, limit in (
        ("observations", MAX_OBSERVATIONS),
        ("coverage", MAX_COVERAGE),
        ("conflicts", MAX_CONFLICTS),
        ("confirmed", MAX_OBSERVATIONS),
    ):
        if not isinstance(value.get(key), list) or len(value[key]) > limit:
            _error("history_budget", 413)
    if not isinstance(value.get("latest"), dict) or len(value["latest"]) > MAX_OBSERVATIONS:
        _error("invalid_history")
    scope = _scope(value["scope"]) if "scope" in value else None
    observations = {}
    for observation in value["observations"]:
        if not isinstance(observation, dict):
            _error("invalid_observation")
        event = observation.get("event")
        _validate_event(event)
        if checksum(_content(event)) != observation.get("payloadChecksum"):
            _error("observation_checksum_mismatch")
        if any(observation.get(key) != field for key, field in (scope or {}).items()):
            _error("history_scope_mismatch")
        expected = (
            "observation_"
            + checksum(
                [
                    scope,
                    event["externalEventId"],
                    event.get("revision"),
                    observation["payloadChecksum"],
                ]
            )[:40]
        )
        if (
            observation.get("id") != expected
            or expected in observations
            or type(observation.get("revision")) is not int
            or observation["revision"] < 1
        ):
            _error("invalid_observation_identity")
        received_at = instant(observation.get("receivedAt"))
        if event.get("timeBasis") == "receipt-only" and instant(event["occurredAt"]) != received_at:
            _error("invalid_receipt_time")
        if "revision" in event and observation["revision"] != event["revision"]:
            _error("invalid_observation_revision")
        observations[expected] = observation
    conflicts = {}
    for conflict in value["conflicts"]:
        if (
            not isinstance(conflict, dict)
            or set(conflict)
            != {"externalEventId", "previousObservationId", "observationId", "reason"}
            or conflict.get("reason") != "conflicting-revision"
        ):
            _error("invalid_history_conflict")
        if (
            conflict.get("observationId") not in observations
            or conflict.get("previousObservationId") not in observations
        ):
            _error("invalid_history_conflict")
        if (
            observations[conflict["observationId"]]["event"]["externalEventId"]
            != conflict["externalEventId"]
        ):
            _error("invalid_history_conflict")
        if conflict["observationId"] in conflicts:
            _error("invalid_history_conflict")
        conflicts[conflict["observationId"]] = conflict
    accepted = {}
    for observation in observations.values():
        external_id = observation["event"]["externalEventId"]
        previous_id = accepted.get(external_id)
        if observation.get("correctsObservationId") != previous_id:
            _error("invalid_observation_chain")
        if observation["id"] in conflicts:
            if (
                not previous_id
                or conflicts[observation["id"]]["previousObservationId"] != previous_id
            ):
                _error("invalid_history_conflict")
        else:
            if "revision" not in observation["event"] and observation["revision"] != (
                observations[previous_id]["revision"] + 1 if previous_id else 1
            ):
                _error("invalid_observation_revision")
            if previous_id and observation["revision"] <= observations[previous_id]["revision"]:
                _error("invalid_observation_revision")
            accepted[external_id] = observation["id"]
    if accepted != value["latest"]:
        _error("invalid_latest_observation")
    for external_id, observation_id in value["latest"].items():
        observation = observations.get(observation_id)
        if not observation or observation["event"].get("externalEventId") != external_id:
            _error("invalid_latest_observation")
    for observation in observations.values():
        previous = observation.get("correctsObservationId")
        if previous is not None and previous not in observations:
            _error("missing_previous_observation")
    confirmed = [
        deepcopy(observations[identity]["event"]["normalizedTrade"])
        for identity in accepted.values()
        if observations[identity]["event"].get("normalizedTrade") is not None
    ]
    confirmed.sort(key=lambda row: row["eventId"])
    if confirmed != value["confirmed"]:
        _error("invalid_confirmed_projection")
    complete_to = []
    for coverage in value["coverage"]:
        if (
            not isinstance(coverage, dict)
            or set(coverage) - {"from", "to", "complete", "observedAt", "reason"}
            or type(coverage.get("complete")) is not bool
        ):
            _error("invalid_history_coverage")
        _window({key: coverage.get(key) for key in ("from", "to")})
        instant(coverage.get("observedAt"))
        if coverage["complete"]:
            complete_to.append(coverage["to"])
    cursor = value.get("cursor")
    if cursor is not None:
        if not isinstance(cursor, dict) or set(cursor) - {
            "nativeCursor",
            "window",
            "observedThrough",
        }:
            _error("invalid_history_cursor")
        if cursor.get("nativeCursor") is not None and not _text(cursor["nativeCursor"]):
            _error("invalid_history_cursor")
        if cursor.get("observedThrough") is not None:
            instant(cursor["observedThrough"])
            if not complete_to or cursor["observedThrough"] > max(complete_to):
                _error("unobserved_history_cursor")
        _window(cursor.get("window"))
    data_only(value)
    return deepcopy(value)


def _window(value):
    if not isinstance(value, dict) or set(value) != {"from", "to"}:
        _error("invalid_history_window")
    result = {key: instant(value[key]) for key in ("from", "to")}
    if result["from"] >= result["to"]:
        _error("invalid_history_window")
    return result


def merge_history(current, page, context):
    """Retain every unique observed revision; return only confirmed trade rows.

    `context` is trusted service scope, never user-supplied provider identity.
    `rows` must still pass the existing P03 normalizer before atomic publication.
    """
    history = validate_history(current if current is not None else empty_history())
    scope = _scope(context)
    if history.get("scope") not in (None, scope):
        _error("history_scope_mismatch", 409)
    history["scope"] = scope
    received_at = instant(context.get("receivedAt"))
    if not isinstance(page, dict) or page.get("providerId") != scope["providerId"]:
        _error("history_provider_mismatch", 409)
    window = _window(page.get("window"))
    if context.get("window") is not None and _window(context["window"]) != window:
        _error("history_window_mismatch", 409)
    for flag in ("hasMore", "complete"):
        if type(page.get(flag)) is not bool:
            _error("invalid_history_page")
    if page["complete"] and page["hasMore"]:
        _error("invalid_history_page")
    next_cursor = page.get("nextCursor")
    if page["hasMore"]:
        if not _text(next_cursor) or next_cursor == page.get("cursor"):
            _error("history_cursor_not_progressing", 409)
    elif next_cursor is not None:
        _error("invalid_history_cursor")
    if "expectedCursor" in context and page.get("cursor") != context["expectedCursor"]:
        _error("history_cursor_mismatch", 409)
    events = page.get("events")
    if not isinstance(events, list) or len(events) > MAX_PAGE:
        _error("history_page_budget", 413)
    coverage = page.get("coverage")
    if not isinstance(coverage, dict) or type(coverage.get("complete")) is not bool:
        _error("invalid_history_coverage")
    coverage_window = _window({key: coverage.get(key) for key in ("from", "to")})
    if not window["from"] <= coverage_window["from"] < coverage_window["to"] <= window["to"]:
        _error("history_coverage_mismatch")
    if coverage["complete"] != page["complete"]:
        _error("history_coverage_mismatch")
    if context.get("identity") is not None and page.get("identity") != context["identity"]:
        _error("history_identity_changed", 409)
    by_id = {observation["id"]: observation for observation in history["observations"]}
    rows, inserts, duplicates, corrections, conflicts = [], 0, 0, 0, 0
    for raw in events:
        if not isinstance(raw, dict) or set(raw) - {
            "externalEventId",
            "revision",
            "kind",
            "status",
            "occurredAt",
            "payload",
            "normalizedTrade",
            "timeBasis",
        }:
            _error("invalid_history_event")
        event = deepcopy(raw)
        if (
            not _text(event.get("externalEventId"))
            or "revision" in event
            and (
                type(event["revision"]) is not int or not 1 <= event["revision"] <= 9007199254740991
            )
        ):
            _error("invalid_history_event")
        if event.get("kind") not in {
            "trade",
            "fill",
            "order",
            "cashflow",
            "fee",
            "balance",
        } or event.get("status") not in {
            "confirmed",
            "partial",
            "unknown",
            "rejected",
            "cancelled",
        }:
            _error("invalid_history_event")
        if event.get("timeBasis", "provider") not in {"provider", "receipt-only"}:
            _error("invalid_history_time_basis")
        event["occurredAt"] = (
            received_at
            if event.get("timeBasis") == "receipt-only"
            else instant(event.get("occurredAt"))
        )
        if (
            event.get("timeBasis") != "receipt-only"
            and not window["from"] <= event["occurredAt"] < window["to"]
        ):
            _error("history_event_outside_window")
        if not isinstance(event.get("payload"), dict):
            _error("invalid_history_payload")
        data_only(event, maximum=MAX_PAYLOAD_BYTES)
        normalized = event.get("normalizedTrade")
        if normalized is not None and (
            not isinstance(normalized, dict)
            or normalized.get("eventId") != event["externalEventId"]
            or normalized.get("eventType") != "trade"
            or not normalized.get("closedAt")
            or event["kind"] != "trade"
            or event["status"] != "confirmed"
            or event.get("timeBasis") == "receipt-only"
        ):
            _error("unconfirmed_journal_fact")
        payload_checksum = checksum(_content(event))
        observation_id = (
            "observation_"
            + checksum([scope, event["externalEventId"], event.get("revision"), payload_checksum])[
                :40
            ]
        )
        if observation_id in by_id:
            duplicates += 1
            continue
        prior_id = history["latest"].get(event["externalEventId"])
        prior = by_id.get(prior_id)
        observation = {
            "id": observation_id,
            **scope,
            "event": event,
            "payloadChecksum": payload_checksum,
            "receivedAt": received_at,
            "revision": event.get("revision", prior["revision"] + 1 if prior else 1),
        }
        if prior:
            observation["correctsObservationId"] = prior_id
        history["observations"].append(observation)
        by_id[observation_id] = observation
        if prior and (
            "revision" in event
            and event["revision"] <= prior["revision"]
            or prior["event"].get("normalizedTrade") is not None
            and normalized is None
        ):
            conflict = {
                "externalEventId": event["externalEventId"],
                "previousObservationId": prior_id,
                "observationId": observation_id,
                "reason": "conflicting-revision",
            }
            history["conflicts"].append(conflict)
            conflicts += 1
            continue
        history["latest"][event["externalEventId"]] = observation_id
        inserts += int(prior is None)
        corrections += int(prior is not None)
        if normalized is not None:
            rows.append(deepcopy(normalized))
    unverified_clock = any(event.get("timeBasis") == "receipt-only" for event in events)
    complete = page["complete"] and not conflicts and not unverified_clock
    record = {
        "from": coverage_window["from"],
        "to": coverage_window["to"],
        "complete": complete,
        "observedAt": received_at,
    }
    if not complete:
        record["reason"] = (
            "conflicting-revision"
            if conflicts
            else "provider_clock_unverified"
            if unverified_clock
            else coverage.get("reason", "partial-page")
        )
    matching = next(
        (
            value
            for value in history["coverage"]
            if all(
                value.get(key) == record.get(key) for key in ("from", "to", "complete", "reason")
            )
        ),
        None,
    )
    if matching is None:
        history["coverage"].append(record)
    else:
        matching["observedAt"] = received_at
    old_cursor = history.get("cursor") or {}
    observed_through = old_cursor.get("observedThrough")
    if complete:
        if observed_through is None:
            observed_through = coverage_window["to"]
        else:
            for covered in sorted(
                (value for value in history["coverage"] if value["complete"]),
                key=lambda value: value["from"],
            ):
                if covered["from"] <= observed_through < covered["to"]:
                    observed_through = covered["to"]
    consumed_continuation = (
        page.get("cursor") is not None
        and page["cursor"] == old_cursor.get("nativeCursor")
        and window == old_cursor.get("window")
    )
    if not conflicts and (page["hasMore"] or complete or consumed_continuation):
        # A transport page can end while UTC coverage remains unverified. Clear
        # its consumed pointer separately from the verified coverage highwater.
        history["cursor"] = {"nativeCursor": next_cursor, "window": window}
        if observed_through:
            history["cursor"]["observedThrough"] = observed_through
    history["confirmed"] = [
        deepcopy(by_id[observation_id]["event"]["normalizedTrade"])
        for observation_id in history["latest"].values()
        if by_id[observation_id]["event"].get("normalizedTrade") is not None
    ]
    history["confirmed"].sort(key=lambda value: value["eventId"])
    validate_history(history)
    return {
        "history": history,
        "rows": rows,
        "summary": {
            "inserted": inserts,
            "duplicates": duplicates,
            "corrected": corrections,
            "conflicts": conflicts,
            "observed": len(events),
            "complete": complete,
        },
    }
