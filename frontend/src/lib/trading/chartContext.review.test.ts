import { describe, expect, it } from 'vitest'
import type { DatasetVersion } from '@/api/dataLibrary'
import type { JournalTrade, PracticeSession, TraderPortfolio } from '@/lib/trader/db'
import { readChartQuery, resolveChartContext, selectedChartRecords } from './chartContext'

const profile: TraderPortfolio = {
  id: 7,
  name: 'Actual environment',
  kind: 'live',
  currency: 'USD',
  startingBalance: 0,
  defaultSymbol: 'PROFILE-DEFAULT',
  defaultTimeframe: '15m',
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
}
const trade = {
  id: 21,
  portfolioId: 7,
  pair: 'TRADE-INSTRUMENT',
  timeframe: '5m',
  journalBookId: 'book-owned',
} as JournalTrade
const rows = {
  portfolios: [profile],
  trades: [trade],
  sessions: [] as PracticeSession[],
  bookAssignments: { 21: 'book-owned' },
  books: [
    { id: 'book-owned', name: 'Owned book', kind: 'manual' as const, profileIds: [7] },
    {
      id: 'book-foreign-profile',
      name: 'Different environment',
      kind: 'manual' as const,
      profileIds: [8],
    },
  ],
}
const version: DatasetVersion = {
  id: 'version-source',
  datasetId: 'dataset-source',
  name: 'History',
  checksum: 'a'.repeat(64),
  sourceHash: 'b'.repeat(64),
  rowCount: 2,
  start: 100,
  end: 160,
  sizeBytes: 100,
  createdAt: '2026-11-03T09:00:00Z',
  quality: {},
  coverage: {},
  dependencies: [],
  metadata: {
    provider: 'fixture',
    symbol: 'OTHER-INSTRUMENT',
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

describe('independent P05 context review', () => {
  it('opens the actual journal trade instrument and timeframe instead of unrelated profile defaults', () => {
    const query = { profileId: 7, tradeId: 21 }
    const context = resolveChartContext('owner', query, selectedChartRecords(query, rows))
    expect(context.defaultSymbol).toMatchObject({ symbol: 'TRADE-INSTRUMENT', interval: '5m' })
    expect(context.bookId).toBe('book-owned')
    expect(context.executionAllowed).toBe(false)
  })
  it('keeps an explicitly selected connected instrument/venue ahead of environment defaults', () => {
    const query = readChartQuery(new URLSearchParams('profileId=7&symbol=CHOSEN&exchange=VENUE'))
    const context = resolveChartContext('owner', query, selectedChartRecords(query, rows))
    expect(context.defaultSymbol).toMatchObject({ symbol: 'CHOSEN', exchange: 'VENUE' })
  })
  it('refuses a conflicting instrument in a trade deep link', () => {
    const query = readChartQuery(
      new URLSearchParams('profileId=7&tradeId=21&symbol=DIFFERENT&exchange=VENUE')
    )
    expect(() => resolveChartContext('owner', query, selectedChartRecords(query, rows))).toThrow()
  })
  it('does not open an unrelated saved dataset under an existing journal trade identity', () => {
    const query = { profileId: 7, tradeId: 21, datasetVersionId: version.id }
    expect(() =>
      resolveChartContext('owner', query, selectedChartRecords(query, rows), version)
    ).toThrow()
  })
  it('rejects a foreign book even when no trade ID was supplied', () => {
    const query = { profileId: 7, bookId: 'book-foreign-profile' }
    expect(() => selectedChartRecords(query, rows)).toThrow()
  })
  it('rejects a nonexistent book rather than claiming the query label as verified context', () => {
    const query = { profileId: 7, bookId: 'invented-book' }
    expect(() => selectedChartRecords(query, rows)).toThrow()
  })
  it('accepts an actual owned book without requiring an arbitrary first trade', () => {
    const query = { profileId: 7, bookId: 'book-owned' }
    const context = resolveChartContext('owner', query, selectedChartRecords(query, rows))
    expect(context.bookId).toBe('book-owned')
    expect(context.navigation.get('bookId')).toBe('book-owned')
  })
  it('keeps two owned profiles and source versions isolated through stable rename-safe namespaces', () => {
    const other = { ...profile, id: 8, name: 'Second environment' }
    const all = { ...rows, portfolios: [profile, other] }
    const firstQuery = { profileId: 7, datasetVersionId: version.id }
    const secondQuery = { profileId: 8, datasetVersionId: version.id }
    const first = resolveChartContext(
      'owner',
      firstQuery,
      selectedChartRecords(firstQuery, all),
      version
    )
    const second = resolveChartContext(
      'owner',
      secondQuery,
      selectedChartRecords(secondQuery, all),
      version
    )
    const renamed = resolveChartContext(
      'owner',
      firstQuery,
      selectedChartRecords(firstQuery, {
        ...all,
        portfolios: [{ ...profile, name: 'Renamed' }, other],
      }),
      version
    )
    const anotherVersion = { ...version, id: 'version-other', checksum: 'c'.repeat(64) }
    const sourceQuery = { profileId: 7, datasetVersionId: anotherVersion.id }
    const source = resolveChartContext(
      'owner',
      sourceQuery,
      selectedChartRecords(sourceQuery, all),
      anotherVersion
    )
    expect(first.namespace).not.toBe(second.namespace)
    expect(first.namespace).not.toBe(source.namespace)
    expect(first.namespace).toBe(renamed.namespace)
  })
})
