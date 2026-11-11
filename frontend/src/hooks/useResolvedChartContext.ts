import { useEffect, useMemo, useState } from 'react'
import type { DatasetVersion } from '@/api/dataLibrary'
import { dataLibrary } from '@/api/dataLibrary'
import { useTraderData } from '@/lib/trader/useTraderData'
import {
  type ResolvedChartContext,
  readChartQuery,
  resolveChartContext,
  selectedChartRecords,
} from '@/lib/trading/chartContext'
import { chartStorageAccount, useAuthStore } from '@/stores/authStore'

export function useResolvedChartContext(params: URLSearchParams) {
  const principal = useAuthStore(chartStorageAccount)
  const data = useTraderData()
  const queryText = params.toString()
  const selection = useMemo(() => {
    try {
      const query = readChartQuery(new URLSearchParams(queryText))
      if (query.profileId && data.storageMode === 'backend' && data.principalId !== principal)
        return { loading: true as const }
      if (
        query.profileId &&
        data.loading &&
        !data.portfolios.some((row) => row.id === query.profileId)
      )
        return { loading: true as const }
      if ((query.profileId || query.runId || query.tradeId) && data.error)
        return { error: data.error }
      return {
        query,
        records: selectedChartRecords(query, {
          portfolios: data.portfolios,
          sessions: data.sessions,
          trades: data.trades,
          bookAssignments: data.bookAssignments,
          books: data.books,
          storageMode: data.storageMode,
        }),
      }
    } catch (cause) {
      return {
        error: cause instanceof Error ? cause.message : 'This chart context could not be read.',
      }
    }
  }, [
    queryText,
    principal,
    data.principalId,
    data.storageMode,
    data.loading,
    data.error,
    data.portfolios,
    data.sessions,
    data.trades,
    data.bookAssignments,
    data.books,
  ])
  const datasetId = selection.records?.datasetId
  const runVerificationId = selection.records?.runVerificationId
  const [version, setVersion] = useState<{
    key: string
    value?: DatasetVersion
    runValue?: DatasetVersion
    error?: string
  }>()
  const versionKey = `${principal}:${datasetId ?? ''}:${runVerificationId ?? ''}`
  const [retry, setRetry] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit retry rechecks retained source after a failed read
  useEffect(() => {
    if (!datasetId || !principal) return
    const controller = new AbortController()
    setVersion(undefined)
    void Promise.all([
      dataLibrary.version(datasetId, controller.signal),
      runVerificationId
        ? dataLibrary.version(runVerificationId, controller.signal)
        : Promise.resolve(undefined),
    ])
      .then(([value, runValue]) => {
        const quarantine = value.quarantine ?? runValue?.quarantine
        if (quarantine) throw new Error(quarantine.message)
        if (!controller.signal.aborted) setVersion({ key: versionKey, value, runValue })
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setVersion({
            key: versionKey,
            error:
              cause instanceof Error
                ? cause.message
                : 'Saved history is unavailable. Review it in Data Library.',
          })
      })
    return () => controller.abort()
  }, [datasetId, runVerificationId, principal, versionKey, retry])
  let context: ResolvedChartContext | undefined
  let error = selection.error
  const loading = selection.loading || (!!datasetId && version?.key !== versionKey)
  if (version?.key === versionKey && version.error) error = version.error
  if (!loading && !error && principal && selection.query && selection.records) {
    try {
      context = resolveChartContext(
        principal,
        selection.query,
        selection.records,
        version?.key === versionKey ? version.value : undefined,
        version?.key === versionKey ? version.runValue : undefined
      )
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The chart context could not be verified.'
    }
  }
  return { context, data, loading, error, retry: () => setRetry((value) => value + 1) }
}
