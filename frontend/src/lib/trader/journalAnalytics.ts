import type { JournalTrade } from './db'

export type JournalPeriod = 'all' | '3m' | '1m' | '1w'
export type AmountKey =
  | 'netPnl'
  | 'grossPnl'
  | 'commission'
  | 'swap'
  | 'fees'
  | 'riskAmount'
  | 'quantity'
  | 'entryPrice'
  | 'exitPrice'
export type ExactAmounts = Partial<Record<AmountKey, string | null>>
export interface JournalRealization {
  id: string
  closedAt: string
  quantity: string
  netPnl: string
  grossPnl?: string | null
  commission?: string | null
  swap?: string | null
  fees?: string | null
  exitPrice?: string | null
  kind?: 'exit' | 'fee'
}
export type AnalyticsTrade = JournalTrade & {
  amounts?: ExactAmounts
  realizations?: JournalRealization[]
  remainingQuantity?: string
  currency?: string
  eventType?: 'trade' | 'deposit' | 'withdrawal' | 'fee'
  decisionId?: string
  copyGroupId?: string
}
export interface MoneyObservation {
  exact: string | null
  value: number | null
  provenance: 'canonical' | 'legacy-number' | 'unknown'
}

const own = (value: object, key: PropertyKey) => Object.hasOwn(value, key)
const canonicalDecimal = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/
function parseDecimal(value: unknown): { amount: bigint; scale: number } | null {
  if (typeof value !== 'string' || value.length > 96) return null
  const match = canonicalDecimal.exec(value)
  if (!match || (match[3]?.length ?? 0) > 32) return null
  const fraction = match[3] ?? ''
  return { amount: BigInt(`${match[1]}${match[2]}${fraction}`), scale: fraction.length }
}
function decimalText(amount: bigint, scale: number): string {
  if (amount === 0n) return '0'
  const negative = amount < 0n
  const digits = (negative ? -amount : amount).toString().padStart(scale + 1, '0')
  const text = scale
    ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '')
    : digits
  return `${negative ? '-' : ''}${text}`
}
export function normalizeExactDecimal(value: unknown): string | null {
  const parsed = parseDecimal(value)
  return parsed ? decimalText(parsed.amount, parsed.scale) : null
}
export function sumExactDecimals(values: readonly string[]): string | null {
  let total = 0n
  let scale = 0
  for (const value of values) {
    const parsed = parseDecimal(value)
    if (!parsed) return null
    if (parsed.scale > scale) {
      total *= 10n ** BigInt(parsed.scale - scale)
      scale = parsed.scale
    }
    total += parsed.amount * 10n ** BigInt(scale - parsed.scale)
  }
  return decimalText(total, scale)
}
export function negateExactDecimal(value: string): string | null {
  const normalized = normalizeExactDecimal(value)
  return normalized === null
    ? null
    : normalized === '0'
      ? '0'
      : normalized.startsWith('-')
        ? normalized.slice(1)
        : `-${normalized}`
}
export function exactDecimalNumber(value: unknown): number | null {
  const normalized = normalizeExactDecimal(value)
  if (normalized === null) return null
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}
function legacyDecimal(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const text = String(value)
  if (!/[eE]/.test(text)) return normalizeExactDecimal(text)
  const [mantissa, exponent] = text.toLowerCase().split('e')
  const negative = mantissa.startsWith('-')
  const unsigned = negative ? mantissa.slice(1) : mantissa
  const [integer, fraction = ''] = unsigned.split('.')
  const digits = integer + fraction
  const point = integer.length + Number(exponent)
  const plain =
    point <= 0
      ? `0.${'0'.repeat(-point)}${digits}`
      : point >= digits.length
        ? `${digits}${'0'.repeat(point - digits.length)}`
        : `${digits.slice(0, point)}.${digits.slice(point)}`
  return normalizeExactDecimal(`${negative ? '-' : ''}${plain}`)
}
export function tradeMoney(trade: JournalTrade, key: AmountKey): MoneyObservation {
  const source = trade as AnalyticsTrade
  if (source.amounts && own(source.amounts, key)) {
    const exact = normalizeExactDecimal(source.amounts[key])
    return {
      exact,
      value: exactDecimalNumber(exact),
      provenance: exact === null ? 'unknown' : 'canonical',
    }
  }
  const legacyKey = key === 'quantity' ? 'lots' : key
  const exact = legacyDecimal(source[legacyKey as keyof JournalTrade])
  return {
    exact,
    value: exactDecimalNumber(exact),
    provenance: exact === null ? 'unknown' : 'legacy-number',
  }
}
export function tradeEventType(trade: JournalTrade): 'trade' | 'deposit' | 'withdrawal' | 'fee' {
  return (trade as AnalyticsTrade).eventType ?? 'trade'
}
export function tradeCurrency(trade: JournalTrade, fallback?: string): string | null {
  const value = (trade as AnalyticsTrade).currency ?? fallback
  return typeof value === 'string' && /^[A-Z][A-Z0-9]{2,11}$/.test(value.toUpperCase())
    ? value.toUpperCase()
    : null
}
export function tradeNetPnl(trade: JournalTrade): number | null {
  return tradeMoney(trade, 'netPnl').value
}
export function tradeOutcome(trade: JournalTrade): JournalTrade['result'] | null {
  if (tradeEventType(trade) !== 'trade') return null
  if (trade.result === 'Open') return 'Open'
  const net = tradeNetPnl(trade)
  return net === null ? null : net > 0 ? 'Win' : net < 0 ? 'Loss' : 'Break Even'
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function zonedFormatter(timezone: string, kind: 'day' | 'hour' | 'weekday') {
  const key = `${timezone}|${kind}`
  const saved = formatters.get(key)
  if (saved) return saved
  const formatter = new Intl.DateTimeFormat(kind === 'day' ? 'en-CA' : 'en-GB', {
    timeZone: timezone,
    ...(kind === 'day'
      ? { year: 'numeric', month: '2-digit', day: '2-digit' }
      : kind === 'hour'
        ? { hour: '2-digit', hourCycle: 'h23' }
        : { weekday: 'long' }),
  } as Intl.DateTimeFormatOptions)
  if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!)
  formatters.set(key, formatter)
  return formatter
}
export function validateJournalTimezone(timezone: string): string {
  try {
    zonedFormatter(timezone, 'day')
  } catch {
    throw new RangeError('Choose a supported IANA reporting timezone.')
  }
  return timezone
}
function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function journalTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value
    )
  if (
    !match ||
    !validDay(match[1]) ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4] ?? 0) > 59 ||
    Number(match[7] ?? 0) > 14 ||
    Number(match[8] ?? 0) > 59 ||
    (Number(match[7]) === 14 && Number(match[8]) !== 0)
  )
    return null
  const instant = Date.parse(value)
  return Number.isFinite(instant) ? instant : null
}
export function journalInstantNanos(value: unknown): bigint | null {
  const milliseconds = journalTimestamp(value)
  if (milliseconds === null || typeof value !== 'string') return null
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? ''
  return BigInt(milliseconds) * 1_000_000n + BigInt(fraction.padEnd(9, '0').slice(3))
}
export function compareJournalTimestamps(first: string, second: string): number {
  const left = journalInstantNanos(first),
    right = journalInstantNanos(second)
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return left < right ? -1 : left > right ? 1 : 0
}
export function zonedJournalDay(value: string | number, timezone = 'UTC'): string | null {
  validateJournalTimezone(timezone)
  const instant = typeof value === 'number' ? value : journalTimestamp(value)
  if (instant === null || !Number.isFinite(instant)) return null
  const parts = zonedFormatter(timezone, 'day').formatToParts(instant)
  const at = (type: string) => parts.find((part) => part.type === type)?.value
  return `${at('year')?.padStart(4, '0')}-${at('month')}-${at('day')}`
}
export function tradeReportingTimestamp(trade: JournalTrade): string {
  const exits = (trade as AnalyticsTrade).realizations
  if (exits?.length)
    return [...exits].sort((a, b) => compareJournalTimestamps(b.closedAt, a.closedAt))[0].closedAt
  return trade.closeDate || trade.openDate
}
export function journalTradeDay(trade: JournalTrade, timezone = 'UTC'): string | null {
  return zonedJournalDay(tradeReportingTimestamp(trade), timezone)
}
export function journalTradeHour(trade: JournalTrade, timezone = 'UTC'): string {
  validateJournalTimezone(timezone)
  const instant = journalTimestamp(tradeReportingTimestamp(trade))
  return instant === null
    ? 'Unknown source time'
    : `${zonedFormatter(timezone, 'hour').format(instant)}:00 ${timezone}`
}
export function journalTradeWeekday(trade: JournalTrade, timezone = 'UTC'): string {
  validateJournalTimezone(timezone)
  const instant = journalTimestamp(tradeReportingTimestamp(trade))
  return instant === null
    ? 'Unknown source time'
    : zonedFormatter(timezone, 'weekday').format(instant)
}
export function weekStart(day: string): string {
  if (!validDay(day)) return ''
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}
function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export interface JournalScope {
  profileIds?: readonly number[]
  bookIds?: readonly string[]
  strategy?: string
  period?: JournalPeriod
  timezone: string
  now?: string | number | Date
  currency?: string
  day?: string
  week?: string
  q?: string
  result?: 'All' | JournalTrade['result']
  direction?: 'All' | JournalTrade['direction']
}
const truncatedRealizations = new WeakSet<JournalTrade>()
export function hasCompleteRealizationScope(trade: JournalTrade): boolean {
  return !truncatedRealizations.has(trade)
}
export function copyAnalyticsScope<T extends JournalTrade>(source: JournalTrade, target: T): T {
  if (truncatedRealizations.has(source)) truncatedRealizations.add(target)
  return target
}
export function scopeJournalTrades(input: JournalTrade[], scope: JournalScope) {
  const timezone = validateJournalTimezone(scope.timezone)
  const instant =
    scope.now instanceof Date
      ? scope.now.getTime()
      : typeof scope.now === 'number'
        ? scope.now
        : scope.now
          ? journalTimestamp(scope.now)
          : Date.now()
  if (instant === null || !Number.isFinite(instant))
    throw new RangeError('Reporting time must be a valid instant.')
  const toDate = zonedJournalDay(instant, timezone)!
  const days = { all: 0, '3m': 90, '1m': 30, '1w': 7 }[scope.period ?? 'all']
  const fromDate = days ? shiftDay(toDate, -(days - 1)) : null
  const requestedDay = scope.day || null
  const requestedWeek = scope.week ? weekStart(scope.week) : null
  if (requestedDay && !validDay(requestedDay)) throw new RangeError('Invalid reporting day.')
  if (scope.week && !requestedWeek) throw new RangeError('Invalid reporting week.')
  const bounded = !!(fromDate || requestedDay || requestedWeek)
  const profiles = scope.profileIds ? new Set(scope.profileIds) : null
  const books = scope.bookIds ? new Set(scope.bookIds) : null
  const excluded = { invalidTime: 0, unknownTime: 0, currency: 0, archived: 0, future: 0 }
  const dateMatches = (date: string): boolean => {
    const time = journalTimestamp(date)
    if (time === null) return !bounded
    const day = zonedJournalDay(time, timezone)!
    return (
      time <= instant &&
      (!fromDate || day >= fromDate) &&
      (!requestedDay || day === requestedDay) &&
      (!requestedWeek || weekStart(day) === requestedWeek)
    )
  }
  const trades: JournalTrade[] = []
  for (const original of input) {
    const row = original as AnalyticsTrade
    if (profiles && !profiles.has(row.portfolioId)) continue
    if (books && (!row.journalBookId || !books.has(row.journalBookId))) continue
    if (row.archivedAt) {
      excluded.archived++
      continue
    }
    if (scope.currency && tradeCurrency(row, scope.currency) !== scope.currency.toUpperCase()) {
      excluded.currency++
      continue
    }
    if (scope.strategy && scope.strategy !== 'All' && (row.strategy || 'Manual') !== scope.strategy)
      continue
    if (scope.result && scope.result !== 'All' && tradeOutcome(row) !== scope.result) continue
    if (
      scope.direction &&
      scope.direction !== 'All' &&
      (tradeEventType(row) !== 'trade' || row.direction !== scope.direction)
    )
      continue
    if (
      scope.q &&
      ![
        row.pair,
        row.strategy,
        row.setup,
        row.technicalNotes,
        row.emotionalNotes,
        row.otherNotes,
        ...(row.tags ?? []),
      ]
        .join(' ')
        .toLowerCase()
        .includes(scope.q.trim().toLowerCase())
    )
      continue
    const dates = row.realizations?.length
      ? row.realizations.map((event) => event.closedAt)
      : [tradeReportingTimestamp(row)]
    const unknown = dates.some((date) => journalTimestamp(date) === null)
    if (unknown) {
      excluded.unknownTime++
      if (dates.some((date) => /^\d{4}-\d{2}-\d{2}T/.test(date) && !validDay(date.slice(0, 10))))
        excluded.invalidTime++
    }
    if (!dates.some(dateMatches)) {
      if (dates.some((date) => (journalTimestamp(date) ?? -Infinity) > instant)) excluded.future++
      continue
    }
    if (row.realizations?.length) {
      const realizations = row.realizations.filter((event) => dateMatches(event.closedAt))
      if (!realizations.length) continue
      const selected = { ...row, realizations }
      if (realizations.length !== row.realizations.length || truncatedRealizations.has(row))
        truncatedRealizations.add(selected)
      trades.push(selected)
    } else trades.push(row)
  }
  return { trades, excluded, fromDate, toDate, timezone }
}

/** A virtual exit is an analytical row; its id still opens the parent position. */
export function realizedJournalRows(input: JournalTrade[]): JournalTrade[] {
  const rows: JournalTrade[] = []
  for (const original of input) {
    const row = original as AnalyticsTrade
    if (row.archivedAt) continue
    if (tradeEventType(row) === 'fee') {
      rows.push(row)
      continue
    }
    if (tradeEventType(row) !== 'trade') continue
    if (row.realizations?.length) {
      for (const event of row.realizations) {
        const amount = exactDecimalNumber(event.netPnl)
        const singleComplete =
          row.realizations.length === 1 && row.result !== 'Open' && hasCompleteRealizationScope(row)
        const amounts: ExactAmounts = {
          netPnl: event.netPnl,
          quantity: event.quantity,
          grossPnl: event.grossPnl ?? null,
          commission: event.commission ?? null,
          swap: event.swap ?? null,
          fees: event.fees ?? null,
          riskAmount: singleComplete ? tradeMoney(row, 'riskAmount').exact : null,
          exitPrice: event.exitPrice ?? null,
        }
        const projection: AnalyticsTrade = {
          ...row,
          realizations: undefined,
          eventType: event.kind === 'fee' ? 'fee' : 'trade',
          amounts,
          closeDate: event.closedAt,
          netPnl: amount ?? Number.NaN,
          pnl: amount ?? Number.NaN,
          lots: exactDecimalNumber(event.quantity) ?? Number.NaN,
          grossPnl: exactDecimalNumber(event.grossPnl) ?? undefined,
          commission: exactDecimalNumber(event.commission) ?? undefined,
          swap: exactDecimalNumber(event.swap) ?? undefined,
          fees: exactDecimalNumber(event.fees) ?? undefined,
          result: amount === null || amount === 0 ? 'Break Even' : amount > 0 ? 'Win' : 'Loss',
          riskAmount: singleComplete
            ? (tradeMoney(row, 'riskAmount').value ?? undefined)
            : undefined,
          rMultiple: undefined,
          duration:
            journalTimestamp(event.closedAt) !== null && journalTimestamp(row.openDate) !== null
              ? Math.max(
                  0,
                  (journalTimestamp(event.closedAt)! - journalTimestamp(row.openDate)!) / 60_000
                )
              : 0,
        }
        rows.push(projection)
      }
    } else if (row.result !== 'Open') rows.push(row)
  }
  return rows
}
export function realizedTradeRows(input: JournalTrade[]): JournalTrade[] {
  return realizedJournalRows(input).filter((row) => tradeEventType(row) === 'trade')
}
export function realizedNetMoney(trade: JournalTrade): MoneyObservation {
  if (!(trade as AnalyticsTrade).realizations?.length) return tradeMoney(trade, 'netPnl')
  const amounts = realizedJournalRows([trade]).map((row) => tradeMoney(row, 'netPnl'))
  if (amounts.some((item) => item.exact === null))
    return { exact: null, value: null, provenance: 'unknown' }
  const exact = sumExactDecimals(amounts.map((item) => item.exact!))
  return {
    exact,
    value: exactDecimalNumber(exact),
    provenance: amounts.some((item) => item.provenance === 'legacy-number')
      ? 'legacy-number'
      : 'canonical',
  }
}

export function summarizeDecisionScope(trades: JournalTrade[]) {
  const outcomes = trades.filter(
    (trade) => !trade.archivedAt && tradeEventType(trade) === 'trade'
  ) as AnalyticsTrade[]
  const linked = new Set<string>()
  let unlinkedAccountOutcomes = 0
  for (const trade of outcomes) {
    if (trade.copyGroupId) linked.add(`copy:${trade.copyGroupId}`)
    else if (trade.decisionId) linked.add(`decision:${trade.decisionId}`)
    else unlinkedAccountOutcomes++
  }
  return {
    accountOutcomes: outcomes.length,
    linkedDecisionCount: linked.size,
    unlinkedAccountOutcomes,
    uniqueDecisionCount: unlinkedAccountOutcomes ? null : linked.size,
  }
}
