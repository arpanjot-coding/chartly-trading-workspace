/**
 * The replay clock's words: a bar's date and time in its chart timezone.
 *
 * Built from the date parts rather than a locale's own pattern, so the
 * readout is the same on every browser and never moves the controls beside it
 * when a month name changes length between runtimes.
 */

import { isIntradayInterval, isSecondsInterval, tryResolveInterval } from 'chartly-charts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(zone: string): Intl.DateTimeFormat {
  const saved = formatters.get(zone)
  if (saved) return saved
  const value = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  })
  if (formatters.size >= 32) formatters.delete(formatters.keys().next().value!)
  formatters.set(zone, value)
  return value
}

/**
 * A daily, weekly or monthly bar has a date and no meaningful time of day. An
 * interval the library does not know keeps the time rather than hiding it.
 */
function dateOnly(interval: string): boolean {
  const code = interval.trim()
  return code !== '' && tryResolveInterval(code) !== null && !isIntradayInterval(code)
}

/**
 * `01 Oct 2026 10:15 IST` for an intraday bar, `01 Oct 2026` for a daily or
 * longer one, and seconds on a seconds chart. Empty for a missing time.
 */
export function formatBarStamp(
  time: number | null | undefined,
  interval: string,
  timezone = 'Asia/Kolkata'
): string {
  if (time === null || time === undefined || !Number.isFinite(time)) return ''
  const parts: Record<string, string> = {}
  let format: Intl.DateTimeFormat
  try {
    format = formatter(timezone)
  } catch {
    timezone = 'UTC'
    format = formatter('UTC')
  }
  for (const part of format.formatToParts(new Date(time * 1000))) parts[part.type] = part.value
  const month = MONTHS[Number(parts.month) - 1] ?? parts.month
  const date = `${parts.day} ${month} ${parts.year}`
  if (dateOnly(interval)) return date
  const seconds = isSecondsInterval(interval.trim()) ? `:${parts.second}` : ''
  const zone =
    timezone === 'Asia/Kolkata' || timezone === 'Asia/Calcutta'
      ? 'IST'
      : (parts.timeZoneName ?? timezone)
  return `${date} ${parts.hour}:${parts.minute}${seconds} ${zone}`
}
