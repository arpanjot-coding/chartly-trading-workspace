import {
  type Bar,
  createChart,
  exportChartDataCsv,
  ReplayController,
  registerIndicator,
} from 'chartly-charts'
import { createRequestedIndicator, SMA } from 'chartly-charts/indicators'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetVersion } from '@/api/dataLibrary'
import { createDatasetChartSource } from './chartSource'
import { replayTiming } from './replayTiming'

const start = Date.parse('2026-11-02T09:00:00Z') / 1000
const bars: Bar[] = [1, 2, 3, 4, 1000000, 2000000].map((close, index) => ({
  time: start + index * 60,
  open: close,
  high: close,
  low: close,
  close,
}))
const charts: ReturnType<typeof createChart>[] = []
const sources: ReturnType<typeof createDatasetChartSource>[] = []
let counter = 0

function setup(interval = '1m') {
  const version: DatasetVersion = {
    id: 'engine-version',
    datasetId: 'engine-dataset',
    name: 'Engine causal fixture',
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
    checksum: 'fixture-checksum',
    sourceHash: 'fixture-source',
    rowCount: bars.length,
    start,
    end: bars.at(-1)!.time,
    sizeBytes: 100,
    quality: {},
    coverage: {},
    createdAt: '2026-11-03T00:00:00Z',
    dependencies: [],
  }
  const source = createDatasetChartSource(version, {
    fetchBars: async () => ({
      versionId: version.id,
      checksum: version.checksum,
      bars: bars.map((bar) => ({
        timestamp: bar.time,
        open: String(bar.open),
        high: String(bar.high),
        low: String(bar.low),
        close: String(bar.close),
        volume: null,
      })),
    }),
  })
  sources.push(source)
  const chart = createChart(document.createElement('div'), {
    shortcuts: false,
    timeNavigator: false,
    raf: {
      schedule(callback) {
        callback()
        return 1
      },
      cancel() {},
    },
  })
  charts.push(chart)
  chart.applySize(800, 500)
  chart.setDataContext({ symbol: 'EXAMPLE', exchange: 'LOCAL', interval: '1m', timezone: 'UTC' })
  const snapshot = vi.fn(source.provider.requestSnapshot!)
  const requestBars = vi.fn(source.provider.requestBars)
  chart.setBarsProvider({ supportsWarmup: true, requestBars, requestSnapshot: snapshot })
  const series = chart.addSeries('candlestick')
  series.setData(bars)
  const id = `p05-requested-native-${++counter}`
  registerIndicator(
    createRequestedIndicator({
      id,
      name: 'Native causal requested close',
      category: 'Custom',
      placement: 'overlay',
      inputs: [],
      plots: [
        { key: 'close', type: 'line', title: 'Requested close', style: { color: '#000000' } },
      ],
      request(ctx) {
        return {
          symbol: 'EXAMPLE',
          exchange: 'LOCAL',
          interval,
          from: start,
          to: (ctx.bars.at(-1)?.time ?? start) + 60,
        }
      },
      expression(observations) {
        return { close: observations.map((bar) => bar.close) }
      },
      targetTimes(ctx) {
        return ctx.bars.map((bar) => bar.time + 60)
      },
    })
  )
  const study = chart.addIndicator(id)
  const ordinary = chart.addIndicator(SMA.id, { length: 2 })
  return { chart, series, study, ordinary, snapshot, requestBars }
}

beforeEach(() => {
  const context = new Proxy(
    {
      measureText: (text: string) => ({ width: text.length * 7 }),
      createLinearGradient: () => ({ addColorStop() {} }),
    },
    { get: (target, key) => target[key as keyof typeof target] ?? (() => {}) }
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
})
afterEach(() => {
  for (const chart of charts.splice(0)) chart.destroy()
  for (const source of sources.splice(0)) source.dispose()
  vi.restoreAllMocks()
})

describe('installed chart engine replay and native requested studies', () => {
  it('passes a real replay asOf to the provider and keeps built-in/requested plots and CSV inside the revealed prefix', async () => {
    const { chart, series, study, ordinary, snapshot, requestBars } = setup()
    await vi.waitFor(() => expect(study.dataStatus()?.state).toBe('ready'))
    expect(study.values().close.at(-1)).toBe(2000000)
    const replay = new ReplayController(chart, {
      series,
      bars,
      startIndex: 1,
      timing: replayTiming('1m', 'UTC'),
    })
    await vi.waitFor(() => expect(snapshot.mock.calls.at(-1)?.[0].asOf).toBe(start + 120))
    await vi.waitFor(() => expect(study.values().close).toEqual([1, 2]))
    expect(series.getData()).toHaveLength(2)
    expect(ordinary.values()).toEqual(SMA.calc(bars.slice(0, 2), ordinary.settings(), {}))
    expect(requestBars).not.toHaveBeenCalled()
    const csv = exportChartDataCsv(chart)
    expect(csv).not.toContain('1000000')
    expect(csv).not.toContain('2000000')
    replay.seek(4)
    await vi.waitFor(() => expect(snapshot.mock.calls.at(-1)?.[0].asOf).toBe(start + 300))
    await vi.waitFor(() => expect(study.values().close.at(-1)).toBe(1000000))
    replay.seek(1)
    await vi.waitFor(() => expect(snapshot.mock.calls.at(-1)?.[0].asOf).toBe(start + 120))
    await vi.waitFor(() => expect(study.values().close).toEqual([1, 2]))
    expect(exportChartDataCsv(chart)).not.toContain('1000000')
    replay.stop()
  })
  it('marks legacy replay without an availability cutoff unsupported rather than making a latest-history request', async () => {
    const { chart, series, study, snapshot } = setup()
    await vi.waitFor(() => expect(study.dataStatus()?.state).toBe('ready'))
    const count = snapshot.mock.calls.length
    const replay = new ReplayController(chart, { series, bars, startIndex: 1 })
    await vi.waitFor(() => expect(study.dataStatus()?.state).toBe('unsupported'))
    expect(snapshot).toHaveBeenCalledTimes(count)
    expect(study.values().close.every((value) => value === null)).toBe(true)
    replay.stop()
  })
  it('shows unavailable requested MTF history instead of substituting a native or connected series', async () => {
    const { study, snapshot, requestBars } = setup('5m')
    await vi.waitFor(() => expect(study.dataStatus()?.state).toBe('error'))
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(requestBars).not.toHaveBeenCalled()
    expect(study.values().close.every((value) => value === null)).toBe(true)
  })
})
