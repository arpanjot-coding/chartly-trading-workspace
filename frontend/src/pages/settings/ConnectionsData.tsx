import { Link, useSearchParams } from 'react-router'
import { ConnectorPanel } from '@/components/connections/ConnectorPanel'
import { ConnectionsDataNavigation, SettingsBackLink } from '@/components/layout/SettingsNavigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useTraderData } from '@/lib/trader/useTraderData'
import { chartHref, profileHref } from '@/pages/workspace/ProfileShell'

export default function ConnectionsData() {
  const [params, setParams] = useSearchParams()
  const data = useTraderData()
  const profiles = data.portfolios.filter(
    (profile) => profile.id && profile.kind === 'live' && !profile.archivedAt
  )
  const requestedProfile = params.get('profileId')
  const profile = profiles.find((item) => String(item.id) === requestedProfile)
  const scopedProfileId =
    profile?.id ??
    (data.loading &&
    requestedProfile &&
    /^[1-9]\d*$/.test(requestedProfile) &&
    Number.isSafeInteger(Number(requestedProfile))
      ? Number(requestedProfile)
      : undefined)
  const unavailableProfile = !!requestedProfile && !profile && !data.loading
  function selectProfile(value: string) {
    const next = new URLSearchParams(params)
    next.delete('tab')
    if (value) next.set('profileId', value)
    else next.delete('profileId')
    setParams(next)
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6">
      <header className="space-y-3">
        <SettingsBackLink />
        <div>
          <h1 className="text-2xl font-bold">Connections & Data</h1>
          <p className="mt-1 text-muted-foreground">
            Connect your sources and manage the saved history you use in charts and research.
          </p>
        </div>
      </header>
      <ConnectionsDataNavigation active="connections" />
      <section className="space-y-3 border p-4" aria-label="Connection profile">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="connections-profile">Profile</Label>
          <select
            id="connections-profile"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={profile?.id ?? ''}
            disabled={data.loading}
            onChange={(event) => selectProfile(event.target.value)}
          >
            <option value="">All profiles</option>
            {profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        {data.loading && <output>Opening your workspace…</output>}
        {data.error && (
          <div role="alert" className="space-y-2 text-sm">
            <p>{data.error}</p>
            <Button variant="outline" onClick={() => void data.reload()}>
              Retry workspace
            </Button>
          </div>
        )}
        {unavailableProfile ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>This profile is unavailable in the current workspace.</p>
            <Button variant="outline" onClick={() => selectProfile('')}>
              Show all profiles
            </Button>
          </div>
        ) : profile?.id ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p>
              {profile.name} · {profile.currency}
            </p>
            <Button asChild size="sm" variant="outline">
              <Link to={chartHref(profile.id, undefined, profile)}>Chart</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={profileHref(profile.id, 'journal')}>Journal</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to={profileHref(profile.id)}>Open profile</Link>
            </Button>
          </div>
        ) : (
          !data.loading && (
            <p className="text-sm text-muted-foreground">
              Choose a profile to focus its connections, or manage all sources here.
              {!profiles.length && (
                <>
                  {' '}
                  Create a live profile in{' '}
                  <Link className="underline" to="/workspace">
                    Workspace
                  </Link>{' '}
                  when you want to link an account journal.
                </>
              )}
            </p>
          )
        )}
      </section>
      {!unavailableProfile && (
        <ConnectorPanel
          profileId={scopedProfileId}
          returnTo={`/settings/connections${scopedProfileId ? `?profileId=${scopedProfileId}` : ''}`}
        />
      )}
    </div>
  )
}
