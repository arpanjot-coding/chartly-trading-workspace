import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  type DeveloperApiObservation,
  developerApiPrincipalHeaders,
  observeDeveloperApi,
} from '@/lib/developerApi/context'
import { useAuthStore } from '@/stores/authStore'

async function readStatus(
  path: string,
  signal: AbortSignal,
  principal: string | null
): Promise<unknown> {
  try {
    const response = await fetch(path, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...developerApiPrincipalHeaders(principal) },
      signal,
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
      return null
    return await response.json()
  } catch {
    return null
  }
}

const UNKNOWN: DeveloperApiObservation = { provider: null, routing: 'unknown' }

/** Observations of the existing broker API, never an account or execution permission. */
export function DeveloperApiContext({ compact = false }: { compact?: boolean }) {
  const username = useAuthStore((state) => state.user?.username)
  const broker = useAuthStore((state) => state.user?.broker)
  const principal = useAuthStore((state) => state.localPrincipalId)
  const authenticated = useAuthStore((state) => state.isAuthenticated)
  const owner = JSON.stringify([username, broker, principal, authenticated])
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{
    owner: string
    refresh: number
    observation: DeveloperApiObservation
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    void Promise.all([
      readStatus('/api/broker/capabilities', controller.signal, principal),
      readStatus('/auth/analyzer-mode', controller.signal, principal),
    ]).then(([capabilities, routing]) => {
      if (current)
        setResult({ owner, refresh, observation: observeDeveloperApi(capabilities, routing) })
    })
    return () => {
      current = false
      controller.abort()
    }
  }, [owner, refresh, principal])

  const loaded = result?.owner === owner && result.refresh === refresh
  const observation = loaded ? result.observation : UNKNOWN
  return (
    <section
      aria-label="Developer API context"
      className={compact ? 'border-b px-4 py-2 text-xs' : 'border bg-card p-4 text-sm'}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>Broker API context</strong>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setRefresh((value) => value + 1)}
          disabled={!loaded}
        >
          <RefreshCw className={`mr-1.5 h-3 w-3 ${!loaded ? 'animate-spin' : ''}`} />
          Refresh status
        </Button>
      </div>
      <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
        <div>
          <dt className="inline text-muted-foreground">Configured provider: </dt>
          <dd className="inline">{observation.provider ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Server order routing: </dt>
          <dd className="inline">
            {observation.routing === 'sandbox'
              ? 'Legacy sandbox'
              : observation.routing === 'broker'
                ? 'Broker API — orders may be real'
                : 'Unknown'}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Trading account: </dt>
          <dd className="inline">Not reported by this API</dd>
        </div>
      </dl>
      <p className="mt-2 text-muted-foreground">
        Provider metadata does not verify an account or permission to trade. Eligible broker API
        requests follow the server routing and approval policy; this is separate from profile paper
        trading. Manage read-only account connections and saved history in{' '}
        <Link className="underline underline-offset-2" to="/settings/connections">
          Connections & Data
        </Link>
        .
      </p>
    </section>
  )
}
