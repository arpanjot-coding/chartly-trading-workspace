# Diagnostic adapter conformance plan

Owner: Chartly maintainers. Provider `diagnostic`, version `p07-read-only-v1`, local synthetic broker_demo environment. Its two fixed accounts are fixture identities, not real accounts. No supplied code/URL or financial dispatch method exists.

The fixed 1–2 November 2026 fixture contains two fully closed EXAMPLE trades with exact quantities/prices/costs and P03-compatible normalization. Native event IDs remain stable across repeated reads. Configured fault enums exercise disconnect, expiry, revocation, rate limit/retry-after, wrong identity, stale quote, duplicate/reordered/corrected events, incomplete pages, partial fills and unknown submissions. Unknown/partial outcomes retain reconciliation state and have no closed-trade projection or automatic resubmission.

The conformance runner calls only trusted static factory methods, verifies version/environment/identity/synthetic scope, freshness, actual read permissions, capability declarations, no order grants, repeated native facts and truthful coverage. Active fault configuration refuses readiness promotion. The default diagnostic can pass read-only conformance for itself; its synthetic flag, provider ID and checksum cannot be relabelled as a real-provider certificate.

Tests are `test/test_connector_adapters.py`, `test/test_connector_mt5.py` and `test/test_connector_conformance.py`. Root integration tests additionally own transaction/CAS, account/book identity, journal effects, vault protection, restore and original UI acceptance. Fake transport success is not proof of any external endpoint or terminal behavior.
