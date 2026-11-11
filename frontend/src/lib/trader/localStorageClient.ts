import { fetchCSRFToken } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'
import type { BrowserSnapshot, TraderTables } from './browserSnapshot'

export interface JournalBookSummary {
  id: string
  name: string
  kind: 'manual' | 'paper' | 'connected'
  profileId?: number
  profileIds?: number[]
  accountId?: number
  sessionId?: number
  identityState?: string
}
export interface WorkspaceState {
  originId: string
  revision: number
  stateRevision?: number
  generation?: number
  tables: TraderTables
  active: boolean
  books?: JournalBookSummary[]
  bookAssignments?: Record<string, string>
  nativeCatalogs?: BrowserSnapshot['nativeCatalogs']
  preferences?: BrowserSnapshot['preferences']
  attachments?: BrowserSnapshot['attachments']
  datasetManifests?: unknown[]
  receipt?: unknown
}
export interface LocalContext {
  authenticated: boolean
  setupRequired: boolean
  principalId?: string
  activeOriginId?: string | null
  workspaces: { originId: string; revision: number; name?: string }[]
  revision?: number
}
export interface MigrationIssue {
  id: string
  kind: string
  message: string
  choices?: string[]
  table?: string
  recordId?: number
}
export interface MigrationPreview {
  id: string
  originId?: string
  snapshotHash?: string
  tableChecksums?: Record<string, string>
  revision: number
  counts: Record<string, number>
  issues: MigrationIssue[]
  resolutions?: Record<string, string>
  status?: string
  receipt?: unknown
  issuesCount?: number
  issuesTruncated?: boolean
}
export interface RestorePreview {
  jobId: string
  confirmationHash: string
  expectedRevision: number
  originCount: number
  tableCounts: Record<string, number>
  moduleCounts: Record<string, number>
  unavailableAttachments: { id: string; reason: string; originalSource?: string }[]
  unverifiedDependencies: unknown[]
  requiresOwnershipConfirmation: boolean
  unavailableAttachmentCount?: number
  unverifiedDependencyCount?: number
  previewDetailsTruncated?: boolean
}
export interface RecoveryStatus {
  restores: (RestorePreview & { status: 'preview' | 'completed'; receipt?: RestoreReceipt })[]
  migrations: MigrationPreview[]
}
export interface RestoreReceipt {
  status: string
  originId: string
  revision: number
  recoveryCopyId: string
  activated: boolean
}
export class LocalStorageError extends Error {
  code: string
  status: number
  issues?: unknown
  constructor(code: string, message: string, status = 0, issues?: unknown) {
    super(message)
    this.name = 'LocalStorageError'
    this.code = code
    this.status = status
    this.issues = issues
  }
}

const BASE = '/api/local/v1'
export interface WorkspaceSaveOptions {
  isCurrent?: () => boolean
  principalId?: string
}
async function request<T>(
  path: string,
  init: RequestInit = {},
  isCurrent?: () => boolean
): Promise<T> {
  const principal = useAuthStore.getState().localPrincipalId
  const ensureCurrent = () => {
    if ((isCurrent && !isCurrent()) || useAuthStore.getState().localPrincipalId !== principal)
      throw new LocalStorageError(
        'auth.changed',
        'Account changed before saving. Reopen the correct workspace.',
        401
      )
  }
  ensureCurrent()
  const headers = new Headers(init.headers)
  if (principal && !headers.has('X-Chartly-Principal'))
    headers.set('X-Chartly-Principal', principal)
  const method = (init.method ?? 'GET').toUpperCase()
  if (method !== 'GET') {
    const csrf = await fetchCSRFToken()
    ensureCurrent()
    if (!csrf)
      throw new LocalStorageError('csrf.unavailable', 'Sign in again to save local records.')
    headers.set('X-CSRFToken', csrf)
  }
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  ensureCurrent()
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch (cause) {
    throw new LocalStorageError(
      'storage.offline',
      'The local engine is unavailable. Your draft is retained; reconnect and retry.',
      0,
      cause
    )
  }
  ensureCurrent()
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const error = data.error ?? data
    throw new LocalStorageError(
      error.code ?? 'storage.request_failed',
      error.message ?? `Local storage request failed (${response.status}).`,
      response.status,
      error.issues
    )
  }
  if (response.status === 204) return undefined as T
  const result = (await response.json()) as T
  ensureCurrent()
  return result
}
export const localStorageClient = {
  recoveryStatus: () => request<RecoveryStatus>('/recovery/status'),
  restoreJob: (id: string) => request<RestorePreview>(`/restores/${encodeURIComponent(id)}`),
  context: () => request<LocalContext>('/context'),
  setup: () => request<LocalContext>('/setup', { method: 'POST', body: '{}' }),
  workspace: (originId?: string) =>
    request<WorkspaceState>(
      `/workspace${originId ? `?originId=${encodeURIComponent(originId)}` : ''}`
    ),
  save: (
    state: WorkspaceState,
    tables: TraderTables,
    requestId: string,
    options: WorkspaceSaveOptions = {}
  ) =>
    request<WorkspaceState>(
      `/workspace?originId=${encodeURIComponent(state.originId)}`,
      {
        method: 'PUT',
        headers: options.principalId ? { 'X-Chartly-Principal': options.principalId } : undefined,
        body: JSON.stringify({ expectedRevision: state.revision, tables, requestId }),
      },
      options.isCurrent
    ),
  preview: (snapshot: BrowserSnapshot, nativeTargetNamespace?: string) =>
    request<MigrationPreview>('/migrations/preview', {
      method: 'POST',
      body: JSON.stringify({ snapshot, nativeTargetNamespace }),
    }),
  migration: (id: string) => request<MigrationPreview>(`/migrations/${encodeURIComponent(id)}`),
  commit: (id: string, resolutions: Record<string, string>, requestId: string) =>
    request<{ originId: string; status: string; revision: number }>(
      `/migrations/${encodeURIComponent(id)}/commit`,
      {
        method: 'POST',
        body: JSON.stringify({ resolutions, requestId }),
      }
    ),
  activate: (originId: string) =>
    request<LocalContext>('/context/active', { method: 'PUT', body: JSON.stringify({ originId }) }),
  savePreferences: (
    originId: string,
    preferences: Record<string, string>,
    requestId: string,
    expectedPreferences: Record<string, string>
  ) =>
    request<{ generation: number }>('/preferences', {
      method: 'PUT',
      body: JSON.stringify({ originId, preferences, requestId, expectedPreferences }),
    }),
  native: (kind: string, namespace: string, originId: string, options: WorkspaceSaveOptions = {}) =>
    request<{ catalog: unknown; revision: number; generation?: number }>(
      `/native/${kind}?namespace=${encodeURIComponent(namespace)}&originId=${encodeURIComponent(originId)}`,
      { headers: options.principalId ? { 'X-Chartly-Principal': options.principalId } : undefined },
      options.isCurrent
    ),
  saveNative: (
    kind: string,
    namespace: string,
    originId: string,
    catalog: unknown,
    expectedCatalogRevision: number,
    requestId: string,
    options: WorkspaceSaveOptions = {}
  ) =>
    request<{ catalog: unknown; revision: number; generation?: number }>(
      `/native/${kind}`,
      {
        method: 'PUT',
        headers: options.principalId ? { 'X-Chartly-Principal': options.principalId } : undefined,
        body: JSON.stringify({ originId, namespace, catalog, expectedCatalogRevision, requestId }),
      },
      options.isCurrent
    ),
  async backup(originId: string): Promise<Blob> {
    const csrf = await fetchCSRFToken()
    const response = await fetch(`${BASE}/backups?originId=${encodeURIComponent(originId)}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRFToken': csrf },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new LocalStorageError(
        body.error?.code ?? 'backup.failed',
        body.error?.message ?? 'Backup could not be created.',
        response.status
      )
    }
    return response.blob()
  },
  restorePreview: (file: File, expectedRevision: number) => {
    const form = new FormData()
    form.set('file', file)
    form.set('expectedRevision', String(expectedRevision))
    return request<RestorePreview>('/restores/preview', { method: 'POST', body: form })
  },
  restoreCommit: (
    id: string,
    expectedRevision: number,
    confirmationHash: string,
    confirmOwner = false
  ) =>
    request<RestoreReceipt>(`/restores/${encodeURIComponent(id)}/commit`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision, confirmationHash, confirmOwner }),
    }),
  undoPreview: (id: string, expectedRevision: number) =>
    request<RestorePreview>(`/restores/copies/${encodeURIComponent(id)}/preview`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision }),
    }),
}
