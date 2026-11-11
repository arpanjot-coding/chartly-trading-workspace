/** Convert displayed IANA wall time without guessing a daylight-saving fold. */
export function journalWallTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? ''
  const seconds = value('second')
  const fraction = date.getUTCMilliseconds()
    ? `.${String(date.getUTCMilliseconds()).padStart(3, '0')}`
    : ''
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}${seconds !== '00' || fraction ? `:${seconds}${fraction}` : ''}`
}
export function journalTimestamp(value: string, timezone: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(\.\d{1,3})?)?$/.exec(value)
  if (!match) throw new Error('Enter a complete journal date and time.')
  const seconds = match[2] ?? '00'
  const milliseconds = (match[3]?.slice(1) ?? '').padEnd(3, '0')
  const wall = Date.parse(`${match[1]}:${seconds}.${milliseconds}Z`)
  if (
    !Number.isFinite(wall) ||
    new Date(wall).toISOString().slice(0, 23) !== `${match[1]}:${seconds}.${milliseconds}`
  )
    throw new Error('Enter a valid journal date and time.')
  const normalized = journalWallTime(new Date(wall), 'UTC')
  const candidates = new Set<number>()
  for (let hour = -36; hour <= 36; hour += 6) {
    const sample = wall + hour * 3_600_000
    const local = journalWallTime(new Date(sample), timezone)
    const offset = Date.parse(`${local}Z`) - sample
    const candidate = wall - offset
    if (journalWallTime(new Date(candidate), timezone) === normalized) candidates.add(candidate)
  }
  if (candidates.size === 0)
    throw new Error(
      'That local time does not exist because the clocks change. Choose another time or switch the journal to UTC.'
    )
  if (candidates.size > 1)
    throw new Error(
      'That local time occurs twice because the clocks change. Switch the journal to UTC and enter the exact instant.'
    )
  return new Date([...candidates][0]).toISOString()
}
export function downloadJournalFile(value: Blob | unknown, filename: string) {
  const blob =
    value instanceof Blob
      ? value
      : new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  URL.revokeObjectURL(href)
}
