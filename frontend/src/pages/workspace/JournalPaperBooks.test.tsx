import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JournalTrade, PracticeSession, TraderPortfolio } from '@/lib/trader/db'
import { useTraderData } from '@/lib/trader/useTraderData'
import TraderJournal from './TraderJournal'

vi.mock('@/lib/trader/useTraderData', () => ({ useTraderData: vi.fn() }))
const profile: TraderPortfolio = {
  id: 3,
  name: 'Historical project',
  kind: 'replay',
  currency: 'USD',
  startingBalance: 99999,
  emotionTrackingEnabled: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}
function run(id: number, name: string, cash: string): PracticeSession {
  return {
    id,
    portfolioId: 3,
    name,
    mode: 'Replay',
    market: 'Stocks',
    symbol: 'EXAMPLE',
    timeframe: '1m',
    dataSource: 'Saved history',
    status: 'Completed',
    startingBalance: 77777,
    currency: 'USD',
    notes: '',
    paper: {
      version: 1,
      revision: 5,
      status: 'finished',
      manifestId: `manifest_${id}`,
      startingCash: cash,
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}
function trade(id: number, runId: number, pnl: number): JournalTrade {
  return {
    id,
    portfolioId: 3,
    sessionId: runId,
    journalBookId: `paper_${runId}`,
    origin: 'simulator',
    openDate: '2026-10-22T09:00:00Z',
    closeDate: '2026-10-22T10:00:00Z',
    currency: 'USD',
    timeframe: '1m',
    pair: `RUN${runId}`,
    strategy: 'Historical paper',
    direction: 'Buy',
    lots: 1,
    result: 'Win',
    rr: 0,
    sl: 0,
    tp: 0,
    pnl,
    netPnl: pnl,
    emotionalNotes: '',
    technicalNotes: '',
    otherNotes: '',
    duration: 60,
  }
}
function mount(book = 'paper_1') {
  render(
    <MemoryRouter initialEntries={[`/workspace/profiles/3/journal?book=${book}`]}>
      <Routes>
        <Route path="/workspace/profiles/:profileId/journal" element={<TraderJournal />} />
      </Routes>
    </MemoryRouter>
  )
  return userEvent.setup()
}
function baselineCard() {
  return screen.getByText('Starting + shown P&L').parentElement!.parentElement!
}
beforeEach(() => {
  vi.mocked(useTraderData).mockReturnValue({
    loading: false,
    portfolios: [profile],
    sessions: [run(1, 'Original hypothesis', '1000'), run(2, 'Earlier branch', '10000')],
    trades: [trade(1, 1, 100), trade(2, 2, 500)],
    moods: [],
    brokerAccounts: [],
    destinations: [],
    terminals: [],
    books: [1, 2].map((id) => ({
      id: `paper_${id}`,
      name: 'Historical project · Paper',
      kind: 'paper',
      profileIds: [3],
      sessionId: id,
    })),
  } as unknown as ReturnType<typeof useTraderData>)
})
afterEach(cleanup)

describe('independent managed paper books in the existing journal', () => {
  it('distinguishes two books by run and uses each canonical cash instead of profile or legacy run balance', async () => {
    const user = mount()
    const select = screen.getByLabelText('Journal book')
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['Original hypothesis · Paper · Run 1', 'Earlier branch · Paper · Run 2'])
    expect(within(baselineCard()).getByText(/\$1,100\.00$/)).toBeInTheDocument()
    expect(within(baselineCard()).getByText(/10\.00%/)).toBeInTheDocument()
    expect(screen.getByText(/Starting cash 1000 USD/)).toBeInTheDocument()
    expect(
      screen.queryByText(/Replay equity uses the project starting balance/)
    ).not.toBeInTheDocument()
    expect(screen.getByText(/^Last /)).toHaveTextContent('$1,100.00')
    let chart = new URL(
      screen.getByRole('link', { name: 'Open chart', exact: true }).getAttribute('href')!,
      'http://chartly.local'
    )
    expect(Object.fromEntries(chart.searchParams)).toMatchObject({
      profileId: '3',
      runId: '1',
      bookId: 'paper_1',
      paper: '1',
      journalReturn: '/workspace/profiles/3/journal?book=paper_1',
    })
    await user.selectOptions(select, 'paper_2')
    expect(within(baselineCard()).getByText(/\$10,500\.00$/)).toBeInTheDocument()
    expect(within(baselineCard()).getByText(/5\.00%/)).toBeInTheDocument()
    expect(screen.getByText(/Starting cash 10000 USD/)).toBeInTheDocument()
    expect(screen.getByText(/^Last /)).toHaveTextContent('$10,500.00')
    chart = new URL(
      screen.getByRole('link', { name: 'Open chart', exact: true }).getAttribute('href')!,
      'http://chartly.local'
    )
    expect(Object.fromEntries(chart.searchParams)).toMatchObject({
      profileId: '3',
      runId: '2',
      bookId: 'paper_2',
      paper: '1',
    })
    expect(
      new URL(chart.searchParams.get('journalReturn')!, 'http://chartly.local').searchParams.get(
        'book'
      )
    ).toBe('paper_2')
    expect(screen.queryByText('$99,999.00')).not.toBeInTheDocument()
    expect(screen.queryByText('$77,777.00')).not.toBeInTheDocument()
  })

  it('keeps an older managed marker without canonical cash unavailable rather than guessing its capital', () => {
    const data = vi.mocked(useTraderData)()
    const sessions = data.sessions.map((session) => ({ ...session, paper: { ...session.paper! } }))
    delete sessions[0].paper.startingCash
    vi.mocked(useTraderData).mockReturnValue({ ...data, sessions })
    mount()
    expect(within(baselineCard()).getByText('—')).toBeInTheDocument()
    expect(screen.getByText(/no project balance substituted/)).toBeInTheDocument()
    expect(
      screen.getByText(/Starting cash is unavailable in this older account summary/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Open its current paper account to inspect the pinned starting cash/)
    ).toBeInTheDocument()
    expect(screen.getByText(/^Last /)).toHaveTextContent(/\+(?:US)?\$100\.00 cumulative/)
  })

  it('retains the original project-baseline behavior for legacy replay books', () => {
    const data = vi.mocked(useTraderData)()
    vi.mocked(useTraderData).mockReturnValue({
      ...data,
      sessions: data.sessions.map(({ paper: _paper, ...session }) => session),
    })
    mount()
    expect(screen.getByText(/Replay equity uses the project starting balance/)).toBeInTheDocument()
    expect(within(baselineCard()).getByText(/\$100,099\.00$/)).toBeInTheDocument()
    expect(screen.queryByText(/Independent paper account:/)).not.toBeInTheDocument()
  })
})
