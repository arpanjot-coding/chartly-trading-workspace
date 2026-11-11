import 'fake-indexeddb/auto'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChartEvidenceCapture, ChartEvidenceRequest } from '@/lib/trader/chartEvidence'
import { journalDrafts } from '@/lib/trader/journalDrafts'
import { LocalStorageError } from '@/lib/trader/localStorageClient'
import type { useTraderData } from '@/lib/trader/useTraderData'
import JournalPanel, { type JournalPanelProps } from './JournalPanel'

const { state, attach } = vi.hoisted(() => ({
  state: { data: {} as ReturnType<typeof useTraderData> },
  attach: vi.fn(),
}))
vi.mock('@/lib/trader/useTraderData', () => ({ useTraderData: () => state.data }))
vi.mock('@/lib/trader/journalClient', () => ({ journalClient: { attachChartEvidence: attach } }))
const metadata: ChartEvidenceCapture = {
  version: 1,
  capturedAt: '2026-11-03T09:00:00Z',
  source: { kind: 'dataset', datasetVersionId: 'version-fixture', checksum: 'a'.repeat(64) },
  instrument: { symbol: 'EXAMPLE', exchange: 'LOCAL' },
  view: {
    interval: '1m',
    chartType: 'candlestick',
    timezone: 'UTC',
    visibleFrom: 100,
    visibleTo: 200,
  },
}
const image = {
  type: 'image/png',
  size: 8,
  arrayBuffer: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
} as Blob
function fixture(override: Partial<JournalPanelProps> = {}) {
  const props: JournalPanelProps = {
    contextKey: 'chart-A',
    profileId: 7,
    tradeId: 21,
    bookId: 'book-A',
    capture: vi.fn().mockResolvedValue({ file: image, capture: metadata }),
    readCaptureKey: () => 'pane-A',
    ...override,
  }
  const view = render(
    <MemoryRouter>
      <JournalPanel {...props} />
    </MemoryRouter>
  )
  return { props, view, user: userEvent.setup() }
}
beforeEach(() => {
  vi.clearAllMocks()
  const principalId = crypto.randomUUID()
  state.data = {
    portfolios: [
      { id: 7, name: 'Environment A', kind: 'replay' },
      { id: 8, name: 'Environment B', kind: 'live' },
    ],
    trades: [
      {
        id: 21,
        portfolioId: 7,
        pair: 'EXAMPLE',
        openDate: '2026-11-02T09:00:00Z',
        direction: 'Buy',
      },
      {
        id: 22,
        portfolioId: 8,
        pair: 'OTHER',
        openDate: '2026-11-02T10:00:00Z',
        direction: 'Sell',
      },
    ],
    sessions: [{ id: 31, portfolioId: 7, symbol: 'EXAMPLE', name: 'Run A' }],
    books: [
      { id: 'book-A', name: 'Book A', kind: 'manual', profileIds: [7] },
      { id: 'book-B', name: 'Book B', kind: 'manual', profileIds: [8] },
    ],
    bookAssignments: { 21: 'book-A', 22: 'book-B' },
    principalId,
    workspace: { originId: 'fixture-origin', revision: 3 },
    loading: false,
    error: null,
    storageMode: 'backend',
    readOnly: false,
    acceptJournalResponse: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useTraderData>
  attach.mockResolvedValue({
    workspace: { originId: 'fixture-origin', revision: 4 },
    result: {
      evidenceId: 'evidence1',
      attachmentId: 'asset1',
      url: '/api/local/v1/attachments/asset1?originId=fixture-origin',
    },
  })
})

describe('original chart Journal panel', () => {
  it('keeps attach disabled while the owning chart clock is held', async () => {
    const { props, user } = fixture({ captureAvailable: false })
    expect(await screen.findByText(/Wait for every chart pane/)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Attach focused chart' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(props.capture).not.toHaveBeenCalled()
    expect(attach).not.toHaveBeenCalled()
  })
  it('saves the focused PNG, metadata and notes only to the explicit owned book/trade', async () => {
    const { user, props } = fixture()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
    await user.type(screen.getByLabelText('Chart notes'), 'Test decision')
    await user.click(screen.getByRole('button', { name: 'Attach focused chart' }))
    await waitFor(() => expect(attach).toHaveBeenCalledOnce())
    const body = attach.mock.calls[0][0] as ChartEvidenceRequest
    expect(body.target).toEqual({ kind: 'trade', id: 21, profileId: 7, bookId: 'book-A' })
    expect(body).toMatchObject({
      expectedRevision: 3,
      mimeType: 'image/png',
      annotations: 'Test decision',
      capture: metadata,
    })
    expect(props.capture).toHaveBeenCalledOnce()
    expect(screen.queryByRole('option', { name: /OTHER/ })).not.toBeInTheDocument()
    await screen.findByText(/Chart saved to the selected record/)
    expect(
      await journalDrafts.get(
        { principalId: state.data.principalId!, originId: 'fixture-origin', bookId: 'book-A' },
        'attachment:chart-trade-21'
      )
    ).toBeUndefined()
  })
  it('retains a failed capture and retries the same image/request instead of recapturing', async () => {
    attach.mockRejectedValueOnce(
      new LocalStorageError('journal.offline', 'Local engine unavailable.')
    )
    const { user, props } = fixture()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Attach focused chart' }))
    await screen.findByText('Local engine unavailable.')
    const body = attach.mock.calls[0][0]
    await user.click(screen.getByRole('button', { name: 'Retry retained capture' }))
    await screen.findByText(/Chart saved to the selected record/)
    expect(attach.mock.calls[1][0]).toEqual(body)
    expect(props.capture).toHaveBeenCalledOnce()
  })
  it('restores a retained draft when the panel reopens', async () => {
    attach.mockRejectedValueOnce(
      new LocalStorageError('journal.offline', 'Local engine unavailable.')
    )
    const { user, props, view } = fixture()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Attach focused chart' }))
    await screen.findByText('Local engine unavailable.')
    const body = attach.mock.calls[0][0]
    view.unmount()
    const reopened = fixture(props)
    await screen.findByRole('region', { name: 'Retained chart capture' })
    await reopened.user.click(screen.getByRole('button', { name: 'Retry retained capture' }))
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(2))
    expect(attach.mock.calls[1][0]).toEqual(body)
  })
  it('rejects a capture when its source/pane identity changes during the asynchronous snapshot', async () => {
    let resolve!: (value: { file: Blob; capture: ChartEvidenceCapture }) => void
    let key = 'before'
    const { user } = fixture({
      capture: () =>
        new Promise((done) => {
          resolve = done
        }),
      readCaptureKey: () => key,
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Attach focused chart' }))
    key = 'after'
    await act(async () => resolve({ file: image, capture: metadata }))
    expect(await screen.findByText(/chart changed during capture/)).toBeInTheDocument()
    expect(attach).not.toHaveBeenCalled()
  })
  it('does not submit an outgoing environment capture after the panel changes context', async () => {
    let resolve!: (value: { file: Blob; capture: ChartEvidenceCapture }) => void
    const { user, props, view } = fixture({
      capture: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Attach focused chart' }))
    view.rerender(
      <MemoryRouter>
        <JournalPanel {...props} contextKey="chart-B" profileId={8} tradeId={22} bookId="book-B" />
      </MemoryRouter>
    )
    await act(async () => resolve({ file: image, capture: metadata }))
    expect(attach).not.toHaveBeenCalled()
  })
  it('offers storage setup for preserved browser records without capturing or uploading', async () => {
    state.data = { ...state.data, storageMode: 'browser', workspace: undefined }
    fixture()
    expect(screen.getByRole('link', { name: 'durable local storage' })).toHaveAttribute(
      'href',
      '/settings/storage'
    )
    expect(screen.queryByRole('button', { name: 'Attach focused chart' })).not.toBeInTheDocument()
    expect(attach).not.toHaveBeenCalled()
  })
  it('requires an explicit destination on an unbound chart', () => {
    fixture({ profileId: undefined, tradeId: undefined, bookId: undefined })
    expect(screen.getByLabelText('Destination environment')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Attach focused chart' })).not.toBeInTheDocument()
  })
  it('pins a run capture to its actual profile/run without inventing a trade', async () => {
    const { user } = fixture({ runId: 31, tradeId: undefined, bookId: undefined })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Attach focused chart' }))
    await waitFor(() => expect(attach).toHaveBeenCalledOnce())
    expect(attach.mock.calls[0][0].target).toEqual({ kind: 'run', id: 31, profileId: 7 })
  })
  it('requires explicit review after a definite revision conflict and retains the original PNG', async () => {
    attach.mockRejectedValueOnce(
      new LocalStorageError('storage.revision_conflict', 'The journal changed. Reload it.', 409)
    )
    const { user, props, view } = fixture()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Attach focused chart' }))
    await screen.findByText('The journal changed. Reload it.')
    const original = attach.mock.calls[0][0]
    expect(
      screen.getByRole('button', { name: 'Save retained capture after review' })
    ).toBeDisabled()
    state.data = { ...state.data, workspace: { ...state.data.workspace!, revision: 4 } }
    view.rerender(
      <MemoryRouter>
        <JournalPanel {...props} />
      </MemoryRouter>
    )
    await user.click(screen.getByRole('checkbox', { name: /I reviewed the latest record/ }))
    await user.click(screen.getByRole('button', { name: 'Save retained capture after review' }))
    await screen.findByText(/Chart saved to the selected record/)
    const reviewed = attach.mock.calls[1][0]
    expect(reviewed).toMatchObject({
      ...original,
      expectedRevision: 4,
      requestId: expect.any(String),
    })
    expect(reviewed.requestId).not.toBe(original.requestId)
    expect(reviewed.base64).toBe(original.base64)
    expect(props.capture).toHaveBeenCalledOnce()
  })
  it('does not overwrite unchecked durable drafts when their lookup fails', async () => {
    vi.spyOn(journalDrafts, 'get').mockRejectedValueOnce(new Error('disk unavailable'))
    const { user } = fixture()
    await screen.findByText(/Interrupted captures could not be checked/)
    expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeDisabled()
    expect(attach).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Check retained captures again' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
  })
  it('does not capture twice while a snapshot is still being produced', async () => {
    let resolve!: (value: { file: Blob; capture: ChartEvidenceCapture }) => void
    const capture = vi.fn(
      () =>
        new Promise<{ file: Blob; capture: ChartEvidenceCapture }>((done) => {
          resolve = done
        })
    )
    const { user } = fixture({ capture })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
    await user.dblClick(screen.getByRole('button', { name: 'Attach focused chart' }))
    expect(capture).toHaveBeenCalledOnce()
    await act(async () => resolve({ file: image, capture: metadata }))
    await waitFor(() => expect(attach).toHaveBeenCalledOnce())
  })
  it('does not apply an outgoing save response to a new environment and keeps its retry proof', async () => {
    let resolve!: (value: unknown) => void
    attach.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const { user, props, view } = fixture()
    const principalId = state.data.principalId!
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Attach focused chart' }))
    await waitFor(() => expect(attach).toHaveBeenCalledOnce())
    view.rerender(
      <MemoryRouter>
        <JournalPanel {...props} contextKey="chart-B" profileId={8} tradeId={22} bookId="book-B" />
      </MemoryRouter>
    )
    await act(async () => resolve({ workspace: { originId: 'fixture-origin', revision: 4 } }))
    expect(state.data.acceptJournalResponse).not.toHaveBeenCalled()
    expect(
      await journalDrafts.get(
        { principalId, originId: 'fixture-origin', bookId: 'book-A' },
        'attachment:chart-trade-21'
      )
    ).toBeDefined()
  })
  it('keeps disconnected cached journals read-only', async () => {
    state.data = { ...state.data, readOnly: true }
    const { props } = fixture()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeDisabled()
    )
    expect(screen.getByText(/Reconnect the local engine/)).toBeInTheDocument()
    expect(props.capture).not.toHaveBeenCalled()
  })
  it('refuses a mismatched chart instrument before creating an unusable retained request', async () => {
    const { user } = fixture({
      capture: async () => ({
        file: image,
        capture: { ...metadata, instrument: { symbol: 'OTHER', exchange: 'LOCAL' } },
      }),
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Attach focused chart' }))
    expect(await screen.findByText(/This chart shows OTHER/)).toBeInTheDocument()
    expect(attach).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Retained chart capture' })).not.toBeInTheDocument()
  })
  it('bounds record options and finds an older matching trade without loading another book', async () => {
    const template = state.data.trades[0]
    const trades = Array.from({ length: 125 }, (_, index) => ({ ...template, id: 1000 + index }))
    state.data = {
      ...state.data,
      trades,
      bookAssignments: Object.fromEntries(trades.map((trade) => [String(trade.id), 'book-A'])),
    }
    const { user } = fixture({
      tradeId: undefined,
      instrument: { symbol: 'EXAMPLE', exchange: 'LOCAL' },
    })
    const selector = screen.getByLabelText('Journal entry')
    expect(selector.querySelectorAll('option')).toHaveLength(101)
    expect(screen.getByText(/Showing 100 matching records/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Find a record'), '1124')
    expect(selector.querySelectorAll('option')).toHaveLength(2)
    await user.selectOptions(selector, '1124')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach focused chart' })).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Attach focused chart' }))
    await waitFor(() => expect(attach).toHaveBeenCalledOnce())
    expect(attach.mock.calls[0][0].target).toEqual({
      kind: 'trade',
      id: 1124,
      profileId: 7,
      bookId: 'book-A',
    })
  })
})
