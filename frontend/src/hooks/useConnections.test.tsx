import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ConnectorConnection, connectorClient } from '@/lib/trader/connectorClient'
import { LocalStorageError } from '@/lib/trader/localStorageClient'
import { useConnections } from './useConnections'

vi.mock('@/lib/trader/connectorClient', () => ({
  connectorClient: { list: vi.fn(), providers: vi.fn(), action: vi.fn() },
}))
const owner = { principal: 'owner-one', originId: 'origin-one', profileId: 7 }
const connection: ConnectorConnection = {
  id: 'connection-one',
  revision: 1,
  label: 'Simulated source',
  providerId: 'fake',
  profileId: 7,
  state: 'unverified',
  health: 'unknown',
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(connectorClient.list).mockResolvedValue({ connections: [] })
  vi.mocked(connectorClient.providers).mockResolvedValue({ providers: [] })
})
afterEach(cleanup)
describe('connection ownership and command retention', () => {
  it('loads public provider choices without a principal or workspace and makes no private list call', async () => {
    vi.mocked(connectorClient.providers).mockResolvedValue({
      providers: [{ id: 'public-provider' } as never],
    })
    const { result } = renderHook(() => useConnections(null))
    await waitFor(() => expect(result.current.providers).toEqual([{ id: 'public-provider' }]))
    expect(connectorClient.providers).toHaveBeenCalledWith(expect.any(AbortSignal), undefined)
    expect(connectorClient.list).not.toHaveBeenCalled()
    expect(result.current.connections).toEqual([])
  })
  it('keeps public provider choices visible when saved connections are unavailable', async () => {
    vi.mocked(connectorClient.providers).mockResolvedValue({
      providers: [{ id: 'public-provider' } as never],
    })
    vi.mocked(connectorClient.list).mockRejectedValueOnce(new Error('Reopen this workspace'))
    const { result } = renderHook(() => useConnections(owner))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.providers).toEqual([{ id: 'public-provider' }])
    expect(result.current.error).toBe('Reopen this workspace')
    expect(result.current.connections).toEqual([])
  })
  it('passes the captured owner on reads and rejects a cookie-only account change without publishing another account', async () => {
    let cookiePrincipal = owner.principal
    const callback = vi.fn()
    vi.mocked(connectorClient.action).mockImplementation(async (_body, _signal, principal) => {
      if (principal !== cookiePrincipal)
        throw new LocalStorageError(
          'account.scope_changed',
          'Sign in again to confirm the current account.',
          403
        )
      return { connection: { ...connection, id: 'foreign-connection' }, workspace: {} as never }
    })
    const { result } = renderHook(() => useConnections(owner, callback))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(connectorClient.list).toHaveBeenCalledWith(
      owner.originId,
      owner.profileId,
      expect.any(AbortSignal),
      owner.principal
    )
    expect(connectorClient.providers).toHaveBeenCalledWith(expect.any(AbortSignal), undefined)
    cookiePrincipal = 'another-cookie-owner'
    await act(async () => {
      await expect(
        result.current.mutate('create', null, {
          providerId: 'diagnostic',
          label: 'Old owner setup',
          configuration: {},
        })
      ).rejects.toMatchObject({ code: 'account.scope_changed' })
    })
    expect(connectorClient.action).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', originId: owner.originId }),
      expect.any(AbortSignal),
      owner.principal
    )
    expect(result.current.rejected).toBe(true)
    expect(result.current.connections).toEqual([])
    expect(callback).not.toHaveBeenCalled()
  })
  it('retains the same body and receipt identity after an uncertain network response', async () => {
    vi.mocked(connectorClient.action)
      .mockRejectedValueOnce(new Error('Response interrupted'))
      .mockResolvedValueOnce({ connection })
    const { result } = renderHook(() => useConnections(owner))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await expect(
        result.current.mutate('create', null, {
          providerId: 'fake',
          label: 'Simulated source',
          configuration: {},
        })
      ).rejects.toThrow('interrupted')
    })
    const retained = result.current.pending
    expect(retained?.expectedRevision).toBe(0)
    await act(async () => {
      await result.current.retry()
    })
    expect(connectorClient.action).toHaveBeenNthCalledWith(
      2,
      retained,
      expect.any(AbortSignal),
      owner.principal
    )
    expect(result.current.pending).toBeNull()
    expect(result.current.connections).toEqual([connection])
    expect(localStorage.getItem('connection-one')).toBeNull()
  })
  it('requires explicit review after definite revision rejection and never automatically resubmits', async () => {
    vi.mocked(connectorClient.action).mockRejectedValue(
      new LocalStorageError('connector.revision_conflict', 'Reload and review', 409)
    )
    const { result } = renderHook(() => useConnections(owner))
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.mutate('probe', connection).catch(() => {})
    })
    expect(result.current.rejected).toBe(true)
    expect(connectorClient.action).toHaveBeenCalledTimes(1)
    await act(async () => {
      await expect(result.current.mutate('probe', connection)).rejects.toThrow('retained')
    })
    act(() => result.current.clearRejected())
    expect(result.current.pending).toBeNull()
  })
  it('drops a stale principal read and an in-flight write acknowledgement when owner changes', async () => {
    let release: (value: { connections: ConnectorConnection[] }) => void = () => {}
    vi.mocked(connectorClient.list).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const callback = vi.fn()
    const { result, rerender } = renderHook(
      ({ principal }) => useConnections({ ...owner, principal }, callback),
      { initialProps: { principal: 'owner-one' } }
    )
    rerender({ principal: 'owner-two' })
    await act(async () => release({ connections: [connection] }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.connections).toEqual([])
    let confirm: (value: { connection: ConnectorConnection; workspace: never }) => void = () => {}
    vi.mocked(connectorClient.action).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = resolve
        })
    )
    let pending: Promise<unknown> = Promise.resolve()
    act(() => {
      pending = result.current.mutate('create', null, {
        providerId: 'fake',
        label: 'Source',
        configuration: {},
      })
    })
    rerender({ principal: 'owner-three' })
    await act(async () => {
      confirm({ connection, workspace: {} as never })
      await pending
    })
    expect(result.current.connections).toEqual([])
    expect(callback).not.toHaveBeenCalled()
  })
})
