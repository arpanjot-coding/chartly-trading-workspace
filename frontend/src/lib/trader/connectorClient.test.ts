import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCSRFToken } from '@/api/client'
import { connectorClient } from './connectorClient'

vi.mock('@/api/client', () => ({ fetchCSRFToken: vi.fn() }))
const fakeFetch = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fakeFetch)
  vi.mocked(fetchCSRFToken).mockResolvedValue('csrf-token')
  fakeFetch.mockResolvedValue({ ok: true, json: async () => ({ connections: [] }) })
})
afterEach(() => vi.unstubAllGlobals())
describe('private connector transport', () => {
  it('sends only reviewed commands with local cookie and CSRF, never a browser-supplied health grant', async () => {
    const body = {
      originId: 'origin-one',
      requestId: 'request-one',
      expectedRevision: 0,
      action: 'create' as const,
      payload: { providerId: 'fake', label: 'Source', configuration: {} },
    }
    await connectorClient.action(body)
    const [url, init] = fakeFetch.mock.calls[0]
    expect(url).toBe('/api/local/v1/connectors/action')
    expect(init.credentials).toBe('include')
    expect(init.headers.get('X-CSRFToken')).toBe('csrf-token')
    expect(JSON.parse(init.body)).toEqual(body)
  })
  it('aborts before fetching a command if owner changes during CSRF resolution', async () => {
    const controller = new AbortController()
    vi.mocked(fetchCSRFToken).mockImplementation(async () => {
      controller.abort()
      return 'csrf-token'
    })
    await expect(
      connectorClient.action(
        {
          originId: 'origin-one',
          expectedRevision: 1,
          requestId: 'request-one',
          action: 'probe',
          connectionId: 'one',
          payload: {},
        },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fakeFetch).not.toHaveBeenCalled()
  })
  it('keeps the reviewed principal when only the cookie changes during CSRF, so the server rejects the stale create', async () => {
    let csrfReady!: (value: string) => void
    vi.mocked(fetchCSRFToken).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        csrfReady = resolve
      })
    )
    let cookiePrincipal = 'owner-one'
    let saved = 0
    fakeFetch.mockImplementation(async (_url, init) => {
      if (init.headers.get('X-Chartly-Principal') !== cookiePrincipal)
        return {
          ok: false,
          status: 403,
          json: async () => ({
            error: {
              code: 'account.scope_changed',
              message: 'Sign in again to confirm the current account.',
            },
          }),
        }
      saved++
      return { ok: true, json: async () => ({ connection: { id: 'foreign-connection' } }) }
    })
    const request = connectorClient.action(
      {
        originId: 'same-origin',
        expectedRevision: 0,
        requestId: 'stale-create',
        action: 'create',
        payload: { providerId: 'diagnostic', label: 'Reviewed by first owner', configuration: {} },
      },
      undefined,
      'owner-one'
    )
    // Another tab changed the session cookie, without updating this tab's owner store or aborting its signal.
    cookiePrincipal = 'owner-two'
    csrfReady('second-owner-csrf')
    await expect(request).rejects.toMatchObject({ code: 'account.scope_changed', status: 403 })
    expect(fakeFetch.mock.calls[0][1].headers.get('X-Chartly-Principal')).toBe('owner-one')
    expect(saved).toBe(0)
  })
  it.each([
    'providers',
    'list',
    'detail',
    'history',
  ] as const)('scopes the %s read to the captured principal when the cookie-only owner has changed', async (method) => {
    fakeFetch.mockImplementation(async (_url, init) => ({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          code:
            init.headers.get('X-Chartly-Principal') === 'owner-one'
              ? 'account.scope_changed'
              : 'unscoped',
          message: 'Sign in again to confirm the current account.',
        },
      }),
    }))
    const response =
      method === 'providers'
        ? connectorClient.providers(undefined, 'owner-one')
        : method === 'list'
          ? connectorClient.list('same-origin', 7, undefined, 'owner-one')
          : method === 'detail'
            ? connectorClient.detail('same-origin', 'connection-one', undefined, 'owner-one')
            : connectorClient.history('same-origin', 'connection-one', undefined, 0, 'owner-one')
    await expect(response).rejects.toMatchObject({ code: 'account.scope_changed', status: 403 })
    expect(fakeFetch.mock.calls[0][1].headers.get('X-Chartly-Principal')).toBe('owner-one')
  })
  it('encodes scoped read identities and preserves actionable provider errors', async () => {
    await connectorClient.list('origin one', 7)
    expect(fakeFetch.mock.calls[0][0]).toContain('originId=origin+one&profileId=7')
    fakeFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: {
          code: 'connector.identity_changed',
          message: 'The terminal account changed. Recheck the expected account.',
        },
      }),
    })
    await expect(connectorClient.detail('origin-one', 'private-one')).rejects.toMatchObject({
      code: 'connector.identity_changed',
      status: 409,
      message: expect.stringContaining('terminal account changed'),
    })
  })
  it.each([
    undefined,
    'receipt-only',
    'provider-native',
    'Receipt-only',
  ])('normalizes bounded raw pages with only the exact receipt-only time marker (%s), without native payloads', async (timeBasis) => {
    fakeFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        connection: {
          history: {
            observations: 250,
            confirmed: 2,
            conflicts: 1,
            coverage: [],
            summary: { pendingCorrections: 1 },
          },
        },
        history: {
          total: 250,
          offset: 0,
          limit: 100,
          coverage: [],
          conflicts: [],
          observations: [
            {
              id: 'observation-one',
              event: {
                kind: 'deal',
                status: 'observed',
                occurredAt: '2026-11-03T09:00:00Z',
                timeBasis,
                payload: { account: 'private-native-id' },
              },
            },
          ],
        },
      }),
    })
    const response = await connectorClient.history('origin-one', 'connection-one')
    expect(response.history).toMatchObject({
      observations: 250,
      confirmed: 2,
      conflicts: 1,
      nextOffset: 1,
      summary: { pendingCorrections: 1 },
      rows: [
        {
          id: 'observation-one',
          kind: 'deal',
          status: 'observed',
          occurredAt: '2026-11-03T09:00:00Z',
        },
      ],
    })
    expect(response.history.rows?.[0]).not.toHaveProperty('payload')
    expect(response.history.rows?.[0].timeBasis).toBe(
      timeBasis === 'receipt-only' ? 'receipt-only' : undefined
    )
  })
})
