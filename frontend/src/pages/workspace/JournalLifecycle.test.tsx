import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JournalTrade, TraderPortfolio } from '@/lib/trader/db'
import { journalDrafts } from '@/lib/trader/journalDrafts'
import type { useTraderData } from '@/lib/trader/useTraderData'
import JournalTradeEditor from './JournalTradeEditor'

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }))
vi.mock('@/lib/trader/journalClient', () => ({ journalClient: { uploadAttachment: upload } }))
const portfolio: TraderPortfolio = {
  id: 7,
  name: 'Journal fixture',
  kind: 'live',
  currency: 'USD',
  startingBalance: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}
const trade: JournalTrade = {
  id: 21,
  portfolioId: 7,
  pair: 'EURUSD',
  direction: 'Buy',
  strategy: 'Manual',
  origin: 'manual',
  openDate: '2026-01-01T09:00:00Z',
  closeDate: '',
  result: 'Open',
  lots: 10,
  netPnl: 0,
  pnl: 0,
  timeframe: '1h',
  rr: 0,
  sl: 0,
  tp: 0,
  duration: 0,
  technicalNotes: 'original notes',
  otherNotes: '',
  emotionalNotes: '',
  amounts: { quantity: '10', netPnl: null, riskAmount: null },
  remainingQuantity: '10',
}
function fixture(
  row?: JournalTrade,
  mode: 'create' | 'review' | 'close' | 'partial' | 'edit' = 'review'
) {
  const scope = {
    principalId: crypto.randomUUID(),
    originId: 'fixture-source',
    bookId: 'book-fixture',
  }
  const data = {
    storageMode: 'backend',
    readOnly: false,
    workspace: { originId: scope.originId, revision: 3 },
    journalScope: () => scope,
    tradeDetail: vi
      .fn()
      .mockResolvedValue({ trade: row ?? trade, history: [], executions: [], observations: [] }),
    createTrade: vi.fn().mockResolvedValue(99),
    updateTrade: vi.fn().mockResolvedValue(undefined),
    reviewTrade: vi.fn().mockResolvedValue(undefined),
    performJournalAction: vi
      .fn()
      .mockResolvedValue({ workspace: { originId: scope.originId, revision: 4 } }),
    acceptJournalResponse: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useTraderData>
  const close = vi.fn()
  render(
    <MemoryRouter>
      <JournalTradeEditor
        data={data}
        portfolio={portfolio}
        bookId={scope.bookId}
        trade={row}
        mode={mode}
        timezone="UTC"
        emotionEnabled={false}
        chartLink="/trading?profileId=7"
        onClose={close}
      />
    </MemoryRouter>
  )
  return { data, scope, close, user: userEvent.setup() }
}
beforeEach(() => vi.clearAllMocks())
describe('original journal professional lifecycle', () => {
  it('creates an open trade without fabricating close time, profit, quantity or risk', async () => {
    const { data, user, close } = fixture(undefined, 'create')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save trade', exact: true })).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Save trade', exact: true }))
    await waitFor(() => expect(data.createTrade).toHaveBeenCalled())
    expect(vi.mocked(data.createTrade).mock.calls[0][0]).toMatchObject({
      result: 'Open',
      closeDate: '',
      amounts: { netPnl: null, quantity: null, riskAmount: null },
      emotionalNotes: '',
    })
    await waitFor(() => expect(close).toHaveBeenCalled())
  })
  it('requires an explicit closed profit value and preserves the form after validation failure', async () => {
    const { data, user } = fixture(undefined, 'create')
    await waitFor(() => expect(screen.getByLabelText('Position status')).toBeEnabled())
    await user.selectOptions(screen.getByLabelText('Position status'), 'Closed')
    fireEvent.change(screen.getByLabelText('Opened'), { target: { value: '2026-01-01T09:00' } })
    fireEvent.change(screen.getByLabelText('Closed'), { target: { value: '2026-01-01T10:00' } })
    await user.type(screen.getByLabelText('Technical / decision notes'), 'keep this review')
    await user.click(screen.getByRole('button', { name: 'Save trade', exact: true }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter known net P&L')
    expect(data.createTrade).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Technical / decision notes')).toHaveValue('keep this review')
    await user.type(screen.getByLabelText('Net P&L'), '0')
    await user.click(screen.getByRole('button', { name: 'Save trade', exact: true }))
    await waitFor(() => expect(data.createTrade).toHaveBeenCalled())
    expect(vi.mocked(data.createTrade).mock.calls[0][0]).toMatchObject({
      result: 'Break Even',
      amounts: { netPnl: '0', riskAmount: null },
    })
  })
  it('keeps imported financial facts read-only while allowing a review', async () => {
    const imported = { ...trade, origin: 'imported' as const, technicalNotes: 'source review' }
    const { data, user } = fixture(imported)
    expect(screen.queryByRole('button', { name: 'Edit', exact: true })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Symbol')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Technical / decision notes')).toBeEnabled())
    await user.clear(screen.getByLabelText('Technical / decision notes'))
    await user.type(screen.getByLabelText('Technical / decision notes'), 'my independent review')
    await user.click(screen.getByLabelText('Mark reviewed'))
    await user.click(screen.getByRole('button', { name: 'Save review', exact: true }))
    await waitFor(() => expect(data.reviewTrade).toHaveBeenCalled())
    expect(vi.mocked(data.reviewTrade).mock.calls[0][1]).toMatchObject({
      technicalNotes: 'my independent review',
      reviewStatus: 'reviewed',
    })
    expect(data.updateTrade).not.toHaveBeenCalled()
  })
  it('sends final-total close profit separately from an earlier partial exit', async () => {
    const partial = {
      ...trade,
      remainingQuantity: '6',
      realizations: [
        { id: 'earlier-exit', closedAt: '2026-01-01T10:00:00Z', quantity: '4', netPnl: '10' },
      ],
    }
    const { data, user } = fixture(partial, 'close')
    await waitFor(() =>
      expect(screen.getByLabelText('Final total net P&L (including earlier exits)')).toBeEnabled()
    )
    expect(screen.getByLabelText('Quantity / size')).toBeDisabled()
    await user.type(screen.getByLabelText('Final total net P&L (including earlier exits)'), '15.50')
    // The footer action is distinct from the mode selector by submit type.
    const submit = screen
      .getAllByRole('button', { name: 'Close trade', exact: true })
      .find((button) => button.getAttribute('type') === 'submit')!
    await user.click(submit)
    await waitFor(() => expect(data.updateTrade).toHaveBeenCalled())
    expect(vi.mocked(data.updateTrade).mock.calls[0][1].amounts?.netPnl).toBe('15.5')
    expect(vi.mocked(data.updateTrade).mock.calls[0][2]).toMatchObject({
      close: true,
      expectedRevision: 3,
    })
  })
  it('records only the current partial exit and leaves remaining-position accounting to the service', async () => {
    const { data, user } = fixture(trade, 'partial')
    await waitFor(() => expect(screen.getByLabelText('This exit’s quantity')).toBeEnabled())
    await user.type(screen.getByLabelText('This exit’s quantity'), '2')
    await user.type(screen.getByLabelText('This exit’s net P&L'), '5.25')
    await user.click(screen.getByRole('button', { name: 'Record partial exit' }))
    await waitFor(() => expect(data.performJournalAction).toHaveBeenCalled())
    expect(vi.mocked(data.performJournalAction).mock.calls[0][0]).toBe('partial-close-trade')
    expect(vi.mocked(data.performJournalAction).mock.calls[0][1]).toMatchObject({
      tradeId: 21,
      quantity: '2',
      netPnl: '5.25',
    })
  })
  it('retains failed review fields and the same request identity for retry', async () => {
    const { data, user, scope, close } = fixture(trade)
    vi.mocked(data.reviewTrade).mockRejectedValueOnce(new Error('Local engine offline'))
    await waitFor(() => expect(screen.getByLabelText('Technical / decision notes')).toBeEnabled())
    await user.clear(screen.getByLabelText('Technical / decision notes'))
    await user.type(screen.getByLabelText('Technical / decision notes'), 'unsent decision')
    await user.click(screen.getByRole('button', { name: 'Save review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Local engine offline')
    expect(close).not.toHaveBeenCalled()
    const saved = await journalDrafts.get<{ technicalNotes: string; requestId: string }>(
      scope,
      'trade:21'
    )
    expect(saved?.value.technicalNotes).toBe('unsent decision')
    const id = vi.mocked(data.reviewTrade).mock.calls[0][2]?.requestId
    await user.click(screen.getByRole('button', { name: 'Save review' }))
    await waitFor(() => expect(data.reviewTrade).toHaveBeenCalledTimes(2))
    expect(vi.mocked(data.reviewTrade).mock.calls[1][2]?.requestId).toBe(id)
  })
  it('requires a correction reason for closed manual totals and preserves final-total semantics', async () => {
    const closed = {
      ...trade,
      result: 'Win' as const,
      closeDate: '2026-01-01T10:00:00Z',
      netPnl: 12,
      amounts: { ...trade.amounts, netPnl: '12' },
      realizations: [
        { id: 'exit1', closedAt: '2026-01-01T10:00:00Z', quantity: '10', netPnl: '12' },
      ],
    }
    const { data, user } = fixture(closed, 'edit')
    await waitFor(() => expect(screen.getByLabelText('Net P&L')).toBeEnabled())
    await user.clear(screen.getByLabelText('Net P&L'))
    await user.type(screen.getByLabelText('Net P&L'), '13.1')
    await user.click(screen.getByRole('button', { name: 'Save trade' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a reason')
    expect(data.updateTrade).not.toHaveBeenCalled()
    await user.type(
      screen.getByLabelText('Reason for changing manual facts'),
      'Corrected statement value'
    )
    await user.click(screen.getByRole('button', { name: 'Save trade' }))
    await waitFor(() => expect(data.updateTrade).toHaveBeenCalled())
    expect(vi.mocked(data.updateTrade).mock.calls[0][1].amounts?.netPnl).toBe('13.1')
    expect(vi.mocked(data.updateTrade).mock.calls[0][2]).toMatchObject({
      reason: 'Corrected statement value',
      expectedRevision: 3,
    })
  })
  it('corrects one manual partial exit with a reason and explicit status-change consent', async () => {
    const partial = {
      ...trade,
      remainingQuantity: '6',
      netPnl: 5,
      amounts: { ...trade.amounts, netPnl: '5' },
      realizations: [{ id: 'exit1', closedAt: '2026-01-01T10:00:00Z', quantity: '4', netPnl: '5' }],
    }
    const { data, user } = fixture(partial)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Correct exit' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Correct exit' }))
    await user.selectOptions(screen.getByLabelText('Manual exit to correct'), 'exit1')
    await user.clear(screen.getByLabelText('This exit’s net P&L'))
    await user.type(screen.getByLabelText('This exit’s net P&L'), '6.25')
    await user.type(
      screen.getByLabelText('Reason for changing manual facts'),
      'Transcription correction'
    )
    await user.click(screen.getByRole('button', { name: 'Save exit correction' }))
    await waitFor(() => expect(data.performJournalAction).toHaveBeenCalled())
    expect(vi.mocked(data.performJournalAction).mock.calls[0][0]).toBe('correct-realization')
    expect(vi.mocked(data.performJournalAction).mock.calls[0][1]).toMatchObject({
      tradeId: 21,
      realizationId: 'exit1',
      reason: 'Transcription correction',
      confirmStatusChange: false,
      patch: { quantity: '4', netPnl: '6.25' },
    })
  })
  it('keeps realized amounts read-only while editing an open partially realized entry', async () => {
    const partial = {
      ...trade,
      remainingQuantity: '6',
      netPnl: 5,
      amounts: { ...trade.amounts, netPnl: '5', commission: null },
      realizations: [{ id: 'exit1', closedAt: '2026-01-01T10:00:00Z', quantity: '4', netPnl: '5' }],
    }
    const { data, user } = fixture(partial, 'edit')
    await waitFor(() =>
      expect(screen.getByLabelText('Reason for changing manual facts')).toBeEnabled()
    )
    expect(screen.getByLabelText('Net P&L')).toBeDisabled()
    expect(screen.getByLabelText('Commission expense')).toBeDisabled()
    await user.type(
      screen.getByLabelText('Reason for changing manual facts'),
      'Fixed entry quantity'
    )
    await user.click(screen.getByRole('button', { name: 'Save trade' }))
    await waitFor(() => expect(data.updateTrade).toHaveBeenCalled())
    expect(vi.mocked(data.updateTrade).mock.calls[0][1]).toMatchObject({
      result: 'Open',
      closeDate: '',
      amounts: { netPnl: '5', commission: null },
    })
  })
  it('preserves the original microsecond entry instant when closing and changes the display timezone without moving it', async () => {
    const precise = {
      ...trade,
      openDate: '2026-07-01T09:00:32.123456Z',
      quantityUnit: 'shares',
      currency: 'USDT',
    }
    const { data, user } = fixture(precise, 'close')
    await waitFor(() => expect(screen.getByLabelText('Input timezone')).toBeEnabled())
    await user.selectOptions(screen.getByLabelText('Input timezone'), 'Europe/London')
    expect(screen.getByLabelText('Opened')).toHaveValue('2026-07-01T10:00:32.123')
    expect(screen.getByLabelText('Size unit')).toHaveValue('shares')
    expect(screen.getByLabelText('Size unit')).toBeDisabled()
    await user.type(screen.getByLabelText('Final total net P&L (including earlier exits)'), '7')
    await user.click(
      screen
        .getAllByRole('button', { name: 'Close trade', exact: true })
        .find((button) => button.getAttribute('type') === 'submit')!
    )
    await waitFor(() => expect(data.updateTrade).toHaveBeenCalled())
    expect(vi.mocked(data.updateTrade).mock.calls[0][1]).toMatchObject({
      openDate: '2026-07-01T09:00:32.123456Z',
      quantityUnit: 'shares',
      currency: 'USDT',
    })
  })
  it('retains screenshot bytes and the original attachment request after a failed upload', async () => {
    const { data, user, scope } = fixture(trade)
    upload
      .mockRejectedValueOnce(new Error('Asset worker disconnected'))
      .mockResolvedValue({ workspace: { originId: 'fixture-source', revision: 4 } })
    await waitFor(() =>
      expect(
        screen.getByLabelText('Attach PNG, JPEG, WebP, GIF or PDF (up to 8 MiB)')
      ).toBeEnabled()
    )
    await user.upload(
      screen.getByLabelText('Attach PNG, JPEG, WebP, GIF or PDF (up to 8 MiB)'),
      new File(['fixture image bytes'], 'evidence.png', { type: 'image/png' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Asset worker disconnected')
    const saved = await journalDrafts.get(scope, 'attachment:21')
    expect(saved?.value).toMatchObject({
      tradeId: 21,
      mimeType: 'image/png',
      expectedRevision: 3,
      base64: expect.any(String),
    })
    await user.click(screen.getByRole('button', { name: 'Retry retained attachment' }))
    await waitFor(() => expect(data.acceptJournalResponse).toHaveBeenCalled())
    expect(upload.mock.calls[1][0]).toEqual(upload.mock.calls[0][0])
    await waitFor(async () =>
      expect(await journalDrafts.get(scope, 'attachment:21')).toBeUndefined()
    )
  })
  it('converts an old expense-style swap into signed cashflow when editing a legacy manual record', async () => {
    const legacy = {
      ...trade,
      result: 'Win' as const,
      closeDate: '2026-01-01T10:00:00Z',
      amounts: undefined,
      grossPnl: 10,
      commission: 1,
      fees: 1,
      swap: 2,
      netPnl: 6,
    }
    const { data, user } = fixture(legacy, 'edit')
    await waitFor(() =>
      expect(screen.getByLabelText('Reason for changing manual facts')).toBeEnabled()
    )
    expect(screen.getByLabelText('Swap cashflow (+ credit / − charge)')).toHaveValue('-2')
    await user.type(
      screen.getByLabelText('Reason for changing manual facts'),
      'Preserve recorded accounting'
    )
    await user.click(screen.getByRole('button', { name: 'Save trade' }))
    await waitFor(() => expect(data.updateTrade).toHaveBeenCalled())
    expect(vi.mocked(data.updateTrade).mock.calls[0][1].amounts).toMatchObject({
      netPnl: '6',
      grossPnl: '10',
      commission: '1',
      fees: '1',
      swap: '-2',
    })
  })
  it('offers partial exit for a migrated known-quantity Open record without a derived remainingQuantity', async () => {
    const migrated = {
      ...trade,
      remainingQuantity: undefined,
      rating: null,
    } as unknown as JournalTrade
    const { user, data } = fixture(migrated)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Partial exit' })).toBeEnabled())
    expect(screen.getByLabelText('Optional rating (1–5)')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Partial exit' }))
    expect(screen.getByText(/Remaining quantity: 10/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('This exit’s quantity'), '4')
    await user.type(screen.getByLabelText('This exit’s net P&L'), '5')
    await user.click(screen.getByRole('button', { name: 'Record partial exit' }))
    await waitFor(() => expect(data.performJournalAction).toHaveBeenCalled())
    expect(vi.mocked(data.performJournalAction).mock.calls[0][1]).toMatchObject({
      quantity: '4',
      netPnl: '5',
    })
  })
})
