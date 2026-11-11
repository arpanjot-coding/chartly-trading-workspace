import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router'
import { SettingsBackLink } from '@/components/layout/SettingsNavigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { libraryReturn } from '@/lib/historify/dataLibraryNavigation'
import {
  captureBrowserSnapshot,
  TRADER_TABLES,
  type TraderTableName,
  type TraderTables,
} from '@/lib/trader/browserSnapshot'
import {
  acceptWorkspace,
  archivedWorkspaceDrafts,
  archivePendingDrafts,
  copyTables,
  loadTraderBinding,
  notifyStorageChanged,
  persistenceStatus,
  rebuildDerivedCache,
  retainedDraft,
  retainedWorkspaceDrafts,
  retryNativeDraft,
  retryPendingSave,
  retryPreferenceSave,
  saveBackendTables,
  subscribePersistence,
} from '@/lib/trader/dataPersistence'
import { traderDb } from '@/lib/trader/db'
import {
  type LocalContext,
  LocalStorageError,
  localStorageClient,
  type MigrationPreview,
  type RecoveryStatus,
  type RestorePreview,
  type RestoreReceipt,
  type WorkspaceState,
} from '@/lib/trader/localStorageClient'
import { useAuthStore } from '@/stores/authStore'

export function downloadStorageFile(value: Blob | unknown, filename: string) {
  const blob =
    value instanceof Blob
      ? value
      : new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const SELECT = 'rounded-md border bg-background px-3 py-2 text-sm max-w-full'
const JOB_KEY = 'chartly.storage.migration-job.v1'

export default function StorageRecovery() {
  const [params] = useSearchParams()
  const returnTo = libraryReturn(params.get('returnTo'))
  const connecting = !!params.get('returnTo') && returnTo !== '/workspace'
  const [context, setContext] = useState<LocalContext | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [browserTables, setBrowserTables] = useState<TraderTables | null>(null)
  const [preview, setPreview] = useState<MigrationPreview | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, string>>({})
  const [restore, setRestore] = useState<RestorePreview | null>(null)
  const [receipt, setReceipt] = useState<RestoreReceipt | null>(null)
  const [recovery, setRecovery] = useState<RecoveryStatus>({ restores: [], migrations: [] })
  const [confirmOwner, setConfirmOwner] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [drafts, setDrafts] = useState<Awaited<ReturnType<typeof retainedWorkspaceDrafts>>>([])
  const [commitId, setCommitId] = useState(() => crypto.randomUUID())
  const [catalogSelection, setCatalogSelection] = useState('')
  const status = useSyncExternalStore(subscribePersistence, persistenceStatus)
  const username = useAuthStore((state) => state.user?.username)
  const chartNamespace = context?.principalId ? `oa-trading:${context.principalId}` : undefined

  const refresh = useCallback(async () => {
    const next: LocalContext = await localStorageClient.context().catch((cause) => {
      if (cause instanceof LocalStorageError && cause.status === 401)
        return { authenticated: false, setupRequired: true, workspaces: [] } satisfies LocalContext
      throw cause
    })
    setContext(next)
    setRecovery({ restores: [], migrations: [] })
    setReceipt(null)
    if (next.authenticated) {
      const reviews = await localStorageClient.recoveryStatus()
      setRecovery(reviews)
      setReceipt(
        reviews.restores.find((item) => item.status === 'completed' && item.receipt)?.receipt ??
          null
      )
    }
    if (next.authenticated && next.activeOriginId) {
      const loaded = await loadTraderBinding()
      if (
        loaded?.kind === 'backend' &&
        (loaded.principalId !== next.principalId ||
          loaded.workspace?.originId !== next.activeOriginId)
      )
        throw new Error('Account or workspace changed. Reopen Storage & recovery.')
      setWorkspace(loaded?.workspace ?? (await localStorageClient.workspace(next.activeOriginId)))
      setBrowserTables(null)
      setDrafts(
        next.principalId
          ? await retainedWorkspaceDrafts({
              principalId: next.principalId,
              originId: next.activeOriginId,
            })
          : []
      )
    } else {
      setWorkspace(null)
      setDrafts([])
      try {
        const local = await loadTraderBinding()
        setBrowserTables(local?.kind === 'browser' ? local.tables : null)
      } catch {
        setBrowserTables(null)
      }
    }
    return next
  }, [])
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The operation failed. Your source records are retained.'
      )
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void run(async () => {
      const next = await refresh()
      const savedJob = localStorage.getItem(JOB_KEY)
      if (savedJob && next.authenticated) {
        const job = JSON.parse(savedJob)
        if (job.principalId === next.principalId) {
          const result = await localStorageClient.migration(job.id)
          setPreview(result)
          setResolutions(result.resolutions ?? {})
          setCommitId(job.requestId)
        }
      }
    })
  }, [refresh, run])
  async function hydrateSaved() {
    const next = await localStorageClient.context()
    if (!next.activeOriginId) throw new Error('No saved workspace is active.')
    const state = await localStorageClient.workspace(next.activeOriginId)
    await acceptWorkspace(state)
    await refresh()
  }
  async function previewBrowser() {
    const snapshot = await captureBrowserSnapshot()
    const next = await localStorageClient.preview(snapshot, chartNamespace)
    const requestId = crypto.randomUUID()
    localStorage.setItem(
      JOB_KEY,
      JSON.stringify({ id: next.id, principalId: context?.principalId, requestId })
    )
    setCommitId(requestId)
    setPreview(next)
    setResolutions(next.resolutions ?? {})
  }
  function resumeMigration(job: MigrationPreview) {
    if (job.issuesTruncated)
      throw new Error('Load the complete migration review before resolving its issues.')
    let requestId = crypto.randomUUID()
    try {
      const held = JSON.parse(localStorage.getItem(JOB_KEY) ?? 'null')
      if (
        held?.id === job.id &&
        held.principalId === context?.principalId &&
        typeof held.requestId === 'string'
      )
        requestId = held.requestId
      localStorage.setItem(
        JOB_KEY,
        JSON.stringify({ id: job.id, principalId: context?.principalId, requestId })
      )
    } catch {
      /* server retains the preview even if this browser cannot retain its request token */
    }
    setPreview(job)
    setResolutions(job.resolutions ?? {})
    setCommitId(requestId)
  }
  const restoreStale = restore !== null && restore.expectedRevision !== context?.revision
  const unresolved =
    preview?.issues.filter((issue) => !issue.choices?.includes(resolutions[issue.id])) ?? []
  const archiveTables = workspace?.tables ?? browserTables
  const archived = archiveTables
    ? TRADER_TABLES.flatMap((table) =>
        archiveTables[table].filter((row) => row.archivedAt).map((row) => ({ table, row }))
      )
    : []
  const catalogs = Object.entries(workspace?.nativeCatalogs ?? {}).flatMap(
    ([database, namespaces]) =>
      Object.keys(namespaces).map((namespace) => ({
        database,
        namespace,
        id: JSON.stringify([database, namespace]),
      }))
  )
  async function reactivate(table: TraderTableName, id: number) {
    const binding = await loadTraderBinding()
    const tables = copyTables(binding.tables)
    const row = tables[table].find((record) => record.id === id)
    if (!row) throw new Error('Archived record is no longer available; reload saved data.')
    delete row.archivedAt
    // Archived connection configuration never re-arms copying or execution.
    if (binding.kind === 'backend') await saveBackendTables(binding, tables)
    else {
      await traderDb.table(table).update(id, { archivedAt: undefined })
      notifyStorageChanged()
    }
    await refresh()
    setNotice('Record restored. Connection and execution settings remain unverified.')
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6">
      <SettingsBackLink />
      {connecting && (
        <Alert>
          <AlertTitle>Save your existing profiles on this computer</AlertTitle>
          <AlertDescription>
            Review the browser records below once, then save them to use account connections. Your
            original browser copy is kept. No broker sign-in is required.
            <Button variant="outline" asChild className="mt-3">
              <Link to={returnTo}>Back to Connections</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <header>
        <h1 className="text-2xl font-bold">Storage & recovery</h1>
        <p className="mt-2 text-muted-foreground">
          Keep your journal, saved charts and working drafts on this computer’s local engine. Broker
          access is separate.
        </p>
      </header>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Operation could not be completed</AlertTitle>
          <AlertDescription>
            {error}{' '}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await refresh()
                })
              }
            >
              Reload status
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Local storage</CardTitle>
          <CardDescription>{status.message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!context?.authenticated ? (
            <>
              <p className="text-sm">
                Browser records stay on this browser until you review and migrate them. Sign in to
                your local account to access saved workspaces.
              </p>
              <Button asChild>
                <Link to="/login?purpose=local&next=/settings/storage">
                  Sign in for local storage
                </Link>
              </Button>
            </>
          ) : (
            <>
              {context.setupRequired && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setContext(await localStorageClient.setup())
                      setNotice(
                        'Local storage is ready. Review the browser migration before importing records.'
                      )
                    })
                  }
                >
                  Set up local storage
                </Button>
              )}
              {!!context.workspaces.length && (
                <label className="flex flex-col gap-2 text-sm">
                  Saved workspace
                  <select
                    className={SELECT}
                    aria-label="Saved workspace"
                    value={context.activeOriginId ?? ''}
                    disabled={busy}
                    onChange={(event) =>
                      void run(async () => {
                        const next = await localStorageClient.activate(event.target.value)
                        setContext(next)
                        await hydrateSaved()
                        setNotice('Saved workspace selected.')
                      })
                    }
                  >
                    {!context.activeOriginId && <option value="">Choose workspace</option>}
                    {context.workspaces.map((item) => (
                      <option key={item.originId} value={item.originId}>
                        {item.name ?? item.originId}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="text-sm">
                {workspace
                  ? `Active source: ${workspace.originId} · Journal revision ${workspace.revision}`
                  : 'No saved source selected. Review your browser records below.'}
              </p>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  downloadStorageFile(
                    await captureBrowserSnapshot(),
                    'chartly-preserved-browser-source.json'
                  )
                })
              }
            >
              Export preserved browser source
            </Button>
            <Button
              disabled={busy || !context?.authenticated}
              onClick={() => void run(previewBrowser)}
            >
              {connecting ? 'Preview existing profiles' : 'Review browser migration'}
            </Button>
            {workspace && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await hydrateSaved()
                    setNotice('Saved records reloaded from the local engine.')
                  })
                }
              >
                Reload saved data
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            The export includes all seven journal tables, saved chart catalogs, allowlisted
            preferences and available screenshot bytes. Credentials and broker sessions are
            excluded. Original browser databases are preserved.
          </p>
        </CardContent>
      </Card>
      {(recovery.restores.some((job) => job.status === 'preview') ||
        recovery.migrations.some((job) => job.status === 'preview')) && (
        <Card>
          <CardHeader>
            <CardTitle>Resumable reviews</CardTitle>
            <CardDescription>
              Saved on the local engine for this account. Resume a review to inspect it; nothing is
              committed automatically. Newest reviews appear first.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recovery.restores
              .filter((job) => job.status === 'preview')
              .map((job) => (
                <div
                  key={job.jobId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm"
                >
                  <span>
                    Restore · {job.jobId} · preview revision {job.expectedRevision}
                    {job.expectedRevision !== context?.revision
                      ? ' · Saved data has changed; a fresh preview is required.'
                      : ''}
                  </span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await refresh()
                        const details = await localStorageClient.restoreJob(job.jobId)
                        if (details.previewDetailsTruncated)
                          throw new Error(
                            'The full restore review could not be loaded. Retry before confirming a restore.'
                          )
                        setRestore(details)
                        setConfirmOwner(false)
                      })
                    }
                  >
                    Resume restore review {job.jobId}
                  </Button>
                </div>
              ))}
            {recovery.migrations
              .filter((job) => job.status === 'preview')
              .map((job) => (
                <div
                  key={job.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm"
                >
                  <span>Browser migration · {job.id}</span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        resumeMigration(await localStorageClient.migration(job.id))
                      })
                    }
                  >
                    Resume migration review {job.id}
                  </Button>
                </div>
              ))}
          </CardContent>
        </Card>
      )}
      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>Migration review</CardTitle>
            <CardDescription>
              Review every ownership, identity, numeric and namespace issue before activation.
              Declared accounts remain unverified.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.originId && <p className="text-sm break-all">Source: {preview.originId}</p>}
            {preview.snapshotHash && (
              <details className="text-sm">
                <summary className="cursor-pointer">Source verification</summary>
                <p className="mt-2 break-all">Snapshot SHA-256: {preview.snapshotHash}</p>
                {Object.entries(preview.tableChecksums ?? {}).map(([name, checksum]) => (
                  <p key={name} className="mt-1 break-all">
                    {name}: {checksum}
                  </p>
                ))}
              </details>
            )}
            <p className="text-sm">
              {Object.entries(preview.counts)
                .map(([key, count]) => `${key}: ${count}`)
                .join(' · ')}
            </p>
            {preview.issues.map((issue) => (
              <div className="space-y-2 rounded border p-3" key={issue.id}>
                <label className="block text-sm" htmlFor={`issue-${issue.id}`}>
                  {issue.message}
                </label>
                {issue.choices?.length ? (
                  <select
                    id={`issue-${issue.id}`}
                    className={SELECT}
                    value={resolutions[issue.id] ?? ''}
                    disabled={busy}
                    onChange={(event) =>
                      setResolutions((current) => ({ ...current, [issue.id]: event.target.value }))
                    }
                  >
                    <option value="">Choose explicitly…</option>
                    {issue.choices.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice === 'map-current'
                          ? `Map to current local chart account (${username ?? 'account'} · ${context?.principalId ?? 'unavailable'})`
                          : choice}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm text-destructive">
                    This issue blocks migration. Correct the preserved source or contact support; no
                    data has been activated.
                  </p>
                )}
              </div>
            ))}
            <Button
              disabled={busy || unresolved.length > 0 || preview.status === 'completed'}
              onClick={() =>
                void run(async () => {
                  const receipt = await localStorageClient.commit(preview.id, resolutions, commitId)
                  const state = await localStorageClient.workspace(receipt.originId)
                  await acceptWorkspace(state)
                  localStorage.removeItem(JOB_KEY)
                  setPreview(null)
                  await refresh()
                  setNotice(
                    'Migration completed and saved records activated. Original browser source retained.'
                  )
                })
              }
            >
              {connecting ? 'Save these profiles on this computer' : 'Commit reviewed migration'}
            </Button>
            {!!unresolved.length && (
              <p className="text-sm">{unresolved.length} issue(s) need an explicit decision.</p>
            )}
          </CardContent>
        </Card>
      )}
      {workspace && (
        <Card>
          <CardHeader>
            <CardTitle>Saved chart catalogs</CardTitle>
            <CardDescription>
              Inspect preserved namespaces individually. Namespace mapping is an explicit migration
              decision.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {catalogs.length ? (
              <>
                <label className="flex flex-col gap-2 text-sm">
                  Catalog namespace
                  <select
                    className={SELECT}
                    value={catalogSelection}
                    onChange={(event) => setCatalogSelection(event.target.value)}
                  >
                    <option value="">Choose catalog</option>
                    {catalogs.map((catalog) => (
                      <option key={catalog.id} value={catalog.id}>
                        {catalog.database} · {catalog.namespace}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="outline"
                  disabled={!catalogSelection || busy}
                  onClick={() =>
                    void run(async () => {
                      const selected = catalogs.find((catalog) => catalog.id === catalogSelection)
                      if (!selected) throw new Error('Choose an available catalog.')
                      const kind =
                        selected.database === 'openalgo-chart-workspaces'
                          ? 'workspace'
                          : selected.database === 'openalgo-chart-watchlists'
                            ? 'watchlist'
                            : 'drawingTemplates'
                      const saved = await localStorageClient.native(
                        kind,
                        selected.namespace,
                        workspace.originId
                      )
                      downloadStorageFile(saved.catalog, 'chartly-saved-chart-catalog.json')
                    })
                  }
                >
                  Export selected catalog
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No native chart catalogs in this saved source.
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {context?.authenticated && (
        <Card>
          <CardHeader>
            <CardTitle>Backup & restore</CardTitle>
            <CardDescription>
              Back up all saved sources, books, charts, attachments and preferences. Restore
              requires a validated preview; runtime trading remains disarmed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              variant="outline"
              disabled={busy || !workspace}
              onClick={() =>
                void run(async () => {
                  if (!workspace)
                    throw new Error('Select a saved workspace before downloading its backup.')
                  downloadStorageFile(
                    await localStorageClient.backup(workspace.originId),
                    `chartly-backup-${new Date().toISOString().slice(0, 10)}.zip`
                  )
                })
              }
            >
              Download workspace backup ZIP
            </Button>
            <label className="block text-sm">
              Preview backup ZIP
              <input
                className="mt-2 block max-w-full text-sm"
                type="file"
                accept=".zip,application/zip"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file)
                    void run(async () => {
                      const next = await refresh()
                      setRestore(await localStorageClient.restorePreview(file, next.revision ?? 0))
                      setConfirmOwner(false)
                    })
                }}
              />
            </label>
            {restore && (
              <div className="space-y-3 rounded border p-4">
                <p className="text-sm">
                  Preview revision {restore.expectedRevision} · Current saved revision{' '}
                  {context.revision ?? 0}
                </p>
                {restoreStale && (
                  <p role="alert" className="text-sm text-destructive">
                    Saved data changed after this preview. Upload the backup again to create a fresh
                    preview before restoring.
                  </p>
                )}
                <p className="font-medium">
                  Validated restore preview · {restore.originCount} source(s)
                </p>
                <p className="text-sm">
                  {Object.entries(restore.moduleCounts)
                    .map(([name, count]) => `${name}: ${count}`)
                    .join(' · ')}
                </p>
                {!!restore.unavailableAttachments.length && (
                  <p className="text-sm">
                    {restore.unavailableAttachments.length} attachments remain unavailable; original
                    references are retained.
                  </p>
                )}
                {!!restore.unverifiedDependencies.length && (
                  <p className="text-sm">
                    {restore.unverifiedDependencies.length} external dependencies require
                    verification after restore.
                  </p>
                )}
                {restore.requiresOwnershipConfirmation && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmOwner}
                      onChange={(event) => setConfirmOwner(event.target.checked)}
                    />
                    I confirm I own these records and want to import them into this local account.
                  </label>
                )}
                <Button
                  disabled={
                    busy || restoreStale || (restore.requiresOwnershipConfirmation && !confirmOwner)
                  }
                  onClick={() =>
                    void run(async () => {
                      const result = await localStorageClient.restoreCommit(
                        restore.jobId,
                        restore.expectedRevision,
                        restore.confirmationHash,
                        confirmOwner
                      )
                      setReceipt(result)
                      await hydrateSaved()
                      setRestore(null)
                      setNotice(
                        'Backup restored. The previous saved state is retained as a recovery copy.'
                      )
                    })
                  }
                >
                  Restore reviewed backup
                </Button>
              </div>
            )}
            {receipt?.recoveryCopyId && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await refresh()
                    setRestore(
                      await localStorageClient.undoPreview(
                        receipt.recoveryCopyId,
                        next.revision ?? 0
                      )
                    )
                    setConfirmOwner(false)
                  })
                }
              >
                Review undo of last restore
              </Button>
            )}
            <details>
              <summary className="cursor-pointer text-sm">Rebuild derived cache</summary>
              <p className="my-3 text-sm">
                Reloads only the current account’s derived cache from saved data. The original
                browser databases, pending drafts and saved records are retained.
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const state = await rebuildDerivedCache()
                    setWorkspace(state)
                    setNotice(
                      'Derived cache rebuilt from saved records. Original source and pending drafts retained.'
                    )
                  })
                }
              >
                Rebuild cache from saved data
              </Button>
            </details>
          </CardContent>
        </Card>
      )}
      {(status.pending || drafts.length > 0) && context?.authenticated && (
        <Card>
          <CardHeader>
            <CardTitle>Retained drafts</CardTitle>
            <CardDescription>
              A conflict never overwrites newer saved records. Export your draft before reconciling
              changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await retryPendingSave()
                    await refresh()
                  })
                }
              >
                Retry journal save
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await retryPreferenceSave()
                    await refresh()
                  })
                }
              >
                Retry preferences & editor drafts
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await archivePendingDrafts()
                    await hydrateSaved()
                    setNotice(
                      'Newer saved records loaded. Interrupted drafts retained in the local draft archive.'
                    )
                  })
                }
              >
                Keep saved data and archive drafts
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    downloadStorageFile(
                      await retainedWorkspaceDrafts(),
                      'chartly-retained-workspace-drafts.json'
                    )
                  })
                }
              >
                Export all retained drafts
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const draft = await retainedDraft()
                    if (!draft) throw new Error('No journal draft is retained for this account.')
                    downloadStorageFile(draft, 'chartly-retained-journal-draft.json')
                  })
                }
              >
                Export journal draft
              </Button>
            </div>
            {drafts
              .filter((draft) => draft.kind === 'native')
              .map((draft) => (
                <div key={draft.key} className="flex flex-wrap items-center gap-3 text-sm">
                  <span>{draft.namespace}</span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await retryNativeDraft(draft.key)
                        await refresh()
                      })
                    }
                  >
                    Retry chart draft
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => downloadStorageFile(draft, 'chartly-retained-chart-draft.json')}
                  >
                    Export chart draft
                  </Button>
                </div>
              ))}
          </CardContent>
        </Card>
      )}
      {(workspace || browserTables) && (
        <Card>
          <CardHeader>
            <CardTitle>Archived records</CardTitle>
            <CardDescription>
              Archiving retains the record and its relationships. No permanent purge is available
              here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  downloadStorageFile(
                    await archivedWorkspaceDrafts(),
                    'chartly-archived-interrupted-drafts.json'
                  )
                })
              }
            >
              Export archived interrupted drafts
            </Button>
            {!archived.length && (
              <p className="text-sm text-muted-foreground">No archived records.</p>
            )}
            {archived.map(({ table, row }) => (
              <div
                key={`${table}:${row.id}`}
                className="flex flex-wrap items-center justify-between gap-3 text-sm"
              >
                <span>
                  {table} ·{' '}
                  {'name' in row ? row.name : 'pair' in row ? row.pair : `Record ${row.id}`}
                </span>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (row.id) await reactivate(table, row.id)
                    })
                  }
                >
                  Restore record {row.id}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
