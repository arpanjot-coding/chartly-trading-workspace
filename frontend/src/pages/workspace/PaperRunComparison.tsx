import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import type { PracticeSession } from '@/lib/trader/db'
import { paperClient } from '@/lib/trader/paperClient'

export function PaperRunComparison({
  originId,
  profileId,
  sessions,
}: {
  originId?: string
  profileId: number
  sessions: PracticeSession[]
}) {
  const [selected, setSelected] = useState<number[]>([])
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const abort = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      generation.current++
      abort.current?.abort()
    },
    []
  )
  useEffect(() => {
    if (!originId || !Number.isSafeInteger(profileId)) return
    generation.current++
    abort.current?.abort()
    setSelected([])
    setResult(null)
    setError('')
    setBusy(false)
  }, [originId, profileId])
  const choices = sessions.filter((session) => session.paper && session.id)
  if (!choices.length) return null
  const change = (next: number[]) => {
    generation.current++
    abort.current?.abort()
    setSelected(next)
    setResult(null)
    setError('')
    setBusy(false)
  }
  const compare = async () => {
    if (!originId) return
    const current = ++generation.current
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setBusy(true)
    setError('')
    try {
      const response = await paperClient.compare(originId, profileId, selected, controller.signal)
      if (current === generation.current && !controller.signal.aborted) setResult(response)
    } catch (cause) {
      if (current === generation.current && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Independent reports could not be read.')
    } finally {
      if (current === generation.current && !controller.signal.aborted) setBusy(false)
    }
  }
  const comparison = result?.comparison as Record<string, unknown> | undefined
  const runs = Array.isArray(comparison?.runs) ? (comparison.runs as Record<string, unknown>[]) : []
  return (
    <section aria-label="Compare independent paper runs" className="space-y-3 border bg-card p-4">
      <h2 className="text-lg font-semibold">Compare independent paper runs</h2>
      <p className="text-sm text-muted-foreground">
        Each run keeps its own starting cash, currency, coverage and costs. These accounts are never
        pooled into a fictional equity curve.
      </p>
      <div className="flex flex-wrap gap-4">
        {choices.map((session) => (
          <label key={session.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(session.id!)}
              disabled={!selected.includes(session.id!) && selected.length >= 20}
              onChange={(event) =>
                change(
                  event.target.checked
                    ? [...selected, session.id!]
                    : selected.filter((id) => id !== session.id)
                )
              }
            />
            {session.name}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!originId || busy || selected.length < 2}
          onClick={() => void compare()}
        >
          Compare selected runs
        </Button>
        <Button size="sm" variant="outline" disabled={!selected.length} onClick={() => change([])}>
          Clear run selections
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <>
          <p className="text-sm">
            Selected accounts: {selected.length}. Results retain each run’s individual currency and
            assumptions.
          </p>
          {runs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {[
                      'Run',
                      'Currency',
                      'Starting cash',
                      'Cash',
                      'Equity',
                      'Realized gross',
                      'Fees',
                      'Review',
                    ].map((label) => (
                      <th key={label} className="border-b p-2">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map((row) => {
                    const summary = row.summary as Record<string, unknown> | undefined
                    return (
                      <tr key={String(row.runId)}>
                        <td className="p-2">{String(row.name ?? `Run ${row.runId}`)}</td>
                        {[
                          'currency',
                          'startingCash',
                          'cash',
                          'equity',
                          'realizedGross',
                          'fees',
                        ].map((key) => {
                          const value = row[key] ?? summary?.[key]
                          return (
                            <td className="p-2 tabular-nums" key={key}>
                              {typeof value === 'string' || typeof value === 'number'
                                ? String(value)
                                : '—'}
                            </td>
                          )
                        })}
                        <td className="p-2">
                          <Link
                            className="underline"
                            to={`/trading?${new URLSearchParams({ profileId: String(profileId), runId: String(row.runId), paper: '1' })}`}
                          >
                            Review account
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm">
              The selected report set is saved. Open each paper account to inspect its detailed
              assumptions and results.
            </p>
          )}
        </>
      )}
    </section>
  )
}
