import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCSRFToken } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'
import { emptyTraderTables } from './browserSnapshot'
import { localStorageClient } from './localStorageClient'

vi.mock('@/api/client', () => ({ fetchCSRFToken: vi.fn() }))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.setState({ localPrincipalId: null })
})
describe('account-scoped recovery status transport', () => {
  it('captures the current principal on reads and discards JSON resolved after an owner change', async () => {
    const firstPrincipal = `principal_${'a'.repeat(32)}`
    const nextPrincipal = `principal_${'b'.repeat(32)}`
    useAuthStore.setState({ localPrincipalId: firstPrincipal })
    let resolve!: (value: unknown) => void
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((done) => {
          resolve = done
        }),
    }))
    vi.stubGlobal('fetch', request)
    const reading = localStorageClient.context()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    expect(new Headers(request.mock.calls[0][1].headers).get('X-Chartly-Principal')).toBe(
      firstPrincipal
    )
    useAuthStore.setState({ localPrincipalId: nextPrincipal })
    resolve({ authenticated: true, workspaces: [] })
    await expect(reading).rejects.toMatchObject({ code: 'auth.changed', status: 401 })
  })
  it('uses authenticated same-origin credentials and rejects denied status responses', async () => {
    const request = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          code: 'account.authentication_required',
          message: 'Sign in to your local account.',
        },
      }),
    }))
    vi.stubGlobal('fetch', request)
    await expect(localStorageClient.recoveryStatus()).rejects.toMatchObject({
      status: 401,
      code: 'account.authentication_required',
    })
    expect(request).toHaveBeenCalledWith(
      '/api/local/v1/recovery/status',
      expect.objectContaining({ credentials: 'include' })
    )
  })
  it('sends no workspace PUT if the owner changes while CSRF is being fetched', async () => {
    let resolve!: (value: string) => void
    vi.mocked(fetchCSRFToken).mockReturnValueOnce(
      new Promise<string>((done) => {
        resolve = done
      })
    )
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    let current = true
    const tables = emptyTraderTables()
    const saving = localStorageClient.save(
      { originId: 'same-origin', revision: 1, tables, active: true },
      tables,
      'write-one',
      {
        principalId: 'alice',
        isCurrent: () => current,
      }
    )
    current = false
    resolve('new-session-token')
    await expect(saving).rejects.toMatchObject({ code: 'auth.changed', status: 401 })
    expect(request).not.toHaveBeenCalled()
  })
  it.each([
    true,
    false,
  ])('keeps save compatibility and includes a captured principal only when provided (%s)', async (scoped) => {
    vi.mocked(fetchCSRFToken).mockResolvedValueOnce('csrf')
    const tables = emptyTraderTables()
    const state = { originId: 'same-origin', revision: 1, tables, active: true }
    const request = vi.fn(async () => ({ ok: true, status: 200, json: async () => state }))
    vi.stubGlobal('fetch', request)
    await localStorageClient.save(
      state,
      tables,
      'write-one',
      scoped ? { principalId: 'alice', isCurrent: () => true } : undefined
    )
    const init = request.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('X-Chartly-Principal')).toBe(scoped ? 'alice' : null)
    expect(init.credentials).toBe('include')
  })
})
