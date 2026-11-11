/**
 * Validate a custom indicator draft exactly the way the chart loader will
 * treat it — before anything is saved.
 *
 * The draft is staged on the server and imported from its same-origin
 * preview URL (the app CSP is script-src 'self', which refuses data:
 * and blob: module imports — the same reason the chart loader fetches
 * saved files over HTTP). It is never registered into the real
 * catalogue: its factory is called with the real charting API, every
 * descriptor is checked with the loader's own `descriptorErrors`, and
 * each `calc` runs over sample bars with its default settings, checked
 * with `calcOutputError`. A draft that passes here registers and draws;
 * one that fails says why, in the loader's own words.
 */
import { customIndicatorsClient } from '@/api/customIndicators'
import { calcOutputError, descriptorErrors } from '@/lib/trading/customIndicators'

/** Turns draft source into an importable module URL. Injectable for tests. */
export type StageSource = (source: string) => Promise<string>

const stageOnServer: StageSource = (source) => customIndicatorsClient.stagePreview(source)

export interface ValidatedDescriptor {
  id: string
  name: string
  placement: string
}

export interface IndicatorValidation {
  ok: boolean
  errors: string[]
  indicators: ValidatedDescriptor[]
}

interface SampleBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function sampleBars(count = 120): SampleBar[] {
  const bars: SampleBar[] = []
  let price = 100
  for (let i = 0; i < count; i += 1) {
    const drift = Math.sin(i / 7) * 0.6 + (i % 5 === 0 ? 0.4 : -0.1)
    const open = price
    const close = price + drift
    bars.push({
      time: 1_700_000_000 + i * 3600,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 1000 + (i % 17) * 37,
    })
    price = close
  }
  return bars
}

export async function validateCustomIndicatorSource(
  source: string,
  stageSource: StageSource = stageOnServer
): Promise<IndicatorValidation> {
  const errors: string[] = []
  const indicators: ValidatedDescriptor[] = []
  if (!source.trim()) return { ok: false, errors: ['The source is empty.'], indicators }

  let factory: unknown
  try {
    const url = await stageSource(source)
    const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown }
    factory = mod.default
  } catch (cause) {
    return {
      ok: false,
      errors: [
        `The file does not parse as a module: ${cause instanceof Error ? cause.message : String(cause)}`,
      ],
      indicators,
    }
  }
  if (typeof factory !== 'function') {
    return { ok: false, errors: ['The module has no default-exported function.'], indicators }
  }

  const core = await import('chartly-charts')
  const api: Record<string, unknown> = {
    ...core,
    ...(await import('chartly-charts/indicators')),
  }
  const bars = sampleBars()

  try {
    await (factory as (api: Record<string, unknown>) => unknown)({
      ...api,
      registerIndicator: (descriptor: Record<string, unknown>) => {
        if (typeof descriptor !== 'object' || descriptor === null) {
          errors.push('registerIndicator needs a descriptor object')
          return
        }
        const problems = descriptorErrors(descriptor)
        if (problems.length > 0) {
          errors.push(...problems)
          return
        }
        const settings: Record<string, unknown> = {}
        for (const input of (descriptor.inputs as { key: string; default: unknown }[]) ?? []) {
          settings[input.key] = input.default
        }
        try {
          const values = (descriptor.calc as (...args: unknown[]) => unknown)(bars, settings, {})
          const problem = calcOutputError(
            values,
            bars.length,
            descriptor.plots as { key: string }[]
          )
          if (problem) errors.push(`${String(descriptor.id)}: ${problem}`)
          else
            indicators.push({
              id: String(descriptor.id),
              name: String(descriptor.name),
              placement: String(descriptor.placement),
            })
        } catch (cause) {
          errors.push(
            `${String(descriptor.id)}: calc threw on sample bars: ${cause instanceof Error ? cause.message : String(cause)}`
          )
        }
      },
    })
  } catch (cause) {
    errors.push(
      `The factory threw while registering: ${cause instanceof Error ? cause.message : String(cause)}`
    )
  }

  if (indicators.length === 0 && errors.length === 0) {
    errors.push('The module never called registerIndicator.')
  }
  return { ok: errors.length === 0 && indicators.length > 0, errors, indicators }
}
