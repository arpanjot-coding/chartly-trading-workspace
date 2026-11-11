import { Database } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { type MarketSymbol, type Mt5ProfileScope, marketData } from '@/api/marketData'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { liveFeedExchange, liveFeedIntervals, platformSymbol } from '@/lib/chart/feeds/platformFeed'
import { MARKET_CHART_PROVIDERS, marketProvider } from '@/lib/chart/marketProviders'
import type { ProfileChartSource } from '@/lib/trader/db'
import type { ResolvedChartContext } from '@/lib/trading/chartContext'
import { type DatasetSourceChoice, datasetSourceChoices } from '@/lib/trading/chartSource'
import type { PreservedChartSetup } from '@/lib/trading/chartWorkspaceRecovery'

export type LiveFeedSourceChoice = Extract<ProfileChartSource, { kind: 'live-feed' }>
export type ChartSourceSelection = DatasetSourceChoice | LiveFeedSourceChoice | null

export function ChartContextControls({
  context,
  mt5Profile,
  onSelect,
  onRemember,
  onCopyLegacy,
  openRequest = 0,
  preserved = [],
  onRecover,
  canBindRun = false,
}: {
  context: ResolvedChartContext
  mt5Profile?: Mt5ProfileScope | null
  onSelect(choice: ChartSourceSelection): Promise<void>
  onRemember?(): Promise<void>
  onCopyLegacy?(): Promise<void>
  openRequest?: number
  preserved?: PreservedChartSetup[]
  onRecover?(key: string): Promise<void>
  canBindRun?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [choices, setChoices] = useState<DatasetSourceChoice[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [liveProviderId, setLiveProviderId] = useState(
    () =>
      MARKET_CHART_PROVIDERS.find(
        ({ id }) =>
          id === (context.liveFeed?.providerId ?? context.profile?.liveSetup?.account.providerId)
      )?.id ?? MARKET_CHART_PROVIDERS[0].id
  )
  const [liveSymbol, setLiveSymbol] = useState(
    () =>
      context.liveFeed?.symbol ??
      context.profile?.defaultSymbol ??
      (marketProvider(liveProviderId) ?? MARKET_CHART_PROVIDERS[0]).exampleSymbol
  )
  const [liveInterval, setLiveInterval] = useState(() => {
    const intervals = liveFeedIntervals(liveProviderId)
    const interval = context.liveFeed?.interval ?? context.profile?.defaultTimeframe ?? '15m'
    return intervals.includes(interval) ? interval : intervals[0]
  })
  useEffect(() => {
    if (openRequest) setOpen(true)
  }, [openRequest])
  const [liveSymbols, setLiveSymbols] = useState<MarketSymbol[]>([])
  const [liveCatalogError, setLiveCatalogError] = useState('')
  const mt5OriginId = mt5Profile?.originId
  const mt5ProfileId = mt5Profile?.profileId
  // Venue-native symbol list for the live feed: typing "GBP USD" finds
  // the broker's exact GBPUSDm / GBPUSD.pro (MT5) or the venue's own
  // BTCUSDT / BTC-USD spelling instead of guessing one it does not use.
  useEffect(() => {
    setLiveSymbols([])
    setLiveCatalogError('')
    if (!open) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void marketData
        .symbols(
          {
            provider: liveProviderId,
            q: liveSymbol.trim(),
            limit: 12,
            ...(liveProviderId === 'mt5' && mt5OriginId && mt5ProfileId
              ? { mt5Profile: { originId: mt5OriginId, profileId: mt5ProfileId } }
              : {}),
          },
          context.principal,
          controller.signal
        )
        .then((result) => {
          if (!controller.signal.aborted) setLiveSymbols(result.symbols)
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setLiveCatalogError(
              cause instanceof Error ? cause.message : 'Venue symbols could not be loaded.'
            )
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, liveProviderId, liveSymbol, context.principal, mt5OriginId, mt5ProfileId])
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refresh button deliberately rechecks source availability
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setChoices([])
    void datasetSourceChoices(context.principal, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setChoices(value)
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Saved sources could not be loaded. Open Data Library.'
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [open, context.principal, retry])
  async function act(operation: () => Promise<void>, message?: string) {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
      if (message) setNotice(message)
      else setOpen(false)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'This chart action could not be completed. Your previous view is retained.'
      )
    } finally {
      setBusy(false)
    }
  }
  const liveOption = marketProvider(liveProviderId) ?? MARKET_CHART_PROVIDERS[0]
  const nativeLiveSymbol = platformSymbol(liveProviderId, liveSymbol)
  const canUseLiveFeed = context.profile?.kind === 'live' && !context.run && !context.evidence
  const sourceLabel = context.dataset
    ? context.dataset.metadata.provider
    : context.liveFeed
      ? `Live · ${context.liveFeed.providerName}`
      : context.source === 'missing'
        ? 'Choose chart data'
        : 'Legacy connected stream'
  const results = choices
    .filter((choice) =>
      `${choice.name} ${choice.symbol} ${choice.exchange} ${choice.providerId}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase())
    )
    .slice(0, 100)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 max-w-48 shrink-0 gap-1.5 px-2 text-xs text-foreground/85 max-sm:size-8 max-sm:px-0"
          aria-label="Chart data source"
          title={sourceLabel}
        >
          <Database className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="hidden truncate sm:inline">{sourceLabel}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Chart data source</DialogTitle>
          <DialogDescription>
            {context.profile ? `${context.profile.name} · ` : ''}Live platform candles and saved
            replay history are separate choices. This does not connect trade execution.
          </DialogDescription>
        </DialogHeader>
        {context.run && !canBindRun && (
          <p className="text-sm">
            {context.run.datasetVersionId
              ? 'This run is pinned to its saved dataset and window.'
              : 'This retained run has recorded trades or is no longer an empty Draft.'}{' '}
            To use another source, prepare a separate run in its replay project.
          </p>
        )}
        {context.run && canBindRun && (
          <p className="text-sm">
            Choose the first saved source for this empty Draft. Symbol and native interval must
            match; this does not create simulated fills or change its status.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && <output className="text-sm">{notice}</output>}
        {canUseLiveFeed && (
          <section className="space-y-3 border p-3" aria-label="Live platform feed">
            <div>
              <h3 className="text-sm font-medium">Live platform feed</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Main live chart source. Reads recent candles directly from the selected platform; it
                does not place trades or rewrite saved replay history.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="chart-live-provider">Platform feed</Label>
                <select
                  id="chart-live-provider"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={liveProviderId}
                  disabled={busy}
                  onChange={(event) => {
                    const next = MARKET_CHART_PROVIDERS.find(
                      (provider) => provider.id === event.target.value
                    )
                    if (!next) return
                    setLiveProviderId(next.id)
                    setLiveSymbol(next.exampleSymbol)
                    if (!liveFeedIntervals(next.id).includes(liveInterval)) setLiveInterval('1h')
                  }}
                >
                  {MARKET_CHART_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="chart-live-symbol">Venue symbol</Label>
                <Input
                  id="chart-live-symbol"
                  value={liveSymbol}
                  maxLength={liveOption.symbolFormat === 'mt5-native' ? 80 : 24}
                  disabled={busy}
                  onChange={(event) => setLiveSymbol(event.target.value)}
                />
                {liveCatalogError && (
                  <output className="text-xs text-muted-foreground">{liveCatalogError}</output>
                )}
                {liveSymbols.length > 0 && (
                  <fieldset className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                    <legend className="sr-only">Venue symbols</legend>
                    {liveSymbols.map((row) => (
                      <button
                        key={row.symbol}
                        type="button"
                        className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-accent"
                        title={row.name}
                        onClick={() => setLiveSymbol(row.symbol)}
                      >
                        {row.symbol}
                      </button>
                    ))}
                  </fieldset>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="chart-live-interval">Timeframe</Label>
                <select
                  id="chart-live-interval"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={liveInterval}
                  disabled={busy}
                  onChange={(event) => setLiveInterval(event.target.value)}
                >
                  {liveFeedIntervals(liveProviderId).map((interval) => (
                    <option key={interval} value={interval}>
                      {interval}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={busy || !nativeLiveSymbol}
                onClick={() => {
                  if (!nativeLiveSymbol) return
                  void act(() =>
                    onSelect({
                      kind: 'live-feed',
                      providerId: liveProviderId,
                      providerName: liveOption.label,
                      symbol: nativeLiveSymbol,
                      exchange: liveFeedExchange(liveProviderId),
                      interval: liveInterval,
                    })
                  )
                }}
              >
                Use live feed
              </Button>
              <span className="text-xs text-muted-foreground">
                Recent window up to 1,000 candles, refreshed every few seconds.
                {liveOption.credentials === 'terminal-session'
                  ? mt5Profile
                    ? ' Verify and link a running MT5 account in this profile’s Connections. Chart times use the terminal clock.'
                    : ' MT5 must be running and signed in. Chart times use the terminal clock.'
                  : ''}
              </span>
            </div>
          </section>
        )}
        {!context.run && (
          <div className="space-y-1">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void act(() => onSelect(null))}
            >
              {context.trade || context.evidence
                ? 'Use legacy connected prices for current analysis'
                : 'Use legacy connected stream'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Advanced legacy transport only; it uses Chartly&apos;s websocket API key, not a
              platform feed.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link
              to={`/historify?${new URLSearchParams({ returnTo: context.profile?.id ? `/workspace/profiles/${context.profile.id}${context.run ? '/replay' : ''}` : '/workspace' })}`}
            >
              Import or review saved history
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/settings/connections">Platform accounts</Link>
          </Button>
        </div>
        <Input
          aria-label="Find saved chart sources"
          placeholder="Find symbol, venue, provider or dataset"
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 256))}
        />
        {loading ? (
          <output>Reading your saved sources…</output>
        ) : results.length ? (
          <div className="space-y-2">
            {results.map((choice) => (
              <div
                key={choice.id}
                className="flex items-center justify-between gap-3 rounded border p-3 text-sm"
              >
                <div>
                  <div className="font-medium">{choice.name}</div>
                  <div>
                    {choice.exchange}:{choice.symbol} · {choice.providerId} · native{' '}
                    {choice.interval}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(choice.from * 1000).toISOString()} →{' '}
                    {new Date(choice.to * 1000).toISOString()} · {choice.id}
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={
                    busy ||
                    (!!context.trade && choice.symbol !== context.trade.pair) ||
                    (!!context.run &&
                      (!canBindRun ||
                        choice.symbol !== context.run.symbol ||
                        choice.interval !== context.run.timeframe))
                  }
                  onClick={() => void act(() => onSelect(choice))}
                >
                  Use source
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm">
            {query
              ? 'No matching saved source. Try another symbol or import history.'
              : 'No saved source yet. Import candle history in Data Library.'}
          </p>
        )}
        <Button
          variant="ghost"
          disabled={loading || busy}
          onClick={() => setRetry((value) => value + 1)}
        >
          Refresh sources
        </Button>
        {onRemember && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act(
                onRemember,
                'Chart cursor remembered. Reopening this profile or run restores this view; no simulation account was changed.'
              )
            }
          >
            Remember chart cursor
          </Button>
        )}
        {onCopyLegacy && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void act(
                onCopyLegacy,
                'The original workspace was copied into this environment. The original remains unchanged.'
              )
            }
          >
            Copy original active chart setup
          </Button>
        )}
        {!!preserved.length && onRecover && (
          <section aria-label="Preserved chart setups" className="space-y-2 border-t pt-3">
            <h3 className="text-sm font-medium">Preserved chart setups</h3>
            <p className="text-xs text-muted-foreground">
              These setups belong to this restored workspace. Restore a matching saved-dataset setup
              with its drawings, or copy another setup as a template with drawings and alerts
              cleared. Original namespaces remain preserved. Up to 100 setups are shown.
            </p>
            {preserved.map((setup) => (
              <div
                key={setup.key}
                className="flex items-center justify-between gap-3 rounded border p-2 text-sm"
              >
                <div>
                  {setup.name}
                  <div className="text-xs text-muted-foreground">
                    {setup.sameSource
                      ? 'Matching profile/run and verified saved dataset'
                      : 'Different or unverified source · configuration template only'}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => onRecover(setup.key),
                      'Preserved setup copied into this chart environment. The original remains available in Storage & recovery.'
                    )
                  }
                >
                  {setup.sameSource ? 'Restore preserved setup' : 'Copy as template'}
                </Button>
              </div>
            ))}
          </section>
        )}
        <p className="text-xs text-muted-foreground">
          Named chart workspaces and studies stay in this environment/source. Export and import a
          workspace to share configuration deliberately. Copy/import keeps the selected data source
          and native interval, removes active alerts/comparisons, and clears copied drawings because
          the original configuration does not prove source/economic identity. Applicable indicator
          settings remain templates; unavailable inputs stay unavailable. It never permits account
          orders.
        </p>
      </DialogContent>
    </Dialog>
  )
}
