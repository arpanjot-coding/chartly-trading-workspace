# Local chart workflow and evidence API

The original `/trading` terminal now resolves a saved environment/source before loading its chart. Chart workflow records use the existing cookie-authenticated `/api/local/v1` surface. They are separate from the broker-key trading API and never grant execution permission. [Architecture](../plans/chartly-professional-platform/p05/ARCHITECTURE.md), [source/availability policy](../plans/chartly-professional-platform/p05/SOURCE_POLICY.md), [terminal guide](../userguide/32-charting-terminal/README.md).

## Identity, access and retained records

The server derives the current local principal; `originId` selects an owned saved workspace. Use the existing local account proof/cookies and `X-CSRFToken` for mutations. Private responses are no-store, attachment responses use nosniff and a sandbox policy, and bounded workspace-worker calls own database/file work. No API key, broker credential, code or raw candle payload belongs in these requests.

The frontend resolves actual nonarchived profile/run/trade/book records, not query-supplied names or mode labels. A run belongs to its profile and keeps its immutable version/checksum, symbol/native interval and UTC date window. The dataset API may resolve a verified restored alias only by returning that exact requested `resolvedFromVersionId` and a canonical owned version. Saved checksum/native identity must still match. See [dataset API](local-datasets.md).

An unbound legacy chart remains the existing app-level connected workflow. Profile-bound and private-history charts are analysis contexts; account-specific order routing is not established by stored profile settings. Data prices, mode labels and source selection are not execution authority.

## Profile source and chart-view checkpoint

Use the existing `PUT /api/local/v1/workspace?originId=...` envelope `{expectedRevision,tables,requestId}` to save reviewed table changes. This endpoint remains a full supported-table mutation with existing ownership/CAS/idempotency rules; these fields do not introduce a second authoritative store.

A profile may add `chartSource:{kind:"dataset",versionId,checksum}` or `chartSource:{kind:"connected"}`. Dataset changes are owner/checksum validated and append a dataset manifest reference. The connected choice is data intent, not a verified execution account.

A profile or dataset-bound practice run may add:

```json
{
  "chartView": {
    "version": 1,
    "datasetVersionId": "version_from_owned_catalog",
    "datasetChecksum": "64_lowercase_hex_characters_from_the_owned_version",
    "cursorTime": 1793610000
  }
}
```

`cursorTime` is a finite UTC **candle opening** inside the owned dataset and the saved run window. Run dates use exact `YYYY-MM-DD`; the end date includes that UTC day. The checkpoint cannot change source/checksum or relabel a run completed. It is a **chart-view/replay cursor**, not a simulation checkpoint containing balances, orders, fills, costs or a journal projection.

## Scoped chart storage and recovery

The existing chart workspace repository keeps the authenticated principal separate from its context namespace. Scoped keys distinguish principal, profile, optional run and immutable source version. The original direct-chart namespace and browser sources remain preserved. A new profile scope does not inherit a global pane key.

Existing `/native/:kind` reads/writes and P02 native catalog backup/restore store named grid documents. `/preferences` retains an allowlisted scoped envelope under `chartly.chart.preferences.v1:...`; bodies remain `{originId,preferences,requestId,expectedPreferences}`. The envelope is bounded to 2,048 string entries and 2,097,152 characters, with 16 pane-key namespaces and allowlisted existing chart preference names. Arbitrary preference names are rejected.

Cross-owner restores preserve historical namespaces. The explicit **Preserved chart setups** recovery path restores matching verified profile/run/dataset setups with their drawings. A different/unverified source is copied only as a configuration template. Template copying keeps the selected source/native interval, clears incompatible drawings/alerts/comparisons and cannot transfer execution authority. It does not overwrite the historical namespace. P05's browser evidence records the matching four-pane/drawing recovery across owners.

Recorded-chart links carry the actual target IDs and `evidenceId`. Source/checksum, view and replay availability come from that target's stored evidence, not editable query labels or later profile defaults. A restored run's old version and a new capture's canonical version require two owned reads that attest the exact requested identities and converge to the same canonical version/checksum. Current connected prices require explicit analysis selection when historical data is unavailable; the saved PNG stays the original visual record. These links never authorize an order or restore a simulation ledger.

## Append chart evidence

`POST /api/local/v1/journal/chart-evidence` accepts exactly:

```json
{
  "originId": "owned_source_origin",
  "expectedRevision": 12,
  "requestId": "stable_request_identity",
  "target": { "kind": "trade", "id": 24, "profileId": 1, "bookId": "owned_book_id" },
  "mimeType": "image/png",
  "base64": "base64_of_the_focused_static_png",
  "capture": {
    "version": 1,
    "capturedAt": "2026-11-03T09:00:00.000000Z",
    "source": {
      "kind": "dataset",
      "datasetVersionId": "version_from_owned_catalog",
      "checksum": "64_lowercase_hex_characters_from_the_owned_version"
    },
    "instrument": { "symbol": "EXAMPLE", "exchange": "LOCAL" },
    "view": {
      "interval": "1m",
      "chartType": "candlestick",
      "timezone": "UTC",
      "visibleFrom": 1793610000,
      "visibleTo": 1793610600,
      "paneId": "p0"
    }
  },
  "annotations": "Decision context and chart annotations."
}
```

The placeholder checksum above must be replaced with the actual 64-character hexadecimal checksum. `target.kind` is `trade` or `run`; IDs/profile relationships are resolved from the owned source. `bookId` is optional but, when supplied, must match the target's actual book/run. Trade symbol and dataset native identity must agree. Dataset-bound runs cannot receive evidence from another source. A legacy source instead uses `{kind:"legacy-connected",provider:"the_displayed_provider"}`; that captures reported chart context, not certification of broker execution or historical market truth.

`source.provider` is optional for a dataset and must match if supplied; the server fills the canonical provider/version. `capturedAt` requires an explicit offset, and the server normalizes it to UTC microseconds. View fields require an IANA timezone, interval and chart type. `visibleFrom`/`visibleTo` are supplied together as finite ordered UTC seconds. `replayAsOf` is optional finite UTC availability metadata. `paneId` is optional. Labels are bounded; annotations allow ordinary newlines and at most 4,000 characters.

Only a valid **single-frame static PNG** is accepted: at most 8 MiB, each dimension at most 8,192 pixels and at most 16,777,216 pixels in total. Captures are limited to 20 per target, 64 KiB of capture/evidence metadata and a conservative 64 MiB aggregate asset-byte budget per source origin. Existing evidence is append-only and server-owned; generic trade/table edits cannot forge or erase it. The pre-existing generic journal attachment endpoint retains its ABI.

The result is `{workspace,result:{evidenceId,attachmentId,url},detail?}`; `detail` accompanies trade evidence. The transaction appends image identity/hash, source/instrument/view/notes and review history without changing financial facts. Image publication, record update and receipt commit together; failure rolls back all three. A missing/archived/foreign target, source/checksum mismatch, invalid image or stale revision cannot publish an asset.

Keep the same request ID and exact reviewed body when acknowledgement is uncertain. A stale journal revision needs an explicit reload/review before retrying a changed request. The frontend retains the failed image, notes, target and request identity; it does not silently capture a different chart. Only one capture/upload is active. Source, pane, instrument or replay changes during capture reject the mixed result.

## Read, export and restore evidence

Chart evidence is returned on the saved trade/run as `chartEvidence`. Entries retain `id`, `attachmentId`, `imageSha256`, capture time, source, instrument, view and annotations. Derive image URLs from the **current deployment origin** and attachment ID: `GET /api/local/v1/attachments/:attachmentId?originId=...`. Another principal/source cannot read those bytes.

Routine workspace/journal metadata does not select or base64-encode image content. Explicit image reads and supported exports retrieve bytes. Scoped journal export and the full P02 workspace ZIP include every retained capture, not only the current screenshot URL. Restore verifies evidence hashes and actual static PNG structure. Unavailable legacy assets remain explicitly unavailable. Undo and archive retain the supported records and relationships.

Workspace backups include chart documents/preferences/evidence and dataset manifest references. Candle files still require the separate [dataset bundle](local-datasets.md); a journal ZIP is not a candle-file backup. Validated restored aliases retain original run/trade references, while chart reads and new evidence resolve the owned canonical version.

## Supported source and replay boundary

Private charts serve the immutable version's native interval only. Same-source requested snapshots use explicit warmup and UTC availability; daily confirmation needs a declared frozen calendar. Forming/future observations, adjusted historical snapshots without point-in-time values, other instruments/venues, alternate variants and unsupported MTF requests are not silently substituted. Legacy connected requested history without a certified historical cutoff remains unavailable during replay. See the exact [supported source matrix](../plans/chartly-professional-platform/p05/SOURCE_POLICY.md).

The installed-engine test exercises actual replay callbacks, native requested and built-in plots, comparison readings and CSV future-value exclusion. The recorded 50,000-candle preparation fixture is a bounded JavaScript conversion/queue test, not a full-canvas, network, Linux/gunicorn or real-provider benchmark. Broader provider certification and simulation execution remain separate packages.
