import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ContextBanner, StateNotice } from './states'

describe('shared states (P18)', () => {
  it('announces errors assertively and other states politely, with text labels', () => {
    render(<StateNotice kind="error" detail="The local engine is unavailable." />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong')
    expect(alert).toHaveTextContent('local engine is unavailable')
    render(<StateNotice kind="stale" detail="Last updated 2026-11-04." />)
    expect(screen.getByRole('status')).toHaveTextContent('Data may be out of date')
  })

  it('renders every state kind with a non-colour label', () => {
    for (const [kind, label] of [
      ['loading', 'Loading'],
      ['empty', 'Nothing here yet'],
      ['partial', 'Partially available'],
      ['saved', 'Saved'],
    ] as const) {
      const { unmount } = render(<StateNotice kind={kind} />)
      expect(screen.getByText(label)).toBeVisible()
      unmount()
    }
  })

  it('shows account, environment and source unambiguously as text', () => {
    render(
      <ContextBanner
        account="Kraken · key:abc123"
        mode="broker_demo (paper)"
        source="SEC EDGAR stored facts"
        freshness="as of 2026-11-04T12:00:00Z"
      />
    )
    const banner = screen.getByLabelText('Current context')
    expect(banner).toHaveTextContent('Account: Kraken')
    expect(banner).toHaveTextContent('Environment: broker_demo (paper)')
    expect(banner).toHaveTextContent('Source: SEC EDGAR stored facts')
  })
})
