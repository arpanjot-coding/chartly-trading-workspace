import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import DataLibrary from './DataLibrary'
import { datasetCatalog, datasetVersion } from './testFixtures'

const api = vi.hoisted(() => ({
  catalog: vi.fn(),
  version: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  controlDownload: vi.fn(),
  stepDownload: vi.fn(),
  export: vi.fn(),
}))
vi.mock('@/api/dataLibrary', async (original) => ({
  ...(await original<typeof import('@/api/dataLibrary')>()),
  dataLibrary: api,
}))
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => <nav>Original navigation</nav> }))
vi.mock('@/components/layout/SettingsNavigation', () => ({
  SettingsBackLink: () => null,
  ConnectionsDataNavigation: () => null,
}))
vi.mock('@/lib/trader/useTraderData', () => ({
  useTraderData: () => ({ portfolios: [{ id: 7, name: 'Replay environment', kind: 'replay' }] }),
}))
function show(path = '/historify') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <DataLibrary />
      </MemoryRouter>
    </QueryClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({
    localPrincipalId: 'principal-one',
    isLocalAuthenticated: true,
    isAuthenticated: false,
  })
})
describe('private Data Library catalog and workflow', () => {
  it('labels quarantined time and preserves backup while disabling chart, CSV and practice use', async () => {
    const quarantine = {
      reason: 'dataset.time_unverified',
      timeBasis: 'tick-derived-unverified',
      message: 'Keep the dataset backup and reimport history with verified UTC timestamps.',
    } as const
    api.catalog.mockResolvedValue(datasetCatalog([datasetVersion({ quarantine })]))
    show('/historify?version=version-one&returnTo=%2Fworkspace%2Fprofiles%2F7%2Freplay')
    expect(await screen.findByText(quarantine.message)).toBeVisible()
    expect(screen.getAllByText('Time verification required')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Open chart' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Open chart' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export candles CSV' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Prepare practice draft' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Prepare practice draft' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download dataset backup' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Archive version' })).toBeEnabled()
    expect(screen.getByText('Stored coverage starts · time unverified')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Export candles CSV' }))
    expect(api.export).not.toHaveBeenCalled()
  })
  it.each([
    '/settings/connections?profileId=7',
    '/workspace/profiles/7/connections',
  ])('opens public history with a correctly named return to %s', async (returnTo) => {
    api.catalog.mockResolvedValue(datasetCatalog())
    show(`/historify?source=kraken&returnTo=${encodeURIComponent(returnTo)}`)
    expect(await screen.findByText('Get public market history')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Return to connections' })).toHaveAttribute(
      'href',
      returnTo
    )
    expect(screen.getByText(/no exchange account or API key/)).toBeVisible()
  })
  it('keeps same-symbol source versions separate and preserves exact version chart/practice handoffs', async () => {
    const first = datasetVersion({
      importReport: {
        counts: { accepted: 3, rejected: 1, changed: 0 },
        quality: { summary: '3 accepted source candles and one rejected row.' },
        sourceHash: 'source-checksum',
        policy: 'new-version',
      },
    })
    const second = datasetVersion({
      id: 'version-two',
      name: 'EURUSD other source',
      metadata: { ...first.metadata, provider: 'other-csv' },
    })
    api.catalog.mockResolvedValue(datasetCatalog([first, second]))
    show('/historify?returnTo=%2Fworkspace%2Fprofiles%2F7%2Freplay')
    expect(await screen.findByText('2 versions shown')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open version' })[0])
    expect(screen.getByText(/original source contained 1 rejected row/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open chart' }).getAttribute('href')).toContain(
      'datasetVersionId=version-one'
    )
    expect(
      screen.getByRole('link', { name: 'Prepare practice draft' }).getAttribute('href')
    ).toContain('/workspace/profiles/7/replay?datasetVersionId=version-one')
    expect(screen.getByText('other-csv', { exact: false })).toBeInTheDocument()
  })
  it('archives without deleting saved bytes and can restore the same version', async () => {
    const version = datasetVersion()
    api.catalog.mockResolvedValue(datasetCatalog([version]))
    const archived = { ...version, archivedAt: '2026-11-03T10:00:00Z' }
    api.archive.mockResolvedValue({
      version: archived,
      catalog: { ...datasetCatalog([archived]), revision: 2 },
    })
    api.restore.mockResolvedValue({
      version,
      catalog: { ...datasetCatalog([version]), revision: 3 },
    })
    show('/historify?version=version-one')
    fireEvent.click(await screen.findByRole('button', { name: 'Archive version' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore to catalog' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Archive version' })).toBeEnabled()
    )
    expect(api.archive).toHaveBeenCalledWith('version-one', 1, expect.any(String))
    expect(api.restore).toHaveBeenCalledWith('version-one', 2, expect.any(String))
  })
  it('requires a replay profile when the return context belongs to another environment', async () => {
    api.catalog.mockResolvedValue(datasetCatalog([datasetVersion()]))
    show('/historify?version=version-one&returnTo=%2Fworkspace%2Fprofiles%2F9')
    const picker = await screen.findByLabelText('Replay profile')
    expect(screen.queryByRole('link', { name: 'Prepare practice draft' })).not.toBeInTheDocument()
    fireEvent.change(picker, { target: { value: '7' } })
    expect(
      screen.getByRole('link', { name: 'Prepare practice draft' }).getAttribute('href')
    ).toContain('/workspace/profiles/7/replay?datasetVersionId=version-one')
  })
  it('fences paged catalogs when the revision changes instead of mixing result sets', async () => {
    const first = { ...datasetCatalog([datasetVersion()]), nextOffset: 100 }
    api.catalog.mockResolvedValueOnce(first).mockResolvedValueOnce({
      ...datasetCatalog([datasetVersion({ id: 'version-two', name: 'Concurrent version' })]),
      revision: 2,
    })
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Load more versions' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('catalog changed while paging')
    expect(screen.queryByText('Concurrent version')).not.toBeInTheDocument()
    expect(api.catalog.mock.calls[1]).toEqual([undefined, 100])
  })
  it('does not confuse import jobs with download jobs when nullable cursor fields are present', async () => {
    api.catalog.mockResolvedValue({
      ...datasetCatalog(),
      jobs: [
        { id: 'import-1', kind: 'history-import', status: 'staged', cursor: null },
        {
          id: 'download-1',
          kind: 'download',
          status: 'queued',
          cursor: 0,
          context: { symbol: 'BTCUSD' },
        },
      ],
    })
    show()
    expect(await screen.findByRole('button', { name: 'Resume import review' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Downloads', exact: true }))
    expect(screen.getByText('BTCUSD')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Process next chunk' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Create history download' })
    ).not.toBeInTheDocument()
  })
  it('never caches a library returned for another verified principal', async () => {
    api.catalog.mockResolvedValue({
      ...datasetCatalog([datasetVersion({ name: 'Another owner private data' })]),
      principalId: 'principal-other',
    })
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent('local account changed')
    expect(screen.queryByText('Another owner private data')).not.toBeInTheDocument()
  })
})
