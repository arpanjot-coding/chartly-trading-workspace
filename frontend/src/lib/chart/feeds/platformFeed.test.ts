import { afterEach, describe, expect, it, vi } from 'vitest'
import { type MarketCandle, MarketDataError } from '@/api/marketData'
import { PlatformFeed } from './platformFeed'

const candle = (openTimeMs: number, patch: Partial<MarketCandle> = {}): MarketCandle => ({
  source: 'mt5',
  symbol: 'EURUSD',
  interval: '15m',
  openTimeMs,
  open: '1.10000',
  high: '1.10100',
  low: '1.09900',
  close: '1.10050',
  volume: '321',
  timeBasis: 'provider-epoch-unverified',
  utcAlignmentVerified: false,
  ...patch,
})

describe('PlatformFeed', () => {
  afterEach(() => vi.useRealTimers())

  it('preserves native MT5 coordinates without treating quote age as an offset', async () => {
    const providerBase = Date.parse('2026-11-04T10:00:00Z')
    const fetchCandles = vi.fn(async () => ({
      count: 2,
      candles: [
        candle(providerBase, { observedSkewSeconds: -10800 }),
        candle(providerBase + 900_000, { high: '1.10200', close: '1.10150' }),
      ],
    }))
    const feed = new PlatformFeed(
      {
        providerId: 'mt5',
        symbol: 'EURUSD',
        exchange: 'MT5',
        intervals: ['15m'],
        principalId: 'owner-one',
      },
      fetchCandles as never
    )
    const bars = await feed.getBars({
      symbol: 'EURUSD',
      exchange: 'MT5',
      interval: '15m',
      from: 0,
      to: Number.MAX_SAFE_INTEGER,
    })
    expect(bars.map((bar) => new Date(bar.time * 1000).toISOString())).toEqual([
      '2026-11-04T10:00:00.000Z',
      '2026-11-04T10:15:00.000Z',
    ])
    expect(bars[1].close).toBe(1.1015)
    expect(fetchCandles).toHaveBeenCalledWith(
      { provider: 'mt5', symbol: 'EURUSD', interval: '15m', limit: 1000 },
      'owner-one',
      expect.any(AbortSignal)
    )
    expect(feed.utcAlignmentVerified).toBe(false)
    expect(feed.status('EURUSD', '15m')).toMatchObject({
      state: 'delayed',
      latestEventTimeMs: null,
      message: 'MT5 broker time · UTC alignment unverified',
    })
  })

  it('never merges candles from a replacement MT5 connection into the open chart', async () => {
    vi.useFakeTimers()
    const time = Date.parse('2026-11-04T10:00:00Z')
    const scope = { originId: 'workspace-one', profileId: 7 }
    const fetchCandles = vi
      .fn()
      .mockResolvedValueOnce({ count: 1, candles: [candle(time)], connectionKey: 'first' })
      .mockResolvedValueOnce({
        count: 1,
        candles: [candle(time, { open: '2.1', high: '2.2', low: '2.0', close: '2.15' })],
        connectionKey: 'replacement',
      })
    const feed = new PlatformFeed(
      {
        providerId: 'mt5',
        symbol: 'EURUSD',
        exchange: 'MT5',
        intervals: ['15m'],
        principalId: 'owner-one',
        mt5Profile: scope,
      },
      fetchCandles
    )
    const instrument = { symbol: 'EURUSD', exchange: 'MT5', interval: '15m' }
    await expect(feed.getBars(instrument)).resolves.toMatchObject([{ close: 1.1005 }])
    await vi.advanceTimersByTimeAsync(1100)
    await expect(feed.getBars({ ...instrument, noCache: true })).rejects.toMatchObject({
      code: 'mt5.profile_binding_changed',
    })
    expect(fetchCandles.mock.calls[1][0]).toMatchObject({ mt5Profile: scope, limit: 5 })
    expect(feed.status('EURUSD', '15m').state).toBe('unavailable')
    feed.dispose()
  })

  it('serves other instruments on the same venue and refuses other venues', async () => {
    const base = Date.parse('2026-11-04T08:00:00Z')
    const fetchCandles = vi.fn(async (request: { symbol: string }) => ({
      count: 1,
      candles: [
        candle(base, {
          source: 'binance',
          symbol: request.symbol,
          interval: '1h',
          observedSkewSeconds: undefined,
        }),
      ],
    }))
    const feed = new PlatformFeed(
      {
        providerId: 'binance',
        symbol: 'BTCUSDT',
        exchange: 'BINANCE',
        intervals: ['1h'],
        principalId: 'owner-one',
      },
      fetchCandles as never,
      vi.fn(async () => ({
        symbols: [
          { symbol: 'ETHUSDT', exchange: 'BINANCE', name: 'Ethereum / USDT' },
          { symbol: 'BTCUSDT', exchange: 'BINANCE', name: 'Bitcoin / USDT' },
        ],
        count: 2,
      })) as never
    )
    const bars = await feed.getBars({
      symbol: 'ETHUSDT',
      exchange: 'BINANCE',
      interval: '1h',
      from: 0,
      to: Number.MAX_SAFE_INTEGER,
    })
    expect(bars).toHaveLength(1)
    expect(fetchCandles).toHaveBeenCalledWith(
      { provider: 'binance', symbol: 'ETHUSDT', interval: '1h', limit: 1000 },
      'owner-one',
      expect.any(AbortSignal)
    )
    await expect(
      feed.getBars({ symbol: 'ETHUSDT', exchange: 'OKX', interval: '1h', from: 0, to: 1 })
    ).rejects.toThrow(/serves BINANCE instruments only/)
    await expect(feed.searchSymbols({ query: 'ETH' })).resolves.toEqual([
      { symbol: 'ETHUSDT', exchange: 'BINANCE', name: 'Ethereum / USDT' },
      { symbol: 'BTCUSDT', exchange: 'BINANCE', name: 'Bitcoin / USDT' },
    ])
  })

  it('loads exact MT5 symbols with punctuation on the native H4 grid', async () => {
    const fetchCandles = vi.fn(async () => ({
      count: 1,
      candles: [
        candle(Date.parse('2026-11-04T12:00:00Z'), { symbol: '#AAPL.pro', interval: '4h' }),
      ],
    }))
    const feed = new PlatformFeed(
      {
        providerId: 'mt5',
        symbol: 'EURUSD',
        exchange: 'MT5',
        intervals: ['4h'],
        principalId: 'owner-one',
      },
      fetchCandles
    )
    const bars = await feed.getBars({ symbol: '#AAPL.pro', exchange: 'MT5', interval: '4h' })
    expect(bars[0].time).toBe(Date.parse('2026-11-04T12:00:00Z') / 1000)
    expect(fetchCandles).toHaveBeenCalledWith(
      { provider: 'mt5', symbol: '#AAPL.pro', interval: '4h', limit: 1000 },
      'owner-one',
      expect.any(AbortSignal)
    )
  })

  it('leaves unknown MT5 symbols empty and surfaces catalog failures', async () => {
    const error = new MarketDataError('market.terminal_not_running', 'Start MetaTrader 5.', 409)
    const fetchSymbols = vi
      .fn()
      .mockResolvedValueOnce({ symbols: [], count: 0 })
      .mockRejectedValueOnce(error)
    const feed = new PlatformFeed(
      {
        providerId: 'mt5',
        symbol: 'EURUSD',
        exchange: 'MT5',
        intervals: ['15m'],
        principalId: 'owner-one',
      },
      vi.fn(),
      fetchSymbols
    )
    await expect(feed.searchSymbols({ query: 'MADEUP' })).resolves.toEqual([])
    await expect(feed.searchSymbols({ query: 'GBPUSD' })).rejects.toBe(error)
  })

  it('does not reuse an aborted request when the user returns to the same pair', async () => {
    const fetchCandles = vi
      .fn<typeof import('@/api/marketData').marketData.candles>()
      .mockImplementationOnce(
        (_request, _owner, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
      )
      .mockResolvedValue({ count: 1, candles: [candle(Date.parse('2026-11-04T12:00:00Z'))] })
    const feed = new PlatformFeed(
      {
        providerId: 'mt5',
        symbol: 'EURUSD',
        exchange: 'MT5',
        intervals: ['15m'],
        principalId: 'owner-one',
      },
      fetchCandles
    )
    const request = { symbol: 'EURUSD', exchange: 'MT5', interval: '15m' }
    const first = new AbortController()
    const cancelled = expect(
      feed.getBars({ ...request, signal: first.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    first.abort()
    await expect(feed.getBars(request)).resolves.toHaveLength(1)
    await cancelled
    expect(fetchCandles).toHaveBeenCalledTimes(2)
  })

  it('shares one upstream read across four panes and keeps it alive after one pane leaves', async () => {
    vi.useFakeTimers()
    let reply!: (response: { count: number; candles: MarketCandle[] }) => void
    const fetchCandles = vi.fn<typeof import('@/api/marketData').marketData.candles>(
      () =>
        new Promise((resolve) => {
          reply = resolve
        })
    )
    const feed = new PlatformFeed(
      {
        providerId: 'mt5',
        symbol: 'EURUSD',
        exchange: 'MT5',
        intervals: ['15m'],
        principalId: 'owner',
      },
      fetchCandles
    )
    const request = { symbol: 'EURUSD', exchange: 'MT5', interval: '15m' }
    const panes = Array.from({ length: 4 }, () => new AbortController())
    const results = panes.map(({ signal }) => feed.getBars({ ...request, signal }))
    const cancelled = expect(results[0]).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    expect(fetchCandles).toHaveBeenCalledTimes(1)
    const upstream = fetchCandles.mock.calls[0][2]
    panes[0].abort()
    await cancelled
    expect(upstream?.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(1)

    reply({ count: 1, candles: [candle(Date.parse('2026-11-10T12:00:00Z'))] })
    const bars = await Promise.all(results.slice(1))
    expect(bars.map((page) => page.length)).toEqual([1, 1, 1])
    expect(vi.getTimerCount()).toBe(0)
    feed.dispose()
  })

  it('merges a five-bar refresh and repairs a missing overlap or outage with bounded history', async () => {
    vi.useFakeTimers()
    const base = Date.parse('2026-11-10T12:00:00Z')
    vi.setSystemTime(base + 30_000)
    const row = (offset: number, patch?: Partial<MarketCandle>) =>
      candle(base + offset * 60_000, {
        source: 'binance',
        symbol: 'BTCUSDT',
        interval: '1m',
        ...patch,
      })
    const window = (end: number) =>
      Array.from({ length: 1000 }, (_, index) => row(end - 999 + index))
    const response = (candles: MarketCandle[]) => ({ count: candles.length, candles })
    const fetchCandles = vi
      .fn<typeof import('@/api/marketData').marketData.candles>()
      .mockResolvedValueOnce(response(window(0)))
      .mockResolvedValueOnce(
        response([row(-4), row(-3), row(-2), row(0, { close: '1.10075' }), row(1)])
      )
      .mockResolvedValueOnce(response([row(2), row(3), row(4), row(5), row(6)]))
      .mockResolvedValueOnce(response(window(6)))
      .mockRejectedValueOnce(
        new MarketDataError('market.provider_access_denied', 'Venue denies access.')
      )
      .mockResolvedValueOnce(response(window(7)))
    const feed = new PlatformFeed(
      {
        providerId: 'binance',
        symbol: 'BTCUSDT',
        exchange: 'BINANCE',
        intervals: ['1m'],
        principalId: 'owner',
      },
      fetchCandles
    )
    const request = { symbol: 'BTCUSDT', exchange: 'BINANCE', interval: '1m', noCache: true }
    expect(await feed.getBars(request)).toHaveLength(1000)
    vi.setSystemTime(base + 90_000)
    const refreshed = await feed.getBars(request)
    expect(refreshed).toHaveLength(1000)
    expect(refreshed[0].time).toBe(row(-998).openTimeMs / 1000)
    expect(refreshed.at(-3)?.time).toBe(row(-1).openTimeMs / 1000)
    expect(refreshed.at(-2)?.close).toBe(1.10075)
    expect(refreshed.at(-1)?.time).toBe(row(1).openTimeMs / 1000)

    vi.setSystemTime(base + 100_000)
    const repaired = await feed.getBars(request)
    expect(repaired).toHaveLength(1000)
    expect(feed.status('BTCUSDT', '1m').latestEventTimeMs).toBe(row(6).openTimeMs)
    vi.setSystemTime(base + 110_000)
    await expect(feed.getBars(request)).rejects.toThrow('Venue denies access.')
    expect(feed.status('BTCUSDT', '1m')).toMatchObject({
      state: 'unavailable',
      message: 'Venue denies access.',
      latestEventTimeMs: row(6).openTimeMs,
    })
    vi.setSystemTime(base + 120_000)
    await feed.getBars(request)
    expect(fetchCandles.mock.calls.map(([{ limit }]) => limit)).toEqual([1000, 5, 5, 1000, 5, 1000])
    expect(vi.getTimerCount()).toBe(0)
    feed.dispose()
  })

  it('falls back to an exact typed venue symbol when the venue has no list', async () => {
    const feed = new PlatformFeed(
      {
        providerId: 'mt5',
        symbol: 'EURUSD',
        exchange: 'MT5',
        intervals: ['15m'],
        principalId: 'owner-one',
      },
      vi.fn() as never,
      vi.fn(async () => {
        throw new MarketDataError('market.symbols_unsupported', 'No venue catalog', 400)
      }) as never
    )
    await expect(feed.searchSymbols({ query: 'GBPUSD' })).resolves.toEqual([
      { symbol: 'GBPUSD', exchange: 'MT5', name: 'GBPUSD · exact venue symbol' },
    ])
    await expect(feed.searchSymbols({ query: 'EUR' })).resolves.toEqual([
      { symbol: 'EURUSD', exchange: 'MT5', name: 'EURUSD · mt5 live feed' },
    ])
  })

  it('does not claim deeper history beyond the recent live window', async () => {
    const base = Date.parse('2026-11-04T08:00:00Z')
    const fetchCandles = vi.fn(async () => ({
      count: 2,
      candles: [
        candle(base, {
          source: 'binance',
          symbol: 'BTCUSDT',
          interval: '1h',
          observedSkewSeconds: undefined,
        }),
        candle(base + 3_600_000, {
          source: 'binance',
          symbol: 'BTCUSDT',
          interval: '1h',
          observedSkewSeconds: undefined,
        }),
      ],
    }))
    const feed = new PlatformFeed(
      {
        providerId: 'binance',
        symbol: 'BTCUSDT',
        exchange: 'BINANCE',
        intervals: ['1h'],
        principalId: 'owner-one',
      },
      fetchCandles as never
    )
    const page = await feed.getBarsPage({
      symbol: 'BTCUSDT',
      exchange: 'BINANCE',
      interval: '1h',
      from: 0,
      before: base / 1000 + 3600,
      countBack: 500,
    })
    expect(page.bars).toHaveLength(1)
    expect(page.hasMore).toBe(false)
  })

  it('shows an ahead-of-UTC native series without filtering it by an unverified UTC clock', async () => {
    const nativeTime = Date.parse('2026-11-08T15:30:00Z')
    const feed = new PlatformFeed(
      {
        providerId: 'mt5',
        symbol: 'EURUSD',
        exchange: 'MT5',
        intervals: ['15m'],
        principalId: 'owner',
      },
      vi.fn(async () => ({ count: 1, candles: [candle(nativeTime)] }))
    )
    const bars = await feed.getBars({
      symbol: 'EURUSD',
      exchange: 'MT5',
      interval: '15m',
      to: nativeTime / 1000 - 3 * 3600,
    })
    expect(bars[0].time).toBe(nativeTime / 1000)
    expect(feed.clock()).toBe(nativeTime / 1000)
  })

  it('does not shift half-hour sessions or H4 opens across a daylight-saving boundary', async () => {
    const times = ['2026-03-27T08:30:00Z', '2026-03-30T09:30:00Z']
    const feed = new PlatformFeed(
      {
        providerId: 'mt5',
        symbol: 'EURUSD',
        exchange: 'MT5',
        intervals: ['4h'],
        principalId: 'owner',
      },
      vi.fn(async () => ({
        count: 2,
        candles: times.map((time) => candle(Date.parse(time), { interval: '4h' })),
      }))
    )
    const bars = await feed.getBars({ symbol: 'EURUSD', exchange: 'MT5', interval: '4h' })
    expect(bars.map((bar) => bar.time)).toEqual(times.map((time) => Date.parse(time) / 1000))
  })

  it('uses candle age for public-feed freshness and preserves the last successful read across an outage', async () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-11-10T12:00:30Z')
    vi.setSystemTime(now)
    const base = Date.parse('2026-11-10T12:00:00Z')
    const row = (at: number) =>
      candle(at, { source: 'binance', symbol: 'BTCUSDT', interval: '1m', timeBasis: 'utc' })
    const fetchCandles = vi
      .fn()
      .mockResolvedValueOnce({ count: 1, candles: [row(base)] })
      .mockRejectedValueOnce(new MarketDataError('market.offline', 'Offline'))
      .mockResolvedValueOnce({
        count: 3,
        candles: [row(base), row(base + 60_000), row(base + 120_000)],
      })
    const feed = new PlatformFeed(
      {
        providerId: 'binance',
        symbol: 'BTCUSDT',
        exchange: 'BINANCE',
        intervals: ['1m'],
        principalId: 'owner',
      },
      fetchCandles
    )
    const statuses = vi.fn()
    const unsubscribe = feed.subscribeStatus(statuses)
    const request = { symbol: 'BTCUSDT', exchange: 'BINANCE', interval: '1m' }
    expect(await feed.getBars(request)).toHaveLength(1)
    expect(feed.status('BTCUSDT', '1m').state).toBe('current')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(feed.status('BTCUSDT', '1m').state).toBe('delayed')
    await expect(feed.getBars(request)).rejects.toThrow('Offline')
    expect(feed.status('BTCUSDT', '1m')).toMatchObject({
      state: 'reconnecting',
      lastSuccessAt: now,
      latestEventTimeMs: base,
    })
    expect(await feed.getBars(request)).toHaveLength(3)
    expect(feed.status('BTCUSDT', '1m').state).toBe('current')
    unsubscribe()
    const calls = statuses.mock.calls.length
    feed.dispose()
    expect(statuses).toHaveBeenCalledTimes(calls)
  })

  it('keeps a successful response with stale candles delayed rather than claiming a closed market', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-11-08T12:00:00Z'))
    const feed = new PlatformFeed(
      {
        providerId: 'binance',
        symbol: 'BTCUSDT',
        exchange: 'BINANCE',
        intervals: ['1h'],
        principalId: 'owner',
      },
      vi.fn(async () => ({
        count: 1,
        candles: [
          candle(Date.parse('2026-11-06T12:00:00Z'), {
            source: 'binance',
            symbol: 'BTCUSDT',
            interval: '1h',
          }),
        ],
      }))
    )
    await feed.getBars({ symbol: 'BTCUSDT', exchange: 'BINANCE', interval: '1h' })
    expect(feed.status('BTCUSDT', '1h')).toMatchObject({ state: 'delayed' })
  })

  it('aborts outstanding history and symbol requests and fences a late answer after disposal', async () => {
    let resolveBars!: (value: { count: number; candles: MarketCandle[] }) => void
    let historySignal: AbortSignal | undefined
    let symbolSignal: AbortSignal | undefined
    const feed = new PlatformFeed(
      {
        providerId: 'mt5',
        symbol: 'EURUSD',
        exchange: 'MT5',
        intervals: ['15m'],
        principalId: 'owner',
      },
      (_request, _principal, signal) => {
        historySignal = signal
        return new Promise((resolve) => {
          resolveBars = resolve
        })
      },
      (_request, _principal, signal) => {
        symbolSignal = signal
        return new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        )
      }
    )
    const bars = expect(
      feed.getBars({ symbol: 'EURUSD', exchange: 'MT5', interval: '15m' })
    ).rejects.toMatchObject({ name: 'AbortError' })
    const symbols = expect(feed.searchSymbols({ query: 'EUR' })).rejects.toMatchObject({
      name: 'AbortError',
    })
    await Promise.resolve()
    feed.dispose()
    resolveBars({ count: 1, candles: [candle(Date.parse('2026-11-10T12:00:00Z'))] })
    await Promise.all([bars, symbols])
    expect(historySignal?.aborted).toBe(true)
    expect(symbolSignal?.aborted).toBe(true)
  })

  it('times out an unresponsive source, releases its timer, and allows a fresh retry', async () => {
    vi.useFakeTimers()
    const fetchCandles = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ count: 1, candles: [candle(Date.parse('2026-11-10T12:00:00Z'))] })
    const feed = new PlatformFeed(
      {
        providerId: 'mt5',
        symbol: 'EURUSD',
        exchange: 'MT5',
        intervals: ['15m'],
        principalId: 'owner',
      },
      fetchCandles
    )
    const request = { symbol: 'EURUSD', exchange: 'MT5', interval: '15m' }
    const timedOut = expect(feed.getBars(request)).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(15_000)
    await timedOut
    expect(feed.status('EURUSD', '15m').state).toBe('unavailable')
    expect(vi.getTimerCount()).toBe(0)
    await expect(feed.getBars(request)).resolves.toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    feed.dispose()
  })

  it('bounds retained chart health and releases timers and listeners through repeated reads', async () => {
    vi.useFakeTimers()
    const feed = new PlatformFeed(
      {
        providerId: 'binance',
        symbol: 'BTCUSDT',
        exchange: 'BINANCE',
        intervals: ['1h'],
        principalId: 'owner',
      },
      vi.fn(async (request) => ({
        count: 1,
        candles: [
          candle(Date.parse('2026-11-10T12:00:00Z'), {
            source: 'binance',
            symbol: request.symbol,
            interval: '1h',
          }),
        ],
      }))
    )
    for (let index = 0; index < 300; index++) {
      const listener = vi.fn()
      const unsubscribe = feed.subscribeStatus(listener)
      await feed.getBars({ symbol: `BTC${index}`, exchange: 'BINANCE', interval: '1h' })
      unsubscribe()
    }
    expect(feed.status('BTC0', '1h').state).toBe('loading')
    expect(feed.status('BTC299', '1h').state).not.toBe('loading')
    expect(vi.getTimerCount()).toBe(0)
    feed.dispose()
    expect(feed.status('BTC299', '1h').state).toBe('loading')
  })
})
