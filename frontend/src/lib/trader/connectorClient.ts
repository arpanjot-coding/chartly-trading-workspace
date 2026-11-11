import { fetchCSRFToken } from '@/api/client'
import { LocalStorageError, type WorkspaceState } from './localStorageClient'

export interface ConnectorCapability {
  id: string
  label: string
  state?: string
  supported: boolean
  reason?: string
  verifiedAt?: string
}
export interface ConnectorProvider {
  id: string
  name: string
  version: string
  kind: string
  category: 'brokerage' | 'crypto' | 'desktop' | 'diagnostic'
  connectionMode: 'account' | 'public-data' | 'diagnostic'
  setupState: 'available' | 'prerequisites' | 'planned'
  actionHref?: string
  synthetic: boolean
  available: boolean
  reason?: string
  environments: string[]
  capabilities: ConnectorCapability[]
}
export interface ConnectorHistory {
  observations: number
  confirmed: number
  conflicts: number
  coverage: { from: string; to: string; complete: boolean; reason?: string }[]
  cursor?: {
    nativeCursor: string | null
    window: { from: string; to: string }
    observedThrough?: string
  } | null
  lastSyncedAt?: string
  rows?: {
    id?: string
    externalEventId?: string
    kind?: string
    status?: string
    occurredAt?: string
    timeBasis?: 'receipt-only'
    [key: string]: unknown
  }[]
  summary?: {
    pendingCorrections?: number
    corrections?: {
      id: string
      summary: string
      changedFields: { field: string; before: unknown; after: unknown }[]
    }[]
  }
  nextOffset?: number | null
  offset?: number
  suggestedWindow?: { from: string; to: string }
  overlapSeconds?: number
  maxWindowDays?: number
}
export interface ConnectorConnection {
  id: string
  revision: number
  label: string
  providerId: string
  profileId?: number
  state: string
  health: string
  observedAt?: string
  requiresVerification?: boolean
  identity?: {
    displayName?: string
    externalIdMasked: string
    server: string
    environment: string
    currency: string
    synthetic: boolean
  }
  accountId?: number
  bookId?: string
  active?: boolean
  capabilities?: ConnectorCapability[]
  credential?: { status: string; generation: number }
  history?: ConnectorHistory
  reason?: string
  failure?: { code: string; message: string; retryAt?: string }
  configuration?: Record<string, unknown>
  conformance?: {
    readiness: string
    passed: boolean
    checks: { id: string; passed: boolean; reason?: string }[]
    synthetic: boolean
    checkedAt?: string
  }
}
export type ConnectorAction =
  | 'create'
  | 'set-secret'
  | 'probe'
  | 'link'
  | 'sync'
  | 'disconnect'
  | 'revoke'
  | 'archive'
  | 'conformance'
  | 'apply-corrections'
  | 'configure'
export interface ConnectorRequest {
  originId: string
  connectionId?: string
  expectedRevision: number
  requestId: string
  action: ConnectorAction
  payload: Record<string, unknown>
}
export interface ConnectorResponse {
  connection?: ConnectorConnection
  workspace?: WorkspaceState
  receipt?: unknown
}
const BASE = '/api/local/v1/connectors'
async function request<T>(path: string, init: RequestInit = {}, principalId?: string): Promise<T> {
  const headers = new Headers(init.headers)
  if (principalId) headers.set('X-Chartly-Principal', principalId)
  if ((init.method ?? 'GET') !== 'GET') {
    const token = await fetchCSRFToken()
    if (!token)
      throw new LocalStorageError('csrf.unavailable', 'Sign in again before changing a connection.')
    headers.set('X-CSRFToken', token)
  }
  if (init.body) headers.set('Content-Type', 'application/json')
  init.signal?.throwIfAborted()
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch (cause) {
    if (init.signal?.aborted) throw cause
    throw new LocalStorageError(
      'connector.offline',
      'The local engine is unavailable. Keep this screen open to retry the same reviewed request.'
    )
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new LocalStorageError(
      body.error?.code ?? 'connector.request_failed',
      body.error?.message ??
        'The connection could not be updated. Reload its saved state and review the next step.',
      response.status,
      body.error?.issues
    )
  }
  return response.json() as Promise<T>
}
const scoped = (originId: string) => new URLSearchParams({ originId })
export const connectorClient = {
  providers: (signal?: AbortSignal, principalId?: string) =>
    request<{ providers: ConnectorProvider[] }>('/providers', { signal }, principalId),
  list: (originId: string, profileId?: number, signal?: AbortSignal, principalId?: string) => {
    const params = scoped(originId)
    if (profileId) params.set('profileId', String(profileId))
    return request<{ connections: ConnectorConnection[]; providers?: ConnectorProvider[] }>(
      `/?${params}`,
      { signal },
      principalId
    )
  },
  detail: (originId: string, id: string, signal?: AbortSignal, principalId?: string) =>
    request<{ connection: ConnectorConnection }>(
      `/${encodeURIComponent(id)}?${scoped(originId)}`,
      { signal },
      principalId
    ),
  history: async (
    originId: string,
    id: string,
    signal?: AbortSignal,
    offset = 0,
    principalId?: string
  ) => {
    const result = await request<{
      connection?: ConnectorConnection
      history:
        | ConnectorHistory
        | {
            observations: Record<string, unknown>[]
            conflicts: unknown[]
            coverage: ConnectorHistory['coverage']
            total: number
            offset: number
            limit: number
          }
    }>(
      `/${encodeURIComponent(id)}/history?${scoped(originId)}&offset=${offset}&limit=100`,
      { signal },
      principalId
    )
    if (!Array.isArray(result.history.observations))
      return result as { connection?: ConnectorConnection; history: ConnectorHistory }
    const page = result.history as {
      observations: Record<string, unknown>[]
      conflicts: unknown[]
      coverage: ConnectorHistory['coverage']
      total: number
      offset: number
      limit: number
    }
    const summary = result.connection?.history
    if (!summary || !Number.isSafeInteger(page.total) || !Number.isSafeInteger(summary.confirmed))
      throw new LocalStorageError(
        'connector.invalid_response',
        'Saved observations could not be verified. Reload this connection before reviewing history.'
      )
    return {
      connection: result.connection,
      history: {
        ...summary,
        observations: page.total,
        coverage: page.coverage,
        offset: page.offset,
        nextOffset:
          page.offset + page.observations.length < page.total
            ? page.offset + page.observations.length
            : null,
        rows: page.observations.map((value) => {
          const event =
            value.event && typeof value.event === 'object'
              ? (value.event as Record<string, unknown>)
              : {}
          return {
            ...(typeof value.id === 'string' ? { id: value.id } : {}),
            ...(typeof event.externalEventId === 'string'
              ? { externalEventId: event.externalEventId }
              : {}),
            ...(typeof event.kind === 'string' ? { kind: event.kind } : {}),
            ...(typeof event.status === 'string' ? { status: event.status } : {}),
            ...(typeof event.occurredAt === 'string' ? { occurredAt: event.occurredAt } : {}),
            ...(event.timeBasis === 'receipt-only' ? { timeBasis: 'receipt-only' as const } : {}),
          }
        }),
      },
    }
  },
  action: (body: ConnectorRequest, signal?: AbortSignal, principalId?: string) =>
    request<ConnectorResponse>(
      '/action',
      { method: 'POST', body: JSON.stringify(body), signal },
      principalId
    ),
}
