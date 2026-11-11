import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import type { PaperController } from '@/hooks/usePaperSession'
import {
  type PaperConfig,
  type PaperInstrument,
  type PaperRequest,
  type PaperResponse,
  paperClient,
} from '@/lib/trader/paperClient'
import { PaperReportDetails } from './PaperReportDetails'
import { PANEL_HEADER, PanelShell } from './panelShell'

const inputClass = 'h-8 w-full rounded border bg-background px-2 text-xs'
const buttonClass = 'rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50'
function retainedFacts(request: PaperRequest): [string, string][] {
  const scalar = (value: unknown) =>
    typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 200) : '—'
  const result: [string, string][] = [
    ['Run', String(request.runId)],
    ['Account revision', String(request.expectedRevision)],
  ]
  const names: Record<string, string> = {
    side: 'Side',
    orderType: 'Order type',
    quantity: 'Quantity',
    limitPrice: 'Limit price',
    stopPrice: 'Stop trigger',
    stopLoss: 'Protective stop',
    takeProfit: 'Target',
    positionId: 'Position',
    orderId: 'Order',
    count: 'Next observed candles',
    atIndex: 'Branch candle index',
    name: 'Branch name',
  }
  for (const [key, label] of Object.entries(names))
    if (key in request.payload) result.push([label, scalar(request.payload[key])])
  if (request.action === 'prepare') {
    result.push(['Starting cash', scalar(request.payload.startingCash)])
    const instrument = request.payload.instrument as Record<string, unknown> | undefined
    for (const [key, label] of [
      ['quantityUnit', 'Quantity unit'],
      ['quantityStep', 'Quantity step'],
      ['priceTick', 'Price tick'],
      ['multiplier', 'Value multiplier'],
    ])
      if (instrument?.[key] !== undefined) result.push([label, scalar(instrument[key])])
    const costs = request.payload.costs as Record<string, unknown> | undefined
    for (const [key, label] of [
      ['spreadTicks', 'Spread ticks'],
      ['slippageTicks', 'Slippage ticks'],
      ['feeBps', 'Fee basis points'],
      ['feePerFill', 'Fee per fill'],
    ])
      if (costs?.[key] !== undefined) result.push([label, scalar(costs[key])])
  }
  return result
}
export function exportPaperJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
interface Props {
  controller: PaperController
  profileId: number
  runId: number
  originId: string
  startingCash: string
  instrument: Pick<PaperInstrument, 'symbol' | 'exchange' | 'interval' | 'currency'>
  onBranch(runId: number): void
  synchronized: boolean
  managed?: boolean
}
export function PaperSessionPanel({
  controller,
  profileId,
  runId,
  originId,
  startingCash,
  instrument,
  onBranch,
  synchronized,
  managed = false,
}: Props) {
  const { session, loading, busy, pending } = controller
  const [error, setError] = useState('')
  const [report, setReport] = useState<Record<string, unknown> | null>(null)
  const [reportBusy, setReportBusy] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [fields, setFields] = useState({
    quantityUnit: '',
    quantityStep: '',
    priceTick: '',
    multiplier: '',
    quantityScale: '0',
    priceScale: '2',
    moneyScale: '2',
    spreadTicks: '0',
    slippageTicks: '0',
    feeBps: '0',
    feePerFill: '0',
  })
  const [side, setSide] = useState('buy')
  const [orderType, setOrderType] = useState('market')
  const [quantity, setQuantity] = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [stopPrice, setStopPrice] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [takeProfit, setTakeProfit] = useState('')
  const [closeQuantity, setCloseQuantity] = useState<Record<string, string>>({})
  const [branchIndex, setBranchIndex] = useState('')
  const [branchName, setBranchName] = useState('')
  const [branchReviewed, setBranchReviewed] = useState(false)
  const [recordSearch, setRecordSearch] = useState('')
  const reportAbort = useRef<AbortController | null>(null)
  const reportGeneration = useRef(0)
  const reportScope = `${originId}:${runId}:${session?.revision ?? 'none'}`
  const reportScopeRef = useRef(reportScope)
  reportScopeRef.current = reportScope
  const revisionRef = useRef(session?.revision)
  revisionRef.current = session?.revision
  useEffect(() => () => reportAbort.current?.abort(), [])
  useEffect(() => {
    if (reportScopeRef.current !== reportScope) return
    reportGeneration.current++
    reportAbort.current?.abort()
    setReport(null)
    setReportBusy(false)
  }, [reportScope])
  const disabled = loading || busy || !!pending || (!!session && !synchronized)
  const tradeAllowed = !!session && ['in_progress', 'paused'].includes(session.status)
  const hasNext = !!session && session.cursorIndex < (session.totalBars ?? 0) - 1
  const act = async (
    action: Parameters<PaperController['mutate']>[0],
    payload: Record<string, unknown> = {}
  ) => {
    setError('')
    reportGeneration.current++
    reportAbort.current?.abort()
    setReportBusy(false)
    setReport(null)
    try {
      return await controller.mutate(action, payload)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Paper decision could not be saved.')
      return null
    }
  }
  const openBranch = (response: PaperResponse | null) => {
    const child = response?.session
    if (
      child &&
      child.profileId === profileId &&
      Number.isSafeInteger(child.runId) &&
      child.runId > 0 &&
      child.runId !== runId
    )
      onBranch(child.runId)
  }
  const prepare = async (event: FormEvent) => {
    event.preventDefault()
    if (!reviewed) return
    setError('')
    for (const [key, label, maximum] of [
      ['quantityScale', 'Quantity decimals', 18],
      ['priceScale', 'Price decimals', 18],
      ['moneyScale', 'Money decimals', 8],
      ['spreadTicks', 'Spread ticks', 10000],
      ['slippageTicks', 'Slippage ticks', 10000],
    ] as const) {
      if (!/^\d+$/.test(fields[key]) || Number(fields[key]) > maximum) {
        setError(`${label} must be a whole number from 0 to ${maximum}.`)
        return
      }
    }
    for (const [key, label, positive] of [
      ['quantityStep', 'Quantity step', true],
      ['priceTick', 'Price tick', true],
      ['multiplier', 'Value multiplier', true],
      ['feeBps', 'Fee basis points', false],
      ['feePerFill', 'Fee per fill', false],
    ] as const) {
      if (
        !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(fields[key]) ||
        !Number.isFinite(Number(fields[key])) ||
        (positive && Number(fields[key]) <= 0)
      ) {
        setError(`${label} needs a ${positive ? 'positive' : 'nonnegative'} plain decimal value.`)
        return
      }
    }
    const config: PaperConfig = {
      version: 1,
      instrument: {
        ...instrument,
        quantityUnit: fields.quantityUnit.trim(),
        quantityStep: fields.quantityStep,
        priceTick: fields.priceTick,
        multiplier: fields.multiplier,
        quantityScale: Number(fields.quantityScale),
        priceScale: Number(fields.priceScale),
      },
      startingCash,
      moneyScale: Number(fields.moneyScale),
      costs: {
        spreadTicks: Number(fields.spreadTicks),
        slippageTicks: Number(fields.slippageTicks),
        feeBps: fields.feeBps,
        feePerFill: fields.feePerFill,
      },
      policy: { id: 'native-ohlc-conservative-v1', gap: 'next-observed' },
      seed: 0,
    }
    await act('prepare', config as unknown as Record<string, unknown>)
  }
  const submitOrder = async (event: FormEvent) => {
    event.preventDefault()
    const result = await act('order', {
      side,
      orderType,
      quantity,
      ...(orderType === 'limit' ? { limitPrice } : {}),
      ...(orderType === 'stop' ? { stopPrice } : {}),
      ...(stopLoss ? { stopLoss } : {}),
      ...(takeProfit ? { takeProfit } : {}),
    })
    if (result) setQuantity('')
  }
  const openReport = async () => {
    reportAbort.current?.abort()
    const abort = new AbortController()
    reportAbort.current = abort
    const generation = ++reportGeneration.current
    const revision = revisionRef.current
    setReportBusy(true)
    setError('')
    try {
      const response = await paperClient.report(originId, runId, abort.signal)
      if (
        !abort.signal.aborted &&
        reportGeneration.current === generation &&
        revisionRef.current === revision
      ) {
        const saved = (response.report ?? response) as Record<string, unknown>
        if (saved.revision !== revision) {
          setError('The paper account changed. Reload its current state and reopen the report.')
          return
        }
        setReport(response)
      }
    } catch (cause) {
      if (!abort.signal.aborted && reportGeneration.current === generation)
        setError(cause instanceof Error ? cause.message : 'Report unavailable.')
    } finally {
      if (!abort.signal.aborted && reportGeneration.current === generation) setReportBusy(false)
    }
  }
  const matches = (value: unknown) =>
    !recordSearch || JSON.stringify(value).toLowerCase().includes(recordSearch.toLowerCase())
  const positions =
    session?.positions
      .filter((position) => Number(position.quantity) > 0 && matches(position))
      .slice(0, 100) ?? []
  const orders = session?.orders.filter(matches).slice(-100) ?? []
  const fills = session?.fills ?? session?.lastFills ?? []
  const journalHref = `/workspace/profiles/${profileId}/journal?${new URLSearchParams({ ...(typeof session?.bookId === 'string' ? { book: session.bookId } : {}), tab: 'Trades' })}`
  return (
    <PanelShell id="oa-panel-paper" label="Paper session" storageKey="chartly-paper-panel-width">
      <header className={PANEL_HEADER}>
        <h2 className="text-sm font-semibold">Paper session</h2>
        <span className="ml-auto text-xs text-muted-foreground">Historical only</span>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-xs">
        <p>
          {instrument.symbol} · {instrument.exchange} · native {instrument.interval} ·{' '}
          {instrument.currency}
        </p>
        <p>
          Paper orders use this run’s saved candles. No broker order or live account is connected.
        </p>
        {(error || controller.error) && (
          <p role="alert" className="text-destructive">
            {error || controller.error}
          </p>
        )}
        {loading && <output>Reading the saved paper account…</output>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={busy || loading}
            onClick={() => void controller.reload()}
          >
            Reload paper account
          </button>
        </div>
        {pending && (
          <section aria-label="Retained paper request" className="space-y-2 rounded border p-2">
            <p>
              The exact {pending.request.action} request is retained. An interrupted response may
              already have committed; retrying uses the same receipt.
            </p>
            <dl className="grid grid-cols-2 gap-1">
              {retainedFacts(pending.request).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className="break-all font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => {
                const action = pending.request.action
                void controller
                  .retry()
                  .then((response) => {
                    if (action === 'branch') openBranch(response)
                  })
                  .catch(() => {})
              }}
            >
              Retry retained request
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => exportPaperJson(pending.request, `paper-run-${runId}-request.json`)}
            >
              Export retained request
            </button>
            {pending.rejected && (
              <>
                <p>
                  This request was rejected. Reload and review the account before clearing the
                  rejected input.
                </p>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy || !controller.reviewed}
                  onClick={() => void controller.clearRejected()}
                >
                  Clear reviewed rejected request
                </button>
              </>
            )}
          </section>
        )}
        {!session && !loading && managed && (
          <p>
            This run already owns a saved paper account. Reload its committed state before trading;
            no replacement account is prepared from a failed read.
          </p>
        )}
        {!session && !loading && !managed && (
          <form className="space-y-3" onSubmit={(event) => void prepare(event)}>
            <h3 className="font-semibold">Prepare this run</h3>
            <p>
              Review the instrument economics. Display precision does not establish a tradable tick
              or quantity step.
            </p>
            <p>
              Starting cash: {startingCash} {instrument.currency}. Collateral is one-times entry
              notional for both long and short exposure; short-sale proceeds are unavailable.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span>Quantity unit</span>
                <select
                  required
                  className={inputClass}
                  value={fields.quantityUnit}
                  onChange={(event) =>
                    setFields((previous) => ({ ...previous, quantityUnit: event.target.value }))
                  }
                >
                  <option value="">Choose units</option>
                  <option value="share">Shares</option>
                  <option value="base_asset">Base asset units</option>
                  <option value="contract">Contracts</option>
                  <option value="lot">Lots</option>
                </select>
              </label>
              {(
                [
                  ['quantityStep', 'Quantity step', 'e.g. 1'],
                  ['priceTick', 'Price tick', 'e.g. 0.01'],
                  ['multiplier', 'Value multiplier', 'e.g. 1'],
                  ['quantityScale', 'Quantity decimals', ''],
                  ['priceScale', 'Price decimals', ''],
                  ['moneyScale', 'Money decimals', ''],
                  ['spreadTicks', 'Spread ticks', ''],
                  ['slippageTicks', 'Slippage ticks', ''],
                  ['feeBps', 'Fee basis points', ''],
                  ['feePerFill', 'Fee per fill', ''],
                ] as const
              ).map(([key, label, placeholder]) => (
                <label key={key} className="space-y-1">
                  <span>{label}</span>
                  <input
                    required
                    className={inputClass}
                    value={fields[key]}
                    placeholder={placeholder}
                    onChange={(event) =>
                      setFields((previous) => ({ ...previous, [key]: event.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <p>
              Conservative native OHLC: decisions fill on the next observed candle; protective stops
              win an ambiguous stop/target bar. Missing bars are never invented. Entry fees and
              every exit fee are charged once. No funding, swap, FX conversion or tick-level fill
              accuracy.
            </p>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              <span>
                I reviewed the economics, costs and native OHLC assumptions for this independent
                account.
              </span>
            </label>
            <Button size="sm" disabled={disabled || !reviewed}>
              Prepare paper account
            </Button>
          </form>
        )}
        {session && (
          <>
            <section aria-label="Paper account summary" className="space-y-2 border-y py-3">
              <h3 className="font-semibold">
                {session.status.replaceAll('_', ' ')} · revision {session.revision}
              </h3>
              <dl className="grid grid-cols-2 gap-2">
                {[
                  ['Settled cash', session.cash],
                  ['Equity', session.equity],
                  ['Available collateral', session.available],
                  ['Used collateral', session.collateral],
                  ['Realized gross', session.realizedGross],
                  ['Fees charged', session.fees],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium tabular-nums">
                      {value} {instrument.currency}
                    </dd>
                  </div>
                ))}
              </dl>
              <p>
                Observed {session.cursorIndex + 1} / {session.totalBars ?? '—'} candles. Clock:{' '}
                {new Date(session.asOf * 1000).toISOString()}.
              </p>
              {session.status === 'ready' && (
                <Button size="sm" disabled={disabled} onClick={() => void act('start')}>
                  Start paper session
                </Button>
              )}
            </section>
            <details className="space-y-2 rounded border p-2">
              <summary className="cursor-pointer font-semibold">
                Pinned economics and execution assumptions
              </summary>
              <p>
                Quantity: {session.config.instrument.quantityUnit}, step{' '}
                {session.config.instrument.quantityStep}; price tick{' '}
                {session.config.instrument.priceTick}; value multiplier{' '}
                {session.config.instrument.multiplier}. Starting cash {session.config.startingCash}{' '}
                {session.config.instrument.currency}.
              </p>
              <p>
                Spread {session.config.costs.spreadTicks} ticks; slippage{' '}
                {session.config.costs.slippageTicks} ticks; fee {session.config.costs.feeBps} basis
                points plus {session.config.costs.feePerFill} per fill.
              </p>
              <p>
                One-times entry-notional collateral for long and short exposure. Native OHLC fills
                use the next observed candle; protective stops win stop/target ambiguity. Gaps never
                create invented candles. No funding, swap or FX conversion. Finishing retains open
                exposure.
              </p>
            </details>
            {session.status !== 'finished' && (
              <form className="space-y-2" onSubmit={(event) => void submitOrder(event)}>
                <h3 className="font-semibold">Paper ticket</h3>
                <p>
                  Orders become eligible at the next native candle, including reduce-only closes.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    Side
                    <select
                      aria-label="Paper side"
                      className={inputClass}
                      value={side}
                      onChange={(event) => setSide(event.target.value)}
                    >
                      <option value="buy">Buy / Long</option>
                      <option value="sell">Sell / Short</option>
                    </select>
                  </label>
                  <label>
                    Type
                    <select
                      aria-label="Paper order type"
                      className={inputClass}
                      value={orderType}
                      onChange={(event) => setOrderType(event.target.value)}
                    >
                      <option value="market">Market</option>
                      <option value="limit">Limit</option>
                      <option value="stop">Stop market</option>
                    </select>
                  </label>
                </div>
                <label className="block">
                  Quantity ({session.config.instrument.quantityUnit})
                  <input
                    aria-label="Paper quantity"
                    className={inputClass}
                    required
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                  />
                </label>
                {orderType === 'limit' && (
                  <label className="block">
                    Limit price
                    <input
                      aria-label="Paper limit price"
                      className={inputClass}
                      required
                      maxLength={125}
                      value={limitPrice}
                      onChange={(event) => setLimitPrice(event.target.value)}
                    />
                  </label>
                )}
                {orderType === 'stop' && (
                  <label className="block">
                    Stop trigger
                    <input
                      aria-label="Paper stop trigger"
                      className={inputClass}
                      required
                      value={stopPrice}
                      onChange={(event) => setStopPrice(event.target.value)}
                    />
                  </label>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    Protective stop
                    <input
                      aria-label="Paper protective stop"
                      className={inputClass}
                      value={stopLoss}
                      onChange={(event) => setStopLoss(event.target.value)}
                    />
                  </label>
                  <label>
                    Target
                    <input
                      aria-label="Paper target"
                      className={inputClass}
                      value={takeProfit}
                      onChange={(event) => setTakeProfit(event.target.value)}
                    />
                  </label>
                </div>
                {!hasNext && (
                  <p>
                    No next saved candle remains. New entries and closes cannot execute at an
                    already-observed price; finishing retains any open exposure.
                  </p>
                )}
                <Button size="sm" disabled={disabled || !tradeAllowed || !hasNext}>
                  Submit paper order
                </Button>
              </form>
            )}
            <label className="block">
              Find an order or position
              <input
                className={inputClass}
                aria-label="Find paper records"
                maxLength={128}
                value={recordSearch}
                onChange={(event) => setRecordSearch(event.target.value)}
              />
              <span className="text-muted-foreground">
                Up to 100 matching orders and open positions are shown. Search by identifier for
                older records.
              </span>
            </label>
            <section aria-label="Paper orders" className="space-y-2">
              <h3 className="font-semibold">Orders</h3>
              {!orders.length && <p>No matching paper orders.</p>}
              {orders.map((order) => (
                <div key={order.id} className="rounded border p-2">
                  <p>
                    {order.id} · {order.side} {order.quantity} · {order.orderType} · {order.status}
                  </p>
                  {order.reason && <p>{order.reason}</p>}
                  {['pending', 'open', 'triggered'].includes(order.status) && (
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={disabled || !tradeAllowed}
                      onClick={() => void act('cancel', { orderId: order.id })}
                    >
                      Cancel {order.id}
                    </button>
                  )}
                </div>
              ))}
            </section>
            <section aria-label="Paper positions" className="space-y-2">
              <h3 className="font-semibold">Open positions</h3>
              {!positions.length && <p>No open paper positions.</p>}
              {positions.map((position) => (
                <form
                  key={position.id}
                  className="space-y-2 rounded border p-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void act('close', {
                      positionId: position.id,
                      quantity: closeQuantity[position.id] ?? position.quantity,
                    })
                  }}
                >
                  <p>
                    {position.side} {position.quantity} @ {position.entryPrice}
                  </p>
                  <label>
                    Close quantity
                    <input
                      aria-label={`Close quantity for ${position.id}`}
                      required
                      className={inputClass}
                      value={closeQuantity[position.id] ?? position.quantity}
                      onChange={(event) =>
                        setCloseQuantity((previous) => ({
                          ...previous,
                          [position.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    type="submit"
                    className={buttonClass}
                    disabled={
                      disabled || !tradeAllowed || !hasNext || session.status === 'finished'
                    }
                  >
                    Queue reduce-only close
                  </button>
                </form>
              ))}
            </section>
            <section aria-label="Paper fills">
              <h3 className="font-semibold">Recent fills ({fills.length})</h3>
              {fills.map((fill, index) => (
                <p key={String(fill.id ?? index)}>
                  {String(fill.kind)} · {String(fill.side)} {String(fill.quantity)} @{' '}
                  {String(fill.price)} · fee {String(fill.fee)}
                </p>
              ))}
              <p className="mt-1 text-muted-foreground">
                Recent records are bounded. Export the report for the complete ledger.
              </p>
            </section>
            <section className="space-y-2 border-t pt-3">
              <h3 className="font-semibold">Finish and review</h3>
              <p>
                Finishing cancels pending orders and retains marked open exposure. It does not
                invent a close at an already-seen price.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={disabled || session.status === 'finished'}
                  onClick={() => void act('finish')}
                >
                  Finish paper session
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={reportBusy || busy}
                  onClick={() => void openReport()}
                >
                  Review saved report
                </button>
                <Link className={buttonClass} to={journalHref}>
                  Open run journal
                </Link>
              </div>
              {report && (
                <>
                  <PaperReportDetails value={report} />
                  <p>
                    The saved report includes the pinned source, economics, costs, observed
                    coverage, checkpoint, fills and independent account results.
                  </p>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => exportPaperJson(report, `paper-run-${runId}-report.json`)}
                  >
                    Export report JSON
                  </button>
                </>
              )}
            </section>
            <form
              className="space-y-2 border-t pt-3"
              onSubmit={(event) => {
                event.preventDefault()
                void act('branch', { atIndex: Number(branchIndex), name: branchName }).then(
                  (response) => {
                    openBranch(response)
                  }
                )
              }}
            >
              <h3 className="font-semibold">Branch from an earlier candle</h3>
              <p>
                A branch creates a fresh independent account at that candle’s close. It carries no
                existing orders, positions or P&amp;L. This original run and journal stay intact.
              </p>
              <label className="block">
                Earlier observed index
                <input
                  aria-label="Branch candle index"
                  className={inputClass}
                  required
                  type="number"
                  min={0}
                  max={Math.max(0, session.cursorIndex - 1)}
                  value={branchIndex}
                  onChange={(event) => setBranchIndex(event.target.value)}
                />
              </label>
              <label className="block">
                Branch name
                <input
                  aria-label="Branch name"
                  className={inputClass}
                  maxLength={100}
                  required
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                />
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={branchReviewed}
                  onChange={(event) => setBranchReviewed(event.target.checked)}
                />
                <span>Start a fresh account here; keep the original results.</span>
              </label>
              <button
                type="submit"
                className={buttonClass}
                disabled={disabled || !branchReviewed || session.cursorIndex < 1}
              >
                Create independent branch
              </button>
            </form>
          </>
        )}
      </div>
    </PanelShell>
  )
}
