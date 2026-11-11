import { beforeEach, describe, expect, it, vi } from 'vitest'
import { paperClient } from '@/lib/trader/paperClient'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { PaperRunMetrics } from './PaperRunMetrics'

vi.mock('@/lib/trader/paperClient', () => ({ paperClient: { report: vi.fn() } }))
const props = {
  originId: 'paper-origin',
  principalId: 'owner',
  profileId: 7,
  runId: 1,
  revision: 5,
}
const saved = (override: Record<string, unknown> = {}) => ({
  report: {
    runId: 1,
    profileId: 7,
    revision: 5,
    currency: 'USD',
    metrics: [
      { metricId: 'realized_net', value: '-0.08', unit: 'currency', sampleSize: 1 },
      { metricId: 'win_rate', value: '0', unit: 'percent', sampleSize: 1 },
    ],
    ...override,
  },
})
beforeEach(() => vi.clearAllMocks())
describe('paper run card report metrics', () => {
  it('loads only the explicitly requested report and uses a fully closed net loss after partial exits and fees', async () => {
    vi.mocked(paperClient.report).mockResolvedValue(
      saved({
        summary: { realizedGross: '2.92', fees: '3' },
        positions: [
          { id: 'p1', quantity: '0', realizedGross: '2.92', entryFee: '1', exitFees: '2' },
        ],
        fills: [
          { kind: 'exit', grossPnl: '1', fee: '1' },
          { kind: 'exit', grossPnl: '1.92', fee: '1' },
        ],
      })
    )
    render(
      <dl>
        <PaperRunMetrics {...props} />
      </dl>
    )
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
    expect(paperClient.report).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Load saved metrics' }))
    expect(await screen.findByText('-0.08 USD')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('1 fully closed position')).toBeInTheDocument()
    expect(screen.queryByText('50.0%')).not.toBeInTheDocument()
    expect(paperClient.report).toHaveBeenCalledWith('paper-origin', 1, expect.any(AbortSignal))
  })
  it('keeps zero closed positions unavailable instead of inventing a zero win rate', async () => {
    vi.mocked(paperClient.report).mockResolvedValue(
      saved({
        metrics: [
          { metricId: 'realized_net', value: '0', sampleSize: 1 },
          {
            metricId: 'win_rate',
            value: null,
            sampleSize: 0,
            unavailableReason: 'no_closed_positions',
          },
        ],
      })
    )
    render(
      <dl>
        <PaperRunMetrics {...props} />
      </dl>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load saved metrics' }))
    expect(await screen.findByText('0 USD')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })
  it('hides previous metrics and rejects a delayed report when the account revision changes', async () => {
    let resolve!: (value: Record<string, unknown>) => void
    vi.mocked(paperClient.report).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const view = render(
      <dl>
        <PaperRunMetrics {...props} />
      </dl>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load saved metrics' }))
    await waitFor(() => expect(paperClient.report).toHaveBeenCalledOnce())
    const signal = vi.mocked(paperClient.report).mock.calls[0][2]!
    view.rerender(
      <dl>
        <PaperRunMetrics {...props} revision={6} />
      </dl>
    )
    expect(signal.aborted).toBe(true)
    await act(async () => resolve(saved()))
    expect(screen.queryByText('-0.08 USD')).not.toBeInTheDocument()
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
  })
})
