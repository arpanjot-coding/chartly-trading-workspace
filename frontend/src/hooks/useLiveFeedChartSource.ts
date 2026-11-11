import { useEffect, useMemo } from 'react'
import type { Mt5ProfileScope } from '@/api/marketData'
import type { LiveFeedChartContext } from '@/lib/trading/chartContext'
import {
  createLiveFeedChartSource,
  type LiveFeedChartSource,
} from '@/lib/trading/liveFeedChartSource'

export function useLiveFeedChartSource(
  config: LiveFeedChartContext | undefined,
  principalId: string,
  prepared?: LiveFeedChartSource,
  mt5Profile?: Mt5ProfileScope | null
): LiveFeedChartSource | undefined {
  const {
    providerId = '',
    providerName = '',
    symbol = '',
    exchange = '',
    interval = '',
  } = config ?? {}
  const originId = providerId === 'mt5' ? mt5Profile?.originId : undefined
  const profileId = providerId === 'mt5' ? mt5Profile?.profileId : undefined
  const intervalKey = config?.intervals.join(' ') ?? ''
  const source = useMemo(() => {
    if (!providerId || !principalId) return undefined
    if (
      prepared &&
      prepared.principalId === principalId &&
      prepared.providerId === providerId &&
      prepared.symbol === symbol &&
      prepared.exchange === exchange &&
      prepared.interval === interval &&
      prepared.mt5Profile?.originId === originId &&
      prepared.mt5Profile?.profileId === profileId &&
      prepared.intervals.join(' ') === intervalKey
    )
      return prepared
    return createLiveFeedChartSource(
      {
        providerId,
        providerName,
        symbol,
        exchange,
        interval,
        intervals: intervalKey ? intervalKey.split(' ') : [],
        ...(originId && profileId ? { mt5Profile: { originId, profileId } } : {}),
      },
      principalId
    )
  }, [
    providerId,
    providerName,
    symbol,
    exchange,
    interval,
    intervalKey,
    principalId,
    prepared,
    originId,
    profileId,
  ])
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
