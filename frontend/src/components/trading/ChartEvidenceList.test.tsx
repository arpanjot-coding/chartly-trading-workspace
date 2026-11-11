import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChartEvidenceList } from './ChartEvidenceList'

const record = {
  chartEvidence: [
    {
      id: 'evidence-1',
      attachmentId: 'attachment-1',
      imageSha256: 'a'.repeat(64),
      capturedAt: '2026-11-03T09:00:00Z',
      source: { kind: 'dataset', datasetVersionId: 'version-1', checksum: 'b'.repeat(64) },
      instrument: { symbol: 'EXAMPLE', exchange: 'LOCAL' },
      view: {
        interval: '1m',
        chartType: 'candlestick',
        timezone: 'UTC',
        visibleFrom: 100,
        visibleTo: 200,
        replayAsOf: 150,
      },
      annotations: 'Original view, before the next candle.',
    },
  ],
}

describe('saved chart evidence', () => {
  it('loads an image only after its evidence row opens and retains source/time/notes', () => {
    render(<ChartEvidenceList record={record} originId="restored-origin" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const details = screen.getByText(/EXAMPLE · 1m/).closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/api/local/v1/attachments/attachment-1?originId=restored-origin'
    )
    expect(screen.getByText('Original view, before the next candle.')).toBeInTheDocument()
    expect(screen.getByText(/Saved history · LOCAL · candlestick · UTC/)).toBeInTheDocument()
  })
  it('shows recovery guidance when the current durable source is unavailable', () => {
    render(<ChartEvidenceList record={record} />)
    const details = screen.getByText(/EXAMPLE · 1m/).closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText(/durable local storage/)).toBeInTheDocument()
  })
  it('offers an explicit retry when saved bytes cannot be read', () => {
    render(<ChartEvidenceList record={record} originId="restored-origin" />)
    const details = screen.getByText(/EXAMPLE · 1m/).closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByText(/saved image could not be read/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved image' }))
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/api/local/v1/attachments/attachment-1?originId=restored-origin'
    )
  })
  it('links the exact saved evidence and owned trade while keeping its journal return context', () => {
    render(
      <ChartEvidenceList
        record={record}
        originId="origin"
        reopenContext={{
          profileId: 7,
          tradeId: 21,
          bookId: 'book-A',
          journalReturn: '/workspace/profiles/7/journal?tab=Trades&trade=21',
        }}
      />
    )
    const details = screen.getByText(/EXAMPLE · 1m/).closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    const link = screen.getByRole('link', { name: 'Reopen recorded chart' })
    const query = new URL(link.getAttribute('href')!, 'http://chartly.local').searchParams
    expect(Object.fromEntries(query)).toMatchObject({
      profileId: '7',
      tradeId: '21',
      bookId: 'book-A',
      evidenceId: 'evidence-1',
      journalReturn: '/workspace/profiles/7/journal?tab=Trades&trade=21',
    })
    expect(query.has('datasetVersionId')).toBe(false)
    expect(query.has('from')).toBe(false)
  })
  it('labels connected history as current analysis rather than reconstructing historical data', () => {
    const connected = {
      chartEvidence: [
        {
          ...record.chartEvidence[0],
          source: { kind: 'legacy-connected', provider: 'Connected account' },
        },
      ],
    }
    render(
      <ChartEvidenceList
        record={connected}
        originId="origin"
        reopenContext={{ profileId: 7, runId: 31 }}
      />
    )
    const details = screen.getByText(/EXAMPLE · 1m/).closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(screen.getByRole('link', { name: 'Open current connected chart' })).toHaveAttribute(
      'href',
      '/trading?profileId=7&evidenceId=evidence-1&runId=31'
    )
    expect(screen.getByText(/historical data cannot be reconstructed exactly/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Reopen recorded chart' })).not.toBeInTheDocument()
  })
})
