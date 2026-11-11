import type { TraderPortfolio } from './db'
import { notifyPreferenceChange } from './preferenceEvents'

export const COMBINED_SELECTION_KEY = 'chartly.combined-selection.v1'
export interface CombinedSelection {
  version: 1
  profileIds: number[]
  currency: string
}
export interface CombinedSelectionScope {
  principalId: string
  originId: string
}
export function combinedSelectionKey(scope?: CombinedSelectionScope): string {
  return scope
    ? `${COMBINED_SELECTION_KEY}:${JSON.stringify([scope.principalId, scope.originId])}`
    : COMBINED_SELECTION_KEY
}

export function loadCombinedSelection(
  scope?: CombinedSelectionScope,
  saved?: string
): { selection: CombinedSelection | null; error: string } {
  try {
    const raw = localStorage.getItem(combinedSelectionKey(scope)) ?? saved ?? null
    if (raw === null) return { selection: null, error: '' }
    const value = JSON.parse(raw)
    if (
      value?.version !== 1 ||
      !Array.isArray(value.profileIds) ||
      !value.profileIds.every((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0) ||
      typeof value.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(value.currency)
    ) {
      throw new Error('Invalid saved selection')
    }
    return {
      selection: {
        version: 1,
        profileIds: [...new Set<number>(value.profileIds)],
        currency: value.currency,
      },
      error: '',
    }
  } catch {
    return {
      selection: null,
      error: 'Your saved selection could not be loaded. Choose portfolios and save again.',
    }
  }
}

export function saveCombinedSelection(
  selection: CombinedSelection,
  scope?: CombinedSelectionScope
): void {
  localStorage.setItem(combinedSelectionKey(scope), JSON.stringify(selection))
  notifyPreferenceChange()
}

/** null means first-use defaults; an explicit empty array always stays empty. */
export function resolveCombinedSelection(
  portfolios: TraderPortfolio[],
  requestedIds: number[] | null
) {
  const available = portfolios.filter((p) => p.kind === 'live' && p.id && !p.archivedAt)
  const availableIds = new Set(available.map((p) => p.id!))
  const requested = requestedIds ?? [...availableIds]
  return {
    profiles: available,
    selectedIds: requested.filter((id) => availableIds.has(id)),
    unavailableIds: requested.filter((id) => !availableIds.has(id)),
  }
}

export function sameCombinedSelection(a: CombinedSelection | null, b: CombinedSelection): boolean {
  if (!a || a.currency !== b.currency || a.profileIds.length !== b.profileIds.length) return false
  const sorted = [...b.profileIds].sort((x, y) => x - y)
  return [...a.profileIds].sort((x, y) => x - y).every((id, index) => id === sorted[index])
}
