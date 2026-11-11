export interface MarketCandle {
  source: string
  symbol: string
  interval: string
  openTimeMs: number
  open: string
  high: string
  low: string
  close: string
  volume: string
  observedSkewSeconds?: number
  timeBasis?: string
  rawProviderOpenTimeMs?: number
  utcAlignmentVerified?: boolean
  clockPolicy?: string
  receivedAt?: string
  [key: string]: unknown
}

export interface MarketQuote {
  source: string
  symbol: string
  price: string
  bid?: string
  ask?: string
  [key: string]: unknown
}

export interface MarketSymbol {
  symbol: string
  exchange: string
  name: string
  digits?: number | null
}

export interface FeedPosition {
  ticket: string
  symbol: { native: string; canonicalCandidate?: string }
  side: 'buy' | 'sell'
  volumeLots: string
  contractSize?: string | null
  priceOpen: string
  priceCurrent: string
  stopLoss?: string | null
  takeProfit?: string | null
  profit: string
}

export interface FeedOrder {
  ticket: string
  symbol: { native: string }
  type: number
  volumeInitialLots: string
  volumeCurrentLots: string
  priceOpen: string
  stopLoss?: string | null
  takeProfit?: string | null
}

export interface FeedDeal {
  ticket: string
  type: number
  entry?: number | null
  order?: string | null
  position_id?: string | null
  rawProviderTimeMsc: number
  symbol: string
  volume?: string | null
  price?: string | null
  commission?: string | null
  swap?: string | null
  profit?: string | null
  fee?: string | null
}

export interface FeedHistoricalOrder {
  ticket: string
  symbol: string
  type: number
  state: number
  position_id: string | null
  position_by_id: string | null
  rawProviderSetupTimeMsc: number
  rawProviderDoneTimeMsc: number | null
  rawProviderTimeMsc: number
  volumeInitialLots: string
  volumeCurrentLots: string
  priceOpen: string
}

export interface FeedHistoryCoverage {
  queryFrom: string
  queryTo: string
  status: 'read' | 'limited' | 'unavailable'
  observedCount: number | null
  returnedCount: number
  reason?: string
}

export interface FeedAccountSnapshot {
  providerId: string
  identity: {
    externalId: string
    server: string
    environment: string
    currency: string
  }
  account: {
    balance: string
    credit: string
    profit: string
    equity: string
    margin: string
    marginFree: string
    marginLevel: string
    leverage: number | null
    currency: string
  }
  positions: FeedPosition[]
  orders: FeedOrder[]
  history: FeedDeal[]
  historicalOrders?: FeedHistoricalOrder[]
  historyDays: number
  historyLoaded?: boolean
  historyCoverage?: {
    utcAlignmentVerified: boolean
    deals: FeedHistoryCoverage
    orders: FeedHistoryCoverage
  } | null
  bookErrors?: Partial<Record<'positions' | 'orders' | 'history' | 'historicalOrders', string>>
  observedAt: string
  timeBasis: string
}

export class MarketDataError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status = 0) {
    super(message)
    this.name = 'MarketDataError'
    this.code = code
    this.status = status
  }
}

const BASE = '/api/local/v1/market'

async function read<T>(
  path: string,
  principalId: string,
  signal?: AbortSignal,
  headers?: Record<string, string>
): Promise<T> {
  let result: Response
  try {
    signal?.throwIfAborted()
    result = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      signal,
      headers: {
        'X-Chartly-Principal': principalId,
        ...(headers ?? {}),
      },
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
      throw error
    throw new MarketDataError(
      'market.offline',
      'The local market-data service is unavailable. The chart has not been changed.'
    )
  }
  if (!result.ok) {
    const body = (await result.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string }
    }
    throw new MarketDataError(
      body.error?.code ?? 'market.request_failed',
      body.error?.message ?? 'The market-data request failed. No candles were changed.',
      result.status
    )
  }
  return (await result.json()) as T
}

export interface MarketCandlesRequest {
  provider: string
  symbol: string
  interval: string
  limit?: number
  start?: string
  end?: string
  mt5Profile?: Mt5ProfileScope
}

export interface Mt5ProfileScope {
  originId: string
  profileId: number
}

function withMt5Profile(params: URLSearchParams, scope?: Mt5ProfileScope): URLSearchParams {
  if (scope && params.get('provider') === 'mt5') {
    params.set('originId', scope.originId)
    params.set('profileId', String(scope.profileId))
  }
  return params
}

export const marketData = {
  candles: (
    request: MarketCandlesRequest,
    principalId: string,
    signal?: AbortSignal
  ): Promise<{ candles: MarketCandle[]; count: number; connectionKey?: string }> => {
    const params = new URLSearchParams({
      provider: request.provider,
      symbol: request.symbol,
      interval: request.interval,
      limit: String(request.limit ?? 500),
    })
    if (request.start) params.set('start', request.start)
    if (request.end) params.set('end', request.end)
    return read(`/candles?${withMt5Profile(params, request.mt5Profile)}`, principalId, signal)
  },
  quote: (
    provider: string,
    symbol: string,
    principalId: string,
    signal?: AbortSignal,
    mt5Profile?: Mt5ProfileScope
  ): Promise<{ quote: MarketQuote; connectionKey?: string }> =>
    read(
      `/quote?${withMt5Profile(new URLSearchParams({ provider, symbol }), mt5Profile)}`,
      principalId,
      signal
    ),
  quotes: (
    provider: string,
    symbols: readonly string[],
    principalId: string,
    signal?: AbortSignal
  ): Promise<{ quotes: MarketQuote[]; missing: string[] }> =>
    read(
      `/quotes?${new URLSearchParams({ provider, symbols: symbols.join(',') })}`,
      principalId,
      signal
    ),
  symbols: (
    request: { provider: string; q?: string; limit?: number; mt5Profile?: Mt5ProfileScope },
    principalId: string,
    signal?: AbortSignal
  ): Promise<{ symbols: MarketSymbol[]; count: number; connectionKey?: string }> =>
    read(
      `/symbols?${withMt5Profile(
        new URLSearchParams({
          provider: request.provider,
          q: request.q ?? '',
          limit: String(request.limit ?? 100),
        }),
        request.mt5Profile
      )}`,
      principalId,
      signal
    ),
  account: (
    provider: string,
    principalId: string,
    scope: Mt5ProfileScope,
    signal?: AbortSignal,
    historyDays = 7,
    includeHistory = true
  ): Promise<{ account: FeedAccountSnapshot }> =>
    read(
      `/account?${new URLSearchParams({
        provider,
        originId: scope.originId,
        profileId: String(scope.profileId),
        historyDays: String(historyDays),
        includeHistory: includeHistory ? '1' : '0',
      })}`,
      principalId,
      signal
    ),
}
