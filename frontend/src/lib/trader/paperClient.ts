import { fetchCSRFToken } from '@/api/client'
import { LocalStorageError, type WorkspaceState } from './localStorageClient'

export interface PaperInstrument {
  symbol: string
  exchange: string
  interval: string
  currency: string
  quantityUnit: string
  quantityStep: string
  priceTick: string
  multiplier: string
  quantityScale: number
  priceScale: number
}
export interface PaperConfig {
  version: 1
  instrument: PaperInstrument
  startingCash: string
  moneyScale: number
  costs: { spreadTicks: number; slippageTicks: number; feeBps: string; feePerFill: string }
  policy: { id: 'native-ohlc-conservative-v1'; gap: 'next-observed' }
  seed: 0
  startTime?: number
}
export interface PaperOrder {
  id: string
  side: 'buy' | 'sell'
  orderType: 'market' | 'limit' | 'stop'
  quantity: string
  status: string
  positionId?: string
  limitPrice?: string
  stopPrice?: string
  stopLoss?: string
  takeProfit?: string
  reduceOnly?: boolean
  reason?: string
  [key: string]: unknown
}
export interface PaperPosition {
  id: string
  side: 'buy' | 'sell'
  quantity: string
  entryPrice: string
  remainingQuantity?: string
  status?: string
  [key: string]: unknown
}
export interface PaperSession {
  version?: number
  runId: number
  profileId?: number
  originId?: string
  revision: number
  status: string
  config: PaperConfig
  manifest: Record<string, unknown>
  checkpoint: Record<string, unknown>
  cursorIndex: number
  asOf: number
  totalBars?: number
  cash: string
  equity: string
  available: string
  collateral: string
  realizedGross: string
  fees: string
  orders: PaperOrder[]
  positions: PaperPosition[]
  fills?: Record<string, unknown>[]
  lastFills?: Record<string, unknown>[]
  ledger?: Record<string, unknown>[]
  journalIds?: number[]
  journalBookId?: string
  bookId?: string
  journalTradeIds?: number[]
  report?: Record<string, unknown>
  [key: string]: unknown
}
export type PaperAction =
  | 'prepare'
  | 'start'
  | 'pause'
  | 'advance'
  | 'order'
  | 'cancel'
  | 'close'
  | 'finish'
  | 'branch'
export interface PaperRequest {
  originId: string
  runId: number
  expectedRevision: number
  requestId: string
  action: PaperAction
  payload: Record<string, unknown>
}
export interface PaperResponse {
  session: PaperSession | null
  workspace?: WorkspaceState
  [key: string]: unknown
}
const BASE = '/api/local/v1/paper'
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if ((init.method ?? 'GET') !== 'GET') {
    const token = await fetchCSRFToken()
    if (!token)
      throw new LocalStorageError('csrf.unavailable', 'Sign in again to save paper decisions.')
    headers.set('X-CSRFToken', token)
  }
  if (init.body) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch (cause) {
    if (init.signal?.aborted) throw cause
    throw new LocalStorageError(
      'paper.offline',
      'The local engine is unavailable. The exact paper request is retained for retry.'
    )
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = body.error ?? {}
    throw new LocalStorageError(
      error.code ?? 'paper.request_failed',
      error.message ?? `Paper request failed (${response.status}).`,
      response.status,
      error.issues
    )
  }
  return response.json() as Promise<T>
}
const query = (originId: string, runId: number) =>
  new URLSearchParams({ originId, runId: String(runId) })
export const paperClient = {
  session: (originId: string, runId: number, signal?: AbortSignal) =>
    request<PaperResponse>(`/session?${query(originId, runId)}`, { signal }),
  action: (body: PaperRequest, signal?: AbortSignal) =>
    request<PaperResponse>('/action', { method: 'POST', body: JSON.stringify(body), signal }),
  report: (originId: string, runId: number, signal?: AbortSignal) =>
    request<Record<string, unknown>>(`/report?${query(originId, runId)}`, { signal }),
  ledger: (originId: string, runId: number, offset = 0, limit = 100, signal?: AbortSignal) =>
    request<Record<string, unknown>>(
      `/ledger?${query(originId, runId)}&offset=${offset}&limit=${limit}`,
      { signal }
    ),
  compare: (originId: string, profileId: number, runIds: number[], signal?: AbortSignal) =>
    request<Record<string, unknown>>(
      `/compare?${new URLSearchParams({ originId, profileId: String(profileId), runIds: runIds.join(',') })}`,
      { signal }
    ),
}
