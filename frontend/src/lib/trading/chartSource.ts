import {
  type Bar,
  type BarsRequest,
  type DataFeed,
  type IndicatorBarsProviderAccess,
  type IndicatorSnapshotRequest,
  type RequestedBarsSnapshot,
  SessionCalendar,
  startOfZonedDay,
  utcSecondsToZonedDateString,
} from 'chartly-charts'
import { type DatasetCatalog, type DatasetVersion, dataLibrary } from '@/api/dataLibrary'
import { createDatasetVersionFeed } from '@/lib/chart/feeds/datasetVersionFeed'
import { replayTiming } from './replayTiming'
import type { SearchRow } from './terminal'

export interface DatasetSourceChoice {
  kind: 'dataset'
  id: string
  versionId: string
  checksum: string
  name: string
  providerId: string
  symbol: string
  exchange: string
  interval: string
  from: number
  to: number
}

export interface DatasetChartSource extends DatasetSourceChoice {
  readonly preparedBars?: readonly Bar[]
  readonly version: DatasetVersion
  readonly intervals: readonly string[]
  /** Exclusive clock horizon; the last opening time alone hides its final candle. */
  readonly horizon: number
  readonly timezone: string
  readonly volumeAvailable: boolean
  /** Observed data availability, not a claim about every instrument's intrinsic capability. */
  readonly openInterestAvailable: boolean
  readonly calendar: SessionCalendar | null
  readonly gapStatus: 'unknown' | 'reported' | 'none'
  readonly quality: string
  readonly feed: DataFeed
  readonly provider: IndicatorBarsProviderAccess
  search(
    query: string,
    exchange?: string,
    limit?: number,
    signal?: AbortSignal
  ): Promise<SearchRow[]>
  instrument(row: Pick<SearchRow, 'symbol' | 'exchange'>): SearchRow | null
  dispose(): void
}

export interface DatasetChartSourceOptions {
  /** UTC opening-time bounds, inclusive, resolved from the owned profile/run. */
  window?: { from: number; to: number }
  fetchBars?: typeof dataLibrary.bars
}

const NATIVE_SECONDS: Readonly<Record<string, number>> = {
  '1s': 1,
  '5s': 5,
  '15s': 15,
  '30s': 30,
  '1m': 60,
  '2m': 120,
  '3m': 180,
  '5m': 300,
  '10m': 600,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
}
const abort = () => new DOMException('This history request was cancelled.', 'AbortError')
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
function immutable<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value)
    Object.freeze(value)
    for (const child of Object.values(value)) immutable(child, seen)
  }
  return value
}

/** Frozen declared calendar only. Unknown sessions never become an invented venue calendar. */
export function datasetSessionCalendar(version: DatasetVersion): SessionCalendar | null {
  const value = version.metadata.calendar
  if (value.id === 'unknown' || (!value.sessions.length && !Object.keys(value.exceptions).length))
    return null
  const window = (entry: { open: string; close: string }) =>
    `${entry.open.replace(':', '')}-${entry.close === '24:00' ? '0000' : entry.close.replace(':', '')}`
  try {
    const exceptions: Record<string, string[]> = {}
    for (const [date, entries] of Object.entries(value.exceptions)) {
      if (!Array.isArray(entries)) throw new Error('Invalid calendar exception')
      exceptions[date] = entries.map((entry) => window(entry as { open: string; close: string }))
    }
    return new SessionCalendar({
      timezone: value.timezone,
      sessions: value.sessions.map(
        (entry) => `${window(entry)}:${entry.weekdays.map((day) => ((day + 1) % 7) + 1).join('')}`
      ),
      exceptions,
    })
  } catch {
    throw new Error('The saved session calendar is invalid. Review it in Data Library.')
  }
}

function choice(version: DatasetVersion): DatasetSourceChoice {
  return {
    kind: 'dataset',
    id: version.id,
    versionId: version.id,
    checksum: version.checksum,
    name: version.name || version.metadata.symbol,
    providerId: version.metadata.provider,
    symbol: version.metadata.symbol,
    exchange: version.metadata.exchange,
    interval: version.metadata.interval,
    from: version.start,
    to: version.end,
  }
}

/** A catalog is one choice per immutable source/version, never one row per shared ticker. */
export async function datasetSourceChoices(
  principalId: string,
  signal?: AbortSignal,
  fetchCatalog: typeof dataLibrary.catalog = dataLibrary.catalog
): Promise<DatasetSourceChoice[]> {
  const choices: DatasetSourceChoice[] = []
  const seen = new Set<string>()
  let revision: number | undefined
  let offset: number | undefined
  for (let page = 0; page < 20; page++) {
    if (signal?.aborted) throw abort()
    const result: DatasetCatalog = await fetchCatalog(signal, offset)
    if (signal?.aborted) throw abort()
    if (!principalId || result.principalId !== principalId)
      throw new Error('The local account changed. Reopen source selection for the current account.')
    if (revision !== undefined && result.revision !== revision)
      throw new Error(
        'Your Data Library changed while sources were loading. Refresh source selection.'
      )
    revision = result.revision
    if (!Array.isArray(result.versions) || result.versions.length > 100)
      throw new Error('The source catalog could not be verified. Refresh Data Library.')
    for (const version of result.versions) {
      if (seen.has(version.id))
        throw new Error('The source catalog changed. Refresh source selection.')
      seen.add(version.id)
      if (!version.archivedAt && !version.quarantine) choices.push(choice(version))
    }
    if (result.nextOffset === undefined || result.nextOffset === null) return choices
    if (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= (offset ?? 0))
      throw new Error('The source catalog could not be verified. Refresh Data Library.')
    offset = result.nextOffset
  }
  throw new Error(
    'The source catalog exceeds this chart’s supported limit. Open Data Library to choose a version.'
  )
}

/** Exact source identity plus native historical knowledge, without any broker or order transport. */
export function createDatasetChartSource(
  original: DatasetVersion,
  options: DatasetChartSourceOptions = {}
): DatasetChartSource {
  if (original.quarantine) throw new Error(original.quarantine.message)
  const version = immutable(structuredClone(original))
  const metadata = version.metadata
  const seconds = NATIVE_SECONDS[metadata.interval]
  if (!seconds && metadata.interval !== 'D')
    throw new Error(
      'This saved native interval is unavailable. Choose another dataset in Data Library.'
    )
  if (
    !finite(version.start) ||
    !finite(version.end) ||
    version.start > version.end ||
    !Number.isInteger(version.rowCount) ||
    version.rowCount < 1 ||
    version.rowCount > 50000
  )
    throw new Error('This saved history range is invalid. Review its version in Data Library.')
  const dailyTiming = replayTiming('D', metadata.calendar.timezone)
  const calendar = datasetSessionCalendar(version)
  const nominalEnd = (time: number) =>
    seconds
      ? time + seconds
      : dailyTiming.barEndTime({ time, open: 0, high: 0, low: 0, close: 0 }, 0)
  const from = Math.max(version.start, options.window?.from ?? version.start)
  const to = Math.min(version.end, options.window?.to ?? version.end)
  if (
    !finite(from) ||
    !finite(to) ||
    from > to ||
    (options.window &&
      (!finite(options.window.from) ||
        !finite(options.window.to) ||
        options.window.from > options.window.to))
  )
    throw new Error(
      'The saved chart window does not overlap this dataset. Review the run’s dates or choose another version.'
    )
  const horizon = nominalEnd(to)
  const publishedAt = Date.parse(version.createdAt) / 1000
  if (!finite(publishedAt))
    throw new Error('This saved history has no valid publication time. Review it in Data Library.')
  // An immutable partial tail cannot become a complete observation as wall time passes.
  const confirmationHorizon = Math.min(horizon, publishedAt)
  const raw = createDatasetVersionFeed(version, options.fetchBars)
  let disposed = false
  const check = (
    request: Pick<BarsRequest, 'symbol' | 'exchange' | 'interval' | 'variant' | 'signal'>
  ) => {
    if (disposed || request.signal?.aborted) throw abort()
    if (
      request.symbol !== metadata.symbol ||
      request.exchange !== metadata.exchange ||
      request.interval !== metadata.interval
    )
      throw new Error(
        'This study or comparison needs a different instrument or interval. Choose an explicitly saved source; this chart uses only its native dataset.'
      )
    if (request.variant && Object.values(request.variant).some((value) => value !== undefined))
      throw new Error(
        'This saved version has one price/session/currency variant. Alternate variants are unavailable.'
      )
  }
  const read = async (request: BarsRequest, warmup = false) => {
    check(request)
    if (
      (request.from !== undefined && !finite(request.from)) ||
      (request.to !== undefined && !finite(request.to))
    )
      throw new Error('This chart request has an invalid UTC window.')
    const low = Math.max(warmup ? version.start : from, request.from ?? from)
    const high = Math.min(horizon, request.to ?? horizon)
    if (low >= high) return []
    const rows = await raw.getBars({ ...request, from: low, to: high })
    check(request)
    return rows.filter((bar) => bar.time >= low && bar.time < high && bar.time <= to)
  }
  const availableAt = (bar: Bar): number | null => {
    if (seconds) {
      if (!calendar) return nominalEnd(bar.time)
      const session = calendar.sessionAt(bar.time)
      return session ? Math.min(nominalEnd(bar.time), session.close) : null
    }
    if (!calendar) return null
    const date = utcSecondsToZonedDateString(bar.time, calendar.timezone)
    let cursor = startOfZonedDay(bar.time, calendar.timezone)
    let close: number | null = null
    for (let index = 0; index < 64; index++) {
      const session = calendar.sessionFrom(cursor)
      if (!session || session.date > date) break
      if (session.date === date) close = Math.max(close ?? -Infinity, session.close)
      if (session.close <= cursor) break
      cursor = session.close
    }
    return close !== null && close >= bar.time ? close : null
  }
  const snapshot = async (request: IndicatorSnapshotRequest): Promise<RequestedBarsSnapshot> => {
    const req = { ...request, exchange: request.exchange ?? metadata.exchange }
    check(req)
    if (
      !finite(request.from) ||
      !finite(request.to) ||
      request.from > request.to ||
      (request.asOf !== undefined && !finite(request.asOf)) ||
      !Number.isSafeInteger(request.warmupBars ?? 0) ||
      (request.warmupBars ?? 0) < 0 ||
      (request.warmupBars ?? 0) > 50000
    )
      throw new Error('This study request has an invalid history window or warmup limit.')
    if (metadata.interval === 'D' && !calendar)
      throw new Error(
        'Daily study confirmation needs a declared trading calendar. Review the dataset calendar in Data Library.'
      )
    if (
      request.asOf !== undefined &&
      (metadata.priceBasis !== 'raw' || metadata.adjustment !== 'none')
    )
      throw new Error(
        'This adjusted snapshot does not preserve prices as known at the replay time. Choose raw history for requested replay studies.'
      )
    const bars = await read(
      { ...req, from: request.warmupBars ? version.start : request.from },
      !!request.warmupBars
    )
    const observed = bars
      .map((bar) => ({ bar, at: availableAt(bar) }))
      .filter(
        (item) =>
          request.asOf === undefined ||
          (item.at !== null && item.at <= Math.min(request.asOf, confirmationHorizon))
      )
    const earlier = observed
      .filter((item) => item.bar.time < request.from)
      .slice(-(request.warmupBars ?? 0))
    const selected = [
      ...(request.warmupBars ? earlier : []),
      ...observed.filter((item) => item.bar.time >= request.from && item.bar.time < request.to),
    ]
    return {
      bars: selected.map((item) => ({ ...item.bar })),
      availableAt: selected.map((item) => item.at),
      confirmed: selected.map(
        (item) =>
          item.at !== null &&
          item.at <= Math.min(request.asOf ?? confirmationHorizon, confirmationHorizon)
      ),
    }
  }
  const coverage = version.coverage as
    | {
        volumeUnknownRows?: number
        openInterestKnownRows?: number
        missingExpectedBars?: number | null
        unclassifiedGaps?: number
        gapCount?: number
        gaps?: unknown[]
      }
    | undefined
  const openInterestAvailable = (coverage?.openInterestKnownRows ?? 0) > 0
  const instrument = (row: Pick<SearchRow, 'symbol' | 'exchange'>): SearchRow | null =>
    row.symbol === metadata.symbol && row.exchange === metadata.exchange
      ? {
          symbol: metadata.symbol,
          exchange: metadata.exchange,
          name: `${version.name || metadata.symbol} · ${metadata.provider} · ${metadata.interval}`,
          datasetVersionId: version.id,
          datasetChecksum: version.checksum,
          quoteOnly: true,
          ...(openInterestAvailable ? { hasOpenInterest: true } : {}),
        }
      : null
  const quality = version.quality as { summary?: string; counts?: { gaps?: number } }
  return {
    ...choice(version),
    from,
    to,
    horizon,
    version,
    intervals: [metadata.interval],
    timezone: metadata.calendar.timezone,
    volumeAvailable: metadata.volumeMeaning !== 'unknown' && coverage?.volumeUnknownRows === 0,
    openInterestAvailable,
    calendar,
    gapStatus:
      !calendar || coverage?.missingExpectedBars === null || (coverage?.unclassifiedGaps ?? 0) > 0
        ? 'unknown'
        : (coverage?.missingExpectedBars ?? 0) > 0 ||
            (coverage?.gapCount ?? 0) > 0 ||
            (quality.counts?.gaps ?? 0) > 0 ||
            (coverage?.gaps?.length ?? 0) > 0
          ? 'reported'
          : 'none',
    quality: quality.summary || 'Structural checks only; source authenticity is not certified.',
    feed: { getBars: (request) => read(request) },
    provider: {
      supportsWarmup: true,
      requestBars: (request) =>
        read({ ...request, exchange: request.exchange ?? metadata.exchange }),
      requestSnapshot: snapshot,
    },
    async search(query, exchange, limit = 30, signal) {
      if (disposed || signal?.aborted) throw abort()
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
        throw new Error('Choose a supported symbol-search result limit.')
      const needle = query.trim().toLocaleLowerCase()
      return (!exchange || exchange === metadata.exchange) &&
        [metadata.symbol, metadata.exchange, metadata.provider, version.name].some((value) =>
          value?.toLocaleLowerCase().includes(needle)
        )
        ? [instrument(metadata)!]
        : []
    },
    instrument,
    dispose() {
      if (!disposed) {
        disposed = true
        raw.dispose()
      }
    },
  }
}
