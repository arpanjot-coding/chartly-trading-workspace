import { describe, expect, it, vi } from 'vitest'
import type { DatasetBar } from '@/api/dataLibrary'
import { datasetVersion } from '@/pages/historify/testFixtures'
import { createDatasetVersionFeed, datasetBar } from './datasetVersionFeed'

const candle: DatasetBar = {
  timestamp: 1793610000,
  open: '1.12',
  high: '1.15',
  low: '1.11',
  close: '1.14',
  volume: null,
}
describe('exact dataset version feed', () => {
  it('preserves optional open-interest observations, including zero, while unknown is absent', () => {
    expect(datasetBar({ ...candle, openInterest: '0' })).toHaveProperty('openInterest', 0)
    expect(datasetBar({ ...candle, openInterest: '12.5' })).toHaveProperty('openInterest', 12.5)
    expect(datasetBar({ ...candle, openInterest: null })).not.toHaveProperty('openInterest')
    expect(datasetBar(candle)).not.toHaveProperty('openInterest')
    for (const openInterest of ['', 'not-a-value', '-1', 'Infinity'])
      expect(datasetBar({ ...candle, openInterest })).toBeNull()
  })
  it('pins the version/checksum and passes UTC bounds and cancellation unchanged', async () => {
    const version = datasetVersion()
    const fetch = vi.fn(async () => ({
      versionId: version.id,
      checksum: version.checksum,
      bars: [candle],
    }))
    const signal = new AbortController().signal
    const bars = await createDatasetVersionFeed(version, fetch).getBars({
      symbol: 'EURUSD',
      exchange: 'LOCAL',
      interval: '1m',
      from: 1793610000,
      to: 1793610120,
      signal,
    })
    expect(fetch).toHaveBeenCalledWith(version.id, {
      from: 1793610000,
      to: 1793610120,
      limit: 50000,
      signal: expect.any(AbortSignal),
    })
    expect(bars[0]).not.toHaveProperty('volume')
    expect(bars[0]).toMatchObject({ open: 1.12, close: 1.14 })
  })
  it('never relabels a native version into another instrument or resolution', async () => {
    const fetch = vi.fn()
    const feed = createDatasetVersionFeed(datasetVersion(), fetch)
    for (const request of [
      { symbol: 'BTCUSD', exchange: 'LOCAL', interval: '1m' },
      { symbol: 'EURUSD', exchange: 'OTHER', interval: '1m' },
      { symbol: 'EURUSD', exchange: 'LOCAL', interval: '5m' },
    ])
      await expect(feed.getBars(request)).rejects.toThrow('pinned')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects a mismatching receipt or invalid candle instead of drawing partial trusted history', async () => {
    const version = datasetVersion()
    const fetch = vi.fn(async () => ({
      versionId: 'other-version',
      checksum: version.checksum,
      bars: [candle],
    }))
    await expect(
      createDatasetVersionFeed(version, fetch).getBars({
        symbol: 'EURUSD',
        exchange: 'LOCAL',
        interval: '1m',
      })
    ).rejects.toThrow('does not match')
    fetch.mockResolvedValue({
      versionId: version.id,
      checksum: version.checksum,
      bars: [{ ...candle, high: '0' }],
    })
    await expect(
      createDatasetVersionFeed(version, fetch).getBars({
        symbol: 'EURUSD',
        exchange: 'LOCAL',
        interval: '1m',
      })
    ).rejects.toThrow('invalid candle')
  })
  it('keeps declared zero/fractional volume and negative prices while unknown remains absent', () => {
    expect(datasetBar({ ...candle, volume: '0' })).toHaveProperty('volume', 0)
    expect(datasetBar({ ...candle, volume: '0.25' })).toHaveProperty('volume', 0.25)
    expect(datasetBar({ ...candle, open: '-3', high: '-1', low: '-4', close: '-2' })).toMatchObject(
      { open: -3, close: -2 }
    )
    expect(datasetBar({ ...candle, close: 'not-a-price' })).toBeNull()
  })
  it('serializes different multi-pane windows so one feed cannot exhaust the two-worker pool', async () => {
    const version = datasetVersion()
    let active = 0
    let peak = 0
    const fetch = vi.fn(async () => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return { versionId: version.id, checksum: version.checksum, bars: [candle] }
    })
    const feed = createDatasetVersionFeed(version, fetch)
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, from) =>
        feed.getBars({ symbol: 'EURUSD', exchange: 'LOCAL', interval: '1m', from })
      )
    )
    expect(peak).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(8)
    expect(results).toHaveLength(8)
    feed.dispose()
  })
  it('coalesces identical windows while aborting consumers independently and isolating returned bars', async () => {
    const version = datasetVersion()
    let release!: (result: { versionId: string; checksum: string; bars: DatasetBar[] }) => void
    let ownedSignal: AbortSignal | undefined
    const fetch = vi.fn((_id: string, request: { signal?: AbortSignal }) => {
      ownedSignal = request.signal
      return new Promise<{ versionId: string; checksum: string; bars: DatasetBar[] }>((resolve) => {
        release = resolve
      })
    })
    const feed = createDatasetVersionFeed(version, fetch)
    const controller = new AbortController()
    const one = feed.getBars({
      symbol: 'EURUSD',
      exchange: 'LOCAL',
      interval: '1m',
      signal: controller.signal,
    })
    const two = feed.getBars({ symbol: 'EURUSD', exchange: 'LOCAL', interval: '1m' })
    const three = feed.getBars({ symbol: 'EURUSD', exchange: 'LOCAL', interval: '1m' })
    const rejected = expect(one).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(ownedSignal?.aborted).toBe(false)
    release({ versionId: version.id, checksum: version.checksum, bars: [candle] })
    const [second, third] = await Promise.all([two, three])
    second[0].close = 99
    expect(third[0].close).toBe(1.14)
    expect(fetch).toHaveBeenCalledTimes(1)
    feed.dispose()
  })
  it('bounds pending work, removes queued aborted loads and disposes every outstanding consumer', async () => {
    const version = datasetVersion()
    const fetch = vi.fn(
      () => new Promise<{ versionId: string; checksum: string; bars: DatasetBar[] }>(() => {})
    )
    const feed = createDatasetVersionFeed(version, fetch)
    const queuedController = new AbortController()
    const waiting = Array.from({ length: 17 }, (_, from) =>
      feed.getBars({
        symbol: 'EURUSD',
        exchange: 'LOCAL',
        interval: '1m',
        from,
        ...(from === 16 ? { signal: queuedController.signal } : {}),
      })
    )
    await expect(
      feed.getBars({ symbol: 'EURUSD', exchange: 'LOCAL', interval: '1m', from: 18 })
    ).rejects.toThrow('too many pending')
    const queuedRejected = expect(waiting[16]).rejects.toMatchObject({ name: 'AbortError' })
    queuedController.abort()
    await queuedRejected
    waiting.push(feed.getBars({ symbol: 'EURUSD', exchange: 'LOCAL', interval: '1m', from: 18 }))
    const settled = Promise.allSettled(waiting)
    feed.dispose()
    expect(
      (await settled).every(
        (result) => result.status === 'rejected' && result.reason.name === 'AbortError'
      )
    ).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(
      feed.getBars({ symbol: 'EURUSD', exchange: 'LOCAL', interval: '1m' })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
