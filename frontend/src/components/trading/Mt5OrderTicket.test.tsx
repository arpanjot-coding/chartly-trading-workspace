import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/authStore'
import { Mt5OrderTicket } from './Mt5OrderTicket'

const { csrf } = vi.hoisted(() => ({ csrf: vi.fn() }))
vi.mock('@/api/client', () => ({ fetchCSRFToken: csrf }))

const principal = `principal_${'a'.repeat(32)}`
const profileScope = { originId: 'fixture_origin', profileId: 1 }
const request = vi.fn()
const review = {
  token: 'signed-preview',
  sendAvailable: true,
  review: {
    id: '0123456789abcdef0123456789abcdef',
    accountLabel: 'Fixture · demo · ending 4516',
    symbol: 'EURUSD.pro',
    side: 'buy',
    lots: '0.01',
    price: '1.12345',
  },
}

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState({ localPrincipalId: principal })
  csrf.mockReset()
  csrf.mockResolvedValue('fixture-csrf')
  request.mockReset()
  request.mockResolvedValueOnce(Response.json(review))
  vi.stubGlobal('fetch', request)
})

afterEach(() => {
  cleanup()
  useAuthStore.setState({ localPrincipalId: null })
  vi.unstubAllGlobals()
})

async function reviewOrder(readSymbol: () => string, onOutcome = vi.fn()) {
  const user = userEvent.setup()
  render(
    <Mt5OrderTicket
      principal={principal}
      profileScope={profileScope}
      disabled={false}
      readSymbol={readSymbol}
      onOutcome={onOutcome}
    />
  )
  await user.click(screen.getByRole('button', { name: 'MT5 demo order' }))
  await user.type(screen.getByLabelText('Volume in lots'), '0.01')
  await user.click(screen.getByRole('button', { name: 'Review order' }))
  expect(await screen.findByText(review.review.accountLabel)).toBeVisible()
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][0]).toBe('/api/local/v1/mt5-orders/preview')
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject(profileScope)
  return user
}

describe('MT5 order review', () => {
  it('submits only the reviewed token and reports the actual partial fill', async () => {
    const onOutcome = vi.fn()
    const user = await reviewOrder(() => 'EURUSD.pro', onOutcome)
    request.mockResolvedValueOnce(
      Response.json({ receipt: { id: review.review.id, state: 'partially-filled', order: '551' } })
    )
    await user.click(screen.getByRole('button', { name: 'Send demo order' }))
    expect(await screen.findByRole('status')).toHaveTextContent('MT5 reported a partial fill.')
    expect(request.mock.calls[1][0]).toBe('/api/local/v1/mt5-orders/submit')
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ token: review.token })
    expect(onOutcome).toHaveBeenCalledOnce()
  })

  it('requires a fresh review when the chart changes during the CSRF request', async () => {
    let symbol = 'EURUSD.pro'
    const user = await reviewOrder(() => symbol)
    let resolveCsrf!: (value: string) => void
    csrf.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveCsrf = resolve
      })
    )
    await user.click(screen.getByRole('button', { name: 'Send demo order' }))
    symbol = 'GBPUSD'
    resolveCsrf('fixture-csrf')
    expect(await screen.findByRole('alert')).toHaveTextContent('The active chart changed.')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('recovers a lost submit response after reopening with an unavailable chart', async () => {
    const user = await reviewOrder(() => 'EURUSD.pro')
    request.mockRejectedValueOnce(new TypeError('Connection lost'))
    await user.click(screen.getByRole('button', { name: 'Send demo order' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The order outcome is unknown.')
    cleanup()

    render(
      <Mt5OrderTicket
        principal={principal}
        profileScope={null}
        disabled
        readSymbol={() => null}
        onOutcome={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'MT5 demo order' }))
    expect(screen.getByText(/Chartly 0123456789abcdef/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Send demo order' })).toBeNull()
    request.mockResolvedValueOnce(
      Response.json({ receipt: { id: review.review.id, state: 'filled', deal: '552' } })
    )
    await user.click(screen.getByRole('button', { name: 'Check order status' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Deal 552.')
    expect(request.mock.calls[2]).toEqual([
      `/api/local/v1/mt5-orders/receipts/${review.review.id}`,
      expect.objectContaining({ method: 'GET', body: undefined }),
    ])
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('does not open a new ticket on a chart without a saved profile scope', async () => {
    const user = userEvent.setup()
    render(
      <Mt5OrderTicket
        principal={principal}
        profileScope={null}
        disabled={false}
        readSymbol={() => 'EURUSD.pro'}
        onOutcome={vi.fn()}
      />
    )
    const button = screen.getByRole('button', { name: 'MT5 demo order' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(request).not.toHaveBeenCalled()
  })

  it('recovers an unresolved receipt found by the server and submits an exact ticket for reconciliation', async () => {
    request.mockReset()
    request.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            message: 'This account has an unresolved demo order.',
            issues: [{ requestId: review.review.id }],
          },
        },
        { status: 409 }
      )
    )
    const user = userEvent.setup()
    render(
      <Mt5OrderTicket
        principal={principal}
        profileScope={profileScope}
        disabled={false}
        readSymbol={() => 'EURUSD.pro'}
        onOutcome={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'MT5 demo order' }))
    await user.type(screen.getByLabelText('Volume in lots'), '0.01')
    await user.click(screen.getByRole('button', { name: 'Review order' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('unresolved demo order')
    expect(screen.queryByRole('button', { name: 'Send demo order' })).toBeNull()
    const ticket = '9007199254741021'
    await user.type(screen.getByLabelText('MT5 order ticket'), ticket)
    request.mockResolvedValueOnce(
      Response.json({ receipt: { id: review.review.id, state: 'filled', order: ticket } })
    )
    await user.click(screen.getByRole('button', { name: 'Reconcile with MT5' }))
    expect(await screen.findByRole('status')).toHaveTextContent(`Order ${ticket}.`)
    expect(request.mock.calls[1][0]).toBe(
      `/api/local/v1/mt5-orders/receipts/${review.review.id}/reconcile`
    )
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ orderTicket: ticket })
  })

  it('requires a fresh review when a different profile opens the same symbol', async () => {
    const user = userEvent.setup()
    const props = {
      principal,
      disabled: false,
      readSymbol: () => 'EURUSD.pro',
      onOutcome: vi.fn(),
    }
    const { rerender } = render(<Mt5OrderTicket {...props} profileScope={profileScope} />)
    await user.click(screen.getByRole('button', { name: 'MT5 demo order' }))
    await user.type(screen.getByLabelText('Volume in lots'), '0.01')
    await user.click(screen.getByRole('button', { name: 'Review order' }))
    expect(await screen.findByText(review.review.accountLabel)).toBeVisible()
    rerender(<Mt5OrderTicket {...props} profileScope={{ ...profileScope, profileId: 2 }} />)
    await user.click(screen.getByRole('button', { name: 'Send demo order' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The active chart changed.')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
