# Local journal API

The original app's journal uses `/api/local/v1/journal`, separately from the API-key/broker `/api/v1` trading API. These endpoints manage local records and never execute broker orders. [Architecture and recovery boundary](../plans/chartly-professional-platform/p03/ARCHITECTURE.md). [User workflow](../userguide/33-trading-journal/README.md).

## Authentication, revisions and responses

Use the current authenticated local account proof and cookies; mutation requests also require the existing `X-CSRFToken`. The server derives principal ownership. `originId` is a source owned by that principal, not an owner override. IDs and source revisions must come from the loaded local workspace/book. Unknown/duplicate envelope fields, nonfinite JSON and over-budget bodies are rejected. Responses are private/no-store; files are served with nosniff. The frontend `journalClient.ts` is the implemented transport client.

An action envelope is `{originId, expectedRevision, requestId, action, payload}`. A successful mutation returns `{workspace, result, detail?}` after commit. Preserve the same request ID and exact body when a reply is uncertain; edit/rebase only after resolving or reloading that request. A stale revision returns409. Errors use `{error:{code,message,issues}}`:400 invalid input/CSRF,401 missing local proof,404 unavailable/foreign object,409 stale/conflicting request or blocked correction,413 size limit,503 unavailable storage/worker. The original entered form is retained on failure.

## Reads and actions

- `GET /?originId=` returns origin/revision, scoped book summaries, ledger and retained import summaries.
- `GET /trades/:tradeId?originId=` returns `trade`, separate `review`, before/after `history`, normalized source `executions` and original `observations`.
- `POST /actions` dispatches only the supported actions below.

`create-book` takes `{portfolioId,accountId}` and explicitly links an account-owned book to that environment. It does not connect the account to a broker or create credentials.

`create-trade` takes `{trade}`. A manual trade identifies its `portfolioId`, optional resolved `journalBookId`, symbol `pair`, Buy/Sell `direction`, `openDate`, Open/closed `result`, currency/unit and `amounts`. Manual records belong to the environment's manual book. Open has no close time; closed requires offset-aware `closeDate` and known net P&L. Source provenance, realizations and IDs are server-owned.

`update-trade` and `close-trade` take `{tradeId,patch,reason?}`. Close applies only to an Open manual position. For a previously partially exited position, the close `amounts.netPnl` and supplied cost components are cumulative whole-position totals; the service calculates the final exit residual. Correcting realized financial facts requires a reason, with identity/source fields locked. `partial-close-trade` instead takes `{tradeId,quantity,closedAt,netPnl,grossPnl?,commission?,swap?,fees?,exitPrice?,reason?}` for this exit alone. Its positive quantity cannot exceed known remaining quantity.

`correct-realization` takes `{tradeId,realizationId,patch,reason,confirmStatusChange?}`. Patch fields are quantity, closedAt, netPnl, grossPnl, commission, swap, fees and exitPrice. The reason is mandatory. Set `confirmStatusChange:true` only after reviewing an open/closed status change caused by corrected quantity. The service retains prior history and recalculates the position.

`review-trade` takes `{tradeId,review}` for strategy/setup/tags, review status, rating, decision/copy linkage, notes, optional mindset and chart/screenshot references. It cannot rewrite imported fills. `archive-trade` / `restore-trade` take `{tradeId}` and retain records/history. `save-mapping` takes `{mapping}` for a reusable validated normalized statement mapping.

`review-period` takes `{portfolioId,bookId,period,startDate,timezone,currency,strategy,notes?,goals?,includedTradeIds,filters?}`. Period is day/week; weeks start Monday. Timezone is IANA. Included IDs must match the profile/book, currency, strategy and actual local calendar period. Saved fact revisions/hashes identify what was reviewed. Filters retain the displayed q/result/direction/period/review values as scope metadata; IDs are independently checked against book, profile, currency, strategy and local dates.

Canonical `amounts` keys are `netPnl`, `grossPnl`, `commission`, `swap`, `fees`, `riskAmount`, `quantity`, `entryPrice`, `exitPrice`. Values are plain decimal strings or null. Manual inputs support up to40 integer and24 fractional digits within the80-character bound; exponent notation and nonfinite values are invalid. Known quantities/prices must be positive, risk may be zero/unknown, and all known money components must reconcile exactly. Canonical null is unknown, regardless of a legacy numeric display field. Currency/asset codes are3–12 uppercase alphanumeric characters starting with a letter. See the [calculation policy](../plans/chartly-professional-platform/p03/CALCULATION_POLICY.md).

## Staged statement import

- `POST /imports/preview` takes `{originId,portfolioId,bookId,provider,csvText,mapping,expectedRevision,accountId?}`. App CSV text is limited to4MiB UTF-8; supported rows/mappings and stricter decimal/source rules are described in the [statement format](../plans/chartly-professional-platform/p03/SUPPORTED_STATEMENT_FORMAT.md). Preview persists source/mapping/context and returns `{id,expectedRevision,preview}` including rows, errors/conflicts, per-currency totals and insert/unchanged/correction counts. It does not commit trades.
- `GET /imports/:jobId?originId=` resumes the scoped retained review/status/receipt. The supplied source must match the job; another owner/source cannot inspect it.
- `POST /imports/:jobId/repreview {expectedRevision}` rebuilds a preview from retained original source/mapping against current state; it does not silently accept corrections.
- `POST /imports/:jobId/commit {expectedRevision,requestId,acceptCorrections}` atomically commits only an error-free reviewed preview. Corrections need explicit `acceptCorrections:true`. The same source/event identity is not inserted again on repeat import. Existing user reviews survive source changes.

Provider names and source IDs describe retained statement provenance; they do not certify a live provider connection. Partial execution rows require explicit position linkage/economics. Missing cost policy defaults to unknown. Declaring absent components zero is a deliberate mapping choice retained with the observations. Broker-specific exports require their own supported mappings/certification.

## Evidence and export

`POST /attachments` takes `{originId,expectedRevision,requestId,tradeId,mimeType,base64}`. PNG/JPEG/GIF/WebP/PDF are limited to8MiB decoded bytes and checked for matching signatures. The transaction adds a scoped attachment reference/review history; P02 `GET /api/local/v1/attachments/:id?originId=` serves verified bytes. External links remain references, not bundled remote downloads.

`GET /export?originId=&portfolioId=&bookId=&format=json|csv` authorizes the selected profile's membership and downloads the complete book, including archived rows across environments linked to it. JSON format `chartly-journal-export` version1 contains trades, matching source/review/history ledger, reusable mappings and referenced permitted attachment data. CSV retains exact amounts plus realization/history/source-event ID JSON columns and escapes spreadsheet formula prefixes while preserving normal negative decimals. Use JSON to retain the full raw source observations and bundled evidence. This full-book operation differs from the UI's filtered displayed-row CSV. Neither includes unsubmitted IndexedDB drafts; export those separately. Workspace backup/restore/Undo remain the [P02 recovery operations](../plans/chartly-professional-platform/p02/RECOVERY_GUIDE.md).
