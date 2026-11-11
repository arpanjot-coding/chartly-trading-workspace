import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webClient } from '@/api/client'
import { AccountControls } from '@/components/layout/AccountControls'
import { Navbar } from '@/components/layout/Navbar'
import { ConnectionsDataNavigation } from '@/components/layout/SettingsNavigation'
import Profile from '@/pages/Profile'
import { useAuthStore } from '@/stores/authStore'
import ConnectionsData from './ConnectionsData'
import SettingsIndex from './SettingsIndex'

const fixture = vi.hoisted(() => ({
  profiles: [] as {
    id: number
    name: string
    currency: string
    kind: string
    archivedAt?: string
  }[],
  loading: false,
  error: null as string | null,
  reload: vi.fn(),
}))
vi.mock('@/lib/trader/useTraderData', () => ({
  useTraderData: () => ({
    portfolios: fixture.profiles,
    loading: fixture.loading,
    error: fixture.error,
    reload: fixture.reload,
  }),
}))
vi.mock('@/components/connections/ConnectorPanel', () => ({
  ConnectorPanel: ({ profileId }: { profileId?: number }) => (
    <section aria-label="Connection panel">Connections for {profileId ?? 'all profiles'}</section>
  ),
}))
vi.mock('@/api/client', () => ({ webClient: { get: vi.fn(), post: vi.fn() } }))
vi.mock('@/components/auth/TwoFactorEnforcement', () => ({ default: () => null }))
vi.mock('@/utils/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn() },
  toast: { dismiss: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLocalAuthenticated: false,
    localPrincipalId: null,
  })
  fixture.profiles = []
  fixture.loading = false
  fixture.error = null
  vi.mocked(webClient.get).mockResolvedValue({
    data: {
      status: 'success',
      data: { username: 'Test user', smtp_settings: null, qr_code: null, totp_secret: null },
    },
  })
})
function renderJourney(initial = '/settings') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/settings" element={<SettingsIndex />} />
        <Route path="/settings/connections" element={<ConnectionsData />} />
        <Route
          path="/historify"
          element={
            <>
              <h1>Existing History</h1>
              <ConnectionsDataNavigation active="history" />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}
describe('Settings and Connections & Data journey', () => {
  it('uses the same Settings grouping in the mobile sheet and marks nested data pages current', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/settings/connections']}>
        <Navbar />
      </MemoryRouter>
    )
    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))
    const sheet = await screen.findByRole('dialog', { name: 'Navigation Menu' })
    expect(within(sheet).getByRole('link', { name: /^Settings/ })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      within(sheet).queryByRole('link', { name: /^History|^Developer|^Advanced/ })
    ).not.toBeInTheDocument()
  })
  it('offers one settings entry in the shared user menu', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AccountControls />
      </MemoryRouter>
    )
    await user.click(screen.getByRole('button', { name: 'Open user menu' }))
    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: /^Settings/ })
    ).toBeVisible()
  })
  it('keeps account, developer and system controls reachable', () => {
    renderJourney()
    expect(screen.getByRole('link', { name: /Account & preferences/ })).toHaveAttribute(
      'href',
      '/profile'
    )
    expect(screen.getByRole('link', { name: /Developer API/ })).toHaveAttribute('href', '/apikey')
    expect(screen.getByRole('link', { name: /System & advanced/ })).toHaveAttribute(
      'href',
      '/admin'
    )
  })
  it('has one connection hub without a broker-login detour, including the old portfolio tab URL', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { username: 'Test', broker: 'zerodha', isLoggedIn: true, loginTime: null },
    })
    renderJourney('/settings/connections?tab=portfolios')
    const nav = screen.getByRole('navigation', { name: 'Connections & Data' })
    expect(within(nav).getAllByRole('link')).toHaveLength(2)
    expect(within(nav).getByRole('link', { name: 'Connections', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('region', { name: 'Connection panel' })).toBeVisible()
    expect(screen.queryByText('App broker connection')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Broker API Key')).not.toBeInTheDocument()
    expect(document.querySelector('a[href="/broker"]')).toBeNull()
    expect(webClient.get).not.toHaveBeenCalled()
  })
  it('filters by a live profile and preserves chart, journal and profile return paths', async () => {
    fixture.profiles = [
      { id: 12, name: 'Personal', currency: 'GBP', kind: 'live' },
      { id: 22, name: 'Replay', currency: 'USD', kind: 'replay' },
    ]
    const user = userEvent.setup()
    renderJourney('/settings/connections')
    expect(screen.getByRole('region', { name: 'Connection panel' })).toHaveTextContent(
      'all profiles'
    )
    await user.selectOptions(screen.getByLabelText('Profile'), '12')
    expect(screen.getByRole('region', { name: 'Connection panel' })).toHaveTextContent('12')
    expect(screen.getByRole('link', { name: 'Chart', exact: true }).getAttribute('href')).toContain(
      'profileId=12'
    )
    expect(screen.getByRole('link', { name: 'Journal', exact: true })).toHaveAttribute(
      'href',
      '/workspace/profiles/12/journal'
    )
    expect(screen.getByRole('link', { name: 'Open profile' })).toHaveAttribute(
      'href',
      '/workspace/profiles/12'
    )
    expect(screen.queryByRole('option', { name: 'Replay' })).not.toBeInTheDocument()
    const historyLink = screen.getByRole('link', { name: 'History & data', exact: true })
    expect(
      new URL(historyLink.getAttribute('href')!, 'http://localhost').searchParams.get('returnTo')
    ).toBe('/settings/connections?profileId=12')
    await user.click(historyLink)
    expect(screen.getByRole('link', { name: 'Connections', exact: true })).toHaveAttribute(
      'href',
      '/settings/connections?profileId=12'
    )
    await user.click(screen.getByRole('link', { name: 'Connections', exact: true }))
    expect(screen.getByRole('region', { name: 'Connection panel' })).toHaveTextContent('12')
    await user.selectOptions(screen.getByLabelText('Profile'), '')
    expect(screen.getByRole('region', { name: 'Connection panel' })).toHaveTextContent(
      'all profiles'
    )
  })
  it('retains the requested profile scope while the workspace opens', () => {
    fixture.loading = true
    renderJourney('/settings/connections?profileId=12')
    expect(screen.getByRole('region', { name: 'Connection panel' })).toHaveTextContent('12')
    expect(screen.getByLabelText('Profile')).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Journal', exact: true })).not.toBeInTheDocument()
  })
  it('does not substitute a different profile for an unavailable owner-scoped link', async () => {
    const user = userEvent.setup()
    renderJourney('/settings/connections?profileId=123')
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable')
    expect(screen.queryByRole('region', { name: 'Connection panel' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all profiles' }))
    expect(screen.getByRole('region', { name: 'Connection panel' })).toBeVisible()
  })
  it('links history and connections as siblings with a working Settings return', async () => {
    const user = userEvent.setup()
    renderJourney('/settings/connections')
    await user.click(screen.getByRole('link', { name: 'History & data', exact: true }))
    expect(screen.getByRole('heading', { name: 'Existing History' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'History & data', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await user.click(screen.getByRole('link', { name: 'Connections', exact: true }))
    await user.click(screen.getByRole('link', { name: 'Settings', exact: true }))
    expect(screen.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  })
  it('keeps local entry available without an app or broker sign-in and offers workspace retry', async () => {
    fixture.error = 'Workspace unavailable'
    const user = userEvent.setup()
    renderJourney('/settings/connections')
    expect(screen.getByRole('region', { name: 'Connection panel' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Workspace', exact: true })).toHaveAttribute(
      'href',
      '/workspace'
    )
    await user.click(screen.getByRole('button', { name: 'Retry workspace' }))
    expect(fixture.reload).toHaveBeenCalledOnce()
  })
  it('keeps broker configuration and its API request out of Account', async () => {
    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    )
    expect(await screen.findByRole('heading', { name: 'Account & preferences' })).toBeVisible()
    expect(screen.queryByRole('tab', { name: 'Broker' })).not.toBeInTheDocument()
    expect(webClient.get).toHaveBeenCalledWith('/auth/profile-data')
    expect(webClient.get).not.toHaveBeenCalledWith('/api/broker/credentials')
  })
})
