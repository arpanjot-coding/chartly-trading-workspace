import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import App from './App'

const { sessionMount, socketMount } = vi.hoisted(() => ({
  sessionMount: vi.fn(),
  socketMount: vi.fn(),
}))
vi.mock('@/app/providers', () => ({
  Providers: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/auth/AuthSync', () => ({
  AuthSync: ({ children }: { children: ReactNode }) => {
    sessionMount()
    return children
  },
}))
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => {} }))
vi.mock('@/components/layout/Navbar', () => ({
  Navbar: () => <nav>Existing product navigation</nav>,
}))
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }))
vi.mock('@/components/layout/MobileBottomNav', () => ({ MobileBottomNav: () => null }))
vi.mock('@/components/socket/SocketProvider', () => ({
  SocketProvider: ({ children }: { children: ReactNode }) => {
    socketMount()
    return children
  },
}))
vi.mock('@/pages/ApiKey', () => ({ default: () => <h1>Developer API page</h1> }))
vi.mock('@/pages/Profile', () => ({ default: () => <h1>Account preferences page</h1> }))
vi.mock('@/pages/Playground', () => ({
  default: () => (
    <header>
      <h1>Full-width Playground</h1>
    </header>
  ),
}))
vi.mock('@/pages/Login', () => ({ default: () => <h1>Account sign-in</h1> }))
vi.mock('@/pages/NotFound', () => ({ default: () => <h1>Not found</h1> }))
vi.mock('@/pages/workspace/TraderWorkspace', () => ({ default: () => <h1>Trading profiles</h1> }))

const UID = 'principal_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    isAuthenticated: false,
    isLocalAuthenticated: false,
    localPrincipalId: null,
    user: null,
  })
})
function open(path: string) {
  window.history.replaceState({}, '', path)
  render(<App />)
}
const destinations = [
  ['/apikey', 'Developer API page'],
  ['/profile', 'Account preferences page'],
  ['/playground', 'Full-width Playground'],
] as const

describe('public Chartly homepage', () => {
  it('loads without checking account state and opens the existing workspace route', async () => {
    open('/')
    const title = 'Chart the market. Practise before you trade.'
    expect(await screen.findByRole('heading', { name: title })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Product navigation' })).toBeVisible()
    expect(sessionMount).not.toHaveBeenCalled()
    expect(socketMount).not.toHaveBeenCalled()

    const hero = screen.getByRole('region', { name: title })
    const workspace = within(hero).getByRole('link', { name: 'Open workspace' })
    expect(workspace).toHaveAttribute('href', '/workspace')
    await userEvent.click(workspace)

    expect(await screen.findByRole('heading', { name: 'Trading profiles' })).toBeVisible()
    expect(window.location.pathname).toBe('/workspace')
    expect(sessionMount).toHaveBeenCalled()
    expect(socketMount).not.toHaveBeenCalled()
  })
})

describe('actual App routes for broker-independent account and developer access', () => {
  it.each(
    destinations
  )('opens %s for a verified personal account without starting broker sockets', async (path, title) => {
    useAuthStore.setState({
      isLocalAuthenticated: true,
      localPrincipalId: UID,
      user: {
        username: 'Local workspace',
        broker: null,
        isLoggedIn: false,
        loginTime: null,
        isLocalGuest: true,
      },
    })
    open(path)
    expect(await screen.findByRole('heading', { name: title })).toBeVisible()
    expect(socketMount).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    if (path === '/playground') expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    else expect(screen.getByRole('navigation')).toBeVisible()
  })

  it.each(
    destinations
  )('opens %s for a verified named account with no broker', async (path, title) => {
    useAuthStore.getState().setLocalAccount('alice', UID)
    open(path)
    expect(await screen.findByRole('heading', { name: title })).toBeVisible()
    expect(socketMount).not.toHaveBeenCalled()
    expect(useAuthStore.getState().user?.broker).toBeNull()
  })

  it.each(
    destinations
  )('sends an anonymous shared-install visit to %s through local sign-in with the exact return', async (path) => {
    open(`${path}?return=kept`)
    expect(await screen.findByRole('heading', { name: 'Account sign-in' })).toBeVisible()
    const search = new URLSearchParams(window.location.search)
    expect(search.get('purpose')).toBe('local')
    expect(search.get('next')).toBe(`${path}?return=kept`)
  })

  it.each([
    null,
    '',
    'alice',
    'principal_not-a-real-uid',
  ])('rejects a local flag without a canonical principal: %j', async (principal) => {
    useAuthStore.setState({
      isLocalAuthenticated: true,
      localPrincipalId: principal,
      user: {
        username: 'Local workspace',
        broker: null,
        isLoggedIn: false,
        loginTime: null,
        isLocalGuest: true,
      },
    })
    open('/apikey')
    expect(await screen.findByRole('heading', { name: 'Account sign-in' })).toBeVisible()
    expect(socketMount).not.toHaveBeenCalled()
  })

  it('does not accept a stale UID or forged guest/broker metadata as authenticated access', async () => {
    useAuthStore.setState({
      localPrincipalId: UID,
      isLocalAuthenticated: false,
      isAuthenticated: true,
      user: {
        username: 'Old guest',
        broker: 'kraken',
        isLoggedIn: true,
        loginTime: null,
        isLocalGuest: true,
      },
    })
    open('/profile')
    expect(await screen.findByRole('heading', { name: 'Account sign-in' })).toBeVisible()
    expect(socketMount).not.toHaveBeenCalled()
  })

  it('preserves existing genuine broker-account access', async () => {
    useAuthStore.getState().login('alice', 'kraken')
    open('/apikey')
    expect(await screen.findByRole('heading', { name: 'Developer API page' })).toBeVisible()
    expect(socketMount).toHaveBeenCalled()
  })

  it('opens Layout surfaces like /websocket/order for a verified local account', async () => {
    // Personal-mode owners were bounced to login (then Workspace) by
    // the legacy-account-only gate, which also broke Settings targets
    // such as System & advanced and AI configuration. Backend broker
    // APIs still enforce their own session rules server-side.
    useAuthStore.getState().setLocalAccount('Local workspace', UID, true)
    open('/websocket/order')
    expect(await screen.findByRole('heading', { name: /Order Stream/ })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Account sign-in' })).not.toBeInTheDocument()
  })

  it.each([
    '/orderbook',
    '/positions',
    '/broker',
  ])('removed Indian-broker route %s no longer exists', async (path) => {
    useAuthStore.getState().setLocalAccount('Local workspace', UID, true)
    open(path)
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeVisible()
    expect(socketMount).not.toHaveBeenCalled()
  })

  it.each([
    '/fundamentals',
    '/strategy-builder',
    '/portfolio-backtester/results',
  ])('offers Workspace from deferred route %s', async (path) => {
    open(path)
    expect(
      await screen.findByRole('heading', { name: 'This feature is unavailable' })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open Workspace' })).toHaveAttribute(
      'href',
      '/workspace'
    )
    expect(socketMount).not.toHaveBeenCalled()
  })
})
