import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Clock3,
  Gauge,
  Layers,
  Scale,
  ShieldAlert,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import {
  COMBINED_SELECTION_KEY,
  type CombinedSelection,
  type CombinedSelectionScope,
  combinedSelectionKey,
  loadCombinedSelection,
  resolveCombinedSelection,
  sameCombinedSelection,
  saveCombinedSelection,
} from '@/lib/trader/combinedSelection'
import type { JournalTrade } from '@/lib/trader/db'
import {
  compareJournalTimestamps,
  exactDecimalNumber,
  journalTimestamp,
  journalTradeDay,
  journalTradeHour,
  journalTradeWeekday,
  realizedJournalRows,
  realizedNetMoney,
  realizedTradeRows,
  scopeJournalTrades,
  sumExactDecimals,
  tradeEventType,
  tradeMoney,
  tradeNetPnl,
  tradeReportingTimestamp,
  weekStart,
} from '@/lib/trader/journalAnalytics'
import { journalHref } from '@/lib/trader/journalNavigation'
import {
  buildDailySummaries,
  formatMoney,
  formatQuantityTotals,
  type GroupedTradeStats,
  groupTradeStats,
  summarizeCombinedProfiles,
  summarizePortfolio,
} from '@/lib/trader/metrics'
import { useTraderData } from '@/lib/trader/useTraderData'
import { pnlTone, profileHref, StatTile } from './ProfileShell'

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
const periods = [
  { value: 'all', label: 'All time', days: null },
  { value: '3m', label: '3M', days: 90 },
  { value: '1m', label: '1M', days: 30 },
  { value: '1w', label: '1W', days: 7 },
] as const
type Period = (typeof periods)[number]['value']
type ProfileSort = 'pnl' | 'profitFactor' | 'winRate' | 'trades' | 'drawdown'

function signedMoney(value: number | null | undefined, currency: string) {
  return value === null || value === undefined
    ? '—'
    : `${value > 0 ? '+' : ''}${formatMoney(value, currency)}`
}

function ratioLabel(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : value.toFixed(2)
}

function durationLabel(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function dateLabel(value: string, timezone: string) {
  const instant = journalTimestamp(value)
  if (instant === null) return value ? `${value} (source time unknown)` : '—'
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(instant)
}

function CombinedEquityChart({
  trades,
  currency,
  timezone,
}: {
  trades: JournalTrade[]
  currency: string
  timezone: string
}) {
  const closed = realizedJournalRows(trades)
    .filter(
      (trade) =>
        tradeNetPnl(trade) !== null && journalTimestamp(trade.closeDate || trade.openDate) !== null
    )
    .sort((a, b) => compareJournalTimestamps(a.closeDate || a.openDate, b.closeDate || b.openDate))
  const values = [0]
  let exact = '0'
  for (const trade of closed) {
    exact = sumExactDecimals([exact, tradeMoney(trade, 'netPnl').exact!])!
    values.push(exactDecimalNumber(exact) ?? 0)
  }
  const width = 820
  const height = 250
  const margin = { top: 16, right: 18, bottom: 28, left: 58 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pad = Math.max((rawMax - rawMin) * 0.12, Math.abs(rawMax) * 0.02, 1)
  const min = rawMin - pad
  const max = rawMax + pad
  const x = (index: number) =>
    margin.left + (values.length <= 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth)
  const y = (value: number) => margin.top + ((max - value) / (max - min || 1)) * innerHeight
  const coords = values.map((value, index) => ({ x: x(index), y: y(value), value }))
  const line = coords.map((point) => `${point.x},${point.y}`).join(' ')
  const peaks: number[] = []
  values.forEach((value, index) =>
    peaks.push(index === 0 ? value : Math.max(peaks[index - 1], value))
  )
  const peakLine = peaks.map((value, index) => `${x(index)},${y(value)}`).join(' ')
  const area = coords.length
    ? `M ${coords[0].x} ${margin.top + innerHeight} ${coords.map((point) => `L ${point.x} ${point.y}`).join(' ')} L ${coords.at(-1)?.x} ${margin.top + innerHeight} Z`
    : ''
  const ticks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4).reverse()
  const first = closed[0]
  const last = closed.at(-1)

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-64 w-full"
        role="img"
        aria-label="Combined cumulative profit and loss curve"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={margin.left}
              x2={width - margin.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="currentColor"
              strokeDasharray="3 5"
              className="text-border"
            />
            <text
              x={margin.left - 8}
              y={y(tick) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {formatMoney(tick, currency)}
            </text>
          </g>
        ))}
        {coords.length > 1 && <path d={area} className="fill-teal-600/10" />}
        {coords.length > 1 && (
          <polyline
            points={peakLine}
            fill="none"
            stroke="currentColor"
            strokeDasharray="5 5"
            strokeWidth="1.2"
            className="text-muted-foreground/60"
          />
        )}
        {coords.length > 1 ? (
          <polyline
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinejoin="round"
            strokeLinecap="round"
            className="text-teal-700 dark:text-teal-300"
          />
        ) : (
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={y(0)}
            y2={y(0)}
            stroke="currentColor"
            strokeDasharray="5 5"
            className="text-muted-foreground"
          />
        )}
        {first && (
          <text x={margin.left} y={height - 6} className="fill-muted-foreground text-[11px]">
            {journalTradeDay(first, timezone) ?? 'Unknown source time'}
          </text>
        )}
        {last && (
          <text
            x={width - margin.right}
            y={height - 6}
            textAnchor="end"
            className="fill-muted-foreground text-[11px]"
          >
            {journalTradeDay(last, timezone) ?? 'Unknown source time'}
          </text>
        )}
      </svg>
      <p className="text-xs text-muted-foreground">
        Cumulative realized journal P&amp;L across selected live profiles, including partial exits
        and fee adjustments. Deposits/withdrawals are excluded. Grey dashed line is the prior peak
        used for drawdown.
      </p>
    </div>
  )
}

function BreakdownList({
  title,
  description,
  rows,
  currency,
}: {
  title: string
  description: string
  rows: GroupedTradeStats[]
  currency: string
}) {
  const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(row.pnl)))
  const totalAbs = rows.reduce((sum, row) => sum + Math.abs(row.pnl), 0)
  const totalTrades = rows.reduce((sum, row) => sum + row.trades, 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y border-y text-sm">
          {rows.slice(0, 10).map((row, index) => (
            <div key={row.name} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium">
                    <span className="mr-2 text-xs text-muted-foreground">#{index + 1}</span>
                    {row.name}
                  </span>
                  <span className="text-muted-foreground">
                    {row.trades} exits (
                    {totalTrades ? ((row.trades / totalTrades) * 100).toFixed(0) : 0}% share) ·{' '}
                    {row.wins}W / {row.losses}L / {row.breakEven}BE · {row.winRate.toFixed(1)}% wins
                  </span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    PF {ratioLabel(row.profitFactor)} · Expectancy{' '}
                    {signedMoney(row.expectancy, currency)}
                    {row.totalR !== null ? ` · ${row.totalR.toFixed(2)}R` : ''}
                    {row.averageDurationMinutes
                      ? ` · Avg ${durationLabel(row.averageDurationMinutes)}`
                      : ''}
                  </span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    Gross {signedMoney(row.grossProfit, currency)} / −
                    {formatMoney(row.grossLoss, currency)}
                    {row.totalLots
                      ? ` · ${formatQuantityTotals(row.quantityTotals, row.totalLots)}`
                      : ''}
                    {row.totalCosts ? ` · Costs ${signedMoney(row.totalCosts, currency)}` : ''}
                    {row.totalPips
                      ? ` · ${row.totalPips > 0 ? '+' : ''}${row.totalPips.toFixed(1)} pips`
                      : ''}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`block font-semibold ${pnlTone(row.pnl)}`}>
                    {signedMoney(row.pnl, currency)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {totalAbs
                      ? `${((Math.abs(row.pnl) / totalAbs) * 100).toFixed(1)}% of |P&L|`
                      : '—'}
                  </span>
                </span>
              </div>
              <div className="mt-2 h-1.5 bg-muted" aria-hidden="true">
                <div
                  className={`h-full ${row.pnl >= 0 ? 'bg-teal-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.max(3, (Math.abs(row.pnl) / maxAbs) * 100)}%` }}
                />
              </div>
            </div>
          ))}
          {!rows.length && (
            <p className="py-4 text-muted-foreground">No realized exits in this view.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DetailRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="divide-y border-y text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 py-2.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function CombinedLiveAnalytics() {
  const data = useTraderData()
  if (data.loading && !data.workspace && data.portfolios.length === 0)
    return <p className="py-8 text-sm text-muted-foreground">Loading combined analytics…</p>
  const scope =
    data.storageMode === 'backend' && data.principalId && data.workspace?.originId
      ? { principalId: data.principalId, originId: data.workspace.originId }
      : undefined
  if (data.storageMode === 'backend' && !scope)
    return (
      <p className="py-8 text-sm text-muted-foreground">
        {data.error ?? 'Reopen the saved workspace to view combined analytics.'}
      </p>
    )
  return <CombinedPortfolioDashboard key={combinedSelectionKey(scope)} data={data} scope={scope} />
}

function CombinedPortfolioDashboard({
  data,
  scope,
}: {
  data: ReturnType<typeof useTraderData>
  scope?: CombinedSelectionScope
}) {
  const [initial] = useState(() =>
    loadCombinedSelection(scope, data.workspace?.preferences?.[COMBINED_SELECTION_KEY])
  )
  const [savedSelection, setSavedSelection] = useState(initial.selection)
  const [selectionError, setSelectionError] = useState(initial.error)
  const [currencyChoice, setCurrencyChoice] = useState(initial.selection?.currency ?? '')
  const [period, setPeriod] = useState<Period>('all')
  const [strategy, setStrategy] = useState('All')
  const [selectedProfileIds, setSelectedProfileIds] = useState<number[] | null>(
    initial.selection?.profileIds ?? null
  )
  const [profileSort, setProfileSort] = useState<ProfileSort>('pnl')
  const [timezone, setTimezone] = useState('UTC')
  const [now, setNow] = useState(() => Date.now())
  const [dayChoice, setDayChoice] = useState('')
  const [weekChoice, setWeekChoice] = useState('')
  const timezones = useMemo(
    () => [
      'UTC',
      ...((
        Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
      ).supportedValuesOf?.('timeZone') ?? [
        'Europe/London',
        'America/New_York',
        'Asia/Tokyo',
        'Asia/Kolkata',
        'Australia/Sydney',
      ]),
    ],
    []
  )
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const selection = useMemo(
    () => resolveCombinedSelection(data.portfolios, selectedProfileIds),
    [data.portfolios, selectedProfileIds]
  )
  const liveProfiles = selection.profiles
  const allCombined = useMemo(
    () => summarizeCombinedProfiles(liveProfiles, data.trades),
    [liveProfiles, data.trades]
  )
  const currencyRows = useMemo(
    () => Object.values(allCombined).sort((a, b) => b.trades - a.trades || b.netPnl - a.netPnl),
    [allCombined]
  )
  const selectedCurrency =
    currencyRows.find((row) => row.currency === currencyChoice)?.currency ??
    currencyRows[0]?.currency ??
    liveProfiles[0]?.currency.toUpperCase() ??
    'USD'
  const currencyProfiles = liveProfiles.filter(
    (portfolio) =>
      portfolio.currency.toUpperCase() === selectedCurrency ||
      data.trades.some(
        (trade) =>
          trade.portfolioId === portfolio.id && trade.currency?.toUpperCase() === selectedCurrency
      )
  )
  const effectiveSelectedIds = useMemo(() => {
    const available = new Set(currencyProfiles.map((portfolio) => portfolio.id!))
    return selection.selectedIds.filter((id) => available.has(id))
  }, [currencyProfiles, selection.selectedIds])
  const selectedProfiles = currencyProfiles.filter((portfolio) =>
    effectiveSelectedIds.includes(portfolio.id!)
  )
  const selectedProfileIdSet = useMemo(() => new Set(effectiveSelectedIds), [effectiveSelectedIds])
  const profileById = useMemo(
    () =>
      new Map(
        data.portfolios
          .filter((portfolio) => portfolio.id)
          .map((portfolio) => [portfolio.id!, portfolio])
      ),
    [data.portfolios]
  )
  const accountById = useMemo(
    () =>
      new Map(
        data.brokerAccounts.filter((account) => account.id).map((account) => [account.id!, account])
      ),
    [data.brokerAccounts]
  )

  const baseTrades = useMemo(
    () =>
      data.trades
        .filter((trade) => selectedProfileIdSet.has(trade.portfolioId))
        .map((trade) =>
          trade.currency
            ? trade
            : { ...trade, currency: profileById.get(trade.portfolioId)?.currency }
        ),
    [data.trades, selectedProfileIdSet, profileById]
  )
  const strategyOptions = useMemo(
    () => [...new Set(baseTrades.map((trade) => trade.strategy || 'Manual'))].sort(),
    [baseTrades]
  )
  const scoped = useMemo(
    () =>
      scopeJournalTrades(baseTrades, {
        period,
        strategy,
        timezone,
        now,
        currency: selectedCurrency,
        day: dayChoice,
        week: weekChoice,
      }),
    [baseTrades, period, strategy, timezone, now, selectedCurrency, dayChoice, weekChoice]
  )
  const scopedTrades = scoped.trades

  const combined = useMemo(
    () => summarizeCombinedProfiles(selectedProfiles, scopedTrades)[selectedCurrency],
    [scopedTrades, selectedCurrency, selectedProfiles]
  )
  const profileRows = useMemo(
    () =>
      selectedProfiles
        .map((portfolio) => ({
          portfolio,
          summary: summarizePortfolio(portfolio, scopedTrades, {
            currency: selectedCurrency,
            timezone,
          }),
          destinationCount: data.destinations.filter(
            (destination) => destination.portfolioId === portfolio.id
          ).length,
        }))
        .sort((a, b) => {
          if (profileSort === 'pnl') return b.summary.netPnl - a.summary.netPnl
          if (profileSort === 'profitFactor')
            return (b.summary.profitFactor ?? -1) - (a.summary.profitFactor ?? -1)
          if (profileSort === 'winRate') return b.summary.winRate - a.summary.winRate
          if (profileSort === 'trades') return b.summary.closedTrades - a.summary.closedTrades
          if (profileSort === 'drawdown')
            return a.summary.maxDrawdownCurrency - b.summary.maxDrawdownCurrency
          return b.summary.netPnl - a.summary.netPnl
        }),
    [data.destinations, profileSort, scopedTrades, selectedProfiles, selectedCurrency, timezone]
  )
  const daily = useMemo(
    () => buildDailySummaries(scopedTrades, [], timezone),
    [scopedTrades, timezone]
  )
  const weekly = useMemo(() => {
    const weeks = new Map<
      string,
      { pnl: number; trades: number; wins: number; activeDays: number }
    >()
    for (const day of daily) {
      const key = weekStart(day.date)
      const current = weeks.get(key) ?? { pnl: 0, trades: 0, wins: 0, activeDays: 0 }
      current.pnl += day.pnl
      current.trades += day.trades
      current.wins += day.wins
      current.activeDays += 1
      weeks.set(key, current)
    }
    return [...weeks.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 8)
  }, [daily])

  const breakdown = useMemo(
    () => ({
      profiles: groupTradeStats(
        scopedTrades,
        (trade) => profileById.get(trade.portfolioId)?.name ?? 'Unknown profile',
        { currency: selectedCurrency }
      ),
      symbols: groupTradeStats(scopedTrades, (trade) => trade.pair, { currency: selectedCurrency }),
      strategies: groupTradeStats(scopedTrades, (trade) => trade.strategy || 'Manual', {
        currency: selectedCurrency,
      }),
      directions: groupTradeStats(
        scopedTrades,
        (trade) =>
          tradeEventType(trade) === 'fee'
            ? 'Fee adjustments'
            : trade.direction === 'Buy'
              ? 'Long'
              : 'Short',
        { currency: selectedCurrency }
      ),
      hours: groupTradeStats(scopedTrades, (trade) => journalTradeHour(trade, timezone), {
        currency: selectedCurrency,
      }),
      weekdays: groupTradeStats(scopedTrades, (trade) => journalTradeWeekday(trade, timezone), {
        currency: selectedCurrency,
      }),
      sources: groupTradeStats(scopedTrades, (trade) => trade.origin ?? 'manual', {
        currency: selectedCurrency,
      }),
      accounts: groupTradeStats(
        scopedTrades,
        (trade) => accountById.get(trade.accountId ?? -1)?.displayName ?? 'Profile journal',
        { currency: selectedCurrency }
      ),
    }),
    [accountById, profileById, scopedTrades, selectedCurrency, timezone]
  )
  const symbolSides = useMemo(
    () =>
      breakdown.symbols.map((group) => {
        const symbolTrades = realizedTradeRows(scopedTrades).filter(
          (trade) => trade.pair === group.name && tradeNetPnl(trade) !== null
        )
        const side = (direction: 'Buy' | 'Sell') => {
          const items = symbolTrades.filter((trade) => trade.direction === direction)
          return {
            trades: items.length,
            pnl:
              exactDecimalNumber(
                sumExactDecimals(items.map((trade) => tradeMoney(trade, 'netPnl').exact!))
              ) ?? 0,
            wins: items.filter((trade) => tradeNetPnl(trade)! > 0).length,
          }
        }
        return { group, long: side('Buy'), short: side('Sell') }
      }),
    [breakdown.symbols, scopedTrades]
  )
  const recentTrades = useMemo(
    () =>
      [...scopedTrades]
        .filter((row) => tradeEventType(row) === 'trade')
        .sort((a, b) =>
          compareJournalTimestamps(tradeReportingTimestamp(b), tradeReportingTimestamp(a))
        )
        .slice(0, 12),
    [scopedTrades]
  )
  const destinationTotal = data.destinations.filter((destination) =>
    selectedProfileIdSet.has(destination.portfolioId)
  ).length

  function toggleProfile(id: number, checked: boolean) {
    const current = selection.selectedIds
    setSelectedProfileIds(
      checked ? [...new Set([...current, id])] : current.filter((item) => item !== id)
    )
    setStrategy('All')
  }

  const currentSelection: CombinedSelection = {
    version: 1,
    profileIds: selection.selectedIds,
    currency: selectedCurrency,
  }
  const selectionSaved = sameCombinedSelection(savedSelection, currentSelection)
  function saveSelection() {
    try {
      saveCombinedSelection(currentSelection, scope)
      setSavedSelection(currentSelection)
      setSelectedProfileIds(currentSelection.profileIds)
      setCurrencyChoice(currentSelection.currency)
      setSelectionError('')
    } catch {
      setSelectionError(
        'Selection could not be saved on this device. Your current choices are still available; try saving again.'
      )
    }
  }

  if (data.loading)
    return <p className="py-8 text-sm text-muted-foreground">Loading combined analytics…</p>
  if (!data.loading && liveProfiles.length === 0) {
    return (
      <div className="space-y-6 py-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/workspace">
            <ArrowLeft className="h-4 w-4" /> All profiles
          </Link>
        </Button>
        <EmptyState
          icon={BarChart3}
          title="No live profiles yet"
          description="Create a live trading profile first. Combined analytics will roll every live channel together by reporting currency."
          action={
            <Button asChild className="mt-4">
              <Link to="/workspace">Back to profiles</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const tradedProfileRows = profileRows.filter((row) => row.summary.knownPnlCount > 0)
  const bestProfile = [...tradedProfileRows].sort((a, b) => b.summary.netPnl - a.summary.netPnl)[0]
  const weakestProfile = [...tradedProfileRows].sort(
    (a, b) => a.summary.netPnl - b.summary.netPnl
  )[0]
  const bestSymbol = breakdown.symbols[0]
  const bestStrategy = breakdown.strategies[0]
  const totalAbsProfilePnl = profileRows.reduce((sum, row) => sum + Math.abs(row.summary.netPnl), 0)

  return (
    <div className="space-y-6 py-6">
      <header>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
          <Link to="/workspace">
            <ArrowLeft className="h-4 w-4" /> All profiles
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
              <BarChart3 className="h-7 w-7 text-teal-600" /> Combined live analytics
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Overall live portfolio first, then the channels, symbols, strategies, sessions, and
              trades underneath it. Each recorded account outcome remains separate. Explicit
              decision links show shared copied decisions without removing account-specific results.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {selectedProfiles.length} of {currencyProfiles.length} {selectedCurrency} profiles
              selected
            </Badge>
          </div>
        </div>
      </header>

      <section
        className="space-y-4 border bg-card p-4 shadow-xs"
        aria-label="Combined analytics filters"
      >
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="combined-currency">Reporting currency</Label>
            <select
              id="combined-currency"
              className={fieldClass}
              value={selectedCurrency}
              onChange={(event) => {
                setCurrencyChoice(event.target.value)
                setStrategy('All')
              }}
            >
              {currencyRows.map((row) => (
                <option key={row.currency} value={row.currency}>
                  {row.currency} · {row.profileCount} available portfolios
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="combined-strategy">Strategy</Label>
            <select
              id="combined-strategy"
              className={fieldClass}
              value={strategy}
              onChange={(event) => setStrategy(event.target.value)}
            >
              <option value="All">All strategies</option>
              {strategyOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="flex items-end">
            <legend className="sr-only">Combined analytics period</legend>
            <div className="flex border bg-muted/30 p-1">
              {periods.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={period === item.value}
                  onClick={() => setPeriod(item.value)}
                  className={`px-3 py-1.5 text-sm font-medium ${period === item.value ? 'bg-background shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="mt-3 space-y-2">
          <Label htmlFor="combined-timezone">Reporting timezone</Label>
          <select
            id="combined-timezone"
            className={fieldClass}
            value={timezone}
            onChange={(event) => {
              setTimezone(event.target.value)
              setDayChoice('')
              setWeekChoice('')
            }}
          >
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {scoped.fromDate
              ? `${scoped.fromDate} through ${scoped.toDate}`
              : `All known historical records through ${scoped.toDate}`}{' '}
            · {timezone}. Rolling periods end today, not at the latest stored trade.
          </p>
          {(dayChoice || weekChoice) && (
            <p className="text-sm">
              Reviewing {dayChoice || `week of ${weekChoice}`}{' '}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDayChoice('')
                  setWeekChoice('')
                }}
              >
                Clear day/week filter
              </Button>
            </p>
          )}
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Profiles included</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {currencyProfiles.map((portfolio) => {
              const checked = selectedProfileIdSet.has(portfolio.id!)
              return (
                <label
                  key={portfolio.id}
                  className={`flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm ${checked ? 'border-teal-600 bg-teal-500/5' : 'text-muted-foreground'}`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => toggleProfile(portfolio.id!, value === true)}
                  />
                  {portfolio.name}
                </label>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedProfileIds([
                  ...new Set([...selection.selectedIds, ...currencyProfiles.map((p) => p.id!)]),
                ])
                setStrategy('All')
              }}
            >
              Select all {selectedCurrency}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedProfileIds([])
                setStrategy('All')
              }}
            >
              Clear all
            </Button>
            <Button type="button" size="sm" onClick={saveSelection}>
              Save selection
            </Button>
            <output aria-live="polite" className="text-xs text-muted-foreground">
              {selectionSaved
                ? 'Selection saved on this device'
                : savedSelection
                  ? 'Unsaved selection changes'
                  : 'Selection not saved yet'}
            </output>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {selection.selectedIds.length} portfolios selected across currency groups. Currencies
            are never mixed into one money total. Clear all clears every group.
          </p>
          {selection.unavailableIds.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              {selection.unavailableIds.length} previously selected portfolios are unavailable and
              excluded. Saving updates the selection to available portfolios.
            </p>
          )}
          {selectionError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {selectionError}
            </p>
          )}
        </fieldset>
      </section>

      {!combined ? (
        <EmptyState
          icon={BarChart3}
          title="No portfolios selected in this currency"
          description="Choose portfolios above or select all in this currency group. No charts or metrics are calculated until you select a portfolio."
        />
      ) : (
        <section aria-label="Selected portfolio analysis" className="space-y-6">
          <section className="border bg-card p-4 shadow-xs" aria-labelledby="combined-intelligence">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="combined-intelligence"
                className="flex items-center gap-2 text-sm font-semibold uppercase"
              >
                <Layers className="h-4 w-4 text-teal-600" /> Portfolio intelligence
              </h2>
              <span className="text-xs text-muted-foreground">
                {periods.find((item) => item.value === period)?.label} ·{' '}
                {strategy === 'All' ? 'All strategies' : strategy}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
              {[
                ['Profiles', String(combined.profileCount)],
                ['Realized exits', String(combined.realizedExits)],
                ['Open positions', String(combined.openTrades)],
                ['Trading days', String(daily.length)],
                ['Symbols', String(breakdown.symbols.length)],
                ['Strategies', String(breakdown.strategies.length)],
                ['Destinations', String(destinationTotal)],
                ['Size by unit', formatQuantityTotals(combined.quantityTotals, combined.totalLots)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dd className="text-xl font-semibold">{value}</dd>
                  <dt className="mt-0.5 text-xs uppercase text-muted-foreground">{label}</dt>
                </div>
              ))}
            </dl>
          </section>

          <section
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Combined key metrics"
          >
            <StatTile
              label="Net P&L"
              value={signedMoney(combined.netPnl, selectedCurrency)}
              tone={pnlTone(combined.netPnl)}
              detail={`${combined.completedPositions} completed positions · ${combined.openPositions} open · ${combined.realizedExits} realized exits`}
            />
            <StatTile
              label="Expectancy"
              value={signedMoney(combined.expectancy, selectedCurrency)}
              tone={pnlTone(combined.expectancy)}
              detail={`Avg R ${combined.averageR === null ? '—' : combined.averageR.toFixed(2)} · Total ${combined.totalR === null ? '—' : `${combined.totalR.toFixed(2)}R`}`}
            />
            <StatTile
              label="Profit factor"
              value={ratioLabel(combined.profitFactor)}
              detail={`Gross ${signedMoney(combined.grossProfit, selectedCurrency)} / −${formatMoney(combined.grossLoss, selectedCurrency)}`}
            />
            <StatTile
              label="Win rate"
              value={`${combined.winRate.toFixed(1)}%`}
              detail={`${combined.wins}W · ${combined.breakEven}BE · ${combined.losses}L`}
            />
            <StatTile
              label="Max drawdown"
              value={
                combined.unknownTimeCount
                  ? '—'
                  : formatMoney(combined.maxDrawdownCurrency, selectedCurrency)
              }
              tone={combined.maxDrawdownCurrency > 0 ? 'text-red-600 dark:text-red-400' : undefined}
              detail={
                combined.unknownTimeCount
                  ? 'Unavailable: some source chronology is unknown'
                  : 'Chronological combined P&L peak-to-trough'
              }
            />
            <StatTile
              label="Avg win / loss"
              value={`${formatMoney(combined.averageWin, selectedCurrency)} / −${formatMoney(combined.averageLoss, selectedCurrency)}`}
              detail={`Best ${combined.bestTrade === null ? '—' : signedMoney(combined.bestTrade, selectedCurrency)} · Worst ${combined.worstTrade === null ? '—' : signedMoney(combined.worstTrade, selectedCurrency)}`}
            />
            <StatTile
              label="Execution costs"
              value={signedMoney(combined.totalCosts, selectedCurrency)}
              detail={`Commission ${signedMoney(combined.totalCommission, selectedCurrency)} · Swap ${signedMoney(combined.totalSwap, selectedCurrency)} · Fees ${signedMoney(combined.totalFees, selectedCurrency)}`}
            />
            <StatTile
              label="Avg duration"
              value={durationLabel(combined.averageDurationMinutes)}
              detail={`${combined.totalPips > 0 ? '+' : ''}${combined.totalPips.toFixed(1)} total pips where recorded`}
            />
          </section>

          {!combined.trades && (
            <section className="border border-amber-500/40 bg-amber-500/5 p-4">
              <h2 className="font-semibold">No realized live exits in this view yet</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The combined structure is ready. Add or sync realized exits inside a selected live
                profile, or widen the period/strategy filters.
              </p>
            </section>
          )}

          <section className="rounded-md border p-4 text-sm" aria-label="Analysis coverage">
            <p>
              {combined.realizedExits} realized exits · {combined.completedPositions} completed
              positions · {combined.openPositions} open positions · {combined.riskSampleSize}{' '}
              known-risk position samples.
            </p>
            <p>
              Win rate uses all known realized exits including break-even. Fees affect P&amp;L
              without creating a winning or losing trade. Deposits and withdrawals are excluded from
              performance.
            </p>
            <p>
              {combined.knownPnlCount} known cash observations; {combined.excludedUnknownPnlCount}{' '}
              unknown P&amp;L observations excluded. {combined.unknownCostCount} observations have
              incomplete costs; missing components stay unavailable. {combined.legacyAmountCount}{' '}
              amounts retain legacy number precision.
            </p>
            <p>
              {combined.feeAdjustmentCount} fee adjustments and {combined.cashflowCount} transfers
              are separate from trade exit counts.
            </p>
            <p>
              {combined.decisionScope.accountOutcomes} account outcomes ·{' '}
              {combined.decisionScope.linkedDecisionCount} explicitly linked decisions ·{' '}
              {combined.decisionScope.unlinkedAccountOutcomes} unlinked outcomes. Account outcomes
              are counted separately; shared decisions are never guessed.
            </p>
            {!!(combined.unknownTimeCount || scoped.excluded.unknownTime) && (
              <p>
                Unknown source times:{' '}
                {Math.max(combined.unknownTimeCount, scoped.excluded.unknownTime)}. All-time known
                amounts remain visible; bounded periods and date-specific panels exclude ambiguous
                times. Complete drawdown is unavailable until chronology is resolved.
              </p>
            )}
            <p>{combined.ratiosUnavailableReason}</p>
          </section>
          <section
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
            aria-label="Combined highlights"
          >
            {[
              [
                'Best profile',
                bestProfile
                  ? `${bestProfile.portfolio.name} · ${signedMoney(bestProfile.summary.netPnl, selectedCurrency)}`
                  : '—',
                bestProfile
                  ? `${bestProfile.summary.realizedExits} realized exits · PF ${ratioLabel(bestProfile.summary.profitFactor)}`
                  : 'No data',
              ],
              [
                'Weakest profile',
                weakestProfile
                  ? `${weakestProfile.portfolio.name} · ${signedMoney(weakestProfile.summary.netPnl, selectedCurrency)}`
                  : '—',
                weakestProfile
                  ? `${weakestProfile.summary.closedTrades} completed positions · Max DD ${formatMoney(weakestProfile.summary.maxDrawdownCurrency, selectedCurrency)}`
                  : 'No data',
              ],
              [
                'Best symbol',
                bestSymbol
                  ? `${bestSymbol.name} · ${signedMoney(bestSymbol.pnl, selectedCurrency)}`
                  : '—',
                bestSymbol
                  ? `${bestSymbol.trades} exits · PF ${ratioLabel(bestSymbol.profitFactor)}`
                  : 'No data',
              ],
              [
                'Best strategy',
                bestStrategy
                  ? `${bestStrategy.name} · ${signedMoney(bestStrategy.pnl, selectedCurrency)}`
                  : '—',
                bestStrategy
                  ? `${bestStrategy.trades} exits · Expectancy ${signedMoney(bestStrategy.expectancy, selectedCurrency)}`
                  : 'No data',
              ],
            ].map(([label, value, detail]) => (
              <div key={label} className="border bg-card p-4 shadow-xs">
                <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
                <div className="mt-2 font-semibold leading-6">{value}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</div>
              </div>
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.7fr_1fr] [&>*]:min-w-0">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {combined.netPnl >= 0 ? (
                    <TrendingUp className="h-5 w-5 text-teal-600" />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-red-500" />
                  )}
                  Combined P&amp;L &amp; drawdown
                </CardTitle>
                <CardDescription>
                  Live broker equity is not invented here. This is cumulative local journal P&amp;L
                  until account equity sync exists.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CombinedEquityChart
                  trades={scopedTrades}
                  currency={selectedCurrency}
                  timezone={timezone}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-teal-600" /> Performance &amp; risk detail
                </CardTitle>
                <CardDescription>
                  Per-trade descriptive statistics across the selected live profiles.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DetailRows
                  rows={[
                    ['Gross profit', signedMoney(combined.grossProfit, selectedCurrency)],
                    ['Gross loss', `−${formatMoney(combined.grossLoss, selectedCurrency)}`],
                    [
                      'Gross trade P&L total',
                      signedMoney(combined.grossPnlTotal, selectedCurrency),
                    ],
                    ['Average win', formatMoney(combined.averageWin, selectedCurrency)],
                    ['Average loss', `−${formatMoney(combined.averageLoss, selectedCurrency)}`],
                    [
                      'Payoff ratio',
                      combined.averageLoss > 0
                        ? ratioLabel(combined.averageWin / combined.averageLoss)
                        : '—',
                    ],
                    [
                      'P&L standard deviation',
                      combined.pnlStdDev === null
                        ? '—'
                        : formatMoney(combined.pnlStdDev, selectedCurrency),
                    ],
                    ['Sharpe (complete daily returns)', ratioLabel(combined.sharpe)],
                    ['Sortino (complete daily returns)', ratioLabel(combined.sortino)],
                    ['Total R', combined.totalR === null ? '—' : `${combined.totalR.toFixed(2)}R`],
                    [
                      'Average R',
                      combined.averageR === null ? '—' : `${combined.averageR.toFixed(2)}R`,
                    ],
                    [
                      'Average pips',
                      combined.averagePips === null
                        ? '—'
                        : `${combined.averagePips > 0 ? '+' : ''}${combined.averagePips.toFixed(1)}`,
                    ],
                  ]}
                />
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="border bg-muted/20 p-3">
                    <span className="flex items-center gap-1 font-medium">
                      <ArrowUpRight className="h-4 w-4 text-teal-600" /> Long
                    </span>
                    <strong className={pnlTone(combined.longNetPnl)}>
                      {signedMoney(combined.longNetPnl, selectedCurrency)}
                    </strong>
                    <span className="block text-muted-foreground">
                      {combined.longTrades} exits · {combined.longWinRate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="border bg-muted/20 p-3">
                    <span className="flex items-center gap-1 font-medium">
                      <ArrowDownRight className="h-4 w-4 text-red-500" /> Short
                    </span>
                    <strong className={pnlTone(combined.shortNetPnl)}>
                      {signedMoney(combined.shortNetPnl, selectedCurrency)}
                    </strong>
                    <span className="block text-muted-foreground">
                      {combined.shortTrades} exits · {combined.shortWinRate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Profile comparison</CardTitle>
                  <CardDescription>
                    Each channel keeps its own journal and risk. Contribution shows share of
                    absolute profile P&amp;L in this view.
                  </CardDescription>
                </div>
                <div className="w-52">
                  <Label htmlFor="combined-profile-sort" className="sr-only">
                    Sort profiles
                  </Label>
                  <select
                    id="combined-profile-sort"
                    className={fieldClass}
                    value={profileSort}
                    onChange={(event) => setProfileSort(event.target.value as ProfileSort)}
                  >
                    <option value="pnl">Sort: Net P&L</option>
                    <option value="profitFactor">Sort: Profit factor</option>
                    <option value="winRate">Sort: Win rate</option>
                    <option value="trades">Sort: Completed positions</option>
                    <option value="drawdown">Sort: Lowest drawdown</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-w-0">
              <div className="w-full max-w-full overflow-x-auto border">
                <table className="w-full min-w-[1180px] text-left text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Profile</th>
                      <th className="px-3 py-2 text-right font-medium">Realized exits</th>
                      <th className="px-3 py-2 text-right font-medium">Net P&L</th>
                      <th className="px-3 py-2 text-right font-medium">Contribution</th>
                      <th className="px-3 py-2 text-right font-medium">Win %</th>
                      <th className="px-3 py-2 text-right font-medium">PF</th>
                      <th className="px-3 py-2 text-right font-medium">Expectancy</th>
                      <th className="px-3 py-2 text-right font-medium">Completed positions</th>
                      <th className="px-3 py-2 text-right font-medium">Total R</th>
                      <th className="px-3 py-2 text-right font-medium">Max DD</th>
                      <th className="px-3 py-2 text-right font-medium">Avg duration</th>
                      <th className="px-3 py-2 text-right font-medium">Destinations</th>
                      <th className="px-3 py-2 text-right font-medium">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileRows.map(({ portfolio, summary, destinationCount }) => (
                      <tr key={portfolio.id} className="border-t">
                        <td className="px-3 py-3">
                          <Link
                            to={profileHref(portfolio.id!)}
                            className="font-semibold hover:underline"
                          >
                            {portfolio.name}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {portfolio.sessionLabel ?? selectedCurrency} · {summary.wins}W /{' '}
                            {summary.losses}L / {summary.breakEven}BE
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Badge variant="secondary">{summary.realizedExits}</Badge>
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-semibold ${pnlTone(summary.netPnl)}`}
                        >
                          {signedMoney(summary.netPnl, selectedCurrency)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {totalAbsProfilePnl
                            ? `${((Math.abs(summary.netPnl) / totalAbsProfilePnl) * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                        <td className="px-3 py-3 text-right">{summary.winRate.toFixed(1)}%</td>
                        <td className="px-3 py-3 text-right">{ratioLabel(summary.profitFactor)}</td>
                        <td className={`px-3 py-3 text-right ${pnlTone(summary.expectancy)}`}>
                          {signedMoney(summary.expectancy, selectedCurrency)}
                        </td>
                        <td className="px-3 py-3 text-right">{summary.closedTrades}</td>
                        <td className="px-3 py-3 text-right">
                          {summary.totalR === null ? '—' : `${summary.totalR.toFixed(2)}R`}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {formatMoney(summary.maxDrawdownCurrency, selectedCurrency)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {durationLabel(summary.averageDurationMinutes)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Badge variant="outline">{destinationCount}</Badge>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Button asChild variant="outline" size="sm">
                            <Link to={profileHref(portfolio.id!, 'journal')}>Journal</Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Strategy breakdown</CardTitle>
              <CardDescription>
                Combined strategy performance across selected live channels. Use the strategy filter
                above to isolate one.
              </CardDescription>
            </CardHeader>
            <CardContent className="min-w-0">
              <div className="w-full max-w-full overflow-x-auto border">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Strategy</th>
                      <th className="px-3 py-2 text-right font-medium">Realized exits</th>
                      <th className="px-3 py-2 text-right font-medium">Win %</th>
                      <th className="px-3 py-2 text-right font-medium">Net P&L</th>
                      <th className="px-3 py-2 text-right font-medium">PF</th>
                      <th className="px-3 py-2 text-right font-medium">Expectancy</th>
                      <th className="px-3 py-2 text-right font-medium">Total R</th>
                      <th className="px-3 py-2 text-right font-medium">Gross W / L</th>
                      <th className="px-3 py-2 text-right font-medium">Costs</th>
                      <th className="px-3 py-2 text-right font-medium">Avg duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.strategies.map((group) => (
                      <tr
                        key={group.name}
                        className="cursor-pointer border-t hover:bg-muted/30"
                        onClick={() => setStrategy(group.name)}
                        title={`Filter combined analytics to ${group.name}`}
                      >
                        <td className="px-3 py-3">
                          <strong>{group.name}</strong>
                          <span className="block text-xs text-muted-foreground">
                            {group.wins}W / {group.losses}L / {group.breakEven}BE
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">{group.trades}</td>
                        <td className="px-3 py-3 text-right">{group.winRate.toFixed(1)}%</td>
                        <td className={`px-3 py-3 text-right font-semibold ${pnlTone(group.pnl)}`}>
                          {signedMoney(group.pnl, selectedCurrency)}
                        </td>
                        <td className="px-3 py-3 text-right">{ratioLabel(group.profitFactor)}</td>
                        <td className={`px-3 py-3 text-right ${pnlTone(group.expectancy)}`}>
                          {signedMoney(group.expectancy, selectedCurrency)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {group.totalR === null ? '—' : `${group.totalR.toFixed(2)}R`}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {signedMoney(group.grossProfit, selectedCurrency)} / −
                          {formatMoney(group.grossLoss, selectedCurrency)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {group.totalCosts ? signedMoney(group.totalCosts, selectedCurrency) : '—'}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {durationLabel(group.averageDurationMinutes)}
                        </td>
                      </tr>
                    ))}
                    {!breakdown.strategies.length && (
                      <tr>
                        <td colSpan={10} className="px-3 py-4 text-muted-foreground">
                          No realized exits in this view.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {strategy !== 'All' && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Filtered to <strong className="text-foreground">{strategy}</strong>.{' '}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0"
                    onClick={() => setStrategy('All')}
                  >
                    Show all strategies
                  </Button>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Symbol by side</CardTitle>
              <CardDescription>
                Long and short results separately across all selected live profiles.
              </CardDescription>
            </CardHeader>
            <CardContent className="min-w-0">
              <div className="w-full max-w-full overflow-x-auto border">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium" rowSpan={2}>
                        Symbol
                      </th>
                      <th className="px-3 py-2 text-center font-medium" colSpan={3}>
                        Long
                      </th>
                      <th className="px-3 py-2 text-center font-medium" colSpan={3}>
                        Short
                      </th>
                      <th className="px-3 py-2 text-center font-medium" colSpan={3}>
                        Total
                      </th>
                    </tr>
                    <tr>
                      <th className="px-3 py-2 text-right font-medium">Realized exits</th>
                      <th className="px-3 py-2 text-right font-medium">Win %</th>
                      <th className="px-3 py-2 text-right font-medium">P&L</th>
                      <th className="px-3 py-2 text-right font-medium">Realized exits</th>
                      <th className="px-3 py-2 text-right font-medium">Win %</th>
                      <th className="px-3 py-2 text-right font-medium">P&L</th>
                      <th className="px-3 py-2 text-right font-medium">Realized exits</th>
                      <th className="px-3 py-2 text-right font-medium">Win %</th>
                      <th className="px-3 py-2 text-right font-medium">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {symbolSides.map(({ group, long, short }) => (
                      <tr key={group.name} className="border-t">
                        <td className="px-3 py-3 font-semibold">{group.name}</td>
                        <td className="px-3 py-3 text-right">{long.trades}</td>
                        <td className="px-3 py-3 text-right">
                          {long.trades ? `${((long.wins / long.trades) * 100).toFixed(0)}%` : '—'}
                        </td>
                        <td className={`px-3 py-3 text-right font-medium ${pnlTone(long.pnl)}`}>
                          {signedMoney(long.pnl, selectedCurrency)}
                        </td>
                        <td className="px-3 py-3 text-right">{short.trades}</td>
                        <td className="px-3 py-3 text-right">
                          {short.trades
                            ? `${((short.wins / short.trades) * 100).toFixed(0)}%`
                            : '—'}
                        </td>
                        <td className={`px-3 py-3 text-right font-medium ${pnlTone(short.pnl)}`}>
                          {signedMoney(short.pnl, selectedCurrency)}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold">{group.trades}</td>
                        <td className="px-3 py-3 text-right">{group.winRate.toFixed(0)}%</td>
                        <td className={`px-3 py-3 text-right font-semibold ${pnlTone(group.pnl)}`}>
                          {signedMoney(group.pnl, selectedCurrency)}
                        </td>
                      </tr>
                    ))}
                    {!symbolSides.length && (
                      <tr>
                        <td colSpan={10} className="px-3 py-4 text-muted-foreground">
                          No realized exits in this view.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <section className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <BreakdownList
              title="By profile"
              description="Contribution by trading channel."
              rows={breakdown.profiles}
              currency={selectedCurrency}
            />
            <BreakdownList
              title="By symbol"
              description="Where combined live money is made and lost."
              rows={breakdown.symbols}
              currency={selectedCurrency}
            />
            <BreakdownList
              title="Long vs short"
              description="Combined directional edge."
              rows={breakdown.directions}
              currency={selectedCurrency}
            />
            <BreakdownList
              title={`By realized hour (${timezone})`}
              description="Reporting-zone exit/adjustment times across selected channels. Unknown source times are separate."
              rows={breakdown.hours}
              currency={selectedCurrency}
            />
            <BreakdownList
              title="By weekday"
              description="Weekday quality in the selected view."
              rows={breakdown.weekdays}
              currency={selectedCurrency}
            />
            <BreakdownList
              title="By source"
              description="Source-origin grouping over the same selected outcomes. Account copies keep their actual outcomes."
              rows={breakdown.sources}
              currency={selectedCurrency}
            />
            <BreakdownList
              title="By account"
              description="Actual account outcomes remain separate. Explicit links count shared decisions without silently deduplicating execution outcomes."
              rows={breakdown.accounts}
              currency={selectedCurrency}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1fr_1.5fr] [&>*]:min-w-0">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-teal-600" /> Weekly digest
                </CardTitle>
                <CardDescription>Monday-start weeks across selected profiles.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="divide-y border-y text-sm">
                  {weekly.map(([week, item]) => (
                    <button
                      type="button"
                      key={week}
                      aria-label={`Review week of ${week}`}
                      onClick={() => {
                        setWeekChoice(week)
                        setDayChoice('')
                      }}
                      className="flex w-full items-center justify-between gap-3 py-3 text-left"
                    >
                      <span>
                        <span className="block font-medium">Week of {week}</span>
                        <span className="text-muted-foreground">
                          {item.trades} exits · {item.wins} wins · {item.activeDays} active days
                        </span>
                      </span>
                      <strong className={pnlTone(item.pnl)}>
                        {signedMoney(item.pnl, selectedCurrency)}
                      </strong>
                    </button>
                  ))}
                  {!weekly.length && (
                    <p className="py-4 text-muted-foreground">
                      No completed trading weeks in this view.
                    </p>
                  )}
                </div>
                <h3 className="mb-2 mt-5 font-semibold">Recent days</h3>
                <div className="divide-y border-y text-sm">
                  {daily
                    .slice(-8)
                    .reverse()
                    .map((day) => (
                      <button
                        type="button"
                        key={day.date}
                        aria-label={`Review day ${day.date}`}
                        onClick={() => {
                          setDayChoice(day.date)
                          setWeekChoice('')
                        }}
                        className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
                      >
                        <span>
                          <span className="block font-medium">{day.date}</span>
                          <span className="text-muted-foreground">
                            {day.trades} realized exits · {day.winRate.toFixed(0)}% win ·{' '}
                            {formatQuantityTotals(day.quantityTotals, day.lots)}
                          </span>
                        </span>
                        <strong className={pnlTone(day.pnl)}>
                          {signedMoney(day.pnl, selectedCurrency)}
                        </strong>
                      </button>
                    ))}
                  {!daily.length && (
                    <p className="py-4 text-muted-foreground">No trading days in this view.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent combined trades</CardTitle>
                <CardDescription>
                  Latest journal positions across selected live profiles; partial exits retain their
                  parent position.
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0">
                <div className="w-full max-w-full overflow-x-auto border">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Opened</th>
                        <th className="px-3 py-2 font-medium">Closed</th>
                        <th className="px-3 py-2 font-medium">Profile</th>
                        <th className="px-3 py-2 font-medium">Symbol</th>
                        <th className="px-3 py-2 font-medium">Side</th>
                        <th className="px-3 py-2 font-medium">Entry → Exit</th>
                        <th className="px-3 py-2 font-medium">Pips</th>
                        <th className="px-3 py-2 font-medium">Duration</th>
                        <th className="px-3 py-2 text-right font-medium">Net P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTrades.map((trade) => {
                        const profile = profileById.get(trade.portfolioId)
                        const cash = realizedNetMoney(trade)
                        const bookId =
                          data.bookAssignments?.[`journalTrades:${trade.id}`] ??
                          data.bookAssignments?.[String(trade.id)] ??
                          trade.journalBookId
                        const target = profile
                          ? journalHref(
                              profile.id!,
                              new URLSearchParams({
                                book: bookId ?? '',
                                tab: 'Trades',
                                trade: trade.id ? String(trade.id) : '',
                                timezone,
                                currency: selectedCurrency,
                                period,
                                strategy,
                                day: dayChoice,
                                week: weekChoice,
                              })
                            )
                          : ''
                        return (
                          <tr
                            key={trade.id ?? `${trade.portfolioId}-${trade.pair}-${trade.openDate}`}
                            className="border-t"
                          >
                            <td className="whitespace-nowrap px-3 py-2">
                              {dateLabel(trade.openDate, timezone)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">
                              {trade.result === 'Open'
                                ? 'Open'
                                : dateLabel(trade.closeDate || trade.openDate, timezone)}
                              <span className="block text-xs text-muted-foreground">
                                {trade.result}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {profile ? (
                                <Link className="font-medium hover:underline" to={target}>
                                  {profile.name}
                                </Link>
                              ) : (
                                'Unknown'
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <strong>{trade.pair}</strong>
                              <span className="block text-xs text-muted-foreground">
                                {trade.strategy || 'Manual'}
                                {trade.setup ? ` · ${trade.setup}` : ''}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant={trade.direction === 'Buy' ? 'default' : 'secondary'}>
                                {trade.direction === 'Buy' ? 'Long' : 'Short'}
                              </Badge>
                              <span className="block text-xs text-muted-foreground">
                                {tradeMoney(trade, 'quantity').exact ?? '—'}{' '}
                                {trade.quantityUnit ?? 'lots (legacy)'}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">
                              {tradeMoney(trade, 'entryPrice').exact ?? '—'} →{' '}
                              {tradeMoney(trade, 'exitPrice').exact ?? '—'}
                            </td>
                            <td className="px-3 py-2">
                              {typeof trade.pips === 'number'
                                ? `${trade.pips > 0 ? '+' : ''}${trade.pips.toFixed(1)}`
                                : '—'}
                            </td>
                            <td className="px-3 py-2">{durationLabel(trade.duration)}</td>
                            <td
                              className={`px-3 py-2 text-right font-semibold ${pnlTone(cash.value ?? 0)}`}
                            >
                              {signedMoney(cash.value, selectedCurrency)}
                            </td>
                          </tr>
                        )
                      })}
                      {!recentTrades.length && (
                        <tr>
                          <td colSpan={9} className="px-3 py-4 text-muted-foreground">
                            No trades in this view.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Target className="h-3.5 w-3.5" /> Expectancy and R use recorded risk only.
                  </span>
                  <span className="flex items-center gap-1">
                    <Scale className="h-3.5 w-3.5" /> Currencies stay separate.
                  </span>
                  <span className="flex items-center gap-1">
                    <Gauge className="h-3.5 w-3.5" /> Sharpe/Sortino require a complete
                    cashflow-adjusted daily excess-return series.
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock3 className="h-3.5 w-3.5" /> Hours use {timezone}; partial exits retain
                    their own dates.
                  </span>
                </p>
              </CardContent>
            </Card>
          </section>
        </section>
      )}
    </div>
  )
}
