import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installBlobText } from '@/test/axiosAnswer'

const { csrf } = vi.hoisted(() => ({ csrf: vi.fn() }))
vi.mock('@/api/client', () => ({ fetchCSRFToken: csrf }))

import type { ChartEvidenceRequest } from './chartEvidence'
import { journalClient } from './journalClient'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  csrf.mockResolvedValue('proof')
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())
describe('scoped durable journal transport', () => {
  it('sends the exact frozen chart evidence and target through the local CSRF boundary', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ workspace: { originId: 'source', revision: 4 } }))
    )
    const body: ChartEvidenceRequest = {
      originId: 'source',
      expectedRevision: 3,
      requestId: 'same-capture-request',
      target: { kind: 'trade', id: 7, profileId: 2, bookId: 'book-2' },
      mimeType: 'image/png',
      base64: 'iVBORw0KGgo=',
      annotations: 'At entry',
      capture: {
        version: 1,
        capturedAt: '2026-11-03T09:00:00Z',
        source: { kind: 'dataset', datasetVersionId: 'version-1', checksum: 'a'.repeat(64) },
        instrument: { symbol: 'EXAMPLE', exchange: 'LOCAL' },
        view: { interval: '1m', chartType: 'candlestick', timezone: 'UTC', replayAsOf: 100 },
      },
    }
    await journalClient.attachChartEvidence(body)
    const [path, options] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/local/v1/journal/chart-evidence')
    expect(JSON.parse(options.body)).toEqual(body)
    expect(options.credentials).toBe('include')
    expect(options.headers.get('X-CSRFToken')).toBe('proof')
  })
  it('sends exact decimal strings, original revision and retry identity with CSRF', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ workspace: { originId: 'source', revision: 4 } }))
    )
    const body = {
      originId: 'source',
      expectedRevision: 3,
      requestId: 'unchanged-retry-id',
      action: 'partial-close-trade',
      payload: { tradeId: 7, quantity: '0.000000000000000001', netPnl: '1.000000000000000001' },
    }
    await journalClient.action(body)
    const [path, options] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/local/v1/journal/actions')
    expect(JSON.parse(options.body)).toEqual(body)
    expect(options.credentials).toBe('include')
    expect(options.headers.get('X-CSRFToken')).toBe('proof')
  })
  it('preserves revision conflict codes and issues without silently retrying', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'storage.revision_conflict',
            message: 'Reload the saved record.',
            issues: [{ path: 'revision' }],
          },
        }),
        { status: 409 }
      )
    )
    await expect(
      journalClient.action({
        originId: 's',
        expectedRevision: 1,
        requestId: 'i',
        action: 'x',
        payload: {},
      })
    ).rejects.toMatchObject({
      code: 'storage.revision_conflict',
      status: 409,
      issues: [{ path: 'revision' }],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('refuses mutation when session proof is missing', async () => {
    csrf.mockResolvedValue('')
    await expect(journalClient.repreviewImport('job', 4)).rejects.toMatchObject({
      code: 'csrf.unavailable',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('scopes recovered previews and full exports and encodes identifiers', async () => {
    installBlobText()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'job' })))
    await journalClient.importPreview('a/b', 'source & other')
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/local/v1/journal/imports/a%2Fb?originId=source+%26+other'
    )
    fetchMock.mockResolvedValue(new Response('full-source'))
    const exported = await journalClient.export('source', 7, 'book & id', 'csv')
    expect(await exported.text()).toBe('full-source')
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/local/v1/journal/export?originId=source&portfolioId=7&bookId=book+%26+id&format=csv'
    )
    expect(csrf).not.toHaveBeenCalled()
  })
  it('turns engine disconnection into an actionable retained-draft error', async () => {
    fetchMock.mockRejectedValue(new TypeError('network failed'))
    await expect(journalClient.state('source')).rejects.toMatchObject({
      code: 'journal.offline',
      message: expect.stringContaining('draft is retained'),
    })
  })
})
