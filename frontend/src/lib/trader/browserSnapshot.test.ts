import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  browserOrigin,
  collectAttachments,
  emptyTraderTables,
  readNativeCatalogs,
  readPreferences,
  restoreNativeState,
} from './browserSnapshot'

vi.mock('./db', () => ({ traderDb: {} }))
beforeEach(() => localStorage.clear())
describe('browser migration source boundaries', () => {
  it('keeps a stable source identity and exports only allowlisted view preferences', () => {
    const origin = browserOrigin()
    expect(browserOrigin()).toBe(origin)
    localStorage.setItem('chartly-auth', 'secret')
    localStorage.setItem('api-key', 'secret')
    localStorage.setItem('oa-trading-armed', '1')
    localStorage.setItem('oa-trading-script-draft:sample.oscript', '{"text":"study"}')
    localStorage.setItem(
      'chartly-theme',
      JSON.stringify({ state: { mode: 'dark', color: 'blue', appMode: 'live' }, version: 1 })
    )
    const preferences = readPreferences()
    expect(Object.keys(preferences)).toEqual([
      'oa-trading-script-draft:sample.oscript',
      'chartly-theme',
    ])
    expect(JSON.parse(preferences['chartly-theme']).state).toEqual({ mode: 'dark', color: 'blue' })
  })
  it('does not open missing native databases when exporting', async () => {
    const factory = { databases: vi.fn(async () => []), open: vi.fn() }
    expect(Object.keys(await readNativeCatalogs(factory as unknown as IDBFactory))).toHaveLength(3)
    expect(factory.open).not.toHaveBeenCalled()
  })
  it('preserves screenshot references and retains external images as unavailable', async () => {
    const tables = emptyTraderTables()
    tables.journalTrades.push(
      { id: 1, screenshotUrl: 'data:image/png;base64,aGVsbG8=' } as never,
      { id: 2, screenshotUrl: 'https://example.invalid/image.png' } as never
    )
    const attachments = Object.values(await collectAttachments(tables))
    expect(attachments[0]).toMatchObject({ mimeType: 'image/png', base64: 'aGVsbG8=' })
    expect(attachments[1]).toMatchObject({
      status: 'unavailable',
      originalSource: 'https://example.invalid/image.png',
    })
    expect(tables.journalTrades[0].screenshotUrl).toBe('data:image/png;base64,aGVsbG8=')
  })
  it('hydrates preferences without touching native databases or broker arming state', async () => {
    localStorage.setItem('chartly-auth', 'retained-secret')
    localStorage.setItem('oa-trading-script-draft:old.oscript', 'private old draft')
    localStorage.setItem(
      'chartly-theme',
      JSON.stringify({ state: { appMode: 'analyzer', mode: 'light', color: 'zinc' } })
    )
    await restoreNativeState({
      nativeCatalogs: { forbidden: { source: 'untouched' } },
      preferences: {
        'chartly-theme': JSON.stringify({
          state: { mode: 'dark', color: 'blue', appMode: 'live' },
        }),
        'chartly-auth': 'injected',
      },
    })
    expect(localStorage.getItem('chartly-auth')).toBe('retained-secret')
    expect(localStorage.getItem('oa-trading-script-draft:old.oscript')).toBeNull()
    expect(
      JSON.parse(localStorage.getItem('chartly.storage.original-preferences.v1')!)
    ).toHaveProperty('oa-trading-script-draft:old.oscript')
    expect(JSON.parse(localStorage.getItem('chartly-theme')!).state.appMode).toBe('analyzer')
  })
})
