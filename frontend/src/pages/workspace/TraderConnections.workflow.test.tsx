import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDestination } from '@/lib/trader/profileModel'
import TraderConnections from './TraderConnections'

const fixture = vi.hoisted(() => ({ kind: 'live' }))
vi.mock('@/components/connections/ConnectorPanel', () => ({
  ConnectorPanel: ({ profileId }: { profileId?: number }) => (
    <section aria-label="Working connections">Working sources for {profileId}</section>
  ),
}))
vi.mock('@/lib/trader/useTraderData', () => ({
  useTraderData: () => ({
    loading: false,
    portfolios: [
      {
        id: 7,
        kind: fixture.kind,
        name: 'Personal',
        currency: 'GBP',
        startingBalance: 0,
        createdAt: '2026-11-03',
        updatedAt: '2026-11-03',
      },
    ],
    brokerAccounts: [
      {
        id: 4,
        displayName: 'Saved account',
        platform: 'mt5',
        enabled: true,
        externalLogin: 'saved-login',
        server: 'Saved server',
        currency: 'GBP',
        accountKind: 'demo',
        symbolSuffix: '',
        createdAt: '2026-11-03',
        updatedAt: '2026-11-03',
      },
    ],
    terminals: [
      {
        id: 8,
        label: 'Saved terminal',
        platform: 'mt5',
        assignedAccountId: 4,
        running: true,
        discoverySource: 'manual',
        createdAt: '2026-11-03',
        updatedAt: '2026-11-03',
      },
    ],
    destinations: [
      {
        ...defaultDestination({ portfolioId: 7, accountId: 4, terminalId: 8, now: '2026-11-03' }),
        id: 9,
        copyingEnabled: true,
      },
    ],
  }),
}))
function mount() {
  render(
    <MemoryRouter initialEntries={['/workspace/profiles/7/connections']}>
      <Routes>
        <Route path="/workspace/profiles/:profileId/connections" element={<TraderConnections />} />
      </Routes>
    </MemoryRouter>
  )
  return userEvent.setup()
}
beforeEach(() => {
  fixture.kind = 'live'
})
describe('profile connection workflow', () => {
  it('puts working sources first and retains legacy preferences in a collapsed advanced area', async () => {
    const user = mount()
    const working = screen.getByRole('region', { name: 'Working connections' })
    const summary = screen.getByText('Advanced saved settings', { selector: 'summary' })
    const details = summary.closest('details')!
    expect(details).not.toHaveAttribute('open')
    expect(working.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open connection hub' })).toHaveAttribute(
      'href',
      '/settings/connections?profileId=7'
    )
    expect(screen.queryByText(/Configuration wireframe/)).not.toBeInTheDocument()
    await user.click(summary)
    await waitFor(() => expect(details).toHaveAttribute('open'))
    expect(details).toHaveTextContent('Saved account')
    expect(details).toHaveTextContent('Saved terminal')
    expect(details).toHaveTextContent('Copy preference enabled')
    expect(screen.queryByText('Copy on', { exact: true })).not.toBeInTheDocument()
    expect(details).toHaveTextContent('do not connect a source, start copying or place orders')
  })
  it('keeps replay history separate from account connection setup', () => {
    fixture.kind = 'replay'
    mount()
    expect(screen.queryByRole('region', { name: 'Working connections' })).not.toBeInTheDocument()
    expect(screen.getByText('Connections belong to live profiles')).toBeVisible()
  })
})
