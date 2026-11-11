import { describe, expect, it } from 'vitest'
import { isGlobalRoutingControl, observeDeveloperApi } from './context'

describe('developer API observations', () => {
  it('uses explicit successful server observations without inferring account permissions', () => {
    expect(
      observeDeveloperApi(
        { status: 'success', data: { broker_name: '  Example provider  ', placeOrder: true } },
        { status: 'success', data: { analyze_mode: false } }
      )
    ).toEqual({ provider: 'Example provider', routing: 'broker' })
    expect(observeDeveloperApi(null, { status: 'success', data: { analyze_mode: true } })).toEqual({
      provider: null,
      routing: 'sandbox',
    })
  })

  it.each([
    null,
    {},
    [],
    'live',
    { status: 'error', data: { analyze_mode: false } },
    { status: 'success', data: { analyze_mode: 'false' } },
    { status: 'success', data: { analyze_mode: 0 } },
  ])('keeps malformed, failed and missing routing unknown: %j', (value) => {
    expect(observeDeveloperApi(value, value)).toEqual({ provider: null, routing: 'unknown' })
  })

  it('filters only global routing mutation entries and keeps diagnostic/read endpoints', () => {
    for (const path of [
      '/api/v1/analyzer/toggle',
      '/api/v1/analyzer/toggle/?mode=false',
      'http://localhost:5000/api/v1/analyzer/toggle',
      '/auth/analyzer-toggle',
    ])
      expect(isGlobalRoutingControl(path)).toBe(true)
    for (const path of ['/api/v1/analyzer', '/api/v1/history', '/api/v1/placeorder'])
      expect(isGlobalRoutingControl(path)).toBe(false)
  })
})
