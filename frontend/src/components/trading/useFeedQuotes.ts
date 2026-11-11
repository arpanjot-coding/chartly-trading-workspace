/**
 * Watchlist prices from the chart's own platform feed.
 *
 * The legacy price hook reads the Indian-broker websocket/multiquote
 * stack, which knows nothing about MT5 or crypto-venue symbols. On a
 * live-feed chart the watchlist instead polls the same market-data
 * API the candles came from, so a row's price is the feed the user
 * actually connected — the whole point of bringing your own platform.
 *
 * Only the last price is available this way (feed quotes carry no
 * previous close), so day change stays blank rather than invented.
 */

import { useEffect, useState } from 'react'
import {
  MarketDataError,
  type MarketQuote,
  type Mt5ProfileScope,
  marketData,
} from '@/api/marketData'
import { marketProvider, marketSymbol } from '@/lib/chart/marketProviders'

export interface FeedQuoteSource {
  providerId: string
  providerName: string
  exchange: string
  principalId: string
  mt5Profile?: Mt5ProfileScope
}

export interface FeedQuoteItem {
  symbol: string
  exchange: string
}

const REFRESH_MS = 5000
const MAX_SYMBOLS = 50
const CONCURRENCY = 5
const EMPTY_PRICES: ReadonlyMap<string, number> = new Map()
type QuoteState = 'loading' | 'current' | 'partial' | 'reconnecting'

/** Polls feed last prices keyed `EXCHANGE:SYMBOL`, like the legacy map. */
export function useFeedQuotes(
  items: readonly FeedQuoteItem[],
  feed: FeedQuoteSource | null | undefined
) {
  const { providerId, principalId, exchange } = feed ?? {}
  const originId = feed?.mt5Profile?.originId
  const profileId = feed?.mt5Profile?.profileId
  const scope = JSON.stringify([providerId, principalId, exchange, originId, profileId])
  const selected = [
    ...new Set(items.filter((item) => item.exchange === exchange).map((item) => item.symbol)),
  ].slice(0, MAX_SYMBOLS)
  const key = selected.length ? JSON.stringify(selected) : ''
  const [snapshot, setSnapshot] = useState<{
    scope: string
    prices: ReadonlyMap<string, number>
    state: QuoteState
  }>()

  useEffect(() => {
    if (!providerId || !principalId || !exchange || !key) return
    const mt5Profile = originId && profileId ? { originId, profileId } : undefined
    const symbols: string[] = JSON.parse(key)
    const native = new Map(
      symbols.flatMap((symbol) => {
        const normalized = marketSymbol(providerId, symbol)
        return normalized ? [[symbol, normalized] as const] : []
      })
    )
    const requested = [...new Set(native.values())]
    const batch = marketProvider(providerId)?.batchQuotes === true
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let connectionKey: string | undefined

    const publish = (received: ReadonlyMap<string, number>, state: QuoteState) => {
      if (!active) return
      setSnapshot((previous) => {
        const prices = new Map<string, number>()
        for (const [symbol, nativeSymbol] of native) {
          const rowKey = `${exchange}:${symbol}`
          const price =
            received.get(nativeSymbol) ??
            (previous?.scope === scope ? previous.prices.get(rowKey) : undefined)
          if (price !== undefined) prices.set(rowKey, price)
        }
        return { scope, prices, state }
      })
    }
    const visible = () => !document.hidden && navigator.onLine !== false

    const tick = async () => {
      if (!active || controller || !visible() || !requested.length) return
      clearTimeout(timer)
      const ctrl = new AbortController()
      controller = ctrl
      deadline = setTimeout(() => ctrl.abort(), batch ? 15_000 : 60_000)
      const next = new Map<string, number>()
      let bindingUnavailable = false
      const add = (quote: MarketQuote) => {
        if (quote.source !== providerId || !requested.includes(quote.symbol)) return
        const price = Number(quote.price)
        if (Number.isFinite(price) && price > 0) next.set(quote.symbol, price)
      }
      try {
        if (batch) {
          const result = await marketData.quotes(providerId, requested, principalId, ctrl.signal)
          for (const quote of result.quotes) add(quote)
        } else {
          for (let index = 0; index < requested.length; index += CONCURRENCY) {
            const group = requested.slice(index, index + CONCURRENCY)
            const results = await Promise.allSettled(
              group.map((symbol) =>
                mt5Profile
                  ? marketData.quote(providerId, symbol, principalId, ctrl.signal, mt5Profile)
                  : marketData.quote(providerId, symbol, principalId, ctrl.signal)
              )
            )
            if (!active || ctrl.signal.aborted) break
            for (const result of results) {
              if (result.status === 'rejected') {
                const error: unknown = result.reason
                if (
                  error instanceof MarketDataError &&
                  (error.code === 'market.account_changed' ||
                    error.code.startsWith('mt5.profile_binding_'))
                )
                  bindingUnavailable = true
                continue
              }
              const { quote, connectionKey: observedKey } = result.value
              if (mt5Profile) {
                if (!observedKey || (connectionKey && observedKey !== connectionKey)) {
                  bindingUnavailable = true
                  continue
                }
                connectionKey = observedKey
              }
              add(quote)
            }
            if (bindingUnavailable) break
          }
        }
        if (bindingUnavailable) {
          setSnapshot({ scope, prices: EMPTY_PRICES, state: 'reconnecting' })
        } else if (!ctrl.signal.aborted) {
          publish(
            next,
            next.size === requested.length ? 'current' : next.size ? 'partial' : 'reconnecting'
          )
        } else if (visible()) publish(next, next.size ? 'partial' : 'reconnecting')
      } catch {
        if (visible()) publish(EMPTY_PRICES, 'reconnecting')
      } finally {
        clearTimeout(deadline)
        controller = undefined
        if (active && visible()) timer = setTimeout(() => void tick(), REFRESH_MS)
      }
    }

    const onConnectionChange = () => {
      if (visible()) {
        void tick()
        return
      }
      clearTimeout(timer)
      clearTimeout(deadline)
      controller?.abort()
      if (navigator.onLine === false) publish(EMPTY_PRICES, 'reconnecting')
    }
    document.addEventListener('visibilitychange', onConnectionChange)
    window.addEventListener('online', onConnectionChange)
    window.addEventListener('offline', onConnectionChange)
    onConnectionChange()
    return () => {
      active = false
      clearTimeout(timer)
      clearTimeout(deadline)
      controller?.abort()
      document.removeEventListener('visibilitychange', onConnectionChange)
      window.removeEventListener('online', onConnectionChange)
      window.removeEventListener('offline', onConnectionChange)
    }
  }, [providerId, principalId, exchange, scope, key, originId, profileId])

  return snapshot?.scope === scope && key
    ? snapshot
    : { prices: EMPTY_PRICES, state: 'loading' as const }
}
