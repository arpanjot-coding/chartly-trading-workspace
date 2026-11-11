import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import Playground from './Playground'

vi.mock('@/components/ui/json-editor', () => ({
  JsonEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="Request JSON"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))
vi.mock('@/components/playground/WebSocketTesterPanel', () => ({
  WebSocketTesterPanel: () => <div>WebSocket testing retained</div>,
}))
vi.mock('@/utils/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  })
let fetcher: ReturnType<typeof vi.fn>
beforeEach(() => {
  useAuthStore.setState({
    user: { username: 'alice', broker: null, isLoggedIn: false, loginTime: null },
    isAuthenticated: false,
    localPrincipalId: null,
  })
  useThemeStore.setState({ mode: 'light', appMode: 'analyzer' })
  fetcher = vi.fn(async (url: string) => {
    if (url === '/playground/endpoints')
      return json({
        account: [
          { name: 'Account funds', path: '/api/v1/funds', method: 'POST', body: {} },
          { name: 'Routing diagnostic', path: '/api/v1/analyzer', method: 'POST', body: {} },
          { name: 'Toggle routing', path: '/api/v1/analyzer/toggle', method: 'POST', body: {} },
        ],
        data: [
          { name: 'Untrusted URL', path: 'https://outside.example/api/v1/history', method: 'POST' },
        ],
      })
    if (url === '/playground/api-key') return json({ api_key: 'fixture-key' })
    if (url === '/auth/csrf-token') return json({ csrf_token: 'fixture-csrf' })
    if (url === '/api/v1/funds') return json({ status: 'success', data: { available: '1000.00' } })
    if (url === '/auth/analyzer-mode')
      return json({ status: 'success', data: { analyze_mode: false } })
    return json({})
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => vi.unstubAllGlobals())

function mount() {
  return render(
    <MemoryRouter>
      <Playground />
    </MemoryRouter>
  )
}

describe('Developer Playground workflow', () => {
  it('has no global routing switch and keeps appearance, REST and WS independent', async () => {
    const user = userEvent.setup()
    mount()
    expect(await screen.findByRole('button', { name: /Account funds/ })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /Switch to (Live|Analyze)/ })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Toggle routing/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Routing diagnostic/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'utilities' }))
    expect(screen.getByRole('button', { name: /Legacy routing status/ })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute('href', '/workspace')
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(useThemeStore.getState().mode).toBe('dark')
    expect(useThemeStore.getState().appMode).toBe('analyzer')
    await user.click(screen.getByRole('button', { name: 'WebSocket' }))
    expect(screen.getByText('WebSocket testing retained')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'REST API' }))
    expect(screen.getByRole('heading', { name: 'API Playground' })).toBeVisible()
    expect(
      fetcher.mock.calls.some(
        ([path]) =>
          String(path).includes('analyzer-toggle') || String(path).includes('analyzer/toggle')
      )
    ).toBe(false)
  })

  it('retains explicit read POST, key injection, edited body, CSRF and response display', async () => {
    useAuthStore.setState({ localPrincipalId: 'fixture-principal' })
    const user = userEvent.setup()
    mount()
    await screen.findByDisplayValue('fixture-key')
    await user.click(await screen.findByRole('button', { name: /Account funds/ }))
    expect(
      JSON.parse(
        (screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement).value
      )
    ).toEqual({ apikey: 'fixture-key' })
    expect(fetcher.mock.calls.some(([path]) => path === '/api/v1/funds')).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
      target: { value: '{"apikey":"fixture-key","extra":"edited"}' },
    })
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('200 OK')).toBeVisible()
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([path]) => path === '/api/v1/funds')).toBe(true)
    )
    const request = fetcher.mock.calls.find(([path]) => path === '/api/v1/funds')!
    expect(request[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-CSRFToken': 'fixture-csrf',
        'Content-Type': 'application/json',
        'X-Chartly-Principal': 'fixture-principal',
      },
      body: '{"apikey":"fixture-key","extra":"edited"}',
    })
    expect(screen.getByText('"1000.00"')).toBeVisible()
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await user.click(screen.getByRole('button', { name: 'cURL' }))
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('curl -X POST'))
    await user.click(screen.getByRole('button', { name: 'Copy response' }))
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('1000.00'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('retains the same-origin URL guard before sending a catalog request', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('button', { name: /Account funds/ })
    await user.click(screen.getByRole('button', { name: 'data' }))
    await user.click(screen.getByRole('button', { name: /Untrusted URL/ }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(fetcher.mock.calls.some(([path]) => String(path).includes('outside.example'))).toBe(
      false
    )
  })

  it('clears private tabs and results on owner change and ignores a delayed response', async () => {
    const originalFetch = fetcher.getMockImplementation()!
    let resolveRequest!: (response: Response) => void
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/funds')
        return await new Promise<Response>((resolve) => {
          resolveRequest = resolve
        })
      if (url === '/playground/api-key')
        return json({
          api_key: useAuthStore.getState().user?.username === 'alice' ? 'alice-key' : 'bob-key',
        })
      return await originalFetch(url, init)
    })
    const user = userEvent.setup()
    mount()
    await screen.findByDisplayValue('alice-key')
    await user.click(await screen.findByRole('button', { name: /Account funds/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Request JSON' }), {
      target: { value: '{"apikey":"alice-key","private":"alice-draft"}' },
    })
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(resolveRequest).toBeTypeOf('function'))
    act(() =>
      useAuthStore.setState({
        user: { username: 'bob', broker: null, isLoggedIn: false, loginTime: null },
      })
    )
    expect(screen.queryByRole('textbox', { name: 'Request JSON' })).not.toBeInTheDocument()
    await screen.findByDisplayValue('bob-key')
    await act(async () => {
      resolveRequest(json({ private: 'alice-response' }))
    })
    expect(screen.queryByText(/alice-response|alice-draft/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'API Playground' })).toBeVisible()
    await user.click(await screen.findByRole('button', { name: /Account funds/ }))
    expect(
      (screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement).value
    ).toContain('bob-key')
    expect(
      (screen.getByRole('textbox', { name: 'Request JSON' }) as HTMLTextAreaElement).value
    ).not.toContain('alice')
  })

  it('does not restore an old API key after the principal reloads', async () => {
    const originalFetch = fetcher.getMockImplementation()!
    let resolveKey!: (response: Response) => void
    let fresh = false
    fetcher.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/playground/api-key'
        ? fresh
          ? json({ api_key: 'fresh-key' })
          : await new Promise<Response>((resolve) => {
              resolveKey = resolve
            })
        : await originalFetch(url, init)
    )
    mount()
    await waitFor(() => expect(resolveKey).toBeTypeOf('function'))
    fresh = true
    act(() => useAuthStore.setState({ localPrincipalId: 'fresh-principal' }))
    await screen.findByDisplayValue('fresh-key')
    await act(async () => {
      resolveKey(json({ api_key: 'old-private-key' }))
    })
    expect(screen.queryByDisplayValue('old-private-key')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('fresh-key')).toBeVisible()
  })
})
