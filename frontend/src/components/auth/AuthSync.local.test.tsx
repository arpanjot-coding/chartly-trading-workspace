import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import { useBrokerStore } from '@/stores/brokerStore'
import { useThemeStore } from '@/stores/themeStore'
import { AuthSync } from './AuthSync'

const proof = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('@/api/localWorkspace', () => ({ openLocalWorkspace: proof.open }))
vi.mock('@/lib/trader/dataPersistence', () => ({
  activationMarker: vi.fn(async () => null),
  loadTraderBinding: vi.fn(async () => ({ kind: 'browser' })),
}))
const uid = `principal_${'2'.repeat(32)}`
const capabilities = vi.fn(async () => {})
const routing = vi.fn(async () => {})
beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLocalAuthenticated: false,
    localPrincipalId: null,
    apiKey: null,
  })
  useBrokerStore.setState({ fetchCapabilities: capabilities })
  useThemeStore.setState({ syncAppMode: routing })
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'success',
            authenticated: true,
            logged_in: true,
            local_guest: true,
            user: 'old-guest',
            broker: 'zerodha',
            api_key: 'old-key',
          })
        )
    )
  )
  proof.open.mockResolvedValue({
    authenticated: true,
    principal: { uid, username: 'Local workspace', personal: true },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
describe('personal app entry', () => {
  it('opens the personal data identity without a broker-login dependency', async () => {
    render(
      <AuthSync>
        <span>Workspace ready</span>
      </AuthSync>
    )
    await screen.findByText('Workspace ready')
    expect(useAuthStore.getState().localPrincipalId).toBe(uid)
    expect(useAuthStore.getState().user).toMatchObject({
      isLocalGuest: true,
      broker: null,
      isLoggedIn: false,
    })
    expect(useAuthStore.getState().apiKey).toBeNull()
    expect(capabilities).not.toHaveBeenCalled()
    expect(routing).not.toHaveBeenCalled()
  })
  it('ignores an unfinished proof after the entry component closes', async () => {
    let finish!: (value: unknown) => void
    proof.open.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const page = render(
      <AuthSync>
        <span>Workspace ready</span>
      </AuthSync>
    )
    await waitFor(() => expect(proof.open).toHaveBeenCalled())
    page.unmount()
    useAuthStore.getState().setLocalAccount('Another owner', `principal_${'3'.repeat(32)}`)
    finish({ authenticated: true, principal: { uid, username: 'Local workspace', personal: true } })
    await Promise.resolve()
    expect(useAuthStore.getState().localPrincipalId).toBe(`principal_${'3'.repeat(32)}`)
  })
})
