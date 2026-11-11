import { fetchCSRFToken } from '@/api/client'
import { LocalStorageError } from './localStorageClient'

export interface ResearchIssuer {
  id: string
  name: string
  country: string
  identifiers: { namespace: string; key: string }[]
}
export interface StatementLine {
  line: string
  concept: string
  value: string
  displayValue: string
  unit: string
  periodEnd: string
  fiscalYear: number
  fiscalPeriod: string
  citation: string
}
export interface StatementResult {
  statement: string
  view: string
  scale: string
  lines: StatementLine[]
  unavailable: { line: string; reason: string }[]
  segmentData: { status: string; reason: string }
}
export interface OverlayPoint {
  date: string
  value: string
  unit: string
  span: string
  fiscalYear: number
  fiscalPeriod: string
  citation: string
}
export interface OverlayResult {
  series: { line: string; concept: string | null; points: OverlayPoint[] }
  events: { time: string; label: string; sourceUrl: string }[]
  semantics: {
    seriesDates: string
    eventDates: string
    interpolated: boolean
    sources: string[]
  }
}
export interface CompareResult {
  line: string
  comparable: boolean
  comparabilityNote: string
  complete: boolean
  rows: {
    issuer: string
    status: string
    value?: string
    unit?: string
    periodEnd?: string
    citation?: string
    reason?: string
  }[]
}
export interface ResearchNote {
  id: string
  documentVersionId: string
  text: string
  createdAt: string
}
export interface SnapshotSummary {
  id: string
  label: string
  savedAt: string
  factCount: number
}
export interface DerivedMetricRow {
  id: string
  formulaId: string
  value?: string
  unavailableReason?: string
  unit: string
  inputFactIds: string[]
}

const BASE = '/api/local/v1/research'

async function request<T>(path: string, init: RequestInit = {}, principalId?: string): Promise<T> {
  const headers = new Headers(init.headers)
  if (principalId && !headers.has('X-Chartly-Principal'))
    headers.set('X-Chartly-Principal', principalId)
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') {
    const csrf = await fetchCSRFToken()
    if (!csrf) throw new LocalStorageError('csrf.unavailable', 'Sign in again to update research data.')
    headers.set('X-CSRFToken', csrf)
  }
  if (init.body) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch (cause) {
    throw new LocalStorageError('storage.offline', 'The local engine is unavailable.', 0, cause)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new LocalStorageError(
      body.error?.code ?? 'research.request_failed',
      body.error?.message ?? 'Research data could not be loaded.',
      response.status,
      body.error?.issues
    )
  }
  return response.json() as Promise<T>
}

const qs = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`

export const researchClient = {
  issuers: (originId: string, principalId?: string) =>
    request<{ issuers: ResearchIssuer[] }>(`/issuers${qs({ originId })}`, {}, principalId),
  issuer: (originId: string, id: string, principalId?: string) =>
    request<{ issuer: ResearchIssuer; documentCount: number; factCount: number }>(
      `/issuers/${encodeURIComponent(id)}${qs({ originId })}`,
      {},
      principalId
    ),
  statement: (
    originId: string,
    id: string,
    kind: string,
    params: { view?: string; asOf?: string; scale?: string },
    principalId?: string
  ) =>
    request<StatementResult>(
      `/issuers/${encodeURIComponent(id)}/statements/${kind}${qs({
        originId,
        view: params.view ?? 'latest-restated',
        scale: params.scale ?? 'millions',
        ...(params.asOf ? { asOf: params.asOf } : {}),
      })}`,
      {},
      principalId
    ),
  metrics: (originId: string, id: string, principalId?: string) =>
    request<{ metrics: DerivedMetricRow[] }>(
      `/issuers/${encodeURIComponent(id)}/metrics${qs({ originId })}`,
      {},
      principalId
    ),
  coverage: (originId: string, id: string, principalId?: string) =>
    request<{
      fields: { line: string; status: string; definition: string; concept: string | null }[]
      gatedCapabilities: { capability: string; status: string; reason: string }[]
    }>(`/issuers/${encodeURIComponent(id)}/coverage${qs({ originId })}`, {}, principalId),
  events: (originId: string, id: string, principalId?: string) =>
    request<{ events: { time: string; accession: string; sourceUrl: string }[] }>(
      `/issuers/${encodeURIComponent(id)}/events${qs({ originId, limit: '20' })}`,
      {},
      principalId
    ),
  overlay: (originId: string, id: string, line: string, principalId?: string) =>
    request<OverlayResult>(
      `/issuers/${encodeURIComponent(id)}/overlay${qs({ originId, line })}`,
      {},
      principalId
    ),
  compare: (originId: string, issuerIds: string[], line: string, principalId?: string) =>
    request<CompareResult>(
      `/compare${qs({ originId, issuerIds: issuerIds.join(','), line })}`,
      {},
      principalId
    ),
  notes: (originId: string, id: string, principalId?: string) =>
    request<{ notes: ResearchNote[] }>(
      `/issuers/${encodeURIComponent(id)}/notes${qs({ originId })}`,
      {},
      principalId
    ),
  addNote: (
    originId: string,
    id: string,
    documentVersionId: string,
    text: string,
    principalId?: string
  ) =>
    request<ResearchNote>(
      `/issuers/${encodeURIComponent(id)}/notes`,
      { method: 'POST', body: JSON.stringify({ originId, documentVersionId, text }) },
      principalId
    ),
  documents: (originId: string, id: string, principalId?: string) =>
    request<{ documents: { id: string; nativeDocumentId: string; sourceUrl: string }[] }>(
      `/issuers/${encodeURIComponent(id)}/documents${qs({ originId, limit: '20' })}`,
      {},
      principalId
    ),
  snapshots: (originId: string, id: string, principalId?: string) =>
    request<{ snapshots: SnapshotSummary[] }>(
      `/issuers/${encodeURIComponent(id)}/snapshots${qs({ originId })}`,
      {},
      principalId
    ),
  saveSnapshot: (originId: string, id: string, label: string, principalId?: string) =>
    request(
      `/issuers/${encodeURIComponent(id)}/snapshots`,
      { method: 'POST', body: JSON.stringify({ originId, label }) },
      principalId
    ),
  ingest: (originId: string, cik: string, principalId?: string) =>
    request(
      '/ingestion/action',
      {
        method: 'POST',
        body: JSON.stringify({
          originId,
          action: 'submit',
          payload: { requestId: `ingest_${crypto.randomUUID().replaceAll('-', '')}`, cik },
        }),
      },
      principalId
    ),
  runNextIngestion: (originId: string, principalId?: string) =>
    request<{ job: { status: string; stats?: unknown } }>(
      '/ingestion/action',
      {
        method: 'POST',
        body: JSON.stringify({ originId, action: 'run-next', payload: {} }),
      },
      principalId
    ),
}
