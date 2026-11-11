import { describe, expect, it } from 'vitest'
import type { JournalTrade } from '@/lib/trader/db'
import { filteredJournalCsv } from './journalCsv'

const trade = {
  id: 1,
  portfolioId: 7,
  pair: 'EXAMPLE',
  direction: 'Buy',
  strategy: 'Manual',
  openDate: '2026-11-02T09:00:00Z',
  closeDate: '2026-11-02T10:00:00Z',
  result: 'Win',
  netPnl: 0.3,
  pnl: 0.3,
  lots: 1,
  technicalNotes: '',
  otherNotes: '',
  emotionalNotes: '',
  amounts: {
    netPnl: '0.30000000000000000001',
    quantity: '1',
    entryPrice: '0.000000000000012345',
    commission: null,
    swap: '-0.0000000000001',
    fees: '0',
  },
  currency: 'USDT',
  quantityUnit: 'units',
} as JournalTrade
describe('selected-scope journal CSV', () => {
  it('exports exact canonical decimal strings and unknown values without rounding or fabricating zero', () => {
    const csv = filteredJournalCsv([trade], 7, 'USDT', 'Asia/Tokyo')
    expect(csv).toContain('0.30000000000000000001')
    expect(csv).toContain('0.000000000000012345')
    expect(csv).toContain('USDT,units')
    expect(csv).toContain('Asia/Tokyo')
    expect(csv).toContain('commissionInScope')
  })
  it('sums only the selected exit events exactly and retains the realization data', () => {
    const csv = filteredJournalCsv(
      [
        {
          ...trade,
          result: 'Open',
          realizations: [
            { id: 'exit', closedAt: '2026-11-02T10:00:00Z', quantity: '0.1', netPnl: '0.1' },
            {
              id: 'fee',
              kind: 'fee',
              closedAt: '2026-11-02T10:01:00Z',
              quantity: '0',
              netPnl: '-0.02',
            },
          ],
        },
      ],
      7,
      'USDT',
      'UTC'
    )
    expect(csv).toContain(',0.08,1,')
    expect(csv).toContain('""kind"":""fee""')
  })
  it('neutralizes spreadsheet formulas in authored fields while keeping a numeric loss numeric', () => {
    const csv = filteredJournalCsv(
      [
        {
          ...trade,
          strategy: '=HYPERLINK("https://example.test")',
          technicalNotes: '\t+SUM(1,2)',
          amounts: { netPnl: '-2.5' },
        },
      ],
      7,
      'USDT',
      'UTC'
    )
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain("'\t+SUM")
    expect(csv).toContain(',-2.5,')
  })
})
