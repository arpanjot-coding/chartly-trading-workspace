import { fetchCSRFToken } from '@/api/client'

export interface DatasetCalendar {
  id: string
  timezone: string
  sessions: { weekdays: number[]; open: string; close: string }[]
  exceptions: Record<string, unknown>
}
export interface DatasetContext {
  name?: string
  provider: string
  symbol: string
  exchange: string
  interval: string
  currency?: string
  priceBasis: 'raw' | 'split_adjusted' | 'total_return'
  adjustment: string
  volumeMeaning: 'unknown' | 'units' | 'contracts' | 'ticks' | 'currency'
  allowNegativePrices: boolean
  calendar: DatasetCalendar
}
export interface DatasetMapping {
  version: 1
  columns: Record<string, string>
  timestampFormat: 'iso' | 'seconds' | 'milliseconds'
  timezone: string
  delimiter: string
  decimalSeparator: string
  timestampMeaning: 'open'
}
export interface DatasetVersion {
  id: string
  /** The server resolved this exact validated backup alias to the owned canonical version. */
  resolvedFromVersionId?: string
  datasetId: string
  name: string
  metadata: DatasetContext
  checksum: string
  sourceHash: string
  rowCount: number
  start: number
  end: number
  sizeBytes: number
  quality: Record<string, unknown>
  coverage: unknown
  createdAt: string
  archivedAt?: string
  dependencies: unknown[]
  importReport?: {
    counts: Record<string, number>
    quality: Record<string, unknown>
    sourceHash: string
    policy: string
    baseVersionId?: string | null
  }
  sourceObservation?: PublicSourceObservation
  quarantine?: DatasetQuarantine
}
export interface DatasetQuarantine {
  reason: 'dataset.time_unverified'
  timeBasis: string
  message: string
}
export interface PublicSourceObservation {
  provider: string
  receivedAt: string
  nativePair: string
  symbol: string
  interval: string
  returnedFirst: number
  returnedLast: number
  closedRows: number
  excludedUnfinished: number
  maxEntries: number
  scope: string
}
export interface PublicMarketInstrument {
  id: string
  symbol: string
  base: string
  quote: string
  alias: string
}
export interface DatasetJob {
  id: string
  status: string
  kind?: string
  expectedRevision?: number
  createdAt?: string
  [key: string]: unknown
}
export interface DatasetCatalog {
  principalId?: string
  revision: number
  versions: DatasetVersion[]
  jobs: DatasetJob[]
  capabilities: Record<string, unknown>
  nextOffset?: number | null
}
export interface DatasetBar {
  timestamp: number
  open: string
  high: string
  low: string
  close: string
  volume: string | null
  openInterest?: string | null
}
export interface DatasetPreview {
  id: string
  expectedRevision: number
  status: string
  sourceObservation?: PublicSourceObservation
  quarantine?: DatasetQuarantine
  preview: {
    rows: Record<string, unknown>[]
    counts: Record<string, number>
    quality: Record<string, unknown>
    coverage: unknown
    canCommit?: boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}
export type DatasetPolicy = 'keep' | 'replace' | 'new-version'
export class DatasetError extends Error {
  code: string
  status: number
  issues: unknown[]
  constructor(code: string, message: string, status = 0, issues: unknown[] = []) {
    super(message)
    this.name = 'DatasetError'
    this.code = code
    this.status = status
    this.issues = issues
  }
}
const BASE = '/api/local/v1/datasets'
async function response(
  path: string,
  init: RequestInit = {},
  principalId?: string
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (principalId) headers.set('X-Chartly-Principal', principalId)
  if ((init.method ?? 'GET') !== 'GET') {
    const token = await fetchCSRFToken()
    if (!token) throw new DatasetError('csrf.unavailable', 'Sign in locally again before saving.')
    headers.set('X-CSRFToken', token)
  }
  if (init.body) headers.set('Content-Type', 'application/json')
  let result: Response
  try {
    init.signal?.throwIfAborted()
    result = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
      throw error
    throw new DatasetError(
      'datasets.offline',
      'The local engine is unavailable. Your input is retained.'
    )
  }
  if (!result.ok) {
    const body = await result.json().catch(() => ({}))
    const timeMessage =
      body.error?.code === 'dataset.time_unverified'
        ? 'This MT5 history needs time verification. Download its dataset backup and reimport history with verified UTC timestamps.'
        : body.error?.code === 'dataset.feed_time_unverified'
          ? 'MT5 history needs verified UTC timestamps before saving. You can inspect its native series on the chart.'
          : undefined
    throw new DatasetError(
      body.error?.code ?? 'datasets.request_failed',
      timeMessage ??
        body.error?.message ??
        'The local data request failed. Saved versions are unchanged.',
      result.status,
      body.error?.issues ?? []
    )
  }
  return result
}
async function json<T>(path: string, init?: RequestInit, principalId?: string): Promise<T> {
  return (await response(path, init, principalId)).json() as Promise<T>
}
function post<T>(path: string, body: unknown, principalId?: string): Promise<T> {
  return json(path, { method: 'POST', body: JSON.stringify(body) }, principalId)
}
const identity = (id: string) => encodeURIComponent(id)
export const dataLibrary = {
  krakenInstruments: (query: string, principalId: string, signal?: AbortSignal) =>
    json<{
      sourceId: string
      instruments: PublicMarketInstrument[]
      matched: number
      intervals: string[]
    }>(
      `/sources/kraken/instruments?${new URLSearchParams({ q: query, limit: '50' })}`,
      { signal },
      principalId
    ),
  previewKraken: (
    body: { expectedRevision: number; pair: string; interval: string },
    principalId: string,
    signal?: AbortSignal
  ) =>
    json<DatasetPreview>(
      '/sources/kraken/preview',
      { method: 'POST', body: JSON.stringify(body), signal },
      principalId
    ),
  previewFeed: (
    body: {
      expectedRevision: number
      provider: string
      symbol: string
      interval: string
      limit?: number
      start?: string
      end?: string
    },
    principalId: string,
    signal?: AbortSignal
  ) =>
    json<DatasetPreview>(
      '/sources/feed/preview',
      { method: 'POST', body: JSON.stringify(body), signal },
      principalId
    ),
  catalog: (signal?: AbortSignal, offset?: number) =>
    json<DatasetCatalog>(offset === undefined ? '' : `?offset=${offset}`, { signal }),
  version: async (id: string, signal?: AbortSignal) => {
    const version = await json<DatasetVersion>(`/versions/${identity(id)}`, { signal })
    if (
      typeof version.id !== 'string' ||
      !version.id ||
      (version.id !== id && version.resolvedFromVersionId !== id) ||
      (version.resolvedFromVersionId !== undefined && version.resolvedFromVersionId !== id)
    )
      throw new DatasetError(
        'datasets.version_mismatch',
        'The returned history does not match the requested version. Reopen it from Data Library.',
        409
      )
    return version
  },
  bars: (
    id: string,
    bounds: { from?: number; to?: number; limit?: number; signal?: AbortSignal }
  ) => {
    const params = new URLSearchParams()
    for (const key of ['from', 'to', 'limit'] as const)
      if (bounds[key] !== undefined) params.set(key, String(bounds[key]))
    return json<{
      versionId: string
      resolvedFromVersionId?: string
      checksum: string
      bars: DatasetBar[]
    }>(`/versions/${identity(id)}/bars?${params}`, { signal: bounds.signal })
  },
  preview: (
    body: {
      expectedRevision: number
      csvText: string
      mapping: DatasetMapping
      context: DatasetContext
      baseVersionId?: string
    },
    principalId?: string
  ) => post<DatasetPreview>('/imports/preview', body, principalId),
  importJob: (id: string, principalId?: string) =>
    json<DatasetPreview>(`/imports/${identity(id)}`, undefined, principalId),
  repreview: (id: string, expectedRevision: number, principalId?: string) =>
    post<DatasetPreview>(`/imports/${identity(id)}/repreview`, { expectedRevision }, principalId),
  commit: (
    id: string,
    body: {
      expectedRevision: number
      requestId: string
      policy: DatasetPolicy
      allowRejectedRows: boolean
    },
    principalId?: string
  ) =>
    post<{ version: DatasetVersion; catalog: DatasetCatalog }>(
      `/imports/${identity(id)}/commit`,
      body,
      principalId
    ),
  archive: (id: string, expectedRevision: number, requestId: string) =>
    post<{ version: DatasetVersion; catalog: DatasetCatalog }>(
      `/versions/${identity(id)}/archive`,
      {
        expectedRevision,
        requestId,
      }
    ),
  restore: (id: string, expectedRevision: number, requestId: string) =>
    post<{ version: DatasetVersion; catalog: DatasetCatalog }>(
      `/versions/${identity(id)}/restore`,
      {
        expectedRevision,
        requestId,
      }
    ),
  export: async (id: string, format: 'csv' | 'bundle') =>
    (await response(`/versions/${identity(id)}/export?format=${format}`)).blob(),
  createDownload: (body: {
    expectedRevision: number
    requestId: string
    context: DatasetContext
    mapping: DatasetMapping
    startAt: string
    endAt: string
    chunkSeconds?: number
  }) => post<{ job: DatasetJob; catalog: DatasetCatalog }>('/downloads', body),
  downloadJob: (id: string) => json<DatasetJob>(`/downloads/${identity(id)}`),
  stepDownload: (id: string, expectedRevision: number, requestId: string) =>
    post<{ job: DatasetJob; catalog: DatasetCatalog }>(`/downloads/${identity(id)}/step`, {
      expectedRevision,
      requestId,
    }),
  controlDownload: (
    id: string,
    expectedRevision: number,
    requestId: string,
    command: 'pause' | 'resume' | 'cancel' | 'retry'
  ) =>
    post<{ job: DatasetJob; catalog: DatasetCatalog }>(`/downloads/${identity(id)}/control`, {
      expectedRevision,
      requestId,
      command,
    }),
  previewBundle: (expectedRevision: number, base64: string) =>
    post<DatasetPreview>('/bundles/preview', { expectedRevision, base64 }),
  bundleJob: (id: string) => json<DatasetPreview>(`/bundles/${identity(id)}`),
  repreviewBundle: (id: string, expectedRevision: number) =>
    post<DatasetPreview>(`/bundles/${identity(id)}/repreview`, { expectedRevision }),
  commitBundle: (id: string, expectedRevision: number, requestId: string) =>
    post<{ version: DatasetVersion; catalog: DatasetCatalog }>(`/bundles/${identity(id)}/commit`, {
      expectedRevision,
      requestId,
    }),
}
