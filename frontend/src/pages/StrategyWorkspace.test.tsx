import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ArtifactBundle, strategyArtifactClient } from '@/lib/trader/strategyArtifactClient'
import { experimentClient } from '@/lib/trader/experimentClient'
import { LocalStorageError } from '@/lib/trader/localStorageClient'
import { useAuthStore } from '@/stores/authStore'
import StrategyWorkspace from './StrategyWorkspace'

vi.mock('@/lib/trader/strategyArtifactClient', () => ({
  strategyArtifactClient: { list: vi.fn(), templates: vi.fn(), detail: vi.fn(), action: vi.fn() },
}))
vi.mock('@/lib/trader/experimentClient', () => ({
  experimentClient: {
    list: vi.fn(),
    detail: vi.fn(),
    submit: vi.fn(),
    runNext: vi.fn(),
    cancel: vi.fn(),
    recover: vi.fn(),
  },
}))
const reload = vi.hoisted(() => vi.fn())
vi.mock('@/lib/trader/useTraderData', () => ({
  useTraderData: () => ({
    storageMode: 'backend',
    workspace: { originId: 'builder-fixture' },
    reload,
  }),
}))

const sourceDoc = {
  format: 'chartly-rules-v1',
  kind: 'indicator',
  inputs: [{ name: 'length', type: 'integer', default: '14' }],
  outputs: [{ name: 'rsi', plot: 'line' }],
  policy: { warmupBars: 14, barCloseOnly: true, missingData: 'skip-bar' },
  rules: [{ op: 'rsi', input: 'close', length: 'length', output: 'rsi' }],
}
let current: ArtifactBundle
const fresh = (): ArtifactBundle => ({
  id: 'artifactproject-0001',
  revision: 1,
  project: {
    id: 'artifactproject-0001',
    name: 'RSI momentum (starter)',
    kind: 'indicator',
    language: 'chartly-rules-v1',
    state: 'active',
  },
  draft: { source: sourceDoc, baseRevisionId: null, draftRevision: 1, diagnostics: [] },
  revisions: [],
  parameterSets: [],
  attachments: [],
})

function mount() {
  useAuthStore.setState({ isLocalAuthenticated: true, localPrincipalId: 'builder-owner', user: null })
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <StrategyWorkspace />
    </MemoryRouter>
  )
  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(experimentClient.list).mockResolvedValue({ jobs: [] })
  current = fresh()
  vi.mocked(strategyArtifactClient.templates).mockResolvedValue({
    templates: [
      {
        id: 'template-rsi-indicator',
        name: 'RSI momentum (starter)',
        kind: 'indicator',
        description: 'Starter RSI',
        language: 'chartly-rules-v1',
      },
    ],
  })
  vi.mocked(strategyArtifactClient.list).mockImplementation(async () => ({
    projects: [
      {
        id: current.id,
        revision: current.revision,
        name: current.project.name,
        kind: current.project.kind,
        language: current.project.language,
        state: current.project.state,
        updatedAt: '2026-11-04T00:00:00Z',
        draftRevision: current.draft.draftRevision,
        diagnostics: current.draft.diagnostics,
        revisionCount: current.revisions.length,
      },
    ],
  }))
  vi.mocked(strategyArtifactClient.detail).mockImplementation(async () => ({ project: current }))
})
afterEach(() => cleanup())

describe('StrategyWorkspace', () => {
  it('creates from a template, edits, saves and creates a revision', async () => {
    vi.mocked(strategyArtifactClient.action).mockImplementation(async (body) => {
      if (body.action === 'save-draft') {
        current = {
          ...current,
          revision: current.revision + 1,
          draft: {
            ...current.draft,
            source: body.payload.source,
            draftRevision: current.draft.draftRevision + 1,
          },
        }
      }
      if (body.action === 'create-revision') {
        current = {
          ...current,
          revision: current.revision + 1,
          revisions: [
            {
              id: 'artifactrevision-0001',
              checksum: 'a'.repeat(64),
              createdAt: '2026-11-04T00:00:00Z',
              dependencies: [],
            },
          ],
          parameterSets: [
            {
              id: 'parameterset-0001',
              artifactRevisionId: 'artifactrevision-0001',
              values: { length: '14' },
              origin: 'default',
            },
          ],
        }
      }
      return { project: current }
    })
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /RSI momentum/ }))
    const editor = await screen.findByLabelText('Rules document (JSON)')
    expect(editor).toHaveValue(JSON.stringify(sourceDoc, null, 2))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(screen.getByText('Draft saved.')).toBeVisible())
    await user.click(screen.getByRole('button', { name: 'Create revision' }))
    await waitFor(() => expect(screen.getByText(/sha aaaaaaaaaaaa/)).toBeVisible())
    expect(strategyArtifactClient.action).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create-revision', projectId: current.id }),
      undefined,
      'builder-owner'
    )
  })

  it('keeps editor text on a draft conflict and offers reload', async () => {
    vi.mocked(strategyArtifactClient.action).mockRejectedValue(
      new LocalStorageError('artifact.draft_conflict', 'Changed elsewhere.', 409)
    )
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /RSI momentum/ }))
    const editor = await screen.findByLabelText('Rules document (JSON)')
    await user.clear(editor)
    await user.type(editor, '{{"format":"chartly-rules-v1","edited":true}')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('changed elsewhere')
    )
    expect(editor).toHaveValue('{"format":"chartly-rules-v1","edited":true}')
    expect(screen.getByRole('button', { name: 'Reload saved draft' })).toBeVisible()
  })

  it('previews the latest revision on the labelled synthetic series', async () => {
    current = {
      ...fresh(),
      revisions: [
        {
          id: 'artifactrevision-0001',
          checksum: 'b'.repeat(64),
          createdAt: '2026-11-04T00:00:00Z',
          dependencies: [],
        },
      ],
      parameterSets: [
        {
          id: 'parameterset-0001',
          artifactRevisionId: 'artifactrevision-0001',
          values: { length: '14' },
          origin: 'default',
        },
      ],
    }
    vi.mocked(strategyArtifactClient.action).mockResolvedValue({
      planChecksum: 'c'.repeat(64),
      rows: [{ time: '2026-01-01T00:39:00Z', outputs: { rsi: '100' } }],
      forming: null,
    })
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /RSI momentum/ }))
    await user.click(await screen.findByRole('button', { name: 'Run preview' }))
    await waitFor(() => expect(screen.getByText(/"rsi":"100"/)).toBeVisible())
    expect(screen.getByText(/synthetic down-then-up series — not\s+market data/)).toBeVisible()
    const call = vi.mocked(strategyArtifactClient.action).mock.calls[0][0]
    expect(call.action).toBe('preview')
    expect((call.payload.candles as unknown[]).length).toBe(40)
  })

  it('submits, runs and reopens a durable experiment report', async () => {
    current = {
      ...fresh(),
      project: { ...fresh().project, kind: 'strategy' },
      revisions: [
        {
          id: 'artifactrevision-0001',
          checksum: 'a'.repeat(64),
          createdAt: '2026-11-04T00:00:00Z',
          dependencies: [],
        },
      ],
      parameterSets: [
        {
          id: 'parameterset-0001',
          artifactRevisionId: 'artifactrevision-0001',
          values: { length: '14' },
          origin: 'default',
        },
      ],
    }
    const job = {
      id: 'experiment-0001-job',
      trial: { status: 'queued' },
      report: null,
      manifest: {},
    }
    vi.mocked(experimentClient.submit).mockResolvedValue({ job })
    vi.mocked(experimentClient.runNext).mockResolvedValue({
      job: {
        ...job,
        trial: { status: 'completed' },
        report: {
          endingEquity: '1500',
          totalReturn: '0.25',
          maxDrawdown: '0.1',
          tradeCount: 1,
          winRate: '1',
          checksum: 'c'.repeat(64),
          trades: [
            {
              entryTime: '2026-01-01T03:00:00Z',
              exitTime: '2026-01-01T05:00:00Z',
              quantity: '100',
              entryPrice: '12',
              exitPrice: '15',
              netPnl: '300',
            },
          ],
          openPosition: null,
        },
      },
    })
    const user = mount()
    await user.click(await screen.findByRole('button', { name: /RSI momentum/ }))
    await user.type(screen.getByLabelText('Dataset version ID'), 'datasetversion-0001')
    await user.type(screen.getByLabelText('Instrument ID'), 'instrument-kraken-btc-usd')
    await user.type(screen.getByLabelText('Warmup start (UTC ISO)'), '2026-01-01T00:00:00Z')
    await user.type(screen.getByLabelText('Range start (UTC ISO)'), '2026-01-01T02:00:00Z')
    await user.type(screen.getByLabelText('Range end (UTC ISO)'), '2026-01-01T07:00:00Z')
    await user.click(screen.getByRole('button', { name: 'Submit experiment' }))
    await waitFor(() =>
      expect(screen.getByText(/Experiment submitted/)).toBeVisible()
    )
    await user.click(screen.getByRole('button', { name: 'Run next queued' }))
    await waitFor(() => expect(screen.getByText(/equity 1500/)).toBeVisible())
    expect(screen.getByText(/net 300/)).toBeVisible()
    expect(vi.mocked(experimentClient.submit).mock.calls[0][1]).toMatchObject({
      revisionId: 'artifactrevision-0001',
      datasetVersionId: 'datasetversion-0001',
    })
  })
})
