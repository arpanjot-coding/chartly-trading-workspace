import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useParams, useSearchParams } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChartProfileNavigation } from '@/components/trading/ChartProfileNavigation'
import type { JournalTrade, TraderPortfolio } from '@/lib/trader/db'
import { useTraderData } from '@/lib/trader/useTraderData'
import * as journalCsv from './journalCsv'
import * as journalForm from './journalForm'
import { ProfileHeader } from './ProfileShell'
import TraderJournal from './TraderJournal'

vi.mock('@/lib/trader/useTraderData', () => ({ useTraderData: vi.fn() }))

const portfolios: TraderPortfolio[] = [
  {
    id: 7,
    name: 'London',
    kind: 'live',
    currency: 'USD',
    startingBalance: 0,
    emotionTrackingEnabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 8,
    name: 'Gold Paper',
    kind: 'replay',
    currency: 'USD',
    startingBalance: 10000,
    emotionTrackingEnabled: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]
const trade: JournalTrade = {
  id: 11,
  portfolioId: 7,
  openDate: '2026-10-22T09:00:00Z',
  closeDate: '2026-10-22T10:00:00Z',
  timeframe: '15m',
  pair: 'EURUSD',
  strategy: 'Breakout',
  direction: 'Buy',
  lots: 1,
  result: 'Win',
  rr: 2,
  sl: 10,
  tp: 20,
  pnl: 100,
  netPnl: 100,
  emotionalNotes: '',
  technicalNotes: 'London review',
  otherNotes: '',
  duration: 60,
}

function Chart() {
  const [params] = useSearchParams()
  return <ChartProfileNavigation params={params} />
}
function Management() {
  const { profileId } = useParams()
  return (
    <ProfileHeader
      portfolio={portfolios.find((p) => p.id === Number(profileId))!}
      active="overview"
    />
  )
}
function mount(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/workspace/profiles/:profileId/journal" element={<TraderJournal />} />
        <Route path="/workspace/profiles/:profileId" element={<Management />} />
        <Route path="/trading" element={<Chart />} />
        <Route
          path="/workspace"
          element={
            <>
              <h1>Workspace</h1>
              <Link to="/workspace/profiles/8/journal">Other journal</Link>
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
  return userEvent.setup()
}

beforeEach(() => {
  vi.mocked(useTraderData).mockReturnValue({
    loading: false,
    portfolios,
    trades: [
      trade,
      { ...trade, id: 12, portfolioId: 8, pair: 'XAUUSD', technicalNotes: 'Paper review' },
    ],
    sessions: [],
    moods: [],
    brokerAccounts: [],
    destinations: [],
    terminals: [],
  } as unknown as ReturnType<typeof useTraderData>)
})
afterEach(() => vi.useRealTimers())

describe('focused original journal navigation', () => {
  it('renders 50 positions at a time, exports all matching rows, and resets when filters change', async () => {
    const original = vi.mocked(useTraderData)()
    const trades = Array.from({ length: 102 }, (_, index) => ({
      ...trade,
      id: index + 1,
      pair: index === 0 ? 'FIRSTONLY' : `PAIR${index + 1}`,
    }))
    vi.mocked(useTraderData).mockReturnValue({ ...original, trades })
    const exportRows = vi.spyOn(journalCsv, 'filteredJournalCsv')
    const download = vi.spyOn(journalForm, 'downloadJournalFile').mockImplementation(() => {})
    const user = mount('/workspace/profiles/7/journal?tab=Trades')
    const table = screen.getByRole('table', { name: 'Trade log' })
    const pages = screen.getByRole('navigation', { name: 'Trade log pages' })
    expect(within(table).getAllByRole('row')).toHaveLength(51)
    expect(within(pages).getByRole('status')).toHaveTextContent('Positions 1–50 of 102')
    expect(within(pages).getByRole('button', { name: 'Previous trade page' })).toBeDisabled()
    expect(within(table).getByText('PAIR102')).toBeInTheDocument()
    expect(within(table).queryByText('FIRSTONLY')).not.toBeInTheDocument()

    await user.click(within(pages).getByRole('button', { name: 'Next trade page' }))
    expect(within(pages).getByRole('status')).toHaveTextContent('Positions 51–100 of 102')
    await user.keyboard('{Enter}')
    expect(within(pages).getByRole('status')).toHaveTextContent('Positions 101–102 of 102')
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(pages).getByRole('button', { name: 'Next trade page' })).toBeDisabled()
    expect(within(table).getByText('FIRSTONLY')).toBeInTheDocument()

    try {
      await user.click(screen.getByRole('button', { name: 'Export CSV' }))
      expect(exportRows.mock.calls[0][0]).toHaveLength(102)
    } finally {
      exportRows.mockRestore()
      download.mockRestore()
    }
    await user.type(screen.getByRole('textbox', { name: 'Search trades' }), 'PAIR102')
    expect(within(table).getByText('PAIR102')).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(pages).not.toBeInTheDocument()
  })

  it('opens a trade deep link on its actual page and carries that page through the chart return', () => {
    const original = vi.mocked(useTraderData)()
    vi.mocked(useTraderData).mockReturnValue({
      ...original,
      trades: Array.from({ length: 53 }, (_, index) => ({
        ...trade,
        id: index + 1,
        pair: `PAIR${index + 1}`,
      })),
    })
    mount('/workspace/profiles/7/journal?tab=Trades&page=2&trade=1')
    const pages = screen.getByRole('navigation', { name: 'Trade log pages' })
    expect(within(pages).getByRole('status')).toHaveTextContent('Positions 51–53 of 53')
    expect(screen.getByText('PAIR1')).toBeInTheDocument()
    const chart = screen.getByRole('link', { name: 'Open trade chart' })
    const url = new URL(chart.getAttribute('href')!, 'http://chartly.local')
    expect(url.searchParams.get('journalReturn')).toBe(
      '/workspace/profiles/7/journal?tab=Trades&page=2&trade=1'
    )
  })

  it('opens a trade from its latest saved evidence after the profile default source changes', () => {
    const original = vi.mocked(useTraderData)()
    const evidence = {
      id: 'saved-view',
      attachmentId: 'saved-image',
      imageSha256: 'a'.repeat(64),
      capturedAt: '2026-11-03T09:00:00Z',
      source: {
        kind: 'dataset' as const,
        datasetVersionId: 'original-source',
        checksum: 'b'.repeat(64),
      },
      instrument: { symbol: 'EURUSD', exchange: 'LOCAL' },
      view: {
        interval: '15m',
        chartType: 'candlestick',
        timezone: 'UTC',
        visibleFrom: 100,
        visibleTo: 200,
        replayAsOf: 150,
      },
      annotations: '',
    }
    vi.mocked(useTraderData).mockReturnValue({
      ...original,
      portfolios: original.portfolios.map((profile) =>
        profile.id === 7
          ? {
              ...profile,
              chartSource: {
                kind: 'dataset',
                versionId: 'changed-default',
                checksum: 'c'.repeat(64),
              },
            }
          : profile
      ),
      trades: [{ ...trade, chartEvidence: [evidence] }],
    } as ReturnType<typeof useTraderData>)
    mount('/workspace/profiles/7/journal?tab=Trades&trade=11&q=EURUSD')
    const link = screen.getByRole('link', { name: 'Open trade chart' })
    const query = new URL(link.getAttribute('href')!, 'http://chartly.local').searchParams
    expect(Object.fromEntries(query)).toMatchObject({
      profileId: '7',
      tradeId: '11',
      evidenceId: 'saved-view',
      journalReturn: '/workspace/profiles/7/journal?tab=Trades&q=EURUSD&trade=11',
    })
    expect(query.has('datasetVersionId')).toBe(false)
    expect(link.getAttribute('href')).not.toContain('changed-default')
  })
  it('shows a newly captured Open position immediately after a reload later than the mounted reporting clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T10:00:00Z'))
    const original = vi.mocked(useTraderData)()
    vi.mocked(useTraderData).mockReturnValue({ ...original, trades: [] })
    const tree = (
      <MemoryRouter initialEntries={['/workspace/profiles/7/journal?tab=Trades']}>
        <Routes>
          <Route path="/workspace/profiles/:profileId/journal" element={<TraderJournal />} />
        </Routes>
      </MemoryRouter>
    )
    const { rerender } = render(tree)
    expect(screen.queryByText('P03TEST')).not.toBeInTheDocument()
    vi.setSystemTime(new Date('2026-11-02T10:00:05Z'))
    vi.mocked(useTraderData).mockReturnValue({
      ...original,
      trades: [
        {
          ...trade,
          id: 15,
          pair: 'P03TEST',
          openDate: '2026-11-02T10:00:05Z',
          closeDate: '',
          result: 'Open',
          amounts: { netPnl: null, quantity: '10' },
          quantityUnit: 'units',
        },
      ],
    })
    rerender(
      <MemoryRouter initialEntries={['/workspace/profiles/7/journal?tab=Trades']}>
        <Routes>
          <Route path="/workspace/profiles/:profileId/journal" element={<TraderJournal />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('P03TEST')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByText(
          'Showing 1 positions in the displayed book and filters. Realized-exit samples are counted separately from position rows.'
        )
      ).toBeInTheDocument()
    )
  })
  it('isolates books within one profile and keeps the selected book on chart return', async () => {
    const original = vi.mocked(useTraderData)()
    vi.mocked(useTraderData).mockReturnValue({
      ...original,
      books: [
        { id: 'book_manual', name: 'Manual book', kind: 'manual', profileIds: [7] },
        { id: 'book_connected', name: 'Account book', kind: 'connected', profileIds: [7] },
      ],
      bookAssignments: { 'journalTrades:11': 'book_manual', 'journalTrades:13': 'book_connected' },
      trades: [
        trade,
        { ...trade, id: 13, pair: 'BTCUSD', technicalNotes: 'Connected review', netPnl: -500 },
      ],
    } as ReturnType<typeof useTraderData>)
    const user = mount('/workspace/profiles/7/journal?tab=Trades&book=book_connected&trade=13')
    expect(screen.getByLabelText('Journal book')).toHaveValue('book_connected')
    expect(screen.getByText('Connected review')).toBeInTheDocument()
    expect(screen.queryByText('EURUSD')).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Open chart' }))
    await user.click(screen.getByRole('link', { name: 'Back to London journal' }))
    expect(screen.getByLabelText('Journal book')).toHaveValue('book_connected')
    await user.click(screen.getByRole('button', { name: 'Open manual book to log a trade' }))
    expect(screen.getByLabelText('Journal book')).toHaveValue('book_manual')
    expect(screen.getByText('EURUSD')).toBeInTheDocument()
    expect(screen.queryByText('BTCUSD')).not.toBeInTheDocument()
  })
  it('keeps journal tabs while removing portfolio management navigation', () => {
    mount('/workspace/profiles/7/journal')
    expect(screen.queryByRole('navigation', { name: 'Profile sections' })).not.toBeInTheDocument()
    const tabs = within(screen.getByRole('navigation', { name: 'Journal sections' }))
    expect(tabs.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Overview',
      'Trades',
      'Calendar',
      'Breakdown',
      'Mind',
    ])
    expect(screen.getByRole('link', { name: 'Portfolio details' })).toHaveAttribute(
      'href',
      expect.stringContaining('/workspace/profiles/7?journalReturn=')
    )
  })

  it('returns from the chart to the same trade, tab and filters', async () => {
    const user = mount(
      '/workspace/profiles/7/journal?tab=Trades&period=1m&strategy=Breakout&q=EURUSD&result=Win&direction=Buy&sort=pnlDesc&trade=11'
    )
    expect(screen.getByText('London review')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Open chart' }))
    await user.click(screen.getByRole('link', { name: 'Back to London journal' }))
    expect(screen.getByRole('button', { name: 'Trades', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: '1M', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByLabelText('Search trades')).toHaveValue('EURUSD')
    expect(screen.getByLabelText('Filter by result')).toHaveValue('Win')
    expect(screen.getByLabelText('Filter by direction')).toHaveValue('Buy')
    expect(screen.getByLabelText('Sort trades')).toHaveValue('pnlDesc')
    expect(screen.getByText('London review')).toBeInTheDocument()
    expect(screen.queryByText('Paper review')).not.toBeInTheDocument()
  })

  it('returns from portfolio details to the same journal view', async () => {
    const user = mount('/workspace/profiles/7/journal?tab=Breakdown&period=1w')
    await user.click(screen.getByRole('link', { name: 'Portfolio details' }))
    expect(
      within(screen.getByRole('navigation', { name: 'Profile sections' }))
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(['Overview', 'Connections', 'Settings'])
    await user.click(screen.getByRole('link', { name: 'Journal', exact: true }))
    expect(screen.getByRole('button', { name: 'Breakdown', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: '1W', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('keeps replay runs accessible outside the management tab bar', async () => {
    const user = mount('/workspace/profiles/8')
    expect(
      within(screen.getByRole('navigation', { name: 'Profile sections' }))
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(['Overview', 'Connections', 'Settings'])
    expect(screen.getByRole('link', { name: 'Runs', exact: true })).toHaveAttribute(
      'href',
      '/workspace/profiles/8/replay'
    )
    await user.click(screen.getByRole('link', { name: 'Journal', exact: true }))
    expect(screen.queryByRole('button', { name: 'Mind', exact: true })).not.toBeInTheDocument()
  })

  it('opens a portfolio chart’s own journal without leaking another book’s view', async () => {
    const user = mount(
      '/trading?profileId=8&profileName=Gold+Paper&journalReturn=%2Fworkspace%2Fprofiles%2F7%2Fjournal%3Ftab%3DTrades'
    )
    await user.click(screen.getByRole('link', { name: 'Open Gold Paper journal' }))
    expect(screen.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await user.click(screen.getByRole('button', { name: 'Trades', exact: true }))
    expect(screen.getByText('XAUUSD')).toBeInTheDocument()
    expect(screen.queryByText('EURUSD')).not.toBeInTheDocument()
  })

  it('restores calendar selection through the chart and resets at another book’s direct link', async () => {
    const user = mount('/workspace/profiles/7/journal?tab=Calendar&month=2026-10&day=2026-10-22')
    await user.click(screen.getByRole('link', { name: 'Open chart' }))
    await user.click(screen.getByRole('link', { name: 'Back to London journal' }))
    expect(screen.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByText('October 2026')).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('navigation', { name: 'Journal workspace' })).getByRole('link', {
        name: 'Workspace',
        exact: true,
      })
    )
    await user.click(screen.getByRole('link', { name: 'Other journal' }))
    expect(screen.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })
})
