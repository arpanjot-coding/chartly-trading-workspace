import Dexie from 'dexie'
import { useAuthStore } from '@/stores/authStore'
import {
  browserOrigin,
  clearRuntimePreferences,
  emptyTraderTables,
  readBrowserTables,
  readPreferences,
  restoreNativeState,
  type TraderTables,
} from './browserSnapshot'
import { COMBINED_SELECTION_KEY, combinedSelectionKey } from './combinedSelection'
import { ensureTraderSeed } from './db'
import {
  type LocalContext,
  LocalStorageError,
  localStorageClient,
  type WorkspaceState,
} from './localStorageClient'

const MARKER = 'chartly.storage.activation.v1'
const EVENT = 'chartly:storage-changed'
const cache = new Dexie('ChartlyDurableCache')
cache.version(1).stores({ snapshots: '&key', pending: '&key', controls: '&key' })
interface Marker {
  principalId: string
  originId: string
}
export interface DataBinding {
  kind: 'browser' | 'backend'
  tables: TraderTables
  workspace?: WorkspaceState
  principalId?: string
  readOnly?: boolean
}
export interface PersistenceStatus {
  phase: 'browser' | 'loading' | 'saved' | 'saving' | 'error' | 'conflict' | 'signin'
  message: string
  backend: boolean
  pending: boolean
}
let status: PersistenceStatus = {
  phase: 'browser',
  message: 'Records are stored in this browser.',
  backend: false,
  pending: false,
}
let binding: DataBinding | null = null
let loading: Promise<DataBinding> | null = null
let sessionEpoch = 0
let writeQueue = Promise.resolve()
let preferenceTimer: ReturnType<typeof setTimeout> | undefined
let scheduledPreferenceSave: Promise<void> | null = null
let preferenceSaveAgain = false
let hydratedPreferences: string | null = null
let preferenceWriterId: string | undefined
const preferenceRequests = new Map<string, 'saving' | 'saved'>()
interface PreferenceNotice {
  status: PersistenceStatus
  principalId: string
  originId: string
}
let pendingLoadNotice: PreferenceNotice | null = null
let preferenceFailureNotice: PreferenceNotice | null = null
const listeners = new Set<() => void>()
export const persistenceStatus = () => status
export function reportJournalPersistence(
  phase: 'saving' | 'error' | 'conflict',
  message: string,
  pending = true
) {
  report({ phase, message, backend: true, pending })
}
export function subscribePersistence(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
function report(next: PersistenceStatus) {
  status = next
  for (const listener of listeners) listener()
}
const key = (principalId: string, originId: string) => `${principalId}:${originId}`
function ensureScope(isCurrent: () => boolean) {
  if (!isCurrent())
    throw new LocalStorageError(
      'auth.changed',
      'Account or workspace changed. Reopen the correct workspace.',
      401
    )
}

function publicationGuard() {
  const epoch = sessionEpoch
  const principalId = useAuthStore.getState().localPrincipalId
  return () => epoch === sessionEpoch && useAuthStore.getState().localPrincipalId === principalId
}

function browserActivationMarker(): Marker | null {
  try {
    const raw = localStorage.getItem(MARKER)
    if (raw) {
      const marker = JSON.parse(raw)
      if (typeof marker?.principalId === 'string' && typeof marker?.originId === 'string')
        return marker
    }
  } catch {
    /* try durable control record */
  }
  return null
}

export async function activationMarker(): Promise<Marker | null> {
  return (
    browserActivationMarker() ??
    (
      await cache
        .table('controls')
        .get('active')
        .catch(() => null)
    )?.value ??
    null
  )
}
async function remember(principalId: string, state: WorkspaceState, isCurrent: () => boolean) {
  const marker = { principalId, originId: state.originId }
  await cache.table('snapshots').put({ key: key(principalId, state.originId), value: state })
  ensureScope(isCurrent)
  await cache.transaction('rw', cache.table('controls'), async () => {
    ensureScope(isCurrent)
    await cache.table('controls').put({ key: 'active', value: marker })
    ensureScope(isCurrent)
  })
  ensureScope(isCurrent)
}

function publishMarker(principalId: string, originId: string) {
  try {
    localStorage.setItem(MARKER, JSON.stringify({ principalId, originId }))
  } catch {
    /* IndexedDB marker remains authoritative for cache routing */
  }
}
export function notifyStorageChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(EVENT))
  try {
    localStorage.setItem('chartly.storage.change.v1', crypto.randomUUID())
  } catch {
    /* current window already notified */
  }
}
export function subscribeStorageChanges(listener: () => void) {
  if (typeof window === 'undefined') return () => {}
  const remote = (event: StorageEvent) => {
    if (event.key === 'chartly.storage.change.v1') listener()
  }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', remote)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', remote)
  }
}
function invalidateBinding() {
  sessionEpoch++
  preferenceRequests.clear()
  pendingLoadNotice = null
  preferenceFailureNotice = null
  binding = null
  loading = null
  hydratedPreferences = null
  clearTimeout(preferenceTimer)
  scheduledPreferenceSave = null
  preferenceSaveAgain = false
}

export function resetAccountBinding() {
  let hasActivation = !!hydratedPreferences
  try {
    hasActivation ||= !!localStorage.getItem(MARKER)
  } catch {
    /* durable load still verifies identity */
  }
  if (hasActivation) clearRuntimePreferences()
  invalidateBinding()
  notifyStorageChanged()
}
if (typeof window !== 'undefined') {
  window.addEventListener('chartly:local-session-changed', resetAccountBinding)
  useAuthStore.subscribe((next, previous) => {
    if (next.localPrincipalId !== previous.localPrincipalId && (binding || loading))
      resetAccountBinding()
  })
  window.addEventListener('storage', (event) => {
    if (event.key !== MARKER || event.newValue === event.oldValue) return
    // Other tabs share this marker and the preference mirror. Drop the old
    // in-memory binding without clearing the other tab's freshly hydrated data.
    invalidateBinding()
    window.dispatchEvent(new Event(EVENT))
  })
}

export async function acceptWorkspace(
  state: WorkspaceState,
  context?: LocalContext
): Promise<DataBinding> {
  let isCurrent = publicationGuard()
  const ctx = context ?? (await localStorageClient.context())
  ensureScope(isCurrent)
  if (!ctx.authenticated || !ctx.principalId)
    throw new LocalStorageError('auth.required', 'Sign in to access saved records.', 401)
  const principal = useAuthStore.getState().localPrincipalId
  ensureScope(
    () => ctx.activeOriginId === state.originId && (!principal || principal === ctx.principalId)
  )
  // A verified activation supersedes any load or save still using the old source.
  if (binding?.workspace?.originId !== state.originId || binding?.principalId !== ctx.principalId) {
    invalidateBinding()
    isCurrent = publicationGuard()
  }
  await remember(ctx.principalId, state, isCurrent)
  ensureScope(isCurrent)
  restoreNativeState(state)
  ensureScope(isCurrent)
  hydratedPreferences = key(ctx.principalId, state.originId)
  binding = {
    kind: 'backend',
    tables: state.tables,
    workspace: state,
    principalId: ctx.principalId,
  }
  publishMarker(ctx.principalId, state.originId)
  report({ phase: 'saved', message: 'Saved to the local engine.', backend: true, pending: false })
  notifyStorageChanged()
  return binding
}

export async function loadTraderBinding(): Promise<DataBinding> {
  if (loading) return loading
  const isCurrent = publicationGuard()
  const pending = (async () => {
    const marker = await activationMarker()
    ensureScope(isCurrent)
    let verifiedPrincipal: string | undefined
    let verifiedOrigin: string | null | undefined
    try {
      const context = await localStorageClient.context()
      ensureScope(isCurrent)
      if (context.authenticated) {
        verifiedPrincipal = context.principalId
        verifiedOrigin = context.activeOriginId
      }
      if (context.authenticated && context.activeOriginId) {
        const state = await localStorageClient.workspace(context.activeOriginId)
        ensureScope(isCurrent)
        if (!context.principalId)
          throw new LocalStorageError(
            'auth.scope_missing',
            'Local account identity is unavailable.',
            401
          )
        const principal = useAuthStore.getState().localPrincipalId
        ensureScope(
          () =>
            state.originId === context.activeOriginId &&
            (!principal || principal === context.principalId)
        )
        await remember(context.principalId, state, isCurrent).catch(() => {})
        ensureScope(isCurrent)
        const drafts = await cache
          .table('pending')
          .toArray()
          .catch(() => [])
        ensureScope(isCurrent)
        if (hydratedPreferences !== key(context.principalId, state.originId)) {
          restoreNativeState(state)
          ensureScope(isCurrent)
          hydratedPreferences = key(context.principalId, state.originId)
        }
        binding = {
          kind: 'backend',
          tables: state.tables,
          workspace: state,
          principalId: context.principalId,
        }
        publishMarker(context.principalId, state.originId)
        const hasDraft = drafts.some(
          (draft) =>
            draft.principalId === context.principalId &&
            (draft.originId === state.originId || draft.workspace?.originId === state.originId) &&
            !(draft.kind === 'preferences' && preferenceRequests.has(draft.requestId))
        )
        const loadedStatus: PersistenceStatus = {
          phase: 'saved',
          message: hasDraft
            ? 'Saved records loaded. An interrupted save is retained for review.'
            : 'Saved to the local engine.',
          backend: true,
          pending: hasDraft,
        }
        pendingLoadNotice = hasDraft
          ? { status: loadedStatus, principalId: context.principalId, originId: state.originId }
          : null
        report(loadedStatus)
        return binding
      }
      if (marker) {
        clearRuntimePreferences()
        throw new LocalStorageError(
          'auth.required',
          'Sign in to access your durable workspace. The original browser copy is retained.',
          401
        )
      }
    } catch (error) {
      ensureScope(isCurrent)
      if (error instanceof LocalStorageError && error.code === 'auth.changed') throw error
      if (marker) {
        const authFailure = error instanceof LocalStorageError && error.status === 401
        if (
          !authFailure &&
          verifiedPrincipal === marker.principalId &&
          verifiedOrigin === marker.originId &&
          binding?.kind === 'backend' &&
          binding.principalId === marker.principalId
        ) {
          const saved = await cache
            .table('snapshots')
            .get(key(marker.principalId, marker.originId))
            .catch(() => null)
          ensureScope(isCurrent)
          if (saved) {
            binding = {
              kind: 'backend',
              tables: saved.value.tables,
              workspace: saved.value,
              principalId: marker.principalId,
              readOnly: true,
            }
            report({
              phase: 'error',
              message:
                'Local engine unavailable. Showing the last saved copy; reconnect before editing.',
              backend: true,
              pending: true,
            })
            return binding
          }
        }
        report({
          phase: authFailure ? 'signin' : 'error',
          message: error instanceof Error ? error.message : 'Saved records could not be loaded.',
          backend: true,
          pending: true,
        })
        throw error
      }
      // A browser-only user remains browser-only until an explicit verified migration.
    }
    await ensureTraderSeed()
    ensureScope(isCurrent)
    const tables = await readBrowserTables()
    ensureScope(isCurrent)
    binding = { kind: 'browser', tables }
    report({
      phase: 'browser',
      message: 'Records are stored in this browser. Set up durable storage in Settings.',
      backend: false,
      pending: false,
    })
    return binding
  })()
  loading = pending
  try {
    return await pending
  } finally {
    if (loading === pending) loading = null
  }
}

function workspaceSaveGuard(expected: DataBinding, epoch: number) {
  const principalId = expected.principalId
  const originId = expected.workspace?.originId
  const verifiedPrincipal = useAuthStore.getState().localPrincipalId
  const isCurrent = () => {
    const marker = browserActivationMarker()
    return (
      epoch === sessionEpoch &&
      useAuthStore.getState().localPrincipalId === verifiedPrincipal &&
      (!verifiedPrincipal || verifiedPrincipal === principalId) &&
      (!marker || (marker.principalId === principalId && marker.originId === originId)) &&
      binding?.kind === 'backend' &&
      binding.principalId === principalId &&
      binding.workspace?.originId === originId
    )
  }
  const ensureCurrent = () => {
    if (!isCurrent())
      throw new LocalStorageError(
        'auth.changed',
        'Account changed during save. Reopen the correct workspace.',
        401
      )
  }
  return { isCurrent, ensureCurrent }
}

interface WorkspaceDraft {
  key: string
  principalId: string
  workspace: WorkspaceState
  tables: TraderTables
  requestId: string
}

async function pendingTableDrafts(
  principalId: string,
  originId: string
): Promise<WorkspaceDraft[]> {
  // The original schema used one row per source. Keep those drafts readable and
  // retry them with their original request ID and revision.
  const pending = cache.table('pending')
  const legacy = await pending.get(key(principalId, originId))
  const drafts = (await pending.toArray()).filter(
    (draft) =>
      draft.kind === 'tables' &&
      draft.principalId === principalId &&
      draft.workspace?.originId === originId
  ) as WorkspaceDraft[]
  if (
    legacy?.tables &&
    legacy.principalId === principalId &&
    legacy.workspace?.originId === originId
  )
    drafts.unshift(legacy)
  return drafts
}

async function removePendingDraft(draft: { key: string; requestId: string }) {
  const pending = cache.table('pending')
  await cache.transaction('rw', pending, async () => {
    if ((await pending.get(draft.key))?.requestId === draft.requestId)
      await pending.delete(draft.key)
  })
}

export function saveBackendTables(
  expected: DataBinding,
  tables: TraderTables
): Promise<DataBinding> {
  const epoch = sessionEpoch
  const { isCurrent, ensureCurrent } = workspaceSaveGuard(expected, epoch)
  let result!: DataBinding
  const operation = writeQueue.then(async () => {
    if (expected.kind !== 'backend' || !expected.workspace || !expected.principalId)
      throw new LocalStorageError('storage.context_missing', 'Reload the workspace before saving.')
    if (expected.readOnly)
      throw new LocalStorageError(
        'storage.offline',
        'Reconnect the local engine and reload before editing.'
      )
    ensureCurrent()
    const requestId = crypto.randomUUID()
    const scopeKey = key(expected.principalId, expected.workspace.originId)
    const draft = {
      key: `tables:${scopeKey}:${requestId}`,
      kind: 'tables',
      principalId: expected.principalId,
      workspace: expected.workspace,
      tables,
      requestId,
    }
    report({
      phase: 'saving',
      message: 'Saving to the local engine…',
      backend: true,
      pending: true,
    })
    try {
      const retained = await pendingTableDrafts(expected.principalId, expected.workspace.originId)
      ensureCurrent()
      const savedDraft =
        retained.find(
          (item) =>
            item.workspace.revision === draft.workspace.revision &&
            JSON.stringify(item.tables) === JSON.stringify(tables)
        ) ?? draft
      if (savedDraft === draft) await cache.table('pending').put(draft)
      ensureCurrent()
      const state = await localStorageClient.save(
        savedDraft.workspace,
        savedDraft.tables,
        savedDraft.requestId,
        {
          isCurrent,
          principalId: expected.principalId,
        }
      )
      ensureCurrent()
      // A save refreshes only this owner's snapshot; it must not reactivate an old account.
      await cache.table('snapshots').put({ key: scopeKey, value: state })
      ensureCurrent()
      await removePendingDraft(savedDraft)
      ensureCurrent()
      binding = {
        kind: 'backend',
        tables: state.tables,
        workspace: state,
        principalId: expected.principalId,
      }
      result = binding
      report({
        phase: 'saved',
        message: 'Saved to the local engine.',
        backend: true,
        pending: retained.some((item) => item.key !== savedDraft.key),
      })
      notifyStorageChanged()
    } catch (error) {
      if (isCurrent())
        report({
          phase: error instanceof LocalStorageError && error.status === 409 ? 'conflict' : 'error',
          message: error instanceof Error ? error.message : 'Save failed. Your draft is retained.',
          backend: true,
          pending: true,
        })
      throw error
    }
  })
  writeQueue = operation.catch(() => {})
  return operation.then(() => result)
}
export async function retryPendingSave(): Promise<void> {
  const epoch = sessionEpoch
  const current = await loadTraderBinding()
  if (current.kind !== 'backend' || !current.principalId || !current.workspace) return
  const { isCurrent, ensureCurrent } = workspaceSaveGuard(current, epoch)
  const operation = writeQueue.then(async () => {
    ensureCurrent()
    const scopeKey = key(current.principalId!, current.workspace!.originId)
    const drafts = await pendingTableDrafts(current.principalId!, current.workspace!.originId)
    ensureCurrent()
    const [draft] = drafts
    if (!draft) return
    report({ phase: 'saving', message: 'Retrying interrupted save…', backend: true, pending: true })
    try {
      const state = await localStorageClient.save(draft.workspace, draft.tables, draft.requestId, {
        isCurrent,
        principalId: current.principalId,
      })
      ensureCurrent()
      await cache.table('snapshots').put({ key: scopeKey, value: state })
      ensureCurrent()
      await removePendingDraft(draft)
      ensureCurrent()
      binding = {
        kind: 'backend',
        tables: state.tables,
        workspace: state,
        principalId: current.principalId,
      }
      report({
        phase: 'saved',
        message: 'Saved to the local engine.',
        backend: true,
        pending: drafts.length > 1,
      })
      notifyStorageChanged()
    } catch (error) {
      if (isCurrent())
        report({
          phase: error instanceof LocalStorageError && error.status === 409 ? 'conflict' : 'error',
          message: error instanceof Error ? error.message : 'Retry failed; draft retained.',
          backend: true,
          pending: true,
        })
      throw error
    }
  })
  writeQueue = operation.catch(() => {})
  return operation
}
export function schedulePreferenceSave() {
  clearTimeout(preferenceTimer)
  if (binding?.kind !== 'backend') return
  preferenceTimer = setTimeout(() => {
    if (scheduledPreferenceSave) {
      preferenceSaveAgain = true
      return
    }
    preferenceSaveAgain = false
    const operation = persistPreferences()
    scheduledPreferenceSave = operation
    void operation
      .catch(() => {})
      .finally(() => {
        if (scheduledPreferenceSave !== operation) return
        scheduledPreferenceSave = null
        if (preferenceSaveAgain) {
          preferenceSaveAgain = false
          schedulePreferenceSave()
        }
      })
  }, 350)
}
async function clearOwnPreferenceNotice(principalId: string, originId: string, epoch: number) {
  const notice = [pendingLoadNotice, preferenceFailureNotice].find(
    (item) => item?.status === status
  )
  const sameOwner = () =>
    epoch === sessionEpoch &&
    binding?.principalId === principalId &&
    binding.workspace?.originId === originId
  if (!notice || notice.principalId !== principalId || notice.originId !== originId || !sameOwner())
    return
  const otherDrafts = (await cache.table('pending').toArray()).some(
    (draft) =>
      draft.principalId === principalId &&
      (draft.originId === originId || draft.workspace?.originId === originId)
  )
  if (!sameOwner() || status !== notice.status || otherDrafts) return
  if (pendingLoadNotice === notice) pendingLoadNotice = null
  if (preferenceFailureNotice === notice) preferenceFailureNotice = null
  report({ phase: 'saved', message: 'Saved to the local engine.', backend: true, pending: false })
}
export async function persistPreferences() {
  const current = binding
  if (current?.kind !== 'backend' || !current.workspace || !current.principalId) return
  const epoch = sessionEpoch
  const { isCurrent: sameOwner } = workspaceSaveGuard(current, epoch)
  ensureScope(sameOwner)
  const preferences = readPreferences()
  const expectedPreferences = structuredClone(current.workspace.preferences ?? {})
  const combined =
    localStorage.getItem(
      combinedSelectionKey({
        principalId: current.principalId,
        originId: current.workspace.originId,
      })
    ) ?? expectedPreferences[COMBINED_SELECTION_KEY]
  // Global preferences may have been hydrated by another account's tab.
  if (combined === undefined) delete preferences[COMBINED_SELECTION_KEY]
  else preferences[COMBINED_SELECTION_KEY] = combined
  preferenceWriterId ??= crypto.randomUUID()
  const draftKey = `preferences:${key(current.principalId, current.workspace.originId)}:${preferenceWriterId}`
  const requestId = crypto.randomUUID()
  preferenceRequests.set(requestId, 'saving')
  const draft = {
    key: draftKey,
    kind: 'preferences',
    principalId: current.principalId,
    originId: current.workspace.originId,
    preferences,
    expectedPreferences,
    requestId,
  }
  try {
    await cache.table('pending').put(draft)
    ensureScope(sameOwner)
    await localStorageClient.savePreferences(
      current.workspace.originId,
      preferences,
      requestId,
      expectedPreferences
    )
    if (sameOwner()) {
      const latestPreferences = JSON.stringify(binding!.workspace!.preferences ?? {})
      if (
        latestPreferences === JSON.stringify(expectedPreferences) ||
        latestPreferences === JSON.stringify(preferences)
      )
        binding!.workspace!.preferences = preferences
      preferenceRequests.set(requestId, 'saved')
      // A load may already be reading this row. Retain a bounded success history so it
      // cannot mistake that stale snapshot for an interrupted operation.
      const completed = [...preferenceRequests].filter(([, phase]) => phase === 'saved')
      for (const [finished] of completed.slice(0, Math.max(0, completed.length - 128)))
        preferenceRequests.delete(finished)
    }
    await removePendingDraft(draft)
    await clearOwnPreferenceNotice(current.principalId, current.workspace.originId, epoch)
  } catch (error) {
    preferenceRequests.delete(requestId)
    if (sameOwner()) {
      const failedStatus: PersistenceStatus = {
        phase: 'error',
        message:
          'Preferences or editor drafts could not be saved. Your local copy is retained; retry in Storage & recovery.',
        backend: true,
        pending: true,
      }
      preferenceFailureNotice = {
        status: failedStatus,
        principalId: current.principalId,
        originId: current.workspace.originId,
      }
      report(failedStatus)
    }
    throw error
  }
}
export async function retryPreferenceSave() {
  const epoch = sessionEpoch
  const current =
    binding?.kind === 'backend' && !binding.readOnly ? binding : await loadTraderBinding()
  if (!current.workspace || !current.principalId) return
  const context = await localStorageClient.context()
  if (
    epoch !== sessionEpoch ||
    !context.authenticated ||
    context.principalId !== current.principalId ||
    context.activeOriginId !== current.workspace.originId
  )
    throw new LocalStorageError(
      'auth.changed',
      'Account changed. Reopen the correct workspace.',
      401
    )
  const scopeKey = `preferences:${key(current.principalId, current.workspace.originId)}`
  const pending = cache.table('pending')
  const draft =
    (preferenceWriterId && (await pending.get(`${scopeKey}:${preferenceWriterId}`))) ||
    (await pending.get(scopeKey)) ||
    (await pending.toArray()).find(
      (item) =>
        item.kind === 'preferences' &&
        item.principalId === current.principalId &&
        item.originId === current.workspace?.originId
    )
  ensureScope(workspaceSaveGuard(current, epoch).isCurrent)
  if (draft) {
    await localStorageClient.savePreferences(
      draft.originId,
      draft.preferences,
      draft.requestId,
      draft.expectedPreferences
    )
    const workspace = binding?.workspace
    if (
      epoch === sessionEpoch &&
      binding?.principalId === current.principalId &&
      workspace &&
      workspace.originId === draft.originId &&
      [JSON.stringify(draft.expectedPreferences), JSON.stringify(draft.preferences)].includes(
        JSON.stringify(workspace.preferences ?? {})
      )
    )
      workspace.preferences = draft.preferences
    await removePendingDraft(draft)
    await clearOwnPreferenceNotice(current.principalId, current.workspace.originId, epoch)
  }
}
export async function retainedWorkspaceDrafts(expected?: Marker) {
  const isCurrent = publicationGuard()
  const context = await localStorageClient.context()
  ensureScope(isCurrent)
  ensureScope(
    () =>
      !expected ||
      (context.authenticated &&
        context.principalId === expected.principalId &&
        context.activeOriginId === expected.originId)
  )
  if (!context.authenticated || !context.principalId || !context.activeOriginId) return []
  const drafts = await cache.table('pending').toArray()
  ensureScope(isCurrent)
  return drafts.filter(
    (draft) =>
      draft.principalId === context.principalId &&
      (draft.originId === context.activeOriginId ||
        draft.workspace?.originId === context.activeOriginId)
  )
}
export async function archivePendingDrafts() {
  const isCurrent = publicationGuard()
  const drafts = await retainedWorkspaceDrafts()
  const pending = cache.table('pending')
  const controls = cache.table('controls')
  await cache.transaction('rw', pending, controls, async () => {
    for (const draft of drafts) {
      ensureScope(isCurrent)
      const retained = await pending.get(draft.key)
      if (retained?.requestId !== draft.requestId) continue
      await controls.put({
        key: `draft-history:${crypto.randomUUID()}`,
        value: retained,
        archivedAt: new Date().toISOString(),
      })
      await pending.delete(draft.key)
    }
    ensureScope(isCurrent)
  })
  ensureScope(isCurrent)
  report({
    phase: 'saved',
    message: 'Saved records retained. Interrupted drafts moved to the local draft archive.',
    backend: true,
    pending: false,
  })
  notifyStorageChanged()
}
export async function archivedWorkspaceDrafts() {
  const isCurrent = publicationGuard()
  const context = await localStorageClient.context()
  ensureScope(isCurrent)
  if (!context.authenticated || !context.principalId || !context.activeOriginId) return []
  const controls = await cache.table('controls').toArray()
  ensureScope(isCurrent)
  return controls.filter(
    (item) =>
      item.key.startsWith('draft-history:') &&
      item.value.principalId === context.principalId &&
      (item.value.originId === context.activeOriginId ||
        item.value.workspace?.originId === context.activeOriginId)
  )
}
if (typeof window !== 'undefined')
  window.addEventListener('chartly:preferences-changed', schedulePreferenceSave)
export async function retainedDraft(): Promise<TraderTables | null> {
  const drafts = await retainedWorkspaceDrafts()
  return drafts.find((draft) => draft.tables)?.tables ?? null
}
/** Remove derived cache for the current authenticated source; preserved browser databases are untouched. */
export async function rebuildDerivedCache(): Promise<WorkspaceState> {
  const isCurrent = publicationGuard()
  const context = await localStorageClient.context()
  ensureScope(isCurrent)
  if (!context.authenticated || !context.principalId || !context.activeOriginId)
    throw new LocalStorageError('auth.required', 'Sign in and select a saved workspace first.', 401)
  const state = await localStorageClient.workspace(context.activeOriginId)
  ensureScope(isCurrent)
  await cache.table('snapshots').delete(key(context.principalId, state.originId))
  ensureScope(isCurrent)
  await acceptWorkspace(state)
  return state
}
export async function retainNativeDraft(
  originId: string,
  namespace: string,
  catalog: unknown,
  expected: number,
  requestId: string,
  expectedPrincipal: string
) {
  const isCurrent = publicationGuard()
  const context = await localStorageClient.context()
  if (
    !isCurrent() ||
    !context.authenticated ||
    context.principalId !== expectedPrincipal ||
    context.activeOriginId !== originId
  )
    throw new LocalStorageError(
      'auth.changed',
      'Select the correct saved workspace before editing charts.',
      401
    )
  const draftKey = `native:${key(context.principalId, originId)}:${requestId}`
  await cache.table('pending').put({
    key: draftKey,
    principalId: context.principalId,
    originId,
    namespace,
    catalog,
    expected,
    requestId,
    kind: 'native',
  })
  ensureScope(isCurrent)
  return draftKey
}
export async function finishNativeDraft(draftKey: string, requestId: string) {
  await removePendingDraft({ key: draftKey, requestId })
  try {
    localStorage.setItem('chartly.storage.native-change.v1', crypto.randomUUID())
  } catch {
    /* save remains durable even when notifications are unavailable */
  }
}
export async function nativeDrafts() {
  return (await retainedWorkspaceDrafts()).filter((draft) => draft.kind === 'native')
}
export async function retryNativeDraft(draftKey: string) {
  const isCurrent = publicationGuard()
  const drafts = await nativeDrafts()
  const draft = drafts.find((item) => item.key === draftKey)
  if (!draft) throw new Error('Chart draft is unavailable for this account and workspace.')
  ensureScope(isCurrent)
  await localStorageClient.saveNative(
    'workspace',
    draft.namespace,
    draft.originId,
    draft.catalog,
    draft.expected,
    draft.requestId,
    { principalId: draft.principalId, isCurrent }
  )
  await finishNativeDraft(draft.key, draft.requestId)
  notifyStorageChanged()
}
export async function loadPortfolioList() {
  const state = await loadTraderBinding()
  return state.tables.portfolios.filter((record) => !record.archivedAt)
}
export function currentBinding() {
  return binding
}
export const newRecordId = (records: { id?: number }[]) =>
  records.reduce((maximum, record) => Math.max(maximum, record.id ?? 0), 0) + 1
export const copyTables = (tables: TraderTables) => structuredClone(tables)
export { emptyTraderTables, browserOrigin }
