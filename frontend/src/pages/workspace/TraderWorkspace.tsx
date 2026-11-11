import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Brain,
  CandlestickChart,
  CheckCircle2,
  History,
  Plus,
  RadioTower,
  ShieldCheck,
} from 'lucide-react'
import { type FormEvent, memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { type DatasetPreview, type DatasetVersion, dataLibrary } from '@/api/dataLibrary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { liveFeedExchange, liveFeedIntervals, PlatformFeed } from '@/lib/chart/feeds/platformFeed'
import {
  DEFAULT_MARKET_IMPORT_PROVIDER,
  MARKET_CHART_PROVIDERS,
  MARKET_IMPORT_PROVIDERS,
  marketHistoryParameters,
  marketImportLabel,
  marketProvider,
  marketSymbol,
} from '@/lib/chart/marketProviders'
import { datasetLibraryHref } from '@/lib/historify/dataLibraryNavigation'
import { type ConnectorProvider, connectorClient } from '@/lib/trader/connectorClient'
import type {
  JournalTrade,
  LiveProfileSetup,
  TraderPortfolio,
  TradingProfileKind,
} from '@/lib/trader/db'
import { formatMoney, summarizeCombinedProfiles, summarizePortfolio } from '@/lib/trader/metrics'
import { validPaperStartingCash as validPaperCash } from '@/lib/trader/paperCash'
import { useTraderData } from '@/lib/trader/useTraderData'
import { PublicSourceDetails } from '@/pages/historify/DataLibraryPublicSource'
import { chartStorageAccount, useAuthStore } from '@/stores/authStore'
import { chartHref, dateLabel, pnlTone, profileHref } from './ProfileShell'

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
const currencies = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'CAD',
  'CHF',
  'INR',
  'USDT',
  'USDC',
  'BTC',
  'ETH',
]
const timezones = [
  'UTC',
  'Europe/London',
  'America/New_York',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Australia/Sydney',
]
const timeframes = ['1m', '5m', '15m', '1h', '4h', '1D']
const sessionPresets = ['London', 'New York', 'Asia', 'London / New York overlap']
const tags = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  ),
]
const validCurrency = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z][A-Z0-9]{2,11}$/.test(value)

type AccountMode = LiveProfileSetup['account']['mode']
type ChartDataMode = LiveProfileSetup['chartData']['mode']
type AccountProviderChoice = Pick<
  ConnectorProvider,
  'id' | 'name' | 'category' | 'available' | 'setupState' | 'connectionMode'
>
const accountCategories = [
  ['desktop', 'Desktop platforms'],
  ['crypto', 'Crypto exchanges'],
  ['brokerage', 'Brokerages'],
] as const
const defaultChartProvider = MARKET_CHART_PROVIDERS[0]
const emptyTrades: JournalTrade[] = []

function countsByProfile(rows: ReadonlyArray<{ portfolioId?: number }>) {
  const counts = new Map<number, number>()
  for (const { portfolioId } of rows) {
    if (portfolioId !== undefined) counts.set(portfolioId, (counts.get(portfolioId) ?? 0) + 1)
  }
  return counts
}

function EquitySparkline({
  startingBalance,
  trades,
}: {
  startingBalance: number
  trades: JournalTrade[]
}) {
  const values = [startingBalance]
  const sorted = [...trades]
    .filter((trade) => trade.result !== 'Open')
    .sort((a, b) => (a.closeDate || a.openDate).localeCompare(b.closeDate || b.openDate))
  if (!sorted.length) {
    return (
      <span className="flex min-h-8 items-center text-xs text-muted-foreground">
        Equity curve appears after the first closed trade
      </span>
    )
  }
  let min = startingBalance
  let max = startingBalance
  for (const trade of sorted) {
    const value = values[values.length - 1] + (trade.netPnl || 0)
    values.push(value)
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  const range = max - min
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100
      const y = range === 0 ? 16 : 29 - ((value - min) / range) * 26
      return `${x},${y}`
    })
    .join(' ')
  const positive = values[values.length - 1] >= startingBalance

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className={`h-10 w-full ${positive ? 'text-teal-600 dark:text-teal-400' : 'text-rose-600 dark:text-rose-400'}`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

const ProfileCard = memo(function ProfileCard({
  portfolio,
  trades,
  sessionCount,
  destinationCount,
}: {
  portfolio: TraderPortfolio
  trades: JournalTrade[]
  sessionCount: number
  destinationCount: number
}) {
  if (!portfolio.id) return null

  const summary = portfolio.kind === 'live' ? summarizePortfolio(portfolio, trades) : null
  const isLive = summary !== null

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-colors hover:border-foreground/20 focus-within:border-foreground/25">
      <Link
        to={profileHref(portfolio.id)}
        className="block flex-1 p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block break-words text-base leading-snug font-semibold tracking-tight">
              {portfolio.name}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {portfolio.sessionTags?.join(', ') || portfolio.sessionLabel
                ? `${portfolio.sessionTags?.join(', ') || portfolio.sessionLabel} · `
                : ''}
              {portfolio.currency} · created {dateLabel(portfolio.createdAt)}
            </span>
          </span>
          <Badge
            variant="outline"
            className={
              isLive
                ? 'gap-1.5 border-teal-700/15 bg-teal-600/5 text-teal-800 dark:border-teal-300/20 dark:text-teal-300'
                : 'gap-1.5 bg-muted/40 text-muted-foreground'
            }
          >
            {isLive ? (
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            ) : (
              <History className="size-3" aria-hidden="true" />
            )}
            {isLive ? 'Live' : 'Replay'}
          </Badge>
        </span>

        <span className="mt-4 block">
          <span className="block text-xs font-medium text-muted-foreground">
            {isLive ? 'Journal net P&L' : 'Independent replay runs'}
          </span>
          <span
            className={`mt-0.5 block text-[1.7rem] leading-tight font-semibold tracking-tight tabular-nums ${pnlTone(summary?.netPnl ?? 0)}`}
          >
            {isLive ? formatMoney(summary.netPnl, portfolio.currency) : String(sessionCount)}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {isLive
              ? destinationCount
                ? `${destinationCount} destination${destinationCount === 1 ? '' : 's'} configured · broker sync pending`
                : 'Not connected'
              : 'Review each run’s own capital, costs and results.'}
          </span>
        </span>

        <span className="mt-2.5 block rounded-md bg-[var(--app-surface)] px-2.5">
          {isLive ? (
            <EquitySparkline startingBalance={0} trades={trades} />
          ) : (
            <span className="flex min-h-8 items-center text-xs text-muted-foreground">
              Each run keeps its own equity curve
            </span>
          )}
        </span>

        <span className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 xl:grid-cols-4">
          {(isLive
            ? [
                ['Destinations', String(destinationCount)],
                ['Win rate', `${summary.winRate.toFixed(0)}%`],
                ['Closed trades', String(summary.closedTrades)],
                ['Drawdown', formatMoney(summary.maxDrawdownCurrency, portfolio.currency)],
              ]
            : [
                ['Runs', String(sessionCount)],
                ['Journal positions', String(trades.length)],
                ['Reporting', 'Per run'],
                ['Capital', 'Independent'],
              ]
          ).map(([label, value]) => (
            <span key={label} className="min-w-0">
              <span className="block break-words text-sm font-semibold tabular-nums">{value}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                {label}
              </span>
            </span>
          ))}
        </span>
      </Link>

      <footer className="flex flex-wrap items-center gap-2 border-t bg-[var(--app-surface)]/60 px-4 py-2.5 sm:px-5">
        <Button asChild size="sm" className="flex-1">
          <Link to={chartHref(portfolio.id, undefined, portfolio)}>
            <CandlestickChart className="h-4 w-4" /> Chart
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="flex-1">
          <Link to={profileHref(portfolio.id, 'journal')}>
            <BookOpenCheck className="h-4 w-4" /> Journal
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost" className="ml-auto">
          <Link to={profileHref(portfolio.id)}>
            Open <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </footer>
    </article>
  )
})

export default function TraderWorkspace() {
  const data = useTraderData()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const principal = useAuthStore((state) => state.localPrincipalId ?? state.user?.username ?? '')
  const storagePrincipal = useAuthStore(chartStorageAccount)
  const ownerKey = `${principal}:${data.workspace?.originId ?? 'browser'}`
  const activeOwner = useRef(ownerKey)
  activeOwner.current = ownerKey
  const [createOpen, setCreateOpen] = useState(false)
  const [createStep, setCreateStep] = useState(1)
  const [kind, setKind] = useState<TradingProfileKind>('live')
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [sessionLabel, setSessionLabel] = useState('')
  const [timezone, setTimezone] = useState('UTC')
  const [strategy, setStrategy] = useState('')
  const [defaultSymbol, setDefaultSymbol] = useState('EURUSD')
  const [defaultTimeframe, setDefaultTimeframe] = useState('15m')
  const [startingBalance, setStartingBalance] = useState('10000')
  const [trackEmotions, setTrackEmotions] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [creationUncertain, setCreationUncertain] = useState(false)
  const [versions, setVersions] = useState<DatasetVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [selectedVersion, setSelectedVersion] = useState<DatasetVersion | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyReviewed, setHistoryReviewed] = useState(false)
  const [catalogRefresh, setCatalogRefresh] = useState(0)
  const [nextHistoryOffset, setNextHistoryOffset] = useState<number | null>(null)
  const [accountMode, setAccountMode] = useState<AccountMode>('connector')
  const [accountProviderId, setAccountProviderId] = useState('mt5')
  const [accountProviders, setAccountProviders] = useState<AccountProviderChoice[]>([])
  const [accountDirectoryStatus, setAccountDirectoryStatus] = useState<
    'loading' | 'ready' | 'unavailable'
  >('loading')
  const [accountDirectoryRetry, setAccountDirectoryRetry] = useState(0)
  const [connectionLabel, setConnectionLabel] = useState('')
  const [chartDataMode, setChartDataMode] = useState<ChartDataMode>('live-feed')
  const [liveProvider, setLiveProvider] = useState(defaultChartProvider.id)
  const [liveSymbol, setLiveSymbol] = useState(defaultChartProvider.exampleSymbol)
  const [liveInterval, setLiveInterval] = useState('15m')
  const [liveTestBusy, setLiveTestBusy] = useState(false)
  const [liveTestMessage, setLiveTestMessage] = useState('')
  const [liveTestOk, setLiveTestOk] = useState(false)
  const liveTestRequest = useRef<AbortController | null>(null)
  const [downloadReplay, setDownloadReplay] = useState(false)
  const [feedProvider, setFeedProvider] = useState(DEFAULT_MARKET_IMPORT_PROVIDER.id)
  const [feedSymbol, setFeedSymbol] = useState(DEFAULT_MARKET_IMPORT_PROVIDER.exampleSymbol)
  const [feedInterval, setFeedInterval] = useState('15m')
  const [feedLimit, setFeedLimit] = useState('500')
  const [feedStart, setFeedStart] = useState('')
  const [feedEnd, setFeedEnd] = useState('')
  const [feedPreview, setFeedPreview] = useState<DatasetPreview | null>(null)
  const [feedReviewed, setFeedReviewed] = useState(false)
  const [feedBusy, setFeedBusy] = useState(false)
  const [feedError, setFeedError] = useState('')
  const [committedFeedVersion, setCommittedFeedVersion] = useState<DatasetVersion | null>(null)
  const feedRequest = useRef<AbortController | null>(null)
  const feedCommitRequestId = useRef('')
  const restoredDraft = useRef('')
  const catalogGeneration = useRef(0)
  const creationGeneration = useRef(0)
  const draftKey = `chartly:profile-setup:${ownerKey}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: A different principal/source must not see the prior owner's profile draft.
  useEffect(() => {
    creationGeneration.current++
    setCreateOpen(false)
    setName('')
    setSessionLabel('')
    setStrategy('')
    setCreateError('')
    setCreationUncertain(false)
    setCreating(false)
    feedRequest.current?.abort()
    liveTestRequest.current?.abort()
    setAccountMode('connector')
    setAccountProviderId('mt5')
    setAccountProviders([])
    setAccountDirectoryStatus('loading')
    setConnectionLabel('')
    setChartDataMode('live-feed')
    setLiveProvider(defaultChartProvider.id)
    setLiveSymbol(defaultChartProvider.exampleSymbol)
    setLiveInterval('15m')
    setLiveTestBusy(false)
    setLiveTestMessage('')
    setLiveTestOk(false)
    setDownloadReplay(false)
    setFeedProvider(DEFAULT_MARKET_IMPORT_PROVIDER.id)
    setFeedSymbol(DEFAULT_MARKET_IMPORT_PROVIDER.exampleSymbol)
    setFeedInterval('15m')
    setFeedPreview(null)
    setFeedReviewed(false)
    setFeedBusy(false)
    setFeedError('')
    setCommittedFeedVersion(null)
    feedCommitRequestId.current = ''
    restoredDraft.current = ''
  }, [ownerKey])
  useEffect(() => {
    if (data.loading || params.get('create') !== 'replay' || restoredDraft.current === ownerKey)
      return
    restoredDraft.current = ownerKey
    setKind('replay')
    setCreateStep(3)
    setCreateOpen(true)
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null')
      if (draft?.version === 1 && draft.owner === ownerKey) {
        if (typeof draft.name === 'string') setName(draft.name.slice(0, 200))
        if (validCurrency(draft.currency)) setCurrency(draft.currency)
        if (typeof draft.sessionLabel === 'string')
          setSessionLabel(draft.sessionLabel.slice(0, 1000))
        if (timezones.includes(draft.timezone)) setTimezone(draft.timezone)
        if (typeof draft.strategy === 'string') setStrategy(draft.strategy.slice(0, 1000))
        if (typeof draft.defaultSymbol === 'string')
          setDefaultSymbol(draft.defaultSymbol.slice(0, 100))
        if (typeof draft.defaultTimeframe === 'string')
          setDefaultTimeframe(draft.defaultTimeframe.slice(0, 20))
        if (typeof draft.startingBalance === 'string' && validPaperCash(draft.startingBalance))
          setStartingBalance(draft.startingBalance)
        setTrackEmotions(draft.trackEmotions === true)
      }
    } catch {
      setCreateError(
        'The saved setup could not be reopened. Enter profile details again; your history remains saved.'
      )
    }
  }, [data.loading, draftKey, ownerKey, params])
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh nonce intentionally invalidates the owned catalog and reviewed selection.
  useEffect(() => {
    const generation = ++catalogGeneration.current
    setSelectedVersion(null)
    setSelectedVersionId('')
    setVersions([])
    setHistoryReviewed(false)
    setNextHistoryOffset(null)
    setHistoryLoading(false)
    if (!createOpen || (kind !== 'replay' && chartDataMode !== 'saved-history')) return
    const controller = new AbortController()
    const expectedOwner = ownerKey
    setHistoryLoading(true)
    setHistoryError('')
    void dataLibrary
      .catalog(controller.signal)
      .then((catalog) => {
        if (
          controller.signal.aborted ||
          activeOwner.current !== expectedOwner ||
          catalogGeneration.current !== generation
        )
          return
        if (principal && catalog.principalId && catalog.principalId !== principal)
          throw new Error('Sign in again before choosing private history.')
        setVersions(
          catalog.versions.filter(
            (version) => !version.archivedAt && !version.quarantine && version.rowCount > 0
          )
        )
        setNextHistoryOffset(catalog.nextOffset ?? null)
      })
      .catch((cause) => {
        if (!controller.signal.aborted && activeOwner.current === expectedOwner)
          setHistoryError(
            cause instanceof Error ? cause.message : 'Saved history could not be loaded.'
          )
      })
      .finally(() => {
        if (!controller.signal.aborted && activeOwner.current === expectedOwner)
          setHistoryLoading(false)
      })
    return () => controller.abort()
  }, [createOpen, kind, chartDataMode, ownerKey, principal, catalogRefresh])
  useEffect(() => {
    setSelectedVersion(null)
    setHistoryReviewed(false)
    if (!selectedVersionId) return
    const controller = new AbortController()
    const expectedOwner = ownerKey
    setHistoryLoading(true)
    setHistoryError('')
    void dataLibrary
      .version(selectedVersionId, controller.signal)
      .then((version) => {
        if (controller.signal.aborted || activeOwner.current !== expectedOwner) return
        if (
          version.archivedAt ||
          version.quarantine ||
          version.rowCount < 1 ||
          (kind === 'replay' && !validCurrency(version.metadata.currency))
        )
          throw new Error('Choose nonempty history with a valid declared currency.')
        setSelectedVersion(version)
        if (validCurrency(version.metadata.currency)) setCurrency(version.metadata.currency)
        setDefaultSymbol(version.metadata.symbol)
        setDefaultTimeframe(version.metadata.interval)
      })
      .catch((cause) => {
        if (!controller.signal.aborted && activeOwner.current === expectedOwner)
          setHistoryError(
            cause instanceof Error ? cause.message : 'The selected history could not be verified.'
          )
      })
      .finally(() => {
        if (!controller.signal.aborted && activeOwner.current === expectedOwner)
          setHistoryLoading(false)
      })
    return () => controller.abort()
  }, [selectedVersionId, ownerKey, kind])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly reloads the account directory.
  useEffect(() => {
    if (!createOpen || kind !== 'live') return
    const controller = new AbortController()
    const expectedOwner = ownerKey
    setAccountDirectoryStatus('loading')
    setAccountProviders([])
    void connectorClient
      .providers(controller.signal, storagePrincipal ?? undefined)
      .then((result) => {
        if (controller.signal.aborted || activeOwner.current !== expectedOwner) return
        const choices = result.providers.filter((provider) => provider.connectionMode === 'account')
        setAccountProviders(choices)
        setAccountDirectoryStatus(choices.length ? 'ready' : 'unavailable')
      })
      .catch(() => {
        if (!controller.signal.aborted && activeOwner.current === expectedOwner)
          setAccountDirectoryStatus('unavailable')
      })
    return () => controller.abort()
  }, [createOpen, kind, ownerKey, storagePrincipal, accountDirectoryRetry])
  useEffect(
    () => () => {
      feedRequest.current?.abort()
      liveTestRequest.current?.abort()
    },
    []
  )

  const selectedAccountProvider =
    accountProviders.find((provider) => provider.id === accountProviderId) ?? accountProviders[0]
  const accountCategory = selectedAccountProvider?.category
  const selectedChartProvider = marketProvider(liveProvider) ?? defaultChartProvider
  const selectedHistoryProvider = marketProvider(feedProvider) ?? DEFAULT_MARKET_IMPORT_PROVIDER
  const mt5ChartSetup =
    kind === 'live' &&
    data.storageMode === 'backend' &&
    accountMode !== 'journal-only' &&
    chartDataMode === 'live-feed' &&
    liveProvider === 'mt5'
  const effectiveConnectionLabel =
    connectionLabel.trim() ||
    `${name.trim() || 'Live profile'} — ${selectedAccountProvider?.name ?? 'Platform'}`
  const accountSetupValid =
    kind !== 'live' ||
    accountMode !== 'connector' ||
    (accountDirectoryStatus === 'ready' &&
      !!selectedAccountProvider &&
      effectiveConnectionLabel.length > 0)
  const chartDataSetupValid =
    kind !== 'live' ||
    chartDataMode === 'later' ||
    (chartDataMode === 'saved-history'
      ? !!selectedVersion && historyReviewed && !historyLoading
      : (mt5ChartSetup ? !!marketSymbol(liveProvider, liveSymbol) : liveTestOk) &&
        !liveTestBusy &&
        (!downloadReplay || (!!feedPreview && feedReviewed && !feedBusy)))

  function clearLiveTest() {
    setLiveTestOk(false)
    setLiveTestMessage('')
  }
  function chooseLiveProvider(value: string) {
    const next = MARKET_CHART_PROVIDERS.find((provider) => provider.id === value)
    if (!next) return
    setLiveProvider(next.id)
    setLiveSymbol(next.exampleSymbol)
    if (!liveFeedIntervals(next.id).includes(liveInterval)) setLiveInterval('1h')
    clearLiveTest()
  }
  async function testLiveFeed() {
    if (liveTestBusy) return
    liveTestRequest.current?.abort()
    const controller = new AbortController()
    liveTestRequest.current = controller
    const expectedOwner = ownerKey
    const requestGeneration = creationGeneration.current
    const current = () =>
      !controller.signal.aborted &&
      activeOwner.current === expectedOwner &&
      creationGeneration.current === requestGeneration
    const owner = storagePrincipal ?? principal
    const symbol = marketSymbol(liveProvider, liveSymbol)
    setLiveTestBusy(true)
    setLiveTestOk(false)
    setLiveTestMessage('')
    try {
      if (!owner) throw new Error('Sign in locally before testing a live chart feed.')
      if (!symbol) throw new Error('Enter the venue-native symbol for this live feed.')
      const exchange = liveFeedExchange(liveProvider)
      const feed = new PlatformFeed({
        providerId: liveProvider,
        symbol,
        exchange,
        intervals: liveFeedIntervals(liveProvider),
        principalId: owner,
      })
      try {
        const bars = await feed.getBars({
          symbol,
          exchange,
          interval: liveInterval,
          signal: controller.signal,
        })
        if (!current()) return
        const last = bars.at(-1)
        if (!last) throw new Error('This feed returned no candles for the selected symbol.')
        setLiveTestOk(true)
        setLiveTestMessage(
          `Feed OK: ${bars.length} recent candles received. Latest close ${last.close}. ${feed.status(symbol, liveInterval).message}.`
        )
      } finally {
        feed.dispose()
      }
    } catch (cause) {
      if (current())
        setLiveTestMessage(
          cause instanceof Error
            ? cause.message
            : 'The live feed test failed. No chart source was saved.'
        )
    } finally {
      if (current()) setLiveTestBusy(false)
    }
  }

  function clearFeedPreview() {
    setFeedPreview(null)
    setFeedReviewed(false)
    setFeedError('')
    setCommittedFeedVersion(null)
    feedCommitRequestId.current = ''
  }
  function chooseFeedProvider(value: string) {
    const next = MARKET_IMPORT_PROVIDERS.find((provider) => provider.id === value)
    if (!next) return
    setFeedProvider(next.id)
    setFeedSymbol(next.exampleSymbol)
    if (!next.intervals.includes(feedInterval)) setFeedInterval('1h')
    clearFeedPreview()
  }
  async function fetchFeedPreview() {
    if (feedBusy) return
    feedRequest.current?.abort()
    const controller = new AbortController()
    feedRequest.current = controller
    const expectedOwner = ownerKey
    const requestGeneration = creationGeneration.current
    const current = () =>
      !controller.signal.aborted &&
      activeOwner.current === expectedOwner &&
      creationGeneration.current === requestGeneration
    setFeedBusy(true)
    setFeedError('')
    setFeedPreview(null)
    setFeedReviewed(false)
    setCommittedFeedVersion(null)
    try {
      const catalog = await dataLibrary.catalog(controller.signal)
      if (!current()) return
      if (principal && catalog.principalId && catalog.principalId !== principal)
        throw new Error('Sign in again before downloading private chart history.')
      const preview = await dataLibrary.previewFeed(
        {
          expectedRevision: catalog.revision,
          ...marketHistoryParameters(feedProvider, feedSymbol, feedInterval, {
            limit: feedLimit,
            start: feedStart,
            end: feedEnd,
          }),
        },
        principal,
        controller.signal
      )
      if (!current()) return
      feedCommitRequestId.current = `profile_feed_${crypto.randomUUID().replaceAll('-', '')}`
      setFeedPreview(preview)
    } catch (cause) {
      if (current())
        setFeedError(
          cause instanceof Error
            ? cause.message
            : 'Chart candles could not be fetched. Saved history is unchanged.'
        )
    } finally {
      if (current()) setFeedBusy(false)
    }
  }

  function retainSetup() {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          version: 1,
          owner: ownerKey,
          name,
          currency,
          sessionLabel,
          timezone,
          strategy,
          defaultSymbol,
          defaultTimeframe,
          startingBalance,
          trackEmotions,
        })
      )
      return true
    } catch {
      setCreateError(
        'Setup could not be retained. Keep this form open and import history in another tab.'
      )
      return false
    }
  }
  async function loadMoreHistory() {
    if (nextHistoryOffset === null || historyLoading) return
    const expectedOwner = ownerKey
    const generation = catalogGeneration.current
    setHistoryLoading(true)
    try {
      const catalog = await dataLibrary.catalog(undefined, nextHistoryOffset)
      if (activeOwner.current !== expectedOwner || catalogGeneration.current !== generation) return
      if (principal && catalog.principalId && catalog.principalId !== principal)
        throw new Error('Sign in again before choosing private history.')
      setVersions((current) => [
        ...current,
        ...catalog.versions.filter(
          (version) =>
            !version.archivedAt &&
            !version.quarantine &&
            version.rowCount > 0 &&
            !current.some((item) => item.id === version.id)
        ),
      ])
      setNextHistoryOffset(catalog.nextOffset ?? null)
    } catch (cause) {
      if (activeOwner.current === expectedOwner && catalogGeneration.current === generation) {
        setHistoryError(
          cause instanceof Error ? cause.message : 'More saved history could not be loaded.'
        )
        setSelectedVersion(null)
        setHistoryReviewed(false)
      }
    } finally {
      if (activeOwner.current === expectedOwner && catalogGeneration.current === generation)
        setHistoryLoading(false)
    }
  }

  const liveProfiles = data.portfolios.filter((portfolio) => portfolio.kind === 'live')
  const replayProfiles = data.portfolios.filter((portfolio) => portfolio.kind === 'replay')
  const tradesByProfile = useMemo(() => {
    const groups = new Map<number, JournalTrade[]>()
    for (const trade of data.trades) {
      const trades = groups.get(trade.portfolioId)
      if (trades) trades.push(trade)
      else groups.set(trade.portfolioId, [trade])
    }
    return groups
  }, [data.trades])
  const sessionCounts = useMemo(() => countsByProfile(data.sessions), [data.sessions])
  const destinationCounts = useMemo(() => countsByProfile(data.destinations), [data.destinations])
  const combined = useMemo(
    () => summarizeCombinedProfiles(data.portfolios, data.trades),
    [data.portfolios, data.trades]
  )
  const combinedRows = Object.values(combined)
  const needsClassification = data.portfolios.filter((portfolio) => portfolio.needsClassification)

  const duplicateProfile = data.portfolios.some(
    (portfolio) =>
      portfolio.kind === kind && portfolio.name.toLowerCase() === name.trim().toLowerCase()
  )
  const step2Valid = name.trim().length >= 2 && validCurrency(currency)
  const cashValid = kind !== 'replay' || validPaperCash(startingBalance)

  function openCreate() {
    creationGeneration.current++
    setCreateStep(1)
    setTrackEmotions(false)
    setCreateOpen(true)
  }

  function resetCreate() {
    setCreateOpen(false)
    setCreateStep(1)
    setName('')
    setSessionLabel('')
    setStrategy('')
    setTrackEmotions(false)
    setCreateError('')
    setCreationUncertain(false)
    setAccountMode('connector')
    setAccountProviderId('mt5')
    setConnectionLabel('')
    setChartDataMode('live-feed')
    setLiveProvider(defaultChartProvider.id)
    setLiveSymbol(defaultChartProvider.exampleSymbol)
    setLiveInterval('15m')
    setLiveTestBusy(false)
    setLiveTestMessage('')
    setLiveTestOk(false)
    setDownloadReplay(false)
    setFeedProvider(DEFAULT_MARKET_IMPORT_PROVIDER.id)
    setFeedSymbol(DEFAULT_MARKET_IMPORT_PROVIDER.exampleSymbol)
    setFeedInterval('15m')
    setFeedLimit('500')
    setFeedStart('')
    setFeedEnd('')
    clearFeedPreview()
  }

  async function createProfile(event: FormEvent) {
    event.preventDefault()
    if (createStep < 4) {
      if (createStep === 2 && !step2Valid) return
      setCreateStep(createStep + 1)
      return
    }
    if (
      !step2Valid ||
      !cashValid ||
      !accountSetupValid ||
      !chartDataSetupValid ||
      creating ||
      creationUncertain ||
      (kind === 'replay' && (!selectedVersion || !historyReviewed || historyLoading))
    )
      return
    setCreating(true)
    setCreateError('')
    const requestOwner = ownerKey
    const requestGeneration = creationGeneration.current
    const isCurrent = () =>
      activeOwner.current === requestOwner && creationGeneration.current === requestGeneration
    let profileSaveStarted = false
    try {
      let replayVersion: DatasetVersion | null =
        kind === 'replay' || chartDataMode === 'saved-history'
          ? selectedVersion
          : committedFeedVersion
      if (kind === 'live' && chartDataMode === 'live-feed' && downloadReplay && !replayVersion) {
        if (!feedPreview)
          throw new Error(
            'Fetch and review replay candles before creating, or turn the optional download off.'
          )
        try {
          const committed = await dataLibrary.commit(
            feedPreview.id,
            {
              expectedRevision: feedPreview.expectedRevision,
              requestId:
                feedCommitRequestId.current ||
                `profile_feed_${crypto.randomUUID().replaceAll('-', '')}`,
              policy: 'new-version',
              allowRejectedRows: false,
            },
            principal
          )
          replayVersion = committed.version
          if (isCurrent()) setCommittedFeedVersion(committed.version)
        } catch (cause) {
          if (!isCurrent()) return
          setCreateError(
            cause instanceof Error
              ? `Replay candles could not be published: ${cause.message}`
              : 'Replay candles could not be published. Review the staged download and retry.'
          )
          return
        }
      }
      if (!isCurrent()) return
      const chartVersion =
        kind === 'replay' || chartDataMode === 'saved-history' ? replayVersion : null
      const strategyTags = strategy
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
      const normalizedLiveSymbol = marketSymbol(liveProvider, liveSymbol) ?? ''
      const liveSetup: LiveProfileSetup | undefined =
        kind === 'live'
          ? {
              version: 1,
              account: {
                mode: accountMode,
                ...(accountMode === 'connector' && selectedAccountProvider
                  ? {
                      providerId: selectedAccountProvider.id,
                      providerName: selectedAccountProvider.name,
                      category: selectedAccountProvider.category,
                      connectionLabel: effectiveConnectionLabel,
                    }
                  : {}),
              },
              chartData: {
                mode: chartDataMode,
                ...(chartDataMode === 'live-feed'
                  ? {
                      providerId: liveProvider,
                      providerName: selectedChartProvider.label,
                      symbol: normalizedLiveSymbol,
                      interval: liveInterval,
                    }
                  : chartDataMode === 'saved-history' && chartVersion
                    ? {
                        providerId: chartVersion.metadata.provider,
                        symbol: chartVersion.metadata.symbol,
                        interval: chartVersion.metadata.interval,
                        datasetVersionId: chartVersion.id,
                      }
                    : {}),
              },
              replayHistory:
                chartDataMode === 'saved-history' && chartVersion
                  ? {
                      mode: 'saved-history',
                      providerId: chartVersion.metadata.provider,
                      symbol: chartVersion.metadata.symbol,
                      interval: chartVersion.metadata.interval,
                      datasetVersionId: chartVersion.id,
                    }
                  : chartDataMode === 'live-feed' && downloadReplay && replayVersion
                    ? {
                        mode: 'download',
                        providerId: feedProvider,
                        providerName: marketImportLabel(selectedHistoryProvider),
                        symbol: replayVersion.metadata.symbol,
                        interval: replayVersion.metadata.interval,
                        datasetVersionId: replayVersion.id,
                      }
                    : { mode: 'later' },
            }
          : undefined
      profileSaveStarted = true
      const id = await data.createPortfolio({
        name: name.trim(),
        kind,
        currency: currency.trim().toUpperCase() || 'USD',
        startingBalance: kind === 'replay' ? Number(startingBalance) : 0,
        sessionLabel: tags(sessionLabel).join(', ') || undefined,
        sessionTags: tags(sessionLabel),
        timezone: timezone.trim() || undefined,
        strategyTags,
        defaultSymbol:
          kind === 'live' && chartDataMode === 'live-feed'
            ? normalizedLiveSymbol
            : chartVersion
              ? chartVersion.metadata.symbol
              : defaultSymbol.trim().toUpperCase() || undefined,
        defaultTimeframe:
          kind === 'live' && chartDataMode === 'live-feed'
            ? liveInterval
            : chartVersion
              ? chartVersion.metadata.interval
              : defaultTimeframe,
        emotionTrackingEnabled: trackEmotions,
        ...(liveSetup ? { liveSetup } : {}),
        ...(kind === 'live' && chartDataMode === 'live-feed'
          ? {
              chartSource: {
                kind: 'live-feed' as const,
                providerId: liveProvider,
                providerName: selectedChartProvider.label,
                symbol: normalizedLiveSymbol,
                exchange: liveFeedExchange(liveProvider),
                interval: liveInterval,
              },
            }
          : chartVersion
            ? {
                chartSource: {
                  kind: 'dataset' as const,
                  versionId: chartVersion.id,
                  checksum: chartVersion.checksum,
                },
              }
            : {}),
      })
      if (!isCurrent()) return

      // The profile records the selected platform as intent. When the
      // backend catalog confirms it is connectable, create its connector
      // record now; verification remains an explicit Connections step.
      let connectionNotice = ''
      if (kind === 'live' && accountMode === 'connector' && selectedAccountProvider) {
        const canAutoCreate =
          data.storageMode === 'backend' &&
          !!data.workspace?.originId &&
          !!storagePrincipal &&
          selectedAccountProvider.available &&
          selectedAccountProvider.setupState === 'available' &&
          selectedAccountProvider.connectionMode === 'account'
        if (mt5ChartSetup && selectedAccountProvider.id === 'mt5') {
          connectionNotice =
            'Choose the running MT5 installation, then verify and link its account.'
        } else if (canAutoCreate) {
          try {
            await connectorClient.action(
              {
                originId: data.workspace!.originId,
                expectedRevision: 0,
                requestId: `connector_${crypto.randomUUID().replaceAll('-', '')}`,
                action: 'create',
                payload: {
                  providerId: selectedAccountProvider.id,
                  label: effectiveConnectionLabel,
                  configuration: {},
                  profileId: id,
                },
              },
              undefined,
              storagePrincipal ?? undefined
            )
          } catch {
            connectionNotice =
              'The profile was created, but its platform connection record could not be created automatically. Create it here, then verify the account.'
          }
        } else {
          connectionNotice =
            selectedAccountProvider.setupState === 'planned'
              ? `${selectedAccountProvider.name} is saved as this profile's intended platform, but its connector is still planned. Chart data and journal remain available.`
              : 'Create and verify the selected platform connection here. It is separate from chart data.'
        }
        if (!isCurrent()) return
        if (connectionNotice) {
          try {
            sessionStorage.setItem(
              `chartly:connection-setup:${id}`,
              JSON.stringify({ message: connectionNotice })
            )
          } catch {
            /* The stored setup intent still guides the Connections page. */
          }
        }
      }

      const destination =
        kind === 'replay'
          ? profileHref(id, 'replay')
          : mt5ChartSetup
            ? profileHref(id, 'connections')
            : chartDataMode === 'live-feed' || chartVersion
              ? chartHref(
                  id,
                  undefined,
                  { name: name.trim(), kind },
                  undefined,
                  undefined,
                  undefined,
                  chartVersion?.id
                )
              : profileHref(id)
      resetCreate()
      try {
        sessionStorage.removeItem(draftKey)
      } catch {
        /* Clearing a nonsecret setup draft cannot invalidate the saved profile. */
      }
      if (params.has('create')) setParams({}, { replace: true })
      navigate(destination)
    } catch (cause) {
      if (!isCurrent()) return
      if (!profileSaveStarted) {
        setCreateError(
          cause instanceof Error
            ? cause.message
            : 'Profile setup could not be completed. Retry the reviewed step.'
        )
        return
      }
      setCreationUncertain(true)
      setCreateError(
        cause instanceof Error
          ? cause.message
          : 'The profile could not be confirmed. Reload Workspace to check saved profiles before trying again.'
      )
    } finally {
      if (isCurrent()) setCreating(false)
    }
  }

  return (
    <div className="space-y-7 pb-3">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5 pt-1 sm:pt-3">
        <div>
          <h1 className="text-[1.7rem] leading-tight font-semibold tracking-tight sm:text-3xl">
            Trading profiles
          </h1>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            {liveProfiles.length} live {liveProfiles.length === 1 ? 'profile' : 'profiles'} ·{' '}
            {replayProfiles.length} replay {replayProfiles.length === 1 ? 'project' : 'projects'}
          </p>
        </div>
        <Button
          type="button"
          className="shadow-xs"
          disabled={creating}
          onClick={() => openCreate()}
        >
          <Plus className="h-4 w-4" /> New profile
        </Button>
      </header>

      {data.error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {data.error}
        </p>
      )}

      {needsClassification.length > 0 && (
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <strong>Legacy profiles need a type.</strong>{' '}
          {needsClassification.map((portfolio) => portfolio.name).join(', ')} were imported before
          Live/Replay profiles existed. Open each profile’s Settings tab to confirm it.
        </section>
      )}

      <section aria-labelledby="live-profiles-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="live-profiles-heading"
              className="flex items-center gap-2.5 text-lg font-semibold tracking-tight"
            >
              <span className="grid size-7 place-items-center rounded-lg border bg-card text-muted-foreground">
                <RadioTower className="size-4" aria-hidden="true" />
              </span>
              Live trading
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep a chart, journal and optional account connections in one environment.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {liveProfiles.length >= 2 && combinedRows.length > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                All live profiles{' '}
                <strong className="font-semibold text-foreground">
                  {combinedRows.map((row) => formatMoney(row.netPnl, row.currency)).join(' · ')}
                </strong>
              </span>
            )}
            {liveProfiles.length > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link to="/workspace/combined">
                  <BarChart3 className="h-4 w-4" /> Combined live analytics
                </Link>
              </Button>
            )}
          </div>
        </div>

        {liveProfiles.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {liveProfiles.map((portfolio) => (
              <ProfileCard
                key={portfolio.id}
                portfolio={portfolio}
                trades={tradesByProfile.get(portfolio.id!) ?? emptyTrades}
                sessionCount={sessionCounts.get(portfolio.id!) ?? 0}
                destinationCount={destinationCounts.get(portfolio.id!) ?? 0}
              />
            ))}
          </div>
        ) : (
          !data.loading && (
            <EmptyState
              icon={RadioTower}
              title="No live profiles yet"
              description="Create a live profile, then add its broker accounts and chart data source."
            />
          )
        )}
      </section>

      <section aria-labelledby="replay-profiles-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="replay-profiles-heading"
              className="flex items-center gap-2.5 text-lg font-semibold tracking-tight"
            >
              <span className="grid size-7 place-items-center rounded-lg border bg-card text-muted-foreground">
                <History className="size-4" aria-hidden="true" />
              </span>
              Paper & replay
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep saved-history experiments together. Each run has its own paper account and
              results.
            </p>
          </div>
        </div>

        {replayProfiles.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {replayProfiles.map((portfolio) => (
              <ProfileCard
                key={portfolio.id}
                portfolio={portfolio}
                trades={tradesByProfile.get(portfolio.id!) ?? emptyTrades}
                sessionCount={sessionCounts.get(portfolio.id!) ?? 0}
                destinationCount={destinationCounts.get(portfolio.id!) ?? 0}
              />
            ))}
          </div>
        ) : (
          !data.loading && (
            <EmptyState
              icon={History}
              title="No replay projects yet"
              description="Use New profile above to choose saved history and create a replay project. Review each run’s paper account before starting."
            />
          )
        )}
      </section>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!creating) setCreateOpen(open)
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Create trading profile</DialogTitle>
            <DialogDescription>
              Set up the profile, trading platform, and chart data as separate choices.
            </DialogDescription>
          </DialogHeader>

          <ol className="grid grid-cols-4 gap-2" aria-label="Profile setup steps">
            {[
              'Choose type',
              'Profile details',
              kind === 'live' ? 'Platform & data' : 'Replay history',
              'Review',
            ].map((label, index) => {
              const step = index + 1
              return (
                <li
                  key={label}
                  aria-current={createStep === step ? 'step' : undefined}
                  className={`flex items-center gap-2 border px-3 py-2 text-sm ${
                    createStep >= step
                      ? 'border-teal-600 bg-teal-500/5 font-medium'
                      : 'text-muted-foreground'
                  }`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs">
                    {createStep > step ? <CheckCircle2 className="h-4 w-4 text-teal-600" /> : step}
                  </span>
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sm:hidden">Step {step}</span>
                </li>
              )
            })}
          </ol>

          <form onSubmit={createProfile} className="space-y-5">
            {createStep === 1 && (
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">What kind of channel is this?</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setKind('live')}
                    aria-pressed={kind === 'live'}
                    className={`border p-4 text-left ${kind === 'live' ? 'border-teal-600 bg-teal-500/5' : 'border-border hover:border-muted-foreground/40'}`}
                  >
                    <RadioTower className="h-6 w-6 text-teal-600" />
                    <span className="mt-3 block font-semibold">Live trading channel</span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                      Choose a trading platform and, separately, where its chart candles come from.
                      Verification never silently downloads or invents market data.
                    </span>
                    <span className="mt-3 block text-xs text-muted-foreground">
                      Example: One account → one connected journal book
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setKind('replay')}
                    aria-pressed={kind === 'replay'}
                    className={`border p-4 text-left ${kind === 'replay' ? 'border-teal-600 bg-teal-500/5' : 'border-border hover:border-muted-foreground/40'}`}
                  >
                    <History className="h-6 w-6 text-teal-600" />
                    <span className="mt-3 block font-semibold">Replay project</span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                      A folder for independent paper and replay runs across symbols and periods.
                      Choose actual saved history before creating a replay project.
                    </span>
                    <span className="mt-3 block text-xs text-muted-foreground">
                      Example: Breakout v2 → EURUSD, XAUUSD, GBPJPY runs
                    </span>
                  </button>
                </div>
                <p className="flex gap-2 text-sm text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                  Type stays fixed after creation so live money and test results cannot mix. A
                  replay project can later be duplicated as a live profile.
                </p>
              </fieldset>
            )}

            {createStep === 2 && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="profile-name">Profile name</Label>
                  <Input
                    id="profile-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={kind === 'live' ? 'London Breakout Live' : 'London Breakout v2'}
                    required
                    aria-invalid={!step2Valid}
                  />
                  {duplicateProfile && (
                    <p className="text-sm text-amber-700">
                      A {kind} profile with this name already exists. You can still create it, but a
                      session or version suffix will be easier to tell apart.
                    </p>
                  )}
                </div>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Trading sessions (optional tags)</legend>
                  <div className="flex flex-wrap gap-2">
                    {sessionPresets.map((preset) => (
                      <Button
                        key={preset}
                        type="button"
                        size="sm"
                        variant={tags(sessionLabel).includes(preset) ? 'default' : 'outline'}
                        aria-pressed={tags(sessionLabel).includes(preset)}
                        onClick={() => {
                          setSessionLabel((current) =>
                            (tags(current).includes(preset)
                              ? tags(current).filter((item) => item !== preset)
                              : [...tags(current), preset]
                            ).join(', ')
                          )
                        }}
                      >
                        {preset}
                      </Button>
                    ))}
                  </div>
                </fieldset>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="profile-session">Session tags (optional)</Label>
                    <Input
                      id="profile-session"
                      value={sessionLabel}
                      onChange={(event) => setSessionLabel(event.target.value)}
                      placeholder="London, New York…"
                    />
                    <p className="text-xs text-muted-foreground">
                      Choose several or add comma-separated tags. Tags never change your timezone.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-timezone">Profile timezone</Label>
                    <select
                      id="profile-timezone"
                      className={fieldClass}
                      value={timezone}
                      onChange={(event) => setTimezone(event.target.value)}
                    >
                      {timezones.map((zone) => (
                        <option key={zone}>{zone}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-currency">Reporting currency</Label>
                    <select
                      id="profile-currency"
                      className={fieldClass}
                      value={currency}
                      disabled={kind === 'replay' && !!selectedVersion}
                      onChange={(event) => setCurrency(event.target.value)}
                    >
                      {[...new Set([currency, ...currencies])].map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-strategy">Strategies (optional)</Label>
                    <Input
                      id="profile-strategy"
                      value={strategy}
                      onChange={(event) => setStrategy(event.target.value)}
                      placeholder="Breakout, Pullback"
                    />
                    <p className="text-xs text-muted-foreground">
                      Separate multiple strategies with commas.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-default-symbol">Default symbol</Label>
                    <Input
                      id="profile-default-symbol"
                      value={defaultSymbol}
                      disabled={kind === 'replay' && !!selectedVersion}
                      onChange={(event) => setDefaultSymbol(event.target.value)}
                      placeholder="EURUSD"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-default-timeframe">Default timeframe</Label>
                    <select
                      id="profile-default-timeframe"
                      className={fieldClass}
                      value={defaultTimeframe}
                      disabled={kind === 'replay' && !!selectedVersion}
                      onChange={(event) => setDefaultTimeframe(event.target.value)}
                    >
                      {[...new Set([defaultTimeframe, ...timeframes])].map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {kind === 'replay' && (
                  <div className="space-y-2">
                    <Label htmlFor="profile-starting-balance">Default paper starting cash</Label>
                    <Input
                      id="profile-starting-balance"
                      inputMode="decimal"
                      value={startingBalance}
                      onChange={(event) => setStartingBalance(event.target.value)}
                      aria-invalid={!cashValid}
                    />
                    <p className="text-xs text-muted-foreground">
                      A positive default for each independent run, in {currency}. Review it again
                      when preparing a paper account.
                    </p>
                    {!cashValid && (
                      <p role="alert" className="text-sm text-destructive">
                        Enter positive starting cash with at most eight decimal places, without
                        commas or exponent notation.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-3 border bg-muted/20 p-3">
                  <Brain className="mt-0.5 h-5 w-5 shrink-0 text-teal-600" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor="profile-track-emotions"
                      className="flex cursor-pointer items-start gap-2 text-sm font-medium"
                    >
                      <Checkbox
                        id="profile-track-emotions"
                        checked={trackEmotions}
                        onCheckedChange={(checked) => setTrackEmotions(checked === true)}
                      />
                      Track mindset & emotions for this profile
                    </label>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Optional, off by default. Adds a daily check-in and optional per-trade mindset
                      fields. You can change this later in Profile Settings; it never blocks the
                      chart or a trade.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {createStep === 3 && (
              <div className="space-y-5">
                {kind === 'replay' && (
                  <section className="space-y-4 border p-4" aria-label="Replay data setup">
                    <div>
                      <h3 className="font-medium">Choose saved history</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        A replay project needs an owned, nonempty history version. A connection
                        label alone does not supply candles.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="profile-history">Saved history version</Label>
                      <select
                        id="profile-history"
                        className={fieldClass}
                        value={selectedVersionId}
                        disabled={historyLoading || creating}
                        onChange={(event) => setSelectedVersionId(event.target.value)}
                      >
                        <option value="">Choose saved history</option>
                        {versions.map((version) => (
                          <option key={version.id} value={version.id}>
                            {version.name || version.metadata.symbol} · {version.metadata.symbol} ·{' '}
                            {version.metadata.interval} ·{' '}
                            {version.metadata.currency || 'Currency unavailable'}
                          </option>
                        ))}
                      </select>
                      {historyLoading && (
                        <output className="text-sm">Reading owned history…</output>
                      )}
                      {historyError && (
                        <p role="alert" className="text-sm text-destructive">
                          {historyError}
                        </p>
                      )}
                      {!historyLoading && !versions.length && !historyError && (
                        <p className="text-sm text-muted-foreground">
                          No saved history is available. Import candles, then return to this setup.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="outline">
                        <Link
                          to={datasetLibraryHref('/workspace?create=replay')}
                          onClick={(event) => {
                            if (creating || !retainSetup()) event.preventDefault()
                          }}
                        >
                          Import or manage history
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={historyLoading || creating}
                        onClick={() => setCatalogRefresh((value) => value + 1)}
                      >
                        Refresh history
                      </Button>
                      {nextHistoryOffset !== null && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={historyLoading || creating}
                          onClick={() => void loadMoreHistory()}
                        >
                          Load more history versions
                        </Button>
                      )}
                    </div>
                    {selectedVersion && (
                      <div className="space-y-3 text-sm">
                        <p>
                          {selectedVersion.rowCount.toLocaleString()} candles ·{' '}
                          {new Date(selectedVersion.start * 1000).toISOString()} →{' '}
                          {new Date(selectedVersion.end * 1000).toISOString()}
                        </p>
                        <p>
                          {selectedVersion.metadata.provider} · {selectedVersion.metadata.symbol} ·
                          native {selectedVersion.metadata.interval} ·{' '}
                          {selectedVersion.metadata.currency}. Symbol, interval and currency follow
                          this version.
                        </p>
                        {typeof selectedVersion.quality.summary === 'string' && (
                          <p>{selectedVersion.quality.summary}</p>
                        )}
                        <label className="flex items-start gap-2">
                          <Checkbox
                            checked={historyReviewed}
                            disabled={creating}
                            onCheckedChange={(checked) => setHistoryReviewed(checked === true)}
                          />
                          I reviewed this history and its declared currency.
                        </label>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Creation saves the project and exact history reference. Create a run next,
                      then review its starting cash, quantity units, tick, spread, slippage and fees
                      before starting. Current paper accounts use 1× linear collateral; historical
                      spreads cannot be inferred from candle prices.
                    </p>
                  </section>
                )}

                {kind === 'live' && (
                  <div className="flex flex-col gap-5">
                    <section
                      className="order-2 space-y-4 border p-4"
                      aria-label="Trading platform setup"
                    >
                      <div>
                        <h3 className="font-medium">2. Account connection (optional)</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Optional read-only account identity for journal sync. It is separate from
                          the live chart feed and does not enable trade execution.
                        </p>
                      </div>
                      <fieldset className="flex flex-wrap gap-2">
                        <legend className="sr-only">Account setup choice</legend>
                        {(
                          [
                            ['connector', 'Connect a platform'],
                            ['later', 'Connect later'],
                            ['journal-only', 'Journal only'],
                          ] as const
                        ).map(([value, label]) => (
                          <Button
                            key={value}
                            type="button"
                            variant={accountMode === value ? 'default' : 'outline'}
                            aria-pressed={accountMode === value}
                            disabled={creating}
                            onClick={() => setAccountMode(value)}
                          >
                            {label}
                          </Button>
                        ))}
                      </fieldset>
                      {accountMode === 'connector' && accountDirectoryStatus === 'loading' && (
                        <output className="block text-sm text-muted-foreground">
                          Loading account platforms…
                        </output>
                      )}
                      {accountMode === 'connector' && accountDirectoryStatus === 'unavailable' && (
                        <div className="space-y-2">
                          <output className="block text-sm text-muted-foreground">
                            Account platforms are unavailable. Retry or choose Connect later to
                            continue setting up your profile.
                          </output>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setAccountDirectoryRetry((attempt) => attempt + 1)}
                          >
                            Retry account platforms
                          </Button>
                        </div>
                      )}
                      {accountMode === 'connector' && accountDirectoryStatus === 'ready' && (
                        <div className="space-y-4">
                          <fieldset className="flex flex-wrap gap-2">
                            <legend className="sr-only">Platform category</legend>
                            {accountCategories.map(([value, label]) => (
                              <Button
                                key={value}
                                type="button"
                                size="sm"
                                variant={accountCategory === value ? 'default' : 'outline'}
                                aria-pressed={accountCategory === value}
                                disabled={
                                  creating ||
                                  !accountProviders.some((provider) => provider.category === value)
                                }
                                onClick={() => {
                                  const first = accountProviders.find(
                                    (provider) => provider.category === value
                                  )
                                  if (first) setAccountProviderId(first.id)
                                }}
                              >
                                {label}
                              </Button>
                            ))}
                          </fieldset>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="profile-platform">Trading platform</Label>
                              <select
                                id="profile-platform"
                                className={fieldClass}
                                value={selectedAccountProvider?.id ?? ''}
                                disabled={creating}
                                onChange={(event) => setAccountProviderId(event.target.value)}
                              >
                                {accountProviders
                                  .filter((provider) => provider.category === accountCategory)
                                  .map((provider) => (
                                    <option key={provider.id} value={provider.id}>
                                      {provider.name}
                                      {provider.setupState === 'planned'
                                        ? ' · planned'
                                        : !provider.available
                                          ? ' · setup required'
                                          : ''}
                                    </option>
                                  ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="profile-connection-name">Connection name</Label>
                              <Input
                                id="profile-connection-name"
                                value={connectionLabel}
                                onChange={(event) => setConnectionLabel(event.target.value)}
                                placeholder={effectiveConnectionLabel}
                                maxLength={100}
                                disabled={creating}
                              />
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {selectedAccountProvider?.setupState === 'planned'
                              ? 'This connector is planned. The choice is saved as intent; account verification is not available yet.'
                              : selectedAccountProvider?.id === 'mt5'
                                ? 'Next, Connections verifies the account in the already-running MT5 terminal. Chartly never asks for or stores the MT5 password.'
                                : 'Next, Connections creates/verifies this read-only account connection. Credentials are entered there, not in profile details.'}
                          </p>
                        </div>
                      )}
                      {accountMode === 'later' && (
                        <p className="text-sm text-muted-foreground">
                          The profile will be created without an account connection. You can add and
                          verify one later from Connections.
                        </p>
                      )}
                      {accountMode === 'journal-only' && (
                        <p className="text-sm text-muted-foreground">
                          No external account will be connected. Use the journal and chart data
                          independently.
                        </p>
                      )}
                    </section>

                    <section
                      className="order-1 space-y-4 border p-4"
                      aria-label="Live chart feed setup"
                    >
                      <div>
                        <h3 className="font-medium">1. Live chart feed</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          This is the main Live chart source: recent candles come directly from the
                          chosen platform. Saved history for replay is a separate optional download
                          below.
                        </p>
                      </div>
                      <fieldset className="flex flex-wrap gap-2">
                        <legend className="sr-only">Chart data choice</legend>
                        {(
                          [
                            ['live-feed', 'Live platform feed'],
                            ['saved-history', 'Saved history chart'],
                            ['later', 'Decide later'],
                          ] as const
                        ).map(([value, label]) => (
                          <Button
                            key={value}
                            type="button"
                            variant={chartDataMode === value ? 'default' : 'outline'}
                            aria-pressed={chartDataMode === value}
                            disabled={creating || feedBusy || liveTestBusy}
                            onClick={() => setChartDataMode(value)}
                          >
                            {label}
                          </Button>
                        ))}
                      </fieldset>

                      {chartDataMode === 'live-feed' && (
                        <div className="space-y-4">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="space-y-2">
                              <Label htmlFor="profile-live-provider">Platform feed</Label>
                              <select
                                id="profile-live-provider"
                                className={fieldClass}
                                value={liveProvider}
                                disabled={creating || liveTestBusy}
                                onChange={(event) => chooseLiveProvider(event.target.value)}
                              >
                                {MARKET_CHART_PROVIDERS.map((provider) => (
                                  <option key={provider.id} value={provider.id}>
                                    {provider.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="profile-live-symbol">Venue symbol</Label>
                              <Input
                                id="profile-live-symbol"
                                value={liveSymbol}
                                maxLength={
                                  selectedChartProvider.symbolFormat === 'mt5-native' ? 80 : 24
                                }
                                disabled={creating || liveTestBusy}
                                onChange={(event) => {
                                  setLiveSymbol(event.target.value)
                                  clearLiveTest()
                                }}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="profile-live-interval">Timeframe</Label>
                              <select
                                id="profile-live-interval"
                                className={fieldClass}
                                value={liveInterval}
                                disabled={creating || liveTestBusy}
                                onChange={(event) => {
                                  setLiveInterval(event.target.value)
                                  clearLiveTest()
                                }}
                              >
                                {liveFeedIntervals(liveProvider).map((interval) => (
                                  <option key={interval} value={interval}>
                                    {interval}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          {mt5ChartSetup ? (
                            <p className="text-sm text-muted-foreground">
                              Verify a running MT5 installation in Connections after creating the
                              profile. Chart times use the terminal clock.
                            </p>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                disabled={creating || liveTestBusy || !liveSymbol.trim()}
                                onClick={() => void testLiveFeed()}
                              >
                                {liveTestBusy ? 'Testing feed…' : 'Test live feed'}
                              </Button>
                              <span className="text-xs text-muted-foreground">
                                Recent live window (up to 1,000 candles), refreshed every few
                                seconds.
                                {selectedChartProvider.credentials === 'terminal-session'
                                  ? ' MT5 must be running and signed in. Chart times use the terminal clock.'
                                  : ''}
                              </span>
                            </div>
                          )}
                          {!mt5ChartSetup && liveTestMessage && (
                            <p
                              role={liveTestOk ? 'status' : 'alert'}
                              className={
                                liveTestOk ? 'text-sm text-emerald-700' : 'text-sm text-destructive'
                              }
                            >
                              {liveTestMessage}
                            </p>
                          )}
                          <label className="flex items-start gap-2 border-t pt-4 text-sm">
                            <Checkbox
                              checked={downloadReplay}
                              disabled={creating || feedBusy}
                              onCheckedChange={(checked) => setDownloadReplay(checked === true)}
                            />
                            <span>
                              Also download a separate saved-history version for Replay now
                              <span className="block text-muted-foreground">
                                Optional. The live chart will still open from the platform feed; the
                                download is reviewed and saved separately for replay.
                              </span>
                            </span>
                          </label>
                        </div>
                      )}

                      {chartDataMode === 'live-feed' && downloadReplay && (
                        <div className="space-y-4 border-t pt-4">
                          <div>
                            <h4 className="text-sm font-medium">
                              Optional replay history download
                            </h4>
                            <p className="mt-1 text-sm text-muted-foreground">
                              Choose the history provider and range independently. Only closed
                              candles are staged for review.
                            </p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="space-y-2">
                              <Label htmlFor="profile-feed-provider">Replay history provider</Label>
                              <select
                                id="profile-feed-provider"
                                className={fieldClass}
                                value={feedProvider}
                                disabled={creating || feedBusy}
                                onChange={(event) => chooseFeedProvider(event.target.value)}
                              >
                                {MARKET_IMPORT_PROVIDERS.map((provider) => (
                                  <option key={provider.id} value={provider.id}>
                                    {marketImportLabel(provider)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="profile-feed-symbol">Venue symbol</Label>
                              <Input
                                id="profile-feed-symbol"
                                value={feedSymbol}
                                maxLength={24}
                                disabled={creating || feedBusy}
                                onChange={(event) => {
                                  setFeedSymbol(event.target.value)
                                  clearFeedPreview()
                                }}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="profile-feed-interval">Timeframe</Label>
                              <select
                                id="profile-feed-interval"
                                className={fieldClass}
                                value={feedInterval}
                                disabled={creating || feedBusy}
                                onChange={(event) => {
                                  setFeedInterval(event.target.value)
                                  clearFeedPreview()
                                }}
                              >
                                {selectedHistoryProvider.intervals.map((value) => (
                                  <option key={value} value={value}>
                                    {value}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {!selectedHistoryProvider.maxWindowHours ? (
                              <div className="space-y-2">
                                <Label htmlFor="profile-feed-limit">Candles (max 1000)</Label>
                                <Input
                                  id="profile-feed-limit"
                                  value={feedLimit}
                                  inputMode="numeric"
                                  maxLength={4}
                                  disabled={creating || feedBusy}
                                  onChange={(event) => {
                                    setFeedLimit(event.target.value)
                                    clearFeedPreview()
                                  }}
                                />
                              </div>
                            ) : (
                              <>
                                <div className="space-y-2">
                                  <Label htmlFor="profile-feed-start">Start (UTC)</Label>
                                  <Input
                                    id="profile-feed-start"
                                    type="datetime-local"
                                    value={feedStart}
                                    disabled={creating || feedBusy}
                                    onChange={(event) => {
                                      setFeedStart(event.target.value)
                                      clearFeedPreview()
                                    }}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label htmlFor="profile-feed-end">
                                    End (UTC, under {selectedHistoryProvider.maxWindowHours}h)
                                  </Label>
                                  <Input
                                    id="profile-feed-end"
                                    type="datetime-local"
                                    value={feedEnd}
                                    disabled={creating || feedBusy}
                                    onChange={(event) => {
                                      setFeedEnd(event.target.value)
                                      clearFeedPreview()
                                    }}
                                  />
                                </div>
                              </>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              disabled={
                                creating ||
                                feedBusy ||
                                !feedSymbol.trim() ||
                                (!!selectedHistoryProvider.maxWindowHours &&
                                  (!feedStart || !feedEnd))
                              }
                              onClick={() => void fetchFeedPreview()}
                            >
                              {feedBusy ? 'Fetching candles…' : 'Fetch & review candles'}
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              The preview contains closed candles. MT5 import requires verified UTC
                              alignment.
                            </span>
                          </div>
                          {feedError && (
                            <p role="alert" className="text-sm text-destructive">
                              {feedError}
                            </p>
                          )}
                          {feedPreview?.sourceObservation && (
                            <>
                              <PublicSourceDetails observation={feedPreview.sourceObservation} />
                              <label className="flex items-start gap-2 text-sm">
                                <Checkbox
                                  checked={feedReviewed}
                                  disabled={creating || feedBusy}
                                  onCheckedChange={(checked) => setFeedReviewed(checked === true)}
                                />
                                I reviewed this candle source, coverage, and time basis. Publish it
                                as this profile&apos;s saved replay history when I create the
                                profile.
                              </label>
                            </>
                          )}
                          {feedPreview && !feedPreview.sourceObservation && (
                            <div className="space-y-3">
                              <p className="border p-3 text-sm">
                                {feedPreview.preview.counts.accepted ?? 0} candles staged for
                                review.
                              </p>
                              <label className="flex items-start gap-2 text-sm">
                                <Checkbox
                                  checked={feedReviewed}
                                  disabled={creating || feedBusy}
                                  onCheckedChange={(checked) => setFeedReviewed(checked === true)}
                                />
                                I reviewed these staged candles. Publish them as this profile&apos;s
                                saved replay history when I create the profile.
                              </label>
                            </div>
                          )}
                        </div>
                      )}

                      {chartDataMode === 'saved-history' && (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="profile-live-history">Saved history version</Label>
                            <select
                              id="profile-live-history"
                              className={fieldClass}
                              value={selectedVersionId}
                              disabled={historyLoading || creating}
                              onChange={(event) => setSelectedVersionId(event.target.value)}
                            >
                              <option value="">Choose saved history</option>
                              {versions.map((version) => (
                                <option key={version.id} value={version.id}>
                                  {version.name || version.metadata.symbol} ·{' '}
                                  {version.metadata.symbol} · {version.metadata.interval} ·{' '}
                                  {version.metadata.provider}
                                </option>
                              ))}
                            </select>
                            {historyLoading && (
                              <output className="text-sm">Reading owned history…</output>
                            )}
                            {historyError && (
                              <p role="alert" className="text-sm text-destructive">
                                {historyError}
                              </p>
                            )}
                            {!historyLoading && !versions.length && !historyError && (
                              <p className="text-sm text-muted-foreground">
                                No saved history is available. Download candles above or open
                                History &amp; data.
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button asChild variant="outline">
                              <Link to={datasetLibraryHref('/workspace')}>
                                Open History &amp; data
                              </Link>
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={historyLoading || creating}
                              onClick={() => setCatalogRefresh((value) => value + 1)}
                            >
                              Refresh history
                            </Button>
                          </div>
                          {selectedVersion && (
                            <div className="space-y-3 text-sm">
                              <p>
                                {selectedVersion.rowCount.toLocaleString()} candles ·{' '}
                                {new Date(selectedVersion.start * 1000).toISOString()} →{' '}
                                {new Date(selectedVersion.end * 1000).toISOString()}
                              </p>
                              <p>
                                {selectedVersion.metadata.provider} ·{' '}
                                {selectedVersion.metadata.symbol} · native{' '}
                                {selectedVersion.metadata.interval}
                              </p>
                              <label className="flex items-start gap-2">
                                <Checkbox
                                  checked={historyReviewed}
                                  disabled={creating}
                                  onCheckedChange={(checked) =>
                                    setHistoryReviewed(checked === true)
                                  }
                                />
                                I reviewed this saved history for this live chart.
                              </label>
                            </div>
                          )}
                        </div>
                      )}

                      {chartDataMode === 'later' && (
                        <p className="text-sm text-muted-foreground">
                          The profile and journal will be created, but its chart will ask you to
                          download or choose candles before it can display prices.
                        </p>
                      )}
                    </section>
                  </div>
                )}
              </div>
            )}

            {createStep === 4 && (
              <div className="space-y-5">
                <section className="border bg-muted/20 p-4" aria-label="Profile summary">
                  <h3 className="font-medium">Review</h3>
                  <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Type</dt>
                      <dd>{kind === 'live' ? 'Live channel' : 'Replay project'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Name</dt>
                      <dd>{name || 'Untitled'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Session tags</dt>
                      <dd>{tags(sessionLabel).join(', ') || 'None'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Timezone</dt>
                      <dd>{timezone}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Currency</dt>
                      <dd>{currency}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Chart default</dt>
                      <dd>
                        {kind === 'live' && chartDataMode === 'live-feed'
                          ? `${liveSymbol || '—'} · ${liveInterval}`
                          : `${defaultSymbol || '—'} · ${defaultTimeframe}`}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Mindset tracking</dt>
                      <dd>{trackEmotions ? 'On' : 'Off'}</dd>
                    </div>
                    {kind === 'live' && (
                      <>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Live chart feed</dt>
                          <dd>
                            {chartDataMode === 'live-feed'
                              ? `${selectedChartProvider.label} · ${liveSymbol} · ${liveInterval}${mt5ChartSetup ? ' · verify in Connections' : liveTestOk ? ' · tested' : ' · not tested'}`
                              : chartDataMode === 'saved-history'
                                ? selectedVersion
                                  ? `Saved history · ${selectedVersion.name || selectedVersion.metadata.symbol} · ${selectedVersion.metadata.interval}`
                                  : 'No saved history selected'
                                : 'Decide later'}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Replay history</dt>
                          <dd>
                            {chartDataMode === 'saved-history'
                              ? 'Same saved history'
                              : chartDataMode === 'live-feed' && downloadReplay
                                ? feedPreview?.sourceObservation
                                  ? `${feedPreview.sourceObservation.provider} · ${feedPreview.sourceObservation.closedRows} closed candles`
                                  : 'Download not reviewed yet'
                                : 'Decide later in History & data'}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">Account connection</dt>
                          <dd>
                            {accountMode === 'connector'
                              ? (selectedAccountProvider?.name ?? 'Choose a platform')
                              : accountMode === 'later'
                                ? 'Connect later (optional)'
                                : 'Journal only'}
                          </dd>
                        </div>
                      </>
                    )}
                    {kind === 'replay' && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Default paper starting cash</dt>
                        <dd>
                          {cashValid
                            ? formatMoney(Number(startingBalance), currency)
                            : 'Review positive cash'}
                        </dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-3 sm:col-span-2">
                      <dt className="text-muted-foreground">Next</dt>
                      <dd>
                        {kind === 'replay'
                          ? 'Replay runs'
                          : chartDataMode === 'later'
                            ? 'Finish chart-data setup'
                            : mt5ChartSetup
                              ? 'Verify MT5 in Connections'
                              : 'Open live chart'}
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>
            )}

            {createError && (
              <p role="alert" className="border border-destructive/30 p-3 text-sm text-destructive">
                {createError}
              </p>
            )}
            {creationUncertain && (
              <div className="space-y-2 text-sm">
                <p>
                  The save may already have completed. Reload Workspace and review saved profiles
                  before submitting again.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    await data.reload()
                    resetCreate()
                  }}
                >
                  Reload Workspace
                </Button>
              </div>
            )}
            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() =>
                  createStep === 1 ? setCreateOpen(false) : setCreateStep(createStep - 1)
                }
              >
                {createStep === 1 ? (
                  'Cancel'
                ) : (
                  <>
                    <ArrowLeft className="h-4 w-4" /> Back
                  </>
                )}
              </Button>
              {createStep < 4 ? (
                <Button type="submit" disabled={createStep === 2 && !step2Valid}>
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={
                    creating ||
                    creationUncertain ||
                    !step2Valid ||
                    !cashValid ||
                    !accountSetupValid ||
                    !chartDataSetupValid ||
                    (kind === 'replay' && (!selectedVersion || !historyReviewed || historyLoading))
                  }
                >
                  <Plus className="h-4 w-4" /> {creating ? 'Creating…' : 'Create profile'}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
