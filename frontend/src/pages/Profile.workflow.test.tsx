import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webClient } from '@/api/client'
import { useAlertStore } from '@/stores/alertStore'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import Profile from './Profile'

vi.mock('@/api/client', () => ({ webClient: { get: vi.fn(), post: vi.fn() } }))
vi.mock('@/components/auth/TwoFactorEnforcement', () => ({ default: () => null }))
vi.mock('@/utils/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn() },
  toast: { dismiss: vi.fn() },
}))
beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    localPrincipalId: null,
    user: {
      username: 'alice',
      broker: null,
      isLoggedIn: false,
      loginTime: null,
      isLocalGuest: false,
    },
  })
  useThemeStore.setState({ mode: 'light', color: 'zinc', appMode: 'analyzer' })
  vi.mocked(webClient.get).mockResolvedValue({
    data: {
      status: 'success',
      data: {
        username: 'alice',
        smtp_settings: null,
      },
    },
  })
})

describe('global account appearance without execution-mode coupling', () => {
  it('clears security metadata on owner change and discards a late previous owner response', async () => {
    let resolveBob!: (response: unknown) => void
    vi.mocked(webClient.get).mockImplementation(async () => {
      const username = useAuthStore.getState().user?.username
      if (username === 'bob')
        return await new Promise((resolve) => {
          resolveBob = resolve
        })
      return {
        data: {
          status: 'success',
          data: {
            username,
            smtp_settings: null,
            qr_code: 'fixture-qr',
            totp_secret: `private-${username}`,
          },
        },
      }
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('tab', { name: 'TOTP' }))
    expect(screen.getByText('private-alice')).toBeVisible()
    act(() =>
      useAuthStore.setState({
        user: { username: 'bob', broker: null, isLoggedIn: false, loginTime: null },
        localPrincipalId: 'bob-principal',
      })
    )
    expect(screen.queryByText('private-alice')).not.toBeInTheDocument()
    await waitFor(() => expect(resolveBob).toBeTypeOf('function'))
    act(() =>
      useAuthStore.setState({
        user: { username: 'carol', broker: null, isLoggedIn: false, loginTime: null },
        localPrincipalId: 'carol-principal',
      })
    )
    await user.click(await screen.findByRole('tab', { name: 'TOTP' }))
    expect(screen.getByText('private-carol')).toBeVisible()
    await act(async () => {
      resolveBob({
        data: {
          status: 'success',
          data: {
            username: 'bob',
            smtp_settings: null,
            qr_code: 'old-qr',
            totp_secret: 'private-bob',
          },
        },
      })
    })
    expect(screen.queryByText('private-bob')).not.toBeInTheDocument()
    expect(screen.getByText('private-carol')).toBeVisible()
    expect(webClient.get).toHaveBeenLastCalledWith('/auth/profile-data', {
      headers: { 'X-Chartly-Principal': 'carol-principal' },
    })
  })

  it('shows a personal workspace without generated identity, admin claims or unusable account security forms', async () => {
    useAuthStore.setState({
      user: {
        username: '__personal_generated',
        broker: null,
        isLoggedIn: false,
        loginTime: null,
        isLocalGuest: true,
      },
    })
    vi.mocked(webClient.get).mockResolvedValue({
      data: {
        status: 'success',
        data: {
          username: '__personal_generated',
          local_guest: true,
          smtp_settings: null,
          qr_code: 'old-sensitive-qr',
          totp_secret: 'old-sensitive-secret',
        },
      },
    })
    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    )
    expect(await screen.findByText('Personal workspace access')).toBeVisible()
    expect(screen.getByDisplayValue('Local workspace')).toBeVisible()
    expect(screen.getByText('Personal PC')).toBeVisible()
    expect(screen.queryByText('Administrator')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('__personal_generated')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Enter your current password')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'SMTP' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'TOTP' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    expect(screen.getByRole('link', { name: 'Backup & restore' })).toHaveAttribute(
      'href',
      '/settings/storage'
    )
    expect(webClient.post).not.toHaveBeenCalled()
  })

  it('changes light/dark/accent and resets even when the stored legacy routing value is analyzer', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('tab', { name: 'Theme' }))
    expect(
      screen.queryByText(/Theme Changes Disabled|Purple Theme|Switch back to Live/)
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Dark/ }))
    await user.click(screen.getByRole('button', { name: 'Blue' }))
    expect(useThemeStore.getState()).toMatchObject({
      mode: 'dark',
      color: 'blue',
      appMode: 'analyzer',
    })
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(useThemeStore.getState()).toMatchObject({
      mode: 'light',
      color: 'zinc',
      appMode: 'analyzer',
    })
    expect(webClient.post).not.toHaveBeenCalled()
  })

  it('preserves the existing legacy alert preference with a scope-specific display label', async () => {
    const user = userEvent.setup()
    const original = useAlertStore.getState().categories.analyzer
    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('tab', { name: 'Alerts' }))
    expect(screen.getAllByText('Legacy sandbox API')[0]).toBeVisible()
    expect(useAlertStore.getState().categories.analyzer).toBe(original)
    expect(webClient.post).not.toHaveBeenCalled()
  })
})
