import type { ComponentProps } from 'react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChartPane } from '@/components/trading/ChartPane'
import type { JournalPanelProps } from '@/components/trading/JournalPanel'
import type { PaperController } from '@/hooks/usePaperSession'
import { paperFixture } from '@/lib/trader/paper.fixture'
import type { ResolvedChartContext } from '@/lib/trading/chartContext'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import Trading from './Trading'

const fake = vi.hoisted(() => ({
  context: null as ResolvedChartContext | null,
  controller: null as PaperController | null,
  disabled: null as PaperController | null,
  source: {
    versionId: 'version-one',
    checksum: 'a'.repeat(64),
    providerId: 'fixture',
    interval: '1m',
    timezone: 'UTC',
    from: 1000,
    to: 1600,
    gapStatus: 'none',
    quality: 'native',
  },
  clock: Promise.resolve() as Promise<void>,
  resolveClock: () => {},
  onChange: null as null | ((value: unknown) => void),
  ack: vi.fn(),
  start: vi.fn(),
  resume: vi.fn(),
  usePaper: vi.fn(),
  brokerDock: vi.fn(),
  journal: null as JournalPanelProps | null,
  terminal: {
    setSnapshotGuard: vi.fn(),
    chartContext: () => ({ symbol: 'EXAMPLE', exchange: 'LOCAL' }),
    evidenceKey: () => 'ready-evidence',
    evidenceView: () => ({
      symbol: 'EXAMPLE',
      exchange: 'LOCAL',
      interval: '1m',
      chartType: 'candlestick',
      timezone: 'UTC',
      replayAsOf: 1120,
    }),
    snapshotPng: vi.fn(async () => new File(['fixture'], 'chart.png', { type: 'image/png' })),
    setWorkspaceTransitionLocked: vi.fn(),
    setArmed: vi.fn(),
    drawStats: () => ({}),
    currentInterval: () => '1m',
    liveChart: () => ({ timezone: () => 'UTC' }),
    whenReady: () => Promise.resolve(),
    restoreRecordedView: vi.fn(async () => {}),
    focusTradeTime: vi.fn(),
    replayPickingBar: () => false,
  },
  data: {
    loading: false,
    readOnly: false,
    storageMode: 'backend',
    sessions: [],
    trades: [],
    workspace: { originId: 'paper-origin', tables: { journalTrades: [] } },
    acceptJournalResponse: vi.fn(async () => {}),
    books: [],
  },
}))
vi.mock('@/hooks/useResolvedChartContext', () => ({
  useResolvedChartContext: () => ({ context: fake.context, data: fake.data }),
}))
vi.mock('@/hooks/useDatasetChartSource', () => ({ useDatasetChartSource: () => fake.source }))
vi.mock('@/hooks/usePaperSession', () => ({
  usePaperSession: (owner: unknown) => {
    fake.usePaper(owner)
    return owner ? fake.controller : fake.disabled
  },
}))
vi.mock('@/stores/authStore', () => {
  const state = { isAuthenticated: true, user: { username: 'owned' } }
  return {
    chartStorageAccount: () => 'owned',
    useAuthStore: Object.assign((selector: (state: unknown) => unknown) => selector(state), {
      getState: () => state,
      subscribe: () => () => {},
    }),
  }
})
vi.mock('@/components/layout/AccountControls', () => ({ AccountControls: () => null }))
vi.mock('@/components/trading/JournalPanel', () => ({
  JournalPanel: (props: JournalPanelProps) => {
    fake.journal = props
    return (
      <button type="button" disabled={props.captureAvailable === false}>
        Attach focused chart
      </button>
    )
  },
}))
vi.mock('chartly-charts', () => ({ createLinkGroup: () => ({ setOptions() {}, destroy() {} }) }))
vi.mock('@/hooks/useChartWorkspaceCatalog', () => ({
  useChartWorkspaceCatalog: () => ({ catalog: null, loading: false, pending: false, error: null }),
}))
vi.mock('@/hooks/useWorkspaceAutosave', () => ({
  useWorkspaceAutosave: () => ({
    status: 'Unsaved',
    error: null,
    changed: vi.fn(),
    markSaved: vi.fn(),
  }),
}))
vi.mock('@/hooks/useWorkspaceGridTransition', () => ({
  useWorkspaceGridTransition: () => ({ grids: [], current: null, pending: false }),
}))
vi.mock('@/lib/trading/workspaceReplay', () => ({
  WorkspaceReplayCoordinator: class {
    constructor(callback: { onChange: (value: unknown) => void }) {
      fake.onChange = callback.onChange
    }
    setMembers() {}
    setScope() {}
    subscribePick() {
      return () => {}
    }
    stop() {}
    destroy() {}
    state() {
      return { phase: 'idle' }
    }
    start = fake.start
    resume = fake.resume
    acknowledge = fake.ack
  },
}))
vi.mock('@/components/trading/ChartPane', () => ({
  ChartPane: (props: ComponentProps<typeof ChartPane>) => {
    const initialized = useRef(props.onInitialized)
    initialized.current = props.onInitialized
    useEffect(() => {
      let current = true
      props.onTerminalChange?.(props.paneId, fake.terminal as never)
      void Promise.resolve().then(() => {
        if (current) initialized.current?.(props.paneId, fake.terminal as never)
      })
      return () => {
        current = false
        props.onTerminalChange?.(props.paneId, null)
      }
    }, [props.paneId, props.onTerminalChange])
    return (
      <div data-testid={`paper-chart-${props.paneId}`}>
        <button type="button" onClick={() => props.onReplayStart?.(props.paneId)}>
          Local replay action
        </button>
        <output>
          execution allowed: {String(props.executionAllowed)}; one click armed:{' '}
          {String(props.armed)}
        </output>
      </div>
    )
  },
}))
vi.mock('@/components/trading/DrawingRail', () => ({
  DrawingRail: () => null,
  DrawingRailTab: () => null,
}))
vi.mock('@/components/trading/ChartBottomBar', () => ({
  BOTTOM_BAR_PX: 34,
  ChartBottomBar: () => null,
}))
vi.mock('@/components/trading/WorkspaceMenu', () => ({ WorkspaceMenu: () => null }))
vi.mock('@/components/trading/IndicatorTemplates', () => ({ IndicatorTemplates: () => null }))
vi.mock('@/components/trading/dock/TradingDock', () => ({
  TradingDock: (props: unknown) => {
    fake.brokerDock(props)
    return <div>Broker dock mounted</div>
  },
}))
vi.mock('@/components/trading/dock/ReadonlyTradingDock', () => ({
  ReadonlyTradingDock: () => <div>Account execution disconnected</div>,
}))
function controller(session: ReturnType<typeof paperFixture> | null): PaperController {
  return {
    enabled: !!session,
    session,
    loading: false,
    busy: false,
    error: '',
    pending: null,
    reviewed: false,
    reload: vi.fn(async () => {}),
    mutate: vi.fn(async () => ({ session })),
    retry: vi.fn(async () => null),
    clearRejected: vi.fn(async () => {}),
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  fake.journal = null
  fake.data.readOnly = false
  fake.clock = new Promise<void>((resolve) => {
    fake.resolveClock = resolve
  })
  fake.ack.mockImplementation(async (_owner: string, time: number) => {
    await fake.clock
    fake.onChange?.({
      phase: 'active',
      scope: 'all',
      ownerId: 'p0',
      state: { time, members: [], playing: false },
    })
    return true
  })
  fake.controller = controller(paperFixture({ status: 'in_progress', asOf: 1120, cursorIndex: 1 }))
  fake.disabled = controller(null)
  fake.context = {
    key: 'owned-run',
    principal: 'owned',
    namespace: 'scope',
    preferenceScope: 'scope',
    source: 'dataset',
    executionAllowed: false,
    navigation: new URLSearchParams({ profileId: '1', runId: '1' }),
    returnHref: '/workspace/profiles/1/replay',
    window: { from: 1000, to: 1600 },
    profile: {
      id: 1,
      name: 'Owned profile',
      kind: 'replay',
      currency: 'USD',
      startingBalance: 10000,
      createdAt: '2026-11-03',
      updatedAt: '2026-11-03',
    },
    run: {
      id: 1,
      portfolioId: 1,
      name: 'Owned run',
      datasetVersionId: 'version-one',
      datasetChecksum: 'a'.repeat(64),
      paper: {
        version: 1,
        revision: 2,
        status: 'in_progress',
        manifestId: 'one',
        window: { from: 1000, to: 1600 },
      },
      symbol: 'EXAMPLE',
      timeframe: '1m',
      mode: 'Replay',
      market: 'Stocks',
      dataSource: 'fixture',
      status: 'In progress',
      startingBalance: 10000,
      notes: '',
      createdAt: '2026-11-03',
      updatedAt: '2026-11-03',
    },
    dataset: {
      id: 'version-one',
      metadata: { symbol: 'EXAMPLE', exchange: 'LOCAL', interval: '1m', currency: 'USD' },
    } as never,
  }
})
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})
describe('managed paper authority in the original Trading workspace', () => {
  it('preserves small legacy run cash as a plain decimal in the preparation ticket', async () => {
    fake.context!.run!.startingBalance = 0.00000001
    delete fake.context!.run!.paper
    fake.controller = controller(null)
    window.history.replaceState(null, '', '/trading?profileId=1&runId=1&paper=1')
    render(<Trading />)
    expect(await screen.findByText(/Starting cash: 0\.00000001/)).toBeInTheDocument()
    expect(screen.queryByText(/Starting cash: 1e-8/)).not.toBeInTheDocument()
  })
  it('blocks journal and terminal snapshots until every pane acknowledges the account clock', async () => {
    render(<Trading />)
    fireEvent.click(screen.getByRole('button', { name: 'Journal' }))
    expect(await screen.findByRole('button', { name: 'Attach focused chart' })).toBeDisabled()
    await waitFor(() => expect(fake.ack).toHaveBeenCalledWith('p0', 1120))
    expect(fake.journal!.readCaptureKey()).toBeNull()
    await expect(fake.journal!.capture()).rejects.toThrow(/Wait for the selected chart/)
    expect(fake.terminal.snapshotPng).not.toHaveBeenCalled()
    const readIdentity = fake.terminal.setSnapshotGuard.mock.calls.at(-1)![0] as () => string | null
    expect(readIdentity()).toBeNull()
    await act(async () => {
      fake.resolveClock()
      await fake.clock
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
    expect(readIdentity()).not.toBeNull()
    expect(fake.journal!.readCaptureKey()).not.toBeNull()
    await expect(fake.journal!.capture()).resolves.toMatchObject({ file: expect.any(File) })
    expect(fake.terminal.snapshotPng).toHaveBeenCalledOnce()
  })
  it('inspects an earlier simulated fill without moving or trading the current paper account', async () => {
    fake.context!.trade = {
      id: 9,
      portfolioId: 1,
      sessionId: 1,
      pair: 'EXAMPLE',
      origin: 'simulator',
      openDate: new Date(1060 * 1000).toISOString(),
    } as never
    window.history.replaceState(null, '', '/trading?profileId=1&runId=1&tradeId=9&paper=1')
    render(<Trading />)
    expect(await screen.findByRole('link', { name: 'Open current paper account' })).toHaveAttribute(
      'href',
      '/trading?profileId=1&runId=1&paper=1'
    )
    expect(screen.getByText(/Read-only trade review/)).toBeInTheDocument()
    await waitFor(() => expect(fake.resume).toHaveBeenCalledWith('p0', 1060))
    expect(fake.ack).not.toHaveBeenCalled()
    expect(fake.usePaper).toHaveBeenCalledWith(null)
    expect(screen.queryByRole('button', { name: 'Submit paper order' })).not.toBeInTheDocument()
  })
  it('does not expose future chart data or a replacement prepare action when a managed account read fails', async () => {
    fake.controller = controller(null)
    fake.controller.error = 'The paper account is unavailable. Reload it.'
    window.history.replaceState(null, '', '/trading?profileId=1&runId=1&paper=1')
    render(<Trading />)
    expect(
      await screen.findByText(/This run already owns a saved paper account/)
    ).toBeInTheDocument()
    expect(screen.getByTestId('paper-chart-p0')).not.toBeVisible()
    expect(screen.queryByRole('button', { name: 'Prepare paper account' })).not.toBeInTheDocument()
  })
  it('holds the original grid until the backend cutoff is applied and keeps account execution disabled', async () => {
    render(<Trading />)
    await waitFor(() => expect(fake.ack).toHaveBeenCalledWith('p0', 1120))
    expect(screen.getByTestId('paper-chart-p0')).not.toBeVisible()
    expect(screen.getByText(/execution allowed: false/)).toBeInTheDocument()
    expect(fake.brokerDock).not.toHaveBeenCalled()
    expect(screen.getByText(/one click armed: false/)).toBeInTheDocument()
    await act(async () => {
      fake.resolveClock()
      await fake.clock
    })
    await waitFor(() => expect(screen.getByTestId('paper-chart-p0')).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: 'Local replay action' }))
    expect(fake.start).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'Paper session' })).toBeInTheDocument()
    expect(fake.controller!.mutate).not.toHaveBeenCalled()
  })
  it('keeps recorded chart review independent of the current paper account and its ticket', async () => {
    fake.context!.evidence = {
      id: 'evidence-one',
      attachmentId: 'asset-one',
      imageSha256: 'b'.repeat(64),
      capturedAt: '2026-11-03T10:00:00Z',
      source: { kind: 'dataset', datasetVersionId: 'version-one', checksum: 'a'.repeat(64) },
      instrument: { symbol: 'EXAMPLE', exchange: 'LOCAL' },
      view: { interval: '1m', chartType: 'candlestick', timezone: 'UTC', replayAsOf: 1060 },
      annotations: '',
    }
    fake.context!.navigation.set('paper', '1')
    window.history.replaceState(null, '', '/trading?profileId=1&runId=1&paper=1')
    render(<Trading />)
    expect(await screen.findByRole('link', { name: 'Open current paper account' })).toHaveAttribute(
      'href',
      '/trading?profileId=1&runId=1&paper=1'
    )
    await waitFor(() => expect(fake.resume).toHaveBeenCalledWith('p0', 1060))
    expect(fake.ack).not.toHaveBeenCalled()
    expect(fake.usePaper).toHaveBeenCalledWith(null)
    expect(screen.queryByRole('button', { name: 'Submit paper order' })).not.toBeInTheDocument()
  })
  it('keeps an unavailable managed account behind an explicit reconnect state', async () => {
    fake.data.readOnly = true
    render(<Trading />)
    expect(
      await screen.findByText(/Reconnect the local engine to load this managed paper account/)
    ).toBeInTheDocument()
    expect(screen.getByTestId('paper-chart-p0')).not.toBeVisible()
    expect(fake.ack).not.toHaveBeenCalled()
    expect(fake.brokerDock).not.toHaveBeenCalled()
  })
})
