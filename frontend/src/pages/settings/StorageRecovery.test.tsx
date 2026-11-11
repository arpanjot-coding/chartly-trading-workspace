import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { api, accept, snapshot, status } = vi.hoisted(() => ({
  api: {
    context: vi.fn(),
    workspace: vi.fn(),
    preview: vi.fn(),
    migration: vi.fn(),
    commit: vi.fn(),
    restorePreview: vi.fn(),
    restoreCommit: vi.fn(),
    recoveryStatus: vi.fn(),
    undoPreview: vi.fn(),
    restoreJob: vi.fn(),
  },
  accept: vi.fn(),
  snapshot: vi.fn(),
  status: { phase: 'browser', message: 'Browser source retained', pending: false },
}))
vi.mock('@/lib/trader/localStorageClient', () => ({ localStorageClient: api }))
vi.mock('@/lib/trader/dataPersistence', () => ({
  acceptWorkspace: accept,
  retainedWorkspaceDrafts: async () => [],
  persistenceStatus: () => status,
  subscribePersistence: () => () => {},
  rebuildDerivedCache: vi.fn(),
  retainedDraft: vi.fn(),
  retryNativeDraft: vi.fn(),
  retryPendingSave: vi.fn(),
  saveBackendTables: vi.fn(),
  loadTraderBinding: vi.fn(),
  copyTables: structuredClone,
}))
vi.mock('@/lib/trader/browserSnapshot', () => ({
  captureBrowserSnapshot: snapshot,
  restoreNativeState: vi.fn(),
  TRADER_TABLES: ['portfolios'],
}))

import StorageRecovery from './StorageRecovery'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  api.context.mockResolvedValue({
    authenticated: true,
    principalId: 'alice',
    setupRequired: false,
    workspaces: [],
    activeOriginId: null,
  })
  snapshot.mockResolvedValue({ originId: 'source' })
  api.recoveryStatus.mockResolvedValue({ restores: [], migrations: [] })
  api.restoreJob.mockImplementation(async (id: string) =>
    (await api.recoveryStatus()).restores.find((job: { jobId: string }) => job.jobId === id)
  )
})
describe('Storage migration review', () => {
  it('offers a reviewed profile save and safe return from Connections without moving data automatically', async () => {
    render(
      <MemoryRouter
        initialEntries={['/settings/storage?returnTo=%2Fworkspace%2Fprofiles%2F1%2Fconnections']}
      >
        <StorageRecovery />
      </MemoryRouter>
    )
    expect(screen.getByText('Save your existing profiles on this computer')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Connections' })).toHaveAttribute(
      'href',
      '/workspace/profiles/1/connections'
    )
    await screen.findByRole('button', { name: 'Preview existing profiles' })
    expect(api.preview).not.toHaveBeenCalled()
    expect(api.commit).not.toHaveBeenCalled()
  })
  it('loads full warning details before showing a compact restore status for confirmation', async () => {
    const user = userEvent.setup()
    api.context.mockResolvedValue({
      authenticated: true,
      principalId: 'alice',
      revision: 8,
      workspaces: [],
    })
    const compact = {
      jobId: 'compact-job',
      status: 'preview',
      expectedRevision: 8,
      confirmationHash: 'hash',
      originCount: 1,
      moduleCounts: {},
      unavailableAttachments: [],
      unavailableAttachmentCount: 2,
      unverifiedDependencies: [],
      unverifiedDependencyCount: 1,
      requiresOwnershipConfirmation: false,
      previewDetailsTruncated: true,
    }
    api.recoveryStatus.mockResolvedValue({ restores: [compact], migrations: [] })
    api.restoreJob.mockResolvedValue({
      ...compact,
      previewDetailsTruncated: false,
      unavailableAttachments: [{ id: 'one' }, { id: 'two' }],
      unverifiedDependencies: [{ id: 'dependency' }],
    })
    render(
      <MemoryRouter>
        <StorageRecovery />
      </MemoryRouter>
    )
    await user.click(
      await screen.findByRole('button', { name: 'Resume restore review compact-job' })
    )
    expect(api.restoreJob).toHaveBeenCalledWith('compact-job')
    expect(
      await screen.findByText('2 attachments remain unavailable; original references are retained.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('1 external dependencies require verification after restore.')
    ).toBeInTheDocument()
    expect(api.restoreCommit).not.toHaveBeenCalled()
  })
  it('recovers the last restore receipt and Undo action after reload and cache clearing', async () => {
    const user = userEvent.setup()
    api.context.mockResolvedValue({
      authenticated: true,
      principalId: 'alice',
      revision: 9,
      activeOriginId: 'source',
      workspaces: [{ originId: 'source' }],
    })
    api.workspace.mockResolvedValue({ originId: 'source', revision: 2, tables: { portfolios: [] } })
    api.recoveryStatus.mockResolvedValue({
      restores: [
        {
          jobId: 'completed-job',
          status: 'completed',
          receipt: { recoveryCopyId: 'durable-copy', status: 'completed', originId: 'source' },
        },
      ],
      migrations: [],
    })
    api.undoPreview.mockResolvedValue({
      jobId: 'undo-job',
      expectedRevision: 9,
      confirmationHash: 'hash',
      originCount: 1,
      moduleCounts: {},
      unavailableAttachments: [],
      unverifiedDependencies: [],
      requiresOwnershipConfirmation: false,
    })
    const first = render(
      <MemoryRouter>
        <StorageRecovery />
      </MemoryRouter>
    )
    expect(
      await screen.findByRole('button', { name: 'Review undo of last restore' })
    ).toBeInTheDocument()
    first.unmount()
    localStorage.clear()
    render(
      <MemoryRouter>
        <StorageRecovery />
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('button', { name: 'Review undo of last restore' }))
    await waitFor(() => expect(api.undoPreview).toHaveBeenCalledWith('durable-copy', 9))
    expect(api.restoreCommit).not.toHaveBeenCalled()
  })
  it('resumes an interrupted restore explicitly and resets ownership confirmation after reload', async () => {
    const user = userEvent.setup()
    api.context.mockResolvedValue({
      authenticated: true,
      principalId: 'alice',
      revision: 8,
      workspaces: [],
    })
    api.recoveryStatus.mockResolvedValue({
      restores: [
        {
          jobId: 'interrupted',
          status: 'preview',
          expectedRevision: 8,
          confirmationHash: 'hash',
          originCount: 1,
          moduleCounts: {},
          unavailableAttachments: [],
          unverifiedDependencies: [],
          requiresOwnershipConfirmation: true,
        },
      ],
      migrations: [],
    })
    const first = render(
      <MemoryRouter>
        <StorageRecovery />
      </MemoryRouter>
    )
    expect(
      screen.queryByRole('button', { name: 'Restore reviewed backup' })
    ).not.toBeInTheDocument()
    await user.click(
      await screen.findByRole('button', { name: 'Resume restore review interrupted' })
    )
    expect(await screen.findByRole('button', { name: 'Restore reviewed backup' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Restore reviewed backup' })).toBeEnabled()
    first.unmount()
    render(
      <MemoryRouter>
        <StorageRecovery />
      </MemoryRouter>
    )
    await user.click(
      await screen.findByRole('button', { name: 'Resume restore review interrupted' })
    )
    expect(await screen.findByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Restore reviewed backup' })).toBeDisabled()
    expect(api.restoreCommit).not.toHaveBeenCalled()
  })
  it('blocks a stale interrupted restore until the backup is previewed again', async () => {
    const user = userEvent.setup()
    api.context.mockResolvedValue({
      authenticated: true,
      principalId: 'alice',
      revision: 9,
      workspaces: [],
    })
    api.recoveryStatus.mockResolvedValue({
      restores: [
        {
          jobId: 'stale-job',
          status: 'preview',
          expectedRevision: 8,
          confirmationHash: 'hash',
          originCount: 1,
          moduleCounts: {},
          unavailableAttachments: [],
          unverifiedDependencies: [],
          requiresOwnershipConfirmation: false,
        },
      ],
      migrations: [],
    })
    render(
      <MemoryRouter>
        <StorageRecovery />
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('button', { name: 'Resume restore review stale-job' }))
    expect(
      await screen.findByText(
        'Saved data changed after this preview. Upload the backup again to create a fresh preview before restoring.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore reviewed backup' })).toBeDisabled()
    expect(api.restoreCommit).not.toHaveBeenCalled()
  })
  it('offers server-held migration previews after the browser migration token is cleared', async () => {
    const user = userEvent.setup()
    const job = { id: 'server-job', status: 'preview', counts: { portfolios: 1 }, issues: [] }
    api.recoveryStatus.mockResolvedValue({ restores: [], migrations: [job] })
    api.migration.mockResolvedValue(job)
    render(
      <MemoryRouter>
        <StorageRecovery />
      </MemoryRouter>
    )
    await user.click(
      await screen.findByRole('button', { name: 'Resume migration review server-job' })
    )
    expect(await screen.findByRole('button', { name: 'Commit reviewed migration' })).toBeEnabled()
    expect(api.commit).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('chartly.storage.migration-job.v1')!).id).toBe(
      'server-job'
    )
  })
  it('requires explicit issue resolution and keeps the review on a failed commit', async () => {
    const user = userEvent.setup()
    api.preview.mockResolvedValue({
      id: 'job',
      revision: 1,
      counts: { portfolios: 1, journalTrades: 3 },
      issues: [
        { id: 'ownership', message: 'Choose journal ownership', choices: ['manual', 'account:17'] },
      ],
    })
    api.commit.mockRejectedValue(new Error('Revision changed; reload and review'))
    render(
      <MemoryRouter>
        <StorageRecovery />
      </MemoryRouter>
    )
    await user.click(await screen.findByRole('button', { name: 'Review browser migration' }))
    const commit = await screen.findByRole('button', { name: 'Commit reviewed migration' })
    expect(commit).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Choose journal ownership'), 'manual')
    expect(commit).toBeEnabled()
    await user.click(commit)
    expect(await screen.findByText('Revision changed; reload and review')).toBeInTheDocument()
    expect(screen.getByLabelText('Choose journal ownership')).toHaveValue('manual')
    expect(accept).not.toHaveBeenCalled()
  })
  it('requires an ownership confirmation for a cross-account restore', async () => {
    const user = userEvent.setup()
    api.context.mockResolvedValue({
      authenticated: true,
      principalId: 'alice',
      setupRequired: false,
      revision: 8,
      workspaces: [{ originId: 'source' }],
      activeOriginId: 'source',
    })
    api.workspace.mockResolvedValue({ originId: 'source', revision: 2, tables: { portfolios: [] } })
    api.restorePreview.mockResolvedValue({
      jobId: 'restore-job',
      expectedRevision: 8,
      confirmationHash: 'verified',
      originCount: 1,
      moduleCounts: { journal: 3, charts: 2 },
      unavailableAttachments: [],
      unverifiedDependencies: [],
      requiresOwnershipConfirmation: true,
    })
    api.restoreCommit.mockResolvedValue({ status: 'completed', recoveryCopyId: 'copy' })
    render(
      <MemoryRouter>
        <StorageRecovery />
      </MemoryRouter>
    )
    await user.upload(
      await screen.findByLabelText('Preview backup ZIP'),
      new File(['zip'], 'backup.zip', { type: 'application/zip' })
    )
    const restore = await screen.findByRole('button', { name: 'Restore reviewed backup' })
    expect(restore).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(restore)
    await waitFor(() =>
      expect(api.restoreCommit).toHaveBeenCalledWith('restore-job', 8, 'verified', true)
    )
  })
})
