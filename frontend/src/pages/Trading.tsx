import { type ChartObjects, createLinkGroup, type LinkGroup } from 'chartly-charts'
import type { WorkspaceDocument, WorkspacePayload } from 'chartly-charts/workspace'
import { parseWorkspacePayload, WorkspaceRepository } from 'chartly-charts/workspace'
import { LayoutGrid, Link2 as LinkIcon } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { dataLibrary } from '@/api/dataLibrary'
import { AccountControls } from '@/components/layout/AccountControls'
import {
  ChartContextControls,
  type ChartSourceSelection,
} from '@/components/trading/ChartContextControls'
import { AccountFeedDock } from '@/components/trading/dock/AccountFeedDock'
import { ReadonlyTradingDock } from '@/components/trading/dock/ReadonlyTradingDock'
import { Mt5OrderTicket } from '@/components/trading/Mt5OrderTicket'
import { useDatasetChartSource } from '@/hooks/useDatasetChartSource'
import { useLiveFeedChartSource } from '@/hooks/useLiveFeedChartSource'
import { usePaperSession } from '@/hooks/usePaperSession'
import { useResolvedChartContext } from '@/hooks/useResolvedChartContext'
import type { ChartEvidenceCapture } from '@/lib/trader/chartEvidence'
import { createDurableWorkspaceStorage } from '@/lib/trader/nativePersistence'
import { plainPaperCash } from '@/lib/trader/paperCash'
import {
  type ResolvedChartContext,
  readChartQuery,
  resolveChartContext,
} from '@/lib/trading/chartContext'
import { createDatasetChartSource } from '@/lib/trading/chartSource'
import {
  chartSourceNavigation,
  type PreparedChartSource,
  prepareChartSource,
} from '@/lib/trading/chartSourceTransition'
import { preservedChartSetups } from '@/lib/trading/chartWorkspaceRecovery'
import { templateForChartSource } from '@/lib/trading/chartWorkspaceTemplate'
import { scopedChartStorage } from '@/lib/trading/scopedChartStorage'

// Lazy, because the panel pulls the markdown renderer and the syntax
// highlighter's grammars and themes behind it. Statically imported, every
// trader loading a chart paid for a chat they may never open. The heavy
// visualization packages inside it are already lazy for the same reason.
const AgentPanel = lazy(() =>
  import('@/components/trading/AgentPanel').then((m) => ({ default: m.AgentPanel }))
)

// The other side panels are lazy for the same reason: each is shown only once
// its rail button is pressed, and none is needed to paint a chart. Loaded with
// the page they cost every trader their code before the first candle. A
// remembered open panel is fetched beside the chart.
const AlertsPanel = lazy(() =>
  import('@/components/trading/AlertsPanel').then((m) => ({ default: m.AlertsPanel }))
)
// Brings the widget tier's data window with it, which nothing else needs to
// paint a chart.
const DataWindowPanel = lazy(() =>
  import('@/components/trading/DataWindowPanel').then((m) => ({ default: m.DataWindowPanel }))
)
const OptionChainPanel = lazy(() =>
  import('@/components/trading/OptionChainPanel').then((m) => ({ default: m.OptionChainPanel }))
)
const ScriptPanel = lazy(() =>
  import('@/components/trading/ScriptPanel').then((m) => ({ default: m.ScriptPanel }))
)
const WatchlistPanel = lazy(() =>
  import('@/components/trading/WatchlistPanel').then((m) => ({ default: m.WatchlistPanel }))
)
const JournalPanel = lazy(() =>
  import('@/components/trading/JournalPanel').then((m) => ({ default: m.JournalPanel }))
)
const PaperSessionPanel = lazy(() =>
  import('@/components/trading/PaperSessionPanel').then((m) => ({ default: m.PaperSessionPanel }))
)
const PaperReplayBar = lazy(() =>
  import('@/components/trading/PaperReplayBar').then((m) => ({ default: m.PaperReplayBar }))
)

import type { MagnetMode } from 'chartly-charts/draw'
import {
  BOTTOM_BAR_PX,
  type BottomBarControl,
  ChartBottomBar,
} from '@/components/trading/ChartBottomBar'
import { ChartPane } from '@/components/trading/ChartPane'
import { ChartProfileNavigation } from '@/components/trading/ChartProfileNavigation'
import { DrawingRail, DrawingRailTab } from '@/components/trading/DrawingRail'
import {
  ChartOrderBridgeContext,
  type ChartOrderBridgeRef,
} from '@/components/trading/dock/chartOrderBridge'
import { DOCK_ID } from '@/components/trading/dock/DockShell'
import {
  type DockTab,
  escapeTarget,
  readDockTab,
  writeDockTab,
} from '@/components/trading/dock/dockState'
import { TradingDock } from '@/components/trading/dock/TradingDock'
import { GridDividers } from '@/components/trading/GridDividers'
import { IndicatorTemplates } from '@/components/trading/IndicatorTemplates'
import { ObjectsPanel } from '@/components/trading/ObjectsPanel'
import { isPanelId, type PanelId, RightRail } from '@/components/trading/RightRail'
import { TickBox } from '@/components/trading/TickBox'
import { Tip } from '@/components/trading/Tip'
import { TB_BTN, TB_ICON, TB_ON, ToolbarDivider } from '@/components/trading/toolbarStyles'
import { WorkspaceGrid } from '@/components/trading/WorkspaceGrid'
import { WorkspaceMenu } from '@/components/trading/WorkspaceMenu'
import { type ReplayPickSource, WorkspaceReplayBar } from '@/components/trading/WorkspaceReplayBar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { useChartWorkspaceCatalog } from '@/hooks/useChartWorkspaceCatalog'
import { useWorkspaceAutosave } from '@/hooks/useWorkspaceAutosave'
import { useWorkspaceGridTransition } from '@/hooks/useWorkspaceGridTransition'
import type { AgentChartCommand } from '@/lib/agent/stream'
import { LAYOUTS, LayoutIcon, type LayoutPreset } from '@/lib/chart/layouts'
import { clearLog, fetchLog, type LoggedFire } from '@/lib/trading/alertLog'
import { alertRuntimeKey, removeWorkspaceAlertRuntime } from '@/lib/trading/alertRuntime'
import { historyChord } from '@/lib/trading/chartHistory'
import { hasChartRequest, readChartRequest, withoutChartRequest } from '@/lib/trading/chartLink'
import { chartMayTakeKey } from '@/lib/trading/drawingKeys'
import { lineStroke24 } from '@/lib/trading/glyphs'
import {
  type GridWeights,
  parseAreas,
  parseTracks,
  readGridWeights,
  tracksTemplate,
  writeGridWeights,
} from '@/lib/trading/gridSizes'
import type { PreparedChartGrid } from '@/lib/trading/preparedGrid'
import type {
  AlertFire,
  AlertsView,
  DrawStats,
  SearchRow,
  TradingTerminal,
} from '@/lib/trading/terminal'
import { capturePresetWorkspace } from '@/lib/trading/workspaceGrid'
import {
  WorkspaceReplayCoordinator,
  type WorkspaceReplaySnapshot,
} from '@/lib/trading/workspaceReplay'
import { cn } from '@/lib/utils'
import { chartStorageAccount, useAuthStore } from '@/stores/authStore'
import { showToast } from '@/utils/toast'

const NO_DRAW: DrawStats = {
  count: 0,
  canUndo: false,
  canRedo: false,
  hasSelection: false,
  magnet: false,
  magnetMode: 'off',
  removable: 0,
  selectable: 0,
  stay: false,
  tool: null,
  shortcuts: {},
}

const LAYOUT_KEY = 'oa-trading-layout'
const SYNC_KEY = 'oa-trading-sync'
const PANEL_KEY = 'oa-trading-panel'
/**
 * One-Click, the scalping terminal's convention ('1' / '0'). Off by default
 * and off whenever the key is unreadable: a chart must never open with its
 * Buy button live because storage was cleared or blocked.
 */
const ARMED_KEY = 'oa-trading-armed'
/** The drawing rail folded away ('1') or shown ('0'), beside the rail's last tools. */
const RAIL_FOLDED_KEY = 'oa-trading-rail-folded'

/** Shown unless the trader folded it: an unreadable key keeps the tools in reach. */
function readRailShown(store: Storage = localStorage): boolean {
  try {
    return store.getItem(RAIL_FOLDED_KEY) !== '1'
  } catch {
    return true
  }
}

/**
 * Where the folded rail's tab sits, from the bottom of the chart area: the
 * bottom bar's strip, the grid's 8px gutter and a pane's 1px border, then
 * centred on the 22px time axis, so the tab sits at the left end of the axis
 * row rather than over the plot or the watermark in its corner.
 */
const RAIL_TAB_BOTTOM = BOTTOM_BAR_PX + 8 + 1 + (22 - 26) / 2
/**
 * How many firings the session log keeps.
 *
 * A repeating alert on a one-minute chart left running through a session fires
 * hundreds of times, and past the first screenful nobody is reading them: the
 * cost is memory that is never given back. The oldest go first, because the
 * question the log answers is what just happened.
 */
const ALERT_LOG_LIMIT = 200

/**
 * A stored firing as the panel renders one.
 *
 * Keyed on the row id rather than on the alert's, because one alert fires many
 * times and each firing is its own row. The `log-` prefix keeps a stored row
 * from ever colliding with a live one, which is keyed by alert and sequence.
 */
function loggedToFire(row: LoggedFire): AlertFire {
  return {
    key: `log-${row.id}`,
    alertId: row.alertId,
    title: row.title,
    message: row.message,
    symbol: row.symbol,
    exchange: row.exchange,
    ...(typeof row.price === 'number' ? { price: row.price } : {}),
    firedAt: row.firedAt ?? 0,
    delivered: row.delivered,
  }
}

function readArmed(store: Storage = localStorage): boolean {
  try {
    return store.getItem(ARMED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * What a linked grid agrees on. The engine keeps the three independent, so the
 * control does too: a trader watching one instrument across four timeframes
 * wants crosshair and time linked and the symbol emphatically not, while a
 * sector grid wants the opposite.
 *
 * Crosshair and time default on and symbol defaults off, which is the reading
 * that never surprises: linking the pointer costs nothing, and silently
 * replacing the instrument in three panes because you changed one is a bad way
 * to learn a feature exists. With a single pane a group of one does nothing, so
 * the defaults are invisible until a grid makes them useful.
 */
interface SyncState {
  crosshair: boolean
  viewport: boolean
  symbol: boolean
  interval: boolean
}
const SYNC_DEFAULT: SyncState = { crosshair: true, viewport: true, symbol: false, interval: false }

/** A preset's own split, which a layout opens with until somebody drags it. */
function presetWeights(preset: LayoutPreset): GridWeights {
  return { columns: parseTracks(preset.cols), rows: parseTracks(preset.rows) }
}

function readSync(store: Storage = localStorage): SyncState {
  try {
    const raw = store.getItem(SYNC_KEY)
    if (!raw) return SYNC_DEFAULT
    const p = JSON.parse(raw) as Partial<SyncState>
    return {
      crosshair: p.crosshair ?? SYNC_DEFAULT.crosshair,
      viewport: p.viewport ?? SYNC_DEFAULT.viewport,
      symbol: p.symbol ?? SYNC_DEFAULT.symbol,
      interval: p.interval ?? SYNC_DEFAULT.interval,
    }
  } catch {
    return SYNC_DEFAULT
  }
}

export default function Trading() {
  const [params] = useSearchParams()
  const resolved = useResolvedChartContext(params)
  const principal = useAuthStore(chartStorageAccount)
  const origin = resolved.data.workspace?.originId ?? 'browser'
  const [handoff, setHandoff] = useState<{
    context: ResolvedChartContext
    source?: PreparedChartSource
    route: string
    pending: boolean
    origin: string
  }>()
  const route = params.toString()
  useEffect(() => {
    if (
      handoff &&
      (handoff.context.principal !== principal ||
        handoff.origin !== origin ||
        handoff.route !== route)
    )
      setHandoff(undefined)
  }, [handoff, principal, origin, route])
  const retained =
    handoff?.context.principal === principal && handoff.origin === origin && handoff.route === route
      ? handoff
      : undefined
  const context =
    retained && (retained.pending || resolved.context?.key !== retained.context.key)
      ? retained.context
      : resolved.context
  if (!context)
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p role={resolved.error ? 'alert' : 'status'}>
          {resolved.error || 'Reading this chart’s profile and saved history…'}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild variant="outline">
            <Link to="/workspace">Open Workspace</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/historify">Choose or import saved history</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/settings/connections">Connect data</Link>
          </Button>
          {resolved.error && (
            <Button variant="outline" onClick={resolved.retry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    )
  return (
    <TradingWorkspace
      key={`${origin}:${context.key}`}
      account={context.principal}
      context={context}
      preparedSource={retained?.source}
      onSourceHold={() =>
        setHandoff({
          context,
          source: retained?.source,
          route: params.toString(),
          pending: true,
          origin,
        })
      }
      onSourceCommit={(next, source) =>
        setHandoff({
          context: next,
          source,
          route: next.navigation.toString(),
          pending: false,
          origin,
        })
      }
      onSourceCancel={() =>
        setHandoff((current) => (current ? { ...current, pending: false } : undefined))
      }
      data={resolved.data}
    />
  )
}

function TradingWorkspace({
  account,
  context,
  data: traderData,
  preparedSource,
  onSourceHold,
  onSourceCommit,
  onSourceCancel,
}: {
  account: string
  context: ResolvedChartContext
  data: ReturnType<typeof useResolvedChartContext>['data']
  preparedSource?: PreparedChartSource
  onSourceHold(): void
  onSourceCommit(context: ResolvedChartContext, source?: PreparedChartSource): void
  onSourceCancel(): void
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const brokerConnected = useAuthStore((state) => state.isAuthenticated && !!state.user?.broker)
  const source = useDatasetChartSource(
    context.dataset,
    context.window,
    preparedSource?.kind === 'dataset' ? preparedSource : undefined
  )
  const profileTerminalScope =
    context.profile?.kind === 'live' &&
    context.profile.id &&
    traderData.storageMode === 'backend' &&
    traderData.workspace?.originId
      ? { originId: traderData.workspace.originId, profileId: context.profile.id }
      : null
  const mt5ProfileScope = traderData.readOnly ? null : profileTerminalScope
  // A journal-only profile may inspect prices from the default terminal.
  // Once it has an MT5 account book, use the verified connection instead.
  const mt5ChartScope =
    context.profile?.liveSetup?.account.mode === 'journal-only' &&
    !traderData.workspace?.books?.some(
      (book) =>
        book.kind === 'connected' &&
        (book.profileId === context.profile?.id ||
          (context.profile?.id !== undefined && book.profileIds?.includes(context.profile.id))) &&
        traderData.brokerAccounts.some(
          (account) => account.id === book.accountId && account.platform === 'mt5'
        )
    )
      ? null
      : profileTerminalScope
  const liveSource = useLiveFeedChartSource(
    context.liveFeed,
    account,
    preparedSource?.kind === 'live-feed' ? preparedSource : undefined,
    mt5ChartScope
  )
  const sourceAbort = useRef<AbortController | null>(null)
  const sourceScope = useRef('')
  sourceScope.current = `${account}:${traderData.workspace?.originId ?? 'browser'}`
  useEffect(() => () => sourceAbort.current?.abort(), [])
  const paperOwner = useMemo(
    () =>
      context.run?.id &&
      !context.evidence &&
      !context.trade &&
      source &&
      traderData.storageMode === 'backend' &&
      !traderData.readOnly &&
      traderData.workspace?.originId
        ? { principal: account, originId: traderData.workspace.originId, runId: context.run.id }
        : null,
    [
      context.run?.id,
      context.evidence,
      context.trade,
      source,
      account,
      traderData.storageMode,
      traderData.readOnly,
      traderData.workspace?.originId,
    ]
  )
  const paper = usePaperSession(paperOwner, async (response) => {
    if (response.workspace)
      await traderData.acceptJournalResponse({ workspace: response.workspace })
  })
  const [paperGridRevision, setPaperGridRevision] = useState(0)
  const [paperApplied, setPaperApplied] = useState('')
  const [paperClockError, setPaperClockError] = useState('')
  const captureGate = useRef({ blocked: true, identity: '' })
  const readSnapshotIdentity = useCallback(
    () => (captureGate.current.blocked ? null : captureGate.current.identity),
    []
  )
  useEffect(
    () => () => {
      captureGate.current.blocked = true
    },
    []
  )
  const preferences = useMemo(
    () => scopedChartStorage(context.preferenceScope),
    [context.preferenceScope]
  )
  const [initialInstrument] = useState(() =>
    context.liveFeed && !preparedSource && !context.trade && !context.navigation.has('symbol')
      ? undefined
      : context.defaultSymbol
  )
  const workspaceCatalog = useChartWorkspaceCatalog(account, undefined, context.namespace)
  const canBindRun =
    !!context.run &&
    context.run.status === 'Draft' &&
    !context.run.datasetVersionId &&
    !(traderData.workspace?.tables.journalTrades ?? traderData.trades).some(
      (trade) => trade.sessionId === context.run!.id
    )
  const preservedSetups = useMemo(
    () => preservedChartSetups(traderData.workspace?.nativeCatalogs, context),
    [traderData.workspace?.nativeCatalogs, context]
  )
  const workspacePending = useRef(false)
  const visibleGrid = useRef<PreparedChartGrid | null>(null)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const savedWorkspaceSnapshot = useRef<WorkspacePayload | undefined>(undefined)
  const [workspaceMessage, setWorkspaceMessage] = useState('Unsaved')
  const [saveStamp, setSaveStamp] = useState(0)
  const restoreAttempted = useRef(false)
  const [layoutId, setLayoutId] = useState(() => {
    const saved = preferences.getItem(LAYOUT_KEY)
    return LAYOUTS.some((l) => l.id === saved) ? (saved as string) : 'single'
  })
  const [sync, setSync] = useState<SyncState>(() => readSync(preferences))
  /**
   * One-Click for the whole workspace. Every pane follows it, like sync: the
   * on-chart Buy in one pane must not fire while the same button in the next
   * pane asks first.
   */
  const [armedIntent, setArmed] = useState<boolean>(() => readArmed(preferences))
  const armed = context.executionAllowed && brokerConnected && armedIntent
  /**
   * One group for the whole workspace, created once and kept for the life of
   * the page. Panes join it as their charts are built and re-join after every
   * rebuild, so changing a layout, theme or chart type does not quietly drop a
   * pane out of the group it still thinks it belongs to.
   */
  const [linkGroup, setLinkGroup] = useState<LinkGroup | null>(null)

  const [apiKey, setApiKey] = useState<string | null>(
    preparedSource?.kind === 'legacy-connected' ? preparedSource.apiKey : null
  )
  const [wsUrl, setWsUrl] = useState<string | null>(
    preparedSource?.kind === 'legacy-connected' ? preparedSource.wsUrl : null
  )
  const [noApiKey, setNoApiKey] = useState(false)
  const [sourcePickerRequest, setSourcePickerRequest] = useState(0)
  const chartReady = !!source || !!liveSource || (!!apiKey && !!wsUrl)

  /* ── one drawing rail for every pane ─────────────────────────────────── */
  const [tool, setTool] = useState<string | null>(null)
  const [magnet, setMagnet] = useState<MagnetMode>('off')
  const [stay, setStay] = useState(false)
  /** A tool held by a double-click on the rail, until Escape or another pick. */
  const [latched, setLatched] = useState(false)
  // Folded or not, remembered beside the rail's other choices. The rail stays
  // mounted while folded, so the armed tool, the drawings and the chords carry
  // on; a tool armed by its chord does not unfold it. The chart's right-click
  // "Hide drawing tools" folds it the same way.
  const [showRail, setShowRail] = useState(() => readRailShown(preferences))
  useEffect(() => {
    try {
      preferences.setItem(RAIL_FOLDED_KEY, showRail ? '0' : '1')
    } catch {
      // Storage refused: the fold holds for this visit.
    }
  }, [showRail, preferences])
  const [stats, setStats] = useState<DrawStats>(NO_DRAW)
  // Undo / delete act on the pane you last drew in; arming a tool hits them all,
  // so whichever pane you click next is the one that gets the shape.
  const activeRef = useRef<TradingTerminal | null>(null)

  /* ── side panels ─────────────────────────────────────────────────────── */
  const [panel, setPanel] = useState<PanelId | null>(() => {
    if (context.run && searchParams.get('paper') === '1') return 'paper'
    const saved = preferences.getItem(PANEL_KEY)
    // Checked against the rail's own list rather than a second copy of it, so
    // a panel added or renamed there cannot leave this reading a stale name.
    return isPanelId(saved) ? saved : null
  })
  /**
   * A script the chart has asked to show the source of, or null.
   *
   * Set by the braces button on a study's legend row, cleared by the panel the
   * moment it opens the file. It lives here rather than in the panel because
   * the panel is unmounted while another one is up: the request has to survive
   * long enough to bring the panel back.
   */
  const [scriptSource, setScriptSource] = useState<string | null>(null)
  const showScriptSource = useCallback((file: string) => {
    setScriptSource(file)
    setPanel('scripts')
  }, [])
  /**
   * The bottom dock: which book is open under the grid, or null for the
   * collapsed strip. Page-level like the side panels, and for the same
   * reason: the books span every symbol, so they belong to no one pane.
   */
  const [dock, setDock] = useState<DockTab | null>(() => readDockTab(preferences))
  /**
   * Which pane a panel click loads into, and whose instrument the watchlist
   * highlights. The first pane until the user touches another, so a click in
   * the panel does something sensible before any pane has been focused.
   */
  const [focusedPane, setFocusedPane] = useState('p0')
  const [mt5OrderRefresh, setMt5OrderRefresh] = useState(0)
  /**
   * Bumped whenever what `readChartContext` would answer has changed.
   *
   * A panel acting on the chart needs its instrument and its timeframe, and the
   * chart is not a React value: it is a library holding its own state, so there
   * is nothing to depend on. The only way to notice a change was to read it on
   * a timer, a question asked every second and answered differently a few times
   * a day.
   *
   * Three things change the answer and all three are already known here: the
   * focused pane, that pane's symbol, and its timeframe. A counter is enough,
   * because the panels re-read the context themselves and only need telling
   * that it is worth re-reading.
   */
  const [, setChartRevision] = useState(0)
  const noteChartChanged = useCallback(() => setChartRevision((at) => at + 1), [])
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null)
  const [paneSymbols, setPaneSymbols] = useState<Record<string, string | null>>({})
  const [paneObjects, setPaneObjects] = useState<Record<string, ChartObjects>>({})
  const [paneAlerts, setPaneAlerts] = useState<Record<string, AlertsView>>({})
  /**
   * Every alert that has fired, oldest first.
   *
   * Read back from the server on load and added to as firings happen. Alerts
   * are still evaluated by the chart that is open, so nothing fires because of
   * this list; what the server keeps is the history, which is the part a closed
   * tab used to take with it. Capped in the page as well as on the server,
   * because a repeating alert on a one-minute chart left running all day is a
   * list nobody reads and memory nobody gets back.
   */
  const [alertLog, setAlertLog] = useState<AlertFire[]>([])
  /**
   * Bumped whenever an alert changes.
   *
   * The controller is mutable and its `list()` hands back a copy, so nothing in
   * React knows that a drag, a Delete key or a firing has made the rendered
   * list stale. This is what says so.
   */
  const [alertRevision, setAlertRevision] = useState(0)
  /**
   * Every live pane's terminal, keyed by pane id.
   *
   * activeRef alone is not enough: it is only set once the user has clicked
   * into a pane, so on a fresh page load the panels had nothing to act on and
   * their search returned no results at all. This is populated as each pane
   * builds, so the panels work from the first paint.
   */
  const terminalsRef = useRef<Record<string, TradingTerminal | null>>({})
  /** The bottom bar once its code has loaded; told when a pane finishes loading. */
  const bottomBar = useRef<BottomBarControl | null>(null)
  const layoutIdRef = useRef(layoutId)
  layoutIdRef.current = layoutId
  const replayCoordinator = useRef<WorkspaceReplayCoordinator | null>(null)
  const [replaySnapshot, setReplaySnapshot] = useState<WorkspaceReplaySnapshot>({
    phase: 'idle',
    scope: 'focused',
    ownerId: null,
    state: null,
  })
  const replaySnapshotRef = useRef(replaySnapshot)
  const [replayError, setReplayError] = useState<string | null>(null)
  const [confirmReplayExit, setConfirmReplayExit] = useState(false)
  /**
   * The start bar under the pointer while one is chosen, for the replay bar's
   * label. A listener set here rather than page state, so a crosshair sweep
   * re-renders the bar alone and not every pane. Held by the page because the
   * bar subscribes before the coordinator below exists.
   */
  const replayPickListeners = useRef(new Set<() => void>())
  const replayPick = useRef<ReplayPickSource>({
    subscribe: (listener) => {
      replayPickListeners.current.add(listener)
      return () => {
        replayPickListeners.current.delete(listener)
      }
    },
    time: () => {
      const owner = replaySnapshotRef.current.ownerId
      const terminal = owner ? terminalsRef.current[owner] : null
      return terminal?.replayPickingBar() ? (terminal.replayPickBar()?.time ?? null) : null
    },
  }).current
  const replayPaneIds = useCallback(
    () =>
      visibleGrid.current
        ? visibleGrid.current.payload.panes.map((pane) => pane.id)
        : (LAYOUTS.find((item) => item.id === layoutIdRef.current) ?? LAYOUTS[0]).cells.map(
            (_, index) => `p${index}`
          ),
    []
  )
  const updateReplayMembers = useCallback(() => {
    replayCoordinator.current?.setMembers(
      replayPaneIds().flatMap((id) => {
        const terminal = terminalsRef.current[id]
        return terminal ? [{ id, terminal }] : []
      })
    )
  }, [replayPaneIds])
  useEffect(() => {
    let current = true
    const coordinator = new WorkspaceReplayCoordinator({
      onChange: (snapshot) => {
        replaySnapshotRef.current = snapshot
        if (current) {
          setReplaySnapshot(snapshot)
          if (snapshot.phase !== 'active') setConfirmReplayExit(false)
        }
      },
      onError: (error) => {
        if (current)
          setReplayError(error instanceof Error ? error.message : 'Unable to replay this workspace')
      },
    })
    replayCoordinator.current = coordinator
    const offPick = coordinator.subscribePick(() => {
      for (const listener of [...replayPickListeners.current]) listener()
    })
    updateReplayMembers()
    return () => {
      current = false
      offPick()
      coordinator.destroy()
      if (replayCoordinator.current === coordinator) replayCoordinator.current = null
    }
  }, [updateReplayMembers])
  const stopWorkspaceReplay = useCallback(() => {
    setConfirmReplayExit(false)
    replayCoordinator.current?.stop()
    setPaperGridRevision((value) => value + 1)
  }, [])
  const requestReplayExit = useCallback(() => {
    if (replaySnapshotRef.current.phase === 'active') setConfirmReplayExit(true)
    else stopWorkspaceReplay()
  }, [stopWorkspaceReplay])
  const startWorkspaceReplay = useCallback(
    (paneId: string) => {
      if (workspacePending.current) return
      if (paper.session || (paperOwner && paper.loading)) {
        setPanel('paper')
        return
      }
      setReplayError(null)
      const coordinator = replayCoordinator.current
      if (!coordinator) return
      if (coordinator.state().phase !== 'idle') requestReplayExit()
      else {
        if (replayPaneIds().some((id) => !terminalsRef.current[id])) {
          setReplayError('Every visible chart must be ready before replay')
          return
        }
        updateReplayMembers()
        coordinator.start(paneId)
      }
    },
    [
      replayPaneIds,
      requestReplayExit,
      updateReplayMembers,
      paper.session,
      paper.loading,
      paperOwner,
    ]
  )

  const noteTerminal = useCallback(
    (paneId: string, terminal: TradingTerminal | null) => {
      if (visibleGrid.current) return
      if (terminalsRef.current[paneId] !== terminal) setPaperGridRevision((value) => value + 1)
      if (terminal) terminalsRef.current[paneId] = terminal
      else {
        if (activeRef.current === terminalsRef.current[paneId]) activeRef.current = null
        delete terminalsRef.current[paneId]
      }
      terminal?.setSnapshotGuard?.(readSnapshotIdentity)
      updateReplayMembers()
    },
    [updateReplayMembers, readSnapshotIdentity]
  )
  const resumedCursor = useRef(false)
  const focusPane = useCallback(
    (t: TradingTerminal | null, paneId?: string) => {
      if (workspacePending.current) return
      activeRef.current = t
      if (visibleGrid.current && t) {
        setMagnet(t.drawStats().magnetMode)
        setStay(t.drawStats().stay)
      }
      if (paneId) {
        setFocusedPane(paneId)
        noteChartChanged()
      }
      if (t) setStats(t.drawStats())
    },
    [noteChartChanged]
  )
  const initializedTerminals = useRef(new WeakSet<TradingTerminal>())
  const resumeRememberedCursor = useCallback(
    (_paneId: string, initialized: TradingTerminal) => {
      initializedTerminals.current.add(initialized)
      if (paperOwner && (paper.loading || paper.session)) {
        setPaperGridRevision((value) => value + 1)
        return
      }
      if (
        resumedCursor.current ||
        !source ||
        workspacePending.current ||
        workspaceCatalog.loading ||
        (workspaceCatalog.catalog && !restoreAttempted.current)
      )
        return
      const ids = replayPaneIds()
      if (
        ids.some(
          (id) =>
            !terminalsRef.current[id] ||
            (!visibleGrid.current && !initializedTerminals.current.has(terminalsRef.current[id]!))
        )
      )
        return
      const paneId =
        context.evidence?.view.paneId && ids.includes(context.evidence.view.paneId)
          ? context.evidence.view.paneId
          : (visibleGrid.current?.payload.activePaneId ?? focusedPane)
      const terminal = terminalsRef.current[paneId]
      if (!terminal) return
      resumedCursor.current = true
      focusPane(terminal, paneId)
      updateReplayMembers()
      if (context.evidence) {
        const view = context.evidence.view
        void (async () => {
          const stillCurrent = () =>
            terminalsRef.current[paneId] === terminal &&
            !workspacePending.current &&
            terminal.liveChart() !== null
          await terminal.restoreRecordedView(view)
          if (!stillCurrent()) return
          if (view.replayAsOf !== undefined)
            await replayCoordinator.current?.resume(paneId, view.replayAsOf)
          if (!stillCurrent()) return
          await terminal.restoreRecordedView(view)
        })().catch((cause) =>
          showToast.error(
            cause instanceof Error ? cause.message : 'The recorded view could not be restored.'
          )
        )
      } else if (context.checkpoint) {
        void replayCoordinator.current?.resume(
          paneId,
          terminal.cursorAvailability(context.checkpoint.cursorTime)
        )
      } else if (context.trade) {
        const at = /(?:Z|[+-]\d{2}:\d{2})$/.test(context.trade.openDate)
          ? Date.parse(context.trade.openDate) / 1000
          : NaN
        if (context.run?.paper && context.trade.origin === 'simulator' && Number.isFinite(at)) {
          replayCoordinator.current?.setScope('all')
          void replayCoordinator.current?.resume(paneId, at)
        } else terminal.focusTradeTime(context.trade.openDate)
      }
    },
    [
      context.checkpoint,
      context.evidence,
      context.trade,
      context.run?.paper,
      source,
      updateReplayMembers,
      replayPaneIds,
      focusedPane,
      workspaceCatalog.loading,
      workspaceCatalog.catalog,
      focusPane,
      paperOwner,
      paper.loading,
      paper.session,
    ]
  )

  const noteAlerts = useCallback((paneId: string, view: AlertsView | null) => {
    setPaneAlerts((previous) => {
      if (view) {
        if (previous[paneId] === view) return previous
        return { ...previous, [paneId]: view }
      }
      if (!(paneId in previous)) return previous
      const next = { ...previous }
      delete next[paneId]
      return next
    })
    setAlertRevision((n) => n + 1)
  }, [])

  const noteAlertFired = useCallback((fire: AlertFire) => {
    setAlertLog((previous) =>
      previous.length < ALERT_LOG_LIMIT
        ? [...previous, fire]
        : [...previous.slice(previous.length - ALERT_LOG_LIMIT + 1), fire]
    )
  }, [])

  /**
   * The history from before this tab was opened.
   *
   * Once, on load. Not on every panel open: the rows a trader is watching for
   * arrive live through `noteAlertFired`, so refetching would only replace a
   * list that is already correct, and it would do it while they are reading it.
   */
  useEffect(() => {
    if (source || !context.executionAllowed) return
    let cancelled = false
    void fetchLog().then((fires) => {
      if (cancelled) return
      // The server answers newest first and this list is oldest first, which is
      // what the panel reverses for display.
      setAlertLog((live) => [...fires.map(loggedToFire).reverse(), ...live])
    })
    return () => {
      cancelled = true
    }
  }, [source, context.executionAllowed])

  const clearAlertLog = useCallback(() => {
    // Emptied here first: the button has to answer immediately, and the rows
    // are a log rather than anything a decision rests on.
    setAlertLog([])
    void clearLog().then((cleared) => {
      if (!cleared) {
        showToast.error('The log could not be cleared. It will be back on the next reload.')
      }
    })
  }, [])

  const noteObjects = useCallback((paneId: string, objects: ChartObjects | null) => {
    setPaneObjects((previous) => {
      if (objects) {
        if (previous[paneId] === objects) return previous
        return { ...previous, [paneId]: objects }
      }
      if (!(paneId in previous)) return previous
      const next = { ...previous }
      delete next[paneId]
      return next
    })
  }, [])

  /** The pane a panel acts on: the focused one, else any pane that is up. */
  const panelTarget = useCallback(
    () =>
      workspacePending.current
        ? null
        : (terminalsRef.current[focusedPane] ??
          activeRef.current ??
          Object.values(terminalsRef.current)[0] ??
          null),
    [focusedPane]
  )

  const noteSymbol = useCallback(
    (paneId: string, key: string | null) => {
      setPaneSymbols((prev) => (prev[paneId] === key ? prev : { ...prev, [paneId]: key }))
      noteChartChanged()
      // A pane on a preset range shows the same span of its new bars.
      const terminal = terminalsRef.current[paneId]
      if (terminal && !workspacePending.current) bottomBar.current?.paneLoaded(terminal)
    },
    [noteChartChanged]
  )

  /**
   * Load an instrument chosen in a side panel.
   *
   * Panels are page-level and panes are not, so the click has to be routed to
   * one. It goes to the pane the user last touched -- the same pane the drawing
   * rail acts on, so "the pane I am working in" means one thing everywhere.
   */
  const sendToFocusedPane = useCallback(
    (row: SearchRow) => {
      stopWorkspaceReplay()
      void panelTarget()?.loadSymbol(row)
    },
    [panelTarget, stopWorkspaceReplay]
  )

  /**
   * Whether any pane is replaying, or picking a bar to replay from. The
   * dock's actions go to the broker at the live price, and the chart already
   * refuses every order route while a replayed session is on screen; a
   * Cancel in the dock under that chart has to refuse in the same breath.
   * Any pane, not just the focused one: the dock is page-level and the
   * replayed chart is on screen whichever pane it is in.
   */
  const tradingLocked = useCallback(
    () =>
      !context.executionAllowed ||
      workspacePending.current ||
      replaySnapshotRef.current.phase !== 'idle' ||
      Object.values(terminalsRef.current).some(
        (t) =>
          t !== null &&
          (t.replayActive() ||
            t.replayPickingBar() ||
            t.replayLoadingBars() ||
            t.dataUnavailable() ||
            t.alertDialogOpen())
      ),
    [context.executionAllowed]
  )

  /** Bound to the focused pane so panel search returns broker-supported rows. */
  const searchFromFocusedPane = useCallback(
    (query: string, exchange?: string, limit?: number) =>
      panelTarget()?.search(query, exchange, limit) ?? Promise.resolve([]),
    [panelTarget]
  )

  /**
   * The agent's two ends, both resolved through `panelTarget` at call time.
   *
   * That is what makes the chart context fresh: the pane is looked up when the
   * message is sent, not when the panel mounted, so loading a symbol and then
   * asking about it asks about the symbol that is there. It also means the
   * agent follows the focused pane in a grid layout, the same way the
   * watchlist and the option chain already do.
   */
  const readChartContext = useCallback(
    () => (readSnapshotIdentity() === null ? null : (panelTarget()?.chartContext() ?? null)),
    [panelTarget, readSnapshotIdentity]
  )

  const applyChartCommands = useCallback(
    (commands: AgentChartCommand[]) => {
      stopWorkspaceReplay()
      void panelTarget()?.applyChartCommands(commands)
    },
    [panelTarget, stopWorkspaceReplay]
  )

  /**
   * The focused pane as a PNG, for the agent composer's screenshot item.
   *
   * The same capture the camera menu's save and copy use, so what the model is
   * shown is exactly what saving would have produced: the interaction-only
   * overlays taken down, the OHLC readout painted in.
   */
  const captureChart = useCallback(async () => {
    const before = readSnapshotIdentity()
    if (before === null) return null
    const file = await panelTarget()?.snapshotPng()
    return before === readSnapshotIdentity() ? (file ?? null) : null
  }, [panelTarget, readSnapshotIdentity])
  const readCaptureKey = useCallback(() => {
    const identity = readSnapshotIdentity()
    if (identity === null) return null
    const terminal = panelTarget()
    const key = terminal?.evidenceKey()
    return key ? `${identity}:${focusedPane}:${key}` : null
  }, [panelTarget, readSnapshotIdentity, focusedPane])
  const captureJournalChart = useCallback(async () => {
    const terminal = panelTarget(),
      before = readCaptureKey(),
      view = terminal?.evidenceView()
    if (!terminal || !before || !view)
      throw new Error('Wait for the selected chart to load before attaching it.')
    const capturedAt = new Date().toISOString()
    const file = await terminal.snapshotPng()
    if (!file)
      throw new Error('This chart image could not be captured. Keep the chart open and try again.')
    if (before !== readCaptureKey())
      throw new Error(
        'The selected chart changed during capture. Review the current view and attach it again.'
      )
    const capture: ChartEvidenceCapture = {
      version: 1,
      capturedAt,
      source: source
        ? { kind: 'dataset', datasetVersionId: source.versionId, checksum: source.checksum }
        : {
            kind: 'legacy-connected',
            provider: useAuthStore.getState().user?.broker ?? 'existing-connected-source',
          },
      instrument: { symbol: view.symbol, exchange: view.exchange },
      view: {
        interval: view.interval,
        chartType: view.chartType,
        timezone: view.timezone,
        ...(view.visibleFrom === undefined ? {} : { visibleFrom: view.visibleFrom }),
        ...(view.visibleTo === undefined ? {} : { visibleTo: view.visibleTo }),
        ...(view.replayAsOf === undefined ? {} : { replayAsOf: view.replayAsOf }),
        paneId: focusedPane,
      },
    }
    return { file, capture }
  }, [panelTarget, readCaptureKey, source, focusedPane])
  // The same rule the objects panel follows: the focused pane when it has
  // alerts, else whichever pane does, so the panel is useful before the trader
  // has clicked into a chart.
  const alertsPaneId = paneAlerts[focusedPane]
    ? focusedPane
    : (Object.keys(paneAlerts)[0] ?? focusedPane)
  const alertsPaneNumber = visibleGrid.current
    ? visibleGrid.current.payload.panes.findIndex((pane) => pane.id === alertsPaneId) + 1
    : Number(alertsPaneId.slice(1)) + 1
  const alertsPaneLabel = `Pane ${alertsPaneNumber}${
    paneSymbols[alertsPaneId] ? ` · ${paneSymbols[alertsPaneId]}` : ''
  }`
  /**
   * Open the alert editor, on a new alert or on one already in the list.
   *
   * The editor is a dialog the pane owns, because it needs the instrument's
   * tick and the drawing tier as they are at the moment it opens. The page asks
   * for it rather than rendering it, which is why this goes through the
   * terminal instead of setting state here.
   */
  const openAlertEditor = useCallback(
    (alertId?: string) => {
      void panelTarget()?.openAlerts(undefined, alertId)
    },
    [panelTarget]
  )

  const objectsPaneId = paneObjects[focusedPane]
    ? focusedPane
    : (Object.keys(paneObjects)[0] ?? focusedPane)
  const objectsPaneNumber = visibleGrid.current
    ? visibleGrid.current.payload.panes.findIndex((pane) => pane.id === objectsPaneId) + 1
    : Number(objectsPaneId.slice(1)) + 1
  const objectsPaneLabel = `Pane ${objectsPaneNumber}${
    paneSymbols[objectsPaneId] ? ` · ${paneSymbols[objectsPaneId]}` : ''
  }`
  const railStats: DrawStats = {
    ...stats,
    tool,
    magnet: magnet !== 'off',
    magnetMode: magnet,
    stay,
  }
  /**
   * A pane's drawing state, for the rail. When the pane being drawn in drops
   * its tool (the shape is placed and nothing holds the tool, or Escape ended
   * the eraser there), the rail and every other pane return to the cursor
   * with it, rather than the rail showing a tool no pane is using.
   */
  const onPaneDrawStats = useCallback((value: DrawStats) => {
    setStats(value)
    if (activeRef.current?.drawStats().tool === null) {
      setTool(null)
      setLatched(false)
    }
  }, [])
  /** Pick a tool from the rail; `latch` holds it after each placement until Escape. */
  const pickTool = useCallback((id: string | null, latch = false) => {
    setTool(id)
    setLatched(id !== null && latch)
  }, [])
  /**
   * Hand a key event to the focused pane; it reports whether the drawing tier
   * claimed it, as a chord arming a tool or as an edit of the selection
   * (delete, duplicate, a nudge). Both tables ship with the lazily loaded
   * tier, so the terminal -- not this page and not the rail -- can answer.
   */
  const onDrawKey = useCallback((e: KeyboardEvent) => {
    if (workspacePending.current) return false
    const t = activeRef.current
    if (!t || !t.handleDrawKey(e)) return false
    setTool(t.drawStats().tool)
    setStats(t.drawStats())
    return true
  }, [])

  /**
   * Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z walk the focused chart's undo timeline:
   * drawings, studies, panes, scales, the chart type and the interval, in the
   * order they were made. Captured on the window so it is one press whether
   * the drawing rail is shown or not, and never taken from a field, a dialog,
   * an open menu or the order ticket (chartMayTakeKey). Nothing on the
   * timeline is an order, so no press can place, change or cancel one.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const direction = historyChord(e)
      if (!direction || e.repeat || workspacePending.current) return
      if (!chartMayTakeKey(e)) return
      const t = activeRef.current
      if (!t) return
      e.preventDefault()
      e.stopPropagation()
      t.historyPress(direction)
      setStats(t.drawStats())
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  /** The dock fills this; each chart's right-click menu reads it as it opens. */
  const orderBridge = useRef<ChartOrderBridgeRef['current']>(null)

  const act = (fn: (t: TradingTerminal) => void) => {
    if (workspacePending.current) return
    const t = activeRef.current
    if (!t) return
    fn(t)
    setStats(t.drawStats())
  }

  useEffect(() => {
    preferences.setItem(LAYOUT_KEY, layoutId)
  }, [layoutId, preferences])

  useEffect(() => {
    if (panel) preferences.setItem(PANEL_KEY, panel)
    else preferences.removeItem(PANEL_KEY)
  }, [panel, preferences])

  useEffect(() => {
    writeDockTab(dock, preferences)
  }, [dock, preferences])

  useEffect(() => {
    try {
      preferences.setItem(ARMED_KEY, armed ? '1' : '0')
    } catch {
      // Storage refused (private mode, quota): the switch still works for
      // this visit, it just does not survive a reload.
    }
  }, [armed, preferences])

  /**
   * Escape closes the open panel, the way it disarms a drawing tool. Without
   * it the only way back to a full-width chart is a 32px target in the corner.
   *
   * Closing the panel is the LAST thing Escape should do, so this yields twice:
   *
   * - to any open Radix surface. Checking only the scroll lock and role=dialog
   *   missed the non-modal ones: the option chain's underlying combobox is a
   *   Popover, which sets neither, so dismissing the search closed the whole
   *   panel underneath it.
   * - to an armed drawing tool, which DrawingRail disarms on the same key
   *   without stopping propagation. One Escape did both.
   *
   * The bottom dock slots in after those two and before the panel, but only
   * while it is the topmost thing with focus: focus is inside it, or it is
   * the only thing open. escapeTarget holds that rule.
   */
  useEffect(() => {
    if (!panel && !dock) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (tool) return
      // Never steal Escape from a field, the way DrawingRail does not.
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return
      }
      if (document.body.hasAttribute('data-scroll-locked')) return
      if (
        document.querySelector(
          '[data-trading-dialog-open="true"],' +
            '[data-state="open"][role="dialog"],' +
            '[data-state="open"][data-slot="popover-content"],' +
            '[data-state="open"][role="menu"],' +
            '[data-state="open"][role="listbox"]'
        )
      ) {
        return
      }
      const dockEl = document.getElementById(DOCK_ID)
      const closes = escapeTarget({
        dock: dock !== null,
        panel: panel !== null,
        focusInDock: !!dockEl && dockEl.contains(document.activeElement),
      })
      if (closes === 'dock') setDock(null)
      else if (closes === 'panel') setPanel(null)
    }
    // Capture sees an open pane dialog before that dialog's own window-level
    // Escape listener unmounts it. In bubble order the dialog could disappear
    // first, making this handler also close the panel underneath it.
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [panel, dock, tool])

  useEffect(() => {
    preferences.setItem(SYNC_KEY, JSON.stringify(sync))
    // setOptions, not a rebuild: the engine clears the linked crosshairs when
    // that switch goes off and converges the group on its agreed symbol when
    // the symbol switch comes on, neither of which a fresh group would do.
    linkGroup?.setOptions(sync)
    visibleGrid.current?.linkGroup.setOptions(sync)
  }, [sync, linkGroup, preferences])

  useEffect(() => {
    // Setup owns the group so an effect restart cannot reuse a destroyed one.
    const group = createLinkGroup()
    setLinkGroup(group)
    return () => group.destroy()
  }, [])

  // Fetch the API key + WS URL once; every pane shares them.
  useEffect(() => {
    if (
      source ||
      liveSource ||
      preparedSource?.kind === 'legacy-connected' ||
      context.source === 'missing'
    )
      return
    let alive = true
    ;(async () => {
      try {
        const [keyRes, cfgRes] = await Promise.all([
          fetch('/api/websocket/apikey').then((r) => r.json()),
          fetch('/api/websocket/config').then((r) => r.json()),
        ])
        if (!alive) return
        if (keyRes.status !== 'success') {
          setNoApiKey(true)
          return
        }
        setApiKey(keyRes.api_key)
        setWsUrl(cfgRes.websocket_url || 'ws://127.0.0.1:8765')
      } catch {
        if (alive) setNoApiKey(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [source, liveSource, preparedSource, context.source])

  const layout = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0]
  /**
   * The unnamed grid's split. Read once per layout from this browser, and held
   * here while a divider is dragged so the charts follow the pointer before
   * anything is written.
   */
  const storedWeights = useMemo(
    () => readGridWeights(preferences, layout.id, presetWeights(layout)),
    [layout, preferences]
  )
  const [liveWeights, setLiveWeights] = useState<{ id: string; weights: GridWeights } | null>(null)
  const gridWeights = liveWeights?.id === layout.id ? liveWeights.weights : storedWeights
  const keepGridWeights = (weights: GridWeights) => {
    setLiveWeights({ id: layout.id, weights })
    writeGridWeights(preferences, layout.id, weights, presetWeights(layout))
    autosave.changed()
  }
  /** The preset with the dragged split, which is what a save captures. */
  const sizedLayout: LayoutPreset = {
    ...layout,
    cols: tracksTemplate(gridWeights.columns),
    rows: tracksTemplate(gridWeights.rows),
  }

  const lockWorkspace = useCallback(
    (pending: boolean) => {
      if (pending) stopWorkspaceReplay()
      workspacePending.current = pending
      for (const terminal of Object.values(terminalsRef.current)) {
        terminal?.setWorkspaceTransitionLocked(pending)
        if (pending) terminal?.setArmed(false)
      }
    },
    [stopWorkspaceReplay]
  )
  const publishWorkspace = useCallback(
    (grid: PreparedChartGrid) => {
      visibleGrid.current = grid
      terminalsRef.current = Object.fromEntries(grid.terminals)
      for (const terminal of grid.terminals.values())
        terminal?.setSnapshotGuard?.(readSnapshotIdentity)
      updateReplayMembers()
      setPaneSymbols(Object.fromEntries(grid.symbols))
      setPaneObjects(Object.fromEntries(grid.objects))
      const focused = grid.terminals.get(grid.payload.activePaneId) ?? null
      activeRef.current = focused
      setFocusedPane(grid.payload.activePaneId)
      setSync(grid.payload.sync)
      setArmed(false)
      setTool(null)
      setLatched(false)
      const draw = focused?.drawStats() ?? NO_DRAW
      setStats(draw)
      setMagnet(draw.magnetMode)
      setStay(draw.stay)
      if (focused) queueMicrotask(() => resumeRememberedCursor(grid.payload.activePaneId, focused))
    },
    [updateReplayMembers, resumeRememberedCursor, readSnapshotIdentity]
  )
  const workspace = useWorkspaceGridTransition(account, publishWorkspace, lockWorkspace)
  const paperClockKey = paper.session
    ? `${paper.session.runId}:${paper.session.revision}:${workspace.current?.key ?? layoutId}:${paperGridRevision}`
    : ''
  const paperSynchronized =
    !!paperClockKey && paperApplied === paperClockKey && replaySnapshot.phase === 'active'
  const paperUnavailable =
    !!context.run?.paper && !context.evidence && !context.trade && !paperOwner
  const paperBlocked =
    paperUnavailable ||
    (!!paperOwner &&
      (paper.loading ||
        (!!context.run?.paper && !paper.session) ||
        (!!paper.session && !paperSynchronized)))
  captureGate.current = {
    blocked: paperBlocked || workspace.pending,
    identity: `${context.key}:${paperClockKey}:${workspace.current?.key ?? layoutId}`,
  }
  useEffect(() => {
    if (
      !paper.session ||
      !source ||
      workspace.pending ||
      workspaceCatalog.loading ||
      (workspaceCatalog.catalog && !restoreAttempted.current)
    )
      return
    const ids = replayPaneIds()
    if (
      !ids.length ||
      ids.some(
        (id) =>
          !terminalsRef.current[id] ||
          (!visibleGrid.current && !initializedTerminals.current.has(terminalsRef.current[id]!))
      )
    )
      return
    let current = true
    const terminals = ids.map((id) => terminalsRef.current[id]!)
    const asOf = paper.session.asOf
    const ownerId = ids.includes(focusedPane) ? focusedPane : ids[0]
    setPaperClockError('')
    void (async () => {
      await Promise.all(terminals.map((terminal) => terminal.whenReady()))
      if (!current || ids.some((id, index) => terminalsRef.current[id] !== terminals[index])) return
      updateReplayMembers()
      const applied = await replayCoordinator.current?.acknowledge(ownerId, asOf)
      if (
        current &&
        applied &&
        ids.every((id, index) => terminalsRef.current[id] === terminals[index])
      )
        setPaperApplied(paperClockKey)
    })().catch((cause) => {
      if (current)
        setPaperClockError(
          cause instanceof Error
            ? cause.message
            : 'The acknowledged paper chart could not be restored.'
        )
    })
    return () => {
      current = false
    }
  }, [
    paper.session,
    paperClockKey,
    source,
    workspace.pending,
    workspaceCatalog.loading,
    workspaceCatalog.catalog,
    replayPaneIds,
    updateReplayMembers,
    focusedPane,
  ])
  useEffect(() => {
    if (!paperOwner || paper.loading || paper.session) return
    const terminal = Object.entries(terminalsRef.current).find(([, value]) => value)
    if (terminal?.[1]) resumeRememberedCursor(terminal[0], terminal[1])
  }, [paperOwner, paper.loading, paper.session, resumeRememberedCursor])

  const bindAlertRuntime = (
    terminals: Iterable<[string, TradingTerminal | null]>,
    workspaceId: string | null,
    mode: 'restore' | 'seed'
  ) => {
    for (const [paneId, terminal] of terminals) {
      terminal?.setAlertRuntimeScope(
        account && workspaceId ? alertRuntimeKey(account, workspaceId, paneId) : null,
        mode
      )
    }
  }

  const captureWorkspace = () => {
    if (workspacePending.current) throw new Error('Wait for the workspace to finish loading')
    if (replaySnapshotRef.current.phase !== 'idle')
      throw new Error('Stop replay before saving the workspace')
    if (visibleGrid.current) return visibleGrid.current.capture(focusedPane, sync)
    const panes = layout.cells.map((_, index) => {
      const id = `p${index}`,
        terminal = terminalsRef.current[id]
      if (!terminal) throw new Error('Every chart must be ready before saving')
      return terminal.captureWorkspacePane(id)
    })
    return capturePresetWorkspace(
      sizedLayout,
      panes,
      panes.some((pane) => pane.id === focusedPane) ? focusedPane : panes[0].id,
      sync
    )
  }
  const autosave = useWorkspaceAutosave({
    identity: activeWorkspaceId ? `${account}:${activeWorkspaceId}` : null,
    enabled: workspaceCatalog.catalog?.autosave === true,
    paused: workspace.pending || replaySnapshot.phase !== 'idle',
    isPaused: () => workspacePending.current || replaySnapshotRef.current.phase !== 'idle',
    capture: captureWorkspace,
    save: async (payload) => {
      if (!activeWorkspaceId) throw new Error('Save this workspace with a name first')
      await workspaceCatalog.run((repository) =>
        repository.saveWorkspace(activeWorkspaceId, payload)
      )
    },
  })
  useEffect(() => {
    if (activeWorkspaceId && saveStamp > 0) {
      autosave.markSaved(savedWorkspaceSnapshot.current)
      savedWorkspaceSnapshot.current = undefined
    }
  }, [activeWorkspaceId, saveStamp, autosave.markSaved])
  useEffect(() => {
    if (workspace.pending) setArmed(false)
  }, [workspace.pending])
  const openWorkspace = async (document: WorkspaceDocument) => {
    const revision = workspaceCatalog.catalog?.revision
    await workspace.open(
      document,
      (signal) =>
        workspaceCatalog.run((repository) =>
          repository.openWorkspace(document.id, { signal, expectedRevision: revision })
        ),
      (grid) => bindAlertRuntime(grid.terminals, document.id, 'restore')
    )
    savedWorkspaceSnapshot.current = parseWorkspacePayload(document)
    setActiveWorkspaceId(document.id)
    setWorkspaceMessage('Saved')
    setSaveStamp((value) => value + 1)
  }
  const saveWorkspaceAs = async (name: string) => {
    const payload = captureWorkspace()
    const document = await workspaceCatalog.run(async (repository) => {
      const saved = await repository.createWorkspace(name, payload)
      await repository.openWorkspace(saved.id)
      return saved
    })
    savedWorkspaceSnapshot.current = payload
    bindAlertRuntime(Object.entries(terminalsRef.current), document.id, 'seed')
    setActiveWorkspaceId(document.id)
    setWorkspaceMessage('Saved')
    setSaveStamp((value) => value + 1)
    return document
  }
  const createWorkspace = async (name: string) => {
    const payload = capturePresetWorkspace(
      LAYOUTS[0],
      [
        {
          id: 'p0',
          symbol: source?.symbol ?? initialInstrument?.symbol ?? 'BHEL',
          exchange: source?.exchange ?? initialInstrument?.exchange ?? 'NSE',
          interval: source?.interval ?? initialInstrument?.interval ?? '5m',
          chartType: 'candlestick',
          chart: { version: 1 },
          settings: {},
          volume: true,
          magnet: 'off',
          stay: false,
          comparisons: [],
          comparisonMode: 'price',
        },
      ],
      'p0',
      SYNC_DEFAULT
    )
    return prepareNewWorkspace(payload, (repository) => repository.createWorkspace(name, payload))
  }
  const prepareNewWorkspace = async (
    payload: WorkspacePayload,
    create: Parameters<typeof workspaceCatalog.run<WorkspaceDocument>>[0]
  ) => {
    let saved: WorkspaceDocument | undefined
    await workspace.open(
      payload,
      (signal) =>
        workspaceCatalog.run(async (repository) => {
          signal.throwIfAborted()
          saved = await create(repository)
          signal.throwIfAborted()
          await repository.openWorkspace(saved.id, { signal })
        }),
      (grid) => {
        if (saved) bindAlertRuntime(grid.terminals, saved.id, 'seed')
      }
    )
    if (!saved) throw new Error('Workspace was not saved')
    savedWorkspaceSnapshot.current = payload
    setActiveWorkspaceId(saved.id)
    setWorkspaceMessage('Saved')
    setSaveStamp((value) => value + 1)
    return saved
  }
  const changeLayout = (id: string) => {
    if (workspacePending.current) return
    const next = LAYOUTS.find((item) => item.id === id)
    if (!next) return
    stopWorkspaceReplay()
    if (!visibleGrid.current && !activeWorkspaceId) {
      if (!next.cells.some((_, index) => `p${index}` === focusedPane)) {
        focusPane(terminalsRef.current.p0 ?? null, 'p0')
      }
      setLayoutId(id)
      setWorkspaceMessage('Unsaved')
      autosave.changed()
      return
    }
    try {
      const current = captureWorkspace()
      const panes = next.cells.map((_, index) => ({
        ...(current.panes[index] ?? current.panes[0]),
        id: `p${index}`,
      }))
      const focusedIndex = current.panes.findIndex((pane) => pane.id === focusedPane)
      const nextFocus = focusedIndex >= 0 && focusedIndex < panes.length ? `p${focusedIndex}` : 'p0'
      const payload = capturePresetWorkspace(next, panes, nextFocus, sync)
      void workspace
        .open(
          payload,
          async () => {},
          (grid) => bindAlertRuntime(grid.terminals, activeWorkspaceId, 'seed')
        )
        .then(() => {
          setLayoutId(id)
          setWorkspaceMessage('Unsaved')
          autosave.changed()
        })
        .catch(() => {})
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : String(error))
    }
  }
  useEffect(() => {
    if (preparedSource) {
      restoreAttempted.current = true
      return
    }
    if (
      restoreAttempted.current ||
      workspaceCatalog.loading ||
      !workspaceCatalog.catalog ||
      (!source && !liveSource && (!apiKey || !wsUrl))
    )
      return
    restoreAttempted.current = true
    const document = workspaceCatalog.catalog.workspaces.find(
      (item) => item.id === workspaceCatalog.catalog?.activeWorkspaceId
    )
    if (document) void openWorkspace(document).catch(() => {})
  })
  // An unnamed chart may finish before its scoped catalog does. Retry only after
  // catalog resolution; the named-workspace publish path handles saved setups.
  useEffect(() => {
    if (workspaceCatalog.loading || workspaceCatalog.catalog?.activeWorkspaceId) return
    const terminal = terminalsRef.current[focusedPane]
    if (terminal && initializedTerminals.current.has(terminal))
      resumeRememberedCursor(focusedPane, terminal)
  }, [workspaceCatalog.loading, workspaceCatalog.catalog, focusedPane, resumeRememberedCursor])
  /**
   * A chart link from the order book, trade book or positions page.
   *
   * Applied after the saved workspace has had its turn: declared after the
   * restore above, which locks the page synchronously when it opens one, so a
   * restore can never land on top of the instrument the link asked for. The
   * parameters are dropped once applied, so a refresh keeps whatever the
   * trader has charted since.
   */
  const profileContextName = context.profile?.name ?? null
  const handledChartQuery = useRef<string | null>(null)
  useEffect(() => {
    if (liveSource) return // Direct feed links are resolved before mounting the chart.
    const explicit = hasChartRequest(searchParams)
    if (!explicit && (!context.trade || source)) return
    const query = explicit ? searchParams.toString() : `trade:${context.trade!.id}`
    if (handledChartQuery.current === query) return
    if (workspacePending.current || workspaceCatalog.loading) return
    if (workspaceCatalog.catalog && !restoreAttempted.current) return
    const request = readChartRequest(searchParams)
    if (request) {
      const target = panelTarget()
      if (!target) return
      void target.whenReady().then(() => {
        if (!workspacePending.current) sendToFocusedPane(request)
      })
    } else if (context.trade && initialInstrument) {
      const target = panelTarget()
      if (!target) return
      void target
        .whenReady()
        .then(async () => {
          const rows = (
            await target.search(initialInstrument.symbol, initialInstrument.exchange)
          ).filter(
            (row) =>
              row.symbol === initialInstrument.symbol &&
              (!initialInstrument.exchange || row.exchange === initialInstrument.exchange)
          )
          if (workspacePending.current || panelTarget() !== target) return
          if (rows.length !== 1) {
            setWorkspaceMessage(
              'Choose the complete instrument and venue for this journal entry using symbol search.'
            )
            return
          }
          await target.loadSymbol(rows[0])
          if (initialInstrument.interval && target.supportsInterval(initialInstrument.interval))
            await target.showInterval(initialInstrument.interval)
        })
        .catch((error) =>
          setWorkspaceMessage(
            error instanceof Error
              ? error.message
              : 'The journal instrument could not be loaded. Choose it using symbol search.'
          )
        )
    }
    handledChartQuery.current = query
    if (explicit) setSearchParams(withoutChartRequest(searchParams), { replace: true })
  })
  const workspaceMenu = (
    <WorkspaceMenu
      {...workspaceCatalog}
      activeId={activeWorkspaceId}
      transitionPending={workspace.pending}
      cancelOpening={workspace.cancel}
      status={autosave.status}
      error={autosave.error || workspaceCatalog.error}
      saveAs={saveWorkspaceAs}
      create={createWorkspace}
      openWorkspace={openWorkspace}
      importWorkspace={(document) =>
        prepareNewWorkspace(templateForChartSource(document, source), async (repository) => {
          const saved = await repository.importDocument(templateForChartSource(document, source))
          if (saved.kind !== 'workspace') throw new Error('Expected a chart workspace')
          return saved
        })
      }
      save={async () => {
        if (!activeWorkspaceId) throw new Error('Save this workspace with a name first')
        if (replaySnapshotRef.current.phase !== 'idle')
          throw new Error('Stop replay before saving the workspace')
        autosave.changed()
        await autosave.flush()
      }}
      onRemoved={(id) => {
        if (activeWorkspaceId === id) {
          bindAlertRuntime(Object.entries(terminalsRef.current), null, 'seed')
          setActiveWorkspaceId(null)
          setWorkspaceMessage('Unsaved')
        }
        if (account) {
          try {
            removeWorkspaceAlertRuntime(localStorage, account, id)
          } catch {
            setWorkspaceMessage('Workspace removed, but its alert history could not be cleared')
          }
        }
      }}
    />
  )
  const paneCount = workspace.current?.payload.panes.length ?? layout.cells.length
  const activeLayoutId = workspace.current?.payload.layout.preset ?? layoutId
  const activeLayoutLabel = LAYOUTS.find((item) => item.id === activeLayoutId)?.label ?? 'Custom'

  const chartIds =
    workspace.current?.geometry.panes.map((pane) => pane.id) ??
    layout.cells.map((_, index) => `p${index}`)

  /**
   * Workspace controls share one row with the selected chart's controls.
   *
   * Which chart the row drives is chosen here too, under the layouts, once
   * there is more than one chart to choose between. It used to be a "Chart 1"
   * button of its own at the head of the row, which on a single chart was a
   * label for the only chart there is. Clicking a chart still selects it, and
   * the selected chart's frame carries the accent, so the row needs no word
   * to say which one it is driving.
   */
  const layoutPicker = (
    <DropdownMenu>
      <Tip
        tip={{
          title: `Layout: ${activeLayoutLabel}`,
          sub: 'How many charts, and how they sit. Drag the gap between two charts to resize them; double-click the gap to put the sizes back.',
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(TB_BTN, TB_ICON)}
            data-workspace-control
            aria-label={`Chart layout: ${activeLayoutLabel}`}
          >
            <LayoutGrid className="h-4 w-4" strokeWidth={lineStroke24(16)} />
          </button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="start" className="w-56" data-workspace-control>
        <div className="grid grid-cols-4 gap-1 p-1">
          {LAYOUTS.map((l) => (
            <DropdownMenuItem
              key={l.id}
              onSelect={() => changeLayout(l.id)}
              title={l.label}
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-1 rounded border',
                l.id === layoutId
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'text-muted-foreground'
              )}
            >
              <LayoutIcon preset={l} />
              <span className="text-[9px] font-medium">{l.cells.length}</span>
            </DropdownMenuItem>
          ))}
        </div>
        {chartIds.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Selected chart
            </div>
            {chartIds.map((id, index) => (
              <DropdownMenuItem
                key={id}
                onSelect={() => focusPane(terminalsRef.current[id] ?? null, id)}
                className={cn('text-[13px]', id === focusedPane && 'bg-primary/10 text-primary')}
              >
                Chart {index + 1}
                {paneSymbols[id] ? `: ${paneSymbols[id]}` : ''}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  /**
   * Chart sync, beside the layout picker because the two describe the same
   * thing: how the panes relate to each other. Page-level, so only pane zero
   * carries it.
   *
   * The trigger lights up only while something is actually linked, and it is
   * disabled outright on a single-pane layout. A group of one has nobody to
   * sync with, so an inviting control there would promise something it cannot
   * do; disabled with its state still readable is the honest version.
   */
  const syncOn = sync.crosshair || sync.viewport || sync.symbol || sync.interval
  const syncPicker = (
    <DropdownMenu>
      <Tip
        tip={{
          title:
            paneCount < 2
              ? 'Chart sync needs more than one chart'
              : syncOn
                ? 'Chart sync is on'
                : 'Chart sync is off',
          sub: 'Link the crosshair, time range, symbol or interval across charts',
        }}
      >
        {/* Wrapped, so the label still shows while the button is disabled. */}
        <span className="inline-flex shrink-0">
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={paneCount < 2}
              className={cn(TB_BTN, TB_ICON, syncOn && paneCount > 1 && TB_ON)}
              aria-label="Chart sync"
            >
              <LinkIcon className="h-4 w-4" strokeWidth={lineStroke24(16)} />
            </button>
          </DropdownMenuTrigger>
        </span>
      </Tip>
      <DropdownMenuContent align="start" className="w-56">
        <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Sync across panes
        </div>
        {(
          [
            ['crosshair', 'Crosshair', 'Mirror the hovered bar'],
            ['viewport', 'Time range', 'Mirror pan and zoom'],
            ['symbol', 'Symbol', 'Load the same instrument everywhere'],
            ['interval', 'Interval', 'Use the same interval where supported'],
          ] as const
        ).map(([key, label, hint]) => (
          // A label, not a button, and the row carries no click handler of its
          // own. A <button> wrapping a checkbox is invalid HTML and behaves
          // exactly as badly as that suggests: the row handler and the input's
          // own change both fire, the switch toggles twice, and it appears to
          // do nothing at all. The label forwards a click on the text to the
          // input, so every part of the row toggles it exactly once.
          //
          // Independent switches keep the menu open while they are set.
          <label
            key={key}
            className="flex w-full cursor-pointer items-start gap-2.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <TickBox
              checked={sync[key]}
              onChange={(next) => {
                if (key === 'symbol' || key === 'interval') stopWorkspaceReplay()
                setSync((p) => ({ ...p, [key]: next }))
                autosave.changed()
              }}
              label={label}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] leading-5">{label}</span>
              <span className="block text-[11px] leading-4 text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  /**
   * One-Click, beside the layout and sync pickers because, like them, it is a
   * property of the workspace and not of one pane. The switch is the control
   * and the badge is its label, so clicking either toggles it once. A label,
   * not a button, for the reason the sync rows give: a button wrapping a
   * switch fires twice.
   */
  const armedControl = (
    <Tip
      tip={{
        title: armed ? 'One-Click is on' : 'One-Click is off',
        sub: armed
          ? 'Buy and Sell on the chart send a live order at once'
          : 'Buy and Sell on the chart open the order ticket first',
      }}
    >
      <label
        className={cn(
          'flex h-7 shrink-0 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-xs font-medium transition-colors',
          armed
            ? 'bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/40'
            : 'text-foreground/80 hover:bg-accent hover:text-foreground'
        )}
      >
        <Switch
          checked={armed}
          disabled={!brokerConnected}
          onCheckedChange={setArmed}
          aria-label="One-Click"
          // Switched on, the track carries the same red as the border and the
          // word.
          // Left on the app's accent it was a pale switch inside a red control
          // saying two different things about one state, and the accent is what
          // every harmless toggle on the page is already wearing.
          className={cn(armed && 'data-[state=checked]:bg-destructive')}
        />
        {/* One control, not two. The switch and a badge beside it were the same
          state said twice, and the badge said it in the loudest colour in the
          row while sitting at a different height from every button around it.
          The border makes it one control at the row's own height and the
          switch is still what you press.

          ON, not ARMED. The state is worth shouting about, because it is the
          one where a click on the chart sends a live order, and the capitals
          and the red are what do the shouting. The word itself only has to
          say which way the switch is thrown, and a trader should not have to
          learn a second vocabulary to read a toggle. */}
        <span className="whitespace-nowrap">
          {/* The name stays at every width, because "off" alone does not say
            what is off. The state word is the part that gives way: the switch
            beside it already shows the state, and when it is on the whole
            control is in the on-state red. The word comes back from 2xl, where
            the row has room. The accessible name is the switch's own
            aria-label, so it never depends on this text. */}
          One-Click
          <span className="hidden 2xl:inline"> {armed ? 'ON' : 'off'}</span>
        </span>
      </label>
    </Tip>
  )

  const workspaceControls = (
    <>
      {/* These are the workspace, not this chart: the grid and what syncs
          across it, the saved layouts and studies, and whether a click
          anywhere in it sends an order. Three groups, each behind a hairline. */}
      <ToolbarDivider />
      {layoutPicker}
      {syncPicker}
      <ToolbarDivider />
      {workspaceMenu}
      <IndicatorTemplates key={account} {...workspaceCatalog} target={panelTarget} />
      <ToolbarDivider />
      {armedControl}
    </>
  )

  return (
    <ChartOrderBridgeContext.Provider value={orderBridge}>
      <div className="flex flex-1 flex-col overflow-hidden bg-[var(--app-surface)]">
        {/* Rail + grid */}
        <div aria-live="polite">
          {autosave.error && (
            <p role="alert" className="px-3 py-1 text-sm text-destructive">
              Workspace not saved: {autosave.error}
            </p>
          )}
          {workspaceMessage !== 'Saved' && workspaceMessage !== 'Unsaved' && (
            <p role="alert" className="px-3 py-1 text-sm text-destructive">
              {workspaceMessage}
            </p>
          )}
          {workspace.pending && (
            <output className="flex items-center gap-3 px-3 py-1 text-sm">
              Loading workspace...
              <Button variant="ghost" size="sm" onClick={workspace.cancel}>
                Cancel
              </Button>
            </output>
          )}
          {workspace.error && (
            <p role="alert" className="px-3 py-1 text-sm text-destructive">
              {workspace.error}
            </p>
          )}
        </div>
        {/* The terminal's one header. The app's navbar is not on this page:
            the chart takes the viewport, and the way back to the dashboard
            and the account controls the navbar carries (broker, Live or
            Analyze, light or dark, the profile menu) sit at the two ends of
            this row instead. They stay put while the chart controls between
            them scroll on a narrow screen. */}
        <div className="oa-terminal-band flex h-10 min-w-0 shrink-0 items-center border-b">
          <ChartProfileNavigation
            params={context.navigation}
            returnHref={context.returnHref}
            returnLabel={
              context.returnHref.startsWith('/historify')
                ? 'Data Library'
                : context.run && !context.returnHref.includes('/journal')
                  ? 'Replay runs'
                  : undefined
            }
          />
          <ChartContextControls
            openRequest={sourcePickerRequest}
            context={context}
            mt5Profile={mt5ChartScope}
            preserved={preservedSetups}
            canBindRun={canBindRun}
            onRecover={async (key) => {
              const setup = preservedSetups.find((item) => item.key === key)
              if (!setup)
                throw new Error(
                  'This preserved setup is no longer available. Reload saved records.'
                )
              stopWorkspaceReplay()
              await prepareNewWorkspace(setup.payload, (repository) =>
                repository.createWorkspace(`${setup.name} restored`, setup.payload)
              )
            }}
            onSelect={async (choice: ChartSourceSelection) => {
              sourceAbort.current?.abort()
              const controller = new AbortController()
              sourceAbort.current = controller
              const scope = sourceScope.current
              const expectedScope =
                traderData.storageMode === 'backend' && traderData.workspace
                  ? { principalId: account, originId: traderData.workspace.originId }
                  : undefined
              const assertSourceScope = () => {
                controller.signal.throwIfAborted()
                if (
                  scope !== sourceScope.current ||
                  chartStorageAccount(useAuthStore.getState()) !== account
                )
                  throw new Error(
                    'The workspace changed. Choose the source again in the current profile.'
                  )
              }
              if (context.trade && choice && choice.symbol !== context.trade.pair)
                throw new Error(
                  'Choose saved history matching this journal trade instrument. Its current source remains unchanged.'
                )
              if (context.run) {
                if (
                  !canBindRun ||
                  !choice ||
                  choice.kind !== 'dataset' ||
                  choice.symbol !== context.run.symbol ||
                  choice.interval !== context.run.timeframe
                )
                  throw new Error(
                    'Choose matching native history for an empty unbound Draft, or prepare another run.'
                  )
                const version = await dataLibrary.version(choice.versionId, controller.signal)
                controller.signal.throwIfAborted()
                if (version.checksum !== choice.checksum)
                  throw new Error(
                    'This saved history changed. Refresh sources before binding the run.'
                  )
                const binding = {
                  datasetVersionId: version.id,
                  datasetChecksum: version.checksum,
                  symbol: version.metadata.symbol,
                  timeframe: version.metadata.interval,
                  dataSource: `${version.name || version.metadata.symbol} · ${version.metadata.provider}`,
                  rangeStart:
                    context.run.rangeStart ||
                    new Date(version.start * 1000).toISOString().slice(0, 10),
                  rangeEnd:
                    context.run.rangeEnd || new Date(version.end * 1000).toISOString().slice(0, 10),
                }
                const next = chartSourceNavigation(context, choice)
                const nextContext = resolveChartContext(
                  account,
                  readChartQuery(next),
                  {
                    profile: context.profile,
                    run: { ...context.run, ...binding },
                    trade: context.trade,
                    bookId: context.bookId,
                    datasetId: version.id,
                    missing: false,
                    evidence: undefined,
                    historicalUnavailable: false,
                  },
                  version
                )
                const candidate = createDatasetChartSource(version, { window: nextContext.window })
                try {
                  const bars = await candidate.feed.getBars({
                    symbol: candidate.symbol,
                    exchange: candidate.exchange,
                    interval: candidate.interval,
                    from: candidate.from,
                    to: candidate.horizon,
                    signal: controller.signal,
                  })
                  controller.signal.throwIfAborted()
                  if (!bars.length)
                    throw new Error('This history has no candles in the run window.')
                  assertSourceScope()
                  onSourceHold()
                  await traderData.updateSessionSource(context.run.id!, binding, expectedScope)
                  assertSourceScope()
                  stopWorkspaceReplay()
                  onSourceCommit({ ...nextContext, navigation: next }, candidate)
                  setSearchParams(next)
                } catch (error) {
                  candidate.dispose()
                  onSourceCancel()
                  throw error
                }
                return
              }
              const prepared = await prepareChartSource(
                context,
                choice,
                controller.signal,
                mt5ChartScope
              )
              try {
                assertSourceScope()
                onSourceHold()
                if (context.profile?.id && prepared.profilePatch)
                  await traderData.updatePortfolio(
                    context.profile.id,
                    prepared.profilePatch,
                    expectedScope
                  )
                assertSourceScope()
                stopWorkspaceReplay()
                onSourceCommit(prepared.context, prepared.source)
                setSearchParams(prepared.navigation)
              } catch (error) {
                prepared.source?.dispose()
                onSourceCancel()
                throw error
              }
            }}
            onRemember={
              source &&
              context.profile?.id &&
              ((!!context.run?.datasetVersionId &&
                context.run.datasetChecksum === source.checksum) ||
                (context.profile.chartSource?.kind === 'dataset' &&
                  [source.versionId, context.navigation.get('datasetVersionId')].includes(
                    context.profile.chartSource.versionId
                  )))
                ? async () => {
                    const cursorTime = panelTarget()?.chartCursor()
                    if (cursorTime === undefined || cursorTime === null)
                      throw new Error('Load the chart or choose a replay bar first.')
                    const chartView = {
                      version: 1 as const,
                      datasetVersionId: source.versionId,
                      datasetChecksum: source.checksum,
                      cursorTime,
                    }
                    if (context.run?.id)
                      await traderData.updateSessionChartView(context.run.id, chartView)
                    else await traderData.updatePortfolio(context.profile!.id!, { chartView })
                  }
                : undefined
            }
            onCopyLegacy={
              context.preferenceScope
                ? async () => {
                    const storage = createDurableWorkspaceStorage(window.indexedDB)
                    try {
                      const repository = new WorkspaceRepository(storage, `oa-trading:${account}`)
                      const original = await repository.load()
                      const document = original.workspaces.find(
                        (item) => item.id === original.activeWorkspaceId
                      )
                      if (!document)
                        throw new Error(
                          'No original active named workspace is saved. Save one in the unbound chart or import an exported workspace here.'
                        )
                      const payload = templateForChartSource(document, source)
                      await prepareNewWorkspace(payload, (target) =>
                        target.createWorkspace(`${document.name} copy`, payload)
                      )
                    } finally {
                      await storage.close()
                    }
                  }
                : undefined
            }
          />
          <ToolbarDivider />
          <div
            ref={setToolbarHost}
            className="h-full min-w-0 flex-1 [&>[role=toolbar]]:h-full"
            data-workspace-toolbar
          />
          <ToolbarDivider />
          <div className="flex shrink-0 items-center gap-0.5 pr-2">
            {liveSource?.providerId === 'mt5' &&
              liveSource.utcAlignmentVerified &&
              !context.trade &&
              !context.evidence && (
                <Mt5OrderTicket
                  principal={account}
                  profileScope={mt5ProfileScope}
                  disabled={
                    !paneSymbols[focusedPane] ||
                    workspace.pending ||
                    replaySnapshot.phase !== 'idle'
                  }
                  readSymbol={() => {
                    const pane = panelTarget()
                    if (
                      !pane ||
                      pane.dataUnavailable() ||
                      replaySnapshotRef.current.phase !== 'idle' ||
                      Object.values(terminalsRef.current).some(
                        (terminal) =>
                          terminal?.replayActive() ||
                          terminal?.replayPickingBar() ||
                          terminal?.replayLoadingBars()
                      )
                    )
                      return null
                    const instrument = pane.chartContext()
                    return instrument?.exchange === liveSource.exchange ? instrument.symbol : null
                  }}
                  onOutcome={() => setMt5OrderRefresh((current) => current + 1)}
                />
              )}
            <AccountControls variant="toolbar" />
          </div>
        </div>
        {/* Provenance strip only where it carries information the toolbar
            cannot: saved-history coverage, gaps and the paper revision.
            For a live platform feed the toolbar already names the feed,
            symbol and interval, so a second explanation line is noise. */}
        {liveSource && !liveSource.utcAlignmentVerified && (
          <output
            className="shrink-0 border-b bg-card/80 px-3 py-1.5 text-xs text-muted-foreground"
            aria-label="Chart time basis"
          >
            {liveSource.timeBasisLabel}. Replay, journal evidence and order review require verified
            time.
          </output>
        )}
        {source && (
          <output
            className="flex shrink-0 flex-wrap gap-x-3 gap-y-0.5 border-b bg-card/80 px-3 py-1.5 text-xs text-muted-foreground tabular-nums"
            aria-label="Chart context status"
          >
            <span>
              Saved history · {source.providerId} · native {source.interval} · {source.timezone}
            </span>
            <span>
              {new Date(source.from * 1000).toISOString()} →{' '}
              {new Date(source.to * 1000).toISOString()}
            </span>
            <span>
              Gaps: {source.gapStatus} · {source.quality}
            </span>
            <span>Read-only · no account orders</span>
            {paper.session && (
              <span>
                Paper account · {paper.session.status.replaceAll('_', ' ')} · committed revision{' '}
                {paper.session.revision}
              </span>
            )}
          </output>
        )}
        {!source && !liveSource && context.source === 'missing' && (
          <output
            className="block shrink-0 border-b px-3 py-1 text-xs text-muted-foreground"
            aria-label="Chart context status"
          >
            Choose a live feed or saved history for this profile to load candles.
          </output>
        )}
        {context.evidence && source && (
          <output className="block border-b px-3 py-1 text-xs">
            Recorded chart source and presentation · captured {context.evidence.capturedAt}.
            Reopening restores the observed view and replay clock; the original saved image remains
            in the journal.
          </output>
        )}
        {context.historicalUnavailable && context.source !== 'missing' && (
          <output className="block border-b px-3 py-1 text-xs">
            Current connected analysis only. No saved candles reconstruct this trade or recorded
            capture; its saved image remains in the journal.
          </output>
        )}
        {context.trade && context.run?.paper && !context.evidence && (
          <output className="block border-b px-3 py-1 text-xs">
            Read-only trade review. The paper account’s clock and finances do not change; saved
            chart captures in the journal preserve original decision evidence.
          </output>
        )}
        <main className="flex min-h-0 flex-1" inert={workspace.pending ? true : undefined}>
          {chartReady && (
            <DrawingRail
              folded={!showRail}
              onFold={() => setShowRail(false)}
              stats={railStats}
              latched={latched}
              onPick={pickTool}
              onUndo={() => act((t) => t.historyPress('undo'))}
              onRedo={() => act((t) => t.historyPress('redo'))}
              onDeleteSelected={() => act((t) => t.removeDrawings(false))}
              onRemoveAll={() => act((t) => t.requestRemoveAllDrawings())}
              onSelectAll={() => act((t) => t.selectAllDrawings())}
              onHideSelected={() => act((t) => t.hideSelectedDrawings())}
              onLockSelected={() => act((t) => t.styleSelectedDrawing({ locked: true }))}
              onMagnet={(v) => {
                setMagnet(v)
                if (visibleGrid.current)
                  for (const terminal of visibleGrid.current.terminals.values())
                    terminal.setMagnet(v)
              }}
              onStay={(v) => {
                setStay(v)
                if (visibleGrid.current)
                  for (const terminal of visibleGrid.current.terminals.values())
                    terminal.setDrawStay(v)
              }}
              onShortcut={onDrawKey}
            />
          )}
          <div className="relative min-h-0 min-w-0 flex-1">
            {context.source === 'missing' ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p>
                  {context.historicalUnavailable
                    ? 'No saved chart history is linked to this trade or capture. Current connected prices cannot reconstruct its original chart. Choose or import matching history; the journal and saved image remain available.'
                    : 'Choose saved history to open this replay environment. Its journal and profile remain available.'}
                </p>
                <Button asChild variant="outline">
                  <Link to={`/historify?${new URLSearchParams({ returnTo: context.returnHref })}`}>
                    Import or choose saved history
                  </Link>
                </Button>
                {context.historicalUnavailable &&
                  (!context.run ||
                    (!context.run.datasetVersionId &&
                      context.evidence?.source.kind === 'legacy-connected')) && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        const next = new URLSearchParams(context.navigation)
                        next.set('currentAnalysis', '1')
                        setSearchParams(next)
                      }}
                    >
                      Open current connected prices for analysis
                    </Button>
                  )}
                <Link className="underline" to={context.returnHref}>
                  Return to profile
                </Link>
              </div>
            ) : noApiKey ? (
              context.profile?.kind === 'live' ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="max-w-xl space-y-2">
                    <p className="font-medium">
                      Chart data is not set up
                      {profileContextName ? ` for ${profileContextName}` : ''}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      A platform account and chart candles are separate. Choose a live platform feed
                      (for example MT5 on this PC or Binance) or saved history. No Chartly websocket
                      API key is needed for a platform feed.
                    </p>
                  </div>
                  <Button onClick={() => setSourcePickerRequest((value) => value + 1)}>
                    Choose live chart feed
                  </Button>
                  <div className="flex flex-wrap justify-center gap-3 text-sm">
                    <Link className="underline" to="/historify">
                      Download or open saved history
                    </Link>
                    <Link
                      className="underline"
                      to={`/workspace/profiles/${context.profile.id}/connections`}
                    >
                      Review platform account
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <p className="text-sm text-muted-foreground">
                    This unbound legacy chart uses Chartly&apos;s websocket API key. That key is not
                    an MT5, Binance, or other platform credential.
                  </p>
                  <a href="/apikey" className="text-sm font-medium text-primary underline">
                    Get Chartly websocket API key
                  </a>
                  <Link className="text-sm underline" to="/historify">
                    Import or open saved history without a broker
                  </Link>
                </div>
              )
            ) : chartReady && linkGroup ? (
              <div className="relative h-full">
                {/* The grid stops above the bottom bar's strip, kept clear from
                    the first render so nothing moves when the bar arrives. */}
                {!showRail && (
                  <DrawingRailTab onUnfold={() => setShowRail(true)} bottom={RAIL_TAB_BOTTOM} />
                )}
                {paperBlocked && (
                  <output className="absolute inset-0 z-20 flex items-center justify-center bg-background p-4 text-center text-sm">
                    {paperUnavailable
                      ? 'Reconnect the local engine to load this managed paper account’s committed clock. Its journal remains available.'
                      : paperClockError ||
                        replayError ||
                        paper.error ||
                        'Loading the committed paper account and applying its chart cutoff…'}
                  </output>
                )}
                <div
                  className="absolute inset-x-0 top-0"
                  style={{ bottom: BOTTOM_BAR_PX, visibility: paperBlocked ? 'hidden' : undefined }}
                >
                  {!workspace.current && (
                    <div
                      key="unnamed"
                      className="grid h-full min-h-0 gap-1.5 p-1 sm:gap-2 sm:p-2"
                      style={{
                        gridTemplateColumns: sizedLayout.cols,
                        gridTemplateRows: sizedLayout.rows,
                        gridTemplateAreas: layout.areas,
                      }}
                    >
                      {layout.cells.map((cell, i) => (
                        <ChartPane
                          key={`p${i}`}
                          paneId={`p${i}`}
                          paneLabel={`Chart ${i + 1}`}
                          toolbarHost={toolbarHost}
                          focused={focusedPane === `p${i}`}
                          apiKey={apiKey ?? ''}
                          wsUrl={wsUrl ?? ''}
                          source={source}
                          liveSource={liveSource}
                          preparedHistory={
                            preparedSource?.kind === 'legacy-connected' ? preparedSource : undefined
                          }
                          preferences={preferences}
                          executionAllowed={context.executionAllowed}
                          initialInstrument={initialInstrument}
                          onAttachToJournal={() => setPanel('journal')}
                          onChooseSource={() => setSourcePickerRequest((value) => value + 1)}
                          style={{ gridArea: cell }}
                          sharedTool={tool}
                          sharedMagnet={magnet}
                          sharedStay={stay}
                          sharedLatch={latched}
                          onWorkspaceChange={autosave.changed}
                          onReplayStart={startWorkspaceReplay}
                          workspaceReplay={replaySnapshot}
                          onBeforeSourceChange={stopWorkspaceReplay}
                          onFocusPane={focusPane}
                          onSymbolChange={(id, key) => {
                            if (!visibleGrid.current) noteSymbol(id, key)
                          }}
                          onIntervalChange={() => {
                            if (!visibleGrid.current) noteChartChanged()
                          }}
                          onTerminalChange={noteTerminal}
                          onInitialized={resumeRememberedCursor}
                          onObjectsChange={(id, objects) => {
                            if (!visibleGrid.current) noteObjects(id, objects)
                          }}
                          onOpenScriptSource={showScriptSource}
                          onAlertsReady={(id, view) => {
                            if (!visibleGrid.current) noteAlerts(id, view)
                          }}
                          onAlertFired={noteAlertFired}
                          onAlertsChanged={() => setAlertRevision((n) => n + 1)}
                          onDrawStats={(value) => {
                            if (!visibleGrid.current) onPaneDrawStats(value)
                          }}
                          onToggleRail={() => setShowRail((v) => !v)}
                          railVisible={showRail}
                          linkGroup={linkGroup}
                          armed={armed}
                          transitionLocked={workspace.pending}
                          layoutPicker={workspaceControls}
                        />
                      ))}
                    </div>
                  )}
                  {!workspace.current && layout.cells.length > 1 && !workspace.pending && (
                    <GridDividers
                      key={layout.id}
                      cells={parseAreas(layout.areas)}
                      weights={gridWeights}
                      onChange={(weights) => setLiveWeights({ id: layout.id, weights })}
                      onCommit={keepGridWeights}
                      onReset={() => keepGridWeights(presetWeights(layout))}
                    />
                  )}
                  {workspace.grids.map((owner) => (
                    <WorkspaceGrid
                      key={owner.key}
                      owner={owner}
                      active={workspace.current === owner}
                      toolbarHost={toolbarHost}
                      focusedPaneId={focusedPane}
                      apiKey={apiKey ?? ''}
                      wsUrl={wsUrl ?? ''}
                      source={source}
                      liveSource={liveSource}
                      preferences={preferences}
                      executionAllowed={context.executionAllowed}
                      initialInstrument={initialInstrument}
                      onAttachToJournal={() => setPanel('journal')}
                      onChooseSource={() => setSourcePickerRequest((value) => value + 1)}
                      sharedTool={tool}
                      sharedLatch={latched}
                      transitionLocked={workspace.pending}
                      armed={armed}
                      railVisible={showRail}
                      onToggleRail={() => setShowRail((value) => !value)}
                      onWorkspaceChange={autosave.changed}
                      onReplayStart={startWorkspaceReplay}
                      workspaceReplay={replaySnapshot}
                      onBeforeSourceChange={stopWorkspaceReplay}
                      onFocusPane={focusPane}
                      onSymbolChange={noteSymbol}
                      onIntervalChange={noteChartChanged}
                      onObjectsChange={noteObjects}
                      onOpenScriptSource={showScriptSource}
                      onAlertsReady={noteAlerts}
                      onAlertFired={noteAlertFired}
                      onAlertsChanged={() => setAlertRevision((n) => n + 1)}
                      onDrawStats={onPaneDrawStats}
                      onTerminalChange={(id, terminal) => {
                        if (visibleGrid.current !== owner) return
                        if (terminalsRef.current[id] !== terminal)
                          setPaperGridRevision((value) => value + 1)
                        if (terminal) terminalsRef.current[id] = terminal
                        else delete terminalsRef.current[id]
                        updateReplayMembers()
                      }}
                      layoutPicker={workspaceControls}
                    />
                  ))}
                  {!paper.session && (
                    <WorkspaceReplayBar
                      snapshot={replaySnapshot}
                      timezone={
                        replaySnapshot.ownerId
                          ? (terminalsRef.current[replaySnapshot.ownerId]
                              ?.liveChart()
                              ?.timezone() ?? source?.timezone)
                          : source?.timezone
                      }
                      error={replayError}
                      ownerLabel={
                        replaySnapshot.ownerId
                          ? (paneSymbols[replaySnapshot.ownerId] ?? replaySnapshot.ownerId)
                          : undefined
                      }
                      onScopeChange={(scope) => replayCoordinator.current?.setScope(scope)}
                      onStepPick={(direction) => {
                        const owner = replaySnapshotRef.current.ownerId
                        if (owner) terminalsRef.current[owner]?.stepReplayPick(direction)
                      }}
                      onStartPick={() => {
                        const owner = replaySnapshotRef.current.ownerId
                        if (owner) terminalsRef.current[owner]?.commitReplayPick()
                      }}
                      onPlay={(speed) => replayCoordinator.current?.play(speed)}
                      onPause={() => replayCoordinator.current?.pause()}
                      onStep={() => replayCoordinator.current?.step()}
                      onStepBack={() => replayCoordinator.current?.stepBack()}
                      onSeek={(index) => replayCoordinator.current?.seek(index)}
                      onStop={requestReplayExit}
                      confirmExit={confirmReplayExit}
                      onCancelExit={() => setConfirmReplayExit(false)}
                      onConfirmExit={stopWorkspaceReplay}
                      pick={replayPick}
                      interval={
                        replaySnapshot.ownerId
                          ? terminalsRef.current[replaySnapshot.ownerId]?.currentInterval()
                          : undefined
                      }
                    />
                  )}
                  {paper.session && (
                    <Suspense fallback={null}>
                      <PaperReplayBar
                        controller={paper}
                        synchronized={paperSynchronized}
                        onOpen={() => setPanel('paper')}
                      />
                    </Suspense>
                  )}
                </div>
                <ChartBottomBar
                  pane={panelTarget}
                  panes={() =>
                    Object.values(terminalsRef.current).filter(
                      (terminal): terminal is TradingTerminal => terminal !== null
                    )
                  }
                  focusKey={focusedPane}
                  control={bottomBar}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading charting terminal…
              </div>
            )}
          </div>

          {/* Side panels, between the grid and the rail that toggles them.
              Both are page-level: they act on the focused pane rather than
              belonging to one, so repeating them per pane would be wrong. */}
          {/* The watchlist is session data plus chart navigation: it must
              open on a platform-feed chart too, not only when the legacy
              API key/WebSocket pair exists. Prices simply stay blank for
              symbols the legacy feed does not quote. */}
          {chartReady && !source && panel === 'watchlist' && (
            <Suspense fallback={null}>
              <WatchlistPanel
                apiKey={apiKey ?? ''}
                onPick={sendToFocusedPane}
                search={searchFromFocusedPane}
                activeSymbol={paneSymbols[focusedPane] ?? null}
                feed={
                  liveSource
                    ? {
                        providerId: liveSource.providerId,
                        providerName: liveSource.providerName,
                        exchange: liveSource.exchange,
                        principalId: account,
                        mt5Profile: liveSource.mt5Profile,
                      }
                    : null
                }
              />
            </Suspense>
          )}
          {chartReady && panel === 'journal' && (
            <Suspense fallback={null}>
              <JournalPanel
                contextKey={context.key}
                profileId={context.profile?.id}
                runId={context.run?.id}
                tradeId={context.trade?.id}
                bookId={context.bookId}
                instrument={readChartContext() ?? undefined}
                capture={captureJournalChart}
                readCaptureKey={readCaptureKey}
                captureAvailable={!paperBlocked && !workspace.pending}
              />
            </Suspense>
          )}
          {chartReady &&
            panel === 'paper' &&
            paperOwner &&
            context.profile?.id &&
            context.run &&
            context.dataset && (
              <Suspense fallback={null}>
                <PaperSessionPanel
                  key={paperOwner.runId}
                  controller={paper}
                  synchronized={paperSynchronized}
                  managed={!!context.run.paper}
                  profileId={context.profile.id}
                  runId={paperOwner.runId}
                  originId={paperOwner.originId}
                  startingCash={plainPaperCash(context.run.startingBalance)}
                  instrument={{
                    symbol: context.dataset.metadata.symbol,
                    exchange: context.dataset.metadata.exchange,
                    interval: context.dataset.metadata.interval,
                    currency: context.dataset.metadata.currency ?? context.profile.currency,
                  }}
                  onBranch={(runId) =>
                    setSearchParams({
                      profileId: String(context.profile!.id),
                      runId: String(runId),
                      paper: '1',
                    })
                  }
                />
              </Suspense>
            )}
          {chartReady && panel === 'paper' && !paperOwner && (
            <aside className="w-80 shrink-0 border-l p-4 text-sm">
              {(context.evidence || context.trade) && context.run?.id && context.profile?.id ? (
                <>
                  <p>
                    This is a read-only decision view. Its historical clock does not move the paper
                    account. Open the current account before submitting another decision.
                  </p>
                  <Link
                    className="underline"
                    to={`/trading?${new URLSearchParams({ profileId: String(context.profile.id), runId: String(context.run.id), paper: '1', ...(context.navigation.get('journalReturn') ? { journalReturn: context.navigation.get('journalReturn')! } : {}) })}`}
                  >
                    Open current paper account
                  </Link>
                </>
              ) : (
                <>
                  <p>
                    Open a saved, version-bound replay run in local Storage to prepare its
                    independent paper account.
                  </p>
                  <Link className="underline" to="/workspace">
                    Open Workspace
                  </Link>
                </>
              )}
            </aside>
          )}
          {apiKey && wsUrl && !source && context.executionAllowed && panel === 'options' && (
            <Suspense fallback={null}>
              <OptionChainPanel
                apiKey={apiKey}
                onPick={sendToFocusedPane}
                activeSymbol={paneSymbols[focusedPane] ?? null}
              />
            </Suspense>
          )}
          {chartReady && !paperBlocked && panel === 'agent' && (
            <Suspense fallback={null}>
              <AgentPanel
                getChartContext={readChartContext}
                onChartCommand={applyChartCommands}
                onCaptureChart={captureChart}
              />
            </Suspense>
          )}
          {/* Alerts are drawn on the chart and fire locally, so they work
              on every chart source — they never needed an account. */}
          {chartReady && !paperBlocked && panel === 'alerts' && (
            <Suspense fallback={null}>
              <AlertsPanel
                view={paneAlerts[alertsPaneId] ?? null}
                log={alertLog}
                paneLabel={alertsPaneLabel}
                onEdit={openAlertEditor}
                onClearLog={clearAlertLog}
                revision={alertRevision}
              />
            </Suspense>
          )}
          {chartReady && !paperBlocked && panel === 'objects' && (
            <ObjectsPanel model={paneObjects[objectsPaneId] ?? null} paneLabel={objectsPaneLabel} />
          )}
          {chartReady && !paperBlocked && panel === 'data' && (
            <Suspense fallback={null}>
              {/* Same pane rule as Objects. A pane builds a new chart and a new
                  inventory together, so the inventory changing is what brings
                  the panel onto the new chart. */}
              <DataWindowPanel
                chart={
                  paneObjects[objectsPaneId]
                    ? (terminalsRef.current[objectsPaneId]?.liveChart() ?? null)
                    : null
                }
                paneLabel={objectsPaneLabel}
              />
            </Suspense>
          )}
          {chartReady && !paperBlocked && panel === 'scripts' && (
            <Suspense fallback={null}>
              <ScriptPanel
                // `panelTarget`, not `act`. Both reach a chart, but `act` wants
                // the pane a toolbar button was pressed over and answers null
                // until one has been focused, so adding a study did nothing at
                // all until the trader happened to click the chart first. This is
                // the helper written for a panel: the focused pane, else any pane
                // that is up. It is the same one the watchlist and the assistant
                // use for the same reason.
                onAddToChart={(indicatorId) => {
                  const target = panelTarget()
                  if (!target) return false
                  void target.addIndicatorById(indicatorId)
                  return true
                }}
                openFile={scriptSource}
                onOpened={() => setScriptSource(null)}
              />
            </Suspense>
          )}

          {chartReady &&
            paperBlocked &&
            panel &&
            ['agent', 'objects', 'data', 'scripts'].includes(panel) && (
              <aside className="w-80 shrink-0 border-l p-4 text-sm">
                <output>
                  Chart readouts and captures will be available after every pane applies the
                  committed paper cutoff.
                </output>
              </aside>
            )}

          {chartReady &&
            panel &&
            ((!!source && (panel === 'watchlist' || panel === 'options')) ||
              (!source && !context.executionAllowed && panel === 'options')) && (
              <aside className="w-80 shrink-0 border-l p-4 text-sm">
                {source ? (
                  <p className="mb-3">
                    This is a saved-history chart, so account tools and automated execution are off.
                    Drawings, indicators, alerts, replay and the Journal panel work here.
                  </p>
                ) : (
                  <p className="mb-3">
                    The option chain needs an options venue with a tradable account session.
                    {liveSource
                      ? ` This chart is a read-only ${liveSource.providerName} feed, which has no option chain.`
                      : ' Connect the account in this profile to view strikes.'}
                  </p>
                )}
                <Button variant="outline" asChild>
                  <Link
                    to={
                      context.profile?.id
                        ? `/workspace/profiles/${context.profile.id}/connections`
                        : '/settings/connections'
                    }
                  >
                    Open profile connections
                  </Link>
                </Button>
                <Button variant="ghost" onClick={() => setPanel('journal')}>
                  Open Journal panel
                </Button>
              </aside>
            )}
          {chartReady && (
            <RightRail
              active={panel}
              onSelect={setPanel}
              paperAvailable={!!paperOwner || !!context.run?.paper}
            />
          )}
        </main>

        {/* The bottom dock: orders, positions and trades across every symbol.
            Under the rails and the side panel, full width, because the books
            are the workspace's and not one pane's. */}
        {apiKey && wsUrl && !source && context.executionAllowed && (
          <TradingDock
            tab={dock}
            onTabChange={setDock}
            apiKey={apiKey}
            onPick={sendToFocusedPane}
            activeSymbol={paneSymbols[focusedPane] ?? null}
            tradingLocked={tradingLocked}
            bridge={orderBridge}
            storage={preferences}
          />
        )}
        {/* On an MT5 live-feed chart the dock is the terminal account
            itself (Toolbox equivalent): balance/equity in the strip,
            positions/orders/history behind the tabs, read-only. */}
        {chartReady && !context.executionAllowed && liveSource?.providerId === 'mt5' ? (
          <AccountFeedDock
            tab={dock === 'gtt' ? null : dock}
            onTabChange={setDock}
            storage={preferences}
            providerId={liveSource.providerId}
            providerName={liveSource.providerName}
            principalId={account}
            profileScope={mt5ProfileScope}
            refreshKey={mt5OrderRefresh}
            activeSymbol={paneSymbols[focusedPane] ?? null}
            onPick={(symbol) => sendToFocusedPane({ symbol, exchange: liveSource.exchange })}
          />
        ) : (
          chartReady &&
          !context.executionAllowed && (
            <ReadonlyTradingDock
              tab={dock}
              onTabChange={setDock}
              storage={preferences}
              savedHistory={!!source}
              paperAvailable={!!paper.session}
              onOpenPaper={() => setPanel('paper')}
            />
          )
        )}
      </div>
    </ChartOrderBridgeContext.Provider>
  )
}
