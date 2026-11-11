import { fetchCSRFToken } from '@/api/client'
import { LocalStorageError } from './localStorageClient'

export interface ArtifactTemplate {
  id: string
  name: string
  kind: 'indicator' | 'strategy'
  description: string
  language: string
}
export interface ArtifactProjectSummary {
  id: string
  revision: number
  name: string
  kind: 'indicator' | 'strategy'
  language: string
  state: string
  updatedAt: string
  draftRevision: number
  diagnostics: string[]
  revisionCount: number
}
export interface ArtifactBundle {
  id: string
  revision: number
  project: {
    id: string
    name: string
    kind: 'indicator' | 'strategy'
    language: string
    state: string
  }
  draft: {
    source: unknown
    baseRevisionId: string | null
    draftRevision: number
    diagnostics: string[]
  }
  revisions: {
    id: string
    checksum: string
    createdAt: string
    dependencies: { revisionId: string; checksum: string }[]
  }[]
  parameterSets: {
    id: string
    artifactRevisionId: string
    values: Record<string, string>
    origin: string
  }[]
  attachments: {
    id: string
    chartDocumentId: string
    artifactRevisionId: string
    parameterSetId: string
    revision: number
  }[]
}
export interface PreviewResult {
  planChecksum: string
  rows: { time: string; outputs: Record<string, string | boolean | null> }[]
  forming: { included: boolean; reason?: string; provisional?: boolean; outputs: unknown } | null
}
export type StrategyAction =
  | 'create'
  | 'create-from-template'
  | 'save-draft'
  | 'create-revision'
  | 'attach'
  | 'upgrade-attachment'
  | 'clone'
  | 'export'
  | 'import'
  | 'archive'
  | 'preview'

const BASE = '/api/local/v1/strategy-artifacts'

async function request<T>(
  path: string,
  init: RequestInit = {},
  principalId?: string
): Promise<T> {
  const headers = new Headers(init.headers)
  if (principalId && !headers.has('X-Chartly-Principal'))
    headers.set('X-Chartly-Principal', principalId)
  const method = (init.method ?? 'GET').toUpperCase()
  if (method !== 'GET') {
    const csrf = await fetchCSRFToken()
    if (!csrf)
      throw new LocalStorageError('csrf.unavailable', 'Sign in again to save strategy projects.')
    headers.set('X-CSRFToken', csrf)
  }
  if (init.body) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch (cause) {
    throw new LocalStorageError(
      'storage.offline',
      'The local engine is unavailable. Your draft text is retained in the editor; reconnect and retry.',
      0,
      cause
    )
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new LocalStorageError(
      body.error?.code ?? 'artifact.request_failed',
      body.error?.message ?? 'The project could not be updated. Reload its saved state and review.',
      response.status,
      body.error?.issues
    )
  }
  return response.json() as Promise<T>
}

export interface StrategyRequest {
  originId: string
  projectId?: string
  expectedRevision: number
  expectedDraftRevision?: number
  action: StrategyAction
  payload: Record<string, unknown>
}

export const strategyArtifactClient = {
  templates: (signal?: AbortSignal, principalId?: string) =>
    request<{ templates: ArtifactTemplate[] }>('/templates', { signal }, principalId),
  list: (originId: string, signal?: AbortSignal, principalId?: string) =>
    request<{ projects: ArtifactProjectSummary[] }>(
      `/?originId=${encodeURIComponent(originId)}`,
      { signal },
      principalId
    ),
  detail: (originId: string, id: string, signal?: AbortSignal, principalId?: string) =>
    request<{ project: ArtifactBundle }>(
      `/${encodeURIComponent(id)}?originId=${encodeURIComponent(originId)}`,
      { signal },
      principalId
    ),
  action: (body: StrategyRequest, signal?: AbortSignal, principalId?: string) =>
    request<{ project?: ArtifactBundle; package?: unknown } & Partial<PreviewResult>>(
      '/action',
      { method: 'POST', body: JSON.stringify(body), signal },
      principalId
    ),
}
