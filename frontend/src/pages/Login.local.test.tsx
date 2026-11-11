import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import Login, { localLoginDestination } from './Login'

vi.mock('@/utils/toast', () => ({ showToast: { success: vi.fn() } }))
beforeEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false, isLocalAuthenticated: false })
  vi.restoreAllMocks()
})
describe('local-purpose sign-in', () => {
  it('keeps exact saved-data and chart return contexts without allowing an open redirect', () => {
    for (const target of [
      '/workspace',
      '/profile',
      '/apikey',
      '/playground?request=history',
      '/workspace/profiles/7/replay?datasetVersionId=one',
      '/settings/storage',
      '/historify',
      '/historify/charts?datasetVersionId=one&returnTo=%2Fhistorify%3Fversion%3Done',
      '/trading?profileId=7&journalReturn=%2Fworkspace%2Fprofiles%2F7%2Fjournal',
    ])
      expect(localLoginDestination(target)).toBe(target)
    for (const target of [
      'https://outside.test',
      '//outside.test',
      '/\\outside.test',
      '/api/local/v1/datasets',
      '/historify/provider-tools',
      '/broker',
      '/apikey/another-owner',
      '/profile/security',
      '/playground/execute',
      '/historify\n/charts',
    ])
      expect(localLoginDestination(target)).toBe('/settings/storage')
  })
  it('retains the local return purpose through password and TOTP without granting broker auth', async () => {
    const calls: { url: string; body?: BodyInit | null }[] = []
    let localChecks = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        calls.push({ url: input, body: init?.body })
        if (input === '/auth/local-session') localChecks++
        const data =
          input === '/auth/check-setup'
            ? { needs_setup: false }
            : input === '/auth/local-session'
              ? localChecks === 1
                ? { authenticated: false }
                : {
                    authenticated: true,
                    principal: {
                      username: 'alice',
                      uid: 'principal_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    },
                  }
              : input === '/auth/csrf-token'
                ? { csrf_token: 'fixture' }
                : input === '/auth/login'
                  ? { status: 'totp_required' }
                  : { status: 'success', local_authenticated: true, redirect: '/settings/storage' }
        return {
          ok: input !== '/auth/local-session' || localChecks > 1,
          status: input === '/auth/local-session' && localChecks === 1 ? 401 : 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => data,
        }
      })
    )
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/login?purpose=local&next=/settings/storage']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/settings/storage" element={<h1>Storage recovery destination</h1>} />
        </Routes>
      </MemoryRouter>
    )
    await user.type(await screen.findByLabelText('Username'), 'alice')
    await user.type(screen.getByLabelText('Password'), 'fixture-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    const login = calls.find((call) => call.url === '/auth/login')!
    expect((login.body as FormData).get('purpose')).toBe('local')
    expect((login.body as FormData).get('next')).toBe('/settings/storage')
    expect(useAuthStore.getState().isLocalAuthenticated).toBe(false)
    fireEvent.change(await screen.findByLabelText('Authentication code'), {
      target: { value: '123456' },
    })
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(
      await screen.findByRole('heading', { name: 'Storage recovery destination' })
    ).toBeInTheDocument()
    expect(useAuthStore.getState().isLocalAuthenticated).toBe(true)
    expect(useAuthStore.getState().localPrincipalId).toBe(
      'principal_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user?.broker).toBeNull()
    expect(calls.some((call) => call.url === '/auth/session-status')).toBe(false)
    vi.unstubAllGlobals()
  })
})
