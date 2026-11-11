import { useEffect, useMemo } from 'react'
import type { DatasetVersion } from '@/api/dataLibrary'
import { createDatasetChartSource, type DatasetChartSource } from '@/lib/trading/chartSource'

/** Effect replay keeps the current source alive; a real exit closes only its own source. */
export function useDatasetChartSource(
  dataset?: DatasetVersion,
  window?: { from: number; to: number },
  prepared?: DatasetChartSource
) {
  const from = window?.from,
    to = window?.to
  const source = useMemo(
    () =>
      dataset
        ? prepared?.versionId === dataset.id &&
          prepared.checksum === dataset.checksum &&
          prepared.from === Math.max(dataset.start, from ?? dataset.start) &&
          prepared.to === Math.min(dataset.end, to ?? dataset.end)
          ? prepared
          : createDatasetChartSource(dataset, {
              window: from !== undefined && to !== undefined ? { from, to } : undefined,
            })
        : undefined,
    [dataset, from, to, prepared]
  )
  const lifetime = useMemo(() => ({ source, generation: 0 }), [source])
  useEffect(() => {
    const generation = ++lifetime.generation
    return () => {
      queueMicrotask(() => {
        if (lifetime.generation === generation) lifetime.source?.dispose()
      })
    }
  }, [lifetime])
  return source
}
