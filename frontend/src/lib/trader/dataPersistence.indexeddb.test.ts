import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { emptyTraderTables } from './browserSnapshot'

const { api } = vi.hoisted(() => ({
  api: { context: vi.fn(), savePreferences: vi.fn(), save: vi.fn() },
}))

import { LocalStorageError, type WorkspaceState } from './localStorageClient'

vi.mock('./localStorageClient', async (original) => ({
  ...(await original<object>()),
  localStorageClient: api,
}))

describe('chart preference save with actual IndexedDB transactions', () => {
  it('deletes only its completed durable request without reporting a storage error', async () => {
    const store = await import('./dataPersistence')
    store.resetAccountBinding()
    localStorage.clear()
    const state = {
      originId: `preferences-${crypto.randomUUID()}`,
      revision: 1,
      tables: emptyTraderTables(),
      active: true,
      preferences: { 'oa-agent-model': '2' },
    }
    const context = {
      authenticated: true,
      principalId: 'indexeddb-owner',
      activeOriginId: state.originId,
      setupRequired: false,
      workspaces: [],
    }
    api.context.mockResolvedValue(context)
    api.savePreferences.mockResolvedValue({ generation: 2 })
    await store.acceptWorkspace(state, context)
    localStorage.setItem('oa-agent-model', '3')
    await store.persistPreferences()
    expect(api.savePreferences).toHaveBeenCalledOnce()
    expect(await store.retainedWorkspaceDrafts()).toEqual([])
    expect(store.currentBinding()?.workspace?.preferences).toEqual({ 'oa-agent-model': '3' })
    expect(store.persistenceStatus()).toMatchObject({ phase: 'saved', pending: false })
    store.resetAccountBinding()
  })

  it('retains the losing tab’s exact draft after the winning tab completes', async () => {
    const tabA = await import('./dataPersistence')
    tabA.resetAccountBinding()
    localStorage.clear()
    const state = {
      originId: `two-tabs-${crypto.randomUUID()}`,
      revision: 1,
      tables: emptyTraderTables(),
      active: true,
    }
    const context = {
      authenticated: true,
      principalId: 'indexeddb-owner',
      activeOriginId: state.originId,
      setupRequired: false,
      workspaces: [],
    }
    api.context.mockResolvedValue(context)
    const first = await tabA.acceptWorkspace(state, context)
    // Independent module instances have separate tab-local write queues and share IndexedDB.
    vi.resetModules()
    const tabB = await import('./dataPersistence')
    const second = await tabB.acceptWorkspace(state, context)
    const tablesA = emptyTraderTables()
    const tablesB = emptyTraderTables()
    tablesA.portfolios.push({ id: 19, name: 'Tab A' } as never)
    tablesB.portfolios.push({ id: 19, name: 'Tab B' } as never)
    let commitA!: (value: WorkspaceState) => void
    let conflictB!: (reason: Error) => void
    api.save.mockImplementation((_previous, tables) =>
      tables === tablesA
        ? new Promise((resolve) => {
            commitA = resolve
          })
        : new Promise((_resolve, reject) => {
            conflictB = reject
          })
    )

    const winning = tabA.saveBackendTables(first, tablesA)
    const losing = tabB.saveBackendTables(second, tablesB)
    const rejected = expect(losing).rejects.toMatchObject({ status: 409 })
    await vi.waitFor(() => expect(api.save).toHaveBeenCalledTimes(2))
    const requestB = api.save.mock.calls.find((call) => call[1] === tablesB)?.[2]
    expect(requestB).toBeTruthy()
    commitA({ ...state, revision: 2, tables: tablesA })
    await winning
    conflictB(new LocalStorageError('storage.revision_conflict', 'The other tab saved first.', 409))
    await rejected

    tabB.resetAccountBinding()
    expect(await tabB.retainedDraft()).toEqual(tablesB)
    expect(await tabB.retainedWorkspaceDrafts()).toEqual([
      expect.objectContaining({ requestId: requestB, tables: tablesB, workspace: state }),
    ])
  })
})
