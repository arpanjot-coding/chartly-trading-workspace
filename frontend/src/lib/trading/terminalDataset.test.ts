import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetVersion } from '@/api/dataLibrary'
import { createDatasetChartSource } from './chartSource'
import { datasetDisplayPrecision, type TerminalCallbacks, TradingTerminal } from './terminal'

const start = Date.parse('2026-11-02T09:00:00Z') / 1000
const version: DatasetVersion = {
  id: 'version-one',
  datasetId: 'dataset-one',
  name: 'Crypto fixture',
  checksum: 'a'.repeat(64),
  sourceHash: 'b'.repeat(64),
  rowCount: 4,
  start,
  end: start + 180,
  sizeBytes: 100,
  createdAt: '2026-11-03T09:00:00Z',
  quality: {},
  coverage: { volumeKnownRows: 0 },
  dependencies: [],
  metadata: {
    provider: 'fixture',
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
}
const rows = Array.from({ length: 4 }, (_, index) => ({
  timestamp: start + index * 60,
  open: String((10 + index) / 1e9),
  high: String((12 + index) / 1e9),
  low: String((8 + index) / 1e9),
  close: String((11 + index) / 1e9),
  volume: null,
}))
const owned: TradingTerminal[] = []
beforeEach(() => {
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
})
afterEach(() => {
  for (const terminal of owned.splice(0)) terminal.destroy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function mount() {
  const source = createDatasetChartSource(version, {
    fetchBars: vi.fn(async () => ({
      versionId: version.id,
      checksum: version.checksum,
      bars: rows,
    })),
  })
  const callbacks: TerminalCallbacks = {
    onReady: vi.fn(),
    onToast: vi.fn(),
    onWsState: vi.fn(),
    onSymbolLoaded: vi.fn(),
    onLtp: vi.fn(),
  }
  const terminal = new TradingTerminal({
    source,
    executionAllowed: false,
    apiKey: 'present-but-not-authority',
    wsUrl: 'ws://forbidden.invalid',
    container: document.createElement('div'),
    legendEl: document.createElement('div'),
    getTheme: () => ({ mode: 'light', appMode: 'live' }),
    callbacks,
  })
  owned.push(terminal)
  return { source, terminal, callbacks }
}
describe('the original terminal over private native history', () => {
  it('freezes chart chrome at native history time and gives exact replay time precedence', async () => {
    const { terminal, source } = mount()
    await terminal.init()
    expect(terminal.chartClock()).toBe(source.horizon)
    expect(terminal.liveChart()?.axisChromeOptions().clock?.()).toBe(source.horizon)
    const internal = terminal as unknown as { workspaceReplayTime: number | null }
    internal.workspaceReplayTime = start + 75
    expect(terminal.chartClock()).toBe(start + 75)
    expect(terminal.liveChart()?.axisChromeOptions().clock?.()).toBe(start + 75)
    internal.workspaceReplayTime = null
    expect(terminal.chartClock()).toBe(source.horizon)
    source.dispose()
  })
  it('keeps connected profile prices separate from global account/order resources', async () => {
    const sockets = vi.fn()
    vi.stubGlobal(
      'WebSocket',
      class {
        readyState = 0
        constructor() {
          sockets()
        }
        send() {}
        close() {
          this.readyState = 3
        }
      }
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', data: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const terminal = new TradingTerminal({
      executionAllowed: false,
      initialInstrument: { symbol: 'EXAMPLE', exchange: 'LOCAL', interval: '1m' },
      apiKey: 'readonly-connected',
      wsUrl: 'ws://fixture.invalid',
      container: document.createElement('div'),
      legendEl: document.createElement('div'),
      getTheme: () => ({ mode: 'light', appMode: 'live' }),
      callbacks: { onReady() {}, onToast() {}, onWsState() {}, onSymbolLoaded() {}, onLtp() {} },
    })
    owned.push(terminal)
    vi.spyOn(terminal, 'api').mockImplementation(
      async (path) =>
        ({
          data:
            path === 'intervals' ? { minutes: ['1m'] } : [{ symbol: 'EXAMPLE', exchange: 'LOCAL' }],
        }) as never
    )
    vi.spyOn(terminal, 'loadSymbol').mockResolvedValue(true)
    await terminal.init()
    const fields = terminal as unknown as {
      trade: unknown
      offOrderUpdate: unknown
      bookTimer: unknown
      tradingLocked(): boolean
    }
    expect(sockets).toHaveBeenCalledOnce()
    expect(fields.trade).toBeNull()
    expect(fields.offOrderUpdate).toBeNull()
    expect(fields.bookTimer).toBeNull()
    expect(fields.tradingLocked()).toBe(true)
  })
  it('initializes a real chart without broker REST, order feeds, websockets or polling', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Connected transport is forbidden'))
    const socket = vi.fn()
    vi.stubGlobal('WebSocket', socket)
    const { source, terminal, callbacks } = mount()
    await terminal.init()
    expect(terminal.liveChart()).not.toBeNull()
    expect(terminal.chartContext()).toMatchObject({
      symbol: 'EXAMPLE',
      exchange: 'LOCAL',
      interval: '1m',
      bars_loaded: 4,
    })
    expect(terminal.liveChart()?.timezone()).toBe('UTC')
    expect(callbacks.onSymbolLoaded).toHaveBeenCalledWith(
      expect.objectContaining({ tick: 0, quoteOnly: true })
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(socket).not.toHaveBeenCalled()
    expect((terminal as unknown as { bookTimer: unknown }).bookTimer).toBeNull()
    expect((terminal as unknown as { trade: unknown }).trade).toBeNull()
    expect(terminal.supportsInterval('5m')).toBe(false)
    source.dispose()
  })
  it('refuses direct account commands even with a global key and Live app mode', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    const { terminal, source } = mount()
    await terminal.init()
    await expect(terminal.api('placeorder', { symbol: 'EXAMPLE' })).rejects.toThrow(
      /no connected account/
    )
    expect((terminal as unknown as { tradingLocked(): boolean }).tradingLocked()).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
    source.dispose()
  })
  it('preserves tiny observed prices without manufacturing a trading tick', async () => {
    const { terminal, source } = mount()
    await terminal.init()
    expect((terminal as unknown as { fmt(n: number): string }).fmt(0.000000014)).toBe('0.000000014')
    expect((terminal as unknown as { tick(): number }).tick()).toBe(0)
    source.dispose()
  })
  it('uses actual replay clock metadata and includes partial step changes in capture identity', async () => {
    const { terminal, source } = mount()
    await terminal.init()
    const internal = terminal as unknown as { workspaceReplayTime: number; replayState(): unknown }
    const partial = {
      index: 1,
      total: 4,
      playing: false,
      speed: 1,
      bar: { time: start + 60, open: 1, high: 2, low: 1, close: 2 },
      subIndex: 0,
      subSteps: 4,
      simulated: false,
    }
    vi.spyOn(internal, 'replayState').mockReturnValue(partial)
    internal.workspaceReplayTime = start + 75
    expect(terminal.evidenceView()?.replayAsOf).toBe(start + 75)
    const before = terminal.evidenceKey()
    partial.subIndex = 1
    internal.workspaceReplayTime = start + 90
    expect(terminal.evidenceKey()).not.toBe(before)
    expect(terminal.evidenceView()?.replayAsOf).toBe(start + 90)
    source.dispose()
  })
  it('keeps display precision bounded for 50,000 candles without argument spreading', () => {
    expect(
      datasetDisplayPrecision(
        Array.from({ length: 50000 }, () => ({
          time: 0,
          open: 1e-24,
          high: 2e-24,
          low: 0,
          close: 1e-24,
        }))
      )
    ).toBe(24)
  })
})
