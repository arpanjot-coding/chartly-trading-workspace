"""Optional AI research boundary + redacted support export (P17-T07/T08).

AI assistance is read-only and source-cited: the model callable only
ever receives already-saved snapshot evidence, its declared tool
permissions are `read` only, and when no model is configured the
feature reports itself unavailable without affecting anything else.

The support export redacts by *meaning*: any key whose name suggests
a credential (secret, token, password, api key in any spelling,
authorization, private key, session…) is replaced, at any depth.
Unknown shapes fail closed — unrecognized container types are
summarized, never passed through raw.
"""

from __future__ import annotations

import re

_SECRET_KEY = re.compile(
    r"(secret|token|password|passwd|api[_-]?key|apikey|authorization|auth[_-]?key|"
    r"private[_-]?key|session[_-]?id|cookie|credential|totp|otp|pin)",
    re.IGNORECASE,
)
REDACTED = "[redacted]"


def redact(value, _depth=0):
    if _depth > 12:
        return "[truncated]"
    if isinstance(value, dict):
        return {
            key: REDACTED if _SECRET_KEY.search(str(key)) else redact(item, _depth + 1)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(item, _depth + 1) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return f"[{type(value).__name__} omitted]"


def support_export(*, versions, counts, states):
    """Redacted diagnostics bundle safe to share with support."""
    return {
        "kind": "chartly-support-export",
        "versions": redact(versions),
        "counts": redact(counts),
        "states": redact(states),
        "note": "Credentials and secret-shaped fields are redacted by name at any depth; account balances and personal data are not included by the callers of this export.",
    }


class AiResearchAssistant:
    """Read-only, citation-bound assistant over saved evidence."""

    declared_permissions = ["read:snapshots", "read:facts"]  # no write tools exist

    def __init__(self, model=None):
        self._model = model  # callable(prompt, evidence) -> text, or None

    @property
    def configured(self):
        return self._model is not None

    def answer(self, question, snapshot):
        if not self.configured:
            return {
                "status": "unavailable",
                "reason": "No AI model is configured. All non-AI research workflows remain available.",
                "citations": [],
            }
        facts = snapshot.get("facts", [])
        citations = sorted({row.get("citation") for row in facts if row.get("citation")})
        evidence = [
            {
                "metricId": row["metricId"],
                "value": row["value"],
                "unit": row["unit"],
                "periodEnd": row["periodEnd"],
                "citation": row.get("citation"),
            }
            for row in facts
        ]
        text = self._model(question, evidence)
        return {
            "status": "answered",
            "text": text,
            "citations": citations,
            "permissionsUsed": ["read:snapshots"],
            "writesPerformed": False,
        }
