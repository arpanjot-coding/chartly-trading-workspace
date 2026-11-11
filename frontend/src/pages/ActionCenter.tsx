import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
  RefreshCw,
  Settings,
  Trash2,
  X,
} from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { webClient } from '@/api/client'
import { useSocketContext } from '@/components/socket/SocketProvider'
import { useKeepReconnecting } from '@/components/socket/useKeepReconnecting'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useAlertStore } from '@/stores/alertStore'
import { showToast } from '@/utils/toast'
import { AutomationNav } from './flow/AutomationNav'

interface PendingOrder {
  id: number
  strategy: string
  api_type: string
  symbol: string
  exchange: string
  action: 'BUY' | 'SELL' | 'MULTI'
  quantity: number | string
  price: number | string
  price_type: string
  product_type: string
  status: 'pending' | 'approved' | 'rejected'
  created_at_ist: string
  raw_order_data: Record<string, unknown>
  /** What the broker said once the order was sent, e.g. open, complete, rejected. */
  broker_status?: string | null
  broker_order_id?: string | null
  /**
   * Seconds since the order was approved, measured by the server when this
   * list was read. Null while it is pending. Approval age alone cannot tell
   * whether a long split or basket send is still running.
   */
  approved_age_seconds?: number | null
}

/**
 * The broker_status of an approved order Chartly has started sending and has
 * no broker answer recorded for (SUBMITTING in database/action_center_db.py).
 *
 * It is written just before the order goes to the broker and replaced by the
 * broker's answer as soon as there is one. A long-running split or basket send
 * can remain in this state for minutes; a crash can leave it there indefinitely.
 * Elapsed time cannot distinguish those cases, so the page never treats age as
 * proof that sending stopped.
 */
const SENDING_NOT_CONFIRMED = 'submitting'

/**
 * When to show a longer-wait notice. This is a prompt to investigate an order
 * without a broker answer, not a deadline after which sending must have stopped.
 */
export const SEND_SETTLE_MS = 120_000

/** When this order's send began, on this page's clock, or null if unknown. */
function sendStartedAt(order: PendingOrder, readAt: number): number | null {
  const age = order.approved_age_seconds
  if (typeof age !== 'number' || !Number.isFinite(age)) return null
  return readAt - age * 1000
}

function isClaimed(order: PendingOrder): boolean {
  return order.status === 'approved' && order.broker_status === SENDING_NOT_CONFIRMED
}

/** An approved order in the initial sending window. */
function isSending(order: PendingOrder, readAt: number, now: number): boolean {
  const started = sendStartedAt(order, readAt)
  return isClaimed(order) && started !== null && now - started < SEND_SETTLE_MS
}

/** An approved order still lacking an answer after the initial window. */
function isSendNotConfirmed(order: PendingOrder, readAt: number, now: number): boolean {
  return isClaimed(order) && !isSending(order, readAt, now)
}

interface OrderStats {
  total_pending: number
  total_approved: number
  total_rejected: number
  total_buy_orders: number
  total_sell_orders: number
}

interface ActionCenterResponse {
  status: string
  data: {
    orders: PendingOrder[]
    statistics: OrderStats
  }
}

const orderFilters = [
  { value: 'pending', label: 'Pending', count: 'total_pending' },
  { value: 'approved', label: 'Approved', count: 'total_approved' },
  { value: 'rejected', label: 'Rejected', count: 'total_rejected' },
  { value: 'all', label: 'All Orders', count: null },
] as const

const orderStats = [
  { key: 'total_pending', label: 'Pending Approval' },
  { key: 'total_buy_orders', label: 'Buy Orders' },
  { key: 'total_sell_orders', label: 'Sell Orders' },
  { key: 'total_approved', label: 'Approved' },
  { key: 'total_rejected', label: 'Rejected' },
] as const

function OrderSideBadge({ action }: { action: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        action === 'BUY' && 'border-teal-600/25 bg-teal-500/10 text-teal-800 dark:text-teal-300',
        action === 'SELL' && 'border-red-600/25 bg-red-500/10 text-red-800 dark:text-red-300'
      )}
    >
      {action === 'BUY' && <ArrowUp aria-hidden="true" />}
      {action === 'SELL' && <ArrowDown aria-hidden="true" />}
      {action}
    </Badge>
  )
}

export default function ActionCenterPage() {
  const [orders, setOrders] = useState<PendingOrder[]>([])
  const [stats, setStats] = useState<OrderStats>({
    total_pending: 0,
    total_approved: 0,
    total_rejected: 0,
    total_buy_orders: 0,
    total_sell_orders: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeFilter, setActiveFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>(
    'pending'
  )
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set())
  // When the list was read, and the clock the send states are judged by.
  const [readAt, setReadAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  // Confirmation dialogs
  const [orderToDelete, setOrderToDelete] = useState<PendingOrder | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isApproving, setIsApproving] = useState<number | null>(null)
  const [isRejecting, setIsRejecting] = useState<number | null>(null)
  const [isApprovingAll, setIsApprovingAll] = useState(false)

  // The app-wide Socket.IO connection, for realtime updates
  const { socket } = useSocketContext()
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const fetchData = useCallback(async () => {
    try {
      // Always named, "all" included: the server reads a missing status as
      // pending, so All Orders used to list only the pending ones.
      const response = await webClient.get<ActionCenterResponse>(
        `/action-center/api/data?status=${activeFilter}`
      )

      if (response.data.status === 'success') {
        const read = Date.now()
        setReadAt(read)
        setNow(read)
        setOrders(Array.isArray(response.data.data.orders) ? response.data.data.orders : [])
        setStats(
          response.data.data.statistics || {
            total_pending: 0,
            total_approved: 0,
            total_rejected: 0,
            total_buy_orders: 0,
            total_sell_orders: 0,
          }
        )
      }
    } catch (_error) {
      showToast.error('Failed to load action center data', 'actionCenter')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [activeFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // A send may finish, which refreshes this page through pending_order_updated,
  // or outlive SEND_SETTLE_MS. Look again then and show the longer-wait notice
  // without assuming that the send stopped.
  useEffect(() => {
    let next: number | null = null
    for (const order of orders) {
      if (!isSending(order, readAt, now)) continue
      const started = sendStartedAt(order, readAt)
      if (started === null) continue
      const settles = started + SEND_SETTLE_MS
      if (next === null || settles < next) next = settles
    }
    if (next === null) return
    const timer = window.setTimeout(
      () => {
        setNow(Date.now())
        fetchData()
      },
      Math.max(0, next - Date.now()) + 50
    )
    return () => window.clearTimeout(timer)
  }, [orders, readAt, now, fetchData])

  // Alert sound for newly queued orders
  useEffect(() => {
    audioRef.current = new Audio('/sounds/alert.mp3')
    audioRef.current.preload = 'auto'
  }, [])

  // Realtime order updates, on the app-wide connection SocketProvider owns.
  // This page used to open a second connection of its own, which the server had
  // to keep waiting alongside the first for as long as the page was open.
  useEffect(() => {
    if (!socket) return

    // Listen for new pending orders (semi-auto mode)
    const onCreated = (data: { api_type: string; message: string }) => {
      const { shouldShowToast, shouldPlaySound } = useAlertStore.getState()

      // Play alert sound if enabled
      if (shouldPlaySound() && shouldShowToast('actionCenter') && audioRef.current) {
        audioRef.current.play().catch(() => {})
      }

      // Show toast notification (showToast handles category filtering)
      showToast.warning(`New Order Queued: ${data.message}`, 'actionCenter', {
        duration: 5000,
      })

      // Refresh data to show new order (always do this regardless of toast settings)
      fetchData()
    }

    // Listen for order updates (approved, rejected, deleted)
    const onUpdated = () => {
      // Refresh data
      fetchData()
    }

    socket.on('pending_order_created', onCreated)
    socket.on('pending_order_updated', onUpdated)

    // Remove only this page's handlers: the connection is shared with the rest
    // of the app and stays open.
    return () => {
      socket.off('pending_order_created', onCreated)
      socket.off('pending_order_updated', onUpdated)
    }
  }, [socket, fetchData])

  // The connection this page used to own never stopped trying to reconnect, so
  // a trader waiting here for orders to approve got them again after a server
  // restart of any length. The shared connection gives up after five attempts;
  // keep it trying while this page is open.
  useKeepReconnecting(socket)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchData()
    showToast.success('Data refreshed', 'actionCenter')
  }

  const handleApprove = async (orderId: number) => {
    setIsApproving(orderId)
    try {
      const response = await webClient.post<{ status: string; message: string }>(
        `/action-center/approve/${orderId}`,
        {}
      )

      if (response.data.status === 'success') {
        showToast.success(response.data.message || 'Order approved and executed', 'actionCenter')
        fetchData()
      } else if (response.data.status === 'warning') {
        showToast.warning(response.data.message, 'actionCenter')
        fetchData()
      } else {
        showToast.error(response.data.message || 'Failed to approve order', 'actionCenter')
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } }
      showToast.error(err.response?.data?.message || 'Failed to approve order', 'actionCenter')
    } finally {
      setIsApproving(null)
    }
  }

  const handleReject = async (orderId: number) => {
    setIsRejecting(orderId)
    try {
      const response = await webClient.post<{ status: string; message: string }>(
        `/action-center/reject/${orderId}`,
        { reason: 'Rejected by user' }
      )

      if (response.data.status === 'success') {
        showToast.success('Order rejected', 'actionCenter')
        fetchData()
      } else {
        showToast.error(response.data.message || 'Failed to reject order', 'actionCenter')
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } }
      showToast.error(err.response?.data?.message || 'Failed to reject order', 'actionCenter')
    } finally {
      setIsRejecting(null)
    }
  }

  const handleDelete = async () => {
    if (!orderToDelete) return

    setIsDeleting(true)
    try {
      const response = await webClient.delete<{ status: string; message: string }>(
        `/action-center/delete/${orderToDelete.id}`
      )

      if (response.data.status === 'success') {
        showToast.success('Order deleted', 'actionCenter')
        setOrderToDelete(null)
        fetchData()
      } else {
        showToast.error(response.data.message || 'Failed to delete order', 'actionCenter')
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } }
      showToast.error(err.response?.data?.message || 'Failed to delete order', 'actionCenter')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleApproveAll = async () => {
    setIsApprovingAll(true)
    try {
      const response = await webClient.post<{ status: string; message: string }>(
        '/action-center/approve-all',
        {}
      )

      if (response.data.status === 'success') {
        showToast.success(response.data.message || 'All orders approved', 'actionCenter')
        fetchData()
      } else if (response.data.status === 'warning') {
        showToast.warning(response.data.message, 'actionCenter')
        fetchData()
      } else {
        showToast.error(response.data.message || 'Failed to approve all orders', 'actionCenter')
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } }
      showToast.error(err.response?.data?.message || 'Failed to approve all orders', 'actionCenter')
    } finally {
      setIsApprovingAll(false)
    }
  }

  const toggleExpanded = (orderId: number) => {
    setExpandedOrders((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(orderId)) {
        newSet.delete(orderId)
      } else {
        newSet.add(orderId)
      }
      return newSet
    })
  }

  const getRelativeTime = (istTimestamp: string): string => {
    if (!istTimestamp) return ''
    try {
      const orderTime = new Date(istTimestamp.replace(' IST', ''))
      const now = new Date()
      const diffMs = now.getTime() - orderTime.getTime()
      const diffMins = Math.floor(diffMs / 60000)

      if (diffMins < 1) return 'Just now'
      if (diffMins === 1) return '1 minute ago'
      if (diffMins < 60) return `${diffMins} minutes ago`

      const diffHours = Math.floor(diffMins / 60)
      if (diffHours === 1) return '1 hour ago'
      if (diffHours < 24) return `${diffHours} hours ago`

      const diffDays = Math.floor(diffHours / 24)
      if (diffDays === 1) return 'Yesterday'
      return `${diffDays} days ago`
    } catch {
      return ''
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:space-y-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Automation approvals</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Approve or reject pending automation and API orders
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {activeFilter === 'pending' && stats.total_pending > 0 && (
            <Button onClick={handleApproveAll} disabled={isApprovingAll}>
              {isApprovingAll ? <RefreshCw className="animate-spin" /> : <Check />}
              Approve All ({stats.total_pending})
            </Button>
          )}
          <Button variant="outline" onClick={handleRefresh} disabled={isLoading || isRefreshing}>
            <RefreshCw className={cn(isRefreshing && 'animate-spin')} />
            Refresh
          </Button>
          <Button variant="outline" asChild>
            <Link to="/apikey">
              <Settings />
              Toggle Order Mode
            </Link>
          </Button>
        </div>
      </header>

      <AutomationNav current="approvals" />

      <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-4 py-3 text-sm leading-5 text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p>
          When Semi-Auto is enabled in Developer API key settings, incoming automation/API orders
          are queued here for manual approval before broker execution.
        </p>
      </div>

      {isLoading ? (
        <output className="flex min-h-52 items-center justify-center gap-2 rounded-lg border bg-card px-4 text-sm text-muted-foreground">
          <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
          Loading approvals…
        </output>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-5">
            {orderStats.map(({ key, label }) => (
              <div
                key={key}
                className="space-y-1 bg-card px-3 py-3 last:col-span-2 sm:px-4 sm:last:col-span-1"
              >
                <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                <dd
                  className={cn(
                    'text-xl font-semibold tracking-tight tabular-nums',
                    key === 'total_pending' &&
                      stats[key] > 0 &&
                      'text-amber-800 dark:text-amber-300'
                  )}
                >
                  {stats[key]}
                </dd>
              </div>
            ))}
          </dl>

          <Card className="min-w-0 gap-0 overflow-hidden rounded-lg py-0 shadow-none">
            <CardHeader className="gap-4 border-b px-4 py-4 lg:flex lg:items-center lg:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base">Orders</CardTitle>
                <CardDescription>
                  {orders.length} {orders.length === 1 ? 'order' : 'orders'}
                </CardDescription>
              </div>
              <Tabs
                value={activeFilter}
                onValueChange={(v) => setActiveFilter(v as typeof activeFilter)}
              >
                <TabsList
                  aria-label="Order status"
                  className="grid h-auto w-full grid-cols-2 gap-1 rounded-md border bg-muted/40 p-1 sm:inline-flex sm:w-fit"
                >
                  {orderFilters.map(({ value, label, count }) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="min-h-8 rounded-sm px-2.5 text-xs data-[state=active]:border-border data-[state=active]:shadow-none"
                    >
                      {label}
                      {count && stats[count] > 0 && (
                        <span className="rounded-sm bg-muted px-1 tabular-nums text-muted-foreground">
                          {stats[count]}
                        </span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="px-0">
              {orders.length === 0 ? (
                <div className="space-y-1.5 px-4 py-9 text-sm">
                  <p className="font-medium">No orders found</p>
                  {activeFilter === 'pending' && (
                    <p className="max-w-md text-muted-foreground">
                      Enable Semi-Auto mode in{' '}
                      <Link to="/apikey" className="text-foreground underline underline-offset-4">
                        API Key settings
                      </Link>{' '}
                      to queue orders here
                    </p>
                  )}
                </div>
              ) : (
                <Table aria-label="Orders" className="min-w-[54rem] [&_td]:px-3 [&_th]:px-3">
                  <TableHeader className="bg-muted/30 [&_th]:text-xs [&_th]:text-muted-foreground">
                    <TableRow>
                      <TableHead>Strategy</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Exchange</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead>Order Type</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <Fragment key={order.id}>
                        <TableRow>
                          <TableCell>
                            <div className="max-w-40 truncate font-medium" title={order.strategy}>
                              {order.strategy}
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {order.api_type}
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">{order.symbol}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {order.exchange}
                          </TableCell>
                          <TableCell>
                            <OrderSideBadge action={order.action} />
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {order.quantity}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {order.price || 0}
                          </TableCell>
                          <TableCell className="text-xs">{order.price_type}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {order.product_type}
                          </TableCell>
                          <TableCell>
                            <div className="font-mono text-xs tabular-nums">
                              {order.created_at_ist}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {getRelativeTime(order.created_at_ist)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => toggleExpanded(order.id)}
                                aria-expanded={expandedOrders.has(order.id)}
                                aria-label={
                                  expandedOrders.has(order.id)
                                    ? 'Collapse order details'
                                    : 'Expand order details'
                                }
                              >
                                {expandedOrders.has(order.id) ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </Button>

                              {isSending(order, readAt, now) && (
                                <Badge variant="outline">Sending</Badge>
                              )}

                              {isSendNotConfirmed(order, readAt, now) && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-600/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                                >
                                  Status unclear
                                </Badge>
                              )}

                              {order.status === 'pending' ? (
                                <>
                                  <Button
                                    size="icon-sm"
                                    variant="outline"
                                    className="text-teal-800 hover:text-teal-900 dark:text-teal-300 dark:hover:text-teal-200"
                                    aria-label={`Approve order for ${order.symbol}`}
                                    title="Approve order"
                                    onClick={() => handleApprove(order.id)}
                                    disabled={isApproving === order.id}
                                  >
                                    {isApproving === order.id ? (
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Check className="h-4 w-4" />
                                    )}
                                  </Button>
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    aria-label={`Reject order for ${order.symbol}`}
                                    title="Reject order"
                                    onClick={() => handleReject(order.id)}
                                    disabled={isRejecting === order.id}
                                  >
                                    {isRejecting === order.id ? (
                                      <RefreshCw className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <X className="h-4 w-4" />
                                    )}
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-destructive"
                                  aria-label={`Delete order for ${order.symbol}`}
                                  title="Delete order"
                                  onClick={() => setOrderToDelete(order)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* A long send may still be running or have been interrupted. */}
                        {isSendNotConfirmed(order, readAt, now) && (
                          <TableRow>
                            <TableCell colSpan={10} className="whitespace-normal p-2">
                              <Alert variant="warning" className="max-w-[min(80vw,42rem)]">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle>This order may still be sending</AlertTitle>
                                <AlertDescription>
                                  Chartly has no broker answer recorded. A split or basket order can
                                  take longer than two minutes. Sending may still be in progress, or
                                  an interruption may have left its outcome unknown. Check your
                                  broker's order book and refresh this page. Do not place this order
                                  again while its status is unclear.
                                </AlertDescription>
                              </Alert>
                            </TableCell>
                          </TableRow>
                        )}

                        {/* Expanded Details Row */}
                        {expandedOrders.has(order.id) && (
                          <TableRow>
                            <TableCell colSpan={10} className="bg-muted/25 p-4 whitespace-normal">
                              <Collapsible open={true}>
                                <CollapsibleContent className="max-w-[min(80vw,46rem)]">
                                  <div className="space-y-4">
                                    <h4 className="font-semibold">Order Details</h4>

                                    {/* Order Type Specific Details */}
                                    {order.api_type === 'basketorder' &&
                                    order.raw_order_data.orders ? (
                                      <div className="space-y-3">
                                        <p className="text-sm text-muted-foreground">
                                          Basket Order with{' '}
                                          {Array.isArray(order.raw_order_data.orders)
                                            ? order.raw_order_data.orders.length
                                            : 0}{' '}
                                          orders
                                        </p>
                                        {Array.isArray(order.raw_order_data.orders) &&
                                          order.raw_order_data.orders.map(
                                            (basketOrder: Record<string, unknown>, idx: number) => (
                                              <Card
                                                key={idx}
                                                className="gap-0 rounded-lg py-0 shadow-none"
                                              >
                                                <CardContent className="p-3">
                                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                                    <Badge variant="outline">Order {idx + 1}</Badge>
                                                    <span className="font-medium">
                                                      {String(basketOrder.symbol || '')}
                                                    </span>
                                                    <OrderSideBadge
                                                      action={String(basketOrder.action || '')}
                                                    />
                                                  </div>
                                                  <div className="grid grid-cols-2 gap-2 break-words text-sm md:grid-cols-4">
                                                    {Object.entries(basketOrder).map(
                                                      ([key, value]) => (
                                                        <div key={key}>
                                                          <span className="text-muted-foreground">
                                                            {key}:
                                                          </span>{' '}
                                                          <span className="font-medium">
                                                            {String(value)}
                                                          </span>
                                                        </div>
                                                      )
                                                    )}
                                                  </div>
                                                </CardContent>
                                              </Card>
                                            )
                                          )}
                                      </div>
                                    ) : (
                                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                                        {Object.entries(order.raw_order_data).map(
                                          ([key, value]) => (
                                            <div
                                              key={key}
                                              className="min-w-0 rounded-md border bg-card p-2.5"
                                            >
                                              <p className="break-all text-xs text-muted-foreground">
                                                {key}
                                              </p>
                                              <p className="break-all text-sm font-medium">
                                                {typeof value === 'object'
                                                  ? JSON.stringify(value, null, 2)
                                                  : String(value)}
                                              </p>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </CollapsibleContent>
                              </Collapsible>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!orderToDelete} onOpenChange={() => setOrderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this order? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
