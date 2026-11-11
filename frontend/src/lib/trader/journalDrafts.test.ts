import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { journalDrafts } from './journalDrafts'

describe('journal local drafts', () => {
  it('isolates financial drafts by principal, origin and book, and restores exact failed request data', async () => {
    const scope = { principalId: crypto.randomUUID(), originId: 'origin-one', bookId: 'book-one' }
    const value = {
      requestId: 'retry-stable',
      expectedRevision: 4,
      notes: 'unsent review',
      amount: '0.10000000000000000001',
    }
    await journalDrafts.save(scope, 'request:retry-stable', value)
    expect((await journalDrafts.get(scope, 'request:retry-stable'))?.value).toEqual(value)
    expect(await journalDrafts.list({ ...scope, principalId: 'another-owner' })).toEqual([])
    expect(await journalDrafts.list({ ...scope, originId: 'another-source' })).toEqual([])
    expect(await journalDrafts.list({ ...scope, bookId: 'another-book' })).toEqual([])
    await journalDrafts.delete(scope, 'request:retry-stable')
    expect(await journalDrafts.list(scope)).toEqual([])
  })
  it('rejects an oversized form without deleting the previous draft, while retaining a 4 MiB import source', async () => {
    const scope = { principalId: crypto.randomUUID(), originId: 'source', bookId: 'manual' }
    await journalDrafts.save(scope, 'trade:1', { notes: 'previous' })
    await expect(
      journalDrafts.save(scope, 'trade:1', { notes: 'x'.repeat(1_000_001) })
    ).rejects.toThrow('supported size')
    expect((await journalDrafts.get(scope, 'trade:1'))?.value).toEqual({ notes: 'previous' })
    await journalDrafts.save(scope, 'import', {
      csvText: 'x'.repeat(4 * 1024 * 1024),
      requestId: 'source-stable',
    })
    expect(
      (await journalDrafts.get<{ csvText: string }>(scope, 'import'))?.value.csvText.length
    ).toBe(4 * 1024 * 1024)
  })
  it('never silently purges old work when the per-book draft limit is reached', async () => {
    const scope = { principalId: crypto.randomUUID(), originId: 'source', bookId: 'book' }
    for (let index = 0; index < 100; index++)
      await journalDrafts.save(scope, `trade:${index}`, { notes: `draft-${index}` })
    await expect(journalDrafts.save(scope, 'trade:new', { notes: 'new' })).rejects.toThrow(
      '100 interrupted drafts'
    )
    expect((await journalDrafts.get(scope, 'trade:0'))?.value).toEqual({ notes: 'draft-0' })
    expect((await journalDrafts.list(scope)).length).toBe(100)
  })
})
