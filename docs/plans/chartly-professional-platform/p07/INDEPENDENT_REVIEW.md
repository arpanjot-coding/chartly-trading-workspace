# P07 independent implementation review

3 November 2026. This is a review record, not package acceptance. No plan checkbox or historical P00–P06 evidence was changed by this review. The [ordered plan](IMPLEMENTATION_PLAN.md) and root's [implementation evidence](IMPLEMENTATION_EVIDENCE.md) control the final package decision.

## Scope and method

The reviewer implemented the scoped history/storage/recovery slice, then independently inspected the separately implemented registry, encrypted vault, private API, native adapters, conformance runner and frontend ownership/creation paths. History/storage changes are therefore covered by separate integration tests and root review; this document does not describe self-review as independent authorship.

Review used source inspection, isolated SQL databases, synthetic local principals, an injected MT5 SDK and executable failure regressions. This reviewer made no actual SDK calls, placed no orders and accessed no private credential screenshot or real account activity. Root's separately authorized native observations are recorded in [the MT5 adapter plan](adapters/mt5.md) and redacted evidence; mock results do not substitute for them.

## Resolved service and recovery findings

- A committed sync retry originally omitted its current workspace. Receipt replay now returns the owned accepted workspace without fetching the provider again. The independent test verifies two journal rows, the same receipt and zero second adapter calls.
- Matching several legacy account records could silently select the first account, despite their distinct broker aliases and book keys. Such ambiguity now requires explicit account selection. Existing account/book identities remain separate.
- Provider calls run outside SQL, so their response must be checked against the current saved revision/configuration/credential generation before publication. The concurrent-configuration regression confirms stale results cannot publish history, cursor or journal facts.
- Wrong account identity or stale whole-response time now persists an actionable degraded failure and requires verification, while retaining earlier financial state. Fresh partial raw history with an explicitly unverified provider clock remains a separate, disclosed state.
- A restored connection cannot reuse its previous effective capabilities or certificate as authority. Restore and Undo remove usable credential references and all principal vault rows, reset verification/health, pause canonical links and require explicit relinking. Cross-owner restore rebinds the actual account/book references while preserving immutable observations and leaving the original owner intact.
- Expired vault material suppresses effective capabilities and is refused before adapter access. Credential writes remain outside temporary worker payloads; portable exports contain no encrypted credential table or plaintext secrets.
- Generic account-table updates cannot change a linked account's platform, broker, server, native login, environment or currency and thereby rehome its existing book. Display names remain editable.
- P01 timestamps use the canonical contract precision when generating SourceConnection, CapabilityManifest and AccountSourceLink. Runtime observation precision remains available separately.
- Root's actual browser review found a field-name mismatch when creating an account from observed identity: the service wrote `isEnabled`, while the existing UI reads `enabled`. The service now writes the existing `enabled: false` field. Review confirmed this matches the account model/UI, and the integrated service regression asserts the new record is disabled and contains no `isEnabled` property. Existing manually configured account intent is not overwritten. Root's final full backend rerun includes this correction.
- Root's last authority review found that an older cached creation wizard or direct workspace API could omit the required replay source. The durable save boundary now requires owned, nonempty, unarchived saved history for new replay IDs and transitions from another kind to replay, with exact checksum/native symbol/interval/currency checks. Already stored replay projects remain compatible, including empty projects introduced by reviewed migration/restore. Actual authenticated/CSRF API cases reject missing, connected-only and unavailable sources without changing saved state, and accept the exact owned version. The storage test models a legacy project through migration instead of creating a new empty project through the guarded API.

The pre-existing P06 `bind_run` test helper already imports real owned history, but originally changed its live fixture profile to replay without pinning that version on the project. The helper now sets the imported source/checksum and exact profile symbol/interval/currency before the transition. All paper account, fill, accounting, invalid-price and recovery assertions remain unchanged. Zero-price candles are still nonempty history; the existing paper preparation tests continue to decide whether their financial economics are supported. This is a current fixture adaptation to the new creation boundary, not a rewrite of historical P06 evidence or a weakening of the production guard.

These behaviors are exercised by [independent service cases](../../../../test/test_connector_service_review.py), [storage cases](../../../../test/test_connector_storage.py), [recovery cases](../../../../test/test_connector_recovery.py) and the service/API/vault suites. The [history/storage contract](HISTORY_STORAGE_RECOVERY.md) records their transaction and recovery boundaries.

## Resolved native pagination findings

Three issues were reproduced across the actual adapter-page shape and pure merger rather than testing the components only in isolation:

1. A multi-day request returns bounded one-day native page coverage. The merger formerly required coverage bounds to equal the whole request. It now accepts a strictly bounded subinterval, stores that exact coverage and keeps the transport cursor bound to the full request.
2. A final native page can consume its transport cursor while UTC coverage remains unverified. The merger now clears a successfully consumed final continuation without advancing the verified coverage high-water mark. Conflicting final pages retain the cursor and accepted facts.
3. Saving a checkpoint normalizes UTC fractional seconds. MT5 resume formerly compared literal window strings, rejecting the same instants spelled with six fractional digits. Resume now compares validated UTC bounds; different accounts or actual bounds remain rejected.

The [six independent native integration cases](../../../../test/test_connector_adapter_review.py) also verify account identity again after history is read, refuse conformance that combines one account's probe with another account's history, retain content corrections without a guessed native revision and avoid projecting raw deals as closed journal trades. Re-reading older identical content deduplicates without reversing the accepted latest observation.

## Final ownership and workflow review

The original chart UI remains outside these changes. The wizard fixes preserve exact owned native symbol spelling and interval, including suffixes and daily/weekly intervals. Owner/save generations fence late success, failure and catalog paging. New replay UI creation requires an owned nonempty version, exact source/checksum/currency/defaults and explicit review; it creates a project before a separately reviewed paper run. Optional session tags do not overwrite the chosen timezone. The connected-account selector resets when its owner changes.

The last review found a cookie-only account-switch gap in connector transport: an old tab could retain its local owner state while another tab changed the authenticated cookie. The server already supported an expected-principal precondition, but connector requests did not send it. The client/hook/panel now capture the original principal for provider/list/detail/history/action calls in `X-Chartly-Principal`. This header is a precondition checked against the authenticated cookie, not an identity selector. A mismatch returns 403 before a worker or private result. Existing clients without the optional header retain compatibility.

Shared workspace save and pending-save retry capture the same principal and current owner/origin generation. They check before and after IndexedDB waits and after CSRF acquisition. A late response can update only its original owner's snapshot; it cannot reactivate that owner or replace another owner's current binding. No credential is persisted in connector browser drafts.

The final canonical freshness regression confirms that stale public capabilities are unavailable, canonical source health becomes degraded and a rebuilt canonical history link becomes paused. Stored `link.active` represents the user's retained linking intent; effective read permission additionally requires fresh health, the same verified configuration, current identity and permitted credentials. The service refuses a stale sync. Persisted observations, manifests and historical conformance are evidence, not an independent execution grant.

Reviewed source: [registry](../../../../services/connectors.py), [local account boundary](../../../../services/local_account_access.py), [connector transport](../../../../frontend/src/lib/trader/connectorClient.ts), [ownership hook](../../../../frontend/src/hooks/useConnections.ts), [shared save transport](../../../../frontend/src/lib/trader/localStorageClient.ts) and [durable save/retry guards](../../../../frontend/src/lib/trader/dataPersistence.ts).

## Executed evidence

- The combined compatibility run passed 143 cases covering connector history/storage/recovery and existing workspace/journal/paper recovery. Log: [storage compatibility](evidence/storage-compatibility.log).
- After native integration corrections, nine focused files passed 187 cases in 10.06 seconds. Log: [adapter and service review](evidence/adapter-review.log). This includes six new native integration cases and the conflicting-final-page case.
- The late canonical/access review passed 39 cases in 23.94 seconds across independent service review, connector API and local account access. Log: [final independent checks](evidence/backend-independent-followup.log). The independent service file contains eight cases; the final 1,503-test full result includes the added freshness regression.
- After the API regression gained all four read-route assertions, its explicit-principal test passed again in 7.31 seconds. It proves mismatched-owner create and provider/list/detail/history requests are refused before worker access. Log: [current principal precondition](evidence/backend-owner-header-followup.log).
- After adapting the P06 helper to pin its already imported project history, all 33 cases in paper sessions, independent session review, journal context and resource measurement passed in 39.22 seconds. The resource fixture balanced 501 opened/501 closed SQL connections. Log: [paper fixture compatibility](evidence/paper-fixture-followup.log).
- Root's final full backend log was inspected: **1,503 cases across 64 files passed**, with one warning, in **446.08 seconds**. This includes the freshness/expected-owner cases, disabled-account field, authoritative required-history guard and valid P06 fixture pin. Log: [durable full backend](evidence/compatibility-regression.log).
- The frontend principal transport/hook/panel follow-up passed 19 cases across three files in 4.99 seconds. Log: [principal boundary follow-up](evidence/frontend-principal-followup.log). The final 2,419-test/220-suite frontend selection, latest TypeScript/build and root actual-browser verification subsequently passed.
- Scoped Ruff lint/format and production compilation passed for the native/history fixes. Ruff lint/format also passed after the last independent service test was added.

These runs overlap and must not be summed into a unique test count. Earlier failing reproductions were corrected and followed by the stated passing runs; the final package evidence must retain the current code hashes and latest integrated results.

## Scope limits

No unresolved blocking finding remains in the reviewed read-only paths after the principal-header fix. This statement does not certify every provider or future execution consumer.

Actual MT5 provider timestamps remain unverified relative to host UTC. Raw receipt-only observations retain provider time without guessing an offset. They cannot promote complete UTC history, chart market data, historical spreads or general netting/hedging journal conversion. The exercised MT5 scope is read-only account identity and explicitly bounded raw history; it is not execution certification.

Authenticated crypto and brokerage account access still requires its own permitted test environment and provider-family work. A public endpoint response is not account certification. Orders, copying, bots and automated startup synchronization are not activated by P07.

Linux, gunicorn, eventlet and gthread production checks were not executed by this Windows reviewer. Passing Windows unit/integration tests does not prove those runtime modes. Their verification remains separate from the demonstrated local read-only behavior.
