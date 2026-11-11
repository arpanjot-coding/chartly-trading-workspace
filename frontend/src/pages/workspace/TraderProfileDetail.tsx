import {
  ArrowRight,
  BookOpenCheck,
  Brain,
  CheckCircle2,
  CircleAlert,
  Copy,
  History,
  RadioTower,
  Save,
  Trash2,
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useChartWorkspaceCatalog } from '@/hooks/useChartWorkspaceCatalog'
import type { TradingProfileKind } from '@/lib/trader/db'
import { formatMoney, summarizeEmotions, summarizePortfolio } from '@/lib/trader/metrics'
import { isEmotionTrackingEnabled } from '@/lib/trader/profileModel'
import { useTraderData } from '@/lib/trader/useTraderData'
import { useAuthStore } from '@/stores/authStore'
import { chartHref, ProfileHeader, pnlTone, profileHref, StatTile } from './ProfileShell'

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'INR']
const timezones = [
  'UTC',
  'Europe/London',
  'America/New_York',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Australia/Sydney',
]
const timeframes = ['1m', '5m', '15m', '1h', '4h', '1D']

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

export default function TraderProfileDetail() {
  const { profileId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const data = useTraderData()
  const username = useAuthStore((state) => state.user?.username ?? null)
  const chartCatalog = useChartWorkspaceCatalog(username)
  const id = Number(profileId)
  const portfolio = data.portfolios.find((item) => item.id === id)
  const isSettings = location.pathname.endsWith('/settings')

  const summary = useMemo(
    () => (portfolio ? summarizePortfolio(portfolio, data.trades) : null),
    [data.trades, portfolio]
  )
  const emotion = useMemo(
    () => (portfolio?.id ? summarizeEmotions(portfolio.id, data.trades, data.moods) : null),
    [data.moods, data.trades, portfolio]
  )
  const sessions = data.sessions.filter((session) => session.portfolioId === id)
  const trades = data.trades.filter((trade) => trade.portfolioId === id)
  const todayMood = data.moods.find((mood) => mood.portfolioId === id && mood.date === todayKey())

  const [name, setName] = useState('')
  const [kind, setKind] = useState<TradingProfileKind>('live')
  const [currency, setCurrency] = useState('USD')
  const [sessionLabel, setSessionLabel] = useState('')
  const [timezone, setTimezone] = useState('')
  const [strategyTags, setStrategyTags] = useState('')
  const [defaultSymbol, setDefaultSymbol] = useState('')
  const [defaultTimeframe, setDefaultTimeframe] = useState('')
  const [startingBalance, setStartingBalance] = useState('0')
  const [emotionTrackingEnabled, setEmotionTrackingEnabled] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState('')

  useEffect(() => {
    if (!portfolio) return
    setName(portfolio.name)
    setKind(portfolio.kind)
    setCurrency(portfolio.currency)
    setSessionLabel(portfolio.sessionTags?.join(', ') || portfolio.sessionLabel || '')
    setTimezone(portfolio.timezone ?? '')
    setStrategyTags((portfolio.strategyTags ?? []).join(', '))
    setDefaultSymbol(portfolio.defaultSymbol ?? '')
    setDefaultTimeframe(portfolio.defaultTimeframe ?? '')
    setStartingBalance(String(portfolio.startingBalance || 0))
    setEmotionTrackingEnabled(isEmotionTrackingEnabled(portfolio))
  }, [portfolio])

  if (!data.loading && !portfolio) {
    return (
      <EmptyState
        icon={CircleAlert}
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

  if (!portfolio || !summary) {
    return <p className="py-8 text-sm text-muted-foreground">Loading profile…</p>
  }
  const emotionTracking = isEmotionTrackingEnabled(portfolio)

  async function saveSettings(event: FormEvent) {
    event.preventDefault()
    if (!portfolio?.id || !name.trim()) return
    await data.updatePortfolio(portfolio.id, {
      name: name.trim(),
      kind: portfolio.needsClassification ? kind : portfolio.kind,
      needsClassification: false,
      currency: currency.trim().toUpperCase() || portfolio.currency,
      sessionLabel: sessionLabel.trim() || undefined,
      sessionTags: [
        ...new Set(
          sessionLabel
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        ),
      ],
      timezone: timezone.trim() || undefined,
      strategyTags: strategyTags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      defaultSymbol: defaultSymbol.trim().toUpperCase() || undefined,
      defaultTimeframe: defaultTimeframe.trim() || undefined,
      startingBalance:
        portfolio.kind === 'replay' ? Number(startingBalance) || 0 : portfolio.startingBalance,
      emotionTrackingEnabled,
    })
    setSettingsMessage('Profile settings saved.')
  }

  async function duplicateAsLive() {
    if (!portfolio) return
    const newId = await data.createPortfolio({
      name: `${portfolio.name} Live`,
      kind: 'live',
      currency: portfolio.currency,
      startingBalance: 0,
      sessionLabel: portfolio.sessionLabel,
      sessionTags: portfolio.sessionTags,
      timezone: portfolio.timezone,
      strategyTags: portfolio.strategyTags,
      defaultSymbol: portfolio.defaultSymbol,
      defaultTimeframe: portfolio.defaultTimeframe,
      emotionTrackingEnabled: portfolio.emotionTrackingEnabled,
    })
    navigate(profileHref(newId, 'connections'))
  }

  async function deleteProfile() {
    if (!portfolio?.id) return
    if (
      !window.confirm(
        `Archive ${portfolio.name}? Its journal records and relationships will be retained. You can restore it in Storage & recovery.`
      )
    )
      return
    await data.deletePortfolio(portfolio.id)
    navigate('/workspace')
  }

  const setupItems =
    portfolio.kind === 'live'
      ? [
          {
            done:
              portfolio.chartSource?.kind === 'live-feed' ||
              portfolio.chartSource?.kind === 'dataset',
            label:
              portfolio.chartSource?.kind === 'live-feed'
                ? `Live chart feed: ${portfolio.chartSource.providerName} · ${portfolio.chartSource.symbol} · ${portfolio.chartSource.interval}`
                : portfolio.chartSource?.kind === 'dataset'
                  ? 'Chart uses pinned saved history'
                  : 'Choose a live platform feed for the chart',
            href: chartHref(id, undefined, portfolio),
          },
          {
            done:
              portfolio.chartSource?.kind === 'dataset' ||
              !!portfolio.liveSetup?.replayHistory?.datasetVersionId,
            label:
              portfolio.chartSource?.kind === 'dataset' ||
              portfolio.liveSetup?.replayHistory?.datasetVersionId
                ? 'Saved replay history is available'
                : 'Optional: download saved history for replay',
            href: '/historify',
          },
          {
            done:
              portfolio.liveSetup?.account.mode === 'connector' ||
              portfolio.liveSetup?.account.mode === 'journal-only',
            label:
              portfolio.liveSetup?.account.mode === 'connector'
                ? `Optional account connection selected: ${portfolio.liveSetup.account.providerName ?? portfolio.liveSetup.account.providerId}`
                : portfolio.liveSetup?.account.mode === 'journal-only'
                  ? 'Journal-only account setup'
                  : 'Optional: connect an account for journal sync',
            href: profileHref(id, 'connections'),
          },
          ...(emotionTracking
            ? [
                {
                  done: Boolean(todayMood),
                  label: 'Save today’s state before trading (optional)',
                  href: profileHref(id, 'journal'),
                },
              ]
            : []),
        ]
      : [
          {
            done: sessions.length > 0,
            label: 'Create the first replay run',
            href: profileHref(id, 'replay'),
          },
          {
            done: sessions.some((session) => session.status === 'Completed'),
            label: 'Complete a run and review its journal',
            href: profileHref(id, 'journal'),
          },
          {
            done: new Set(sessions.map((session) => session.symbol)).size > 1,
            label: 'Test the strategy on another symbol in this project',
            href: profileHref(id, 'replay'),
          },
        ]

  return (
    <div className="space-y-6 py-6">
      <ProfileHeader portfolio={portfolio} active={isSettings ? 'settings' : 'overview'} />

      {isSettings ? (
        <Card>
          <CardHeader>
            <CardTitle>Profile settings</CardTitle>
            <CardDescription>
              {portfolio.needsClassification
                ? 'Confirm whether this legacy profile is Live or Replay. After this, its type stays fixed.'
                : 'Profile type is fixed so live and replay records cannot mix.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveSettings} className="grid gap-4 sm:grid-cols-2">
              {portfolio.needsClassification && (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="profile-kind">Legacy profile type</Label>
                  <select
                    id="profile-kind"
                    className={fieldClass}
                    value={kind}
                    onChange={(event) => setKind(event.target.value as TradingProfileKind)}
                  >
                    <option value="live">Live trading</option>
                    <option value="replay">Replay project</option>
                  </select>
                </div>
              )}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="settings-name">Name</Label>
                <Input
                  id="settings-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-session">Session tags (optional, comma separated)</Label>
                <Input
                  id="settings-session"
                  value={sessionLabel}
                  onChange={(event) => setSessionLabel(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-timezone">Timezone</Label>
                <select
                  id="settings-timezone"
                  className={fieldClass}
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                >
                  <option value="">Not set</option>
                  {[...new Set([timezone, ...timezones].filter(Boolean))].map((zone) => (
                    <option key={zone}>{zone}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-currency">Currency</Label>
                <select
                  id="settings-currency"
                  className={fieldClass}
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  required
                >
                  {[...new Set([currency, ...currencies].filter(Boolean))].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-strategies">Strategies (optional, comma separated)</Label>
                <Input
                  id="settings-strategies"
                  value={strategyTags}
                  onChange={(event) => setStrategyTags(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-symbol">Default symbol</Label>
                <Input
                  id="settings-symbol"
                  value={defaultSymbol}
                  onChange={(event) => setDefaultSymbol(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-timeframe">Default timeframe</Label>
                <select
                  id="settings-timeframe"
                  className={fieldClass}
                  value={defaultTimeframe}
                  onChange={(event) => setDefaultTimeframe(event.target.value)}
                >
                  <option value="">Not set</option>
                  {[...new Set([defaultTimeframe, ...timeframes].filter(Boolean))].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>
              {portfolio.kind === 'replay' && (
                <div className="space-y-2">
                  <Label htmlFor="settings-balance">Default run balance</Label>
                  <Input
                    id="settings-balance"
                    type="number"
                    min="0"
                    step="100"
                    value={startingBalance}
                    onChange={(event) => setStartingBalance(event.target.value)}
                  />
                </div>
              )}
              <fieldset className="border bg-muted/20 p-4 sm:col-span-2">
                <legend className="sr-only">Mindset and emotion tracking</legend>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex max-w-2xl gap-3">
                    <Brain className="mt-0.5 h-5 w-5 shrink-0 text-teal-600" aria-hidden />
                    <div>
                      <Label htmlFor="settings-emotion-tracking" className="text-base">
                        Mindset & emotion tracking
                      </Label>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Optional and off unless you want it. When on, this profile gets a daily
                        check-in, an optional per-trade mindset check, and Mind analytics. It never
                        blocks the chart or a trade. Existing entries are kept if you turn it off
                        and reappear if you turn it back on.
                      </p>
                    </div>
                  </div>
                  <Switch
                    id="settings-emotion-tracking"
                    checked={emotionTrackingEnabled}
                    onCheckedChange={setEmotionTrackingEnabled}
                    aria-label="Toggle mindset and emotion tracking"
                  />
                </div>
                <p className="mt-3 text-sm font-medium">
                  {emotionTrackingEnabled ? 'On for this profile' : 'Off for this profile'}
                </p>
              </fieldset>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <Button type="submit">
                  <Save className="h-4 w-4" /> Save settings
                </Button>
                {portfolio.kind === 'replay' && (
                  <Button type="button" variant="outline" onClick={() => void duplicateAsLive()}>
                    <Copy className="h-4 w-4" /> Duplicate as Live
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => void deleteProfile()}
                >
                  <Trash2 className="h-4 w-4" /> Archive profile
                </Button>
                {settingsMessage && (
                  <span className="text-sm text-teal-700">{settingsMessage}</span>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <>
          {portfolio.kind === 'replay' ? (
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatTile
                label="Independent runs"
                value={String(sessions.length)}
                detail="Each run has its own paper account."
              />
              <StatTile
                label="Default starting cash"
                value={formatMoney(portfolio.startingBalance, portfolio.currency)}
                detail="A default for new runs, not a project account balance."
              />
              <StatTile
                label="Journal positions"
                value={String(trades.length)}
                detail="Choose a book to review its own outcomes."
              />
              <StatTile
                label="Reporting"
                value="Per run"
                detail="Compare selected accounts in Replay runs."
              />
              <StatTile
                label="Capital"
                value="Independent"
                detail="No pooled equity or implied currency conversion."
              />
            </section>
          ) : (
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatTile
                label={portfolio.kind === 'live' ? 'Chart feed' : 'Replay balance'}
                value={
                  portfolio.kind === 'live'
                    ? portfolio.chartSource?.kind === 'live-feed'
                      ? 'Live feed set'
                      : portfolio.chartSource?.kind === 'dataset'
                        ? 'Saved history'
                        : 'Not set up'
                    : summary.balance === null
                      ? '—'
                      : formatMoney(summary.balance, portfolio.currency)
                }
                detail={
                  portfolio.kind === 'live'
                    ? portfolio.chartSource?.kind === 'live-feed'
                      ? `${portfolio.chartSource.providerName} · ${portfolio.chartSource.symbol} · ${portfolio.chartSource.interval}`
                      : 'Choose a platform feed for live candles.'
                    : `Started ${formatMoney(portfolio.startingBalance, portfolio.currency)}`
                }
              />
              <StatTile
                label="Net P&L"
                value={formatMoney(summary.netPnl, portfolio.currency)}
                tone={pnlTone(summary.netPnl)}
                detail={`${summary.closedTrades} closed trades`}
              />
              <StatTile
                label="Win rate"
                value={`${summary.winRate.toFixed(1)}%`}
                detail={`${summary.wins} wins · ${summary.losses} losses`}
              />
              <StatTile
                label="Profit factor"
                value={summary.profitFactor === null ? '—' : summary.profitFactor.toFixed(2)}
                detail={`Expectancy ${formatMoney(summary.expectancy, portfolio.currency)}`}
              />
              <StatTile
                label="Max drawdown"
                value={formatMoney(summary.maxDrawdownCurrency, portfolio.currency)}
                detail={
                  summary.maxDrawdownPct === null
                    ? 'Percentage needs real equity history.'
                    : `${summary.maxDrawdownPct.toFixed(2)}% of peak equity`
                }
              />
            </section>
          )}

          {portfolio.kind === 'live' && (
            <section className="flex flex-wrap items-center justify-between gap-3 border bg-card p-4 shadow-xs">
              <div>
                <h2 className="font-semibold">Holdings research</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  This profile journal stays the trading record. Use Holdings Analyzer only for
                  broker-held positions, concentration, and co-movement.
                </p>
              </div>
              <Button asChild variant="outline">
                <Link to="/portfolio-analyzer">
                  Open Portfolio Analyzer <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </section>
          )}

          <section className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
            <Card>
              <CardHeader>
                <CardTitle>
                  {portfolio.kind === 'live' ? 'Channel setup' : 'Project setup'}
                </CardTitle>
                <CardDescription>The next useful actions for this profile.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {setupItems.map((item) => (
                  <Link
                    key={item.label}
                    to={item.href}
                    className="flex items-start gap-2 text-sm hover:underline"
                  >
                    {item.done ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                    ) : (
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    )}
                    <span>{item.label}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {portfolio.kind === 'live' ? (
                    <RadioTower className="h-5 w-5 text-teal-600" />
                  ) : (
                    <History className="h-5 w-5 text-teal-600" />
                  )}
                  {portfolio.kind === 'live' ? 'Live feed & replay history' : 'Replay runs'}
                </CardTitle>
                <CardDescription>
                  {portfolio.kind === 'live'
                    ? 'Live candles come from the platform feed. Saved history is separate and only changes when you download or publish it.'
                    : 'Each run is one symbol and test window inside this project.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {portfolio.kind === 'live' ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-sm">
                      <span>
                        <span className="block font-medium">Live chart feed</span>
                        <span className="text-muted-foreground">
                          {portfolio.chartSource?.kind === 'live-feed'
                            ? `${portfolio.chartSource.providerName} · ${portfolio.chartSource.symbol} · ${portfolio.chartSource.interval}`
                            : portfolio.chartSource?.kind === 'dataset'
                              ? 'Chart currently uses pinned saved history'
                              : 'Not set up yet'}
                        </span>
                      </span>
                      <Badge variant={portfolio.chartSource ? 'default' : 'outline'}>
                        {portfolio.chartSource?.kind === 'live-feed'
                          ? 'Live'
                          : portfolio.chartSource?.kind === 'dataset'
                            ? 'Saved'
                            : 'Needed'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-sm">
                      <span>
                        <span className="block font-medium">Replay history</span>
                        <span className="text-muted-foreground">
                          {portfolio.chartSource?.kind === 'dataset' ||
                          portfolio.liveSetup?.replayHistory?.datasetVersionId
                            ? 'A reviewed saved-history version is available'
                            : 'Optional — download it separately when you want replay'}
                        </span>
                      </span>
                      <Badge variant="outline">
                        {portfolio.chartSource?.kind === 'dataset' ||
                        portfolio.liveSetup?.replayHistory?.datasetVersionId
                          ? 'Saved'
                          : 'Optional'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>
                        <span className="block font-medium">Account connection</span>
                        <span className="text-muted-foreground">
                          {portfolio.liveSetup?.account.mode === 'connector'
                            ? `${portfolio.liveSetup.account.providerName ?? portfolio.liveSetup.account.providerId} selected for read-only journal sync`
                            : portfolio.liveSetup?.account.mode === 'journal-only'
                              ? 'Journal only'
                              : 'Not needed for live chart candles'}
                        </span>
                      </span>
                      <Badge variant="outline">Optional</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild>
                        <Link to={chartHref(id, undefined, portfolio)}>
                          Open chart / choose feed <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild variant="outline">
                        <Link to="/historify">Replay history</Link>
                      </Button>
                      <Button asChild variant="ghost">
                        <Link to={profileHref(id, 'connections')}>Account connection</Link>
                      </Button>
                    </div>
                  </div>
                ) : sessions.length ? (
                  sessions.slice(0, 5).map((session) => (
                    <div
                      key={session.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-sm"
                    >
                      <span>
                        <span className="block font-medium">{session.name}</span>
                        <span className="text-muted-foreground">
                          {session.symbol} · {session.timeframe} · {session.mode}
                        </span>
                      </span>
                      <Badge variant="outline">{session.status}</Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No runs yet. Add one symbol test to start this project.
                  </p>
                )}
                {portfolio.kind !== 'live' && (
                  <Button asChild variant="outline">
                    <Link to={profileHref(id, 'replay')}>
                      Manage runs <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpenCheck className="h-5 w-5 text-teal-600" /> Recent journal
                </CardTitle>
                <CardDescription>Latest local decisions in this profile.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="divide-y border-y">
                  {trades.slice(0, 5).map((trade) => (
                    <div key={trade.id} className="flex items-center justify-between py-3 text-sm">
                      <span>
                        <span className="block font-medium">{trade.pair}</span>
                        <span className="text-muted-foreground">
                          {trade.strategy} · {trade.origin ?? 'manual'}
                        </span>
                      </span>
                      <span className={pnlTone(trade.netPnl)}>
                        {formatMoney(trade.netPnl, portfolio.currency)}
                      </span>
                    </div>
                  ))}
                  {!trades.length && (
                    <p className="py-4 text-sm text-muted-foreground">No journal trades yet.</p>
                  )}
                </div>
                {emotionTracking ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Mind averages: FOMO {emotion?.fomo?.toFixed(1) ?? '—'} · Discipline{' '}
                    {emotion?.discipline?.toFixed(1) ?? '—'} · Confidence{' '}
                    {emotion?.confidence?.toFixed(1) ?? '—'}
                  </p>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Mindset tracking is off. Enable it in Settings only if you want daily or
                    per-trade check-ins.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Chart layouts</CardTitle>
                <CardDescription>
                  Layouts and templates already saved by the unchanged chart terminal.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between border-b pb-2">
                  <span>Saved layouts</span>
                  <strong>{chartCatalog.catalog?.workspaces.length ?? 0}</strong>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span>Indicator templates</span>
                  <strong>{chartCatalog.catalog?.templates.length ?? 0}</strong>
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link to={chartHref(id, undefined, portfolio)}>Open this profile’s chart</Link>
                </Button>
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  )
}
