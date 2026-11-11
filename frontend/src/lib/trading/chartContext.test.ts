import { describe, expect, it } from 'vitest'
import type { DatasetVersion } from '@/api/dataLibrary'
import type { JournalTrade, PracticeSession, TraderPortfolio } from '@/lib/trader/db'
import {
  chartReturn,
  readChartQuery,
  resolveChartContext,
  selectedChartRecords,
} from './chartContext'

const start = Date.parse('2026-11-02T09:00:00Z') / 1000
const dataset = (patch: Partial<DatasetVersion> = {}): DatasetVersion => ({
  id: 'version-one',
  datasetId: 'dataset-one',
  name: 'Test history',
  checksum: 'a'.repeat(64),
  sourceHash: 'b'.repeat(64),
  rowCount: 30,
  start,
  end: start + 29 * 60,
  sizeBytes: 100,
  createdAt: '2026-11-03T09:00:00Z',
  quality: {},
  coverage: {},
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
  ...patch,
})
const profile: TraderPortfolio = {
  id: 1,
  name: 'Actual profile',
  kind: 'replay',
  currency: 'USD',
  startingBalance: 10000,
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
}
const run: PracticeSession = {
  id: 2,
  portfolioId: 1,
  name: 'Actual run',
  mode: 'Replay',
  market: 'Stocks',
  symbol: 'EXAMPLE',
  timeframe: '1m',
  dataSource: 'fixture',
  datasetVersionId: 'version-one',
  datasetChecksum: 'a'.repeat(64),
  rangeStart: '2026-11-02',
  rangeEnd: '2026-11-02',
  status: 'Draft',
  startingBalance: 10000,
  notes: '',
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
}
const rows = { portfolios: [profile], sessions: [run], trades: [] }
describe('verified chart context', () => {
  it('clamps managed paper branches to their server-owned native window despite editable bounds', () => {
    const query = { profileId: 1, runId: 2, from: start - 86400, to: start + 86400 }
    const selected = selectedChartRecords(query, {
      ...rows,
      sessions: [
        {
          ...run,
          paper: {
            version: 1,
            revision: 3,
            status: 'paused',
            manifestId: 'manifest-one',
            window: { from: start + 600, to: start + 1200 },
          },
        },
      ],
    })
    const value = resolveChartContext('owner', query, selected, dataset())
    expect(value.window).toEqual({ from: start + 600, to: start + 1200 })
    expect(value.executionAllowed).toBe(false)
    expect(value.key).toContain(String(start + 600))
    const narrowed = resolveChartContext(
      'owner',
      { ...query, from: start + 700, to: start + 900 },
      selected,
      dataset()
    )
    expect(narrowed.window).toEqual(value.window)
  })
  it('rejects malformed managed window state instead of displaying a different price horizon', () => {
    const query = { profileId: 1, runId: 2 }
    const selected = selectedChartRecords(query, {
      ...rows,
      sessions: [
        {
          ...run,
          paper: {
            version: 1,
            revision: 1,
            status: 'paused',
            manifestId: 'manifest-one',
            window: { from: NaN, to: start + 1200 },
          },
        },
      ],
    })
    expect(() => resolveChartContext('owner', query, selected, dataset())).toThrow(
      'managed paper window'
    )
  })
  it.each([
    'profileId=0',
    'profileId=-1',
    'profileId=1x',
    'profileId=9007199254740993',
    'profileId=1&profileId=2',
    'runId=2',
    'tradeId=3',
    'datasetVersionId=../secret',
    'symbol=EXAMPLE',
    'from=1',
    'from=2&to=1',
    'from=NaN&to=4',
    'bookId=book-one',
    'profileId=1&bookId=../x',
  ])('rejects malformed links: %s', (value) =>
    expect(() => readChartQuery(new URLSearchParams(value))).toThrow())
  it('loads actual profile/run and ignores supplied display authority', () => {
    const query = readChartQuery(
      new URLSearchParams('profileId=1&runId=2&profileName=Forged&profileKind=live')
    )
    const value = resolveChartContext('owner', query, selectedChartRecords(query, rows), dataset())
    expect(value.profile?.name).toBe('Actual profile')
    expect(value.executionAllowed).toBe(false)
    expect(value.navigation.get('profileKind')).toBe('replay')
    expect(value.window).toEqual({ from: start, to: start + 29 * 60 })
    expect(value.returnHref).toBe('/workspace/profiles/1/replay')
  })
  it('keeps the exact UTC run window and refuses no-overlap dates', () => {
    const query = readChartQuery(
      new URLSearchParams({
        profileId: '1',
        runId: '2',
        from: String(start + 120),
        to: String(start + 600),
      })
    )
    const value = resolveChartContext('owner', query, selectedChartRecords(query, rows), dataset())
    expect(value.window?.from).toBe(start + 120)
    expect(value.window?.to).toBeCloseTo(start + 600 - 0.000001, 5)
    expect(() =>
      resolveChartContext(
        'owner',
        query,
        selectedChartRecords(query, {
          ...rows,
          sessions: [{ ...run, rangeStart: '2026-11-04', rangeEnd: '2026-11-04' }],
        }),
        dataset()
      )
    ).toThrow(/no saved candles/)
  })
  it('rejects missing, archived and cross-profile records', () => {
    const query = readChartQuery(new URLSearchParams('profileId=1&runId=2'))
    expect(() => selectedChartRecords(query, { ...rows, portfolios: [] })).toThrow(/missing/)
    expect(() =>
      selectedChartRecords(query, { ...rows, portfolios: [{ ...profile, archivedAt: 'today' }] })
    ).toThrow(/missing/)
    expect(() =>
      selectedChartRecords(query, { ...rows, sessions: [{ ...run, portfolioId: 3 }] })
    ).toThrow(/does not belong/)
  })
  it('refuses conflicting dataset links, checksums, symbols and intervals for a pinned run', () => {
    expect(() =>
      selectedChartRecords(
        {
          ...readChartQuery(new URLSearchParams('profileId=1&runId=2')),
          datasetVersionId: 'version-two',
        },
        rows
      )
    ).toThrow(/conflicts/)
    const query = { profileId: 1, runId: 2 },
      selected = selectedChartRecords(query, rows)
    expect(() =>
      resolveChartContext('owner', query, selected, dataset({ checksum: 'c'.repeat(64) }))
    ).toThrow(/checksum/)
    expect(() =>
      resolveChartContext(
        'owner',
        query,
        { ...selected, run: { ...run, symbol: 'OTHER' } },
        dataset()
      )
    ).toThrow(/instrument/)
    expect(() =>
      resolveChartContext(
        'owner',
        query,
        { ...selected, run: { ...run, timeframe: '5m' } },
        dataset()
      )
    ).toThrow(/interval/)
  })
  it('accepts a restored alias only with exact server alias identity and retained checksum', () => {
    const query = { profileId: 1, runId: 2 },
      selected = selectedChartRecords(query, rows)
    expect(() =>
      resolveChartContext('owner', query, selected, dataset({ id: 'version-restored' }))
    ).toThrow(/could not be verified/)
    const restored = {
      ...dataset({ id: 'version-restored' }),
      resolvedFromVersionId: 'version-one',
    }
    expect(resolveChartContext('owner', query, selected, restored).dataset?.id).toBe(
      'version-restored'
    )
    expect(() =>
      resolveChartContext('owner', query, selected, { ...restored, checksum: 'c'.repeat(64) })
    ).toThrow(/checksum/)
  })
  it('resolves a pinned MT5 live feed without requiring saved replay history', () => {
    const liveProfile: TraderPortfolio = {
      ...profile,
      kind: 'live',
      chartSource: {
        kind: 'live-feed',
        providerId: 'mt5',
        providerName: 'MetaTrader 5 (this PC)',
        symbol: 'EURUSD',
        exchange: 'MT5',
        interval: '15m',
      },
    }
    const query = readChartQuery(new URLSearchParams('profileId=1'))
    const selected = selectedChartRecords(query, {
      portfolios: [liveProfile],
      sessions: [],
      trades: [],
    })
    const value = resolveChartContext('owner', query, selected)
    expect(value.source).toBe('live-feed')
    expect(value.liveFeed).toEqual(
      expect.objectContaining({ providerId: 'mt5', symbol: 'EURUSD', interval: '15m' })
    )
    expect(value.dataset).toBeUndefined()
    expect(value.defaultSymbol).toEqual({ symbol: 'EURUSD', exchange: 'MT5', interval: '15m' })
    expect(value.executionAllowed).toBe(false)
    expect(value.key).toContain('live-feed:mt5')
  })
  it('opens a different native symbol from a journal entry only in current-price analysis', () => {
    const trade: JournalTrade = {
      id: 4,
      portfolioId: 1,
      pair: '#AAPL.pro',
      timeframe: '1h',
      openDate: '2026-11-02',
      closeDate: '',
      direction: 'Buy',
      lots: 1,
      strategy: '',
      result: 'Open',
      rr: 0,
      sl: 0,
      tp: 0,
      pnl: 0,
      netPnl: 0,
    }
    const chartSource = {
      kind: 'live-feed' as const,
      providerId: 'mt5',
      providerName: 'MetaTrader 5',
      symbol: 'EURUSD',
      exchange: 'MT5',
      interval: '15m',
    }
    const records = {
      portfolios: [{ ...profile, kind: 'live' as const, chartSource }],
      sessions: [],
      trades: [trade],
    }
    const resolve = (params: string) => {
      const query = readChartQuery(new URLSearchParams(`profileId=1&${params}`))
      return resolveChartContext('owner', query, selectedChartRecords(query, records))
    }
    expect(resolve('tradeId=4').source).toBe('missing')
    const current = resolve('tradeId=4&currentAnalysis=1')
    expect(current.liveFeed).toMatchObject({ symbol: '#AAPL.pro', interval: '1h' })
    expect(current.historicalUnavailable).toBe(true)
    expect(current.executionAllowed).toBe(false)
    expect(resolve('symbol=%23AAPL.pro&exchange=MT5').navigation.get('symbol')).toBe('#AAPL.pro')
    expect(() => resolve('symbol=%23AAPL.pro&exchange=NSE')).toThrow(/linked venue/)
    expect(chartSource.symbol).toBe('EURUSD')
  })
  it('keeps missing replay history explicit and never grants profile execution', () => {
    const query = { profileId: 1 },
      selected = selectedChartRecords(query, rows)
    expect(resolveChartContext('owner', query, selected).source).toBe('missing')
    const connected = selectedChartRecords(query, {
      ...rows,
      portfolios: [{ ...profile, chartSource: { kind: 'connected' } }],
    })
    expect(resolveChartContext('owner', query, connected).source).toBe('legacy-connected')
    expect(resolveChartContext('owner', query, connected).executionAllowed).toBe(false)
  })
  it('isolates source/profile/run/principal namespaces while retaining the unbound legacy namespace', () => {
    const query = { profileId: 1, runId: 2 },
      selected = selectedChartRecords(query, rows)
    const one = resolveChartContext('owner', query, selected, dataset())
    const other = resolveChartContext('other', query, selected, dataset())
    const unbound = resolveChartContext('owner', {}, selectedChartRecords({}, rows))
    expect(one.namespace).not.toBe(other.namespace)
    expect(one.preferenceScope).toContain('run-2')
    expect(unbound.namespace).toBe('oa-trading:owner')
    expect(unbound.preferenceScope).toBeUndefined()
  })
  it('validates supplied book membership without a trade and does not claim a browser book', () => {
    const query = { profileId: 1, bookId: 'book-two' }
    expect(() =>
      selectedChartRecords(query, {
        ...rows,
        books: [{ id: 'book-two', name: 'Other', kind: 'manual', profileId: 3 }],
      })
    ).toThrow(/not available/)
    expect(
      selectedChartRecords(query, {
        ...rows,
        books: [{ id: 'book-two', name: 'Own', kind: 'manual', profileId: 1 }],
      }).bookId
    ).toBe('book-two')
    expect(
      selectedChartRecords({ ...query, bookId: 'manual:1' }, { ...rows, storageMode: 'browser' })
        .bookId
    ).toBeUndefined()
  })
  it('retains an opening-time chart cursor only for the exact version/window', () => {
    const query = { profileId: 1, runId: 2 },
      checkpoint = {
        version: 1 as const,
        datasetVersionId: 'version-one',
        datasetChecksum: dataset().checksum,
        cursorTime: start + 5 * 60,
      }
    const selected = selectedChartRecords(query, {
      ...rows,
      sessions: [{ ...run, chartView: checkpoint }],
    })
    expect(resolveChartContext('owner', query, selected, dataset()).checkpoint).toEqual(checkpoint)
    expect(
      resolveChartContext(
        'owner',
        query,
        { ...selected, run: { ...run, chartView: { ...checkpoint, cursorTime: start + 86400 } } },
        dataset()
      ).checkpoint
    ).toBeUndefined()
  })
  it.each([
    'https://evil.test/workspace',
    '//evil.test/workspace',
    '/workspace/profiles/2/replay',
    '/historify\\x',
    '/historify#x',
    '/historify/%5cfoo',
  ])('rejects unsafe or other-profile returns: %s', (target) =>
    expect(chartReturn(target, 1)).toBeUndefined())
  it('preserves safe library and own-journal return context', () => {
    expect(chartReturn('/historify?version=version-one', 1)).toBe('/historify?version=version-one')
    const query = readChartQuery(
      new URLSearchParams({
        profileId: '1',
        journalReturn: '/workspace/profiles/1/journal?tab=Trades&q=EXAMPLE',
      })
    )
    expect(query.journalReturn).toContain('tab=Trades')
    expect(query.journalReturn).toContain('q=EXAMPLE')
  })
})
