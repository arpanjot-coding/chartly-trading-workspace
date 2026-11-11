import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PracticeSession } from '@/lib/trader/db'
import { paperClient } from '@/lib/trader/paperClient'
import { datasetVersion } from '@/pages/historify/testFixtures'
import TraderReplay from './TraderReplay'

const api = vi.hoisted(() => ({ version: vi.fn() }))
const state = vi.hoisted(() => ({
  createSession: vi.fn(),
  updateSessionStatus: vi.fn(),
  sessions: [] as PracticeSession[],
  chartSource: undefined as { kind: 'dataset'; versionId: string; checksum: string } | undefined,
}))
vi.mock('@/api/dataLibrary', () => ({ dataLibrary: api }))
vi.mock('@/lib/trader/paperClient', () => ({ paperClient: { report: vi.fn() } }))
vi.mock('@/lib/trader/useTraderData', () => ({
  useTraderData: () => ({
    loading: false,
    portfolios: [
      {
        id: 7,
        name: 'Saved practice',
        kind: 'replay',
        currency: 'USD',
        startingBalance: 1000,
        chartSource: state.chartSource,
        createdAt: '2026-11-03T00:00:00Z',
        updatedAt: '2026-11-03T00:00:00Z',
      },
    ],
    sessions: state.sessions,
    trades: [],
    workspace: { originId: 'paper-origin' },
    createSession: state.createSession,
    updateSessionStatus: state.updateSessionStatus,
    deleteSession: vi.fn(),
  }),
}))
function show(version = true) {
  render(
    <MemoryRouter
      initialEntries={[
        `/workspace/profiles/7/replay${version ? '?datasetVersionId=version-one' : ''}`,
      ]}
    >
      <Routes>
        <Route path="/workspace/profiles/:profileId/replay" element={<TraderReplay />} />
      </Routes>
    </MemoryRouter>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  state.sessions = []
  state.chartSource = undefined
  state.createSession.mockResolvedValue(1)
  const version = datasetVersion()
  version.metadata.interval = '1s'
  api.version.mockResolvedValue(version)
})
describe('dataset practice draft handoff', () => {
  it('requires saved history before creating a run and inherits the project’s exact selected version', async () => {
    show(false)
    expect(screen.getByRole('button', { name: 'Create run', exact: true })).toBeDisabled()
    expect(state.createSession).not.toHaveBeenCalled()
  })
  it('loads a project’s pinned history without asking the user to choose it again and preserves native currency', async () => {
    state.chartSource = { kind: 'dataset', versionId: 'version-one', checksum: 'content-checksum' }
    const version = datasetVersion()
    version.metadata.currency = 'GBP'
    version.metadata.symbol = 'EURUSDm'
    version.metadata.interval = 'D'
    api.version.mockResolvedValue(version)
    show(false)
    await waitFor(() => expect(screen.getByLabelText('Symbol')).toBeDisabled())
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'My GBP run' } })
    fireEvent.change(screen.getByLabelText('Starting balance'), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: 'Create run', exact: true })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Starting balance'), { target: { value: '1250.25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create run', exact: true }))
    await waitFor(() =>
      expect(state.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          currency: 'GBP',
          symbol: 'EURUSDm',
          timeframe: 'D',
          startingBalance: 1250.25,
          datasetVersionId: 'version-one',
          datasetChecksum: 'content-checksum',
          status: 'Draft',
        })
      )
    )
  })
  it('uses the independent paper report rather than journal-realization statistics for a managed run card', async () => {
    state.sessions = [
      {
        id: 1,
        portfolioId: 7,
        name: 'Managed run',
        mode: 'Replay',
        market: 'Forex',
        symbol: 'EURUSD',
        timeframe: '1m',
        dataSource: 'Fixture',
        datasetVersionId: 'version-one',
        datasetChecksum: 'content-checksum',
        paper: { version: 1, revision: 5, status: 'finished', manifestId: 'one' },
        status: 'Completed',
        startingBalance: 10000,
        notes: '',
        createdAt: '2026-11-03T00:00:00Z',
        updatedAt: '2026-11-03T00:00:00Z',
      },
    ]
    vi.mocked(paperClient.report).mockResolvedValue({
      report: {
        runId: 1,
        profileId: 7,
        revision: 5,
        currency: 'USD',
        metrics: [
          { metricId: 'realized_net', value: '-0.08', sampleSize: 1 },
          { metricId: 'win_rate', value: '0', sampleSize: 1 },
        ],
      },
    })
    show(false)
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
    expect(paperClient.report).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Load saved metrics' }))
    expect(await screen.findByText('-0.08 USD')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
  })
  it('prefills the exact saved version and creates only a Draft with native interval/checksum', async () => {
    show()
    await waitFor(() => expect(screen.getByLabelText('Timeframe')).toHaveValue('1s'))
    expect(screen.getByLabelText('Symbol')).toBeDisabled()
    expect(screen.getByLabelText('Timeframe')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Run name'), {
      target: { value: 'A new practice draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create run', exact: true }))
    await waitFor(() => expect(state.createSession).toHaveBeenCalledTimes(1))
    expect(state.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        portfolioId: 7,
        status: 'Draft',
        symbol: 'EURUSD',
        timeframe: '1s',
        datasetVersionId: 'version-one',
        datasetChecksum: 'content-checksum',
      })
    )
    expect(state.updateSessionStatus).not.toHaveBeenCalled()
  })
  it('retains input and blocks binding when the private version cannot be read', async () => {
    api.version.mockRejectedValue(new Error('This private version is unavailable.'))
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent('private version is unavailable')
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Keep this input' } })
    expect(screen.getByRole('button', { name: 'Create run', exact: true })).toBeDisabled()
    expect(screen.getByLabelText('Run name')).toHaveValue('Keep this input')
    expect(state.createSession).not.toHaveBeenCalled()
  })
  it('keeps bound drafts honest and sends Chart to the pinned saved history', () => {
    state.sessions = [
      {
        id: 1,
        portfolioId: 7,
        name: 'Bound draft',
        mode: 'Replay',
        market: 'Forex',
        symbol: 'EURUSD',
        timeframe: '1s',
        dataSource: 'Fixture history',
        datasetVersionId: 'version-one',
        datasetChecksum: 'content-checksum',
        status: 'Draft',
        startingBalance: 1000,
        notes: '',
        createdAt: '2026-11-03T00:00:00Z',
        updatedAt: '2026-11-03T00:00:00Z',
      },
    ]
    show(false)
    expect(screen.getByLabelText('Status for Bound draft')).toBeDisabled()
    expect(screen.getByRole('link', { name: /Chart/ }).getAttribute('href')).toContain(
      'datasetVersionId=version-one'
    )
  })
})
