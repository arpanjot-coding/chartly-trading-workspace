import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { JournalTrade, TraderPortfolio } from './db'
import {
  compareJournalTimestamps,
  hasCompleteRealizationScope,
  journalTimestamp,
  journalTradeDay,
  journalTradeHour,
  normalizeExactDecimal,
  realizedJournalRows,
  realizedNetMoney,
  scopeJournalTrades,
  sumExactDecimals,
  summarizeDecisionScope,
  tradeCurrency,
  tradeMoney,
  weekStart,
} from './journalAnalytics'
import {
  buildDailySummaries,
  buildEquityCurve,
  calculateAnnualizedRatios,
  formatMoney,
  formatQuantityTotals,
  groupTradeStats,
  summarizeCombinedProfiles,
  summarizePortfolio,
} from './metrics'

const profile: TraderPortfolio = {
  id: 1,
  name: 'Fixture',
  kind: 'live',
  currency: 'USD',
  startingBalance: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}
function row(patch: Partial<JournalTrade> = {}): JournalTrade {
  return {
    id: 1,
    portfolioId: 1,
    openDate: '2026-11-01T10:00:00Z',
    closeDate: '2026-11-01T11:00:00Z',
    pair: 'EXAMPLE',
    strategy: 'Fixture',
    direction: 'Buy',
    lots: 1,
    result: 'Win',
    pnl: 10,
    netPnl: 10,
    rr: 0,
    sl: 0,
    tp: 0,
    timeframe: '1h',
    emotionalNotes: '',
    technicalNotes: '',
    otherNotes: '',
    duration: 60,
    ...patch,
  }
}

describe('exact source amounts and explicit statistics', () => {
  it('reconciles the importer worked partial-position fixture without counting its remaining quantity as realized', () => {
    const fixture = JSON.parse(
      readFileSync(resolve('../test/fixtures/p03/preview-example.json'), 'utf8')
    ) as {
      tradeProjections: Array<{
        openedAt: string
        closedAt: string | null
        remainingQuantity: string
        currency: string
        quantityUnit: string
        amounts: JournalTrade['amounts']
        realizations: JournalTrade['realizations']
      }>
      totals: { byCurrency: { USD: { netPnl: string; commission: string } } }
    }
    const projection = fixture.tradeProjections[0]
    const trade = row({
      ...projection,
      result: 'Open',
      openDate: projection.openedAt,
      closeDate: projection.closedAt ?? undefined,
    })
    const scoped = scopeJournalTrades([trade], {
      timezone: 'UTC',
      day: '2026-11-02',
      now: '2026-11-02T12:00:00Z',
    }).trades
    const summary = summarizePortfolio(profile, scoped)
    expect(summary.netPnlExact).toBe(fixture.totals.byCurrency.USD.netPnl)
    expect(summary.totalCommission).toBe(Number(fixture.totals.byCurrency.USD.commission))
    expect(summary.realizedExits).toBe(1)
    expect(summary.completedPositions).toBe(0)
    expect(summary.openPositions).toBe(1)
    expect(summary.quantityTotals).toEqual({ units: '4' })
    expect(buildDailySummaries(scoped, [], 'UTC')[0].pnl).toBe(38.2)
    expect(buildEquityCurve(profile, scoped).at(-1)?.cumulativePnl).toBe(38.2)
    expect(trade.amounts?.quantity).toBe('10')
    expect(trade.remainingQuantity).toBe('6')
  })
  it('keeps a true zero elapsed duration but rejects a zero legacy placeholder without known chronology', () => {
    expect(
      summarizePortfolio(profile, [row({ closeDate: '2026-11-01T10:00:00Z', duration: 0 })])
        .averageDurationMinutes
    ).toBe(0)
    expect(
      summarizePortfolio(profile, [
        row({ openDate: '2026-11-01', closeDate: '2026-11-02', duration: 0 }),
      ]).averageDurationMinutes
    ).toBeNull()
    expect(
      summarizePortfolio(profile, [
        row({ openDate: '2026-11-01', closeDate: '2026-11-02', duration: 75 }),
      ]).averageDurationMinutes
    ).toBe(75)
  })
  it('reports independently known costs even when a closed outcome has unknown net P&L', () => {
    const summary = summarizePortfolio(profile, [
      row({ amounts: { netPnl: null, grossPnl: '20', commission: '2', swap: '0', fees: '0' } }),
    ])
    expect(summary.knownPnlCount).toBe(0)
    expect(summary.excludedUnknownPnlCount).toBe(1)
    expect(summary.realizedExits).toBe(0)
    expect(summary.knownCostCount).toBe(1)
    expect(summary.unknownCostCount).toBe(0)
    expect(summary.grossPnlTotal).toBe(20)
    expect(summary.totalCosts).toBe(2)
    const unknown = summarizePortfolio(profile, [
      row({ amounts: { netPnl: null, commission: null, swap: null, fees: null } }),
    ])
    expect(unknown.totalCosts).toBeNull()
    expect(unknown.unknownCostCount).toBe(1)
  })
  it('does not reinterpret a replay starting baseline in another currency or claim equity from incomplete dated money', () => {
    const replay = { ...profile, kind: 'replay' as const, startingBalance: 1000 }
    const euro = row({ currency: 'EUR', amounts: { netPnl: '10' } })
    const summary = summarizePortfolio(replay, [euro], { currency: 'EUR' })
    expect(summary.netPnlExact).toBe('10')
    expect(summary.balance).toBeNull()
    expect(summary.returnPct).toBeNull()
    const euroCurve = buildEquityCurve(replay, [euro], { currency: 'EUR' })
    expect(euroCurve.at(-1)?.cumulativePnl).toBe(10)
    expect(euroCurve.every((point) => point.equity === null && point.drawdownPct === null)).toBe(
      true
    )
    for (const uncertain of [
      row({ amounts: { netPnl: null } }),
      row({ openDate: '2026-11-01', closeDate: '2026-11-02', amounts: { netPnl: '20' } }),
    ]) {
      const curve = buildEquityCurve(replay, [row({ id: 2, amounts: { netPnl: '10' } }), uncertain])
      expect(curve.every((point) => point.equity === null && point.drawdownPct === null)).toBe(true)
      expect(curve.at(-1)?.cumulativePnl).toBe(10)
    }
  })
  it('adds canonical decimals without binary drift and never falls back from explicit unknowns', () => {
    expect(sumExactDecimals(['0.1', '0.2', '-0.05'])).toBe('0.25')
    expect(normalizeExactDecimal('-0.0000')).toBe('0')
    for (const invalid of ['NaN', '1e3', '1,000', ' 1', '01', '0x10'])
      expect(normalizeExactDecimal(invalid)).toBeNull()
    expect(tradeMoney(row({ netPnl: 999, amounts: { netPnl: null } }), 'netPnl')).toEqual({
      exact: null,
      value: null,
      provenance: 'unknown',
    })
    expect(tradeMoney(row({ netPnl: 0.1 }), 'netPnl')).toEqual({
      exact: '0.1',
      value: 0.1,
      provenance: 'legacy-number',
    })
  })
  it('uses known net signs once and includes break-even in the win denominator', () => {
    const result = summarizePortfolio(profile, [
      row({ result: 'Loss', amounts: { netPnl: '10' } }),
      row({ id: 2, result: 'Win', amounts: { netPnl: '-5' } }),
      row({ id: 3, result: 'Win', amounts: { netPnl: '0' } }),
      row({ id: 4, amounts: { netPnl: null } }),
    ])
    expect(result).toMatchObject({
      netPnl: 5,
      netPnlExact: '5',
      wins: 1,
      losses: 1,
      breakEven: 1,
      decisiveWinRate: 50,
      realizedExits: 3,
      completedPositions: 4,
      excludedUnknownPnlCount: 1,
    })
    expect(result.winRate).toBeCloseTo(100 / 3)
    expect(result.expectancy).toBeCloseTo(5 / 3)
  })
  it('separates unknown costs from zero and applies canonical signed-swap cashflow convention', () => {
    const complete = row({
      amounts: {
        netPnl: '86',
        grossPnl: '100',
        commission: '10',
        fees: '2',
        swap: '-2',
        riskAmount: '0',
      },
    })
    const summary = summarizePortfolio(profile, [complete])
    expect(summary).toMatchObject({
      netPnl: 86,
      totalCosts: 14,
      totalSwap: -2,
      knownCostCount: 1,
      unknownCostCount: 0,
      averageR: null,
      riskSampleSize: 0,
    })
    const missing = summarizePortfolio(profile, [
      complete,
      row({ id: 2, amounts: { netPnl: '0', commission: null, swap: '0', fees: '0' } }),
    ])
    expect(missing.totalCosts).toBeNull()
    expect(missing.unknownCostCount).toBe(1)
    expect(missing.knownCostsTotal).toBe(14)
    expect(
      summarizePortfolio(profile, [
        row({ amounts: { netPnl: '0', grossPnl: '0', commission: '0', fees: '0', swap: '0' } }),
      ]).totalCosts
    ).toBe(0)
  })
  it('keeps invalid/unknown/zero risk out of the R sample and does not synthesize scores or ratios', () => {
    const summary = summarizePortfolio({ ...profile, kind: 'replay', startingBalance: 10_000 }, [
      row({ riskAmount: 0, rMultiple: 4 }),
      row({ id: 2, riskAmount: 100, amounts: { netPnl: '20', riskAmount: null } }),
      row({ id: 3, amounts: { netPnl: '10', riskAmount: '5' } }),
    ])
    expect(summary.averageR).toBe(2)
    expect(summary.riskSampleSize).toBe(1)
    expect(summary.performanceScore).toBeNull()
    expect(summary.performanceRadar).toEqual([])
    expect(summary.sharpe).toBeNull()
    expect(summary.sortino).toBeNull()
    expect(summary.ratiosUnavailableReason).toContain('complete')
  })
  it('does not count deposits/withdrawals as trades or profit and keeps standalone fees as expenses', () => {
    const trades = [
      row({ amounts: { netPnl: '10' } }),
      row({ id: 2, eventType: 'deposit', amounts: { netPnl: '1000' } }),
      row({ id: 3, eventType: 'withdrawal', amounts: { netPnl: '-250' } }),
      row({ id: 4, eventType: 'fee', amounts: { netPnl: '-2' } }),
    ]
    const summary = summarizePortfolio(profile, trades)
    expect(summary).toMatchObject({
      trades: 1,
      closedTrades: 1,
      realizedExits: 1,
      netPnl: 8,
      cashflowCount: 2,
      feeAdjustmentCount: 1,
      wins: 1,
      losses: 0,
    })
    expect(buildEquityCurve(profile, trades).at(-1)?.cumulativePnl).toBe(8)
    const replay = summarizePortfolio({ ...profile, kind: 'replay', startingBalance: 100 }, trades)
    expect(replay.balance).toBe(858)
    expect(replay.returnPct).toBeNull()
    expect(replay.maxDrawdownPct).toBeNull()
  })
  it('reports independent currency/asset buckets with no FX conversion', () => {
    const rows = [
      row({ currency: 'USD', amounts: { netPnl: '10' } }),
      row({ id: 2, currency: 'EUR', amounts: { netPnl: '100' } }),
      row({ id: 3, currency: 'USDT', amounts: { netPnl: '0.000001' } }),
    ]
    expect(summarizePortfolio(profile, rows)).toMatchObject({
      netPnl: 10,
      excludedCurrencyCount: 2,
    })
    const combined = summarizeCombinedProfiles([profile], rows)
    expect(Object.keys(combined).sort()).toEqual(['EUR', 'USD', 'USDT'])
    expect(combined.USD.netPnlExact).toBe('10')
    expect(combined.EUR.netPnlExact).toBe('100')
    expect(combined.USDT.netPnlExact).toBe('0.000001')
    expect(groupTradeStats(rows, (item) => item.pair)).toHaveLength(3)
    expect(tradeCurrency(rows[2])).toBe('USDT')
    expect(formatMoney(0.000001, 'USDT')).toContain('0.000001')
    expect(formatMoney(null, 'USD')).toBe('—')
  })
  it('counts account outcomes separately and groups only explicit decision links', () => {
    const original = row({ accountId: 1, copyGroupId: 'explicit-copy' })
    const copied = row({ id: 2, accountId: 2, copyGroupId: 'explicit-copy' })
    expect(summarizeDecisionScope([original, copied])).toEqual({
      accountOutcomes: 2,
      linkedDecisionCount: 1,
      unlinkedAccountOutcomes: 0,
      uniqueDecisionCount: 1,
    })
    expect(
      summarizeDecisionScope([row({ accountId: 1 }), row({ id: 2, accountId: 2 })])
    ).toMatchObject({ accountOutcomes: 2, unlinkedAccountOutcomes: 2, uniqueDecisionCount: null })
    const combined = summarizeCombinedProfiles([profile], [original, copied])
    expect(combined.USD.netPnl).toBe(20)
    expect(combined.USD.decisionScope.linkedDecisionCount).toBe(1)
  })
  it('reports size per declared unit without adding shares, lots and contracts together', () => {
    const result = summarizePortfolio(profile, [
      row({ quantityUnit: 'units', amounts: { netPnl: '10', quantity: '0.123456789012345678' } }),
      row({ id: 2, quantityUnit: 'contracts', amounts: { netPnl: '20', quantity: '3' } }),
    ])
    expect(result.quantityTotals).toEqual({ units: '0.123456789012345678', contracts: '3' })
    expect(formatQuantityTotals(result.quantityTotals)).toBe(
      '0.123456789012345678 units · 3 contracts'
    )
    expect(
      groupTradeStats(
        [row({ quantityUnit: 'units', amounts: { netPnl: '10', quantity: '2' } })],
        (item) => item.pair
      )[0].quantityTotals
    ).toEqual({ units: '2' })
  })
})

describe('one reporting scope across midnight and partial exits', () => {
  it('uses today rather than the newest stored trade for rolling calendar periods', () => {
    const scope = scopeJournalTrades(
      [
        row({ id: 1, closeDate: '2026-01-02T10:00:00Z' }),
        row({ id: 2, closeDate: '2026-10-27T00:00:00Z' }),
        row({ id: 3, closeDate: '2026-10-26T23:59:59Z' }),
        row({ id: 4, closeDate: '2026-11-02T13:00:00Z' }),
      ],
      { period: '1w', timezone: 'UTC', now: '2026-11-02T12:00:00Z' }
    )
    expect(scope.fromDate).toBe('2026-10-27')
    expect(scope.toDate).toBe('2026-11-02')
    expect(scope.trades.map((item) => item.id)).toEqual([2])
    expect(scope.excluded.future).toBe(1)
  })
  it('respects midnight and both DST transitions without inventing local offsets', () => {
    expect(journalTradeDay(row({ closeDate: '2026-07-01T23:30:00Z' }), 'Europe/London')).toBe(
      '2026-07-02'
    )
    expect(journalTradeDay(row({ closeDate: '2026-07-01T23:30:00Z' }), 'UTC')).toBe('2026-07-01')
    expect(journalTradeHour(row({ closeDate: '2026-03-08T06:59:00Z' }), 'America/New_York')).toBe(
      '01:00 America/New_York'
    )
    expect(journalTradeHour(row({ closeDate: '2026-03-08T07:01:00Z' }), 'America/New_York')).toBe(
      '03:00 America/New_York'
    )
    expect(journalTradeHour(row({ closeDate: '2026-11-01T05:30:00Z' }), 'America/New_York')).toBe(
      '01:00 America/New_York'
    )
    expect(journalTradeHour(row({ closeDate: '2026-11-01T06:30:00Z' }), 'America/New_York')).toBe(
      '01:00 America/New_York'
    )
    expect(weekStart('2026-11-01')).toBe('2026-10-26')
    expect(() => scopeJournalTrades([], { timezone: 'Invented/Zone' })).toThrow('timezone')
  })
  it('keeps source-local uncertainty visible and excludes it from date-specific panels', () => {
    const unknown = row({ closeDate: '2026-11-01' })
    expect(journalTimestamp(unknown.closeDate)).toBeNull()
    expect(
      scopeJournalTrades([unknown], {
        timezone: 'Europe/London',
        period: 'all',
        now: '2026-11-02T12:00:00Z',
      }).trades
    ).toHaveLength(1)
    expect(
      scopeJournalTrades([unknown], {
        timezone: 'Europe/London',
        period: '1w',
        now: '2026-11-02T12:00:00Z',
      }).trades
    ).toHaveLength(0)
    expect(buildDailySummaries([unknown], [], 'Europe/London')).toEqual([])
    expect(buildEquityCurve(profile, [unknown])).toHaveLength(1)
    expect(journalTimestamp('2026-02-30T00:00:00Z')).toBeNull()
  })
  it('realizes open partial positions by exit date and never repeats their total or fee as an exit', () => {
    const partial = row({
      result: 'Open',
      closeDate: '',
      amounts: { netPnl: '55', quantity: '10', riskAmount: '100' },
      remainingQuantity: '4',
      realizations: [
        { id: 'old', closedAt: '2026-10-25T12:00:00Z', quantity: '2', netPnl: '20' },
        { id: 'current', closedAt: '2026-11-01T12:00:00Z', quantity: '4', netPnl: '40' },
        { id: 'fee', closedAt: '2026-11-02T10:00:00Z', quantity: '0', netPnl: '-5', kind: 'fee' },
      ],
    })
    const scope = scopeJournalTrades([partial], {
      timezone: 'UTC',
      period: '1w',
      now: '2026-11-02T12:00:00Z',
    })
    expect(partial.realizations).toHaveLength(3)
    expect(scope.trades[0].realizations).toHaveLength(2)
    expect(hasCompleteRealizationScope(scope.trades[0])).toBe(false)
    expect(summarizePortfolio(profile, scope.trades)).toMatchObject({
      netPnl: 35,
      realizedExits: 1,
      openPositions: 1,
      completedPositions: 0,
      closedTrades: 0,
      feeAdjustmentCount: 1,
    })
    expect(realizedJournalRows(scope.trades)).toHaveLength(2)
    expect(
      buildDailySummaries(scope.trades, [], 'UTC').map((day) => [day.date, day.pnl, day.trades])
    ).toEqual([
      ['2026-11-01', 40, 1],
      ['2026-11-02', -5, 0],
    ])
    expect(buildEquityCurve(profile, scope.trades).map((point) => point.cumulativePnl)).toEqual([
      0, 40, 35,
    ])
  })
  it('preserves period fences while combining closed positions with earlier partials', () => {
    const closed = row({
      closeDate: '2026-11-01T12:00:00Z',
      amounts: { netPnl: '60', riskAmount: '100' },
      realizations: [
        { id: 'a', closedAt: '2026-10-25T12:00:00Z', quantity: '2', netPnl: '20' },
        { id: 'b', closedAt: '2026-11-01T12:00:00Z', quantity: '2', netPnl: '40' },
      ],
    })
    const scoped = scopeJournalTrades([closed], {
      timezone: 'UTC',
      period: '1w',
      now: '2026-11-02T12:00:00Z',
    })
    expect(summarizeCombinedProfiles([profile], scoped.trades).USD).toMatchObject({
      netPnl: 40,
      completedPositions: 1,
      realizedExits: 1,
      riskSampleSize: 0,
    })
    expect(
      scopeJournalTrades([closed], {
        timezone: 'UTC',
        day: '2026-10-25',
        now: '2026-11-02T12:00:00Z',
      }).trades[0].realizations?.map((item) => item.id)
    ).toEqual(['a'])
    const twiceScoped = scopeJournalTrades(scoped.trades, {
      timezone: 'UTC',
      period: 'all',
      now: '2026-11-02T12:00:00Z',
    })
    expect(hasCompleteRealizationScope(twiceScoped.trades[0])).toBe(false)
  })
  it('keeps full-position R consistent with grouped realized cash including linked fees', () => {
    const closed = row({
      amounts: { netPnl: '58', riskAmount: '100' },
      closeDate: '2026-11-01T12:00:00Z',
      realizations: [
        { id: 'first', closedAt: '2026-10-25T12:00:00Z', quantity: '2', netPnl: '20' },
        { id: 'last', closedAt: '2026-11-01T12:00:00Z', quantity: '2', netPnl: '40' },
        { id: 'fee', closedAt: '2026-11-01T12:00:00Z', quantity: '0', netPnl: '-2', kind: 'fee' },
      ],
    })
    expect(realizedNetMoney(closed).exact).toBe('58')
    expect(summarizePortfolio(profile, [closed]).averageR).toBeCloseTo(0.58)
    expect(groupTradeStats([closed], (item) => item.strategy)[0].averageR).toBeCloseTo(0.58)
    expect(groupTradeStats([closed], (item) => journalTradeDay(item, 'UTC')!)).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: '2026-11-01', averageR: null })])
    )
  })
  it('uses every displayed filter and retains microsecond ordering for drawdown', () => {
    const rows = [
      row({
        id: 1,
        journalBookId: 'book1',
        amounts: { netPnl: '-5' },
        closeDate: '2026-11-01T11:00:00.000002Z',
      }),
      row({
        id: 2,
        journalBookId: 'book1',
        amounts: { netPnl: '10' },
        closeDate: '2026-11-01T11:00:00.000001Z',
      }),
      row({ id: 3, journalBookId: 'other', amounts: { netPnl: '999' } }),
      row({ id: 4, journalBookId: 'book1', archivedAt: '2026-11-02T00:00:00Z' }),
    ]
    const scoped = scopeJournalTrades(rows, {
      profileIds: [1],
      bookIds: ['book1'],
      strategy: 'Fixture',
      timezone: 'UTC',
      q: 'EXAMPLE',
      direction: 'Buy',
      now: '2026-11-02T12:00:00Z',
    })
    expect(scoped.trades).toHaveLength(2)
    expect(scoped.excluded.archived).toBe(1)
    expect(compareJournalTimestamps(rows[0].closeDate, rows[1].closeDate)).toBe(1)
    expect(buildEquityCurve(profile, scoped.trades).map((point) => point.cumulativePnl)).toEqual([
      0, 10, 5,
    ])
    expect(summarizePortfolio(profile, scoped.trades).maxDrawdownCurrency).toBe(5)
  })
})

describe('annualized ratios require a complete declared calendar', () => {
  it('rejects sparse/duplicate/unadjusted samples and computes only declared complete excess returns', () => {
    const complete = {
      frequency: 'daily' as const,
      expectedDates: ['2026-01-01', '2026-01-02', '2026-01-03'],
      observations: [
        { date: '2026-01-01', excessReturn: '0.01' },
        { date: '2026-01-02', excessReturn: '-0.01' },
        { date: '2026-01-03', excessReturn: '0.02' },
      ],
      cashflowAdjusted: true as const,
      beginningEquityKnown: true as const,
      annualizationFactor: 365,
    }
    const result = calculateAnnualizedRatios(complete)
    const expectedMean = (0.01 - 0.01 + 0.02) / 3
    const expectedDeviation = Math.sqrt(
      ((0.01 - expectedMean) ** 2 + (-0.01 - expectedMean) ** 2 + (0.02 - expectedMean) ** 2) / 2
    )
    expect(result.sharpe).toBeCloseTo((expectedMean / expectedDeviation) * Math.sqrt(365))
    expect(result.sortino).toBeCloseTo((expectedMean / Math.sqrt(0.0001 / 3)) * Math.sqrt(365))
    expect(
      calculateAnnualizedRatios({ ...complete, observations: complete.observations.slice(1) })
        .sharpe
    ).toBeNull()
    expect(
      calculateAnnualizedRatios({
        ...complete,
        observations: [
          complete.observations[0],
          complete.observations[0],
          complete.observations[2],
        ],
      }).sharpe
    ).toBeNull()
    expect(
      calculateAnnualizedRatios({
        ...complete,
        cashflowAdjusted: false,
      } as unknown as typeof complete).sharpe
    ).toBeNull()
  })
})
