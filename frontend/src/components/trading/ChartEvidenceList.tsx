import { useState } from 'react'
import {
  type ChartEvidenceRecord,
  type ChartEvidenceReopenContext,
  chartEvidenceUrl,
  readChartEvidence,
  recordedChartHref,
} from '@/lib/trader/chartEvidence'

function instant(seconds: number): string {
  const value = new Date(seconds * 1000)
  return Number.isFinite(value.getTime()) ? value.toISOString() : 'Unknown'
}

function EvidenceItem({
  item,
  originId,
  reopenContext,
}: {
  item: ChartEvidenceRecord
  originId?: string
  reopenContext?: ChartEvidenceReopenContext
}) {
  const [open, setOpen] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const source =
    item.source.kind === 'dataset'
      ? `${item.source.provider ? `${item.source.provider} · ` : ''}Saved history`
      : item.source.provider
  const title = `${item.instrument.symbol} · ${item.view.interval} · ${item.capturedAt}`
  const url = originId ? chartEvidenceUrl(originId, item.attachmentId) : null
  const chartHref = reopenContext
    ? recordedChartHref({ chartEvidence: [item] }, reopenContext, item.id)
    : undefined
  return (
    <details className="rounded border p-2" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          <p>
            {source} · {item.instrument.exchange} · {item.view.chartType} · {item.view.timezone}
          </p>
          {item.view.replayAsOf !== undefined && (
            <p>Replay view at {instant(item.view.replayAsOf)}</p>
          )}
          {(item.view.visibleFrom !== undefined || item.view.visibleTo !== undefined) && (
            <p>
              Visible UTC range:{' '}
              {item.view.visibleFrom !== undefined ? instant(item.view.visibleFrom) : 'Unknown'} to{' '}
              {item.view.visibleTo !== undefined ? instant(item.view.visibleTo) : 'Unknown'}
            </p>
          )}
          {item.annotations && <p className="whitespace-pre-wrap">{item.annotations}</p>}
          {chartHref && (
            <div className="space-y-1">
              <a className="inline-block underline" href={chartHref}>
                {item.source.kind === 'dataset'
                  ? 'Reopen recorded chart'
                  : 'Open current connected chart'}
              </a>
              {item.source.kind === 'legacy-connected' && (
                <p>
                  Uses current connected history. The saved image records the original view; its
                  historical data cannot be reconstructed exactly.
                </p>
              )}
            </div>
          )}
          {url ? (
            <>
              {imageFailed ? (
                <div className="space-y-1" role="alert">
                  <p>
                    The saved image could not be read. Reconnect the local engine and retry, or
                    restore this record's workspace backup.
                  </p>
                  <button type="button" className="underline" onClick={() => setImageFailed(false)}>
                    Retry saved image
                  </button>
                </div>
              ) : (
                <img
                  className="h-auto w-full rounded border"
                  src={url}
                  alt={`Saved chart: ${title}`}
                  onError={() => setImageFailed(true)}
                />
              )}
              <a className="inline-block underline" href={url} target="_blank" rel="noreferrer">
                Open saved chart image
              </a>
            </>
          ) : (
            <p>Open this record in durable local storage to read its saved image.</p>
          )}
        </div>
      )}
    </details>
  )
}

/** Images load only when their evidence row is opened. */
export function ChartEvidenceList({
  record,
  originId,
  reopenContext,
}: {
  record: unknown
  originId?: string
  reopenContext?: ChartEvidenceReopenContext
}) {
  const items = readChartEvidence(record)
  if (items.length === 0) return null
  return (
    <section className="space-y-2" aria-label="Saved chart evidence">
      <h3 className="text-sm font-semibold">Saved chart evidence ({items.length})</h3>
      {items.map((item) => (
        <EvidenceItem key={item.id} item={item} originId={originId} reopenContext={reopenContext} />
      ))}
    </section>
  )
}
