import { useEffect, useRef, useState } from 'react'
import {
  type DatasetCatalog,
  type DatasetContext,
  type DatasetMapping,
  type DatasetPolicy,
  type DatasetPreview,
  type DatasetVersion,
  dataLibrary,
} from '@/api/dataLibrary'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { dataLibraryDrafts } from '@/lib/historify/dataLibraryDrafts'
import { PublicSourceDetails } from './DataLibraryPublicSource'

export const DATASET_INTERVALS = [
  '1s',
  '5s',
  '15s',
  '30s',
  '1m',
  '2m',
  '3m',
  '5m',
  '10m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  'D',
]
const field = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
const columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'openInterest']
export const emptyDatasetContext = (): DatasetContext => ({
  name: '',
  provider: 'csv-import',
  symbol: '',
  exchange: 'LOCAL',
  interval: '1m',
  currency: 'USD',
  priceBasis: 'raw',
  adjustment: 'none',
  volumeMeaning: 'unknown',
  allowNegativePrices: false,
  calendar: { id: 'unknown', timezone: 'UTC', sessions: [], exceptions: {} },
})
export const emptyDatasetMapping = (): DatasetMapping => ({
  version: 1,
  columns: { timestamp: 'timestamp', open: 'open', high: 'high', low: 'low', close: 'close' },
  timestampFormat: 'iso',
  timezone: 'UTC',
  delimiter: ',',
  decimalSeparator: '.',
  timestampMeaning: 'open',
})
/** Blank optional labels/currency are omitted rather than sent as invalid codes. */
export function datasetRequestContext(context: DatasetContext): DatasetContext {
  const result = { ...context }
  for (const key of ['name', 'currency'] as const) if (!result[key]?.trim()) delete result[key]
  return result
}
interface ImportForm {
  csvText: string
  mapping: DatasetMapping
  context: DatasetContext
  baseVersionId: string
  previewId?: string
  policy: DatasetPolicy
  allowRejectedRows: boolean
  pending?: {
    expectedRevision: number
    requestId: string
    policy: DatasetPolicy
    allowRejectedRows: boolean
  }
}
const newForm = (): ImportForm => ({
  csvText: '',
  mapping: emptyDatasetMapping(),
  context: emptyDatasetContext(),
  baseVersionId: '',
  policy: 'new-version',
  allowRejectedRows: false,
})
export function csvHeaders(text: string, delimiter: string): string[] {
  const source = text.replace(/^\uFEFF/, '')
  const headers: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"'
        index++
      } else quoted = !quoted
    } else if (!quoted && (character === delimiter || character === '\r' || character === '\n')) {
      headers.push(value.trim())
      value = ''
      if (character !== delimiter || headers.length >= 32) return headers.filter(Boolean)
    } else value += character
  }
  if (headers.length < 32) headers.push(value.trim())
  return headers.filter(Boolean)
}
function human(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')
}
export function DataQuality({ preview }: { preview: DatasetPreview['preview'] }) {
  return (
    <section className="space-y-3" aria-label="Import quality report">
      <p className="text-sm">
        {String(preview.quality?.summary ?? 'Review the reported rows before committing.')}
      </p>
      {Array.isArray(preview.quality?.warnings) && !!preview.quality.warnings.length && (
        <ul className="list-inside list-disc space-y-1 text-sm">
          {preview.quality.warnings.map((item, index) => (
            <li key={index}>
              {String((item as { message?: string }).message ?? 'Review this quality warning.')}
            </li>
          ))}
        </ul>
      )}
      {Array.isArray(preview.quality?.rowErrors) && !!preview.quality.rowErrors.length && (
        <section className="space-y-2 rounded border p-3">
          <h4 className="text-sm font-semibold">Rejected-row reasons across the full source</h4>
          <ul className="list-inside list-disc space-y-1 text-sm">
            {preview.quality.rowErrors.map((item, index) => {
              const issue = item as { message?: string; count?: number; firstRowNumbers?: number[] }
              return (
                <li key={index}>
                  {issue.message ?? 'Rejected source values'} · {issue.count ?? 0} rows
                  {issue.firstRowNumbers?.length
                    ? ` · first rows ${issue.firstRowNumbers.join(', ')}`
                    : ''}
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {Object.entries(preview.counts ?? {}).map(([key, value]) => (
          <div className="rounded border p-2" key={key}>
            <dt className="capitalize text-muted-foreground">{human(key)}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Quality describes these structural checks. A gap is classified using your declared calendar;
        unknown sessions remain unknown. No candles are filled or adjusted automatically.
      </p>
      <details>
        <summary className="cursor-pointer text-sm">Coverage and declared calendar</summary>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(preview.coverage, null, 2)}
        </pre>
      </details>
      {!!preview.rows?.length && (
        <div className="max-h-72 overflow-auto rounded border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b">
                <th className="p-2">Row</th>
                <th className="p-2">Result</th>
                <th className="p-2">Explanation</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, index) => (
                <tr className="border-b" key={String(row.rowNumber ?? index)}>
                  <td className="p-2">{String(row.rowNumber ?? index + 1)}</td>
                  <td className="p-2">{String(row.action ?? '')}</td>
                  <td className="p-2">
                    {[
                      ...(Array.isArray(row.errors) ? row.errors : []),
                      ...(Array.isArray(row.warnings) ? row.warnings : []),
                    ]
                      .map((item) =>
                        String(
                          (item as { message?: string; code?: string }).message ??
                            (item as { code?: string }).code ??
                            item
                        )
                      )
                      .join(' · ') || 'No row issue reported'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!preview.rowsTruncated && (
        <p className="text-xs text-muted-foreground">
          Showing a bounded sample of row details. Counts cover every source row.
        </p>
      )}
    </section>
  )
}
export function DataLibraryImport({
  principalId,
  catalog,
  resumeId,
  onCatalog,
  onVersion,
  onNewImport,
}: {
  principalId: string
  catalog: DatasetCatalog
  resumeId?: string
  onCatalog: (catalog: DatasetCatalog) => void
  onVersion: (version: DatasetVersion) => void
  onNewImport?: () => void
}) {
  const [form, setForm] = useState<ImportForm>(newForm)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<DatasetPreview | null>(null)
  const [saved, setSaved] = useState<DatasetVersion | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setReady(false)
    setForm(newForm())
    setPreview(null)
    setSaved(null)
    setError('')
    void (async () => {
      const suppliedJob = resumeId ? await dataLibrary.importJob(resumeId, principalId) : null
      if (current !== generation.current) return
      // Public source bytes are retained by the server; they must not consume a CSV draft.
      const draft = suppliedJob?.sourceObservation
        ? undefined
        : await dataLibraryDrafts.get<ImportForm>(principalId)
      if (current !== generation.current) return
      if (draft?.value) setForm(draft.value)
      const id = resumeId ?? draft?.value.previewId
      if (id) {
        const job = suppliedJob ?? (await dataLibrary.importJob(id, principalId))
        if (current !== generation.current) return
        setPreview(job)
        setForm((value) => ({
          ...(job.sourceObservation ? newForm() : value),
          ...(job.context && typeof job.context === 'object'
            ? { context: job.context as DatasetContext }
            : {}),
          ...(job.mapping && typeof job.mapping === 'object'
            ? { mapping: job.mapping as DatasetMapping }
            : {}),
          ...(typeof job.baseVersionId === 'string' ? { baseVersionId: job.baseVersionId } : {}),
          previewId: id,
        }))
        setNotice('The retained source review was reopened. Check its revision before committing.')
      }
    })()
      .catch((cause) => {
        if (current === generation.current)
          setError(
            cause instanceof Error
              ? cause.message
              : 'The retained source review could not be opened.'
          )
      })
      .finally(() => {
        if (current === generation.current) setReady(true)
      })
    return () => {
      generation.current++
    }
  }, [principalId, resumeId])
  useEffect(() => {
    if (!ready || saved || preview?.sourceObservation) return
    void dataLibraryDrafts
      .save(principalId, form)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'The local draft could not be retained. Export your input before leaving.'
        )
      )
  }, [principalId, form, ready, saved, preview?.sourceObservation])
  function change(next: Partial<ImportForm>) {
    setForm((value) => ({ ...value, ...next, previewId: undefined, pending: undefined }))
    setPreview(null)
    setError('')
    setNotice('')
  }
  const context = (next: Partial<DatasetContext>) =>
    change({ context: { ...form.context, ...next } })
  const mapping = (next: Partial<DatasetMapping>) =>
    change({ mapping: { ...form.mapping, ...next } })
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The local request failed. Your input is retained.'
      )
    } finally {
      setBusy(false)
    }
  }
  function source(text: string) {
    const headers = csvHeaders(text, form.mapping.delimiter)
    const mapped: Record<string, string> = {}
    for (const column of columns) {
      const candidate =
        headers.find((header) => header.toLowerCase() === column.toLowerCase()) ??
        (column === 'timestamp'
          ? headers.find((header) => ['date', 'datetime', 'time'].includes(header.toLowerCase()))
          : undefined)
      if (candidate) mapped[column] = candidate
    }
    change({ csvText: text, mapping: { ...form.mapping, columns: mapped } })
  }
  async function review() {
    await dataLibraryDrafts.save(principalId, form)
    const result = await dataLibrary.preview(
      {
        expectedRevision: catalog.revision,
        csvText: form.csvText,
        mapping: form.mapping,
        context: datasetRequestContext(form.context),
        ...(form.baseVersionId ? { baseVersionId: form.baseVersionId } : {}),
      },
      principalId
    )
    setPreview(result)
    setForm((value) => ({ ...value, previewId: result.id, pending: undefined }))
    setNotice('Source staged locally. Review quality and conflict policy before publishing.')
  }
  async function commit() {
    if (!preview) return
    const pending = form.pending ?? {
      expectedRevision: preview.expectedRevision,
      requestId: crypto.randomUUID(),
      policy: form.policy,
      allowRejectedRows: form.allowRejectedRows,
    }
    const retained = { ...form, pending, previewId: preview.id }
    setForm(retained)
    if (!preview.sourceObservation) await dataLibraryDrafts.save(principalId, retained)
    const result = await dataLibrary.commit(preview.id, pending, principalId)
    onCatalog(result.catalog)
    setSaved(result.version)
    if (!preview.sourceObservation) await dataLibraryDrafts.delete(principalId)
  }
  const headers = csvHeaders(form.csvText, form.mapping.delimiter)
  const stale = preview && preview.expectedRevision !== catalog.revision
  if (saved)
    return (
      <Card>
        <CardHeader>
          <CardTitle>History saved</CardTitle>
          <CardDescription>
            {saved.name || saved.metadata.symbol} · {saved.rowCount.toLocaleString()} candles ·{' '}
            {saved.metadata.interval}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            This version and checksum are fixed. Older versions and their saved references remain
            unchanged.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onVersion(saved)}>Review saved version</Button>
            {(!preview?.sourceObservation || onNewImport) && (
              <Button
                variant="outline"
                onClick={() => {
                  if (preview?.sourceObservation) {
                    onNewImport?.()
                    return
                  }
                  setSaved(null)
                  setPreview(null)
                  setForm((value) => ({ ...value, previewId: undefined, pending: undefined }))
                }}
              >
                Review another import
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import market history</CardTitle>
        <CardDescription>
          Candles for charts and historical practice. Trade statements belong in the Journal’s
          Import CSV workflow.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <p
            role="alert"
            className="rounded border border-destructive p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {notice && <output className="block text-sm">{notice}</output>}
        {preview?.sourceObservation ? (
          <PublicSourceDetails observation={preview.sourceObservation} />
        ) : (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              void run(review)
            }}
          >
            <fieldset disabled={busy || !ready} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="dataset-source">Paste candle CSV</Label>
                <Textarea
                  id="dataset-source"
                  value={form.csvText}
                  onChange={(event) => source(event.target.value)}
                  className="min-h-32 font-mono text-xs"
                  placeholder="timestamp,open,high,low,close,volume"
                />
                <p className="text-xs text-muted-foreground">
                  Up to 8 MiB UTF-8, 50,000 rows. Paste or select a file; nothing is published until
                  reviewed.
                </p>
                <Input
                  aria-label="Select candle CSV"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    if (file.size > 8 * 1024 * 1024) {
                      setError('Choose a CSV no larger than 8 MiB.')
                      return
                    }
                    void run(async () => source(await file.text()))
                  }}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="dataset-name">Dataset name</Label>
                  <Input
                    id="dataset-name"
                    value={form.context.name ?? ''}
                    onChange={(event) => context({ name: event.target.value })}
                    placeholder="EURUSD minute history"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset-provider">Source / provider</Label>
                  <Input
                    id="dataset-provider"
                    value={form.context.provider}
                    onChange={(event) => context({ provider: event.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset-symbol">Symbol / instrument</Label>
                  <Input
                    id="dataset-symbol"
                    value={form.context.symbol}
                    onChange={(event) => context({ symbol: event.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset-exchange">Exchange / market</Label>
                  <Input
                    id="dataset-exchange"
                    value={form.context.exchange}
                    onChange={(event) => context({ exchange: event.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset-interval">Native candle interval</Label>
                  <select
                    id="dataset-interval"
                    className={field}
                    value={form.context.interval}
                    onChange={(event) => context({ interval: event.target.value })}
                  >
                    {DATASET_INTERVALS.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset-currency">Currency / asset code</Label>
                  <Input
                    id="dataset-currency"
                    value={form.context.currency ?? ''}
                    onChange={(event) => context({ currency: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset-volume">Volume meaning</Label>
                  <select
                    id="dataset-volume"
                    className={field}
                    value={form.context.volumeMeaning}
                    onChange={(event) =>
                      context({
                        volumeMeaning: event.target.value as DatasetContext['volumeMeaning'],
                      })
                    }
                  >
                    {['unknown', 'units', 'contracts', 'ticks', 'currency'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset-basis">Price basis</Label>
                  <select
                    id="dataset-basis"
                    className={field}
                    value={form.context.priceBasis}
                    onChange={(event) =>
                      context({ priceBasis: event.target.value as DatasetContext['priceBasis'] })
                    }
                  >
                    <option value="raw">Raw</option>
                    <option value="split_adjusted">Split adjusted</option>
                    <option value="total_return">Total return</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset-adjustment">Adjustment description</Label>
                  <Input
                    id="dataset-adjustment"
                    value={form.context.adjustment}
                    onChange={(event) => context({ adjustment: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset-time-format">Timestamp format</Label>
                  <select
                    id="dataset-time-format"
                    className={field}
                    value={form.mapping.timestampFormat}
                    onChange={(event) =>
                      mapping({
                        timestampFormat: event.target.value as DatasetMapping['timestampFormat'],
                      })
                    }
                  >
                    <option value="iso">ISO date/time</option>
                    <option value="seconds">Unix seconds</option>
                    <option value="milliseconds">Unix milliseconds</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset-timezone">Source timezone (IANA)</Label>
                  <Input
                    id="dataset-timezone"
                    value={form.mapping.timezone}
                    onChange={(event) => mapping({ timezone: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset-delimiter">CSV delimiter</Label>
                  <select
                    id="dataset-delimiter"
                    className={field}
                    value={form.mapping.delimiter}
                    onChange={(event) => mapping({ delimiter: event.target.value })}
                  >
                    <option value=",">Comma</option>
                    <option value=";">Semicolon</option>
                    <option value={'\t'}>Tab</option>
                    <option value="|">Pipe</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dataset-decimal">Decimal separator</Label>
                  <select
                    id="dataset-decimal"
                    className={field}
                    value={form.mapping.decimalSeparator}
                    onChange={(event) => mapping({ decimalSeparator: event.target.value })}
                  >
                    <option value=".">Point (1.25)</option>
                    <option value=",">Comma (1,25)</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.context.allowNegativePrices}
                  onChange={(event) => context({ allowNegativePrices: event.target.checked })}
                />
                This instrument permits negative prices
              </label>
              <p className="text-xs text-muted-foreground">
                Timestamps describe candle opening times. Naive times use the selected timezone;
                ambiguous/nonexistent DST times require an offset. Unknown volume remains unknown.
                No currency conversion or price adjustment is performed.
              </p>
              <details className="rounded border p-3">
                <summary className="cursor-pointer text-sm">Trading sessions and closures</summary>
                <div className="mt-3 space-y-3">
                  <Label htmlFor="dataset-calendar">Session calendar</Label>
                  <select
                    id="dataset-calendar"
                    className={field}
                    value={form.context.calendar.id}
                    onChange={(event) =>
                      context({
                        calendar: {
                          id: event.target.value,
                          timezone: form.context.calendar.timezone,
                          sessions:
                            event.target.value === 'continuous'
                              ? [{ weekdays: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '24:00' }]
                              : event.target.value === 'custom'
                                ? [{ weekdays: [0, 1, 2, 3, 4], open: '09:30', close: '16:00' }]
                                : [],
                          exceptions: {},
                        },
                      })
                    }
                  >
                    <option value="unknown">Unknown sessions</option>
                    <option value="continuous">Continuous, every day</option>
                    <option value="custom">Declared weekly session</option>
                  </select>
                  <Label htmlFor="dataset-calendar-timezone">Session timezone (IANA)</Label>
                  <Input
                    id="dataset-calendar-timezone"
                    value={form.context.calendar.timezone}
                    onChange={(event) =>
                      context({
                        calendar: { ...form.context.calendar, timezone: event.target.value },
                      })
                    }
                  />
                  {form.context.calendar.id === 'custom' && (
                    <>
                      <div className="flex flex-wrap gap-3">
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => (
                          <label className="flex items-center gap-1 text-sm" key={day}>
                            <input
                              type="checkbox"
                              checked={
                                form.context.calendar.sessions[0]?.weekdays.includes(index) ?? false
                              }
                              onChange={(event) => {
                                const session = form.context.calendar.sessions[0]
                                if (!session) return
                                context({
                                  calendar: {
                                    ...form.context.calendar,
                                    sessions: [
                                      {
                                        ...session,
                                        weekdays: event.target.checked
                                          ? [...session.weekdays, index].sort()
                                          : session.weekdays.filter((value) => value !== index),
                                      },
                                    ],
                                  },
                                })
                              }}
                            />
                            {day}
                          </label>
                        ))}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="dataset-session-open">Session opens</Label>
                          <Input
                            id="dataset-session-open"
                            value={form.context.calendar.sessions[0]?.open ?? ''}
                            onChange={(event) =>
                              context({
                                calendar: {
                                  ...form.context.calendar,
                                  sessions: [
                                    {
                                      ...form.context.calendar.sessions[0],
                                      open: event.target.value,
                                    },
                                  ],
                                },
                              })
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor="dataset-session-close">
                            Session closes (24:00 supported)
                          </Label>
                          <Input
                            id="dataset-session-close"
                            value={form.context.calendar.sessions[0]?.close ?? ''}
                            onChange={(event) =>
                              context({
                                calendar: {
                                  ...form.context.calendar,
                                  sessions: [
                                    {
                                      ...form.context.calendar.sessions[0],
                                      close: event.target.value,
                                    },
                                  ],
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    </>
                  )}
                  <Label htmlFor="dataset-closed-days">
                    Closed anchor dates (one YYYY-MM-DD per line)
                  </Label>
                  <Textarea
                    id="dataset-closed-days"
                    value={Object.keys(form.context.calendar.exceptions).join('\n')}
                    onChange={(event) =>
                      context({
                        calendar: {
                          ...form.context.calendar,
                          exceptions: Object.fromEntries(
                            event.target.value
                              .split(/\r?\n/)
                              .map((value) => value.trim())
                              .filter(Boolean)
                              .map((value) => [value, []])
                          ),
                        },
                      })
                    }
                  />
                </div>
              </details>
              {!!headers.length && (
                <details open className="rounded border p-3">
                  <summary className="cursor-pointer text-sm">Column mapping</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {columns.map((column) => (
                      <div className="space-y-2" key={column}>
                        <Label htmlFor={`dataset-map-${column}`}>
                          {human(column)}
                          {!['volume', 'openInterest'].includes(column) ? ' *' : ''}
                        </Label>
                        <select
                          id={`dataset-map-${column}`}
                          className={field}
                          value={form.mapping.columns[column] ?? ''}
                          onChange={(event) => {
                            const next = { ...form.mapping.columns }
                            if (event.target.value) next[column] = event.target.value
                            else delete next[column]
                            mapping({ columns: next })
                          }}
                        >
                          <option value="">Not mapped</option>
                          {headers.map((header) => (
                            <option key={header}>{header}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <div className="space-y-2">
                <Label htmlFor="dataset-base">
                  Existing version for overlap comparison (optional)
                </Label>
                <select
                  id="dataset-base"
                  className={field}
                  value={form.baseVersionId}
                  onChange={(event) => {
                    const base = catalog.versions.find(
                      (version) => version.id === event.target.value
                    )
                    change({
                      baseVersionId: event.target.value,
                      ...(base ? { context: { ...base.metadata, name: base.name } } : {}),
                    })
                  }}
                >
                  <option value="">New uploaded snapshot</option>
                  {catalog.versions
                    .filter((version) => !version.archivedAt)
                    .map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.name || version.metadata.symbol} · {version.metadata.provider} ·{' '}
                        {version.createdAt}
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!form.csvText.trim()}>
                  {busy ? 'Working…' : 'Preview candles and quality'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const blob = new Blob(
                      [
                        JSON.stringify(
                          { format: 'chartly-dataset-import-draft', version: 1, form },
                          null,
                          2
                        ),
                      ],
                      { type: 'application/json' }
                    )
                    const url = URL.createObjectURL(blob)
                    const link = document.createElement('a')
                    link.href = url
                    link.download = 'chartly-dataset-import-draft.json'
                    link.click()
                    URL.revokeObjectURL(url)
                  }}
                >
                  Export local input draft
                </Button>
              </div>
            </fieldset>
          </form>
        )}
        {preview && (
          <section className="space-y-4 border-t pt-4" aria-label="Reviewed candle import">
            <h3 className="font-semibold">Reviewed candles</h3>
            <DataQuality preview={preview.preview} />
            <p className="text-sm">
              {stale
                ? 'The catalog changed after this preview. Re-preview the retained source before committing.'
                : 'This preview matches the current catalog revision.'}
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await dataLibrary.repreview(
                    preview.id,
                    catalog.revision,
                    principalId
                  )
                  setPreview(result)
                  setForm((value) => ({ ...value, previewId: result.id, pending: undefined }))
                })
              }
            >
              Re-preview retained source
            </Button>
            <div className="space-y-2">
              <Label htmlFor="dataset-policy">Overlapping timestamps</Label>
              <select
                id="dataset-policy"
                className={field}
                disabled={busy}
                value={form.policy}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    policy: event.target.value as DatasetPolicy,
                    pending: undefined,
                  }))
                }
              >
                <option value="new-version">New uploaded snapshot</option>
                <option value="keep" disabled={!form.baseVersionId}>
                  Keep existing candles; add new timestamps
                </option>
                <option value="replace" disabled={!form.baseVersionId}>
                  Use incoming candles; retain old immutable version
                </option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.allowRejectedRows}
                disabled={busy}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    allowRejectedRows: event.target.checked,
                    pending: undefined,
                  }))
                }
              />
              I reviewed rejected rows and choose to publish only the accepted subset
            </label>
            <Button
              disabled={
                busy ||
                !!stale ||
                preview.preview.canCommit === false ||
                ((preview.preview.counts?.rejected ?? 0) > 0 && !form.allowRejectedRows)
              }
              onClick={() => void run(commit)}
            >
              {busy
                ? 'Saving…'
                : form.pending
                  ? 'Retry the same reviewed commit'
                  : 'Publish immutable version'}
            </Button>
          </section>
        )}
      </CardContent>
    </Card>
  )
}
