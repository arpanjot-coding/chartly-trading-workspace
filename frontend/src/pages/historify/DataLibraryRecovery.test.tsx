import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasetError } from '@/api/dataLibrary'
import DataLibraryRecovery from './DataLibraryRecovery'
import { datasetCatalog, datasetVersion } from './testFixtures'

const api = vi.hoisted(() => ({
  bundleJob: vi.fn(),
  repreviewBundle: vi.fn(),
  commitBundle: vi.fn(),
  previewBundle: vi.fn(),
}))
const drafts = vi.hoisted(() => ({
  bundleGet: vi.fn(),
  bundleSave: vi.fn(),
  bundleDelete: vi.fn(),
}))
vi.mock('@/api/dataLibrary', async (original) => ({
  ...(await original<typeof import('@/api/dataLibrary')>()),
  dataLibrary: api,
}))
vi.mock('@/lib/historify/dataLibraryDrafts', () => ({ dataLibraryDrafts: drafts }))
const preview = (revision = 1) => ({
  id: `bundle-${revision}`,
  status: 'staged',
  expectedRevision: revision,
  preview: {
    counts: { accepted: 3, rejected: 0 },
    rows: [],
    quality: { summary: '3 structurally valid backup candles.' },
    coverage: {},
    canCommit: true,
  },
})
beforeEach(() => {
  vi.clearAllMocks()
  drafts.bundleGet.mockResolvedValue(undefined)
  drafts.bundleSave.mockResolvedValue(undefined)
  drafts.bundleDelete.mockResolvedValue(undefined)
  api.bundleJob.mockResolvedValue(preview())
  api.repreviewBundle.mockResolvedValue(preview(2))
})
describe('dataset bundle restore review', () => {
  it('explains the retained time restriction while allowing recovery of the reviewed bundle', async () => {
    const quarantine = {
      reason: 'dataset.time_unverified',
      timeBasis: 'tick-derived-unverified',
      message: 'Reimport this history with verified UTC timestamps before using it.',
    } as const
    api.bundleJob.mockResolvedValue({ ...preview(), quarantine })
    const restored = datasetVersion({ quarantine })
    api.commitBundle.mockResolvedValue({ version: restored, catalog: datasetCatalog([restored]) })
    const received = vi.fn()
    render(
      <DataLibraryRecovery
        principalId="principal-one"
        catalog={datasetCatalog()}
        resumeId="bundle-1"
        onCatalog={vi.fn()}
        onVersion={received}
      />
    )
    expect(await screen.findByText(quarantine.message)).toBeVisible()
    const restore = screen.getByRole('button', { name: 'Restore reviewed dataset' })
    expect(restore).toBeEnabled()
    fireEvent.click(restore)
    await waitFor(() => expect(received).toHaveBeenCalledWith(restored))
  })
  it('requires a fresh explicit review after catalog changes', async () => {
    render(
      <DataLibraryRecovery
        principalId="principal-one"
        catalog={{ ...datasetCatalog(), revision: 2 }}
        resumeId="bundle-1"
        onCatalog={vi.fn()}
        onVersion={vi.fn()}
      />
    )
    expect(await screen.findByRole('button', { name: 'Restore reviewed dataset' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Re-preview retained backup' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restore reviewed dataset' })).toBeEnabled()
    )
    expect(api.repreviewBundle).toHaveBeenCalledWith('bundle-1', 2)
    expect(api.commitBundle).not.toHaveBeenCalled()
  })
  it('retains and reuses the same restore receipt identity after uncertain acknowledgement', async () => {
    const version = datasetVersion()
    api.commitBundle
      .mockRejectedValueOnce(new DatasetError('datasets.offline', 'The acknowledgement was lost.'))
      .mockResolvedValueOnce({ version, catalog: datasetCatalog([version]) })
    const received = vi.fn()
    render(
      <DataLibraryRecovery
        principalId="principal-one"
        catalog={datasetCatalog()}
        resumeId="bundle-1"
        onCatalog={received}
        onVersion={vi.fn()}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Restore reviewed dataset' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Retry the same restore' }))
    await waitFor(() => expect(received).toHaveBeenCalledTimes(1))
    expect(api.commitBundle.mock.calls[1]).toEqual(api.commitBundle.mock.calls[0])
    expect(drafts.bundleDelete).toHaveBeenCalledTimes(1)
  })
})
