import type { Bar, BarsRequest, DataFeed } from 'chartly-charts'
import { type DatasetBar, type DatasetVersion, dataLibrary } from '@/api/dataLibrary'

export function datasetBar(row: DatasetBar): Bar | null {
  const values = [row.timestamp, row.open, row.high, row.low, row.close].map(Number)
  if (!values.every(Number.isFinite)) return null
  const [time, open, high, low, close] = values
  if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) return null
  const quantity = (value: string | null | undefined) =>
    value === null || value === undefined
      ? undefined
      : typeof value === 'string' &&
          value.trim() &&
          Number.isFinite(Number(value)) &&
          Number(value) >= 0
        ? Number(value)
        : Number.NaN
  const volume = quantity(row.volume)
  const openInterest = quantity(row.openInterest)
  if (Number.isNaN(volume) || Number.isNaN(openInterest)) return null
  return {
    time,
    open,
    high,
    low,
    close,
    ...(volume !== undefined && Number.isFinite(volume) ? { volume } : {}),
    ...(openInterest !== undefined ? { openInterest } : {}),
  }
}
interface Consumer {
  signal?: AbortSignal
  abort: () => void
  resolve: (bars: Bar[]) => void
  reject: (error: unknown) => void
  settled: boolean
}
interface Query {
  key: string
  from?: number
  to?: number
  controller: AbortController
  consumers: Set<Consumer>
}
export type DatasetVersionFeed = DataFeed & { dispose(): void }
const cancelled = () => new DOMException('The saved chart request was cancelled.', 'AbortError')

/** One page owns this queue; settled bars and queries are never cached globally. */
export function createDatasetVersionFeed(
  version: DatasetVersion,
  fetchBars = dataLibrary.bars
): DatasetVersionFeed {
  const queries = new Map<string, Query>()
  const waiting: Query[] = []
  let active: Query | undefined
  let consumers = 0
  let disposed = false
  function remove(query: Query) {
    if (queries.get(query.key) === query) queries.delete(query.key)
    const index = waiting.indexOf(query)
    if (index !== -1) waiting.splice(index, 1)
  }
  function settle(query: Query, consumer: Consumer, error?: unknown, bars?: Bar[]) {
    if (consumer.settled) return
    consumer.settled = true
    consumer.signal?.removeEventListener('abort', consumer.abort)
    query.consumers.delete(consumer)
    consumers--
    if (error !== undefined) consumer.reject(error)
    else consumer.resolve((bars ?? []).map((bar) => ({ ...bar })))
  }
  function pump() {
    if (disposed || active) return
    const query = waiting.shift()
    if (!query) return
    if (!query.consumers.size) {
      remove(query)
      pump()
      return
    }
    active = query
    void (async () => {
      try {
        const result = await fetchBars(version.id, {
          ...(query.from !== undefined ? { from: query.from } : {}),
          ...(query.to !== undefined ? { to: query.to } : {}),
          limit: 50000,
          signal: query.controller.signal,
        })
        if (result.versionId !== version.id || result.checksum !== version.checksum)
          throw new Error(
            'The returned history does not match this saved dataset version. Reopen it from Data Library.'
          )
        const bars = result.bars.map(datasetBar)
        if (bars.some((bar) => bar === null))
          throw new Error(
            'The saved history returned an invalid candle. Reopen its quality report in Data Library.'
          )
        const sorted = (bars as Bar[]).sort((a, b) => a.time - b.time)
        for (const consumer of [...query.consumers]) settle(query, consumer, undefined, sorted)
      } catch (error) {
        for (const consumer of [...query.consumers]) settle(query, consumer, error)
      } finally {
        remove(query)
        if (active === query) active = undefined
        pump()
      }
    })()
  }
  return {
    async getBars(request: BarsRequest): Promise<Bar[]> {
      if (disposed || request.signal?.aborted) throw cancelled()
      if (
        request.symbol !== version.metadata.symbol ||
        request.exchange !== version.metadata.exchange ||
        request.interval !== version.metadata.interval
      )
        throw new Error(
          'This chart is pinned to its saved dataset and native interval. Choose another version in Data Library.'
        )
      // At most one active consumer plus sixteen waiting loads; identical loads share I/O.
      if (consumers >= 17)
        throw new Error(
          'This chart has too many pending saved-data loads. Wait for existing panes to finish before loading another window.'
        )
      const from = Number.isFinite(request.from) ? request.from : undefined
      const to = Number.isFinite(request.to) ? request.to : undefined
      const key = JSON.stringify([from, to])
      let query = queries.get(key)
      if (!query) {
        query = { key, from, to, controller: new AbortController(), consumers: new Set() }
        queries.set(key, query)
        waiting.push(query)
      }
      const load = query
      return new Promise<Bar[]>((resolve, reject) => {
        const consumer: Consumer = {
          signal: request.signal,
          resolve,
          reject,
          settled: false,
          abort: () => {
            settle(load, consumer, cancelled())
            if (!load.consumers.size) {
              remove(load)
              load.controller.abort()
            }
          },
        }
        consumers++
        load.consumers.add(consumer)
        consumer.signal?.addEventListener('abort', consumer.abort, { once: true })
        if (consumer.signal?.aborted) consumer.abort()
        pump()
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const query of [...queries.values()]) {
        for (const consumer of [...query.consumers]) settle(query, consumer, cancelled())
        query.controller.abort()
      }
      active?.controller.abort()
      queries.clear()
      waiting.length = 0
    },
  }
}
