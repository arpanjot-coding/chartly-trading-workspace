import { ArrowRight, History, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { type DatasetVersion, dataLibrary } from '@/api/dataLibrary'
import { ChartEvidenceList } from '@/components/trading/ChartEvidenceList'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { datasetLibraryHref } from '@/lib/historify/dataLibraryNavigation'
import type { PracticeMarket, PracticeMode, SessionStatus } from '@/lib/trader/db'
import { formatMoney, summarizePortfolio } from '@/lib/trader/metrics'
import { validPaperStartingCash } from '@/lib/trader/paperCash'
import { useTraderData } from '@/lib/trader/useTraderData'
import { PaperRunComparison } from './PaperRunComparison'
import { PaperRunMetrics } from './PaperRunMetrics'
import { chartHref, dateLabel, ProfileHeader, pnlTone, StatTile } from './ProfileShell'

const markets: PracticeMarket[] = ['Crypto', 'Forex', 'Metals', 'Commodities', 'Indices', 'Stocks']
const modes: PracticeMode[] = ['Replay', 'Practice']
const statuses: SessionStatus[] = ['Draft', 'Ready', 'In progress', 'Completed']
const timeframes = ['1m', '5m', '15m', '1h', '4h', '1D']
const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function TraderReplay() {
  const { profileId } = useParams()
  const [params] = useSearchParams()
  const requestedVersionParam = params.get('datasetVersionId')
  const data = useTraderData()
  const id = Number(profileId)
  const portfolio = data.portfolios.find((item) => item.id === id)
  const requestedVersionId =
    requestedVersionParam ??
    (portfolio?.chartSource?.kind === 'dataset' ? portfolio.chartSource.versionId : null)
  const sessions = data.sessions.filter((session) => session.portfolioId === id)

  const [name, setName] = useState('')
  const [mode, setMode] = useState<PracticeMode>('Replay')
  const [market, setMarket] = useState<PracticeMarket>('Forex')
  const [symbol, setSymbol] = useState('EURUSD')
  const [timeframe, setTimeframe] = useState('15m')
  const [balance, setBalance] = useState('')
  const [source, setSource] = useState('No data feed connected yet')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [dataset, setDataset] = useState<DatasetVersion | null>(null)
  const [datasetLoading, setDatasetLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const runCash = balance.trim() || String(portfolio?.startingBalance ?? '')
  const runCashValid = validPaperStartingCash(runCash)
  useEffect(() => {
    setDataset(null)
    setError('')
    if (!requestedVersionId) {
      setDatasetLoading(false)
      return
    }
    const controller = new AbortController()
    setDatasetLoading(true)
    void dataLibrary
      .version(requestedVersionId, controller.signal)
      .then((version) => {
        if (controller.signal.aborted) return
        setDataset(version)
        setSymbol(version.metadata.symbol)
        setTimeframe(version.metadata.interval)
        setSource(`${version.name || version.metadata.symbol} · ${version.metadata.provider}`)
        setRangeStart(new Date(version.start * 1000).toISOString().slice(0, 10))
        setRangeEnd(new Date(version.end * 1000).toISOString().slice(0, 10))
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'The selected dataset version could not be read.'
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setDatasetLoading(false)
      })
    return () => controller.abort()
  }, [requestedVersionId])

  const symbolsTested = new Set(sessions.map((session) => session.symbol)).size
  const completed = sessions.filter(
    (session) =>
      session.paper?.status === 'finished' || (!session.paper && session.status === 'Completed')
  ).length

  if (!data.loading && !portfolio) {
    return (
      <EmptyState
        icon={History}
        title="Replay project not found"
        description="This profile does not exist in this browser."
        action={
          <Button asChild className="mt-4">
            <Link to="/workspace">Back to profiles</Link>
          </Button>
        }
      />
    )
  }
  if (!portfolio)
    return <p className="py-8 text-sm text-muted-foreground">Loading replay project…</p>

  async function createRun(event: FormEvent) {
    event.preventDefault()
    if (
      !portfolio?.id ||
      !name.trim() ||
      !symbol.trim() ||
      !dataset ||
      !runCashValid ||
      !dataset.metadata.currency
    )
      return
    setBusy(true)
    setError('')
    try {
      await data.createSession({
        portfolioId: portfolio.id,
        name: name.trim(),
        mode,
        market,
        symbol: dataset.metadata.symbol,
        timeframe: dataset.metadata.interval,
        dataSource: source,
        rangeStart: rangeStart || undefined,
        rangeEnd: rangeEnd || undefined,
        status: 'Draft',
        startingBalance: Number(runCash),
        currency: dataset.metadata.currency,
        notes: '',
        ...(dataset ? { datasetVersionId: dataset.id, datasetChecksum: dataset.checksum } : {}),
      })
      setName('')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The draft could not be saved. Your input is retained.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 py-6">
      <ProfileHeader portfolio={portfolio} active="replay" />

      {portfolio.kind !== 'replay' ? (
        <EmptyState
          icon={History}
          title="Replay runs belong to replay projects"
          description="This is a live profile. Use Connections for its broker destinations, or duplicate its strategy into a replay project from Workspace."
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Independent paper accounts"
              value={String(sessions.filter((session) => session.paper).length)}
              detail="Each run owns its own cash and equity"
            />
            <StatTile
              label="Runs"
              value={String(sessions.length)}
              detail={`${completed} completed`}
            />
            <StatTile
              label="Symbols tested"
              value={String(symbolsTested)}
              detail="Across all runs in this folder"
            />
            <StatTile
              label="Reporting"
              value="Per run"
              detail="Compare selected accounts without pooled equity"
            />
          </section>

          <PaperRunComparison
            originId={data.workspace?.originId}
            profileId={portfolio.id!}
            sessions={sessions}
          />

          <section className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Runs in this project</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each run keeps one symbol, timeframe, test window, and starting balance. Confirmed
                paper fills are saved to that run’s own journal book. Open its chart to review
                economics, prepare an independent account, trade saved candles and inspect its
                report.
              </p>
            </div>

            {sessions.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sessions.map((session) => {
                  const runTrades = data.trades.filter((trade) => trade.sessionId === session.id)
                  const runSummary = session.paper
                    ? null
                    : summarizePortfolio(
                        { ...portfolio, startingBalance: session.startingBalance },
                        runTrades
                      )
                  return (
                    <article
                      key={session.id}
                      className="flex flex-col border bg-card p-5 shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{session.name}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {session.symbol} · {session.timeframe} · {session.market}
                          </p>
                        </div>
                        <Badge variant={session.mode === 'Replay' ? 'default' : 'secondary'}>
                          {session.mode}
                        </Badge>
                      </div>
                      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                        {session.paper ? (
                          <PaperRunMetrics
                            originId={data.workspace?.originId}
                            principalId={data.principalId}
                            profileId={portfolio.id!}
                            runId={session.id!}
                            revision={session.paper.revision}
                          />
                        ) : (
                          runSummary && (
                            <>
                              <div>
                                <dt className="text-muted-foreground">Net P&L</dt>
                                <dd className={`mt-1 font-semibold ${pnlTone(runSummary.netPnl)}`}>
                                  {formatMoney(runSummary.netPnl, portfolio.currency)}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-muted-foreground">Win rate</dt>
                                <dd className="mt-1 font-semibold">
                                  {runSummary.winRate.toFixed(1)}%
                                </dd>
                              </div>
                            </>
                          )
                        )}
                        <div>
                          <dt className="text-muted-foreground">Window</dt>
                          <dd className="mt-1 font-semibold">
                            {session.rangeStart || session.rangeEnd
                              ? `${session.rangeStart || '…'} → ${session.rangeEnd || '…'}`
                              : 'Not set'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Updated</dt>
                          <dd className="mt-1 font-semibold">{dateLabel(session.updatedAt)}</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-muted-foreground">Data</dt>
                          <dd className="mt-1">{session.dataSource}</dd>
                        </div>
                      </dl>
                      <ChartEvidenceList
                        record={session}
                        originId={data.workspace?.originId}
                        reopenContext={{
                          profileId: portfolio.id!,
                          runId: session.id!,
                          returnTo: `/workspace/profiles/${portfolio.id}/replay${params.toString() ? `?${params}` : ''}`,
                        }}
                      />
                      <div className="mt-5 flex items-center gap-2 border-t pt-4">
                        {session.paper && (
                          <span className="min-w-0 flex-1 text-sm">
                            Paper: {session.paper.status.replaceAll('_', ' ')} · revision{' '}
                            {session.paper.revision}
                          </span>
                        )}
                        {!session.paper && (
                          <select
                            aria-label={`Status for ${session.name}`}
                            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                            value={session.status}
                            disabled={!!session.datasetVersionId}
                            onChange={(event) =>
                              session.id &&
                              void data.updateSessionStatus(
                                session.id,
                                event.target.value as SessionStatus
                              )
                            }
                          >
                            {statuses.map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </select>
                        )}
                        <Button asChild size="sm">
                          <Link
                            to={chartHref(
                              portfolio.id!,
                              session.id,
                              portfolio,
                              undefined,
                              undefined,
                              undefined,
                              session.datasetVersionId
                            )}
                          >
                            Chart <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Archive ${session.name}`}
                          onClick={() => {
                            if (
                              session.id &&
                              window.confirm(
                                'Archive this practice run? Its journal records are retained.'
                              )
                            )
                              void data.deleteSession(session.id)
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {session.datasetVersionId && (
                        <Link
                          className="mt-3 text-sm underline"
                          to={`${chartHref(portfolio.id!, session.id, portfolio, undefined, undefined, undefined, session.datasetVersionId)}&paper=1`}
                        >
                          {session.paper
                            ? 'Review paper account and report'
                            : 'Prepare paper account'}
                        </Link>
                      )}
                    </article>
                  )
                })}
              </div>
            ) : (
              <EmptyState
                icon={History}
                title="No runs in this project"
                description="Create the first symbol test below."
              />
            )}
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Create a run</CardTitle>
              <CardDescription>
                Keep tests for one strategy together, even when symbols and periods differ.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 space-y-2">
                <Button asChild variant="outline">
                  <Link to={datasetLibraryHref(`/workspace/profiles/${id}/replay`, dataset?.id)}>
                    Choose history in Data Library
                  </Link>
                </Button>
                {datasetLoading && (
                  <output className="block text-sm">Reading selected dataset version…</output>
                )}
                {dataset && (
                  <p className="text-sm">
                    Pinned history: {dataset.name || dataset.metadata.symbol} ·{' '}
                    {dataset.metadata.provider} · {dataset.metadata.interval}. This creates a Draft;
                    simulation execution is a later workflow.
                  </p>
                )}
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>
              <form onSubmit={createRun} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="run-name">Run name</Label>
                  <Input
                    id="run-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="EURUSD Jan-Mar"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="run-mode">Mode</Label>
                  <select
                    id="run-mode"
                    className={fieldClass}
                    value={mode}
                    onChange={(event) => setMode(event.target.value as PracticeMode)}
                  >
                    {modes.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="run-market">Market</Label>
                  <select
                    id="run-market"
                    className={fieldClass}
                    value={market}
                    onChange={(event) => setMarket(event.target.value as PracticeMarket)}
                  >
                    {markets.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="run-symbol">Symbol</Label>
                  <Input
                    id="run-symbol"
                    value={symbol}
                    onChange={(event) => setSymbol(event.target.value)}
                    disabled={!!dataset || datasetLoading}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="run-timeframe">Timeframe</Label>
                  <select
                    id="run-timeframe"
                    className={fieldClass}
                    value={timeframe}
                    disabled={!!dataset || datasetLoading}
                    onChange={(event) => setTimeframe(event.target.value)}
                  >
                    {[
                      ...new Set([...(dataset ? [dataset.metadata.interval] : []), ...timeframes]),
                    ].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="run-balance">Starting balance</Label>
                  <Input
                    id="run-balance"
                    inputMode="decimal"
                    value={balance}
                    onChange={(event) => setBalance(event.target.value)}
                    placeholder={String(portfolio.startingBalance)}
                    aria-invalid={!runCashValid}
                  />
                  <p className="text-xs text-muted-foreground">
                    {dataset?.metadata.currency || portfolio.currency} · positive cash for this
                    independent run. Review spread, slippage, fees and 1× collateral in its paper
                    account.
                  </p>
                  {!runCashValid && (
                    <p className="text-sm text-destructive">
                      Enter positive starting cash without commas or exponent notation.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="run-source">Data source</Label>
                  <select
                    id="run-source"
                    className={fieldClass}
                    value={source}
                    disabled={!!dataset || datasetLoading}
                    onChange={(event) => setSource(event.target.value)}
                  >
                    {dataset && <option>{source}</option>}
                    <option>No data feed connected yet</option>
                  </select>
                  {!dataset && (
                    <p className="text-xs text-muted-foreground">
                      Use Choose history in Data Library above to import or select a saved version.
                      It returns here to prepare a version-bound Draft.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="run-start">Window start</Label>
                  <Input
                    id="run-start"
                    type="date"
                    value={rangeStart}
                    onChange={(event) => setRangeStart(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="run-end">Window end</Label>
                  <Input
                    id="run-end"
                    type="date"
                    value={rangeEnd}
                    onChange={(event) => setRangeEnd(event.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={
                      busy ||
                      datasetLoading ||
                      !dataset ||
                      !dataset.metadata.currency ||
                      !runCashValid
                    }
                  >
                    <Plus className="h-4 w-4" /> {busy ? 'Saving…' : 'Create run'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
