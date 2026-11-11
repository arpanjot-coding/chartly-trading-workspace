import { type Bar, OpenAlgoDataFeed } from 'chartly-charts'
import { dataLibrary } from '@/api/dataLibrary'
import type { Mt5ProfileScope } from '@/api/marketData'
import type { ChartSourceSelection } from '@/components/trading/ChartContextControls'
import { liveFeedIntervals } from '@/lib/chart/feeds/platformFeed'
import type { TraderPortfolio } from '@/lib/trader/db'
import { type ResolvedChartContext, readChartQuery, resolveChartContext } from './chartContext'
import { createDatasetChartSource, type DatasetChartSource } from './chartSource'
import { createLiveFeedChartSource, type LiveFeedChartSource } from './liveFeedChartSource'

export interface PreparedLegacyChartSource {
  kind: 'legacy-connected'
  symbol: string
  exchange: string
  interval: string
  preparedBars: readonly Bar[]
  apiKey: string
  wsUrl: string
  dispose(): void
}
export type PreparedChartSource =
  | DatasetChartSource
  | LiveFeedChartSource
  | PreparedLegacyChartSource

export function chartSourceNavigation(context: ResolvedChartContext, choice: ChartSourceSelection) {
  const next = new URLSearchParams(context.navigation)
  for (const key of ['evidenceId', 'currentAnalysis', 'symbol', 'exchange', 'from', 'to'])
    next.delete(key)
  if (choice?.kind === 'dataset') next.set('datasetVersionId', choice.versionId)
  else {
    next.delete('datasetVersionId')
    if (context.trade || context.evidence) next.set('currentAnalysis', '1')
  }
  return next
}

export function chartSourceProfilePatch(
  profile: TraderPortfolio,
  choice: ChartSourceSelection
): Partial<TraderPortfolio> {
  const liveSetup = profile.liveSetup
  const chartData =
    choice?.kind === 'live-feed'
      ? {
          mode: 'live-feed' as const,
          providerId: choice.providerId,
          providerName: choice.providerName,
          symbol: choice.symbol,
          interval: choice.interval,
        }
      : choice?.kind === 'dataset'
        ? {
            mode: 'saved-history' as const,
            providerId: choice.providerId,
            symbol: choice.symbol,
            interval: choice.interval,
            datasetVersionId: choice.versionId,
          }
        : undefined
  return {
    chartSource:
      choice?.kind === 'dataset'
        ? { kind: 'dataset', versionId: choice.versionId, checksum: choice.checksum }
        : choice?.kind === 'live-feed'
          ? choice
          : { kind: 'connected' },
    ...(choice ? { defaultSymbol: choice.symbol, defaultTimeframe: choice.interval } : {}),
    ...(profile.kind === 'live' && chartData
      ? {
          liveSetup: {
            version: 1,
            account: liveSetup?.account ?? { mode: 'later' },
            chartData,
            ...(liveSetup?.replayHistory ? { replayHistory: liveSetup.replayHistory } : {}),
          },
        }
      : {}),
    chartView: undefined,
  }
}

/** Keep this candidate private until candles and the profile save both succeed. */
export async function prepareChartSource(
  context: ResolvedChartContext,
  choice: ChartSourceSelection,
  signal: AbortSignal,
  mt5Profile?: Mt5ProfileScope | null
) {
  signal.throwIfAborted()
  const version =
    choice?.kind === 'dataset' ? await dataLibrary.version(choice.versionId, signal) : undefined
  signal.throwIfAborted()
  if (
    version &&
    choice?.kind === 'dataset' &&
    (version.checksum !== choice.checksum ||
      version.archivedAt ||
      version.metadata.symbol !== choice.symbol ||
      version.metadata.exchange !== choice.exchange ||
      version.metadata.interval !== choice.interval ||
      version.metadata.provider !== choice.providerId)
  )
    throw new Error('This saved source changed. Refresh the source list and choose it again.')
  const profilePatch = context.profile
    ? chartSourceProfilePatch(context.profile, choice)
    : undefined
  const navigation = chartSourceNavigation(context, choice)
  const nextContext = resolveChartContext(
    context.principal,
    readChartQuery(navigation),
    {
      profile: context.profile ? { ...context.profile, ...profilePatch } : undefined,
      run: context.run,
      trade: context.trade,
      bookId: context.bookId,
      datasetId: version?.id,
      missing: false,
      historicalUnavailable: !!context.trade && !version,
    },
    version
  )
  const source: DatasetChartSource | LiveFeedChartSource | undefined =
    choice?.kind === 'dataset'
      ? createDatasetChartSource(version!, { window: nextContext.window })
      : choice?.kind === 'live-feed'
        ? createLiveFeedChartSource(
            {
              ...choice,
              intervals: liveFeedIntervals(choice.providerId),
              ...(choice.providerId === 'mt5' && mt5Profile ? { mt5Profile } : {}),
            },
            context.principal
          )
        : undefined
  try {
    let bars: readonly Bar[]
    let legacy: Omit<PreparedLegacyChartSource, 'preparedBars'> | undefined
    if (source)
      bars = await source.feed.getBars({
        symbol: source.symbol,
        exchange: source.exchange,
        interval: source.interval,
        ...(source.kind === 'dataset' ? { from: source.from, to: source.horizon } : {}),
        signal,
      })
    else {
      const [response, configResponse] = await Promise.all([
        fetch('/api/websocket/apikey', { signal }),
        fetch('/api/websocket/config', { signal }),
      ])
      const credentials = await response.json()
      const config = await configResponse.json()
      signal.throwIfAborted()
      if (
        !response.ok ||
        !configResponse.ok ||
        credentials.status !== 'success' ||
        !credentials.api_key
      )
        throw new Error('Connect the broker data source before opening its chart stream.')
      const instrument = context.defaultSymbol
      if (!instrument?.symbol || !instrument.exchange)
        throw new Error('Open an instrument from the connected broker to use its chart stream.')
      bars = await new OpenAlgoDataFeed({ baseUrl: '', apiKey: credentials.api_key }).getBars({
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        interval: instrument.interval ?? '5m',
        from: Math.floor(Date.now() / 1000) - 7 * 86400,
        to: Math.floor(Date.now() / 1000),
        signal,
      })
      navigation.set('symbol', instrument.symbol)
      navigation.set('exchange', instrument.exchange)
      legacy = {
        kind: 'legacy-connected',
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        interval: instrument.interval ?? '5m',
        apiKey: credentials.api_key,
        wsUrl: config.websocket_url || 'ws://127.0.0.1:8765',
        dispose() {},
      }
    }
    signal.throwIfAborted()
    if (!bars.length)
      throw new Error('This source has no candles for the selected instrument and interval.')
    const prepared =
      source || legacy
        ? Object.freeze({
            ...(source ?? legacy!),
            preparedBars: Object.freeze(bars.map((bar) => Object.freeze({ ...bar }))),
          })
        : undefined
    return {
      source: prepared as PreparedChartSource | undefined,
      context: legacy
        ? {
            ...nextContext,
            navigation,
            defaultSymbol: {
              symbol: legacy.symbol,
              exchange: legacy.exchange,
              interval: legacy.interval,
            },
          }
        : nextContext,
      profilePatch,
      navigation,
    }
  } catch (error) {
    source?.dispose()
    throw error
  }
}
