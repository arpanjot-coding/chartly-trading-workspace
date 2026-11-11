import {
  AlertTriangle,
  CandlestickChart,
  MonitorSmartphone,
  Plus,
  Power,
  Save,
  ShieldCheck,
  Trash2,
  WalletCards,
} from 'lucide-react'
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ConnectorPanel } from '@/components/connections/ConnectorPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type {
  BrokerAccount,
  BrokerAccountKind,
  CommentPolicy,
  DrawdownResetMode,
  LotScalingMode,
  PlatformKind,
  ProfileDestination,
  TradingTerminal,
} from '@/lib/trader/db'
import { nowIso } from '@/lib/trader/db'
import {
  defaultDestination,
  isBrokerAccountEnabled,
  isDestinationCopyActive,
  isRiskIncreasingDestinationChange,
  validateDestinationSettings,
} from '@/lib/trader/profileModel'
import { useTraderData } from '@/lib/trader/useTraderData'
import { chartHref, ProfileHeader, profileHref } from './ProfileShell'

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
const platforms: PlatformKind[] = [
  'mt5',
  'ninjatrader',
  'tradestation',
  'broker-api',
  'simulator',
  'manual',
]

function platformLabel(platform: PlatformKind) {
  return {
    mt5: 'MetaTrader 5',
    ninjatrader: 'NinjaTrader',
    tradestation: 'TradeStation',
    'broker-api': 'Broker API',
    simulator: 'Simulator',
    manual: 'Manual',
  }[platform]
}

function NumberField({
  label,
  value,
  onChange,
  step = '1',
  min,
  hint,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: string
  min?: string
  hint?: string
}) {
  const id = useId()
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div
      className={`flex items-start justify-between gap-4 border-b py-3 ${disabled ? 'opacity-70' : ''}`}
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
        {checked ? 'On' : 'Off'}
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-label={label}
        />
      </span>
    </div>
  )
}

function DestinationCard({
  destination,
  brokerAccounts,
  terminals,
  onSave,
  onDelete,
  onToggleAccount,
}: {
  destination: ProfileDestination
  brokerAccounts: BrokerAccount[]
  terminals: TradingTerminal[]
  onSave: (destination: ProfileDestination) => Promise<number>
  onDelete: (id: number) => Promise<void>
  onToggleAccount: (accountId: number, enabled: boolean) => Promise<void>
}) {
  const [draft, setDraft] = useState(destination)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const fieldId = useId().replace(/:/g, '')

  useEffect(() => setDraft(destination), [destination])

  const account = brokerAccounts.find((item) => item.id === destination.accountId)
  const accountEnabled = isBrokerAccountEnabled(account)
  const copyActive = isDestinationCopyActive(draft, account)
  const dirty = JSON.stringify(draft) !== JSON.stringify(destination)

  function patch(patch: Partial<ProfileDestination>) {
    setDraft((current) => ({ ...current, ...patch }))
    setMessage('')
  }

  async function save() {
    const validation = validateDestinationSettings(draft)
    setErrors(validation)
    if (validation.length) return

    const riskDiff = isRiskIncreasingDestinationChange(destination, draft)
    if (riskDiff.increasing) {
      const confirmed = window.confirm(
        `This change increases destination risk:\n\n${riskDiff.reasons.join('\n')}\n\nSave it?`
      )
      if (!confirmed) return
    }

    try {
      await onSave(draft)
      setMessage('Destination settings saved. No connector order was sent.')
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Destination could not be saved.'])
    }
  }

  return (
    <article className="border bg-card p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {account?.displayName ?? `Account ${destination.accountId}`}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {account
              ? `${platformLabel(account.platform)} · ${account.server || 'No server'} · #${account.externalLogin}`
              : 'Account record missing'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draft.isChartDataSource && (
            <Badge>Chart data preference{accountEnabled ? '' : ' · account off'}</Badge>
          )}
          <Badge variant={copyActive ? 'default' : 'outline'}>
            {!accountEnabled
              ? 'Saved account off'
              : copyActive
                ? 'Copy preference enabled'
                : 'Copy preference disabled'}
          </Badge>
          {dirty && <Badge variant="secondary">Unsaved</Badge>}
          {account?.id && (
            <span className="ml-1 flex items-center gap-2 border px-2 py-1 text-xs font-medium">
              <Power className="h-3.5 w-3.5" /> Account
              <span>{accountEnabled ? 'On' : 'Off'}</span>
              <Switch
                checked={accountEnabled}
                aria-label={`Turn ${account.displayName} ${accountEnabled ? 'off' : 'on'}`}
                onCheckedChange={(checked) => void onToggleAccount(account.id!, checked)}
              />
            </span>
          )}
        </div>
      </div>
      {!accountEnabled && (
        <p className="mt-4 border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          This saved account is off. Its destination preferences are retained.
        </p>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-terminal`}>Terminal</Label>
          <select
            id={`${fieldId}-terminal`}
            className={fieldClass}
            value={draft.terminalId ?? ''}
            onChange={(event) =>
              patch({ terminalId: event.target.value ? Number(event.target.value) : undefined })
            }
          >
            <option value="">No terminal assigned</option>
            {terminals.map((terminal) => (
              <option key={terminal.id} value={terminal.id}>
                {terminal.label} · {platformLabel(terminal.platform)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-suffix`}>Broker symbol suffix</Label>
          <Input
            id={`${fieldId}-suffix`}
            value={draft.symbolSuffixOverride}
            onChange={(event) => patch({ symbolSuffixOverride: event.target.value })}
            placeholder={account?.symbolSuffix || 'e.g. .a'}
          />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <Checkbox
            checked={draft.isChartDataSource}
            onCheckedChange={(checked) => patch({ isChartDataSource: checked === true })}
          />
          Save as the preferred chart account
        </label>
      </div>

      <ToggleRow
        label="Copy chart trades preference"
        description={
          accountEnabled
            ? 'Saved preference only. This does not start a copier or place orders.'
            : 'Enable the saved account before changing this preference.'
        }
        checked={draft.copyingEnabled && accountEnabled}
        disabled={!accountEnabled}
        onCheckedChange={(checked) => patch({ copyingEnabled: checked })}
      />
      <ToggleRow
        label="Include open trades preference"
        description="Saved preference only; existing positions are not copied."
        checked={draft.copyExistingPositions}
        onCheckedChange={(checked) => patch({ copyExistingPositions: checked })}
      />

      <details className="mt-4 border-t pt-4" open>
        <summary className="cursor-pointer font-medium">Sizing</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-scaling-mode`}>Mode</Label>
            <select
              id={`${fieldId}-scaling-mode`}
              className={fieldClass}
              value={draft.lotScalingMode}
              onChange={(event) => patch({ lotScalingMode: event.target.value as LotScalingMode })}
            >
              <option value="flat">Flat multiplier</option>
              <option value="equity_ratio">Equity ratio</option>
              <option value="smart">Smart strategy risk</option>
            </select>
          </div>
          <NumberField
            label={draft.lotScalingMode === 'smart' ? 'DD budget / factor' : 'Lot factor'}
            value={draft.lotScalingFactor}
            step="0.01"
            min="0"
            onChange={(value) => patch({ lotScalingFactor: value })}
            hint={
              draft.lotScalingMode === 'smart'
                ? 'Smart mode gives this strategy-risk meaning.'
                : '1.0 copies the chart size.'
            }
          />
          <NumberField
            label="Max lot / trade"
            value={draft.maxLotCap}
            step="0.01"
            min="0"
            onChange={(value) => patch({ maxLotCap: value })}
            hint="0 = no cap"
          />
          <NumberField
            label="Max total lots"
            value={draft.maxTotalLots}
            step="0.01"
            min="0"
            onChange={(value) => patch({ maxTotalLots: value })}
            hint="0 = no cap"
          />
          <NumberField
            label="Max concurrent"
            value={draft.maxConcurrentPositions}
            min="0"
            onChange={(value) => patch({ maxConcurrentPositions: value })}
            hint="0 = no cap"
          />
        </div>
      </details>

      <details className="mt-4 border-t pt-4">
        <summary className="cursor-pointer font-medium">Copy behaviour</summary>
        <p className="mt-2 flex gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          Delay, lot noise, and comment changes may conflict with broker or prop-firm rules. Chartly
          does not promise they make copying compliant or undetectable.
        </p>
        <ToggleRow
          label="Random delay"
          description="Delay each copied action within a range."
          checked={draft.randomDelayEnabled}
          onCheckedChange={(checked) => patch({ randomDelayEnabled: checked })}
        />
        {draft.randomDelayEnabled && (
          <div className="grid gap-3 py-3 sm:grid-cols-2">
            <NumberField
              label="Minimum delay (ms)"
              value={draft.minDelayMs}
              min="0"
              onChange={(value) => patch({ minDelayMs: value })}
            />
            <NumberField
              label="Maximum delay (ms)"
              value={draft.maxDelayMs}
              min="0"
              onChange={(value) => patch({ maxDelayMs: value })}
            />
          </div>
        )}
        <ToggleRow
          label="Lot noise"
          description="Vary copied lot size by a configured percentage."
          checked={draft.randomLotNoiseEnabled}
          onCheckedChange={(checked) => patch({ randomLotNoiseEnabled: checked })}
        />
        {draft.randomLotNoiseEnabled && (
          <div className="py-3 sm:max-w-xs">
            <NumberField
              label="Noise ±%"
              value={draft.lotNoisePct}
              step="0.5"
              min="0"
              onChange={(value) => patch({ lotNoisePct: value })}
            />
          </div>
        )}
        <div className="grid gap-3 py-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-comment-policy`}>Order comment</Label>
            <select
              id={`${fieldId}-comment-policy`}
              className={fieldClass}
              value={draft.commentPolicy}
              onChange={(event) => patch({ commentPolicy: event.target.value as CommentPolicy })}
            >
              <option value="strategy">Strategy name</option>
              <option value="blank">Blank</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {draft.commentPolicy === 'custom' && (
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-custom-comment`}>Custom comment</Label>
              <Input
                id={`${fieldId}-custom-comment`}
                value={draft.customComment ?? ''}
                onChange={(event) => patch({ customComment: event.target.value })}
              />
            </div>
          )}
        </div>
      </details>

      <details className="mt-4 border-t pt-4" open>
        <summary className="cursor-pointer font-medium">Drawdown guard</summary>
        <ToggleRow
          label="Enable DD Guard"
          description="Pause new copied entries for this destination when a cap is reached."
          checked={draft.ddGuardEnabled}
          onCheckedChange={(checked) => patch({ ddGuardEnabled: checked })}
        />
        {draft.ddGuardEnabled && (
          <div className="grid gap-3 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              label="Daily cap %"
              value={draft.dailyDdCapPct}
              step="0.1"
              min="0"
              onChange={(value) => patch({ dailyDdCapPct: value })}
            />
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-daily-reset`}>Daily reset</Label>
              <select
                id={`${fieldId}-daily-reset`}
                className={fieldClass}
                value={draft.dailyDdAutoReset ? 'auto' : 'manual'}
                onChange={(event) => patch({ dailyDdAutoReset: event.target.value === 'auto' })}
              >
                <option value="auto">Auto</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <NumberField
              label="Max cap %"
              value={draft.maxDdCapPct}
              step="0.1"
              min="0"
              onChange={(value) => patch({ maxDdCapPct: value })}
            />
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-max-reset`}>Max reset</Label>
              <select
                id={`${fieldId}-max-reset`}
                className={fieldClass}
                value={draft.maxDdResetMode}
                onChange={(event) =>
                  patch({ maxDdResetMode: event.target.value as DrawdownResetMode })
                }
              >
                <option value="manual">Manual review</option>
                <option value="auto">Auto next day</option>
              </select>
            </div>
          </div>
        )}
        {draft.pausedReason && (
          <p className="text-sm text-amber-700">Paused: {draft.pausedReason}</p>
        )}
      </details>

      {errors.length > 0 && (
        <div
          role="alert"
          className="mt-4 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
        <Button type="button" onClick={() => void save()} disabled={!dirty}>
          <Save className="h-4 w-4" /> Save destination
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive"
          onClick={() => {
            if (
              destination.id &&
              window.confirm(
                'Archive this destination configuration? Its record is retained and copying is disabled.'
              )
            )
              void onDelete(destination.id)
          }}
        >
          <Trash2 className="h-4 w-4" /> Archive
        </Button>
        {message && <span className="text-sm text-teal-700">{message}</span>}
      </div>
    </article>
  )
}

export default function TraderConnections() {
  const { profileId } = useParams()
  const data = useTraderData()
  const id = Number(profileId)
  const portfolio = data.portfolios.find((item) => item.id === id)
  const destinations = data.destinations.filter((destination) => destination.portfolioId === id)
  const linkedAccountIds = new Set(destinations.map((destination) => destination.accountId))
  const availableAccounts = data.brokerAccounts.filter(
    (account) => account.id && isBrokerAccountEnabled(account) && !linkedAccountIds.has(account.id)
  )
  const accountsOn = data.brokerAccounts.filter(isBrokerAccountEnabled).length
  const destinationsCopyingOn = destinations.filter((destination) =>
    isDestinationCopyActive(
      destination,
      data.brokerAccounts.find((account) => account.id === destination.accountId)
    )
  ).length

  const [accountName, setAccountName] = useState('')
  const [platform, setPlatform] = useState<PlatformKind>('mt5')
  const [brokerName, setBrokerName] = useState('')
  const [server, setServer] = useState('')
  const [login, setLogin] = useState('')
  const [accountKind, setAccountKind] = useState<BrokerAccountKind>('live')
  const [currency, setCurrency] = useState('USD')
  const [suffix, setSuffix] = useState('')
  const [terminalLabel, setTerminalLabel] = useState('')
  const [terminalPlatform, setTerminalPlatform] = useState<PlatformKind>('mt5')
  const [terminalPath, setTerminalPath] = useState('')
  const [terminalAccountId, setTerminalAccountId] = useState('')
  const [destinationAccountId, setDestinationAccountId] = useState('')
  const [destinationTerminalId, setDestinationTerminalId] = useState('')
  const [destinationCopyingEnabled, setDestinationCopyingEnabled] = useState(false)
  const [accountEnabledOnCreate, setAccountEnabledOnCreate] = useState(true)
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [terminalDialogOpen, setTerminalDialogOpen] = useState(false)
  const [destinationDialogOpen, setDestinationDialogOpen] = useState(false)
  const [pageError, setPageError] = useState('')
  const [setupNotice] = useState(() => {
    try {
      const key = `chartly:connection-setup:${id}`
      const raw = sessionStorage.getItem(key)
      if (!raw) return ''
      sessionStorage.removeItem(key)
      const parsed = JSON.parse(raw) as { message?: unknown }
      return typeof parsed.message === 'string' ? parsed.message : ''
    } catch {
      return ''
    }
  })

  const dataSource = destinations.find(
    (destination) =>
      destination.isChartDataSource &&
      isBrokerAccountEnabled(
        data.brokerAccounts.find((account) => account.id === destination.accountId)
      )
  )
  const storedDataSource = destinations.find((destination) => destination.isChartDataSource)
  const dataSourceAccount = useMemo(
    () => data.brokerAccounts.find((account) => account.id === dataSource?.accountId),
    [data.brokerAccounts, dataSource]
  )

  if (!data.loading && !portfolio) {
    return (
      <EmptyState
        icon={WalletCards}
        title="Profile not found"
        description="This trading profile does not exist in this browser."
        action={
          <Button asChild className="mt-4">
            <Link to="/workspace">Back to profiles</Link>
          </Button>
        }
      />
    )
  }
  if (!portfolio) return <p className="py-8 text-sm text-muted-foreground">Loading connections…</p>

  async function createAccount(event: FormEvent) {
    event.preventDefault()
    if (!accountName.trim() || !login.trim()) return
    const accountId = await data.createBrokerAccount({
      displayName: accountName.trim(),
      platform,
      brokerName: brokerName.trim(),
      server: server.trim(),
      externalLogin: login.trim(),
      accountKind,
      currency: currency.trim().toUpperCase() || 'USD',
      symbolSuffix: suffix,
      enabled: accountEnabledOnCreate,
    })
    if (accountEnabledOnCreate) setDestinationAccountId(String(accountId))
    setAccountName('')
    setBrokerName('')
    setServer('')
    setLogin('')
    setSuffix('')
    setAccountEnabledOnCreate(true)
    setAccountDialogOpen(false)
    setPageError('')
  }

  async function createTerminal(event: FormEvent) {
    event.preventDefault()
    if (!terminalLabel.trim()) return
    const terminalId = await data.createTerminal({
      label: terminalLabel.trim(),
      platform: terminalPlatform,
      exePath: terminalPath.trim() || undefined,
      assignedAccountId: terminalAccountId ? Number(terminalAccountId) : undefined,
      discoverySource: terminalPlatform === 'simulator' ? 'simulator' : 'manual',
      running: false,
    })
    setDestinationTerminalId(String(terminalId))
    setTerminalLabel('')
    setTerminalPath('')
    setTerminalAccountId('')
    setTerminalDialogOpen(false)
    setPageError('')
  }

  function chooseDestinationAccount(value: string) {
    setDestinationAccountId(value)
    const accountId = Number(value)
    const assignedTerminal = data.terminals.find(
      (terminal) => terminal.assignedAccountId === accountId
    )
    setDestinationTerminalId(assignedTerminal?.id ? String(assignedTerminal.id) : '')
  }

  async function addDestination(event: FormEvent) {
    event.preventDefault()
    if (!portfolio?.id || !destinationAccountId) return
    const accountId = Number(destinationAccountId)
    const account = data.brokerAccounts.find((item) => item.id === accountId)
    if (!isBrokerAccountEnabled(account)) {
      setPageError('Turn this broker account on before adding it as a destination.')
      return
    }
    setPageError('')
    try {
      await data.saveDestination({
        ...defaultDestination({
          portfolioId: portfolio.id,
          accountId,
          terminalId: destinationTerminalId ? Number(destinationTerminalId) : undefined,
          symbolSuffix: account?.symbolSuffix,
          now: nowIso(),
        }),
        copyingEnabled: destinationCopyingEnabled,
      })
      setDestinationAccountId('')
      setDestinationTerminalId('')
      setDestinationCopyingEnabled(false)
      setDestinationDialogOpen(false)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Destination could not be added.')
    }
  }

  async function addSimulator() {
    if (!portfolio?.id) return
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const accountId = await data.createBrokerAccount({
      displayName: `Simulator ${stamp}`,
      platform: 'simulator',
      brokerName: 'Chartly Simulator',
      server: 'local',
      externalLogin: `sim-${Date.now()}`,
      accountKind: 'demo',
      currency: portfolio.currency,
      symbolSuffix: '',
      enabled: true,
    })
    const terminalId = await data.createTerminal({
      label: `Simulator terminal ${stamp}`,
      platform: 'simulator',
      assignedAccountId: accountId,
      discoverySource: 'simulator',
      running: true,
      lastSeenAt: nowIso(),
    })
    await data.saveDestination(
      defaultDestination({ portfolioId: portfolio.id!, accountId, terminalId, now: nowIso() })
    )
  }

  const mt5Chart =
    portfolio.chartSource?.kind === 'live-feed' && portfolio.chartSource.providerId === 'mt5'
  const accountSetup = portfolio.liveSetup?.account
  return (
    <div className="space-y-6 py-6">
      <ProfileHeader portfolio={portfolio} active="connections" />

      {portfolio.kind !== 'live' ? (
        <EmptyState
          icon={WalletCards}
          title="Connections belong to live profiles"
          description="Use saved history for replay. Connect account sources from a live profile."
        />
      ) : (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 border bg-card p-4">
            <div>
              <h2 className="text-xl font-semibold">Connections</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Trading platform and account sources linked to {portfolio.name}. Chart candles are
                downloaded and pinned separately in History &amp; data.
              </p>
              {portfolio.liveSetup?.account.mode === 'connector' && (
                <p className="mt-2 text-sm">
                  Setup choice:{' '}
                  <strong>
                    {portfolio.liveSetup.account.providerName ??
                      portfolio.liveSetup.account.providerId}
                  </strong>
                  . Create or select it below, then verify the observed account.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to={`/settings/connections?profileId=${id}`}>Open connection hub</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/historify">Chart data</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={chartHref(id, undefined, portfolio)}>Open chart</Link>
              </Button>
            </div>
          </section>
          {setupNotice && <output className="block border p-3 text-sm">{setupNotice}</output>}
          <ConnectorPanel
            profileId={id}
            initialProviderId={
              mt5Chart
                ? 'mt5'
                : accountSetup?.mode === 'connector'
                  ? accountSetup.providerId
                  : undefined
            }
            initialLabel={
              mt5Chart && accountSetup?.providerId !== 'mt5'
                ? `${portfolio.name} · MT5`.slice(0, 100)
                : accountSetup?.mode === 'connector'
                  ? accountSetup.connectionLabel
                  : undefined
            }
          />
          <details className="space-y-4 border p-4">
            <summary className="cursor-pointer font-medium">Advanced saved settings</summary>
            <p className="mt-3 text-sm text-muted-foreground">
              Existing account, terminal and destination preferences are kept here. They do not
              connect a source, start copying or place orders.
            </p>
            <section className="border bg-card p-4 shadow-xs" aria-labelledby="connections-actions">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 id="connections-actions" className="text-xl font-semibold">
                    Saved accounts and destinations
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Review saved account, terminal and destination preferences.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-sm">
                    <Badge variant="outline">
                      {accountsOn} of {data.brokerAccounts.length} account records enabled
                    </Badge>
                    <Badge variant="outline">
                      {data.terminals.filter((terminal) => terminal.running).length} terminals saved
                      as on
                    </Badge>
                    <Badge variant={destinationsCopyingOn ? 'default' : 'outline'}>
                      {destinationsCopyingOn} of {destinations.length} copy preferences saved as
                      enabled
                    </Badge>
                    <Badge variant="secondary">
                      Chart account preference:{' '}
                      {dataSourceAccount
                        ? dataSourceAccount.displayName
                        : storedDataSource
                          ? 'selected account is off'
                          : 'not selected'}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => setAccountDialogOpen(true)}>
                    <Plus className="h-4 w-4" /> Add broker account
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTerminalDialogOpen(true)}
                  >
                    <Plus className="h-4 w-4" /> Add terminal
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDestinationDialogOpen(true)}
                  >
                    <Plus className="h-4 w-4" /> Add destination
                  </Button>
                </div>
              </div>
            </section>

            {pageError && (
              <p
                role="alert"
                className="border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
              >
                {pageError}
              </p>
            )}

            <section className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <WalletCards className="h-5 w-5 text-teal-600" /> 1. Broker accounts
                  </CardTitle>
                  <CardDescription>
                    Reusable account identities. Secrets are not entered in the browser.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-3">
                    {data.brokerAccounts.map((account) => {
                      const links = data.destinations.filter(
                        (destination) => destination.accountId === account.id
                      )
                      const enabled = isBrokerAccountEnabled(account)
                      const activeLinks = links.filter((destination) =>
                        isDestinationCopyActive(destination, account)
                      ).length
                      return (
                        <div
                          key={account.id}
                          className={`flex flex-wrap items-start justify-between gap-3 border-b pb-3 text-sm ${enabled ? '' : 'opacity-75'}`}
                        >
                          <span>
                            <span className="flex flex-wrap items-center gap-2 font-medium">
                              {account.displayName}
                              <Badge variant={enabled ? 'default' : 'outline'}>
                                {enabled ? 'On' : 'Off'}
                              </Badge>
                              <Badge variant="outline">{account.accountKind}</Badge>
                              <Badge variant="secondary">{platformLabel(account.platform)}</Badge>
                            </span>
                            <span className="mt-1 block text-muted-foreground">
                              #{account.externalLogin} · {account.server || 'No server'} ·{' '}
                              {account.currency}
                              {account.symbolSuffix ? ` · suffix ${account.symbolSuffix}` : ''}
                            </span>
                            <span className="block text-muted-foreground">
                              Linked to {links.length} profile{links.length === 1 ? '' : 's'} ·{' '}
                              {activeLinks} saved copy preferences
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {enabled
                                ? 'Available for saved profile preferences.'
                                : 'Saved account preferences are disabled.'}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="flex items-center gap-2 border px-2 py-1 text-xs font-medium">
                              <Power className="h-3.5 w-3.5" /> {enabled ? 'On' : 'Off'}
                              <Switch
                                checked={enabled}
                                aria-label={`Turn ${account.displayName} ${enabled ? 'off' : 'on'}`}
                                onCheckedChange={(checked) =>
                                  account.id &&
                                  void data.updateBrokerAccount(account.id, { enabled: checked })
                                }
                              />
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Archive ${account.displayName}`}
                              onClick={() => {
                                if (
                                  account.id &&
                                  window.confirm(
                                    'Archive this account configuration? Its journal and account record are retained.'
                                  )
                                )
                                  void data.deleteBrokerAccount(account.id)
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </span>
                        </div>
                      )
                    })}
                    {!data.brokerAccounts.length && (
                      <p className="text-sm text-muted-foreground">
                        No broker accounts registered yet.
                      </p>
                    )}
                  </div>

                  <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
                    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Add broker account</DialogTitle>
                        <DialogDescription>
                          Register the account identity once, then add it to any live profile as a
                          destination. No broker password is entered or stored in the browser.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={createAccount} className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="account-name">Account name</Label>
                          <Input
                            id="account-name"
                            value={accountName}
                            onChange={(event) => setAccountName(event.target.value)}
                            placeholder="FTMO London #1"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="account-platform">Platform</Label>
                          <select
                            id="account-platform"
                            className={fieldClass}
                            value={platform}
                            onChange={(event) => setPlatform(event.target.value as PlatformKind)}
                          >
                            {platforms.map((item) => (
                              <option key={item} value={item}>
                                {platformLabel(item)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="account-kind">Account type</Label>
                          <select
                            id="account-kind"
                            className={fieldClass}
                            value={accountKind}
                            onChange={(event) =>
                              setAccountKind(event.target.value as BrokerAccountKind)
                            }
                          >
                            <option value="live">Live</option>
                            <option value="demo">Demo</option>
                            <option value="prop">Prop / funded</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="account-broker">Broker / firm</Label>
                          <Input
                            id="account-broker"
                            value={brokerName}
                            onChange={(event) => setBrokerName(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="account-server">Server</Label>
                          <Input
                            id="account-server"
                            value={server}
                            onChange={(event) => setServer(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="account-login">Login</Label>
                          <Input
                            id="account-login"
                            value={login}
                            onChange={(event) => setLogin(event.target.value)}
                            required
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label htmlFor="account-currency">Currency</Label>
                            <Input
                              id="account-currency"
                              value={currency}
                              onChange={(event) => setCurrency(event.target.value)}
                              maxLength={3}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="account-suffix">Suffix</Label>
                            <Input
                              id="account-suffix"
                              value={suffix}
                              onChange={(event) => setSuffix(event.target.value)}
                              placeholder=".a"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-4 border bg-muted/20 p-3 sm:col-span-2">
                          <span>
                            <span className="block text-sm font-medium">Account on</span>
                            <span className="text-xs text-muted-foreground">
                              On accounts can be added as destinations. Copying still starts off per
                              destination.
                            </span>
                          </span>
                          <span className="flex items-center gap-2 text-xs font-medium">
                            {accountEnabledOnCreate ? 'On' : 'Off'}
                            <Switch
                              checked={accountEnabledOnCreate}
                              onCheckedChange={setAccountEnabledOnCreate}
                              aria-label="Account on when created"
                            />
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setAccountDialogOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit">
                            <Plus className="h-4 w-4" /> Add broker account
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MonitorSmartphone className="h-5 w-5 text-teal-600" /> 2. Terminals & chart
                    data
                  </CardTitle>
                  <CardDescription>
                    Future local discovery will find MT5, NinjaTrader, and TradeStation. For now,
                    register terminals manually.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="border bg-muted/20 p-3 text-sm">
                    <strong>Selected chart data:</strong>{' '}
                    {dataSourceAccount
                      ? `${dataSourceAccount.displayName} (${platformLabel(dataSourceAccount.platform)})`
                      : storedDataSource
                        ? 'Selected account is off — turn it on before using its chart data'
                        : 'None selected'}
                  </div>
                  <div className="space-y-3">
                    {data.terminals.map((terminal) => {
                      const assigned = data.brokerAccounts.find(
                        (account) => account.id === terminal.assignedAccountId
                      )
                      return (
                        <div
                          key={terminal.id}
                          className="flex flex-wrap items-start justify-between gap-3 border-b pb-3 text-sm"
                        >
                          <span>
                            <span className="flex flex-wrap items-center gap-2 font-medium">
                              {terminal.label}
                              <Badge variant={terminal.running ? 'default' : 'outline'}>
                                {terminal.running ? 'Declared on' : 'Declared off'}
                              </Badge>
                              <Badge variant="secondary">{terminal.discoverySource}</Badge>
                            </span>
                            <span className="mt-1 block text-muted-foreground">
                              {platformLabel(terminal.platform)} ·{' '}
                              {assigned ? assigned.displayName : 'Unassigned'}
                              {terminal.exePath ? ` · ${terminal.exePath}` : ''}
                              {terminal.lastSeenAt
                                ? ` · last seen ${new Date(terminal.lastSeenAt).toLocaleString()}`
                                : ''}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="flex items-center gap-2 border px-2 py-1 text-xs font-medium">
                              {terminal.running ? 'On' : 'Off'}
                              <Switch
                                checked={terminal.running}
                                aria-label={`Turn ${terminal.label} ${terminal.running ? 'off' : 'on'}`}
                                onCheckedChange={(checked) =>
                                  terminal.id &&
                                  void data.updateTerminal(terminal.id, {
                                    running: checked,
                                    lastSeenAt: nowIso(),
                                  })
                                }
                              />
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Archive ${terminal.label}`}
                              onClick={() => {
                                if (
                                  terminal.id &&
                                  window.confirm(
                                    'Archive this terminal configuration? Its record is retained and copying is disabled.'
                                  )
                                )
                                  void data.deleteTerminal(terminal.id)
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </span>
                        </div>
                      )
                    })}
                    {!data.terminals.length && (
                      <p className="text-sm text-muted-foreground">
                        No terminals registered or discovered yet.
                      </p>
                    )}
                  </div>

                  <Dialog open={terminalDialogOpen} onOpenChange={setTerminalDialogOpen}>
                    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Add terminal</DialogTitle>
                        <DialogDescription>
                          Register an MT5, NinjaTrader, TradeStation, API, simulator, or manual
                          terminal. It starts off; turn it on in the terminal list when it is
                          actually running.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={createTerminal} className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="terminal-label">Terminal label</Label>
                          <Input
                            id="terminal-label"
                            value={terminalLabel}
                            onChange={(event) => setTerminalLabel(event.target.value)}
                            placeholder="MT5 — main PC"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="terminal-platform">Platform</Label>
                          <select
                            id="terminal-platform"
                            className={fieldClass}
                            value={terminalPlatform}
                            onChange={(event) =>
                              setTerminalPlatform(event.target.value as PlatformKind)
                            }
                          >
                            {platforms.map((item) => (
                              <option key={item} value={item}>
                                {platformLabel(item)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="terminal-account">Assigned account</Label>
                          <select
                            id="terminal-account"
                            className={fieldClass}
                            value={terminalAccountId}
                            onChange={(event) => setTerminalAccountId(event.target.value)}
                          >
                            <option value="">Unassigned</option>
                            {data.brokerAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.displayName}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="terminal-path">Executable / install path</Label>
                          <Input
                            id="terminal-path"
                            value={terminalPath}
                            onChange={(event) => setTerminalPath(event.target.value)}
                            placeholder="C:\Program Files\…\terminal64.exe"
                          />
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setTerminalDialogOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit">
                            <Plus className="h-4 w-4" /> Add terminal
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            </section>

            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-xl font-semibold">
                    <ShieldCheck className="h-5 w-5 text-teal-600" /> 3. Copy & risk destinations
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Saved sizing and risk preferences. Live copying is not available here.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => setDestinationDialogOpen(true)}>
                    <Plus className="h-4 w-4" /> Add destination
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void addSimulator()}>
                    <Plus className="h-4 w-4" /> Add simulator destination
                  </Button>
                </div>
              </div>

              <Dialog open={destinationDialogOpen} onOpenChange={setDestinationDialogOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Add destination to {portfolio.name}</DialogTitle>
                    <DialogDescription>
                      Choose a saved account and review its destination preferences. Saving these
                      settings does not start copying.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={addDestination} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="destination-account">Broker account</Label>
                      <select
                        id="destination-account"
                        className={fieldClass}
                        value={destinationAccountId}
                        onChange={(event) => chooseDestinationAccount(event.target.value)}
                        required
                      >
                        <option value="">Choose an account…</option>
                        {availableAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.displayName} · {platformLabel(account.platform)} · #
                            {account.externalLogin}
                          </option>
                        ))}
                      </select>
                      {!availableAccounts.length && (
                        <p className="text-sm text-muted-foreground">
                          No unlinked accounts are on. Add a broker account or turn an existing
                          account on first.
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="destination-terminal">Terminal</Label>
                      <select
                        id="destination-terminal"
                        className={fieldClass}
                        value={destinationTerminalId}
                        onChange={(event) => setDestinationTerminalId(event.target.value)}
                      >
                        <option value="">No terminal assigned</option>
                        {data.terminals.map((terminal) => (
                          <option key={terminal.id} value={terminal.id}>
                            {terminal.label} · {platformLabel(terminal.platform)} ·{' '}
                            {terminal.running ? 'On' : 'Off'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <ToggleRow
                      label="Save copying preference"
                      description="This preference does not activate copying or submit orders."
                      checked={destinationCopyingEnabled}
                      onCheckedChange={setDestinationCopyingEnabled}
                    />
                    <p className="border bg-muted/20 p-3 text-sm text-muted-foreground">
                      If no chart account preference is saved, this destination becomes the default.
                      Actual chart data is selected separately.
                    </p>
                    {pageError && (
                      <p
                        role="alert"
                        className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                      >
                        {pageError}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0"
                        onClick={() => {
                          setDestinationDialogOpen(false)
                          setAccountDialogOpen(true)
                        }}
                      >
                        Need an account? Add broker account
                      </Button>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setDestinationDialogOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" disabled={!destinationAccountId}>
                          <Plus className="h-4 w-4" /> Add destination
                        </Button>
                      </div>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>

              {destinations.length ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {destinations.map((destination) => (
                    <DestinationCard
                      key={destination.id}
                      destination={destination}
                      brokerAccounts={data.brokerAccounts}
                      terminals={data.terminals}
                      onSave={data.saveDestination}
                      onDelete={data.deleteDestination}
                      onToggleAccount={async (accountId, enabled) =>
                        data.updateBrokerAccount(accountId, { enabled })
                      }
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={ShieldCheck}
                  title="No destinations in this profile"
                  description="Add an account that is on as a destination, then set its sizing and drawdown guard."
                  action={
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <Button type="button" onClick={() => setDestinationDialogOpen(true)}>
                        <Plus className="h-4 w-4" /> Add destination
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setAccountDialogOpen(true)}
                      >
                        <Plus className="h-4 w-4" /> Add broker account
                      </Button>
                    </div>
                  }
                />
              )}
            </section>

            <section className="flex flex-wrap items-center justify-between gap-4 border bg-muted/20 p-4">
              <div>
                <h2 className="font-semibold">Next step</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Open the chart to choose its data. Saved destination preferences do not activate a
                  feed or copier.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link to={profileHref(id)}>Back to overview</Link>
                </Button>
                <Button asChild>
                  <Link to={chartHref(id, undefined, portfolio)}>
                    <CandlestickChart className="h-4 w-4" /> Open chart
                  </Link>
                </Button>
              </div>
            </section>
          </details>
        </>
      )}
    </div>
  )
}
