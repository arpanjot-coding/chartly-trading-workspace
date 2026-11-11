import { describe, expect, it } from 'vitest'
import { chartHref } from './ProfileShell'

describe('profile chart handoff', () => {
  it('carries profile context to the chart so the terminal can show the way back', () => {
    expect(chartHref(7, undefined, { name: 'London Live', kind: 'live' })).toBe(
      '/trading?profileId=7&profileName=London+Live&profileKind=live'
    )
  })

  it('carries replay run context with the profile', () => {
    expect(chartHref(7, 12, { name: 'Gold Replay', kind: 'replay' })).toBe(
      '/trading?profileId=7&runId=12&profileName=Gold+Replay&profileKind=replay'
    )
  })
})
