import manifest from '../../../../services/market_providers.json'

type MarketProvider = (typeof manifest)[number]

const providersById = new Map<string, MarketProvider>(manifest.map((row) => [row.id, row]))

export function marketProvider(id: string): MarketProvider | undefined {
  return providersById.get(id)
}

export function marketChartIntervals(id: string): readonly string[] {
  const provider = marketProvider(id)
  return provider?.chartIntervals ?? (provider?.directChart ? provider.intervals : [])
}

export const MARKET_CHART_PROVIDERS = manifest.filter((row) => marketChartIntervals(row.id).length)
export const MARKET_IMPORT_PROVIDERS = manifest.filter((row) => row.historyImport === 'available')
export const DEFAULT_MARKET_IMPORT_PROVIDER = MARKET_IMPORT_PROVIDERS[0]

export function marketImportLabel(provider: MarketProvider): string {
  return provider.historyLabel ?? `${provider.label} (no key)`
}

const symbolPatterns = {
  'mt5-native': /^(?=[A-Za-z0-9._#+&-]*[A-Za-z0-9])[A-Za-z0-9._#+&-]{1,80}$/,
  'preserve-case': /^[A-Za-z0-9][A-Za-z0-9_-]{0,23}$/,
  uppercase: /^[A-Z0-9][A-Z0-9\-_/]{2,23}$/,
}

export function marketSymbol(id: string, value: string): string | null {
  const format = marketProvider(id)?.symbolFormat
  if (format !== 'mt5-native' && format !== 'preserve-case' && format !== 'uppercase') return null
  const symbol = format === 'uppercase' ? value.trim().toUpperCase() : value.trim()
  return symbolPatterns[format].test(symbol) ? symbol : null
}

export function marketHistoryParameters(
  providerId: string,
  rawSymbol: string,
  interval: string,
  limits: { limit: string; start: string; end: string }
) {
  const provider = marketProvider(providerId)
  if (!provider || provider.historyImport !== 'available')
    throw new Error('This provider cannot supply a saved candle preview.')
  const symbol = marketSymbol(providerId, rawSymbol)
  if (!symbol) throw new Error('Enter the exact venue symbol for this provider.')
  if (!provider.intervals.includes(interval))
    throw new Error('Choose a supported interval for this history provider.')
  const selection = { provider: providerId, symbol, interval }
  if (provider.maxWindowHours) {
    const start = Date.parse(`${limits.start}Z`)
    const end = Date.parse(`${limits.end}Z`)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      throw new Error('Choose a start and a later end in UTC.')
    const hourMs = 3_600_000
    const firstHour = Math.floor(start / hourMs) * hourMs
    if (end > firstHour + provider.maxWindowHours * hourMs)
      throw new Error(`Choose a window spanning at most ${provider.maxWindowHours} UTC hours.`)
    return { ...selection, start: new Date(start).toISOString(), end: new Date(end).toISOString() }
  }
  const limit = Number(limits.limit || 500)
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Enter a candle count from 1 to 1000.')
  return { ...selection, limit }
}
