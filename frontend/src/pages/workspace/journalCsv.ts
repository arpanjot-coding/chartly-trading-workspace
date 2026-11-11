import type { JournalTrade } from '@/lib/trader/db'
import { sumExactDecimals, tradeMoney } from '@/lib/trader/journalAnalytics'

function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? '' : String(value)
  // Spreadsheet executables remain literal; signed plain decimals stay numeric.
  if (/^\s*[=+@-]/.test(text) && !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
export function filteredJournalCsv(
  trades: JournalTrade[],
  profileId: number,
  currency: string,
  timezone: string
): string {
  const headers = [
    'profileId',
    'bookId',
    'tradeId',
    'eventType',
    'currency',
    'quantityUnit',
    'openDate',
    'closeDate',
    'positionStatus',
    'direction',
    'symbol',
    'strategy',
    'netPnlInScope',
    'positionQuantity',
    'remainingQuantity',
    'realizedQuantityInScope',
    'positionEntryPrice',
    'exitPrice',
    'grossPnlInScope',
    'commissionInScope',
    'swapCashflowInScope',
    'feesInScope',
    'riskAmount',
    'realizationsJson',
    'technicalNotes',
    'otherNotes',
    'emotionalNotes',
    'reviewStatus',
    'reviewedAt',
    'sourceEventKeysJson',
    'decisionId',
    'copyGroupId',
    'reportingTimezone',
  ]
  const money = (trade: JournalTrade, key: Parameters<typeof tradeMoney>[1]) => {
    if (
      trade.realizations?.length &&
      ['netPnl', 'grossPnl', 'commission', 'swap', 'fees'].includes(key)
    ) {
      const values = trade.realizations.map(
        (event) => (event as unknown as Record<string, unknown>)[key]
      )
      return values.every((value) => typeof value === 'string')
        ? (sumExactDecimals(values as string[]) ?? '')
        : ''
    }
    return tradeMoney(trade, key).exact ?? ''
  }
  const rows = trades.map((trade) => [
    profileId,
    trade.journalBookId,
    trade.id,
    trade.eventType ?? 'trade',
    trade.currency ?? currency,
    trade.quantityUnit ?? 'lots (legacy)',
    trade.openDate,
    trade.closeDate,
    trade.result === 'Open' ? 'Open' : 'Closed',
    trade.direction,
    trade.pair,
    trade.strategy,
    money(trade, 'netPnl'),
    money(trade, 'quantity'),
    trade.remainingQuantity,
    trade.realizations?.length
      ? sumExactDecimals(
          trade.realizations.filter((event) => event.kind !== 'fee').map((event) => event.quantity)
        )
      : '',
    money(trade, 'entryPrice'),
    money(trade, 'exitPrice'),
    money(trade, 'grossPnl'),
    money(trade, 'commission'),
    money(trade, 'swap'),
    money(trade, 'fees'),
    money(trade, 'riskAmount'),
    JSON.stringify(trade.realizations ?? []),
    trade.technicalNotes,
    trade.otherNotes,
    trade.emotionalNotes,
    trade.reviewStatus ?? 'unreviewed',
    trade.reviewedAt,
    JSON.stringify(trade.sourceEventKeys ?? []),
    trade.decisionId,
    trade.copyGroupId,
    timezone,
  ])
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}
