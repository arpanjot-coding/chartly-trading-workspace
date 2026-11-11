import { useId, useRef, useState } from 'react'
import { fetchCSRFToken } from '@/api/client'
import type { Mt5ProfileScope } from '@/api/marketData'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/authStore'

type Review = {
  id: string
  accountLabel: string
  symbol: string
  side: 'buy' | 'sell'
  lots: string
  price: string
}

type Receipt = {
  id: string
  state: 'placed' | 'filled' | 'partially-filled' | 'rejected' | 'canceled' | 'unknown'
  retcode?: number
  order?: string
  deal?: string
  dealTickets?: string[]
  filledLots?: string
  reason?: string
}

const statusText: Record<Receipt['state'], string> = {
  placed: 'MT5 accepted the order.',
  filled: 'MT5 reported a fill.',
  'partially-filled': 'MT5 reported a partial fill.',
  rejected: 'MT5 rejected the order.',
  canceled: 'MT5 history shows the order was canceled without a fill.',
  unknown: 'The order outcome is unknown. Check the MT5 terminal before submitting another order.',
}

class OrderRequestError extends Error {
  readonly status: number
  readonly pendingId?: string

  constructor(message: string, status: number, pendingId?: string) {
    super(message)
    this.status = status
    this.pendingId = pendingId
  }
}

async function request<T>(
  path: 'preview' | 'submit' | `receipts/${string}`,
  principal: string,
  data: unknown,
  chartIsCurrent?: () => boolean,
  beforeSend?: () => void
): Promise<T> {
  const csrf = await fetchCSRFToken()
  if (!csrf || useAuthStore.getState().localPrincipalId !== principal)
    throw new OrderRequestError('Reload the intended Chartly workspace and review the order.', 403)
  if (chartIsCurrent && !chartIsCurrent())
    throw new OrderRequestError('The active chart changed. Review the intended symbol again.', 409)
  beforeSend?.()
  const response = await fetch(`/api/local/v1/mt5-orders/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrf,
      'X-Chartly-Principal': principal,
    },
    body: JSON.stringify(data),
  })
  const body = await response.json()
  if (!response.ok) {
    const code = body?.error?.issues?.[0]?.retcode
    const id = body?.error?.issues?.[0]?.requestId
    const message = body?.error?.message ?? 'MT5 could not complete the request.'
    throw new OrderRequestError(
      typeof code === 'number' ? `${message} MT5 code ${code}.` : message,
      response.status,
      typeof id === 'string' && /^[a-f0-9]{32}$/.test(id) ? id : undefined
    )
  }
  return body as T
}

function pendingReceipt(key: string): string | null {
  try {
    const id = localStorage.getItem(key)
    return id && /^[a-f0-9]{32}$/.test(id) ? id : null
  } catch {
    return null
  }
}

interface Props {
  principal: string
  profileScope: Mt5ProfileScope | null
  disabled: boolean
  readSymbol(): string | null
  onOutcome(): void
}

export function Mt5OrderTicket({
  principal,
  profileScope,
  disabled,
  readSymbol,
  onOutcome,
}: Props) {
  const inputId = useId()
  const receiptKey = `chartly:mt5:pending-receipt:${principal}`
  const currentChart = useRef({ disabled, readSymbol, principal, profileScope })
  currentChart.current = { disabled, readSymbol, principal, profileScope }
  const [open, setOpen] = useState(false)
  const [symbol, setSymbol] = useState('')
  const [orderScope, setOrderScope] = useState<Mt5ProfileScope | null>(null)
  const [side, setSide] = useState<Review['side']>('buy')
  const [lots, setLots] = useState('')
  const [busy, setBusy] = useState(false)
  const [reviewed, setReviewed] = useState<{
    review: Review
    token: string
    sendAvailable: boolean
  } | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [message, setMessage] = useState('')
  const [pendingId, setPendingId] = useState(() => pendingReceipt(receiptKey))
  const [orderTicket, setOrderTicket] = useState('')
  const [receiptMissing, setReceiptMissing] = useState(false)
  const chartIsCurrent = () =>
    orderScope !== null &&
    !currentChart.current.disabled &&
    currentChart.current.principal === principal &&
    currentChart.current.profileScope?.originId === orderScope.originId &&
    currentChart.current.profileScope.profileId === orderScope.profileId &&
    currentChart.current.readSymbol() === symbol

  function newOrder() {
    const instrument = readSymbol()
    if (!instrument || !profileScope) return
    setOrderScope(profileScope)
    setSymbol(instrument)
    setSide('buy')
    setLots('')
    setReviewed(null)
    setReceipt(null)
    setOrderTicket('')
    setReceiptMissing(false)
    setMessage('')
    setOpen(true)
  }

  function clearPending(id: string) {
    try {
      if (pendingReceipt(receiptKey) === id) localStorage.removeItem(receiptKey)
    } catch {
      // The server still retains the receipt.
    }
    setPendingId(null)
  }

  function recoverPending(id: string) {
    setReviewed(null)
    setReceipt(null)
    setReceiptMissing(false)
    setOrderTicket('')
    setPendingId(id)
    try {
      localStorage.setItem(receiptKey, id)
    } catch {
      // The pending intent remains discoverable from the next server review.
    }
  }

  function changeOpen(next: boolean) {
    if (busy) return
    if (!next) {
      setOpen(false)
      return
    }
    const saved = pendingId ?? pendingReceipt(receiptKey)
    if (saved) {
      setPendingId(saved)
      setOpen(true)
      return
    }
    newOrder()
  }

  async function checkOrder() {
    if (!orderScope || !chartIsCurrent()) {
      setMessage('The active chart changed. Reopen the ticket on the intended symbol.')
      return
    }
    setMessage('')
    setBusy(true)
    try {
      setReviewed(
        await request('preview', principal, { symbol, side, lots, ...orderScope }, chartIsCurrent)
      )
    } catch (error) {
      if (error instanceof OrderRequestError && error.pendingId) recoverPending(error.pendingId)
      setMessage(error instanceof Error ? error.message : 'MT5 order check failed.')
    } finally {
      setBusy(false)
    }
  }

  async function sendOrder() {
    if (!reviewed?.sendAvailable || !chartIsCurrent() || reviewed.review.symbol !== symbol) {
      setMessage('The active chart changed. Reopen the ticket on the intended symbol.')
      return
    }
    setMessage('')
    setBusy(true)
    const id = reviewed.review.id
    let prepared = false
    try {
      const result = await request<{ receipt: Receipt }>(
        'submit',
        principal,
        { token: reviewed.token },
        chartIsCurrent,
        () => {
          if (pendingReceipt(receiptKey))
            throw new OrderRequestError('Check the previous demo order before submitting.', 409)
          try {
            localStorage.setItem(receiptKey, id)
          } catch {
            throw new OrderRequestError('This browser could not save the order reference.', 409)
          }
          prepared = true
          setPendingId(id)
        }
      )
      if (result.receipt?.id !== id || !Object.hasOwn(statusText, result.receipt.state))
        throw new Error('Unrecognized MT5 receipt.')
      setReceipt(result.receipt)
      if (result.receipt.state !== 'unknown') clearPending(id)
      onOutcome()
    } catch (error) {
      if (error instanceof OrderRequestError && error.status < 500) {
        if (prepared) clearPending(id)
        setMessage(error.message)
        setReviewed(null)
        if (error.pendingId) recoverPending(error.pendingId)
      } else {
        setMessage(prepared ? statusText.unknown : 'MT5 could not start the order submission.')
        onOutcome()
      }
    } finally {
      setBusy(false)
    }
  }

  async function checkReceipt(id: string, reconcile = false) {
    setMessage('')
    setBusy(true)
    setReceiptMissing(false)
    try {
      const { receipt: saved } = await request<{ receipt: Receipt }>(
        `receipts/${id}${reconcile ? '/reconcile' : ''}`,
        principal,
        reconcile ? { orderTicket: orderTicket.trim() || undefined } : undefined
      )
      if (saved?.id !== id || !Object.hasOwn(statusText, saved.state))
        throw new Error('Unrecognized MT5 receipt.')
      setReceipt(saved)
      if (saved.order) setOrderTicket(saved.order)
      if (saved.state !== 'unknown') clearPending(id)
      onOutcome()
    } catch (error) {
      if (error instanceof OrderRequestError && error.status === 404) {
        setReceipt(null)
        setReceiptMissing(true)
      }
      setMessage(error instanceof OrderRequestError ? error.message : statusText.unknown)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          className="h-7 text-xs"
          size="sm"
          variant="outline"
          disabled={(disabled || !profileScope) && !pendingId}
        >
          MT5 demo order
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>MT5 demo market order</DialogTitle>
          <DialogDescription>
            {symbol ? `${symbol} · ` : ''}Sign in to this profile’s linked demo account in MT5 on
            this PC. The fill price can differ from the estimate.
          </DialogDescription>
        </DialogHeader>
        {reviewed ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt>Account</dt>
            <dd>{reviewed.review.accountLabel}</dd>
            <dt>Order</dt>
            <dd className="capitalize">
              {reviewed.review.side} {reviewed.review.lots} lots · {reviewed.review.symbol}
            </dd>
            <dt>Estimated price</dt>
            <dd>{reviewed.review.price}</dd>
          </dl>
        ) : !pendingId && !receipt ? (
          <div className="grid gap-3">
            <Label htmlFor={`${inputId}-side`}>Side</Label>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              id={`${inputId}-side`}
              disabled={busy}
              value={side}
              onChange={(event) => setSide(event.target.value === 'sell' ? 'sell' : 'buy')}
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
            <Label htmlFor={inputId}>Volume in lots</Label>
            <Input
              id={inputId}
              inputMode="decimal"
              disabled={busy}
              value={lots}
              onChange={(event) => setLots(event.target.value)}
            />
          </div>
        ) : null}
        {receipt && (
          <output className="text-sm">
            {receipt.reason === 'mt5.preview_expired'
              ? 'The review expired before dispatch.'
              : statusText[receipt.state]}
            {receipt.order && ` Order ${receipt.order}.`}
            {receipt.deal && ` Deal ${receipt.deal}.`}
            {receipt.dealTickets?.length ? ` Deals ${receipt.dealTickets.join(', ')}.` : ''}
            {receipt.filledLots && ` Filled volume ${receipt.filledLots} lots.`}
            {receipt.retcode !== undefined && ` MT5 code ${receipt.retcode}.`}
          </output>
        )}
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        {pendingId && (
          <div className="grid gap-2">
            <p className="text-sm">
              Check the saved status or find the order in MT5 under comment Chartly{' '}
              {pendingId.slice(0, 16)}.
            </p>
            {!receiptMissing && (
              <>
                <Label htmlFor={`${inputId}-ticket`}>MT5 order ticket</Label>
                <Input
                  id={`${inputId}-ticket`}
                  inputMode="numeric"
                  maxLength={20}
                  disabled={busy || Boolean(receipt?.order)}
                  value={orderTicket}
                  onChange={(event) => setOrderTicket(event.target.value)}
                />
              </>
            )}
          </div>
        )}
        {reviewed && !reviewed.sendAvailable && (
          <p className="text-sm text-muted-foreground">
            Demo submission is disabled on this installation.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => changeOpen(false)}>
            Close
          </Button>
          {pendingId && (
            <>
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void checkReceipt(pendingId)}
              >
                Check order status
              </Button>
              {receiptMissing ? (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => {
                    clearPending(pendingId)
                    setOpen(false)
                  }}
                >
                  Dismiss missing receipt
                </Button>
              ) : (
                <Button
                  disabled={busy || (orderTicket !== '' && !/^[1-9][0-9]{0,19}$/.test(orderTicket))}
                  variant="outline"
                  onClick={() => void checkReceipt(pendingId, true)}
                >
                  Reconcile with MT5
                </Button>
              )}
            </>
          )}
          {!receipt &&
            !pendingId &&
            (reviewed ? (
              <Button disabled={busy || !reviewed.sendAvailable} onClick={() => void sendOrder()}>
                {busy ? 'Submitting…' : 'Send demo order'}
              </Button>
            ) : (
              <Button
                disabled={busy || !/^[0-9]{1,12}(\.[0-9]{1,12})?$/.test(lots)}
                onClick={() => void checkOrder()}
              >
                {busy ? 'Checking…' : 'Review order'}
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
