import { describe, expect, it, vi } from 'vitest'
import { TradingTerminal } from './terminal'

function fixture() {
  const canvas = {
    toBlob: vi.fn((callback: (blob: Blob) => void) =>
      callback(new Blob(['image'], { type: 'image/png' }))
    ),
  }
  const chart = {
    removePrimitive: vi.fn(),
    addPrimitive: vi.fn(),
    takeScreenshot: vi.fn(() => canvas),
  }
  const terminal = Object.assign(Object.create(TradingTerminal.prototype), {
    chart,
    sym: { symbol: 'EXAMPLE' },
    interval: '1m',
    destroyed: false,
    screenshotExcluded: [],
    draw: null,
    paintLegend: vi.fn(),
  }) as TradingTerminal
  return { terminal, chart, canvas }
}

describe('terminal capture boundary for an authoritative paper clock', () => {
  it('rejects a held clock before compositing, including the camera save path', async () => {
    const { terminal, chart } = fixture()
    terminal.setSnapshotGuard(() => null)
    await expect(terminal.snapshotPng()).resolves.toBeNull()
    await terminal.screenshot()
    expect(chart.takeScreenshot).not.toHaveBeenCalled()
  })
  it('discards a snapshot if the committed clock changes while waiting for the chart repaint', async () => {
    const { terminal, chart } = fixture()
    let identity: string | null = 'revision-1'
    terminal.setSnapshotGuard(() => identity)
    const result = terminal.snapshotPng()
    identity = null
    await expect(result).resolves.toBeNull()
    expect(chart.takeScreenshot).not.toHaveBeenCalled()
  })
  it('discards an already composited PNG if its clock changes during blob encoding', async () => {
    const { terminal, chart, canvas } = fixture()
    let identity = 'revision-1'
    let encoded!: (blob: Blob) => void
    canvas.toBlob.mockImplementation((callback) => {
      encoded = callback
    })
    terminal.setSnapshotGuard(() => identity)
    const result = terminal.snapshotPng()
    await vi.waitFor(() => expect(chart.takeScreenshot).toHaveBeenCalledOnce())
    identity = 'revision-2'
    encoded(new Blob(['image'], { type: 'image/png' }))
    await expect(result).resolves.toBeNull()
  })
  it('captures an acknowledged unchanged clock', async () => {
    const { terminal } = fixture()
    terminal.setSnapshotGuard(() => 'revision-1')
    await expect(terminal.snapshotPng()).resolves.toBeInstanceOf(File)
  })
})
