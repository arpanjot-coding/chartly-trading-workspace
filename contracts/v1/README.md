# Domain contracts v1

Implemented boundary for P01. The canonical source is [domain.schema.json](schemas/domain.schema.json), JSON Schema Draft 2020-12, plus [relationship/lifecycle declarations](rules.json). These are record, reference, compatibility and transition contracts. They do not implement storage, providers, matching, metric calculations, execution permissions or research ingestion.

The Python boundary is [validation.py](../../services/domain/validation.py); the TypeScript boundary is [validation.ts](../../frontend/src/lib/domain/validation.ts). Python uses the existing `jsonschema` 4.26.0 dependency. The frontend now pins Ajv 8.20.0 directly. Draft selection follows the validators' official documentation: [Ajv dialects](https://ajv.js.org/json-schema.html), [Python validator selection](https://python-jsonschema.readthedocs.io/en/stable/validate/).

## Supported shapes and owners

- LocalOwner/Workspace scope, environment Profile, JournalBook, Account, SourceConnection, capability manifest and chart-document reference. A workspace is the local ownership namespace; it is not a required trading profile for research or authoring.
- Asset, Issuer, Instrument, Listing, InstrumentContract and ProviderSymbol identities. Identity can exist without trading economics. Quantity validation and order/fill calculations require the applicable explicit instrument units, scale and step; unsupported economics remain unavailable. Metadata fixtures for FX/futures do not certify a simulation or broker adapter for them.
- ManualTrade and JournalEntry distinguish user assertions from account executions. Account orders/child commands/acknowledgements/fills, corrections, cash movements, trade aggregates, decisions and book-scoped reviews remain distinct records. A deposit is never an execution fill.
- Logical Dataset/version, practice project, immutable run manifest and checkpoint references. P04/P06 own the actual datasets and simulated ledger.
- Artifact projects/revisions/dependency locks, parameter sets, indicator attachments, experiments/trials/splits/scenarios, validation and deployment revisions. P20/P21 own authoring and experiments; P17/P11 own actual operation and eligible dispatch.
- Source documents, fact observations/revisions, derived metrics and immutable notebook snapshots. The initial research entity is an Issuer joined to Listings; no duplicate portfolio or invented second company identity is required. P13/P14 enforce provider content and calculation semantics.
- Source observations, canonical reconciliation links, account/source links, jobs/cursors/coverage/conflicts. Multiple source observations can explain one canonical execution; amount/time similarity alone cannot prove a match. P22 owns actual reconciliation/sync.
- Command/event envelopes, explicit query selection, pagination and metric result semantics. Query ranges are UTC half-open instants; a display/trading timezone accompanies them. Empty account/book/profile selections mean none. Stable cursors must use occurred time plus canonical ID, never offset alone.

## Identity, precision and time

IDs are opaque lowercase identifiers, 8–128 characters, starting with a letter. Generate random canonical IDs; do not encode a ticker, numeric browser key or external account login as the identity. Relationships validate record type, local owner and workspace. These checks do not authenticate a caller. P02 must derive the owner from its trusted local session and enforce transactional uniqueness and foreign keys.

One active connected book per canonical external account, and one active paper book per simulated account, are collection invariants. Separate manual books have no account binding. Profiles may reference the same book. Archiving does not create another identity; reactivation must recheck the active-book constraint inside the same transaction. Account identity is provider + venue/server + external identity + demo/live mode, scoped to the owner/workspace; display text is not verification. Cross-provider equivalence requires P07/P22 evidence.

Decimal values are strings, with at most 38 integer and 18 fractional digits; exponent notation and floating-point wire values are rejected. The exact `decimalUnits`/`decimal_units` conversion rejects rounding, invalid scale and incompatible steps. Unknown values are omitted or accompanied by an explicit unavailable reason, never automatically zero. Financial amounts include currency. No currency conversion or P&L engine is supplied by these contracts.

Instants are Gregorian UTC `YYYY-MM-DDTHH:mm:ssZ` or exactly millisecond precision `.sssZ`. Invalid dates and ambiguous local timestamps are rejected. Imported greater precision, offsets and unresolved local dates must be retained raw in staging and resolved before canonical conversion. Trading dates are separate validated `YYYY-MM-DD` values. [Timezone names](timezones.json) are a checked-in snapshot from the installed pinned timezone data, shared across runtimes so OS differences cannot change acceptance. Future timezone/schema changes require explicit compatibility review.

## Validation API and errors

`validateRecord` / `validate_record` checks a record shape and local field invariants. `validateRecords` / `validate_records` additionally checks a complete collection of related records, maximum 10,000 per call. A repository validating a changed subset must load its related records and active uniqueness peers; it must not treat a record-only check as authorization to commit. Larger migrations validate staged partitions plus database-wide constraints.

Errors are sorted, deduplicated `{code, path}` entries. Paths are JSON Pointers; collection paths start with the entry index and `/value`. Codes such as `schema.required`, `scope.account_mismatch`, `book.active_account_conflict` and `revision.immutable` are stable; library prose is not part of the wire contract. Unsupported versions fail with `contract.unsupported_version`. Unknown record types and properties fail closed. Neither adapter coerces types, supplies economic defaults or strips unexpected fields.

`validateReplacement` / `validate_replacement` accepts exact idempotent retries. Editable records require the next revision and preserve identity/ownership/creation time. Immutable records must be replaced by a new ID/revision reference, not rewritten. These functions complement P02's atomic compare-and-write; checking in the browser alone cannot resolve concurrent edits.

`validateTransition` / `validate_transition` checks the declared state graph. Unknown submissions can enter reconciliation; they cannot blindly become another submit. A run requires a validated manifest to enter Ready/In progress, and arming requires eligibility plus explicit approval. The booleans are assertions by a trusted domain service after its checks, not client-supplied permission grants. No function here sends, cancels or approves an order. A valid intent may remain disarmed/ineligible.

Supported/unsupported/unknown capability states are separate. Supported claims require versioned evidence/time. Configured intent is distinct from observed health. P07/P11 must resolve evidence, verify account/environment, freshness, actual permissions and risk before exposing actions. Opaque receipt, engine, policy and blob IDs in this v1 contract are declarations; the owning service must resolve them before use.

The canonical account custodian/provider and the source provider are independent. An account may receive history from another service after an AccountSourceLink is verified. Native fill/observation provider IDs match their SourceConnection, not an assumed custodian name. Research/data/artifact event envelopes require no invented trading account; account payloads cannot disguise themselves as research events.

## Compatibility and tests

[Legacy mapping and ownership](LEGACY_MAPPING.md) and [handoff sequences](HANDOFF_SEQUENCES.md) govern migration. Pure legacy classifiers exist in both runtimes and use [one classification policy](legacy-policy.json). They preserve ambiguity; no installed data is read or migrated by P01.

Fixtures are runtime-neutral JSON under [the manifest](fixture-manifest.json). Expected outcomes were authored independently of either validator. Collection cases reference a base fixture and explicit replacements/appends/reversal; fixture compaction was verified by exact roundtrip before writing. The tests materialize new copies for each case. Positive full-v1 records cover every record type, alongside negative scope, precision, lifecycle, evidence and identity cases.

Regenerate declarations with `python contracts/generate_types.py`; verify with `--check`. Generated types are convenience declarations, not validation or execution authority. Do not hand-edit them. No separately handwritten Python/TypeScript schema exists.

Run Python `pytest test/test_domain_contracts.py test/test_domain_legacy.py`; from `frontend`, run `npx vitest run src/lib/domain/validation.test.ts src/lib/domain/legacy.test.ts` and `npx tsc -b`. Test outcomes and current limitations are recorded in the [P01 evidence](../../docs/plans/chartly-professional-platform/p01/IMPLEMENTATION_EVIDENCE.md).
