import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { DatasetError, type DatasetVersion, dataLibrary } from '@/api/dataLibrary'
import { ChartGrid, ChartLayoutPicker } from '@/components/chart/ChartGrid'
import { HistorifyChartPane, type PaneState } from '@/components/historify/HistorifyChartPane'
import { Navbar } from '@/components/layout/Navbar'
import { Button } from '@/components/ui/button'
import { createDatasetVersionFeed } from '@/lib/chart/feeds/datasetVersionFeed'
import { layoutById } from '@/lib/chart/layouts'
import type { CatalogSymbol } from '@/lib/historify/catalog'
import { libraryReturn } from '@/lib/historify/dataLibraryNavigation'
import { useAuthStore } from '@/stores/authStore'

export function datasetSymbol(version: DatasetVersion): CatalogSymbol {
  const coverage = version.coverage as { volumeUnknownRows?: number } | undefined
  return {
    symbol: version.metadata.symbol,
    exchange: version.metadata.exchange,
    name: `${version.name || version.metadata.symbol} · ${version.metadata.provider}`,
    sources: new Set(),
    nativeIntervals: [version.metadata.interval],
    nativeLastAt: version.end,
    nativeVolumeAvailable:
      version.metadata.volumeMeaning !== 'unknown' && coverage?.volumeUnknownRows === 0,
    lastBySource: {},
    records: version.rowCount,
  }
}
function LoadedDatasetChart({
  version,
  returnTo,
  principalId,
}: {
  version: DatasetVersion
  returnTo: string
  principalId: string
}) {
  const [layoutId, setLayoutId] = useState('single')
  const [states, setStates] = useState<Record<number, PaneState>>({})
  const [focused, setFocused] = useState(0)
  const feed = useMemo(() => createDatasetVersionFeed(version), [version])
  const lifecycle = useRef<{ feed: typeof feed; token: object } | null>(null)
  useEffect(() => {
    const token = {}
    lifecycle.current = { feed, token }
    return () =>
      queueMicrotask(() => {
        // StrictMode replays an effect against the same live feed before this microtask.
        if (lifecycle.current?.feed !== feed || lifecycle.current?.token === token) feed.dispose()
      })
  }, [feed])
  const symbols = useMemo(() => [datasetSymbol(version)], [version])
  const blank: PaneState = {
    symbol: version.metadata.symbol,
    exchange: version.metadata.exchange,
    interval: version.metadata.interval,
    chartType: 'candlestick',
  }
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2 text-xs">
        <Button asChild variant="outline" size="sm">
          <Link to={returnTo}>
            <ArrowLeft className="h-4 w-4" />
            {returnTo.startsWith('/historify') ? 'Back to Data Library' : 'Return to workspace'}
          </Link>
        </Button>
        <span>
          {version.name || version.metadata.symbol} · {version.metadata.provider} · native{' '}
          {version.metadata.interval} · {version.rowCount.toLocaleString()} candles
        </span>
        <span className="text-muted-foreground">
          Saved version · read-only history · no live feed
        </span>
        {version.archivedAt && <span>Archived version retained for its saved references</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChartGrid
          preset={layoutById(layoutId)}
          renderPane={(paneId, index) => (
            <HistorifyChartPane
              paneId={paneId}
              feed={feed}
              symbols={symbols}
              state={states[index] ?? blank}
              onChange={(next) =>
                setStates((value) => ({
                  ...value,
                  [index]: {
                    ...(value[index] ?? blank),
                    ...next,
                    symbol: version.metadata.symbol,
                    exchange: version.metadata.exchange,
                    interval: version.metadata.interval,
                  },
                }))
              }
              focused={focused === index}
              onFocus={() => setFocused(index)}
              loading={false}
              canSelectInterval={(interval) => interval === version.metadata.interval}
              persistKey={`private-dataset:${principalId}:${version.id}:pane:${index}`}
              defaultTimezone={version.metadata.calendar.timezone || 'UTC'}
              pageControls={
                index === 0 ? (
                  <ChartLayoutPicker
                    layoutId={layoutId}
                    onChange={setLayoutId}
                    className="h-7 w-7 shrink-0"
                  />
                ) : undefined
              }
            />
          )}
        />
      </div>
    </>
  )
}
export default function DatasetVersionChart({
  versionId,
  rawReturn,
}: {
  versionId: string
  rawReturn: string | null
}) {
  const principalId = useAuthStore((state) => state.localPrincipalId)
  const returnTo = (() => {
    if (rawReturn?.startsWith('/historify?') && !rawReturn.includes('\\')) {
      try {
        const url = new URL(rawReturn, 'http://local.invalid')
        if (url.origin === 'http://local.invalid' && url.pathname === '/historify') {
          const params = new URLSearchParams({
            version: versionId,
            returnTo: libraryReturn(url.searchParams.get('returnTo')),
          })
          return `/historify?${params}`
        }
      } catch {
        /* use known local fallback */
      }
    }
    return libraryReturn(rawReturn)
  })()
  const query = useQuery({
    queryKey: ['private-dataset-version', principalId, versionId],
    queryFn: ({ signal }) => dataLibrary.version(versionId, signal),
    enabled: !!principalId,
    refetchOnWindowFocus: false,
  })
  return (
    <>
      <Navbar fluid />
      {!principalId ? (
        <div className="space-y-3 p-6">
          <h1 className="text-lg font-semibold">Open saved dataset</h1>
          <p>Open workspace access to read this saved version. No broker is required.</p>
          <Button asChild>
            <Link
              to={`/login?${new URLSearchParams({ purpose: 'local', next: `/historify/charts?${new URLSearchParams({ datasetVersionId: versionId, returnTo })}` })}`}
            >
              Open workspace access
            </Link>
          </Button>
        </div>
      ) : query.isPending ? (
        <output className="block p-6">Reading saved version…</output>
      ) : query.error ? (
        <div role="alert" className="space-y-3 p-6">
          <p>
            {query.error instanceof DatasetError
              ? query.error.message
              : 'This version could not be read. Open it from Data Library to check availability.'}
          </p>
          <Button asChild variant="outline">
            <Link to={returnTo}>Back to Data Library</Link>
          </Button>
        </div>
      ) : query.data ? (
        <LoadedDatasetChart
          key={`${principalId}:${versionId}`}
          version={query.data}
          returnTo={returnTo}
          principalId={principalId}
        />
      ) : null}
    </>
  )
}
