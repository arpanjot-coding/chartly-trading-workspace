/**
 * Chart alert delivery is local: sound and desktop notification only.
 *
 * External delivery belongs in Flow's explicit HTTP/webhook nodes. These
 * checks also pin the migration rule for alerts stored by older releases:
 * retired outward-channel flags are ignored rather than resurrected.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DELIVERY, deliverAlert, deliveryOf } from './alertDelivery'

const NOTICE = { title: 'EURUSD crossing 1.0850', body: 'Crossed on the close', tag: 'a1' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('local alert delivery defaults', () => {
  it('defaults to sound and desktop notification', () => {
    expect(DEFAULT_DELIVERY).toEqual({ sound: true, notify: true })
  })

  it('reads alerts stored before delivery was a choice as the default', () => {
    expect(deliveryOf(undefined)).toEqual(DEFAULT_DELIVERY)
    expect(deliveryOf({})).toEqual(DEFAULT_DELIVERY)
    expect(deliveryOf({ autoTitle: true })).toEqual(DEFAULT_DELIVERY)
  })

  it('reads the local choices the trader made', () => {
    expect(deliveryOf({ deliver: { sound: false, notify: false } })).toEqual({
      sound: false,
      notify: false,
    })
  })

  it('fills a half-written local delivery from the default', () => {
    expect(deliveryOf({ deliver: { sound: false } })).toEqual({
      sound: false,
      notify: true,
    })
  })

  it('ignores removed outward flags on older stored alerts', () => {
    const legacy: unknown = {
      deliver: { sound: false, notify: false, telegram: true, whatsapp: true },
    }
    expect(deliveryOf(legacy)).toEqual({ sound: false, notify: false })
  })

  it('reads a delivery that is not an object as the default', () => {
    expect(deliveryOf({ deliver: 'yes' })).toEqual(DEFAULT_DELIVERY)
    expect(deliveryOf({ deliver: null })).toEqual(DEFAULT_DELIVERY)
  })
})

describe('delivering locally', () => {
  it('makes no network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const accepted = await deliverAlert({ sound: false, notify: false }, NOTICE)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(accepted).toEqual([])
  })
})
