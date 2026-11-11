import Dexie, { type Table } from 'dexie'

export interface JournalDraftScope {
  principalId: string
  originId: string
  bookId: string
}
export interface JournalDraft<T = unknown> extends JournalDraftScope {
  key: string
  kind: string
  updatedAt: string
  value: T
}
const db = new Dexie('ChartlyJournalDrafts')
db.version(1).stores({ drafts: '&key, [principalId+originId+bookId], updatedAt' })
const drafts: Table<JournalDraft, string> = db.table('drafts')
function key(scope: JournalDraftScope, kind: string) {
  if (!scope.principalId || !scope.originId || !scope.bookId || !kind)
    throw new Error('Choose a loaded journal book before saving its draft.')
  return JSON.stringify([scope.principalId, scope.originId, scope.bookId, kind])
}
export const journalDrafts = {
  async get<T>(scope: JournalDraftScope, kind: string): Promise<JournalDraft<T> | undefined> {
    return drafts.get(key(scope, kind)) as Promise<JournalDraft<T> | undefined>
  },
  async save<T>(scope: JournalDraftScope, kind: string, value: T): Promise<void> {
    const id = key(scope, kind)
    const limit = kind.startsWith('attachment:')
      ? 12 * 1024 * 1024
      : kind === 'import'
        ? 20 * 1024 * 1024
        : 1_000_000
    if (JSON.stringify(value).length > limit)
      throw new Error(
        'This journal draft exceeds its supported size. Export it before adding more content.'
      )
    await db.transaction('rw', drafts, async () => {
      const existing = await drafts.get(id)
      if (
        !existing &&
        (await drafts
          .where('[principalId+originId+bookId]')
          .equals([scope.principalId, scope.originId, scope.bookId])
          .count()) >= 100
      )
        throw new Error(
          'This book already has 100 interrupted drafts. Export or resolve one before creating another.'
        )
      await drafts.put({ ...scope, key: id, kind, value, updatedAt: new Date().toISOString() })
    })
  },
  async delete(scope: JournalDraftScope, kind: string) {
    await drafts.delete(key(scope, kind))
  },
  async list(scope: JournalDraftScope, kindPrefix?: string): Promise<JournalDraft[]> {
    key(scope, 'check')
    const rows: JournalDraft[] = []
    let bytes = 0
    await drafts
      .where('[principalId+originId+bookId]')
      .equals([scope.principalId, scope.originId, scope.bookId])
      .each((row) => {
        if (kindPrefix && !row.kind.startsWith(kindPrefix)) return
        bytes += JSON.stringify(row.value).length
        if (bytes > 32 * 1024 * 1024)
          throw new Error(
            'This book’s drafts exceed the 32 MiB combined export limit. Export individual forms or attachments separately; all drafts are retained.'
          )
        rows.push(row)
      })
    return rows.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  },
}
