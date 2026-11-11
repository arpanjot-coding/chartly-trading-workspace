import { journalReturnHref } from './journalNavigation'

export type ChartEvidenceSource =
  | { kind: 'dataset'; datasetVersionId: string; checksum: string; provider?: string }
  | { kind: 'legacy-connected'; provider: string }

/** Observed chart state. It grants no execution permission. */
export interface ChartEvidenceCapture {
  version: 1
  capturedAt: string
  source: ChartEvidenceSource
  instrument: { symbol: string; exchange: string }
  view: {
    interval: string
    chartType: string
    timezone: string
    visibleFrom?: number
    visibleTo?: number
    replayAsOf?: number
    paneId?: string
  }
}

export interface ChartEvidenceTarget {
  kind: 'trade' | 'run'
  id: number
  profileId: number
  bookId?: string
}

/** IDs only: the chart resolves source and view from the owned record, never from link metadata. */
export interface ChartEvidenceReopenContext {
  profileId: number
  runId?: number
  tradeId?: number
  bookId?: string
  journalReturn?: string
  returnTo?: string
}

export interface ChartEvidenceRequest {
  originId: string
  expectedRevision: number
  requestId: string
  target: ChartEvidenceTarget
  mimeType: 'image/png'
  base64: string
  capture: ChartEvidenceCapture
  annotations: string
}

export interface ChartEvidenceRecord extends Omit<ChartEvidenceCapture, 'version' | 'source'> {
  source: ChartEvidenceSource & { provider?: string }
  id: string
  attachmentId: string
  imageSha256: string
  annotations: string
  createdAt?: string
}

export const MAX_CHART_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_CHART_METADATA_BYTES = 64 * 1024

export function chartEvidenceUrl(originId: string, attachmentId: string): string {
  return `/api/local/v1/attachments/${encodeURIComponent(attachmentId)}?${new URLSearchParams({ originId })}`
}

export function recordedChartHref(
  record: unknown,
  context: ChartEvidenceReopenContext,
  evidenceId?: string
): string | undefined {
  if (!Number.isSafeInteger(context.profileId) || context.profileId <= 0) return undefined
  if (!context.tradeId && !context.runId) return undefined
  const items = readChartEvidence(record).filter((item) =>
    Number.isFinite(Date.parse(item.capturedAt))
  )
  const evidence = evidenceId
    ? items.find((item) => item.id === evidenceId)
    : items.reduce<ChartEvidenceRecord | undefined>(
        (latest, item) =>
          !latest || Date.parse(item.capturedAt) >= Date.parse(latest.capturedAt) ? item : latest,
        undefined
      )
  if (!evidence) return undefined
  const params = new URLSearchParams({
    profileId: String(context.profileId),
    evidenceId: evidence.id,
  })
  for (const [key, value] of [
    ['runId', context.runId],
    ['tradeId', context.tradeId],
  ] as const) {
    if (value !== undefined) {
      if (!Number.isSafeInteger(value) || value <= 0) return undefined
      params.set(key, String(value))
    }
  }
  if (context.bookId) params.set('bookId', context.bookId)
  const journal = journalReturnHref(context.profileId, context.journalReturn ?? null)
  if (journal) params.set('journalReturn', journal)
  if (context.returnTo) {
    try {
      const target = new URL(context.returnTo, 'http://chartly.local')
      if (
        target.origin === 'http://chartly.local' &&
        !target.hash &&
        [
          `/workspace/profiles/${context.profileId}/replay`,
          `/workspace/profiles/${context.profileId}`,
        ].includes(target.pathname)
      )
        params.set('returnTo', target.pathname + target.search)
    } catch {
      /* Only the current owned journal or profile is a return destination. */
    }
  }
  return `/trading?${params}`
}

export function readChartEvidence(value: unknown): ChartEvidenceRecord[] {
  if (!value || typeof value !== 'object' || !('chartEvidence' in value)) return []
  const rows = value.chartEvidence
  if (!Array.isArray(rows)) return []
  return rows.filter(
    (row): row is ChartEvidenceRecord =>
      !!row &&
      typeof row === 'object' &&
      typeof row.id === 'string' &&
      typeof row.attachmentId === 'string' &&
      typeof row.capturedAt === 'string' &&
      !!row.source &&
      typeof row.source === 'object' &&
      !!row.instrument &&
      typeof row.instrument === 'object' &&
      typeof row.instrument.symbol === 'string' &&
      typeof row.instrument.exchange === 'string' &&
      !!row.view &&
      typeof row.view === 'object' &&
      typeof row.view.interval === 'string' &&
      typeof row.view.chartType === 'string' &&
      typeof row.view.timezone === 'string'
  )
}

/** Keep a private copy: changing a pane cannot mutate a retained request. */
export function validateChartCapture(capture: ChartEvidenceCapture): ChartEvidenceCapture {
  const bytes = new TextEncoder().encode(JSON.stringify(capture))
  if (bytes.length > MAX_CHART_METADATA_BYTES)
    throw new Error('This chart view contains too much evidence metadata. Capture a smaller view.')
  const value = JSON.parse(new TextDecoder().decode(bytes)) as ChartEvidenceCapture
  if (
    value.version !== 1 ||
    !Number.isFinite(Date.parse(value.capturedAt)) ||
    !value.instrument?.symbol ||
    !value.instrument.exchange ||
    !value.view?.interval ||
    !value.view.chartType ||
    !value.view.timezone ||
    !value.source ||
    !['dataset', 'legacy-connected'].includes(value.source.kind)
  )
    throw new Error('The chart is not ready to capture. Reload its source and try again.')
  for (const bound of [value.view.visibleFrom, value.view.visibleTo, value.view.replayAsOf])
    if (bound !== undefined && !Number.isFinite(bound))
      throw new Error('The chart time window is unavailable. Reload the chart before capturing it.')
  if (
    value.view.visibleFrom !== undefined &&
    value.view.visibleTo !== undefined &&
    value.view.visibleFrom > value.view.visibleTo
  )
    throw new Error('The chart time window is unavailable. Reload the chart before capturing it.')
  if (
    (value.source.kind === 'dataset' &&
      (!value.source.datasetVersionId || !/^[a-f0-9]{64}$/.test(value.source.checksum))) ||
    (value.source.kind === 'legacy-connected' && !value.source.provider)
  )
    throw new Error('The chart source could not be identified. Choose its source again.')
  return value
}

export async function chartImageBase64(image: Blob): Promise<string> {
  if (image.type !== 'image/png' || image.size === 0 || image.size > MAX_CHART_IMAGE_BYTES)
    throw new Error('Capture a PNG chart image no larger than 8 MiB.')
  const bytes = new Uint8Array(await image.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}
