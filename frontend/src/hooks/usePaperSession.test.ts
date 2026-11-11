import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalStorageError } from '@/lib/trader/localStorageClient'
import { paperFixture } from '@/lib/trader/paper.fixture'
import { type PaperResponse, paperClient } from '@/lib/trader/paperClient'
import { type PendingPaperRequest, paperPending } from '@/lib/trader/paperPending'
import { usePaperSession } from './usePaperSession'

const mocks = vi.hoisted(() => ({ saved: new Map<string, unknown>() }))
vi.mock('@/lib/trader/paperClient', () => ({ paperClient: { session: vi.fn(), action: vi.fn() } }))
vi.mock('@/lib/trader/paperPending', () => ({
  paperPending: {
    read: vi.fn(async (key: string) => mocks.saved.get(key)),
    claim: vi.fn(async (draft: { key: string; request: { requestId: string } }) => {
      const old = mocks.saved.get(draft.key) as typeof draft | undefined
      if (old && old.request.requestId !== draft.request.requestId)
        throw new Error('Another paper request is retained.')
      mocks.saved.set(draft.key, structuredClone(draft))
    }),
    finish: vi.fn(async (key: string, id: string) => {
      const old = mocks.saved.get(key) as { request: { requestId: string } } | undefined
      if (old?.request.requestId === id) mocks.saved.delete(key)
    }),
  },
}))
const owner = { principal: 'owned', originId: 'paper-origin', runId: 1 }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.saved.clear()
  vi.mocked(paperClient.session).mockResolvedValue({ session: paperFixture() })
  vi.mocked(paperClient.action).mockResolvedValue({
    session: paperFixture({ revision: 2, status: 'in_progress' }),
  })
})
afterEach(cleanup)
describe('paper server acknowledgement and retained request lifecycle', () => {
  it('retries an uncertain branch receipt exactly and returns the child while preserving the parent account', async () => {
    vi.mocked(paperClient.action)
      .mockRejectedValueOnce(new LocalStorageError('paper.offline', 'Response lost.', 0))
      .mockResolvedValueOnce({ session: paperFixture({ runId: 2 }) })
    const { result } = renderHook(() => usePaperSession(owner))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.mutate('branch', { atIndex: 1, name: 'Earlier' }).catch(() => {})
    })
    const original = vi.mocked(paperClient.action).mock.calls[0][0]
    let response: PaperResponse | null = null
    await act(async () => {
      response = await result.current.retry()
    })
    expect(vi.mocked(paperClient.action).mock.calls[1][0]).toEqual(original)
    expect((response as PaperResponse | null)?.session?.runId).toBe(2)
    expect(result.current.session?.runId).toBe(1)
    expect(result.current.pending).toBeNull()
  })
  it('does not create a paper account or request an unbound chart', async () => {
    const { result } = renderHook(() => usePaperSession(null))
    expect(result.current.enabled).toBe(false)
    expect(paperClient.session).not.toHaveBeenCalled()
    expect(paperClient.action).not.toHaveBeenCalled()
  })
  it('never advances optimistically while an acknowledged mutation is pending', async () => {
    const next = deferred<PaperResponse>()
    vi.mocked(paperClient.action).mockReturnValue(next.promise)
    const { result } = renderHook(() => usePaperSession(owner))
    await waitFor(() => expect(result.current.session?.revision).toBe(1))
    let request!: Promise<PaperResponse | null>
    await act(async () => {
      request = result.current.mutate('advance', { count: 1 })
      await Promise.resolve()
    })
    expect(result.current.session?.cursorIndex).toBe(-1)
    expect(result.current.busy).toBe(true)
    await expect(result.current.mutate('advance', { count: 1 })).rejects.toThrow()
    await act(async () => {
      next.resolve({ session: paperFixture({ revision: 2, cursorIndex: 0, asOf: 1793610060 }) })
      await request
    })
    expect(result.current.session?.cursorIndex).toBe(0)
    expect(paperClient.action).toHaveBeenCalledTimes(1)
  })
  it('retains an uncertain exact body across reopen and retries the same receipt', async () => {
    vi.mocked(paperClient.action).mockRejectedValueOnce(
      new LocalStorageError('paper.offline', 'Retained.', 0)
    )
    const first = renderHook(() => usePaperSession(owner))
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    await act(async () => {
      await first.result.current
        .mutate('order', { side: 'buy', orderType: 'market', quantity: '2' })
        .catch(() => {})
    })
    const body = vi.mocked(paperClient.action).mock.calls[0][0]
    expect(first.result.current.pending?.rejected).toBe(false)
    first.unmount()
    const second = renderHook(() => usePaperSession(owner))
    await waitFor(() => expect(second.result.current.pending?.request).toEqual(body))
    await act(async () => {
      await second.result.current.retry()
    })
    expect(vi.mocked(paperClient.action).mock.calls[1][0]).toEqual(body)
    expect(second.result.current.pending).toBeNull()
    expect(mocks.saved.size).toBe(0)
  })
  it('requires latest-state review before clearing a rejected CAS request', async () => {
    vi.mocked(paperClient.action).mockRejectedValueOnce(
      new LocalStorageError('paper.revision_conflict', 'Review latest.', 409)
    )
    const { result } = renderHook(() => usePaperSession(owner))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.mutate('advance', { count: 1 }).catch(() => {})
    })
    await act(async () => {
      await result.current.clearRejected()
    })
    expect(result.current.pending?.rejected).toBe(true)
    await act(async () => {
      await result.current.reload()
      await result.current.clearRejected()
    })
    await act(async () => {
      await result.current.clearRejected()
    })
    expect(result.current.pending).toBeNull()
  })
  it('does not publish an old owner response into another run', async () => {
    const response = deferred<PaperResponse>()
    vi.mocked(paperClient.action).mockReturnValue(response.promise)
    const { result, rerender } = renderHook(({ runId }) => usePaperSession({ ...owner, runId }), {
      initialProps: { runId: 1 },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    let request!: Promise<PaperResponse | null>
    await act(async () => {
      request = result.current.mutate('advance', { count: 1 })
      await Promise.resolve()
    })
    vi.mocked(paperClient.session).mockResolvedValue({
      session: paperFixture({ runId: 2, revision: 9, cash: '50' }),
    })
    rerender({ runId: 2 })
    await waitFor(() => expect(result.current.session?.runId).toBe(2))
    await act(async () => {
      response.resolve({ session: paperFixture({ revision: 2, cash: '99999' }) })
      await request
    })
    expect(result.current.session?.cash).toBe('50')
  })
  it('keeps another tab’s pending command when a new claim is rejected', async () => {
    const { result } = renderHook(() => usePaperSession(owner))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const old: PendingPaperRequest = {
      key: 'owned:paper-origin:1',
      rejected: false,
      request: {
        originId: 'paper-origin',
        runId: 1,
        expectedRevision: 1,
        requestId: 'other-tab',
        action: 'advance',
        payload: { count: 1 },
      },
    }
    mocks.saved.set(old.key, old)
    await act(async () => {
      await result.current.mutate('advance', { count: 2 }).catch(() => {})
    })
    expect(paperClient.action).not.toHaveBeenCalled()
    expect(result.current.pending?.request.requestId).toBe('other-tab')
    expect(await paperPending.read(old.key)).toEqual(old)
  })
  it('returns a fresh branch without replacing the original account in place', async () => {
    vi.mocked(paperClient.action).mockResolvedValue({
      session: paperFixture({ runId: 2, revision: 1, cash: '10000' }),
    })
    const { result } = renderHook(() => usePaperSession(owner))
    await waitFor(() => expect(result.current.loading).toBe(false))
    let child: PaperResponse | null = null
    await act(async () => {
      child = await result.current.mutate('branch', { atIndex: 0, name: 'Independent' })
    })
    expect((child as PaperResponse | null)?.session?.runId).toBe(2)
    expect(result.current.session?.runId).toBe(1)
  })
})
