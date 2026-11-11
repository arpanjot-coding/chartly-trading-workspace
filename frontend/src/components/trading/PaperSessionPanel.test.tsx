import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaperController } from '@/hooks/usePaperSession'
import { paperFixture } from '@/lib/trader/paper.fixture'
import { type PaperSession, paperClient } from '@/lib/trader/paperClient'
import { act, cleanup, fireEvent, render, screen, userEvent, within } from '@/test/test-utils'
import { PaperSessionPanel } from './PaperSessionPanel'

vi.mock('@/lib/trader/paperClient', () => ({ paperClient: { report: vi.fn() } }))
function controller(
  session: PaperSession | null = paperFixture({ status: 'in_progress' }),
  overrides: Partial<PaperController> = {}
): PaperController {
  return {
    enabled: true,
    session,
    loading: false,
    busy: false,
    error: '',
    pending: null,
    reviewed: false,
    reload: vi.fn(async () => {}),
    mutate: vi.fn(async () => ({ session })),
    retry: vi.fn(async () => ({ session })),
    clearRejected: vi.fn(async () => {}),
    ...overrides,
  }
}
const props = {
  profileId: 1,
  runId: 1,
  originId: 'paper-origin',
  startingCash: '10000',
  instrument: { symbol: 'EXAMPLE', exchange: 'LOCAL', interval: '1m', currency: 'USD' },
  onBranch: vi.fn(),
  synchronized: true,
}
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)
describe('paper account workflows in the original chart rail', () => {
  it('aborts a report from an older session revision rather than displaying it beside newer balances', async () => {
    let resolve!: (value: Record<string, unknown>) => void
    vi.mocked(paperClient.report).mockReturnValue(
      new Promise((yes) => {
        resolve = yes
      })
    )
    const value = controller(paperFixture({ status: 'in_progress', revision: 1 }))
    const { rerender } = render(<PaperSessionPanel {...props} controller={value} />)
    await userEvent.click(screen.getByRole('button', { name: 'Review saved report' }))
    const signal = vi.mocked(paperClient.report).mock.calls[0][2]
    rerender(
      <PaperSessionPanel
        {...props}
        controller={controller(paperFixture({ status: 'in_progress', revision: 2, cash: '12000' }))}
      />
    )
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      resolve({ report: { revision: 1, status: 'old stale snapshot' } })
    })
    expect(screen.queryByText(/old stale snapshot/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export report JSON' })).not.toBeInTheDocument()
  })
  it('opens the committed child after retrying an uncertain retained branch without creating another branch', async () => {
    const value = controller(paperFixture({ status: 'in_progress', cursorIndex: 5 }), {
      pending: {
        key: 'owned:paper-origin:1',
        rejected: false,
        request: {
          originId: 'paper-origin',
          runId: 1,
          expectedRevision: 3,
          requestId: 'same-branch-request',
          action: 'branch',
          payload: { atIndex: 2, name: 'Retained branch' },
        },
      },
    })
    vi.mocked(value.retry).mockResolvedValue({ session: paperFixture({ runId: 2 }) })
    render(<PaperSessionPanel {...props} controller={value} />)
    await userEvent.click(screen.getByRole('button', { name: 'Retry retained request' }))
    expect(value.retry).toHaveBeenCalledOnce()
    expect(value.mutate).not.toHaveBeenCalled()
    expect(props.onBranch).toHaveBeenCalledWith(2)
  })
  it('does not turn an emptied close quantity into an accidental full exit', async () => {
    const value = controller(
      paperFixture({
        status: 'in_progress',
        positions: [{ id: 'position-one', side: 'buy', quantity: '10', entryPrice: '100' }],
      })
    )
    render(<PaperSessionPanel {...props} controller={value} />)
    await userEvent.clear(screen.getByRole('textbox', { name: 'Close quantity for position-one' }))
    await userEvent.click(screen.getByRole('button', { name: 'Queue reduce-only close' }))
    expect(value.mutate).not.toHaveBeenCalled()
  })
  it('holds paper ticket actions until the committed chart clock is visible', () => {
    const value = controller(
      paperFixture({
        status: 'in_progress',
        positions: [{ id: 'position-one', side: 'buy', quantity: '10', entryPrice: '100' }],
      })
    )
    render(<PaperSessionPanel {...props} synchronized={false} controller={value} />)
    expect(screen.getByRole('button', { name: 'Submit paper order' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Queue reduce-only close' })).toBeDisabled()
  })
  it('discloses the last-bar constraint and still lets pending orders be cancelled', async () => {
    const value = controller(
      paperFixture({
        status: 'in_progress',
        cursorIndex: 9,
        totalBars: 10,
        orders: [
          { id: 'pending-one', side: 'buy', quantity: '1', orderType: 'limit', status: 'pending' },
        ],
        positions: [{ id: 'position-one', side: 'buy', quantity: '10', entryPrice: '100' }],
      })
    )
    render(<PaperSessionPanel {...props} controller={value} />)
    expect(screen.getByRole('button', { name: 'Submit paper order' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Queue reduce-only close' })).toBeDisabled()
    expect(screen.getByText(/No next saved candle remains/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel pending-one' }))
    expect(value.mutate).toHaveBeenCalledWith('cancel', { orderId: 'pending-one' })
  })
  it('requires explicit reviewed economics rather than guessing a tick or multiplier', async () => {
    const value = controller(null)
    render(<PaperSessionPanel {...props} controller={value} />)
    expect(screen.getByRole('button', { name: 'Prepare paper account' })).toBeDisabled()
    for (const [name, entry] of [
      ['Quantity step', '1'],
      ['Price tick', '0.01'],
      ['Value multiplier', '1'],
    ])
      await userEvent.type(screen.getByLabelText(name, { exact: true }), entry)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Quantity unit' }), 'share')
    await userEvent.click(screen.getByRole('checkbox', { name: /I reviewed the economics/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Prepare paper account' }))
    expect(value.mutate).toHaveBeenCalledWith(
      'prepare',
      expect.objectContaining({
        version: 1,
        startingCash: '10000',
        instrument: expect.objectContaining({
          symbol: 'EXAMPLE',
          exchange: 'LOCAL',
          quantityStep: '1',
          priceTick: '0.01',
          multiplier: '1',
        }),
        policy: { id: 'native-ohlc-conservative-v1', gap: 'next-observed' },
      })
    )
    expect(screen.getByText(/No funding, swap, FX conversion/)).toBeInTheDocument()
  })
  it('submits normalized order intent to its own paper controller only', async () => {
    const value = controller()
    render(<PaperSessionPanel {...props} controller={value} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Paper side' }), 'sell')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Paper order type' }),
      'limit'
    )
    await userEvent.type(screen.getByRole('textbox', { name: 'Paper quantity' }), '2')
    await userEvent.type(screen.getByRole('textbox', { name: 'Paper limit price' }), '100.50')
    await userEvent.type(screen.getByRole('textbox', { name: 'Paper protective stop' }), '110')
    await userEvent.type(screen.getByRole('textbox', { name: 'Paper target' }), '90')
    await userEvent.click(screen.getByRole('button', { name: 'Submit paper order' }))
    expect(value.mutate).toHaveBeenCalledWith('order', {
      side: 'sell',
      orderType: 'limit',
      quantity: '2',
      limitPrice: '100.50',
      stopLoss: '110',
      takeProfit: '90',
    })
    expect(screen.getByRole('textbox', { name: 'Paper quantity' })).toHaveValue('')
  })
  it('queues an explicit partial reduce-only close rather than changing balances locally', async () => {
    const value = controller(
      paperFixture({
        status: 'paused',
        positions: [{ id: 'position-one', side: 'buy', quantity: '10', entryPrice: '100' }],
      })
    )
    render(<PaperSessionPanel {...props} controller={value} />)
    const quantity = screen.getByRole('textbox', { name: 'Close quantity for position-one' })
    await userEvent.clear(quantity)
    await userEvent.type(quantity, '3')
    await userEvent.click(screen.getByRole('button', { name: 'Queue reduce-only close' }))
    expect(value.mutate).toHaveBeenCalledWith('close', {
      positionId: 'position-one',
      quantity: '3',
    })
    expect(value.session?.cash).toBe('10000')
  })
  it('cancels the selected paper order and retains older searchable records in a bounded UI', async () => {
    const orders = Array.from({ length: 150 }, (_, i) => ({
      id: `order-${i}`,
      side: 'buy' as const,
      quantity: '1',
      orderType: 'limit' as const,
      status: 'pending',
    }))
    const value = controller(paperFixture({ status: 'in_progress', orders }))
    render(<PaperSessionPanel {...props} controller={value} />)
    const region = screen.getByRole('region', { name: 'Paper orders' })
    expect(within(region).getAllByRole('button')).toHaveLength(100)
    await userEvent.type(screen.getByRole('textbox', { name: 'Find paper records' }), 'order-0')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel order-0' }))
    expect(value.mutate).toHaveBeenCalledWith('cancel', { orderId: 'order-0' })
  })
  it('blocks new decisions while an uncertain exact request is retained', async () => {
    const value = controller(paperFixture({ status: 'in_progress' }), {
      pending: {
        key: 'owned:paper-origin:1',
        rejected: false,
        request: {
          originId: 'paper-origin',
          runId: 1,
          expectedRevision: 1,
          requestId: 'exact',
          action: 'advance',
          payload: { count: 1 },
        },
      },
    })
    render(<PaperSessionPanel {...props} controller={value} />)
    expect(screen.getByRole('button', { name: 'Submit paper order' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Clear reviewed rejected request' })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry retained request' }))
    expect(value.retry).toHaveBeenCalledOnce()
  })
  it('starts a prepared account explicitly and never silently advances its data', async () => {
    const value = controller(paperFixture())
    render(<PaperSessionPanel {...props} controller={value} />)
    expect(value.mutate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Submit paper order' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Start paper session' }))
    expect(value.mutate).toHaveBeenCalledWith('start', {})
  })
  it('branches only after explaining the fresh-account policy and uses the returned run', async () => {
    const value = controller(paperFixture({ status: 'in_progress', cursorIndex: 5 }))
    vi.mocked(value.mutate).mockResolvedValue({ session: paperFixture({ runId: 2 }) })
    render(<PaperSessionPanel {...props} controller={value} />)
    expect(screen.getByRole('button', { name: 'Create independent branch' })).toBeDisabled()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Branch candle index' }), {
      target: { value: '2' },
    })
    await userEvent.type(screen.getByRole('textbox', { name: 'Branch name' }), 'Earlier account')
    await userEvent.click(screen.getByRole('checkbox', { name: /Start a fresh account here/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Create independent branch' }))
    expect(value.mutate).toHaveBeenCalledWith('branch', { atIndex: 2, name: 'Earlier account' })
    expect(props.onBranch).toHaveBeenCalledWith(2)
  })
  it('finishes without inventing a final fill and keeps the exact paper-book drilldown', async () => {
    const value = controller(paperFixture({ status: 'in_progress', bookId: 'paper-book-one' }))
    render(<PaperSessionPanel {...props} controller={value} />)
    await userEvent.click(screen.getByRole('button', { name: 'Finish paper session' }))
    expect(value.mutate).toHaveBeenCalledWith('finish', {})
    expect(screen.getByRole('link', { name: 'Open run journal' })).toHaveAttribute(
      'href',
      '/workspace/profiles/1/journal?book=paper-book-one&tab=Trades'
    )
    expect(screen.getByText(/It does not invent a close/)).toBeInTheDocument()
  })
  it('reads the report explicitly and aborts an outgoing owner’s pending report', async () => {
    let resolve!: (value: Record<string, unknown>) => void
    vi.mocked(paperClient.report).mockReturnValue(
      new Promise((yes) => {
        resolve = yes
      })
    )
    const { unmount } = render(<PaperSessionPanel {...props} controller={controller()} />)
    expect(paperClient.report).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Review saved report' }))
    const signal = vi.mocked(paperClient.report).mock.calls[0][2]
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
    resolve({ report: { version: 1 } })
  })
  it('does not offer execution for a finished report with marked open positions', () => {
    render(
      <PaperSessionPanel
        {...props}
        controller={controller(
          paperFixture({
            status: 'finished',
            positions: [{ id: 'open', side: 'sell', quantity: '1', entryPrice: '100' }],
          })
        )}
      />
    )
    expect(screen.queryByRole('button', { name: 'Submit paper order' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Queue reduce-only close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Finish paper session' })).toBeDisabled()
  })
})
