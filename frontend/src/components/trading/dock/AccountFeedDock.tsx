/**
 * The platform-account dock for a live-feed chart: the MT5 Toolbox
 * equivalent. Read-only snapshots from the terminal on this PC —
 * balance/equity/margin in the strip (visible even collapsed), open
 * positions, pending orders, historical orders and deals in the tabs.
 *
 * Reads are sequenced, with both history books loaded only while the tab is open.
 * Amounts are the venue's decimal text, grouped for display only.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  type FeedAccountSnapshot,
  MarketDataError,
  type Mt5ProfileScope,
  marketData,
} from '@/api/marketData'
import { cn } from '@/lib/utils'
import { DockShell } from './DockShell'
import type { DockTab } from './dockState'

const TABS = [
  { id: 'positions', label: 'Positions' },
  { id: 'orders', label: 'Orders' },
  { id: 'trades', label: 'History' },
] as const

const REFRESH_MS = 4000

const ORDER_TYPES: Record<number, string> = {
  0: 'Buy',
  1: 'Sell',
  2: 'Buy limit',
  3: 'Sell limit',
  4: 'Buy stop',
  5: 'Sell stop',
  6: 'Buy stop limit',
  7: 'Sell stop limit',
  8: 'Close by',
}

const DEAL_TYPES: Record<number, string> = {
  0: 'Buy',
  1: 'Sell',
  2: 'Balance',
  3: 'Credit',
  4: 'Charge',
  5: 'Correction',
  6: 'Bonus',
  7: 'Commission',
  8: 'Daily commission',
  9: 'Monthly commission',
  10: 'Daily agent commission',
  11: 'Monthly agent commission',
  12: 'Interest',
  13: 'Cancelled buy',
  14: 'Cancelled sell',
  15: 'Dividend',
  16: 'Franked dividend',
  17: 'Tax',
}

const DEAL_ENTRIES: Record<number, string> = { 0: 'In', 1: 'Out', 2: 'In/Out', 3: 'Out by' }
const ORDER_STATES: Record<number, string> = {
  0: 'Started',
  1: 'Placed',
  2: 'Cancelled',
  3: 'Partially filled',
  4: 'Filled',
  5: 'Rejected',
  6: 'Expired',
}

function linkedId(value: string | null | undefined): string {
  return value && value !== '0' ? value : '—'
}

function money(text: string | null | undefined): string {
  if (text === null || text === undefined || text === '') return '—'
  const value = Number(text)
  if (!Number.isFinite(value)) return text
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function signedMoney(text: string | null | undefined): string {
  if (text === null || text === undefined || text === '') return '—'
  const value = Number(text)
  if (!Number.isFinite(value)) return text
  const body = money(String(Math.abs(value)))
  return value > 0 ? `+${body}` : value < 0 ? `-${body}` : body
}

function tone(text: string | null | undefined): string {
  const value = Number(text)
  if (!Number.isFinite(value) || value === 0) return ''
  return value > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
}

/** Raw broker-server epoch formatted as the broker's wall clock. */
function brokerTime(rawMs: number): string {
  const time = new Date(rawMs)
  if (!Number.isSafeInteger(rawMs) || rawMs <= 0 || !Number.isFinite(time.getTime())) return '—'
  return time.toISOString().replace('T', ' ').slice(5, 19)
}

const CELL = 'px-2 py-1 text-right tabular-nums whitespace-nowrap'
const CELL_L = 'px-2 py-1 whitespace-nowrap'
const HEAD = 'px-2 py-1 text-left font-medium text-muted-foreground whitespace-nowrap'
const HEAD_R = 'px-2 py-1 text-right font-medium text-muted-foreground whitespace-nowrap'

interface Props {
  tab: DockTab | null
  onTabChange(tab: DockTab | null): void
  storage?: Storage
  providerId: string
  providerName: string
  principalId: string
  profileScope: Mt5ProfileScope | null
  /** Chart a row's symbol in the focused pane. */
  onPick(symbol: string): void
  activeSymbol?: string | null
  /** A new value refreshes the account after a terminal command completes. */
  refreshKey?: number
}

export function AccountFeedDock({
  tab,
  onTabChange,
  storage,
  providerId,
  providerName,
  principalId,
  profileScope,
  onPick,
  activeSymbol,
  refreshKey,
}: Props) {
  const originId = profileScope?.originId
  const profileId = profileScope?.profileId
  const scope = JSON.stringify([providerId, principalId, originId, profileId])
  const [historyBook, setHistoryBook] = useState<'deals' | 'orders'>('deals')
  const [result, setResult] = useState<{
    scope: string
    snapshot: FeedAccountSnapshot | null
    error: string
    accountLinkError?: boolean
  } | null>(null)
  const request = useRef({ includeHistory: tab === 'trades', refreshKey })
  const requestRefresh = useRef<(() => void) | null>(null)
  const refresh = useCallback(() => requestRefresh.current?.(), [])

  useEffect(() => {
    const previous = request.current
    const includeHistory = tab === 'trades'
    request.current = { includeHistory, refreshKey }
    if ((includeHistory && !previous.includeHistory) || refreshKey !== previous.refreshKey)
      refresh()
  }, [tab, refreshKey, refresh])

  useEffect(() => {
    if (!originId || !profileId) return
    const profile = { originId, profileId }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    let queued = false

    async function readAccount() {
      clearTimeout(timer)
      if (document.hidden || controller.signal.aborted) return
      if (inFlight) {
        queued = true
        return
      }
      inFlight = true
      queued = false
      try {
        const { account } = await marketData.account(
          providerId,
          principalId,
          profile,
          controller.signal,
          7,
          request.current.includeHistory
        )
        if (!controller.signal.aborted) setResult({ scope, snapshot: account, error: '' })
      } catch (cause) {
        if (controller.signal.aborted) return
        const marketError = cause instanceof MarketDataError ? cause : null
        const accountLinkError =
          marketError?.code === 'market.account_changed' ||
          marketError?.code.startsWith('mt5.profile_binding_')
        const discard =
          marketError?.status === 401 || marketError?.status === 403 || accountLinkError
        setResult((previous) => ({
          scope,
          snapshot: !discard && previous?.scope === scope ? previous.snapshot : null,
          error: marketError?.message ?? 'The terminal account could not be read. Try refreshing.',
          accountLinkError,
        }))
      } finally {
        inFlight = false
        if (!controller.signal.aborted && !document.hidden) {
          // Changes during a read coalesce into one follow-up request.
          timer = setTimeout(() => void readAccount(), queued ? 0 : REFRESH_MS)
        }
      }
    }

    const onVisibility = () => {
      clearTimeout(timer)
      if (!document.hidden) void readAccount()
    }
    requestRefresh.current = () => void readAccount()
    document.addEventListener('visibilitychange', onVisibility)
    void readAccount()
    return () => {
      clearTimeout(timer)
      controller.abort()
      requestRefresh.current = null
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [providerId, principalId, originId, profileId, scope])

  const current = result?.scope === scope ? result : null
  const snapshot = current?.snapshot
  const error = profileScope
    ? current?.error
    : 'Open a saved live profile and verify its MT5 account in Connections.'
  const account = snapshot?.account
  const showingHistoricalOrders = historyBook === 'orders' && !!snapshot?.historicalOrders
  const book =
    tab === 'trades'
      ? showingHistoricalOrders
        ? 'historicalOrders'
        : 'history'
      : tab === 'positions' || tab === 'orders'
        ? tab
        : null
  const bookError = book && snapshot?.bookErrors?.[book]
  const coverage =
    tab === 'trades'
      ? snapshot?.historyCoverage?.[showingHistoricalOrders ? 'orders' : 'deals']
      : undefined
  const environment =
    snapshot?.identity.environment === 'broker_demo'
      ? 'Demo'
      : snapshot?.identity.environment === 'broker_live'
        ? 'Live'
        : snapshot?.identity.environment

  const strip =
    error && !snapshot ? (
      <span className="truncate text-xs text-amber-600 dark:text-amber-400">
        {providerName} account unavailable — {error}
      </span>
    ) : account && snapshot ? (
      <span className="truncate text-xs tabular-nums text-muted-foreground">
        <span className="font-medium text-foreground">{providerName}</span>
        {' · '}
        {snapshot.identity.externalId} {snapshot.identity.server}
        {environment ? ` (${environment})` : ''} · Balance {money(account.balance)} · Equity{' '}
        {money(account.equity)} · Free margin {money(account.marginFree)} {account.currency} ·
        Floating <span className={tone(account.profit)}>{signedMoney(account.profit)}</span>
        {error && <span className="text-amber-600 dark:text-amber-400"> · Stale</span>}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">Reading {providerName} account…</span>
    )

  const header = (
    <span className="flex items-center gap-2 truncate text-xs text-muted-foreground">
      <span className="truncate">{strip}</span>
      {profileScope && (
        <button
          type="button"
          className="shrink-0 rounded border px-2 py-0.5 hover:bg-accent"
          onClick={refresh}
        >
          Refresh
        </button>
      )}
      {current?.accountLinkError && profileId && (
        <Link className="shrink-0 underline" to={`/workspace/profiles/${profileId}/connections`}>
          Connections
        </Link>
      )}
    </span>
  )

  return (
    <DockShell
      tab={tab}
      onTabChange={onTabChange}
      counts={{
        positions: snapshot?.bookErrors?.positions ? undefined : snapshot?.positions.length,
        orders: snapshot?.bookErrors?.orders ? undefined : snapshot?.orders.length,
        trades:
          snapshot?.historyLoaded === false ||
          snapshot?.bookErrors?.history ||
          snapshot?.bookErrors?.historicalOrders
            ? undefined
            : snapshot
              ? snapshot.history.length + (snapshot.historicalOrders?.length ?? 0)
              : undefined,
      }}
      tabs={TABS}
      strip={strip}
      header={header}
      storage={storage}
    >
      {error && !snapshot ? (
        <p role="alert" className="p-3 text-sm text-amber-600 dark:text-amber-400">
          {error}
        </p>
      ) : !current ? (
        <p className="p-3 text-sm text-muted-foreground">Reading the account…</p>
      ) : snapshot ? (
        <>
          {error && (
            <p role="alert" className="border-b p-2 text-xs text-amber-600 dark:text-amber-400">
              Last refresh failed ({error}) — figures below are from{' '}
              {new Date(snapshot.observedAt).toLocaleTimeString()}.
            </p>
          )}
          {tab === 'trades' && snapshot.historicalOrders && (
            <fieldset className="flex gap-1 border-b p-1">
              <legend className="sr-only">MT5 history books</legend>
              {(['deals', 'orders'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={historyBook === value}
                  className={cn(
                    'rounded px-2 py-1 text-xs hover:bg-accent',
                    historyBook === value && 'bg-accent'
                  )}
                  onClick={() => setHistoryBook(value)}
                >
                  {value === 'deals' ? 'Deals' : 'Historical orders'}
                </button>
              ))}
            </fieldset>
          )}
          {tab === 'trades' && coverage && (
            <p
              className="border-b px-2 py-1 text-[11px] text-muted-foreground"
              title={`Native query ${coverage.queryFrom} to ${coverage.queryTo}`}
            >
              Requested {snapshot.historyDays}-day lookback. Times use the broker clock. UTC
              coverage is unverified.
              {coverage.status === 'limited' &&
                ` Showing ${coverage.returnedCount} of ${coverage.observedCount} terminal rows.`}
            </p>
          )}
          {bookError && (
            <p role="alert" className="p-3 text-sm text-amber-600 dark:text-amber-400">
              {tab === 'positions'
                ? 'Open positions'
                : tab === 'orders'
                  ? 'Pending orders'
                  : showingHistoricalOrders
                    ? 'Historical orders'
                    : 'Deal history'}{' '}
              could not be read from {providerName}.{' '}
              {bookError === 'connector.history_window_too_dense'
                ? 'The lookback exceeds the snapshot limit. Use a smaller history window in Connections.'
                : 'Refresh to retry.'}
            </p>
          )}
          {tab === 'positions' &&
            !bookError &&
            (snapshot.positions.length ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className={HEAD}>Ticket</th>
                    <th className={HEAD}>Symbol</th>
                    <th className={HEAD}>Side</th>
                    <th className={HEAD_R}>Lots</th>
                    <th className={HEAD_R}>Open</th>
                    <th className={HEAD_R}>Current</th>
                    <th className={HEAD_R}>S/L</th>
                    <th className={HEAD_R}>T/P</th>
                    <th className={HEAD_R}>Profit {account?.currency}</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.positions.map((row) => (
                    <tr key={row.ticket} className="border-b last:border-0">
                      <td className={CELL_L}>{row.ticket}</td>
                      <td className={CELL_L}>
                        <button
                          type="button"
                          className={cn(
                            'font-medium hover:underline',
                            (activeSymbol === row.symbol.native ||
                              activeSymbol?.endsWith(`:${row.symbol.native}`)) &&
                              'text-primary'
                          )}
                          onClick={() => onPick(row.symbol.native)}
                        >
                          {row.symbol.native}
                        </button>
                      </td>
                      <td className={CELL_L}>{row.side === 'buy' ? 'Buy' : 'Sell'}</td>
                      <td className={CELL}>{row.volumeLots}</td>
                      <td className={CELL}>{row.priceOpen}</td>
                      <td className={CELL}>{row.priceCurrent}</td>
                      <td className={CELL}>{row.stopLoss ?? '—'}</td>
                      <td className={CELL}>{row.takeProfit ?? '—'}</td>
                      <td className={cn(CELL, tone(row.profit))}>{signedMoney(row.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                No open positions on this account. Trades you open in {providerName} appear here
                within a few seconds.
              </p>
            ))}
          {tab === 'orders' &&
            !bookError &&
            (snapshot.orders.length ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className={HEAD}>Ticket</th>
                    <th className={HEAD}>Symbol</th>
                    <th className={HEAD}>Type</th>
                    <th className={HEAD_R}>Lots</th>
                    <th className={HEAD_R}>Price</th>
                    <th className={HEAD_R}>S/L</th>
                    <th className={HEAD_R}>T/P</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.orders.map((row) => (
                    <tr key={row.ticket} className="border-b last:border-0">
                      <td className={CELL_L}>{row.ticket}</td>
                      <td className={CELL_L}>
                        <button
                          type="button"
                          className="font-medium hover:underline"
                          onClick={() => onPick(row.symbol.native)}
                        >
                          {row.symbol.native}
                        </button>
                      </td>
                      <td className={CELL_L}>{ORDER_TYPES[row.type] ?? `Type ${row.type}`}</td>
                      <td className={CELL}>
                        {row.volumeCurrentLots}/{row.volumeInitialLots}
                      </td>
                      <td className={CELL}>{row.priceOpen}</td>
                      <td className={CELL}>{row.stopLoss ?? '—'}</td>
                      <td className={CELL}>{row.takeProfit ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                No pending orders on this account.
              </p>
            ))}
          {tab === 'trades' &&
            !bookError &&
            !showingHistoricalOrders &&
            (snapshot.historyLoaded === false ? (
              <p className="p-3 text-sm text-muted-foreground">Reading deal history…</p>
            ) : snapshot.history.length ? (
              <>
                {!coverage && (
                  <p className="border-b px-2 py-1 text-[11px] text-muted-foreground">
                    Times use the {providerName} broker clock. UTC coverage is unverified.
                  </p>
                )}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className={HEAD}>Time</th>
                      <th className={HEAD}>Ticket</th>
                      <th className={HEAD}>Order</th>
                      <th className={HEAD}>Position</th>
                      <th className={HEAD}>Symbol</th>
                      <th className={HEAD}>Type</th>
                      <th className={HEAD}>Entry</th>
                      <th className={HEAD_R}>Lots</th>
                      <th className={HEAD_R}>Price</th>
                      <th className={HEAD_R}>Profit {account?.currency}</th>
                      <th className={HEAD_R}>Commission</th>
                      <th className={HEAD_R}>Swap</th>
                      <th className={HEAD_R}>Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.history.map((row) => (
                      <tr key={row.ticket} className="border-b last:border-0">
                        <td className={CELL_L}>{brokerTime(row.rawProviderTimeMsc)}</td>
                        <td className={CELL_L}>{row.ticket}</td>
                        <td className={CELL_L}>{linkedId(row.order)}</td>
                        <td className={CELL_L}>{linkedId(row.position_id)}</td>
                        <td className={CELL_L}>
                          {row.symbol ? (
                            <button
                              type="button"
                              className="font-medium hover:underline"
                              onClick={() => onPick(row.symbol)}
                            >
                              {row.symbol}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className={CELL_L}>{DEAL_TYPES[row.type] ?? `Type ${row.type}`}</td>
                        <td className={CELL_L}>
                          {row.entry != null ? (DEAL_ENTRIES[row.entry] ?? '—') : '—'}
                        </td>
                        <td className={CELL}>{row.volume ?? '—'}</td>
                        <td className={CELL}>{row.price ?? '—'}</td>
                        <td className={cn(CELL, tone(row.profit))}>{signedMoney(row.profit)}</td>
                        <td className={cn(CELL, tone(row.commission))}>
                          {signedMoney(row.commission)}
                        </td>
                        <td className={cn(CELL, tone(row.swap))}>{signedMoney(row.swap)}</td>
                        <td className={cn(CELL, tone(row.fee))}>{signedMoney(row.fee)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                The terminal returned no deals for this history query.
              </p>
            ))}
          {tab === 'trades' &&
            showingHistoricalOrders &&
            !bookError &&
            (!coverage ? (
              <p className="p-3 text-sm text-muted-foreground">Reading order history…</p>
            ) : snapshot.historicalOrders?.length ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className={HEAD}>Placed</th>
                    <th className={HEAD}>Completed</th>
                    <th className={HEAD}>Ticket</th>
                    <th className={HEAD}>Position</th>
                    <th className={HEAD}>Symbol</th>
                    <th className={HEAD}>Type</th>
                    <th className={HEAD}>State</th>
                    <th className={HEAD_R}>Remaining / initial lots</th>
                    <th className={HEAD_R}>Order price</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.historicalOrders.map((row) => (
                    <tr key={row.ticket} className="border-b last:border-0">
                      <td className={CELL_L}>{brokerTime(row.rawProviderSetupTimeMsc)}</td>
                      <td className={CELL_L}>{brokerTime(row.rawProviderDoneTimeMsc ?? 0)}</td>
                      <td className={CELL_L}>{row.ticket}</td>
                      <td className={CELL_L}>{linkedId(row.position_id)}</td>
                      <td className={CELL_L}>
                        <button
                          type="button"
                          className="font-medium hover:underline"
                          onClick={() => onPick(row.symbol)}
                        >
                          {row.symbol}
                        </button>
                      </td>
                      <td className={CELL_L}>{ORDER_TYPES[row.type] ?? `Type ${row.type}`}</td>
                      <td className={CELL_L}>{ORDER_STATES[row.state] ?? `State ${row.state}`}</td>
                      <td className={CELL}>
                        {row.volumeCurrentLots}/{row.volumeInitialLots}
                      </td>
                      <td className={CELL}>{row.priceOpen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-3 text-sm text-muted-foreground">
                The terminal returned no historical orders for this query.
              </p>
            ))}
        </>
      ) : null}
    </DockShell>
  )
}
