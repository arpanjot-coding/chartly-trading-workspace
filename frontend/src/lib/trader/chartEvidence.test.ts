import { describe, expect, it } from 'vitest'
import {
  type ChartEvidenceCapture,
  chartEvidenceUrl,
  chartImageBase64,
  readChartEvidence,
  recordedChartHref,
  validateChartCapture,
} from './chartEvidence'

const capture: ChartEvidenceCapture = {
  version: 1,
  capturedAt: '2026-11-03T09:00:00Z',
  source: { kind: 'dataset', datasetVersionId: 'version-fixture', checksum: 'a'.repeat(64) },
  instrument: { symbol: 'EXAMPLE', exchange: 'LOCAL' },
  view: {
    interval: '1m',
    chartType: 'candlestick',
    timezone: 'UTC',
    visibleFrom: 100,
    visibleTo: 200,
    replayAsOf: 150,
  },
}

describe('chart evidence wire helpers', () => {
  it('freezes a private metadata copy before a pane can change', () => {
    const value = validateChartCapture(capture)
    value.instrument.symbol = 'OTHER'
    expect(capture.instrument.symbol).toBe('EXAMPLE')
  })
  it.each([NaN, Infinity, -Infinity])('rejects non-finite chart bounds: %s', (value) => {
    expect(() =>
      validateChartCapture({ ...capture, view: { ...capture.view, visibleTo: value } })
    ).toThrow('time window')
  })
  it('rejects reversed windows, missing source identity and unbounded metadata', () => {
    expect(() =>
      validateChartCapture({ ...capture, view: { ...capture.view, visibleFrom: 300 } })
    ).toThrow('time window')
    expect(() =>
      validateChartCapture({
        ...capture,
        source: { kind: 'dataset', datasetVersionId: 'version-fixture', checksum: 'fake' },
      })
    ).toThrow('source')
    expect(() =>
      validateChartCapture({
        ...capture,
        instrument: { symbol: 'X'.repeat(70_000), exchange: 'LOCAL' },
      })
    ).toThrow('metadata')
  })
  it('encodes only bounded nonempty PNG blobs', async () => {
    const image = {
      type: 'image/png',
      size: 3,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as Blob
    expect(await chartImageBase64(image)).toBe('AQID')
    await expect(chartImageBase64({ ...image, type: 'image/svg+xml' } as Blob)).rejects.toThrow(
      'PNG'
    )
    await expect(chartImageBase64({ ...image, size: 8 * 1024 * 1024 + 1 } as Blob)).rejects.toThrow(
      '8 MiB'
    )
    await expect(chartImageBase64({ ...image, size: 0 } as Blob)).rejects.toThrow('PNG')
  })
  it('derives a local attachment URL with encoded identity after restore', () => {
    const value = chartEvidenceUrl('source A&B', 'attachment/path')
    expect(value).toBe('/api/local/v1/attachments/attachment%2Fpath?originId=source+A%26B')
    expect(value).not.toContain('http')
  })
  it('ignores unsupported/corrupt evidence instead of crashing a preserved record', () => {
    const { version: _version, ...stored } = capture
    const valid = {
      ...stored,
      id: 'evidence1',
      attachmentId: 'asset1',
      imageSha256: 'b'.repeat(64),
      annotations: '',
    }
    expect(readChartEvidence({ chartEvidence: [null, { id: 1 }, valid] })).toEqual([valid])
    expect(readChartEvidence({})).toEqual([])
  })
  it('reopens the latest owned evidence by identity, carrying no forgeable source or view metadata', () => {
    const { version: _version, ...stored } = capture
    const record = {
      chartEvidence: [
        { ...stored, id: 'newer', attachmentId: 'image-new', capturedAt: '2026-11-03T10:00:00Z' },
        { ...stored, id: 'older', attachmentId: 'image-old' },
      ],
    }
    const url = recordedChartHref(record, {
      profileId: 7,
      runId: 31,
      tradeId: 21,
      bookId: 'book-A',
      journalReturn: '/workspace/profiles/7/journal?tab=Trades&trade=21&q=EXAMPLE',
    })!
    const params = new URL(url, 'http://chartly.local').searchParams
    expect(Object.fromEntries(params)).toEqual({
      profileId: '7',
      runId: '31',
      tradeId: '21',
      bookId: 'book-A',
      evidenceId: 'newer',
      journalReturn: '/workspace/profiles/7/journal?tab=Trades&q=EXAMPLE&trade=21',
    })
    expect(url).not.toMatch(/datasetVersionId|checksum|replayAsOf|from=|to=/)
    expect(recordedChartHref(record, { profileId: 7, tradeId: 21 }, 'older')).toContain(
      'evidenceId=older'
    )
    expect(recordedChartHref(record, { profileId: 7, tradeId: 21 }, 'foreign')).toBeUndefined()
  })
  it('preserves only the target profile return route and never invents a target', () => {
    const { version: _version, ...stored } = capture
    const record = { chartEvidence: [{ ...stored, id: 'proof', attachmentId: 'image' }] }
    const context = { profileId: 7, runId: 31 }
    const url = recordedChartHref(record, {
      ...context,
      returnTo: '/workspace/profiles/7/replay?datasetVersionId=version-fixture',
    })!
    expect(new URL(url, 'http://chartly.local').searchParams.get('returnTo')).toBe(
      '/workspace/profiles/7/replay?datasetVersionId=version-fixture'
    )
    const unsafe = recordedChartHref(record, {
      ...context,
      returnTo: 'https://example.com/workspace/profiles/7/replay',
      journalReturn: '/workspace/profiles/8/journal',
    })!
    expect(unsafe).not.toMatch(/returnTo|journalReturn/)
    expect(recordedChartHref(record, { profileId: 7 })).toBeUndefined()
    expect(recordedChartHref(record, { profileId: 7, tradeId: -1 })).toBeUndefined()
    expect(recordedChartHref({}, context)).toBeUndefined()
  })
})
