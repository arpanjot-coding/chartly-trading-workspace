import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { journalDrafts, type JournalDraftScope } from '@/lib/trader/journalDrafts'

/** Unsaved data is local, scoped and exportable; it is never an authoritative writer. */
export function useJournalDraft<T extends object>(
  scope: JournalDraftScope,
  kind: string,
  initial: () => T
) {
  const { principalId, originId, bookId } = scope
  const stableScope = useMemo(
    () => ({ principalId, originId, bookId }),
    [principalId, originId, bookId]
  )
  const initialFactory = useRef(initial)
  initialFactory.current = initial
  const [value, setValue] = useState<T>(() => initial())
  const scopeKey = JSON.stringify([scope.principalId, scope.originId, scope.bookId, kind])
  const [loadedKey, setLoadedKey] = useState('')
  const ready = loadedKey === scopeKey
  const [restored, setRestored] = useState(false)
  const [error, setError] = useState('')
  const cleared = useRef(false)
  useEffect(() => {
    let live = true
    setValue(initialFactory.current())
    setLoadedKey('')
    setRestored(false)
    setError('')
    cleared.current = false
    void journalDrafts
      .get<T>(stableScope, kind)
      .then((draft) => {
        if (live && draft) {
          setValue(draft.value)
          setRestored(true)
        }
      })
      .catch(() => {
        if (live)
          setError(
            'Local draft recovery is unavailable. Keep this form open or export it before leaving.'
          )
      })
      .finally(() => {
        if (live) setLoadedKey(scopeKey)
      })
    return () => {
      live = false
    }
  }, [stableScope, kind, scopeKey])
  useEffect(() => {
    if (!ready || cleared.current) return
    void journalDrafts
      .save(stableScope, kind, value)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'The local draft could not be retained. Export it before leaving.'
        )
      )
  }, [value, ready, stableScope, kind])
  const clear = useCallback(async () => {
    cleared.current = true
    await journalDrafts.delete(stableScope, kind)
  }, [stableScope, kind])
  return { value, setValue, ready, restored, error, clear }
}
