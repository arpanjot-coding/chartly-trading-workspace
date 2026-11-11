import { useCallback, useEffect, useRef, useState } from 'react'
import { LocalStorageError } from '@/lib/trader/localStorageClient'
import {
  type PaperAction,
  type PaperResponse,
  type PaperSession,
  paperClient,
} from '@/lib/trader/paperClient'
import { type PendingPaperRequest, paperPending } from '@/lib/trader/paperPending'

export interface PaperOwner {
  principal: string
  originId: string
  runId: number
}
export function usePaperSession(
  owner: PaperOwner | null,
  onWorkspace?: (response: PaperResponse) => Promise<void>
) {
  const originId = owner?.originId
  const runId = owner?.runId
  const key = owner ? `${owner.principal}:${owner.originId}:${owner.runId}` : ''
  const [boundKey, setBoundKey] = useState(key)
  const activeKey = useRef(key)
  activeKey.current = key
  const epoch = useRef(0)
  const readAbort = useRef<AbortController | null>(null)
  const writeAbort = useRef<AbortController | null>(null)
  const inFlight = useRef(false)
  const [session, setSession] = useState<PaperSession | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [pending, setPending] = useState<PendingPaperRequest | null>(null)
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const [loading, setLoading] = useState(!!owner)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const callback = useRef(onWorkspace)
  callback.current = onWorkspace
  const reload = useCallback(async () => {
    if (!originId || !runId) return
    readAbort.current?.abort()
    const abort = new AbortController()
    readAbort.current = abort
    const generation = epoch.current
    setLoading(true)
    setError('')
    try {
      const [response, retained] = await Promise.all([
        paperClient.session(originId, runId, abort.signal),
        paperPending.read(key),
      ])
      if (abort.signal.aborted || generation !== epoch.current || activeKey.current !== key) return
      if (
        !sessionRef.current ||
        (response.session && response.session.revision >= sessionRef.current.revision)
      ) {
        setSession(response.session)
        sessionRef.current = response.session
      }
      setPending(retained ?? null)
      pendingRef.current = retained ?? null
      setReviewed(true)
    } catch (cause) {
      if (!abort.signal.aborted && generation === epoch.current && activeKey.current === key)
        setError(cause instanceof Error ? cause.message : 'Paper session could not be loaded.')
    } finally {
      if (!abort.signal.aborted && generation === epoch.current && activeKey.current === key)
        setLoading(false)
    }
  }, [key, originId, runId])
  useEffect(() => {
    epoch.current++
    setBoundKey(key)
    setSession(null)
    sessionRef.current = null
    setPending(null)
    pendingRef.current = null
    setError('')
    setReviewed(false)
    setBusy(false)
    inFlight.current = false
    if (key) void reload()
    else setLoading(false)
    return () => {
      epoch.current++
      readAbort.current?.abort()
      writeAbort.current?.abort()
    }
  }, [key, reload])
  const send = useCallback(
    async (draft: PendingPaperRequest) => {
      if (!key || inFlight.current) throw new Error('Wait for the current paper request to finish.')
      const generation = epoch.current
      const current = () => activeKey.current === key && generation === epoch.current
      const abort = new AbortController()
      readAbort.current?.abort()
      writeAbort.current = abort
      inFlight.current = true
      setBusy(true)
      setLoading(false)
      setError('')
      setReviewed(false)
      let claimed = false
      try {
        await paperPending.claim(draft)
        claimed = true
        if (!current()) return null
        setPending(draft)
        pendingRef.current = draft
        const response = await paperClient.action(draft.request, abort.signal)
        await paperPending.finish(key, draft.request.requestId)
        if (!current()) return null
        if (draft.request.action !== 'branch') {
          setSession(response.session)
          sessionRef.current = response.session
        }
        setPending(null)
        pendingRef.current = null
        if (response.workspace) await callback.current?.(response)
        return response
      } catch (cause) {
        const rejected =
          cause instanceof LocalStorageError && cause.status >= 400 && cause.status < 500
        const retained = claimed
          ? { ...draft, rejected }
          : ((await paperPending.read(key).catch(() => undefined)) ?? { ...draft, rejected: true })
        if (current()) {
          await paperPending.claim(retained).catch(() => {})
          setPending(retained)
          pendingRef.current = retained
          setError(
            cause instanceof Error
              ? cause.message
              : 'Paper request failed. Retry the retained request.'
          )
        }
        throw cause
      } finally {
        if (current()) {
          inFlight.current = false
          setBusy(false)
        }
      }
    },
    [key]
  )
  const mutate = useCallback(
    async (action: PaperAction, payload: Record<string, unknown> = {}) => {
      if (!originId || !runId) throw new Error('Open a saved run before using paper trading.')
      if (pendingRef.current)
        throw new Error('Review the retained paper request before creating another decision.')
      const draft: PendingPaperRequest = {
        key,
        rejected: false,
        request: {
          originId,
          runId,
          expectedRevision: sessionRef.current?.revision ?? 0,
          requestId: crypto.randomUUID(),
          action,
          payload,
        },
      }
      return send(draft)
    },
    [key, originId, runId, send]
  )
  const retry = useCallback(() => {
    const retained = pendingRef.current
    if (!retained) return Promise.resolve(null)
    return send(retained)
  }, [send])
  const clearRejected = useCallback(async () => {
    const retained = pendingRef.current
    if (!retained || !retained.rejected || !reviewed || inFlight.current) return
    await paperPending.finish(key, retained.request.requestId)
    if (activeKey.current === key) {
      setPending(null)
      pendingRef.current = null
      setError('')
    }
  }, [key, reviewed])
  const owns = boundKey === key
  return {
    enabled: !!owner,
    session: owns ? session : null,
    loading: owns ? loading : !!owner,
    busy: owns ? busy : false,
    error: owns ? error : '',
    pending: owns ? pending : null,
    reviewed: owns ? reviewed : false,
    reload,
    mutate,
    retry,
    clearRejected,
  }
}
export type PaperController = ReturnType<typeof usePaperSession>
