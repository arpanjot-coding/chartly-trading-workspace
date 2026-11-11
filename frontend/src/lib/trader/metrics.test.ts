import { describe, expect, it } from 'vitest'
import type { DailyMood, JournalTrade, TraderPortfolio } from './db'
import {
  buildDailySummaries,
  buildEquityCurve,
  calculateRMultiple,
  groupTradeStats,
  summarizeCombinedProfiles,
  summarizeEmotions,
  summarizePortfolio,
} from './metrics'

const portfolio: TraderPortfolio = {
  id: 1,
  name: 'Main',
  kind: 'replay',
  currency: 'USD',
  startingBalance: 10_000,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function trade(overrides: Partial<JournalTrade>): JournalTrade {
  return {
    portfolioId: 1,
    openDate: '2026-01-02T09:00:00.000Z',
    closeDate: '2026-01-02T10:00:00.000Z',
    timeframe: '15m',
    pair: 'BTCUSD',
    strategy: 'Breakout',
    direction: 'Buy',
    lots: 1,
    result: 'Win',
    rr: 2,
    sl: 10,
    tp: 20,
    pnl: 100,
    netPnl: 100,
    riskAmount: 100,
    emotion: { fomo: 2, patience: 4, discipline: 5, confidence: 4 },
    emotionalNotes: '',
    technicalNotes: '',
    otherNotes: '',
    duration: 60,
    ...overrides,
  }
}

describe('trader workspace metrics', () => {
  it('summarizes balance, win rate and average R for one portfolio only', () => {
    const summary = summarizePortfolio(portfolio, [
      trade({ netPnl: 250, result: 'Win' }),
      trade({ netPnl: -100, result: 'Loss' }),
      trade({ portfolioId: 2, netPnl: 9_000, result: 'Win' }),
    ])

    expect(summary.balance).toBe(10_150)
    expect(summary.netPnl).toBe(150)
    expect(summary.returnPct).toBeCloseTo(1.5)
    expect(summary.openTrades).toBe(0)
    expect(summary.winRate).toBe(50)
    expect(summary.averageR).toBe(0.75)
    expect(summary.bestTrade).toBe(250)
    expect(summary.worstTrade).toBe(-100)
    expect(summary.maxDrawdownCurrency).toBe(100)
    expect(summary.maxDrawdownPct).toBeCloseTo(0.9756, 3)
    expect(summary.profitFactor).toBe(2.5)
    expect(summary.expectancy).toBe(75)
  })

  it('does not invent a live broker balance or percentage return', () => {
    const live: TraderPortfolio = {
      ...portfolio,
      id: 3,
      name: 'London Live',
      kind: 'live',
      startingBalance: 0,
      legacyStartingBalance: 10_000,
    }

    const summary = summarizePortfolio(live, [
      trade({ portfolioId: 3, netPnl: -100, result: 'Loss' }),
    ])

    expect(summary.balance).toBeNull()
    expect(summary.returnPct).toBeNull()
    expect(summary.maxDrawdownCurrency).toBe(100)
    expect(summary.maxDrawdownPct).toBeNull()
    expect(summary.profitFactor).toBe(0)
    expect(summary.expectancy).toBe(-100)
  })

  it('combines live profiles by currency and excludes replay trades', () => {
    const london: TraderPortfolio = { ...portfolio, id: 10, kind: 'live', currency: 'USD' }
    const newYork: TraderPortfolio = { ...portfolio, id: 11, kind: 'live', currency: 'EUR' }
    const replay: TraderPortfolio = { ...portfolio, id: 12, kind: 'replay', currency: 'USD' }

    const combined = summarizeCombinedProfiles(
      [london, newYork, replay],
      [
        trade({ portfolioId: 10, netPnl: 200, result: 'Win' }),
        trade({ portfolioId: 10, netPnl: -50, result: 'Loss' }),
        trade({ portfolioId: 11, netPnl: 80, result: 'Win' }),
        trade({ portfolioId: 12, netPnl: 5_000, result: 'Win' }),
      ]
    )

    expect(combined.USD).toMatchObject({
      netPnl: 150,
      trades: 2,
      wins: 1,
      losses: 1,
      profileCount: 1,
    })
    expect(combined.USD.winRate).toBe(50)
    expect(combined.EUR).toMatchObject({
      netPnl: 80,
      trades: 1,
      wins: 1,
      losses: 0,
      profileCount: 1,
    })
  })

  it('reports detailed combined live performance and chronological drawdown', () => {
    const london: TraderPortfolio = { ...portfolio, id: 20, kind: 'live', currency: 'USD' }
    const newYork: TraderPortfolio = { ...portfolio, id: 21, kind: 'live', currency: 'USD' }
    const combined = summarizeCombinedProfiles(
      [london, newYork],
      [
        trade({
          portfolioId: 20,
          netPnl: 200,
          result: 'Win',
          closeDate: '2026-01-02T10:00:00.000Z',
          commission: 4,
          pips: 20,
        }),
        trade({
          portfolioId: 21,
          netPnl: -100,
          result: 'Loss',
          direction: 'Sell',
          closeDate: '2026-01-03T10:00:00.000Z',
          commission: 3,
          pips: -10,
        }),
        trade({
          portfolioId: 20,
          netPnl: -50,
          result: 'Loss',
          closeDate: '2026-01-04T10:00:00.000Z',
        }),
        trade({
          portfolioId: 21,
          netPnl: 80,
          result: 'Win',
          direction: 'Sell',
          closeDate: '2026-01-05T10:00:00.000Z',
          pips: 8,
        }),
      ]
    )

    expect(combined.USD).toMatchObject({
      profileCount: 2,
      netPnl: 130,
      trades: 4,
      wins: 2,
      losses: 2,
      grossProfit: 280,
      grossLoss: 150,
      expectancy: 32.5,
      maxDrawdownCurrency: 150,
      totalR: 1.3,
      totalLots: 4,
      totalCosts: null,
      knownCostsTotal: 7,
      unknownCostCount: 4,
      totalPips: 18,
      longNetPnl: 150,
      shortNetPnl: -20,
    })
    expect(combined.USD.profitFactor).toBeCloseTo(1.8667, 4)
    expect(combined.USD.averageR).toBeCloseTo(0.325)
    expect(combined.USD.averagePips).toBe(6)
  })

  it('does not fabricate emotion averages for trades without a mindset check-in', () => {
    const summary = summarizeEmotions(1, [trade({ emotion: undefined })], [])
    expect(summary).toMatchObject({
      fomo: null,
      patience: null,
      discipline: null,
      confidence: null,
      moodEntries: 0,
    })
  })

  it('summarizes trade emotions beside daily mood entries', () => {
    const moods: DailyMood[] = [
      {
        portfolioId: 1,
        date: '2026-01-02',
        moodScore: 4,
        energyLevel: 70,
        stressLevel: 80,
        sleepHours: 7,
        dietScore: 'Clean',
        caffeineIntake: '1-2 cups',
        exercised: true,
      },
    ]

    const summary = summarizeEmotions(1, [trade({})], moods)
    expect(summary.fomo).toBe(2)
    expect(summary.discipline).toBe(5)
    expect(summary.averageMood).toBe(4)
    expect(summary.highStressDays).toBe(1)
  })

  it('reports detailed streak, direction, R, duration and daily risk stats', () => {
    const trades = [
      trade({
        netPnl: 200,
        result: 'Win',
        direction: 'Buy',
        openDate: '2026-01-02T09:30:00.000Z',
        closeDate: '2026-01-02T10:00:00.000Z',
        duration: 30,
      }),
      trade({
        netPnl: 100,
        result: 'Win',
        direction: 'Sell',
        openDate: '2026-01-03T08:30:00.000Z',
        closeDate: '2026-01-03T10:00:00.000Z',
        duration: 90,
      }),
      trade({
        netPnl: -50,
        result: 'Loss',
        direction: 'Buy',
        openDate: '2026-01-04T09:00:00.000Z',
        closeDate: '2026-01-04T10:00:00.000Z',
        duration: 60,
      }),
      trade({
        netPnl: -25,
        result: 'Loss',
        direction: 'Sell',
        openDate: '2026-01-05T08:00:00.000Z',
        closeDate: '2026-01-05T10:00:00.000Z',
        duration: 120,
      }),
    ]
    const summary = summarizePortfolio(portfolio, trades)

    expect(summary.totalR).toBe(2.25)
    expect(summary.maxWinStreak).toBe(2)
    expect(summary.maxLossStreak).toBe(2)
    expect(summary.currentStreak).toBe(-2)
    expect(summary.longTrades).toBe(2)
    expect(summary.shortTrades).toBe(2)
    expect(summary.longNetPnl).toBe(150)
    expect(summary.shortNetPnl).toBe(75)
    expect(summary.averageDurationMinutes).toBe(75)
    expect(summary.totalLots).toBe(4)
    expect(summary.bestWinStreakAmount).toBe(300)
    expect(summary.worstLossStreakAmount).toBe(-75)
    expect(summary.pnlStdDev).toBeCloseTo(116.14, 2)
    expect(summary.performanceScore).toBeNull()
    expect(summary.performanceRadar).toEqual([])
    expect(summary.sharpe).toBeNull()
    expect(summary.sortino).toBeNull()
    expect(summary.ratiosUnavailableReason).toContain('complete')
  })

  it('builds equity, daily and grouped journal analytics', () => {
    const trades = [
      trade({ pair: 'XAUUSD', netPnl: 200, result: 'Win', closeDate: '2026-01-02T10:00:00.000Z' }),
      trade({ pair: 'XAUUSD', netPnl: -50, result: 'Loss', closeDate: '2026-01-02T12:00:00.000Z' }),
      trade({ pair: 'EURUSD', netPnl: 75, result: 'Win', closeDate: '2026-01-03T10:00:00.000Z' }),
    ]
    const moods: DailyMood[] = [
      {
        portfolioId: 1,
        date: '2026-01-02',
        state: 'Focused',
        moodScore: 4,
        energyLevel: 80,
        stressLevel: 20,
        sleepHours: 8,
        dietScore: 'Clean',
        caffeineIntake: 'None',
        exercised: true,
      },
    ]

    const curve = buildEquityCurve(portfolio, trades)
    expect(curve[0].date).toBe('2026-01-01T00:00:00.000Z')
    expect(
      buildEquityCurve({ ...portfolio, createdAt: '2026-02-01T00:00:00.000Z' }, trades)[0].date
    ).toBe('2026-01-02T09:00:00.000Z')
    expect(curve.map((point) => point.cumulativePnl)).toEqual([0, 200, 150, 225])
    expect(curve.map((point) => point.dealPnl)).toEqual([0, 200, -50, 75])
    expect(curve.at(-1)?.equity).toBe(10_225)
    expect(Math.max(...curve.map((point) => point.drawdown))).toBe(50)

    const daily = buildDailySummaries(trades, moods)
    expect(daily).toHaveLength(2)
    expect(daily[0]).toMatchObject({
      date: '2026-01-02',
      pnl: 150,
      trades: 2,
      wins: 1,
      losses: 1,
      moodState: 'Focused',
    })
    expect(daily[1]).toMatchObject({ date: '2026-01-03', pnl: 75, trades: 1, wins: 1 })

    const symbols = groupTradeStats(trades, (item) => item.pair)
    expect(symbols[0]).toMatchObject({
      name: 'XAUUSD',
      pnl: 150,
      trades: 2,
      profitFactor: 4,
      expectancy: 75,
    })
    expect(symbols[1]).toMatchObject({ name: 'EURUSD', pnl: 75, trades: 1, profitFactor: null })
  })

  it('tracks execution costs and pips without changing net P&L', () => {
    const summary = summarizePortfolio(portfolio, [
      trade({
        netPnl: 239,
        grossPnl: 250,
        commission: 12,
        swap: -3,
        fees: 2,
        pips: 25,
      }),
      trade({
        openDate: '2026-01-03T09:00:00.000Z',
        closeDate: '2026-01-03T10:00:00.000Z',
        netPnl: -50,
      }),
    ])
    expect(summary.netPnl).toBe(189)
    expect(summary.grossPnlTotal).toBeNull()
    expect(summary.totalCommission).toBeNull()
    expect(summary.totalSwap).toBeNull()
    expect(summary.totalFees).toBeNull()
    expect(summary.totalCosts).toBeNull()
    expect(summary.knownGrossPnlTotal).toBe(250)
    expect(summary.knownCommissionTotal).toBe(12)
    expect(summary.knownSwapTotal).toBe(-3)
    expect(summary.knownFeesTotal).toBe(2)
    expect(summary.knownCostsTotal).toBe(11)
    expect(summary.totalPips).toBe(25)
    expect(summary.averagePips).toBe(25)
  })

  it('does not invent a performance score without closed trades', () => {
    const summary = summarizePortfolio(portfolio, [])
    expect(summary.performanceScore).toBeNull()
    expect(summary.performanceRadar.every((point) => point.score === 0)).toBe(true)
    expect(summary.totalLots).toBe(0)
  })

  it('does not invent an R multiple without positive risk', () => {
    expect(calculateRMultiple(100, 0)).toBeUndefined()
    expect(calculateRMultiple(100, 50)).toBe(2)
  })
})
