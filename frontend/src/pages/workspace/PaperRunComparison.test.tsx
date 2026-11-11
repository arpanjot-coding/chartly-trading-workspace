import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PracticeSession } from '@/lib/trader/db'
import { paperClient } from '@/lib/trader/paperClient'
import { act, cleanup, render, screen, userEvent, waitFor } from '@/test/test-utils'
import { PaperRunComparison } from './PaperRunComparison'

vi.mock('@/lib/trader/paperClient', () => ({ paperClient: { compare: vi.fn() } }))
const sessions = [1, 2, 3].map(
  (id) =>
    ({
      id,
      portfolioId: 1,
      name: `Account ${id}`,
      paper: { version: 1, revision: 1, status: 'paused', manifestId: `manifest-${id}` },
    }) as PracticeSession
)
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)
describe('independent paper account comparisons', () => {
  it('requires explicit selection, compares only those run IDs and clears every result', async () => {
    vi.mocked(paperClient.compare).mockResolvedValue({
      comparison: {
        combinedEquity: null,
        runs: [
          {
            runId: 1,
            name: 'Account 1',
            currency: 'USD',
            startingCash: '100',
            summary: { cash: '110', equity: '112', realizedGross: '10', fees: '1' },
          },
          {
            runId: 2,
            name: 'Account 2',
            currency: 'EUR',
            startingCash: '50',
            summary: { cash: '45', equity: '48', realizedGross: '-5', fees: '0.2' },
          },
        ],
      },
    })
    render(<PaperRunComparison originId="one" profileId={1} sessions={sessions} />)
    expect(screen.getByRole('button', { name: 'Compare selected runs' })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Account 1' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Account 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Compare selected runs' }))
    expect(paperClient.compare).toHaveBeenCalledWith('one', 1, [1, 2], expect.any(AbortSignal))
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByText('USD')).toBeInTheDocument()
    expect(screen.getByText('EUR')).toBeInTheDocument()
    expect(screen.getByText('112')).toBeInTheDocument()
    expect(screen.getByText('48')).toBeInTheDocument()
    expect(screen.queryByText('160')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear run selections' }))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('checkbox').every((input) => !(input as HTMLInputElement).checked)
    ).toBe(true)
  })
  it('discards an old comparison when selections change before its response', async () => {
    let resolve!: (value: Record<string, unknown>) => void
    vi.mocked(paperClient.compare).mockReturnValue(
      new Promise((yes) => {
        resolve = yes
      })
    )
    render(<PaperRunComparison originId="one" profileId={1} sessions={sessions} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Account 1' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Account 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Compare selected runs' }))
    const signal = vi.mocked(paperClient.compare).mock.calls[0][3]
    await userEvent.click(screen.getByRole('checkbox', { name: 'Account 2' }))
    expect(signal?.aborted).toBe(true)
    await act(async () => {
      resolve({ comparison: { runs: [{ runId: 2, name: 'stale result' }] } })
    })
    expect(screen.queryByText('stale result')).not.toBeInTheDocument()
  })
})
