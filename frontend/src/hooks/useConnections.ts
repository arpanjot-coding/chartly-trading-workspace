import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ConnectorAction,
  type ConnectorConnection,
  type ConnectorProvider,
  type ConnectorRequest,
  type ConnectorResponse,
  connectorClient,
} from '@/lib/trader/connectorClient'
import { LocalStorageError } from '@/lib/trader/localStorageClient'

export interface ConnectionOwner {
  principal: string
  originId: string
  profileId?: number
}
const HISTORY_PAGES_PER_READ = 8

export function useConnections(
  owner: ConnectionOwner | null,
  onWorkspace?: (response: ConnectorResponse) => Promise<void>
) {
  const key = owner ? `${owner.principal}:${owner.originId}:${owner.profileId ?? 'all'}` : ''
  const active = useRef(key)
  active.current = key
  const epoch = useRef(0)
  const read = useRef<AbortController | null>(null)
  const write = useRef<AbortController | null>(null)
  const inFlight = useRef(false)
  const historyRead = useRef<{ stop: boolean } | null>(null)
  const callback = useRef(onWorkspace)
  callback.current = onWorkspace
  const [boundKey, setBoundKey] = useState(key)
  const [connections, setConnections] = useState<ConnectorConnection[]>([])
  const [providers, setProviders] = useState<ConnectorProvider[]>([])
  const [pending, setPending] = useState<ConnectorRequest | null>(null)
  const [rejected, setRejected] = useState(false)
  const [loading, setLoading] = useState(!!owner)
  const [busy, setBusy] = useState(false)
  const [syncingHistory, setSyncingHistory] = useState(false)
  const [error, setError] = useState('')
  const principal = owner?.principal
  const originId = owner?.originId
  const profileId = owner?.profileId
  const reload = useCallback(async () => {
    read.current?.abort()
    const controller = new AbortController()
    read.current = controller
    const version = epoch.current
    setLoading(true)
    setError('')
    try {
      const [result, catalog] = await Promise.allSettled([
        originId && principal
          ? connectorClient.list(originId, profileId, controller.signal, principal)
          : Promise.resolve({ connections: [] }),
        connectorClient.providers(controller.signal, undefined),
      ])
      if (controller.signal.aborted || active.current !== key || epoch.current !== version) return
      if (catalog.status === 'fulfilled') setProviders(catalog.value.providers)
      if (result.status === 'fulfilled') setConnections(result.value.connections)
      if (catalog.status === 'rejected') throw catalog.reason
      if (result.status === 'rejected') throw result.reason
    } catch (cause) {
      if (!controller.signal.aborted && active.current === key && epoch.current === version)
        setError(cause instanceof Error ? cause.message : 'Connections could not be loaded.')
    } finally {
      if (!controller.signal.aborted && active.current === key && epoch.current === version)
        setLoading(false)
    }
  }, [key, originId, principal, profileId])
  useEffect(() => {
    epoch.current++
    setBoundKey(key)
    setConnections([])
    setProviders([])
    setPending(null)
    setRejected(false)
    setBusy(false)
    setSyncingHistory(false)
    setError('')
    inFlight.current = false
    void reload()
    return () => {
      epoch.current++
      read.current?.abort()
      write.current?.abort()
      if (historyRead.current) historyRead.current.stop = true
      historyRead.current = null
    }
  }, [key, reload])
  const send = useCallback(
    async (body: ConnectorRequest, retain = true) => {
      if (!key || !principal || inFlight.current || body.originId !== originId)
        throw new Error('Wait for the current connection request to finish.')
      const version = epoch.current
      const current = () => active.current === key && epoch.current === version
      const controller = new AbortController()
      read.current?.abort()
      write.current = controller
      inFlight.current = true
      setBusy(true)
      setLoading(false)
      // Secret-bearing requests are never retained for retry: the payload
      // must not outlive the single in-flight call.
      if (retain) setPending(body)
      setRejected(false)
      setError('')
      try {
        const response = await connectorClient.action(body, controller.signal, principal)
        if (!current()) return null
        if (response.connection)
          setConnections((values) => [
            response.connection!,
            ...values.filter((item) => item.id !== response.connection!.id),
          ])
        setPending(null)
        if (response.workspace) await callback.current?.(response)
        return response
      } catch (cause) {
        if (current()) {
          setRejected(
            retain &&
              cause instanceof LocalStorageError &&
              cause.status >= 400 &&
              cause.status < 500
          )
          setError(
            cause instanceof Error
              ? cause.message
              : 'The response was interrupted. Retry the same reviewed request.'
          )
        }
        throw cause
      } finally {
        if (current()) {
          setBusy(false)
          inFlight.current = false
        }
      }
    },
    [key, originId, principal]
  )
  const mutate = useCallback(
    async (
      action: ConnectorAction,
      connection: ConnectorConnection | null,
      payload: Record<string, unknown> = {}
    ) => {
      if (!originId || pending || historyRead.current)
        throw new Error('Review the retained request before submitting another change.')
      return send({
        originId,
        ...(connection ? { connectionId: connection.id } : {}),
        expectedRevision: connection?.revision ?? 0,
        requestId: `connector_${crypto.randomUUID().replaceAll('-', '')}`,
        action,
        payload,
      })
    },
    [originId, pending, send]
  )
  const setSecret = useCallback(
    async (connection: ConnectorConnection, secret: Record<string, string>) => {
      if (!originId || pending || historyRead.current)
        throw new Error('Review the retained request before submitting another change.')
      return send(
        {
          originId,
          connectionId: connection.id,
          expectedRevision: connection.revision,
          requestId: `connector_${crypto.randomUUID().replaceAll('-', '')}`,
          action: 'set-secret',
          payload: { secret },
        },
        false
      )
    },
    [originId, pending, send]
  )
  async function syncHistory(
    connection: ConnectorConnection,
    window: { from: string; to: string }
  ) {
    if (!originId || pending || historyRead.current || inFlight.current || active.current !== key)
      throw new Error('Wait for the current connection request to finish.')
    const run = { stop: false }
    historyRead.current = run
    setSyncingHistory(true)
    let current = connection
    let pages = 0
    const normalizeUtc = (value: string) =>
      value.replace(
        /(?:\.(\d+))?Z$/,
        (_, fraction?: string) => `.${(fraction ?? '').padEnd(6, '0')}Z`
      )
    const resumeCursor = (candidate: ConnectorConnection) => {
      const checkpoint = candidate.history?.cursor
      if (
        checkpoint?.nativeCursor &&
        normalizeUtc(checkpoint.window.from) === normalizeUtc(window.from) &&
        normalizeUtc(checkpoint.window.to) === normalizeUtc(window.to)
      )
        return checkpoint.nativeCursor
      return null
    }
    const cursors = new Set<string>()
    const previousCursor = resumeCursor(current)
    if (previousCursor) cursors.add(previousCursor)
    try {
      while (
        !run.stop &&
        historyRead.current === run &&
        active.current === key &&
        pages < HISTORY_PAGES_PER_READ
      ) {
        const result = await send({
          originId,
          connectionId: current.id,
          expectedRevision: current.revision,
          requestId: `connector_${crypto.randomUUID().replaceAll('-', '')}`,
          action: 'sync',
          payload: { window },
        })
        if (!result || historyRead.current !== run || active.current !== key) return null
        const next = result.connection
        if (!next || next.id !== current.id || next.revision <= current.revision)
          throw new Error(
            'The saved history checkpoint could not be verified. Reload the connection.'
          )
        current = next
        if (current.failure) break
        pages++
        const cursor = resumeCursor(current)
        if (!cursor) break
        if (cursors.has(cursor))
          throw new Error('The source repeated its history checkpoint. Reload before resuming.')
        cursors.add(cursor)
      }
      return { connection: current, pages }
    } catch (cause) {
      if (historyRead.current === run && active.current === key)
        setError(cause instanceof Error ? cause.message : 'Account history could not be read.')
      throw cause
    } finally {
      if (historyRead.current === run) {
        historyRead.current = null
        setSyncingHistory(false)
      }
    }
  }
  return {
    connections: boundKey === key ? connections : [],
    providers: boundKey === key ? providers : [],
    pending: boundKey === key ? pending : null,
    loading: boundKey !== key || loading,
    busy: boundKey === key && busy,
    syncingHistory: boundKey === key && syncingHistory,
    error: boundKey === key ? error : '',
    rejected,
    reload,
    mutate,
    setSecret,
    syncHistory,
    stopHistory: () => {
      if (historyRead.current) historyRead.current.stop = true
    },
    retry: () => (pending ? send(pending) : Promise.resolve(null)),
    clearRejected: () => {
      if (rejected && !busy) {
        setPending(null)
        setRejected(false)
        setError('')
      }
    },
  }
}
