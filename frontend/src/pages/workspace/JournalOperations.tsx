import { CalendarCheck, Download, Upload } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { browserOrigin } from '@/lib/trader/browserSnapshot'
import { type JournalTrade, type TraderPortfolio, traderDb } from '@/lib/trader/db'
import { scopeJournalTrades, weekStart, zonedJournalDay } from '@/lib/trader/journalAnalytics'
import { type JournalState, journalClient, type StatementPreview } from '@/lib/trader/journalClient'
import { type JournalDraftScope, journalDrafts } from '@/lib/trader/journalDrafts'
import type { useTraderData } from '@/lib/trader/useTraderData'
import { downloadJournalFile } from './journalForm'
import { useJournalDraft } from './useJournalDraft'

type Data = ReturnType<typeof useTraderData>
const FIELD = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
const FIELDS = [
  'eventId',
  'eventType',
  'positionId',
  'occurredAt',
  'openedAt',
  'closedAt',
  'symbol',
  'side',
  'quantity',
  'price',
  'entryPrice',
  'exitPrice',
  'grossPnl',
  'netPnl',
  'commission',
  'swap',
  'fees',
  'amount',
  'currency',
  'quantityUnit',
  'riskAmount',
  'orderId',
  'decisionId',
  'strategy',
  'notes',
  'sequence',
]
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const text = (value: unknown) => (value === undefined || value === null ? '' : String(value))
function StatementTotals({ totals, title }: { totals: unknown; title: string }) {
  const currencies = Object.entries(object(object(totals).byCurrency))
  const fields = [
    ['netPnl', 'Net P&L'],
    ['grossPnl', 'Gross P&L'],
    ['commission', 'Commission'],
    ['swap', 'Signed swap'],
    ['fees', 'Other fees'],
    ['deposits', 'Deposits'],
    ['withdrawals', 'Withdrawals'],
    ['unallocatedFees', 'Unallocated fees'],
  ] as const
  const amount = (value: unknown) =>
    typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
      ? String(value)
      : 'Unknown'
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">
        Includes the provider’s previously saved history and these reviewed changes in this
        destination book. Currencies remain separate; missing components stay Unknown.
      </p>
      {currencies.length ? (
        <div className="overflow-x-auto border">
          <table className="w-full min-w-[780px] text-left text-sm" aria-label={title}>
            <thead className="bg-muted/30">
              <tr>
                <th className="p-2">Currency</th>
                {fields.map(([field, label]) => (
                  <th className="p-2 text-right" key={field}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currencies.map(([currency, values]) => (
                <tr className="border-t" key={currency}>
                  <th className="p-2 font-medium">{currency}</th>
                  {fields.map(([field]) => (
                    <td className="p-2 text-right tabular-nums" key={field}>
                      {amount(object(values)[field])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No currency totals are available.</p>
      )}
    </section>
  )
}
function ImportReceipt({ receipt }: { receipt: Record<string, unknown> }) {
  const counts = object(receipt.counts)
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
  const changed = count(receipt.changedEvents)
  const positions = count(receipt.changedPositions)
  return (
    <section className="space-y-3 rounded border p-4" aria-label="Import result">
      <h3 className="font-semibold">Statement saved</h3>
      <p className="text-sm">
        {changed} source {changed === 1 ? 'event' : 'events'} saved · {positions}{' '}
        {positions === 1 ? 'position' : 'positions'} updated · {count(counts.unchanged)} unchanged ·{' '}
        {count(counts.correction)} {count(counts.correction) === 1 ? 'correction' : 'corrections'}{' '}
        applied.
      </p>
      <StatementTotals totals={receipt.totals} title="Saved source totals by currency" />
      <details className="text-xs">
        <summary className="cursor-pointer">Technical import receipt</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(receipt, null, 2)}
        </pre>
      </details>
    </section>
  )
}
export function csvHeaders(source: string, delimiter = ','): string[] {
  const values: string[] = []
  let value = ''
  let quoted = false
  const input = source.replace(/^\uFEFF/, '')
  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"'
        index++
      } else quoted = !quoted
    } else if (char === delimiter && !quoted) {
      values.push(value)
      value = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      values.push(value)
      return values
    } else value += char
  }
  values.push(value)
  return values
}
interface Props {
  data: Data
  portfolio: TraderPortfolio
  bookId?: string
  timezone: string
  currency: string
  strategy: string
  trades: JournalTrade[]
  filters: Record<string, unknown>
  onBook: (id: string) => void
  onTrade: (id: number) => void
  initialDay?: string
  initialWeek?: string
  resumeImportId?: string
}

function ImportDialog({
  data,
  portfolio,
  bookId,
  timezone,
  currency,
  onClose,
  scope,
  ledger,
  resumeImportId: propsResumeId,
}: Props & { onClose: () => void; scope: JournalDraftScope; ledger: JournalState | null }) {
  const draft = useJournalDraft(scope, 'import', () => ({
    requestId: crypto.randomUUID(),
    csvText: '',
    filename: '',
    provider: 'csv-statement',
    mappingName: 'Normalized statement',
    columns: {} as Record<string, string>,
    timezone,
    currency,
    quantityUnit: 'units',
    delimiter: ',',
    decimalSeparator: '.',
    thousandsSeparator: '',
    costConvention: 'positive',
    missingCostPolicy: 'unknown',
    pnlMultiplier: '1',
    allowMixedCurrencies: false,
    previewId: '',
    expectedRevision: data.workspace?.revision,
  }))
  const form = draft.value
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setPreview(null)
    draft.setValue((previous) => ({ ...previous, [key]: value, previewId: '' }))
  }
  const [preview, setPreview] = useState<StatementPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [acceptCorrections, setAcceptCorrections] = useState(false)
  const [notice, setNotice] = useState('')
  const [committed, setCommitted] = useState(false)
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null)
  const [resumeConsumed, setResumeConsumed] = useState(false)
  const [resuming, setResuming] = useState(false)
  useEffect(() => {
    if (!draft.ready) return
    const id = (!resumeConsumed && propsResumeId) || (draft.ready ? form.previewId : '')
    if (!id || !data.workspace || preview?.id === id || committed) return
    let live = true
    setResuming(true)
    void journalClient
      .importPreview(id, data.workspace.originId)
      .then(async (result) => {
        if (!live) return
        setResuming(false)
        setResumeConsumed(true)
        const context = object(result.preview.context)
        if (
          (result.originId && result.originId !== data.workspace?.originId) ||
          (context.bookId && context.bookId !== bookId) ||
          (context.portfolioId && Number(context.portfolioId) !== portfolio.id)
        )
          throw new Error(
            'This saved review targets another source or book. Choose its explicit destination before resuming.'
          )
        if (result.status === 'completed') {
          const savedResult = object(object(object(result).receipt).result)
          if (Object.keys(savedResult).length) setReceipt(savedResult)
          setCommitted(true)
          setPreview(null)
          setNotice(
            'This import already completed. Saved journal data was reloaded; no duplicate commit was sent.'
          )
          await data.reload()
          await draft.clear()
          return
        }
        setPreview(result)
        setAcceptCorrections(false)
        const sourceMapping = object(result.preview.mapping)
        draft.setValue((previous) => ({
          ...previous,
          ...sourceMapping,
          mappingName: text(sourceMapping.name) || previous.mappingName,
          columns: object(sourceMapping.columns) as Record<string, string>,
          provider: text(context.provider) || previous.provider,
          previewId: result.id,
          expectedRevision: result.expectedRevision,
        }))
        setNotice(
          'Saved statement review recovered from the local engine. Inspect its source, totals and corrections before confirming.'
        )
      })
      .catch((cause) => {
        if (live) {
          setResuming(false)
          setError(
            cause instanceof Error
              ? cause.message
              : 'The saved statement review could not be reopened. The source is retained.'
          )
        }
      })
    return () => {
      live = false
    }
  }, [
    draft.ready,
    draft.clear,
    draft.setValue,
    form.previewId,
    data.workspace,
    data.reload,
    propsResumeId,
    resumeConsumed,
    preview?.id,
    committed,
    bookId,
    portfolio.id,
  ])
  const headers = useMemo(
    () => csvHeaders(form.csvText, form.delimiter),
    [form.csvText, form.delimiter]
  )
  const mappings = ledger?.ledger.mappings ?? []
  const selectedBook = (data.books ?? []).find((book) => book.id === bookId)
  const mapping = () => ({
    version: 1,
    name: form.mappingName,
    columns: form.columns,
    timezone: form.timezone,
    currency: form.currency,
    quantityUnit: form.quantityUnit,
    delimiter: form.delimiter,
    decimalSeparator: form.decimalSeparator,
    thousandsSeparator: form.thousandsSeparator,
    costConvention: form.costConvention,
    missingCostPolicy: form.missingCostPolicy,
    pnlMultiplier: form.pnlMultiplier,
    allowMixedCurrencies: form.allowMixedCurrencies,
  })
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The import failed. Your source and draft are retained.'
      )
    } finally {
      setBusy(false)
    }
  }
  async function read(file?: File) {
    if (!file) return
    await run(async () => {
      if (file.size > 4 * 1024 * 1024)
        throw new Error(
          'Choose a CSV up to 4 MiB. Split larger statements by explicit account/range and keep stable event IDs.'
        )
      const csvText = await file.text()
      const currentHeaders = csvHeaders(csvText, form.delimiter)
      const columns: Record<string, string> = {}
      for (const name of FIELDS) {
        const header = currentHeaders.find(
          (value) => value.toLowerCase().replace(/[_ -]/g, '') === name.toLowerCase()
        )
        if (header) columns[name] = header
      }
      draft.setValue((previous) => ({
        ...previous,
        csvText,
        filename: file.name,
        columns,
        previewId: '',
        requestId: crypto.randomUUID(),
      }))
      setPreview(null)
      setNotice('Source loaded locally. Map fields and review before commit.')
    })
  }
  async function prepare(event: FormEvent) {
    event.preventDefault()
    await run(async () => {
      if (!data.workspace || !bookId) throw new Error('Choose a durable destination book first.')
      if (!form.provider.trim() || !form.csvText)
        throw new Error('Choose the CSV and a stable provider/source name.')
      await journalDrafts.save(scope, 'import', form)
      const result = await journalClient.previewImport({
        originId: data.workspace.originId,
        portfolioId: portfolio.id,
        bookId,
        accountId: selectedBook?.accountId,
        provider: form.provider.trim(),
        csvText: form.csvText,
        mapping: mapping(),
        expectedRevision: data.workspace.revision,
      })
      setPreview(result)
      setAcceptCorrections(false)
      draft.setValue((previous) => ({
        ...previous,
        previewId: result.id,
        expectedRevision: result.expectedRevision,
        requestId: crypto.randomUUID(),
      }))
    })
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Import statement CSV</DialogTitle>
          <DialogDescription>
            Destination: {selectedBook?.name ?? 'Choose a saved book'} ·{' '}
            {selectedBook?.kind ?? 'browser'}. One normalized CSV format with explicit mapping; this
            does not claim every broker export is supported. Raw executions and review notes are
            retained.
          </DialogDescription>
        </DialogHeader>
        {(error || draft.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || draft.error}
          </p>
        )}
        {notice && <output className="block text-sm">{notice}</output>}
        {draft.restored && (
          <p className="text-sm">
            An interrupted local mapping/source draft was restored. Preview again to compare it with
            saved executions.
          </p>
        )}
        {data.storageMode !== 'backend' ? (
          <p className="text-sm">
            Imports need{' '}
            <Link className="underline" to="/settings/storage">
              reviewed durable local storage
            </Link>
            . No broker connection is required.
          </p>
        ) : (
          <>
            {!committed && (
              <form className="space-y-4" onSubmit={(event) => void prepare(event)}>
                <fieldset disabled={busy || resuming || !draft.ready} className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="statement-csv">Statement CSV (up to 4 MiB)</Label>
                      <Input
                        id="statement-csv"
                        type="file"
                        accept=".csv,text/csv"
                        disabled={busy}
                        onChange={(event) => void read(event.target.files?.[0])}
                      />
                      {form.filename && (
                        <p className="text-xs text-muted-foreground">{form.filename}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="statement-provider">Stable provider/source name</Label>
                      <Input
                        id="statement-provider"
                        value={form.provider}
                        onChange={(event) => set('provider', event.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Reuse this name for overlapping/corrected statements. Duplicate event IDs
                        are scoped by source and account/book.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="mapping-profile">Saved mapping</Label>
                      <select
                        id="mapping-profile"
                        className={FIELD}
                        defaultValue=""
                        onChange={(event) => {
                          const item = mappings[Number(event.target.value)]
                          if (!item) return
                          const source = object(item.mapping ?? item)
                          draft.setValue((previous) => ({
                            ...previous,
                            ...source,
                            mappingName: text(source.name) || previous.mappingName,
                            columns: object(source.columns) as Record<string, string>,
                            previewId: '',
                          }))
                          setPreview(null)
                        }}
                      >
                        <option value="">Choose a mapping</option>
                        {mappings.map((item, index) => (
                          <option value={index} key={text(item.id) || index}>
                            {text(item.name ?? object(item.mapping).name) || `Mapping ${index + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mapping-name">Mapping name</Label>
                      <Input
                        id="mapping-name"
                        value={form.mappingName}
                        onChange={(event) => set('mappingName', event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mapping-timezone">Source timezone (IANA)</Label>
                      <Input
                        id="mapping-timezone"
                        value={form.timezone}
                        onChange={(event) => set('timezone', event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-2">
                      <Label htmlFor="mapping-currency">Fallback currency</Label>
                      <Input
                        id="mapping-currency"
                        maxLength={12}
                        value={form.currency}
                        onChange={(event) => set('currency', event.target.value.toUpperCase())}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mapping-unit">Quantity unit</Label>
                      <select
                        id="mapping-unit"
                        className={FIELD}
                        value={form.quantityUnit}
                        onChange={(event) => set('quantityUnit', event.target.value)}
                      >
                        {['units', 'lots', 'shares', 'contracts', 'coins'].map((unit) => (
                          <option key={unit}>{unit}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mapping-multiplier">Price P&amp;L multiplier</Label>
                      <Input
                        id="mapping-multiplier"
                        value={form.pnlMultiplier}
                        onChange={(event) => set('pnlMultiplier', event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mapping-delimiter">CSV delimiter</Label>
                      <select
                        id="mapping-delimiter"
                        className={FIELD}
                        value={form.delimiter}
                        onChange={(event) => set('delimiter', event.target.value)}
                      >
                        <option value=",">Comma</option>
                        <option value=";">Semicolon</option>
                        <option value={'\t'}>Tab</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="mapping-decimal">Decimal separator</Label>
                      <select
                        id="mapping-decimal"
                        className={FIELD}
                        value={form.decimalSeparator}
                        onChange={(event) => set('decimalSeparator', event.target.value)}
                      >
                        <option value=".">Point</option>
                        <option value=",">Comma</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mapping-thousands">Thousands separator</Label>
                      <select
                        id="mapping-thousands"
                        className={FIELD}
                        value={form.thousandsSeparator}
                        onChange={(event) => set('thousandsSeparator', event.target.value)}
                      >
                        <option value="">None</option>
                        <option value=",">Comma</option>
                        <option value=".">Point</option>
                        <option value=" ">Space</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mapping-costs">Commission/fee sign convention</Label>
                      <select
                        id="mapping-costs"
                        className={FIELD}
                        value={form.costConvention}
                        onChange={(event) => set('costConvention', event.target.value)}
                      >
                        <option value="positive">Positive expenses</option>
                        <option value="signed">Signed cashflows</option>
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.missingCostPolicy === 'declared-zero'}
                      onChange={(event) =>
                        set('missingCostPolicy', event.target.checked ? 'declared-zero' : 'unknown')
                      }
                    />
                    This statement omits these costs because they are zero
                  </label>
                  <p className="text-xs text-muted-foreground">
                    By default missing costs stay unknown. Price-derived net P&amp;L needs explicit
                    cost values or this declaration; a reported net-only value does not invent gross
                    P&amp;L or costs.
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.allowMixedCurrencies}
                      onChange={(event) => set('allowMixedCurrencies', event.target.checked)}
                    />
                    Allow explicit per-row currencies; report them separately without FX conversion
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Net = gross − commission − fees + signed swap. For entry/exit prices, set the
                    instrument’s actual multiplier. Ambiguous or nonexistent local DST timestamps
                    require an explicit offset; the importer never guesses.
                  </p>
                  {!!form.csvText && (
                    <details open className="rounded border p-3">
                      <summary className="cursor-pointer text-sm font-semibold">
                        Column mapping
                      </summary>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        {FIELDS.map((name) => (
                          <div className="space-y-1" key={name}>
                            <Label htmlFor={`map-${name}`}>
                              {name}
                              {['eventId', 'eventType'].includes(name) ? ' *' : ''}
                            </Label>
                            <select
                              id={`map-${name}`}
                              className={FIELD}
                              value={form.columns[name] ?? ''}
                              onChange={(event) => {
                                const columns = { ...form.columns }
                                if (event.target.value) columns[name] = event.target.value
                                else delete columns[name]
                                set('columns', columns)
                                setPreview(null)
                              }}
                            >
                              <option value="">Not mapped</option>
                              {headers.map((header, index) => (
                                <option key={`${header}:${index}`}>{header}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={busy || !draft.ready || data.readOnly}>
                      Preview rows and totals
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          if (!form.mappingName.trim()) throw new Error('Name this mapping first.')
                          await data.performJournalAction(
                            'save-mapping',
                            { mapping: mapping() },
                            { bookId }
                          )
                          setNotice(
                            'Mapping saved. Preview the current source against the latest revision before importing.'
                          )
                          setPreview(null)
                        })
                      }
                    >
                      Save reusable mapping
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => downloadJournalFile(form, 'chartly-statement-draft.json')}
                    >
                      Export local import draft
                    </Button>
                  </div>
                </fieldset>
              </form>
            )}
            {preview && (
              <section className="space-y-3 rounded border p-4" aria-label="Statement preview">
                <h3 className="font-semibold">Reviewed source rows</h3>
                <p className="text-sm">
                  Review the changes and totals below, then confirm to save them to{' '}
                  {selectedBook?.name ?? 'this book'}.
                </p>
                {preview.expectedRevision !== data.workspace?.revision && (
                  <p role="alert" className="text-sm text-destructive">
                    The saved journal changed after this preview. Generate a new comparison; an old
                    pending commit is never silently rebased.
                  </p>
                )}
                <Button
                  variant="outline"
                  disabled={busy || !data.workspace}
                  onClick={() =>
                    void run(async () => {
                      const result = await journalClient.repreviewImport(
                        preview.id,
                        data.workspace!.revision
                      )
                      setPreview(result)
                      setAcceptCorrections(false)
                      setResumeConsumed(true)
                      draft.setValue((previous) => ({
                        ...previous,
                        previewId: result.id,
                        expectedRevision: result.expectedRevision,
                        requestId: crypto.randomUUID(),
                      }))
                      setNotice(
                        'Retained source compared again. Review the new rows and corrections before committing.'
                      )
                    })
                  }
                >
                  Preview again using retained source
                </Button>
                <p className="text-sm">
                  {Object.entries({
                    insert: 'New events',
                    unchanged: 'Unchanged',
                    correction: 'Corrections',
                    conflict: 'Conflicts',
                    error: 'Errors',
                  })
                    .map(([name, label]) => `${label}: ${preview.preview.counts[name] ?? 0}`)
                    .join(' · ')}
                </p>
                <StatementTotals
                  totals={preview.preview.totals}
                  title="Projected source totals by currency"
                />
                <details className="text-xs">
                  <summary className="cursor-pointer">Source verification details</summary>
                  <p className="mt-2 break-all">
                    Source SHA-256: {text(preview.preview.sourceHash) || 'Unavailable'}
                  </p>
                  <p className="mt-1">
                    Review revision {preview.expectedRevision} · saved revision{' '}
                    {data.workspace?.revision}
                  </p>
                </details>
                <div className="max-h-80 overflow-auto border">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead>
                      <tr>
                        <th className="p-2">Row</th>
                        <th className="p-2">Action</th>
                        <th className="p-2">Event / position</th>
                        <th className="p-2">Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.rows.slice(0, 1000).map((row, index) => (
                        <tr key={index} className="border-t">
                          <td className="p-2">{text(row.rowNumber)}</td>
                          <td className="p-2">{text(row.action)}</td>
                          <td className="p-2">
                            {text(object(row.event).eventId)} · {text(object(row.event).positionId)}{' '}
                            · {text(object(row.event).type)}
                          </td>
                          <td className="p-2">
                            {Array.isArray(row.errors)
                              ? row.errors
                                  .map((error) => text(object(error).message ?? object(error).code))
                                  .join('; ')
                              : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.preview.rows.length > 1000 && (
                  <p className="text-xs">
                    First 1,000 rows shown. Export the full preview to inspect every row; all rows
                    must validate before commit.
                  </p>
                )}
                <Button
                  variant="outline"
                  onClick={() => downloadJournalFile(preview, 'chartly-statement-preview.json')}
                >
                  Export full preview
                </Button>
                {(preview.preview.requiresCorrectionConfirmation ||
                  preview.preview.counts.correction > 0) && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={acceptCorrections}
                      disabled={busy}
                      onChange={(event) => {
                        setAcceptCorrections(event.target.checked)
                        draft.setValue((previous) => ({
                          ...previous,
                          requestId: crypto.randomUUID(),
                        }))
                      }}
                    />
                    Accept these source corrections. Earlier raw observations and my reviews remain
                    in history; changed facts return to unreviewed.
                  </label>
                )}
                <div>
                  <Button
                    disabled={
                      busy ||
                      resuming ||
                      preview.expectedRevision !== data.workspace?.revision ||
                      !preview.preview.canCommit ||
                      !!preview.preview.counts.conflict ||
                      !!preview.preview.counts.error ||
                      ((!!preview.preview.requiresCorrectionConfirmation ||
                        preview.preview.counts.correction > 0) &&
                        !acceptCorrections)
                    }
                    onClick={() =>
                      void run(async () => {
                        const commitBody = {
                          expectedRevision: preview.expectedRevision,
                          requestId: form.requestId,
                          acceptCorrections,
                        }
                        const pendingKind = `request:import:${form.requestId}`
                        await journalDrafts.save(scope, pendingKind, {
                          jobId: preview.id,
                          ...commitBody,
                        })
                        const result = await journalClient.commitImport(preview.id, commitBody)
                        await data.acceptJournalResponse(result)
                        await journalDrafts.delete(scope, pendingKind)
                        await draft.clear()
                        setReceipt(result.result ?? null)
                        setNotice(
                          `The statement has been saved to ${selectedBook?.name ?? 'this book'}.`
                        )
                        setPreview(null)
                        setCommitted(true)
                      })
                    }
                  >
                    Commit reviewed import
                  </Button>
                </div>
              </section>
            )}
            {committed && (
              <>
                {receipt && <ImportReceipt receipt={receipt} />}
                <Button onClick={onClose}>Return to the journal</Button>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PeriodReviewDialog({
  data,
  portfolio,
  bookId,
  timezone,
  currency,
  strategy,
  trades,
  filters,
  initialDay,
  initialWeek,
  onClose,
  scope,
  ledger,
  onTrade,
}: Props & { onClose: () => void; scope: JournalDraftScope; ledger: JournalState | null }) {
  const initialDate =
    initialWeek ||
    initialDay ||
    zonedJournalDay(Date.now(), timezone) ||
    new Date().toISOString().slice(0, 10)
  const draft = useJournalDraft(
    scope,
    `period:${initialWeek ? 'week' : 'day'}:${initialDate}:${currency}:${strategy}`,
    () => ({
      requestId: crypto.randomUUID(),
      expectedRevision: data.workspace?.revision,
      period: initialWeek ? 'week' : 'day',
      startDate: initialDate,
      notes: '',
      goals: '',
    })
  )
  const form = draft.value
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const startDate = form.period === 'week' ? weekStart(form.startDate) : form.startDate
  const included = useMemo(
    () =>
      startDate
        ? scopeJournalTrades(trades, {
            timezone,
            currency,
            day: form.period === 'day' ? startDate : undefined,
            week: form.period === 'week' ? startDate : undefined,
          }).trades
        : [],
    [trades, timezone, currency, startDate, form.period]
  )
  const prior = ledger?.ledger.periodReviews
    .filter(
      (row) =>
        row.bookId === bookId &&
        row.period === form.period &&
        row.startDate === startDate &&
        row.timezone === timezone &&
        (!row.currency || row.currency === currency) &&
        (!row.strategy || row.strategy === strategy)
    )
    .at(-1)
  const previousNotes = text(prior?.notes)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Daily / weekly review</DialogTitle>
          <DialogDescription>
            Book, {currency}, {timezone}, strategy {strategy}. Included entries use the currently
            displayed filters. Notes are not an automated psychological assessment.
          </DialogDescription>
        </DialogHeader>
        {(error || draft.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || draft.error}
          </p>
        )}
        {draft.restored && (
          <p className="text-sm">Your unsaved period review draft was recovered.</p>
        )}
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            setBusy(true)
            setError('')
            void (async () => {
              if (data.storageMode !== 'backend' || !bookId)
                throw new Error(
                  'Migrate to durable local storage to commit period reviews. Your draft can be exported now.'
                )
              await journalDrafts.save(
                scope,
                `period:${initialWeek ? 'week' : 'day'}:${initialDate}:${currency}:${strategy}`,
                form
              )
              await data.performJournalAction(
                'review-period',
                {
                  portfolioId: portfolio.id,
                  bookId,
                  period: form.period,
                  startDate,
                  timezone,
                  currency,
                  strategy,
                  filters,
                  notes: form.notes,
                  goals: form.goals,
                  includedTradeIds: included
                    .map((row) => row.id)
                    .filter((id): id is number => id !== undefined),
                },
                { requestId: form.requestId, expectedRevision: form.expectedRevision, bookId }
              )
              await draft.clear()
              onClose()
            })()
              .catch((cause) =>
                setError(
                  cause instanceof Error ? cause.message : 'Review save failed; draft retained.'
                )
              )
              .finally(() => setBusy(false))
          }}
        >
          <fieldset disabled={busy || !draft.ready} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="period-review-kind">Review period</Label>
                <select
                  id="period-review-kind"
                  className={FIELD}
                  value={form.period}
                  onChange={(event) =>
                    draft.setValue((previous) => ({
                      ...previous,
                      period: event.target.value,
                      requestId: crypto.randomUUID(),
                    }))
                  }
                >
                  <option value="day">Day</option>
                  <option value="week">Week starting Monday</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="period-review-start">
                  {form.period === 'week' ? 'Date in the review week' : 'Review date'}
                </Label>
                <Input
                  id="period-review-start"
                  type="date"
                  value={form.startDate}
                  onChange={(event) =>
                    draft.setValue((previous) => ({
                      ...previous,
                      startDate: event.target.value,
                      requestId: crypto.randomUUID(),
                    }))
                  }
                />
              </div>
            </div>
            {previousNotes && (
              <div className="rounded border p-3 text-sm">
                <strong>Saved review</strong>
                <p className="mt-1 whitespace-pre-wrap">{previousNotes}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    draft.setValue((previous) => ({
                      ...previous,
                      notes: previousNotes,
                      goals: text(prior?.goals),
                      requestId: crypto.randomUUID(),
                    }))
                  }
                >
                  Use saved notes as a starting point
                </Button>
              </div>
            )}
            <p className="text-sm">
              {included.length} included position / account entries · starting {startDate}.
              Deposits, withdrawals and fee entries keep their type; they do not become winning
              trades.
            </p>
            <ul className="max-h-48 overflow-auto rounded border p-3 text-sm">
              {included.map((row) => (
                <li key={row.id}>
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => {
                      onClose()
                      onTrade(row.id!)
                    }}
                  >
                    {row.pair || row.eventType} · {row.closeDate || row.openDate} · #{row.id}
                  </Button>
                </li>
              ))}
              {!included.length && <li>No entries match this day/week and active filters.</li>}
            </ul>
            <div className="space-y-2">
              <Label htmlFor="period-review-notes">Review notes</Label>
              <Textarea
                id="period-review-notes"
                rows={5}
                value={form.notes}
                onChange={(event) =>
                  draft.setValue((previous) => ({
                    ...previous,
                    notes: event.target.value,
                    requestId: crypto.randomUUID(),
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="period-review-goals">Next-session goals (optional)</Label>
              <Textarea
                id="period-review-goals"
                rows={3}
                value={form.goals}
                onChange={(event) =>
                  draft.setValue((previous) => ({
                    ...previous,
                    goals: event.target.value,
                    requestId: crypto.randomUUID(),
                  }))
                }
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={
                  busy ||
                  !draft.ready ||
                  data.readOnly ||
                  data.storageMode !== 'backend' ||
                  !startDate
                }
              >
                {busy ? 'Saving…' : 'Save period review'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  downloadJournalFile(
                    {
                      ...form,
                      timezone,
                      currency,
                      strategy,
                      includedTradeIds: included.map((row) => row.id),
                    },
                    'chartly-period-review-draft.json'
                  )
                }
              >
                Export review draft
              </Button>
            </div>
            {data.storageMode !== 'backend' && (
              <p className="text-sm">
                <Link className="underline" to="/settings/storage">
                  Set up durable local storage
                </Link>{' '}
                to save review versions and restore them with the journal.
              </p>
            )}
          </fieldset>
        </form>
        {prior && (
          <details className="rounded border p-3 text-sm">
            <summary>Saved review history</summary>
            {ledger?.ledger.history
              .filter((row) => row.periodReviewId === prior.id)
              .map((row, index) => (
                <pre
                  className="mt-2 whitespace-pre-wrap break-all text-xs"
                  key={text(row.id) || index}
                >
                  {JSON.stringify(row, null, 2)}
                </pre>
              ))}
          </details>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function JournalOperations(props: Props) {
  const { data, portfolio, bookId, onBook } = props
  const [storedLedger, setLedger] = useState<JournalState | null>(null)
  const [ledgerOwner, setLedgerOwner] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [open, setOpen] = useState<'import' | 'review' | null>(null)
  const [resumeImportId, setResumeImportId] = useState<string | undefined>()
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const currentScope = data.journalScope?.(bookId) ?? {
    principalId: 'preserved-browser-source',
    originId: browserOrigin(),
    bookId: bookId ?? `manual:${portfolio.id}`,
  }
  const { principalId, originId, bookId: scopedBookId } = currentScope
  const scope = useMemo(
    () => ({ principalId, originId, bookId: scopedBookId }),
    [principalId, originId, scopedBookId]
  )
  const ledgerScope = JSON.stringify([scope.principalId, scope.originId])
  const ledger =
    ledgerOwner === ledgerScope && storedLedger?.originId === data.workspace?.originId
      ? storedLedger
      : null
  useEffect(() => {
    let live = true
    if (data.storageMode === 'backend' && data.workspace)
      void journalClient
        .state(data.workspace.originId)
        .then((result) => {
          if (live) {
            setLedger(result)
            setLedgerOwner(ledgerScope)
          }
        })
        .catch((cause) => {
          if (live)
            setError(
              cause instanceof Error ? cause.message : 'Journal history could not be loaded.'
            )
        })
    else setLedger(null)
    return () => {
      live = false
    }
  }, [data.storageMode, data.workspace, ledgerScope])
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The journal action failed. Saved records and local drafts are retained.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-3" aria-label="Journal workflows">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setResumeImportId(undefined)
            setOpen('import')
          }}
        >
          <Upload className="size-3.5 text-muted-foreground" aria-hidden />
          Import CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen('review')}>
          <CalendarCheck className="size-3.5 text-muted-foreground" aria-hidden />
          Daily / weekly review
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (data.storageMode === 'backend') {
                if (!data.workspace || !bookId)
                  throw new Error('Choose a saved book before exporting its records.')
                const blob = await journalClient.export(
                  data.workspace.originId,
                  portfolio.id!,
                  bookId,
                  'json'
                )
                downloadJournalFile(blob, `chartly-book-${bookId}.json`)
              } else
                downloadJournalFile(
                  {
                    format: 'chartly-browser-profile-journal',
                    version: 1,
                    originId: browserOrigin(),
                    profile: portfolio,
                    journalTrades: await traderDb.journalTrades
                      .where('portfolioId')
                      .equals(portfolio.id!)
                      .toArray(),
                    dailyMoods: await traderDb.dailyMoods
                      .where('portfolioId')
                      .equals(portfolio.id!)
                      .toArray(),
                    practiceSessions: await traderDb.practiceSessions
                      .where('portfolioId')
                      .equals(portfolio.id!)
                      .toArray(),
                  },
                  `chartly-profile-${portfolio.id}-journal.json`
                )
            })
          }
        >
          <Download className="size-3.5 text-muted-foreground" aria-hidden />
          Export full book JSON
        </Button>
        {data.workspace && bookId && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () =>
                downloadJournalFile(
                  await journalClient.export(
                    data.workspace!.originId,
                    portfolio.id!,
                    bookId,
                    'csv'
                  ),
                  `chartly-book-${bookId}.csv`
                )
              )
            }
          >
            <Download className="size-3.5 text-muted-foreground" aria-hidden />
            Export full book CSV
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              downloadJournalFile(
                {
                  format: 'chartly-journal-local-drafts',
                  version: 1,
                  scope,
                  drafts: await journalDrafts.list(scope),
                },
                `chartly-book-drafts-${portfolio.id}.json`
              )
              setNotice(
                'Local unsent drafts exported. They are not included in a server workspace backup until submitted.'
              )
            })
          }
        >
          Export unsent drafts
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && <output className="block text-sm">{notice}</output>}
      {data.storageMode === 'backend' && !!data.brokerAccounts.length && (
        <details className="rounded-lg border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Open an account book for statement imports
          </summary>
          <p className="mt-2 text-muted-foreground">
            Each account keeps its own book. This declares ownership; it does not verify or connect
            a broker.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Label className="sr-only" htmlFor="journal-import-account">
              Destination account
            </Label>
            <select
              id="journal-import-account"
              className={`${FIELD} max-w-sm`}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              <option value="">Choose this account explicitly</option>
              {data.brokerAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.displayName} · {account.currency} · {account.platform}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={!accountId || busy}
              onClick={() =>
                void run(async () => {
                  const result = await data.performJournalAction(
                    'create-book',
                    { portfolioId: portfolio.id, accountId: Number(accountId) },
                    { bookId }
                  )
                  const id = text(result.result?.bookId)
                  if (!id)
                    throw new Error('The account book was not returned. Reload saved records.')
                  onBook(id)
                })
              }
            >
              Open account book
            </Button>
          </div>
        </details>
      )}
      {ledger && !!ledger.ledger.periodReviews.filter((row) => row.bookId === bookId).length && (
        <details className="rounded-lg border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-medium">Saved daily / weekly reviews</summary>
          {ledger.ledger.periodReviews
            .filter((row) => row.bookId === bookId)
            .slice(-20)
            .reverse()
            .map((row, index) => (
              <article className="mt-3 border-t pt-3" key={text(row.id) || index}>
                <h3 className="font-medium">
                  {text(row.period)} · {text(row.startDate)} · {text(row.timezone)} ·{' '}
                  {text(row.currency)} · {text(row.strategy)}
                </h3>
                <p className="mt-1 whitespace-pre-wrap">{text(row.notes)}</p>
                <p className="mt-1 text-muted-foreground">
                  Goals: {text(row.goals) || 'not recorded'}
                </p>
                <p className="text-xs">
                  {Array.isArray(row.includedTradeIds) ? row.includedTradeIds.length : 0} included
                  entries · revision {text(row.revision)}
                </p>
                {Array.isArray(row.includedTradeIds) && (
                  <div className="flex flex-wrap gap-1">
                    {row.includedTradeIds.slice(0, 100).map((id) => (
                      <Button
                        key={text(id)}
                        variant="link"
                        size="sm"
                        onClick={() => props.onTrade(Number(id))}
                      >
                        Entry #{text(id)}
                      </Button>
                    ))}
                  </div>
                )}
              </article>
            ))}
        </details>
      )}
      {!!ledger?.imports?.some(
        (job) => job.status === 'preview' && (!job.bookId || job.bookId === bookId)
      ) && (
        <details className="rounded border p-3 text-sm">
          <summary className="cursor-pointer">Pending statement reviews for this book</summary>
          {ledger.imports
            .filter(
              (job) =>
                job.status === 'preview' &&
                (!job.bookId || job.bookId === bookId) &&
                (!job.portfolioId || job.portfolioId === portfolio.id)
            )
            .map((job) => (
              <div
                className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3"
                key={job.id}
              >
                <span>
                  {job.provider ?? 'Statement'} · {job.createdAt} · review revision{' '}
                  {job.expectedRevision}
                </span>
                <Button
                  variant="outline"
                  onClick={() => {
                    setResumeImportId(job.id)
                    setOpen('import')
                  }}
                >
                  Resume statement review
                </Button>
              </div>
            ))}
        </details>
      )}
      {open === 'import' && (
        <ImportDialog
          key={`${scope.principalId}:${scope.originId}:${scope.bookId}:${resumeImportId ?? 'new'}`}
          {...props}
          scope={scope}
          ledger={ledger}
          resumeImportId={resumeImportId}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'review' && (
        <PeriodReviewDialog
          key={`${scope.principalId}:${scope.originId}:${scope.bookId}:${props.initialDay ?? props.initialWeek ?? 'today'}`}
          {...props}
          scope={scope}
          ledger={ledger}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  )
}
