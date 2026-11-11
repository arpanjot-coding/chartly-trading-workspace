import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { DeveloperApiContext } from './DeveloperApiContext'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  useAuthStore.setState({
    user: { username: 'alice', broker: 'cached-provider', isLoggedIn: true, loginTime: null },
    isAuthenticated: true,
    localPrincipalId: 'alice-principal',
  })
  useThemeStore.setState({ appMode: 'analyzer' })
})
afterEach(() => vi.unstubAllGlobals())

function mount() {
  return render(
    <MemoryRouter>
      <DeveloperApiContext />
    </MemoryRouter>
  )
}

describe('observed Developer API context', () => {
  it('shows server routing and configured provider without claiming an observed account', async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) =>
      json({
        status: 'success',
        data:
          url === '/auth/analyzer-mode'
            ? { analyze_mode: false }
            : { broker_name: 'Reported provider' },
      })
    )
    vi.stubGlobal('fetch', fetcher)
    mount()
    expect(await screen.findByText('Reported provider')).toBeVisible()
    expect(screen.getByText('Broker API — orders may be real')).toBeVisible()
    expect(screen.getByText('Not reported by this API')).toBeVisible()
    expect(screen.getByText(/does not verify an account/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Connections & Data' })).toHaveAttribute(
      'href',
      '/settings/connections'
    )
    expect(useThemeStore.getState().appMode).toBe('analyzer')
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/broker/capabilities',
      '/auth/analyzer-mode',
    ])
    expect(
      fetcher.mock.calls.every(
        ([, init]) =>
          (init?.headers as Record<string, string>)['X-Chartly-Principal'] === 'alice-principal'
      )
    ).toBe(true)
  })

  it('reports observed legacy sandbox rather than a profile paper account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ status: 'success', data: { analyze_mode: true } }))
    )
    mount()
    expect(await screen.findByText('Legacy sandbox')).toBeVisible()
    expect(screen.getByText(/separate from profile paper trading/)).toBeVisible()
  })

  it('keeps failed/HTML observations unknown and does not fall back to cached session labels', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/auth/analyzer-mode'
          ? new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } })
          : json({ status: 'error' }, 401)
      )
    )
    mount()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh status' })).toBeEnabled()
    )
    expect(
      within(screen.getByRole('region', { name: 'Developer API context' })).getAllByText('Unknown')
    ).toHaveLength(2)
    expect(screen.queryByText('cached-provider')).not.toBeInTheDocument()
  })

  it('refreshes observations without retaining a stale successful route after failure', async () => {
    let healthy = true
    const fetcher = vi.fn(async () =>
      healthy
        ? json({ status: 'success', data: { analyze_mode: true, broker_name: 'Old provider' } })
        : json({ status: 'error' }, 503)
    )
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    mount()
    expect(await screen.findByText('Legacy sandbox')).toBeVisible()
    healthy = false
    await user.click(screen.getByRole('button', { name: 'Refresh status' }))
    await waitFor(() => expect(screen.getAllByText('Unknown')).toHaveLength(2))
    expect(screen.queryByText('Old provider')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('discards delayed observations when the local owner changes', async () => {
    const resolveOld: ((value: Response) => void)[] = []
    let owner = 'alice'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        owner === 'alice'
          ? await new Promise<Response>((resolve) => resolveOld.push(resolve))
          : json({ status: 'success', data: { analyze_mode: false, broker_name: 'Bob provider' } })
      )
    )
    mount()
    await waitFor(() => expect(resolveOld).toHaveLength(2))
    owner = 'bob'
    act(() =>
      useAuthStore.setState({
        localPrincipalId: 'bob-principal',
        user: {
          username: 'bob',
          broker: null,
          isLoggedIn: false,
          loginTime: null,
        },
      })
    )
    expect(await screen.findByText('Bob provider')).toBeVisible()
    await act(async () => {
      for (const resolve of resolveOld)
        resolve(
          json({ status: 'success', data: { analyze_mode: true, broker_name: 'Alice provider' } })
        )
    })
    expect(screen.queryByText('Alice provider')).not.toBeInTheDocument()
    expect(screen.getByText('Broker API — orders may be real')).toBeVisible()
  })
})
