import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCSRFToken } from '@/api/client'
import { paperClient } from './paperClient'

vi.mock('@/api/client', () => ({ fetchCSRFToken: vi.fn(async () => 'proof') }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
describe('owned historical paper transport', () => {
  it('sends only normalized command intent with local CSRF and cookie authentication', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ session: null }) }))
    vi.stubGlobal('fetch', fetch)
    const body = {
      originId: 'origin-one',
      runId: 2,
      expectedRevision: 4,
      requestId: 'stable-command',
      action: 'advance' as const,
      payload: { count: 1 },
    }
    await paperClient.action(body)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/local/v1/paper/action')
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('X-CSRFToken')).toBe('proof')
    expect(JSON.parse(String(init.body))).toEqual(body)
    expect(String(init.body)).not.toMatch(/price|cash|equity|asOf|api_key|broker/)
  })
  it('reads only the requested origin/run and aborts old source reads', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ session: null }) }))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    await paperClient.session('origin with spaces', 3, signal)
    expect(fetch.mock.calls[0][0]).toBe(
      '/api/local/v1/paper/session?originId=origin+with+spaces&runId=3'
    )
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({
      signal,
      credentials: 'include',
    })
    expect(fetchCSRFToken).not.toHaveBeenCalled()
  })
  it('retains server error identity for definite conflict review', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          error: { code: 'paper.revision_conflict', message: 'Reload the paper account.' },
        }),
      }))
    )
    await expect(
      paperClient.action({
        originId: 'one',
        runId: 1,
        expectedRevision: 2,
        requestId: 'same',
        action: 'advance',
        payload: { count: 1 },
      })
    ).rejects.toMatchObject({
      code: 'paper.revision_conflict',
      status: 409,
      message: 'Reload the paper account.',
    })
  })
  it('refuses a mutation without CSRF before any request leaves', async () => {
    vi.mocked(fetchCSRFToken).mockResolvedValueOnce(null)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(
      paperClient.action({
        originId: 'one',
        runId: 1,
        expectedRevision: 0,
        requestId: 'same',
        action: 'prepare',
        payload: {},
      })
    ).rejects.toMatchObject({ code: 'csrf.unavailable' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
