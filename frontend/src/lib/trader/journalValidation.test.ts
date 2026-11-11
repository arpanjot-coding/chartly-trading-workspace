import { describe, expect, it } from 'vitest'
import { validateManualJournalAmounts } from './journalValidation'
describe('manual journal accounting identity', () => {
  it('checks exact net profit with signed swap without floating-point rounding', () => {
    expect(() =>
      validateManualJournalAmounts({
        netPnl: '0.30000000000000000001',
        grossPnl: '0.4',
        commission: '0.1',
        fees: '0',
        swap: '0.00000000000000000001',
      })
    ).not.toThrow()
    expect(() =>
      validateManualJournalAmounts({
        netPnl: '0.3',
        grossPnl: '0.4',
        commission: '0.1',
        fees: '0',
        swap: '0.00000000000000000001',
      })
    ).toThrow('Net P&L must equal')
  })
  it('leaves unknown costs and net-only reported values unknown', () => {
    expect(() =>
      validateManualJournalAmounts({
        netPnl: '5',
        grossPnl: null,
        commission: null,
        fees: '0',
        swap: null,
      })
    ).not.toThrow()
    expect(() =>
      validateManualJournalAmounts({ netPnl: null, grossPnl: null, quantity: null })
    ).not.toThrow()
  })
  it('rejects negative declared expenses and nonpositive known position sizes', () => {
    expect(() => validateManualJournalAmounts({ commission: '-1' })).toThrow('cannot be negative')
    expect(() => validateManualJournalAmounts({ quantity: '0' })).toThrow('must be positive')
    expect(() => validateManualJournalAmounts({ swap: '-1' })).not.toThrow()
  })
})
