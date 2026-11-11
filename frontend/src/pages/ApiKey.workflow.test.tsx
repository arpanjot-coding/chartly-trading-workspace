import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import ApiKey from './ApiKey'

vi.mock('@/utils/toast', () => ({ showToast: { success: vi.fn(), error: vi.fn() } }))
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
let fetcher: ReturnType<typeof vi.fn>
beforeEach(() => {
  useAuthStore.setState({
    user: { username: 'alice', broker: null, isLoggedIn: false, loginTime: null },
    apiKey: null,
    localPrincipalId: null,
    isAuthenticated: false,
  })
  fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/apikey')
      return json(
        init?.method === 'POST'
          ? { api_key: 'new-fixture-key' }
          : { api_key: 'old-fixture-key', order_mode: 'auto' }
      )
    if (url === '/auth/csrf-token') return json({ csrf_token: 'fixture-csrf' })
    if (url === '/apikey/mode') return json({ mode: JSON.parse(String(init?.body)).mode })
    return json({})
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())

describe('Developer API keys and approval policy', () => {
  it('does not claim automatic approval when the stored policy could not be observed', async () => {
    fetcher.mockImplementation(async () => json({ status: 'error' }))
    render(
      <MemoryRouter>
        <ApiKey />
      </MemoryRouter>
    )
    expect(await screen.findByText(/Reload this page to observe the stored policy/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Automatic approval' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Review before execution' })).toBeDisabled()
    expect(fetcher.mock.calls.some(([path]) => path === '/apikey/mode')).toBe(false)
  })

  it('keeps backend approval routing distinct from sandbox or account readiness', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ApiKey />
      </MemoryRouter>
    )
    expect(await screen.findByText('Broker API approval policy')).toBeVisible()
    expect(screen.getByText(/does not guarantee broker execution/)).toBeVisible()
    expect(screen.queryByText(/All orders will execute immediately/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review before execution' }))
    expect(await screen.findByRole('link', { name: 'Automation approvals' })).toHaveAttribute(
      'href',
      '/action-center'
    )
    const request = fetcher.mock.calls.find(([path]) => path === '/apikey/mode')!
    expect(request[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': 'fixture-csrf',
      },
    })
    expect(JSON.parse(request[1].body)).toEqual({ mode: 'semi_auto' })
    expect(fetcher.mock.calls.some(([path]) => String(path).includes('analyzer-toggle'))).toBe(
      false
    )
  })

  it('preserves reveal, copy, regeneration and the Playground destination', async () => {
    useAuthStore.setState({ localPrincipalId: 'fixture-principal' })
    const user = userEvent.setup()
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(
      <MemoryRouter>
        <ApiKey />
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('button', { name: 'Show API key' }))
    expect(screen.getByText('old-fixture-key')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(copy).toHaveBeenCalledWith('old-fixture-key')
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    const dialog = screen.getByRole('dialog', { name: 'Regenerate API Key?' })
    await user.click(within(dialog).getByRole('button', { name: 'Regenerate' }))
    expect(await screen.findByText('new-fixture-key')).toBeVisible()
    expect(useAuthStore.getState().apiKey).toBe('new-fixture-key')
    expect(
      fetcher.mock.calls.find(([path, init]) => path === '/apikey' && init?.method === 'POST')?.[1]
    ).toMatchObject({
      method: 'POST',
      headers: { 'X-CSRFToken': 'fixture-csrf', 'X-Chartly-Principal': 'fixture-principal' },
      body: '{}',
    })
    expect(
      fetcher.mock.calls.find(([path, init]) => path === '/apikey' && !init?.method)?.[1].headers
    ).toMatchObject({ 'X-Chartly-Principal': 'fixture-principal' })
    expect(screen.getByRole('link', { name: /Open Playground/ })).toHaveAttribute(
      'href',
      '/playground'
    )
  })

  it('discards an old key response and reloads when the principal changes', async () => {
    let resolveOld!: (response: Response) => void
    let fresh = false
    fetcher.mockImplementation(async (url: string) => {
      if (url === '/apikey')
        return fresh
          ? json({ api_key: 'new-owner-key', order_mode: 'semi_auto' })
          : await new Promise<Response>((resolve) => {
              resolveOld = resolve
            })
      return json({})
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ApiKey />
      </MemoryRouter>
    )
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'))
    fresh = true
    act(() => useAuthStore.setState({ localPrincipalId: 'replacement-owner' }))
    await user.click(await screen.findByRole('button', { name: 'Show API key' }))
    expect(screen.getByText('new-owner-key')).toBeVisible()
    await act(async () => {
      resolveOld(json({ api_key: 'private-old-key', order_mode: 'auto' }))
    })
    expect(screen.queryByText('private-old-key')).not.toBeInTheDocument()
    expect(useAuthStore.getState().apiKey).toBe('new-owner-key')
  })

  it('does not submit an old owner regeneration after a delayed CSRF response', async () => {
    let resolveCsrf!: (response: Response) => void
    fetcher.mockImplementation(async (url: string) =>
      url === '/auth/csrf-token'
        ? await new Promise<Response>((resolve) => {
            resolveCsrf = resolve
          })
        : url === '/apikey'
          ? json({ api_key: 'current-owner-key', order_mode: 'auto' })
          : json({})
    )
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ApiKey />
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('button', { name: 'Regenerate' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(resolveCsrf).toBeTypeOf('function'))
    act(() => useAuthStore.setState({ localPrincipalId: 'replacement-owner' }))
    await act(async () => {
      resolveCsrf(json({ csrf_token: 'old-csrf' }))
    })
    expect(
      fetcher.mock.calls.some(([path, init]) => path === '/apikey' && init?.method === 'POST')
    ).toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('discards a regeneration response delivered after switching users', async () => {
    let resolvePost!: (response: Response) => void
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/auth/csrf-token') return json({ csrf_token: 'fixture' })
      if (url === '/apikey' && init?.method === 'POST')
        return await new Promise<Response>((resolve) => {
          resolvePost = resolve
        })
      if (url === '/apikey')
        return json({
          api_key: useAuthStore.getState().user?.username === 'alice' ? 'alice-key' : 'bob-key',
        })
      return json({})
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ApiKey />
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('button', { name: 'Regenerate' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(resolvePost).toBeTypeOf('function'))
    act(() =>
      useAuthStore.setState({
        user: { username: 'bob', broker: null, isLoggedIn: false, loginTime: null },
      })
    )
    await user.click(await screen.findByRole('button', { name: 'Show API key' }))
    expect(screen.getByText('bob-key')).toBeVisible()
    await act(async () => {
      resolvePost(json({ api_key: 'alice-regenerated-key' }))
    })
    expect(screen.queryByText('alice-regenerated-key')).not.toBeInTheDocument()
    expect(useAuthStore.getState().apiKey).toBe('bob-key')
  })
})
