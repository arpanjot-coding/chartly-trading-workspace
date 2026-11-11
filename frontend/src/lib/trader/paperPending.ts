import Dexie from 'dexie'
import type { PaperRequest } from './paperClient'

export interface PendingPaperRequest {
  key: string
  request: PaperRequest
  rejected: boolean
}
const actions = new Set([
  'prepare',
  'start',
  'pause',
  'advance',
  'order',
  'cancel',
  'close',
  'finish',
  'branch',
])
function checked(value: PendingPaperRequest, key = value?.key): PendingPaperRequest {
  const request = value?.request
  if (
    !value ||
    typeof value !== 'object' ||
    typeof key !== 'string' ||
    key.length > 512 ||
    value.key !== key ||
    typeof value.rejected !== 'boolean' ||
    !request ||
    typeof request.originId !== 'string' ||
    !request.originId ||
    request.originId.length > 128 ||
    !Number.isSafeInteger(request.runId) ||
    request.runId <= 0 ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 0 ||
    typeof request.requestId !== 'string' ||
    !request.requestId ||
    request.requestId.length > 160 ||
    !actions.has(request.action) ||
    !request.payload ||
    typeof request.payload !== 'object' ||
    Array.isArray(request.payload)
  )
    throw new Error(
      'The retained paper request is invalid. Its stored record is preserved; reload the saved account before continuing.'
    )
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65536)
    throw new Error(
      'This paper decision exceeds the 64 KiB local retry limit. Shorten its input before sending it.'
    )
  return value
}
async function database<T>(run: (db: Dexie) => Promise<T>): Promise<T> {
  const db = new Dexie('ChartlyPaperRequests')
  db.version(1).stores({ pending: '&key' })
  try {
    return await run(db)
  } finally {
    db.close()
  }
}
export const paperPending = {
  read: (key: string) =>
    database(async (db) => {
      const value = (await db.table('pending').get(key)) as PendingPaperRequest | undefined
      return value ? checked(value, key) : undefined
    }),
  claim: (value: PendingPaperRequest) =>
    database((db) =>
      db.transaction('rw', db.table('pending'), async () => {
        checked(value)
        const previous = (await db.table('pending').get(value.key)) as
          | PendingPaperRequest
          | undefined
        if (previous && checked(previous, value.key).request.requestId !== value.request.requestId)
          throw new Error(
            'Another paper request is retained. Review and retry it before creating a new decision.'
          )
        await db.table('pending').put(value)
      })
    ),
  finish: (key: string, requestId: string) =>
    database((db) =>
      db.transaction('rw', db.table('pending'), async () => {
        const previous = (await db.table('pending').get(key)) as PendingPaperRequest | undefined
        if (previous && checked(previous, key).request.requestId === requestId)
          await db.table('pending').delete(key)
      })
    ),
}
