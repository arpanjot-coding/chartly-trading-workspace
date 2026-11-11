import { negateExactDecimal, normalizeExactDecimal, sumExactDecimals } from './journalAnalytics'

/** Manual capture uses signed swap and positive commission/fee expenses. Unknown stays unknown. */
export function validateManualJournalAmounts(value: object | undefined) {
  if (!value) return
  const amounts = value as Record<string, unknown>
  for (const [field, value] of Object.entries(amounts)) {
    if (value === null || value === undefined) continue
    const normalized = normalizeExactDecimal(value)
    if (normalized === null)
      throw new Error(`${field} must be a plain decimal, or blank when unknown.`)
    if (
      ['commission', 'fees', 'riskAmount', 'entryPrice', 'exitPrice'].includes(field) &&
      normalized.startsWith('-')
    )
      throw new Error(
        `${field} cannot be negative; swap credits and charges use a signed cashflow.`
      )
    if (field === 'quantity' && (normalized === '0' || normalized.startsWith('-')))
      throw new Error('Known quantity must be positive; leave unknown quantity blank.')
  }
  const keys = ['netPnl', 'grossPnl', 'commission', 'swap', 'fees']
  if (keys.some((key) => amounts[key] === null || amounts[key] === undefined)) return
  const expected = sumExactDecimals([
    String(amounts.grossPnl),
    negateExactDecimal(String(amounts.commission))!,
    negateExactDecimal(String(amounts.fees))!,
    String(amounts.swap),
  ])
  if (expected !== normalizeExactDecimal(amounts.netPnl))
    throw new Error(
      'Net P&L must equal gross − commission − fees + signed swap when all components are known. Correct the values or leave unknown components blank.'
    )
}
