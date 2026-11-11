import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CustomIndicators from './CustomIndicators'

const client = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  downloadSkill: vi.fn(),
}))
const validate = vi.hoisted(() => vi.fn())

vi.mock('@/api/customIndicators', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/customIndicators')>()
  return { ...original, customIndicatorsClient: client }
})
vi.mock('@/lib/trading/validateCustomIndicator', () => ({
  validateCustomIndicatorSource: validate,
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <CustomIndicators />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  client.list.mockResolvedValue([{ file: 'open_range_breakout.js', bytes: 2048, mtime: 1 }])
  client.create.mockResolvedValue({ file: 'my_sma.js', bytes: 900, replaced: false })
  validate.mockResolvedValue({
    ok: true,
    errors: [],
    indicators: [{ id: 'my-sma', name: 'My SMA', placement: 'onchart' }],
  })
})

describe('CustomIndicators settings page', () => {
  it('lists stored indicators and warns that they run unsandboxed', async () => {
    renderPage()
    expect(await screen.findByText('open_range_breakout.js')).toBeInTheDocument()
    expect(screen.getByText(/full app privileges/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download SKILL.md/ })).toBeInTheDocument()
  })

  it('gates saving on a passing validation of the current text', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('open_range_breakout.js')
    await user.click(screen.getByRole('button', { name: /Moving average/ }))

    const save = screen.getByRole('button', { name: 'Save indicator' })
    expect(save).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Validate' }))
    await screen.findByText('Validation passed')
    expect(save).toBeEnabled()

    await user.click(save)
    await waitFor(() =>
      expect(client.create).toHaveBeenCalledWith('my_sma.js', expect.stringContaining('my-sma'))
    )
    expect(await screen.findByText(/Saved my_sma.js/)).toBeInTheDocument()
  })

  it('keeps saving blocked when validation fails and shows the errors', async () => {
    validate.mockResolvedValue({
      ok: false,
      errors: ["placement must be 'onchart' or 'pane'"],
      indicators: [],
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('open_range_breakout.js')
    await user.click(screen.getByRole('button', { name: /Moving average/ }))
    await user.click(screen.getByRole('button', { name: 'Validate' }))
    expect(await screen.findByText('Validation failed')).toBeInTheDocument()
    expect(screen.getByText(/placement must be/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save indicator' })).toBeDisabled()
    expect(client.create).not.toHaveBeenCalled()
  })
})
