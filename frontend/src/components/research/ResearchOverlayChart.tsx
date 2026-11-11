/**
 * Financial-series chart with filing-event markers (P16-T07).
 *
 * Driven the same way as `BacktestChart`: dynamic `chartly-charts`
 * import, app theme tokens, disposed-guarded lifecycle. Date
 * semantics come from the backend and are repeated in the legend:
 * financial points sit at fiscal period end, filing flags at SEC
 * publication instant. The two layers keep their own source labels;
 * nothing is interpolated — event times join the axis as whitespace
 * so markers anchor exactly instead of snapping to a nearby period.
 */

import type { Chart } from 'chartly-charts'
import { useEffect, useMemo, useRef } from 'react'
import type { OverlayResult } from '@/lib/trader/researchClient'
import { useThemeStore } from '@/stores/themeStore'

export interface OverlayChartData {
  items: { time: number; value: number }[]
  /** Event rug points (value is a constant 1 on a hidden scale). */
  eventPoints: { time: number; value: number }[]
  eventCount: number
  skippedPoints: number
  pointCount: number
}

function seconds(iso: string): number | null {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

export function toOverlayData(overlay: OverlayResult): OverlayChartData {
  const byTime = new Map<number, { time: number; value: number }>()
  let skipped = 0
  for (const point of overlay.series.points) {
    const time = seconds(`${point.date}T00:00:00Z`)
    const value = Number(point.value)
    if (time === null || !Number.isFinite(value)) {
      skipped += 1
      continue
    }
    byTime.set(time, { time, value }) // later point for a date wins, explicitly
  }
  // Filing events render as a rug strip in their own pane (live-found:
  // series markers need bar-grid times, whitespace anchors broke the
  // line, and 132 accession labels were an unreadable smear). The rug
  // value is a constant on a hidden scale — position on the time axis
  // is the only information, which is exactly what an event time is.
  const eventTimes = new Map<number, { time: number; value: number }>()
  for (const event of overlay.events) {
    const time = seconds(event.time)
    if (time === null) continue
    eventTimes.set(time, { time, value: 1 })
  }
  const items = [...byTime.values()].sort((a, b) => a.time - b.time)
  return {
    items,
    eventPoints: [...eventTimes.values()].sort((a, b) => a.time - b.time),
    eventCount: overlay.events.length,
    skippedPoints: skipped,
    pointCount: byTime.size,
  }
}

export function compactAxisValue(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return String(value)
}

export default function ResearchOverlayChart({
  overlay,
  lineLabel,
}: {
  overlay: OverlayResult
  lineLabel: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mode = useThemeStore((state) => state.mode)
  const appMode = useThemeStore((state) => state.appMode)
  const data = useMemo(() => toOverlayData(overlay), [overlay])

  useEffect(() => {
    const container = hostRef.current
    if (!container || data.pointCount === 0) return
    let disposed = false
    let instance: Chart | null = null
    const build = async () => {
      const [core, theme] = await Promise.all([
        import('chartly-charts'),
        import('@/lib/trading/chartTheme'),
      ])
      if (disposed) return
      try {
        const colours = theme.buildChartTheme(mode, appMode)
        const created = core.createChart(container, {
          theme: colours,
          priceAxisWidth: 64,
          ariaLabel: `${lineLabel} history with filing events`,
          shortcuts: false,
          timeNavigator: false,
          branding: false,
          timeScale: { minBarSpacing: 0.25 },
        })
        instance = created
        if (disposed) {
          created.destroy()
          instance = null
          return
        }
        const series = created.addSeries('line-markers', {
          style: { color: colours.upColor, lineWidth: 1.5 },
          priceFormat: { type: 'custom', formatter: compactAxisValue },
        })
        series.setData(data.items)
        if (data.eventPoints.length > 0) {
          const rug = created.addSeries('line-markers', {
            paneIndex: 1,
            priceScaleId: '',
            style: { color: '#b45309', markersOnly: true, markerRadius: 3 },
          })
          rug.setData(data.eventPoints)
          rug.priceScale().setOptions({ marginTop: 0.4, marginBottom: 0.4 })
        }
        created.fitContent()
      } catch {
        instance?.destroy()
        instance = null
      }
    }
    void build()
    return () => {
      disposed = true
      instance?.destroy()
      instance = null
    }
  }, [data, lineLabel, mode, appMode])

  if (data.pointCount === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No reported {lineLabel} history to chart for this company yet.
      </p>
    )
  }
  return (
    <figure className="space-y-2">
      <div ref={hostRef} className="h-64 w-full" data-testid="research-overlay-chart" />
      <figcaption className="text-xs text-muted-foreground">
        Line: {lineLabel} history ({data.pointCount} reported periods, plotted at period end).
        Dots in the lower strip: SEC filings at publication time ({data.eventCount}). Sources:{' '}
        {overlay.semantics.sources.join('; ')}. {overlay.semantics.seriesDates};{' '}
        {overlay.semantics.eventDates}. Not interpolated.
        {data.skippedPoints > 0 && ` ${data.skippedPoints} non-numeric points skipped.`}
      </figcaption>
    </figure>
  )
}
