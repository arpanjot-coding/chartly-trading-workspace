import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  type ChartEvidenceCapture,
  type ChartEvidenceRequest,
  type ChartEvidenceTarget,
  chartImageBase64,
  readChartEvidence,
  validateChartCapture,
} from '@/lib/trader/chartEvidence'
import { journalClient } from '@/lib/trader/journalClient'
import { type JournalDraftScope, journalDrafts } from '@/lib/trader/journalDrafts'
import { LocalStorageError } from '@/lib/trader/localStorageClient'
import { useTraderData } from '@/lib/trader/useTraderData'
import { ChartEvidenceList } from './ChartEvidenceList'
import { PANEL_HEADER, PanelShell } from './panelShell'

export interface JournalPanelProps {
  contextKey: string
  profileId?: number
  runId?: number
  tradeId?: number
  bookId?: string
  instrument?: { symbol: string; exchange: string }
  capture: () => Promise<{ file: Blob; capture: ChartEvidenceCapture } | null>
  readCaptureKey: () => string | null
  captureAvailable?: boolean
}

const selectClass = 'h-9 w-full rounded border bg-background px-2 text-sm'
const positive = (value: string) => (/^[1-9]\d*$/.test(value) ? Number(value) : 0)

export function JournalPanel(props: JournalPanelProps) {
  const data = useTraderData()
  const [query] = useSearchParams()
  const [chosenProfile, setChosenProfile] = useState('')
  const [chosenBook, setChosenBook] = useState('')
  const [kind, setKind] = useState<'trade' | 'run'>(props.runId && !props.tradeId ? 'run' : 'trade')
  const [chosenRecord, setChosenRecord] = useState(String(props.tradeId ?? props.runId ?? ''))
  const [recordQuery, setRecordQuery] = useState('')
  const [annotations, setAnnotations] = useState('')
  const [retained, setRetained] = useState<ChartEvidenceRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [draftReady, setDraftReady] = useState(false)
  const [draftAttempt, setDraftAttempt] = useState(0)
  const [conflict, setConflict] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const operation = useRef(false)
  const mounted = useRef(true)
  const latestOwner = useRef('')

  const profileId = props.profileId ?? positive(chosenProfile)
  const profile = data.portfolios.find((item) => item.id === profileId && !item.archivedAt)
  const books = data.books.filter(
    (book) => book.profileId === profileId || book.profileIds?.includes(profileId)
  )
  const bookId =
    props.bookId && books.some((book) => book.id === props.bookId) ? props.bookId : chosenBook
  const records =
    kind === 'trade'
      ? data.trades.filter(
          (trade) =>
            trade.portfolioId === profileId &&
            !trade.archivedAt &&
            (data.bookAssignments[String(trade.id)] ?? trade.journalBookId) === bookId &&
            (!props.runId || trade.sessionId === props.runId) &&
            (!props.instrument || trade.pair === props.instrument.symbol)
        )
      : data.sessions.filter(
          (run) =>
            run.portfolioId === profileId &&
            !run.archivedAt &&
            (!props.runId || run.id === props.runId) &&
            (!props.instrument || run.symbol === props.instrument.symbol)
        )
  const selected = records.find((item) => item.id === positive(chosenRecord))
  const needle = recordQuery.trim().toLowerCase()
  const matches = records.filter((item) =>
    ('pair' in item
      ? `${item.id} ${item.pair} ${item.openDate} ${item.direction}`
      : `${item.id} ${item.name} ${item.symbol}`
    )
      .toLowerCase()
      .includes(needle)
  )
  const shownRecords = matches.slice(0, 100)
  if (selected && !recordQuery && !shownRecords.some((item) => item.id === selected.id))
    shownRecords.splice(0, shownRecords.length >= 100 ? 1 : 0, selected)
  const evidenceFull = readChartEvidence(selected).length >= 20
  const target: ChartEvidenceTarget | null =
    selected?.id && profile?.id && (kind === 'run' || bookId)
      ? { kind, id: selected.id, profileId: profile.id, ...(kind === 'trade' ? { bookId } : {}) }
      : null
  const scope: JournalDraftScope | null =
    data.workspace && data.principalId && target
      ? {
          principalId: data.principalId,
          originId: data.workspace.originId,
          bookId: target.bookId ?? `run:${target.id}`,
        }
      : null
  const draftKind = target ? `attachment:chart-${target.kind}-${target.id}` : ''
  const owner = JSON.stringify([props.contextKey, scope, draftKind, target])
  latestOwner.current = owner

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // A different chart environment clears destination choices even when optional IDs stay absent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: context identity deliberately resets unbound destination choices
  useEffect(() => {
    setChosenProfile('')
    setChosenBook('')
    setRecordQuery('')
    setKind(props.runId && !props.tradeId ? 'run' : 'trade')
    setChosenRecord(String(props.tradeId ?? props.runId ?? ''))
  }, [props.contextKey, props.runId, props.tradeId])
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit retry rechecks a previously failed durable draft read
  useEffect(() => {
    const [, frozenScope, key, frozenTarget] = JSON.parse(owner) as [
      string,
      JournalDraftScope | null,
      string,
      ChartEvidenceTarget | null,
    ]
    let active = true
    setRetained(null)
    setError('')
    setMessage('')
    setConflict(false)
    setReviewed(false)
    setDraftReady(false)
    if (!frozenScope) {
      setDraftReady(true)
      return
    }
    void journalDrafts
      .get<ChartEvidenceRequest>(frozenScope, key)
      .then((draft) => {
        if (!active) return
        if (
          draft &&
          (draft.value.originId !== frozenScope.originId ||
            draft.value.target?.kind !== frozenTarget?.kind ||
            draft.value.target.id !== frozenTarget?.id ||
            draft.value.target.profileId !== frozenTarget?.profileId ||
            draft.value.target.bookId !== frozenTarget?.bookId)
        )
          throw new Error(
            'The interrupted capture does not match this record. Keep it for recovery and reopen its original journal.'
          )
        setRetained(draft?.value ?? null)
        setDraftReady(true)
      })
      .catch(() => {
        if (active)
          setError(
            'Interrupted captures could not be checked. Reload this journal before capturing another chart.'
          )
      })
    return () => {
      active = false
    }
  }, [owner, draftAttempt])

  const current = (identity: string) => mounted.current && latestOwner.current === identity
  async function publish(
    body: ChartEvidenceRequest,
    identity: string,
    draftScope: JournalDraftScope,
    key: string
  ) {
    try {
      const response = await journalClient.attachChartEvidence(body)
      if (!current(identity)) return
      await data.acceptJournalResponse(response)
      await journalDrafts.delete(draftScope, key)
      if (!current(identity)) return
      setRetained(null)
      setAnnotations('')
      setConflict(false)
      setMessage('Chart saved to the selected record. Financial facts were unchanged.')
    } catch (cause) {
      if (!current(identity)) return
      setConflict(cause instanceof LocalStorageError && cause.code === 'storage.revision_conflict')
      setError(
        cause instanceof Error
          ? cause.message
          : 'The chart could not be saved. Its captured image and notes are retained.'
      )
    }
  }
  async function captureAndSave() {
    if (props.captureAvailable === false) return
    if (
      operation.current ||
      retained ||
      !target ||
      !selected ||
      !scope ||
      !data.workspace ||
      data.readOnly ||
      evidenceFull ||
      !draftReady
    )
      return
    const identity = owner
    const captureKey = props.readCaptureKey()
    if (!captureKey) {
      setError('Wait for the selected chart to finish loading before capturing it.')
      return
    }
    operation.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const image = await props.capture()
      if (!current(identity)) return
      if (!image)
        throw new Error(
          'The focused chart did not produce an image. Wait for it to finish loading and capture it again.'
        )
      if (props.readCaptureKey() !== captureKey)
        throw new Error(
          'The chart changed during capture. Review the focused pane and capture it again.'
        )
      const capture = validateChartCapture(image.capture)
      if (capture.instrument.symbol !== ('pair' in selected ? selected.pair : selected.symbol))
        throw new Error(
          `This chart shows ${capture.instrument.symbol}. Choose a matching journal entry or practice run before attaching it.`
        )
      const base64 = await chartImageBase64(image.file)
      if (!current(identity)) return
      if (props.readCaptureKey() !== captureKey)
        throw new Error(
          'The chart changed during capture. Review the focused pane and capture it again.'
        )
      const body: ChartEvidenceRequest = {
        originId: scope.originId,
        expectedRevision: data.workspace.revision,
        requestId: crypto.randomUUID(),
        target,
        mimeType: 'image/png',
        base64,
        capture,
        annotations: annotations.trim(),
      }
      await journalDrafts.save(scope, draftKind, body)
      if (!current(identity)) return
      setRetained(body)
      await publish(body, identity, scope, draftKind)
    } catch (cause) {
      if (current(identity))
        setError(
          cause instanceof Error
            ? cause.message
            : 'The chart could not be captured. Try again when the pane is ready.'
        )
    } finally {
      operation.current = false
      if (mounted.current) setBusy(false)
    }
  }
  async function retry(rebase = false) {
    if (operation.current || !retained || !scope || !data.workspace || data.readOnly) return
    const identity = owner
    operation.current = true
    setBusy(true)
    setError('')
    const body = rebase
      ? { ...retained, expectedRevision: data.workspace.revision, requestId: crypto.randomUUID() }
      : retained
    try {
      if (rebase) {
        await journalDrafts.save(scope, draftKind, body)
        if (current(identity)) setRetained(body)
      }
      if (!current(identity)) return
      await publish(body, identity, scope, draftKind)
    } catch (cause) {
      if (current(identity))
        setError(
          cause instanceof Error
            ? cause.message
            : 'The retained capture could not be saved. Its original draft remains available.'
        )
    } finally {
      operation.current = false
      if (mounted.current) setBusy(false)
    }
  }
  function changeTarget(nextKind: 'trade' | 'run', record = '') {
    setKind(nextKind)
    setChosenRecord(record)
    setRecordQuery('')
    setAnnotations('')
  }

  return (
    <PanelShell id="oa-panel-journal" label="Chart journal" storageKey="oa-journal-panel-width">
      <header className={PANEL_HEADER}>
        <h2 className="text-sm font-semibold">Journal</h2>
      </header>
      <div className="flex-1 space-y-4 overflow-auto p-3 text-sm">
        <p>
          Save the focused chart, its source and your notes to an existing trade or practice run.
        </p>
        {data.loading ? (
          <output>Loading journal records...</output>
        ) : data.error ? (
          <div role="alert">
            <p>{data.error}</p>
            <Button variant="outline" onClick={() => void data.reload()}>
              Reload journal
            </Button>
          </div>
        ) : data.storageMode !== 'backend' || !data.workspace ? (
          <p>
            Preserved browser records need reviewed{' '}
            <Link className="underline" to="/settings/storage">
              durable local storage
            </Link>{' '}
            before images can be attached.
          </p>
        ) : (
          <>
            {data.readOnly && (
              <p role="alert">
                Reconnect the local engine before saving a chart. Saved records are read-only.
              </p>
            )}
            {props.profileId ? (
              <p>
                Environment:{' '}
                {profile?.name ?? 'This environment is unavailable. Return to Workspace.'}
              </p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="chart-journal-profile">Destination environment</Label>
                <select
                  id="chart-journal-profile"
                  className={selectClass}
                  value={chosenProfile}
                  disabled={busy}
                  onChange={(event) => {
                    setChosenProfile(event.target.value)
                    setChosenBook('')
                    changeTarget('trade')
                  }}
                >
                  <option value="">Choose an environment</option>
                  {data.portfolios
                    .filter((item) => !item.archivedAt)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {profile && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="chart-journal-kind">Save chart to</Label>
                  <select
                    id="chart-journal-kind"
                    className={selectClass}
                    value={kind}
                    disabled={busy}
                    onChange={(event) => changeTarget(event.target.value as 'trade' | 'run')}
                  >
                    <option value="trade">Journal trade</option>
                    <option value="run">Practice run</option>
                  </select>
                </div>
                {kind === 'trade' && (
                  <div className="space-y-1">
                    <Label htmlFor="chart-journal-book">Journal book</Label>
                    <select
                      id="chart-journal-book"
                      className={selectClass}
                      value={bookId}
                      disabled={busy || !!props.bookId}
                      onChange={(event) => {
                        setChosenBook(event.target.value)
                        setChosenRecord('')
                      }}
                    >
                      <option value="">Choose a book</option>
                      {books.map((book) => (
                        <option key={book.id} value={book.id}>
                          {book.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="chart-journal-search">Find a record</Label>
                  <Input
                    id="chart-journal-search"
                    maxLength={160}
                    value={recordQuery}
                    disabled={busy}
                    placeholder="Symbol, date, name or record number"
                    onChange={(event) => {
                      setRecordQuery(event.target.value)
                      setChosenRecord('')
                    }}
                  />
                  <Label htmlFor="chart-journal-record">
                    {kind === 'trade' ? 'Journal entry' : 'Practice run'}
                  </Label>
                  <select
                    id="chart-journal-record"
                    className={selectClass}
                    value={chosenRecord}
                    disabled={busy}
                    onChange={(event) => setChosenRecord(event.target.value)}
                  >
                    <option value="">Choose a record</option>
                    {shownRecords.map((item) => (
                      <option key={item.id} value={item.id}>
                        {'pair' in item
                          ? `${item.pair} · ${item.openDate} · ${item.direction}`
                          : `${item.name} · ${item.symbol}`}
                      </option>
                    ))}
                  </select>
                  {matches.length > 100 && (
                    <p>Showing 100 matching records. Refine the search to find an older entry.</p>
                  )}
                </div>
                {records.length === 0 && (
                  <p>
                    No eligible records in this selection
                    {props.instrument ? ` for ${props.instrument.symbol}` : ''}.{' '}
                    <Link
                      className="underline"
                      to={`/workspace/profiles/${profile.id}/${kind === 'trade' ? 'journal' : 'replay'}`}
                    >
                      Open {kind === 'trade' ? 'the journal' : 'practice runs'}
                    </Link>{' '}
                    to create one.
                  </p>
                )}
              </>
            )}
            {selected && profile && (
              <>
                <ChartEvidenceList
                  record={selected}
                  originId={data.workspace.originId}
                  reopenContext={{
                    profileId: profile.id!,
                    runId:
                      kind === 'run'
                        ? selected.id
                        : 'sessionId' in selected
                          ? selected.sessionId
                          : undefined,
                    tradeId: kind === 'trade' ? selected.id : undefined,
                    bookId: kind === 'trade' ? bookId : undefined,
                    journalReturn: query.get('journalReturn') ?? undefined,
                    returnTo: query.get('returnTo') ?? undefined,
                  }}
                />
                <div className="space-y-1">
                  <Label htmlFor="chart-journal-notes">Chart notes</Label>
                  <Textarea
                    id="chart-journal-notes"
                    maxLength={5000}
                    value={annotations}
                    disabled={busy || !!retained}
                    onChange={(event) => setAnnotations(event.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={
                    busy ||
                    !!retained ||
                    !draftReady ||
                    data.readOnly ||
                    evidenceFull ||
                    props.captureAvailable === false
                  }
                  onClick={() => void captureAndSave()}
                >
                  {busy ? 'Saving chart...' : 'Attach focused chart'}
                </Button>
                {props.captureAvailable === false && (
                  <output className="block">
                    Wait for every chart pane to apply the committed paper cutoff before attaching a
                    chart.
                  </output>
                )}
                {evidenceFull && (
                  <p>
                    This record already has 20 saved chart captures. Its existing evidence is
                    retained.
                  </p>
                )}
                <Link
                  className="block underline"
                  to={`/workspace/profiles/${profile.id}/${kind === 'trade' ? `journal?${new URLSearchParams({ book: bookId, trade: String(selected.id), tab: 'Trades' })}` : 'replay'}`}
                >
                  Open selected {kind === 'trade' ? 'journal entry' : 'practice run'}
                </Link>
              </>
            )}
          </>
        )}
        {retained && (
          <section className="space-y-2 rounded border p-2" aria-label="Retained chart capture">
            <p>The captured image and request are retained for this record.</p>
            <p>
              {retained.capture.instrument.symbol} · {retained.capture.view.interval} ·{' '}
              {retained.capture.capturedAt}
            </p>
            {retained.annotations && <p className="whitespace-pre-wrap">{retained.annotations}</p>}
            <Button variant="outline" disabled={busy || data.readOnly} onClick={() => void retry()}>
              Retry retained capture
            </Button>
            {conflict && (
              <div className="space-y-2">
                <Button variant="outline" disabled={busy} onClick={() => void data.reload()}>
                  Reload target for review
                </Button>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(event) => setReviewed(event.target.checked)}
                  />
                  I reviewed the latest record and want to attach this retained capture.
                </label>
                <Button
                  variant="outline"
                  disabled={
                    busy || !reviewed || data.workspace?.revision === retained.expectedRevision
                  }
                  onClick={() => void retry(true)}
                >
                  Save retained capture after review
                </Button>
              </div>
            )}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(retained, null, 2)], { type: 'application/json' })
                )
                try {
                  const link = document.createElement('a')
                  link.href = url
                  link.download = 'chartly-retained-chart-capture.json'
                  link.click()
                } finally {
                  URL.revokeObjectURL(url)
                }
              }}
            >
              Export retained capture
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (scope)
                  void journalDrafts
                    .delete(scope, draftKind)
                    .then(() => {
                      setRetained(null)
                      setConflict(false)
                      setError('')
                    })
                    .catch(() =>
                      setError('The local draft could not be discarded. It is retained.')
                    )
              }}
            >
              Discard local capture draft
            </Button>
          </section>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {!draftReady && error && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setDraftAttempt((value) => value + 1)}
          >
            Check retained captures again
          </Button>
        )}
        {message && <output>{message}</output>}
      </div>
    </PanelShell>
  )
}

export default JournalPanel
