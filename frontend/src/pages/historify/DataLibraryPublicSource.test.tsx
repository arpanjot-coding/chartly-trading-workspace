import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type DatasetPreview, dataLibrary } from '@/api/dataLibrary'
import DataLibraryPublicSource, { PublicSourceDetails } from './DataLibraryPublicSource'

vi.mock('@/api/dataLibrary', () => ({
  dataLibrary: { krakenInstruments: vi.fn(), previewKraken: vi.fn() },
}))
const instruments = {
  sourceId: 'kraken-public',
  instruments: [{ id: 'XXBTZUSD', symbol: 'XBT/USD', base: 'XBT', quote: 'USD', alias: 'XBTUSD' }],
  matched: 1,
  intervals: ['1m', 'D'],
}
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
  scope: 'Recent public spot candles only; no private account or execution.',
}
const preview: DatasetPreview = {
  id: 'review-one',
  expectedRevision: 5,
  status: 'staged',
  sourceObservation: observation,
  preview: { rows: [], counts: { accepted: 2 }, quality: {}, coverage: {}, canCommit: true },
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(dataLibrary.krakenInstruments).mockResolvedValue(instruments)
  vi.mocked(dataLibrary.previewKraken).mockResolvedValue(preview)
})
afterEach(cleanup)
describe('public data in the existing saved-history workflow', () => {
  it('requires an explicit instrument and stages an owned review without a key or account', async () => {
    const received = vi.fn()
    render(<DataLibraryPublicSource principalId="owner-one" revision={5} onPreview={received} />)
    expect(dataLibrary.krakenInstruments).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/API key|Password/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Search public instruments' }))
    const pair = await screen.findByLabelText('Kraken spot instrument')
    expect(screen.getByRole('button', { name: 'Fetch closed candles and review' })).toBeDisabled()
    fireEvent.change(pair, { target: { value: 'XXBTZUSD' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch closed candles and review' }))
    await waitFor(() => expect(received).toHaveBeenCalledWith(preview))
    expect(dataLibrary.previewKraken).toHaveBeenCalledWith(
      { expectedRevision: 5, pair: 'XXBTZUSD', interval: '1m' },
      'owner-one',
      expect.any(AbortSignal)
    )
  })
  it('discards a prior owner instrument result and does not expose it after switching', async () => {
    let resolve!: (value: typeof instruments) => void
    vi.mocked(dataLibrary.krakenInstruments).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    const received = vi.fn()
    const view = render(
      <DataLibraryPublicSource principalId="owner-one" revision={5} onPreview={received} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Search public instruments' }))
    view.rerender(
      <DataLibraryPublicSource principalId="owner-two" revision={1} onPreview={received} />
    )
    await act(async () => resolve(instruments))
    expect(screen.queryByLabelText('Kraken spot instrument')).not.toBeInTheDocument()
    expect(received).not.toHaveBeenCalled()
  })
  it('cannot open a staged preview response under another owner', async () => {
    let resolve!: (value: DatasetPreview) => void
    vi.mocked(dataLibrary.previewKraken).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    const received = vi.fn()
    const view = render(
      <DataLibraryPublicSource principalId="owner-one" revision={5} onPreview={received} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Search public instruments' }))
    fireEvent.change(await screen.findByLabelText('Kraken spot instrument'), {
      target: { value: 'XXBTZUSD' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch closed candles and review' }))
    view.rerender(
      <DataLibraryPublicSource principalId="owner-two" revision={1} onPreview={received} />
    )
    await act(async () => resolve(preview))
    expect(received).not.toHaveBeenCalled()
  })
  it('reports provider failures instead of inventing an available source', async () => {
    vi.mocked(dataLibrary.krakenInstruments).mockRejectedValueOnce(
      new Error('Kraken asked us to wait.')
    )
    render(<DataLibraryPublicSource principalId="owner-one" revision={5} onPreview={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Search public instruments' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Kraken asked us to wait.')
    expect(screen.queryByLabelText('Kraken spot instrument')).not.toBeInTheDocument()
  })
  it('shows actual closed coverage, receipt time and recent-history limitations', () => {
    render(<PublicSourceDetails observation={observation} />)
    expect(screen.getByText(/2 closed candles/)).toBeVisible()
    expect(screen.getByText(/final unfinished candle was excluded/)).toBeVisible()
    expect(screen.getByText(/at most 720 closed candles/)).toBeVisible()
  })
})
