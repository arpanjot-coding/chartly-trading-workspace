/** Journal view state is carried by its own route, never by a global selected profile. */
export const journalTabs = ['Overview', 'Trades', 'Calendar', 'Breakdown', 'Mind'] as const
export type JournalTab = (typeof journalTabs)[number]
export type JournalView = {
  book?: string
  timezone?: string
  currency?: string
  review: 'All' | 'reviewed' | 'unreviewed'
  week: string
  tab: JournalTab
  period: 'all' | '3m' | '1m' | '1w'
  strategy: string
  q: string
  result: 'All' | 'Win' | 'Loss' | 'Break Even' | 'Open'
  direction: 'All' | 'Buy' | 'Sell'
  sort: 'newest' | 'pnlDesc' | 'pnlAsc' | 'duration'
  page: number
  day: string
  month: string
  trade: number | null
}

function choice<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback
}

function validDay(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : ''
}

function positiveId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

export function readJournalView(params: URLSearchParams, allowMind = true): JournalView {
  const tab = choice(params.get('tab'), journalTabs, 'Overview')
  const month = params.get('month')
  let timezone: string | undefined
  const requestedTimezone = params.get('timezone')
  if (requestedTimezone && requestedTimezone.length <= 100) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: requestedTimezone }).format()
      timezone = requestedTimezone
    } catch {
      /* invalid timezone is never guessed */
    }
  }
  const currency = params.get('currency')
  return {
    ...(params.get('book') && /^[A-Za-z0-9_-]{1,160}$/.test(params.get('book')!)
      ? { book: params.get('book')! }
      : {}),
    ...(timezone ? { timezone } : {}),
    ...(currency && /^[A-Z][A-Z0-9]{2,11}$/.test(currency) ? { currency } : {}),
    review: choice(params.get('review'), ['All', 'reviewed', 'unreviewed'], 'All'),
    week: validDay(params.get('week')),
    tab: tab === 'Mind' && !allowMind ? 'Overview' : tab,
    period: choice(params.get('period'), ['all', '3m', '1m', '1w'], 'all'),
    strategy: params.get('strategy')?.slice(0, 128) || 'All',
    q: params.get('q')?.slice(0, 256) || '',
    result: choice(params.get('result'), ['All', 'Win', 'Loss', 'Break Even', 'Open'], 'All'),
    direction: choice(params.get('direction'), ['All', 'Buy', 'Sell'], 'All'),
    sort: choice(params.get('sort'), ['newest', 'pnlDesc', 'pnlAsc', 'duration'], 'newest'),
    page: positiveId(params.get('page')) ?? 1,
    day: validDay(params.get('day')),
    month: month && validDay(`${month}-01`) ? month : '',
    trade: positiveId(params.get('trade')),
  }
}

export function writeJournalView(view: JournalView): URLSearchParams {
  const params = new URLSearchParams()
  const defaults = readJournalView(params)
  for (const key of Object.keys(view) as Array<keyof JournalView>) {
    if (view[key] !== defaults[key] && view[key] !== null && view[key] !== '') {
      params.set(key, String(view[key]))
    }
  }
  return params
}

export function journalHref(profileId: number, params = new URLSearchParams()): string {
  const query = writeJournalView(readJournalView(params)).toString()
  return `/workspace/profiles/${profileId}/journal${query ? `?${query}` : ''}`
}

/** Only the exact journal for this profile is a permitted return destination. */
export function journalReturnHref(profileId: number, target: string | null): string | null {
  const path = `/workspace/profiles/${profileId}/journal`
  if (!target || (target !== path && !target.startsWith(`${path}?`))) return null
  const url = new URL(target, 'http://chartly.local')
  if (url.origin !== 'http://chartly.local' || url.pathname !== path || url.hash) return null
  return journalHref(profileId, url.searchParams)
}

export function chartProfileNavigation(params: URLSearchParams) {
  const profileId = positiveId(params.get('profileId'))
  const name = profileId ? params.get('profileName')?.trim() || 'Portfolio' : 'Workspace'
  const journal = profileId ? journalHref(profileId) : null
  const journalReturn = profileId ? journalReturnHref(profileId, params.get('journalReturn')) : null
  return {
    profileId,
    name,
    journalHref: journalReturn || journal,
    backHref: journalReturn || (profileId ? `/workspace/profiles/${profileId}` : '/workspace'),
    backLabel: journalReturn ? `${name} journal` : name,
    returningToJournal: Boolean(journalReturn),
  }
}
