import type { WorkspaceCatalog } from 'chartly-charts/workspace'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'

const { api, marker, retain, finish, browser } = vi.hoisted(() => ({
  api: { context: vi.fn(), native: vi.fn(), saveNative: vi.fn() },
  marker: vi.fn(),
  retain: vi.fn(),
  finish: vi.fn(),
  browser: { read: vi.fn(), write: vi.fn(), close: vi.fn() },
}))
vi.mock('chartly-charts/workspace', () => ({ createIndexedDbWorkspaceStorage: () => browser }))
vi.mock('./dataPersistence', () => ({
  activationMarker: marker,
  retainNativeDraft: retain,
  finishNativeDraft: finish,
}))
vi.mock('./localStorageClient', async (original) => ({
  ...(await original<object>()),
  localStorageClient: api,
}))

import { LocalStorageError } from './localStorageClient'
import { createDurableWorkspaceStorage } from './nativePersistence'

beforeEach(() => {
  vi.clearAllMocks()
  marker.mockResolvedValue(null)
  retain.mockResolvedValue('draft-key')
})
describe('native chart storage authority', () => {
  it('loads and persists the exact account namespace with catalog CAS, retaining stable retry IDs', async () => {
    api.context.mockResolvedValue({
      authenticated: true,
      activeOriginId: 'origin',
      principalId: 'alice',
    })
    api.native.mockResolvedValue({ catalog: { revision: 7 } })
    api.saveNative
      .mockRejectedValueOnce(new LocalStorageError('conflict', 'Other tab saved', 409))
      .mockResolvedValueOnce({})
    const storage = createDurableWorkspaceStorage({} as IDBFactory)
    expect(await storage.read('oa-trading:alice')).toEqual({ revision: 7 })
    const catalog = { revision: 8 } as WorkspaceCatalog
    await expect(storage.write('oa-trading:alice', catalog, 7)).rejects.toMatchObject({
      name: 'WorkspaceConflictError',
    })
    expect(finish).not.toHaveBeenCalled()
    await storage.write('oa-trading:alice', catalog, 7)
    expect(api.saveNative.mock.calls[1]).toEqual(api.saveNative.mock.calls[0])
    expect(api.saveNative.mock.calls[0].slice(0, 5)).toEqual([
      'workspace',
      'oa-trading:alice',
      'origin',
      catalog,
      7,
    ])
    expect(browser.write).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledWith('draft-key', api.saveNative.mock.calls[0][5])
  })
  it('blocks native source fallback after local sign-out', async () => {
    marker.mockResolvedValue({ principalId: 'alice', originId: 'origin' })
    api.context.mockResolvedValue({ authenticated: false })
    await expect(
      createDurableWorkspaceStorage({} as IDBFactory).read('oa-trading:alice')
    ).rejects.toMatchObject({ status: 401 })
    expect(browser.read).not.toHaveBeenCalled()
  })

  it('keeps an old chart request out of a new account even when origin IDs match', async () => {
    const auth = useAuthStore.getState()
    auth.setLocalAccount('Alice', 'alice')
    try {
      api.context.mockResolvedValue({
        authenticated: true,
        activeOriginId: 'origin',
        principalId: 'alice',
      })
      let release!: (value: string) => void
      retain.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve
        })
      )
      const storage = createDurableWorkspaceStorage({} as IDBFactory)
      const writing = storage.write('oa-trading:alice', { revision: 8 } as WorkspaceCatalog, 7)
      const rejected = expect(writing).rejects.toMatchObject({ code: 'auth.changed' })
      await vi.waitFor(() => expect(retain).toHaveBeenCalledOnce())
      expect(retain.mock.calls[0].at(-1)).toBe('alice')
      auth.setLocalAccount('Bob', 'bob')
      release('alice-draft')
      await rejected
      expect(api.saveNative).not.toHaveBeenCalled()
      expect(finish).not.toHaveBeenCalled()
    } finally {
      auth.logout()
    }
  })
})
