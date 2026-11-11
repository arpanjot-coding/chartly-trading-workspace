import { fetchCSRFToken } from '@/api/client'
import { LocalStorageError } from './localStorageClient'

export interface ExperimentJobSummary {
  id: string
  status: string
  artifactRevisionId: string
  createdAt: string
  updatedAt: string
  failureCode?: string
}
export interface ExperimentReport {
  endingEquity: string
  totalReturn: string
  maxDrawdown: string
  tradeCount: number
  winRate: string | null
  checksum: string
  trades: {
    entryTime: string
    exitTime: string
    quantity: string
    entryPrice: string
    exitPrice: string
    netPnl: string
  }[]
  openPosition: { quantity: string; entryPrice: string; entryTime: string } | null
}
export interface ExperimentJob {
  id: string
  trial: { status: string; failureCode?: string }
  report: ExperimentReport | null
  manifest: Record<string, unknown>
}
export interface ExperimentSubmit {
  requestId: string
  projectId: string
  revisionId: string
  parameterSetId: string
  datasetVersionId: string
  instrumentId: string
  warmupStart: string
  rangeStart: string
  rangeEnd: string
  startingCash: { value: string; currency: string }
  feeBps: string
  slippageBps: string
  fraction: string
  quantityStep: string
  quantityScale: number
  entryOutput: string
  exitOutput: string
  seed: number
}

const BASE = '/api/local/v1/experiments'

async function request<T>(path: string, init: RequestInit = {}, principalId?: string): Promise<T> {
  const headers = new Headers(init.headers)
  if (principalId && !headers.has('X-Chartly-Principal'))
    headers.set('X-Chartly-Principal', principalId)
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') {
    const csrf = await fetchCSRFToken()
    if (!csrf)
      throw new LocalStorageError('csrf.unavailable', 'Sign in again to run experiments.')
    headers.set('X-CSRFToken', csrf)
  }
  if (init.body) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch (cause) {
    throw new LocalStorageError(
      'storage.offline',
      'The local engine is unavailable. Submitted jobs are durable; reconnect to check them.',
      0,
      cause
    )
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new LocalStorageError(
      body.error?.code ?? 'experiment.request_failed',
      body.error?.message ?? 'The experiment could not be updated.',
      response.status,
      body.error?.issues
    )
  }
  return response.json() as Promise<T>
}

const post = (originId: string, action: string, payload: Record<string, unknown>, jobId?: string) => ({
  method: 'POST',
  body: JSON.stringify({ originId, action, payload, ...(jobId ? { jobId } : {}) }),
})

export const experimentClient = {
  list: (originId: string, principalId?: string) =>
    request<{ jobs: ExperimentJobSummary[] }>(`/?originId=${encodeURIComponent(originId)}`, {}, principalId),
  detail: (originId: string, id: string, principalId?: string) =>
    request<{ job: ExperimentJob }>(`/${encodeURIComponent(id)}?originId=${encodeURIComponent(originId)}`, {}, principalId),
  submit: (originId: string, payload: ExperimentSubmit, principalId?: string) =>
    request<{ job: ExperimentJob }>('/action', post(originId, 'submit', { ...payload }), principalId),
  runNext: (originId: string, principalId?: string) =>
    request<{ job: ExperimentJob | null }>('/action', post(originId, 'run-next', {}), principalId),
  cancel: (originId: string, jobId: string, principalId?: string) =>
    request<{ job: ExperimentJob }>('/action', post(originId, 'cancel', {}, jobId), principalId),
  recover: (originId: string, principalId?: string) =>
    request<{ jobs: ExperimentJobSummary[] }>('/action', post(originId, 'recover', {}), principalId),
}
