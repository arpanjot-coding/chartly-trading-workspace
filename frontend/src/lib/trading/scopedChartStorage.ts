/** Existing preference names stored inside a private, recoverable context envelope. */
export const CHART_PREFERENCES_KEY = /^chartly\.chart\.preferences\.v1:[A-Za-z0-9_%:~.-]{1,240}$/
const GLOBAL = new Set([
  'oa-trading-layout',
  'oa-trading-sync',
  'oa-trading-panel',
  'oa-trading-armed',
  'oa-trading-rail-folded',
  'oa-trading-layout-sizes',
  'oa-trading-dock',
  'oa-trading-dock-height',
])
const PANE =
  /^oa-trading-p(?:[0-9]|1[0-5])-(?:alerts|chartsettings|comparisons|ctype|grid|indicators|interval|magnet-mode|magnet|panes-folded|product|range|stay|symbol|transforms|vol|draw|draw-scoped|draw:[A-Za-z0-9_%:~.!'()*+-]{1,400})$/
export const chartPreferenceName = (key: string) => GLOBAL.has(key) || PANE.test(key)
export function validChartPreferenceEnvelope(raw: string): boolean {
  if (raw.length > 2 * 1024 * 1024) return false
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const entries = Object.entries(value)
    return (
      entries.length <= 2048 &&
      entries.every(
        ([key, item]) =>
          chartPreferenceName(key) && typeof item === 'string' && item.length <= 1024 * 1024
      )
    )
  } catch {
    return false
  }
}
/** No scoped read inherits a global pane; original browser records remain untouched. */
export function scopedChartStorage(scope?: string, store: Storage = localStorage): Storage {
  if (!scope) return store
  const key = `chartly.chart.preferences.v1:${scope}`
  if (!CHART_PREFERENCES_KEY.test(key))
    throw new Error('The chart context cannot be saved. Reopen it from Workspace.')
  const read = (): Record<string, string> => {
    const raw = store.getItem(key)
    return raw && validChartPreferenceEnvelope(raw) ? JSON.parse(raw) : {}
  }
  const write = (value: Record<string, string>) => {
    const raw = JSON.stringify(value)
    if (!validChartPreferenceEnvelope(raw))
      throw new Error(
        'This chart preference snapshot exceeds its supported size. Save a named chart workspace before adding more drawings.'
      )
    store.setItem(key, raw)
    if (typeof window !== 'undefined')
      window.dispatchEvent(new Event('chartly:preferences-changed'))
  }
  return {
    get length() {
      return Object.keys(read()).length
    },
    key(index) {
      return Object.keys(read())[index] ?? null
    },
    getItem(name) {
      return chartPreferenceName(name) ? (read()[name] ?? null) : null
    },
    setItem(name, value) {
      if (!chartPreferenceName(name)) return
      write({ ...read(), [name]: String(value) })
    },
    removeItem(name) {
      const value = read()
      delete value[name]
      write(value)
    },
    clear() {
      write({})
    },
  }
}
