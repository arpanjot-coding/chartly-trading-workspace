# P05 chart-to-journal evidence integration

3 November 2026. Frontend owner: P05 journal agent. Backend/storage owner: root. Chart/terminal integration owner: context agent. This records the implemented interface and focused checks; package/browser acceptance remains a separate root gate. Original chart controls and original journal tabs remain the base.

## Screens and ownership

The existing right rail gains a labelled Journal control and lazy panel. It uses the existing `PanelShell`, including resize/focus cleanup. A chart with an owned profile/run/trade can start with that destination; an unbound chart requires an explicit environment and book/record selection. Records from other books/profiles are absent. Preserved browser-only records receive the Storage & recovery action; disconnected cached journals remain read-only.

The actual focused instrument narrows eligible targets, and a captured-symbol check runs before retaining or uploading bytes. Record options are capped at 100 with a bounded text search for older entries. Trade-chart links preserve the actual trade/run/book and journal return context. Failed image reads offer an explicit retry and workspace-recovery guidance.

The context integration supplies a focused PNG capture callback and synchronous capture identity. The panel checks that identity around the snapshot and byte conversion, and fences source/profile/target changes and unmount. It neither creates a journal trade nor changes financial fields. One capture/upload is active at a time.

Saved evidence appears in the existing trade editor and expanded journal trade card, and on the practice-run card. Each row shows instrument, interval, capture time and source/view notes. PNG bytes are fetched only when that row is expanded. URLs are derived from the current local source origin and stored attachment ID, so restoring to another deployment does not retain an old hostname.

Expanded evidence also offers a recorded-chart return. The link carries the owned profile/trade/run/book and `evidenceId`, together with the validated journal or replay return route; it never encodes source, checksum, cursor or viewport authority in editable URL labels. The chart resolves those values from that target's actual stored evidence. The normal trade-chart link prefers its latest capture, so changing a profile's default source does not silently change the historical source used for review. Immutable evidence reopens its exact owned version and recorded view where available; a run's pinned source remains binding. Connected-only evidence explicitly offers current connected analysis and explains that the original historical data cannot be reconstructed exactly. Its saved PNG remains the original visual record.

## Frozen local contract

`POST /api/local/v1/journal/chart-evidence` uses existing verified account proof, CSRF, bounded worker and journal revision/receipt handling.

The body is `{originId,expectedRevision,requestId,target,mimeType:'image/png',base64,capture,annotations}`. Target is `{kind:'trade'|'run',id,profileId,bookId?}`; trade targets require their actual book. Capture is:

```typescript
{
  version: 1,
  capturedAt: string, // explicit ISO instant
  source:
    | { kind: 'dataset', datasetVersionId: string, checksum: string }
    | { kind: 'legacy-connected', provider: string },
  instrument: { symbol: string, exchange: string },
  view: {
    interval: string, chartType: string, timezone: string,
    visibleFrom?: number, visibleTo?: number,
    replayAsOf?: number, paneId?: string
  }
}
```

UTC bounds are seconds. The capture is an observed view, not order permission, a market authenticity certificate or a validated simulation checkpoint. The server resolves real target ownership and source/version/checksum; query labels and a PNG never grant authority.

The response uses `JournalActionResponse`: `{workspace,result:{evidenceId,attachmentId,url},detail?}`. A target's `chartEvidence` list stores flattened `{id,attachmentId,imageSha256,capturedAt,source,instrument,view,annotations}` records; optional server provenance fields may be additive. Dataset provider labels are canonicalized against the actual version and shown in the saved capture. Limits are PNG 8 MiB, 16 million decoded pixels/8,192-pixel edges, metadata 64 KiB and 20 captures per target, with the server enforcing the origin's aggregate asset budget. Existing byte-attachment behavior remains available separately.

## Retry and recovery

Before submitting, the panel retains the complete frozen body in the existing per-principal/origin/book draft store. A run uses a dedicated `run:<id>` draft scope; no second IndexedDB connection/store is created. Uncertain outcomes retry the same request ID, image, source metadata and reviewed revision, rather than capturing a different chart. Reopening the same target restores the retained capture. An outgoing save response is not applied to a different environment.

A definite journal revision conflict permits reloading the target and explicitly reviewing it. Only that deliberate path creates a new request identity/revision while retaining the original image and metadata. Draft lookup failure prevents new capture from overwriting unexamined interrupted work and offers a bounded recheck. A local JSON export and explicit draft discard remain available for recovery. No backend evidence deletion or purge is added.

All image assets referenced by historical capture records must remain in the scoped journal export and full workspace backup. The backend implementation owns verification of export, restore/Undo, record linkage, native dataset aliases and byte hashes. A workspace ZIP still does not contain P04 candle files.

The capture workflow also corrects a preference-status race exposed by journal reload: an active preference request is not an interrupted financial save. Preference completion clears only its exact stale loaded-draft notice for the same active principal and origin after checking that no other draft remains. It does not replace a financial saving/error/conflict status. Removing the completed request checks its request ID in an IndexedDB transaction, preserving a later concurrent preference draft. Current-session success identities are bounded to 128 entries for stale cache-read recognition and cleared on session reset.

## Implementation files

- `frontend/src/lib/trader/chartEvidence.ts`: typed source/capture/target/request/record, defensive metadata bounds, bounded PNG conversion and local URL derivation.
- `frontend/src/lib/trader/journalClient.ts`: typed chart-evidence mutation through the existing transport.
- `frontend/src/components/trading/JournalPanel.tsx`: destination selection, capture identity fencing, retained retry/review and existing panel shell.
- `frontend/src/components/trading/ChartEvidenceList.tsx`: lazy saved-image/view rendering reused by chart, journal and run.
- `frontend/src/components/trading/RightRail.tsx`: Journal panel ID/control; original controls remain.
- `JournalTradeEditor.tsx` / `TraderJournal.tsx`: additive saved-evidence rendering.
- Context agent owns the `Trading.tsx` lazy callback/wiring, terminal capture generation, `db.ts` additive field types and `TraderReplay.tsx` run-card insertion.

## Verification

Focused tests exercise explicit book/profile targets, run targets without fabricated trades, browser/storage and read-only states, metadata/image bounds, stale source during snapshot, outgoing environment responses, single active capture, persisted same-request retry after reopen, definite-conflict review, failed draft lookup and lazy image requests. Existing journal lifecycle/separation/operations tests cover regressions. The local transport test checks exact body/CSRF/credentials. Logs: `tmp/p05-journal-ui-tests.log`, `tmp/p05-journal-ui-biome.log` and `tmp/p05-journal-ui-typescript.log`; final integrated types/build/browser and server recovery checks belong to root acceptance.

Latest focused run: **67 tests across 8 suites passed**. A subsequent **3-test image/error-retry follow-up passed** after the final saved-image recovery UI; it overlaps the broader run. TypeScript passed after terminal/context integration, and scoped Biome checked 10 owned files with no fixes. The original large journal files received only additive imports/rendering/links and were not whole-file reformatted. Root owns the final production build and actual-screen evidence.

The final recorded-link and preference-status follow-up passed **86 tests across 9 suites** (`tmp/p05-journal-reopen-combined.log`), including latest-source trade links, exact evidence identity, safe return routes, connected-history disclosure, active preference reload, another retained chart draft, concurrent preference requests, financial status preservation and account changes. TypeScript passed (`tmp/p05-journal-reopen-typescript.log`, empty successful output); scoped Biome checked the seven changed helper/panel/list/persistence files without fixes. These counts overlap earlier runs.

Independent context review added **8 passing cases** in `frontend/src/lib/trading/chartContext.review.test.ts`, covering trade/default/explicit instrument priority, conflicting links, wrong dataset/book, owned book and rename-safe source/profile namespaces. Its log is `tmp/p05-context-independent-review.log`. Review findings for connected read-only account resources, StrictMode source lifetime and template drawings were passed to the context owner for fixes and focused regression; root owns their integrated acceptance.

Frontend resource behavior is bounded: one 8 MiB image and one retained body for the selected target; no raw candle arrays, timers or new singleton stores; no image requests for collapsed evidence rows. Draft JSON export revokes its object URL immediately. Existing `PanelShell` removes drag listeners on unmount. Repeated backend asset/connection and memory measurements are recorded by the root resource audit.
