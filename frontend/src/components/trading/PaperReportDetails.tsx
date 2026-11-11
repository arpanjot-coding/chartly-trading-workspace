const labels: Record<string, string> = {
  realized_net: 'Realized net',
  unrealized_pnl: 'Unrealized P&L',
  fees: 'Total fees',
  win_rate: 'Win rate',
  profit_factor: 'Profit factor',
  max_drawdown: 'Maximum drawdown',
  max_drawdown_percent: 'Maximum drawdown %',
}
export function PaperReportDetails({ value }: { value: Record<string, unknown> }) {
  const report = (value.report ?? value) as Record<string, unknown>
  const metrics = Array.isArray(report.metrics) ? (report.metrics as Record<string, unknown>[]) : []
  const coverage = report.coverage as Record<string, unknown> | undefined
  const source = report.source as Record<string, unknown> | undefined
  const checkpoint = report.checkpoint as Record<string, unknown> | undefined
  const assumptions = Array.isArray(report.assumptions)
    ? (report.assumptions.filter((item) => typeof item === 'string') as string[])
    : []
  const curve = Array.isArray(report.equityCurve)
    ? (report.equityCurve as Record<string, unknown>[]).filter((point) =>
        Number.isFinite(Number(point.equity))
      )
    : []
  const sampled = curve.filter(
    (_, index) =>
      index % Math.max(1, Math.ceil(curve.length / 200)) === 0 || index === curve.length - 1
  )
  const values = sampled.map((point) => Number(point.equity))
  const low = Math.min(...values),
    high = Math.max(...values),
    span = Math.max(high - low, 1)
  const points = sampled
    .map(
      (point, index) =>
        `${10 + (index / Math.max(1, sampled.length - 1)) * 280},${90 - ((Number(point.equity) - low) / span) * 80}`
    )
    .join(' ')
  return (
    <section aria-label="Saved paper report" className="space-y-3 rounded border p-2">
      <h4 className="font-semibold">
        Saved report · {String(report.status ?? 'paper')} · revision{' '}
        {String(report.revision ?? '—')}
      </h4>
      <p>
        Coverage: {String(coverage?.observedCount ?? 0)} observed candles. Results belong to this
        independent {String(report.currency ?? '')} account.
      </p>
      <dl className="space-y-2">
        {metrics.map((metric) => (
          <div key={String(metric.id ?? metric.metricId)}>
            <dt>{labels[String(metric.metricId)] ?? String(metric.metricId)}</dt>
            <dd className="font-medium">
              {typeof metric.value === 'string'
                ? `${metric.value}${metric.unit === 'percent' ? '%' : metric.unit === 'currency' ? ` ${String(metric.currency ?? report.currency ?? '')}` : ''}`
                : `Unavailable: ${String(metric.unavailableReason ?? 'missing input').replaceAll('_', ' ')}`}
              <span className="ml-2 font-normal text-muted-foreground">
                sample {String(metric.sampleSize ?? 0)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {sampled.length > 0 && (
        <figure>
          <svg
            viewBox="0 0 300 100"
            role="img"
            aria-label="This paper account's observed equity curve"
            className="w-full border bg-background"
          >
            <title>Observed equity for this independent paper account</title>
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <figcaption>
            Observed-close equity · {String(report.currency ?? '')} · display sampled when
            necessary; drawdown metrics use every observed close.
          </figcaption>
        </figure>
      )}
      {assumptions.length > 0 && (
        <ul className="list-disc space-y-1 pl-4">
          {assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer">Source and checkpoint evidence</summary>
        <p className="break-all">
          Dataset: {String(source?.datasetVersionId ?? '—')} · checksum{' '}
          {String(source?.checksum ?? '—')}
        </p>
        <p className="break-all">State checksum: {String(checkpoint?.stateChecksum ?? '—')}</p>
        <p className="break-all">Report checksum: {String(report.checksum ?? '—')}</p>
      </details>
    </section>
  )
}
