import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { marketData } from '@/api/marketData'
import { useFeedQuotes } from './useFeedQuotes'

vi.mock('@/api/marketData', () => ({
  marketData: { quote: vi.fn(), quotes: vi.fn() },
}))

const source = {
  providerId: 'binance',
  providerName: 'Binance',
  exchange: 'BINANCE',
  principalId: 'owner-one',
}

describe('useFeedQuotes', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
    vi.useRealTimers()
  })

  it('uses one request per 50-symbol cycle and never overlaps a slow cycle', async () => {
    vi.useFakeTimers()
    const items = Array.from({ length: 50 }, (_, index) => ({
      exchange: 'BINANCE',
      symbol: `BTC${index}`,
    }))
    const symbols = items.map(({ symbol }) => symbol)
    let reply!: (result: Awaited<ReturnType<typeof marketData.quotes>>) => void
    const batch = vi.mocked(marketData.quotes)
    batch.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve
        })
    )
    const { result, rerender, unmount } = renderHook(({ feed }) => useFeedQuotes(items, feed), {
      initialProps: { feed: source },
    })
    expect(batch).toHaveBeenCalledWith('binance', symbols, 'owner-one', expect.any(AbortSignal))
    expect(marketData.quote).not.toHaveBeenCalled()

    rerender({ feed: { ...source } })
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(batch).toHaveBeenCalledTimes(1)
    const quotes = symbols.map((symbol, index) => ({
      source: 'binance',
      symbol,
      price: String(index + 1),
      observedAtMs: null,
    }))
    await act(async () => reply({ quotes, missing: [] }))
    expect(result.current.state).toBe('current')
    expect(result.current.prices.get('BINANCE:BTC49')).toBe(50)

    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(batch).toHaveBeenCalledTimes(2)
    const lastSignal = batch.mock.calls[1][3]
    unmount()
    expect(lastSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains last valid prices during a partial update and clears them when the principal changes', async () => {
    vi.useFakeTimers()
    const items = ['BTCUSDT', 'ETHUSDT'].map((symbol) => ({ exchange: 'BINANCE', symbol }))
    const quotes = [
      { source: 'binance', symbol: 'BTCUSDT', price: '15', observedAtMs: null },
      { source: 'binance', symbol: 'ETHUSDT', price: '7.25', observedAtMs: null },
    ]
    const batch = vi.mocked(marketData.quotes)
    batch.mockResolvedValueOnce({ quotes, missing: [] })
    batch.mockResolvedValueOnce({
      quotes: [
        { ...quotes[0], price: '16' },
        { ...quotes[1], source: 'other' },
      ],
      missing: ['ETHUSDT'],
    })
    let reply!: (result: Awaited<ReturnType<typeof marketData.quotes>>) => void
    batch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve
        })
    )
    batch.mockImplementation(() => new Promise(() => {}))

    const { result, rerender } = renderHook(({ feed }) => useFeedQuotes(items, feed), {
      initialProps: { feed: source },
    })
    await act(async () => {})
    expect(result.current.state).toBe('current')
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(result.current.state).toBe('partial')
    expect(result.current.prices.get('BINANCE:BTCUSDT')).toBe(16)
    expect(result.current.prices.get('BINANCE:ETHUSDT')).toBe(7.25)

    await act(() => vi.advanceTimersByTimeAsync(5000))
    const previousSignal = batch.mock.calls[2][3]
    rerender({ feed: { ...source, principalId: 'owner-two' } })
    expect(previousSignal?.aborted).toBe(true)
    expect(result.current.prices.size).toBe(0)
    await act(async () => reply({ quotes, missing: [] }))
    expect(result.current.prices.size).toBe(0)
  })
})
