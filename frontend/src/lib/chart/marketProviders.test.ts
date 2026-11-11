import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarketCandle } from '@/api/marketData'
import { liveFeedExchange, liveFeedIntervals, PlatformFeed } from './feeds/platformFeed'
import {
  MARKET_CHART_PROVIDERS,
  MARKET_IMPORT_PROVIDERS,
  marketHistoryParameters,
  marketProvider,
  marketSymbol,
} from './marketProviders'

afterEach(() => vi.useRealTimers())

describe('market adapter capabilities', () => {
  it.each([
    { id: 'mt5', rawSymbol: ' #AAPL.m ', symbol: '#AAPL.m', utc: false },
    { id: 'binance', rawSymbol: ' btcusdt ', symbol: 'BTCUSDT', utc: true },
    { id: 'hyperliquid', rawSymbol: ' kBONK ', symbol: 'kBONK', utc: true },
  ])('loads $id using the same chart contract and exact venue identity', async ({
    id,
    rawSymbol,
    symbol,
    utc,
  }) => {
    const stamp = Date.UTC(2026, 10, 10, 12)
    vi.useFakeTimers()
    vi.setSystemTime(stamp + 30_000)
    const exchange = liveFeedExchange(id)
    const interval = '1m'
    const nativeOpen = utc ? stamp : stamp + 3 * 3_600_000
    const candle: MarketCandle = {
      source: id,
      symbol,
      interval,
      openTimeMs: nativeOpen,
      rawProviderOpenTimeMs: utc ? undefined : nativeOpen,
      open: '1.1234',
      high: '1.1250',
      low: '1.1220',
      close: '1.1240',
      volume: '42',
    }
    const read = vi.fn(async () => ({ count: 1, candles: [candle] }))
    const feed = new PlatformFeed(
      {
        providerId: id,
        symbol,
        exchange,
        intervals: liveFeedIntervals(id),
        principalId: 'fixture-owner',
      },
      read
    )
    try {
      expect(marketSymbol(id, rawSymbol)).toBe(symbol)
      expect(MARKET_CHART_PROVIDERS).toContain(marketProvider(id))
      const bars = await feed.getBars({
        symbol: rawSymbol,
        exchange,
        interval,
        to: stamp / 1000 + 30,
      })
      expect(bars).toEqual([
        {
          time: nativeOpen / 1000,
          open: 1.1234,
          high: 1.125,
          low: 1.122,
          close: 1.124,
          volume: 42,
        },
      ])
      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({ provider: id, symbol, interval }),
        'fixture-owner',
        expect.any(AbortSignal)
      )
      expect(feed.utcAlignmentVerified).toBe(utc)
      await expect(feed.getBars({ symbol, exchange: 'another-venue', interval })).rejects.toThrow(
        /instruments only/
      )
      expect(read).toHaveBeenCalledOnce()
    } finally {
      feed.dispose()
    }
  })

  it('keeps directory entries separate from direct chart and saved import capabilities', () => {
    expect(marketProvider('oanda')?.credentials).toBe('client-token')
    expect(liveFeedIntervals('oanda')).toEqual([])
    expect(liveFeedIntervals('dukascopy')).toEqual([])
    expect(liveFeedIntervals('coinbase')).not.toContain('4h')
    expect(MARKET_IMPORT_PROVIDERS.map((row) => row.id)).not.toContain('mt5')
    expect(marketProvider('mt5')?.historyImport).toBe('clock-unverified')
    expect(marketSymbol('unknown-provider', 'BTCUSDT')).toBeNull()
    expect(() =>
      marketHistoryParameters('oanda', 'EUR_USD', '1m', { limit: '10', start: '', end: '' })
    ).toThrow(/cannot supply/)
  })

  it('counts partial Dukascopy UTC hours toward the upstream request budget', () => {
    const start = '2024-01-02T10:30'
    expect(
      marketHistoryParameters('dukascopy', 'EURUSD', '1h', {
        start,
        end: '2024-01-05T10:00',
        limit: '',
      })
    ).toMatchObject({ end: '2024-01-05T10:00:00.000Z' })
    expect(() =>
      marketHistoryParameters('dukascopy', 'EURUSD', '1h', {
        start,
        end: '2024-01-05T10:15',
        limit: '',
      })
    ).toThrow(/at most 72 UTC hours/)
  })
})
