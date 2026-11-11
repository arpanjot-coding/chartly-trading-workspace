import { useEffect, useRef, useState } from 'react'
import { paperClient } from '@/lib/trader/paperClient'

interface Props {
  originId?: string
  principalId?: string | null
  profileId: number
  runId: number
  revision: number
}

/** Journal rows can be partial realizations. Only the paper report owns closed-position statistics. */
export function PaperRunMetrics({ originId, principalId, profileId, runId, revision }: Props) {
  const scope = `${principalId ?? ''}:${originId ?? ''}:${profileId}:${runId}:${revision}`
  const current = useRef(scope)
  current.current = scope
  const abort = useRef<AbortController | null>(null)
  const [result, setResult] = useState<{ scope: string; report: Record<string, unknown> } | null>(
    null
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (current.current !== scope) return
    setLoading(false)
    setError('')
    return () => abort.current?.abort()
  }, [scope])
  const report = result?.scope === scope ? result.report : null
  const metrics = Array.isArray(report?.metrics)
    ? (report.metrics as Record<string, unknown>[])
    : []
  const metric = (id: string) => metrics.find((item) => item.metricId === id)
  const net = metric('realized_net'),
    win = metric('win_rate')
  const value = (item: Record<string, unknown> | undefined) =>
    typeof item?.value === 'string' && /^-?\d+(?:\.\d+)?$/.test(item.value) ? item.value : null
  const netValue = value(net),
    winValue = value(win)
  async function load() {
    if (!originId) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const requested = scope
    setLoading(true)
    setError('')
    try {
      const response = await paperClient.report(originId, runId, controller.signal)
      if (controller.signal.aborted || current.current !== requested) return
      const saved = response.report as Record<string, unknown> | undefined
      if (
        !saved ||
        saved.runId !== runId ||
        saved.profileId !== profileId ||
        saved.revision !== revision
      )
        throw new Error(
          'The account changed. Reload this project before loading its saved metrics.'
        )
      setResult({ scope: requested, report: saved })
    } catch (cause) {
      if (!controller.signal.aborted && current.current === requested)
        setError(cause instanceof Error ? cause.message : 'Saved metrics are unavailable.')
    } finally {
      if (!controller.signal.aborted && current.current === requested) setLoading(false)
    }
  }
  return (
    <>
      <div>
        <dt className="text-muted-foreground">Realized net</dt>
        <dd className="mt-1 font-semibold">
          {netValue === null ? 'Unavailable' : `${netValue} ${String(report?.currency ?? '')}`}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Win rate</dt>
        <dd className="mt-1 font-semibold">
          {winValue === null || Number(win?.sampleSize ?? 0) < 1 ? 'Unavailable' : `${winValue}%`}
        </dd>
        {report && (
          <dd className="text-xs text-muted-foreground">
            {String(win?.sampleSize ?? 0)} fully closed{' '}
            {Number(win?.sampleSize) === 1 ? 'position' : 'positions'}
          </dd>
        )}
      </div>
      <div className="col-span-2 text-xs text-muted-foreground">
        <button
          type="button"
          className="underline disabled:opacity-50"
          disabled={loading || !originId}
          onClick={() => void load()}
        >
          {loading ? 'Loading saved metrics…' : 'Load saved metrics'}
        </button>
        {report && (
          <p>Paper report · revision {revision}. Includes allocated entry and exit fees.</p>
        )}
        {!report && !error && (
          <p>Load this account’s report to review net results and closed-position statistics.</p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </>
  )
}
