import { ArrowLeft, BookOpenCheck, CandlestickChart, History } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink, useSearchParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { TraderPortfolio } from '@/lib/trader/db'
import { journalHref, journalReturnHref } from '@/lib/trader/journalNavigation'
import { cn } from '@/lib/utils'

export type ProfileSection = 'overview' | 'journal' | 'connections' | 'replay' | 'settings'

export function profileHref(profileId: number, section: ProfileSection = 'overview') {
  const base = `/workspace/profiles/${profileId}`
  return section === 'overview' ? base : `${base}/${section}`
}

export function chartHref(
  profileId: number,
  runId?: number,
  context?: { name?: string; kind?: TraderPortfolio['kind'] },
  journalReturn?: string,
  tradeId?: number,
  bookId?: string,
  datasetVersionId?: string
) {
  const params = new URLSearchParams({ profileId: String(profileId) })
  if (runId) params.set('runId', String(runId))
  if (tradeId) params.set('tradeId', String(tradeId))
  if (bookId) params.set('bookId', bookId)
  if (datasetVersionId) params.set('datasetVersionId', datasetVersionId)
  if (context?.name) params.set('profileName', context.name)
  if (context?.kind) params.set('profileKind', context.kind)
  const returnHref = journalReturnHref(profileId, journalReturn ?? null)
  if (returnHref) params.set('journalReturn', returnHref)
  return `/trading?${params.toString()}`
}

export function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

export function pnlTone(value: number) {
  return value > 0
    ? 'text-teal-600 dark:text-teal-400'
    : value < 0
      ? 'text-red-600 dark:text-red-400'
      : 'text-foreground'
}

const profileTypeClass = (live: boolean) =>
  live
    ? 'border-teal-700/15 bg-teal-700/5 text-teal-800 dark:border-teal-400/20 dark:bg-teal-400/10 dark:text-teal-300'
    : 'border-border bg-muted/50 text-foreground'

export function ProfileHeader({
  portfolio,
  active,
  children,
}: {
  portfolio: TraderPortfolio
  active: ProfileSection
  children?: ReactNode
}) {
  const [searchParams] = useSearchParams()
  if (!portfolio.id) return null

  const returnHref = journalReturnHref(portfolio.id, searchParams.get('journalReturn'))
  const tabs: Array<{ key: ProfileSection; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'connections', label: 'Connections' },
    { key: 'settings', label: 'Settings' },
  ]
  const managementHref = (section: ProfileSection) => {
    const path = profileHref(portfolio.id!, section)
    return returnHref ? `${path}?${new URLSearchParams({ journalReturn: returnHref })}` : path
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
            <Link to="/workspace">
              <ArrowLeft className="h-4 w-4" aria-hidden /> All profiles
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight sm:text-3xl">
              {portfolio.name}
            </h1>
            <Badge variant="outline" className={profileTypeClass(portfolio.kind === 'live')}>
              {portfolio.kind === 'live' ? 'Live profile' : 'Replay project'}
            </Badge>
            {portfolio.sessionLabel && <Badge variant="outline">{portfolio.sessionLabel}</Badge>}
            {portfolio.needsClassification && <Badge variant="destructive">Confirm type</Badge>}
          </div>
          <p className="mt-2 break-words text-sm leading-5 text-muted-foreground">
            {portfolio.currency} · created {dateLabel(portfolio.createdAt)}
            {portfolio.timezone ? ` · ${portfolio.timezone}` : ''}
            {portfolio.strategyTags?.length ? ` · ${portfolio.strategyTags.join(', ')}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild>
            <Link to={chartHref(portfolio.id, undefined, portfolio)}>
              <CandlestickChart className="h-4 w-4" /> Open chart
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={returnHref || profileHref(portfolio.id, 'journal')}>
              <BookOpenCheck className="h-4 w-4" /> Journal
            </Link>
          </Button>
          {portfolio.kind === 'replay' && (
            <Button asChild variant="outline">
              <Link to={managementHref('replay')}>
                <History className="h-4 w-4" /> Runs
              </Link>
            </Button>
          )}
        </div>
      </header>

      <nav aria-label="Profile sections" className="flex flex-wrap gap-1 border-b">
        {tabs.map((tab) => (
          <NavLink
            key={tab.key}
            to={managementHref(tab.key)}
            end={tab.key === 'overview'}
            className={cn(
              '-mb-px rounded-t-md border-b-2 px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              active === tab.key
                ? 'border-foreground bg-muted/45 text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/35 hover:text-foreground'
            )}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      {children}
    </div>
  )
}

/** The journal has its own controls; portfolio management is a separate destination. */
export function JournalNavigation({
  portfolio,
  params,
  chartLink,
}: {
  portfolio: TraderPortfolio
  params: URLSearchParams
  chartLink?: string
}) {
  if (!portfolio.id) return null
  const returnHref = journalHref(portfolio.id, params)
  const detailsHref = `${profileHref(portfolio.id)}?${new URLSearchParams({ journalReturn: returnHref })}`
  return (
    <nav
      aria-label="Journal workspace"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link to="/workspace">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Workspace
          </Link>
        </Button>
        <span className="min-w-0 break-words text-sm font-medium">{portfolio.name}</span>
        <Badge variant="outline" className={profileTypeClass(portfolio.kind === 'live')}>
          {portfolio.kind === 'live' ? 'Live journal' : 'Paper journal'}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to={chartLink ?? chartHref(portfolio.id, undefined, portfolio, returnHref)}>
            <CandlestickChart className="h-4 w-4" /> Open chart
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to={detailsHref}>Portfolio details</Link>
        </Button>
      </div>
    </nav>
  )
}

export function StatTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail?: string
  tone?: string
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4 shadow-xs">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div
        className={cn('mt-2 break-words text-2xl font-semibold tracking-tight tabular-nums', tone)}
      >
        {value}
      </div>
      {detail && <div className="mt-1.5 text-sm leading-5 text-muted-foreground">{detail}</div>}
    </div>
  )
}
