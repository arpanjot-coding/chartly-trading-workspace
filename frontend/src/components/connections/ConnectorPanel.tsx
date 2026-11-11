import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConnections } from '@/hooks/useConnections'
import type {
  ConnectorConnection,
  ConnectorHistory,
  ConnectorProvider,
} from '@/lib/trader/connectorClient'
import { connectorClient } from '@/lib/trader/connectorClient'
import { useTraderData } from '@/lib/trader/useTraderData'
import { chartStorageAccount, useAuthStore } from '@/stores/authStore'

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
const dateText = (value: Date) => value.toISOString().slice(0, 10)
function historyReason(value: string) {
  if (/clock.*unverified|unverified.*clock|timezone.*unverified/.test(value))
    return 'Terminal history timing has not been verified. Raw records are retained; candle replay and automatic trade accounting remain unavailable.'
  if (value === 'partial' || /incomplete|partial_response|page_limit/.test(value))
    return 'The source returned only part of this window. Read the next page or a smaller window before claiming complete coverage.'
  return value.replaceAll('_', ' ')
}
export function ConnectorPanel({
  profileId,
  returnTo,
  initialProviderId,
  initialLabel,
}: {
  profileId?: number
  returnTo?: string
  initialProviderId?: string
  initialLabel?: string
}) {
  const data = useTraderData()
  const principal = useAuthStore(chartStorageAccount)
  const originId = data.workspace?.originId
  const ownerKey = `${principal ?? ''}:${originId ?? ''}:${profileId ?? 'all'}`
  const owner =
    principal && originId && data.storageMode === 'backend'
      ? { principal, originId, profileId }
      : null
  const connectionState = useConnections(owner, async () => {
    await data.reload()
  })
  const [providerId, setProviderId] = useState('')
  const [category, setCategory] = useState<ConnectorProvider['category'] | ''>('')
  const [label, setLabel] = useState('')
  const [mt5TerminalPath, setMt5TerminalPath] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const activeContext = useRef({ ownerKey, selectedId })
  activeContext.current = { ownerKey, selectedId }
  const ownerEpoch = useRef(0)
  const initialApplied = useRef('')
  const [targetProfile, setTargetProfile] = useState(profileId ? String(profileId) : '')
  const [targetAccount, setTargetAccount] = useState('new')
  const [reviewed, setReviewed] = useState(false)
  const [from, setFrom] = useState(dateText(new Date(Date.now() - 86400000)))
  const [to, setTo] = useState(dateText(new Date()))
  const [checkpointWindow, setCheckpointWindow] = useState<{ from: string; to: string } | null>(
    null
  )
  const [history, setHistory] = useState<ConnectorHistory | null>(null)
  const [historyBinding, setHistoryBinding] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyOffset, setHistoryOffset] = useState(0)
  const [notice, setNotice] = useState('')
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [correctionReviewed, setCorrectionReviewed] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [apiSecretInput, setApiSecretInput] = useState('')
  const selected = connectionState.connections.find((item) => item.id === selectedId)
  const selectedProvider = connectionState.providers.find(
    (item) => item.id === selected?.providerId
  )
  const selectedIsPublic = selectedProvider?.connectionMode === 'public-data'
  const credentialStatus = selected?.credential?.status
  const needsCredential =
    !!selected &&
    !selectedIsPublic &&
    selectedProvider?.connectionMode === 'account' &&
    !!credentialStatus &&
    credentialStatus !== 'not_required' &&
    selected.state !== 'archived'
  const credentialMissing = needsCredential && credentialStatus !== 'stored'
  const selectedRevision = selected?.revision
  // biome-ignore lint/correctness/useExhaustiveDependencies: A different source or owner must discard the reviewed checkpoint.
  useEffect(() => {
    setCheckpointWindow(null)
  }, [selectedId, ownerKey])
  const provider = connectionState.providers.find((item) => item.id === providerId)
  const canCreate =
    !!owner &&
    provider?.available &&
    provider.setupState === 'available' &&
    provider.connectionMode !== 'public-data'
  function historyHref(source?: ConnectorProvider) {
    const url = new URL(source?.actionHref || '/historify', 'http://local.invalid')
    if (url.origin !== 'http://local.invalid' || url.pathname !== '/historify') return '/historify'
    url.searchParams.set(
      'returnTo',
      returnTo ||
        (profileId ? `/workspace/profiles/${profileId}/connections` : '/settings/connections')
    )
    return `${url.pathname}${url.search}`
  }
  function selectCategory(value: ConnectorProvider['category']) {
    setCategory(value)
    setProviderId('')
  }
  const disabled =
    connectionState.busy ||
    connectionState.syncingHistory ||
    connectionState.loading ||
    !!connectionState.pending
  // biome-ignore lint/correctness/useExhaustiveDependencies: Owner identity is the form's privacy boundary.
  useEffect(() => {
    ownerEpoch.current++
    setProviderId('')
    setCategory('')
    setLabel('')
    setMt5TerminalPath('')
    setSelectedId('')
    setReviewed(false)
    setHistory(null)
    setHistoryError('')
    setNotice('')
    setTargetProfile(profileId ? String(profileId) : '')
    setTargetAccount('new')
    setApiKeyInput('')
    setApiSecretInput('')
  }, [ownerKey, profileId])
  useEffect(() => {
    if (!initialProviderId || !connectionState.providers.length) return
    const key = `${ownerKey}:${initialProviderId}:${initialLabel ?? ''}`
    if (initialApplied.current === key) return
    const provider = connectionState.providers.find((item) => item.id === initialProviderId)
    if (!provider) return
    initialApplied.current = key
    setCategory(provider.category)
    setProviderId(provider.id)
    if (initialLabel) setLabel(initialLabel)
  }, [connectionState.providers, initialLabel, initialProviderId, ownerKey])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reviews and paged observations are pinned to this exact account revision.
  useEffect(() => {
    setReviewed(false)
    setHistory(null)
    setHistoryError('')
    setHistoryLoading(false)
    setHistoryOffset(0)
    setCorrectionOpen(false)
    setCorrectionReviewed(false)
    setApiKeyInput('')
    setApiSecretInput('')
  }, [selectedId, selectedRevision, ownerKey])
  useEffect(() => {
    if (!selectedId || !originId || !principal || !historyLoading) return
    const controller = new AbortController()
    void connectorClient
      .history(originId, selectedId, controller.signal, historyOffset, principal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (result.connection && result.connection.revision !== selectedRevision)
          throw new Error(
            'This connection changed while observations were loading. Reload connections before reviewing another page.'
          )
        setHistory(result.history)
        setHistoryBinding(`${ownerKey}:${selectedId}:${selectedRevision}`)
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setHistoryError(
            cause instanceof Error ? cause.message : 'Observed history could not be loaded.'
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false)
      })
    return () => controller.abort()
  }, [selectedId, selectedRevision, originId, principal, historyLoading, historyOffset, ownerKey])
  async function submitSecret() {
    if (!selected || !apiKeyInput || !apiSecretInput) return
    const secret = { apiKey: apiKeyInput, apiSecret: apiSecretInput }
    // Clear the fields before the request so the secret cannot linger in
    // the form, and never route it through the retained-request retry path.
    setApiKeyInput('')
    setApiSecretInput('')
    const requestEpoch = ownerEpoch.current
    const isCurrent = () =>
      activeContext.current.ownerKey === ownerKey && ownerEpoch.current === requestEpoch
    setNotice('')
    try {
      const response = await connectionState.setSecret(selected, secret)
      if (!isCurrent()) return
      if (response?.connection) setSelectedId(response.connection.id)
      if (response)
        setNotice(
          'Credential saved encrypted on this computer. Verify the account next; the secret is never shown again.'
        )
    } catch {
      /* The hook surfaces the error; the secret is deliberately not retained. */
    }
  }
  async function perform(
    action: Parameters<typeof connectionState.mutate>[0],
    connection: ConnectorConnection | null,
    payload: Record<string, unknown> = {}
  ) {
    const requestEpoch = ownerEpoch.current
    const isCurrent = () =>
      activeContext.current.ownerKey === ownerKey && ownerEpoch.current === requestEpoch
    setNotice('')
    try {
      const response = await connectionState.mutate(action, connection, payload)
      if (!isCurrent()) return
      if (response?.connection) setSelectedId(response.connection.id)
      if (response)
        setNotice(
          action === 'link'
            ? 'The verified account is linked to its own journal book. Trading remains unavailable.'
            : 'The saved connection was updated.'
        )
    } catch {
      /* The hook retains the reviewed request and actionable error. */
    } finally {
      if (
        action === 'apply-corrections' &&
        isCurrent() &&
        activeContext.current.selectedId === connection?.id
      ) {
        setCorrectionOpen(false)
        setCorrectionReviewed(false)
      }
    }
  }
  async function readHistory() {
    if (!selected) return
    const requestEpoch = ownerEpoch.current
    setNotice('')
    try {
      const result = await connectionState.syncHistory(selected, requestedWindow)
      if (
        !result ||
        ownerEpoch.current !== requestEpoch ||
        activeContext.current.ownerKey !== ownerKey
      )
        return
      const saved = `Saved ${result.pages} history ${result.pages === 1 ? 'page' : 'pages'}`
      if (result.connection.failure) setNotice(result.connection.failure.message)
      else if (result.connection.history?.cursor?.nativeCursor)
        setNotice(`${saved}. Use the saved checkpoint to continue.`)
      else setNotice(`${saved} for the requested window.`)
    } catch {
      /* The hook retains the interrupted request and reports its error. */
    }
  }
  const profiles = data.portfolios.filter((item) => item.kind === 'live' && item.id)
  const requestedWindow = checkpointWindow ?? { from: `${from}T00:00:00Z`, to: `${to}T00:00:00Z` }
  const windowDuration = Date.parse(requestedWindow.to) - Date.parse(requestedWindow.from)
  const windowValid = !!from && !!to && windowDuration > 0 && windowDuration <= 7 * 86400000
  const visibleHistory =
    historyBinding === `${ownerKey}:${selectedId}:${selectedRevision}` ? history : null
  const shownHistory = visibleHistory ?? selected?.history
  const canReadIdentity =
    !!selectedProvider &&
    !selectedIsPublic &&
    !!selected?.identity &&
    !selected.requiresVerification &&
    selected.capabilities?.some(
      (capability) => capability.id === 'accountRead' && capability.supported
    ) &&
    ['healthy', 'degraded'].includes(selected.health) &&
    !(selected.failure?.retryAt && Date.parse(selected.failure.retryAt) > Date.now())
  return (
    <section className="space-y-4" aria-label="Verified read-only connections">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold">Your connections</h2>
        <p className="text-sm text-muted-foreground">
          Connect a source, check its account and link its journal. Choose saved market history from
          History & data.
        </p>
      </header>
      {!owner && (
        <Card>
          <CardContent className="space-y-3 pt-5">
            <p className="text-sm">
              Choose a source below. Use your saved workspace when you want to link an account
              journal.
            </p>
            <Button asChild variant="outline">
              <Link
                to={`/settings/storage?${new URLSearchParams({ returnTo: returnTo || (profileId ? `/workspace/profiles/${profileId}/connections` : '/settings/connections') })}`}
              >
                Use existing profiles on this computer
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {connectionState.loading && <output className="text-sm">Reading saved connections…</output>}
      {connectionState.error && (
        <p role="alert" className="border border-destructive/30 p-3 text-sm text-destructive">
          {connectionState.error}
        </p>
      )}
      {notice && <output className="block border p-3 text-sm">{notice}</output>}
      {connectionState.pending && (
        <div className="space-y-2 border p-3 text-sm">
          <p>
            The reviewed {connectionState.pending.action} request is retained in this open screen.
            Its response may have been interrupted after saving.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={connectionState.busy || connectionState.rejected}
              onClick={() => void connectionState.retry().catch(() => {})}
            >
              Retry same request
            </Button>
            {connectionState.rejected && (
              <Button
                variant="outline"
                disabled={connectionState.busy}
                onClick={() => {
                  connectionState.clearRejected()
                  void connectionState.reload()
                }}
              >
                Reload and review rejected request
              </Button>
            )}
          </div>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect a source</CardTitle>
          <CardDescription>
            Choose the type of source, then see what is available for your provider.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (canCreate && provider && label.trim())
                void perform('create', null, {
                  providerId: provider.id,
                  label: label.trim(),
                  configuration:
                    provider.id === 'mt5' && mt5TerminalPath.trim()
                      ? { terminalPath: mt5TerminalPath.trim() }
                      : {},
                  ...(profileId ? { profileId } : {}),
                })
            }}
          >
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="mb-2 text-sm font-medium">Source type</legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['brokerage', 'Brokerages'],
                    ['crypto', 'Crypto exchanges'],
                    ['desktop', 'Desktop platforms'],
                  ] as const
                ).map(([value, title]) => (
                  <Button
                    key={value}
                    type="button"
                    variant={category === value ? 'default' : 'outline'}
                    aria-pressed={category === value}
                    disabled={disabled}
                    onClick={() => selectCategory(value)}
                  >
                    {title}
                  </Button>
                ))}
              </div>
              <details className="pt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Diagnostics
                </summary>
                <Button
                  type="button"
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  aria-pressed={category === 'diagnostic'}
                  onClick={() => selectCategory('diagnostic')}
                >
                  Use simulated connection check
                </Button>
              </details>
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor={`connector-provider-${profileId ?? 'all'}`}>
                Connection provider
              </Label>
              <select
                id={`connector-provider-${profileId ?? 'all'}`}
                className={fieldClass}
                value={providerId}
                disabled={disabled || !category}
                onChange={(event) => setProviderId(event.target.value)}
              >
                <option value="">Choose a source</option>
                {connectionState.providers
                  .filter((item) => item.category === category)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.synthetic ? ' · simulated check' : ''}
                      {item.setupState === 'planned'
                        ? ' · planned'
                        : item.setupState === 'prerequisites' || !item.available
                          ? ' · setup required'
                          : item.connectionMode === 'public-data'
                            ? ' · public data'
                            : ''}
                    </option>
                  ))}
              </select>
              {category &&
                !connectionState.loading &&
                !connectionState.providers.some((item) => item.category === category) && (
                  <p className="text-xs text-muted-foreground">
                    No providers are listed in this category yet.
                  </p>
                )}
            </div>
            {provider?.connectionMode !== 'public-data' && (
              <div className="space-y-2">
                <Label htmlFor={`connector-label-${profileId ?? 'all'}`}>Connection name</Label>
                <Input
                  id={`connector-label-${profileId ?? 'all'}`}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  maxLength={100}
                  disabled={disabled}
                  required={!!canCreate}
                />
              </div>
            )}
            {provider?.id === 'mt5' && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor={`connector-terminal-${profileId ?? 'all'}`}>
                  MT5 installation path (optional)
                </Label>
                <Input
                  id={`connector-terminal-${profileId ?? 'all'}`}
                  placeholder="C:/Program Files/MetaTrader 5/terminal64.exe"
                  aria-describedby={`connector-terminal-hint-${profileId ?? 'all'}`}
                  value={mt5TerminalPath}
                  onChange={(event) => setMt5TerminalPath(event.target.value)}
                  maxLength={260}
                  spellCheck={false}
                  disabled={disabled}
                />
                <p
                  id={`connector-terminal-hint-${profileId ?? 'all'}`}
                  className="text-xs text-muted-foreground"
                >
                  Leave blank for the standard installation. For another account, use a separate
                  live profile and an approved MT5 installation that is running and signed in.
                </p>
              </div>
            )}
            {provider && (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                {provider.connectionMode === 'public-data'
                  ? provider.reason ||
                    'Download closed market candles into saved history. No account connection is required.'
                  : provider.reason ||
                    (provider.synthetic
                      ? 'This diagnostic source uses invented account data. It does not certify a real platform.'
                      : 'Verify the account to see its supported read-only access.')}
                {provider.connectionMode === 'public-data' &&
                  ' Public data does not connect an account journal.'}
              </p>
            )}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              {provider?.connectionMode === 'public-data' ? (
                <Button asChild variant="outline">
                  <Link to={historyHref(provider)}>Open History & data</Link>
                </Button>
              ) : (
                <Button type="submit" disabled={disabled || !canCreate || !label.trim()}>
                  Connect source
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={connectionState.busy}
                onClick={() => void connectionState.reload()}
              >
                Reload connections
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {connectionState.connections.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {connectionState.connections.map((connection) => (
            <button
              key={connection.id}
              type="button"
              aria-pressed={connection.id === selectedId}
              disabled={connectionState.syncingHistory}
              onClick={() => setSelectedId(connection.id)}
              className={`space-y-2 border p-4 text-left ${connection.id === selectedId ? 'border-foreground' : ''}`}
            >
              <strong className="block">{connection.label}</strong>
              <span className="flex flex-wrap gap-2">
                <Badge variant="outline">{connection.state}</Badge>
                <Badge variant="secondary">{connection.health}</Badge>
                {connection.identity?.synthetic && <Badge variant="outline">Simulated</Badge>}
              </span>
              <span className="block text-xs text-muted-foreground">
                Last observed: {connection.observedAt || 'Not verified'}
              </span>
              <span className="block text-xs text-muted-foreground">
                {connection.profileId
                  ? `Profile: ${data.portfolios.find((item) => item.id === connection.profileId)?.name || 'Unavailable profile'}`
                  : 'Not linked to a profile'}
                {connection.bookId ? ' · Journal linked' : ''}
              </span>
            </button>
          ))}
        </div>
      ) : (
        !connectionState.loading && (
          <p className="border p-4 text-sm text-muted-foreground">
            No connections yet. Choose a source above to get started.
          </p>
        )
      )}
      {!!connectionState.providers.length && (
        <details className="border p-3">
          <summary className="cursor-pointer text-sm font-medium">Provider availability</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {connectionState.providers.map((item) => (
              <div key={item.id} className="space-y-2 border p-3 text-sm">
                <strong>{item.name}</strong>
                <p>
                  {item.available
                    ? item.connectionMode === 'public-data'
                      ? 'Public data only; no account journal.'
                      : 'Account access is checked when you connect.'
                    : item.setupState === 'planned'
                      ? 'Planned integration.'
                      : 'Setup prerequisites are required.'}
                  {item.synthetic ? ' Synthetic checks do not certify a real provider.' : ''}
                </p>
                {item.reason && <p className="text-muted-foreground">{item.reason}</p>}
                <p className="text-xs text-muted-foreground">
                  Declared environments: {item.environments.join(', ').replaceAll('_', ' ')}.
                  Version {item.version}.
                </p>
              </div>
            ))}
          </div>
        </details>
      )}
      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{selected.label}</CardTitle>
            <CardDescription>
              Check this source’s current access before updating its journal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={disabled || selected.state === 'archived' || credentialMissing}
                onClick={() => void perform('probe', selected)}
              >
                {selectedIsPublic ? 'Check source' : 'Verify account'}
              </Button>
              <Button
                variant="outline"
                disabled={disabled || selected.state === 'archived'}
                onClick={() => void perform('disconnect', selected)}
              >
                Disconnect
              </Button>
            </div>
            {selected.reason && <p className="text-sm">{selected.reason}</p>}
            {selected.providerId === 'mt5' &&
              typeof selected.configuration?.terminalPath === 'string' && (
                <p className="break-all text-sm text-muted-foreground">
                  MT5 installation · {selected.configuration.terminalPath}
                </p>
              )}
            {selected.failure && (
              <output className="block border p-3 text-sm">
                {selected.failure.message}
                {selected.failure.retryAt ? ` Try again after ${selected.failure.retryAt}.` : ''}
              </output>
            )}
            {needsCredential && (
              <form
                className="space-y-3 border p-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitSecret()
                }}
              >
                <h3 className="text-sm font-medium">
                  {credentialStatus === 'stored'
                    ? 'Replace the saved API credential'
                    : 'Add your API credential'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {selected.providerId === 'kraken'
                    ? 'Use a Kraken API key with only Query Funds, Query Open Orders & Trades, Query Closed Orders & Trades and Query Ledger Entries enabled. Do not enable trading or withdrawals; Chartly reads this account and cannot place orders with it.'
                    : 'Use the least-privileged read-only key your provider offers. Chartly never needs withdrawal permission.'}
                </p>
                {credentialStatus === 'stored' && (
                  <p className="text-sm">
                    A credential is stored (generation {selected.credential?.generation}). Saving a
                    new one replaces it and requires verification again.
                  </p>
                )}
                {(credentialStatus === 'expired' || credentialStatus === 'revoked') && (
                  <p className="text-sm">
                    The saved credential is {credentialStatus}. Save a current key to verify this
                    account again.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="connector-api-key">API key</Label>
                    <Input
                      id="connector-api-key"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={apiKeyInput}
                      onChange={(event) => setApiKeyInput(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="connector-api-secret">API secret</Label>
                    <Input
                      id="connector-api-secret"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={apiSecretInput}
                      onChange={(event) => setApiSecretInput(event.target.value)}
                    />
                  </div>
                </div>
                <Button type="submit" disabled={disabled || !apiKeyInput || !apiSecretInput}>
                  Save credential
                </Button>
                <p className="text-xs text-muted-foreground">
                  Stored encrypted on this computer only. It is never shown again, and a failed save
                  does not keep it for retry.
                </p>
              </form>
            )}
            {selectedIsPublic ? (
              <p className="text-sm">
                This is a public data source.{' '}
                <Link className="underline" to={historyHref(selectedProvider)}>
                  Open History & data
                </Link>{' '}
                to manage saved market history.
              </p>
            ) : selected.identity ? (
              <div className="space-y-3 border p-3 text-sm">
                <strong>
                  {selected.identity.displayName || 'Observed account'} ·{' '}
                  {selected.identity.externalIdMasked}
                </strong>
                <p>
                  {selected.identity.server} · {selected.identity.environment} ·{' '}
                  {selected.identity.currency}
                  {selected.identity.synthetic ? ' · Synthetic identity' : ''}
                </p>
                <p>
                  Checked at {selected.observedAt || 'Unavailable'}. Stale or changed identity must
                  be verified again before history can be read.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Account identity has not been observed. A typed account name cannot substitute for
                verification.
              </p>
            )}
            {!!selected.capabilities?.length && (
              <div className="space-y-2">
                <h3 className="font-medium">What this source supports</h3>
                {selected.capabilities.map((capability) => (
                  <div key={capability.id} className="border-b pb-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <span>{capability.label}</span>
                      <span>
                        {capability.supported
                          ? capability.state || 'Available within observed scope'
                          : 'Unavailable'}
                      </span>
                    </div>
                    {capability.reason && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {historyReason(capability.reason)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!selectedIsPublic &&
              selected.identity &&
              !selected.bookId &&
              selected.state !== 'archived' && (
                <fieldset className="space-y-3 border p-3">
                  <legend className="px-1 text-sm font-medium">Link this account’s journal</legend>
                  {!profileId && (
                    <div className="space-y-2">
                      <Label htmlFor="connector-target-profile">Destination profile</Label>
                      <select
                        id="connector-target-profile"
                        className={fieldClass}
                        value={targetProfile}
                        onChange={(event) => setTargetProfile(event.target.value)}
                      >
                        <option value="">Choose a live profile</option>
                        {profiles.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="connector-target-account">Journal account</Label>
                    <select
                      id="connector-target-account"
                      className={fieldClass}
                      value={targetAccount}
                      onChange={(event) => setTargetAccount(event.target.value)}
                    >
                      <option value="new">Create an account from observed identity</option>
                      {data.brokerAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.displayName} · {account.currency}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={reviewed}
                      onCheckedChange={(checked) => setReviewed(checked === true)}
                    />
                    I reviewed the observed account, environment and currency. Keep its book
                    separate from manual records and other accounts.
                  </label>
                  <Button
                    disabled={disabled || !reviewed || !Number(targetProfile) || !canReadIdentity}
                    onClick={() =>
                      void perform('link', selected, {
                        profileId: Number(targetProfile),
                        confirmIdentity: true,
                        ...(targetAccount === 'new'
                          ? { createObservedAccount: true }
                          : { accountId: Number(targetAccount) }),
                      })
                    }
                  >
                    Link verified account
                  </Button>
                </fieldset>
              )}
            {!selectedIsPublic && selected.bookId && (
              <div className="space-y-2 border p-3 text-sm">
                <p>
                  {selected.identity?.displayName ||
                    selected.identity?.externalIdMasked ||
                    'Verified account'}{' '}
                  ·{' '}
                  {data.portfolios.find((item) => item.id === selected.profileId)?.name ||
                    'Linked profile'}{' '}
                  · This account has its own journal book.
                </p>
                <Button asChild variant="outline">
                  <Link
                    to={`/workspace/profiles/${selected.profileId ?? profileId}/journal?${new URLSearchParams({ book: selected.bookId, tab: 'Trades' })}`}
                  >
                    Open connected journal
                  </Link>
                </Button>
                {selected.active === false && (
                  <div className="space-y-3 border-t pt-3">
                    <p>
                      This read-only history link is paused. Verify the same account, then
                      explicitly reconnect its existing book.
                    </p>
                    <label className="flex items-start gap-2">
                      <Checkbox
                        checked={reviewed}
                        onCheckedChange={(checked) => setReviewed(checked === true)}
                      />
                      I reviewed the same observed account and want to resume this book's read-only
                      history link.
                    </label>
                    <Button
                      disabled={disabled || !reviewed || !canReadIdentity}
                      onClick={() =>
                        void perform('link', selected, {
                          profileId: selected.profileId ?? profileId,
                          accountId: selected.accountId,
                          confirmIdentity: true,
                        })
                      }
                    >
                      Reconnect verified account
                    </Button>
                  </div>
                )}
              </div>
            )}
            {!selectedIsPublic && (
              <section className="space-y-3 border-t pt-4" aria-label="Connection history review">
                <h3 className="font-medium">Read account history</h3>
                <p className="text-sm text-muted-foreground">
                  Choose a bounded UTC window, at most seven days. Raw observations, confirmed
                  journal facts and complete coverage are reported separately. A successful limited
                  response does not prove full history.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="connector-history-from">History from (UTC)</Label>
                    <Input
                      id="connector-history-from"
                      type="date"
                      value={from}
                      disabled={connectionState.syncingHistory}
                      onChange={(event) => {
                        setFrom(event.target.value)
                        setCheckpointWindow(null)
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="connector-history-to">History to (UTC, exclusive)</Label>
                    <Input
                      id="connector-history-to"
                      type="date"
                      value={to}
                      disabled={connectionState.syncingHistory}
                      onChange={(event) => {
                        setTo(event.target.value)
                        setCheckpointWindow(null)
                      }}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {shownHistory?.suggestedWindow && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => {
                        const window = shownHistory.suggestedWindow!
                        setCheckpointWindow(window)
                        setFrom(window.from.slice(0, 10))
                        setTo(window.to.slice(0, 10))
                      }}
                    >
                      Use saved history checkpoint
                    </Button>
                  )}
                  <Button
                    disabled={
                      disabled ||
                      !selected.bookId ||
                      selected.active === false ||
                      !canReadIdentity ||
                      !selected.capabilities?.some(
                        (capability) => capability.id === 'accountHistory' && capability.supported
                      ) ||
                      !windowValid
                    }
                    onClick={() => void readHistory()}
                  >
                    Read history window
                  </Button>
                  {connectionState.syncingHistory && (
                    <Button variant="outline" onClick={connectionState.stopHistory}>
                      Stop after this page
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={disabled || historyLoading}
                    onClick={() => {
                      setHistoryError('')
                      setHistoryLoading(true)
                    }}
                  >
                    Review saved observations
                  </Button>
                </div>
                {checkpointWindow && (
                  <p className="border p-3 text-sm">
                    Reviewed checkpoint window: {checkpointWindow.from} → {checkpointWindow.to}. The
                    exact UTC times are retained, including the saved overlap; no read starts until
                    you choose Read history window.
                  </p>
                )}
                {!windowValid && (
                  <p className="text-sm text-destructive">
                    Choose an increasing history window of at most seven days.
                  </p>
                )}
                {historyError && (
                  <p role="alert" className="text-sm text-destructive">
                    {historyError}
                  </p>
                )}
                {shownHistory && (
                  <>
                    <HistorySummary value={shownHistory} />
                    {visibleHistory && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          disabled={
                            historyLoading || !(visibleHistory.offset && visibleHistory.offset > 0)
                          }
                          onClick={() => {
                            setHistoryOffset(Math.max(0, (visibleHistory.offset ?? 0) - 100))
                            setHistoryLoading(true)
                          }}
                        >
                          Previous observation page
                        </Button>
                        <Button
                          variant="outline"
                          disabled={historyLoading || visibleHistory.nextOffset == null}
                          onClick={() => {
                            setHistoryOffset(visibleHistory.nextOffset ?? 0)
                            setHistoryLoading(true)
                          }}
                        >
                          Next observation page
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {!!shownHistory?.summary?.pendingCorrections && (
                  <div className="space-y-2 border p-3 text-sm">
                    <p>
                      {shownHistory.summary.pendingCorrections} source corrections await review.
                      Existing journal facts stay unchanged until you approve the displayed changes.
                    </p>
                    <Button
                      variant="outline"
                      disabled={disabled || !shownHistory.summary.corrections?.length}
                      onClick={() => setCorrectionOpen(true)}
                    >
                      Review source corrections
                    </Button>
                  </div>
                )}
              </section>
            )}
            <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Review source corrections</DialogTitle>
                  <DialogDescription>
                    These saved observations change confirmed facts in this account’s own journal
                    book. Notes, chart evidence and reviews are retained. No provider request or
                    order is submitted.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  {shownHistory?.summary?.corrections?.map((correction) => (
                    <section key={correction.id} className="border p-3 text-sm">
                      <h3 className="font-medium">{correction.summary}</h3>
                      <dl className="mt-2 space-y-2">
                        {correction.changedFields.map((field) => (
                          <div key={field.field}>
                            <dt className="font-medium">{field.field}</dt>
                            <dd>
                              {String(field.before ?? 'Unavailable')} →{' '}
                              {String(field.after ?? 'Unavailable')}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={correctionReviewed}
                    onCheckedChange={(checked) => setCorrectionReviewed(checked === true)}
                  />
                  I reviewed these exact saved changes for this account.
                </label>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCorrectionOpen(false)}>
                    Keep current facts
                  </Button>
                  <Button
                    disabled={
                      disabled ||
                      !correctionReviewed ||
                      !canReadIdentity ||
                      selected.active === false
                    }
                    onClick={() => void perform('apply-corrections', selected)}
                  >
                    Apply reviewed corrections
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <section className="space-y-3 border-t pt-4">
              <h3 className="font-medium">Capability evidence</h3>
              <Button
                variant="outline"
                disabled={disabled || selected.state === 'archived'}
                onClick={() => void perform('conformance', selected)}
              >
                Check read-only capabilities
              </Button>
              {selected.conformance && (
                <div className="space-y-2 text-sm">
                  <p>
                    {selected.conformance.readiness} ·{' '}
                    {selected.conformance.synthetic
                      ? 'Synthetic evidence only'
                      : 'Measured provider scope'}{' '}
                    · {selected.conformance.checkedAt}
                  </p>
                  {selected.conformance.checks.map((check) => (
                    <p key={check.id}>
                      {check.id}: {check.passed ? 'Passed' : 'Unavailable'}
                      {check.reason ? ` · ${check.reason}` : ''}
                    </p>
                  ))}
                </div>
              )}
            </section>
            <details className="border-t pt-3">
              <summary className="cursor-pointer text-sm">Credential and archive controls</summary>
              <p className="mt-2 text-sm text-muted-foreground">
                Revoking a saved credential or archiving keeps observed history. Neither action
                closes positions or sends broker orders.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  disabled={disabled || selected.state === 'archived'}
                  onClick={() => void perform('revoke', selected)}
                >
                  Revoke credential
                </Button>
                <Button
                  variant="outline"
                  disabled={disabled || selected.state === 'archived'}
                  onClick={() => void perform('archive', selected)}
                >
                  Archive connection
                </Button>
              </div>
            </details>
          </CardContent>
        </Card>
      )}
    </section>
  )
}
function HistorySummary({ value }: { value: ConnectorHistory }) {
  return (
    <div className="space-y-2 border p-3 text-sm">
      <p>
        {value.observations} observations · {value.confirmed} confirmed journal facts ·{' '}
        {value.conflicts} conflicts
      </p>
      {value.lastSyncedAt && <p>Last saved read: {value.lastSyncedAt}</p>}
      {value.cursor?.nativeCursor && <p>A saved checkpoint is available for this window.</p>}
      {value.coverage.map((coverage, index) => (
        <p key={`${coverage.from}:${coverage.to}:${index}`}>
          {coverage.from} → {coverage.to}:{' '}
          {coverage.complete
            ? 'Complete for this returned window'
            : 'Partial / unverified coverage'}
          {coverage.reason ? ` · ${historyReason(coverage.reason)}` : ''}
        </p>
      ))}
      {value.rows?.length ? (
        <ul className="max-h-52 space-y-2 overflow-y-auto">
          {value.rows.map((row, index) => (
            <li key={row.id ?? index} className="border-t pt-2">
              {row.kind || 'Observation'} · {row.status || 'Observed'} ·{' '}
              {row.externalEventId && <>{row.externalEventId} · </>}
              {row.timeBasis === 'receipt-only' ? (
                <>
                  {row.occurredAt ? `Received ${row.occurredAt}` : 'Receipt time unavailable'} ·
                  provider event time unverified
                </>
              ) : (
                row.occurredAt || 'Time unavailable'
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>No observation rows in this response. Missing rows do not delete earlier history.</p>
      )}
    </div>
  )
}
