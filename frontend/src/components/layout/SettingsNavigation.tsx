import { ArrowLeft } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { datasetLibraryHref, libraryReturn } from '@/lib/historify/dataLibraryNavigation'
import { cn } from '@/lib/utils'

export function SettingsBackLink() {
  return (
    <Link
      to="/settings"
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Settings
    </Link>
  )
}

export function ConnectionsDataNavigation({ active }: { active: 'connections' | 'history' }) {
  const [params] = useSearchParams()
  const requested = active === 'connections' ? params.get('profileId') : null
  const returned = new URL(libraryReturn(params.get('returnTo')), 'http://local.invalid')
  const returnedProfile =
    returned.pathname === '/settings/connections'
      ? returned.searchParams.get('profileId')
      : returned.pathname.match(/^\/workspace\/profiles\/([1-9]\d*)\/connections$/)?.[1]
  const profileId = requested || returnedProfile
  const connectionsHref = `/settings/connections${profileId && /^[1-9]\d*$/.test(profileId) ? `?profileId=${profileId}` : ''}`
  const items = [
    { id: 'connections', label: 'Connections', href: connectionsHref },
    { id: 'history', label: 'History & data', href: datasetLibraryHref(connectionsHref) },
  ] as const
  return (
    <nav aria-label="Connections & Data" className="flex gap-1 overflow-x-auto border-b">
      {items.map((item) => (
        <Link
          key={item.id}
          to={item.href}
          aria-current={active === item.id ? 'page' : undefined}
          className={cn(
            'shrink-0 border-b-2 px-3 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2',
            active === item.id
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
