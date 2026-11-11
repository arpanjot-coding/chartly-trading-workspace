import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetVersion } from '@/api/dataLibrary'
import { useAuthStore } from '@/stores/authStore'
import TraderWorkspace from './TraderWorkspace'

const fixture = vi.hoisted(() => ({
  createPortfolio: vi.fn(),
  reload: vi.fn(),
  catalog: vi.fn(),
  version: vi.fn(),
  createSession: vi.fn(),
  providers: vi.fn(),
  connectorAction: vi.fn(),
  liveCandles: vi.fn(),
}))
vi.mock('@/api/dataLibrary', () => ({
  dataLibrary: { catalog: fixture.catalog, version: fixture.version },
}))
vi.mock('@/api/marketData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/marketData')>()),
  marketData: { candles: fixture.liveCandles, quote: vi.fn() },
}))
vi.mock('@/lib/trader/connectorClient', () => ({
  connectorClient: { providers: fixture.providers, action: fixture.connectorAction },
}))
vi.mock('@/lib/trader/useTraderData', () => ({
  useTraderData: () => ({
    loading: false,
    portfolios: [],
    sessions: [],
    trades: [],
    destinations: [],
    brokerAccounts: [],
    terminals: [],
    storageMode: 'backend',
    workspace: { originId: 'creation-fixture' },
    createPortfolio: fixture.createPortfolio,
    createSession: fixture.createSession,
    reload: fixture.reload,
  }),
}))
const history: DatasetVersion = {
  id: 'saved-one',
  datasetId: 'dataset-one',
  name: 'Owned EURUSD history',
  checksum: 'pinned-checksum',
  sourceHash: 'source-checksum',
  rowCount: 10,
  metadata: {
    provider: 'local-csv',
    symbol: 'EURUSD',
    exchange: 'LOCAL',
    interval: '1m',
    currency: 'GBP',
    priceBasis: 'raw',
    adjustment: 'none',
    volumeMeaning: 'ticks',
    allowNegativePrices: false,
    calendar: { id: 'continuous', timezone: 'UTC', sessions: [], exceptions: {} },
  },
  start: 1793610000,
  end: 1793610600,
  sizeBytes: 1000,
  quality: {},
  coverage: {},
  dependencies: [],
  createdAt: '2026-11-03T09:00:00Z',
}
function mount() {
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Routes>
        <Route path="/workspace" element={<TraderWorkspace />} />
        <Route path="/workspace/profiles/7/replay" element={<h1>Created replay project</h1>} />
        <Route
          path="/workspace/profiles/7/connections"
          element={<h1>Created live connections</h1>}
        />
        <Route path="/trading" element={<h1>Created live chart</h1>} />
        <Route
          path="/historify"
          element={<Link to="/workspace?create=replay">Return to profile setup</Link>}
        />
      </Routes>
    </MemoryRouter>
  )
  return userEvent.setup()
}
async function details(user: ReturnType<typeof userEvent.setup>, replay = true) {
  await user.click(screen.getByRole('button', { name: 'New profile' }))
  if (replay) await user.click(screen.getByRole('button', { name: /Replay project/ }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.type(
    screen.getByLabelText('Profile name'),
    replay ? 'My saved history project' : 'My live journal'
  )
}
async function chooseHistory(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByLabelText('Saved history version')).not.toBeDisabled())
  await user.selectOptions(screen.getByLabelText('Saved history version'), 'saved-one')
  await user.click(await screen.findByRole('checkbox', { name: /I reviewed this history/ }))
}
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  useAuthStore.setState({ user: null, isLocalAuthenticated: true, localPrincipalId: 'owner-one' })
  fixture.createPortfolio.mockResolvedValue(7)
  fixture.reload.mockResolvedValue(undefined)
  fixture.catalog.mockResolvedValue({
    principalId: 'owner-one',
    versions: [history],
    revision: 1,
    jobs: [],
    capabilities: {},
  })
  fixture.version.mockResolvedValue(history)
  fixture.providers.mockResolvedValue({
    providers: [
      {
        id: 'mt5',
        name: 'MetaTrader 5 · selected running terminal',
        category: 'desktop',
        available: true,
        setupState: 'available',
        connectionMode: 'account',
      },
    ],
  })
  fixture.connectorAction.mockResolvedValue({ revision: 1, connections: [] })
  fixture.liveCandles.mockResolvedValue({
    count: 1,
    candles: [
      {
        source: 'mt5',
        symbol: 'EURUSD',
        interval: '15m',
        openTimeMs: 1793836800000,
        open: '1.12310',
        high: '1.12400',
        low: '1.12290',
        close: '1.12350',
        volume: '321',
      },
    ],
  })
})
afterEach(cleanup)
describe('original Workspace profile creation', () => {
  it.each([
    'D',
    '1w',
  ])('preserves the source’s case-sensitive symbol and exact %s interval', async (interval) => {
    const native = { ...history, metadata: { ...history.metadata, symbol: 'EURUSDm', interval } }
    fixture.catalog.mockResolvedValue({ principalId: 'owner-one', versions: [native], revision: 1 })
    fixture.version.mockResolvedValue(native)
    const user = mount()
    await details(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await chooseHistory(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Create profile' }))
    await screen.findByRole('heading', { name: 'Created replay project' })
    expect(fixture.createPortfolio).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultSymbol: 'EURUSDm',
        defaultTimeframe: interval,
      })
    )
  })
  it.each([
    'success',
    'failure',
  ])('ignores a former owner’s late profile save %s without closing the current setup', async (outcome) => {
    let finish!: () => void
    fixture.createPortfolio.mockImplementationOnce(
      () =>
        new Promise<number>((resolve, reject) => {
          finish = () =>
            outcome === 'success' ? resolve(7) : reject(new Error('Former owner save failed'))
        })
    )
    const user = mount()
    await details(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await chooseHistory(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Create profile' }))
    expect(screen.getByRole('button', { name: 'New profile', hidden: true })).toBeDisabled()
    await act(async () => useAuthStore.setState({ localPrincipalId: 'owner-two' }))
    await user.click(screen.getByRole('button', { name: 'New profile' }))
    await user.click(screen.getByRole('button', { name: /Live trading/ }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Profile name'), 'Second owner setup')
    await act(async () => finish())
    expect(screen.getByLabelText('Profile name')).toHaveValue('Second owner setup')
    expect(
      screen.queryByRole('heading', { name: 'Created replay project' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Former owner save failed/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Journal only' }))
    await user.click(screen.getByRole('button', { name: 'Decide later' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('button', { name: 'Create profile' })).not.toBeDisabled()
  })
  it('has one creation entry and supports multiple optional session tags without changing timezone', async () => {
    const user = mount()
    expect(screen.queryByRole('button', { name: 'Add live profile' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add replay project' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'New profile' })).toHaveLength(1)
    await details(user)
    await user.selectOptions(screen.getByLabelText('Profile timezone'), 'Asia/Tokyo')
    await user.click(screen.getByRole('button', { name: 'London', exact: true }))
    await user.click(screen.getByRole('button', { name: 'New York', exact: true }))
    expect(screen.getByLabelText('Session tags (optional)')).toHaveValue('London, New York')
    expect(screen.getByLabelText('Profile timezone')).toHaveValue('Asia/Tokyo')
    expect(screen.getByLabelText('Strategies (optional)')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.queryByRole('button', { name: 'Create profile' })).not.toBeInTheDocument()
    await chooseHistory(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Create profile' }))
    await screen.findByRole('heading', { name: 'Created replay project' })
    expect(fixture.createPortfolio).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'replay',
        sessionTags: ['London', 'New York'],
        timezone: 'Asia/Tokyo',
        strategyTags: [],
        currency: 'GBP',
        defaultSymbol: 'EURUSD',
        defaultTimeframe: '1m',
        chartSource: { kind: 'dataset', versionId: 'saved-one', checksum: 'pinned-checksum' },
      })
    )
    expect(fixture.createSession).not.toHaveBeenCalled()
  })
  it('requires actual owned history and explicit review, rather than creating an unbound first run', async () => {
    fixture.catalog.mockResolvedValue({ principalId: 'owner-one', versions: [], revision: 1 })
    const user = mount()
    await details(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/No saved history is available/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeDisabled()
    expect(screen.queryByLabelText('First run name')).not.toBeInTheDocument()
    expect(fixture.createPortfolio).not.toHaveBeenCalled()
  })
  it('retains the owner-scoped setup across importing history and returning', async () => {
    const user = mount()
    await details(user)
    await user.type(screen.getByLabelText('Session tags (optional)'), 'London, New York')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('link', { name: 'Import or manage history' }))
    await user.click(screen.getByRole('link', { name: 'Return to profile setup' }))
    await chooseHistory(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('My saved history project', { selector: 'dd' })).toBeVisible()
    expect(screen.getByText('London, New York', { selector: 'dd' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Create profile' }))
    await screen.findByRole('heading', { name: 'Created replay project' })
    expect(sessionStorage.getItem('chartly:profile-setup:owner-one:creation-fixture')).toBeNull()
  })
  it('rejects an unavailable/private version and cannot reuse another principal catalog', async () => {
    fixture.catalog.mockResolvedValue({
      principalId: 'another-owner',
      versions: [history],
      revision: 1,
    })
    const user = mount()
    await details(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeDisabled()
    expect(fixture.version).not.toHaveBeenCalled()
  })
  it('validates positive explicit cash and blocks another write after an uncertain profile save', async () => {
    fixture.createPortfolio.mockRejectedValue(new Error('The local engine is unavailable.'))
    const user = mount()
    await details(user)
    await user.clear(screen.getByLabelText('Default paper starting cash'))
    await user.type(screen.getByLabelText('Default paper starting cash'), '0')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await chooseHistory(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.clear(screen.getByLabelText('Default paper starting cash'))
    await user.type(screen.getByLabelText('Default paper starting cash'), '12500.25')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Create profile' }))
    expect(await screen.findByText(/The save may already have completed/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create profile' })).toBeDisabled()
    expect(fixture.createPortfolio).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Reload Workspace' }))
    expect(fixture.reload).toHaveBeenCalledOnce()
    expect(fixture.createPortfolio).toHaveBeenCalledTimes(1)
  })
  it('creates a live profile around a tested MT5 chart feed without session/strategy tags', async () => {
    const user = mount()
    await details(user, false)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('1. Live chart feed')).toBeVisible()
    expect(screen.getByLabelText('Platform feed')).toHaveValue('mt5')
    expect(screen.getByLabelText('Venue symbol')).toHaveValue('EURUSD')
    expect(screen.queryByText('First setup step')).not.toBeInTheDocument()
    expect(screen.queryByText('Review simulator setup')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Journal only' }))
    await user.click(screen.getByRole('button', { name: 'Test live feed' }))
    expect(await screen.findByText(/Feed OK: 1 recent candles received/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(/Live chart feed/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Create profile' }))
    await screen.findByRole('heading', { name: 'Created live chart' })
    expect(fixture.liveCandles).toHaveBeenCalled()
    expect(fixture.createPortfolio).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'live',
        startingBalance: 0,
        sessionTags: [],
        strategyTags: [],
        defaultSymbol: 'EURUSD',
        defaultTimeframe: '15m',
        chartSource: {
          kind: 'live-feed',
          providerId: 'mt5',
          providerName: 'MetaTrader 5 (this PC)',
          symbol: 'EURUSD',
          exchange: 'MT5',
          interval: '15m',
        },
        liveSetup: expect.objectContaining({
          account: { mode: 'journal-only' },
          chartData: expect.objectContaining({
            mode: 'live-feed',
            providerId: 'mt5',
            symbol: 'EURUSD',
            interval: '15m',
          }),
          replayHistory: { mode: 'later' },
        }),
      })
    )
    expect(fixture.createSession).not.toHaveBeenCalled()
    expect(fixture.connectorAction).not.toHaveBeenCalled()
  })

  it('opens Connections for an MT5 chart profile so the operator can choose its installation', async () => {
    const user = mount()
    await details(user, false)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByLabelText('Trading platform')).toHaveValue('mt5')
    expect(screen.queryByRole('button', { name: 'Test live feed' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Verify MT5 in Connections')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Create profile' }))
    await screen.findByRole('heading', { name: 'Created live connections' })
    expect(fixture.connectorAction).not.toHaveBeenCalled()
    expect(fixture.liveCandles).not.toHaveBeenCalled()
  })

  it('tests the exact feed instrument and rejects mismatched candles before saving a profile', async () => {
    const user = mount()
    await details(user, false)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.selectOptions(screen.getByLabelText('Platform feed'), 'hyperliquid')
    await user.clear(screen.getByLabelText('Venue symbol'))
    await user.type(screen.getByLabelText('Venue symbol'), 'kBONK')
    await user.click(screen.getByRole('button', { name: 'Test live feed' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/another instrument or interval/)
    expect(fixture.liveCandles).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'hyperliquid', symbol: 'kBONK', interval: '15m' }),
      'owner-one',
      expect.any(AbortSignal)
    )
    expect(fixture.createPortfolio).not.toHaveBeenCalled()
  })

  it('offers a retry when the account directory is unavailable', async () => {
    fixture.providers.mockRejectedValueOnce(new Error('offline'))
    const user = mount()
    await details(user, false)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText(/Account platforms are unavailable/)).toBeVisible()
    expect(screen.queryByLabelText('Trading platform')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect later' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Retry account platforms' }))

    expect(await screen.findByLabelText('Trading platform')).toHaveValue('mt5')
    expect(fixture.providers).toHaveBeenCalledTimes(2)
    expect(fixture.connectorAction).not.toHaveBeenCalled()
  })
})
