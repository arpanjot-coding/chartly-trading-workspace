import { fetchCSRFToken } from '@/api/client'
import type { ChartEvidenceRequest } from './chartEvidence'
import type { JournalTrade } from './db'
import { LocalStorageError, type WorkspaceState } from './localStorageClient'

export interface JournalDetail {
  trade: JournalTrade
  review?: Record<string, unknown>
  history: Record<string, unknown>[]
  executions: Record<string, unknown>[]
  observations?: Record<string, unknown>[]
}
export interface JournalLedger {
  version: number
  events: Record<string, unknown>[]
  observations: Record<string, unknown>[]
  reviews: Record<string, unknown>[]
  history: Record<string, unknown>[]
  periodReviews: Record<string, unknown>[]
  mappings: Record<string, unknown>[]
  batches: Record<string, unknown>[]
  bookLinks: Record<string, unknown>[]
}
export interface JournalState {
  originId: string
  revision: number
  books: WorkspaceState['books']
  ledger: JournalLedger
  imports?: {
    id: string
    originId?: string
    bookId?: string
    portfolioId?: number
    provider?: string
    expectedRevision: number
    createdAt: string
    status: string
  }[]
}
export interface JournalActionRequest {
  originId: string
  expectedRevision: number
  requestId: string
  action: string
  payload: Record<string, unknown>
}
export interface JournalActionResponse {
  workspace: WorkspaceState
  detail?: JournalDetail
  result?: Record<string, unknown>
}
export interface StatementPreview {
  id: string
  expectedRevision: number
  preview: {
    rows: Record<string, unknown>[]
    counts: Record<string, number>
    totals: Record<string, unknown>
    canCommit: boolean
    [key: string]: unknown
  }
}

const BASE = '/api/local/v1/journal'
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if ((init.method ?? 'GET') !== 'GET') {
    const token = await fetchCSRFToken()
    if (!token)
      throw new LocalStorageError('csrf.unavailable', 'Sign in again before saving the journal.')
    headers.set('X-CSRFToken', token)
  }
  if (init.body) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch {
    throw new LocalStorageError(
      'journal.offline',
      'The local engine is unavailable. Your journal draft is retained.'
    )
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = body.error ?? {}
    throw new LocalStorageError(
      error.code ?? 'journal.request_failed',
      error.message ?? `Journal request failed (${response.status}).`,
      response.status,
      error.issues
    )
  }
  return response.json() as Promise<T>
}
const query = (fields: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(fields)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)])
  ).toString()
export const journalClient = {
  state: (originId: string) => request<JournalState>(`?${query({ originId })}`),
  detail: (originId: string, tradeId: number) =>
    request<JournalDetail>(`/trades/${tradeId}?${query({ originId })}`),
  action: (body: JournalActionRequest) =>
    request<JournalActionResponse>('/actions', { method: 'POST', body: JSON.stringify(body) }),
  previewImport: (body: Record<string, unknown>) =>
    request<StatementPreview>('/imports/preview', { method: 'POST', body: JSON.stringify(body) }),
  commitImport: (
    id: string,
    body: { expectedRevision: number; requestId: string; acceptCorrections: boolean }
  ) =>
    request<JournalActionResponse>(`/imports/${encodeURIComponent(id)}/commit`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  importPreview: (id: string, originId: string) =>
    request<StatementPreview & { status?: string; originId?: string }>(
      `/imports/${encodeURIComponent(id)}?${query({ originId })}`
    ),
  uploadAttachment: (body: Record<string, unknown>) =>
    request<JournalActionResponse>('/attachments', { method: 'POST', body: JSON.stringify(body) }),
  attachChartEvidence: (body: ChartEvidenceRequest) =>
    request<JournalActionResponse>('/chart-evidence', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  repreviewImport: (id: string, expectedRevision: number) =>
    request<StatementPreview>(`/imports/${encodeURIComponent(id)}/repreview`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision }),
    }),
  async export(
    originId: string,
    portfolioId: number,
    bookId: string,
    format: 'json' | 'csv'
  ): Promise<Blob> {
    const response = await fetch(
      `${BASE}/export?${query({ originId, portfolioId, bookId, format })}`,
      { credentials: 'include' }
    )
    if (!response.ok)
      throw new LocalStorageError(
        'journal.export_failed',
        'Journal export failed. Saved records remain intact.',
        response.status
      )
    return response.blob()
  },
}
