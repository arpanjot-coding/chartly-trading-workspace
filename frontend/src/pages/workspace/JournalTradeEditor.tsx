import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ChartEvidenceList } from '@/components/trading/ChartEvidenceList'
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
import { recordedChartHref, type ChartEvidenceReopenContext } from '@/lib/trader/chartEvidence'
import type { JournalTrade, TraderPortfolio } from '@/lib/trader/db'
import {
  normalizeExactDecimal,
  negateExactDecimal,
  sumExactDecimals,
  tradeMoney,
  journalTimestamp as sourceTimestamp,
} from '@/lib/trader/journalAnalytics'
import { journalClient, type JournalDetail } from '@/lib/trader/journalClient'
import { journalDrafts } from '@/lib/trader/journalDrafts'
import { validateManualJournalAmounts } from '@/lib/trader/journalValidation'
import type { useTraderData } from '@/lib/trader/useTraderData'
import { downloadJournalFile, journalTimestamp, journalWallTime } from './journalForm'
import { useJournalDraft } from './useJournalDraft'

export type TradeEditorMode =
  | 'create'
  | 'edit'
  | 'close'
  | 'partial'
  | 'correct'
  | 'review'
  | 'history'
type Data = ReturnType<typeof useTraderData>
interface Props {
  data: Data
  portfolio: TraderPortfolio
  bookId?: string
  trade?: JournalTrade
  mode: TradeEditorMode
  timezone: string
  emotionEnabled: boolean
  chartLink: string
  reopenContext?: ChartEvidenceReopenContext
  onClose: () => void
}
const FIELD = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
function dateTimeLabelForExit(value: string, timezone: string) {
  const instant = sourceTimestamp(value)
  return instant === null
    ? `${value} (source time unknown)`
    : new Date(instant).toLocaleString([], { timeZone: timezone })
}
const optional = (value: string) => value.trim() || undefined
function amount(value: string, name: string, nonnegative = false): string | null {
  if (!value.trim()) return null
  const result = normalizeExactDecimal(value.trim())
  if (
    result === null ||
    !Number.isFinite(Number(result)) ||
    (nonnegative && result.startsWith('-'))
  )
    throw new Error(
      `${name} must be a plain decimal${nonnegative ? ' at least zero' : ''}. Leave unknown values blank.`
    )
  return result
}
function initialDraft({ trade, mode, timezone, portfolio, data }: Props) {
  const value = (field: Parameters<typeof tradeMoney>[1]) =>
    trade ? (tradeMoney(trade, field).exact ?? '') : ''
  const wall = (date?: string) => {
    const instant = sourceTimestamp(date)
    return instant === null ? '' : journalWallTime(new Date(instant), timezone)
  }
  return {
    requestId: crypto.randomUUID(),
    expectedRevision: data.workspace?.revision,
    mode,
    timezone,
    pair: trade?.pair ?? portfolio.defaultSymbol ?? 'EURUSD',
    currency: trade?.currency ?? portfolio.currency,
    quantityUnit: trade?.quantityUnit ?? 'lots',
    direction: trade?.direction ?? 'Buy',
    result: trade?.result ?? 'Open',
    openDate: trade ? wall(trade.openDate) : journalWallTime(new Date(), timezone),
    sourceTimeConfirmed: !trade || sourceTimestamp(trade.openDate) !== null,
    closeDate:
      mode === 'close' || mode === 'partial'
        ? journalWallTime(new Date(), timezone)
        : wall(trade?.closeDate),
    quantity: mode === 'partial' ? '' : value('quantity'),
    entryPrice: value('entryPrice'),
    exitPrice: mode === 'partial' ? '' : value('exitPrice'),
    netPnl: mode === 'close' || mode === 'partial' ? '' : value('netPnl'),
    grossPnl: mode === 'close' || mode === 'partial' ? '' : value('grossPnl'),
    commission: mode === 'close' || mode === 'partial' ? '' : value('commission'),
    swap:
      mode === 'close' || mode === 'partial'
        ? ''
        : trade && !trade.amounts && value('swap')
          ? (negateExactDecimal(value('swap')) ?? '')
          : value('swap'),
    fees: mode === 'close' || mode === 'partial' ? '' : value('fees'),
    riskAmount: value('riskAmount'),
    timeframe: trade?.timeframe ?? portfolio.defaultTimeframe ?? '',
    strategy: trade?.strategy ?? '',
    setup: trade?.setup ?? '',
    tags: (trade?.tags ?? []).join(', '),
    technicalNotes: trade?.technicalNotes ?? '',
    emotionalNotes: trade?.emotionalNotes ?? '',
    otherNotes: trade?.otherNotes ?? '',
    chartUrl: trade?.chartUrl ?? '',
    reviewStatus: trade?.reviewStatus ?? 'unreviewed',
    rating: trade?.rating == null ? '' : String(trade.rating),
    reason: '',
    realizationId: '',
    confirmStatusChange: false,
    recordMindset: !!trade?.emotion,
    preTradeState: trade?.preTradeState ?? '',
    conviction: trade?.conviction == null ? '' : String(trade.conviction),
    fomo: trade?.emotion ? String(trade.emotion.fomo) : '',
    patience: trade?.emotion ? String(trade.emotion.patience) : '',
    discipline: trade?.emotion ? String(trade.emotion.discipline) : '',
    confidence: trade?.emotion ? String(trade.emotion.confidence) : '',
  }
}
type Draft = ReturnType<typeof initialDraft>
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The selected file could not be read.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.readAsDataURL(file)
  })
}

export default function JournalTradeEditor(props: Props) {
  const { data, portfolio, trade, timezone, bookId, onClose, emotionEnabled, chartLink } = props
  const [mode, setMode] = useState<TradeEditorMode>(props.mode)
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
  const draft = useJournalDraft(scope, `trade:${trade?.id ?? 'new'}`, () => initialDraft(props))
  const form = draft.value
  const inputTimezone = form.timezone ?? timezone
  const change = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    draft.setValue((previous) => ({ ...previous, [field]: value, requestId: crypto.randomUUID() }))
  const [detail, setDetail] = useState<JournalDetail | null>(null)
  const recordedChartLink = props.reopenContext
    ? recordedChartHref(detail?.trade ?? trade, props.reopenContext)
    : undefined
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attachment, setAttachment] = useState<{ value: Record<string, unknown> } | null>(null)
  const manual = !trade?.origin || trade.origin === 'manual'
  const backend = data.storageMode === 'backend'
  const hasExits = !!trade?.realizations?.some((event) => event.kind !== 'fee')
  const entryQuantity = trade ? tradeMoney(trade, 'quantity').exact : null
  const remainingQuantity =
    trade?.remainingQuantity ??
    (entryQuantity
      ? sumExactDecimals([
          entryQuantity,
          ...(trade?.realizations ?? [])
            .filter((event) => event.kind !== 'fee')
            .map((event) => negateExactDecimal(event.quantity) ?? 'invalid'),
        ])
      : null)
  const correcting = mode === 'correct'
  const exitForm = mode === 'partial' || correcting
  const openRealized = mode === 'edit' && trade?.result === 'Open' && hasExits
  function inputInstant(value: string, original?: string) {
    const instant = sourceTimestamp(original)
    return instant !== null && value === journalWallTime(new Date(instant), inputTimezone)
      ? original!
      : journalTimestamp(value, inputTimezone)
  }
  function changeTimezone(next: string) {
    try {
      const convert = (value: string, original?: string) =>
        value ? journalWallTime(new Date(inputInstant(value, original)), next) : ''
      const openDate = convert(form.openDate, trade?.openDate)
      const closeDate = convert(
        form.closeDate,
        correcting
          ? trade?.realizations?.find((item) => item.id === form.realizationId)?.closedAt
          : trade?.closeDate
      )
      draft.setValue((previous) => ({
        ...previous,
        timezone: next,
        openDate,
        closeDate,
        requestId: crypto.randomUUID(),
      }))
      setError('')
    } catch (cause) {
      change('timezone', next)
      setError(
        `The previous wall time could not be converted: ${cause instanceof Error ? cause.message : 'unknown source time'}. Verify the entered times in ${next} before saving.`
      )
    }
  }
  useEffect(() => {
    if (draft.ready && draft.restored && form.mode) setMode(form.mode)
  }, [draft.ready, draft.restored, form.mode])
  function selectMode(next: TradeEditorMode) {
    setMode(next)
    setError('')
    draft.setValue((previous) => {
      const fresh = initialDraft({ ...props, mode: next, timezone: inputTimezone })
      if (next === 'edit' || next === 'close' || next === 'partial')
        return {
          ...previous,
          ...Object.fromEntries(
            [
              'quantity',
              'entryPrice',
              'exitPrice',
              'netPnl',
              'grossPnl',
              'commission',
              'swap',
              'fees',
              'openDate',
              'closeDate',
              'result',
            ].map((key) => [key, fresh[key as keyof Draft]])
          ),
          mode: next,
          requestId: crypto.randomUUID(),
        }
      return { ...previous, mode: next, requestId: crypto.randomUUID() }
    })
  }
  function selectRealization(id: string) {
    const event = trade?.realizations?.find((item) => item.id === id)
    if (!event) return
    draft.setValue((previous) => ({
      ...previous,
      realizationId: id,
      quantity: event.quantity,
      closeDate: journalWallTime(new Date(event.closedAt), inputTimezone),
      netPnl: event.netPnl,
      grossPnl: event.grossPnl ?? '',
      commission: event.commission ?? '',
      swap: event.swap ?? '',
      fees: event.fees ?? '',
      exitPrice: event.exitPrice ?? '',
      reason: '',
      confirmStatusChange: false,
      requestId: crypto.randomUUID(),
    }))
  }
  useEffect(() => {
    let live = true
    if (trade?.id && data.tradeDetail)
      void data
        .tradeDetail(trade.id)
        .then((result) => {
          if (live) setDetail(result)
        })
        .catch((cause) => {
          if (live)
            setError(cause instanceof Error ? cause.message : 'Trade history could not be loaded.')
        })
    if (trade?.id)
      void journalDrafts
        .get<Record<string, unknown>>(scope, `attachment:${trade.id}`)
        .then((saved) => {
          if (live && saved) setAttachment(saved)
        })
        .catch(() => {})
    return () => {
      live = false
    }
  }, [trade?.id, data.tradeDetail, scope])
  const options = { requestId: form.requestId, expectedRevision: form.expectedRevision, bookId }
  function review() {
    const rating = form.rating ? Number(form.rating) : null
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5))
      throw new Error('Rating must be between 1 and 5, or blank.')
    const result: Record<string, unknown> = {
      strategy: form.strategy.trim(),
      setup: form.setup.trim(),
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      technicalNotes: form.technicalNotes,
      otherNotes: form.otherNotes,
      chartUrl: form.chartUrl.trim() || null,
      rating,
      reviewStatus: form.reviewStatus,
    }
    if (emotionEnabled && form.recordMindset) {
      const emotion = {
        fomo: Number(form.fomo),
        patience: Number(form.patience),
        discipline: Number(form.discipline),
        confidence: Number(form.confidence),
      }
      if (
        Object.values(emotion).some((value) => !Number.isInteger(value) || value < 1 || value > 5)
      )
        throw new Error(
          'Choose each optional mindset score from 1 to 5, or leave mindset unchecked.'
        )
      result.emotion = emotion
      result.emotionalNotes = form.emotionalNotes
      if (form.preTradeState) result.preTradeState = form.preTradeState
      if (form.conviction) result.conviction = Number(form.conviction)
    }
    return result
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await journalDrafts.save(scope, `trade:${trade?.id ?? 'new'}`, form)
      if (mode === 'review' && trade?.id) {
        await data.reviewTrade(trade.id, review(), options)
      } else if (exitForm && trade?.id) {
        const quantity = amount(form.quantity, 'Exit quantity', true)
        const netPnl = amount(form.netPnl, 'This exit’s net P&L')
        if (!quantity || Number(quantity) <= 0 || netPnl === null)
          throw new Error('Enter a positive exit quantity and this exit’s known net P&L.')
        const payload: Record<string, unknown> = {
          tradeId: trade.id,
          quantity,
          closedAt: inputInstant(
            form.closeDate,
            correcting
              ? trade.realizations?.find((event) => event.id === form.realizationId)?.closedAt
              : undefined
          ),
          netPnl,
        }
        for (const key of ['grossPnl', 'commission', 'swap', 'fees', 'exitPrice'] as const) {
          const value = amount(form[key], key, ['commission', 'fees', 'exitPrice'].includes(key))
          if (value !== null || correcting) payload[key] = value
        }
        validateManualJournalAmounts(
          Object.fromEntries(
            ['quantity', 'netPnl', 'grossPnl', 'commission', 'swap', 'fees', 'exitPrice']
              .filter((key) => key in payload)
              .map((key) => [key, payload[key]])
          )
        )
        if (correcting) {
          if (!manual || !form.realizationId) throw new Error('Choose the manual exit to correct.')
          if (!form.reason.trim()) throw new Error('Enter a reason for correcting this exit.')
          const { tradeId, ...patch } = payload
          await data.performJournalAction(
            'correct-realization',
            {
              tradeId,
              realizationId: form.realizationId,
              patch,
              reason: form.reason.trim(),
              confirmStatusChange: form.confirmStatusChange,
            },
            options
          )
        } else await data.performJournalAction('partial-close-trade', payload, options)
      } else {
        if (!manual)
          throw new Error('Source execution facts are read-only. Save review annotations instead.')
        const result = mode === 'close' ? 'Win' : form.result
        const openDate = inputInstant(form.openDate, trade?.openDate)
        const closeDate =
          result === 'Open'
            ? ''
            : inputInstant(form.closeDate, mode === 'close' ? undefined : trade?.closeDate)
        if (closeDate && Date.parse(closeDate) < Date.parse(openDate))
          throw new Error('Close time must be at or after open time.')
        const net =
          result === 'Open'
            ? openRealized
              ? tradeMoney(trade!, 'netPnl').exact
              : null
            : amount(form.netPnl, 'Net P&L')
        if (mode === 'edit' && trade?.id && !form.reason.trim())
          throw new Error('Enter a reason for changing manual execution facts.')
        if (result !== 'Open' && net === null)
          throw new Error(
            'Enter known net P&L for a closed trade. Unknown is not recorded as break-even.'
          )
        if (!form.sourceTimeConfirmed)
          throw new Error(
            'Confirm the intended input timezone and replace the original unknown timestamp before changing execution facts.'
          )
        const amounts = {
          netPnl: net,
          grossPnl: openRealized
            ? tradeMoney(trade!, 'grossPnl').exact
            : amount(form.grossPnl, 'Gross P&L'),
          commission: openRealized
            ? tradeMoney(trade!, 'commission').exact
            : amount(form.commission, 'Commission', true),
          swap: openRealized ? tradeMoney(trade!, 'swap').exact : amount(form.swap, 'Swap'),
          fees: openRealized ? tradeMoney(trade!, 'fees').exact : amount(form.fees, 'Fees', true),
          quantity: amount(form.quantity, 'Quantity', true),
          riskAmount: amount(form.riskAmount, 'Risk amount', true),
          entryPrice: amount(form.entryPrice, 'Entry price', true),
          exitPrice: amount(form.exitPrice, 'Exit price', true),
        }
        validateManualJournalAmounts(amounts)
        if (amounts.quantity !== null && Number(amounts.quantity) <= 0)
          throw new Error('Known quantity must be positive; leave unknown quantity blank.')
        const reviewFields = review()
        const patch: Partial<JournalTrade> = {
          ...reviewFields,
          pair: form.pair.trim().toUpperCase(),
          direction: form.direction as JournalTrade['direction'],
          openDate,
          closeDate,
          timeframe: form.timeframe.trim(),
          sourceTimezone: inputTimezone,
          currency: form.currency.trim().toUpperCase(),
          quantityUnit: form.quantityUnit,
          amounts,
          result:
            result === 'Open'
              ? 'Open'
              : Number(net) > 0
                ? 'Win'
                : Number(net) < 0
                  ? 'Loss'
                  : 'Break Even',
          netPnl: Number(net ?? 0),
          pnl: Number(net ?? 0),
          lots: Number(amounts.quantity ?? 0),
          riskAmount: amounts.riskAmount === null ? undefined : Number(amounts.riskAmount),
          entryPrice: amounts.entryPrice === null ? undefined : Number(amounts.entryPrice),
          exitPrice: amounts.exitPrice === null ? undefined : Number(amounts.exitPrice),
          grossPnl: amounts.grossPnl === null ? undefined : Number(amounts.grossPnl),
          commission: amounts.commission === null ? undefined : Number(amounts.commission),
          swap: amounts.swap === null ? undefined : Number(amounts.swap),
          fees: amounts.fees === null ? undefined : Number(amounts.fees),
          duration: closeDate ? (Date.parse(closeDate) - Date.parse(openDate)) / 60_000 : 0,
        }
        if (!patch.pair) throw new Error('Enter a symbol.')
        if (!/^[A-Z][A-Z0-9]{2,11}$/.test(patch.currency!))
          throw new Error('Enter a native currency or asset code of 3–12 letters/numbers.')
        if (trade?.id)
          await data.updateTrade(trade.id, patch, {
            ...options,
            close: mode === 'close',
            reason: optional(form.reason),
          })
        else
          await data.createTrade(
            {
              ...patch,
              portfolioId: portfolio.id!,
              journalBookId: backend ? bookId : undefined,
              origin: 'manual',
              strategy: form.strategy.trim() || 'Manual',
              rr: 0,
              sl: 0,
              tp: 0,
              technicalNotes: form.technicalNotes,
              emotionalNotes: emotionEnabled && form.recordMindset ? form.emotionalNotes : '',
              otherNotes: form.otherNotes,
            } as Parameters<Data['createTrade']>[0],
            options
          )
      }
      await draft.clear()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed. The draft is retained.')
    } finally {
      setBusy(false)
    }
  }
  async function upload(file?: File) {
    if (!file || !trade?.id || !data.workspace) return
    setBusy(true)
    setError('')
    try {
      if (
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'].includes(
          file.type
        ) ||
        file.size > 8 * 1024 * 1024
      )
        throw new Error('Choose a PNG, JPEG, WebP, GIF or PDF up to 8 MiB.')
      if (attachment)
        throw new Error(
          'An interrupted attachment is retained. Retry or export it before attaching another file.'
        )
      const body = {
        originId: data.workspace.originId,
        expectedRevision: data.workspace.revision,
        requestId: crypto.randomUUID(),
        tradeId: trade.id,
        mimeType: file.type,
        base64: await readFile(file),
      }
      await journalDrafts.save(scope, `attachment:${trade.id}`, body)
      setAttachment({ value: body })
      await data.acceptJournalResponse(await journalClient.uploadAttachment(body))
      await journalDrafts.delete(scope, `attachment:${trade.id}`)
      setAttachment(null)
      setDetail(await data.tradeDetail(trade.id))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Attachment failed; the submitted file is retained locally.'
      )
    } finally {
      setBusy(false)
    }
  }
  const field = (name: keyof Draft, label: string, type = 'text', disabled = false) => (
    <div className="space-y-2">
      <Label htmlFor={`journal-edit-${name}`}>{label}</Label>
      <Input
        id={`journal-edit-${name}`}
        type={type}
        step={type === 'datetime-local' ? 'any' : undefined}
        value={String(form[name] ?? '')}
        disabled={disabled || busy}
        onChange={(event) => change(name, event.target.value as never)}
      />
    </div>
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {trade
              ? `${mode === 'history' ? 'History' : mode === 'review' ? 'Review' : correcting ? 'Correct exit' : mode === 'partial' ? 'Partial exit' : mode === 'close' ? 'Close' : 'Edit'} · ${trade.pair}`
              : 'Log a trade'}
          </DialogTitle>
          <DialogDescription>
            {trade
              ? `${trade.origin ?? 'manual'} record · execution revision ${trade.factRevision ?? 0} · review revision ${trade.reviewRevision ?? 0}. Source corrections retain your review history.`
              : 'Save to this explicit manual book. Leave unknown risk, costs and mindset values blank.'}{' '}
            Times use {inputTimezone}.
          </DialogDescription>
        </DialogHeader>
        {trade && (
          <nav className="flex flex-wrap gap-2" aria-label="Trade actions">
            {(
              [
                'review',
                ...(manual
                  ? [
                      'edit',
                      ...(backend && hasExits ? ['correct'] : []),
                      ...(trade.result === 'Open'
                        ? [
                            'close',
                            ...(backend &&
                            remainingQuantity !== null &&
                            Number(remainingQuantity) > 0
                              ? ['partial']
                              : []),
                          ]
                        : []),
                    ]
                  : []),
                'history',
              ] as TradeEditorMode[]
            ).map((item) => (
              <Button
                key={item}
                type="button"
                variant={mode === item ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => selectMode(item)}
              >
                {item === 'correct'
                  ? 'Correct exit'
                  : item === 'partial'
                    ? 'Partial exit'
                    : item === 'close'
                      ? 'Close trade'
                      : item[0].toUpperCase() + item.slice(1)}
              </Button>
            ))}
          </nav>
        )}
        {!manual && (
          <p className="rounded border p-3 text-sm">
            Imported, connector and simulated execution facts are read-only here. Review notes, tags
            and evidence remain editable.
          </p>
        )}
        {draft.restored && (
          <output className="block text-sm">
            An unsaved local draft was restored. Compare it with the current saved record before
            retrying.
          </output>
        )}
        {(error || draft.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || draft.error}
          </p>
        )}
        {mode === 'history' ? (
          <div className="space-y-3">
            <p className="text-sm">
              {detail?.history.length ?? 0} recorded changes · {detail?.executions.length ?? 0}{' '}
              source executions. Full source and history are included in book export.
            </p>
            {!!(detail?.trade.realizations ?? trade?.realizations)?.length && (
              <section className="rounded border p-3 text-sm">
                <h3 className="font-semibold">Saved exits and linked adjustments</h3>
                <p className="mt-1 text-muted-foreground">
                  Exact amounts in {trade?.currency ?? portfolio.currency}; adjustments keep their
                  type and do not count as exits.
                </p>
                <div className="mt-2 max-h-64 overflow-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr>
                        <th className="p-2">Type / time</th>
                        <th className="p-2">Quantity</th>
                        <th className="p-2">Net P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail?.trade.realizations ?? trade?.realizations)?.map((event) => (
                        <tr key={event.id} className="border-t">
                          <td className="p-2">
                            {event.kind === 'fee' ? 'Fee adjustment' : 'Exit'} ·{' '}
                            {dateTimeLabelForExit(event.closedAt, inputTimezone)}
                          </td>
                          <td className="p-2">{event.quantity}</td>
                          <td className="p-2">{event.netPnl}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {detail?.history
              .slice(-1000)
              .reverse()
              .map((entry, index) => (
                <details className="rounded border p-3 text-sm" key={String(entry.id ?? index)}>
                  <summary>
                    {String(entry.action ?? entry.kind ?? 'Journal change')} ·{' '}
                    {String(entry.at ?? entry.createdAt ?? 'Time not recorded')}
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs">
                    {JSON.stringify(entry, null, 2)}
                  </pre>
                </details>
              ))}
            {detail?.executions.map((entry, index) => (
              <details className="rounded border p-3 text-sm" key={`source-${index}`}>
                <summary>Source execution {index + 1}</summary>
                <pre className="mt-2 whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(entry, null, 2)}
                </pre>
              </details>
            ))}
            {detail?.observations?.map((entry, index) => (
              <details className="rounded border p-3 text-sm" key={`observation-${index}`}>
                <summary>Retained source observation {index + 1}</summary>
                <pre className="mt-2 whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(entry, null, 2)}
                </pre>
              </details>
            ))}
            {!detail?.history.length && (
              <p className="text-sm text-muted-foreground">
                No prior changes were recorded. This does not invent a historical audit for legacy
                records.
              </p>
            )}
          </div>
        ) : (
          <form className="space-y-5" onSubmit={(event) => void save(event)}>
            <fieldset disabled={busy || !draft.ready} className="space-y-5">
              {mode !== 'review' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="journal-input-timezone">Input timezone</Label>
                    <select
                      id="journal-input-timezone"
                      className={FIELD}
                      value={inputTimezone}
                      onChange={(event) => changeTimezone(event.target.value)}
                    >
                      {[
                        ...new Set([
                          inputTimezone,
                          'UTC',
                          'Europe/London',
                          'America/New_York',
                          'Asia/Tokyo',
                          'Asia/Kolkata',
                          'Australia/Sydney',
                        ]),
                      ].map((zone) => (
                        <option key={zone}>{zone}</option>
                      ))}
                    </select>
                  </div>
                  {trade && sourceTimestamp(trade.openDate) === null && (
                    <label className="flex items-start gap-2 rounded border p-3 text-sm">
                      <input
                        type="checkbox"
                        checked={form.sourceTimeConfirmed}
                        onChange={(event) => change('sourceTimeConfirmed', event.target.checked)}
                      />
                      The original timestamp has unknown timezone/time. I confirm the input timezone
                      and the replacement timestamp entered below.
                    </label>
                  )}
                  {correcting && (
                    <div className="space-y-2">
                      <Label htmlFor="journal-correct-exit">Manual exit to correct</Label>
                      <select
                        id="journal-correct-exit"
                        className={FIELD}
                        value={form.realizationId}
                        onChange={(event) => selectRealization(event.target.value)}
                      >
                        <option value="">Choose an exit</option>
                        {trade?.realizations
                          ?.filter((event) => event.kind !== 'fee')
                          .map((event) => (
                            <option key={event.id} value={event.id}>
                              {dateTimeLabelForExit(event.closedAt, inputTimezone)} ·{' '}
                              {event.quantity} · net {event.netPnl}
                            </option>
                          ))}
                      </select>
                      <p className="text-sm text-muted-foreground">
                        A correction retains the prior exit and reason in history. The entry
                        quantity stays unchanged; quantities must reconcile with the remaining
                        position.
                      </p>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {field('pair', 'Symbol', 'text', mode === 'close' || exitForm)}
                    <div className="space-y-2">
                      <Label htmlFor="journal-edit-direction">Direction</Label>
                      <select
                        id="journal-edit-direction"
                        className={FIELD}
                        value={form.direction}
                        disabled={mode === 'close' || exitForm || busy}
                        onChange={(event) =>
                          change('direction', event.target.value as 'Buy' | 'Sell')
                        }
                      >
                        <option>Buy</option>
                        <option>Sell</option>
                      </select>
                    </div>
                    {field('timeframe', 'Timeframe', 'text', exitForm)}
                    {field(
                      'currency',
                      'Native currency / asset code',
                      'text',
                      mode === 'close' || exitForm
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="journal-edit-unit">Size unit</Label>
                      <select
                        id="journal-edit-unit"
                        className={FIELD}
                        value={form.quantityUnit}
                        disabled={mode === 'close' || exitForm}
                        onChange={(event) => change('quantityUnit', event.target.value)}
                      >
                        {['lots', 'units', 'shares', 'contracts', 'coins'].map((unit) => (
                          <option key={unit}>{unit}</option>
                        ))}
                      </select>
                    </div>
                    {!exitForm && (
                      <div className="space-y-2">
                        <Label htmlFor="journal-edit-result">Position status</Label>
                        <select
                          id="journal-edit-result"
                          className={FIELD}
                          value={
                            mode === 'close' ? 'Closed' : form.result === 'Open' ? 'Open' : 'Closed'
                          }
                          disabled={mode === 'close' || hasExits || busy}
                          onChange={(event) =>
                            change('result', event.target.value === 'Open' ? 'Open' : 'Win')
                          }
                        >
                          <option>Open</option>
                          <option>Closed</option>
                        </select>
                      </div>
                    )}
                    {field('openDate', 'Opened', 'datetime-local', mode === 'close' || exitForm)}
                    {(mode === 'close' || exitForm || form.result !== 'Open') &&
                      field('closeDate', exitForm ? 'Exit time' : 'Closed', 'datetime-local')}
                    {field(
                      'quantity',
                      exitForm ? 'This exit’s quantity' : 'Quantity / size',
                      'text',
                      mode === 'close'
                    )}
                    {field(
                      'netPnl',
                      mode === 'close'
                        ? 'Final total net P&L (including earlier exits)'
                        : exitForm
                          ? 'This exit’s net P&L'
                          : 'Net P&L',
                      'text',
                      form.result === 'Open' && mode !== 'close' && !exitForm
                    )}
                  </div>
                  <details className="rounded border p-3">
                    <summary className="cursor-pointer text-sm font-medium">
                      Prices, costs and risk (optional)
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {field('entryPrice', 'Entry price', 'text', mode === 'close' || exitForm)}
                      {field('exitPrice', 'Exit price')}
                      {field('grossPnl', 'Gross P&L', 'text', !!openRealized)}
                      {field('commission', 'Commission expense', 'text', !!openRealized)}
                      {field('swap', 'Swap cashflow (+ credit / − charge)', 'text', !!openRealized)}
                      {field('fees', 'Other fee expense', 'text', !!openRealized)}
                      {field('riskAmount', 'Risk amount (unknown stays blank)', 'text', exitForm)}
                    </div>
                  </details>
                  {trade &&
                    (mode === 'edit' || correcting) &&
                    field('reason', 'Reason for changing manual facts')}
                  {openRealized && (
                    <p className="text-sm">
                      Realized net and costs come from saved exits. Use Correct exit to change an
                      individual exit; editing entry facts requires a reason.
                    </p>
                  )}
                  {correcting && (
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.confirmStatusChange}
                        onChange={(event) => change('confirmStatusChange', event.target.checked)}
                      />
                      Confirm an open/closed status change caused by corrected quantities. Leave
                      unchecked to require the current position status.
                    </label>
                  )}
                  {mode === 'partial' && (
                    <p className="text-sm">
                      Remaining quantity: {remainingQuantity ?? 'unknown'}. This action records only
                      this exit; it leaves the remaining position open.
                    </p>
                  )}
                </>
              )}
              {!exitForm && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {field('strategy', 'Strategy')}
                    {field('setup', 'Setup')}
                    {field('tags', 'Tags (comma separated)')}
                    {field('rating', 'Optional rating (1–5)')}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="journal-technical-notes">Technical / decision notes</Label>
                      <Textarea
                        id="journal-technical-notes"
                        rows={4}
                        value={form.technicalNotes}
                        onChange={(event) => change('technicalNotes', event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="journal-other-notes">Other review notes</Label>
                      <Textarea
                        id="journal-other-notes"
                        rows={4}
                        value={form.otherNotes}
                        onChange={(event) => change('otherNotes', event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="journal-chart-url">Chart evidence URL</Label>
                    <Input
                      id="journal-chart-url"
                      value={form.chartUrl}
                      onChange={(event) => change('chartUrl', event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        change('chartUrl', new URL(recordedChartLink ?? chartLink, window.location.origin).href)
                      }
                    >
                      Attach this journal’s chart link
                    </Button>
                  </div>
                  {emotionEnabled && (
                    <details className="rounded border p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        Optional mindset
                      </summary>
                      <label className="mt-3 flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={form.recordMindset}
                          onChange={(event) => change('recordMindset', event.target.checked)}
                        />
                        Record explicit mindset values
                      </label>
                      {!!trade?.emotion && !form.recordMindset && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Saved mindset values remain unchanged while this option is off. Execution
                          capture does not require a new mindset assessment.
                        </p>
                      )}
                      {form.recordMindset && (
                        <>
                          <div className="mt-3 grid gap-3 sm:grid-cols-4">
                            {field('fomo', 'FOMO (1–5)')}
                            {field('patience', 'Patience (1–5)')}
                            {field('discipline', 'Discipline (1–5)')}
                            {field('confidence', 'Confidence (1–5)')}
                          </div>
                          <Label htmlFor="journal-emotional-notes">Mindset notes</Label>
                          <Textarea
                            id="journal-emotional-notes"
                            value={form.emotionalNotes}
                            onChange={(event) => change('emotionalNotes', event.target.value)}
                          />
                        </>
                      )}
                    </details>
                  )}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.reviewStatus === 'reviewed'}
                      onChange={(event) =>
                        change('reviewStatus', event.target.checked ? 'reviewed' : 'unreviewed')
                      }
                    />
                    Mark reviewed
                  </label>
                </>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    downloadJournalFile(form, `chartly-trade-${trade?.id ?? 'new'}-draft.json`)
                  }
                >
                  Export local draft
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void draft
                      .clear()
                      .then(onClose)
                      .catch((cause) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : 'The draft could not be discarded.'
                        )
                      )
                  }
                >
                  Discard local draft
                </Button>
                <Button type="submit" disabled={busy || !draft.ready || data.readOnly}>
                  {busy
                    ? 'Saving…'
                    : mode === 'review'
                      ? 'Save review'
                      : correcting
                        ? 'Save exit correction'
                        : mode === 'partial'
                          ? 'Record partial exit'
                          : mode === 'close'
                            ? 'Close trade'
                            : 'Save trade'}
                </Button>
              </div>
            </fieldset>
          </form>
        )}
        {trade?.id && (
          <section className="space-y-3 rounded border p-3">
            <ChartEvidenceList record={detail?.trade ?? trade} originId={data.workspace?.originId} reopenContext={props.reopenContext} />
            <h3 className="text-sm font-semibold">Screenshot / document bytes</h3>
            {(detail?.trade.screenshotUrl ?? trade.screenshotUrl) && (
              <a
                className="block text-sm underline"
                href={detail?.trade.screenshotUrl ?? trade.screenshotUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open saved evidence
              </a>
            )}
            {backend ? (
              <>
                <Label htmlFor="journal-evidence-file">
                  Attach PNG, JPEG, WebP, GIF or PDF (up to 8 MiB)
                </Label>
                <Input
                  id="journal-evidence-file"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                  disabled={busy || !!attachment}
                  onChange={(event) => void upload(event.target.files?.[0])}
                />
                {attachment && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true)
                        void journalClient
                          .uploadAttachment(attachment.value)
                          .then(data.acceptJournalResponse)
                          .then(async () => {
                            await journalDrafts.delete(scope, `attachment:${trade.id}`)
                            setAttachment(null)
                            setDetail(await data.tradeDetail(trade.id!))
                          })
                          .catch((cause) =>
                            setError(
                              cause instanceof Error ? cause.message : 'Attachment retry failed.'
                            )
                          )
                          .finally(() => setBusy(false))
                      }}
                    >
                      Retry retained attachment
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        downloadJournalFile(
                          attachment.value,
                          `chartly-trade-${trade.id}-retained-attachment.json`
                        )
                      }
                    >
                      Export retained attachment
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void journalDrafts
                          .delete(scope, `attachment:${trade.id}`)
                          .then(() => setAttachment(null))
                          .catch((cause) =>
                            setError(
                              cause instanceof Error
                                ? cause.message
                                : 'The local attachment draft could not be discarded.'
                            )
                          )
                      }
                    >
                      Discard local attachment draft
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm">
                Portable byte attachments need{' '}
                <Link className="underline" to="/settings/storage">
                  durable local storage
                </Link>
                . A chart URL can still be recorded as a reference.
              </p>
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}
