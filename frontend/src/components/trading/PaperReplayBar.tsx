import { useEffect, useRef, useState } from 'react'
import type { PaperController } from '@/hooks/usePaperSession'

export function PaperReplayBar({
  controller,
  synchronized,
  onOpen,
}: {
  controller: PaperController
  synchronized: boolean
  onOpen(): void
}) {
  const { session, busy, loading, pending, error } = controller
  const [playing, setPlaying] = useState(false)
  const [batch, setBatch] = useState(1)
  const action = useRef(controller.mutate)
  action.current = controller.mutate
  const active = useRef(false)
  const generation = useRef(0)
  const [playError, setPlayError] = useState('')
  useEffect(() => {
    if (
      !playing ||
      !session ||
      !synchronized ||
      busy ||
      loading ||
      pending ||
      session.status !== 'in_progress' ||
      session.cursorIndex >= (session.totalBars ?? 0) - 1
    )
      return
    const version = ++generation.current
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled || active.current) return
      active.current = true
      void action
        .current('advance', { count: batch })
        .catch((cause) => {
          if (!cancelled) {
            setPlaying(false)
            setPlayError(cause instanceof Error ? cause.message : 'Paper playback stopped.')
          }
        })
        .finally(() => {
          active.current = false
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
      if (generation.current === version) generation.current++
    }
  }, [playing, session, synchronized, busy, loading, pending, batch])
  useEffect(() => {
    if (
      error ||
      (!busy && pending) ||
      session?.status !== 'in_progress' ||
      (session && session.cursorIndex >= (session.totalBars ?? 0) - 1)
    )
      setPlaying(false)
  }, [error, pending, busy, session])
  if (!session) return null
  const disabled = busy || loading || !!pending || !synchronized || session.status === 'finished'
  const end = session.cursorIndex >= (session.totalBars ?? 0) - 1
  const button =
    'rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50'
  return (
    <section
      aria-label="Paper replay"
      className="absolute bottom-3 left-1/2 z-30 max-w-[calc(100%_-_1.5rem)] -translate-x-1/2 rounded-lg border bg-popover p-2 text-xs shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong>Paper · all charts</strong>
        <button className={button} type="button" onClick={onOpen}>
          Paper ticket
        </button>
        <button
          className={button}
          type="button"
          disabled={disabled || session.status === 'ready' || end}
          onClick={() => {
            setPlayError('')
            if (playing) {
              setPlaying(false)
              void controller.mutate('pause').catch(() => {})
            } else if (session.status === 'paused') {
              void controller
                .mutate('start')
                .then(() => setPlaying(true))
                .catch(() => {})
            } else setPlaying(true)
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          className={button}
          type="button"
          aria-label="Advance paper observation"
          disabled={disabled || session.status === 'ready' || end}
          onClick={() => {
            setPlaying(false)
            void controller.mutate('advance', { count: 1 }).catch(() => {})
          }}
        >
          Next
        </button>
        <label>
          Bars per request
          <select
            aria-label="Paper advance batch"
            className="ml-1 rounded border bg-background p-1"
            value={batch}
            disabled={busy}
            onChange={(event) => setBatch(Number(event.target.value))}
          >
            {[1, 5, 25, 100, 500].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <span>
          {session.cursorIndex + 1} / {session.totalBars ?? '—'}
        </span>
        <time>{new Date(session.asOf * 1000).toISOString()}</time>
      </div>
      {!synchronized && <output>Applying the acknowledged paper clock…</output>}
      {playError && <p role="alert">{playError}</p>}
    </section>
  )
}
