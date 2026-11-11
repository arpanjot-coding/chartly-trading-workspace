import { describe, expect, it } from 'vitest'
import type { ProfileDestination } from './db'
import {
  classifyLegacyProfile,
  getDestinationOwnershipConflict,
  inferMarketForSymbol,
  isBrokerAccountEnabled,
  isDestinationCopyActive,
  isEmotionTrackingEnabled,
  isRiskIncreasingDestinationChange,
  validateDestinationSettings,
  withDefaultChartDataSource,
} from './profileModel'

function destination(overrides: Partial<ProfileDestination> = {}): ProfileDestination {
  return {
    portfolioId: 1,
    accountId: 10,
    copyingEnabled: false,
    copyExistingPositions: false,
    isChartDataSource: false,
    symbolSuffixOverride: '',
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('trading profile model', () => {
  it('classifies legacy profiles without losing ambiguous records', () => {
    expect(classifyLegacyProfile({ name: 'Personal Portfolio', sessionCount: 0 })).toEqual({
      kind: 'live',
      needsClassification: false,
    })
    expect(classifyLegacyProfile({ name: 'Gold tests', sessionCount: 3 })).toEqual({
      kind: 'replay',
      needsClassification: false,
    })
    expect(classifyLegacyProfile({ name: 'Old profile', sessionCount: 0 })).toEqual({
      kind: 'replay',
      needsClassification: true,
    })
  })

  it('treats emotion tracking as explicit opt-in for new profiles but preserves legacy profiles', () => {
    expect(isEmotionTrackingEnabled({ emotionTrackingEnabled: true })).toBe(true)
    expect(isEmotionTrackingEnabled({ emotionTrackingEnabled: false })).toBe(false)
    expect(isEmotionTrackingEnabled({})).toBe(true)
    expect(isEmotionTrackingEnabled(null)).toBe(false)
  })

  it('treats legacy broker accounts as on and makes account-off override destination copy-on', () => {
    expect(isBrokerAccountEnabled({})).toBe(true)
    expect(isBrokerAccountEnabled({ enabled: true })).toBe(true)
    expect(isBrokerAccountEnabled({ enabled: false })).toBe(false)
    expect(isBrokerAccountEnabled(null)).toBe(false)

    const armed = destination({ copyingEnabled: true })
    expect(isDestinationCopyActive(armed, {})).toBe(true)
    expect(isDestinationCopyActive(armed, { enabled: false })).toBe(false)
    expect(isDestinationCopyActive(destination(), { enabled: true })).toBe(false)
  })

  it('validates destination delay and risk ranges', () => {
    expect(validateDestinationSettings(destination())).toEqual([])
    expect(
      validateDestinationSettings(
        destination({ randomDelayEnabled: true, minDelayMs: 6_000, maxDelayMs: 5_000 })
      )
    ).toContain('Minimum delay must not exceed maximum delay.')
    expect(validateDestinationSettings(destination({ dailyDdCapPct: 101 }))).toContain(
      'Daily drawdown cap must be between 0 and 100%.'
    )
  })

  it('flags changes that increase live destination risk', () => {
    const before = destination()
    const after = destination({
      copyingEnabled: true,
      copyExistingPositions: true,
      lotScalingFactor: 2,
      ddGuardEnabled: false,
      dailyDdCapPct: 4,
    })

    const diff = isRiskIncreasingDestinationChange(before, after)
    expect(diff.increasing).toBe(true)
    expect(diff.reasons).toEqual(
      expect.arrayContaining([
        'copying enabled',
        'copy existing positions enabled',
        'lot scaling increased',
        'drawdown guard disabled',
        'daily drawdown cap increased',
      ])
    )
  })

  it('makes the first destination the chart data source only when none is selected', () => {
    const candidate = destination({ portfolioId: 7 })
    expect(withDefaultChartDataSource([], candidate).isChartDataSource).toBe(true)
    expect(
      withDefaultChartDataSource(
        [destination({ id: 99, portfolioId: 7, isChartDataSource: true })],
        candidate
      ).isChartDataSource
    ).toBe(false)
    expect(
      withDefaultChartDataSource(
        [destination({ id: 100, portfolioId: 8, isChartDataSource: true })],
        candidate
      ).isChartDataSource
    ).toBe(true)
  })

  it('infers obvious replay markets from symbols', () => {
    expect(inferMarketForSymbol('XAUUSD', 'Forex')).toBe('Metals')
    expect(inferMarketForSymbol('xagusd', 'Forex')).toBe('Metals')
    expect(inferMarketForSymbol('BTCUSDT', 'Forex')).toBe('Crypto')
    expect(inferMarketForSymbol('EURUSD', 'Forex')).toBe('Forex')
    expect(inferMarketForSymbol('EURUSD', 'Indices')).toBe('Indices')
  })

  it('prevents one broker account being armed by two profiles by default', () => {
    const existing = destination({ id: 1, portfolioId: 1, copyingEnabled: true })
    const candidate = destination({ portfolioId: 2, copyingEnabled: true })

    expect(getDestinationOwnershipConflict([existing], candidate)).toBe(existing)
    expect(
      getDestinationOwnershipConflict([existing], destination({ portfolioId: 1, copyingEnabled: true }))
    ).toBeUndefined()
    expect(
      getDestinationOwnershipConflict([existing], destination({ portfolioId: 2, copyingEnabled: false }))
    ).toBeUndefined()
  })
})
