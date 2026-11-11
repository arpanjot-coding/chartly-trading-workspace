import type { ReactNode } from 'react'

/**
 * Shared product states (P18-T02/T05). Every state is announced to
 * assistive technology (status/alert), carries a text label so meaning
 * never depends on colour alone, and offers an explicit next action.
 */
const LABELS = {
  loading: 'Loading',
  empty: 'Nothing here yet',
  error: 'Something went wrong',
  stale: 'Data may be out of date',
  partial: 'Partially available',
  saved: 'Saved',
} as const

export type StateKind = keyof typeof LABELS

export function StateNotice({
  kind,
  detail,
  action,
}: {
  kind: StateKind
  detail?: string
  action?: ReactNode
}) {
  const isError = kind === 'error'
  return (
    <output
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className="block space-y-2 border bg-card p-4 text-sm"
      data-state-kind={kind}
    >
      <span className="font-semibold">{LABELS[kind]}</span>
      {detail && <span className="block text-muted-foreground">{detail}</span>}
      {action}
    </output>
  )
}

/**
 * Unambiguous execution context (P18-T04): account, environment/mode
 * and data source are always rendered as text, never colour alone.
 */
export function ContextBanner({
  account,
  mode,
  source,
  freshness,
}: {
  account: string
  mode: string
  source: string
  freshness?: string
}) {
  return (
    <section
      className="flex flex-wrap gap-x-4 gap-y-1 border bg-muted/40 px-3 py-2 text-xs"
      aria-label="Current context"
    >
      <span>
        Account: <strong>{account}</strong>
      </span>
      <span>
        Environment: <strong>{mode}</strong>
      </span>
      <span>
        Source: <strong>{source}</strong>
      </span>
      {freshness && (
        <span>
          Freshness: <strong>{freshness}</strong>
        </span>
      )}
    </section>
  )
}
