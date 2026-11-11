import {
  createIndexedDbWorkspaceStorage,
  type IndexedDbWorkspaceStorage,
  type WorkspaceCatalog,
} from 'chartly-charts/workspace'
import { useAuthStore } from '@/stores/authStore'
import { activationMarker, finishNativeDraft, retainNativeDraft } from './dataPersistence'
import { LocalStorageError, localStorageClient } from './localStorageClient'

/** Original chart API, with server authority after verified migration. */
export function createDurableWorkspaceStorage(factory: IDBFactory): IndexedDbWorkspaceStorage {
  let closed = false
  let browser: IndexedDbWorkspaceStorage | undefined
  let route: Promise<{ originId: string; principalId: string } | null> | undefined
  let retry: { signature: string; requestId: string } | undefined
  const principal = useAuthStore.getState().localPrincipalId
  const isCurrent = () => !closed && useAuthStore.getState().localPrincipalId === principal
  const check = () => {
    if (closed) throw new Error('Chart workspace storage is closed')
    if (!isCurrent())
      throw new LocalStorageError(
        'auth.changed',
        'Account changed. Reopen the chart workspace.',
        401
      )
  }
  const resolve = async () => {
    check()
    if (!route)
      route = (async () => {
        const marker = await activationMarker()
        try {
          const context = await localStorageClient.context()
          check()
          if (context.authenticated && context.activeOriginId && context.principalId)
            return { originId: context.activeOriginId, principalId: context.principalId }
          if (marker)
            throw new LocalStorageError(
              'auth.required',
              'Sign in to reopen saved chart layouts.',
              401
            )
        } catch (error) {
          if (marker || (error instanceof LocalStorageError && error.code === 'auth.changed'))
            throw error
        }
        return null
      })()
    return route
  }
  const local = () => {
    if (!browser) browser = createIndexedDbWorkspaceStorage(factory)
    return browser
  }
  return {
    async read(namespace) {
      const destination = await resolve()
      const value = destination
        ? (
            await localStorageClient.native('workspace', namespace, destination.originId, {
              principalId: destination.principalId,
              isCurrent,
            })
          ).catalog
        : await local().read(namespace)
      check()
      return value
    },
    async write(namespace, catalog: WorkspaceCatalog, expected, options) {
      check()
      if (options?.signal?.aborted) throw new DOMException('Operation cancelled', 'AbortError')
      const destination = await resolve()
      if (!destination) return local().write(namespace, catalog, expected, options)
      const signature = JSON.stringify([namespace, expected, catalog])
      if (retry?.signature !== signature) retry = { signature, requestId: crypto.randomUUID() }
      const { requestId } = retry
      const draftKey = await retainNativeDraft(
        destination.originId,
        namespace,
        catalog,
        expected,
        requestId,
        destination.principalId
      )
      check()
      try {
        await localStorageClient.saveNative(
          'workspace',
          namespace,
          destination.originId,
          catalog,
          expected,
          requestId,
          { principalId: destination.principalId, isCurrent }
        )
        await finishNativeDraft(draftKey, requestId)
        if (retry?.requestId === requestId) retry = undefined
      } catch (error) {
        if (error instanceof LocalStorageError && error.status === 409)
          error.name = 'WorkspaceConflictError'
        throw error
      }
      check()
    },
    async close() {
      closed = true
      await browser?.close()
    },
  }
}
