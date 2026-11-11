# Local Data Library API

Base path: `/api/local/v1/datasets`. This is the original app's private market-history API, separate from journal statement import and the broker `/api/v1` surface. It never places orders.

## Access, scope and retries

All routes require verified local-account proof. Mutations additionally require the existing CSRF token in `X-CSRFToken`. The server chooses the principal; owner IDs, API keys, URLs, executable expressions and the internal download publication guard are not public request fields. Responses are private/no-store. A broker connection is required only for optional provider downloads.

Read the current catalog `revision` before a mutation. Send its value as `expectedRevision` and use a stable `requestId` for the same action/body after an uncertain reply. Do not reuse an ID with changed input or silently rebase a stale review. Unknown JSON/query fields are rejected. Foreign/private IDs return unavailable/not-found rather than another principal's records.

## Catalog and version reads

- `GET /?offset=0` returns `{principalId,revision,versions,jobs,nextOffset,capabilities}`. Pages contain at most 100 versions; follow `nextOffset` rather than assuming the first page is the complete catalog. `capabilities.downloads` states whether the current owner-bound history connection is available. Local imports/chart reads remain available when that connection is missing.
- `GET /versions/:id` returns one exact version with metadata, checksums, quality/coverage, local size, archived state and saved practice dependencies.
- `GET /versions/:id/bars?from=&to=&limit=` returns `{versionId,checksum,bars}`. Bounds are inclusive UTC epoch seconds, at most microsecond precision; the default limit is 5000 and maximum 50,000. This is the version's native interval, not a request for implicit resampling.

Bars contain `time` (canonical UTC ISO), `timestamp` (numeric epoch-seconds projection), exact decimal-string OHLC and string/null `volume` and `openInterest`. Local normalization retains absent/unmapped values as null. A missing/changed immutable file returns a checksum/readiness error rather than another source's data.

The chart feed pins native symbol/exchange/interval plus version/checksum. It serializes active fetches, shares identical pending windows and caps pending consumers at 17; abort/dispose releases its listeners and queue. It does not introduce a global bar cache or implicit resampling.

## Reviewed CSV import

`POST /imports/preview` takes `{expectedRevision,csvText,mapping,context,baseVersionId?}`. It retains the source and returns a staged ID, revision, mapping/context and a preview with row actions/errors, counts, quality, coverage and hashes. The public preview omits the internal full canonical array; displayed row details are bounded with totals/truncation flags retained.

Example mapping and context:

```json
{
  "mapping": {
    "version": 1,
    "columns": {"timestamp":"time","open":"open","high":"high","low":"low","close":"close","volume":"volume"},
    "timestampFormat": "iso",
    "timestampMeaning": "open",
    "timezone": "UTC",
    "delimiter": ",",
    "decimalSeparator": ".",
    "thousandsSeparator": ""
  },
  "context": {
    "provider": "my-csv-source",
    "symbol": "EXAMPLE",
    "exchange": "DECLARED",
    "interval": "1m",
    "priceBasis": "raw",
    "adjustment": "none",
    "volumeMeaning": "unknown",
    "allowNegativePrices": false
  }
}
```

Timestamp formats are `iso`, `seconds` and `milliseconds`; naive ISO values require an explicit IANA timezone. Opening timestamp meaning is supported; no close-labelled candle shift is guessed. Context can additionally declare native currency, display name and a frozen calendar of weekly sessions/dated exceptions. Trusted code resolves private source/instrument identity. Price basis is raw, split-adjusted or total-return metadata; the library does not perform an adjustment or continuous-contract roll merely because one is described.

- `GET /imports/:id` resumes that private review.
- `POST /imports/:id/repreview` takes `{expectedRevision}` and creates a fresh preview while retaining its identified base version.
- `POST /imports/:id/commit` takes `{expectedRevision,requestId,policy,allowRejectedRows}` and returns `{version,catalog}` after commit.

Policy `keep` retains existing overlaps; `replace` applies incoming overlaps in a new merged version; `new-version` creates an uploaded-only snapshot. Prior versions remain immutable. An intra-file timestamp conflict blocks commit. Excluding rejected rows requires `allowRejectedRows:true` after review. An identical canonical result reuses its existing version.

Version `quality` and `coverage` describe the recomputed merged/snapshot candle set. Its separate `importReport` retains upload counts/quality, source hash, policy and base version. Consumers must not substitute a source-fragment report for merged coverage or erase source warnings because the final stored subset passes structural checks.

CSV limits are 8 MiB UTF-8, 50,000 source rows, 32 columns and 2000 characters per cell. A canonical merged/restored version also has a 50,000-candle bound. Supported native intervals, exact precision, calendar rules and detailed quality semantics are in the [quality policy](../plans/chartly-professional-platform/p04/QUALITY_POLICY.md). `verified` means structural checks only, not source authenticity, source permissions or completeness beyond the supplied range.

## Retention and dataset bundles

- `POST /versions/:id/archive` and `/restore` take `{expectedRevision,requestId}`. Archive retains bytes and exact reads. Dependencies remain visible; there is no permanent-purge endpoint.
- `GET /versions/:id/export?format=csv|bundle` returns an actual downloadable file. CSV contains canonical UTC openings and exact lexical values. A bundle contains `manifest.json`, `bars.json` and `source.csv` when the original source is available, with declared member hashes/sizes and version evidence.
- `POST /bundles/preview` takes `{expectedRevision,base64}`. It validates the bounded ZIP, supported members, hashes, source mapping and canonical data before staging. No member is extracted as executable code or trusted as a destination path.
- `GET /bundles/:id` resumes its private preview. `POST /bundles/:id/repreview` takes `{expectedRevision}`; `/commit` takes `{expectedRevision,requestId}`.

Restoring a bundle rebinds source ownership to the current principal. A copied opaque ID is not proof of an external provider's authenticity. Capacity is 2000 retained versions and 5000 metadata records per principal, including staged reviews, jobs/quotas and restore aliases, alongside bounded bundle sizes. Capacity errors do not silently purge older work.

Bundles can include bounded `versionAliases` with `{id,datasetId,checksum}` proofs. Validation checks ID derivation and agreement with the canonical candle checksum. Detail/bar requests using a proven older ID resolve to the destination's owned version and add `resolvedFromVersionId`; their returned `id`/`versionId` identifies the actual resolved version. Ancestor proofs survive re-export, supporting owner A → B → C restoration while saved practice/trade records retain their original IDs and facts. A native destination ID wins over an alias claim; aliases cannot redirect an existing native record or its dependency attribution. Checksum/identity validation is content proof, not provider certification.

P02 workspace ZIPs carry manifest references and dataset bundle links. They still exclude candle-file content. Keep dataset bundles separately when moving or backing up the installation. [Recovery guide](../plans/chartly-professional-platform/p02/RECOVERY_GUIDE.md).

## Finite provider downloads

`POST /downloads` takes `{expectedRevision,requestId,context,mapping,startAt,endAt,chunkSeconds?}`. Provider and interval must match `capabilities.downloads`; the existing owner-bound adapter currently exposes `1m` and `D`. Credentials are resolved from the verified UID/current username, not supplied in JSON or chosen from a first available account.

- `GET /downloads/:id` returns `{job,revision,catalog}`.
- `POST /downloads/:id/step` takes `{expectedRevision,requestId}` and processes at most one chunk.
- `POST /downloads/:id/control` takes `{expectedRevision,requestId,command}`, where command is `pause`, `resume`, `cancel` or `retry`.

Jobs expose queued/running/retry-wait/paused/cancelled/completed/failed state, progress/checkpoints, safe error codes and retry eligibility. A successful HTTP response can contain a failed/waiting job; inspect its state. The private retained CSV and lease token are omitted. Processing is cooperative and explicit, not a daemon that continues indefinitely after the page closes.

Ranges are finite half-open UTC intervals. Persisted quotas, Retry-After/backoff and finite attempts survive restarts. Lease/generation checks and checkpoint publication are atomic with the dataset commit; cancellation cannot be followed by late publication. The provider binding is rechecked after fetching, numeric values respect the mapping, unknown volume stays blank and returned candles are clipped to the requested UTC chunk. A successful empty response records an empty checkpoint without a fake version. [Detailed job limits and conformance](../plans/chartly-professional-platform/p04/DOWNLOAD_PLAN.md).

The connected legacy Historify job pool remains separate and outside this job quota reservation. Its history adapter may already synthesize missing open interest as zero before this bridge receives the row; the bridge cannot recover the original absence. Leave OI unmapped unless that source's meaning is established. Fixture tests certify these local interfaces, not real provider rights, authentic OI, arbitrary exchanges or continuous market coverage; individual provider certification remains deferred.

## Errors and implementation

Validation failures use structured `{error:{code,message,issues}}` responses. Important classes are invalid input/CSRF (400), local authentication (401), unavailable private records (404), stale revision/source/file conflicts (409), supported size limits (413), and storage/worker availability (503). Preserve source files and form drafts after an error; re-preview when the catalog changes.

Sources: `blueprints/data_library.py`, `services/data_library.py`, `services/dataset_quality.py`, `services/dataset_downloads.py`, `services/dataset_provider.py` and `services/workspace_worker.py`. [Architecture](../plans/chartly-professional-platform/p04/ARCHITECTURE.md), [user workflow](../userguide/34-data-library/README.md).
