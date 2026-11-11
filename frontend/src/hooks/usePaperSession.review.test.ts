import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { paperFixture } from '@/lib/trader/paper.fixture'
import { type PaperResponse, paperClient } from '@/lib/trader/paperClient'
import { type PendingPaperRequest, paperPending } from '@/lib/trader/paperPending'
import { usePaperSession } from './usePaperSession'

const local = vi.hoisted(() => ({ saved: new Map<string, PendingPaperRequest>() }))
vi.mock('@/lib/trader/paperClient', () => ({ paperClient: { session: vi.fn(), action: vi.fn() } }))
vi.mock('@/lib/trader/paperPending', () => ({
  paperPending: {
    read: vi.fn(async (key: string) => local.saved.get(key)),
    claim: vi.fn(async (draft: PendingPaperRequest) => {
      local.saved.set(draft.key, structuredClone(draft))
    }),
    finish: vi.fn(async (key: string) => {
      local.saved.delete(key)
    }),
  },
}))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
const firstOwner = { principal: 'owner-a', originId: 'same-origin', runId: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  local.saved.clear()
  vi.mocked(paperPending.read).mockImplementation(async (key) => local.saved.get(key))
  vi.mocked(paperPending.claim).mockImplementation(async (draft) => {
    local.saved.set(draft.key, structuredClone(draft))
  })
  vi.mocked(paperClient.session).mockResolvedValue({ session: paperFixture() })
  vi.mocked(paperClient.action).mockResolvedValue({ session: paperFixture({ revision: 2 }) })
})
afterEach(cleanup)

describe('independent review of paper owner and durable-intent boundaries', () => {
  it('does not send an outgoing owner command whose durable claim resolves after owner change', async () => {
    const claim = deferred<void>()
    vi.mocked(paperPending.claim).mockImplementation(async (draft) => {
      await claim.promise
      local.saved.set(draft.key, structuredClone(draft))
    })
    const { result, rerender } = renderHook(
      ({ principal }) => usePaperSession({ ...firstOwner, principal }),
      { initialProps: { principal: 'owner-a' } }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    let outgoing!: Promise<PaperResponse | null>
    await act(async () => {
      outgoing = result.current.mutate('order', {
        side: 'buy',
        orderType: 'market',
        quantity: '2',
      })
      await Promise.resolve()
    })
    rerender({ principal: 'owner-b' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      claim.resolve()
      await outgoing
    })
    expect(paperClient.action).not.toHaveBeenCalled()
    expect(local.saved.get('owner-a:same-origin:1')?.request.payload).toEqual({
      side: 'buy',
      orderType: 'market',
      quantity: '2',
    })
    expect(result.current.pending).toBeNull()
    expect(result.current.busy).toBe(false)
  })

  it('ignores a late read from a different principal even when origin and run IDs match', async () => {
    const oldRead = deferred<PaperResponse>()
    vi.mocked(paperClient.session).mockReturnValueOnce(oldRead.promise)
    const { result, rerender } = renderHook(
      ({ principal }) => usePaperSession({ ...firstOwner, principal }),
      { initialProps: { principal: 'owner-a' } }
    )
    vi.mocked(paperClient.session).mockResolvedValue({
      session: paperFixture({ cash: '25', revision: 1 }),
    })
    rerender({ principal: 'owner-b' })
    await waitFor(() => expect(result.current.session?.cash).toBe('25'))
    await act(async () => {
      oldRead.resolve({ session: paperFixture({ cash: '99999', revision: 100 }) })
      await oldRead.promise
    })
    expect(result.current.session?.cash).toBe('25')
    expect(result.current.session?.revision).toBe(1)
  })

  it('sends no network mutation if retaining the exact request fails', async () => {
    vi.mocked(paperPending.claim).mockRejectedValue(new Error('The local request store is full.'))
    const { result } = renderHook(() => usePaperSession(firstOwner))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await expect(result.current.mutate('advance', { count: 1 })).rejects.toThrow('store is full')
    })
    expect(paperClient.action).not.toHaveBeenCalled()
    expect(result.current.session?.cursorIndex).toBe(-1)
    expect(result.current.busy).toBe(false)
    expect(result.current.error).toContain('store is full')
  })
})
