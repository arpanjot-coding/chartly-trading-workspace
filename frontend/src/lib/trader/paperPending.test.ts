import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type PendingPaperRequest, paperPending } from './paperPending'

const draft = (key: string, id: string): PendingPaperRequest => ({
  key,
  rejected: false,
  request: {
    originId: 'one',
    runId: 1,
    expectedRevision: 2,
    requestId: id,
    action: 'advance',
    payload: { count: 1 },
  },
})
afterEach(() => vi.restoreAllMocks())
describe('durable paper request claims with real IndexedDB', () => {
  it('refuses an oversized retry body without replacing its durable request', async () => {
    const key = crypto.randomUUID(),
      value = draft(key, 'small')
    await paperPending.claim(value)
    await expect(
      paperPending.claim({
        ...value,
        request: { ...value.request, payload: { quantity: '9'.repeat(70000) } },
      })
    ).rejects.toThrow('64 KiB')
    expect(await paperPending.read(key)).toEqual(value)
    await paperPending.finish(key, 'small')
  })
  it('allows one command claim across concurrent callers and preserves the winner', async () => {
    const key = crypto.randomUUID()
    const results = await Promise.allSettled([
      paperPending.claim(draft(key, 'first')),
      paperPending.claim(draft(key, 'second')),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const saved = await paperPending.read(key)
    expect(['first', 'second']).toContain(saved?.request.requestId)
    await paperPending.finish(key, 'different-request')
    expect(await paperPending.read(key)).toEqual(saved)
    await paperPending.finish(key, saved!.request.requestId)
    expect(await paperPending.read(key)).toBeUndefined()
  })
  it('reopens the same retained body after close and closes connections on rejected claim too', async () => {
    const close = vi.spyOn(Dexie.prototype, 'close')
    const key = crypto.randomUUID(),
      body = draft(key, 'exact-body')
    await paperPending.claim(body)
    expect(await paperPending.read(key)).toEqual(body)
    await expect(paperPending.claim(draft(key, 'other'))).rejects.toThrow('Another paper request')
    expect(close).toHaveBeenCalledTimes(3)
    await paperPending.finish(key, 'exact-body')
  })
})
