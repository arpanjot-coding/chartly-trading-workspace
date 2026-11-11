import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasetError, type DatasetPreview } from '@/api/dataLibrary'
import {
  csvHeaders,
  DataLibraryImport,
  emptyDatasetContext,
  emptyDatasetMapping,
} from './DataLibraryImport'
import { datasetCatalog, datasetVersion } from './testFixtures'

const api = vi.hoisted(() => ({
  preview: vi.fn(),
  commit: vi.fn(),
  importJob: vi.fn(),
  repreview: vi.fn(),
}))
const drafts = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), delete: vi.fn() }))
vi.mock('@/api/dataLibrary', async (original) => ({
  ...(await original<typeof import('@/api/dataLibrary')>()),
  dataLibrary: api,
}))
vi.mock('@/lib/historify/dataLibraryDrafts', () => ({ dataLibraryDrafts: drafts }))
const csv = 'timestamp,open,high,low,close\n2026-11-03T09:00:00Z,1,2,0,1.5\n'
function preview(rejected = 0, revision = 1): DatasetPreview {
  return {
    id: `preview-${revision}`,
    expectedRevision: revision,
    status: 'staged',
    preview: {
      rows: rejected
        ? [
            {
              rowNumber: 3,
              action: 'rejected',
              errors: [{ code: 'row.ohlc', message: 'High is below the candle prices.' }],
            },
          ]
        : [],
      counts: { accepted: 1, rejected, changed: 0 },
      quality: {
        summary: '1 unique valid candle.',
        warnings: [{ code: 'volume.unknown', message: 'Missing volume remains unknown.' }],
      },
      coverage: { volumeUnknownRows: 1 },
      canCommit: true,
    },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  drafts.get.mockResolvedValue(undefined)
  drafts.save.mockResolvedValue(undefined)
  drafts.delete.mockResolvedValue(undefined)
  api.preview.mockResolvedValue(preview())
  api.importJob.mockResolvedValue(preview())
  api.repreview.mockResolvedValue(preview(0, 2))
})
async function fill() {
  await waitFor(() => expect(screen.getByLabelText('Symbol / instrument')).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText('Paste candle CSV'), { target: { value: csv } })
  fireEvent.change(screen.getByLabelText('Symbol / instrument'), { target: { value: 'EURUSD' } })
}
describe('reviewed market history import', () => {
  it('reviews retained public candles without consuming an unsaved manual CSV draft', async () => {
    const observation = {
      provider: 'kraken-public',
      receivedAt: '2026-11-03T12:00:00Z',
      nativePair: 'XXBTZUSD',
      symbol: 'XBT/USD',
      interval: '1m',
      returnedFirst: 1793610000,
      returnedLast: 1793610060,
      closedRows: 2,
      excludedUnfinished: 1,
      maxEntries: 720,
      scope: 'Public data only; no private account.',
    }
    const retained = { ...preview(), sourceObservation: observation }
    const manualRequest = {
      expectedRevision: 99,
      requestId: 'uncertain-manual-commit',
      policy: 'new-version',
      allowRejectedRows: false,
    }
    drafts.get.mockResolvedValue({
      value: { csvText: csv, previewId: 'manual-review', pending: manualRequest },
    })
    api.importJob.mockResolvedValueOnce(retained)
    api.commit.mockResolvedValueOnce({
      version: datasetVersion({ sourceObservation: observation }),
      catalog: datasetCatalog([datasetVersion()]),
    })
    const reopenManual = vi.fn()
    render(
      <DataLibraryImport
        principalId="principal-one"
        catalog={datasetCatalog()}
        resumeId="public-review"
        onCatalog={vi.fn()}
        onVersion={vi.fn()}
        onNewImport={reopenManual}
      />
    )
    expect(await screen.findByText(/final unfinished candle was excluded/)).toBeVisible()
    expect(screen.queryByLabelText('Paste candle CSV')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publish immutable version' }))
    expect(await screen.findByText('History saved')).toBeVisible()
    expect(api.importJob).toHaveBeenCalledWith('public-review', 'principal-one')
    expect(api.commit).toHaveBeenCalledWith(
      retained.id,
      expect.objectContaining({ expectedRevision: 1 }),
      'principal-one'
    )
    expect(api.commit.mock.calls[0][1].requestId).not.toBe(manualRequest.requestId)
    expect(drafts.get).not.toHaveBeenCalled()
    expect(drafts.save).not.toHaveBeenCalled()
    expect(drafts.delete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Review another import' }))
    expect(reopenManual).toHaveBeenCalledOnce()
    expect(drafts.save).not.toHaveBeenCalled()
  })
  it('reads quoted header names without splitting quoted delimiters or escaped quotes', () => {
    expect(
      csvHeaders(
        '\uFEFFtimestamp,"open, adjusted","high ""quoted""",low,close\r\n2026,1,2,0,1',
        ','
      )
    ).toEqual(['timestamp', 'open, adjusted', 'high "quoted"', 'low', 'close'])
    expect(csvHeaders('timestamp;open;high;low;close\n2026;1,25;2;0;1,5', ';')).toEqual([
      'timestamp',
      'open',
      'high',
      'low',
      'close',
    ])
  })

  it('uses the declared timezone/units/mapping and requires deliberate rejected-subset consent', async () => {
    api.preview.mockResolvedValue(preview(1))
    render(
      <DataLibraryImport
        principalId="principal-one"
        catalog={datasetCatalog()}
        onCatalog={vi.fn()}
        onVersion={vi.fn()}
      />
    )
    await fill()
    fireEvent.change(screen.getByLabelText('Timestamp format'), {
      target: { value: 'milliseconds' },
    })
    fireEvent.change(screen.getByLabelText('Source timezone (IANA)'), {
      target: { value: 'America/New_York' },
    })
    fireEvent.change(screen.getByLabelText('Decimal separator'), { target: { value: ',' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview candles and quality' }))
    expect(await screen.findByText('High is below the candle prices.')).toBeInTheDocument()
    expect(screen.getByText('Missing volume remains unknown.')).toBeInTheDocument()
    expect(api.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 1,
        csvText: csv,
        mapping: expect.objectContaining({
          timestampFormat: 'milliseconds',
          timezone: 'America/New_York',
          timestampMeaning: 'open',
          decimalSeparator: ',',
        }),
        context: expect.objectContaining({ symbol: 'EURUSD', volumeMeaning: 'unknown' }),
      }),
      'principal-one'
    )
    expect(screen.getByRole('button', { name: 'Publish immutable version' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /reviewed rejected rows/ }))
    expect(screen.getByRole('button', { name: 'Publish immutable version' })).toBeEnabled()
  })
  it('retains the original reviewed request after a lost acknowledgement and retries it unchanged', async () => {
    const version = datasetVersion()
    const catalog = datasetCatalog()
    const received = vi.fn()
    api.commit
      .mockRejectedValueOnce(
        new DatasetError(
          'datasets.offline',
          'The local engine is unavailable. Your input is retained.'
        )
      )
      .mockResolvedValueOnce({ version, catalog: { ...catalog, revision: 2, versions: [version] } })
    render(
      <DataLibraryImport
        principalId="principal-one"
        catalog={catalog}
        onCatalog={received}
        onVersion={vi.fn()}
      />
    )
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Preview candles and quality' }))
    await screen.findByRole('button', { name: 'Publish immutable version' })
    fireEvent.click(screen.getByRole('button', { name: 'Publish immutable version' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('input is retained')
    expect(screen.getByLabelText('Paste candle CSV')).toHaveValue(csv)
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same reviewed commit' }))
    await screen.findByText('History saved')
    expect(api.commit.mock.calls[1]).toEqual(api.commit.mock.calls[0])
    expect(drafts.save).toHaveBeenCalledWith(
      'principal-one',
      expect.objectContaining({ pending: api.commit.mock.calls[0][1] })
    )
    expect(drafts.delete).toHaveBeenCalledTimes(1)
    expect(received).toHaveBeenCalledTimes(1)
  })
  it('reopens retained source metadata and fences stale previews until explicit re-preview', async () => {
    const catalog = { ...datasetCatalog(), revision: 2 }
    const context = { ...emptyDatasetContext(), symbol: 'EURUSD', provider: 'retained-provider' }
    api.importJob.mockResolvedValue({
      ...preview(),
      context,
      mapping: emptyDatasetMapping(),
      baseVersionId: 'base-version',
    })
    render(
      <DataLibraryImport
        principalId="principal-one"
        catalog={catalog}
        resumeId="preview-1"
        onCatalog={vi.fn()}
        onVersion={vi.fn()}
      />
    )
    const button = await screen.findByRole('button', { name: 'Publish immutable version' })
    expect(button).toBeDisabled()
    expect(screen.getByLabelText('Source / provider')).toHaveValue('retained-provider')
    fireEvent.click(screen.getByRole('button', { name: 'Re-preview retained source' }))
    await waitFor(() => expect(button).toBeEnabled())
    expect(api.repreview).toHaveBeenCalledWith('preview-1', 2, 'principal-one')
    expect(api.commit).not.toHaveBeenCalled()
  })
})
