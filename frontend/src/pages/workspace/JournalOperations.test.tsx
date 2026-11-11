import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JournalTrade, TraderPortfolio } from '@/lib/trader/db'
import type { JournalState, StatementPreview } from '@/lib/trader/journalClient'
import { journalDrafts } from '@/lib/trader/journalDrafts'
import type { useTraderData } from '@/lib/trader/useTraderData'
const { client } = vi.hoisted(() => ({
  client: {
    state: vi.fn(),
    previewImport: vi.fn(),
    commitImport: vi.fn(),
    importPreview: vi.fn(),
    repreviewImport: vi.fn(),
    export: vi.fn(),
  },
}))
vi.mock('@/lib/trader/journalClient', () => ({ journalClient: client }))
import JournalOperations, { csvHeaders } from './JournalOperations'

const portfolio = {
  id: 7,
  name: 'Standalone book',
  kind: 'live',
  currency: 'USD',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as TraderPortfolio
const ledger = {
  version: 1,
  events: [],
  observations: [],
  reviews: [],
  history: [],
  periodReviews: [],
  mappings: [],
  batches: [],
  bookLinks: [],
}
const preview: StatementPreview = {
  id: 'preview1',
  expectedRevision: 3,
  preview: {
    context: { bookId: 'book1', portfolioId: 7, provider: 'csv-statement' },
    rows: [
      {
        rowNumber: 2,
        action: 'correction',
        event: { eventId: 'e1', positionId: 'p1', type: 'trade' },
        errors: [],
      },
      { rowNumber: 3, action: 'unchanged', event: { eventId: 'e2' }, errors: [] },
    ],
    counts: { insert: 0, unchanged: 1, correction: 1, conflict: 0, error: 0 },
    totals: { byCurrency: { USD: { netPnl: '25.125' } } },
    canCommit: true,
    requiresCorrectionConfirmation: true,
  },
}
function fixture(
  options: {
    browser?: boolean
    state?: Partial<JournalState>
    trades?: JournalTrade[]
    initialDay?: string
  } = {}
) {
  const scope = { principalId: crypto.randomUUID(), originId: 'fixture-source', bookId: 'book1' }
  const books = [{ id: 'book1', name: 'Selected manual book', kind: 'manual', profileIds: [7] }]
  const data = {
    loading: false,
    storageMode: options.browser ? 'browser' : 'backend',
    readOnly: false,
    workspace: options.browser
      ? undefined
      : { originId: scope.originId, revision: 3, tables: { brokerAccounts: [] } },
    books,
    brokerAccounts: [],
    journalScope: () => scope,
    performJournalAction: vi
      .fn()
      .mockResolvedValue({ workspace: { originId: scope.originId, revision: 4 } }),
    acceptJournalResponse: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useTraderData>
  client.state.mockResolvedValue({
    originId: scope.originId,
    revision: 3,
    books,
    ledger,
    ...options.state,
  })
  client.previewImport.mockResolvedValue(preview)
  client.commitImport.mockResolvedValue({
    workspace: { originId: scope.originId, revision: 4 },
    result: {
      counts: { insert: 0, correction: 1, unchanged: 1 },
      changedEvents: 1,
      changedPositions: 1,
      totals: preview.preview.totals,
      batchId: 'technical-batch-id',
    },
  })
  const onTrade = vi.fn()
  const onBook = vi.fn()
  render(
    <MemoryRouter>
      <JournalOperations
        data={data}
        portfolio={portfolio}
        bookId="book1"
        timezone="UTC"
        currency="USD"
        strategy="All"
        trades={options.trades ?? []}
        filters={{ period: 'all', q: '', review: 'unreviewed' }}
        onBook={onBook}
        onTrade={onTrade}
        initialDay={options.initialDay}
      />
    </MemoryRouter>
  )
  return { user: userEvent.setup(), data, scope, onTrade, onBook }
}
async function uploadCsv(user: ReturnType<typeof userEvent.setup>) {
  const file = new File(['eventId,eventType,netPnl\ne1,trade,25.125'], 'statement.csv', {
    type: 'text/csv',
  })
  Object.defineProperty(file, 'text', {
    value: async () => 'eventId,eventType,netPnl\ne1,trade,25.125',
  })
  await user.upload(screen.getByLabelText('Statement CSV (up to 4 MiB)'), file)
  await waitFor(() => expect(screen.getByText('statement.csv')).toBeInTheDocument())
}
beforeEach(() => vi.clearAllMocks())
describe('explicit statement and review workflows', () => {
  it('parses quoted, escaped and multiline CSV headers without splitting quoted delimiters', () => {
    expect(csvHeaders('\ufeff"Ticket,id","A ""quoted"" header","line\nheader"\r\n1,2,3')).toEqual([
      'Ticket,id',
      'A "quoted" header',
      'line\nheader',
    ])
    expect(csvHeaders('Ticket;Profit\n1;2', ';')).toEqual(['Ticket', 'Profit'])
  })
  it('previews the explicit book and unknown-cost policy, then requires correction consent before committing', async () => {
    const { data, user } = fixture()
    await user.click(screen.getByRole('button', { name: 'Import CSV' }))
    await waitFor(() => expect(screen.getByLabelText('Statement CSV (up to 4 MiB)')).toBeEnabled())
    expect(
      screen.getByLabelText('This statement omits these costs because they are zero')
    ).not.toBeChecked()
    await uploadCsv(user)
    await user.click(screen.getByRole('button', { name: 'Preview rows and totals' }))
    expect(await screen.findByRole('region', { name: 'Statement preview' })).toBeInTheDocument()
    const projected = screen.getByRole('table', { name: 'Projected source totals by currency' })
    expect(within(projected).getByRole('row', { name: /USD 25.125 Unknown/ })).toBeInTheDocument()
    expect(client.previewImport.mock.calls[0][0]).toMatchObject({
      originId: 'fixture-source',
      portfolioId: 7,
      bookId: 'book1',
      expectedRevision: 3,
      mapping: {
        columns: { eventId: 'eventId', eventType: 'eventType', netPnl: 'netPnl' },
        missingCostPolicy: 'unknown',
        timezone: 'UTC',
        currency: 'USD',
      },
    })
    expect(screen.getByRole('button', { name: 'Commit reviewed import' })).toBeDisabled()
    await user.click(screen.getByLabelText(/Accept these source corrections/))
    await user.click(screen.getByRole('button', { name: 'Commit reviewed import' }))
    await waitFor(() => expect(data.acceptJournalResponse).toHaveBeenCalled())
    expect(client.commitImport.mock.calls[0][0]).toBe('preview1')
    expect(client.commitImport.mock.calls[0][1]).toMatchObject({
      expectedRevision: 3,
      acceptCorrections: true,
    })
    expect(await screen.findByRole('button', { name: 'Return to the journal' })).toBeInTheDocument()
    const saved = screen.getByRole('region', { name: 'Import result' })
    expect(
      within(saved).getByText(
        '1 source event saved · 1 position updated · 1 unchanged · 1 correction applied.'
      )
    ).toBeInTheDocument()
    expect(
      within(saved).getByRole('table', { name: 'Saved source totals by currency' })
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Import committed:/)).not.toBeInTheDocument()
    expect(screen.getByText('Technical import receipt').parentElement).not.toHaveAttribute('open')
  })
  it('retains the pending exact import request after a failed acknowledgement and retries the same identity', async () => {
    const { scope, user } = fixture()
    client.commitImport.mockRejectedValueOnce(new Error('Engine disconnected'))
    await user.click(screen.getByRole('button', { name: 'Import CSV' }))
    await waitFor(() => expect(screen.getByLabelText('Statement CSV (up to 4 MiB)')).toBeEnabled())
    await uploadCsv(user)
    await user.click(screen.getByRole('button', { name: 'Preview rows and totals' }))
    await screen.findByRole('region', { name: 'Statement preview' })
    await user.click(screen.getByLabelText(/Accept these source corrections/))
    await user.click(screen.getByRole('button', { name: 'Commit reviewed import' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Engine disconnected')
    const first = client.commitImport.mock.calls[0][1]
    expect(await journalDrafts.get(scope, `request:import:${first.requestId}`)).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Commit reviewed import' }))
    await waitFor(() => expect(client.commitImport).toHaveBeenCalledTimes(2))
    expect(client.commitImport.mock.calls[1][1]).toEqual(first)
  })
  it('recovers a completed server preview after browser cache loss without sending a duplicate commit', async () => {
    const { user, data } = fixture({
      state: {
        imports: [
          {
            id: 'completed-job',
            bookId: 'book1',
            portfolioId: 7,
            createdAt: '2026-01-01',
            expectedRevision: 3,
            status: 'preview',
          },
        ],
      },
    })
    client.importPreview.mockResolvedValue({
      ...preview,
      id: 'completed-job',
      originId: 'fixture-source',
      status: 'completed',
    })
    await user.click(await screen.findByText('Pending statement reviews for this book'))
    await user.click(screen.getByRole('button', { name: 'Resume statement review' }))
    expect(await screen.findByText(/This import already completed/)).toBeInTheDocument()
    expect(data.reload).toHaveBeenCalled()
    expect(client.commitImport).not.toHaveBeenCalled()
  })
  it('keeps source import behind durable storage instead of falling back to browser execution facts', async () => {
    const { user } = fixture({ browser: true })
    await user.click(screen.getByRole('button', { name: 'Import CSV' }))
    expect(screen.getByRole('link', { name: 'reviewed durable local storage' })).toHaveAttribute(
      'href',
      '/settings/storage'
    )
    expect(screen.queryByRole('button', { name: 'Commit reviewed import' })).not.toBeInTheDocument()
    expect(client.previewImport).not.toHaveBeenCalled()
  })
  it('saves a daily review with only its actual included entry IDs, currency and current filter manifest', async () => {
    const rows = [
      {
        id: 1,
        portfolioId: 7,
        openDate: '2026-01-01T08:00:00Z',
        closeDate: '2026-01-01T09:00:00Z',
        currency: 'USD',
        pair: 'EURUSD',
        result: 'Win',
        netPnl: 5,
      },
      {
        id: 2,
        portfolioId: 7,
        openDate: '2026-01-02T08:00:00Z',
        closeDate: '2026-01-02T09:00:00Z',
        currency: 'USD',
        pair: 'GBPUSD',
        result: 'Win',
        netPnl: 10,
      },
      {
        id: 3,
        portfolioId: 7,
        openDate: '2026-01-01T08:00:00Z',
        closeDate: '2026-01-01T09:00:00Z',
        currency: 'EUR',
        pair: 'OTHER',
        result: 'Win',
        netPnl: 100,
      },
    ] as JournalTrade[]
    const { user, data } = fixture({ trades: rows, initialDay: '2026-01-01' })
    await user.click(screen.getByRole('button', { name: 'Daily / weekly review' }))
    await waitFor(() => expect(screen.getByLabelText('Review notes')).toBeEnabled())
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /EURUSD.*#1/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /GBPUSD/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /OTHER/ })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Review notes'), 'Keep risk consistent')
    await user.click(screen.getByRole('button', { name: 'Save period review' }))
    await waitFor(() => expect(data.performJournalAction).toHaveBeenCalled())
    expect(vi.mocked(data.performJournalAction).mock.calls[0][1]).toMatchObject({
      bookId: 'book1',
      portfolioId: 7,
      period: 'day',
      startDate: '2026-01-01',
      timezone: 'UTC',
      currency: 'USD',
      strategy: 'All',
      filters: { period: 'all', q: '', review: 'unreviewed' },
      includedTradeIds: [1],
      notes: 'Keep risk consistent',
    })
  })
})
