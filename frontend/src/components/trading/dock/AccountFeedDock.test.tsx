import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type FeedAccountSnapshot, MarketDataError, marketData } from '@/api/marketData'
import { fireEvent, render, screen } from '@/test/test-utils'
import { AccountFeedDock } from './AccountFeedDock'

const PROPS = {
  providerId: 'mt5',
  providerName: 'MetaTrader 5',
  principalId: 'principal_one',
  profileScope: { originId: 'fixture_origin', profileId: 1 },
  onTabChange: vi.fn(),
  onPick: vi.fn(),
}

const COVERAGE = {
  queryFrom: '2026-11-02T10:00:00Z',
  queryTo: '2026-11-11T10:00:00Z',
  status: 'read' as const,
  observedCount: 1,
  returnedCount: 1,
}

function snapshot(overrides: Partial<FeedAccountSnapshot> = {}): FeedAccountSnapshot {
  return {
    providerId: 'mt5',
    identity: { externalId: '123', server: 'Fixture', environment: 'broker_demo', currency: 'GBP' },
    account: {
      balance: '10000',
      credit: '0',
      profit: '12',
      equity: '10012',
      margin: '125',
      marginFree: '9887',
      marginLevel: '8009.6',
      leverage: 100,
      currency: 'GBP',
    },
    positions: [
      {
        ticket: '456',
        symbol: { native: 'GBPUSD.pro' },
        side: 'buy',
        volumeLots: '0.1',
        priceOpen: '1.27',
        priceCurrent: '1.28',
        profit: '12',
      },
    ],
    orders: [],
    history: [],
    historyDays: 7,
    historyLoaded: false,
    observedAt: '2026-11-09T10:00:00Z',
    timeBasis: 'provider-epoch-unverified',
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MT5 account dock', () => {
  it('lets slow native reads finish and coalesces a manual and post-order refresh', async () => {
    vi.useFakeTimers()
    let finish: (value: { account: FeedAccountSnapshot }) => void = () => {}
    const request = vi
      .spyOn(marketData, 'account')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue({ account: snapshot() })
    const { rerender, unmount } = render(
      <AccountFeedDock {...PROPS} tab="positions" refreshKey={0} />
    )
    await act(() => vi.advanceTimersByTimeAsync(8_000))
    expect(request).toHaveBeenCalledTimes(1)
    const signal = request.mock.calls[0][3]
    expect(signal?.aborted).toBe(false)
    expect(request.mock.calls[0][5]).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    rerender(<AccountFeedDock {...PROPS} tab="positions" refreshKey={1} />)
    expect(request).toHaveBeenCalledTimes(1)
    await act(async () => finish({ account: snapshot() }))
    const symbol = screen.getByRole('button', { name: 'GBPUSD.pro' })
    fireEvent.click(symbol)
    expect(PROPS.onPick).toHaveBeenCalledWith('GBPUSD.pro')
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(request).toHaveBeenCalledTimes(2)
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('reads deal history on demand and distinguishes an unavailable book from an empty one', async () => {
    const request = vi
      .spyOn(marketData, 'account')
      .mockResolvedValueOnce({ account: snapshot() })
      .mockResolvedValueOnce({
        account: snapshot({ bookErrors: { history: 'connector.history_unavailable' } }),
      })
    const { rerender } = render(<AccountFeedDock {...PROPS} tab="positions" />)
    expect(await screen.findByRole('button', { name: 'GBPUSD.pro' })).toBeInTheDocument()
    expect(request.mock.calls[0][5]).toBe(false)
    rerender(<AccountFeedDock {...PROPS} tab="trades" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Deal history could not be read')
    expect(request.mock.calls[1][5]).toBe(true)
    expect(screen.queryByText(/No deals in the last/)).not.toBeInTheDocument()
  })

  it('shows historical orders separately from deals and preserves exact linked tickets', async () => {
    const orderTicket = '9007199254741011'
    const positionTicket = '9007199254741033'
    vi.spyOn(marketData, 'account').mockResolvedValue({
      account: snapshot({
        historyLoaded: true,
        history: [
          {
            ticket: '9007199254741007',
            type: 1,
            entry: 1,
            order: orderTicket,
            position_id: positionTicket,
            rawProviderTimeMsc: 1794218400000,
            symbol: 'GBPUSD.pro',
            volume: '0.05',
            price: '1.28',
            profit: '12',
            commission: '-0.25',
            swap: '-0.12',
            fee: '-0.04',
          },
        ],
        historicalOrders: [
          {
            ticket: orderTicket,
            symbol: 'GBPUSD.pro',
            type: 2,
            state: 2,
            position_id: positionTicket,
            position_by_id: '0',
            rawProviderSetupTimeMsc: 1794218300000,
            rawProviderDoneTimeMsc: 1794218400000,
            rawProviderTimeMsc: 1794218400000,
            volumeInitialLots: '0.1',
            volumeCurrentLots: '0.05',
            priceOpen: '1.27',
          },
        ],
        historyCoverage: {
          utcAlignmentVerified: false,
          deals: { ...COVERAGE, status: 'limited', observedCount: 3 },
          orders: COVERAGE,
        },
      }),
    })
    render(<AccountFeedDock {...PROPS} tab="trades" />)
    expect(await screen.findByText(orderTicket)).toBeVisible()
    expect(screen.getByText(positionTicket)).toBeVisible()
    expect(screen.getByText('-0.25')).toBeVisible()
    expect(screen.getByText('-0.12')).toBeVisible()
    expect(screen.getByText('-0.04')).toBeVisible()
    expect(screen.getByText(/Showing 1 of 3 terminal rows/)).toBeVisible()
    expect(screen.getByText(/UTC coverage is unverified/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Historical orders' }))
    expect(screen.getByText('Cancelled')).toBeVisible()
    expect(screen.getByText(orderTicket)).toBeVisible()
    expect(screen.queryByText('9007199254741007')).not.toBeInTheDocument()
    expect(screen.queryByText(/Showing 1 of 3 terminal rows/)).not.toBeInTheDocument()
  })

  it('reports a dense order query independently of a valid empty deal query', async () => {
    vi.spyOn(marketData, 'account').mockResolvedValue({
      account: snapshot({
        historyLoaded: true,
        historicalOrders: [],
        historyCoverage: {
          utcAlignmentVerified: false,
          deals: { ...COVERAGE, observedCount: 0, returnedCount: 0 },
          orders: { ...COVERAGE, status: 'unavailable', observedCount: 501, returnedCount: 0 },
        },
        bookErrors: { historicalOrders: 'connector.history_window_too_dense' },
      }),
    })
    render(<AccountFeedDock {...PROPS} tab="trades" />)
    expect(await screen.findByText(/terminal returned no deals/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Historical orders' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Historical orders could not be read')
    expect(screen.getByRole('alert')).toHaveTextContent('lookback exceeds the snapshot limit')
    expect(screen.queryByText(/returned no historical orders/)).not.toBeInTheDocument()
  })

  it('clears account rows after scope changes and rejects stale identity snapshots', async () => {
    const request = vi
      .spyOn(marketData, 'account')
      .mockResolvedValueOnce({ account: snapshot() })
      .mockRejectedValueOnce(
        new MarketDataError('market.account_changed', 'Terminal account changed.', 409)
      )
      .mockResolvedValueOnce({ account: snapshot() })
      .mockImplementation(() => new Promise(() => {}))
    const { rerender } = render(<AccountFeedDock {...PROPS} tab="positions" />)
    expect(await screen.findByRole('button', { name: 'GBPUSD.pro' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Terminal account changed.')
    expect(screen.queryByRole('button', { name: 'GBPUSD.pro' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('button', { name: 'GBPUSD.pro' })).toBeInTheDocument()
    rerender(<AccountFeedDock {...PROPS} tab="positions" principalId="principal_other" />)
    expect(request.mock.calls[3][1]).toBe('principal_other')
    expect(screen.queryByRole('button', { name: 'GBPUSD.pro' })).not.toBeInTheDocument()
  })

  it('clears private rows when the profile changes and sends the new profile scope', async () => {
    const request = vi
      .spyOn(marketData, 'account')
      .mockResolvedValueOnce({ account: snapshot() })
      .mockRejectedValueOnce(new MarketDataError('mt5.profile_binding_required', 'Link MT5.', 409))
    const { rerender } = render(<AccountFeedDock {...PROPS} tab="positions" />)
    expect(await screen.findByRole('button', { name: 'GBPUSD.pro' })).toBeVisible()
    const profileScope = { originId: 'fixture_other_origin', profileId: 2 }
    rerender(<AccountFeedDock {...PROPS} tab="positions" profileScope={profileScope} />)
    expect(screen.queryByRole('button', { name: 'GBPUSD.pro' })).not.toBeInTheDocument()
    expect(request.mock.calls[1][2]).toEqual(profileScope)
    expect(await screen.findByRole('link', { name: 'Connections' })).toHaveAttribute(
      'href',
      '/workspace/profiles/2/connections'
    )
  })
})
