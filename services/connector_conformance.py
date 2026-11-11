"""Evidence from trusted read-only adapter calls, never caller-submitted claims."""

from __future__ import annotations

from copy import deepcopy
from datetime import timedelta

from services import connector_adapters as adapters

ORDER_CAPABILITIES = {"orderSubmit", "orderCancel", "protectiveOrders"}


def _facts(page):
    rows = []
    for event in page.get("events", []):
        row = deepcopy(event)
        if row.get("timeBasis") == "receipt-only":
            row.pop("occurredAt", None)
        rows.append(row)
    return sorted(
        rows, key=lambda value: (value.get("externalEventId", ""), adapters.checksum(value))
    )


def evaluate_conformance(provider_id, configuration, observation, pages=(), *, checked_at=None):
    """Pure verifier used by the trusted runner and negative conformance tests.

    This function validates structure/integrity, not the origin of supplied data.
    Only run_conformance is exposed to the production registry dispatcher.
    """
    description = adapters.describe_provider(provider_id)
    checked = checked_at or adapters.utc_now()
    checks = []

    def check(identifier, passed, reason=None):
        checks.append(
            {"id": identifier, "passed": bool(passed), **({"reason": reason} if reason else {})}
        )

    try:
        adapters.normalize_configuration(provider_id, configuration)
        configuration_valid = True
    except adapters.AdapterError:
        configuration_valid = False
    check("configuration-allowlist", configuration_valid, "connector.invalid_configuration")
    configuration = configuration if isinstance(configuration, dict) else {}

    observation = observation if isinstance(observation, dict) else {}
    identity = observation.get("identity", {})
    identity = identity if isinstance(identity, dict) else {}
    capabilities = observation.get("capabilities", {})
    capabilities = capabilities if isinstance(capabilities, dict) else {}
    raw_permissions = observation.get("permissions")
    permissions_valid = isinstance(raw_permissions, list) and all(
        isinstance(value, str) for value in raw_permissions
    )
    permissions = raw_permissions if permissions_valid else []
    check(
        "provider-version",
        observation.get("providerId") == provider_id
        and observation.get("adapterVersion") == description["version"],
        "connector.evidence_provider_mismatch",
    )
    check(
        "identity-scope",
        identity.get("providerId") == provider_id
        and identity.get("environment") in description["environments"]
        and isinstance(identity.get("externalId"), str)
        and bool(identity.get("externalId"))
        and isinstance(identity.get("server"), str)
        and bool(identity.get("server")),
        "connector.evidence_identity_mismatch",
    )
    check(
        "synthetic-scope",
        identity.get("synthetic") is description["synthetic"],
        "connector.synthetic_evidence_mismatch",
    )
    try:
        age = adapters.instant(checked) - adapters.instant(observation.get("observedAt"))
        fresh = -timedelta(seconds=5) <= age <= timedelta(seconds=120)
    except adapters.AdapterError:
        fresh = False
    check("observed-freshness", fresh, "connector.observation_stale")
    valid_capabilities = (
        isinstance(capabilities, dict)
        and set(capabilities) == set(adapters.CAPABILITIES)
        and all(
            isinstance(value, dict)
            and value.get("state") in {"supported", "unsupported", "unknown"}
            for value in capabilities.values()
        )
    )
    check("capability-states", valid_capabilities, "connector.invalid_capability_evidence")
    declared = {row["id"] for row in description["capabilities"] if row["supported"]}
    measured = {
        key
        for key, value in capabilities.items()
        if isinstance(value, dict) and value.get("state") == "supported"
    }
    check(
        "permission-binding",
        permissions_valid
        and len(set(permissions)) == len(permissions)
        and measured == set(permissions)
        and measured <= declared,
        "connector.permission_evidence_mismatch",
    )
    check(
        "no-order-dispatch",
        not (measured | set(permissions)) & ORDER_CAPABILITIES,
        "connector.execution_not_supported",
    )
    limits = []
    pages = list(pages)
    for page in pages:
        if not isinstance(page, dict):
            check("history-page-shape", False, "connector.invalid_provider_response")
            continue
        check(
            "history-provider-scope",
            page.get("providerId") == provider_id
            and page.get("adapterVersion") == description["version"]
            and page.get("identity") == identity,
            "connector.history_identity_mismatch",
        )
        events = page.get("events")
        valid_events = (
            isinstance(events, list)
            and len(events) <= adapters.MAX_EVENTS
            and all(isinstance(value, dict) for value in events)
        )
        check("history-budget", valid_events, "connector.response_budget")
        if not valid_events:
            continue
        check(
            "confirmed-projection-only",
            all(
                "normalizedTrade" not in event
                or event.get("kind") == "trade"
                and event.get("status") == "confirmed"
                and event.get("timeBasis") != "receipt-only"
                for event in events
            ),
            "connector.unconfirmed_projection",
        )
        coverage = page.get("coverage", {})
        coverage = coverage if isinstance(coverage, dict) else {}
        unverified_clock = (
            any(event.get("timeBasis") == "receipt-only" for event in events)
            or coverage.get("reason") == "connector.provider_clock_unverified"
        )
        if unverified_clock:
            check(
                "unverified-clock-disclosure",
                page.get("complete") is False
                and coverage.get("complete") is False
                and coverage.get("reason") == "connector.provider_clock_unverified",
                "connector.false_complete_coverage",
            )
            limits.extend(["provider_clock_unverified", "raw_history_only"])
        else:
            check(
                "coverage-disclosure",
                type(page.get("complete")) is bool
                and page.get("complete") is coverage.get("complete")
                and (page.get("complete") is True or bool(coverage.get("reason"))),
                "connector.false_complete_coverage",
            )
        if any(event.get("status") in {"partial", "unknown"} for event in events):
            limits.append("unreconciled_observations")
    if len(pages) >= 2 and all(
        isinstance(value, dict)
        and isinstance(value.get("events"), list)
        and all(isinstance(event, dict) for event in value["events"])
        for value in pages[:2]
    ):
        check(
            "repeat-read-deduplication",
            _facts(pages[0]) == _facts(pages[1]),
            "connector.unstable_native_observations",
        )
    if provider_id == "diagnostic":
        check(
            "diagnostic-normal-operation",
            configuration.get("fault", "none") == "none",
            "connector.diagnostic_fault_active",
        )
    passed = all(value["passed"] for value in checks)
    account_read = (
        isinstance(capabilities.get("accountRead"), dict)
        and capabilities["accountRead"].get("state") == "supported"
    )
    result = {
        "version": 1,
        "providerId": provider_id,
        "adapterVersion": description["version"],
        "environment": identity.get("environment"),
        "synthetic": description["synthetic"],
        "checkedAt": checked,
        "identityHash": adapters.checksum(identity),
        "passed": passed,
        "readiness": "read-only-verified" if passed and account_read else "prototype",
        "scope": (
            "Synthetic diagnostic account only; does not certify another provider."
            if description["synthetic"]
            else "Observed account read and explicitly bounded raw history; no execution or UTC-market-clock certification."
            if account_read
            else "Public access observation only; no account capability certified."
        ),
        "checks": checks,
        "capabilities": deepcopy(capabilities),
        "limits": sorted(set(limits)),
        "sample": {
            "pages": len(pages),
            "eventCount": len(pages[0].get("events", []))
            if pages and isinstance(pages[0], dict) and isinstance(pages[0].get("events"), list)
            else 0,
        },
    }
    result["checksum"] = adapters.checksum(result)
    return result


def run_conformance(provider_id, configuration, secret=None):
    """Production entry: factory-owned calls only, with no trading interface."""
    config = adapters.normalize_configuration(provider_id, configuration)
    description = adapters.describe_provider(provider_id)
    try:
        observation = adapters.probe(provider_id, config, secret)
        pages = []
        if (
            observation.get("capabilities", {}).get("accountHistory", {}).get("state")
            == "supported"
        ):
            end = adapters.instant(observation["observedAt"])
            window = (
                {"from": "2026-11-01T00:00:00Z", "to": "2026-11-02T00:00:00Z"}
                if description["synthetic"]
                else {
                    "from": (end - timedelta(days=1)).isoformat().replace("+00:00", "Z"),
                    "to": observation["observedAt"],
                }
            )
            for _ in range(2):
                pages.append(
                    adapters.history(
                        provider_id, config, observation["identity"], window, secret=secret
                    )
                )
        return evaluate_conformance(provider_id, config, observation, pages)
    except adapters.AdapterError as error:
        result = {
            "version": 1,
            "providerId": provider_id,
            "adapterVersion": description["version"],
            "synthetic": description["synthetic"],
            "checkedAt": adapters.utc_now(),
            "passed": False,
            "readiness": "prototype",
            "scope": "Required read-only observation did not pass; no capability promoted.",
            "checks": [{"id": "read-only-observation", "passed": False, "reason": error.code}],
            "limits": [error.code],
            "capabilities": adapters.capability_results(),
            "sample": {"pages": 0, "eventCount": 0},
        }
        result["checksum"] = adapters.checksum(result)
        return result


def validate_conformance(report, provider_id, identity=None, *, checked_at=None, maximum_age=300):
    if not isinstance(report, dict) or report.get("checksum") != adapters.checksum(
        {key: value for key, value in report.items() if key != "checksum"}
    ):
        raise adapters.AdapterError("connector.conformance_checksum_mismatch", 409)
    description = adapters.describe_provider(provider_id)
    if (
        report.get("providerId") != provider_id
        or report.get("adapterVersion") != description["version"]
        or report.get("synthetic") is not description["synthetic"]
        or report.get("passed") is not True
        or not isinstance(report.get("checks"), list)
        or not report["checks"]
        or any(
            not isinstance(check, dict) or check.get("passed") is not True
            for check in report["checks"]
        )
    ):
        raise adapters.AdapterError("connector.conformance_not_verified", 409)
    capabilities = report.get("capabilities")
    declared = {row["id"] for row in description["capabilities"] if row["supported"]}
    if (
        not isinstance(capabilities, dict)
        or set(capabilities) != set(adapters.CAPABILITIES)
        or any(
            not isinstance(value, dict)
            or value.get("state") not in {"supported", "unsupported", "unknown"}
            for value in capabilities.values()
        )
        or any(
            key not in declared and value["state"] == "supported"
            for key, value in capabilities.items()
        )
        or any(capabilities[key]["state"] == "supported" for key in ORDER_CAPABILITIES)
    ):
        raise adapters.AdapterError("connector.invalid_capability_evidence", 409)
    expected_readiness = (
        "read-only-verified" if capabilities["accountRead"]["state"] == "supported" else "prototype"
    )
    if report.get("readiness") != expected_readiness:
        raise adapters.AdapterError("connector.conformance_not_verified", 409)
    if identity is not None and report.get("identityHash") != adapters.checksum(identity):
        raise adapters.AdapterError("connector.conformance_identity_mismatch", 409)
    age = adapters.instant(checked_at or adapters.utc_now()) - adapters.instant(
        report.get("checkedAt")
    )
    if not -timedelta(seconds=5) <= age <= timedelta(seconds=maximum_age):
        raise adapters.AdapterError("connector.conformance_stale", 409)
    return deepcopy(report)
