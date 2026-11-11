import { type Bar, OpenAlgoDataFeed } from 'chartly-charts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type DatasetVersion, dataLibrary } from '@/api/dataLibrary'
import { marketData } from '@/api/marketData'
import type { LiveFeedSourceChoice } from '@/components/trading/ChartContextControls'
import { PlatformFeed } from '@/lib/chart/feeds/platformFeed'
import type { JournalTrade, TraderPortfolio } from '@/lib/trader/db'
import { readChartQuery, resolveChartContext } from './chartContext'
import type { DatasetSourceChoice } from './chartSource'
import {
  chartSourceNavigation,
  chartSourceProfilePatch,
  type PreparedChartSource,
  prepareChartSource,
} from './chartSourceTransition'

const start = Date.parse('2026-11-02T09:00:00Z') / 1000
const live: LiveFeedSourceChoice = {
  kind: 'live-feed',
  providerId: 'binance',
  providerName: 'Binance',
  symbol: 'BTCUSDT',
  exchange: 'BINANCE',
  interval: '1m',
}
const profile: TraderPortfolio = {
  id: 1,
  name: 'Trading profile',
  kind: 'live',
  currency: 'USD',
  startingBalance: 10000,
  chartSource: live,
  defaultSymbol: live.symbol,
  defaultTimeframe: live.interval,
  liveSetup: {
    version: 1,
    account: { mode: 'later' },
    chartData: { mode: 'live-feed', ...live },
    replayHistory: { mode: 'later' },
  },
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
}
const version: DatasetVersion = {
  id: 'version-one',
  datasetId: 'dataset-one',
  name: 'Saved BTC candles',
  checksum: 'a'.repeat(64),
  sourceHash: 'b'.repeat(64),
  rowCount: 2,
  start,
  end: start + 60,
  sizeBytes: 100,
  createdAt: '2026-11-03T09:00:00Z',
  quality: {},
  coverage: {},
  dependencies: [],
  metadata: {
    provider: 'fixture',
    symbol: 'BTCUSDT',
    exchange: 'ARCHIVE',
    interval: '1m',
    currency: 'USD',
    priceBasis: 'raw',
    adjustment: 'none',
    volumeMeaning: 'unknown',
    allowNegativePrices: false,
    calendar: { id: 'unknown', timezone: 'UTC', sessions: [], exceptions: {} },
  },
}
const saved: DatasetSourceChoice = {
  kind: 'dataset',
  id: version.id,
  versionId: version.id,
  checksum: version.checksum,
  name: version.name,
  providerId: version.metadata.provider,
  symbol: version.metadata.symbol,
  exchange: version.metadata.exchange,
  interval: version.metadata.interval,
  from: version.start,
  to: version.end,
}
const trade: JournalTrade = {
  id: 2,
  portfolioId: 1,
  openDate: '2026-11-02T09:00:00Z',
  closeDate: '',
  timeframe: '1m',
  pair: 'BTCUSDT',
  strategy: '',
  direction: 'Buy',
  lots: 1,
  result: 'Open',
  rr: 0,
  sl: 0,
  tp: 0,
  pnl: 0,
  netPnl: 0,
  emotionalNotes: '',
  technicalNotes: '',
  otherNotes: '',
  duration: 0,
}

function context(params = new URLSearchParams('profileId=1'), withTrade = false) {
  return resolveChartContext('principal-one', readChartQuery(params), {
    profile: structuredClone(profile),
    trade: withTrade ? trade : undefined,
    bookId: params.get('bookId') ?? undefined,
    missing: false,
  })
}

const preparedSources = new Set<PreparedChartSource>()
beforeEach(() => {
  vi.spyOn(dataLibrary, 'version').mockResolvedValue(structuredClone(version))
  vi.spyOn(dataLibrary, 'bars').mockResolvedValue({
    versionId: version.id,
    checksum: version.checksum,
    bars: [start, start + 60].map((timestamp) => ({
      timestamp,
      open: '10',
      high: '12',
      low: '8',
      close: '11',
      volume: null,
    })),
  })
  vi.spyOn(marketData, 'candles').mockImplementation(async (request) => ({
    count: 2,
    candles: [start, start + 60].map((timestamp) => ({
      source: request.provider,
      symbol: request.symbol,
      interval: request.interval,
      openTimeMs: timestamp * 1000,
      open: '10',
      high: '12',
      low: '8',
      close: '11',
      volume: '0',
    })),
  }))
})
afterEach(() => {
  for (const source of preparedSources) source.dispose()
  preparedSources.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('chart source transitions through real source objects', () => {
  it('prepares live to saved to live without retaining the saved window or query instrument', async () => {
    const original = context(
      new URLSearchParams(
        `profileId=1&symbol=ETHUSDT&exchange=BINANCE&from=${start}&to=${start + 30}`
      )
    )
    const before = structuredClone(original.profile)
    const first = await prepareChartSource(original, saved, new AbortController().signal)
    if (first.source) preparedSources.add(first.source)
    expect(first.source?.kind).toBe('dataset')
    expect(first.context.source).toBe('dataset')
    expect(first.context.defaultSymbol).toEqual({
      symbol: 'BTCUSDT',
      exchange: 'ARCHIVE',
      interval: '1m',
    })
    expect(first.context.window).toEqual({ from: start, to: start + 60 })
    expect(first.navigation.get('datasetVersionId')).toBe(version.id)
    expect(original.profile).toEqual(before)

    const second = await prepareChartSource(first.context, live, new AbortController().signal)
    if (second.source) preparedSources.add(second.source)
    expect(second.source?.kind).toBe('live-feed')
    expect(second.context.source).toBe('live-feed')
    expect(second.context.dataset).toBeUndefined()
    expect(second.context.window).toBeUndefined()
    expect(second.context.liveFeed).toMatchObject({
      providerId: live.providerId,
      symbol: live.symbol,
      exchange: live.exchange,
      interval: live.interval,
    })
    for (const key of ['datasetVersionId', 'symbol', 'exchange', 'from', 'to'])
      expect(second.navigation.has(key)).toBe(false)
    expect(second.context.key).not.toBe(first.context.key)
  })

  it('keeps two providers of the same ticker distinct throughout preparation', async () => {
    const original = context()
    const other: LiveFeedSourceChoice = {
      ...live,
      providerId: 'bybit',
      providerName: 'Bybit',
      exchange: 'BYBIT',
    }
    const candidate = await prepareChartSource(original, other, new AbortController().signal)
    if (candidate.source) preparedSources.add(candidate.source)
    expect(marketData.candles).toHaveBeenCalledWith(
      { provider: 'bybit', symbol: 'BTCUSDT', interval: '1m', limit: 1000 },
      original.principal,
      expect.any(AbortSignal)
    )
    expect(candidate.context.liveFeed).toMatchObject({
      providerId: other.providerId,
      symbol: other.symbol,
      exchange: other.exchange,
      interval: other.interval,
    })
    expect(candidate.context.defaultSymbol?.exchange).toBe('BYBIT')
    expect(candidate.context.key).not.toBe(original.key)
    expect(original.liveFeed?.providerId).toBe('binance')
    expect(original.profile?.chartSource).toEqual(live)
  })

  it('removes old instrument, evidence and window overrides while preserving journal and book navigation', () => {
    const params = new URLSearchParams({
      profileId: '1',
      tradeId: '2',
      bookId: 'book-one',
      journalReturn: '/workspace/profiles/1/journal?book=book-one&tab=Trades',
      currentAnalysis: '1',
      symbol: 'BTCUSDT',
      exchange: 'BINANCE',
    })
    const original = context(params, true)
    original.navigation.set('evidenceId', 'old-evidence')
    original.navigation.set('from', String(start))
    original.navigation.set('to', String(start + 30))
    const before = original.navigation.toString()
    const next = chartSourceNavigation(original, saved)
    expect(next.get('datasetVersionId')).toBe(version.id)
    expect(next.get('profileId')).toBe('1')
    expect(next.get('tradeId')).toBe('2')
    expect(next.get('bookId')).toBe('book-one')
    expect(next.get('journalReturn')).toBe(params.get('journalReturn'))
    for (const key of ['evidenceId', 'currentAnalysis', 'symbol', 'exchange', 'from', 'to'])
      expect(next.has(key)).toBe(false)
    const liveNavigation = chartSourceNavigation({ ...original, navigation: next }, live)
    expect(liveNavigation.get('currentAnalysis')).toBe('1')
    expect(liveNavigation.get('journalReturn')).toBe(params.get('journalReturn'))
    expect(liveNavigation.has('datasetVersionId')).toBe(false)
    expect(original.navigation.toString()).toBe(before)
  })

  it('returns a profile patch that preserves account and replay configuration', () => {
    const original = structuredClone(profile)
    const before = structuredClone(original)
    const patch = chartSourceProfilePatch(original, saved)
    expect(patch.chartSource).toEqual({
      kind: 'dataset',
      versionId: saved.versionId,
      checksum: saved.checksum,
    })
    expect(patch.liveSetup).toMatchObject({
      account: original.liveSetup!.account,
      replayHistory: original.liveSetup!.replayHistory,
      chartData: { mode: 'saved-history', datasetVersionId: saved.versionId, symbol: saved.symbol },
    })
    expect(patch.defaultSymbol).toBe(saved.symbol)
    expect(patch.chartView).toBeUndefined()
    expect(original).toEqual(before)
  })

  it('keeps the same journal entry, book and return destination through a saved and live round trip', async () => {
    const params = new URLSearchParams({
      profileId: '1',
      tradeId: '2',
      bookId: 'book-one',
      journalReturn: '/workspace/profiles/1/journal?book=book-one&tab=Trades',
      currentAnalysis: '1',
    })
    const original = context(params, true)
    const first = await prepareChartSource(original, saved, new AbortController().signal)
    if (first.source) preparedSources.add(first.source)
    const second = await prepareChartSource(first.context, live, new AbortController().signal)
    if (second.source) preparedSources.add(second.source)
    for (const candidate of [first, second]) {
      expect(candidate.context.trade).toBe(trade)
      expect(candidate.context.bookId).toBe('book-one')
      expect(candidate.context.returnHref).toBe(original.returnHref)
      expect(candidate.navigation.get('journalReturn')).toBe(params.get('journalReturn'))
    }
    expect(first.context.historicalUnavailable).toBe(false)
    expect(second.context.historicalUnavailable).toBe(true)
    expect(second.navigation.get('currentAnalysis')).toBe('1')
  })

  it('rejects empty saved history without changing the profile or navigation', async () => {
    const original = context()
    const before = structuredClone(original.profile)
    const navigation = original.navigation.toString()
    vi.mocked(dataLibrary.bars).mockResolvedValueOnce({
      versionId: version.id,
      checksum: version.checksum,
      bars: [],
    })
    await expect(prepareChartSource(original, saved, new AbortController().signal)).rejects.toThrow(
      /no candles/
    )
    expect(original.profile).toEqual(before)
    expect(original.navigation.toString()).toBe(navigation)
  })

  it.each([
    'network',
    'empty',
  ] as const)('retains the original context when %s candles fail', async (failure) => {
    const original = context()
    const before = structuredClone(original.profile)
    const navigation = original.navigation.toString()
    const dispose = vi.spyOn(PlatformFeed.prototype, 'dispose')
    if (failure === 'network')
      vi.mocked(marketData.candles).mockRejectedValueOnce(new Error('Offline'))
    else vi.mocked(marketData.candles).mockResolvedValueOnce({ count: 0, candles: [] })
    await expect(
      prepareChartSource(original, { ...live, symbol: 'ETHUSDT' }, new AbortController().signal)
    ).rejects.toThrow()
    expect(dispose).toHaveBeenCalledOnce()
    expect(original.profile).toEqual(before)
    expect(original.navigation.toString()).toBe(navigation)
    expect(original.liveFeed?.symbol).toBe('BTCUSDT')
  })

  it('aborts delayed candles and disposes their candidate before it can replace the chart', async () => {
    let resolve!: (response: Awaited<ReturnType<typeof marketData.candles>>) => void
    vi.mocked(marketData.candles).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const original = context()
    const getBars = vi.spyOn(PlatformFeed.prototype, 'getBars')
    const dispose = vi.spyOn(PlatformFeed.prototype, 'dispose')
    const abort = new AbortController()
    const pending = prepareChartSource(original, { ...live, symbol: 'ETHUSDT' }, abort.signal)
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    const feed = getBars.mock.contexts[0]!
    const requestSignal = vi.mocked(marketData.candles).mock.calls[0][2]!
    abort.abort()
    expect(requestSignal.aborted).toBe(true)
    resolve({ count: 0, candles: [] })
    await rejection
    expect(dispose).toHaveBeenCalledOnce()
    await expect(
      feed.getBars({ symbol: 'ETHUSDT', exchange: 'BINANCE', interval: '1m' })
    ).rejects.toThrow(/closed/)
    expect(original.liveFeed?.symbol).toBe('BTCUSDT')
    expect(original.profile?.chartSource).toEqual(live)
  })

  it('retains the validated bootstrap bars across a slow save and a subsequent source outage', async () => {
    vi.useFakeTimers()
    const candidate = await prepareChartSource(context(), live, new AbortController().signal)
    const source = candidate.source!
    if (source.kind === 'legacy-connected') throw new Error('Expected the prepared live source')
    preparedSources.add(source)
    const seed = source.preparedBars!
    expect(seed).toHaveLength(2)
    expect(Object.isFrozen(seed) && seed.every(Object.isFrozen)).toBe(true)
    vi.advanceTimersByTime(2000)
    vi.mocked(marketData.candles).mockRejectedValueOnce(
      new Error('Source went offline during save')
    )
    await expect(
      source.feed.getBars({
        symbol: live.symbol,
        exchange: live.exchange,
        interval: live.interval,
      })
    ).rejects.toThrow(/offline/)
    expect(source.preparedBars).toBe(seed)
    expect(source.preparedBars?.map((bar) => bar.time)).toEqual([start, start + 60])
    expect(marketData.candles).toHaveBeenCalledTimes(2)
  })

  it('prepares the connected broker choice with credentials, exact instrument and frozen candles', async () => {
    const original = context()
    const before = structuredClone(original.profile)
    const navigation = original.navigation.toString()
    const now = Math.floor(Date.now() / 60000) * 60
    const bars: Bar[] = [now - 60, now].map((time) => ({
      time,
      open: 10,
      high: 12,
      low: 8,
      close: 11,
    }))
    const history = vi.spyOn(OpenAlgoDataFeed.prototype, 'getBars').mockResolvedValueOnce(bars)
    const fetchFixture = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path === '/api/websocket/apikey')
        return new Response(JSON.stringify({ status: 'success', api_key: 'fixture-client-key' }))
      if (path === '/api/websocket/config')
        return new Response(JSON.stringify({ websocket_url: 'ws://127.0.0.1:8877' }))
      throw new Error(`Unexpected fixture request ${path}`)
    })
    vi.stubGlobal('fetch', fetchFixture)
    const signal = new AbortController().signal
    const candidate = await prepareChartSource(original, null, signal)
    if (candidate.source) preparedSources.add(candidate.source)
    expect(candidate.source).toMatchObject({
      kind: 'legacy-connected',
      symbol: live.symbol,
      exchange: live.exchange,
      interval: live.interval,
      apiKey: 'fixture-client-key',
      wsUrl: 'ws://127.0.0.1:8877',
    })
    expect(history).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: live.symbol,
        exchange: live.exchange,
        interval: live.interval,
        signal,
      })
    )
    expect(fetchFixture).toHaveBeenCalledTimes(2)
    expect(candidate.navigation.get('symbol')).toBe(live.symbol)
    expect(candidate.navigation.get('exchange')).toBe(live.exchange)
    expect(candidate.context.source).toBe('legacy-connected')
    expect(candidate.context.profile).toMatchObject({
      id: original.profile!.id,
      name: original.profile!.name,
      kind: original.profile!.kind,
      currency: original.profile!.currency,
      chartSource: { kind: 'connected' },
    })
    expect(candidate.context.defaultSymbol).toEqual(original.defaultSymbol)
    const seed = candidate.source!.preparedBars!
    expect(seed).toEqual(bars)
    expect(Object.isFrozen(seed) && seed.every(Object.isFrozen)).toBe(true)
    bars[0].close = 999
    expect(seed[0].close).toBe(11)
    expect(original.profile).toEqual(before)
    expect(original.navigation.toString()).toBe(navigation)
  })

  it('retains the original profile and navigation when connected broker history fails', async () => {
    const original = context()
    const before = structuredClone(original.profile)
    const navigation = original.navigation.toString()
    vi.spyOn(OpenAlgoDataFeed.prototype, 'getBars').mockRejectedValueOnce(
      new Error('Broker history offline')
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        if (path === '/api/websocket/apikey')
          return new Response(JSON.stringify({ status: 'success', api_key: 'fixture-client-key' }))
        if (path === '/api/websocket/config')
          return new Response(JSON.stringify({ websocket_url: 'ws://127.0.0.1:8877' }))
        throw new Error(`Unexpected fixture request ${path}`)
      })
    )
    await expect(prepareChartSource(original, null, new AbortController().signal)).rejects.toThrow(
      /history offline/
    )
    expect(original.profile).toEqual(before)
    expect(original.navigation.toString()).toBe(navigation)
    expect(original.source).toBe('live-feed')
  })

  it.each([
    'checksum',
    'symbol',
    'exchange',
    'interval',
    'provider',
    'archived',
  ] as const)('rejects %s disagreement between the selected dataset and its current metadata', async (field) => {
    const changed = structuredClone(version)
    if (field === 'checksum') changed.checksum = 'c'.repeat(64)
    else if (field === 'archived') changed.archivedAt = '2026-11-03T09:00:00Z'
    else changed.metadata[field] = 'different'
    vi.mocked(dataLibrary.version).mockResolvedValueOnce(changed)
    const original = context()
    await expect(prepareChartSource(original, saved, new AbortController().signal)).rejects.toThrow(
      /saved source changed/
    )
    expect(dataLibrary.bars).not.toHaveBeenCalled()
    expect(original.profile?.chartSource).toEqual(live)
  })

  it('rejects returned candle data with a different dataset checksum', async () => {
    const original = context()
    vi.mocked(dataLibrary.bars).mockResolvedValueOnce({
      versionId: version.id,
      checksum: 'c'.repeat(64),
      bars: [],
    })
    await expect(prepareChartSource(original, saved, new AbortController().signal)).rejects.toThrow(
      /does not match/
    )
    expect(original.profile?.chartSource).toEqual(live)
  })
})
