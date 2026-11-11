import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { ReadonlyTradingDock } from './ReadonlyTradingDock'

describe('the original dock in read-only chart mode', () => {
  it('routes paper users to their run account rather than showing broker books as simulated positions', () => {
    const open = vi.fn(),
      fetcher = vi.spyOn(globalThis, 'fetch')
    render(
      <ReadonlyTradingDock
        tab="positions"
        onTabChange={() => {}}
        paperAvailable
        onOpenPaper={open}
      />
    )
    expect(
      screen.getByText(/Paper orders, positions and fills belong to this run/)
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open paper account' }))
    expect(open).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockRestore()
  })
  it('retains all four tabs and arrow-key navigation without account fetches', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch'),
      select = vi.fn()
    render(<ReadonlyTradingDock tab={null} onTabChange={select} />)
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Orders' }), { key: 'End' })
    expect(select).toHaveBeenCalledWith('gtt')
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockRestore()
  })
  it('explains unavailable account commands and does not create a GTT connection', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    render(<ReadonlyTradingDock tab="gtt" onTabChange={() => {}} />)
    expect(screen.getByText(/does not create or manage account orders/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create|Submit|Buy|Sell/ })).not.toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockRestore()
  })
})
