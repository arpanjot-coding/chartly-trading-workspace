import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rows, api, seed, source, cacheHooks } = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  api: { context: vi.fn(), workspace: vi.fn(), save: vi.fn(), savePreferences: vi.fn() },
  seed: vi.fn(),
  source: vi.fn(),
  cacheHooks: { get: vi.fn(), put: vi.fn() },
}))
vi.mock('dexie', () => ({
  default: class {
    transaction(_mode: string, ...args: unknown[]) {
      return (args.at(-1) as () => Promise<unknown>)()
    }
    version() {
      return { stores() {} }
    }
    table(name: string) {
      return {
        get: async (key: string) => {
          await cacheHooks.get(name, key)
          return rows.get(`${name}:${key}`)
        },
        put: async (row: { key: string }) => {
          await cacheHooks.put(name, row)
          rows.set(`${name}:${row.key}`, structuredClone(row))
        },
        delete: async (key: string) => {
          rows.delete(`${name}:${key}`)
        },
        toArray: async () =>
          [...rows.entries()].filter(([key]) => key.startsWith(`${name}:`)).map(([, row]) => row),
      }
    }
  },
}))
vi.mock('./db', () => ({ ensureTraderSeed: seed, traderDb: {} }))
vi.mock('./browserSnapshot', async (original) => ({
  ...(await original<object>()),
  readBrowserTables: source,
}))
vi.mock('./localStorageClient', async (original) => ({
  ...(await original<object>()),
  localStorageClient: api,
}))

import { emptyTraderTables } from './browserSnapshot'
import { LocalStorageError } from './localStorageClient'

beforeEach(() => {
  rows.clear()
  localStorage.clear()
  vi.clearAllMocks()
  cacheHooks.get.mockReset()
  cacheHooks.put.mockReset()
  source.mockResolvedValue(emptyTraderTables())
})
afterEach(() => vi.useRealTimers())
describe('durable journal authority', () => {
  async function preferenceFixture() {
    const store = await import('./dataPersistence')
    store.resetAccountBinding()
    const state = {
      originId: 'preference-source',
      revision: 2,
      tables: emptyTraderTables(),
      active: true,
      preferences: { 'oa-agent-model': '2' },
    }
    const context = {
      authenticated: true,
      principalId: 'alice',
      activeOriginId: state.originId,
      setupRequired: false,
      workspaces: [],
    }
    api.context.mockResolvedValue(context)
    api.workspace.mockResolvedValue(state)
    await store.acceptWorkspace(state, context)
    localStorage.setItem('oa-agent-model', '3')
    return { store, state, context }
  }
  function deferred() {
    let resolve!: (value?: unknown) => void
    const promise = new Promise((done) => {
      resolve = done
    })
    return { promise, resolve }
  }
  function interruptedPreference(originId: string) {
    const draft = {
      key: `preferences:alice:${originId}`,
      kind: 'preferences',
      principalId: 'alice',
      originId,
      requestId: 'interrupted-request',
      preferences: {},
      expectedPreferences: {},
    }
    rows.set(`pending:${draft.key}`, draft)
  }
  it('retains an old owner draft and sends no save when the account changes during IndexedDB put', async () => {
    const { store, state, context } = await preferenceFixture()
    const pendingPut = deferred()
    cacheHooks.put.mockImplementation((name) =>
      name === 'pending' ? pendingPut.promise : undefined
    )
    const saving = store.saveBackendTables(store.currentBinding()!, emptyTraderTables())
    const rejected = expect(saving).rejects.toMatchObject({ code: 'auth.changed' })
    await vi.waitFor(() =>
      expect(cacheHooks.put).toHaveBeenCalledWith('pending', expect.anything())
    )
    store.resetAccountBinding()
    await store.acceptWorkspace(state, { ...context, principalId: 'bob' })
    const bobStatus = store.persistenceStatus()
    pendingPut.resolve()
    await rejected
    expect(api.save).not.toHaveBeenCalled()
    expect([...rows.values()]).toContainEqual(
      expect.objectContaining({ kind: 'tables', principalId: 'alice', workspace: state })
    )
    expect(store.currentBinding()?.principalId).toBe('bob')
    expect(store.persistenceStatus()).toBe(bobStatus)
    expect(await store.activationMarker()).toEqual({ principalId: 'bob', originId: state.originId })
  })
  it('does not retry or remove a former owner draft after an account switch during its IndexedDB read', async () => {
    const { store, state, context } = await preferenceFixture()
    const draftKey = `alice:${state.originId}`
    rows.set(`pending:${draftKey}`, {
      key: draftKey,
      principalId: 'alice',
      workspace: state,
      tables: state.tables,
      requestId: 'original-request',
    })
    const pendingRead = deferred()
    cacheHooks.get.mockImplementation((name) =>
      name === 'pending' ? pendingRead.promise : undefined
    )
    const retrying = store.retryPendingSave()
    const rejected = expect(retrying).rejects.toMatchObject({ code: 'auth.changed' })
    await vi.waitFor(() => expect(cacheHooks.get).toHaveBeenCalledWith('pending', draftKey))
    store.resetAccountBinding()
    await store.acceptWorkspace(state, { ...context, principalId: 'bob' })
    const bobStatus = store.persistenceStatus()
    pendingRead.resolve()
    await rejected
    expect(api.save).not.toHaveBeenCalled()
    expect(rows.has(`pending:${draftKey}`)).toBe(true)
    expect(store.currentBinding()?.principalId).toBe('bob')
    expect(store.persistenceStatus()).toBe(bobStatus)
  })
  it('passes the captured principal and live owner predicate to the workspace transport', async () => {
    const { store, state } = await preferenceFixture()
    api.save.mockResolvedValueOnce({ ...state, revision: 3 })
    await store.saveBackendTables(store.currentBinding()!, emptyTraderTables())
    expect(api.save).toHaveBeenCalledWith(state, state.tables, expect.any(String), {
      principalId: 'alice',
      isCurrent: expect.any(Function),
    })
    const isCurrent = api.save.mock.calls[0][3].isCurrent
    expect(isCurrent()).toBe(true)
    store.resetAccountBinding()
    expect(isCurrent()).toBe(false)
  })
  it('never activates a stale workspace after the former account finishes its snapshot write', async () => {
    const { store, state, context } = await preferenceFixture()
    store.resetAccountBinding()
    const started = deferred()
    const paused = deferred()
    cacheHooks.put.mockImplementation((name, row) => {
      if (name === 'snapshots' && row.key === `alice:${state.originId}`) {
        started.resolve()
        return paused.promise
      }
    })
    const old = store.loadTraderBinding()
    const rejected = expect(old).rejects.toMatchObject({ code: 'auth.changed' })
    await started.promise
    store.resetAccountBinding()
    const bob = { ...state, preferences: { 'oa-agent-model': '8' } }
    await store.acceptWorkspace(bob, { ...context, principalId: 'bob' })
    paused.resolve()
    await rejected
    expect(store.currentBinding()?.principalId).toBe('bob')
    expect(localStorage.getItem('oa-agent-model')).toBe('8')
    expect(await store.activationMarker()).toEqual({ principalId: 'bob', originId: state.originId })
    localStorage.removeItem('chartly.storage.activation.v1')
    expect(await store.activationMarker()).toEqual({ principalId: 'bob', originId: state.originId })
  })

  it('keeps the new origin when an earlier explicit hydration finishes later', async () => {
    const { store, state, context } = await preferenceFixture()
    const started = deferred()
    const paused = deferred()
    cacheHooks.put.mockImplementation((name, row) => {
      if (name === 'snapshots' && row.key === `alice:${state.originId}`) {
        started.resolve()
        return paused.promise
      }
    })
    const old = store.acceptWorkspace(state, context)
    const rejected = expect(old).rejects.toMatchObject({ code: 'auth.changed' })
    await started.promise
    const next = { ...state, originId: 'other-source', preferences: { 'oa-agent-model': '8' } }
    await store.acceptWorkspace(next, { ...context, activeOriginId: next.originId })
    paused.resolve()
    await rejected
    expect(store.currentBinding()?.workspace?.originId).toBe(next.originId)
    expect(localStorage.getItem('oa-agent-model')).toBe('8')
    expect(await store.activationMarker()).toEqual({
      principalId: 'alice',
      originId: next.originId,
    })
  })
  it('does not call an active preference save interrupted when chart evidence reloads the journal', async () => {
    const { store } = await preferenceFixture()
    const request = deferred()
    api.savePreferences.mockReturnValueOnce(request.promise)
    const saving = store.persistPreferences()
    await vi.waitFor(() => expect(api.savePreferences).toHaveBeenCalledOnce())
    await store.loadTraderBinding()
    expect(store.persistenceStatus()).toMatchObject({ phase: 'saved', pending: false })
    expect(store.persistenceStatus().message).not.toContain('interrupted')
    request.resolve()
    await saving
    expect(await store.retainedWorkspaceDrafts()).toEqual([])
  })
  it('keeps an older draft and its notice when a later preference write succeeds', async () => {
    const { store, state } = await preferenceFixture()
    interruptedPreference(state.originId)
    await store.loadTraderBinding()
    expect(store.persistenceStatus()).toMatchObject({ phase: 'saved', pending: true })
    api.savePreferences.mockResolvedValueOnce(undefined)
    await store.persistPreferences()
    expect(store.persistenceStatus()).toMatchObject({ phase: 'saved', pending: true })
    expect(await store.retainedWorkspaceDrafts()).toMatchObject([
      { requestId: 'interrupted-request' },
    ])
  })
  it('retains the interruption notice while a different chart draft remains pending', async () => {
    const { store, state } = await preferenceFixture()
    const native = {
      key: 'native-draft',
      kind: 'native',
      principalId: 'alice',
      originId: state.originId,
      requestId: 'chart-request',
    }
    rows.set(`pending:${native.key}`, native)
    await store.loadTraderBinding()
    const notice = store.persistenceStatus()
    api.savePreferences.mockResolvedValueOnce(undefined)
    await store.persistPreferences()
    expect(store.persistenceStatus()).toBe(notice)
    expect(await store.retainedWorkspaceDrafts()).toEqual([native])
  })
  it.each([
    'saving',
    'error',
    'conflict',
  ] as const)('does not replace a financial %s status on preference success', async (phase) => {
    const { store, state } = await preferenceFixture()
    interruptedPreference(state.originId)
    await store.loadTraderBinding()
    const request = deferred()
    api.savePreferences.mockReturnValueOnce(request.promise)
    const saving = store.persistPreferences()
    await vi.waitFor(() => expect(api.savePreferences).toHaveBeenCalledOnce())
    store.reportJournalPersistence(phase, 'Current financial record status')
    const financialStatus = store.persistenceStatus()
    request.resolve()
    await saving
    expect(store.persistenceStatus()).toBe(financialStatus)
  })
  it('does not clear a later preference request when an earlier response arrives', async () => {
    const { store } = await preferenceFixture()
    const first = deferred(),
      second = deferred()
    api.savePreferences.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const savingFirst = store.persistPreferences()
    await vi.waitFor(() => expect(api.savePreferences).toHaveBeenCalledTimes(1))
    localStorage.setItem('oa-agent-model', '4')
    const savingSecond = store.persistPreferences()
    await vi.waitFor(() => expect(api.savePreferences).toHaveBeenCalledTimes(2))
    const secondId = api.savePreferences.mock.calls[1][2]
    first.resolve()
    await savingFirst
    expect(await store.retainedWorkspaceDrafts()).toMatchObject([
      { requestId: secondId, preferences: { 'oa-agent-model': '4' } },
    ])
    second.resolve()
    await savingSecond
    expect(await store.retainedWorkspaceDrafts()).toEqual([])
  })
  it('keeps a new account status and preferences when a former account save finishes', async () => {
    const { store, state } = await preferenceFixture()
    const request = deferred()
    api.savePreferences.mockReturnValueOnce(request.promise)
    const saving = store.persistPreferences()
    await vi.waitFor(() => expect(api.savePreferences).toHaveBeenCalledOnce())
    store.resetAccountBinding()
    const bob = { ...state, originId: 'bob-source', preferences: { 'oa-agent-model': '8' } }
    await store.acceptWorkspace(bob, {
      authenticated: true,
      principalId: 'bob',
      activeOriginId: bob.originId,
      setupRequired: false,
      workspaces: [],
    })
    store.reportJournalPersistence('saving', 'Bob financial save')
    const currentStatus = store.persistenceStatus()
    request.resolve()
    await saving
    expect(store.persistenceStatus()).toBe(currentStatus)
    expect(store.currentBinding()?.workspace?.preferences).toEqual({ 'oa-agent-model': '8' })
  })
  it('does not roll a reloaded newer preference baseline back when an older committed response arrives last', async () => {
    const { store, state } = await preferenceFixture()
    const first = deferred()
    api.savePreferences.mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined)
    const savingFirst = store.persistPreferences()
    await vi.waitFor(() => expect(api.savePreferences).toHaveBeenCalledTimes(1))
    // The server committed A, but its response has not reached this tab yet.
    api.workspace.mockResolvedValue({ ...state, preferences: { 'oa-agent-model': '3' } })
    await store.loadTraderBinding()
    localStorage.setItem('oa-agent-model', '4')
    await store.persistPreferences()
    expect(api.savePreferences.mock.calls[1][3]).toEqual({ 'oa-agent-model': '3' })
    expect(store.currentBinding()?.workspace?.preferences).toEqual({ 'oa-agent-model': '4' })
    first.resolve()
    await savingFirst
    expect(store.currentBinding()?.workspace?.preferences).toEqual({ 'oa-agent-model': '4' })
    expect(await store.retainedWorkspaceDrafts()).toEqual([])
  })
  it('coalesces automatic chart preference saves behind the active request and uses its accepted baseline', async () => {
    const { store } = await preferenceFixture()
    vi.useFakeTimers()
    const first = deferred(),
      second = deferred()
    api.savePreferences.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const reports: ReturnType<typeof store.persistenceStatus>[] = []
    const unsubscribe = store.subscribePersistence(() => reports.push(store.persistenceStatus()))
    store.schedulePreferenceSave()
    await vi.advanceTimersByTimeAsync(350)
    expect(api.savePreferences).toHaveBeenCalledTimes(1)
    localStorage.setItem('oa-agent-model', '4')
    store.schedulePreferenceSave()
    await vi.advanceTimersByTimeAsync(350)
    expect(api.savePreferences).toHaveBeenCalledTimes(1)
    localStorage.setItem('oa-agent-model', '5')
    store.schedulePreferenceSave()
    await vi.advanceTimersByTimeAsync(350)
    expect(api.savePreferences).toHaveBeenCalledTimes(1)
    first.resolve()
    await vi.advanceTimersByTimeAsync(350)
    expect(api.savePreferences).toHaveBeenCalledTimes(2)
    expect(api.savePreferences.mock.calls[1][1]).toEqual({ 'oa-agent-model': '5' })
    expect(api.savePreferences.mock.calls[1][3]).toEqual({ 'oa-agent-model': '3' })
    second.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(reports.some((status) => status.phase === 'error' || status.phase === 'conflict')).toBe(
      false
    )
    expect(await store.retainedWorkspaceDrafts()).toEqual([])
    unsubscribe()
  })
  it('clears its own earlier preference error after a later automatic save succeeds', async () => {
    const { store } = await preferenceFixture()
    vi.useFakeTimers()
    api.savePreferences
      .mockRejectedValueOnce(new Error('Temporary preference transport failure'))
      .mockResolvedValueOnce(undefined)
    store.schedulePreferenceSave()
    await vi.advanceTimersByTimeAsync(350)
    expect(store.persistenceStatus()).toMatchObject({ phase: 'error', pending: true })
    store.schedulePreferenceSave()
    await vi.advanceTimersByTimeAsync(350)
    expect(api.savePreferences).toHaveBeenCalledTimes(2)
    expect(await store.retainedWorkspaceDrafts()).toEqual([])
    expect(store.persistenceStatus()).toMatchObject({ phase: 'saved', pending: false })
    expect(store.persistenceStatus().message).not.toContain('could not be saved')
  })
  it('clears its own earlier preference error after an explicit same-request retry succeeds', async () => {
    const { store } = await preferenceFixture()
    api.savePreferences
      .mockRejectedValueOnce(new Error('Temporary preference transport failure'))
      .mockResolvedValueOnce(undefined)
    await expect(store.persistPreferences()).rejects.toThrow(
      'Temporary preference transport failure'
    )
    expect(store.persistenceStatus().phase).toBe('error')
    await store.retryPreferenceSave()
    expect(api.savePreferences.mock.calls[1]).toEqual(api.savePreferences.mock.calls[0])
    expect(await store.retainedWorkspaceDrafts()).toEqual([])
    expect(store.persistenceStatus()).toMatchObject({ phase: 'saved', pending: false })
  })
  it.each([
    'saving',
    'error',
    'conflict',
  ] as const)('preserves a financial %s status while an explicit preference retry succeeds', async (phase) => {
    const { store } = await preferenceFixture()
    api.savePreferences
      .mockRejectedValueOnce(new Error('Temporary preference transport failure'))
      .mockResolvedValueOnce(undefined)
    await expect(store.persistPreferences()).rejects.toThrow()
    store.reportJournalPersistence(phase, 'Retained financial record status')
    const financial = store.persistenceStatus()
    await store.retryPreferenceSave()
    expect(store.persistenceStatus()).toBe(financial)
    expect(await store.retainedWorkspaceDrafts()).toEqual([])
  })
  it('does not dismiss a pending notice when another chart draft remains after preference retry', async () => {
    const { store, state } = await preferenceFixture()
    api.savePreferences
      .mockRejectedValueOnce(new Error('Temporary preference transport failure'))
      .mockResolvedValueOnce(undefined)
    await expect(store.persistPreferences()).rejects.toThrow()
    const native = {
      key: 'separate-chart-draft',
      kind: 'native',
      principalId: 'alice',
      originId: state.originId,
      requestId: 'native-request',
    }
    rows.set(`pending:${native.key}`, native)
    const notice = store.persistenceStatus()
    await store.retryPreferenceSave()
    expect(store.persistenceStatus()).toBe(notice)
    expect(await store.retainedWorkspaceDrafts()).toEqual([native])
  })
  it('does not publish a former account preference retry into the new account status or baseline', async () => {
    const { store, state } = await preferenceFixture()
    const retry = deferred()
    api.savePreferences
      .mockRejectedValueOnce(new Error('Temporary preference transport failure'))
      .mockReturnValueOnce(retry.promise)
    await expect(store.persistPreferences()).rejects.toThrow()
    const saving = store.retryPreferenceSave()
    await vi.waitFor(() => expect(api.savePreferences).toHaveBeenCalledTimes(2))
    store.resetAccountBinding()
    const bob = { ...state, originId: 'bob-retry-source', preferences: { 'oa-agent-model': '8' } }
    await store.acceptWorkspace(bob, {
      authenticated: true,
      principalId: 'bob',
      activeOriginId: bob.originId,
      setupRequired: false,
      workspaces: [],
    })
    store.reportJournalPersistence('error', 'Bob current financial error')
    const bobStatus = store.persistenceStatus()
    retry.resolve()
    await saving
    expect(store.persistenceStatus()).toBe(bobStatus)
    expect(store.currentBinding()?.workspace?.preferences).toEqual({ 'oa-agent-model': '8' })
  })
  it('loads the authenticated active source after browser cache clearing', async () => {
    const store = await import('./dataPersistence')
    store.resetAccountBinding()
    const state = {
      originId: 'saved-origin',
      revision: 4,
      tables: emptyTraderTables(),
      active: true,
    }
    api.context.mockResolvedValue({
      authenticated: true,
      principalId: 'alice',
      activeOriginId: state.originId,
    })
    api.workspace.mockResolvedValue(state)
    const binding = await store.loadTraderBinding()
    expect(binding.kind).toBe('backend')
    expect(api.workspace).toHaveBeenCalledWith('saved-origin')
    expect(seed).not.toHaveBeenCalled()
    expect(source).not.toHaveBeenCalled()
  })
  it('does not expose an old browser source when another account has no active migration', async () => {
    const store = await import('./dataPersistence')
    store.resetAccountBinding()
    localStorage.setItem(
      'chartly.storage.activation.v1',
      JSON.stringify({ principalId: 'alice', originId: 'saved-origin' })
    )
    api.context.mockResolvedValue({ authenticated: true, principalId: 'bob', activeOriginId: null })
    await expect(store.loadTraderBinding()).rejects.toMatchObject({ status: 401 })
    expect(source).not.toHaveBeenCalled()
  })
  it('retains a failed CAS save and retries the same revision and request ID', async () => {
    const store = await import('./dataPersistence')
    store.resetAccountBinding()
    const state = {
      originId: 'saved-origin',
      revision: 3,
      tables: emptyTraderTables(),
      active: true,
    }
    const context = {
      authenticated: true,
      principalId: 'alice',
      activeOriginId: state.originId,
      workspaces: [],
      setupRequired: false,
    }
    api.context.mockResolvedValue(context)
    api.workspace.mockResolvedValue(state)
    const binding = await store.acceptWorkspace(state, context)
    const changed = emptyTraderTables()
    changed.portfolios.push({ id: 19, name: 'Preserved draft' } as never)
    api.save
      .mockRejectedValueOnce(new LocalStorageError('revision.conflict', 'Newer records exist', 409))
      .mockResolvedValueOnce({ ...state, revision: 4, tables: changed })
    await expect(store.saveBackendTables(binding, changed)).rejects.toMatchObject({ status: 409 })
    expect(store.persistenceStatus().phase).toBe('conflict')
    expect(await store.retainedDraft()).toEqual(changed)
    await store.retryPendingSave()
    expect(api.save.mock.calls[1].slice(0, 3)).toEqual(api.save.mock.calls[0].slice(0, 3))
    expect(api.save.mock.calls[1][3]).toEqual({
      principalId: 'alice',
      isCurrent: expect.any(Function),
    })
    expect(await store.retainedDraft()).toBeNull()
  })
  it('never seeds a replacement when a migrated source cannot load', async () => {
    const store = await import('./dataPersistence')
    store.resetAccountBinding()
    localStorage.setItem(
      'chartly.storage.activation.v1',
      JSON.stringify({ principalId: 'alice', originId: 'saved-origin' })
    )
    api.context.mockRejectedValue(new LocalStorageError('storage.offline', 'Engine unavailable'))
    await expect(store.loadTraderBinding()).rejects.toThrow('Engine unavailable')
    expect(seed).not.toHaveBeenCalled()
    expect(source).not.toHaveBeenCalled()
  })
  it('retains preference conflicts against their original baseline after restore or another tab', async () => {
    const store = await import('./dataPersistence')
    store.resetAccountBinding()
    const state = {
      originId: 'source',
      revision: 2,
      tables: emptyTraderTables(),
      active: true,
      preferences: { 'oa-agent-model': '2' },
    }
    const context = {
      authenticated: true,
      principalId: 'alice',
      activeOriginId: 'source',
      setupRequired: false,
      workspaces: [],
    }
    api.context.mockResolvedValue(context)
    await store.acceptWorkspace(state, context)
    localStorage.setItem('oa-agent-model', '3')
    api.savePreferences.mockRejectedValue(
      new LocalStorageError('preferences.conflict', 'Preferences changed in another tab', 409)
    )
    await expect(store.persistPreferences()).rejects.toMatchObject({ status: 409 })
    expect(api.savePreferences.mock.calls[0][3]).toEqual({ 'oa-agent-model': '2' })
    api.workspace.mockResolvedValue({ ...state, preferences: { 'oa-agent-model': '4' } })
    await expect(store.retryPreferenceSave()).rejects.toMatchObject({ status: 409 })
    expect(api.savePreferences.mock.calls[1]).toEqual(api.savePreferences.mock.calls[0])
    expect((await store.retainedWorkspaceDrafts())[0]).toMatchObject({
      preferences: { 'oa-agent-model': '3' },
      expectedPreferences: { 'oa-agent-model': '2' },
    })
    await store.archivePendingDrafts()
    expect(await store.retainedWorkspaceDrafts()).toEqual([])
    expect(await store.archivedWorkspaceDrafts()).toHaveLength(1)
  })
})
