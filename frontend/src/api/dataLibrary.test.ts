import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasetError, dataLibrary } from './dataLibrary'

vi.mock('@/api/client', () => ({ fetchCSRFToken: vi.fn(async () => 'local-csrf') }))
const fetcher = vi.fn()
beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal('fetch', fetcher)
})
describe('private dataset transport', () => {
  it('routes public market reads and staged reviews through captured owner scope without credentials', async () => {
    fetcher.mockImplementation(async () => new Response('{}'))
    await dataLibrary.krakenInstruments('XBT/USD', 'principal-one')
    expect(fetcher.mock.calls[0][0]).toBe(
      '/api/local/v1/datasets/sources/kraken/instruments?q=XBT%2FUSD&limit=50'
    )
    expect(new Headers(fetcher.mock.calls[0][1].headers).get('X-Chartly-Principal')).toBe(
      'principal-one'
    )
    await dataLibrary.previewKraken(
      { expectedRevision: 4, pair: 'XXBTZUSD', interval: '1m' },
      'principal-one'
    )
    const init = fetcher.mock.calls[1][1] as RequestInit
    expect(new Headers(init.headers).get('X-Chartly-Principal')).toBe('principal-one')
    expect(new Headers(init.headers).get('X-CSRFToken')).toBe('local-csrf')
    expect(JSON.parse(String(init.body))).toEqual({
      expectedRevision: 4,
      pair: 'XXBTZUSD',
      interval: '1m',
    })
    expect(String(init.body)).not.toContain('apiKey')
  })
  it('accepts only an exact server-declared restored alias and leaves checksum validation to the owned context', async () => {
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'canonical',
          resolvedFromVersionId: 'old-version',
          checksum: 'same-content',
        })
      )
    )
    await expect(dataLibrary.version('old-version')).resolves.toMatchObject({
      id: 'canonical',
      resolvedFromVersionId: 'old-version',
      checksum: 'same-content',
    })
    expect(fetcher.mock.calls[0][0]).toBe('/api/local/v1/datasets/versions/old-version')
    for (const response of [
      { id: 'canonical', checksum: 'same-content' },
      { id: 'canonical', resolvedFromVersionId: 'another-old-version', checksum: 'same-content' },
      { id: 'old-version', resolvedFromVersionId: 'different', checksum: 'same-content' },
      { resolvedFromVersionId: 'old-version', checksum: 'same-content' },
    ]) {
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify(response)))
      await expect(dataLibrary.version('old-version')).rejects.toMatchObject({
        code: 'datasets.version_mismatch',
      })
    }
  })
  it('uses local cookie access with exact UTC bounds, no broker key or date padding', async () => {
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ versionId: 'v/a', checksum: 'fixed', bars: [] }))
    )
    const signal = new AbortController().signal
    await dataLibrary.bars('v/a', { from: 0, to: 1.000001, limit: 100, signal })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/local/v1/datasets/versions/v%2Fa/bars?from=0&to=1.000001&limit=100',
      expect.objectContaining({ credentials: 'include', signal })
    )
    expect(fetcher.mock.calls[0][0]).not.toContain('api_key')
  })
  it('sends the unchanged reviewed body and stable request identity without silent retries', async () => {
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'dataset.revision_conflict', message: 'Review the current catalog.' },
        }),
        { status: 409 }
      )
    )
    const body = {
      expectedRevision: 7,
      requestId: 'same-request',
      policy: 'replace' as const,
      allowRejectedRows: true,
    }
    await expect(dataLibrary.commit('preview-1', body)).rejects.toMatchObject({
      code: 'dataset.revision_conflict',
      status: 409,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const request = fetcher.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual(body)
    expect(new Headers(request.headers).get('X-CSRFToken')).toBe('local-csrf')
  })
  it('retains typed offline and abort failures instead of substituting an empty catalog', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('offline'))
    await expect(dataLibrary.catalog()).rejects.toBeInstanceOf(DatasetError)
    const abort = new DOMException('cancelled', 'AbortError')
    fetcher.mockRejectedValueOnce(abort)
    await expect(dataLibrary.catalog(new AbortController().signal)).rejects.toBe(abort)
  })
  it.each([
    'dataset.time_unverified',
    'dataset.feed_time_unverified',
  ])('explains the recovery path for %s', async (code) => {
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code } }), { status: 409 })
    )
    await expect(dataLibrary.bars('quarantined-version', {})).rejects.toMatchObject({
      code,
      status: 409,
      message: expect.stringMatching(/verified UTC timestamps/),
    })
  })
  it('uses bounded catalog pagination and explicit persisted job commands', async () => {
    fetcher.mockImplementation(async () => new Response('{}'))
    await dataLibrary.catalog(undefined, 100)
    expect(fetcher.mock.calls[0][0]).toBe('/api/local/v1/datasets?offset=100')
    await dataLibrary.controlDownload('download-1', 9, 'control-request', 'pause')
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      expectedRevision: 9,
      requestId: 'control-request',
      command: 'pause',
    })
    await dataLibrary.commitBundle('bundle-1', 9, 'restore-request')
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
      expectedRevision: 9,
      requestId: 'restore-request',
    })
  })
})
