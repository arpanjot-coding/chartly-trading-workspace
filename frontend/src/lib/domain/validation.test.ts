import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decimalUnits,
  parseRecord,
  validateRecord,
  validateRecords,
  validateReplacement,
  validateTransition,
} from './validation'

const root = resolve(process.cwd(), '../contracts/v1')
const load = (file: string) => JSON.parse(readFileSync(resolve(root, file), 'utf8'))
const manifest = load('fixture-manifest.json')
const cases = manifest.files.flatMap((file: string) => load(file))

describe('shared domain contract fixtures', () => {
  for (const fixture of cases) {
    it(fixture.id, () => {
      let actual
      if (fixture.operation === 'collection') {
        const records = load(fixture.baseFile).slice(0, fixture.takeBase)
        if (fixture.reverseBase) records.reverse()
        for (const replacement of fixture.replace)
          records[replacement.index] = structuredClone(replacement.record)
        records.push(...structuredClone(fixture.append))
        actual = validateRecords(records)
      } else if (fixture.operation === 'record')
        actual = validateRecord(fixture.type, fixture.value)
      else if (fixture.operation === 'transition')
        actual = validateTransition(fixture.machine, fixture.before, fixture.after, fixture.context)
      else if (fixture.operation === 'replacement')
        actual = validateReplacement(fixture.type, fixture.previous, fixture.proposed)
      else throw new Error('Unknown fixture operation')
      expect(actual).toEqual(fixture.expected)
    })
  }
})

it('preserves exact large decimal units without rounding', () => {
  expect(decimalUnits('9007199254740993.00000001', 8)).toBe(900719925474099300000001n)
  expect(decimalUnits('0.125', 2)).toBeNull()
  expect(decimalUnits('1e3', 2)).toBeNull()
  expect(decimalUnits('1', 1.5)).toBeNull()
})
it.each([null, 3, {}, 'records'])('requires an array, received %j', (value) => {
  expect(validateRecords(value)).toEqual([{ code: 'collection.array_required', path: '' }])
})
it('rejects malformed entries and non-record schema names', () => {
  expect(validateRecords([{ type: {}, value: {} }])).toEqual([
    { code: 'collection.entry_invalid', path: '/0' },
  ])
  expect(validateRecord('Decimal', '1')).toEqual([{ code: 'contract.unknown_type', path: '' }])
})
it('returns a detached typed record or throws structured errors', () => {
  const source = load('fixtures/local-core.json')[2].value
  const record = parseRecord('JournalBook', source)
  record.name = 'Changed'
  expect(source.name).toBe('Manual book')
  expect(() => parseRecord('JournalBook', {})).toThrow('Invalid domain contract')
})
it('bounds untrusted validation batches', () => {
  expect(validateRecords(Array(10001).fill({}))).toEqual([{ code: 'collection.limit', path: '' }])
})
