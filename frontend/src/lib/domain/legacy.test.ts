import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { classifyLegacyTrade, legacyAlias } from './legacy'

const cases = JSON.parse(
  readFileSync(resolve(process.cwd(), '../contracts/v1/fixtures/legacy-cases.json'), 'utf8')
)
for (const fixture of cases)
  it(fixture.id, () => expect(classifyLegacyTrade(fixture.value)).toEqual(fixture.expected))
it('scopes aliases by origin and table', () => {
  expect(legacyAlias('origin-a', 'portfolios', 1)).toEqual({
    namespace: 'ChartlyTraderDB:origin-a:portfolios',
    key: '1',
  })
  expect(legacyAlias('origin-a', 'portfolios', 1)).not.toEqual(
    legacyAlias('origin-b', 'portfolios', 1)
  )
  expect(legacyAlias('origin-a', 'portfolios', 1)).not.toEqual(
    legacyAlias('origin-a', 'brokerAccounts', 1)
  )
})
it.each([
  ['', 'portfolios', 1],
  ['a:b', 'portfolios', 1],
  ['origin-a', 'unknown', 1],
  ['origin-a', 'portfolios', 1.5],
] as const)('rejects alias %j %j %j', (origin, table, id) => {
  expect(() => legacyAlias(origin, table, id)).toThrow()
})
