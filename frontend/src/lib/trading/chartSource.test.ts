import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ema } from 'chartly-charts'
import { describe, expect, it, vi } from 'vitest'
import type { DatasetBar, DatasetCatalog, DatasetVersion, dataLibrary } from '@/api/dataLibrary'
import {
  createDatasetChartSource,
  datasetSessionCalendar,
  datasetSourceChoices,
} from './chartSource'

const start = Date.parse('2026-11-02T09:00:00Z') / 1000
type FetchBounds = Parameters<typeof dataLibrary.bars>[1]
const measurements: Record<string, unknown> = {}
const record = (name: string, value: unknown) => {
  measurements[name] = value
  mkdirSync(join(process.cwd(), '../tmp'), { recursive: true })
  writeFileSync(
    join(process.cwd(), '../tmp/p05-source-measurements.json'),
    JSON.stringify(measurements, null, 2)
  )
}
function version(changes: Partial<DatasetVersion> = {}): DatasetVersion {
  return {
    id: 'version-a',
    datasetId: 'dataset-a',
    name: 'Saved sample',
    checksum: 'fixed-content',
    sourceHash: 'fixed-source',
    metadata: {
      provider: 'source-a',
      symbol: 'EXAMPLE',
      exchange: 'LOCAL',
      interval: '1m',
      currency: 'USD',
      priceBasis: 'raw',
      adjustment: 'none',
      volumeMeaning: 'unknown',
      allowNegativePrices: false,
      calendar: { id: 'unknown', timezone: 'UTC', sessions: [], exceptions: {} },
    },
    rowCount: 10,
    start,
    end: start + 9 * 60,
    sizeBytes: 100,
    quality: { summary: 'Structural checks only.' },
    coverage: { volumeUnknownRows: 10 },
    createdAt: '2026-11-03T09:00:00Z',
    dependencies: [],
    ...changes,
  }
}
function wire(time: number, close = 2): DatasetBar {
  return {
    timestamp: time,
    open: String(close),
    high: String(close + 1),
    low: String(close - 1),
    close: String(close),
    volume: null,
  }
}
function setup(
  value = version(),
  rows = Array.from({ length: 10 }, (_, index) => wire(start + index * 60, index + 1))
) {
  const fetch = vi.fn(async (_id: string, bounds: FetchBounds) => ({
    versionId: value.id,
    checksum: value.checksum,
    bars: rows.filter(
      (row) =>
        row.timestamp >= (bounds.from ?? -Infinity) && row.timestamp <= (bounds.to ?? Infinity)
    ),
  }))
  const source = createDatasetChartSource(value, { fetchBars: fetch })
  const request = {
    symbol: value.metadata.symbol,
    exchange: value.metadata.exchange,
    interval: value.metadata.interval,
    from: value.start,
    to: value.end + 1000,
  }
  return { source, fetch, request, rows }
}
const catalog = (versions: DatasetVersion[], nextOffset: number | null = null): DatasetCatalog => ({
  principalId: 'owner',
  revision: 5,
  versions,
  nextOffset,
  jobs: [],
  capabilities: {},
})

describe('private original-chart source', () => {
  it('rejects quarantined time before constructing a chart or requesting candles', () => {
    const fetch = vi.fn()
    expect(() =>
      createDatasetChartSource(
        version({
          quarantine: {
            reason: 'dataset.time_unverified',
            timeBasis: 'tick-derived-unverified',
            message: 'Reimport this history with verified UTC timestamps.',
          },
        }),
        { fetchBars: fetch }
      )
    ).toThrow('Reimport this history with verified UTC timestamps.')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not turn partially unclassified declared-calendar coverage into a clean gap status', () => {
    const metadata = {
      ...version().metadata,
      calendar: {
        id: 'continuous',
        timezone: 'UTC',
        sessions: [{ weekdays: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '24:00' }],
        exceptions: {},
      },
    }
    const uncertain = createDatasetChartSource(
      version({ metadata, coverage: { missingExpectedBars: null, unclassifiedGaps: 1 } })
    )
    expect(uncertain.gapStatus).toBe('unknown')
    uncertain.dispose()
    const reported = createDatasetChartSource(
      version({ metadata, coverage: { missingExpectedBars: 0, gapCount: 2, gaps: [] } })
    )
    expect(reported.gapStatus).toBe('reported')
    reported.dispose()
  })
  it('preserves provided open-interest and zero without turning unknown into an intrinsic false capability', async () => {
    const observed = setup(
      version({ coverage: { volumeUnknownRows: 1, openInterestKnownRows: 1 } }),
      [{ ...wire(start), openInterest: '0' }]
    )
    expect(observed.source.openInterestAvailable).toBe(true)
    expect(observed.source.instrument({ symbol: 'EXAMPLE', exchange: 'LOCAL' })).toHaveProperty(
      'hasOpenInterest',
      true
    )
    expect((await observed.source.feed.getBars(observed.request))[0]).toHaveProperty(
      'openInterest',
      0
    )
    observed.source.dispose()
    const unknown = setup()
    expect(unknown.source.openInterestAvailable).toBe(false)
    expect(unknown.source.instrument({ symbol: 'EXAMPLE', exchange: 'LOCAL' })).not.toHaveProperty(
      'hasOpenInterest'
    )
    expect((await unknown.source.feed.getBars(unknown.request))[0]).not.toHaveProperty(
      'openInterest'
    )
    unknown.source.dispose()
  })
  it('exposes native reads and metadata without execution, stream or broker methods', async () => {
    const { source, request } = setup()
    expect(source).toMatchObject({
      kind: 'dataset',
      id: 'version-a',
      providerId: 'source-a',
      symbol: 'EXAMPLE',
      exchange: 'LOCAL',
      interval: '1m',
      from: start,
      to: start + 540,
      horizon: start + 600,
      timezone: 'UTC',
      gapStatus: 'unknown',
      volumeAvailable: false,
    })
    expect(source.intervals).toEqual(['1m'])
    expect(source.feed).not.toHaveProperty('subscribeBars')
    expect(source).not.toHaveProperty('trade')
    expect(source).not.toHaveProperty('apiKey')
    expect(await source.feed.getBars(request)).toHaveLength(10)
    expect(source.instrument({ symbol: 'EXAMPLE', exchange: 'LOCAL' })).not.toHaveProperty(
      'tick_size'
    )
    expect(source.instrument({ symbol: 'EXAMPLE', exchange: 'OTHER' })).toBeNull()
    source.dispose()
  })
  it('clamps an owned run window and rejects identity/variant relabelling before I/O', async () => {
    const value = version()
    const fetch = vi.fn(async () => ({
      versionId: value.id,
      checksum: value.checksum,
      bars: Array.from({ length: 10 }, (_, index) => wire(start + index * 60)),
    }))
    const source = createDatasetChartSource(value, {
      fetchBars: fetch,
      window: { from: start + 120, to: start + 300 },
    })
    const request = { symbol: 'EXAMPLE', exchange: 'LOCAL', interval: '1m' }
    expect(
      (await source.feed.getBars({ ...request, from: start, to: start + 180 })).map(
        (bar) => bar.time
      )
    ).toEqual([start + 120])
    expect((await source.feed.getBars(request)).map((bar) => bar.time)).toEqual([
      start + 120,
      start + 180,
      start + 240,
      start + 300,
    ])
    const previous = fetch.mock.calls.length
    for (const changed of [
      { symbol: 'OTHER' },
      { exchange: 'OTHER' },
      { interval: '5m' },
      { variant: { currency: 'USD' } },
    ])
      await expect(source.feed.getBars({ ...request, ...changed })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(previous)
    source.dispose()
  })
  it('rejects bad windows and unsupported native intervals without creating a transport', () => {
    for (const window of [
      { from: Number.NaN, to: start },
      { from: start + 900, to: start + 1000 },
      { from: start + 10, to: start - 10 },
    ])
      expect(() => createDatasetChartSource(version(), { window })).toThrow(/window/)
    expect(() =>
      createDatasetChartSource(version({ metadata: { ...version().metadata, interval: 'M' } }))
    ).toThrow(/interval/)
    expect(() => createDatasetChartSource(version({ rowCount: 50001 }))).toThrow(/range/)
  })
  it('detaches source metadata and keeps unknown volume absent, including negative prices', async () => {
    const input = version()
    const { source, request } = setup(input, [wire(start, -2)])
    input.metadata.symbol = 'CHANGED'
    expect(source.symbol).toBe('EXAMPLE')
    expect(Object.isFrozen(source.version.metadata)).toBe(true)
    const bars = await source.feed.getBars(request)
    expect(bars[0]).toMatchObject({ close: -2 })
    expect(bars[0]).not.toHaveProperty('volume')
    source.dispose()
  })
  it('searches only the pinned native instrument and rejects closed/cancelled consumers', async () => {
    const { source } = setup()
    expect((await source.search('source-a'))[0]).toMatchObject({
      symbol: 'EXAMPLE',
      exchange: 'LOCAL',
      datasetVersionId: 'version-a',
      datasetChecksum: 'fixed-content',
    })
    expect(await source.search('OTHER')).toEqual([])
    expect(await source.search('EXAMPLE', 'FOREIGN')).toEqual([])
    await expect(source.search('EXAMPLE', undefined, 501)).rejects.toThrow(/limit/)
    const controller = new AbortController()
    controller.abort()
    await expect(source.search('EXAMPLE', undefined, 30, controller.signal)).rejects.toHaveProperty(
      'name',
      'AbortError'
    )
    source.dispose()
    await expect(source.search('EXAMPLE')).rejects.toHaveProperty('name', 'AbortError')
  })
  it('aborts in-flight reads on source replacement and discards late successful results', async () => {
    const value = version()
    let finish!: (value: { versionId: string; checksum: string; bars: DatasetBar[] }) => void
    let activeSignal: AbortSignal | undefined
    const fetch = vi.fn((_id: string, bounds: FetchBounds) => {
      activeSignal = bounds.signal
      return new Promise<{ versionId: string; checksum: string; bars: DatasetBar[] }>((resolve) => {
        finish = resolve
      })
    })
    const source = createDatasetChartSource(value, { fetchBars: fetch })
    const pending = source.feed.getBars({ symbol: 'EXAMPLE', exchange: 'LOCAL', interval: '1m' })
    const failure = expect(pending).rejects.toHaveProperty('name', 'AbortError')
    source.dispose()
    expect(activeSignal?.aborted).toBe(true)
    finish({ versionId: value.id, checksum: value.checksum, bars: [wire(start)] })
    await failure
  })
})

describe('immutable native study knowledge', () => {
  it('never reveals the final OHLC of a future/forming candle at a historical cutoff', async () => {
    const { source, request, rows } = setup()
    rows[8] = wire(start + 480, 1000000)
    const snapshot = await source.provider.requestSnapshot!({ ...request, asOf: start + 240 })
    expect(snapshot.bars.map((bar) => bar.time)).toEqual([
      start,
      start + 60,
      start + 120,
      start + 180,
    ])
    expect(snapshot.availableAt).toEqual([start + 60, start + 120, start + 180, start + 240])
    expect(snapshot.confirmed).toEqual([true, true, true, true])
    expect(
      ema(
        snapshot.bars.map((bar) => bar.close),
        3
      )
    ).toEqual(ema([1, 2, 3, 4], 3))
    source.dispose()
  })
  it('restores an earlier prefix after seeking backwards and isolates future price spikes', async () => {
    const { source, request, rows } = setup()
    await source.provider.requestSnapshot!({ ...request, asOf: start + 540 })
    const before = await source.provider.requestSnapshot!({ ...request, asOf: start + 180 })
    rows[7] = wire(start + 420, 10000000)
    const after = await source.provider.requestSnapshot!({ ...request, asOf: start + 180 })
    expect(after).toEqual(before)
    expect(after.bars).toHaveLength(3)
    source.dispose()
  })
  it('fetches independent bounded warmup and excludes observations without close-time knowledge', async () => {
    const { source, request, fetch } = setup()
    const snapshot = await source.provider.requestSnapshot!({
      ...request,
      from: start + 300,
      warmupBars: 2,
      asOf: start + 480,
    })
    expect(snapshot.bars.map((bar) => bar.time)).toEqual(
      [180, 240, 300, 360, 420].map((seconds) => start + seconds)
    )
    expect(fetch).toHaveBeenCalledWith(
      'version-a',
      expect.objectContaining({ from: start, limit: 50000 })
    )
    await expect(
      source.provider.requestSnapshot!({ ...request, warmupBars: 50001 })
    ).rejects.toThrow(/warmup/)
    source.dispose()
  })
  it('keeps an immutable partial publication tail unconfirmed after wall time advances', async () => {
    const { source, request } = setup(
      version({ createdAt: new Date((start + 90) * 1000).toISOString() })
    )
    const current = await source.provider.requestSnapshot!(request)
    expect(current.confirmed).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
    const replay = await source.provider.requestSnapshot!({ ...request, asOf: start + 5000 })
    expect(replay.bars).toHaveLength(1)
    source.dispose()
  })
  it('does not substitute latest, another symbol, adjusted prices or unsupported MTF history', async () => {
    const { source, request, fetch } = setup()
    for (const changed of [
      { symbol: 'OTHER' },
      { interval: '5m' },
      { variant: { adjustment: 'raw' as const } },
      { asOf: Number.NaN },
    ])
      await expect(source.provider.requestSnapshot!({ ...request, ...changed })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    source.dispose()
    const adjusted = setup(
      version({
        metadata: { ...version().metadata, priceBasis: 'split_adjusted', adjustment: 'split' },
      })
    )
    await expect(
      adjusted.source.provider.requestSnapshot!({ ...adjusted.request, asOf: start + 300 })
    ).rejects.toThrow(/adjusted snapshot/)
    adjusted.source.dispose()
  })
  it('requires a declared daily calendar and observes DST and declared closures', async () => {
    const day = Date.parse('2026-03-08T05:00:00Z') / 1000
    const base = version({
      rowCount: 1,
      start: day,
      end: day,
      metadata: { ...version().metadata, interval: 'D' },
    })
    const unknown = setup(base, [wire(day)])
    await expect(unknown.source.provider.requestSnapshot!(unknown.request)).rejects.toThrow(
      /calendar/
    )
    unknown.source.dispose()
    const known = version({
      ...base,
      metadata: {
        ...base.metadata,
        calendar: {
          id: 'continuous',
          timezone: 'America/New_York',
          sessions: [{ weekdays: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '24:00' }],
          exceptions: {},
        },
      },
    })
    const { source, request } = setup(known, [wire(day)])
    const snapshot = await source.provider.requestSnapshot!(request)
    expect(snapshot.availableAt).toEqual([Date.parse('2026-03-09T04:00:00Z') / 1000])
    expect(snapshot.confirmed).toEqual([true])
    source.dispose()
  })
  it('uses a shortened declared session and withholds outside-session observations', async () => {
    const time = Date.parse('2026-11-02T12:45:00Z') / 1000
    const metadata = {
      ...version().metadata,
      interval: '1h',
      calendar: {
        id: 'custom',
        timezone: 'UTC',
        sessions: [{ weekdays: [0, 1, 2, 3, 4], open: '09:30', close: '16:00' }],
        exceptions: { '2026-11-02': [{ open: '09:30', close: '13:00' }] },
      },
    }
    const { source, request } = setup(
      version({ start: time, end: time + 3600, rowCount: 2, metadata }),
      [wire(time), wire(time + 3600)]
    )
    const snapshot = await source.provider.requestSnapshot!({ ...request, asOf: time + 900 })
    expect(snapshot.bars).toHaveLength(1)
    expect(snapshot.availableAt).toEqual([Date.parse('2026-11-02T13:00:00Z') / 1000])
    source.dispose()
    expect(datasetSessionCalendar(version())).toBeNull()
  })
})

describe('owner-bound source catalog', () => {
  it('retains same-symbol sources and versions while hiding archived and quarantined rows', async () => {
    const a = version()
    const b = version({ id: 'version-b', metadata: { ...a.metadata, provider: 'source-b' } })
    const fetch = vi.fn(async () =>
      catalog([
        a,
        b,
        version({ id: 'archived', archivedAt: '2026-11-03T00:00:00Z' }),
        version({
          id: 'quarantined',
          quarantine: {
            reason: 'dataset.time_unverified',
            timeBasis: 'tick-derived-unverified',
            message: 'Time verification required.',
          },
        }),
      ])
    )
    const choices = await datasetSourceChoices('owner', undefined, fetch)
    expect(choices.map((item) => [item.versionId, item.symbol, item.providerId])).toEqual([
      ['version-a', 'EXAMPLE', 'source-a'],
      ['version-b', 'EXAMPLE', 'source-b'],
    ])
  })
  it('rejects foreign/stale/duplicate and malformed pages without returning a partial selection', async () => {
    for (const second of [
      { ...catalog([version({ id: 'v2' })]), principalId: 'other' },
      { ...catalog([version({ id: 'v2' })]), revision: 6 },
      catalog([version()]),
      catalog([], 100),
    ]) {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(catalog([version()], 100))
        .mockResolvedValueOnce(second)
      await expect(datasetSourceChoices('owner', undefined, fetch)).rejects.toThrow()
    }
  })
  it('passes cancellation and stops before reading another page after it is cancelled', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async () => {
      controller.abort()
      return catalog([version()], 100)
    })
    await expect(datasetSourceChoices('owner', controller.signal, fetch)).rejects.toHaveProperty(
      'name',
      'AbortError'
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('bounded source lifecycle and large history budget', () => {
  it('prepares 50,000 native candles within the defined five-second fixture budget', async () => {
    const count = 50000
    const value = version({
      rowCount: count,
      end: start + (count - 1) * 60,
      createdAt: '2026-12-20T00:00:00Z',
    })
    const rows = Array.from({ length: count }, (_, index) =>
      wire(start + index * 60, (index % 100) + 2)
    )
    const began = performance.now()
    const { source, request } = setup(value, rows)
    const bars = await source.feed.getBars(request)
    const elapsedMs = performance.now() - began
    expect(bars).toHaveLength(count)
    expect(elapsedMs).toBeLessThan(5000)
    record('preparation', {
      candles: count,
      elapsedMs: Math.round(elapsedMs * 100) / 100,
      budgetMs: 5000,
    })
    source.dispose()
  })
  it('balances 100 cancelled source lifetimes without retained active fetches or subscribers', async () => {
    let active = 0,
      started = 0,
      closed = 0
    const value = version()
    for (let index = 0; index < 100; index++) {
      const fetch = vi.fn(
        (_id: string, bounds: FetchBounds) =>
          new Promise<{ versionId: string; checksum: string; bars: DatasetBar[] }>(
            (_resolve, reject) => {
              started++
              active++
              bounds.signal?.addEventListener(
                'abort',
                () => {
                  active--
                  closed++
                  reject(abortError())
                },
                { once: true }
              )
            }
          )
      )
      const source = createDatasetChartSource(value, { fetchBars: fetch })
      const work = source.feed.getBars({ symbol: 'EXAMPLE', exchange: 'LOCAL', interval: '1m' })
      const rejected = expect(work).rejects.toHaveProperty('name', 'AbortError')
      source.dispose()
      await rejected
      expect(active).toBe(0)
    }
    expect({ started, closed, active }).toEqual({ started: 100, closed: 100, active: 0 })
    record('lifecycle', { iterations: 100, started, closed, active })
  })
})
function abortError() {
  return new DOMException('cancelled', 'AbortError')
}
