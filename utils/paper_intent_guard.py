"""Reject explicitly historical intents at broker ingress, without changing live schemas."""

from flask import jsonify, request


def historical_intent(value):
    stack = [(value, 0)]
    visited = 0
    while stack:
        item, depth = stack.pop()
        visited += 1
        if visited > 100000 or depth > 40:
            return True  # never dispatch a transactional intent we could not inspect
        if isinstance(item, dict):
            source = item.get("source")
            if (
                any(
                    item.get(key) in ("paper_replay", "replay", "historical")
                    for key in ("mode", "executionMode", "profileKind")
                )
                or any(
                    key in item
                    for key in (
                        "paperRunId",
                        "paperSessionId",
                        "runId",
                        "datasetVersionId",
                        "datasetChecksum",
                    )
                )
                or isinstance(source, dict)
                and source.get("kind") == "dataset"
            ):
                return True
            stack.extend(
                (child, depth + 1) for child in item.values() if isinstance(child, (dict, list))
            )
        elif isinstance(item, list):
            stack.extend((child, depth + 1) for child in item if isinstance(child, (dict, list)))
    return False


def reject_historical_broker_intent():
    if request.method not in ("POST", "PUT", "PATCH", "DELETE"):
        return None
    if historical_intent(request.get_json(silent=True)):
        return jsonify(
            {
                "status": "error",
                "code": "paper.broker_route_denied",
                "message": "Historical paper decisions belong to the owned paper session, never a broker order route.",
            }
        ), 403
    return None
