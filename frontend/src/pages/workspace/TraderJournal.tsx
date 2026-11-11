import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BookOpenCheck,
  Brain,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Gauge,
  Layers,
  type LucideIcon,
  Plus,
  Scale,
  Search,
  ShieldAlert,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { type FormEvent, Fragment, type ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ChartEvidenceList } from '@/components/trading/ChartEvidenceList'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { recordedChartHref } from '@/lib/trader/chartEvidence'
import type { DailyState, JournalTrade, TradeDirection, TradeResult } from '@/lib/trader/db'
import {
  journalTradeDay,
  journalTradeHour,
  journalTradeWeekday,
  realizedTradeRows,
  scopeJournalTrades,
  journalTimestamp as sourceTimestamp,
  sumExactDecimals,
  tradeEventType,
  tradeMoney,
  tradeNetPnl,
  weekStart,
  zonedJournalDay,
} from '@/lib/trader/journalAnalytics'
import {
  type JournalView,
  journalHref,
  journalTabs,
  readJournalView,
  writeJournalView,
} from '@/lib/trader/journalNavigation'
import {
  buildDailySummaries,
  buildEquityCurve,
  type EquityPoint,
  formatMoney,
  formatQuantityTotals,
  type GroupedTradeStats,
  groupTradeStats,
  summarizeEmotions,
  summarizePortfolio,
} from '@/lib/trader/metrics'
import { isEmotionTrackingEnabled } from '@/lib/trader/profileModel'
import { useTraderData } from '@/lib/trader/useTraderData'
import JournalOperations from './JournalOperations'
import JournalTradeEditor, { type TradeEditorMode } from './JournalTradeEditor'
import { filteredJournalCsv } from './journalCsv'
import { downloadJournalFile } from './journalForm'
import { chartHref, JournalNavigation, pnlTone, profileHref } from './ProfileShell'

const fieldClass =
  'h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
const results: TradeResult[] = ['Win', 'Loss', 'Break Even', 'Open']
const dailyStates: DailyState[] = ['Focused', 'Steady', 'Distracted', 'Emotional', 'Exhausted']
const TRADES_PER_PAGE = 50
const tradeFilterKeys: readonly (keyof JournalView)[] = [
  'book',
  'timezone',
  'currency',
  'review',
  'week',
  'period',
  'strategy',
  'q',
  'result',
  'direction',
  'sort',
  'day',
]
const journalPeriods = [
  { value: 'all', label: 'All time', days: null },
  { value: '3m', label: '3M', days: 90 },
  { value: '1m', label: '1M', days: 30 },
  { value: '1w', label: '1W', days: 7 },
] as const
type JournalPeriod = (typeof journalPeriods)[number]['value']

function scoreLabel(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)} / 5`
}

function ratioLabel(value: number | null) {
  return value === null ? '—' : value.toFixed(2)
}

function durationLabel(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function priceLabel(value: string | null | undefined) {
  return value ?? '—'
}

function dateTimeLabel(iso: string | undefined, timezone = 'UTC') {
  if (!iso) return '—'
  if (sourceTimestamp(iso) === null) return `${iso} (source time unknown)`
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone })
}

function reportingTimestamp(trade: JournalTrade) {
  return trade.realizations?.at(-1)?.closedAt || trade.closeDate || trade.openDate
}

function signedMoney(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${formatMoney(value, currency)}`
}

function displayedPnl(trade: JournalTrade): number | null {
  if (trade.realizations?.length) {
    const total = sumExactDecimals(trade.realizations.map((event) => event.netPnl))
    return total === null ? null : Number(total)
  }
  return tradeNetPnl(trade)
}
function displayedMoney(trade: JournalTrade, key: Parameters<typeof tradeMoney>[1]): number | null {
  if (
    trade.realizations?.length &&
    ['netPnl', 'grossPnl', 'commission', 'swap', 'fees'].includes(key)
  ) {
    const values = trade.realizations.map(
      (event) => (event as unknown as Record<string, unknown>)[key]
    )
    if (values.some((value) => typeof value !== 'string')) return null
    const exact = sumExactDecimals(values as string[])
    return exact === null ? null : Number(exact)
  }
  return tradeMoney(trade, key).value
}
function displayedQuantity(trade: JournalTrade) {
  return `${tradeMoney(trade, 'quantity').exact ?? '—'} ${trade.quantityUnit ?? 'lots (legacy)'}`
}

function axisMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value)
  } catch {
    return formatMoney(value, currency)
  }
}

function EquityChart({ points, currency }: { points: EquityPoint[]; currency: string }) {
  const width = 820
  const height = 290
  const margin = { top: 18, right: 18, bottom: 30, left: 58 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom
  const values = points.map((point) => point.equity ?? point.cumulativePnl)
  const rawMin = values.length ? Math.min(...values) : 0
  const rawMax = values.length ? Math.max(...values) : 0
  const pad = Math.max((rawMax - rawMin) * 0.12, Math.abs(rawMax) * 0.02, 1)
  const min = rawMin - pad
  const max = rawMax + pad
  const x = (index: number) =>
    margin.left + (points.length <= 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth)
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
  const maxDeal = Math.max(1, ...points.map((point) => Math.abs(point.dealPnl)))
  const dealZeroY = margin.top + innerHeight * 0.72
  const barWidth = Math.max(2, Math.min(12, innerWidth / Math.max(points.length - 1, 1) / 2))
  const ticks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4).reverse()
  const last = points.at(-1)

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-72 w-full"
        role="img"
        aria-label="Equity curve with per-trade profit and loss bars"
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
              {axisMoney(tick, currency)}
            </text>
          </g>
        ))}
        {points.slice(1).map((point, index) => {
          const barHeight = Math.max(2, (Math.abs(point.dealPnl) / maxDeal) * 58)
          const barY = point.dealPnl >= 0 ? dealZeroY - barHeight : dealZeroY
          return (
            <rect
              key={`${point.date}-${index}`}
              x={x(index + 1) - barWidth / 2}
              y={barY}
              width={barWidth}
              height={barHeight}
              rx="1"
              className={point.dealPnl >= 0 ? 'fill-teal-600/35' : 'fill-red-500/35'}
            >
              <title>{`${point.date.slice(0, 10)} · ${signedMoney(point.dealPnl, currency)}`}</title>
            </rect>
          )
        })}
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
            y1={dealZeroY}
            y2={dealZeroY}
            stroke="currentColor"
            strokeDasharray="5 5"
            className="text-muted-foreground"
          />
        )}
        {points[0] && (
          <text x={margin.left} y={height - 8} className="fill-muted-foreground text-[11px]">
            {points[0].date.slice(0, 10)}
          </text>
        )}
        {last && (
          <text
            x={width - margin.right}
            y={height - 8}
            textAnchor="end"
            className="fill-muted-foreground text-[11px]"
          >
            {last.date.slice(0, 10)}
          </text>
        )}
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Teal: equity/cumulative P&amp;L · Grey dashed: peak · Bars: individual realized exits
        </span>
        <span className="font-medium text-foreground tabular-nums">
          Last{' '}
          {last?.equity !== null && last?.equity !== undefined
            ? formatMoney(last.equity, currency)
            : `${signedMoney(last?.cumulativePnl ?? 0, currency)} cumulative`}
        </span>
      </div>
    </div>
  )
}

function JournalTableFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll wide journal tables.
      tabIndex={0}
      className="min-w-0 overflow-x-auto rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </section>
  )
}

function JournalKpiCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
  children,
}: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  tone?: string
  children?: ReactNode
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-medium leading-5 text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <div
        className={`mt-2 break-words text-xl font-semibold leading-7 tracking-tight tabular-nums 2xl:text-2xl ${tone ?? ''}`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</div>
      {children}
    </div>
  )
}

function StackedActivityChart({ groups }: { groups: GroupedTradeStats[] }) {
  const max = Math.max(1, ...groups.map((group) => group.wins + group.losses + group.breakEven))
  const width = 520
  const height = 190
  const bottom = 158
  const top = 14
  const band = width / Math.max(groups.length, 1)
  const barWidth = Math.max(5, Math.min(26, band * 0.58))
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-48 w-full"
      role="img"
      aria-label="Winners and losers by time"
    >
      {groups.map((group, index) => {
        const scale = (bottom - top) / max
        const winHeight = group.wins * scale
        const beHeight = group.breakEven * scale
        const lossHeight = group.losses * scale
        const x = index * band + (band - barWidth) / 2
        const yWin = bottom - winHeight
        const yBe = yWin - beHeight
        const yLoss = yBe - lossHeight
        return (
          <g key={group.name}>
            <rect x={x} y={yWin} width={barWidth} height={winHeight} className="fill-teal-600">
              <title>{`${group.name}: ${group.wins} wins`}</title>
            </rect>
            <rect x={x} y={yBe} width={barWidth} height={beHeight} className="fill-slate-400">
              <title>{`${group.name}: ${group.breakEven} break-even`}</title>
            </rect>
            <rect x={x} y={yLoss} width={barWidth} height={lossHeight} className="fill-red-500">
              <title>{`${group.name}: ${group.losses} losses`}</title>
            </rect>
            {(groups.length <= 8 || index % 3 === 0) && (
              <text
                x={x + barWidth / 2}
                y={height - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {group.name}
              </text>
            )}
          </g>
        )
      })}
      <line
        x1="0"
        x2={width}
        y1={bottom}
        y2={bottom}
        stroke="currentColor"
        className="text-border"
      />
    </svg>
  )
}

function exportTradesCsv(
  trades: JournalTrade[],
  profileId: number,
  currency: string,
  timezone: string
) {
  downloadJournalFile(
    new Blob([filteredJournalCsv(trades, profileId, currency, timezone)], {
      type: 'text/csv;charset=utf-8',
    }),
    `chartly-journal-profile-${profileId}-displayed.csv`
  )
}

export default function TraderJournal() {
  const data = useTraderData()
  const { profileId: routeProfileId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedId = Number(routeProfileId ?? searchParams.get('portfolio'))
  const portfolio = routeProfileId
    ? data.portfolios.find((item) => item.id === requestedId)
    : (data.portfolios.find((item) => item.id === requestedId) ?? data.portfolios[0])
  const emotionTrackingEnabled = isEmotionTrackingEnabled(portfolio)
  const [reportingNow, setReportingNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setReportingNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reloaded records advance the reporting clock so a just-captured trade is immediately visible.
  useEffect(() => {
    setReportingNow(new Date())
  }, [data.trades])
  const visibleJournalTabs = emotionTrackingEnabled
    ? journalTabs
    : journalTabs.filter((tab) => tab !== 'Mind')
  const view = readJournalView(searchParams, emotionTrackingEnabled)
  const profileBooks = (data.books ?? []).filter(
    (book) => book.profileIds?.includes(portfolio?.id ?? -1) || book.profileId === portfolio?.id
  )
  const selectedBook = view.book
    ? profileBooks.find((book) => book.id === view.book)
    : profileBooks[0]
  const managedPaperRun =
    selectedBook?.kind === 'paper'
      ? data.sessions.find(
          (run) =>
            run.id === selectedBook.sessionId &&
            run.portfolioId === portfolio?.id &&
            run.paper?.version === 1
        )
      : undefined
  const paperStartingCash = managedPaperRun?.paper?.startingCash
  const paperBaselineKnown =
    !!managedPaperRun?.currency &&
    typeof paperStartingCash === 'string' &&
    Number.isFinite(Number(paperStartingCash)) &&
    Number(paperStartingCash) > 0
  const reportingPortfolio = useMemo(
    () =>
      portfolio && managedPaperRun
        ? {
            ...portfolio,
            kind: 'replay' as const,
            currency: managedPaperRun.currency ?? portfolio.currency,
            startingBalance: paperBaselineKnown ? Number(paperStartingCash) : 0,
            createdAt: managedPaperRun.createdAt,
          }
        : portfolio,
    [portfolio, managedPaperRun, paperStartingCash, paperBaselineKnown]
  )
  const manualBook = profileBooks.find((book) => book.kind === 'manual')
  const setView = (patch: Partial<JournalView>) =>
    setSearchParams(
      (current) => {
        const previous = readJournalView(current, emotionTrackingEnabled)
        const next = { ...previous, ...patch }
        if (tradeFilterKeys.some((key) => key in patch && next[key] !== previous[key])) {
          next.page = 1
          if (!('trade' in patch)) next.trade = null
        }
        return writeJournalView(next)
      },
      { replace: true }
    )
  const requestedTimezone = view.timezone ?? portfolio?.timezone ?? 'UTC'
  const timezone = useMemo(() => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: requestedTimezone }).format()
      return requestedTimezone
    } catch {
      return 'UTC'
    }
  }, [requestedTimezone])
  const reportingCurrency = view.currency ?? reportingPortfolio?.currency ?? 'USD'
  const activeTab = view.tab
  const setActiveTab = (tab: JournalView['tab']) => setView({ tab })
  const journalPeriod = view.period
  const setJournalPeriod = (period: JournalPeriod) => setView({ period })
  const journalStrategy = view.strategy
  const setJournalStrategy = (strategy: string) => setView({ strategy })
  const tradeSearch = view.q
  const setTradeSearch = (q: string) => setView({ q })
  const tradeResultFilter = view.result
  const setTradeResultFilter = (result: JournalView['result']) => setView({ result })
  const tradeDirectionFilter = view.direction
  const setTradeDirectionFilter = (direction: JournalView['direction']) => setView({ direction })
  const tradeSort = view.sort
  const setTradeSort = (sort: JournalView['sort']) => setView({ sort })
  const selectedDay = view.day
  const setSelectedDay = (day: string) => setView({ day })
  const reportingDay =
    zonedJournalDay(reportingNow.getTime(), timezone) ?? reportingNow.toISOString().slice(0, 10)
  const calendarCursor = view.month || reportingDay.slice(0, 7)
  const setCalendarCursor = (month: string) => setView({ month })
  const [logTradeOpen, setLogTradeOpen] = useState(false)
  const [editingTradeId, setEditingTradeId] = useState<number | null>(null)
  const [editorMode, setEditorMode] = useState<TradeEditorMode>('review')
  const journalContextKey = JSON.stringify([
    data.principalId,
    data.workspace?.originId,
    portfolio?.id,
    selectedBook?.id,
  ])
  const [archivedTrade, setArchivedTrade] = useState<{ id: number; context: string } | null>(null)
  const archivedTradeId = archivedTrade?.context === journalContextKey ? archivedTrade.id : null
  const [dailyStateOpen, setDailyStateOpen] = useState(false)
  const [calendarDetailDay, setCalendarDetailDay] = useState('')
  const expandedTradeId = view.trade
  const [strategySort, setStrategySort] = useState<'pnl' | 'profitFactor' | 'winRate' | 'trades'>(
    'pnl'
  )
  const [tradeFormError, setTradeFormError] = useState('')
  // biome-ignore lint/correctness/useExhaustiveDependencies: Dialogs must close when the signed-in owner, source or profile changes.
  useEffect(() => {
    setLogTradeOpen(false)
    setEditingTradeId(null)
    setDailyStateOpen(false)
    setCalendarDetailDay('')
    setTradeFormError('')
  }, [data.principalId, data.workspace?.originId, portfolio?.id])

  const [moodDate, setMoodDate] = useState(() => reportingDay)
  const [dailyState, setDailyState] = useState<DailyState>('Steady')
  const [moodScore, setMoodScore] = useState(3)
  const [energyLevel, setEnergyLevel] = useState(60)
  const [stressLevel, setStressLevel] = useState(40)
  const [sleepHours, setSleepHours] = useState('7')
  const [moodNotes, setMoodNotes] = useState('')

  const profileTrades = useMemo(
    () =>
      data.trades.filter(
        (trade) =>
          trade.portfolioId === portfolio?.id &&
          (!profileBooks.length ||
            (selectedBook &&
              (data.bookAssignments?.[`journalTrades:${trade.id}`] ??
                data.bookAssignments?.[String(trade.id)] ??
                trade.journalBookId) === selectedBook.id))
      ),
    [data.trades, data.bookAssignments, portfolio?.id, selectedBook, profileBooks.length]
  )
  const strategyOptions = useMemo(
    () => [...new Set(profileTrades.map((trade) => trade.strategy || 'Manual'))].sort(),
    [profileTrades]
  )
  const accountRows = data.workspace?.tables.brokerAccounts ?? data.brokerAccounts
  const bookCurrency = selectedBook?.accountId
    ? accountRows.find((account) => account.id === selectedBook.accountId)?.currency
    : reportingPortfolio?.currency
  const scoped = useMemo(
    () =>
      scopeJournalTrades(
        profileTrades.map((trade) =>
          trade.currency
            ? trade
            : {
                ...trade,
                currency: trade.accountId
                  ? (accountRows.find((account) => account.id === trade.accountId)?.currency ?? '')
                  : bookCurrency,
              }
        ),
        {
          period: journalPeriod,
          strategy: journalStrategy,
          timezone,
          now: reportingNow,
          currency: reportingCurrency,
          day: selectedDay || undefined,
          week: view.week || undefined,
          q: tradeSearch,
          result: tradeResultFilter,
          direction: tradeDirectionFilter,
        }
      ),
    [
      profileTrades,
      bookCurrency,
      accountRows,
      journalPeriod,
      journalStrategy,
      timezone,
      reportingNow,
      reportingCurrency,
      selectedDay,
      view.week,
      tradeSearch,
      tradeResultFilter,
      tradeDirectionFilter,
    ]
  )
  const trades = useMemo(
    () =>
      scoped.trades.filter(
        (trade) => view.review === 'All' || (trade.reviewStatus ?? 'unreviewed') === view.review
      ),
    [scoped.trades, view.review]
  )
  const moods = useMemo(
    () =>
      data.moods.filter((mood) => {
        if (
          mood.portfolioId !== portfolio?.id ||
          mood.date > scoped.toDate ||
          (scoped.fromDate && mood.date < scoped.fromDate) ||
          (selectedDay && mood.date !== selectedDay) ||
          (view.week && weekStart(mood.date) !== weekStart(view.week))
        )
          return false
        const tradeSpecific =
          journalStrategy !== 'All' ||
          !!tradeSearch ||
          tradeResultFilter !== 'All' ||
          tradeDirectionFilter !== 'All' ||
          view.review !== 'All'
        return (
          !tradeSpecific ||
          trades.some(
            (trade) =>
              journalTradeDay(trade, timezone) === mood.date ||
              trade.realizations?.some(
                (event) =>
                  journalTradeDay({ ...trade, realizations: [event] }, timezone) === mood.date
              )
          )
        )
      }),
    [
      data.moods,
      portfolio?.id,
      scoped.toDate,
      scoped.fromDate,
      selectedDay,
      view.week,
      journalStrategy,
      tradeSearch,
      tradeResultFilter,
      tradeDirectionFilter,
      view.review,
      trades,
      timezone,
    ]
  )
  const sessions = useMemo(
    () => data.sessions.filter((session) => session.portfolioId === portfolio?.id),
    [data.sessions, portfolio?.id]
  )
  const summary = useMemo(
    () =>
      reportingPortfolio
        ? summarizePortfolio(reportingPortfolio, trades, { currency: reportingCurrency })
        : null,
    [trades, reportingPortfolio, reportingCurrency]
  )
  const emotion = useMemo(
    () =>
      emotionTrackingEnabled && portfolio?.id
        ? summarizeEmotions(portfolio.id, trades, moods)
        : null,
    [moods, trades, emotionTrackingEnabled, portfolio]
  )

  const equityCurve = useMemo(
    () =>
      reportingPortfolio
        ? buildEquityCurve(reportingPortfolio, trades, { currency: reportingCurrency })
        : [],
    [reportingPortfolio, trades, reportingCurrency]
  )
  const dailySummaries = useMemo(
    () => buildDailySummaries(trades, emotionTrackingEnabled ? moods : [], timezone),
    [emotionTrackingEnabled, moods, trades, timezone]
  )
  const dailyMap = useMemo(
    () => new Map(dailySummaries.map((day) => [day.date, day])),
    [dailySummaries]
  )

  const breakdown = useMemo(
    () => ({
      symbols: groupTradeStats(trades, (trade) => trade.pair, {
        currency: reportingCurrency,
        timezone,
      }),
      strategies: groupTradeStats(trades, (trade) => trade.strategy || 'Manual', {
        currency: reportingCurrency,
        timezone,
      }),
      hours: groupTradeStats(trades, (trade) => journalTradeHour(trade, timezone)),
      weekdays: groupTradeStats(trades, (trade) => journalTradeWeekday(trade, timezone)),
      directions: groupTradeStats(trades, (trade) =>
        tradeEventType(trade) !== 'trade'
          ? 'Fee adjustments'
          : trade.direction === 'Buy'
            ? 'Long'
            : 'Short'
      ),
      origins: groupTradeStats(trades, (trade) => trade.origin ?? 'manual'),
      states: groupTradeStats(
        trades.filter((trade) => trade.preTradeState),
        (trade) => trade.preTradeState ?? 'Not recorded'
      ),
      runs: groupTradeStats(trades, (trade) => {
        const run = sessions.find((session) => session.id === trade.sessionId)
        return run?.name ?? 'Whole profile'
      }),
    }),
    [sessions, trades, timezone, reportingCurrency]
  )

  const filteredTrades = useMemo(
    () =>
      trades
        .filter((trade) => tradeEventType(trade) === 'trade')
        .sort((a, b) => {
          const difference =
            tradeSort === 'pnlDesc'
              ? (displayedPnl(b) ?? -Infinity) - (displayedPnl(a) ?? -Infinity)
              : tradeSort === 'pnlAsc'
                ? (displayedPnl(a) ?? Infinity) - (displayedPnl(b) ?? Infinity)
                : tradeSort === 'duration'
                  ? (b.duration || 0) - (a.duration || 0)
                  : 0
          return (
            difference ||
            (b.closeDate || b.openDate).localeCompare(a.closeDate || a.openDate) ||
            (b.id ?? 0) - (a.id ?? 0)
          )
        }),
    [tradeSort, trades]
  )
  const expandedTradeIndex = useMemo(
    () =>
      expandedTradeId === null
        ? -1
        : filteredTrades.findIndex((trade) => trade.id === expandedTradeId),
    [expandedTradeId, filteredTrades]
  )
  const tradePageCount = Math.max(1, Math.ceil(filteredTrades.length / TRADES_PER_PAGE))
  const tradePage =
    expandedTradeIndex >= 0
      ? 1 + Math.floor(expandedTradeIndex / TRADES_PER_PAGE)
      : Math.min(view.page, tradePageCount)
  const firstTradeIndex = (tradePage - 1) * TRADES_PER_PAGE
  const pageTrades = filteredTrades.slice(firstTradeIndex, firstTradeIndex + TRADES_PER_PAGE)
  const setExpandedTradeId = (trade: number | null) => setView({ trade, page: tradePage })

  const calendarMonth = useMemo(() => {
    const [year, month] = calendarCursor.split('-').map(Number)
    const first = new Date(Date.UTC(year, month - 1, 1))
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const mondayOffset = (first.getUTCDay() + 6) % 7
    const cells: Array<{ date: string; day: number } | null> = []
    for (let i = 0; i < mondayOffset; i++) cells.push(null)
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ date: `${calendarCursor}-${String(day).padStart(2, '0')}`, day })
    }
    while (cells.length % 7 !== 0) cells.push(null)
    const monthDays = dailySummaries.filter((day) => day.date.startsWith(calendarCursor))
    return {
      label: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      cells,
      pnl: monthDays.reduce((sum, day) => sum + day.pnl, 0),
      trades: monthDays.reduce((sum, day) => sum + day.trades, 0),
      maxAbs: Math.max(1, ...monthDays.map((day) => Math.abs(day.pnl))),
    }
  }, [calendarCursor, dailySummaries])

  const weeklyDigest = useMemo(() => {
    const weeks = new Map<string, { pnl: number; trades: number; wins: number }>()
    for (const day of dailySummaries) {
      const date = new Date(`${day.date}T00:00:00.000Z`)
      const monday = new Date(date)
      monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
      const key = monday.toISOString().slice(0, 10)
      const current = weeks.get(key) ?? { pnl: 0, trades: 0, wins: 0 }
      current.pnl += day.pnl
      current.trades += day.trades
      current.wins += day.wins
      weeks.set(key, current)
    }
    return [...weeks.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 6)
  }, [dailySummaries])

  const emptyGroup = (name: string): GroupedTradeStats => ({
    name,
    pnl: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    breakEven: 0,
    winRate: 0,
    grossProfit: 0,
    grossLoss: 0,
    profitFactor: 0,
    expectancy: 0,
    averageR: null,
    totalR: null,
    totalLots: 0,
    totalCosts: 0,
    totalPips: 0,
    averageDurationMinutes: null,
  })
  const orderedHours = Array.from({ length: 24 }, (_, hour) => {
    const name = `${String(hour).padStart(2, '0')}:00 ${timezone}`
    return breakdown.hours.find((group) => group.name === name) ?? emptyGroup(name)
  })
  const orderedWeekdays = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ].map((name) => breakdown.weekdays.find((group) => group.name === name) ?? emptyGroup(name))
  const recentTrades = useMemo(
    () =>
      [...trades]
        .sort((a, b) => (b.closeDate || b.openDate).localeCompare(a.closeDate || a.openDate))
        .slice(0, 8),
    [trades]
  )
  const strategyHealth = breakdown.strategies.map((group) => {
    return { group }
  })
  const sortedStrategyHealth = [...strategyHealth].sort((a, b) => {
    if (strategySort === 'pnl') return b.group.pnl - a.group.pnl
    if (strategySort === 'profitFactor')
      return (b.group.profitFactor ?? -1) - (a.group.profitFactor ?? -1)
    if (strategySort === 'winRate') return b.group.winRate - a.group.winRate
    if (strategySort === 'trades') return b.group.trades - a.group.trades
    return b.group.pnl - a.group.pnl
  })
  const symbolSides = useMemo(() => {
    const bySymbol = new Map<string, JournalTrade[]>()
    for (const trade of realizedTradeRows(trades)) {
      if (trade.result === 'Open' || tradeNetPnl(trade) === null) continue
      const rows = bySymbol.get(trade.pair)
      if (rows) rows.push(trade)
      else bySymbol.set(trade.pair, [trade])
    }
    return breakdown.symbols.map((group) => {
      const symbolTrades = bySymbol.get(group.name) ?? []
      const side = (direction: TradeDirection) => {
        const items = symbolTrades.filter((trade) => trade.direction === direction)
        return {
          trades: items.length,
          pnl: items.reduce((sum, trade) => sum + (displayedPnl(trade) ?? 0), 0),
          wins: items.filter((trade) => (tradeNetPnl(trade) ?? 0) > 0).length,
        }
      }
      return { group, long: side('Buy'), short: side('Sell') }
    })
  }, [breakdown.symbols, trades])
  const calendarDetailTrades = useMemo(
    () =>
      calendarDetailDay
        ? scopeJournalTrades(trades, {
            timezone,
            day: calendarDetailDay,
            now: reportingNow,
          }).trades.sort((a, b) =>
            (a.closeDate || a.openDate).localeCompare(b.closeDate || b.openDate)
          )
        : [],
    [calendarDetailDay, trades, timezone, reportingNow]
  )
  const calendarDetailSummary = useMemo(
    () =>
      reportingPortfolio
        ? summarizePortfolio(reportingPortfolio, calendarDetailTrades, {
            currency: reportingCurrency,
          })
        : null,
    [calendarDetailTrades, reportingPortfolio, reportingCurrency]
  )
  const calendarDetailMood = moods.find((mood) => mood.date === calendarDetailDay)
  const openLogTrade = () => {
    if (profileBooks.length && selectedBook?.kind !== 'manual') {
      setTradeFormError(
        'Manual entries belong to the manual book. Choose the manual book above before logging a trade.'
      )
      return
    }
    if (data.readOnly) {
      setTradeFormError('Reconnect the local engine before editing.')
      return
    }
    setActiveTab('Trades')
    setTradeFormError('')
    setEditingTradeId(null)
    setEditorMode('create')
    setLogTradeOpen(true)
  }
  const openDailyState = () => {
    setActiveTab('Mind')
    setDailyStateOpen(true)
  }

  if (!data.loading && !portfolio) {
    return (
      <EmptyState
        icon={BookOpenCheck}
        title="Journal profile not found"
        description="Choose a trading profile first. Journals no longer live outside profiles."
        action={
          <Button asChild className="mt-4">
            <Link to="/workspace">Back to profiles</Link>
          </Button>
        }
      />
    )
  }
  if (!portfolio || !summary)
    return <p className="py-8 text-sm text-muted-foreground">Loading journal…</p>
  const journalSummary = summary
  const chronologyKnown = journalSummary.unknownTimeCount === 0
  const settingsHref = `${profileHref(portfolio.id!, 'settings')}?${new URLSearchParams({ journalReturn: journalHref(portfolio.id!, searchParams) })}`

  async function addMood(event: FormEvent) {
    event.preventDefault()
    if (!portfolio?.id || !emotionTrackingEnabled) return
    const existing = moods.find((mood) => mood.date === moodDate)
    await data.saveMood({
      portfolioId: portfolio.id,
      date: moodDate,
      state: dailyState,
      moodScore,
      energyLevel,
      stressLevel,
      sleepHours: Number(sleepHours) || 0,
      // Lifestyle fields are no longer collected. Preserve historical values
      // when editing an existing day instead of inventing replacements.
      dietScore: existing?.dietScore ?? '',
      caffeineIntake: existing?.caffeineIntake ?? '',
      exercised: existing?.exercised ?? false,
      notes: moodNotes,
    })
    setMoodNotes('')
    setDailyStateOpen(false)
  }

  const breakdownTable = (title: string, rows: GroupedTradeStats[], description?: string) => {
    const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(row.pnl)))
    const totalAbs = rows.reduce((sum, row) => sum + Math.abs(row.pnl), 0)
    const totalTrades = rows.reduce((sum, row) => sum + row.trades, 0)
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {description ?? 'Ranked by net P&L. Bars show size against the strongest segment.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y border-y text-sm">
            {rows.slice(0, 12).map((row, index) => (
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
                      {row.wins}W / {row.losses}L / {row.breakEven}BE · {row.winRate.toFixed(1)}%
                      wins
                    </span>
                    <span className="block text-xs leading-5 text-muted-foreground">
                      PF {ratioLabel(row.profitFactor)} · Expectancy{' '}
                      {signedMoney(row.expectancy, reportingCurrency)}
                      {row.totalR !== null ? ` · ${row.totalR.toFixed(2)}R total` : ''}
                      {row.averageDurationMinutes
                        ? ` · Avg ${durationLabel(row.averageDurationMinutes)}`
                        : ''}
                    </span>
                    <span className="block text-xs leading-5 text-muted-foreground">
                      Gross {signedMoney(row.grossProfit, reportingCurrency)} / −
                      {formatMoney(row.grossLoss, reportingCurrency)}
                      {` · ${formatQuantityTotals(row.quantityTotals, row.totalLots)}`}
                      {row.totalCosts
                        ? ` · Costs ${signedMoney(row.totalCosts, reportingCurrency)}`
                        : ''}
                      {row.totalPips
                        ? ` · ${row.totalPips > 0 ? '+' : ''}${row.totalPips.toFixed(1)} pips`
                        : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block font-semibold ${pnlTone(row.pnl)}`}>
                      {signedMoney(row.pnl, reportingCurrency)}
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
            {!rows.length && <p className="py-4 text-muted-foreground">No realized exits yet.</p>}
          </div>
        </CardContent>
      </Card>
    )
  }

  function moveCalendarMonth(delta: number) {
    const [year, month] = calendarCursor.split('-').map(Number)
    const next = new Date(Date.UTC(year, month - 1 + delta, 1))
    setCalendarCursor(next.toISOString().slice(0, 7))
  }

  function tradeReopenContext(trade?: JournalTrade) {
    return {
      profileId: portfolio!.id!,
      runId: trade ? trade.sessionId : managedPaperRun?.id,
      tradeId: trade?.id,
      bookId: selectedBook?.id,
      journalReturn: journalHref(portfolio!.id!, searchParams),
    }
  }

  function openTradeChart(trade?: JournalTrade) {
    const href =
      recordedChartHref(trade, tradeReopenContext(trade)) ??
      chartHref(
        portfolio!.id!,
        trade ? trade.sessionId : managedPaperRun?.id,
        portfolio,
        journalHref(portfolio!.id!, searchParams),
        trade?.id,
        selectedBook?.id
      )
    return !trade && managedPaperRun ? `${href}&paper=1` : href
  }

  return (
    <div className="min-w-0 space-y-5 pb-8 pt-1 sm:space-y-6 sm:pt-3">
      <JournalNavigation
        portfolio={portfolio}
        params={searchParams}
        chartLink={managedPaperRun ? openTradeChart() : undefined}
      />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="hidden size-11 shrink-0 items-center justify-center rounded-lg border bg-card text-foreground sm:flex">
            <BookOpenCheck className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Trade Journal</h1>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
              {managedPaperRun
                ? 'Each paper run has its own starting cash and journal book.'
                : portfolio.kind === 'live'
                  ? 'Journal results reflect recorded trades. Broker balance and equity are separate account values.'
                  : 'Replay equity uses the project starting balance.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={openLogTrade}>
            <Plus className="size-4" aria-hidden /> Log trade
          </Button>
          {emotionTrackingEnabled && (
            <Button type="button" variant="outline" onClick={openDailyState}>
              <Brain className="size-4" aria-hidden /> Log daily state
            </Button>
          )}
        </div>
      </header>
      {data.error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {data.error}{' '}
          <Button variant="outline" onClick={() => void data.reload()}>
            Reload saved journal
          </Button>
        </div>
      )}
      {archivedTradeId !== null && (
        <output className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm">
          Entry archived; its source and review are retained.
          <Button
            variant="outline"
            onClick={() =>
              void data
                .restoreTrade(archivedTradeId)
                .then(() => setArchivedTrade(null))
                .catch((cause) =>
                  setTradeFormError(cause instanceof Error ? cause.message : 'Restore failed.')
                )
            }
          >
            Undo archive
          </Button>
        </output>
      )}
      {(logTradeOpen ||
        (editingTradeId !== null &&
          profileTrades.some((trade) => trade.id === editingTradeId))) && (
        <JournalTradeEditor
          key={`${data.workspace?.originId ?? 'preserved-browser'}:${selectedBook?.id ?? portfolio.id}:${editingTradeId ?? 'new'}`}
          data={data}
          portfolio={portfolio}
          bookId={selectedBook?.id ?? `manual:${portfolio.id}`}
          trade={
            editingTradeId === null
              ? undefined
              : profileTrades.find((trade) => trade.id === editingTradeId)
          }
          mode={editorMode}
          timezone={timezone}
          emotionEnabled={emotionTrackingEnabled}
          chartLink={openTradeChart(profileTrades.find((trade) => trade.id === editingTradeId))}
          reopenContext={tradeReopenContext(
            profileTrades.find((trade) => trade.id === editingTradeId)
          )}
          onClose={() => {
            setLogTradeOpen(false)
            setEditingTradeId(null)
          }}
        />
      )}

      <section
        className="space-y-3 rounded-xl border bg-card p-3 shadow-xs sm:p-4"
        aria-label="Journal reporting scope"
      >
        <div className="flex flex-wrap items-end gap-3">
          {profileBooks.length > 0 && (
            <div className="min-w-0 grow basis-full space-y-1.5 sm:basis-48">
              <Label htmlFor="journal-book">Journal book</Label>
              <select
                id="journal-book"
                className={fieldClass}
                value={selectedBook?.id ?? ''}
                onChange={(event) => {
                  setView({
                    book: event.target.value,
                    trade: null,
                    day: '',
                    strategy: 'All',
                    q: '',
                  })
                  setTradeFormError('')
                }}
              >
                {!selectedBook && <option value="">Choose a book</option>}
                {profileBooks.map((book) => {
                  const run =
                    book.kind === 'paper'
                      ? data.sessions.find(
                          (item) =>
                            item.id === book.sessionId &&
                            item.portfolioId === portfolio.id &&
                            item.paper?.version === 1
                        )
                      : undefined
                  return (
                    <option key={book.id} value={book.id}>
                      {run ? `${run.name} · Paper · Run ${run.id}` : `${book.name} · ${book.kind}`}
                    </option>
                  )
                })}
              </select>
            </div>
          )}
          <div className="min-w-0 grow basis-36 space-y-1.5">
            <Label htmlFor="journal-timezone">Reporting timezone</Label>
            <select
              id="journal-timezone"
              className={fieldClass}
              value={timezone}
              onChange={(event) => setView({ timezone: event.target.value })}
            >
              {[
                ...new Set([
                  timezone,
                  'UTC',
                  'Europe/London',
                  'America/New_York',
                  'America/Chicago',
                  'Asia/Tokyo',
                  'Asia/Kolkata',
                  'Australia/Sydney',
                ]),
              ].map((zone) => (
                <option key={zone}>{zone}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0 grow basis-28 space-y-1.5">
            <Label htmlFor="journal-currency">Reporting currency</Label>
            <select
              id="journal-currency"
              className={fieldClass}
              value={reportingCurrency}
              onChange={(event) => setView({ currency: event.target.value })}
            >
              {[
                ...new Set([
                  reportingCurrency,
                  bookCurrency ?? reportingCurrency,
                  ...profileTrades.map(
                    (trade) => trade.currency ?? bookCurrency ?? reportingCurrency
                  ),
                ]),
              ].map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0 grow basis-32 space-y-1.5">
            <Label htmlFor="journal-review-filter">Review status</Label>
            <select
              id="journal-review-filter"
              className={fieldClass}
              value={view.review}
              onChange={(event) => setView({ review: event.target.value as JournalView['review'] })}
            >
              <option value="All">All reviews</option>
              <option value="unreviewed">Unreviewed queue</option>
              <option value="reviewed">Reviewed</option>
            </select>
          </div>
          <div className="min-w-0 grow basis-40 space-y-1.5">
            <Label htmlFor="journal-strategy-filter">Strategy</Label>
            <select
              id="journal-strategy-filter"
              aria-label="Filter journal by strategy"
              className={fieldClass}
              value={journalStrategy}
              onChange={(event) => setJournalStrategy(event.target.value)}
            >
              <option value="All">All strategies</option>
              {strategyOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              setView({
                period: 'all',
                strategy: 'All',
                q: '',
                result: 'All',
                direction: 'All',
                day: '',
                week: '',
                review: 'All',
              })
            }
          >
            Clear journal filters
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <fieldset className="flex min-w-0 flex-wrap gap-0.5 rounded-lg border bg-muted/45 p-0.5">
            <legend className="sr-only">Journal period</legend>
            {journalPeriods.map((period) => (
              <button
                key={period.value}
                type="button"
                aria-pressed={journalPeriod === period.value}
                onClick={() => setJournalPeriod(period.value)}
                className={`rounded-md border border-transparent px-2.5 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${journalPeriod === period.value ? 'border-border bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {period.label}
              </button>
            ))}
          </fieldset>
          <p className="min-w-0 grow basis-64 text-xs leading-5 text-muted-foreground">
            Metrics, charts, the calendar and displayed exports follow the selected book and active
            filters. No currency conversion.{' '}
            {scoped.fromDate
              ? `${scoped.fromDate} through ${scoped.toDate}.`
              : 'All recorded dates.'}{' '}
            {selectedDay && `Day ${selectedDay}.`} {view.week && `Week of ${view.week}.`}{' '}
            {scoped.excluded.currency} other-currency entries excluded ·{' '}
            {scoped.excluded.unknownTime} unknown source timestamps
            {journalPeriod === 'all'
              ? ' retained in all-date totals; date panels exclude them.'
              : ' excluded from this dated period.'}
          </p>
        </div>
        {managedPaperRun && (
          <p className="text-xs leading-5 text-muted-foreground">
            Independent paper account: {managedPaperRun.name}.{' '}
            {paperBaselineKnown
              ? `Starting cash ${paperStartingCash} ${managedPaperRun.currency}.`
              : 'Starting cash is unavailable in this older account summary. Open its current paper account to inspect the pinned starting cash.'}{' '}
            Shown realized P&amp;L stays separate from other runs and from marked open exposure. Win
            rate and expectancy here use realized exit samples; entry fees reduce net P&amp;L
            without counting as exits. The paper account report evaluates completed positions after
            all fees.
          </p>
        )}
        {profileBooks.length > 0 && selectedBook?.kind !== 'manual' && manualBook && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setView({ book: manualBook.id, trade: null })
              setTradeFormError('')
            }}
          >
            Open manual book to log a trade
          </Button>
        )}
        {timezone !== requestedTimezone && (
          <p role="alert" className="text-sm text-destructive">
            The profile’s saved timezone is invalid. This view explicitly reports in UTC; choose the
            intended valid timezone before reviewing local dates.
          </p>
        )}
      </section>
      <JournalOperations
        data={data}
        portfolio={portfolio}
        bookId={selectedBook?.id}
        timezone={timezone}
        currency={reportingCurrency}
        strategy={journalStrategy}
        trades={trades}
        filters={{
          period: journalPeriod,
          q: tradeSearch,
          result: tradeResultFilter,
          direction: tradeDirectionFilter,
          review: view.review,
        }}
        initialDay={selectedDay}
        initialWeek={view.week}
        onBook={(book) => setView({ book, trade: null, day: '', week: '', q: '', strategy: 'All' })}
        onTrade={(id) => {
          if (profileTrades.some((trade) => trade.id === id)) {
            setView({
              tab: 'Trades',
              trade: id,
              period: 'all',
              q: '',
              result: 'All',
              direction: 'All',
              review: 'All',
              strategy: 'All',
              day: '',
              week: '',
            })
            if (tradeEventType(profileTrades.find((trade) => trade.id === id)!) !== 'trade') {
              setEditingTradeId(id)
              setEditorMode('review')
            }
          } else
            setTradeFormError(
              'That retained entry is archived or outside this book. Review Storage & recovery instead of opening another account.'
            )
        }}
      />
      {tradeFormError && !logTradeOpen && (
        <p role="alert" className="text-sm text-destructive">
          {tradeFormError}
        </p>
      )}

      <nav aria-label="Journal sections" className="flex flex-wrap gap-1 border-b">
        {visibleJournalTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            aria-pressed={activeTab === tab}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
              activeTab === tab
                ? 'border-foreground bg-muted/45 text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/35 hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === 'Overview' && (
        <section className="space-y-4">
          <section
            className="rounded-xl border bg-card p-4 shadow-xs sm:p-5"
            aria-labelledby="profile-intelligence"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="profile-intelligence"
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <Activity className="size-4 text-muted-foreground" aria-hidden /> Profile
                intelligence
              </h2>
              <span className="text-xs text-muted-foreground">
                {journalPeriods.find((period) => period.value === journalPeriod)?.label} ·{' '}
                {journalStrategy === 'All' ? 'All strategies' : journalStrategy}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
              {[
                ['Realized exits', String(journalSummary.realizedExits)],
                ['Trading days', String(dailySummaries.length)],
                ['Symbols', String(breakdown.symbols.length)],
                ['Strategies', String(breakdown.strategies.length)],
                [
                  'Size by unit',
                  formatQuantityTotals(journalSummary.quantityTotals, journalSummary.totalLots),
                ],
                ['Long win %', `${journalSummary.longWinRate.toFixed(1)}%`],
                ['Short win %', `${journalSummary.shortWinRate.toFixed(1)}%`],
                [
                  'Current streak',
                  !chronologyKnown
                    ? '—'
                    : journalSummary.currentStreak > 0
                      ? `${journalSummary.currentStreak}W`
                      : journalSummary.currentStreak < 0
                        ? `${Math.abs(journalSummary.currentStreak)}L`
                        : '—',
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex min-w-0 flex-col gap-1 border-t pt-2.5">
                  <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                  <dd className="break-words text-xl font-semibold tracking-tight tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section
            className="grid grid-cols-2 gap-3 md:grid-cols-4 min-[1400px]:grid-cols-7"
            aria-label="Journal key metrics"
          >
            <JournalKpiCard
              label="Net P&L"
              value={signedMoney(journalSummary.netPnl, reportingCurrency)}
              detail={`${journalSummary.realizedExits} realized exits · ${journalSummary.openTrades} open positions`}
              icon={journalSummary.netPnl >= 0 ? TrendingUp : TrendingDown}
              tone={pnlTone(journalSummary.netPnl)}
            />
            <JournalKpiCard
              label={
                reportingPortfolio?.kind === 'live' ? 'Broker balance' : 'Starting + shown P&L'
              }
              value={
                summary.balance === null
                  ? reportingPortfolio?.kind === 'live'
                    ? 'Sync pending'
                    : '—'
                  : formatMoney(summary.balance, reportingCurrency)
              }
              detail={
                summary.balance === null
                  ? managedPaperRun && !paperBaselineKnown
                    ? 'Paper starting cash unavailable; no project balance substituted'
                    : reportingPortfolio?.kind === 'live'
                      ? 'Broker equity is not connected yet'
                      : `Starting balance is ${reportingPortfolio?.currency}; no FX conversion`
                  : `${summary.returnPct === null ? '' : `${summary.returnPct >= 0 ? '+' : ''}${summary.returnPct.toFixed(2)}% · `}starting baseline plus filtered realized P&L`
              }
              icon={Wallet}
            />
            <JournalKpiCard
              label="Expectancy"
              value={signedMoney(journalSummary.expectancy, reportingCurrency)}
              detail={`Expected per realized exit · Avg R ${journalSummary.averageR === null ? '—' : journalSummary.averageR.toFixed(2)}`}
              icon={Target}
              tone={pnlTone(journalSummary.expectancy)}
            />
            <JournalKpiCard
              label="Profit factor"
              value={ratioLabel(journalSummary.profitFactor)}
              detail="Gross wins divided by gross losses · target 1.50"
              icon={Scale}
            >
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div
                  className="h-full bg-teal-600"
                  style={{
                    width: `${journalSummary.profitFactor === null ? 100 : Math.min(100, (journalSummary.profitFactor / 1.5) * 100)}%`,
                  }}
                />
              </div>
            </JournalKpiCard>
            <JournalKpiCard
              label="Win rate"
              value={`${journalSummary.winRate.toFixed(1)}%`}
              detail={`${journalSummary.wins}W · ${journalSummary.breakEven}BE · ${journalSummary.losses}L`}
              icon={Gauge}
            >
              <div
                className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <span
                  className="bg-teal-600"
                  style={{
                    width: `${journalSummary.realizedExits ? (journalSummary.wins / journalSummary.realizedExits) * 100 : 0}%`,
                  }}
                />
                <span
                  className="bg-slate-400"
                  style={{
                    width: `${journalSummary.realizedExits ? (journalSummary.breakEven / journalSummary.realizedExits) * 100 : 0}%`,
                  }}
                />
                <span
                  className="bg-red-500"
                  style={{
                    width: `${journalSummary.realizedExits ? (journalSummary.losses / journalSummary.realizedExits) * 100 : 0}%`,
                  }}
                />
              </div>
            </JournalKpiCard>
            <JournalKpiCard
              label="Max drawdown"
              value={
                !chronologyKnown
                  ? '—'
                  : journalSummary.maxDrawdownPct === null
                    ? formatMoney(journalSummary.maxDrawdownCurrency, reportingCurrency)
                    : `${journalSummary.maxDrawdownPct.toFixed(2)}%`
              }
              detail={
                !chronologyKnown
                  ? 'Unknown source timestamps prevent a reliable chronology'
                  : journalSummary.maxDrawdownPct === null
                    ? `Worst loss streak ${signedMoney(journalSummary.worstLossStreakAmount, reportingCurrency)}`
                    : `${formatMoney(journalSummary.maxDrawdownCurrency, reportingCurrency)} from peak`
              }
              icon={ShieldAlert}
              tone={
                journalSummary.maxDrawdownCurrency > 0
                  ? 'text-red-600 dark:text-red-400'
                  : undefined
              }
            />
            <JournalKpiCard
              label="Avg duration"
              value={durationLabel(journalSummary.averageDurationMinutes)}
              detail={`${journalSummary.realizedExits} realized exits in view`}
              icon={Clock3}
            />
          </section>

          {!journalSummary.realizedExits && (
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/35 p-4">
              <div>
                <h2 className="font-semibold">
                  This journal is ready, but it has no realized exits yet
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                  The panels below stay visible so you can see what will be measured. Add a manual
                  trade now, or use the chart and journal the result; automatic broker sync comes
                  with the connector phase.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={openLogTrade}>
                  Add manual trade
                </Button>
                <Button asChild>
                  <Link to={openTradeChart()}>Open chart</Link>
                </Button>
              </div>
            </section>
          )}

          <div className="grid gap-4 xl:grid-cols-[2fr_1fr] [&>*]:min-w-0">
            <Card>
              <CardHeader>
                <CardTitle>
                  {reportingPortfolio?.kind === 'live' ||
                  reportingCurrency !== reportingPortfolio?.currency ||
                  (managedPaperRun && !paperBaselineKnown)
                    ? 'Cumulative journal P&L'
                    : 'Starting balance + shown P&L'}
                </CardTitle>
                <CardDescription>
                  {managedPaperRun && !paperBaselineKnown
                    ? 'Cumulative realized journal P&L only. This older paper summary has no verified starting cash; the project starting balance is not substituted.'
                    : reportingPortfolio?.kind === 'live'
                      ? 'Cumulative local journal P&L until broker equity sync exists. It is not presented as account equity.'
                      : reportingCurrency !== reportingPortfolio?.currency
                        ? `Native ${reportingCurrency} P&L only. The ${reportingPortfolio?.currency} starting balance is not converted.`
                        : managedPaperRun
                          ? 'This paper run’s starting cash plus the realized P&L matching these filters. Open exposure is excluded; this is not marked account equity.'
                          : 'Project starting baseline plus the realized P&L matching these filters; this is not a current full-account balance.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EquityChart points={equityCurve} currency={reportingCurrency} />
                {!journalSummary.realizedExits && (
                  <p className="mt-3 rounded-lg border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                    No realized exits in this view yet. The first realized exit will turn this flat
                    baseline into an equity curve with per-trade bars.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sample &amp; coverage</CardTitle>
                <CardDescription>
                  Transparent counts for the displayed journal scope.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-muted-foreground">Completed positions</dt>
                    <dd className="font-semibold">{journalSummary.closedTrades}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Open positions</dt>
                    <dd className="font-semibold">{journalSummary.openTrades}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Realized exits</dt>
                    <dd className="font-semibold">{journalSummary.realizedExits}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Known P&amp;L samples</dt>
                    <dd className="font-semibold">{journalSummary.knownPnlCount}</dd>
                  </div>
                </dl>
                <p className="text-muted-foreground">
                  Win rate includes break-even exits in its denominator. Risk ratios use only
                  explicit positive risk. Annualized ratios require a complete return series.
                </p>
                <p className="text-muted-foreground">
                  {journalSummary.excludedUnknownPnlCount} unknown P&amp;L values ·{' '}
                  {journalSummary.unknownCostCount} incomplete cost records ·{' '}
                  {journalSummary.unknownTimeCount} unknown source timestamps.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Performance detail</CardTitle>
                <CardDescription>Realized exits in this profile.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Gross profit', formatMoney(journalSummary.grossProfit, reportingCurrency)],
                    ['Gross loss', formatMoney(-journalSummary.grossLoss, reportingCurrency)],
                    ['Average win', formatMoney(journalSummary.averageWin, reportingCurrency)],
                    ['Average loss', formatMoney(-journalSummary.averageLoss, reportingCurrency)],
                    [
                      'Best exit',
                      journalSummary.bestTrade === null
                        ? '—'
                        : formatMoney(journalSummary.bestTrade, reportingCurrency),
                    ],
                    [
                      'Worst exit',
                      journalSummary.worstTrade === null
                        ? '—'
                        : formatMoney(journalSummary.worstTrade, reportingCurrency),
                    ],
                    [
                      'Average R',
                      journalSummary.averageR === null
                        ? '—'
                        : `${journalSummary.averageR.toFixed(2)}R`,
                    ],
                    [
                      'Total R',
                      journalSummary.totalR === null ? '—' : `${journalSummary.totalR.toFixed(2)}R`,
                    ],
                    ['Avg duration', durationLabel(journalSummary.averageDurationMinutes)],
                    ['Break-even', String(journalSummary.breakEven)],
                  ].map(([label, value]) => (
                    <div key={label} className="border bg-muted/20 p-3">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="mt-1 font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Risk & consistency</CardTitle>
                <CardDescription>{journalSummary.ratiosUnavailableReason}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Sharpe (daily)', ratioLabel(journalSummary.sharpe)],
                    ['Sortino (daily)', ratioLabel(journalSummary.sortino)],
                    [
                      'Max win streak',
                      !chronologyKnown
                        ? '—'
                        : `${journalSummary.maxWinStreak} · ${signedMoney(journalSummary.bestWinStreakAmount, reportingCurrency)}`,
                    ],
                    [
                      'Max loss streak',
                      !chronologyKnown
                        ? '—'
                        : `${journalSummary.maxLossStreak} · ${signedMoney(journalSummary.worstLossStreakAmount, reportingCurrency)}`,
                    ],
                    [
                      'Current streak',
                      !chronologyKnown
                        ? '—'
                        : journalSummary.currentStreak > 0
                          ? `${journalSummary.currentStreak} wins`
                          : journalSummary.currentStreak < 0
                            ? `${Math.abs(journalSummary.currentStreak)} losses`
                            : '—',
                    ],
                    [
                      'P&L volatility',
                      journalSummary.pnlStdDev === null
                        ? '—'
                        : formatMoney(journalSummary.pnlStdDev, reportingCurrency),
                    ],
                    [
                      'Longs',
                      `${journalSummary.longTrades} · ${journalSummary.longWinRate.toFixed(1)}%`,
                    ],
                    [
                      'Shorts',
                      `${journalSummary.shortTrades} · ${journalSummary.shortWinRate.toFixed(1)}%`,
                    ],
                    ['Long P&L', formatMoney(journalSummary.longNetPnl, reportingCurrency)],
                    ['Short P&L', formatMoney(journalSummary.shortNetPnl, reportingCurrency)],
                  ].map(([label, value]) => (
                    <div key={label} className="border bg-muted/20 p-3">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="mt-1 font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-teal-600" />{' '}
                  {emotionTrackingEnabled ? 'Today’s state' : 'Mindset tracking'}
                </CardTitle>
                <CardDescription>
                  {emotionTrackingEnabled
                    ? 'Optional and never blocks the chart.'
                    : 'Off for this profile.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {emotionTrackingEnabled ? (
                  <>
                    {moods.find((mood) => mood.date === reportingDay) ? (
                      <p className="text-sm">
                        Today’s state is saved. Update it any time in the Mind tab.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          No daily state saved for today.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setActiveTab('Mind')}
                        >
                          Save daily state
                        </Button>
                      </div>
                    )}
                    <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                      {[
                        ['FOMO', scoreLabel(emotion?.fomo ?? null)],
                        ['Discipline', scoreLabel(emotion?.discipline ?? null)],
                        ['Patience', scoreLabel(emotion?.patience ?? null)],
                        ['Confidence', scoreLabel(emotion?.confidence ?? null)],
                      ].map(([label, value]) => (
                        <div key={label} className="border bg-muted/20 p-3">
                          <span className="block text-muted-foreground">{label}</span>
                          <strong>{value}</strong>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm leading-6 text-muted-foreground">
                      No daily or per-trade emotion prompts are shown for this profile. Turn it on
                      only if you want mindset check-ins and Mind analytics.
                    </p>
                    <Button asChild variant="outline">
                      <Link to={settingsHref}>Manage in Settings</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <section
            className="grid gap-4 xl:grid-cols-[1.45fr_1fr] [&>*]:min-w-0"
            aria-label="Strategy and symbol drivers"
          >
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-teal-600" /> Strategy health
                </CardTitle>
                <CardDescription>
                  Select a strategy to filter every journal view. Each statistic uses the displayed
                  sample of realized exits.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {strategyHealth.length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {strategyHealth.slice(0, 6).map(({ group }) => (
                      <button
                        key={group.name}
                        type="button"
                        onClick={() => setJournalStrategy(group.name)}
                        aria-pressed={journalStrategy === group.name}
                        className={`border p-3 text-left transition-colors hover:bg-muted/30 ${journalStrategy === group.name ? 'border-teal-600 bg-teal-600/5' : ''}`}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="font-semibold">{group.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {group.trades} realized exits
                          </span>
                        </span>
                        <span className={`mt-1 block text-sm font-medium ${pnlTone(group.pnl)}`}>
                          {signedMoney(group.pnl, reportingCurrency)} · {group.winRate.toFixed(0)}%
                          win · PF {ratioLabel(group.profitFactor)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {group.trades} exits · expectancy{' '}
                          {signedMoney(group.expectancy, reportingCurrency)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="border bg-muted/20 p-4 text-sm text-muted-foreground">
                    Strategy health appears after the first realized exit. Strategies are read from
                    each trade, so no separate setup is needed.
                  </p>
                )}
                {strategyHealth.length > 1 && (
                  <div className="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-3">
                    <div className="bg-muted/20 p-3">
                      <span className="block text-muted-foreground">Best expectancy</span>
                      <strong>
                        {
                          [...strategyHealth].sort(
                            (a, b) => b.group.expectancy - a.group.expectancy
                          )[0]?.group.name
                        }
                      </strong>
                      <span className="block text-muted-foreground">
                        {signedMoney(
                          [...strategyHealth].sort(
                            (a, b) => b.group.expectancy - a.group.expectancy
                          )[0]?.group.expectancy ?? 0,
                          reportingCurrency
                        )}{' '}
                        per trade
                      </span>
                    </div>
                    <div className="bg-muted/20 p-3">
                      <span className="block text-muted-foreground">
                        Lowest expectancy in this sample
                      </span>
                      <strong>
                        {
                          [...strategyHealth].sort(
                            (a, b) => a.group.expectancy - b.group.expectancy
                          )[0]?.group.name
                        }
                      </strong>
                      <span className="block text-muted-foreground">
                        {signedMoney(
                          [...strategyHealth].sort(
                            (a, b) => a.group.expectancy - b.group.expectancy
                          )[0]?.group.expectancy ?? 0,
                          reportingCurrency
                        )}{' '}
                        per realized exit
                      </span>
                    </div>
                    <div className="bg-muted/20 p-3">
                      <span className="block text-muted-foreground">Most active</span>
                      <strong>
                        {
                          [...strategyHealth].sort((a, b) => b.group.trades - a.group.trades)[0]
                            ?.group.name
                        }
                      </strong>
                      <span className="block text-muted-foreground">
                        {[...strategyHealth].sort((a, b) => b.group.trades - a.group.trades)[0]
                          ?.group.trades ?? 0}{' '}
                        realized exits
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Symbol & side drivers</CardTitle>
                <CardDescription>
                  Where this profile is making and losing money in the selected view.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {breakdown.symbols.slice(0, 6).map((group) => {
                  const maxAbs = Math.max(1, ...breakdown.symbols.map((item) => Math.abs(item.pnl)))
                  return (
                    <div key={group.name} className="border bg-muted/10 p-3">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-semibold">{group.name}</span>
                        <span className={`font-semibold ${pnlTone(group.pnl)}`}>
                          {signedMoney(group.pnl, reportingCurrency)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {group.trades} exits · {group.winRate.toFixed(1)}% win · PF{' '}
                        {ratioLabel(group.profitFactor)}
                      </div>
                      <div className="mt-2 h-1.5 bg-muted" aria-hidden="true">
                        <div
                          className={`h-full ${group.pnl >= 0 ? 'bg-teal-600' : 'bg-red-500'}`}
                          style={{ width: `${Math.max(3, (Math.abs(group.pnl) / maxAbs) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
                {!breakdown.symbols.length && (
                  <p className="border bg-muted/20 p-4 text-sm text-muted-foreground">
                    Symbol ranking appears after realized exits exist.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                  <div>
                    <span className="flex items-center gap-1 font-medium">
                      <ArrowUpRight className="h-4 w-4 text-teal-600" /> Long
                    </span>
                    <strong className={pnlTone(journalSummary.longNetPnl)}>
                      {signedMoney(journalSummary.longNetPnl, reportingCurrency)}
                    </strong>
                    <span className="block text-muted-foreground">
                      {journalSummary.longTrades} exits · {journalSummary.longWinRate.toFixed(1)}%
                    </span>
                  </div>
                  <div>
                    <span className="flex items-center gap-1 font-medium">
                      <ArrowDownRight className="h-4 w-4 text-red-500" /> Short
                    </span>
                    <strong className={pnlTone(journalSummary.shortNetPnl)}>
                      {signedMoney(journalSummary.shortNetPnl, reportingCurrency)}
                    </strong>
                    <span className="block text-muted-foreground">
                      {journalSummary.shortTrades} exits · {journalSummary.shortWinRate.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section
            className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0"
            aria-label="Trading time patterns"
          >
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Winners vs losers — by hour ({timezone})</CardTitle>
                <CardDescription>
                  Hourly pattern tells you whether a session is helping or hurting this channel.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StackedActivityChart groups={orderedHours} />
                <p className="mt-2 flex gap-4 text-xs text-muted-foreground">
                  <span className="text-teal-700 dark:text-teal-300">■ Wins</span>
                  <span>■ Break-even</span>
                  <span className="text-rose-700 dark:text-rose-400">■ Losses</span>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Winners vs losers — by weekday</CardTitle>
                <CardDescription>
                  Weekday pattern for the selected period and strategy.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StackedActivityChart groups={orderedWeekdays} />
                <p className="mt-2 flex gap-4 text-xs text-muted-foreground">
                  <span className="text-teal-700 dark:text-teal-300">■ Wins</span>
                  <span>■ Break-even</span>
                  <span className="text-rose-700 dark:text-rose-400">■ Losses</span>
                </p>
              </CardContent>
            </Card>
          </section>

          <section
            className="grid gap-4 xl:grid-cols-[1fr_1.7fr] [&>*]:min-w-0"
            aria-label="Weekly digest and recent trades"
          >
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-teal-600" /> Weekly digest
                </CardTitle>
                <CardDescription>
                  Recent trading weeks. Open Calendar for the full month heatmap.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {weeklyDigest.slice(0, 4).map(([week, values]) => (
                  <button
                    key={week}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 border bg-muted/10 p-3 text-left hover:bg-muted/30"
                    onClick={() => {
                      setView({ week, day: '', month: week.slice(0, 7), tab: 'Calendar' })
                    }}
                  >
                    <span>
                      <span className="block font-medium">Week of {week}</span>
                      <span className="text-sm text-muted-foreground">
                        {values.trades} exits · {values.wins} wins
                      </span>
                    </span>
                    <strong className={pnlTone(values.pnl)}>
                      {signedMoney(values.pnl, reportingCurrency)}
                    </strong>
                  </button>
                ))}
                {!weeklyDigest.length && (
                  <p className="border bg-muted/20 p-4 text-sm text-muted-foreground">
                    Weekly totals appear after the first realized exit.
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setActiveTab('Calendar')}
                >
                  Open calendar
                </Button>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Recent trades</CardTitle>
                    <CardDescription>
                      Latest journal activity. Full filters, notes, export, and manual entry live in
                      Trades.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTab('Trades')}
                  >
                    View all trades
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {recentTrades.length ? (
                  <JournalTableFrame label="Recent trades table">
                    <table className="w-full min-w-[680px] text-left text-sm tabular-nums">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Latest selected exit</th>
                          <th className="px-3 py-2 font-medium">Symbol</th>
                          <th className="px-3 py-2 font-medium">Side</th>
                          <th className="px-3 py-2 font-medium">Strategy</th>
                          <th className="px-3 py-2 font-medium">Duration</th>
                          <th className="px-3 py-2 font-medium">R</th>
                          <th className="px-3 py-2 text-right font-medium">Net P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recentTrades.map((trade) => (
                          <tr
                            key={trade.id ?? `${trade.pair}-${trade.closeDate}`}
                            className="border-t"
                          >
                            <td className="whitespace-nowrap px-3 py-2">
                              {dateTimeLabel(reportingTimestamp(trade), timezone)}
                            </td>
                            <td className="px-3 py-2">
                              <strong>{trade.pair}</strong>
                              <span className="block text-xs text-muted-foreground">
                                {trade.timeframe}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant={trade.direction === 'Buy' ? 'default' : 'secondary'}>
                                {trade.direction === 'Buy' ? 'Long' : 'Short'}
                              </Badge>
                              <span className="block text-xs text-muted-foreground">
                                {trade.result}
                              </span>
                            </td>
                            <td className="px-3 py-2">{trade.strategy || 'Manual'}</td>
                            <td className="px-3 py-2">{durationLabel(trade.duration)}</td>
                            <td className="px-3 py-2">
                              {typeof trade.rMultiple === 'number'
                                ? `${trade.rMultiple.toFixed(2)}R`
                                : '—'}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-semibold ${pnlTone(displayedPnl(trade) ?? 0)}`}
                            >
                              {signedMoney(displayedPnl(trade), reportingCurrency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </JournalTableFrame>
                ) : (
                  <p className="border bg-muted/20 p-4 text-sm text-muted-foreground">
                    No trades in this view. Change the period/strategy filter or add the first trade
                    from the empty-state action above.
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
        </section>
      )}

      {activeTab === 'Calendar' && (
        <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-teal-600" /> {calendarMonth.label}
                  </CardTitle>
                  <CardDescription>
                    Select any day to see its P&L, win rate, volume, costs, and every trade that
                    closed that day.
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Previous month"
                    onClick={() => moveCalendarMonth(-1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCalendarCursor(reportingDay.slice(0, 7))}
                  >
                    This month
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Next month"
                    onClick={() => moveCalendarMonth(1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {(() => {
                const monthDays = dailySummaries.filter((day) =>
                  day.date.startsWith(calendarCursor)
                )
                const monthWins = monthDays.reduce((sum, day) => sum + day.wins, 0)
                return (
                  <dl className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[
                      ['Month P&L', signedMoney(calendarMonth.pnl, reportingCurrency)],
                      ['Realized exits', String(calendarMonth.trades)],
                      ['Trading days', String(monthDays.length)],
                      [
                        'Win rate',
                        calendarMonth.trades
                          ? `${((monthWins / calendarMonth.trades) * 100).toFixed(1)}%`
                          : '—',
                      ],
                    ].map(([label, value]) => (
                      <div key={label} className="border bg-muted/20 p-3">
                        <dd
                          className={`text-lg font-semibold ${label === 'Month P&L' ? pnlTone(calendarMonth.pnl) : ''}`}
                        >
                          {value}
                        </dd>
                        <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
                      </div>
                    ))}
                  </dl>
                )
              })()}
              <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                  <div key={day} className="py-1">
                    {day}
                  </div>
                ))}
                {calendarMonth.cells.map((cell, index) => {
                  if (!cell) return <div key={`empty-${index}`} className="min-h-20 bg-muted/20" />
                  const item = dailyMap.get(cell.date)
                  const intensity = item
                    ? Math.min(0.28, 0.06 + (Math.abs(item.pnl) / calendarMonth.maxAbs) * 0.22)
                    : 0
                  return (
                    <button
                      key={cell.date}
                      type="button"
                      onClick={() => {
                        setSelectedDay(cell.date)
                        setCalendarDetailDay(cell.date)
                      }}
                      className={`min-h-20 border p-2 text-left hover:border-teal-600 ${calendarDetailDay === cell.date ? 'ring-2 ring-teal-600 ring-inset' : ''}`}
                      style={{
                        backgroundColor: item
                          ? item.pnl >= 0
                            ? `rgba(13,148,136,${intensity})`
                            : `rgba(220,38,38,${intensity})`
                          : undefined,
                      }}
                      aria-label={
                        item
                          ? `View ${cell.date}: ${formatMoney(item.pnl, reportingCurrency)}, ${item.trades} exits`
                          : `View ${cell.date}: no trades`
                      }
                    >
                      <span className="block text-xs font-medium">{cell.day}</span>
                      {item && (
                        <>
                          <span className={`mt-1 block text-sm font-semibold ${pnlTone(item.pnl)}`}>
                            {formatMoney(item.pnl, reportingCurrency)}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {item.trades} exits · {item.winRate.toFixed(0)}%
                          </span>
                          {item.moodState && (
                            <span className="mt-1 block text-[11px]">{item.moodState}</span>
                          )}
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
              {!dailySummaries.length && (
                <p className="mt-4 text-sm text-muted-foreground">
                  Trading days will appear after realized exits are logged or synced.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Weekly digest</CardTitle>
              <CardDescription>Recent Monday-start weeks in this profile.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="divide-y border-y text-sm">
                {weeklyDigest.map(([week, item]) => (
                  <div key={week} className="flex items-center justify-between gap-3 py-3">
                    <span>
                      <span className="block font-medium">Week of {week}</span>
                      <span className="text-muted-foreground">
                        {item.trades} exits · {item.wins} wins
                      </span>
                    </span>
                    <span className={`font-semibold ${pnlTone(item.pnl)}`}>
                      {formatMoney(item.pnl, reportingCurrency)}
                    </span>
                  </div>
                ))}
                {!weeklyDigest.length && (
                  <p className="py-4 text-muted-foreground">No completed trading weeks yet.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Dialog
            open={Boolean(calendarDetailDay)}
            onOpenChange={(open) => !open && setCalendarDetailDay('')}
          >
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>
                  {calendarDetailDay
                    ? new Date(`${calendarDetailDay}T00:00:00.000Z`).toLocaleDateString('en-GB', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })
                    : 'Trading day'}
                </DialogTitle>
                <DialogDescription>
                  Realized exits and adjustments on this day in {portfolio.name}.
                </DialogDescription>
              </DialogHeader>
              {calendarDetailSummary &&
              (calendarDetailSummary.realizedExits > 0 ||
                calendarDetailSummary.feeAdjustmentCount > 0 ||
                calendarDetailSummary.cashflowCount > 0) ? (
                <div className="space-y-5">
                  <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {[
                      ['Net P&L', signedMoney(calendarDetailSummary.netPnl, reportingCurrency)],
                      ['Realized exits', String(calendarDetailSummary.realizedExits)],
                      ['Win rate', `${calendarDetailSummary.winRate.toFixed(1)}%`],
                      ['Profit factor', ratioLabel(calendarDetailSummary.profitFactor)],
                      [
                        'Gross profit',
                        signedMoney(calendarDetailSummary.grossProfit, reportingCurrency),
                      ],
                      [
                        'Gross loss',
                        `−${formatMoney(calendarDetailSummary.grossLoss, reportingCurrency)}`,
                      ],
                      [
                        'Size by unit',
                        formatQuantityTotals(
                          calendarDetailSummary.quantityTotals,
                          calendarDetailSummary.totalLots
                        ),
                      ],
                      ['Avg duration', durationLabel(calendarDetailSummary.averageDurationMinutes)],
                      [
                        'Total R',
                        calendarDetailSummary.totalR === null
                          ? '—'
                          : `${calendarDetailSummary.totalR.toFixed(2)}R`,
                      ],
                      ['Costs', signedMoney(calendarDetailSummary.totalCosts, reportingCurrency)],
                      [
                        'Pips',
                        calendarDetailSummary.averagePips === null
                          ? '—'
                          : `${calendarDetailSummary.totalPips > 0 ? '+' : ''}${calendarDetailSummary.totalPips.toFixed(1)}`,
                      ],
                      [
                        'Best / worst',
                        `${calendarDetailSummary.bestTrade === null ? '—' : signedMoney(calendarDetailSummary.bestTrade, reportingCurrency)} / ${calendarDetailSummary.worstTrade === null ? '—' : signedMoney(calendarDetailSummary.worstTrade, reportingCurrency)}`,
                      ],
                    ].map(([label, value]) => (
                      <div key={label} className="border bg-muted/20 p-3">
                        <dd className="font-semibold">{value}</dd>
                        <dt className="mt-0.5 text-xs uppercase text-muted-foreground">{label}</dt>
                      </div>
                    ))}
                  </dl>
                  {emotionTrackingEnabled && calendarDetailMood && (
                    <p className="border bg-muted/20 p-3 text-sm">
                      <strong>Daily state:</strong>{' '}
                      {calendarDetailMood.state ?? `Mood ${calendarDetailMood.moodScore}/5`} · Mood{' '}
                      {calendarDetailMood.moodScore}/5 · Energy {calendarDetailMood.energyLevel}% ·
                      Stress {calendarDetailMood.stressLevel}% · Sleep{' '}
                      {calendarDetailMood.sleepHours}h
                      {calendarDetailMood.notes ? (
                        <span className="block text-muted-foreground">
                          {calendarDetailMood.notes}
                        </span>
                      ) : null}
                    </p>
                  )}
                  <div>
                    <h3 className="mb-2 font-semibold">Included exits and account entries</h3>
                    <div className="divide-y border-y">
                      {calendarDetailTrades.map((trade) => (
                        <div
                          key={trade.id ?? `${trade.pair}-${trade.openDate}`}
                          className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm"
                        >
                          <span>
                            <span className="font-semibold">{trade.pair}</span>{' '}
                            <Badge variant={trade.direction === 'Buy' ? 'default' : 'secondary'}>
                              {tradeEventType(trade) === 'trade'
                                ? trade.direction === 'Buy'
                                  ? 'Long'
                                  : 'Short'
                                : tradeEventType(trade)}
                            </Badge>
                            <span className="block text-muted-foreground">
                              {tradeEventType(trade) === 'trade'
                                ? `Opened ${dateTimeLabel(trade.openDate, timezone)} → Selected exit `
                                : 'Recorded '}
                              {dateTimeLabel(reportingTimestamp(trade), timezone)}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {trade.strategy || 'Manual'}
                              {trade.setup ? ` · ${trade.setup}` : ''} · {displayedQuantity(trade)}{' '}
                              · {durationLabel(trade.duration)}
                              {typeof trade.rMultiple === 'number'
                                ? ` · ${trade.rMultiple.toFixed(2)}R`
                                : ''}
                            </span>
                          </span>
                          <strong className={pnlTone(displayedPnl(trade) ?? 0)}>
                            {signedMoney(displayedPnl(trade), reportingCurrency)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCalendarDetailDay('')
                        openLogTrade()
                      }}
                    >
                      <Plus className="h-4 w-4" /> Log trade
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        setCalendarDetailDay('')
                        setActiveTab('Trades')
                      }}
                    >
                      View in Trades
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="border bg-muted/20 p-4 text-sm text-muted-foreground">
                    No realized exits on this day in the current strategy/period view.
                  </p>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCalendarDetailDay('')}
                    >
                      Close
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        setCalendarDetailDay('')
                        openLogTrade()
                      }}
                    >
                      <Plus className="h-4 w-4" /> Log trade
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </section>
      )}

      {activeTab === 'Breakdown' &&
        (summary.realizedExits === 0 ? (
          <EmptyState
            icon={BookOpenCheck}
            title="No breakdown yet"
            description="Symbol, strategy, run, direction, hour, and weekday breakdowns appear after the first realized exit."
          />
        ) : (
          <section className="space-y-4">
            {(() => {
              const bestSymbol = breakdown.symbols[0]
              const worstSymbol = breakdown.symbols.at(-1)
              const bestStrategy = sortedStrategyHealth[0]
              const bestHour = breakdown.hours[0]
              const worstHour = breakdown.hours.at(-1)
              const longGroup = breakdown.directions.find((group) => group.name === 'Long')
              const shortGroup = breakdown.directions.find((group) => group.name === 'Short')
              return (
                <section
                  className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"
                  aria-label="Breakdown highlights"
                >
                  {[
                    [
                      'Best symbol',
                      bestSymbol
                        ? `${bestSymbol.name} · ${signedMoney(bestSymbol.pnl, reportingCurrency)}`
                        : '—',
                      bestSymbol
                        ? `${bestSymbol.trades} exits · PF ${ratioLabel(bestSymbol.profitFactor)}`
                        : 'No data',
                    ],
                    [
                      'Weakest symbol',
                      worstSymbol
                        ? `${worstSymbol.name} · ${signedMoney(worstSymbol.pnl, reportingCurrency)}`
                        : '—',
                      worstSymbol
                        ? `${worstSymbol.trades} exits · ${worstSymbol.winRate.toFixed(1)}% wins`
                        : 'No data',
                    ],
                    [
                      'Top strategy',
                      bestStrategy
                        ? `${bestStrategy.group.name} · ${bestStrategy.group.trades} exits`
                        : '—',
                      bestStrategy
                        ? `${signedMoney(bestStrategy.group.pnl, reportingCurrency)} · PF ${ratioLabel(bestStrategy.group.profitFactor)}`
                        : 'No data',
                    ],
                    [
                      'Best / worst hour',
                      bestHour && worstHour ? `${bestHour.name} / ${worstHour.name}` : '—',
                      bestHour && worstHour
                        ? `${signedMoney(bestHour.pnl, reportingCurrency)} vs ${signedMoney(worstHour.pnl, reportingCurrency)}`
                        : 'No data',
                    ],
                    [
                      'Long vs short edge',
                      longGroup && shortGroup
                        ? `${signedMoney(longGroup.pnl - shortGroup.pnl, reportingCurrency)} long edge`
                        : '—',
                      longGroup && shortGroup
                        ? `Long PF ${ratioLabel(longGroup.profitFactor)} · Short PF ${ratioLabel(shortGroup.profitFactor)}`
                        : 'No data',
                    ],
                  ].map(([label, value, detail]) => (
                    <div key={label} className="min-w-0 rounded-xl border bg-card p-4 shadow-xs">
                      <div className="text-xs font-medium uppercase text-muted-foreground">
                        {label}
                      </div>
                      <div className="mt-2 font-semibold leading-6">{value}</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</div>
                    </div>
                  ))}
                </section>
              )
            })()}

            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Strategy comparison</CardTitle>
                    <CardDescription>
                      Click a strategy to filter the whole journal. Statistics describe the
                      displayed sample; they are not a ranking of future performance.
                    </CardDescription>
                  </div>
                  <div className="w-48">
                    <Label htmlFor="strategy-sort" className="sr-only">
                      Sort strategies
                    </Label>
                    <select
                      id="strategy-sort"
                      className={fieldClass}
                      value={strategySort}
                      onChange={(event) =>
                        setStrategySort(event.target.value as typeof strategySort)
                      }
                    >
                      <option value="pnl">Sort: Net P&L</option>
                      <option value="profitFactor">Sort: Profit factor</option>
                      <option value="winRate">Sort: Win rate</option>
                      <option value="trades">Sort: Realized exits</option>
                    </select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <JournalTableFrame label="Strategy results table">
                  <table className="w-full min-w-[980px] text-left text-sm tabular-nums">
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
                        <th className="px-3 py-2 text-right font-medium">Avg duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedStrategyHealth.map(({ group }) => (
                        <tr
                          key={group.name}
                          className="cursor-pointer border-t hover:bg-muted/30"
                          onClick={() => setJournalStrategy(group.name)}
                          title={`Filter journal to ${group.name}`}
                        >
                          <td className="px-3 py-3">
                            <strong>{group.name}</strong>
                            <span className="block text-xs text-muted-foreground">
                              {group.wins}W / {group.losses}L / {group.breakEven}BE
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">{group.trades}</td>
                          <td className="px-3 py-3 text-right">{group.winRate.toFixed(1)}%</td>
                          <td
                            className={`px-3 py-3 text-right font-semibold ${pnlTone(group.pnl)}`}
                          >
                            {signedMoney(group.pnl, reportingCurrency)}
                          </td>
                          <td className="px-3 py-3 text-right">{ratioLabel(group.profitFactor)}</td>
                          <td className={`px-3 py-3 text-right ${pnlTone(group.expectancy)}`}>
                            {signedMoney(group.expectancy, reportingCurrency)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {group.totalR === null ? '—' : `${group.totalR.toFixed(2)}R`}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {signedMoney(group.grossProfit, reportingCurrency)} / −
                            {formatMoney(group.grossLoss, reportingCurrency)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {durationLabel(group.averageDurationMinutes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </JournalTableFrame>
                {journalStrategy !== 'All' && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Journal is filtered to{' '}
                    <strong className="text-foreground">{journalStrategy}</strong>.{' '}
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => setJournalStrategy('All')}
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
                  Long and short results separately. This exposes symbols that only work in one
                  direction.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <JournalTableFrame label="Symbol by side table">
                  <table className="w-full min-w-[900px] text-left text-sm tabular-nums">
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
                            {signedMoney(long.pnl, reportingCurrency)}
                          </td>
                          <td className="px-3 py-3 text-right">{short.trades}</td>
                          <td className="px-3 py-3 text-right">
                            {short.trades
                              ? `${((short.wins / short.trades) * 100).toFixed(0)}%`
                              : '—'}
                          </td>
                          <td className={`px-3 py-3 text-right font-medium ${pnlTone(short.pnl)}`}>
                            {signedMoney(short.pnl, reportingCurrency)}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold">{group.trades}</td>
                          <td className="px-3 py-3 text-right">{group.winRate.toFixed(0)}%</td>
                          <td
                            className={`px-3 py-3 text-right font-semibold ${pnlTone(group.pnl)}`}
                          >
                            {signedMoney(group.pnl, reportingCurrency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </JournalTableFrame>
              </CardContent>
            </Card>

            <section className="grid gap-4 lg:grid-cols-2">
              {breakdownTable(
                'By symbol',
                breakdown.symbols,
                'Where money is made and lost, with gross wins/losses and costs.'
              )}
              {breakdownTable(
                'By replay run / scope',
                breakdown.runs,
                'Replay runs stay separate from whole-profile records.'
              )}
              {breakdownTable(
                'Long vs short',
                breakdown.directions,
                'Direction edge for this channel in the selected view.'
              )}
              {breakdownTable(
                'By source',
                breakdown.origins,
                'Manual, replay, import, or future connector records.'
              )}
              {breakdownTable(
                `By closing hour (${timezone})`,
                breakdown.hours,
                'Session timing matters: compare expectancy, not just trade count.'
              )}
              {breakdownTable(
                'By weekday',
                breakdown.weekdays,
                'Weekday quality for the selected period and strategy.'
              )}
              {emotionTrackingEnabled &&
                breakdown.states.length > 0 &&
                breakdownTable(
                  'By pre-trade state',
                  breakdown.states,
                  'Only trades with an explicit mindset check-in are included.'
                )}
            </section>
          </section>
        ))}

      {emotionTrackingEnabled && activeTab === 'Mind' && (
        <section className="grid gap-4 xl:grid-cols-[1fr_1.2fr] [&>*]:min-w-0">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-teal-600" /> Daily check-in
                </CardTitle>
                <CardDescription>
                  Optional. One quick entry per profile per day. Logging opens in a dialog so this
                  page stays focused on patterns.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(() => {
                  const latest = [...moods].sort((a, b) => b.date.localeCompare(a.date))[0]
                  return latest ? (
                    <div className="border bg-muted/20 p-4 text-sm">
                      <div className="font-semibold">
                        {latest.date} · {latest.state ?? `Mood ${latest.moodScore}/5`}
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        Mood {latest.moodScore}/5 · Energy {latest.energyLevel}% · Stress{' '}
                        {latest.stressLevel}% · Sleep {latest.sleepHours}h
                      </div>
                      {latest.notes && <p className="mt-2 text-muted-foreground">{latest.notes}</p>}
                    </div>
                  ) : (
                    <p className="border bg-muted/20 p-4 text-sm text-muted-foreground">
                      No daily state logged yet. Add one only if you want mindset patterns beside
                      results.
                    </p>
                  )
                })()}
                <Button type="button" className="w-full" onClick={() => setDailyStateOpen(true)}>
                  <Plus className="h-4 w-4" /> Log daily state
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  Existing entries stay saved even if mindset tracking is later turned off in
                  Settings.
                </p>
              </CardContent>
            </Card>
          </div>

          <Dialog open={dailyStateOpen} onOpenChange={setDailyStateOpen}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Log daily state</DialogTitle>
                <DialogDescription>
                  One quick optional entry per profile per day: state, mood, energy, stress, sleep,
                  and a note.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={addMood} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="mood-date">Date</Label>
                    <Input
                      id="mood-date"
                      type="date"
                      value={moodDate}
                      onChange={(event) => setMoodDate(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="daily-state">State</Label>
                    <select
                      id="daily-state"
                      className={fieldClass}
                      value={dailyState}
                      onChange={(event) => setDailyState(event.target.value as DailyState)}
                    >
                      {dailyStates.map((state) => (
                        <option key={state}>{state}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {[
                  ['Mood', moodScore, setMoodScore, 1, 5, ' / 5'],
                  ['Energy', energyLevel, setEnergyLevel, 1, 100, '%'],
                  ['Stress', stressLevel, setStressLevel, 1, 100, '%'],
                ].map(([label, value, setter, min, max, suffix]) => (
                  <div key={label as string} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <Label htmlFor={`daily-${label}`}>{label as string}</Label>
                      <span>
                        {value as number}
                        {suffix as string}
                      </span>
                    </div>
                    <input
                      id={`daily-${label}`}
                      type="range"
                      min={min as number}
                      max={max as number}
                      value={value as number}
                      onChange={(event) =>
                        (setter as (next: number) => void)(Number(event.target.value))
                      }
                      className="w-full accent-teal-600"
                    />
                  </div>
                ))}
                <div className="space-y-2">
                  <Label htmlFor="mood-sleep">Sleep (hours)</Label>
                  <Input
                    id="mood-sleep"
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={sleepHours}
                    onChange={(event) => setSleepHours(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mood-notes">Notes</Label>
                  <Textarea
                    id="mood-notes"
                    rows={3}
                    value={moodNotes}
                    onChange={(event) => setMoodNotes(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setDailyStateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Save daily state</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <div className="space-y-4">
            {breakdownTable('Results by pre-trade state', breakdown.states)}
            <Card>
              <CardHeader>
                <CardTitle>Recent daily state</CardTitle>
                <CardDescription>
                  Sample sizes matter; treat patterns as prompts to review, not proof.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {moods.slice(0, 7).map((mood) => (
                  <div
                    key={mood.id}
                    className="flex items-start justify-between gap-3 border-b pb-3 text-sm"
                  >
                    <span>
                      <span className="block font-medium">
                        {mood.date} · {mood.state ?? `Mood ${mood.moodScore}/5`}
                      </span>
                      <span className="text-muted-foreground">
                        Sleep {mood.sleepHours}h · Energy {mood.energyLevel}% · Stress{' '}
                        {mood.stressLevel}%
                      </span>
                      {mood.notes && (
                        <span className="block text-muted-foreground">{mood.notes}</span>
                      )}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Archive mood for ${mood.date}`}
                      onClick={() => {
                        if (
                          mood.id &&
                          window.confirm(
                            'Archive this daily state? The record is retained and can be restored in Storage & recovery.'
                          )
                        )
                          void data.deleteMood(mood.id)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {!moods.length && (
                  <p className="text-sm text-muted-foreground">No daily state entries yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {activeTab === 'Trades' && (
        <section className="space-y-4">
          <Card className="min-w-0">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Trade log</CardTitle>
                  <CardDescription>
                    {portfolio.kind === 'live'
                      ? 'Manual entries and confirmed trades from imports or connection reads appear in the selected book. Update a connected book through Connections → Read history; startup sync is not enabled.'
                      : 'Replay decisions and outcomes for this project.'}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={openLogTrade}>
                    <Plus className="h-4 w-4" /> Log trade
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!filteredTrades.length}
                    onClick={() =>
                      portfolio.id &&
                      exportTradesCsv(filteredTrades, portfolio.id, reportingCurrency, timezone)
                    }
                  >
                    <Download className="h-4 w-4" /> Export CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {profileTrades.length > 0 && (
                <div className="mb-4 grid gap-3 rounded-lg border bg-muted/35 p-3 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      aria-label="Search trades"
                      value={tradeSearch}
                      onChange={(event) => setTradeSearch(event.target.value)}
                      placeholder="Search symbol, strategy, run, account…"
                      className="pl-9"
                    />
                  </div>
                  <select
                    aria-label="Filter by result"
                    className={fieldClass}
                    value={tradeResultFilter}
                    onChange={(event) =>
                      setTradeResultFilter(event.target.value as 'All' | TradeResult)
                    }
                  >
                    <option value="All">All results</option>
                    {results.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by direction"
                    className={fieldClass}
                    value={tradeDirectionFilter}
                    onChange={(event) =>
                      setTradeDirectionFilter(event.target.value as 'All' | TradeDirection)
                    }
                  >
                    <option value="All">Long & short</option>
                    <option value="Buy">Long (Buy)</option>
                    <option value="Sell">Short (Sell)</option>
                  </select>
                  <select
                    aria-label="Sort trades"
                    className={fieldClass}
                    value={tradeSort}
                    onChange={(event) => setTradeSort(event.target.value as typeof tradeSort)}
                  >
                    <option value="newest">Newest first</option>
                    <option value="pnlDesc">Highest P&L</option>
                    <option value="pnlAsc">Lowest P&L</option>
                    <option value="duration">Longest duration</option>
                  </select>
                  {selectedDay && (
                    <div className="col-span-full flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary">Day: {selectedDay}</Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedDay('')}
                      >
                        Clear day filter
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {filteredTrades.length ? (
                <JournalTableFrame label="Trade log horizontal scroll area">
                  <table
                    aria-label="Trade log"
                    className="w-full min-w-[1180px] text-left text-sm tabular-nums"
                  >
                    <thead className="bg-muted/55 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Opened</th>
                        <th className="px-3 py-2 font-medium">Closed</th>
                        <th className="px-3 py-2 font-medium">Symbol</th>
                        <th className="px-3 py-2 font-medium">Side</th>
                        <th className="px-3 py-2 font-medium">Strategy / setup</th>
                        <th className="px-3 py-2 font-medium">Size</th>
                        <th className="px-3 py-2 font-medium">Entry → Exit</th>
                        <th className="px-3 py-2 font-medium">Pips</th>
                        <th className="px-3 py-2 font-medium">Duration</th>
                        <th className="px-3 py-2 font-medium">R</th>
                        {emotionTrackingEnabled && <th className="px-3 py-2 font-medium">State</th>}
                        <th className="px-3 py-2 text-right font-medium">Net P&L</th>
                        <th className="px-3 py-2">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageTrades.map((trade) => {
                        const run = sessions.find((session) => session.id === trade.sessionId)
                        const account = data.brokerAccounts.find(
                          (item) => item.id === trade.accountId
                        )
                        const expanded = expandedTradeId === trade.id
                        const parts = [
                          displayedMoney(trade, 'commission'),
                          displayedMoney(trade, 'swap'),
                          displayedMoney(trade, 'fees'),
                        ]
                        const costs = parts.every((value) => value !== null)
                          ? parts[0]! + parts[2]! + (trade.amounts ? -parts[1]! : parts[1]!)
                          : null
                        return (
                          <Fragment key={trade.id}>
                            <tr
                              className={`border-t align-top transition-colors hover:bg-muted/35 focus-within:bg-muted/35 ${expanded ? 'bg-muted/35' : ''}`}
                            >
                              <td className="whitespace-nowrap px-3 py-3">
                                {dateTimeLabel(trade.openDate, timezone)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3">
                                {trade.result === 'Open'
                                  ? 'Open'
                                  : dateTimeLabel(trade.closeDate, timezone)}
                                <span className="block text-xs text-muted-foreground">
                                  {trade.result === 'Open' ? 'Not closed' : timezone}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <span className="font-semibold">{trade.pair}</span>
                                <span className="block text-xs text-muted-foreground">
                                  {trade.timeframe} · {trade.origin ?? 'manual'}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <Badge
                                  variant={trade.direction === 'Buy' ? 'default' : 'secondary'}
                                >
                                  {trade.direction === 'Buy' ? 'Long' : 'Short'}
                                </Badge>
                                <span className="block text-xs text-muted-foreground">
                                  {trade.result}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                {trade.strategy}
                                <span className="block text-xs text-muted-foreground">
                                  {trade.setup ??
                                    run?.name ??
                                    account?.displayName ??
                                    'Whole profile'}
                                </span>
                              </td>
                              <td className="px-3 py-3">{displayedQuantity(trade)}</td>
                              <td className="whitespace-nowrap px-3 py-3">
                                {priceLabel(tradeMoney(trade, 'entryPrice').exact)} →{' '}
                                {priceLabel(tradeMoney(trade, 'exitPrice').exact)}
                              </td>
                              <td
                                className={`px-3 py-3 ${typeof trade.pips === 'number' ? pnlTone(trade.pips) : ''}`}
                              >
                                {typeof trade.pips === 'number'
                                  ? `${trade.pips > 0 ? '+' : ''}${trade.pips.toFixed(1)}`
                                  : '—'}
                              </td>
                              <td className="px-3 py-3">{durationLabel(trade.duration)}</td>
                              <td className="px-3 py-3">
                                {typeof trade.rMultiple === 'number'
                                  ? `${trade.rMultiple.toFixed(2)}R`
                                  : '—'}
                              </td>
                              {emotionTrackingEnabled && (
                                <td className="px-3 py-3">
                                  {trade.preTradeState ?? 'Not recorded'}
                                  <span className="block text-xs text-muted-foreground">
                                    {trade.emotion
                                      ? `D ${trade.emotion.discipline}/5 · C ${trade.emotion.confidence}/5`
                                      : 'No mindset scores'}
                                  </span>
                                </td>
                              )}
                              <td
                                className={`whitespace-nowrap px-3 py-3 text-right font-semibold ${pnlTone(displayedPnl(trade) ?? 0)}`}
                              >
                                {formatMoney(displayedPnl(trade), reportingCurrency)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`${expanded ? 'Hide' : 'Show'} ${trade.pair} trade details`}
                                  aria-expanded={expanded}
                                  onClick={() =>
                                    setExpandedTradeId(expanded ? null : (trade.id ?? null))
                                  }
                                >
                                  <ChevronDown
                                    className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                                  />
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={data.readOnly}
                                  onClick={() => {
                                    setEditingTradeId(trade.id ?? null)
                                    setEditorMode('review')
                                  }}
                                >
                                  Review / edit
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Archive ${trade.pair} trade`}
                                  onClick={() => {
                                    if (
                                      trade.id &&
                                      window.confirm(
                                        `Archive this ${trade.pair} trade? The record is retained and can be restored in Storage & recovery.`
                                      )
                                    )
                                      void data
                                        .deleteTrade(trade.id)
                                        .then(() =>
                                          setArchivedTrade({
                                            id: trade.id!,
                                            context: journalContextKey,
                                          })
                                        )
                                        .catch((cause) =>
                                          setTradeFormError(
                                            cause instanceof Error
                                              ? cause.message
                                              : 'Archive failed.'
                                          )
                                        )
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                            {expanded && (
                              <tr key={`${trade.id}-details`} className="border-t bg-muted/20">
                                <td
                                  colSpan={emotionTrackingEnabled ? 13 : 12}
                                  className="px-4 py-4"
                                >
                                  <div className="grid gap-4 lg:grid-cols-3">
                                    <section>
                                      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                                        Execution
                                      </h3>
                                      <dl className="mt-2 space-y-1.5 text-sm">
                                        <div className="flex justify-between gap-3">
                                          <dt>Opened</dt>
                                          <dd className="text-right">
                                            {dateTimeLabel(trade.openDate, timezone)}
                                          </dd>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <dt>Closed</dt>
                                          <dd className="text-right">
                                            {trade.result === 'Open'
                                              ? 'Still open'
                                              : dateTimeLabel(
                                                  trade.closeDate || trade.openDate,
                                                  timezone
                                                )}
                                          </dd>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <dt>Entry → Exit</dt>
                                          <dd>
                                            {priceLabel(tradeMoney(trade, 'entryPrice').exact)} →{' '}
                                            {priceLabel(tradeMoney(trade, 'exitPrice').exact)}
                                          </dd>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <dt>Stop / Target</dt>
                                          <dd>
                                            {trade.sl || '—'} / {trade.tp || '—'}
                                          </dd>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <dt>Order / ticket</dt>
                                          <dd>{trade.externalId ?? 'Not recorded'}</dd>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <dt>Account / run</dt>
                                          <dd className="text-right">
                                            {account?.displayName ?? run?.name ?? 'Whole profile'}
                                          </dd>
                                        </div>
                                      </dl>
                                    </section>
                                    <section>
                                      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                                        Money & risk
                                      </h3>
                                      <dl className="mt-2 space-y-1.5 text-sm">
                                        <div className="flex justify-between gap-3">
                                          <dt>Gross P&L</dt>
                                          <dd>
                                            {signedMoney(
                                              displayedMoney(trade, 'grossPnl'),
                                              reportingCurrency
                                            )}
                                          </dd>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <dt>Commission</dt>
                                          <dd>
                                            {signedMoney(
                                              displayedMoney(trade, 'commission'),
                                              reportingCurrency
                                            )}
                                          </dd>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <dt>
                                            {trade.amounts ? 'Swap cashflow' : 'Swap (legacy cost)'}
                                          </dt>
                                          <dd>
                                            {signedMoney(
                                              displayedMoney(trade, 'swap'),
                                              reportingCurrency
                                            )}
                                          </dd>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <dt>Other fees</dt>
                                          <dd>
                                            {signedMoney(
                                              displayedMoney(trade, 'fees'),
                                              reportingCurrency
                                            )}
                                          </dd>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <dt>Total costs</dt>
                                          <dd>{signedMoney(costs, reportingCurrency)}</dd>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <dt>
                                            {trade.realizations?.length
                                              ? 'Shown exits net P&L'
                                              : 'Net P&L'}
                                          </dt>
                                          <dd
                                            className={`font-semibold ${pnlTone(displayedPnl(trade) ?? 0)}`}
                                          >
                                            {signedMoney(displayedPnl(trade), reportingCurrency)}
                                          </dd>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                          <dt>Risk / planned R:R</dt>
                                          <dd>
                                            {formatMoney(
                                              tradeMoney(trade, 'riskAmount').value,
                                              reportingCurrency
                                            )}{' '}
                                            / {trade.rr || '—'}
                                          </dd>
                                        </div>
                                      </dl>
                                    </section>
                                    <section>
                                      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                                        Review
                                      </h3>
                                      <div className="mt-2 space-y-2 text-sm">
                                        <Link
                                          className="inline-block underline"
                                          to={openTradeChart(trade)}
                                        >
                                          Open trade chart
                                        </Link>
                                        <ChartEvidenceList
                                          record={trade}
                                          originId={data.workspace?.originId}
                                          reopenContext={tradeReopenContext(trade)}
                                        />
                                        <p>
                                          Plan:{' '}
                                          {trade.planConfirmed
                                            ? 'Setup matched plan'
                                            : 'Not confirmed'}{' '}
                                          · Risk: {trade.riskDefined ? 'Defined' : 'Not confirmed'}
                                        </p>
                                        {typeof trade.rating === 'number' && (
                                          <p>
                                            Trade rating:{' '}
                                            {'★'.repeat(Math.max(0, Math.min(5, trade.rating)))}
                                            {trade.rating}/5
                                          </p>
                                        )}
                                        {!!trade.tags?.length && (
                                          <p className="flex flex-wrap gap-1">
                                            {trade.tags.map((tag) => (
                                              <Badge key={tag} variant="secondary">
                                                {tag}
                                              </Badge>
                                            ))}
                                          </p>
                                        )}
                                        {trade.chartUrl && /^https?:\/\//i.test(trade.chartUrl) && (
                                          <p>
                                            <a
                                              className="font-medium text-primary underline"
                                              href={trade.chartUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                            >
                                              Open chart screenshot
                                            </a>
                                          </p>
                                        )}
                                        {trade.technicalNotes && (
                                          <p>
                                            <strong>Technical:</strong> {trade.technicalNotes}
                                          </p>
                                        )}
                                        {trade.emotionalNotes && (
                                          <p>
                                            <strong>Mind:</strong> {trade.emotionalNotes}
                                          </p>
                                        )}
                                        {trade.otherNotes && <p>{trade.otherNotes}</p>}
                                        {!trade.technicalNotes &&
                                          !trade.emotionalNotes &&
                                          !trade.otherNotes && (
                                            <p className="text-muted-foreground">
                                              No review notes recorded.
                                            </p>
                                          )}
                                      </div>
                                    </section>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </JournalTableFrame>
              ) : (
                <EmptyState
                  icon={BookOpenCheck}
                  title={
                    profileTrades.length ? 'No positions match these filters' : 'No trades yet'
                  }
                  description={
                    profileTrades.length
                      ? 'Try clearing search, result, direction, or the selected calendar day.'
                      : 'Synced or replay trades will appear here when connectors land. For now, add the first one with Log trade.'
                  }
                  action={
                    profileTrades.length ? undefined : (
                      <Button type="button" className="mt-4" onClick={openLogTrade}>
                        Add your first trade
                      </Button>
                    )
                  }
                />
              )}
              {tradePageCount > 1 && (
                <nav
                  aria-label="Trade log pages"
                  className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/25 p-2"
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={tradePage === 1}
                    onClick={() => setView({ page: tradePage - 1, trade: null })}
                  >
                    <ChevronLeft aria-hidden="true" className="h-4 w-4" /> Previous trade page
                  </Button>
                  <output className="px-2 text-sm text-muted-foreground tabular-nums">
                    Positions {firstTradeIndex + 1}–{firstTradeIndex + pageTrades.length} of{' '}
                    {filteredTrades.length}
                  </output>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={tradePage === tradePageCount}
                    onClick={() => setView({ page: tradePage + 1, trade: null })}
                  >
                    Next trade page <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </nav>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Showing {filteredTrades.length} positions in the displayed book and filters.
                Realized-exit samples are counted separately from position rows.
              </p>
              {trades.some((trade) => tradeEventType(trade) !== 'trade') && (
                <section
                  className="mt-5 space-y-3 rounded border p-3"
                  aria-label="Account cashflows and fee adjustments"
                >
                  <h3 className="text-sm font-semibold">Account cashflows &amp; standalone fees</h3>
                  <p className="text-xs text-muted-foreground">
                    Deposits and withdrawals are cash movements, not trading profit or wins. Fee
                    adjustments affect journal P&amp;L without becoming trade outcomes.
                  </p>
                  <JournalTableFrame label="Cash movements table">
                    <table className="w-full min-w-[540px] text-left text-sm">
                      <thead>
                        <tr>
                          <th className="p-2">Date</th>
                          <th className="p-2">Type</th>
                          <th className="p-2">Native amount</th>
                          <th className="p-2">Review</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trades
                          .filter((trade) => tradeEventType(trade) !== 'trade')
                          .map((trade) => (
                            <tr key={trade.id} className="border-t">
                              <td className="p-2">
                                {dateTimeLabel(trade.closeDate || trade.openDate, timezone)}
                              </td>
                              <td className="p-2">{tradeEventType(trade)}</td>
                              <td className="p-2">
                                {trade.cashflowAmount ??
                                  tradeMoney(trade, 'netPnl').exact ??
                                  'Unknown'}{' '}
                                {trade.currency ?? reportingCurrency}
                              </td>
                              <td className="p-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setEditingTradeId(trade.id ?? null)
                                    setEditorMode('review')
                                  }}
                                >
                                  Review {tradeEventType(trade)}
                                </Button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </JournalTableFrame>
                </section>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      <Button
        type="button"
        onClick={openLogTrade}
        className="fixed bottom-24 right-4 z-40 rounded-full shadow-lg md:bottom-6 md:right-6"
        aria-label="Log trade"
      >
        <Plus className="h-5 w-5" />
        <span className="hidden sm:inline">Log trade</span>
      </Button>
    </div>
  )
}
