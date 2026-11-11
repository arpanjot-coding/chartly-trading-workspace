import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import type { DataFeed } from 'chartly-charts'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import DatasetVersionChart, { datasetSymbol } from './DatasetVersionChart'
import { datasetVersion } from './testFixtures'
const api = vi.hoisted(() => ({
  version: vi.fn(),
  bars: vi.fn(),
  loaded: vi.fn(),
  failed: vi.fn(),
  pane: vi.fn(),
}))
vi.mock('@/api/dataLibrary', async (original) => ({
  ...(await original<typeof import('@/api/dataLibrary')>()),
  dataLibrary: api,
}))
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }))
vi.mock('@/components/chart/ChartGrid', () => ({
  ChartGrid: ({ renderPane }: { renderPane: (id: string, index: number) => React.ReactNode }) =>
    renderPane('one', 0),
  ChartLayoutPicker: () => null,
}))
vi.mock('@/components/historify/HistorifyChartPane', async () => {
  const { useEffect } = await import('react')
  return {
    HistorifyChartPane: (props: { feed: DataFeed; defaultTimezone?: string }) => {
      const { feed } = props
      api.pane(props)
      useEffect(() => {
        let live = true
        const controller = new AbortController()
        void feed
          .getBars({
            symbol: 'EURUSD',
            exchange: 'LOCAL',
            interval: '1m',
            signal: controller.signal,
          })
          .then(() => {
            if (live) api.loaded()
          })
          .catch((error) => {
            if (live) api.failed(error)
          })
        return () => {
          live = false
          controller.abort()
        }
      }, [feed])
      return <div>Original chart pane</div>
    },
  }
})
beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ localPrincipalId: 'principal-one', isLocalAuthenticated: true })
  const version = datasetVersion()
  api.version.mockResolvedValue(version)
  api.bars.mockResolvedValue({
    versionId: version.id,
    checksum: version.checksum,
    bars: [
      { timestamp: version.start, open: '1', high: '2', low: '0', close: '1.5', volume: null },
    ],
  })
})
describe('private version chart metadata', () => {
  it('keeps native five-minute data distinct from a fabricated minute source and uses its actual horizon', () => {
    const version = datasetVersion()
    version.metadata.interval = '5m'
    const symbol = datasetSymbol(version)
    expect([...symbol.sources]).toEqual([])
    expect(symbol.nativeIntervals).toEqual(['5m'])
    expect(symbol.nativeLastAt).toBe(version.end)
    expect(symbol.nativeVolumeAvailable).toBe(false)
    version.metadata.volumeMeaning = 'units'
    version.coverage = { volumeUnknownRows: 0 }
    expect(datasetSymbol(version).nativeVolumeAvailable).toBe(true)
  })
  it('keeps the shared feed live through StrictMode effect replay and disposes on actual unmount', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <DatasetVersionChart
              versionId="version-one"
              rawReturn="/historify?version=version-one"
            />
          </MemoryRouter>
        </QueryClientProvider>
      </StrictMode>
    )
    await waitFor(() => expect(api.loaded).toHaveBeenCalled())
    expect(api.failed).not.toHaveBeenCalled()
    expect(api.pane).toHaveBeenCalledWith(expect.objectContaining({ defaultTimezone: 'UTC' }))
    view.unmount()
    await Promise.resolve()
  })
})
