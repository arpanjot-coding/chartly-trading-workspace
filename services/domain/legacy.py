"""Conservative, side-effect-free legacy classification; never a migration writer."""

import json
from math import isfinite

from services.domain.validation import CONTRACTS

POLICY = json.loads((CONTRACTS / "legacy-policy.json").read_text(encoding="utf-8"))


def _id(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and 0 < value <= POLICY["maxLegacyId"]
        and isfinite(value)
        and int(value) == value
    )


def legacy_alias(origin_namespace, table, legacy_id):
    if (
        not isinstance(origin_namespace, str)
        or not 1 <= len(origin_namespace) <= 200
        or ":" in origin_namespace
    ):
        raise ValueError("legacy.origin_namespace_required")
    if table not in POLICY["tables"] or not _id(legacy_id):
        raise ValueError("legacy.invalid_identity")
    return {"namespace": f"ChartlyTraderDB:{origin_namespace}:{table}", "key": str(int(legacy_id))}


def classify_legacy_trade(value):
    if not isinstance(value, dict) or not _id(value.get("id")) or not _id(value.get("portfolioId")):
        return {"state": "invalid", "reason": "legacy.invalid_identity"}
    for field in ("accountId", "sessionId"):
        if field in value and not _id(value[field]):
            return {"state": "invalid", "reason": "legacy.invalid_reference"}
    origin = value.get("origin")
    if origin == "manual" and "accountId" not in value and "sessionId" not in value:
        return {"state": "manual", "reason": "legacy.explicit_manual"}
    if origin in POLICY["paperOrigins"] and "accountId" not in value:
        return {"state": "needs_practice_mapping", "reason": "legacy.dataset_run_unverified"}
    if origin in POLICY["externalOrigins"] and "accountId" in value:
        return {"state": "needs_account_verification", "reason": "legacy.account_unverified"}
    return {"state": "needs_classification", "reason": "legacy.ambiguous_provenance"}
