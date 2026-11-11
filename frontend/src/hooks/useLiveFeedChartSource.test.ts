import { renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { liveFeedIntervals } from '@/lib/chart/feeds/platformFeed'
import { createLiveFeedChartSource } from '@/lib/trading/liveFeedChartSource'
import { useLiveFeedChartSource } from './useLiveFeedChartSource'

it('keeps the feed open through a workspace refresh and closes it on a real scope change', async () => {
  const { result, rerender, unmount } = renderHook(
    ({ principal }) =>
      useLiveFeedChartSource(
        {
          providerId: 'mt5',
          providerName: 'MetaTrader 5',
          symbol: 'EURUSD.pro',
          exchange: 'MT5',
          interval: '15m',
          intervals: liveFeedIntervals('mt5'),
        },
        principal
      ),
    { initialProps: { principal: 'operator-a' }, reactStrictMode: true }
  )
  const first = result.current
  expect(first).toBeDefined()

  rerender({ principal: 'operator-a' })
  await Promise.resolve()
  expect(result.current).toBe(first)

  rerender({ principal: 'operator-b' })
  await Promise.resolve()
  expect(result.current).not.toBe(first)
  await expect(
    first?.provider.requestBars({
      symbol: 'EURUSD.pro',
      exchange: 'MT5',
      interval: '15m',
      from: 0,
      to: 1,
    })
  ).rejects.toThrow(/closed/i)
  unmount()
})

it('adopts a prepared source only for its exact account and target and disposes it on close', async () => {
  const config = {
    providerId: 'mt5',
    providerName: 'MT5',
    symbol: 'EURUSD',
    exchange: 'MT5',
    interval: '15m',
    intervals: ['15m'],
  }
  const prepared = createLiveFeedChartSource(config, 'operator-a')
  const dispose = vi.fn(prepared.dispose)
  const source = { ...prepared, dispose }
  const hook = renderHook(({ principal }) => useLiveFeedChartSource(config, principal, source), {
    initialProps: { principal: 'operator-a' },
  })
  expect(hook.result.current).toBe(source)
  hook.rerender({ principal: 'operator-b' })
  await Promise.resolve()
  expect(hook.result.current).not.toBe(source)
  expect(dispose).toHaveBeenCalledOnce()
  hook.unmount()
})
