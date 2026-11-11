import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@/test/test-utils'
import { PaperReportDetails } from './PaperReportDetails'

afterEach(cleanup)
describe('saved independent paper report presentation', () => {
  it('retains exact decimals and unavailable denominator/sample state', () => {
    render(
      <PaperReportDetails
        value={{
          report: {
            status: 'finished',
            currency: 'USD',
            coverage: { observedCount: 2 },
            metrics: [
              {
                id: 'net',
                metricId: 'realized_net',
                value: '12.34000001',
                unit: 'currency',
                currency: 'USD',
                sampleSize: 1,
              },
              {
                id: 'pf',
                metricId: 'profit_factor',
                unit: 'ratio',
                sampleSize: 0,
                unavailableReason: 'empty_sample',
              },
            ],
            source: { datasetVersionId: 'version-one', checksum: 'original' },
            checkpoint: { stateChecksum: 'state-original' },
            checksum: 'report-original',
            equityCurve: [{ equity: '100' }, { equity: '112.34000001' }],
          },
        }}
      />
    )
    expect(screen.getByText('12.34000001 USD')).toBeInTheDocument()
    expect(screen.getByText('Unavailable: empty sample')).toBeInTheDocument()
    expect(screen.getByText('sample 0')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: "This paper account's observed equity curve" })
    ).toBeInTheDocument()
    expect(screen.getByText('State checksum: state-original')).toBeInTheDocument()
  })
})
