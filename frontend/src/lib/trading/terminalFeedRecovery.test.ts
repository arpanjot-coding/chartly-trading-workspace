import type { Bar, DataLoadingController } from 'chartly-charts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type DatasetVersion, dataLibrary } from '@/api/dataLibrary'
import type { MarketCandle } from '@/api/marketData'
import { PlatformFeed } from '@/lib/chart/feeds/platformFeed'
import type { TraderPortfolio } from '@/lib/trader/db'
import { resolveChartContext } from './chartContext'
import { type PreparedChartSource, prepareChartSource } from './chartSourceTransition'
import { createLiveFeedChartSource } from './liveFeedChartSource'
import { type TerminalCallbacks, TradingTerminal } from './terminal'

const terminals: TradingTerminal[] = []
const sources: PreparedChartSource[] = []
const now = Date.parse('2026-11-10T12:02:30Z')
const base = Date.parse('2026-11-10T12:00:00Z')
type SeriesProbe = {
  rawBars: Bar[]
  price: { getData(): readonly Bar[] }
  data: DataLoadingController
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  localStorage.clear()
  const context = new Proxy(
    {
      measureText: (text: string) => ({ width: text.length * 7 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
    },
    { get: (target, key) => target[key as keyof typeof target] ?? (() => {}) }
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const terminal of terminals.splice(0)) terminal.destroy()
  for (const source of sources.splice(0)) source.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function mount(source: PreparedChartSource, storageKey = `recovery-${terminals.length}`) {
  const callbacks: TerminalCallbacks = {
    onReady: vi.fn(),
    onToast: vi.fn(),
    onWsState: vi.fn(),
    onSymbolLoaded: vi.fn(),
    onLtp: vi.fn(),
  }
  const terminal = new TradingTerminal({
    apiKey: '',
    wsUrl: '',
    ...(source.kind === 'dataset' ? { source } : { liveSource: source }),
    storageKey,
    container: document.createElement('div'),
    legendEl: document.createElement('div'),
    getTheme: () => ({ mode: 'dark', appMode: 'live' }),
    callbacks,
  })
  terminals.push(terminal)
  return { terminal, callbacks, series: terminal as unknown as SeriesProbe }
}

function candle(openTimeMs: number, provider = 'mt5'): MarketCandle {
  return {
    source: provider,
    symbol: provider === 'mt5' ? 'EURUSD' : 'BTCUSDT',
    interval: '1m',
    openTimeMs,
    rawProviderOpenTimeMs: provider === 'mt5' ? openTimeMs : undefined,
    timeBasis: provider === 'mt5' ? 'provider-epoch-unverified' : 'utc',
    utcAlignmentVerified: provider !== 'mt5',
    open: '100',
    high: '103',
    low: '99',
    close: '102',
    volume: '14',
  }
}

function liveSource(
  provider: 'mt5' | 'binance',
  fetchCandles: typeof import('@/api/marketData').marketData.candles
) {
  const config = {
    providerId: provider,
    providerName: provider,
    symbol: provider === 'mt5' ? 'EURUSD' : 'BTCUSDT',
    exchange: provider.toUpperCase(),
    interval: '1m',
    intervals: ['1m'],
  }
  const feed = new PlatformFeed({ ...config, principalId: 'owner' }, fetchCandles)
  const source = createLiveFeedChartSource(config, 'owner', feed)
  sources.push(source)
  return source
}

it('renders ahead-of-UTC MT5 native bars without shifts or clipping and keeps temporal actions gated', async () => {
  const nativeTimes = [0, 60_000, 120_000].map((offset) => base + 3 * 3600_000 + offset)
  const source = liveSource(
    'mt5',
    vi.fn(async () => ({
      count: nativeTimes.length,
      candles: nativeTimes.map((time) => candle(time)),
    }))
  )
  localStorage.setItem(
    'native-chartsettings',
    JSON.stringify({
      'time.timezone': 'America/New_York',
      'axisChrome.sessionClock': true,
      'axisChrome.barCountdown': true,
    })
  )
  const { terminal, series, callbacks } = mount(source, 'native')
  await terminal.init()
  expect(series.price.getData().map((bar) => bar.time)).toEqual(
    nativeTimes.map((time) => time / 1000)
  )
  expect(terminal.liveChart()?.timezone()).toBe('UTC')
  expect(terminal.liveChart()?.axisChromeOptions()).toMatchObject({
    sessionClock: false,
    barCountdown: false,
  })
  await terminal.applyChartSettings({
    'time.timezone': 'Asia/Kolkata',
    'axisChrome.barCountdown': true,
  })
  expect(terminal.liveChart()?.timezone()).toBe('UTC')
  expect(terminal.liveChart()?.axisChromeOptions()).toMatchObject({
    sessionClock: false,
    barCountdown: false,
  })
  terminal.startReplay(0)
  expect(terminal.replayActive()).toBe(false)
  expect(terminal.evidenceView()).toBeNull()
  expect(callbacks.onToast).toHaveBeenCalledWith(expect.stringMatching(/UTC verification/), 'err')
})

const profile: TraderPortfolio = {
  id: 7,
  name: 'Recovery profile',
  kind: 'live',
  currency: 'USD',
  startingBalance: 0,
  defaultSymbol: 'BTCUSDT',
  defaultTimeframe: '1m',
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
}
const context = () =>
  resolveChartContext(
    'owner',
    { profileId: 7 },
    {
      profile,
      missing: false,
      historicalUnavailable: false,
    }
  )

describe.each([1, 2, 4])('%i prepared chart panes', (count) => {
  it('uses its validated live candles after a slow save and an API outage', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        count: 3,
        candles: [0, 60_000, 120_000].map((offset) => candle(base + offset, 'binance')),
      })
    )
    vi.stubGlobal('fetch', fetcher)
    const prepared = await prepareChartSource(
      context(),
      {
        kind: 'live-feed',
        providerId: 'binance',
        providerName: 'Binance',
        symbol: 'BTCUSDT',
        exchange: 'BINANCE',
        interval: '1m',
      },
      new AbortController().signal
    )
    expect(prepared.source).toBeDefined()
    sources.push(prepared.source!)
    vi.setSystemTime(now + 10_000)
    fetcher.mockRejectedValue(new Error('Data service offline'))
    for (let pane = 0; pane < count; pane++) {
      const { terminal, series } = mount(prepared.source!)
      await terminal.init()
      expect(series.price.getData().map((bar) => bar.time)).toEqual(
        [base, base + 60_000, base + 120_000].map((time) => time / 1000)
      )
    }
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('uses its validated saved candles after the history service becomes unavailable', async () => {
    const version: DatasetVersion = {
      id: 'prepared-version',
      datasetId: 'prepared-dataset',
      name: 'Prepared history',
      checksum: 'a'.repeat(64),
      sourceHash: 'b'.repeat(64),
      rowCount: 3,
      start: base / 1000,
      end: base / 1000 + 120,
      sizeBytes: 100,
      createdAt: '2026-11-10T13:00:00Z',
      quality: {},
      coverage: {},
      dependencies: [],
      metadata: {
        provider: 'fixture',
        symbol: 'EXAMPLE',
        exchange: 'LOCAL',
        interval: '1m',
        priceBasis: 'raw',
        adjustment: 'none',
        volumeMeaning: 'unknown',
        allowNegativePrices: false,
        calendar: { id: 'unknown', timezone: 'UTC', sessions: [], exceptions: {} },
      },
    }
    vi.spyOn(dataLibrary, 'version').mockResolvedValue(version)
    const fetchBars = vi.spyOn(dataLibrary, 'bars').mockResolvedValue({
      versionId: version.id,
      checksum: version.checksum,
      bars: [0, 60, 120].map((offset) => ({
        timestamp: base / 1000 + offset,
        open: '100',
        high: '103',
        low: '99',
        close: '102',
        volume: null,
      })),
    })
    const prepared = await prepareChartSource(
      context(),
      {
        kind: 'dataset',
        id: version.datasetId,
        versionId: version.id,
        checksum: version.checksum,
        name: version.name,
        providerId: 'fixture',
        symbol: 'EXAMPLE',
        exchange: 'LOCAL',
        interval: '1m',
        from: version.start,
        to: version.end,
      },
      new AbortController().signal
    )
    sources.push(prepared.source!)
    fetchBars.mockRejectedValue(new Error('History service offline'))
    for (let pane = 0; pane < count; pane++) {
      const { terminal, series } = mount(prepared.source!)
      await terminal.init()
      expect(series.price.getData()).toHaveLength(3)
    }
    expect(fetchBars).toHaveBeenCalledOnce()
  })
})

it('retains candles through a failed refresh, preserves offline status, and repairs the complete bounded gap online', async () => {
  const candles = [0, 60_000, 120_000].map((offset) => candle(base + offset, 'binance'))
  const fetchCandles = vi
    .fn()
    .mockResolvedValueOnce({ count: candles.length, candles })
    .mockRejectedValueOnce(new Error('Feed offline'))
    .mockResolvedValue({
      count: 11,
      candles: Array.from({ length: 11 }, (_, index) => candle(base + index * 60_000, 'binance')),
    })
  const source = liveSource('binance', fetchCandles)
  const { terminal, series, callbacks } = mount(source)
  await terminal.init()
  vi.setSystemTime(now + 120_000)
  await series.data.refresh()
  expect(series.price.getData().map((bar) => bar.time)).toEqual(
    candles.map((row) => row.openTimeMs / 1000)
  )
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  window.dispatchEvent(new Event('offline'))
  document.dispatchEvent(new Event('visibilitychange'))
  const requestsBefore = fetchCandles.mock.calls.length
  await vi.advanceTimersByTimeAsync(11_000)
  expect(fetchCandles).toHaveBeenCalledTimes(requestsBefore)
  expect(callbacks.onWsState).toHaveBeenLastCalledWith(
    expect.stringMatching(/reconnecting.*Offline/)
  )
  vi.setSystemTime(base + 10 * 60_000 + 30_000)
  online.mockReturnValue(true)
  window.dispatchEvent(new Event('online'))
  await vi.advanceTimersByTimeAsync(1)
  expect(series.price.getData().map((bar) => bar.time)).toEqual(
    Array.from({ length: 11 }, (_, index) => base / 1000 + index * 60)
  )
  expect(callbacks.onWsState).toHaveBeenLastCalledWith(
    expect.stringMatching(/current.*Current candles/)
  )
})

it('keeps the displayed bars and last success time when reconnect returns an empty response', async () => {
  const candles = [0, 60_000, 120_000].map((offset) => candle(base + offset, 'binance'))
  const fetchCandles = vi
    .fn()
    .mockResolvedValueOnce({ count: candles.length, candles })
    .mockRejectedValueOnce(new Error('Connection interrupted'))
    .mockResolvedValueOnce({ count: 0, candles: [] })
    .mockResolvedValueOnce({
      count: 4,
      candles: Array.from({ length: 4 }, (_, index) => candle(base + index * 60_000, 'binance')),
    })
  const source = liveSource('binance', fetchCandles)
  const { terminal, series, callbacks } = mount(source)
  await terminal.init()
  const lastSuccess = source.status('BTCUSDT', '1m').lastSuccessAt
  vi.setSystemTime(now + 60_000)
  await series.data.refresh()
  await series.data.refresh()
  expect(series.price.getData()).toHaveLength(3)
  expect(source.status('BTCUSDT', '1m').lastSuccessAt).toBe(lastSuccess)
  expect(callbacks.onWsState).toHaveBeenLastCalledWith(expect.stringMatching(/reconnecting/))
  await series.data.refresh()
  expect(series.price.getData()).toHaveLength(4)
  expect(callbacks.onWsState).toHaveBeenLastCalledWith(expect.stringMatching(/current/))
})

it('discards an old reconnect response after selecting a different symbol', async () => {
  let release!: (value: { count: number; candles: MarketCandle[] }) => void
  const original = [0, 60_000, 120_000].map((offset) => candle(base + offset, 'binance'))
  const replacement = original.map((row) => ({ ...row, symbol: 'ETHUSDT', close: '101' }))
  const fetchCandles = vi
    .fn()
    .mockResolvedValueOnce({ count: original.length, candles: original })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    .mockResolvedValue({ count: replacement.length, candles: replacement })
  const source = liveSource('binance', fetchCandles)
  const { terminal, series, callbacks } = mount(source)
  await terminal.init()
  vi.setSystemTime(now + 2000)
  const repairing = series.data.refresh()
  await vi.advanceTimersByTimeAsync(0)
  expect(fetchCandles).toHaveBeenCalledTimes(2)
  expect(await terminal.loadSymbol({ symbol: 'ETHUSDT', exchange: 'BINANCE' })).toBe(true)
  release({ count: original.length, candles: original })
  await repairing
  expect(terminal.chartContext()?.symbol).toBe('ETHUSDT')
  expect(series.price.getData().map((bar) => bar.close)).toEqual([101, 101, 101])
  expect(callbacks.onSymbolLoaded).toHaveBeenLastCalledWith(
    expect.objectContaining({ symbol: 'ETHUSDT' })
  )
})
