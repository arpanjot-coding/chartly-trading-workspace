/**
 * Loads the user's own indicator modules from `strategies/indicators` and lets
 * them register into the chartly-charts catalogue.
 *
 * Called from `terminal.ts:loadIndicators` right after the built-in tier, so
 * every path that can reach `chart.addIndicator` (the picker, `addIndicatorById`
 * and `applyIndicators` restoring a saved layout) sees a custom indicator before
 * it looks anything up. Registering after the built-ins also means a custom
 * indicator that reuses a built-in id overrides it rather than being overridden.
 *
 * These modules are fetched at runtime rather than bundled. `frontend/dist` is
 * built by CI from what is committed, and user indicators are deliberately
 * gitignored, so a bundled one would be erased by the next `git pull`. Coming in
 * over HTTP keeps them out of the build entirely: no Node.js, no rebuild, and an
 * upgrade leaves them alone.
 *
 * A module default-exports a function and is handed the charting API, because a
 * runtime module cannot resolve the bare `chartly-charts` specifier the way a
 * bundled import can. Passing the API in is what keeps the user's file free of
 * import paths and CDN URLs.
 *
 * **This module validates what it loads.** The chart runtime is forgiving in the
 * worst way: a column one element short, or a plot key that does not match what
 * `calc` returns, draws nothing at all and raises nothing anywhere. A trader has
 * no compiler and no build step between writing a file and running it, so the
 * checks live here, where the real library already is, and report as toasts.
 */

import {
  getIndicator,
  hasIndicator,
  type IndicatorDescriptor,
  registerIndicator,
} from 'chartly-charts'
import { notifyPreferenceChange } from '@/lib/trader/preferenceEvents'

type ArchivedModule = { file: string; version: string }
type CustomModule = ArchivedModule | { file: string; mtime: number; version?: undefined }

export interface CustomIndicatorLoad {
  /** Modules that registered without throwing, this call only. */
  loaded: string[]
  /** Per-module failures, already formatted for a toast. */
  errors: { file: string; message: string }[]
}

/** Reports a problem found while an indicator is running, not while loading. */
type ProblemReporter = (message: string) => void

const INDEX_URL = '/custom-indicators/index.json'
const FILE_NAME = '[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\\.js'
const VERSION = '[0-9a-f]{64}'
const MODULE_FILE = new RegExp(`^${FILE_NAME}$`)
const MODULE_VERSION = new RegExp(`^${VERSION}$`)
const PIN_PREFIX = 'local-study/'
const PINNED_ID = new RegExp(`^${PIN_PREFIX}(${FILE_NAME})/(${VERSION})/(0|[1-9][0-9]{0,5})$`)

type StudyVersion = ArchivedModule & { ordinal: number }
const pins = new WeakMap<IndicatorDescriptor, StudyVersion>()
const originalIds = new WeakMap<IndicatorDescriptor, string>()

export const isPinnedCustomIndicator = (id: string): boolean => id.startsWith(PIN_PREFIX)

function registerPin(version: StudyVersion, descriptor: IndicatorDescriptor): string {
  const id = `${PIN_PREFIX}${version.file}/${version.version}/${version.ordinal}`
  if (!hasIndicator(id)) {
    const pinned = { ...descriptor, id }
    registerIndicator(pinned)
    originalIds.set(pinned, descriptor.id)
  }
  return id
}

/** Use the current descriptor's version when saving or adding it to a chart. */
export function pinCustomIndicator(id: string): string {
  if (!hasIndicator(id)) return id
  const descriptor = getIndicator(id)
  const version = pins.get(descriptor)
  return version ? registerPin(version, descriptor) : id
}

export function originalCustomIndicatorId(id: string): string {
  return isPinnedCustomIndicator(id) && hasIndicator(id)
    ? (originalIds.get(getIndicator(id)) ?? id)
    : id
}

// The library's IndicatorInput union, and nothing beyond it.
//
// This set once also carried 'session', 'timeframe', 'symbol' and 'price',
// which chartly-charts never defined. Permitting a type nothing renders is
// not neutral: the settings dialog switches on `input.type` with no default
// case, so the row is dropped in silence. The indicator still computes, using
// the default forever, while the control the author wrote never appears and
// the user cannot change it. A session stays a 'text' input the indicator
// parses; a fixed set of choices stays a 'select'.
//
// 2.4.0 added two for real, and IndicatorSettingsDialog renders both:
// 'interval' is a timeframe code the engine can bucket by, and 'time' is a
// wall-clock string in the chart's zone.
const INPUT_TYPES = new Set([
  'number',
  'boolean',
  'color',
  'text',
  'select',
  'source',
  'interval',
  'time',
])
const PLACEMENTS = new Set(['onchart', 'pane'])

let loading: Promise<CustomIndicatorLoad> | null = null

/**
 * Ids present before any user module ran, captured once.
 *
 * A custom indicator that reuses a built-in id silently replaces it for the
 * whole app. That is a legitimate way to override one, but it is far more often
 * an accident: the catalogue has grown to 112, and ids like `t3`, `smma`,
 * `net-volume` and `standard-deviation` arrived recently enough that a user file
 * written before them can shadow one without either side knowing.
 *
 * Snapshotted before the first user module registers, never after, so a file
 * that is edited and re-loaded is not reported against its own earlier
 * registration.
 */
let builtinIds: ReadonlySet<string> | null = null

function isModuleList(value: unknown): value is CustomModule[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => {
      if (typeof item !== 'object' || item === null) return false
      const { file, version, mtime } = item as Record<string, unknown>
      if (typeof file !== 'string' || !MODULE_FILE.test(file)) return false
      return version === undefined
        ? Number.isSafeInteger(mtime)
        : typeof version === 'string' && MODULE_VERSION.test(version)
    })
  )
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Structural checks on a descriptor, run at registration.
 *
 * Anything returned here is fatal: registering a descriptor the chart cannot
 * drive produces a picker entry that breaks when clicked, which is worse than
 * not appearing at all.
 */
export function descriptorErrors(d: Record<string, unknown>): string[] {
  const out: string[] = []
  const id = typeof d.id === 'string' ? d.id : ''
  if (!id.trim()) out.push('descriptor.id must be a non-empty string')
  else if (/\s/.test(id)) out.push(`id '${id}' contains whitespace`)
  if (typeof d.name !== 'string' || d.name.trim() === '') out.push('descriptor.name is required')
  if (!PLACEMENTS.has(d.placement as string)) {
    out.push("placement must be 'onchart' or 'pane'")
  }
  if (typeof d.calc !== 'function') out.push('calc must be a function')

  if (!Array.isArray(d.inputs)) {
    out.push('inputs must be an array (use [] for none)')
  } else {
    for (const input of d.inputs as Record<string, unknown>[]) {
      if (!input || typeof input.key !== 'string' || input.key === '') {
        out.push('every input needs a key')
        break
      }
      if (!INPUT_TYPES.has(input.type as string)) {
        out.push(`input '${input.key}' has unsupported type '${String(input.type)}'`)
      }
      if (input.default === undefined) out.push(`input '${input.key}' has no default`)
    }
  }

  if (!Array.isArray(d.plots) || d.plots.length === 0) {
    out.push('plots must be a non-empty array')
  } else {
    const keys = new Set<string>()
    for (const plot of d.plots as Record<string, unknown>[]) {
      if (!plot || typeof plot.key !== 'string' || plot.key === '') {
        out.push('every plot needs a key')
        break
      }
      if (keys.has(plot.key)) out.push(`duplicate plot key '${plot.key}'`)
      keys.add(plot.key)
      if (typeof plot.type !== 'string' || plot.type === '') {
        out.push(`plot '${plot.key}' needs a type`)
      }
    }
  }
  return out
}

/**
 * Check one `calc` result against the bars it was given.
 *
 * These are the two failures the runtime swallows. It iterates `0..bars.length`
 * and reads `col[i]`, so a short column reads `undefined` past its end and a
 * missing key empties the series. Either way the plot just stops drawing.
 */
export function calcOutputError(
  values: unknown,
  barCount: number,
  plots: { key: string; ohlc?: { open: string; high: string; low: string; close: string } }[]
): string | null {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return 'calc must return an object of columns'
  }
  const cols = values as Record<string, unknown>
  for (const plot of plots) {
    // A candle or bar plot is fed by four named columns rather than one keyed
    // by the plot itself, so check those instead.
    const keys = plot.ohlc
      ? [plot.ohlc.open, plot.ohlc.high, plot.ohlc.low, plot.ohlc.close]
      : [plot.key]
    for (const key of keys) {
      const c = cols[key]
      if (c === undefined) return `calc returned no column '${key}' for plot '${plot.key}'`
      if (!Array.isArray(c)) return `column '${key}' is a ${typeof c}, expected an array`
      if (c.length !== barCount) {
        return `column '${key}' returned ${c.length} values for ${barCount} bars`
      }
    }
    if (plot.ohlc) continue
    const col = cols[plot.key]
    if (col === undefined) {
      return `calc returned no column for plot '${plot.key}', so it draws nothing`
    }
    if (!Array.isArray(col)) {
      return `calc returned a ${typeof col} for plot '${plot.key}', expected an array`
    }
    if (col.length !== barCount) {
      return `plot '${plot.key}' returned ${col.length} values for ${barCount} bars`
    }
  }
  return null
}

/**
 * Wrap `calc` so its first real result is checked against the bars.
 *
 * Only the first call, and only once per indicator: the point is to tell the
 * user why nothing is drawing, not to tax every recompute or repeat the same
 * toast on every tick. `this` is forwarded because a descriptor may call
 * `this.calc` from `calcTail`.
 */
function guardCalc(
  descriptor: Record<string, unknown>,
  file: string,
  onProblem: ProblemReporter
): Record<string, unknown> {
  const original = descriptor.calc as (...args: unknown[]) => unknown
  const plots = descriptor.plots as { key: string }[]
  const label = `${file}: ${String(descriptor.id)}`
  let checked = false

  return {
    ...descriptor,
    calc(this: unknown, ...args: unknown[]) {
      const values = original.apply(this, args)
      if (!checked) {
        checked = true
        const bars = args[0]
        const barCount = Array.isArray(bars) ? bars.length : 0
        // An empty series proves nothing, so wait for real bars.
        if (barCount > 0) {
          const problem = calcOutputError(values, barCount, plots)
          if (problem) onProblem(`${label}: ${problem}`)
        }
      }
      return values
    },
  }
}

/**
 * Imports in flight at once.
 *
 * Every module used to be imported one after the other, each waiting for the
 * previous file's round trip. That was invisible with a handful of files and
 * cost a second or more per few hundred: a folder of 500 held every saved
 * indicator back for three seconds on each reload. The browser keeps a small
 * number of connections per origin anyway, so a few more than that is enough to
 * keep the pipe full without flooding the server.
 */
const CONCURRENCY = 8

/**
 * Where the loader remembers which indicator ids each module registers.
 *
 * Keyed by file and content hash, so an edited file is a new key and nothing stale is
 * trusted. It is learned from the modules themselves as they register, never
 * parsed out of their source, and it is what lets a chart restore without
 * importing every module first: a saved layout names indicator ids, and this
 * says which files provide them.
 */
const MANIFEST_KEY = 'chartly.customIndicators.manifest.v1'

type Manifest = Record<string, string[]>

function readManifest(): Manifest {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: Manifest = {}
    for (const [key, ids] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) out[key] = ids
    }
    return out
  } catch {
    // Private mode, a full quota or a corrupted entry. The manifest is only an
    // accelerator: without it the loader imports everything, as it always did.
    return {}
  }
}

function writeManifest(manifest: Manifest): void {
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest))
    notifyPreferenceChange()
  } catch {
    /* See readManifest: losing the accelerator is never an error. */
  }
}

const revisionOf = (mod: CustomModule) => mod.version ?? mod.mtime
const keyOf = (mod: CustomModule) => `${mod.file}@${revisionOf(mod)}`
const urlOf = (mod: CustomModule) =>
  `/custom-indicators/${encodeURIComponent(mod.file)}?v=${revisionOf(mod)}`

/** Ids each current module registered during this page's life, by revision. */
const learned: Manifest = {}

let active = 0
const waiting: (() => void)[] = []

/**
 * Run `task` once fewer than CONCURRENCY imports are in flight.
 *
 * A finishing task hands its slot straight to the next one waiting rather than
 * freeing it, so a new caller can never slip in between and push the count past
 * the limit.
 */
async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve))
  else active += 1
  try {
    return await task()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else active -= 1
  }
}

/** One module's import, started at most once per revision. */
const imports = new Map<string, Promise<unknown>>()

function importOnce(mod: CustomModule): Promise<unknown> {
  const key = keyOf(mod)
  let pending = imports.get(key)
  if (!pending) {
    pending = limited(() => import(/* @vite-ignore */ urlOf(mod)))
    // Observed here so a failure nobody has awaited yet is not reported as an
    // unhandled rejection; registerOnce turns it into the module's error.
    pending.catch(() => {})
    imports.set(key, pending)
  }
  return pending
}

type Outcome = { descriptors: IndicatorDescriptor[] } | { error: string }

/**
 * Evaluate each module factory once per revision. Publication under the
 * original id belongs to the current catalogue, never to a historical restore.
 */
const registrations = new Map<string, Promise<Outcome>>()

interface LoaderEnv {
  core: typeof import('chartly-charts')
  api: Record<string, unknown>
}

let envPromise: Promise<LoaderEnv> | null = null

function loaderEnv(): Promise<LoaderEnv> {
  if (!envPromise) {
    envPromise = (async () => {
      // The whole surface of both tiers, so a user module can reach `sma`,
      // `rma`, `highest`, `sourceValues`, the timezone helpers and
      // `createTier2Indicator` without importing anything itself.
      const core = await import('chartly-charts')
      const api = { ...core, ...(await import('chartly-charts/indicators')) }
      // After the tier import so every built-in has registered, and before the
      // first user module runs so the snapshot holds built-ins only.
      if (builtinIds === null) {
        builtinIds = new Set(core.registeredIndicators().map((d) => d.id))
      }
      return { core, api }
    })()
    envPromise.catch(() => {
      envPromise = null
    })
  }
  return envPromise
}

function registerOnce(mod: CustomModule, onProblem: ProblemReporter): Promise<Outcome> {
  const key = keyOf(mod)
  const existing = registrations.get(key)
  if (existing) return existing

  const outcome = (async (): Promise<Outcome> => {
    try {
      const [{ api }, loaded] = await Promise.all([loaderEnv(), importOnce(mod)])
      const register = (loaded as { default?: unknown }).default
      if (typeof register !== 'function') {
        throw new Error('module has no default-exported function')
      }

      // Registration is intercepted so a descriptor is checked before it can
      // reach the catalogue, and so `calc` can be wrapped on the way through.
      const descriptors: IndicatorDescriptor[] = []
      await register({
        ...api,
        registerIndicator: (descriptor: Record<string, unknown>) => {
          if (typeof descriptor !== 'object' || descriptor === null) {
            throw new Error('registerIndicator needs a descriptor object')
          }
          const problems = descriptorErrors(descriptor)
          if (problems.length > 0) throw new Error(problems.join('; '))
          // A warning, not an error: overriding a built-in is allowed on
          // purpose, and refusing would break a file that has been doing it
          // deliberately since before the id existed upstream.
          const id = descriptor.id
          if (typeof id === 'string' && builtinIds?.has(id)) {
            onProblem(
              `${mod.file}: id "${id}" replaces the built-in indicator of the same name for the whole app. Rename it unless that override is intended.`
            )
          }
          if (typeof id === 'string' && isPinnedCustomIndicator(id)) {
            throw new Error(`id '${id}' uses the reserved ${PIN_PREFIX} prefix`)
          }
          descriptors.push(
            guardCalc(descriptor, mod.file, onProblem) as unknown as IndicatorDescriptor
          )
        },
      })
      if (descriptors.length === 0) throw new Error('module never called registerIndicator')
      return { descriptors }
    } catch (e) {
      return { error: messageOf(e) }
    } finally {
      imports.delete(key)
    }
  })()
  registrations.set(key, outcome)
  return outcome
}

// One active revision per filename. A historic version can be registered
// under a pin without replacing the catalogue's current descriptor.
const published = new Map<string, string>()
let indexRequest = 0
let indexAccepted = 0
let listed = new Map<string, string>()

/**
 * Register `mods` in the order given, fetching them in parallel.
 *
 * Every import is started up front, within the concurrency limit, and the
 * registrations then run one at a time in index order. Order is the only thing
 * that decides which of two modules registering the same id wins, so fetching
 * in parallel must not change it: the last one in the index still wins, exactly
 * as it did when everything was loaded in sequence.
 *
 * A module another call already claimed is awaited, so this resolves only once
 * everything it was asked for is registered, but it is not reported again.
 */
async function registerInOrder(
  mods: CustomModule[],
  onProblem: ProblemReporter,
  result: CustomIndicatorLoad
): Promise<void> {
  for (const mod of mods) {
    if (!registrations.has(keyOf(mod))) void importOnce(mod)
  }
  for (const mod of mods) {
    const key = keyOf(mod)
    const outcome = await registerOnce(mod, onProblem)
    if (listed.get(mod.file) !== key) continue
    if (published.get(mod.file) === key) continue
    published.set(mod.file, key)
    if ('error' in outcome) {
      result.errors.push({ file: mod.file, message: outcome.error })
      continue
    }
    try {
      outcome.descriptors.forEach((descriptor, ordinal) => {
        registerIndicator(descriptor)
        if (mod.version) pins.set(descriptor, { file: mod.file, version: mod.version, ordinal })
      })
      learned[key] = outcome.descriptors.map((descriptor) => descriptor.id)
      result.loaded.push(mod.file)
    } catch (error) {
      result.errors.push({ file: mod.file, message: messageOf(error) })
    }
  }
}

/** The server's module list, or null when there is none to read. */
async function readIndex(): Promise<CustomModule[] | null> {
  const request = ++indexRequest
  try {
    // Without the Accept header an expired session answers with a 302 to the
    // login page, which fetch follows to a 200 of HTML. Asking for JSON gets a
    // straight 401 instead, so a logged-out chart fails fast rather than trying
    // to parse a login page as a module index.
    const res = await fetch(INDEX_URL, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const body: unknown = await res.json()
    if (!isModuleList(body) || request < indexAccepted) return null
    indexAccepted = request
    listed = new Map(body.map((mod) => [mod.file, keyOf(mod)]))
    return body
  } catch {
    // No route, no network, no session. Nothing to load is a normal state here,
    // not a failure worth showing anyone.
    return null
  }
}

/**
 * Fetch, import and run every user module that has not been seen yet.
 *
 * Never throws. A missing folder, a logged-out session and a syntax error in one
 * user file all have to leave the other 112 indicators working, so the index is
 * treated as optional and each module is isolated from the next.
 *
 * This is the complete load the picker needs. A chart restoring a saved layout
 * does not have to wait for it: see ensureCustomIndicators.
 */
export function loadCustomIndicators(
  opts: { onProblem?: ProblemReporter } = {}
): Promise<CustomIndicatorLoad> {
  // A restore and a picker can overlap. Every caller must wait until the
  // shared registry is ready, including modules another call already claimed.
  if (!loading) {
    loading = importCustomIndicators(opts).finally(() => {
      loading = null
    })
  }
  return loading
}

async function importCustomIndicators(
  opts: { onProblem?: ProblemReporter } = {}
): Promise<CustomIndicatorLoad> {
  const result: CustomIndicatorLoad = { loaded: [], errors: [] }
  const onProblem = opts.onProblem ?? (() => {})

  const modules = await readIndex()
  if (!modules) return result
  await registerInOrder(modules, onProblem, result)
  if (result.loaded.length > 0) rememberManifest(modules)
  return result
}

/**
 * Register just the modules that provide `ids`, so a chart can restore now.
 *
 * A saved layout names the indicators it holds, and the manifest this loader
 * learned on earlier loads says which file registers each of them. Only those
 * files are imported here, typically none or a few, and the chart restores
 * without waiting for the rest of a folder that may hold hundreds. The caller
 * runs the full load afterwards, in the background, for the picker.
 *
 * Built-in ids need nothing, unless a module overrides one, in which case that
 * module is loaded so the override is what the chart restores. When an id cannot
 * be placed and some modules are new or edited since the manifest was learned,
 * one of them may be the one that registers it, so this falls back to the full
 * load rather than restoring a chart with that indicator missing.
 */
export async function ensureCustomIndicators(
  ids: readonly string[],
  opts: { onProblem?: ProblemReporter } = {}
): Promise<CustomIndicatorLoad> {
  const result: CustomIndicatorLoad = { loaded: [], errors: [] }
  if (ids.length === 0) return result
  const onProblem = opts.onProblem ?? (() => {})
  const unpinned = new Set<string>()
  const versions = new Map<string, StudyVersion>()
  for (const id of ids) {
    if (!isPinnedCustomIndicator(id)) {
      unpinned.add(id)
      continue
    }
    if (hasIndicator(id)) continue
    const match = PINNED_ID.exec(id)
    if (match) {
      const [, file, version, ordinal] = match
      versions.set(id, { file, version, ordinal: Number(ordinal) })
    } else {
      result.errors.push({ file: 'Custom study', message: 'Invalid saved version reference' })
    }
  }
  for (const version of versions.values()) {
    if (!registrations.has(keyOf(version))) void importOnce(version)
  }
  for (const version of versions.values()) {
    const outcome = await registerOnce(version, onProblem)
    try {
      if ('error' in outcome) throw new Error(outcome.error)
      const descriptor = outcome.descriptors[version.ordinal]
      if (!descriptor) throw new Error('Saved version does not provide this study')
      registerPin(version, descriptor)
      result.loaded.push(version.file)
    } catch (error) {
      result.errors.push({
        file: version.file,
        message: `Saved version ${version.version.slice(0, 12)} could not be restored. ${messageOf(error)}`,
      })
    }
  }
  if (unpinned.size === 0) return result

  const modules = await readIndex()
  if (!modules || modules.length === 0) return result

  const manifest = { ...readManifest(), ...learned }
  const needed: CustomModule[] = []
  const placed = new Set<string>()
  let unknown = false
  for (const mod of modules) {
    const provides = manifest[keyOf(mod)]
    if (!provides) {
      if (!registrations.has(keyOf(mod))) unknown = true
      continue
    }
    if (provides.some((id) => unpinned.has(id))) {
      needed.push(mod)
      for (const id of provides) placed.add(id)
    }
  }

  const { core } = await loaderEnv()
  const unplaced = [...unpinned].some((id) => !placed.has(id) && !core.hasIndicator(id))
  if (unplaced && unknown) {
    const current = await loadCustomIndicators(opts)
    result.loaded.push(...current.loaded)
    result.errors.push(...current.errors)
    return result
  }

  await registerInOrder(needed, onProblem, result)
  return result
}

/** Keep the manifest to the modules the server lists now, with what they register. */
function rememberManifest(modules: CustomModule[]): void {
  const previous = readManifest()
  const next: Manifest = {}
  for (const mod of modules) {
    const key = keyOf(mod)
    const ids = learned[key] ?? previous[key]
    if (ids) next[key] = ids
  }
  writeManifest(next)
}
