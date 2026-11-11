/**
 * What happens when an alert fires, beyond drawing a toast.
 *
 * **An alert is a message to somebody who is not looking at the chart**, so the
 * question a trader is really answering when they set one is "how do you want to
 * be told". Chartly's built-in answers are local and chosen per alert: a sound
 * and an operating-system notification. External delivery belongs in Flow's
 * generic HTTP/webhook nodes, where the destination is explicit in the
 * workflow, rather than in bundled messaging bots.
 *
 * **A delivery that fails is never retried.** These run on a price being
 * reached, and a retry loop behind a fired alert is a queue that grows while
 * the market moves. The toast has already happened by the time any of this is
 * attempted, so the alert itself is never lost to a failed sound/notification.
 */

import { notifyIfHidden } from './alertNotify'

/** How a trader asked to be told, stored with the alert itself. */
export interface AlertDelivery {
  /** A short tone. On by default: it is the one that works with the tab behind another window. */
  readonly sound: boolean
  /** The operating system's own notification, shown only while the page is hidden. */
  readonly notify: boolean
}

/**
 * What an alert does when the trader says nothing.
 *
 * Read by every alert stored before this existed, too: a record with no delivery
 * of its own gets this, which is the behaviour it already had plus the sound.
 */
export const DEFAULT_DELIVERY: AlertDelivery = {
  sound: true,
  notify: true,
}

/** The delivery an alert carries, or the default where it carries none. */
export function deliveryOf(payload: unknown): AlertDelivery {
  const held = (payload as { deliver?: Partial<AlertDelivery> } | undefined)?.deliver
  if (held === undefined || held === null || typeof held !== 'object') return DEFAULT_DELIVERY
  const flag = (name: keyof AlertDelivery): boolean =>
    typeof held[name] === 'boolean' ? (held[name] as boolean) : DEFAULT_DELIVERY[name]
  // Older stored alerts may still carry removed outward channel flags.
  // Ignore them and deliver only the still-supported local choices.
  return {
    sound: flag('sound'),
    notify: flag('notify'),
  }
}

/* ── the sound ──────────────────────────────────────────────────────────── */

/**
 * One audio context for the page, built on the first sound and kept.
 *
 * A context per alert is a handle per alert, and a browser caps how many exist
 * before it refuses to make another: a chart left open all day firing a
 * repeating alert would stop making any sound at all, which is the failure mode
 * nobody would connect to the cause.
 */
let context: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (typeof Ctor !== 'function') return null
  try {
    context ??= new Ctor()
    return context
  } catch {
    return null
  }
}

/**
 * Let a sound be made later, from the click that is happening now.
 *
 * A browser starts an audio context suspended and only resumes it inside a user
 * gesture, so the first alert to fire hours later cannot start one: the tone
 * would be silently dropped and the trader would believe the alert never fired.
 * Arming an alert is a click, and it is the gesture this borrows.
 */
export function readySound(): void {
  const ctx = audio()
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {})
}

/**
 * Two short tones, the second higher than the first.
 *
 * Synthesised rather than played from a file. A file is a request that can fail
 * exactly when it is needed, on a page that may have been open since before the
 * network went away, and it is one more asset to serve from an origin that must
 * not be assumed.
 */
export function playAlertSound(): boolean {
  const ctx = audio()
  if (!ctx) return false
  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    const at = ctx.currentTime
    for (const [index, hz] of [880, 1174].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      // Shaped rather than switched: a square edge on a sine is a click, and a
      // click is what a broken speaker sounds like.
      const start = at + index * 0.18
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.18)
    }
    return true
  } catch {
    return false
  }
}

/* ── local delivery ─────────────────────────────────────────────────────── */

/**
 * Compatibility context for existing terminal call sites.
 *
 * Local sound and desktop notifications need no Chartly API key, username, or
 * network request. The fields stay optional and ignored so removing bundled
 * messaging bots does not ripple credential plumbing through the terminal.
 */
export interface DeliveryContext {
  readonly apiKey?: string
  readonly username?: string
  readonly onProblem?: (message: string) => void
}

/**
 * Deliver the alert through the local channels the trader asked for.
 *
 * The returned names are what the alert log stores. A channel that could not
 * run is absent, which distinguishes "alert fired but was not heard" from
 * "alert did not fire".
 */
export async function deliverAlert(
  delivery: AlertDelivery,
  notice: { title: string; body: string; tag: string },
  _context: DeliveryContext = {}
): Promise<string[]> {
  const accepted: string[] = []

  if (delivery.sound && playAlertSound()) accepted.push('sound')
  if (delivery.notify && notifyIfHidden(notice)) accepted.push('notification')

  return accepted
}
