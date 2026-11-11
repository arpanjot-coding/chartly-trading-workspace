import { describe, expect, it } from 'vitest'
import { journalTimestamp, journalWallTime } from './journalForm'

describe('explicit journal wall times', () => {
  it('resolves a known local instant without the browser timezone', () => {
    expect(journalTimestamp('2026-07-01T12:15', 'Europe/London')).toBe('2026-07-01T11:15:00.000Z')
    expect(journalTimestamp('2026-01-01T00:15', 'Asia/Kolkata')).toBe('2025-12-31T18:45:00.000Z')
    expect(journalWallTime(new Date('2026-07-01T11:15:00Z'), 'Europe/London')).toBe(
      '2026-07-01T12:15'
    )
  })
  it('rejects nonexistent and repeated DST wall times rather than selecting a fold', () => {
    expect(() => journalTimestamp('2026-03-29T01:30', 'Europe/London')).toThrow('does not exist')
    expect(() => journalTimestamp('2026-10-25T01:30', 'Europe/London')).toThrow('occurs twice')
    expect(journalTimestamp('2026-10-25T01:30', 'UTC')).toBe('2026-10-25T01:30:00.000Z')
  })
  it('retains declared seconds and millisecond precision when converting an edited time', () => {
    expect(journalWallTime(new Date('2026-07-01T11:15:32.123Z'), 'Europe/London')).toBe(
      '2026-07-01T12:15:32.123'
    )
    expect(journalTimestamp('2026-07-01T12:15:32.123', 'Europe/London')).toBe(
      '2026-07-01T11:15:32.123Z'
    )
    expect(journalTimestamp('2026-07-01T12:15:00.1', 'Europe/London')).toBe(
      '2026-07-01T11:15:00.100Z'
    )
  })
  it.each([
    '2026-02-30T10:00',
    '2026-11-02',
    'not-a-date',
    '2026-11-02T25:00',
  ])('rejects invalid time %s', (value) => expect(() => journalTimestamp(value, 'UTC')).toThrow())
})
