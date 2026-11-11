# Data Library: saved market history

The Data Library keeps historical candles on this computer for charting and later practice. It is independent of the trading journal: a candle file is market history, while a journal statement records your own trades.

Open **Settings → Connections & data → History & data**, or follow the history link from Workspace/chart/practice. Sign in to the local app account. Importing CSV, viewing saved versions and opening their charts do not require a connected broker. Existing connected-provider tools remain a separate destination.

## Import and review

1. Choose market-history CSV import and paste or select the source file. Keep the original file.
2. Map timestamp and every OHLC column. Map volume/open interest only when supplied; blank values remain unknown.
3. Declare ISO/seconds/milliseconds, opening-time meaning and the IANA timezone for naive times. The app will not guess ambiguous daylight-saving times or convert close-labelled candles into opening times.
4. Name the source, instrument/exchange and native interval. Declare price basis, adjustments/roll description, volume meaning and whether this instrument permits negative prices. These declarations do not automatically adjust prices.
5. Preview accepted/rejected/duplicate/changed rows, coverage and warnings. A declared calendar can distinguish expected market closures from missing candles; without one, gaps stay unclassified. Structural verification does not establish the source's authenticity or data rights.
6. Choose the overlap policy and commit. Keeping existing overlaps, replacing overlaps in a new version, or using only the uploaded snapshot all preserve earlier versions. Conflicting candles inside one file must be resolved. Saving only valid rows requires explicit consent to exclude rejected rows.

Uploads support up to 8 MiB and 50,000 source rows. The preview retains counts even when detailed rows are capped. A capacity or validation error does not silently remove old history. Reopen a saved import review or re-preview it after the catalog changes.

The upload report and saved-version quality answer different questions. The upload report keeps rejected/changed-row warnings; saved-version quality is recalculated over the candles actually retained after your policy. A clean saved subset does not mean every source row was valid.

## Inspect, chart and return

The catalog/detail identifies source, native resolution, exact version/checksum, stored size, quality and coverage. Two sources for the same symbol stay separate. Re-importing identical canonical content does not create a duplicate version. Catalog pages show up to 100 versions; continue through additional pages when needed.

**Open chart** uses that exact saved version in the existing chart interface. It has native intervals only; it does not silently blend sources or request a broker feed. The return link keeps the selected library/context. A missing or changed file is reported instead of substituting another dataset.

Repeated pane requests for the same window share a bounded load. If too many windows are pending, wait for the existing loads rather than starting more. Closing the page cancels its pending consumers; it does not retain a global candle cache.

**Prepare practice draft** passes the version and checksum into a chosen replay profile. It creates/pre-fills a Draft only. It does not start a simulator, establish a completed backtest or place an order; the validated paper-session workflow belongs to the later practice package.

## Optional provider downloads

The Downloads section shows whether this local account has a usable configured history connection. It uses the account's own existing API-key binding, never another account's first available key. Missing provider access does not block CSV or saved charts.

Create a finite request and use **Process next chunk**. Progress, quota waits, retry eligibility and checkpoints are saved. Pause/resume, cancel and explicit retry act on that job. Processing is one bounded chunk per action; it is not an always-running service after you close the page. A changed connection cannot silently continue a job under another provider.

Provider coverage, fees, permissions and rate limits still apply. The local fixture tests do not certify every broker/export or promise free global history. Legacy connected-provider jobs remain separate.

Some legacy history adapters fill absent open interest with zero before returning data. That is not proof of an observed zero. Keep open interest unmapped when its meaning is unverified; source-specific certification remains separate from these local workflow checks.

## Keep history recoverable

Archive removes a version from the default catalog while preserving its bytes and exact reads. Show archived versions to restore one. Saved practice references remain visible. There is no permanent-purge action, so archiving does not silently break a saved draft's history.

Download a **dataset backup** for each version you need to preserve. It contains checked candles, metadata and source CSV when available. Restore a dataset backup through its preview/commit flow; a changed hash or unsupported bundle is rejected before publication. Export candles CSV when you need interoperable values, while keeping the bundle for version/source evidence.

A validated dataset backup also carries proof for older saved version references. Moving it from owner A to B and later C can resolve the old practice references to C's private copy without editing those practice records or your journal trades. Existing native versions on the destination take priority; a backup cannot silently redirect their identity. The displayed checksum remains the content check, not a certification of the named provider.

The current capacity is 2000 retained versions and 5000 metadata records per local account. Reviews, jobs and restore-reference proofs also consume metadata capacity. A full library reports the limit instead of silently deleting old evidence; archiving retains bytes and does not free retained-version capacity.

The workspace/journal ZIP keeps dataset manifest references and backup links; it does **not** contain the candle files. Keep the separate dataset bundles when moving machines or clearing local storage. Credentials, execution state and installed strategy code are not in a dataset bundle.

Technical details: [Data Library API](../../api/local-datasets.md), [quality policy](../../plans/chartly-professional-platform/p04/QUALITY_POLICY.md), [journal guide](../33-trading-journal/README.md).
