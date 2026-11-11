import type { DatasetVersion } from '@/api/dataLibrary'
import { liveFeedExchange, liveFeedIntervals, platformSymbol } from '@/lib/chart/feeds/platformFeed'
import { type ChartEvidenceRecord, readChartEvidence } from '@/lib/trader/chartEvidence'
import type {
  ChartViewCheckpoint,
  JournalTrade,
  PracticeSession,
  TraderPortfolio,
} from '@/lib/trader/db'
import { journalHref, journalReturnHref } from '@/lib/trader/journalNavigation'
import type { JournalBookSummary } from '@/lib/trader/localStorageClient'

export interface ChartQuery {
  profileId?: number
  runId?: number
  tradeId?: number
  bookId?: string
  datasetVersionId?: string
  evidenceId?: string
  currentAnalysis?: boolean
  symbol?: string
  exchange?: string
  from?: number
  to?: number
  journalReturn?: string
  returnTo?: string
}
export interface LiveFeedChartContext {
  providerId: string
  providerName: string
  symbol: string
  exchange: string
  interval: string
  intervals: string[]
}
export interface ResolvedChartContext {
  key: string
  principal: string
  namespace: string
  preferenceScope?: string
  profile?: TraderPortfolio
  run?: PracticeSession
  trade?: JournalTrade
  dataset?: DatasetVersion
  liveFeed?: LiveFeedChartContext
  source: 'dataset' | 'live-feed' | 'legacy-connected' | 'missing'
  window?: { from: number; to: number }
  checkpoint?: ChartViewCheckpoint
  evidence?: ChartEvidenceRecord
  historicalUnavailable?: boolean
  defaultSymbol?: { symbol: string; exchange?: string; interval?: string }
  navigation: URLSearchParams
  returnHref: string
  bookId?: string
  executionAllowed: boolean
}
const id = (value: string | null) => {
  if (value === null) return undefined
  if (!/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('This chart link has an invalid record. Open the chart again from Workspace.')
  return Number(value)
}
const invalidText = (value: string) =>
  [...value].some(
    (character) =>
      character === '\\' || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
  )
function seconds(value: string | null) {
  if (value === null) return undefined
  if (!/^-?\d{1,12}(?:\.\d{1,6})?$/.test(value) || !Number.isFinite(Number(value)))
    throw new Error('This chart link has an invalid time window. Choose saved history again.')
  const result = Number(value)
  if (result < -62135596800 || result > 253402300799)
    throw new Error('The requested chart time is outside the supported range.')
  return result
}
export function chartReturn(target: string | null, profileId?: number): string | undefined {
  if (!target || target.length > 2000 || invalidText(target)) return undefined
  try {
    const url = new URL(target, 'http://chartly.local')
    if (url.origin !== 'http://chartly.local' || url.hash) return undefined
    const path = decodeURIComponent(url.pathname)
    if (invalidText(path) || path.split('/').some((part) => part === '.' || part === '..'))
      return undefined
    if (url.pathname === '/historify') return url.pathname + url.search
    if (url.pathname === '/workspace') return '/workspace'
    if (
      profileId &&
      (url.pathname === `/workspace/profiles/${profileId}/replay` ||
        url.pathname === `/workspace/profiles/${profileId}`)
    )
      return url.pathname + url.search
  } catch {
    /* invalid link */
  }
  return undefined
}
export function readChartQuery(params: URLSearchParams): ChartQuery {
  if (params.toString().length > 5000)
    throw new Error('This chart link is too long. Open it again from Workspace.')
  for (const key of [
    'profileId',
    'runId',
    'tradeId',
    'bookId',
    'datasetVersionId',
    'evidenceId',
    'currentAnalysis',
    'from',
    'to',
    'symbol',
    'exchange',
  ])
    if (params.getAll(key).length > 1)
      throw new Error('This chart link has conflicting selections. Open it again from Workspace.')
  const profileId = id(params.get('profileId'))
  const runId = id(params.get('runId'))
  const tradeId = id(params.get('tradeId'))
  const bookId = params.get('bookId') ?? undefined
  if (bookId && (!profileId || !/^[A-Za-z0-9_:-]{1,160}$/.test(bookId)))
    throw new Error('This chart book selection is invalid. Open the chart from its journal.')
  if ((runId || tradeId) && !profileId)
    throw new Error('Choose the run or journal entry from its own profile.')
  const version = params.get('datasetVersionId')
  if (version !== null && !/^[A-Za-z][A-Za-z0-9_-]{0,159}$/.test(version))
    throw new Error('This saved-history link is invalid. Choose the version in Data Library.')
  const evidenceId = params.get('evidenceId') ?? undefined
  if (evidenceId && ((!tradeId && !runId) || !/^[A-Za-z0-9_-]{1,160}$/.test(evidenceId)))
    throw new Error('This recorded chart link is invalid. Open it from its journal entry or run.')
  if (params.has('currentAnalysis') && params.get('currentAnalysis') !== '1')
    throw new Error('This chart analysis selection is invalid.')
  const symbol = params.get('symbol')?.trim()
  const exchange = params.get('exchange')?.trim()
  if (
    (symbol && (symbol.length > 160 || invalidText(symbol))) ||
    (exchange && (exchange.length > 64 || invalidText(exchange)))
  )
    throw new Error('This instrument link is invalid. Choose an instrument again.')
  if (!!symbol !== !!exchange)
    throw new Error('A chart instrument needs its venue. Choose the complete instrument again.')
  const from = seconds(params.get('from')),
    to = seconds(params.get('to'))
  if ((from === undefined) !== (to === undefined) || (from !== undefined && to! <= from))
    throw new Error('The chart window must end after it starts.')
  return {
    profileId,
    runId,
    tradeId,
    bookId,
    ...(version ? { datasetVersionId: version } : {}),
    evidenceId,
    currentAnalysis: params.get('currentAnalysis') === '1',
    ...(symbol ? { symbol, exchange } : {}),
    from,
    to,
    journalReturn: profileId
      ? (journalReturnHref(profileId, params.get('journalReturn')) ?? undefined)
      : undefined,
    returnTo: chartReturn(params.get('returnTo'), profileId),
  }
}
function day(value: string | undefined): number | undefined {
  if (!value) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error('The saved run has an invalid date window. Review the run first.')
  const time = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value)
    throw new Error('The saved run has an invalid date window. Review the run first.')
  return time / 1000
}
export function selectedChartRecords(
  query: ChartQuery,
  records: {
    portfolios: TraderPortfolio[]
    sessions: PracticeSession[]
    trades: JournalTrade[]
    bookAssignments?: Record<string, string>
    books?: JournalBookSummary[]
    storageMode?: string
  }
): {
  profile?: TraderPortfolio
  run?: PracticeSession
  trade?: JournalTrade
  bookId?: string
  evidence?: ChartEvidenceRecord
  datasetId?: string
  runVerificationId?: string
  historicalUnavailable?: boolean
  missing: boolean
} {
  const profile = query.profileId
    ? records.portfolios.find((row) => row.id === query.profileId && !row.archivedAt)
    : undefined
  if (query.profileId && !profile)
    throw new Error('This profile is missing or archived. Open an available profile in Workspace.')
  const run = query.runId
    ? records.sessions.find((row) => row.id === query.runId && !row.archivedAt)
    : undefined
  if (query.runId && (!run || run.portfolioId !== query.profileId))
    throw new Error(
      'This run does not belong to the selected profile. Open it from its replay project.'
    )
  const trade = query.tradeId
    ? records.trades.find((row) => row.id === query.tradeId && !row.archivedAt)
    : undefined
  if (
    query.tradeId &&
    (!trade || trade.portfolioId !== query.profileId || (run && trade.sessionId !== run.id))
  )
    throw new Error(
      'This journal entry does not belong to this chart context. Open its own journal.'
    )
  if (trade && query.symbol && query.symbol !== trade.pair)
    throw new Error(
      'The linked instrument differs from this journal entry. Open the trade’s own chart.'
    )
  if (query.bookId) {
    const book = records.books?.find((row) => row.id === query.bookId)
    const member =
      book &&
      (book.profileId === query.profileId ||
        book.profileIds?.includes(query.profileId!) ||
        (!!run && book.sessionId === run.id))
    const browserManual =
      records.storageMode === 'browser' && query.bookId === `manual:${profile?.id}`
    if (!member && !browserManual)
      throw new Error(
        'This journal book is not available in the selected profile. Open the chart from its own journal.'
      )
  }
  const bookId =
    records.storageMode === 'browser'
      ? undefined
      : trade
        ? (records.bookAssignments?.[`journalTrades:${trade.id}`] ??
          records.bookAssignments?.[String(trade.id)] ??
          trade.journalBookId)
        : query.bookId
  if (query.bookId && bookId && query.bookId !== bookId)
    throw new Error('This journal entry belongs to another book. Open its own journal chart.')
  const bound =
    run?.datasetVersionId ??
    (profile?.chartSource?.kind === 'dataset' ? profile.chartSource.versionId : undefined)
  const evidence = query.evidenceId
    ? readChartEvidence(trade ?? run).find((item) => item.id === query.evidenceId)
    : undefined
  if (query.evidenceId && !evidence)
    throw new Error(
      'This recorded chart is not available on the selected entry or run. Open its own saved evidence.'
    )
  if (trade && evidence && evidence.instrument.symbol !== trade.pair)
    throw new Error(
      'The recorded chart belongs to another instrument. Open the journal entry’s own evidence.'
    )
  if (
    evidence &&
    (!Number.isFinite(Date.parse(evidence.capturedAt)) ||
      !['dataset', 'legacy-connected'].includes(evidence.source.kind) ||
      !evidence.instrument.symbol ||
      !evidence.instrument.exchange ||
      !evidence.view.timezone ||
      !evidence.view.chartType ||
      [evidence.view.visibleFrom, evidence.view.visibleTo, evidence.view.replayAsOf].some(
        (value) => value !== undefined && !Number.isFinite(value)
      ))
  )
    throw new Error(
      'The recorded chart metadata is incomplete. Its saved image remains in the journal.'
    )
  const recordedSource = evidence?.source.kind === 'dataset' ? evidence.source : undefined
  if (
    recordedSource &&
    (!/^[A-Za-z][A-Za-z0-9_-]{0,159}$/.test(recordedSource.datasetVersionId) ||
      !/^[a-f0-9]{64}$/.test(recordedSource.checksum))
  )
    throw new Error('The recorded chart source is invalid. Restore the original backup.')
  if (
    recordedSource &&
    query.datasetVersionId &&
    query.datasetVersionId !== recordedSource.datasetVersionId
  )
    throw new Error(
      'This link conflicts with the recorded chart source. Reopen the saved evidence.'
    )
  if (run?.datasetVersionId && recordedSource && recordedSource.checksum !== run.datasetChecksum)
    throw new Error('This recorded chart conflicts with the pinned run source. Open its own run.')
  if (run && !run.datasetVersionId && !recordedSource)
    return {
      profile,
      run,
      trade,
      bookId,
      evidence,
      datasetId: undefined,
      missing: !(query.currentAnalysis && evidence?.source.kind === 'legacy-connected'),
      historicalUnavailable: !!trade || !!evidence,
    }
  if (run && query.datasetVersionId && bound && query.datasetVersionId !== bound && !recordedSource)
    throw new Error(
      'This chart link conflicts with the saved run source. Open the run again from its replay project.'
    )
  const datasetId =
    recordedSource?.datasetVersionId ?? query.datasetVersionId ?? (evidence ? undefined : bound)
  const historicalUnavailable = !!(trade || evidence) && !datasetId
  return {
    profile,
    run,
    trade,
    bookId,
    evidence,
    datasetId,
    runVerificationId:
      run?.datasetVersionId &&
      recordedSource &&
      run.datasetVersionId !== recordedSource.datasetVersionId
        ? run.datasetVersionId
        : undefined,
    historicalUnavailable,
    missing:
      !datasetId &&
      ((historicalUnavailable && !query.currentAnalysis) ||
        (!query.currentAnalysis &&
          profile?.kind === 'replay' &&
          profile.chartSource?.kind !== 'connected') ||
        !!run),
  }
}
function resolveLiveFeed(
  query: ChartQuery,
  selected: ReturnType<typeof selectedChartRecords>
): LiveFeedChartContext | undefined {
  const { profile, run, trade, evidence } = selected
  const pinned = profile?.chartSource
  if (
    !profile ||
    profile.kind !== 'live' ||
    pinned?.kind !== 'live-feed' ||
    selected.datasetId ||
    run ||
    evidence ||
    (trade && !query.currentAnalysis)
  )
    return undefined
  const intervals = liveFeedIntervals(pinned.providerId)
  if (
    !pinned.providerName ||
    pinned.providerName.length > 160 ||
    invalidText(pinned.providerName) ||
    typeof pinned.symbol !== 'string' ||
    platformSymbol(pinned.providerId, pinned.symbol) !== pinned.symbol ||
    pinned.exchange !== liveFeedExchange(pinned.providerId) ||
    !intervals.includes(pinned.interval)
  )
    throw new Error(
      'This profile’s live chart feed is incomplete. Choose its platform feed again from the chart data source.'
    )
  const symbol = trade?.pair ?? query.symbol ?? pinned.symbol
  if (query.exchange && query.exchange !== pinned.exchange)
    throw new Error('The linked venue differs from this profile’s live chart feed.')
  if (platformSymbol(pinned.providerId, symbol) !== symbol)
    throw new Error('The linked symbol is invalid for this profile’s live chart feed.')
  return {
    providerId: pinned.providerId,
    providerName: pinned.providerName,
    symbol,
    exchange: pinned.exchange,
    interval: trade && intervals.includes(trade.timeframe) ? trade.timeframe : pinned.interval,
    intervals,
  }
}
export function resolveChartContext(
  principal: string,
  query: ChartQuery,
  selected: ReturnType<typeof selectedChartRecords>,
  dataset?: DatasetVersion,
  verifiedRunDataset?: DatasetVersion
): ResolvedChartContext {
  const { profile, run, trade, evidence } = selected
  const requested = selected.datasetId
  if (requested) {
    if (
      !dataset ||
      (dataset.id !== requested &&
        (dataset as DatasetVersion & { resolvedFromVersionId?: string }).resolvedFromVersionId !==
          requested)
    )
      throw new Error(
        'The requested saved history could not be verified. Choose it in Data Library.'
      )
    const checksum =
      (evidence?.source.kind === 'dataset' ? evidence.source.checksum : undefined) ??
      run?.datasetChecksum ??
      (profile?.chartSource?.kind === 'dataset' && profile.chartSource.versionId === requested
        ? profile.chartSource.checksum
        : undefined)
    if (checksum && checksum !== dataset.checksum)
      throw new Error(
        'The saved history checksum differs from this run. Restore the original dataset backup.'
      )
    if (
      selected.runVerificationId &&
      (!verifiedRunDataset ||
        (verifiedRunDataset.id !== selected.runVerificationId &&
          (verifiedRunDataset as DatasetVersion & { resolvedFromVersionId?: string })
            .resolvedFromVersionId !== selected.runVerificationId) ||
        verifiedRunDataset.id !== dataset.id ||
        verifiedRunDataset.checksum !== dataset.checksum ||
        verifiedRunDataset.checksum !== run?.datasetChecksum)
    )
      throw new Error(
        'The recorded source could not be verified as the pinned run’s restored version. Restore its original history or reopen the run source.'
      )
    if (
      run &&
      (run.symbol !== dataset.metadata.symbol || run.timeframe !== dataset.metadata.interval)
    )
      throw new Error(
        'The saved run instrument or native interval differs from its history. Review the run first.'
      )
    if (trade && trade.pair !== dataset.metadata.symbol)
      throw new Error(
        'This journal entry uses another instrument. Choose its matching history before attaching chart evidence.'
      )
    if (
      evidence &&
      (evidence.instrument.symbol !== dataset.metadata.symbol ||
        evidence.instrument.exchange !== dataset.metadata.exchange ||
        evidence.view.interval !== dataset.metadata.interval)
    )
      throw new Error(
        'The recorded chart instrument or native interval differs from its saved source. Restore matching history.'
      )
    if (
      evidence?.view.replayAsOf !== undefined &&
      (evidence.view.replayAsOf < dataset.start ||
        evidence.view.replayAsOf > dataset.end + 32 * 86400)
    )
      throw new Error(
        'The recorded replay time is outside its saved history. Restore matching history.'
      )
    if (
      query.symbol &&
      (query.symbol !== dataset.metadata.symbol || query.exchange !== dataset.metadata.exchange)
    )
      throw new Error('The linked instrument differs from the selected immutable dataset.')
  }
  let window: { from: number; to: number } | undefined
  if (dataset) {
    const paperWindow = run?.paper?.window
    if (
      paperWindow &&
      (!Number.isFinite(paperWindow.from) ||
        !Number.isFinite(paperWindow.to) ||
        paperWindow.from > paperWindow.to)
    )
      throw new Error('The managed paper window is invalid. Reload its saved account.')
    const start = day(run?.rangeStart),
      end = day(run?.rangeEnd)
    if (start !== undefined && end !== undefined && end < start)
      throw new Error('The saved run window ends before it starts.')
    const from = Math.max(
      dataset.start,
      paperWindow?.from ?? dataset.start,
      start ?? dataset.start,
      evidence || paperWindow ? dataset.start : (query.from ?? dataset.start)
    )
    const to = Math.min(
      dataset.end,
      paperWindow?.to ?? dataset.end,
      end === undefined ? dataset.end : end + 86400 - 0.000001,
      evidence || paperWindow || query.to === undefined ? dataset.end : query.to - 0.000001
    )
    if (from > dataset.end || to < dataset.start || to < from)
      throw new Error(
        'This run window has no saved candles. Review its dates or import the required history.'
      )
    window = { from, to }
    if (trade?.openDate && !evidence) {
      const opened = /^\d{4}-\d{2}-\d{2}$/.test(trade.openDate)
        ? day(trade.openDate)
        : /(?:Z|[+-]\d{2}:\d{2})$/.test(trade.openDate)
          ? Date.parse(trade.openDate) / 1000
          : undefined
      if (opened !== undefined && Number.isFinite(opened)) {
        const dateOnly = trade.openDate.length === 10
        const end = dateOnly ? opened + 86400 : opened + 0.000001
        if (opened > to || end <= from)
          throw new Error(
            'This trade date has no candles in the selected saved history. Choose or import matching trade history; current prices cannot reconstruct it.'
          )
      }
    }
  }
  const liveFeed = dataset ? undefined : resolveLiveFeed(query, selected)
  const source = dataset
    ? 'dataset'
    : liveFeed
      ? 'live-feed'
      : selected.missing
        ? 'missing'
        : 'legacy-connected'
  const contextParts = [
    principal,
    ...(profile ? [`profile-${profile.id}`] : []),
    ...(run ? [`run-${run.id}`] : []),
    source,
    ...(dataset ? [dataset.id] : []),
    ...(liveFeed
      ? [liveFeed.providerId, liveFeed.exchange, liveFeed.symbol, liveFeed.interval]
      : []),
    ...(liveFeed && trade ? [`journal-analysis-${trade.id}`] : []),
    ...(liveFeed && query.symbol ? ['linked-instrument'] : []),
  ]
  const scope = contextParts.map((part) => encodeURIComponent(part)).join(':')
  const namespace = !profile && !dataset ? `oa-trading:${principal}` : `oa-trading:${scope}`
  const navigation = new URLSearchParams()
  if (profile?.id) {
    navigation.set('profileId', String(profile.id))
    navigation.set('profileName', profile.name)
    navigation.set('profileKind', profile.kind)
  }
  if (run?.id) navigation.set('runId', String(run.id))
  if (trade?.id) navigation.set('tradeId', String(trade.id))
  if (selected.bookId) navigation.set('bookId', selected.bookId)
  if (evidence) navigation.set('evidenceId', evidence.id)
  if (query.currentAnalysis) navigation.set('currentAnalysis', '1')
  if (liveFeed && query.symbol) {
    navigation.set('symbol', liveFeed.symbol)
    navigation.set('exchange', liveFeed.exchange)
  }
  if (dataset) navigation.set('datasetVersionId', requested ?? dataset.id)
  if (query.journalReturn) navigation.set('journalReturn', query.journalReturn)
  const returnHref =
    query.journalReturn ??
    query.returnTo ??
    (run && profile
      ? `/workspace/profiles/${profile.id}/replay`
      : profile
        ? `/workspace/profiles/${profile.id}`
        : '/workspace')
  if (query.returnTo) navigation.set('returnTo', query.returnTo)
  const checkpoint = run?.chartView ?? profile?.chartView
  const validCheckpoint =
    dataset &&
    checkpoint &&
    checkpoint.version === 1 &&
    checkpoint.datasetChecksum === dataset.checksum &&
    [dataset.id, requested].includes(checkpoint.datasetVersionId) &&
    Number.isFinite(checkpoint.cursorTime) &&
    checkpoint.cursorTime >= window!.from &&
    checkpoint.cursorTime <= window!.to
      ? checkpoint
      : undefined
  return {
    key: `${namespace}:${window?.from ?? ''}:${window?.to ?? ''}:${trade ? `trade-${trade.id}-${trade.pair}-${trade.timeframe}` : ''}:${evidence?.id ?? ''}:${query.currentAnalysis ? 'current' : ''}`,
    principal,
    namespace,
    preferenceScope: profile || dataset ? scope : undefined,
    profile,
    run,
    trade,
    dataset,
    liveFeed,
    source,
    window,
    checkpoint: evidence || trade ? undefined : validCheckpoint,
    evidence,
    historicalUnavailable: selected.historicalUnavailable,
    navigation,
    returnHref,
    defaultSymbol: dataset
      ? {
          symbol: dataset.metadata.symbol,
          exchange: dataset.metadata.exchange,
          interval: dataset.metadata.interval,
        }
      : liveFeed
        ? {
            symbol: liveFeed.symbol,
            exchange: liveFeed.exchange,
            interval: liveFeed.interval,
          }
        : evidence
          ? {
              symbol: evidence.instrument.symbol,
              exchange: evidence.instrument.exchange,
              interval: evidence.view.interval,
            }
          : trade
            ? {
                symbol: trade.pair,
                exchange: query.symbol === trade.pair ? query.exchange : undefined,
                interval: trade.timeframe,
              }
            : query.symbol
              ? { symbol: query.symbol, exchange: query.exchange }
              : profile?.defaultSymbol
                ? { symbol: profile.defaultSymbol, interval: profile.defaultTimeframe }
                : undefined,
    bookId: selected.bookId,
    executionAllowed: !profile && !dataset,
  }
}
export function chartContextHref(context: Pick<ResolvedChartContext, 'navigation'>): string {
  return `/trading?${context.navigation}`
}
export function contextJournalHref(context: ResolvedChartContext) {
  return context.profile?.id ? journalHref(context.profile.id) : '/workspace'
}
