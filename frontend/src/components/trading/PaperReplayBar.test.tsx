import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaperController } from '@/hooks/usePaperSession'
import { paperFixture } from '@/lib/trader/paper.fixture'
import { act, cleanup, fireEvent, render, screen } from '@/test/test-utils'
import { PaperReplayBar } from './PaperReplayBar'

const control = (override: Partial<PaperController> = {}): PaperController => ({
  enabled: true,
  session: paperFixture({ status: 'in_progress' }),
  loading: false,
  busy: false,
  error: '',
  pending: null,
  reviewed: false,
  reload: vi.fn(async () => {}),
  mutate: vi.fn(async () => ({ session: paperFixture() })),
  retry: vi.fn(async () => null),
  clearRejected: vi.fn(async () => {}),
  ...override,
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
describe('acknowledged paper transport', () => {
  it('advances only through server intent and exposes no free rewind/scrub', () => {
    const value = control()
    render(<PaperReplayBar controller={value} synchronized onOpen={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Advance paper observation' }))
    expect(value.mutate).toHaveBeenCalledWith('advance', { count: 1 })
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /previous/i })).not.toBeInTheDocument()
  })
  it('holds decisions until the committed clock is visible', () => {
    const value = control()
    render(<PaperReplayBar controller={value} synchronized={false} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: 'Advance paper observation' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    expect(value.mutate).not.toHaveBeenCalled()
  })
  it('serializes automatic advances and continues after a successful in-flight pending request', async () => {
    vi.useFakeTimers()
    const calls = vi.fn()
    let release!: () => void
    function Harness() {
      const [session, setSession] = useState(paperFixture({ status: 'in_progress' }))
      const [busy, setBusy] = useState(false)
      const [pending, setPending] = useState<PaperController['pending']>(null)
      const value = control({
        session,
        busy,
        pending,
        mutate: async (action, payload) => {
          calls(action, payload)
          setBusy(true)
          setPending({
            key: 'one',
            rejected: false,
            request: {
              originId: 'one',
              runId: 1,
              expectedRevision: session.revision,
              requestId: 'stable',
              action,
              payload: payload ?? {},
            },
          })
          await new Promise<void>((yes) => {
            release = yes
          })
          const next = {
            ...session,
            revision: session.revision + 1,
            cursorIndex: session.cursorIndex + 1,
            asOf: session.asOf + 60,
          }
          setSession(next)
          setPending(null)
          setBusy(false)
          return { session: next }
        },
      })
      return <PaperReplayBar controller={value} synchronized onOpen={() => {}} />
    }
    const { unmount } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
    expect(calls).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(calls).toHaveBeenCalledTimes(1)
    await act(async () => {
      release()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
    expect(calls).toHaveBeenCalledTimes(2)
    unmount()
    await act(async () => {
      release()
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(calls).toHaveBeenCalledTimes(2)
  })
})
