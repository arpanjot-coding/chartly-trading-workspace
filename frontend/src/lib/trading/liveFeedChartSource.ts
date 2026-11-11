import type {
  Bar,
  DataFeed,
  IndicatorBarsProviderAccess,
  IndicatorSnapshotRequest,
  SessionCalendar,
} from 'chartly-charts'
import type { Mt5ProfileScope } from '@/api/marketData'
import { PlatformFeed, type PlatformFeedHealth } from '@/lib/chart/feeds/platformFeed'
import type { SearchRow } from '@/lib/trading/terminal'

export interface LiveFeedChartSourceConfig {
  providerId: string
  providerName: string
  symbol: string
  exchange: string
  interval: string
  intervals: readonly string[]
  mt5Profile?: Mt5ProfileScope
}

export interface LiveFeedChartSource extends LiveFeedChartSourceConfig {
  readonly preparedBars?: readonly Bar[]
  readonly principalId: string
  readonly kind: 'live-feed'
  readonly timezone: 'UTC'
  readonly timeBasis: 'utc' | 'provider-epoch-unverified'
  readonly timeBasisLabel: string
  readonly utcAlignmentVerified: boolean
  readonly replayAllowed: boolean
  readonly calendar: SessionCalendar | null
  readonly volumeAvailable: boolean
  readonly openInterestAvailable: false
  readonly feed: DataFeed
  readonly provider: IndicatorBarsProviderAccess
  search(
    query: string,
    exchange?: string,
    limit?: number,
    signal?: AbortSignal
  ): Promise<SearchRow[]>
  instrument(row: Pick<SearchRow, 'symbol' | 'exchange'>): SearchRow | null
  clock(): number
  status(symbol: string, interval: string): PlatformFeedHealth
  subscribeStatus(listener: (health: PlatformFeedHealth) => void): () => void
  dispose(): void
}

const INTERVAL_SECONDS: Readonly<Record<string, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  D: 86400,
}

export function createLiveFeedChartSource(
  config: LiveFeedChartSourceConfig,
  principalId: string,
  feed = new PlatformFeed({
    providerId: config.providerId,
    symbol: config.symbol,
    exchange: config.exchange,
    intervals: config.intervals,
    principalId,
    mt5Profile: config.mt5Profile,
  })
): LiveFeedChartSource {
  let disposed = false
  // The feed belongs to the platform account, not one symbol: any of
  // the venue's native symbols on this exchange may be charted through
  // it. config.symbol is the opening instrument only.
  const assertTarget = (symbol: string, exchange?: string, interval?: string) => {
    if (disposed) throw new Error('This live chart feed has been closed.')
    if (!symbol || (exchange !== undefined && exchange !== config.exchange))
      throw new Error(`This live feed serves ${config.exchange} instruments only.`)
    if (interval !== undefined && !config.intervals.includes(interval === 'D' ? '1d' : interval))
      throw new Error(`The ${config.providerName} live feed does not serve ${interval}.`)
  }
  const provider: IndicatorBarsProviderAccess = {
    supportsWarmup: false,
    requestBars: async (request) => {
      assertTarget(request.symbol, request.exchange, request.interval)
      return feed.getBars({
        symbol: request.symbol,
        exchange: config.exchange,
        interval: request.interval,
        from: request.from,
        to: request.to,
        signal: request.signal,
      })
    },
    requestSnapshot: async (request: IndicatorSnapshotRequest) => {
      assertTarget(request.symbol, request.exchange, request.interval)
      const bars = await feed.getBars({
        symbol: request.symbol,
        exchange: config.exchange,
        interval: request.interval,
        from: request.from,
        to: request.to,
        signal: request.signal,
      })
      const seconds = INTERVAL_SECONDS[request.interval] ?? 0
      const now = Math.floor(Date.now() / 1000)
      const availableAt = bars.map((bar) => {
        const close = bar.time + seconds
        return feed.utcAlignmentVerified && seconds && close <= now ? close : null
      })
      return {
        bars,
        availableAt,
        confirmed: availableAt.map((value) => value !== null),
      }
    },
  }
  const source: LiveFeedChartSource = {
    ...config,
    principalId,
    intervals: [...config.intervals],
    kind: 'live-feed',
    // UTC formatting renders the provider's raw numeric coordinates unchanged.
    // For MT5 the adjacent label declares that these coordinates are unverified.
    timezone: 'UTC',
    timeBasis: feed.utcAlignmentVerified ? 'utc' : 'provider-epoch-unverified',
    timeBasisLabel: feed.utcAlignmentVerified
      ? 'UTC'
      : 'MT5 broker time · UTC alignment unverified',
    utcAlignmentVerified: feed.utcAlignmentVerified,
    replayAllowed: feed.utcAlignmentVerified,
    calendar: null,
    volumeAvailable: true,
    openInterestAvailable: false,
    feed,
    provider,
    clock: () => feed.clock(),
    status: (symbol, interval) => feed.status(symbol, interval),
    subscribeStatus: (listener) => feed.subscribeStatus(listener),
    async search(query, exchange, limit, signal) {
      if (exchange !== undefined && exchange !== config.exchange) return []
      const matches = await feed.searchSymbols({ query, signal })
      return (limit === undefined ? matches : matches.slice(0, limit)).map((match) => ({
        symbol: match.symbol,
        exchange: match.exchange ?? config.exchange,
        name: match.name ?? config.providerName,
      }))
    },
    instrument(row) {
      if (!row.symbol || row.exchange !== config.exchange) return null
      return {
        symbol: row.symbol,
        exchange: config.exchange,
        name: `${row.symbol} · ${config.providerName}`,
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      feed.dispose()
    },
  }
  return Object.freeze(source)
}
