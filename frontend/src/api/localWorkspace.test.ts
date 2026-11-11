import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import { openLocalWorkspace } from './localWorkspace'

vi.mock('./client', () => ({ fetchCSRFToken: vi.fn(async () => 'csrf-fixture') }))
const uid = `principal_${'1'.repeat(32)}`
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('personal workspace proof', () => {
  it('uses CSRF bootstrap only when the server permits personal mode', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ authenticated: false, personalModeAvailable: true }, 401))
      .mockResolvedValueOnce(
        response({
          authenticated: true,
          principal: { uid, username: 'Local workspace', personal: true },
        })
      )
    vi.stubGlobal('fetch', fetcher)
    expect((await openLocalWorkspace()).principal?.uid).toBe(uid)
    expect(fetcher.mock.calls[1][0]).toBe('/auth/local-workspace')
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: '{}',
      credentials: 'include',
      headers: { 'X-CSRFToken': 'csrf-fixture' },
    })
  })
  it('keeps network/shared installations on account authentication', async () => {
    const fetcher = vi.fn(async () =>
      response({ authenticated: false, personalModeAvailable: false }, 401)
    )
    vi.stubGlobal('fetch', fetcher)
    expect((await openLocalWorkspace()).authenticated).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('preserves an already verified named owner', async () => {
    const fetcher = vi.fn(async () =>
      response({ authenticated: true, principal: { uid, username: 'Alice', personal: false } })
    )
    vi.stubGlobal('fetch', fetcher)
    expect((await openLocalWorkspace()).principal?.username).toBe('Alice')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not publish a malformed identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({ authenticated: true, principal: { uid: 'arbitrary-owner', username: 'Alice' } })
      )
    )
    await expect(openLocalWorkspace()).rejects.toThrow('identity could not be verified')
  })
  it('does not send bootstrap after cancellation during CSRF acquisition', async () => {
    const { fetchCSRFToken } = await import('./client')
    const control = new AbortController()
    vi.mocked(fetchCSRFToken).mockImplementationOnce(async () => {
      control.abort()
      return 'csrf-fixture'
    })
    const fetcher = vi.fn(async () =>
      response({ authenticated: false, personalModeAvailable: true }, 401)
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(openLocalWorkspace(control.signal)).rejects.toThrow('cancelled')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('personal state never inherits a prior broker or execution session', () => {
    useAuthStore.setState({
      user: { username: 'Alice', broker: 'zerodha', isLoggedIn: true, loginTime: null },
      isAuthenticated: true,
    })
    useAuthStore.getState().setLocalAccount('Local workspace', uid, true)
    expect(useAuthStore.getState().user).toMatchObject({
      isLocalGuest: true,
      broker: null,
      isLoggedIn: false,
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().apiKey).toBeNull()
    expect(useAuthStore.getState().localPrincipalId).toBe(uid)
    useAuthStore.getState().logout()
  })
})
