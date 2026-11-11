import { describe, expect, it } from 'vitest'
import type { DatasetVersion } from '@/api/dataLibrary'
import type { ChartEvidenceRecord } from '@/lib/trader/chartEvidence'
import type { JournalTrade, PracticeSession, TraderPortfolio } from '@/lib/trader/db'
import { readChartQuery, resolveChartContext, selectedChartRecords } from './chartContext'

const start = Date.parse('2026-11-02T09:00:00Z') / 1000
const evidence: ChartEvidenceRecord = {
  id: 'evidence-one',
  attachmentId: 'image-one',
  imageSha256: 'f'.repeat(64),
  capturedAt: '2026-11-03T09:00:00Z',
  source: { kind: 'dataset', datasetVersionId: 'version-old', checksum: 'a'.repeat(64) },
  instrument: { symbol: 'EXAMPLE', exchange: 'LOCAL' },
  view: {
    interval: '1m',
    chartType: 'line',
    timezone: 'UTC',
    visibleFrom: start + 60,
    visibleTo: start + 120,
    replayAsOf: start + 135,
  },
  annotations: '',
}
const profile = {
  id: 1,
  name: 'Actual profile',
  kind: 'live',
  chartSource: { kind: 'dataset', versionId: 'version-new', checksum: 'b'.repeat(64) },
} as TraderPortfolio
const trade = {
  id: 3,
  portfolioId: 1,
  pair: 'EXAMPLE',
  timeframe: '1m',
  openDate: '2026-11-02T09:01:00Z',
  chartEvidence: [evidence],
} as JournalTrade
const version: DatasetVersion = {
  id: 'version-old',
  datasetId: 'dataset-old',
  name: 'Original source',
  checksum: 'a'.repeat(64),
  sourceHash: 'c'.repeat(64),
  rowCount: 4,
  start,
  end: start + 180,
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
}
const rows = { portfolios: [profile], trades: [trade], sessions: [] as PracticeSession[] }
const query = { profileId: 1, tradeId: 3, evidenceId: evidence.id }
describe('recorded chart handoff', () => {
  it('derives recorded history bounds from the owned source rather than editable URL bounds', () => {
    const narrowed = { ...query, from: start + 150, to: start + 160 }
    const context = resolveChartContext(
      'owner',
      narrowed,
      selectedChartRecords(narrowed, rows),
      version
    )
    expect(context.window).toEqual({ from: start, to: version.end })
    expect(context.evidence?.view.replayAsOf).toBe(start + 135)
    expect(context.evidence?.view.visibleFrom).toBe(start + 60)
  })
  it('restores the actual recorded source and view after the profile default changes without mutating it', () => {
    const selected = selectedChartRecords(query, rows)
    expect(selected.datasetId).toBe('version-old')
    const context = resolveChartContext('owner', query, selected, version)
    expect(context.dataset?.id).toBe('version-old')
    expect(context.evidence?.view).toEqual(evidence.view)
    expect(context.navigation.get('evidenceId')).toBe(evidence.id)
    expect(context.executionAllowed).toBe(false)
    expect(context.checkpoint).toBeUndefined()
    expect(profile.chartSource).toMatchObject({ versionId: 'version-new' })
  })
  it('accepts only a server-attested original version alias with matching evidence checksum', () => {
    const selected = selectedChartRecords(query, rows)
    expect(() =>
      resolveChartContext('owner', query, selected, { ...version, id: 'restored' })
    ).toThrow(/verified/)
    const restored = { ...version, id: 'restored', resolvedFromVersionId: version.id }
    expect(resolveChartContext('owner', query, selected, restored).dataset?.id).toBe('restored')
    expect(() =>
      resolveChartContext('owner', query, selected, { ...restored, checksum: 'b'.repeat(64) })
    ).toThrow(/checksum/)
  })
  it('refuses another trade’s evidence ID before requesting history', () => {
    expect(() =>
      selectedChartRecords(query, { ...rows, trades: [{ ...trade, chartEvidence: [] }] })
    ).toThrow(/not available/)
  })
  it('refuses a query source that conflicts with the recorded source', () => {
    expect(() => selectedChartRecords({ ...query, datasetVersionId: 'version-new' }, rows)).toThrow(
      /conflicts/
    )
  })
  it('keeps a run pin stronger than recorded evidence or profile defaults', () => {
    const run = {
      id: 2,
      portfolioId: 1,
      symbol: 'EXAMPLE',
      timeframe: '1m',
      datasetVersionId: 'version-new',
      datasetChecksum: 'b'.repeat(64),
    } as PracticeSession
    expect(() =>
      selectedChartRecords(
        { ...query, runId: 2 },
        { ...rows, sessions: [run], trades: [{ ...trade, sessionId: 2 }] }
      )
    ).toThrow(/pinned run/)
  })
  it('accepts a new canonical capture on an old-bound restored run only after both exact owned IDs converge', () => {
    const run = {
      id: 2,
      portfolioId: 1,
      symbol: 'EXAMPLE',
      timeframe: '1m',
      datasetVersionId: 'version-before-restore',
      datasetChecksum: version.checksum,
    } as PracticeSession
    const recorded = { ...query, runId: 2, datasetVersionId: version.id }
    const selected = selectedChartRecords(recorded, {
      ...rows,
      sessions: [run],
      trades: [{ ...trade, sessionId: 2 }],
    })
    expect(selected.runVerificationId).toBe(run.datasetVersionId)
    expect(() => resolveChartContext('owner', recorded, selected, version)).toThrow(
      /verified as the pinned/
    )
    const proof = { ...version, resolvedFromVersionId: run.datasetVersionId }
    expect(resolveChartContext('owner', recorded, selected, version, proof).dataset?.id).toBe(
      version.id
    )
    expect(() =>
      resolveChartContext('owner', recorded, selected, version, {
        ...proof,
        resolvedFromVersionId: 'unrelated',
      })
    ).toThrow(/verified as the pinned/)
    expect(() =>
      resolveChartContext('owner', recorded, selected, version, {
        ...proof,
        id: 'another-canonical-version',
      })
    ).toThrow(/verified as the pinned/)
    expect(() =>
      resolveChartContext('owner', recorded, selected, version, {
        ...proof,
        checksum: 'b'.repeat(64),
      })
    ).toThrow(/verified as the pinned/)
  })
  it('rejects metadata for a different venue or native interval', () => {
    const selected = selectedChartRecords(query, rows)
    expect(() =>
      resolveChartContext(
        'owner',
        query,
        {
          ...selected,
          evidence: { ...evidence, instrument: { ...evidence.instrument, exchange: 'OTHER' } },
        },
        version
      )
    ).toThrow(/instrument/)
    expect(() =>
      resolveChartContext(
        'owner',
        query,
        { ...selected, evidence: { ...evidence, view: { ...evidence.view, interval: '5m' } } },
        version
      )
    ).toThrow(/interval/)
  })
  it('requires explicit current analysis for a trade without saved history', () => {
    const records = {
      ...rows,
      portfolios: [{ ...profile, chartSource: { kind: 'connected' as const } }],
      trades: [{ ...trade, chartEvidence: undefined }],
    }
    const plain = { profileId: 1, tradeId: 3 }
    expect(resolveChartContext('owner', plain, selectedChartRecords(plain, records))).toMatchObject(
      { source: 'missing', historicalUnavailable: true, executionAllowed: false }
    )
    const current = { ...plain, currentAnalysis: true }
    expect(
      resolveChartContext('owner', current, selectedChartRecords(current, records))
    ).toMatchObject({
      source: 'legacy-connected',
      historicalUnavailable: true,
      executionAllowed: false,
    })
  })
  it('does not reinterpret connected evidence using a later saved profile default', () => {
    const connected = {
      ...evidence,
      source: { kind: 'legacy-connected' as const, provider: 'original' },
    }
    const selected = selectedChartRecords(query, {
      ...rows,
      trades: [{ ...trade, chartEvidence: [connected] }],
    })
    expect(selected.datasetId).toBeUndefined()
    expect(resolveChartContext('owner', query, selected).source).toBe('missing')
  })
  it('uses the recorded venue and interval for explicitly requested current connected analysis', () => {
    const connected = {
      ...evidence,
      source: { kind: 'legacy-connected' as const, provider: 'original' },
    }
    const current = { ...query, currentAnalysis: true }
    const selected = selectedChartRecords(current, {
      ...rows,
      trades: [{ ...trade, chartEvidence: [connected] }],
    })
    expect(resolveChartContext('owner', current, selected)).toMatchObject({
      source: 'legacy-connected',
      historicalUnavailable: true,
      defaultSymbol: { symbol: 'EXAMPLE', exchange: 'LOCAL', interval: '1m' },
      executionAllowed: false,
    })
  })
  it('permits explicit current analysis for unpinned connected run evidence but keeps the historical warning', () => {
    const connected = {
      ...evidence,
      source: { kind: 'legacy-connected' as const, provider: 'original' },
    }
    const run = {
      id: 2,
      portfolioId: 1,
      symbol: 'EXAMPLE',
      timeframe: '1m',
      chartEvidence: [connected],
    } as PracticeSession
    const current = { profileId: 1, runId: 2, evidenceId: evidence.id, currentAnalysis: true }
    expect(
      resolveChartContext(
        'owner',
        current,
        selectedChartRecords(current, { ...rows, sessions: [run] })
      )
    ).toMatchObject({
      source: 'legacy-connected',
      historicalUnavailable: true,
      executionAllowed: false,
    })
  })
  it('rejects no-overlap trade dates rather than showing recent or unrelated saved prices', () => {
    const plain = { profileId: 1, tradeId: 3, datasetVersionId: version.id }
    const selected = selectedChartRecords(plain, {
      ...rows,
      trades: [{ ...trade, openDate: '2026-10-01T09:00:00Z' }],
    })
    expect(() => resolveChartContext('owner', plain, selected, version)).toThrow(/no candles/)
  })
  it('accepts the UTC trade day overlapping saved history without inventing a timezone', () => {
    const plain = { profileId: 1, tradeId: 3, datasetVersionId: version.id }
    const selected = selectedChartRecords(plain, {
      ...rows,
      trades: [{ ...trade, openDate: '2026-11-02' }],
    })
    expect(resolveChartContext('owner', plain, selected, version).source).toBe('dataset')
  })
  it.each([
    'evidenceId=foreign',
    'profileId=1&tradeId=3&evidenceId=../x',
    'profileId=1&tradeId=3&evidenceId=a&evidenceId=b',
    'profileId=1&currentAnalysis=true',
  ])('rejects malformed handoff links: %s', (link) =>
    expect(() => readChartQuery(new URLSearchParams(link))).toThrow())
})
