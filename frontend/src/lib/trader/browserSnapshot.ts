import {
  CHART_PREFERENCES_KEY,
  validChartPreferenceEnvelope,
} from '@/lib/trading/scopedChartStorage'
import type {
  BrokerAccount,
  DailyMood,
  JournalTrade,
  PracticeSession,
  ProfileDestination,
  TraderPortfolio,
  TradingTerminal,
} from './db'
import { traderDb } from './db'

export const TRADER_TABLES = [
  'portfolios',
  'practiceSessions',
  'journalTrades',
  'dailyMoods',
  'brokerAccounts',
  'terminals',
  'profileDestinations',
] as const
export type TraderTableName = (typeof TRADER_TABLES)[number]
export interface TraderTables {
  portfolios: TraderPortfolio[]
  practiceSessions: PracticeSession[]
  journalTrades: JournalTrade[]
  dailyMoods: DailyMood[]
  brokerAccounts: BrokerAccount[]
  terminals: TradingTerminal[]
  profileDestinations: ProfileDestination[]
}
export const NATIVE_DATABASES = [
  'openalgo-chart-workspaces',
  'openalgo-chart-watchlists',
  'openalgo-chart-drawing-templates',
] as const
export const ORIGIN_KEY = 'chartly.storage.origin.v1'
const SOURCE_PREFERENCES = 'chartly.storage.original-preferences.v1'
export const PREFERENCE_KEYS = [
  'chartly.combined-selection.v1',
  'chartly.customIndicators.manifest.v1',
  'oa-trading-script-open',
  'oa-trading-script-recent',
  'oa-agent-model',
] as const
const DRAFT_KEY = /^oa-trading-script-draft:[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\.oscript$/
export interface BrowserAttachment {
  mimeType?: string
  base64?: string
  originalSource: string
  status?: 'unavailable'
  reason?: string
}
export interface BrowserSnapshot {
  format: 'chartly-browser-snapshot'
  version: 1
  originId: string
  createdAt: string
  tables: TraderTables
  nativeCatalogs: Record<string, Record<string, unknown>>
  preferences: Record<string, string>
  attachments: Record<string, BrowserAttachment>
  datasetManifests: unknown[]
}
export const emptyTraderTables = (): TraderTables => ({
  portfolios: [],
  practiceSessions: [],
  journalTrades: [],
  dailyMoods: [],
  brokerAccounts: [],
  terminals: [],
  profileDestinations: [],
})
export function browserOrigin(storage: Storage = localStorage): string {
  const saved = storage.getItem(ORIGIN_KEY)
  if (saved && /^[a-zA-Z0-9_-]{8,128}$/.test(saved)) return saved
  const id = `browser_${crypto.randomUUID().replace(/-/g, '')}`
  storage.setItem(ORIGIN_KEY, id)
  return id
}
export function readPreferences(storage: Storage = localStorage): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (
      key &&
      ((PREFERENCE_KEYS as readonly string[]).includes(key) ||
        DRAFT_KEY.test(key) ||
        CHART_PREFERENCES_KEY.test(key))
    ) {
      const value = storage.getItem(key)
      if (
        value !== null &&
        (!CHART_PREFERENCES_KEY.test(key) || validChartPreferenceEnvelope(value))
      )
        result[key] = value
    }
  }
  // Theme mode/color are harmless preferences; never export appMode/arming intent.
  try {
    const theme = JSON.parse(storage.getItem('chartly-theme') ?? 'null')
    if (theme?.state)
      result['chartly-theme'] = JSON.stringify({
        state: { mode: theme.state.mode, color: theme.state.color },
        version: theme.version ?? 0,
      })
  } catch {
    /* malformed optional preferences do not corrupt journal export */
  }
  return result
}
export function preserveSourcePreferences() {
  if (!localStorage.getItem(SOURCE_PREFERENCES))
    localStorage.setItem(SOURCE_PREFERENCES, JSON.stringify(readPreferences()))
}
function removeRuntimePreferences() {
  for (const key of Object.keys(readPreferences()))
    if (key !== 'chartly-theme') localStorage.removeItem(key)
}

function notifyRuntimePreferences() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('chartly:preferences-hydrated'))
}

export function clearRuntimePreferences() {
  removeRuntimePreferences()
  notifyRuntimePreferences()
}
export async function readBrowserTables(): Promise<TraderTables> {
  return traderDb.transaction(
    'r',
    TRADER_TABLES.map((name) => traderDb.table(name)),
    async () => {
      const result = emptyTraderTables()
      for (const name of TRADER_TABLES)
        (result[name] as unknown[]) = await traderDb.table(name).toArray()
      return result
    }
  )
}
export async function readNativeCatalogs(
  factory: IDBFactory = indexedDB
): Promise<Record<string, Record<string, unknown>>> {
  const result: Record<string, Record<string, unknown>> = {}
  const known =
    typeof factory.databases === 'function'
      ? new Set((await factory.databases()).map((info) => info.name))
      : null
  for (const name of NATIVE_DATABASES) {
    if (known && !known.has(name)) {
      result[name] = {}
      continue
    }
    result[name] = await new Promise<Record<string, unknown>>((resolve, reject) => {
      let absent = false
      const request = factory.open(name)
      request.onupgradeneeded = () => {
        absent = true
        request.transaction?.abort()
      }
      request.onerror = () =>
        absent ? resolve({}) : reject(new Error(`Saved ${name} data could not be read.`))
      request.onsuccess = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('catalogs')) {
          db.close()
          reject(new Error(`Unsupported ${name} storage format.`))
          return
        }
        const transaction = db.transaction('catalogs', 'readonly')
        const store = transaction.objectStore('catalogs')
        const cursor = store.openCursor()
        const catalogs: Record<string, unknown> = {}
        cursor.onsuccess = () => {
          const item = cursor.result
          if (!item) return
          if (typeof item.key !== 'string') {
            transaction.abort()
            return
          }
          catalogs[item.key] = item.value
          item.continue()
        }
        transaction.oncomplete = () => {
          db.close()
          resolve(catalogs)
        }
        transaction.onabort = transaction.onerror = () => {
          db.close()
          reject(new Error(`Saved ${name} data could not be read consistently.`))
        }
      }
    })
  }
  return result
}
function attachmentId(source: string): string {
  let hash = 2166136261
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619)
  return `attachment_${(hash >>> 0).toString(16)}`
}
export async function collectAttachments(
  tables: TraderTables
): Promise<Record<string, BrowserAttachment>> {
  const attachments: Record<string, BrowserAttachment> = {}
  for (const trade of tables.journalTrades)
    for (const source of [trade.screenshotUrl]) {
      if (!source) continue
      let id = attachmentId(source)
      while (attachments[id] && attachments[id].originalSource !== source) id += '_'
      if (attachments[id]) continue
      if (source.startsWith('data:')) {
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(source)
        attachments[id] = match
          ? { mimeType: match[1], base64: match[2].replace(/\s/g, ''), originalSource: source }
          : {
              originalSource: source,
              status: 'unavailable',
              reason: 'Unsupported inline image format; original reference retained.',
            }
      } else if (source.startsWith('blob:')) {
        try {
          const response = await fetch(source)
          if (!response.ok) throw new Error('Unavailable blob')
          const blob = await response.blob()
          if (!blob.type.startsWith('image/') || blob.size > 20 * 1024 * 1024)
            throw new Error('Unsupported attachment')
          const bytes = new Uint8Array(await blob.arrayBuffer())
          let binary = ''
          for (let start = 0; start < bytes.length; start += 8192)
            binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
          attachments[id] = { mimeType: blob.type, base64: btoa(binary), originalSource: source }
        } catch {
          attachments[id] = {
            originalSource: source,
            status: 'unavailable',
            reason: 'Browser image is unavailable. Its reference is retained.',
          }
        }
      } else
        attachments[id] = {
          originalSource: source,
          status: 'unavailable',
          reason: 'External image was not downloaded; original reference retained.',
        }
    }
  return attachments
}
export async function captureBrowserSnapshot(): Promise<BrowserSnapshot> {
  const tables = await readBrowserTables()
  const nativeCatalogs = await readNativeCatalogs()
  return {
    format: 'chartly-browser-snapshot',
    version: 1,
    originId: browserOrigin(),
    createdAt: new Date().toISOString(),
    tables,
    nativeCatalogs,
    preferences: JSON.parse(
      localStorage.getItem(SOURCE_PREFERENCES) ?? JSON.stringify(readPreferences())
    ),
    attachments: await collectAttachments(tables),
    datasetManifests: [],
  }
}

/** Hydrate verified view preferences. Native catalogs stay server-backed; original native databases are untouched. */
export function restoreNativeState(
  state: Partial<Pick<BrowserSnapshot, 'nativeCatalogs' | 'preferences'>>
): void {
  preserveSourcePreferences()
  removeRuntimePreferences()
  for (const [key, value] of Object.entries(state.preferences ?? {})) {
    if ((PREFERENCE_KEYS as readonly string[]).includes(key) || DRAFT_KEY.test(key))
      localStorage.setItem(key, value)
    if (key === 'chartly-theme') {
      const incoming = JSON.parse(value)
      const current = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":0}')
      const mode = incoming?.state?.mode
      const color = incoming?.state?.color
      if (
        !['light', 'dark'].includes(mode) ||
        ![
          'zinc',
          'slate',
          'stone',
          'gray',
          'neutral',
          'red',
          'rose',
          'orange',
          'green',
          'blue',
          'yellow',
          'violet',
        ].includes(color)
      )
        continue
      localStorage.setItem(
        key,
        JSON.stringify({ ...current, state: { ...current.state, mode, color } })
      )
    }
  }
  notifyRuntimePreferences()
}
