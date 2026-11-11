import type { Bar, BarsPage, BarsPageRequest, BarsRequest, DataFeed } from 'chartly-charts'
import {
  type MarketCandle,
  MarketDataError,
  type Mt5ProfileScope,
  marketData,
} from '@/api/marketData'
import { marketChartIntervals, marketSymbol as platformSymbol } from '@/lib/chart/marketProviders'

export { platformSymbol }

export interface PlatformFeedConfig {
  providerId: string
  symbol: string
  exchange: string
  intervals: readonly string[]
  principalId: string
  mt5Profile?: Mt5ProfileScope
}

type FetchCandles = typeof marketData.candles
type FetchSymbols = typeof marketData.symbols
type RequestScope = { controller: AbortController; release(): void }
type PendingBars = { scope: RequestScope; consumers: number; promise: Promise<Bar[]> }
const MAX_RECENT_CHARTS = 16
const MAX_RECENT_BARS = 1000
const REFRESH_BARS = 5
const REQUEST_TIMEOUT_MS = 15_000

function withCancellation<T>(work: Promise<T>, signal?: AbortSignal, release?: () => void) {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return false
      settled = true
      signal?.removeEventListener('abort', cancel)
      release?.()
      return true
    }
    const cancel = () => {
      if (finish()) reject(signal?.reason)
    }
    work.then(
      (value) => {
        if (finish()) resolve(value)
      },
      (error: unknown) => {
        if (finish()) reject(error)
      }
    )
    if (signal?.aborted) cancel()
    else signal?.addEventListener('abort', cancel, { once: true })
  })
}

export interface PlatformFeedHealth {
  state: 'loading' | 'current' | 'delayed' | 'reconnecting' | 'unavailable'
  symbol: string
  interval: string
  message: string
  lastSuccessAt: number | null
  latestEventTimeMs: number | null
}

const normalized = (value: string) => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

const INTERVAL_SECONDS: Readonly<Record<string, number>> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  D: 86400,
}

const finiteText = (value: unknown): number => {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('The live feed returned an invalid candle value.')
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error('The live feed returned an invalid candle value.')
  return number
}

export function liveFeedExchange(providerId: string): string {
  return providerId.toUpperCase()
}

export function liveFeedIntervals(providerId: string): string[] {
  return [...marketChartIntervals(providerId)]
}

/**
 * Recent live candles from a platform feed.
 *
 * This intentionally serves the provider's bounded recent window (at most
 * 1,000 bars). Deep history/replay remains the saved-history system; this
 * feed never fabricates older bars or rewrites a dataset.
 *
 * The feed belongs to the *platform account*, not to one symbol: like
 * the terminal it mirrors, any of the venue's own symbols can be
 * charted through it (config.symbol is only the opening instrument).
 * Symbols are always venue-native spellings — search returns the
 * broker's exact names (prefixes/suffixes intact) and bars are
 * verified against the requested native symbol, never translated.
 */
export class PlatformFeed implements DataFeed {
  readonly #config: PlatformFeedConfig
  readonly #fetchCandles: FetchCandles
  readonly #fetchSymbols: FetchSymbols
  #cache = new Map<string, { at: number; bars: Bar[] }>()
  #inflight = new Map<string, PendingBars>()
  #requests = new Set<AbortController>()
  #health = new Map<string, PlatformFeedHealth>()
  #listeners = new Set<(health: PlatformFeedHealth) => void>()
  #disposed = false
  #connectionKey?: string

  constructor(
    config: PlatformFeedConfig,
    fetchCandles: FetchCandles = marketData.candles,
    fetchSymbols: FetchSymbols = marketData.symbols
  ) {
    this.#config = { ...config, intervals: [...config.intervals] }
    this.#fetchCandles = fetchCandles
    this.#fetchSymbols = fetchSymbols
  }

  dispose(): void {
    this.#disposed = true
    for (const controller of this.#requests) controller.abort()
    this.#requests.clear()
    this.#cache.clear()
    this.#inflight.clear()
    this.#health.clear()
    this.#listeners.clear()
  }

  get utcAlignmentVerified(): boolean {
    return this.#config.providerId !== 'mt5'
  }

  clock(): number {
    if (this.utcAlignmentVerified) return Math.floor(Date.now() / 1000)
    // A native inspection clock is a series coordinate, never a UTC mapping.
    return Math.max(0, ...[...this.#cache.values()].map(({ bars }) => bars.at(-1)?.time ?? 0))
  }

  status(symbol: string, interval: string): PlatformFeedHealth {
    const canonicalInterval = interval === 'D' ? '1d' : interval
    const current = this.#health.get(`${symbol}|${canonicalInterval}`)
    if (!current)
      return {
        state: 'loading',
        symbol,
        interval: canonicalInterval,
        message: 'Loading candles',
        lastSuccessAt: null,
        latestEventTimeMs: null,
      }
    if (current.state === 'current' && current.latestEventTimeMs !== null) {
      const age = Date.now() - current.latestEventTimeMs
      if (age > (INTERVAL_SECONDS[canonicalInterval] + 30) * 1000)
        return { ...current, state: 'delayed', message: 'Delayed candles · last valid bar is old' }
    }
    return current
  }

  subscribeStatus(listener: (health: PlatformFeedHealth) => void): () => void {
    if (this.#disposed) return () => {}
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #publish(key: string, health: PlatformFeedHealth): void {
    if (this.#disposed) return
    this.#health.delete(key)
    if (this.#health.size >= MAX_RECENT_CHARTS) {
      const oldest = this.#health.keys().next().value
      if (oldest !== undefined) this.#health.delete(oldest)
    }
    this.#health.set(key, health)
    for (const listener of this.#listeners) listener(health)
  }

  #requestScope(signal?: AbortSignal): RequestScope {
    signal?.throwIfAborted()
    if (this.#disposed)
      throw new DOMException('This live chart feed has been closed.', 'AbortError')
    const controller = new AbortController()
    const cancel = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', cancel, { once: true })
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    this.#requests.add(controller)
    return {
      controller,
      release: () => {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', cancel)
        this.#requests.delete(controller)
      },
    }
  }

  #assertRequest(request: BarsRequest): { symbol: string; interval: string } {
    if (this.#disposed) throw new Error('This live chart feed has been closed.')
    if (request.exchange !== this.#config.exchange)
      throw new Error(`This live feed serves ${this.#config.exchange} instruments only.`)
    const symbol =
      typeof request.symbol === 'string'
        ? platformSymbol(this.#config.providerId, request.symbol)
        : null
    if (!symbol) throw new Error('Enter the venue symbol exactly as the platform lists it.')
    const interval = request.interval === 'D' ? '1d' : request.interval
    if (!this.#config.intervals.includes(interval) || !(interval in INTERVAL_SECONDS))
      throw new Error(
        `The ${this.#config.providerId} live feed does not serve ${request.interval}.`
      )
    return { symbol, interval }
  }

  #assertMt5Connection(connectionKey?: string) {
    if (!this.#config.mt5Profile) return
    if (connectionKey && (!this.#connectionKey || connectionKey === this.#connectionKey)) {
      this.#connectionKey = connectionKey
      return
    }
    this.#cache.clear()
    throw new MarketDataError(
      'mt5.profile_binding_changed',
      'This profile’s MT5 connection changed. Reopen the chart to load the current account.',
      409
    )
  }

  #convert(candles: readonly MarketCandle[], symbol: string, interval: string): Bar[] {
    if (!candles.length) return []
    const terminal = this.#config.providerId === 'mt5'
    // Native MT5 timestamps remain provider coordinates. A tick's age cannot
    // identify a timezone or establish historical daylight-saving alignment.
    const seconds = terminal ? 60 : INTERVAL_SECONDS[interval]
    const byTime = new Map<number, Bar>()
    for (const candle of candles) {
      if (
        candle.source !== this.#config.providerId ||
        candle.symbol !== symbol ||
        candle.interval !== interval ||
        !Number.isInteger(candle.openTimeMs)
      )
        throw new Error('The live feed returned candles for another instrument or interval.')
      if (
        terminal &&
        candle.rawProviderOpenTimeMs !== undefined &&
        candle.rawProviderOpenTimeMs !== candle.openTimeMs
      )
        throw new Error('MT5 native candle time differs from its preserved source time.')
      const time = candle.openTimeMs / 1000
      if (!Number.isInteger(time) || time <= 0 || time % seconds !== 0)
        throw new Error('The live feed returned an unaligned candle time.')
      const open = finiteText(candle.open)
      const high = finiteText(candle.high)
      const low = finiteText(candle.low)
      const close = finiteText(candle.close)
      const volume = finiteText(candle.volume)
      if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0)
        throw new Error('The live feed returned an invalid candle value.')
      if (high < Math.max(open, close, low) || low > Math.min(open, close))
        throw new Error('The live feed returned an inconsistent candle.')
      byTime.set(time, { time: time as Bar['time'], open, high, low, close, volume })
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time)
  }

  async #recent(
    symbol: string,
    interval: string,
    signal?: AbortSignal,
    incremental = false
  ): Promise<Bar[]> {
    signal?.throwIfAborted()
    const key = `${symbol}|${interval}`
    const cached = this.#cache.get(key)
    if (cached && Date.now() - cached.at < 1000) return cached.bars
    let pending = this.#inflight.get(key)
    if (!pending) {
      const scope = this.#requestScope()
      const promise = this.#loadRecent(key, symbol, interval, scope, cached, incremental)
      pending = { scope, consumers: 0, promise }
      this.#inflight.set(key, pending)
    }
    const shared = pending
    shared.consumers++
    return withCancellation(shared.promise, signal, () => {
      shared.consumers--
      if (shared.consumers === 0 && this.#inflight.get(key) === shared) {
        // Detach before aborting so an immediate reselect gets a new request.
        this.#inflight.delete(key)
        shared.scope.controller.abort()
        shared.scope.release()
      }
    })
  }

  async #loadRecent(
    key: string,
    symbol: string,
    interval: string,
    scope: RequestScope,
    cached: { at: number; bars: Bar[] } | undefined,
    incremental: boolean
  ): Promise<Bar[]> {
    const { signal } = scope.controller
    const previous = this.status(symbol, interval)
    const read = async (limit: number) => {
      signal.throwIfAborted()
      const response = await withCancellation(
        this.#fetchCandles(
          {
            provider: this.#config.providerId,
            symbol,
            interval,
            limit,
            ...(this.#config.mt5Profile ? { mt5Profile: this.#config.mt5Profile } : {}),
          },
          this.#config.principalId,
          signal
        ),
        signal
      )
      signal.throwIfAborted()
      this.#assertMt5Connection(response.connectionKey)
      const bars = this.#convert(response.candles, symbol, interval).slice(-limit)
      if (!bars.length) throw new Error('The live feed returned no candles for this instrument.')
      return bars
    }
    const current = () => this.#inflight.get(key)?.scope === scope && !this.#disposed
    try {
      // Defer transport until the first consumer owns this request.
      await Promise.resolve()
      signal.throwIfAborted()
      const useTail =
        incremental &&
        cached &&
        previous.state !== 'reconnecting' &&
        previous.state !== 'unavailable' &&
        Date.now() - cached.at < (REFRESH_BARS - 1) * INTERVAL_SECONDS[interval] * 1000
      let incoming = await read(useTail ? REFRESH_BARS : MAX_RECENT_BARS)
      let bars = incoming
      if (useTail) {
        const previousTail = cached.bars.at(-1)?.time
        // Session gaps and missed bars can outgrow the tail. Require a shared
        // timestamp before replacing it, including on MT5's native clock.
        if (incoming.some((bar) => bar.time === previousTail)) {
          const merged = new Map(cached.bars.map((bar) => [bar.time, bar]))
          for (const bar of incoming) merged.set(bar.time, bar)
          bars = [...merged.values()].sort((a, b) => a.time - b.time).slice(-MAX_RECENT_BARS)
        } else {
          incoming = await read(MAX_RECENT_BARS)
          bars = incoming
        }
      }
      if (current()) {
        this.#cache.delete(key)
        if (this.#cache.size >= MAX_RECENT_CHARTS) {
          const oldest = this.#cache.keys().next().value
          if (oldest !== undefined) this.#cache.delete(oldest)
        }
        const receivedAt = Date.now()
        this.#cache.set(key, { at: receivedAt, bars })
        const latestEventTimeMs = this.utcAlignmentVerified ? incoming.at(-1)!.time * 1000 : null
        const fresh =
          latestEventTimeMs !== null &&
          latestEventTimeMs <= receivedAt + 5000 &&
          receivedAt - latestEventTimeMs <= (INTERVAL_SECONDS[interval] + 30) * 1000
        this.#publish(key, {
          state: fresh ? 'current' : 'delayed',
          symbol,
          interval,
          message: this.utcAlignmentVerified
            ? fresh
              ? 'Current candles'
              : 'Delayed candles · last valid bar is old'
            : 'MT5 broker time · UTC alignment unverified',
          lastSuccessAt: receivedAt,
          latestEventTimeMs,
        })
      }
      return bars
    } catch (error) {
      if (current()) {
        const accessFailure =
          error instanceof MarketDataError &&
          (error.code === 'market.provider_access_denied' ||
            error.code === 'market.provider_authentication' ||
            error.code === 'market.account_changed' ||
            error.code.startsWith('mt5.profile_binding_'))
        if (accessFailure) this.#cache.clear()
        this.#publish(key, {
          ...previous,
          state: cached && !accessFailure ? 'reconnecting' : 'unavailable',
          message: accessFailure
            ? error.message
            : cached
              ? 'Reconnecting · retaining last valid candles'
              : 'Candles unavailable · retry when the source is available',
        })
      }
      throw error
    } finally {
      scope.release()
      if (current()) this.#inflight.delete(key)
    }
  }

  async getBars(request: BarsRequest): Promise<Bar[]> {
    const { symbol, interval } = this.#assertRequest(request)
    const bars = await this.#recent(symbol, interval, request.signal, request.noCache === true)
    request.signal?.throwIfAborted()
    // A UTC wall-clock request cannot bound an unverified native-clock series.
    // This bounded inspector never presents these coordinates as UTC history.
    if (!this.utcAlignmentVerified) return bars
    const from = request.from ?? 0
    const to = request.to ?? Number.MAX_SAFE_INTEGER
    return bars.filter((bar) => bar.time >= from && bar.time <= to)
  }

  async getBarsPage(request: BarsPageRequest): Promise<BarsPage> {
    const { symbol, interval } = this.#assertRequest(request)
    const bars = await this.#recent(symbol, interval, request.signal)
    request.signal?.throwIfAborted()
    const older = bars.filter((bar) => bar.time < request.before && bar.time >= (request.from ?? 0))
    return {
      bars: older.slice(-Math.max(1, request.countBack)),
      // The recent live window is explicit; older history is not invented.
      hasMore: false,
      nextBefore: older[0]?.time ?? request.before,
    }
  }

  async searchSymbols(request: { query: string; signal?: AbortSignal }) {
    const scope = this.#requestScope(request.signal)
    const query = request.query.trim()
    const rows: Array<{ symbol: string; exchange: string; name: string }> = []
    const seen = new Set<string>()
    const push = (symbol: string, name: string) => {
      if (seen.has(symbol)) return
      seen.add(symbol)
      rows.push({ symbol, exchange: this.#config.exchange, name })
    }
    try {
      const result = await withCancellation(
        this.#fetchSymbols(
          {
            provider: this.#config.providerId,
            q: query,
            limit: 50,
            ...(this.#config.mt5Profile ? { mt5Profile: this.#config.mt5Profile } : {}),
          },
          this.#config.principalId,
          scope.controller.signal
        ),
        scope.controller.signal
      )
      scope.controller.signal.throwIfAborted()
      if (this.#disposed) throw new DOMException('The live chart feed was closed.', 'AbortError')
      this.#assertMt5Connection(result.connectionKey)
      for (const row of result.symbols) {
        const symbol =
          typeof row.symbol === 'string'
            ? platformSymbol(this.#config.providerId, row.symbol)
            : null
        if (symbol) push(symbol, row.name || `${symbol} · ${this.#config.providerId} live feed`)
      }
      return rows
    } catch (error) {
      scope.controller.signal.throwIfAborted()
      if (!(error instanceof MarketDataError) || error.code !== 'market.symbols_unsupported')
        throw error
      // Only a venue that explicitly lacks a catalog accepts a typed symbol.
    } finally {
      scope.release()
    }
    const needle = normalized(query)
    if (!needle || normalized(this.#config.symbol).includes(needle)) {
      push(this.#config.symbol, `${this.#config.symbol} · ${this.#config.providerId} live feed`)
    }
    // A prefix of the opening symbol ("EUR" for EURUSD) is a search,
    // not an exact symbol; only a full-looking typed name is offered.
    const openingNormalized = normalized(this.#config.symbol)
    const isOpeningPrefix =
      needle.length < openingNormalized.length && openingNormalized.startsWith(needle)
    const candidate = platformSymbol(this.#config.providerId, query)
    if (candidate && !isOpeningPrefix && needle.length >= 3) {
      push(candidate, `${candidate} · exact venue symbol`)
    }
    return rows
  }
}
