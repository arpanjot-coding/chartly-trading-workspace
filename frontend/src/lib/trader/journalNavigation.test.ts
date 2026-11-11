import { describe, expect, it } from 'vitest'
import { withoutChartRequest } from '@/lib/trading/chartLink'
import {
  chartProfileNavigation,
  journalHref,
  journalReturnHref,
  readJournalView,
  writeJournalView,
} from './journalNavigation'

describe('journal view and return destinations', () => {
  it('round-trips a filtered trade view without accepting unrelated parameters', () => {
    const params = new URLSearchParams(
      'tab=Trades&period=1m&strategy=A%26B&q=EURUSD&result=Win&direction=Buy&sort=pnlDesc&trade=11&unknown=x'
    )
    const view = readJournalView(params)
    expect(readJournalView(writeJournalView(view))).toEqual(view)
    expect(journalHref(7, params)).not.toContain('unknown')
    expect(view).toMatchObject({ tab: 'Trades', strategy: 'A&B', trade: 11 })
  })

  it('handles invalid tabs, dates, IDs and hidden mindset with safe defaults', () => {
    const view = readJournalView(
      new URLSearchParams('tab=Mind&period=bad&day=2026-02-30&month=2026-13&trade=-1'),
      false
    )
    expect(view).toMatchObject({ tab: 'Overview', period: 'all', day: '', month: '', trade: null })
    expect(journalHref(7)).toBe('/workspace/profiles/7/journal')
  })

  it.each([
    'https://example.com/workspace/profiles/7/journal',
    '//example.com/workspace/profiles/7/journal',
    '/workspace/profiles/8/journal?tab=Trades',
    '/workspace/profiles/7/settings',
    '/workspace/profiles/7/journal/../settings',
    '/workspace/profiles/7/journal?tab=Trades#outside',
    'javascript:alert(1)',
  ])('refuses a return destination outside the same journal: %s', (target) => {
    expect(journalReturnHref(7, target)).toBeNull()
  })

  it('keeps the journal return when the chart consumes its instrument request', () => {
    const params = new URLSearchParams({
      profileId: '7',
      profileName: 'London',
      runId: '12',
      symbol: 'EURUSD',
      exchange: 'FX',
      journalReturn: '/workspace/profiles/7/journal?tab=Calendar&month=2026-10',
    })
    const next = withoutChartRequest(params)
    expect(chartProfileNavigation(next)).toMatchObject({
      backHref: '/workspace/profiles/7/journal?tab=Calendar&month=2026-10',
      returningToJournal: true,
    })
    expect(next.get('runId')).toBe('12')
  })
  it('returns through the chart with book, timezone, native currency and review/week scope intact', () => {
    const raw = new URLSearchParams(
      'tab=Trades&book=opaque_book&timezone=America%2FNew_York&currency=USDT&review=unreviewed&week=2026-10-19&q=BTC&trade=11'
    )
    const view = readJournalView(raw)
    expect(view).toMatchObject({
      book: 'opaque_book',
      timezone: 'America/New_York',
      currency: 'USDT',
      review: 'unreviewed',
      week: '2026-10-19',
    })
    const target = journalHref(7, raw)
    const nav = chartProfileNavigation(
      new URLSearchParams({ profileId: '7', journalReturn: target })
    )
    expect(nav.backHref).toBe(target)
    expect(readJournalView(new URLSearchParams(target.split('?')[1]))).toEqual(view)
    const invalid = readJournalView(
      new URLSearchParams('timezone=Invalid%2FZone&currency=AB&review=invalid&week=2026-02-30')
    )
    expect(invalid).toMatchObject({ review: 'All', week: '' })
    expect(invalid.timezone).toBeUndefined()
    expect(invalid.currency).toBeUndefined()
  })

  it('falls back to portfolio/workspace and never uses another profile’s journal', () => {
    expect(
      chartProfileNavigation(
        new URLSearchParams({ profileId: '7', journalReturn: '/workspace/profiles/8/journal' })
      )
    ).toMatchObject({
      backHref: '/workspace/profiles/7',
      journalHref: '/workspace/profiles/7/journal',
    })
    expect(
      chartProfileNavigation(new URLSearchParams('profileId=bad&profileName=Other'))
    ).toMatchObject({ backHref: '/workspace', backLabel: 'Workspace', journalHref: null })
  })
})
