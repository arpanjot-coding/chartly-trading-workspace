import { describe, expect, it, vi } from 'vitest'
import type { SearchRow } from '@/lib/trading/terminal'
import { act, fireEvent, render, screen, userEvent, waitFor } from '@/test/test-utils'
import { SymbolSearchDialog } from './SymbolSearchDialog'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { resolve, promise }
}
const row = (name: string, version = name): SearchRow => ({
  symbol: 'EXAMPLE',
  exchange: 'LOCAL',
  name,
  datasetVersionId: version,
})
const searchBox = () => screen.getByRole('textbox', { name: 'Search symbol' })

describe('source-aware symbol search lifecycle', () => {
  it.each([
    {
      sourceKind: 'connected' as const,
      mode: 'symbol' as const,
      description:
        'Search instruments available from the connected data source and choose one for this chart.',
    },
    {
      sourceKind: 'dataset' as const,
      mode: 'symbol' as const,
      description:
        'Search instruments in the selected saved dataset version and choose one for this chart.',
    },
    {
      sourceKind: 'dataset' as const,
      mode: 'comparison' as const,
      description:
        'Search instruments in the selected saved dataset version and choose one to compare with this chart.',
    },
  ])('describes the $sourceKind $mode dialog to assistive technology', ({
    description,
    ...props
  }) => {
    render(
      <SymbolSearchDialog
        {...props}
        open
        search={async () => []}
        onOpenChange={() => {}}
        onPick={() => {}}
      />
    )
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(description)
  })
  it('reports a rejected source search, stops loading and retries the same query', async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new Error('technical provider failure'))
      .mockResolvedValue([row('Recovered source')])
    render(
      <SymbolSearchDialog
        open
        initialQuery="EXAMPLE"
        search={search}
        onOpenChange={() => {}}
        onPick={() => {}}
      />
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Symbols could not be loaded')
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument()
    expect(screen.queryByText('technical provider failure')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try search again' }))
    expect(await screen.findByText('Recovered source')).toBeVisible()
    expect(search).toHaveBeenCalledTimes(2)
  })
  it('invalidates the pending query immediately when the input is cleared', async () => {
    const pending = deferred<SearchRow[]>()
    const search = vi.fn(() => pending.promise)
    render(
      <SymbolSearchDialog
        open
        initialQuery="EXAMPLE"
        search={search}
        onOpenChange={() => {}}
        onPick={() => {}}
      />
    )
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    const signal = search.mock.calls[0][3] as AbortSignal
    fireEvent.change(searchBox(), { target: { value: '' } })
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve([row('Old response')]))
    expect(screen.queryByText('Old response')).not.toBeInTheDocument()
    expect(screen.getByText('Type to search symbols')).toBeVisible()
  })
  it('cannot apply an old completion after the data source changes', async () => {
    const pending = deferred<SearchRow[]>()
    const first = vi.fn(() => pending.promise)
    const next = vi.fn(async () => [row('Current source')])
    const common = { open: true, initialQuery: 'EXAMPLE', onOpenChange: () => {}, onPick: () => {} }
    const view = render(<SymbolSearchDialog {...common} sourceKey="old" search={first} />)
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1))
    const signal = first.mock.calls[0][3] as AbortSignal
    view.rerender(<SymbolSearchDialog {...common} sourceKey="new" search={next} />)
    expect(signal.aborted).toBe(true)
    expect(await screen.findByText('Current source')).toBeVisible()
    await act(async () => pending.resolve([row('Old source')]))
    expect(screen.queryByText('Old source')).not.toBeInTheDocument()
  })
  it('aborts and ignores a request after close, including a subsequent reopen', async () => {
    const pending = deferred<SearchRow[]>()
    const search = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue([row('Reopened source')])
    const common = { initialQuery: 'EXAMPLE', search, onOpenChange: () => {}, onPick: () => {} }
    const view = render(<SymbolSearchDialog {...common} open />)
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    const signal = search.mock.calls[0][3] as AbortSignal
    view.rerender(<SymbolSearchDialog {...common} open={false} />)
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve([row('Closed response')]))
    view.rerender(<SymbolSearchDialog {...common} open />)
    expect(await screen.findByText('Reopened source')).toBeVisible()
    expect(screen.queryByText('Closed response')).not.toBeInTheDocument()
  })
  it('cancels its owned signal on unmount without leaving transport listeners active', async () => {
    const pending = deferred<SearchRow[]>()
    const search = vi.fn(() => pending.promise)
    const view = render(
      <SymbolSearchDialog
        open
        initialQuery="EXAMPLE"
        search={search}
        onOpenChange={() => {}}
        onPick={() => {}}
      />
    )
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    const signal = search.mock.calls[0][3] as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve([row('Unmounted response')]))
  })
  it('keeps two source versions with the same symbol and venue distinct through keyboard selection', async () => {
    const onPick = vi.fn()
    const search = vi.fn(async () => [row('Provider A · v1', 'one'), row('Provider B · v2', 'two')])
    render(
      <SymbolSearchDialog
        open
        initialQuery="EXAMPLE"
        sourceKind="dataset"
        allowExpressions={false}
        exchanges={['LOCAL']}
        search={search}
        onOpenChange={() => {}}
        onPick={onPick}
      />
    )
    expect(await screen.findByText('Provider A · v1')).toBeVisible()
    expect(screen.getByText('Provider B · v2')).toBeVisible()
    fireEvent.keyDown(searchBox(), { key: 'ArrowDown' })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ datasetVersionId: 'two' }))
    expect(screen.queryByRole('button', { name: 'Divide' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Index' })).not.toBeInTheDocument()
  })
  it('shows local import/source recovery without accepting a synthetic expression', async () => {
    const picked = vi.fn()
    render(
      <SymbolSearchDialog
        open
        sourceKind="dataset"
        allowExpressions={false}
        sourceAction={<a href="/historify">Choose saved history</a>}
        search={async () => []}
        onOpenChange={() => {}}
        onPick={picked}
      />
    )
    await waitFor(() => expect(searchBox()).toHaveFocus())
    fireEvent.change(searchBox(), { target: { value: 'EXAMPLE/OTHER' } })
    expect(
      await screen.findByText(
        'No matching instrument in this saved version. Choose or import another source in Data Library.'
      )
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Choose saved history' })).toHaveAttribute(
      'href',
      '/historify'
    )
    fireEvent.keyDown(searchBox(), { key: 'Enter' })
    expect(picked).not.toHaveBeenCalled()
  })
})
