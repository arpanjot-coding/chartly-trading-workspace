import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Database, FileDown, LineChart, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  type DatasetCatalog,
  type DatasetContext,
  DatasetError,
  type DatasetVersion,
  dataLibrary,
} from '@/api/dataLibrary'
import { Navbar } from '@/components/layout/Navbar'
import { ConnectionsDataNavigation, SettingsBackLink } from '@/components/layout/SettingsNavigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  datasetChartHref,
  datasetLibraryHref,
  libraryReturn,
} from '@/lib/historify/dataLibraryNavigation'
import { useTraderData } from '@/lib/trader/useTraderData'
import { useAuthStore } from '@/stores/authStore'
import DataLibraryFeedSource from './DataLibraryFeedSource'
import {
  DataLibraryImport,
  datasetRequestContext,
  emptyDatasetContext,
  emptyDatasetMapping,
} from './DataLibraryImport'
import DataLibraryPublicSource, { PublicSourceDetails } from './DataLibraryPublicSource'
import DataLibraryRecovery from './DataLibraryRecovery'

export function utcDate(seconds: number): string {
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString().replace('.000Z', 'Z')
    : 'Unknown'
}
function size(value: number): string {
  return Number.isFinite(value) ? `${(value / 1024).toFixed(1)} KiB` : 'Unknown'
}
export function saveDatasetFile(content: Blob, filename: string) {
  const url = URL.createObjectURL(content)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
function VersionDetail({
  version,
  catalog,
  returnTo,
  onCatalog,
}: {
  version: DatasetVersion
  catalog: DatasetCatalog
  returnTo: string
  onCatalog: (catalog: DatasetCatalog, version?: DatasetVersion) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState('')
  const profiles = useTraderData()
  const pending = useRef<{ action: string; expectedRevision: number; requestId: string } | null>(
    null
  )
  async function archive() {
    const action = version.archivedAt ? 'restore' : 'archive'
    const body =
      pending.current?.action === action
        ? pending.current
        : { action, expectedRevision: catalog.revision, requestId: crypto.randomUUID() }
    pending.current = body
    setBusy(true)
    setError('')
    try {
      const result = await dataLibrary[action](version.id, body.expectedRevision, body.requestId)
      pending.current = null
      onCatalog(result.catalog, result.version)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The version could not be updated. Its data is retained.'
      )
    } finally {
      setBusy(false)
    }
  }
  async function download(format: 'csv' | 'bundle') {
    setBusy(true)
    setError('')
    try {
      saveDatasetFile(
        await dataLibrary.export(version.id, format),
        `chartly-dataset-${version.id}.${format === 'csv' ? 'csv' : 'zip'}`
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The version could not be exported. Saved data is unchanged.'
      )
    } finally {
      setBusy(false)
    }
  }
  const returnProfileId = /^\/workspace\/profiles\/([1-9]\d*)(?:\/replay)?$/.exec(
    new URL(libraryReturn(returnTo), 'http://local.invalid').pathname
  )?.[1]
  const replayProfiles = profiles.portfolios.filter(
    (item) => item.kind === 'replay' && !item.archivedAt
  )
  const fromProfile = replayProfiles.some((item) => String(item.id) === returnProfileId)
    ? returnProfileId
    : undefined
  const profileId = fromProfile ?? profile
  const practiceHref = /^[1-9]\d*$/.test(profileId)
    ? `/workspace/profiles/${profileId}/replay?${new URLSearchParams({ datasetVersionId: version.id, returnTo: datasetLibraryHref(returnTo, version.id) })}`
    : null
  return (
    <Card aria-label="Dataset version detail">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{version.name || version.metadata.symbol}</CardTitle>
          <Badge variant={version.archivedAt || version.quarantine ? 'secondary' : 'outline'}>
            {version.quarantine
              ? 'Time verification required'
              : version.archivedAt
                ? 'Archived · bytes retained'
                : 'Saved immutable version'}
          </Badge>
        </div>
        <CardDescription>
          {version.metadata.provider} · {version.metadata.symbol} · {version.metadata.exchange} ·{' '}
          {version.metadata.interval}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {version.quarantine && (
          <p role="note" className="rounded border p-3 text-sm">
            {version.quarantine.message}
          </p>
        )}
        {version.sourceObservation && (
          <PublicSourceDetails observation={version.sourceObservation} />
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Candles</dt>
            <dd>{version.rowCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Native interval</dt>
            <dd>{version.metadata.interval}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Local size</dt>
            <dd>{size(version.sizeBytes)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Saved references</dt>
            <dd>{version.dependencies?.length ?? 0}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">
              {version.quarantine
                ? 'Stored coverage starts · time unverified'
                : 'Coverage starts (UTC)'}
            </dt>
            <dd>{utcDate(version.start)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">
              {version.quarantine
                ? 'Stored coverage ends · time unverified'
                : 'Coverage ends (UTC)'}
            </dt>
            <dd>{utcDate(version.end)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Price basis</dt>
            <dd>{version.metadata.priceBasis}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Adjustment</dt>
            <dd>{version.metadata.adjustment}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Volume meaning</dt>
            <dd>{version.metadata.volumeMeaning}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Session calendar</dt>
            <dd>
              {version.metadata.calendar.id} · {version.metadata.calendar.timezone}
            </dd>
          </div>
        </dl>
        <p className="text-sm">
          {String(version.quality.summary ?? 'Open the quality details for this version.')}
        </p>
        {version.importReport && (
          <details
            className="rounded border p-3"
            open={(version.importReport.counts.rejected ?? 0) > 0}
          >
            <summary className="cursor-pointer text-sm font-medium">
              Original source import report
            </summary>
            <div className="mt-3 space-y-3">
              {(version.importReport.counts.rejected ?? 0) > 0 && (
                <p className="text-sm">
                  The original source contained {version.importReport.counts.rejected} rejected{' '}
                  {version.importReport.counts.rejected === 1 ? 'row' : 'rows'}. Rejected rows were
                  excluded under the reviewed import policy; the source report is retained.
                </p>
              )}
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {Object.entries(version.importReport.counts).map(([name, value]) => (
                  <div key={name}>
                    <dt className="capitalize text-muted-foreground">
                      {name.replace(/([a-z])([A-Z])/g, '$1 $2')}
                    </dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm">{String(version.importReport.quality.summary ?? '')}</p>
              {Array.isArray(version.importReport.quality.rowErrors) && (
                <ul className="list-inside list-disc text-sm">
                  {version.importReport.quality.rowErrors.map((item, index) => {
                    const issue = item as { code?: string; message?: string; count?: number }
                    return (
                      <li key={issue.code ?? String(index)}>
                        {issue.message ?? 'Rejected source row values'} · {issue.count ?? 0} rows
                      </li>
                    )
                  })}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Publication policy: {version.importReport.policy}. Final saved coverage and quality
                above describe the published version.
              </p>
            </div>
          </details>
        )}
        <div className="flex flex-wrap gap-2">
          {version.quarantine ? (
            <Button disabled>
              <LineChart className="h-4 w-4" />
              Open chart
            </Button>
          ) : (
            <Button asChild>
              <Link to={datasetChartHref(version.id, datasetLibraryHref(returnTo, version.id))}>
                <LineChart className="h-4 w-4" />
                Open chart
              </Link>
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy || !!version.quarantine}
            onClick={() => void download('csv')}
          >
            <FileDown className="h-4 w-4" />
            Export candles CSV
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void download('bundle')}>
            Download dataset backup
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void archive()}>
            {version.archivedAt ? 'Restore to catalog' : 'Archive version'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Archiving hides the version from the active catalog and retains its bytes and references.
          Candle files require a separate dataset backup; a journal workspace backup does not
          contain them.
        </p>
        <section className="space-y-2 rounded border p-3" aria-label="Practice draft handoff">
          <h3 className="font-medium">Use in a practice draft</h3>
          {!fromProfile && (
            <div className="max-w-sm space-y-2">
              <Label htmlFor="dataset-profile">Replay profile</Label>
              <select
                id="dataset-profile"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={profile}
                disabled={!!version.quarantine}
                onChange={(event) => setProfile(event.target.value)}
              >
                <option value="">Choose a replay profile</option>
                {replayProfiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <Button asChild variant="link" className="h-auto p-0">
                <Link to="/workspace">Create or open a replay profile in Workspace</Link>
              </Button>
            </div>
          )}
          {version.quarantine ? (
            <Button variant="outline" disabled>
              Prepare practice draft
            </Button>
          ) : practiceHref ? (
            <Button asChild variant="outline">
              <Link to={practiceHref}>Prepare practice draft</Link>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Choose a replay profile, or create one in Workspace.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            The saved version and checksum follow the draft. This does not start a simulator or
            trading session.
          </p>
        </section>
        <details className="rounded border p-3">
          <summary className="cursor-pointer text-sm">
            Quality, coverage and version evidence
          </summary>
          <dl className="mt-3 space-y-2 text-xs">
            <div>
              <dt>Version</dt>
              <dd className="break-all">{version.id}</dd>
            </div>
            <div>
              <dt>Dataset</dt>
              <dd className="break-all">{version.datasetId}</dd>
            </div>
            <div>
              <dt>Candle checksum</dt>
              <dd className="break-all">{version.checksum}</dd>
            </div>
            <div>
              <dt>Source checksum</dt>
              <dd className="break-all">{version.sourceHash}</dd>
            </div>
          </dl>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(
              {
                quality: version.quality,
                coverage: version.coverage,
                calendar: version.metadata.calendar,
                dependencies: version.dependencies,
              },
              null,
              2
            )}
          </pre>
        </details>
      </CardContent>
    </Card>
  )
}
function DownloadJobs({
  catalog,
  onCatalog,
}: {
  catalog: DatasetCatalog
  onCatalog: (catalog: DatasetCatalog) => void
}) {
  const [symbol, setSymbol] = useState('')
  const [exchange, setExchange] = useState('NSE')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [interval, setInterval] = useState('1m')
  const [currency, setCurrency] = useState('')
  const [volumeMeaning, setVolumeMeaning] = useState<DatasetContext['volumeMeaning']>('unknown')
  const [priceBasis, setPriceBasis] = useState<DatasetContext['priceBasis']>('raw')
  const [adjustment, setAdjustment] = useState('none')
  const [negativePrices, setNegativePrices] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<Map<string, { expectedRevision: number; requestId: string }>>(new Map())
  const capability = catalog.capabilities.downloads as
    | { available?: boolean; provider?: string; reason?: string; intervals?: string[] }
    | undefined
  const jobs = catalog.jobs.filter((job) => job.kind?.includes('download'))
  const nativeInterval = capability?.intervals?.includes(interval)
    ? interval
    : (capability?.intervals?.[0] ?? interval)
  async function act(
    key: string,
    action: (body: {
      expectedRevision: number
      requestId: string
    }) => Promise<{ catalog: DatasetCatalog }>
  ) {
    if (!pending.current.has(key) && pending.current.size >= 100) {
      setError(
        'There are 100 unresolved request receipts in this screen. Inspect or refresh the saved jobs before starting another request; their existing identities are retained.'
      )
      return
    }
    const body = pending.current.get(key) ?? {
      expectedRevision: catalog.revision,
      requestId: crypto.randomUUID(),
    }
    pending.current.set(key, body)
    setBusy(true)
    setError('')
    try {
      const result = await action(body)
      pending.current.delete(key)
      onCatalog(result.catalog)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The download request failed. Check its saved job before retrying.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider downloads</CardTitle>
        <CardDescription>
          Download chunks have saved checkpoints. Processing a chunk fetches history; it never
          submits an order.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!capability?.available ? (
          <p className="text-sm">
            {capability?.reason ||
              'No eligible provider history connection is available. CSV import and saved charts work without one.'}{' '}
            <Link className="underline" to="/settings/connections">
              Review connections
            </Link>
          </p>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault()
              const key = JSON.stringify([
                symbol,
                exchange,
                start,
                end,
                nativeInterval,
                currency,
                volumeMeaning,
                priceBasis,
                adjustment,
                negativePrices,
              ])
              void act(key, (body) =>
                dataLibrary.createDownload({
                  ...body,
                  context: datasetRequestContext({
                    ...emptyDatasetContext(),
                    provider: capability.provider ?? '',
                    symbol,
                    exchange,
                    interval: nativeInterval,
                    currency,
                    volumeMeaning,
                    priceBasis,
                    adjustment,
                    allowNegativePrices: negativePrices,
                  }),
                  mapping: emptyDatasetMapping(),
                  startAt: start,
                  endAt: end,
                })
              )
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="download-symbol">Symbol</Label>
              <Input
                id="download-symbol"
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="download-exchange">Exchange</Label>
              <Input
                id="download-exchange"
                value={exchange}
                onChange={(event) => setExchange(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="download-start">Start (UTC ISO)</Label>
              <Input
                id="download-start"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                placeholder="2026-11-01T00:00:00Z"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="download-end">End (UTC ISO)</Label>
              <Input
                id="download-end"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                placeholder="2026-11-02T00:00:00Z"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="download-interval">Native interval</Label>
              <select
                id="download-interval"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={nativeInterval}
                onChange={(event) => setInterval(event.target.value)}
              >
                {(capability.intervals ?? ['1m', 'D']).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="download-currency">Instrument currency / asset code</Label>
              <Input
                id="download-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                placeholder="Declare native currency"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="download-volume">Provider volume meaning</Label>
              <select
                id="download-volume"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={volumeMeaning}
                onChange={(event) =>
                  setVolumeMeaning(event.target.value as DatasetContext['volumeMeaning'])
                }
              >
                {['unknown', 'units', 'contracts', 'ticks', 'currency'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="download-basis">Declared price basis</Label>
              <select
                id="download-basis"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={priceBasis}
                onChange={(event) =>
                  setPriceBasis(event.target.value as DatasetContext['priceBasis'])
                }
              >
                <option value="raw">Raw</option>
                <option value="split_adjusted">Split adjusted</option>
                <option value="total_return">Total return</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="download-adjustment">Adjustment description</Label>
              <Input
                id="download-adjustment"
                value={adjustment}
                onChange={(event) => setAdjustment(event.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={negativePrices}
                onChange={(event) => setNegativePrices(event.target.checked)}
              />
              This instrument permits negative prices
            </label>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Verify the provider’s price and volume conventions. Candles are stored as reported,
              with an unknown session calendar; this request performs no price adjustment or
              currency conversion.
            </p>
            <Button disabled={busy} type="submit">
              Create history download
            </Button>
          </form>
        )}
        {!jobs.length && (
          <p className="text-sm text-muted-foreground">No saved download jobs yet.</p>
        )}
        {jobs.map((job) => (
          <section key={job.id} className="space-y-3 rounded border p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {String(
                  (job.context as { symbol?: string } | undefined)?.symbol ?? 'History download'
                )}
              </h3>
              <Badge variant="outline">{job.status}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Saved progress: {String(job.cursor ?? 'not started')} · attempts{' '}
              {String(job.attempt ?? 0)}
              {job.nextAttemptAt ? ` · next eligible retry ${String(job.nextAttemptAt)}` : ''}
            </p>
            {job.error != null && (
              <p className="text-sm">
                {typeof job.error === 'object'
                  ? 'The provider chunk did not finish. Its checkpoint is retained; review the connection and retry when eligible.'
                  : String(job.error)}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={
                  busy || ['completed', 'cancelled', 'paused', 'failed'].includes(job.status)
                }
                onClick={() =>
                  void act(`${job.id}:step`, (body) =>
                    dataLibrary.stepDownload(job.id, body.expectedRevision, body.requestId)
                  )
                }
              >
                Process next chunk
              </Button>
              {(['pause', 'resume', 'cancel', 'retry'] as const).map((command) => (
                <Button
                  key={command}
                  variant="outline"
                  disabled={
                    busy ||
                    !(command === 'pause'
                      ? ['queued', 'running', 'retry-wait'].includes(job.status)
                      : command === 'resume'
                        ? job.status === 'paused'
                        : command === 'retry'
                          ? job.status === 'failed'
                          : !['completed', 'cancelled'].includes(job.status))
                  }
                  onClick={() =>
                    void act(`${job.id}:${command}`, (body) =>
                      dataLibrary.controlDownload(
                        job.id,
                        body.expectedRevision,
                        body.requestId,
                        command
                      )
                    )
                  }
                >
                  {command[0].toUpperCase() + command.slice(1)}
                </Button>
              ))}
            </div>
          </section>
        ))}
        <p className="text-xs text-muted-foreground">
          Processing is explicit and bounded to one chunk. Keep/retry/pause state survives app
          restart; this screen does not claim an always-running collector. Existing global provider
          tools remain separate.
        </p>
      </CardContent>
    </Card>
  )
}
export default function DataLibrary() {
  const principalId = useAuthStore((state) => state.localPrincipalId)
  const [params, setParams] = useSearchParams()
  const returnTo = libraryReturn(params.get('returnTo'))
  const [tab, setTab] = useState(params.get('source') === 'kraken' ? 'public' : 'catalog')
  const requestedSource = params.get('source')
  useEffect(() => {
    if (requestedSource === 'kraken') setTab('public')
  }, [requestedSource])
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const [resume, setResume] = useState<string>()
  const [bundleResume, setBundleResume] = useState<string>()
  const [moreBusy, setMoreBusy] = useState(false)
  const [moreError, setMoreError] = useState('')
  const queryClient = useQueryClient()
  const key = ['private-data-library', principalId]
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const value = await dataLibrary.catalog(signal)
      if (value.principalId !== principalId)
        throw new DatasetError(
          'datasets.owner_changed',
          'The local account changed. Reopen its saved-history library.'
        )
      return value
    },
    enabled: !!principalId,
    refetchOnWindowFocus: false,
  })
  const catalog = query.data
  const requestedVersion = params.get('version')
  const detailQuery = useQuery({
    queryKey: ['private-dataset-version', principalId, requestedVersion],
    queryFn: ({ signal }) => dataLibrary.version(requestedVersion!, signal),
    enabled:
      !!principalId &&
      !!requestedVersion &&
      !!catalog &&
      !catalog.versions.some((version) => version.id === requestedVersion),
    refetchOnWindowFocus: false,
  })
  const selected =
    catalog?.versions.find((version) => version.id === requestedVersion) ?? detailQuery.data
  const rows =
    catalog?.versions.filter(
      (version) =>
        (archived || !version.archivedAt) &&
        [
          version.name,
          version.metadata.symbol,
          version.metadata.exchange,
          version.metadata.provider,
        ].some((value) => value.toLowerCase().includes(search.toLowerCase()))
    ) ?? []
  function received(next: DatasetCatalog, version?: DatasetVersion) {
    if (next.principalId !== principalId)
      throw new DatasetError(
        'datasets.owner_changed',
        'The local account changed. Refresh the library.'
      )
    queryClient.setQueryData(key, next)
    if (version)
      queryClient.setQueryData(['private-dataset-version', principalId, version.id], version)
  }
  async function more() {
    if (!catalog || catalog.nextOffset == null) return
    setMoreBusy(true)
    setMoreError('')
    try {
      const next = await dataLibrary.catalog(undefined, catalog.nextOffset)
      if (next.principalId !== principalId || next.revision !== catalog.revision)
        throw new DatasetError(
          'datasets.catalog_changed',
          'The catalog changed while paging. Refresh to read a consistent catalog.'
        )
      const all = new Map(catalog.versions.map((version) => [version.id, version]))
      for (const version of next.versions) all.set(version.id, version)
      received({ ...next, versions: [...all.values()] })
    } catch (cause) {
      setMoreError(cause instanceof Error ? cause.message : 'More versions could not be read.')
    } finally {
      setMoreBusy(false)
    }
  }
  function open(version: DatasetVersion) {
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('version', version.id)
      return next
    })
    setTab('catalog')
  }
  return (
    <>
      <Navbar fluid />
      <main className="flex-1 overflow-auto bg-background">
        <div className="border-b bg-card/50 px-4 py-3">
          <SettingsBackLink />
          <ConnectionsDataNavigation active="history" />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Database className="h-6 w-6" />
              <div>
                <h1 className="text-xl font-semibold">History & data</h1>
                <p className="text-sm text-muted-foreground">
                  Saved market history · versions, quality and charts
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link to={returnTo}>
                  <ArrowLeft className="h-4 w-4" />
                  {returnTo.split('?')[0].endsWith('/connections')
                    ? 'Return to connections'
                    : 'Return to workspace'}
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/historify/provider-tools">Connected provider tools</Link>
              </Button>
              <Button
                variant="outline"
                disabled={query.isFetching || !principalId}
                onClick={() => void query.refetch()}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-7xl space-y-5 p-4">
          {!principalId ? (
            <Card>
              <CardHeader>
                <CardTitle>Open your local Data Library</CardTitle>
                <CardDescription>
                  Open workspace access to import and read saved historical data. Personal mode
                  opens locally; shared installations require sign-in. No broker is required.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link
                    to={`/login?${new URLSearchParams({ purpose: 'local', next: `/historify${window.location.search}` })}`}
                  >
                    Open workspace access
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <nav aria-label="Data Library sections" className="flex flex-wrap gap-2">
                {[
                  ['catalog', 'Datasets'],
                  ['import', 'Import history'],
                  ['public', 'Public market data'],
                  ['downloads', 'Downloads'],
                  ['recovery', 'Dataset backups'],
                ].map(([id, label]) => (
                  <Button
                    key={id}
                    variant={tab === id ? 'default' : 'outline'}
                    onClick={() => {
                      setTab(id)
                      if (id === 'import') setResume(undefined)
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </nav>
              {query.isPending && (
                <output className="block text-sm">Reading saved dataset versions…</output>
              )}
              {query.error && (
                <div role="alert" className="rounded border border-destructive p-3 text-sm">
                  <p>
                    {query.error instanceof Error
                      ? query.error.message
                      : 'Saved datasets could not be read.'}
                  </p>
                  {query.error instanceof DatasetError && query.error.status === 401 && (
                    <Link className="underline" to="/login?purpose=local&next=/historify">
                      Reopen workspace access
                    </Link>
                  )}
                </div>
              )}
              {catalog && (
                <>
                  {tab === 'catalog' && (
                    <>
                      <Card>
                        <CardHeader>
                          <CardTitle>Saved datasets</CardTitle>
                          <CardDescription>
                            Each row is one immutable version. Same-symbol data from different
                            sources stays separate.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="flex flex-wrap items-center gap-3">
                            <Input
                              className="max-w-md"
                              aria-label="Search dataset versions"
                              value={search}
                              onChange={(event) => setSearch(event.target.value)}
                              placeholder="Search name, symbol, exchange or source"
                            />
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={archived}
                                onChange={(event) => setArchived(event.target.checked)}
                              />
                              Show archived versions
                            </label>
                            <span className="text-xs text-muted-foreground">
                              {rows.length} versions shown
                            </span>
                          </div>
                          {rows.length ? (
                            <div className="overflow-auto">
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="border-b">
                                    <th className="p-2">Dataset / source</th>
                                    <th className="p-2">Interval</th>
                                    <th className="p-2">Candles</th>
                                    <th className="p-2">Coverage</th>
                                    <th className="p-2">Local size</th>
                                    <th className="p-2">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((version) => (
                                    <tr key={version.id} className="border-b">
                                      <td className="p-2">
                                        <strong>{version.name || version.metadata.symbol}</strong>
                                        <div className="text-xs text-muted-foreground">
                                          {version.metadata.symbol} · {version.metadata.exchange} ·{' '}
                                          {version.metadata.provider}
                                        </div>
                                        {version.archivedAt && (
                                          <Badge variant="secondary">Archived</Badge>
                                        )}
                                        {version.quarantine && (
                                          <Badge variant="secondary">
                                            Time verification required
                                          </Badge>
                                        )}
                                      </td>
                                      <td className="p-2">{version.metadata.interval}</td>
                                      <td className="p-2">{version.rowCount.toLocaleString()}</td>
                                      <td className="p-2 text-xs">
                                        {version.quarantine
                                          ? 'Time unverified'
                                          : utcDate(version.start)}
                                        <br />
                                        {version.quarantine
                                          ? 'Open version for recovery'
                                          : utcDate(version.end)}
                                      </td>
                                      <td className="p-2">{size(version.sizeBytes)}</td>
                                      <td className="p-2">
                                        <Button variant="outline" onClick={() => open(version)}>
                                          Open version
                                        </Button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="space-y-2 rounded border p-4">
                              <h3 className="font-semibold">
                                {catalog.versions.length
                                  ? 'No dataset versions match these filters'
                                  : 'Your saved-history library is ready'}
                              </h3>
                              <p className="text-sm text-muted-foreground">
                                {catalog.versions.length
                                  ? 'Clear the search or include archived versions.'
                                  : 'Import market-history CSV or choose Public market data to review and save your first version. Existing connected-provider tools remain available separately.'}
                              </p>
                              <Button onClick={() => setTab('import')}>Import history CSV</Button>
                            </div>
                          )}
                          {catalog.nextOffset != null && (
                            <Button
                              variant="outline"
                              disabled={moreBusy}
                              onClick={() => void more()}
                            >
                              {moreBusy ? 'Reading more…' : 'Load more versions'}
                            </Button>
                          )}
                          {moreError && (
                            <p role="alert" className="text-sm text-destructive">
                              {moreError}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                      {selected && (
                        <VersionDetail
                          key={selected.id}
                          version={selected}
                          catalog={catalog}
                          returnTo={returnTo}
                          onCatalog={received}
                        />
                      )}
                      {requestedVersion && detailQuery.isFetching && !selected && (
                        <output className="block text-sm">Reading the requested version…</output>
                      )}
                      {requestedVersion && detailQuery.error && !selected && (
                        <p role="alert" className="text-sm text-destructive">
                          {detailQuery.error instanceof Error
                            ? detailQuery.error.message
                            : 'The requested version is unavailable.'}
                        </p>
                      )}
                      {!!catalog.jobs.filter(
                        (job) =>
                          !job.kind?.includes('download') &&
                          !job.kind?.includes('bundle') &&
                          !['completed', 'cancelled'].includes(job.status)
                      ).length && (
                        <Card>
                          <CardHeader>
                            <CardTitle>Retained import reviews</CardTitle>
                            <CardDescription>
                              Reopen a staged source or re-preview it after the catalog changes.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {catalog.jobs
                              .filter(
                                (job) =>
                                  !job.kind?.includes('download') &&
                                  !job.kind?.includes('bundle') &&
                                  !['completed', 'cancelled'].includes(job.status)
                              )
                              .map((job) => (
                                <div
                                  key={job.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
                                >
                                  <span className="text-sm">
                                    {job.createdAt ?? 'Retained review'} · {job.status}
                                  </span>
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      setResume(job.id)
                                      setTab('import')
                                    }}
                                  >
                                    Resume import review
                                  </Button>
                                </div>
                              ))}
                          </CardContent>
                        </Card>
                      )}
                    </>
                  )}
                  {tab === 'import' && (
                    <DataLibraryImport
                      key={`${principalId}:${resume ?? 'draft'}`}
                      principalId={principalId}
                      catalog={catalog}
                      resumeId={resume}
                      onCatalog={received}
                      onVersion={open}
                      onNewImport={() => setResume(undefined)}
                    />
                  )}
                  {tab === 'public' && (
                    <div className="space-y-4">
                      <DataLibraryPublicSource
                        key={principalId}
                        principalId={principalId}
                        revision={catalog.revision}
                        onPreview={(preview) => {
                          setResume(preview.id)
                          setTab('import')
                        }}
                      />
                      <DataLibraryFeedSource
                        key={`feed-${principalId}`}
                        principalId={principalId}
                        revision={catalog.revision}
                        onPreview={(preview) => {
                          setResume(preview.id)
                          setTab('import')
                        }}
                      />
                    </div>
                  )}
                  {tab === 'downloads' && <DownloadJobs catalog={catalog} onCatalog={received} />}
                  {tab === 'recovery' && (
                    <DataLibraryRecovery
                      key={`${principalId}:${bundleResume ?? 'draft'}`}
                      principalId={principalId}
                      catalog={catalog}
                      resumeId={bundleResume}
                      onCatalog={received}
                      onVersion={open}
                    />
                  )}
                  {tab === 'catalog' &&
                    catalog.jobs
                      .filter(
                        (job) =>
                          job.kind?.includes('bundle') &&
                          !['completed', 'cancelled'].includes(job.status)
                      )
                      .map((job) => (
                        <div
                          key={job.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"
                        >
                          <span className="text-sm">
                            Retained dataset backup review · {job.status}
                          </span>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setBundleResume(job.id)
                              setTab('recovery')
                            }}
                          >
                            Resume backup review
                          </Button>
                        </div>
                      ))}
                </>
              )}
            </>
          )}
        </div>
      </main>
    </>
  )
}
