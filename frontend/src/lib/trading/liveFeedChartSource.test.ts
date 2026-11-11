import { afterEach, expect, it, vi } from 'vitest'
import { PlatformFeed } from '@/lib/chart/feeds/platformFeed'
import { createLiveFeedChartSource } from './liveFeedChartSource'

afterEach(() => vi.useRealTimers())

it('keeps unverified native bars out of confirmed UTC snapshots and replay', async () => {
  const openTimeMs = Date.parse('2026-10-26T08:30:00Z')
  const config = {
    providerId: 'mt5',
    providerName: 'MT5',
    symbol: 'EURUSD',
    exchange: 'MT5',
    interval: '1h',
    intervals: ['1h'],
  }
  const feed = new PlatformFeed(
    { ...config, principalId: 'owner' },
    vi.fn(async () => ({
      count: 1,
      candles: [
        {
          source: 'mt5',
          symbol: 'EURUSD',
          interval: '1h',
          openTimeMs,
          rawProviderOpenTimeMs: openTimeMs,
          utcAlignmentVerified: false,
          open: '1',
          high: '2',
          low: '1',
          close: '2',
          volume: '1',
        },
      ],
    }))
  )
  const source = createLiveFeedChartSource(config, 'owner', feed)
  const snapshot = await source.provider.requestSnapshot!({
    symbol: 'EURUSD',
    exchange: 'MT5',
    interval: '1h',
    from: 0,
    to: Number.MAX_SAFE_INTEGER,
  })
  expect(source.utcAlignmentVerified).toBe(false)
  expect(source.replayAllowed).toBe(false)
  expect(source.timeBasis).toBe('provider-epoch-unverified')
  expect(source.timeBasisLabel).toMatch(/broker time.*unverified/)
  expect(snapshot.bars[0].time).toBe(openTimeMs / 1000)
  expect(snapshot.availableAt).toEqual([null])
  expect(snapshot.confirmed).toEqual([false])
  source.dispose()
})

it('confirms public UTC bars only after their interval closes', async () => {
  vi.useFakeTimers()
  const now = Date.parse('2026-11-10T12:30:00Z')
  vi.setSystemTime(now)
  const config = {
    providerId: 'binance',
    providerName: 'Binance',
    symbol: 'BTCUSDT',
    exchange: 'BINANCE',
    interval: '1h',
    intervals: ['1h'],
  }
  const feed = new PlatformFeed(
    { ...config, principalId: 'owner' },
    vi.fn(async () => ({
      count: 2,
      candles: [11, 12].map((hour) => ({
        source: 'binance',
        symbol: 'BTCUSDT',
        interval: '1h',
        openTimeMs: Date.parse(`2026-11-10T${hour}:00:00Z`),
        open: '1',
        high: '2',
        low: '1',
        close: '2',
        volume: '1',
      })),
    }))
  )
  const source = createLiveFeedChartSource(config, 'owner', feed)
  const snapshot = await source.provider.requestSnapshot!({
    symbol: 'BTCUSDT',
    exchange: 'BINANCE',
    interval: '1h',
    from: 0,
    to: now / 1000,
  })
  expect(source.timeBasis).toBe('utc')
  expect(source.clock()).toBe(now / 1000)
  expect(snapshot.availableAt).toEqual([Date.parse('2026-11-10T12:00:00Z') / 1000, null])
  expect(snapshot.confirmed).toEqual([true, false])
  source.dispose()
})
