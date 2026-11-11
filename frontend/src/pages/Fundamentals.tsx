import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import ResearchOverlayChart from '@/components/research/ResearchOverlayChart'
import {
  type CompareResult,
  type DerivedMetricRow,
  type OverlayResult,
  type ResearchIssuer,
  type ResearchNote,
  type SnapshotSummary,
  type StatementResult,
  researchClient,
} from '@/lib/trader/researchClient'
import { useTraderData } from '@/lib/trader/useTraderData'
import { chartStorageAccount, useAuthStore } from '@/stores/authStore'

const STATEMENTS = [
  ['income', 'Income'],
  ['balance', 'Balance sheet'],
  ['cashflow', 'Cash flow'],
] as const

export default function Fundamentals() {
  const data = useTraderData()
  const principal = useAuthStore(chartStorageAccount)
  const originId = data.workspace?.originId
  const ready = !!(principal && originId && data.storageMode === 'backend')
  const epoch = useRef(0)

  const [issuers, setIssuers] = useState<ResearchIssuer[]>([])
  const [selected, setSelected] = useState<ResearchIssuer | null>(null)
  const [counts, setCounts] = useState<{ documentCount: number; factCount: number } | null>(null)
  const [kind, setKind] = useState<string>('income')
  const [statement, setStatement] = useState<StatementResult | null>(null)
  const [metrics, setMetrics] = useState<DerivedMetricRow[]>([])
  const [coverage, setCoverage] = useState<{
    fields: { line: string; status: string; definition: string }[]
    gatedCapabilities: { capability: string; status: string }[]
  } | null>(null)
  const [events, setEvents] = useState<{ time: string; accession: string; sourceUrl: string }[]>([])
  const [cik, setCik] = useState('')
  const [filter, setFilter] = useState('')
  const [documents, setDocuments] = useState<
    { id: string; nativeDocumentId: string; sourceUrl: string }[]
  >([])
  const [notes, setNotes] = useState<ResearchNote[]>([])
  const [noteText, setNoteText] = useState('')
  const [noteDocument, setNoteDocument] = useState('')
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([])
  const [snapshotLabel, setSnapshotLabel] = useState('')
  const [compareWith, setCompareWith] = useState('')
  const [comparison, setComparison] = useState<CompareResult | null>(null)
  const [overlay, setOverlay] = useState<OverlayResult | null>(null)
  const [overlayLine, setOverlayLine] = useState('revenue')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadIssuers = useCallback(async () => {
    if (!originId || !principal) return
    try {
      const result = await researchClient.issuers(originId, principal)
      setIssuers(result.issuers)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Companies could not be loaded.')
    }
  }, [originId, principal])

  useEffect(() => {
    epoch.current += 1
    setSelected(null)
    setStatement(null)
    if (ready) void loadIssuers()
  }, [ready, loadIssuers])

  async function openIssuer(issuer: ResearchIssuer, statementKind = kind) {
    if (!originId || !principal) return
    const ticket = ++epoch.current
    setBusy(true)
    setError('')
    try {
      const [detail, stmt, mets, cov, evts, docs, nts, snaps, ovl] = await Promise.all([
        researchClient.issuer(originId, issuer.id, principal),
        researchClient.statement(originId, issuer.id, statementKind, {}, principal),
        researchClient.metrics(originId, issuer.id, principal),
        researchClient.coverage(originId, issuer.id, principal),
        researchClient.events(originId, issuer.id, principal),
        researchClient.documents(originId, issuer.id, principal),
        researchClient.notes(originId, issuer.id, principal),
        researchClient.snapshots(originId, issuer.id, principal),
        researchClient.overlay(originId, issuer.id, overlayLine, principal),
      ])
      if (epoch.current !== ticket) return
      setSelected(issuer)
      setCounts({ documentCount: detail.documentCount, factCount: detail.factCount })
      setStatement(stmt)
      setMetrics(mets.metrics)
      setCoverage(cov)
      setEvents(evts.events)
      setDocuments(docs.documents)
      setNotes(nts.notes)
      setSnapshots(snaps.snapshots)
      setNoteDocument(docs.documents[0]?.id ?? '')
      setComparison(null)
      setOverlay(ovl)
    } catch (cause) {
      if (epoch.current === ticket)
        setError(cause instanceof Error ? cause.message : 'Company could not be loaded.')
    } finally {
      if (epoch.current === ticket) setBusy(false)
    }
  }

  async function ingest() {
    if (!originId || !principal || !cik.trim()) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await researchClient.ingest(originId, cik.trim(), principal)
      const ran = await researchClient.runNextIngestion(originId, principal)
      setNotice(
        ran.job.status === 'completed'
          ? 'Company imported from SEC EDGAR.'
          : `Ingestion finished with status: ${ran.job.status}.`
      )
      setCik('')
      await loadIssuers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ingestion could not be started.')
    } finally {
      setBusy(false)
    }
  }

  async function saveNote() {
    if (!originId || !principal || !selected || !noteDocument || !noteText.trim()) return
    setBusy(true)
    setError('')
    try {
      const note = await researchClient.addNote(
        originId,
        selected.id,
        noteDocument,
        noteText.trim(),
        principal
      )
      setNotes((rows) => [...rows, note])
      setNoteText('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Note could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function saveSnapshot() {
    if (!originId || !principal || !selected || !snapshotLabel.trim()) return
    setBusy(true)
    setError('')
    try {
      await researchClient.saveSnapshot(originId, selected.id, snapshotLabel.trim(), principal)
      const snaps = await researchClient.snapshots(originId, selected.id, principal)
      setSnapshots(snaps.snapshots)
      setSnapshotLabel('')
      setNotice('Research snapshot saved. It keeps this evidence even if filings are restated.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Snapshot could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function changeOverlayLine(line: string) {
    setOverlayLine(line)
    if (!originId || !principal || !selected) return
    const ticket = ++epoch.current
    try {
      const ovl = await researchClient.overlay(originId, selected.id, line, principal)
      if (epoch.current === ticket) setOverlay(ovl)
    } catch (cause) {
      if (epoch.current === ticket)
        setError(cause instanceof Error ? cause.message : 'Chart data could not be loaded.')
    }
  }

  async function runCompare() {
    if (!originId || !principal || !selected || !compareWith) return
    setBusy(true)
    setError('')
    try {
      setComparison(
        await researchClient.compare(originId, [selected.id, compareWith], 'revenue', principal)
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Comparison could not be loaded.')
    } finally {
      setBusy(false)
    }
  }

  const visibleIssuers = issuers.filter(
    (issuer) =>
      !filter.trim() ||
      issuer.name.toLowerCase().includes(filter.trim().toLowerCase()) ||
      issuer.identifiers.some((row) =>
        row.key.toLowerCase().includes(filter.trim().toLowerCase())
      )
  )

  return (
    <div className="space-y-6 py-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Fundamentals</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Company statements sourced from SEC EDGAR filings. Every value links back to its
          filing; calculated metrics cite their exact inputs, and anything without a source is
          shown as unavailable — never estimated.
        </p>
      </header>
      {!ready ? (
        <section className="max-w-3xl space-y-3 border bg-card p-6">
          <h2 className="text-lg font-semibold">Local workspace required</h2>
          <p className="text-sm text-muted-foreground">
            Sign in and open the backend workspace to import and inspect company filings.
          </p>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Import company</CardTitle>
                <CardDescription>By SEC CIK number (for example 789019 for Microsoft).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="fund-cik">CIK</Label>
                  <Input
                    id="fund-cik"
                    value={cik}
                    onChange={(event) => setCik(event.target.value)}
                    placeholder="789019"
                  />
                </div>
                <Button disabled={busy || !cik.trim()} onClick={() => void ingest()}>
                  Import from EDGAR
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Companies</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="space-y-2">
                  <Label htmlFor="fund-filter">Search companies</Label>
                  <Input
                    id="fund-filter"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Name, ticker or CIK"
                  />
                </div>
                {issuers.length === 0 && (
                  <p className="text-sm text-muted-foreground">No companies imported yet.</p>
                )}
                {visibleIssuers.map((issuer) => (
                  <button
                    key={issuer.id}
                    type="button"
                    className="block w-full border p-3 text-left text-sm hover:bg-muted"
                    onClick={() => void openIssuer(issuer)}
                  >
                    <span className="font-medium">{issuer.name}</span>{' '}
                    <span className="text-muted-foreground">
                      {issuer.identifiers.map((row) => `${row.namespace}:${row.key}`).join(' · ')}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
          <div className="space-y-4">
            {error && (
              <output role="alert" className="block border p-3 text-sm">
                {error}
              </output>
            )}
            {notice && <output className="block border p-3 text-sm">{notice}</output>}
            {!selected ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Import or select a company to inspect its statements.
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>{selected.name}</CardTitle>
                    <CardDescription>
                      {counts
                        ? `${counts.documentCount} filings · ${counts.factCount} stored facts`
                        : ''}{' '}
                      · values in millions unless stated · latest-restated view
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <fieldset className="flex flex-wrap gap-2">
                      <legend className="sr-only">Statement</legend>
                      {STATEMENTS.map(([value, label]) => (
                        <Button
                          key={value}
                          size="sm"
                          variant={kind === value ? 'default' : 'outline'}
                          disabled={busy}
                          onClick={() => {
                            setKind(value)
                            void openIssuer(selected, value)
                          }}
                        >
                          {label}
                        </Button>
                      ))}
                    </fieldset>
                    {statement && (
                      <table className="w-full text-sm">
                        <tbody>
                          {statement.lines.map((line) => (
                            <tr key={line.line} className="border-b">
                              <td className="py-2 pr-3">{line.line.replaceAll('_', ' ')}</td>
                              <td className="py-2 pr-3 text-right font-mono">{line.displayValue}</td>
                              <td className="py-2 pr-3 text-muted-foreground">
                                {line.unit} · FY{line.fiscalYear} {line.fiscalPeriod} ·{' '}
                                {line.periodEnd}
                              </td>
                              <td className="py-2 font-mono text-xs text-muted-foreground">
                                {line.citation}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {statement && statement.unavailable.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Not reported / unavailable:{' '}
                        {statement.unavailable.map((row) => row.line).join(', ')}. Segment data:{' '}
                        {statement.segmentData.status} — {statement.segmentData.reason}
                      </p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>History chart with filing events</CardTitle>
                    <CardDescription>
                      Reported history on its own date semantics — this is fundamentals history,
                      not a price chart, and no market data is mixed in.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="fund-overlay-line">Chart line</Label>
                      <select
                        id="fund-overlay-line"
                        className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
                        value={overlayLine}
                        onChange={(event) => void changeOverlayLine(event.target.value)}
                      >
                        {['revenue', 'net_income', 'total_assets', 'operating_cash_flow'].map(
                          (line) => (
                            <option key={line} value={line}>
                              {line.replaceAll('_', ' ')}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                    {overlay && (
                      <ResearchOverlayChart
                        overlay={overlay}
                        lineLabel={overlayLine.replaceAll('_', ' ')}
                      />
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Calculated metrics</CardTitle>
                    <CardDescription>
                      Versioned formulas over reported facts. Unavailable means an input is
                      missing — never replaced with zero.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    {metrics.map((row) => (
                      <p key={row.id} className="border-b py-1">
                        <span className="font-medium">{row.formulaId}</span>:{' '}
                        {row.value ?? `unavailable (${row.unavailableReason})`}
                        {row.value ? ` · from ${row.inputFactIds.length} reported facts` : ''}
                      </p>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Compare, value & save evidence</CardTitle>
                    <CardDescription>
                      Related identifiers:{' '}
                      {selected.identifiers.map((row) => `${row.namespace}:${row.key}`).join(' · ')}
                      . Valuation inputs available here are reported EPS and shares (see
                      statements); a market price needs an entitled data source and is shown as
                      unavailable rather than scraped.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-2">
                        <Label htmlFor="fund-compare">Compare revenue with</Label>
                        <select
                          id="fund-compare"
                          className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={compareWith}
                          onChange={(event) => setCompareWith(event.target.value)}
                        >
                          <option value="">Select company</option>
                          {issuers
                            .filter((issuer) => issuer.id !== selected.id)
                            .map((issuer) => (
                              <option key={issuer.id} value={issuer.id}>
                                {issuer.name}
                              </option>
                            ))}
                        </select>
                      </div>
                      <Button size="sm" disabled={busy || !compareWith} onClick={() => void runCompare()}>
                        Compare
                      </Button>
                    </div>
                    {comparison && (
                      <div className="space-y-1">
                        <p className="text-muted-foreground">{comparison.comparabilityNote}</p>
                        {comparison.rows.map((row) => (
                          <p key={row.issuer}>
                            {row.issuer}:{' '}
                            {row.status === 'available'
                              ? `${row.value} ${row.unit} · period ending ${row.periodEnd} · ${row.citation}`
                              : `unavailable (${row.reason})`}
                          </p>
                        ))}
                        {!comparison.complete && (
                          <p className="text-muted-foreground">
                            Comparison incomplete: at least one company has no reported value.
                          </p>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-2">
                        <Label htmlFor="fund-snapshot-label">Snapshot label</Label>
                        <Input
                          id="fund-snapshot-label"
                          value={snapshotLabel}
                          onChange={(event) => setSnapshotLabel(event.target.value)}
                          placeholder="Why I believe this"
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={busy || !snapshotLabel.trim()}
                        onClick={() => void saveSnapshot()}
                      >
                        Save research snapshot
                      </Button>
                    </div>
                    {snapshots.map((row) => (
                      <p key={row.id}>
                        {row.label} · {row.factCount} facts · saved {row.savedAt}
                      </p>
                    ))}
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-2">
                        <Label htmlFor="fund-note-doc">Note on filing</Label>
                        <select
                          id="fund-note-doc"
                          className="flex h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={noteDocument}
                          onChange={(event) => setNoteDocument(event.target.value)}
                        >
                          {documents.map((doc) => (
                            <option key={doc.id} value={doc.id}>
                              {doc.nativeDocumentId}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="min-w-52 flex-1 space-y-2">
                        <Label htmlFor="fund-note-text">Note</Label>
                        <Input
                          id="fund-note-text"
                          value={noteText}
                          onChange={(event) => setNoteText(event.target.value)}
                          placeholder="What did you verify?"
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={busy || !noteText.trim() || !noteDocument}
                        onClick={() => void saveNote()}
                      >
                        Add note
                      </Button>
                    </div>
                    {notes.map((row) => (
                      <p key={row.id} className="border-l-2 pl-3">
                        {row.text} <span className="text-muted-foreground">({row.createdAt})</span>
                      </p>
                    ))}
                    <p className="text-muted-foreground">
                      Other asset classes: crypto supply/unlocks, fund holdings, FX fixing
                      calendars and futures roll data are unavailable — no certified source is
                      connected for them yet (see coverage).
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Filings & coverage</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {events.slice(0, 8).map((event) => (
                      <p key={event.accession}>
                        {event.time} ·{' '}
                        <a
                          className="underline"
                          href={event.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {event.accession}
                        </a>
                      </p>
                    ))}
                    {coverage && (
                      <p className="text-muted-foreground">
                        Fields available:{' '}
                        {coverage.fields.filter((f) => f.status === 'available').length}/
                        {coverage.fields.length}. Not yet sourced:{' '}
                        {coverage.gatedCapabilities.map((row) => row.capability).join(', ')}.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
