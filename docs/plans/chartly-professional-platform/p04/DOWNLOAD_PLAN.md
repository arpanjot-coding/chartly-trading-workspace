# P04 finite download jobs

3 November 2026. Owner: P04 download implementation. State: implemented and fixture-verified; final package acceptance and real-provider certification are separate.

## Frozen service boundary

`DatasetDownloads(library, fetcher=None, clock=None)` exposes `create(expected_revision, request_id, context, mapping, start_at, end_at, chunk_seconds=86400)`, `step(id, expected_revision, request_id)`, `control(id, expected_revision, request_id, command)`, `list()` and `detail(id)`. Controls are pause, resume, cancel and retry. Responses contain the current library revision and a public job projection. A step performs at most one bounded UTC chunk. It creates no threads, scheduler or permanently running loop. Leaving the page does not keep a new browser-owned loop alive; saved progress can be resumed later.

The trusted injected fetcher receives `{jobId, principalUid, context, mapping, startAt, endAt, attempt}` and returns `{csvText}`. An explicit successful zero-row provider response may additionally return `empty:true`; it advances an empty checkpoint without inventing candles or coverage. `DownloadFetchError(code, status, retry_after_seconds)` carries safe structured failure information. The default is unavailable until the application supplies its owner-bound adapter. Requests cannot contain executable code, arbitrary URLs or provider credentials. Context and mapping are frozen for the job.

## Persistence and atomic publication

Jobs use `data_library_records` kind `download`; quotas use kind `download-quota`. Every lookup is bound to the server principal. Requests compare the library revision and retain stable request receipts. A running chunk owns a finite lease, token and cancellation generation. Database transactions finish before network I/O. One request reserves a persisted one-second provider/principal quota; the legacy Historify job pool is explicitly outside that reservation.

Fetched CSV is retained privately in the job before staging. Resume may reuse this retained chunk after a stale publication or interrupted process, without fetching again. Publication calls the library's normal quality/import/version path with internal `download_guard={jobId,leaseToken,generation,chunkIndex}`. Inside the same transaction as canonical version publication, the library calls `validate_download_guard` and then `complete_download_chunk`. These trusted hooks reject paused/cancelled/expired/superseded work and advance the checkpoint atomically with the version commit. They are never accepted from a public import body. Stable per-chunk commit request IDs and the checkpoint make uncertain acknowledgements recoverable without publishing a duplicate chunk.

Paused/cancelled work cannot publish after a fetch returns. Restarted running work can be reclaimed only after its 90-second lease expires. Retryable failures store attempt count and next-attempt time; no request sleeps through a quota wait. HTTP 429 and bounded Retry-After information defer the shared provider/principal reservation. Other transient failures use capped exponential backoff and a five-attempt limit, including publication retries that reuse retained CSV. Retry after a permanent failure is an explicit control action and re-fetches the failed chunk. Earlier successful request receipts return fresh job projections without rewinding current progress.

Creation validates the actual library's metadata and mapping before queueing. Jobs allow at most 366 requested days and 512 chunks; each chunk is 60 seconds through 31 days and retains at most 4 MiB of fetched CSV. The standalone library import supports its own larger upload budget. Provider responses must remain within the requested half-open chunk range. A source returning candles outside it is rejected rather than silently published under a false checkpoint.

## Acceptance and limits

Fixture tests must prove principal isolation, stable request replay, finite chunk ranges, shared persisted quota, restart/reclaim, expired leases, Retry-After/backoff, pause/cancel during fetch, no late publication, retained chunk recovery, atomic checkpoint/version commit and cleaned transaction resources. Existing legacy Historify control and scheduler paths remain unchanged. A real provider adapter is not certified by stub tests, and historical-data permissions still belong to that source. Dataset deletion, checksummed bundles and saved-run dependency checks are owned by the library/retention layer.

## Verification record

**34 tests passed** in 10.62 seconds. `test/test_dataset_downloads.py` uses real file-backed scoped SQLite for state/receipts and a stub fetcher; separate tests exercise the actual Data Library/DuckDB publication and out-of-range rejection. No external provider was called. A 100-job orchestration audit opened and closed 901 SQLite connections, with handles unchanged at 265 and retained traced Python memory 37,612 bytes (peak 581,304 bytes). These are bounded fixture measurements, not production-scale or provider certification. Final test output is retained in `tmp/p04-downloads-tests.log`; root acceptance records the final combined run.
