import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetVersion } from '@/api/dataLibrary'
import type { JournalTrade, PracticeSession, TraderPortfolio } from '@/lib/trader/db'
import { useResolvedChartContext } from './useResolvedChartContext'

const fake = vi.hoisted(() => ({
  principal: 'owner',
  version: vi.fn(),
  data: {} as Record<string, unknown>,
}))
vi.mock('@/api/dataLibrary', () => ({ dataLibrary: { version: fake.version } }))
vi.mock('@/stores/authStore', () => ({
  chartStorageAccount: () => fake.principal,
  useAuthStore: () => fake.principal,
}))
vi.mock('@/lib/trader/useTraderData', () => ({ useTraderData: () => fake.data }))
const version = {
  id: 'canonical-source',
  datasetId: 'dataset-source',
  name: 'Restored history',
  checksum: 'a'.repeat(64),
  start: 100,
  end: 220,
  metadata: { symbol: 'EXAMPLE', exchange: 'LOCAL', interval: '1m', provider: 'fixture' },
} as DatasetVersion
const profile = {
  id: 1,
  kind: 'live',
  name: 'Actual profile',
  chartSource: { kind: 'connected' },
} as TraderPortfolio
const run = {
  id: 2,
  portfolioId: 1,
  symbol: 'EXAMPLE',
  timeframe: '1m',
  datasetVersionId: 'original-source',
  datasetChecksum: version.checksum,
} as PracticeSession
const trade = {
  id: 3,
  portfolioId: 1,
  sessionId: 2,
  pair: 'EXAMPLE',
  timeframe: '1m',
  chartEvidence: [
    {
      id: 'evidence-one',
      attachmentId: 'image-one',
      capturedAt: '2026-11-03T09:00:00Z',
      source: { kind: 'dataset', datasetVersionId: version.id, checksum: version.checksum },
      instrument: { symbol: 'EXAMPLE', exchange: 'LOCAL' },
      view: { interval: '1m', chartType: 'line', timezone: 'UTC', replayAsOf: 180 },
    },
  ],
} as JournalTrade
const params = () => new URLSearchParams('profileId=1&runId=2&tradeId=3&evidenceId=evidence-one')
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
beforeEach(() => {
  fake.version.mockReset()
  fake.principal = 'owner'
  fake.data = {
    principalId: 'owner',
    storageMode: 'backend',
    loading: false,
    error: undefined,
    portfolios: [profile],
    sessions: [run],
    trades: [trade],
    books: [],
    bookAssignments: {},
  }
})
describe('owned chart source resolution lifecycle', () => {
  it.each([
    'capture',
    'run',
  ])('shows recovery guidance for a quarantined %s source', async (target) => {
    const quarantine = {
      reason: 'dataset.time_unverified',
      timeBasis: 'tick-derived-unverified',
      message: 'Download the recovery bundle and reimport verified history.',
    } as const
    fake.version.mockImplementation(async (id: string) => ({
      ...version,
      ...(id === run.datasetVersionId ? { resolvedFromVersionId: run.datasetVersionId } : {}),
      ...((target === 'capture' && id === version.id) ||
      (target === 'run' && id === run.datasetVersionId)
        ? { quarantine }
        : {}),
    }))
    const hook = renderHook(() => useResolvedChartContext(params()))
    await waitFor(() => expect(hook.result.current.error).toBe(quarantine.message))
    expect(hook.result.current.context).toBeUndefined()
  })
  it('waits for both exact owned alias responses before reopening a canonical capture on a restored run', async () => {
    const canonical = deferred<DatasetVersion>(),
      original = deferred<DatasetVersion>()
    fake.version.mockImplementation((id: string) =>
      id === version.id ? canonical.promise : original.promise
    )
    const hook = renderHook(() => useResolvedChartContext(params()))
    await waitFor(() => expect(fake.version).toHaveBeenCalledTimes(2))
    expect(fake.version.mock.calls.map((call) => call[0])).toEqual([
      version.id,
      run.datasetVersionId,
    ])
    await act(async () => canonical.resolve(version))
    expect(hook.result.current.loading).toBe(true)
    expect(hook.result.current.context).toBeUndefined()
    await act(async () =>
      original.resolve({
        ...version,
        resolvedFromVersionId: run.datasetVersionId,
      } as DatasetVersion)
    )
    await waitFor(() => expect(hook.result.current.context?.dataset?.id).toBe(version.id))
    expect(hook.result.current.context?.run?.datasetVersionId).toBe(run.datasetVersionId)
    expect(hook.result.current.context?.evidence?.view.replayAsOf).toBe(180)
    expect(hook.result.current.context?.executionAllowed).toBe(false)
  })
  it('rejects same-checksum responses that do not attest the exact old run identity', async () => {
    fake.version.mockResolvedValue(version)
    const hook = renderHook(() => useResolvedChartContext(params()))
    await waitFor(() => expect(hook.result.current.error).toMatch(/verified as the pinned/))
    expect(hook.result.current.context).toBeUndefined()
  })
  it('aborts both owned reads on a context switch and ignores their later completions', async () => {
    const canonical = deferred<DatasetVersion>(),
      original = deferred<DatasetVersion>()
    fake.version.mockImplementation((id: string) =>
      id === version.id ? canonical.promise : original.promise
    )
    const hook = renderHook(({ query }) => useResolvedChartContext(query), {
      initialProps: { query: params() },
    })
    await waitFor(() => expect(fake.version).toHaveBeenCalledTimes(2))
    const signals = fake.version.mock.calls.map((call) => call[1] as AbortSignal)
    hook.rerender({ query: new URLSearchParams('profileId=1') })
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    await act(async () => {
      canonical.resolve(version)
      original.resolve({
        ...version,
        resolvedFromVersionId: run.datasetVersionId,
      } as DatasetVersion)
    })
    expect(hook.result.current.context?.source).toBe('legacy-connected')
    expect(hook.result.current.context?.evidence).toBeUndefined()
  })
  it('waits for the actual authenticated storage binding rather than reading a former principal’s records', async () => {
    fake.data.principalId = 'former-owner'
    const hook = renderHook(() => useResolvedChartContext(params()))
    expect(hook.result.current.loading).toBe(true)
    expect(fake.version).not.toHaveBeenCalled()
    expect(hook.result.current.context).toBeUndefined()
  })
})
