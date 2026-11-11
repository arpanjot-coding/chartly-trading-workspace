import { describe, expect, it } from 'vitest'
import { datasetChartHref, datasetLibraryHref, libraryReturn } from './dataLibraryNavigation'

describe('dataset return context', () => {
  it('preserves the selected library version and replay environment through the chart link', () => {
    const library = datasetLibraryHref('/workspace/profiles/7/replay', 'version-one')
    const chart = datasetChartHref('version-one', library)
    const params = new URL(chart, 'http://local.invalid').searchParams
    expect(params.get('datasetVersionId')).toBe('version-one')
    expect(params.get('returnTo')).toBe(library)
    expect(new URL(library, 'http://local.invalid').searchParams.get('returnTo')).toBe(
      '/workspace/profiles/7/replay'
    )
  })
  it.each([
    'https://outside.test/path',
    '//outside.test',
    '/api/local/v1/datasets',
    '/broker',
    '/workspace/../apikey',
    '/workspace\\profiles\\1',
  ])('does not return into an external or unrelated action: %s', (value) => {
    expect(libraryReturn(value)).toBe('/workspace')
  })
  it('keeps explicit original chart context and a filtered journal return', () => {
    expect(libraryReturn('/trading?profileId=1&runId=2')).toBe('/trading?profileId=1&runId=2')
    expect(libraryReturn('/workspace/profiles/7/journal?tab=Trades&book=one')).toBe(
      '/workspace/profiles/7/journal?tab=Trades&book=one'
    )
  })
  it('preserves exact profile Connections and a strictly filtered connection hub', () => {
    expect(libraryReturn('/workspace/profiles/7/connections')).toBe(
      '/workspace/profiles/7/connections'
    )
    expect(libraryReturn('/settings/connections?profileId=7')).toBe(
      '/settings/connections?profileId=7'
    )
    for (const value of [
      '/settings/connections?profileId=0',
      '/settings/connections?profileId=7&profileId=8',
      '/settings/connections?redirect=https://outside.test',
    ])
      expect(libraryReturn(value)).toBe('/workspace')
  })
})
