import type { DailyMood, JournalTrade, TraderPortfolio } from './db'
import {
  type AmountKey,
  type AnalyticsTrade,
  compareJournalTimestamps,
  copyAnalyticsScope,
  exactDecimalNumber,
  hasCompleteRealizationScope,
  journalTimestamp,
  journalTradeDay,
  negateExactDecimal,
  realizedJournalRows,
  sumExactDecimals,
  summarizeDecisionScope,
  tradeCurrency,
  tradeEventType,
  tradeMoney,
  tradeNetPnl,
} from './journalAnalytics'

export interface PortfolioSummary {
  balance: number | null
  netPnl: number
  returnPct: number | null
  trades: number
  closedTrades: number
  openTrades: number
  wins: number
  losses: number
  breakEven: number
  winRate: number
  grossProfit: number
  grossLoss: number
  profitFactor: number | null
  expectancy: number
  averageWin: number
  averageLoss: number
  maxDrawdownCurrency: number
  maxDrawdownPct: number | null
  averageR: number | null
  totalR: number | null
  bestTrade: number | null
  worstTrade: number | null
  maxWinStreak: number
  maxLossStreak: number
  currentStreak: number
  longTrades: number
  shortTrades: number
  longWinRate: number
  shortWinRate: number
  longNetPnl: number
  shortNetPnl: number
  averageDurationMinutes: number | null
  grossPnlTotal: number | null
  totalCommission: number | null
  totalSwap: number | null
  totalFees: number | null
  totalCosts: number | null
  totalPips: number
  averagePips: number | null
  totalLots: number
  quantityTotals?: Record<string, string>
  quantityUnknownCount?: number
  bestWinStreakAmount: number
  worstLossStreakAmount: number
  pnlStdDev: number | null
  performanceScore: number | null
  performanceRadar: PerformanceRadarPoint[]
  sharpe: number | null
  sortino: number | null
  netPnlExact: string
  realizedExits: number
  completedPositions: number
  openPositions: number
  riskSampleSize: number
  knownPnlCount: number
  excludedUnknownPnlCount: number
  knownCostCount: number
  unknownCostCount: number
  knownGrossPnlTotal: number
  knownCommissionTotal: number
  knownSwapTotal: number
  knownFeesTotal: number
  knownCostsTotal: number
  legacyAmountCount: number
  unknownTimeCount: number
  feeAdjustmentCount: number
  cashflowCount: number
  excludedCurrencyCount: number
  decisiveWinRate: number | null
  decisionScope: ReturnType<typeof summarizeDecisionScope>
  ratiosUnavailableReason: string | null
}

export interface PerformanceRadarPoint {
  label: string
  score: number
}

export interface EquityPoint {
  date: string
  equity: number | null
  cumulativePnl: number
  dealPnl: number
  drawdown: number
  drawdownPct: number | null
}

export interface DailyTradeSummary {
  date: string
  pnl: number
  trades: number
  wins: number
  losses: number
  winRate: number
  lots: number
  quantityTotals?: Record<string, string>
  quantityUnknownCount?: number
  moodState?: string
  moodScore?: number
  breakEven: number
  realizedExits: number
}

export interface GroupedTradeStats {
  name: string
  pnl: number
  trades: number
  wins: number
  losses: number
  breakEven: number
  winRate: number
  grossProfit: number
  grossLoss: number
  profitFactor: number | null
  expectancy: number
  averageR: number | null
  totalR: number | null
  totalLots: number
  quantityTotals?: Record<string, string>
  quantityUnknownCount?: number
  totalCosts: number | null
  totalPips: number
  averageDurationMinutes: number | null
}

export interface CombinedProfileSummary {
  currency: string
  profileCount: number
  netPnl: number
  trades: number
  openTrades: number
  wins: number
  losses: number
  breakEven: number
  winRate: number
  grossProfit: number
  grossLoss: number
  profitFactor: number | null
  expectancy: number
  averageWin: number
  averageLoss: number
  maxDrawdownCurrency: number
  bestTrade: number | null
  worstTrade: number | null
  averageR: number | null
  totalR: number | null
  longTrades: number
  shortTrades: number
  longWinRate: number
  shortWinRate: number
  longNetPnl: number
  shortNetPnl: number
  averageDurationMinutes: number | null
  grossPnlTotal: number | null
  totalCommission: number | null
  totalSwap: number | null
  totalFees: number | null
  totalCosts: number | null
  totalPips: number
  averagePips: number | null
  totalLots: number
  quantityTotals?: Record<string, string>
  quantityUnknownCount?: number
  pnlStdDev: number | null
  sharpe: number | null
  sortino: number | null
  netPnlExact: string
  realizedExits: number
  completedPositions: number
  openPositions: number
  riskSampleSize: number
  knownPnlCount: number
  excludedUnknownPnlCount: number
  knownCostCount: number
  unknownCostCount: number
  knownGrossPnlTotal: number
  knownCommissionTotal: number
  knownSwapTotal: number
  knownFeesTotal: number
  knownCostsTotal: number
  legacyAmountCount: number
  unknownTimeCount: number
  feeAdjustmentCount: number
  cashflowCount: number
  excludedCurrencyCount: number
  decisiveWinRate: number | null
  decisionScope: ReturnType<typeof summarizeDecisionScope>
  ratiosUnavailableReason: string | null
}

export interface EmotionSummary {
  fomo: number | null
  patience: number | null
  discipline: number | null
  confidence: number | null
  moodEntries: number
  averageMood: number | null
  averageSleep: number | null
  highStressDays: number
}

const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
function quantities(rows: JournalTrade[]) {
  const groups = new Map<string, string[]>()
  let quantityUnknownCount = 0
  for (const row of rows) {
    const value = tradeMoney(row, 'quantity').exact
    if (value === null) {
      quantityUnknownCount++
      continue
    }
    const unit = row.quantityUnit || 'lots'
    groups.set(unit, [...(groups.get(unit) ?? []), value])
  }
  return {
    quantityTotals: Object.fromEntries(
      [...groups].map(([unit, values]) => [unit, sumExactDecimals(values) ?? '0'])
    ),
    quantityUnknownCount,
  }
}
export function formatQuantityTotals(totals?: Record<string, string>, fallback?: number): string {
  if (totals)
    return (
      Object.entries(totals)
        .map(([unit, value]) => `${value} ${unit}`)
        .join(' · ') || '—'
    )
  return typeof fallback === 'number' && Number.isFinite(fallback)
    ? `${fallback.toFixed(2)} lots`
    : '—'
}
const knownSum = (rows: JournalTrade[], key: AmountKey) => {
  const observations = rows.map((row) => tradeMoney(row, key))
  const exact =
    sumExactDecimals(observations.flatMap((item) => (item.exact === null ? [] : [item.exact]))) ??
    '0'
  return {
    exact,
    value: exactDecimalNumber(exact) ?? 0,
    known: observations.filter((item) => item.value !== null).length,
    unknown: observations.filter((item) => item.value === null).length,
  }
}
const ordered = (rows: JournalTrade[]) =>
  [...rows].sort((a, b) =>
    compareJournalTimestamps(a.closeDate || a.openDate, b.closeDate || b.openDate)
  )
function tradeRValue(trade: JournalTrade): number | null {
  const risk = tradeMoney(trade, 'riskAmount').value
  const net = tradeNetPnl(trade)
  if (net === null || risk === null || risk <= 0) return null
  const value = net / risk
  return Number.isFinite(value) ? value : null
}
function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = average(values)!
  const variance = sum(values.map((value) => (value - mean) ** 2)) / (values.length - 1)
  return Number.isFinite(variance) ? Math.sqrt(variance) : null
}
export interface CompleteReturnSeries {
  frequency: 'daily'
  expectedDates: string[]
  observations: { date: string; excessReturn: string }[]
  cashflowAdjusted: true
  beginningEquityKnown: true
  annualizationFactor: number
}
export interface MetricOptions {
  timezone?: string
  currency?: string
  returnSeries?: CompleteReturnSeries
}
/** No trading-day gaps, funding or annualization calendar are inferred from trades. */
export function calculateAnnualizedRatios(series?: CompleteReturnSeries) {
  const unavailable = (reason: string) => ({ sharpe: null, sortino: null, reason })
  if (!series)
    return unavailable('A complete cashflow-adjusted daily excess-return series is required.')
  if (
    series.frequency !== 'daily' ||
    series.cashflowAdjusted !== true ||
    series.beginningEquityKnown !== true ||
    !finite(series.annualizationFactor) ||
    series.annualizationFactor <= 0 ||
    series.annualizationFactor > 366
  )
    return unavailable(
      'Return calendar, cashflow adjustment and annualization factor must be explicit.'
    )
  const expected = series.expectedDates
  const observations = series.observations
  if (
    !Array.isArray(expected) ||
    !Array.isArray(observations) ||
    expected.length < 2 ||
    expected.length !== observations.length ||
    new Set(expected).size !== expected.length ||
    expected.some(
      (day, index) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ||
        new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day ||
        (index > 0 && day <= expected[index - 1])
    )
  )
    return unavailable('Every expected reporting date needs exactly one ordered observation.')
  const byDate = new Map(
    observations.map((item) => [item.date, exactDecimalNumber(item.excessReturn)])
  )
  if (
    byDate.size !== observations.length ||
    expected.some((date) => !byDate.has(date) || byDate.get(date) === null)
  )
    return unavailable('The return series has missing, duplicate or invalid observations.')
  const values = expected.map((date) => byDate.get(date)!)
  const mean = average(values)!
  const deviation = sampleStdDev(values)
  const downside = Math.sqrt(sum(values.map((value) => Math.min(value, 0) ** 2)) / values.length)
  const sharpe =
    deviation !== null && deviation > 0
      ? (mean / deviation) * Math.sqrt(series.annualizationFactor)
      : null
  const sortino = downside > 0 ? (mean / downside) * Math.sqrt(series.annualizationFactor) : null
  return {
    sharpe: finite(sharpe) ? sharpe : null,
    sortino: finite(sortino) ? sortino : null,
    reason:
      sharpe === null && sortino === null
        ? 'The complete return sample has no measurable deviation.'
        : null,
  }
}

export function summarizePortfolio(
  portfolio: TraderPortfolio,
  trades: JournalTrade[],
  options: MetricOptions = {}
): PortfolioSummary {
  const candidates = trades.filter(
    (trade) => trade.portfolioId === portfolio.id && !trade.archivedAt
  )
  const currency = (options.currency ?? portfolio.currency).toUpperCase()
  const own = candidates.filter((trade) => tradeCurrency(trade, portfolio.currency) === currency)
  const positions = own.filter((trade) => tradeEventType(trade) === 'trade')
  const completed = positions.filter(
    (trade) =>
      trade.result !== 'Open' &&
      (!(trade as AnalyticsTrade).realizations?.length ||
        (trade as AnalyticsTrade).realizations!.some(
          (event) =>
            event.kind !== 'fee' &&
            (event.closedAt === trade.closeDate ||
              (journalTimestamp(event.closedAt) !== null &&
                compareJournalTimestamps(event.closedAt, trade.closeDate) === 0))
        ))
  )
  const economicRows = realizedJournalRows(own)
  const exits = ordered(economicRows.filter((row) => tradeEventType(row) === 'trade'))
  const knownExits = exits.filter((trade) => tradeNetPnl(trade) !== null)
  const fees = economicRows.filter((trade) => tradeEventType(trade) === 'fee')
  const cashflows = own.filter((trade) => ['deposit', 'withdrawal'].includes(tradeEventType(trade)))
  const moneyRows = ordered([...knownExits, ...fees.filter((trade) => tradeNetPnl(trade) !== null)])
  const net = knownSum(moneyRows, 'netPnl')
  const pnlValues = moneyRows.map((trade) => tradeNetPnl(trade)!)
  const grossProfit = knownSum(
    moneyRows.filter((trade) => tradeNetPnl(trade)! > 0),
    'netPnl'
  ).value
  const grossLoss = Math.abs(
    knownSum(
      moneyRows.filter((trade) => tradeNetPnl(trade)! < 0),
      'netPnl'
    ).value
  )
  const winningExits = knownExits.filter((trade) => tradeNetPnl(trade)! > 0)
  const losingExits = knownExits.filter((trade) => tradeNetPnl(trade)! < 0)
  const wins = winningExits.length
  const losses = losingExits.length
  const breakEven = knownExits.length - wins - losses
  const winRate = knownExits.length ? (wins / knownExits.length) * 100 : 0
  const riskRows = completed.filter((row) => hasCompleteRealizationScope(row))
  const rValues = riskRows.flatMap((trade) => {
    const row = trade as AnalyticsTrade
    const projected = row.realizations?.length
      ? {
          ...row,
          amounts: { ...row.amounts, netPnl: knownSum(realizedJournalRows([row]), 'netPnl').exact },
        }
      : row
    if (row.realizations?.some((event) => exactDecimalNumber(event.netPnl) === null)) return []
    const risk = tradeRValue(projected)
    return risk === null ? [] : [risk]
  })
  const gross = knownSum(economicRows, 'grossPnl')
  const commission = knownSum(economicRows, 'commission')
  const swap = knownSum(economicRows, 'swap')
  const feesSum = knownSum(economicRows, 'fees')
  const knownCostRows = economicRows.filter((row) =>
    ['commission', 'swap', 'fees'].every((key) => tradeMoney(row, key as AmountKey).value !== null)
  )
  const costSwap =
    sumExactDecimals(
      economicRows.flatMap((row) => {
        const observation = tradeMoney(row, 'swap')
        return observation.exact === null
          ? []
          : [
              observation.provenance === 'canonical'
                ? negateExactDecimal(observation.exact)!
                : observation.exact,
            ]
      })
    ) ?? '0'
  const knownCostsTotal =
    exactDecimalNumber(sumExactDecimals([commission.exact, costSwap, feesSum.exact])) ?? 0
  const unknownCostCount = economicRows.length - knownCostRows.length
  const baselineKnown =
    portfolio.kind === 'replay' &&
    currency === portfolio.currency.toUpperCase() &&
    finite(portfolio.startingBalance) &&
    portfolio.startingBalance > 0
  const baseline = baselineKnown ? portfolio.startingBalance : 0
  const unknownPnlCount =
    exits.length - knownExits.length + fees.filter((trade) => tradeNetPnl(trade) === null).length
  const funding = knownSum(cashflows, 'netPnl')
  const syntheticEquityKnown = baselineKnown && unknownPnlCount === 0 && funding.unknown === 0
  const percentKnown = syntheticEquityKnown && cashflows.length === 0
  let equity = baseline
  let peak = baseline
  let maxDrawdownCurrency = 0
  let maxDrawdownPct = percentKnown ? 0 : null
  let cumulativeExact = '0'
  for (const trade of moneyRows.filter(
    (row) => journalTimestamp(row.closeDate || row.openDate) !== null
  )) {
    cumulativeExact = sumExactDecimals([cumulativeExact, tradeMoney(trade, 'netPnl').exact!])!
    equity = baseline + (exactDecimalNumber(cumulativeExact) ?? 0)
    peak = Math.max(peak, equity)
    const drawdown = peak - equity
    maxDrawdownCurrency = Math.max(maxDrawdownCurrency, drawdown)
    if (percentKnown && peak > 0)
      maxDrawdownPct = Math.max(maxDrawdownPct ?? 0, (drawdown / peak) * 100)
  }
  let runningWins = 0,
    runningLosses = 0,
    runningWinAmount = 0,
    runningLossAmount = 0
  let maxWinStreak = 0,
    maxLossStreak = 0,
    bestWinStreakAmount = 0,
    worstLossStreakAmount = 0
  for (const trade of knownExits) {
    const pnl = tradeNetPnl(trade)!
    if (pnl > 0) {
      runningWins++
      runningWinAmount += pnl
      runningLosses = 0
      runningLossAmount = 0
    } else if (pnl < 0) {
      runningLosses++
      runningLossAmount += pnl
      runningWins = 0
      runningWinAmount = 0
    } else {
      runningWins = 0
      runningLosses = 0
      runningWinAmount = 0
      runningLossAmount = 0
    }
    if (
      runningWins > maxWinStreak ||
      (runningWins === maxWinStreak && runningWinAmount > bestWinStreakAmount)
    )
      bestWinStreakAmount = runningWinAmount
    if (
      runningLosses > maxLossStreak ||
      (runningLosses === maxLossStreak && runningLossAmount < worstLossStreakAmount)
    )
      worstLossStreakAmount = runningLossAmount
    maxWinStreak = Math.max(maxWinStreak, runningWins)
    maxLossStreak = Math.max(maxLossStreak, runningLosses)
  }
  const longClosed = knownExits.filter((trade) => trade.direction === 'Buy')
  const shortClosed = knownExits.filter((trade) => trade.direction === 'Sell')
  const directionalRate = (rows: JournalTrade[]) =>
    rows.length ? (rows.filter((row) => tradeNetPnl(row)! > 0).length / rows.length) * 100 : 0
  const durations = knownExits.flatMap((trade) => {
    const opened = journalTimestamp(trade.openDate),
      closed = journalTimestamp(trade.closeDate)
    const minutes =
      opened !== null && closed !== null && closed >= opened
        ? (closed - opened) / 60_000
        : finite(trade.duration) && trade.duration > 0
          ? trade.duration
          : null
    return minutes === null ? [] : [minutes]
  })
  const pips = knownExits.flatMap((row) => (finite(row.pips) ? [row.pips] : []))
  const ratios = calculateAnnualizedRatios(options.returnSeries)
  return {
    balance: syntheticEquityKnown ? baseline + net.value + funding.value : null,
    netPnl: net.value,
    netPnlExact: net.exact,
    returnPct: percentKnown ? (net.value / baseline) * 100 : null,
    trades: positions.length,
    closedTrades: completed.length,
    completedPositions: completed.length,
    openTrades: positions.filter((row) => row.result === 'Open').length,
    openPositions: positions.filter((row) => row.result === 'Open').length,
    realizedExits: knownExits.length,
    wins,
    losses,
    breakEven,
    winRate,
    decisiveWinRate: wins + losses ? (wins / (wins + losses)) * 100 : null,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    expectancy: knownExits.length ? net.value / knownExits.length : 0,
    averageWin: wins ? knownSum(winningExits, 'netPnl').value / wins : 0,
    averageLoss: losses ? Math.abs(knownSum(losingExits, 'netPnl').value) / losses : 0,
    maxDrawdownCurrency,
    maxDrawdownPct,
    averageR: average(rValues),
    totalR: rValues.length ? sum(rValues) : null,
    riskSampleSize: rValues.length,
    bestTrade: knownExits.length
      ? knownExits.reduce((value, row) => Math.max(value, tradeNetPnl(row)!), -Infinity)
      : null,
    worstTrade: knownExits.length
      ? knownExits.reduce((value, row) => Math.min(value, tradeNetPnl(row)!), Infinity)
      : null,
    maxWinStreak,
    maxLossStreak,
    currentStreak: runningWins || -runningLosses,
    longTrades: longClosed.length,
    shortTrades: shortClosed.length,
    longWinRate: directionalRate(longClosed),
    shortWinRate: directionalRate(shortClosed),
    longNetPnl: knownSum(longClosed, 'netPnl').value,
    shortNetPnl: knownSum(shortClosed, 'netPnl').value,
    averageDurationMinutes: average(durations),
    grossPnlTotal: gross.unknown ? null : gross.value,
    totalCommission: commission.unknown ? null : commission.value,
    totalSwap: swap.unknown ? null : swap.value,
    totalFees: feesSum.unknown ? null : feesSum.value,
    totalCosts: unknownCostCount ? null : knownCostsTotal,
    totalPips: sum(pips),
    averagePips: average(pips),
    totalLots: knownSum(knownExits, 'quantity').value,
    ...quantities(knownExits),
    bestWinStreakAmount,
    worstLossStreakAmount,
    pnlStdDev: sampleStdDev(pnlValues),
    performanceScore: null,
    performanceRadar: [],
    sharpe: ratios.sharpe,
    sortino: ratios.sortino,
    ratiosUnavailableReason: ratios.reason,
    knownPnlCount: moneyRows.length,
    excludedUnknownPnlCount: unknownPnlCount,
    knownCostCount: knownCostRows.length,
    unknownCostCount,
    knownGrossPnlTotal: gross.value,
    knownCommissionTotal: commission.value,
    knownSwapTotal: swap.value,
    knownFeesTotal: feesSum.value,
    knownCostsTotal,
    legacyAmountCount: moneyRows.filter(
      (row) => tradeMoney(row, 'netPnl').provenance === 'legacy-number'
    ).length,
    unknownTimeCount: moneyRows.filter(
      (row) => journalTimestamp(row.closeDate || row.openDate) === null
    ).length,
    feeAdjustmentCount: fees.length,
    cashflowCount: cashflows.length,
    excludedCurrencyCount: candidates.length - own.length,
    decisionScope: summarizeDecisionScope(positions),
  }
}

export function buildEquityCurve(
  portfolio: TraderPortfolio,
  trades: JournalTrade[],
  options: MetricOptions = {}
): EquityPoint[] {
  const currency = (options.currency ?? portfolio.currency).toUpperCase()
  const own = trades.filter(
    (trade) =>
      trade.portfolioId === portfolio.id &&
      !trade.archivedAt &&
      tradeCurrency(trade, portfolio.currency) === currency
  )
  const economicRows = realizedJournalRows(own)
  const rows = ordered(
    economicRows.filter(
      (row) => tradeNetPnl(row) !== null && journalTimestamp(row.closeDate || row.openDate) !== null
    )
  )
  const hasBaseline =
    portfolio.kind === 'replay' &&
    currency === portfolio.currency.toUpperCase() &&
    finite(portfolio.startingBalance) &&
    portfolio.startingBalance > 0 &&
    !own.some((row) => ['deposit', 'withdrawal'].includes(tradeEventType(row))) &&
    !economicRows.some(
      (row) => tradeNetPnl(row) === null || journalTimestamp(row.closeDate || row.openDate) === null
    )
  const baseline = hasBaseline ? portfolio.startingBalance : 0
  let exact = '0',
    peak = baseline
  const firstTradeDate = rows[0]?.openDate || rows[0]?.closeDate
  const points: EquityPoint[] = [
    {
      date:
        firstTradeDate && firstTradeDate < portfolio.createdAt
          ? firstTradeDate
          : portfolio.createdAt,
      equity: hasBaseline ? baseline : null,
      cumulativePnl: 0,
      dealPnl: 0,
      drawdown: 0,
      drawdownPct: hasBaseline ? 0 : null,
    },
  ]
  for (const trade of rows) {
    exact = sumExactDecimals([exact, tradeMoney(trade, 'netPnl').exact!])!
    const cumulativePnl = exactDecimalNumber(exact) ?? 0
    const equity = baseline + cumulativePnl
    peak = Math.max(peak, equity)
    points.push({
      date: trade.closeDate || trade.openDate,
      equity: hasBaseline ? equity : null,
      cumulativePnl,
      dealPnl: tradeNetPnl(trade)!,
      drawdown: peak - equity,
      drawdownPct: hasBaseline && peak > 0 ? ((peak - equity) / peak) * 100 : null,
    })
  }
  return points
}

export function buildDailySummaries(
  trades: JournalTrade[],
  moods: DailyMood[] = [],
  timezone = 'UTC'
): DailyTradeSummary[] {
  const moodByDate = new Map(
    moods.filter((mood) => !mood.archivedAt).map((mood) => [mood.date, mood])
  )
  const byDay = new Map<string, { rows: JournalTrade[]; feeRows: JournalTrade[] }>()
  const rows = realizedJournalRows(trades)
  for (const trade of rows) {
    const date = journalTradeDay(trade, timezone)
    if (!date || tradeNetPnl(trade) === null) continue
    const current = byDay.get(date) ?? { rows: [], feeRows: [] }
    if (tradeEventType(trade) === 'fee') current.feeRows.push(trade)
    else current.rows.push(trade)
    byDay.set(date, current)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, group]) => {
      const wins = group.rows.filter((row) => tradeNetPnl(row)! > 0).length,
        losses = group.rows.filter((row) => tradeNetPnl(row)! < 0).length
      return {
        date,
        pnl: knownSum([...group.rows, ...group.feeRows], 'netPnl').value,
        trades: group.rows.length,
        realizedExits: group.rows.length,
        wins,
        losses,
        breakEven: group.rows.length - wins - losses,
        winRate: group.rows.length ? (wins / group.rows.length) * 100 : 0,
        lots: knownSum(group.rows, 'quantity').value,
        ...quantities(group.rows),
        moodState: moodByDate.get(date)?.state,
        moodScore: moodByDate.get(date)?.moodScore,
      }
    })
}

export function groupTradeStats(
  trades: JournalTrade[],
  keyFor: (trade: JournalTrade) => string,
  options: MetricOptions = {}
): GroupedTradeStats[] {
  const groups = new Map<string, JournalTrade[]>()
  const economicRows = realizedJournalRows(trades)
  const currencies = new Set(
    economicRows.map((row) => tradeCurrency(row, options.currency ?? 'USD'))
  )
  const groupName = (trade: JournalTrade) => {
    const name = keyFor(trade) || 'Unspecified'
    return currencies.size > 1
      ? `${name} · ${tradeCurrency(trade, options.currency ?? 'USD')}`
      : name
  }
  for (const trade of economicRows) {
    const key = groupName(trade)
    groups.set(key, [...(groups.get(key) ?? []), trade])
  }
  return [...groups.entries()]
    .map(([name, items]) => {
      const proxy = items.map((row) => copyAnalyticsScope(row, { ...row, portfolioId: 1 }))
      const result = summarizePortfolio(
        {
          id: 1,
          name,
          kind: 'live',
          currency: tradeCurrency(items[0], options.currency ?? 'USD') ?? 'USD',
          startingBalance: 0,
          createdAt: '',
          updatedAt: '',
        },
        proxy,
        options.currency
          ? { ...options, currency: tradeCurrency(items[0], options.currency) ?? options.currency }
          : options
      )
      const groupedR = trades.flatMap((trade) => {
        if (
          trade.archivedAt ||
          trade.result === 'Open' ||
          tradeEventType(trade) !== 'trade' ||
          !hasCompleteRealizationScope(trade)
        )
          return []
        const events = realizedJournalRows([trade])
        if (
          !events.length ||
          events.some((event) => groupName(event) !== name || tradeNetPnl(event) === null)
        )
          return []
        const value = tradeRValue({
          ...trade,
          amounts: { ...trade.amounts, netPnl: knownSum(events, 'netPnl').exact },
        })
        return value === null ? [] : [value]
      })
      return {
        name,
        pnl: result.netPnl,
        trades: result.realizedExits,
        wins: result.wins,
        losses: result.losses,
        breakEven: result.breakEven,
        winRate: result.winRate,
        grossProfit: result.grossProfit,
        grossLoss: result.grossLoss,
        profitFactor: result.profitFactor,
        expectancy: result.expectancy,
        averageR: average(groupedR),
        totalR: groupedR.length ? sum(groupedR) : null,
        totalLots: result.totalLots,
        quantityTotals: result.quantityTotals,
        quantityUnknownCount: result.quantityUnknownCount,
        totalCosts: result.totalCosts,
        totalPips: result.totalPips,
        averageDurationMinutes: result.averageDurationMinutes,
      }
    })
    .sort((a, b) => b.pnl - a.pnl)
}

export function summarizeCombinedProfiles(
  portfolios: TraderPortfolio[],
  trades: JournalTrade[],
  options: MetricOptions = {}
): Record<string, CombinedProfileSummary> {
  const profiles = portfolios.filter(
    (profile) => profile.kind === 'live' && profile.id && !profile.archivedAt
  )
  const profileById = new Map(profiles.map((profile) => [profile.id!, profile]))
  const groups = new Map<string, { rows: JournalTrade[]; profileIds: Set<number> }>()
  const groupFor = (currency: string) => {
    const current = groups.get(currency)
    if (current) return current
    const group = { rows: [] as JournalTrade[], profileIds: new Set<number>() }
    groups.set(currency, group)
    return group
  }
  for (const profile of profiles) {
    groupFor(profile.currency.toUpperCase()).profileIds.add(profile.id!)
  }
  for (const trade of trades) {
    const profile = profileById.get(trade.portfolioId)
    if (!profile || trade.archivedAt) continue
    const currency = tradeCurrency(trade, profile.currency)
    if (!currency) continue
    const group = groupFor(currency)
    group.rows.push(trade)
    group.profileIds.add(trade.portfolioId)
  }
  const result: Record<string, CombinedProfileSummary> = {}
  for (const [currency, { rows, profileIds }] of groups) {
    const summary = summarizePortfolio(
      {
        id: -1,
        name: 'Combined journal',
        kind: 'live',
        currency,
        startingBalance: 0,
        createdAt: '',
        updatedAt: '',
      },
      rows.map((row) => copyAnalyticsScope(row, { ...row, portfolioId: -1 })),
      { ...options, currency }
    )
    result[currency] = {
      ...summary,
      currency,
      profileCount: profileIds.size,
      trades: summary.realizedExits,
    }
  }
  return result
}

export function summarizeEmotions(
  portfolioId: number,
  trades: JournalTrade[],
  moods: DailyMood[]
): EmotionSummary {
  const ownTrades = trades.filter(
    (trade) =>
      trade.portfolioId === portfolioId && !trade.archivedAt && tradeEventType(trade) === 'trade'
  )
  const scored = (key: 'fomo' | 'patience' | 'discipline' | 'confidence') =>
    ownTrades.flatMap((trade) => {
      const value = trade.emotion?.[key]
      return finite(value) ? [value] : []
    })
  const ownMoods = moods.filter((mood) => mood.portfolioId === portfolioId && !mood.archivedAt)
  return {
    fomo: average(scored('fomo')),
    patience: average(scored('patience')),
    discipline: average(scored('discipline')),
    confidence: average(scored('confidence')),
    moodEntries: ownMoods.length,
    averageMood: average(
      ownMoods.flatMap((mood) => (finite(mood.moodScore) ? [mood.moodScore] : []))
    ),
    averageSleep: average(
      ownMoods.flatMap((mood) => (finite(mood.sleepHours) ? [mood.sleepHours] : []))
    ),
    highStressDays: ownMoods.filter((mood) => finite(mood.stressLevel) && mood.stressLevel >= 70)
      .length,
  }
}
export function calculateRMultiple(netPnl: number, riskAmount?: number) {
  return finite(netPnl) &&
    finite(riskAmount) &&
    riskAmount > 0 &&
    Number.isFinite(netPnl / riskAmount)
    ? netPnl / riskAmount
    : undefined
}
export function formatMoney(value: number | null | undefined, currency = 'USD') {
  if (!finite(value)) return '—'
  const assets = (
    Intl as typeof Intl & { supportedValuesOf?: (key: 'currency') => string[] }
  ).supportedValuesOf?.('currency')
  if (assets && !assets.includes(currency.toUpperCase()))
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 18 }).format(value)} ${currency}`
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 18 }).format(value)} ${currency}`
  }
}
