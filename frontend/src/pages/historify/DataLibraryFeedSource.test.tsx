import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type DatasetPreview, dataLibrary } from '@/api/dataLibrary'
import DataLibraryFeedSource from './DataLibraryFeedSource'
import { PublicSourceDetails } from './DataLibraryPublicSource'

vi.mock('@/api/dataLibrary', () => ({
  dataLibrary: { previewFeed: vi.fn() },
}))

const preview: DatasetPreview = {
  id: 'review-feed',
  expectedRevision: 3,
  status: 'staged',
  preview: { rows: [], counts: { accepted: 119 }, quality: {}, coverage: {}, canCommit: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(dataLibrary.previewFeed).mockResolvedValue(preview)
})
afterEach(cleanup)

describe('exchange and FX feed history card', () => {
  it('shows why MT5 is limited to chart inspection and offers supported imports', () => {
    render(<DataLibraryFeedSource principalId="owner-one" revision={3} onPreview={vi.fn()} />)
    expect(screen.getByLabelText('Feed provider')).toHaveValue('binance')
    expect(screen.getByLabelText('Venue symbol')).toHaveValue('BTCUSDT')
    expect(screen.queryByRole('option', { name: /MetaTrader|OANDA/ })).not.toBeInTheDocument()
    expect(screen.getByText(/MT5 import requires verified UTC alignment/)).toBeVisible()
    expect(screen.queryByLabelText(/API key|Password|Token/)).not.toBeInTheDocument()
  })

  it('preserves case-sensitive Hyperliquid contracts and resets unsupported intervals', async () => {
    const received = vi.fn()
    render(<DataLibraryFeedSource principalId="owner-one" revision={3} onPreview={received} />)
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '4h' } })
    fireEvent.change(screen.getByLabelText('Feed provider'), { target: { value: 'coinbase' } })
    expect(screen.getByLabelText('Interval')).toHaveValue('1h')
    expect(screen.queryByRole('option', { name: '4h' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Feed provider'), { target: { value: 'hyperliquid' } })
    fireEvent.change(screen.getByLabelText('Venue symbol'), { target: { value: ' kBONK ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch & preview history' }))
    await waitFor(() => expect(received).toHaveBeenCalledWith(preview))
    expect(dataLibrary.previewFeed).toHaveBeenCalledWith(
      { expectedRevision: 3, provider: 'hyperliquid', symbol: 'kBONK', interval: '1h', limit: 500 },
      'owner-one',
      expect.any(AbortSignal)
    )
  })

  it('stages a keyless Binance preview with the venue symbol', async () => {
    const received = vi.fn()
    render(<DataLibraryFeedSource principalId="owner-one" revision={3} onPreview={received} />)
    fireEvent.change(screen.getByLabelText('Feed provider'), { target: { value: 'binance' } })
    expect(screen.getByLabelText('Venue symbol')).toHaveValue('BTCUSDT')
    fireEvent.click(screen.getByRole('button', { name: 'Fetch & preview history' }))
    await waitFor(() => expect(received).toHaveBeenCalledWith(preview))
    expect(dataLibrary.previewFeed).toHaveBeenCalledWith(
      { expectedRevision: 3, provider: 'binance', symbol: 'BTCUSDT', interval: '1h', limit: 500 },
      'owner-one',
      expect.any(AbortSignal)
    )
  })

  it('switches to a Dukascopy window with start and end instead of a limit', async () => {
    const received = vi.fn()
    render(<DataLibraryFeedSource principalId="owner-one" revision={3} onPreview={received} />)
    fireEvent.change(screen.getByLabelText('Feed provider'), { target: { value: 'dukascopy' } })
    expect(screen.getByLabelText('Venue symbol')).toHaveValue('EURUSD')
    expect(screen.queryByLabelText('Candles (max 1000)')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Start (UTC)'), {
      target: { value: '2024-01-02T10:00' },
    })
    fireEvent.change(screen.getByLabelText('End (UTC, under 72h)'), {
      target: { value: '2024-01-02T12:00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch & preview history' }))
    await waitFor(() => expect(received).toHaveBeenCalledWith(preview))
    const body = vi.mocked(dataLibrary.previewFeed).mock.calls[0][0]
    expect(body.provider).toBe('dukascopy')
    expect(body.start).toBe('2024-01-02T10:00:00.000Z')
    expect(body.limit).toBeUndefined()
  })

  it('labels saved Binance coverage with its own provider name', () => {
    render(
      <PublicSourceDetails
        observation={{
          provider: 'binance-public',
          receivedAt: '2026-11-04T22:58:56Z',
          nativePair: 'BTCUSDT',
          symbol: 'BTCUSDT',
          interval: '1h',
          returnedFirst: 1793401200,
          returnedLast: 1793826000,
          closedRows: 119,
          excludedUnfinished: 1,
          maxEntries: 1000,
          scope: 'Recent public spot candles only.',
        }}
      />
    )
    expect(screen.getByText('Binance public spot history')).toBeVisible()
    expect(screen.getByText(/119 closed candles/)).toBeVisible()
  })
})
