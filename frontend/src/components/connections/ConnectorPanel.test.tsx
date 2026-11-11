import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ConnectorConnection,
  type ConnectorProvider,
  connectorClient,
} from '@/lib/trader/connectorClient'
import { LocalStorageError } from '@/lib/trader/localStorageClient'
import { useAuthStore } from '@/stores/authStore'
import { ConnectorPanel } from './ConnectorPanel'

vi.mock('@/lib/trader/connectorClient', () => ({
  connectorClient: { list: vi.fn(), providers: vi.fn(), action: vi.fn(), history: vi.fn() },
}))
const reload = vi.hoisted(() => vi.fn())
vi.mock('@/lib/trader/useTraderData', () => ({
  useTraderData: () => ({
    storageMode: 'backend',
    workspace: { originId: 'connector-fixture' },
    reload,
    portfolios: [{ id: 7, kind: 'live', name: 'My journal' }],
    brokerAccounts: [],
  }),
}))
const provider: ConnectorProvider = {
  id: 'fake',
  name: 'Simulated connection check',
  version: '1',
  kind: 'local',
  category: 'diagnostic',
  connectionMode: 'diagnostic',
  setupState: 'available',
  synthetic: true,
  available: true,
  environments: ['broker_demo'],
  capabilities: [],
}
let current: ConnectorConnection
const fresh = (): ConnectorConnection => ({
  id: 'connection-one',
  providerId: 'fake',
  profileId: 7,
  label: 'Practice source',
  revision: 1,
  state: 'unverified',
  health: 'unknown',
})
const withCorrections = (): ConnectorConnection => ({
  ...fresh(),
  state: 'linked',
  health: 'healthy',
  active: true,
  bookId: 'connected-book',
  accountId: 4,
  identity: {
    externalIdMasked: '••1234',
    server: 'Synthetic',
    environment: 'broker_demo',
    currency: 'GBP',
    synthetic: true,
  },
  capabilities: [{ id: 'accountRead', label: 'Account identity', supported: true }],
  history: {
    observations: 3,
    confirmed: 1,
    conflicts: 0,
    coverage: [],
    summary: {
      pendingCorrections: 1,
      corrections: [
        {
          id: 'correction-one',
          summary: 'Updated confirmed trade facts',
          changedFields: [{ field: 'netPnl', before: '10', after: '8' }],
        },
      ],
    },
  },
})
beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ isLocalAuthenticated: true, localPrincipalId: 'owner-one', user: null })
  current = fresh()
  vi.mocked(connectorClient.providers).mockResolvedValue({ providers: [provider] })
  vi.mocked(connectorClient.list).mockResolvedValue({ connections: [] })
  vi.mocked(connectorClient.action).mockImplementation(async (request) => {
    if (request.action === 'probe')
      current = {
        ...current,
        revision: current.revision + 1,
        state: 'ready',
        health: 'healthy',
        observedAt: '2026-11-03T09:00:00Z',
        identity: {
          externalIdMasked: '••1234',
          displayName: 'Diagnostic account',
          server: 'Synthetic',
          environment: 'broker_demo',
          currency: 'GBP',
          synthetic: true,
        },
        capabilities: [
          { id: 'accountRead', label: 'Account identity', state: 'verified', supported: true },
          {
            id: 'orderSubmit',
            label: 'Place orders',
            supported: false,
            reason: 'Read-only connection',
          },
        ],
      }
    if (request.action === 'link')
      current = {
        ...current,
        revision: current.revision + 1,
        state: 'linked',
        active: true,
        accountId: 4,
        bookId: 'connected-book',
      }
    if (request.action === 'apply-corrections')
      current = {
        ...current,
        revision: current.revision + 1,
        history: {
          observations: 3,
          confirmed: 1,
          conflicts: 0,
          coverage: [],
          summary: { pendingCorrections: 0 },
        },
      }
    return { connection: current }
  })
})
afterEach(cleanup)
function mount() {
  render(
    <MemoryRouter>
      <ConnectorPanel profileId={7} />
    </MemoryRouter>
  )
  return userEvent.setup()
}
describe('read-only connection setup in existing UI', () => {
  it('shows server-owned provider categories before workspace activation and sends public data to History without creating an account connection', async () => {
    useAuthStore.setState({
      isLocalAuthenticated: false,
      localPrincipalId: null,
      user: null,
      isAuthenticated: false,
    })
    vi.mocked(connectorClient.providers).mockResolvedValue({
      providers: [
        {
          ...provider,
          id: 'kraken-public',
          name: 'Kraken public data',
          synthetic: false,
          category: 'crypto',
          connectionMode: 'public-data',
          actionHref: '/historify?source=kraken',
        },
      ],
    })
    const user = mount()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Crypto exchanges' })).not.toBeDisabled()
    )
    await user.click(screen.getByRole('button', { name: 'Crypto exchanges' }))
    await waitFor(() => expect(screen.getByLabelText('Connection provider')).not.toBeDisabled())
    await user.selectOptions(screen.getByLabelText('Connection provider'), 'kraken-public')
    const history = screen.getByRole('link', { name: 'Open History & data' })
    const target = new URL(history.getAttribute('href')!, 'http://localhost')
    expect(target.pathname).toBe('/historify')
    expect(target.searchParams.get('source')).toBe('kraken')
    expect(target.searchParams.get('returnTo')).toBe('/workspace/profiles/7/connections')
    expect(screen.queryByLabelText('Connection name')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect source' })).not.toBeInTheDocument()
    expect(screen.getByText(/Download closed market candles into saved history/)).toBeVisible()
    expect(
      screen.queryByText(/Verify the account to see its supported read-only access/)
    ).not.toBeInTheDocument()
    expect(connectorClient.list).not.toHaveBeenCalled()
    expect(connectorClient.action).not.toHaveBeenCalled()
  })
  it('shows planned providers and prerequisites without offering a working connection', async () => {
    vi.mocked(connectorClient.providers).mockResolvedValue({
      providers: [
        {
          ...provider,
          id: 'future-broker',
          name: 'Future broker',
          category: 'brokerage',
          connectionMode: 'account',
          available: false,
          setupState: 'planned',
          synthetic: false,
          reason: 'Account integration is planned; provider approval is required.',
        },
      ],
    })
    const user = mount()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Brokerages' })).not.toBeDisabled()
    )
    await user.click(screen.getByRole('button', { name: 'Brokerages' }))
    await user.selectOptions(screen.getByLabelText('Connection provider'), 'future-broker')
    expect(
      screen.getAllByText('Account integration is planned; provider approval is required.')[0]
    ).toBeVisible()
    await user.type(screen.getByLabelText('Connection name'), 'My account')
    expect(screen.getByRole('button', { name: 'Connect source' })).toBeDisabled()
    expect(connectorClient.action).not.toHaveBeenCalled()
  })
  it('does not offer account journal linking or account history for an existing public-data observation', async () => {
    current = { ...withCorrections(), providerId: 'public-only' }
    vi.mocked(connectorClient.providers).mockResolvedValue({
      providers: [
        {
          ...provider,
          id: 'public-only',
          category: 'crypto',
          connectionMode: 'public-data',
          synthetic: false,
        },
      ],
    })
    vi.mocked(connectorClient.list).mockResolvedValue({ connections: [current] })
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Practice source/ }))
    expect(screen.getByRole('button', { name: 'Check source' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Open connected journal' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Connection history review' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open History & data' })).toBeVisible()
  })
  it('explains unverified provider timing for unavailable market-data capabilities without showing internal error codes', async () => {
    current = {
      ...withCorrections(),
      health: 'degraded',
      capabilities: [
        {
          id: 'marketHistory',
          label: 'Saved market history',
          supported: false,
          reason: 'connector.provider_clock_unverified',
        },
        {
          id: 'marketLive',
          label: 'Current market data',
          supported: false,
          reason: 'connector.provider_clock_unverified',
        },
      ],
    }
    vi.mocked(connectorClient.list).mockResolvedValue({ connections: [current] })
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Practice source/ }))
    expect(screen.getByText('Saved market history').parentElement).toHaveTextContent('Unavailable')
    expect(screen.getByText('Current market data').parentElement).toHaveTextContent('Unavailable')
    expect(screen.getAllByText(/Terminal history timing has not been verified/)).toHaveLength(2)
    expect(screen.queryByText('connector.provider_clock_unverified')).not.toBeInTheDocument()
  })
  it('separates declared setup, observed identity and explicit account/book linkage', async () => {
    const user = mount()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Desktop platforms' })).not.toBeDisabled()
    )
    await user.click(screen.getByText('Diagnostics', { selector: 'summary' }))
    await user.click(screen.getByRole('button', { name: 'Use simulated connection check' }))
    await user.selectOptions(screen.getByLabelText('Connection provider'), 'fake')
    await user.type(screen.getByLabelText('Connection name'), 'Practice source')
    await user.click(screen.getByRole('button', { name: 'Connect source' }))
    expect(await screen.findByText(/Account identity has not been observed/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Link verified account' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Verify account' }))
    expect(await screen.findByText(/Diagnostic account/)).toHaveTextContent('••1234')
    expect(screen.getByText('Place orders').parentElement).toHaveTextContent('Unavailable')
    expect(screen.getByRole('button', { name: 'Link verified account' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /I reviewed the observed account/ }))
    await user.click(screen.getByRole('button', { name: 'Link verified account' }))
    expect(await screen.findByRole('link', { name: 'Open connected journal' })).toHaveAttribute(
      'href',
      '/workspace/profiles/7/journal?book=connected-book&tab=Trades'
    )
    expect(connectorClient.action).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'link',
        expectedRevision: 2,
        payload: { profileId: 7, confirmIdentity: true, createObservedAccount: true },
      }),
      expect.any(AbortSignal),
      'owner-one'
    )
  })
  it('saves the chosen MT5 installation on the new connection', async () => {
    vi.mocked(connectorClient.providers).mockResolvedValue({
      providers: [
        {
          ...provider,
          id: 'mt5',
          name: 'MetaTrader 5',
          category: 'desktop',
          connectionMode: 'account',
          synthetic: false,
        },
      ],
    })
    const user = mount()
    const desktop = screen.getByRole('button', { name: 'Desktop platforms' })
    await waitFor(() => expect(desktop).toBeEnabled())
    await user.click(desktop)
    await user.selectOptions(screen.getByLabelText('Connection provider'), 'mt5')
    await user.type(screen.getByLabelText('Connection name'), 'Second desk')
    const terminalPath = 'C:/Program Files/Broker B/terminal64.exe'
    await user.type(screen.getByLabelText('MT5 installation path (optional)'), terminalPath)
    await user.click(screen.getByRole('button', { name: 'Connect source' }))
    expect(connectorClient.action).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        payload: {
          providerId: 'mt5',
          label: 'Second desk',
          configuration: { terminalPath },
          profileId: 7,
        },
      }),
      expect.any(AbortSignal),
      'owner-one'
    )
  })

  it('requires concrete correction review and posts the saved revision without a new history fetch', async () => {
    current = {
      ...fresh(),
      state: 'linked',
      health: 'healthy',
      active: true,
      bookId: 'connected-book',
      accountId: 4,
      identity: {
        externalIdMasked: '••1234',
        server: 'Synthetic',
        environment: 'broker_demo',
        currency: 'GBP',
        synthetic: true,
      },
      capabilities: [{ id: 'accountRead', label: 'Account identity', supported: true }],
      history: {
        observations: 3,
        confirmed: 1,
        conflicts: 0,
        coverage: [],
        summary: {
          pendingCorrections: 1,
          corrections: [
            {
              id: 'correction-one',
              summary: 'Updated confirmed trade facts',
              changedFields: [{ field: 'netPnl', before: '10', after: '8' }],
            },
          ],
        },
      },
    }
    vi.mocked(connectorClient.list).mockResolvedValue({ connections: [current] })
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Practice source/ }))
    await user.click(screen.getByRole('button', { name: 'Review source corrections' }))
    expect(screen.getByText('10 → 8')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Apply reviewed corrections' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /I reviewed these exact saved changes/ }))
    await user.click(screen.getByRole('button', { name: 'Apply reviewed corrections' }))
    await waitFor(() =>
      expect(connectorClient.action).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'apply-corrections', expectedRevision: 1, payload: {} }),
        expect.any(AbortSignal),
        'owner-one'
      )
    )
    expect(connectorClient.history).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('The saved connection was updated.')).toBeVisible()
  })
  it.each([
    'verification-expired',
    'interrupted',
  ] as const)('closes correction review after %s so the recovery action is visible and requires a fresh review', async (failure) => {
    current = withCorrections()
    vi.mocked(connectorClient.list).mockResolvedValue({ connections: [current] })
    vi.mocked(connectorClient.action).mockRejectedValueOnce(
      failure === 'verification-expired'
        ? new LocalStorageError(
            'connector.verify_and_link_required',
            'Verify and link this account again before applying corrections.',
            403
          )
        : new Error('The response was interrupted. Retry the reviewed request.')
    )
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Practice source/ }))
    await user.click(screen.getByRole('button', { name: 'Review source corrections' }))
    await user.click(screen.getByRole('checkbox', { name: /I reviewed these exact saved changes/ }))
    await user.click(screen.getByRole('button', { name: 'Apply reviewed corrections' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(
      failure === 'verification-expired' ? 'Verify and link' : 'interrupted'
    )
    expect(current.history?.summary?.pendingCorrections).toBe(1)
    expect(connectorClient.action).toHaveBeenCalledOnce()
    expect(connectorClient.history).not.toHaveBeenCalled()
    if (failure === 'verification-expired') {
      await user.click(screen.getByRole('button', { name: 'Reload and review rejected request' }))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Review source corrections' })).toBeEnabled()
      )
      await user.click(screen.getByRole('button', { name: 'Review source corrections' }))
      expect(
        screen.getByRole('checkbox', { name: /I reviewed these exact saved changes/ })
      ).not.toBeChecked()
      expect(screen.getByRole('button', { name: 'Apply reviewed corrections' })).toBeDisabled()
    } else {
      expect(screen.getByRole('button', { name: 'Retry same request' })).toBeEnabled()
    }
  })
  it('uses measured stale status to block history and linking until reverified', async () => {
    current = {
      ...fresh(),
      health: 'stale',
      state: 'ready',
      identity: {
        externalIdMasked: '••1234',
        server: 'Synthetic',
        environment: 'broker_demo',
        currency: 'GBP',
        synthetic: true,
      },
    }
    vi.mocked(connectorClient.list).mockResolvedValue({ connections: [current] })
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Practice source/ }))
    await user.click(screen.getByRole('checkbox', { name: /I reviewed the observed account/ }))
    expect(screen.getByRole('button', { name: 'Link verified account' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Read history window' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Verify account' })).toBeEnabled()
  })
  it('reconnects an explicitly reviewed existing book without creating another account', async () => {
    current = {
      ...fresh(),
      health: 'degraded',
      state: 'ready',
      active: false,
      bookId: 'connected-book',
      accountId: 4,
      identity: {
        externalIdMasked: '••1234',
        server: 'Synthetic',
        environment: 'broker_demo',
        currency: 'GBP',
        synthetic: true,
      },
      capabilities: [{ id: 'accountRead', label: 'Account identity', supported: true }],
    }
    vi.mocked(connectorClient.list).mockResolvedValue({ connections: [current] })
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Practice source/ }))
    expect(screen.getByRole('button', { name: 'Read history window' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reconnect verified account' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /I reviewed the same observed account/ }))
    await user.click(screen.getByRole('button', { name: 'Reconnect verified account' }))
    await waitFor(() =>
      expect(connectorClient.action).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'link',
          payload: { profileId: 7, accountId: 4, confirmIdentity: true },
        }),
        expect.any(AbortSignal),
        'owner-one'
      )
    )
    expect(
      screen.queryByRole('button', { name: 'Reconnect verified account' })
    ).not.toBeInTheDocument()
  })
  it('reviews the exact saved checkpoint overlap before reading, without rounding it to date boundaries', async () => {
    const window = { from: '2026-11-02T10:55:00.123456Z', to: '2026-11-02T12:00:00.123456Z' }
    current = {
      ...fresh(),
      health: 'degraded',
      state: 'linked',
      active: true,
      bookId: 'connected-book',
      accountId: 4,
      identity: {
        externalIdMasked: '••1234',
        server: 'Synthetic',
        environment: 'broker_demo',
        currency: 'GBP',
        synthetic: true,
      },
      capabilities: [
        { id: 'accountRead', label: 'Account identity', supported: true },
        { id: 'accountHistory', label: 'Raw account history', supported: true },
      ],
      history: {
        observations: 2,
        confirmed: 0,
        conflicts: 0,
        coverage: [],
        suggestedWindow: window,
        overlapSeconds: 300,
      },
    }
    vi.mocked(connectorClient.list).mockResolvedValue({ connections: [current] })
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Practice source/ }))
    await user.click(screen.getByRole('button', { name: 'Use saved history checkpoint' }))
    expect(connectorClient.action).not.toHaveBeenCalled()
    expect(screen.getByText(/Reviewed checkpoint window/)).toHaveTextContent(window.from)
    await user.click(screen.getByRole('button', { name: 'Read history window' }))
    await waitFor(() =>
      expect(connectorClient.action).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sync', expectedRevision: 1, payload: { window } }),
        expect.any(AbortSignal),
        'owner-one'
      )
    )
  })
  it('stops after a committed page and resumes the saved window after reopening', async () => {
    const window = { from: '2026-11-02T10:55:00.123456Z', to: '2026-11-03T12:00:00.123456Z' }
    const linked = withCorrections()
    current = {
      ...linked,
      capabilities: [
        ...linked.capabilities!,
        { id: 'accountHistory', label: 'History', supported: true },
      ],
      history: {
        observations: 0,
        confirmed: 0,
        conflicts: 0,
        coverage: [],
        suggestedWindow: window,
      },
    }
    vi.mocked(connectorClient.list).mockImplementation(async () => ({ connections: [current] }))
    let finish!: (value: { connection: ConnectorConnection }) => void
    vi.mocked(connectorClient.action).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Practice source/ }))
    await user.click(screen.getByRole('button', { name: 'Use saved history checkpoint' }))
    await user.click(screen.getByRole('button', { name: 'Read history window' }))
    await user.click(await screen.findByRole('button', { name: 'Stop after this page' }))
    current = {
      ...current,
      revision: 2,
      history: {
        ...current.history!,
        observations: 2,
        cursor: { nativeCursor: 'next-page', window },
      },
    }
    finish({ connection: current })
    expect(await screen.findByText(/Saved 1 history page.*continue/)).toBeVisible()
    expect(connectorClient.action).toHaveBeenCalledTimes(1)
    cleanup()
    vi.mocked(connectorClient.action).mockResolvedValueOnce({
      connection: {
        ...current,
        revision: 3,
        history: { ...current.history!, observations: 4, cursor: { nativeCursor: null, window } },
      },
    })
    const reopened = mount()
    await reopened.click(await screen.findByRole('button', { name: /Practice source/ }))
    await reopened.click(screen.getByRole('button', { name: 'Use saved history checkpoint' }))
    await reopened.click(screen.getByRole('button', { name: 'Read history window' }))
    expect(await screen.findByText(/Saved 1 history page for the requested window/)).toBeVisible()
    expect(connectorClient.action).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'sync', expectedRevision: 2, payload: { window } }),
      expect.any(AbortSignal),
      'owner-one'
    )
  })
  it('labels receipt-only timestamps as received observations while keeping verified event times unchanged', async () => {
    current = {
      ...fresh(),
      state: 'linked',
      health: 'degraded',
      active: true,
      bookId: 'connected-book',
      accountId: 4,
    }
    vi.mocked(connectorClient.list).mockResolvedValue({ connections: [current] })
    vi.mocked(connectorClient.history).mockResolvedValue({
      connection: current,
      history: {
        observations: 2,
        confirmed: 1,
        conflicts: 0,
        coverage: [],
        rows: [
          {
            id: 'raw-receipt',
            kind: 'deal',
            status: 'observed',
            occurredAt: '2026-11-03T09:00:00Z',
            timeBasis: 'receipt-only',
          },
          {
            id: 'verified-event',
            kind: 'deal',
            status: 'confirmed',
            occurredAt: '2026-11-03T08:00:00Z',
          },
        ],
      },
    })
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Practice source/ }))
    await user.click(screen.getByRole('button', { name: 'Review saved observations' }))
    expect(
      await screen.findByText(
        'deal · observed · Received 2026-11-03T09:00:00Z · provider event time unverified'
      )
    ).toBeVisible()
    expect(screen.getByText('deal · confirmed · 2026-11-03T08:00:00Z')).toBeVisible()
    expect(screen.queryByText('deal · observed · 2026-11-03T09:00:00Z')).not.toBeInTheDocument()
  })
  it('does not show history loaded against a different account revision', async () => {
    current = {
      ...fresh(),
      state: 'linked',
      health: 'healthy',
      active: true,
      bookId: 'connected-book',
      accountId: 4,
    }
    vi.mocked(connectorClient.list).mockResolvedValue({ connections: [current] })
    vi.mocked(connectorClient.history).mockResolvedValue({
      connection: { ...current, revision: 2 },
      history: { observations: 99, confirmed: 99, conflicts: 0, coverage: [] },
    })
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Practice source/ }))
    await user.click(screen.getByRole('button', { name: 'Review saved observations' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('connection changed')
    expect(connectorClient.history).toHaveBeenCalledWith(
      'connector-fixture',
      'connection-one',
      expect.any(AbortSignal),
      0,
      'owner-one'
    )
    expect(screen.queryByText(/99 observations/)).not.toBeInTheDocument()
  })
  it('saves a Kraken API credential without retaining it for retry', async () => {
    vi.mocked(connectorClient.providers).mockResolvedValue({
      providers: [
        provider,
        {
          ...provider,
          id: 'kraken',
          name: 'Kraken · spot account (read-only)',
          category: 'crypto',
          connectionMode: 'account',
          synthetic: false,
          environments: ['broker_live'],
        },
      ],
    })
    current = {
      ...fresh(),
      providerId: 'kraken',
      credential: { status: 'missing', generation: 0 },
    }
    vi.mocked(connectorClient.list).mockResolvedValue({ connections: [current] })
    vi.mocked(connectorClient.action).mockImplementation(async (request) => {
      if (request.action === 'set-secret')
        current = {
          ...current,
          revision: current.revision + 1,
          credential: { status: 'stored', generation: 1 },
        }
      return { connection: current }
    })
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Practice source/ }))
    expect(screen.getByText(/Query Funds, Query Open Orders/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Verify account' })).toBeDisabled()
    await user.type(screen.getByLabelText('API key'), 'fixture-key')
    await user.type(screen.getByLabelText('API secret'), 'fixture-secret-value')
    await user.click(screen.getByRole('button', { name: 'Save credential' }))
    await waitFor(() =>
      expect(screen.getByText(/Credential saved encrypted on this computer/)).toBeVisible()
    )
    expect(connectorClient.action).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'set-secret',
        payload: { secret: { apiKey: 'fixture-key', apiSecret: 'fixture-secret-value' } },
      }),
      expect.any(AbortSignal),
      'owner-one'
    )
    expect(screen.getByLabelText('API key')).toHaveValue('')
    expect(screen.getByLabelText('API secret')).toHaveValue('')
    expect(document.body.textContent).not.toContain('fixture-secret-value')
    expect(screen.getByText(/Replace the saved API credential/)).toBeVisible()
  })
  it('does not retain a rejected credential save as a retryable request', async () => {
    vi.mocked(connectorClient.providers).mockResolvedValue({
      providers: [
        provider,
        {
          ...provider,
          id: 'kraken',
          name: 'Kraken · spot account (read-only)',
          category: 'crypto',
          connectionMode: 'account',
          synthetic: false,
          environments: ['broker_live'],
        },
      ],
    })
    current = {
      ...fresh(),
      providerId: 'kraken',
      credential: { status: 'missing', generation: 0 },
    }
    vi.mocked(connectorClient.list).mockResolvedValue({ connections: [current] })
    vi.mocked(connectorClient.action).mockRejectedValue(
      new LocalStorageError('connector.invalid_secret', 'That credential could not be saved.', 400)
    )
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /Practice source/ }))
    await user.type(screen.getByLabelText('API key'), 'fixture-key')
    await user.type(screen.getByLabelText('API secret'), 'rejected-secret-value')
    await user.click(screen.getByRole('button', { name: 'Save credential' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be saved'))
    expect(screen.queryByText(/request is retained/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry same request' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('rejected-secret-value')
  })
})
