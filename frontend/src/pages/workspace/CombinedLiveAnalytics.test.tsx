import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyTraderTables } from '@/lib/trader/browserSnapshot'
import { COMBINED_SELECTION_KEY, combinedSelectionKey } from '@/lib/trader/combinedSelection'
import type { JournalTrade, TraderPortfolio } from '@/lib/trader/db'
import { useTraderData } from '@/lib/trader/useTraderData'
import CombinedLiveAnalytics from './CombinedLiveAnalytics'

vi.mock('@/lib/trader/useTraderData', () => ({ useTraderData: vi.fn() }))

const profile = (
  id: number,
  name: string,
  currency = 'USD',
  patch: Partial<TraderPortfolio> = {}
): TraderPortfolio => ({
  id,
  name,
  kind: 'live',
  currency,
  startingBalance: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...patch,
})
let portfolios: TraderPortfolio[]
const trade = (
  portfolioId: number,
  pair: string,
  netPnl: number,
  patch: Partial<JournalTrade> = {}
): JournalTrade => ({
  id: portfolioId,
  portfolioId,
  pair,
  netPnl,
  pnl: netPnl,
  result: netPnl > 0 ? 'Win' : 'Loss',
  openDate: '2026-10-01T09:00:00Z',
  closeDate: '2026-10-01T10:00:00Z',
  strategy: `${pair} setup`,
  direction: 'Buy',
  timeframe: '1h',
  lots: 1,
  rr: 2,
  sl: 10,
  tp: 20,
  commission: 2,
  swap: 0,
  fees: 1,
  riskAmount: 50,
  rMultiple: netPnl / 50,
  duration: 60,
  emotionalNotes: '',
  technicalNotes: '',
  otherNotes: '',
  accountId: portfolioId,
  origin: 'manual',
  ...patch,
})
const trades = [
  trade(1, 'ALPHAUSD', 100),
  trade(2, 'BETAUSD', -9000, {
    closeDate: '2026-10-30T15:00:00Z',
    direction: 'Sell',
    lots: 50,
    origin: 'connector',
    commission: 100,
  }),
  trade(3, 'EUROONLY', 777),
  trade(4, 'PAPERONLY', 88888),
  trade(5, 'ARCHIVEDONLY', 99999),
]

function mockData(records = trades) {
  vi.mocked(useTraderData).mockReturnValue({
    loading: false,
    portfolios,
    trades: records,
    destinations: [{ portfolioId: 1 }, { portfolioId: 2 }, { portfolioId: 2 }],
    brokerAccounts: [
      { id: 1, displayName: 'Alpha account' },
      { id: 2, displayName: 'Beta account' },
    ],
  } as unknown as ReturnType<typeof useTraderData>)
}
function mount(records = trades) {
  mockData(records)
  render(
    <MemoryRouter>
      <CombinedLiveAnalytics />
    </MemoryRouter>
  )
  return userEvent.setup()
}
const analysis = () => screen.getByRole('region', { name: 'Selected portfolio analysis' })

beforeEach(() => {
  localStorage.clear()
  portfolios = [
    profile(1, 'Alpha'),
    profile(2, 'Beta'),
    profile(3, 'Euro', 'EUR'),
    profile(4, 'Practice', 'USD', { kind: 'replay' }),
    profile(5, 'Archived', 'USD', { archivedAt: '2026-10-01' }),
  ]
})

describe('combined portfolio selection in the original page', () => {
  it('switches owner and origin without applying a saved filter to colliding profile IDs', async () => {
    mockData()
    const browserData = useTraderData()
    const scope = { principalId: 'alice', originId: 'shared-origin-id' }
    const alphaOnly = JSON.stringify({ version: 1, profileIds: [1], currency: 'USD' })
    localStorage.setItem(COMBINED_SELECTION_KEY, alphaOnly)
    const workspace = {
      originId: scope.originId,
      revision: 1,
      active: true,
      tables: emptyTraderTables(),
    }
    const data = {
      ...browserData,
      storageMode: 'backend' as const,
      principalId: 'alice',
      workspace,
    }
    vi.mocked(useTraderData).mockReturnValue(data)
    const page = () => (
      <MemoryRouter>
        <CombinedLiveAnalytics />
      </MemoryRouter>
    )
    const view = render(page())
    expect(within(analysis()).getAllByText('BETAUSD', { exact: true }).length).toBeGreaterThan(0)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    await user.click(screen.getByRole('button', { name: 'Save selection' }))
    expect(JSON.parse(localStorage.getItem(combinedSelectionKey(scope))!)).toMatchObject({
      profileIds: [],
    })

    vi.mocked(useTraderData).mockReturnValue({ ...data, principalId: 'bob' })
    view.rerender(page())
    expect(within(analysis()).getAllByText('BETAUSD', { exact: true }).length).toBeGreaterThan(0)
    vi.mocked(useTraderData).mockReturnValue(data)
    view.rerender(page())
    expect(
      screen.getByRole('heading', { name: 'No portfolios selected in this currency' })
    ).toBeVisible()
    vi.mocked(useTraderData).mockReturnValue({
      ...data,
      workspace: { ...workspace, originId: 'second-origin' },
    })
    view.rerender(page())
    expect(within(analysis()).getAllByText('BETAUSD', { exact: true }).length).toBeGreaterThan(0)
  })
  it('anchors rolling periods to today and exposes the actual reporting timezone', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-02T12:00:00Z'))
    try {
      const user = mount()
      await user.click(screen.getByRole('button', { name: '1W', exact: true }))
      const results = within(analysis())
      expect(results.queryByText('ALPHAUSD', { exact: true })).not.toBeInTheDocument()
      expect(results.getAllByText('BETAUSD', { exact: true }).length).toBeGreaterThan(0)
      expect(screen.getByText(/2026-10-27 through 2026-11-02/)).toHaveTextContent('UTC')
      expect(screen.queryByRole('option', { name: 'Sort: Score' })).not.toBeInTheDocument()
      expect(results.getByRole('region', { name: 'Analysis coverage' })).toHaveTextContent(
        'complete cashflow-adjusted'
      )
    } finally {
      clock.mockRestore()
    }
  })
  it('includes partial realized cash and fees without labelling an open position completed, and drills into its reporting day', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-02T12:00:00Z'))
    try {
      const user = mount([
        trade(1, 'PARTIALUSD', 999, {
          journalBookId: 'book-partial',
          result: 'Open',
          closeDate: '',
          amounts: { netPnl: '40', quantity: '10' },
          remainingQuantity: '5',
          realizations: [
            { id: 'exit', closedAt: '2026-11-01T00:30:00Z', quantity: '5', netPnl: '50' },
            {
              id: 'fee',
              closedAt: '2026-11-01T01:30:00Z',
              quantity: '0',
              netPnl: '-10',
              kind: 'fee',
            },
          ],
        }),
      ])
      const kpis = within(screen.getByRole('region', { name: 'Combined key metrics' }))
      expect(kpis.getByText('Net P&L').parentElement).toHaveTextContent('+US$40.00')
      expect(kpis.getByText('Net P&L').parentElement).toHaveTextContent(
        '0 completed positions · 1 open · 1 realized exits'
      )
      expect(screen.getByText('Fee adjustments', { exact: true })).toBeInTheDocument()
      const symbolTable = screen
        .getByRole('columnheader', { name: 'Long', exact: true })
        .closest('table')!
      const symbolRow = within(symbolTable).getByRole('row', { name: /PARTIALUSD/ })
      const cells = within(symbolRow).getAllByRole('cell')
      expect(cells[1]).toHaveTextContent(/^1$/)
      expect(cells[2]).toHaveTextContent(/^100%$/)
      expect(cells[3]).toHaveTextContent('+US$50.00')
      await user.selectOptions(screen.getByLabelText('Reporting timezone'), 'America/New_York')
      await user.click(screen.getByRole('button', { name: 'Review day 2026-10-31' }))
      expect(screen.getByText(/Reviewing 2026-10-31/)).toBeInTheDocument()
      expect(kpis.getByText('Net P&L').parentElement).toHaveTextContent('+US$40.00')
      const position = within(analysis())
        .getAllByRole('row', { name: /PARTIALUSD/ })
        .find((row) => within(row).queryByRole('link', { name: 'Alpha', exact: true }))!
      expect(position).toHaveTextContent('+US$40.00')
      expect(position).not.toHaveTextContent('999')
      const target = new URL(
        within(position).getByRole('link', { name: 'Alpha', exact: true }).getAttribute('href')!,
        'http://chartly.local'
      )
      expect(target.searchParams.get('book')).toBe('book-partial')
      expect(target.searchParams.get('trade')).toBe('1')
      expect(target.searchParams.get('timezone')).toBe('America/New_York')
      expect(target.searchParams.get('day')).toBe('2026-10-31')
      expect(screen.getByRole('button', { name: 'Clear day/week filter' })).toBeInTheDocument()
    } finally {
      clock.mockRestore()
    }
  })
  it('keeps explicit quote currencies separate from a profile fallback currency', async () => {
    const user = mount([
      trade(3, 'EUROONLY', 777),
      trade(3, 'QUOTEUSD', 10, { id: 33, currency: 'USD', amounts: { netPnl: '10' } }),
    ])
    await user.selectOptions(screen.getByLabelText('Reporting currency'), 'USD')
    const results = within(analysis())
    expect(results.getAllByText('QUOTEUSD', { exact: true }).length).toBeGreaterThan(0)
    expect(results.queryByText('EUROONLY', { exact: true })).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Combined key metrics' })).getByText('Net P&L')
        .parentElement
    ).toHaveTextContent('+US$10.00')
  })
  it('scopes all result families, KPIs and the equity chart to included portfolios', async () => {
    const user = mount()
    await user.click(screen.getByRole('checkbox', { name: 'Beta', exact: true }))
    const results = within(analysis())
    expect(results.queryByText('Beta', { exact: true })).not.toBeInTheDocument()
    for (const excluded of [
      'BETAUSD',
      'BETAUSD setup',
      'Beta account',
      'EUROONLY',
      'PAPERONLY',
      'ARCHIVEDONLY',
    ]) {
      expect(results.queryByText(excluded, { exact: true })).not.toBeInTheDocument()
    }
    expect(results.getAllByText('ALPHAUSD', { exact: true }).length).toBeGreaterThan(0)
    const kpis = within(screen.getByRole('region', { name: 'Combined key metrics' }))
    expect(kpis.getByText('Net P&L').parentElement).toHaveTextContent('+US$100.00')
    expect(kpis.getByText('Expectancy').parentElement).toHaveTextContent('+US$100.00')
    expect(kpis.getByText('Win rate').parentElement).toHaveTextContent('100.0%')
    expect(kpis.getByText('Max drawdown').parentElement).toHaveTextContent('US$0.00')
    expect(kpis.getByText('Execution costs').parentElement).toHaveTextContent('+US$3.00')
    expect(kpis.getByText('Avg duration').parentElement).toHaveTextContent('1h')
    const chart = results.getByRole('img', { name: 'Combined cumulative profit and loss curve' })
    expect(chart).toHaveTextContent('2026-10-01')
    expect(chart).not.toHaveTextContent('2026-10-30')
    // Excluding Beta must remove its loss/drawdown from the rendered price path too.
    const line = chart.querySelectorAll('polyline')[1]!
    const points = line
      .getAttribute('points')!
      .split(' ')
      .map((point) => point.split(',').map(Number))
    expect(points).toHaveLength(2)
    expect(points[1][1]).toBeLessThan(points[0][1])
    expect(results.getByText('Strategy breakdown')).toBeInTheDocument()
    expect(results.getByText('Symbol by side')).toBeInTheDocument()
    expect(results.getByText('Weekly digest')).toBeInTheDocument()
    expect(results.getByText('Recent combined trades')).toBeInTheDocument()
    expect(results.getByText('By source', { exact: true })).toBeInTheDocument()
    expect(results.getByText('By account', { exact: true })).toBeInTheDocument()
  })

  it('can deselect the last portfolio and clear all currency groups without fallback', async () => {
    const user = mount()
    await user.click(screen.getByRole('checkbox', { name: 'Beta', exact: true }))
    await user.click(screen.getByRole('checkbox', { name: 'Alpha', exact: true }))
    expect(
      screen.queryByRole('region', { name: 'Selected portfolio analysis' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'No portfolios selected in this currency' })
    ).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Reporting currency'), 'EUR')
    expect(screen.getByRole('checkbox', { name: 'Euro', exact: true })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Clear all', exact: true }))
    await user.selectOptions(screen.getByLabelText('Reporting currency'), 'USD')
    expect(screen.getByRole('checkbox', { name: 'Alpha', exact: true })).not.toBeChecked()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('saves an explicit selection and excludes newly created portfolios after remount', async () => {
    const user = mount()
    await user.click(screen.getByRole('checkbox', { name: 'Beta', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Save selection' }))
    expect(screen.getByRole('status')).toHaveTextContent('Selection saved on this device')
    cleanup()
    portfolios.push(profile(6, 'New portfolio'))
    mount()
    expect(screen.getByRole('checkbox', { name: 'Alpha', exact: true })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Beta', exact: true })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'New portfolio', exact: true })).not.toBeChecked()
  })

  it('restores an explicitly saved empty selection', async () => {
    const user = mount()
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    await user.click(screen.getByRole('button', { name: 'Save selection' }))
    cleanup()
    mount()
    expect(screen.getByRole('checkbox', { name: 'Alpha', exact: true })).not.toBeChecked()
    expect(
      screen.queryByRole('region', { name: 'Selected portfolio analysis' })
    ).not.toBeInTheDocument()
  })

  it('keeps the selection when switching currencies and Select all only adds the displayed group', async () => {
    const user = mount()
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    await user.click(screen.getByRole('checkbox', { name: 'Alpha', exact: true }))
    await user.selectOptions(screen.getByLabelText('Reporting currency'), 'EUR')
    expect(screen.getByRole('checkbox', { name: 'Euro', exact: true })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Select all EUR' }))
    expect(within(analysis()).getAllByText('EUROONLY', { exact: true }).length).toBeGreaterThan(0)
    expect(within(analysis()).queryByText('ALPHAUSD', { exact: true })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Reporting currency'), 'USD')
    expect(screen.getByRole('checkbox', { name: 'Alpha', exact: true })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Beta', exact: true })).not.toBeChecked()
  })

  it('explains stale saved IDs without selecting replacement portfolios', () => {
    localStorage.setItem(
      COMBINED_SELECTION_KEY,
      JSON.stringify({ version: 1, profileIds: [5, 999], currency: 'USD' })
    )
    mount()
    expect(screen.getByText(/2 previously selected portfolios are unavailable/)).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Selected portfolio analysis' })
    ).not.toBeInTheDocument()
  })

  it('shows corrupt and failed-storage errors truthfully without discarding current choices', async () => {
    localStorage.setItem(COMBINED_SELECTION_KEY, '{broken')
    const user = mount()
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded')
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    await user.click(screen.getByRole('button', { name: 'Save selection' }))
    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved')
    expect(screen.getByRole('status')).not.toHaveTextContent('Selection saved on this device')
    expect(screen.getByRole('checkbox', { name: 'Alpha', exact: true })).not.toBeChecked()
    spy.mockRestore()
  })
})
