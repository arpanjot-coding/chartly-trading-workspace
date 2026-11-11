import { describe, expect, it } from 'vitest'
import { validateCustomIndicatorSource as validateWith } from './validateCustomIndicator'

/** Node can import data: URLs; the browser path stages on the server instead. */
async function stageAsDataUrl(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:text/javascript;base64,${btoa(binary)}`
}

const validateCustomIndicatorSource = (source: string) => validateWith(source, stageAsDataUrl)

const GOOD = `export default function ({ registerIndicator, sourceValues }) {
  registerIndicator({
    id: 'test-sma',
    name: 'Test SMA',
    category: 'Custom',
    placement: 'onchart',
    inputs: [{ key: 'length', type: 'number', label: 'Length', default: 5 }],
    plots: [{ key: 'ma', type: 'line', title: 'MA' }],
    calc(bars, settings) {
      const src = sourceValues(bars, 'close')
      return { ma: src.map((value) => value) }
    },
  })
}`

describe('validateCustomIndicatorSource', () => {
  it('accepts a well-formed indicator and reports its descriptor', async () => {
    const result = await validateCustomIndicatorSource(GOOD)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.indicators).toEqual([{ id: 'test-sma', name: 'Test SMA', placement: 'onchart' }])
  })

  it('refuses a calc that returns no column for its plot', async () => {
    const bad = GOOD.replace('return { ma: src.map((value) => value) }', 'return { other: src }')
    const result = await validateCustomIndicatorSource(bad)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain("no column 'ma'")
  })

  it('refuses a short column instead of letting it draw nothing', async () => {
    const bad = GOOD.replace(
      'return { ma: src.map((value) => value) }',
      'return { ma: src.slice(0, 3) }'
    )
    const result = await validateCustomIndicatorSource(bad)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('values for 120 bars')
  })

  it('refuses an unknown placement with the loader wording', async () => {
    const result = await validateCustomIndicatorSource(GOOD.replace("'onchart'", "'overlay'"))
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain("placement must be 'onchart' or 'pane'")
  })

  it('refuses a module that never registers', async () => {
    const result = await validateCustomIndicatorSource('export default function () {}')
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('never called registerIndicator')
  })

  it('refuses unparseable source and empty drafts', async () => {
    const syntax = await validateCustomIndicatorSource('export default function ({')
    expect(syntax.ok).toBe(false)
    expect(syntax.errors.join(' ')).toContain('does not parse')
    const empty = await validateCustomIndicatorSource('   ')
    expect(empty.ok).toBe(false)
    expect(empty.errors).toEqual(['The source is empty.'])
  })
})
