import Dexie, { type Table } from 'dexie'
import type { ChartEvidenceRecord } from './chartEvidence'

export interface ChartViewCheckpoint {
  version: 1
  datasetVersionId: string
  datasetChecksum: string
  cursorTime: number
}
export type ProfileChartSource =
  | { kind: 'dataset'; versionId: string; checksum: string }
  | {
      kind: 'live-feed'
      providerId: string
      providerName: string
      symbol: string
      exchange: string
      interval: string
    }
  | { kind: 'connected' }

export type TradingProfileKind = 'live' | 'replay'

/**
 * Guided-setup intent, deliberately separate from proof:
 * - account verification lives in the backend connector record;
 * - actual chart candles live in the pinned saved-history version.
 */
export interface LiveProfileSetup {
  version: 1
  account: {
    mode: 'connector' | 'later' | 'journal-only'
    providerId?: string
    providerName?: string
    category?: 'brokerage' | 'crypto' | 'desktop' | 'diagnostic'
    connectionLabel?: string
  }
  chartData: {
    mode: 'live-feed' | 'saved-history' | 'later'
    providerId?: string
    providerName?: string
    symbol?: string
    interval?: string
    datasetVersionId?: string
  }
  replayHistory?: {
    mode: 'download' | 'saved-history' | 'later'
    providerId?: string
    providerName?: string
    symbol?: string
    interval?: string
    datasetVersionId?: string
  }
}

export interface TraderPortfolio {
  chartSource?: ProfileChartSource
  liveSetup?: LiveProfileSetup
  chartView?: ChartViewCheckpoint
  id?: number
  name: string
  kind: TradingProfileKind
  currency: string
  startingBalance: number
  legacyStartingBalance?: number
  sessionLabel?: string
  sessionTags?: string[]
  timezone?: string
  strategyTags?: string[]
  defaultSymbol?: string
  defaultTimeframe?: string
  emotionTrackingEnabled?: boolean
  needsClassification?: boolean
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

/** User-facing name for the persisted profile record. */
export type TradingProfile = TraderPortfolio

export type PracticeMode = 'Replay' | 'Backtest' | 'Practice'
export type PracticeMarket = 'Crypto' | 'Forex' | 'Metals' | 'Commodities' | 'Indices' | 'Stocks'
export type SessionStatus = 'Draft' | 'Ready' | 'In progress' | 'Completed'

export interface PracticeSession {
  paper?: {
    version: 1
    revision: number
    status: string
    manifestId: string
    startingCash?: string
    window?: { from: number; to: number }
  }
  chartView?: ChartViewCheckpoint
  chartEvidence?: ChartEvidenceRecord[]
  archivedAt?: string
  id?: number
  portfolioId: number
  name: string
  mode: PracticeMode
  market: PracticeMarket
  symbol: string
  timeframe: string
  dataSource: string
  datasetVersionId?: string
  datasetChecksum?: string
  rangeStart?: string
  rangeEnd?: string
  status: SessionStatus
  startingBalance: number
  currency?: string
  notes: string
  createdAt: string
  updatedAt: string
}

export type TradeDirection = 'Buy' | 'Sell'
export type TradeResult = 'Win' | 'Loss' | 'Break Even' | 'Open'
export type TradeOrigin = 'manual' | 'replay' | 'chart' | 'simulator' | 'connector' | 'imported'
export type DailyState = 'Focused' | 'Steady' | 'Distracted' | 'Emotional' | 'Exhausted'

export interface EmotionScores {
  fomo: number
  patience: number
  discipline: number
  confidence: number
}

export interface JournalTrade {
  chartEvidence?: ChartEvidenceRecord[]
  amounts?: JournalAmounts
  realizations?: JournalRealization[]
  remainingQuantity?: string
  currency?: string
  quantityUnit?: string
  cashflowAmount?: string
  eventType?: 'trade' | 'deposit' | 'withdrawal' | 'fee'
  decisionId?: string
  sourceDecisionId?: string
  sourceCopyGroupId?: string
  copyGroupId?: string
  reviewStatus?: 'unreviewed' | 'reviewed'
  reviewedAt?: string
  factRevision?: number
  reviewRevision?: number
  sourceEventKeys?: string[]
  positionKey?: string
  sourceTimezone?: string
  history?: JournalHistoryEvent[]
  archivedAt?: string
  journalBookId?: string
  id?: number
  portfolioId: number
  sessionId?: number
  openDate: string
  closeDate: string
  timeframe: string
  pair: string
  strategy: string
  direction: TradeDirection
  lots: number
  result: TradeResult
  rr: number
  sl: number
  tp: number
  entryPrice?: number
  exitPrice?: number
  pnl: number
  netPnl: number
  grossPnl?: number
  commission?: number
  swap?: number
  fees?: number
  pips?: number
  setup?: string
  tags?: string[]
  rating?: number
  chartUrl?: string
  externalId?: string
  riskAmount?: number
  rMultiple?: number
  screenshotUrl?: string
  origin?: TradeOrigin
  accountId?: number
  externalOrderId?: string
  externalPositionId?: string
  externalDealId?: string
  preTradeState?: DailyState
  conviction?: number
  planConfirmed?: boolean
  riskDefined?: boolean
  emotion?: EmotionScores
  emotionalNotes: string
  technicalNotes: string
  otherNotes: string
  duration: number
}

export interface JournalAmounts {
  netPnl?: string | null
  grossPnl?: string | null
  commission?: string | null
  swap?: string | null
  fees?: string | null
  riskAmount?: string | null
  quantity?: string | null
  entryPrice?: string | null
  exitPrice?: string | null
}
export interface JournalHistoryEvent {
  id: string
  at: string
  action: string
  reason?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}
export interface JournalRealization {
  kind?: 'exit' | 'fee'
  id: string
  closedAt: string
  quantity: string
  netPnl: string
  grossPnl?: string | null
  commission?: string | null
  swap?: string | null
  fees?: string | null
  exitPrice?: string | null
}

export interface DailyMood {
  archivedAt?: string
  id?: number
  portfolioId: number
  date: string
  state?: DailyState
  moodScore: number
  energyLevel: number
  stressLevel: number
  sleepHours: number
  dietScore: string
  caffeineIntake: string
  exercised: boolean
  notes?: string
}

export type PlatformKind =
  | 'mt5'
  | 'ninjatrader'
  | 'tradestation'
  | 'broker-api'
  | 'simulator'
  | 'manual'
export type BrokerAccountKind = 'live' | 'demo' | 'prop'

export interface BrokerAccount {
  archivedAt?: string
  id?: number
  displayName: string
  platform: PlatformKind
  brokerName: string
  server: string
  externalLogin: string
  accountKind: BrokerAccountKind
  currency: string
  symbolSuffix: string
  enabled?: boolean
  secretRef?: string
  createdAt: string
  updatedAt: string
}

export type TerminalDiscoverySource = 'manual' | 'simulator' | 'scan'

export interface TradingTerminal {
  archivedAt?: string
  id?: number
  platform: PlatformKind
  label: string
  exePath?: string
  assignedAccountId?: number
  discoverySource: TerminalDiscoverySource
  lastSeenAt?: string
  running: boolean
  createdAt: string
  updatedAt: string
}

export type LotScalingMode = 'flat' | 'equity_ratio' | 'smart'
export type CommentPolicy = 'strategy' | 'blank' | 'custom'
export type DrawdownResetMode = 'auto' | 'manual'

export interface ProfileDestination {
  archivedAt?: string
  id?: number
  portfolioId: number
  accountId: number
  terminalId?: number
  copyingEnabled: boolean
  copyExistingPositions: boolean
  isChartDataSource: boolean
  symbolSuffixOverride: string
  lotScalingMode: LotScalingMode
  lotScalingFactor: number
  maxLotCap: number
  maxTotalLots: number
  maxConcurrentPositions: number
  randomDelayEnabled: boolean
  minDelayMs: number
  maxDelayMs: number
  randomLotNoiseEnabled: boolean
  lotNoisePct: number
  commentPolicy: CommentPolicy
  customComment?: string
  ddGuardEnabled: boolean
  dailyDdCapPct: number
  dailyDdAutoReset: boolean
  maxDdCapPct: number
  maxDdResetMode: DrawdownResetMode
  pausedReason?: string
  createdAt: string
  updatedAt: string
}

class ChartlyTraderDatabase extends Dexie {
  portfolios!: Table<TraderPortfolio, number>
  practiceSessions!: Table<PracticeSession, number>
  journalTrades!: Table<JournalTrade, number>
  dailyMoods!: Table<DailyMood, number>
  brokerAccounts!: Table<BrokerAccount, number>
  terminals!: Table<TradingTerminal, number>
  profileDestinations!: Table<ProfileDestination, number>

  constructor() {
    super('ChartlyTraderDB')
    this.version(1).stores({
      portfolios: '++id, name, createdAt, updatedAt',
      practiceSessions: '++id, portfolioId, mode, market, status, updatedAt',
      journalTrades:
        '++id, portfolioId, sessionId, [portfolioId+openDate], openDate, closeDate, pair, strategy, result',
      dailyMoods: '++id, &[portfolioId+date], portfolioId, date',
    })

    this.version(2)
      .stores({
        portfolios: '++id, name, kind, createdAt, updatedAt',
        practiceSessions: '++id, portfolioId, mode, market, status, updatedAt',
        journalTrades:
          '++id, portfolioId, sessionId, accountId, externalDealId, [portfolioId+openDate], openDate, closeDate, pair, strategy, result',
        dailyMoods: '++id, &[portfolioId+date], portfolioId, date',
        brokerAccounts: '++id, platform, externalLogin, accountKind, updatedAt',
        terminals: '++id, platform, assignedAccountId, updatedAt',
        profileDestinations:
          '++id, &[portfolioId+accountId], portfolioId, accountId, terminalId, updatedAt',
      })
      .upgrade(async (tx) => {
        const sessions = await tx.table('practiceSessions').toArray()
        const sessionCounts = new Map<number, number>()
        for (const session of sessions as PracticeSession[]) {
          sessionCounts.set(session.portfolioId, (sessionCounts.get(session.portfolioId) ?? 0) + 1)
        }

        await tx
          .table('portfolios')
          .toCollection()
          .modify((portfolio: Partial<TraderPortfolio>) => {
            const sessionCount = portfolio.id ? (sessionCounts.get(portfolio.id) ?? 0) : 0
            if (portfolio.name === 'Personal Portfolio') {
              portfolio.kind = 'live'
              portfolio.needsClassification = false
            } else if (sessionCount > 0) {
              portfolio.kind = 'replay'
              portfolio.needsClassification = false
            } else {
              portfolio.kind = 'replay'
              portfolio.needsClassification = true
            }

            if (portfolio.kind === 'live' && portfolio.startingBalance) {
              portfolio.legacyStartingBalance = portfolio.startingBalance
            }
            portfolio.strategyTags = portfolio.strategyTags ?? []
          })

        await tx
          .table('journalTrades')
          .toCollection()
          .modify((trade: Partial<JournalTrade>) => {
            if (!trade.origin) trade.origin = trade.sessionId ? 'replay' : 'manual'
          })
      })
  }
}

export const traderDb = new ChartlyTraderDatabase()

export function nowIso() {
  return new Date().toISOString()
}

export async function ensureTraderSeed(): Promise<number> {
  return traderDb.transaction('rw', traderDb.portfolios, async () => {
    const existing = await traderDb.portfolios.orderBy('createdAt').first()
    if (existing?.id) return existing.id

    const at = nowIso()
    return traderDb.portfolios.add({
      name: 'Personal Portfolio',
      kind: 'live',
      currency: 'USD',
      startingBalance: 0,
      strategyTags: [],
      emotionTrackingEnabled: false,
      createdAt: at,
      updatedAt: at,
    })
  })
}
