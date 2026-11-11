import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OverlayResult } from '@/lib/trader/researchClient'
import ResearchOverlayChart, { toOverlayData } from './ResearchOverlayChart'

const chartCalls = vi.hoisted(() => ({
  setData: [] as unknown[],
  setMarkers: [] as unknown[],
  seriesTypes: [] as string[],
}))

vi.mock('chartly-charts', () => ({
  createChart: () => ({
    addSeries: (type: string) => {
      chartCalls.seriesTypes.push(type)
      return {
        setData: (items: unknown) => chartCalls.setData.push(items),
        priceScale: () => ({ setOptions: () => {} }),
      }
    },
    fitContent: () => {},
    destroy: () => {},
  }),
}))
vi.mock('@/lib/trading/chartTheme', () => ({
  buildChartTheme: () => ({ upColor: '#16a34a' }),
}))

const overlay: OverlayResult = {
  series: {
    line: 'revenue',
    concept: 'us-gaap:Revenues',
    points: [
      {
        date: '2024-06-30',
        value: '245122000000',
        unit: 'USD',
        span: 'year',
        fiscalYear: 2024,
        fiscalPeriod: 'FY',
        citation: '10-K accession 1',
      },
      {
        date: '2025-06-30',
        value: '246000000000',
        unit: 'USD',
        span: 'year',
        fiscalYear: 2025,
        fiscalPeriod: 'FY',
        citation: '10-K/A accession 2',
      },
      {
        date: '2025-06-30',
        value: 'not-a-number',
        unit: 'USD',
        span: 'year',
        fiscalYear: 2025,
        fiscalPeriod: 'FY',
        citation: 'bad row',
      },
    ],
  },
  events: [
    {
      time: '2025-07-30T20:05:00Z',
      label: '0000950170-25-000001',
      sourceUrl: 'https://www.sec.gov/Archives/x',
    },
  ],
  semantics: {
    seriesDates: 'period end (fiscal period close), span carried per point',
    eventDates: 'filing publication instant (SEC acceptance)',
    interpolated: false,
    sources: ['SEC EDGAR company facts (stored)', 'SEC EDGAR filing index (stored)'],
  },
}

beforeEach(() => {
  chartCalls.setData = []
  chartCalls.setMarkers = []
  chartCalls.seriesTypes = []
})
afterEach(() => cleanup())

describe('P16-T07 overlay', () => {
  it('builds sorted points, keeps the line unbroken and counts skips honestly', () => {
    const data = toOverlayData(overlay)
    expect(data.pointCount).toBe(2)
    expect(data.skippedPoints).toBe(1)
    const times = data.items.map((row) => row.time)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(times).toHaveLength(2) // points only: whitespace broke the line (live-found)
    expect(data.eventCount).toBe(1)
    expect(data.eventPoints).toEqual([
      { time: Math.floor(Date.parse('2025-07-30T20:05:00Z') / 1000), value: 1 },
    ])
  })

  it('dedupes dense filing events in the rug while keeping the true count', () => {
    const dense = {
      ...overlay,
      events: Array.from({ length: 40 }, (_, i) => ({
        time: '2025-07-30T20:05:00Z',
        label: `acc-${i}`,
        sourceUrl: 'https://www.sec.gov/Archives/x',
      })),
    }
    const data = toOverlayData(dense)
    expect(data.eventCount).toBe(40)
    expect(data.eventPoints).toHaveLength(1) // same instant shares one rug dot
  })

  it('renders the chart with labelled layers and source semantics', async () => {
    render(<ResearchOverlayChart overlay={overlay} lineLabel="revenue" />)
    await waitFor(() => expect(chartCalls.setData).toHaveLength(2))
    expect(chartCalls.seriesTypes).toEqual(['line-markers', 'line-markers'])
    expect(screen.getByTestId('research-overlay-chart')).toBeVisible()
    expect(screen.getByText(/Line: revenue history \(2 reported periods/)).toBeVisible()
    expect(screen.getByText(/Dots in the lower strip: SEC filings at publication time \(1\)/)).toBeVisible()
    expect(screen.getByText(/Not interpolated/)).toBeVisible()
    expect(screen.getByText(/1 non-numeric points skipped/)).toBeVisible()
  })

  it('shows an explicit empty state instead of an empty chart', () => {
    render(
      <ResearchOverlayChart
        overlay={{ ...overlay, series: { line: 'revenue', concept: null, points: [] } }}
        lineLabel="revenue"
      />
    )
    expect(screen.getByText(/No reported revenue history to chart/)).toBeVisible()
    expect(chartCalls.setData).toHaveLength(0)
  })
})
