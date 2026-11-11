import type {
  BrokerAccount,
  PracticeMarket,
  ProfileDestination,
  TraderPortfolio,
  TradingProfileKind,
} from './db'

export interface LegacyProfileClassification {
  kind: TradingProfileKind
  needsClassification: boolean
}

export function classifyLegacyProfile(input: {
  name: string
  sessionCount: number
}): LegacyProfileClassification {
  if (input.name === 'Personal Portfolio') {
    return { kind: 'live', needsClassification: false }
  }
  if (input.sessionCount > 0) {
    return { kind: 'replay', needsClassification: false }
  }
  return { kind: 'replay', needsClassification: true }
}

export function isEmotionTrackingEnabled(
  portfolio: Pick<TraderPortfolio, 'emotionTrackingEnabled'> | null | undefined
): boolean {
  // New profiles store explicit false until opted in. Legacy records predate
  // the preference, so undefined preserves their existing mindset history/UI.
  return portfolio ? portfolio.emotionTrackingEnabled !== false : false
}

export function isBrokerAccountEnabled(
  account: Pick<BrokerAccount, 'enabled'> | null | undefined
): boolean {
  // Accounts created before the on/off switch have no flag and stay usable.
  return account ? account.enabled !== false : false
}

export function isDestinationCopyActive(
  destination: Pick<ProfileDestination, 'copyingEnabled'>,
  account: Pick<BrokerAccount, 'enabled'> | null | undefined
): boolean {
  return destination.copyingEnabled && isBrokerAccountEnabled(account)
}

export function validateDestinationSettings(destination: ProfileDestination): string[] {
  const errors: string[] = []

  if (!destination.accountId) errors.push('Choose a broker account.')
  if (destination.lotScalingFactor <= 0) errors.push('Lot scaling must be greater than zero.')
  if (destination.maxLotCap < 0) errors.push('Max lot cap cannot be negative.')
  if (destination.maxTotalLots < 0) errors.push('Max total lots cannot be negative.')
  if (destination.maxConcurrentPositions < 0) {
    errors.push('Max concurrent positions cannot be negative.')
  }
  if (
    destination.randomDelayEnabled &&
    destination.minDelayMs > destination.maxDelayMs
  ) {
    errors.push('Minimum delay must not exceed maximum delay.')
  }
  if (destination.minDelayMs < 0 || destination.maxDelayMs < 0) {
    errors.push('Delay values cannot be negative.')
  }
  if (destination.lotNoisePct < 0 || destination.lotNoisePct > 100) {
    errors.push('Lot noise must be between 0 and 100%.')
  }
  if (destination.dailyDdCapPct < 0 || destination.dailyDdCapPct > 100) {
    errors.push('Daily drawdown cap must be between 0 and 100%.')
  }
  if (destination.maxDdCapPct < 0 || destination.maxDdCapPct > 100) {
    errors.push('Maximum drawdown cap must be between 0 and 100%.')
  }
  if (destination.commentPolicy === 'custom' && !destination.customComment?.trim()) {
    errors.push('Enter a custom order comment or choose another comment policy.')
  }

  return errors
}

export interface DestinationRiskDiff {
  increasing: boolean
  reasons: string[]
}

export function isRiskIncreasingDestinationChange(
  previous: ProfileDestination | undefined,
  next: ProfileDestination
): DestinationRiskDiff {
  if (!previous) {
    return next.copyingEnabled
      ? { increasing: true, reasons: ['new copying destination enabled'] }
      : { increasing: false, reasons: [] }
  }

  const reasons: string[] = []
  if (!previous.copyingEnabled && next.copyingEnabled) reasons.push('copying enabled')
  if (!previous.copyExistingPositions && next.copyExistingPositions) {
    reasons.push('copy existing positions enabled')
  }
  if (next.lotScalingFactor > previous.lotScalingFactor) reasons.push('lot scaling increased')
  if (
    previous.maxLotCap > 0 &&
    (next.maxLotCap <= 0 || next.maxLotCap > previous.maxLotCap)
  ) {
    reasons.push('max lot cap raised or removed')
  }
  if (
    previous.maxTotalLots > 0 &&
    (next.maxTotalLots <= 0 || next.maxTotalLots > previous.maxTotalLots)
  ) {
    reasons.push('max total lots raised or removed')
  }
  if (
    previous.maxConcurrentPositions > 0 &&
    (next.maxConcurrentPositions <= 0 ||
      next.maxConcurrentPositions > previous.maxConcurrentPositions)
  ) {
    reasons.push('max concurrent positions raised or removed')
  }
  if (previous.ddGuardEnabled && !next.ddGuardEnabled) reasons.push('drawdown guard disabled')
  if (next.dailyDdCapPct > previous.dailyDdCapPct) reasons.push('daily drawdown cap increased')
  if (next.maxDdCapPct > previous.maxDdCapPct) reasons.push('maximum drawdown cap increased')
  if (previous.lotScalingMode === 'flat' && next.lotScalingMode !== 'flat') {
    reasons.push(`sizing mode changed to ${next.lotScalingMode}`)
  }

  return { increasing: reasons.length > 0, reasons }
}

export function getDestinationOwnershipConflict(
  destinations: ProfileDestination[],
  candidate: ProfileDestination
): ProfileDestination | undefined {
  if (!candidate.copyingEnabled) return undefined
  return destinations.find(
    (destination) =>
      destination.id !== candidate.id &&
      destination.accountId === candidate.accountId &&
      destination.portfolioId !== candidate.portfolioId &&
      destination.copyingEnabled
  )
}

export function withDefaultChartDataSource(
  destinations: ProfileDestination[],
  candidate: ProfileDestination
): ProfileDestination {
  if (candidate.isChartDataSource) return candidate
  const hasSource = destinations.some(
    (destination) =>
      destination.id !== candidate.id &&
      destination.portfolioId === candidate.portfolioId &&
      destination.isChartDataSource
  )
  return hasSource ? candidate : { ...candidate, isChartDataSource: true }
}

export function inferMarketForSymbol(
  symbol: string,
  fallback: PracticeMarket
): PracticeMarket {
  const normalized = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (/^(XAU|XAG|GOLD|SILVER)/.test(normalized)) return 'Metals'
  if (/^(BTC|ETH|SOL|XRP|DOGE|ADA|LTC)/.test(normalized)) return 'Crypto'
  return fallback
}

export function defaultDestination(input: {
  portfolioId: number
  accountId: number
  terminalId?: number
  symbolSuffix?: string
  now: string
}): ProfileDestination {
  return {
    portfolioId: input.portfolioId,
    accountId: input.accountId,
    terminalId: input.terminalId,
    copyingEnabled: false,
    copyExistingPositions: false,
    isChartDataSource: false,
    symbolSuffixOverride: input.symbolSuffix ?? '',
    lotScalingMode: 'flat',
    lotScalingFactor: 1,
    maxLotCap: 0,
    maxTotalLots: 0,
    maxConcurrentPositions: 0,
    randomDelayEnabled: false,
    minDelayMs: 500,
    maxDelayMs: 5_000,
    randomLotNoiseEnabled: false,
    lotNoisePct: 0,
    commentPolicy: 'strategy',
    ddGuardEnabled: true,
    dailyDdCapPct: 2,
    dailyDdAutoReset: true,
    maxDdCapPct: 10,
    maxDdResetMode: 'manual',
    createdAt: input.now,
    updatedAt: input.now,
  }
}
