import {
  parseWorkspaceCatalog,
  type WorkspaceDocument,
  type WorkspacePayload,
} from 'chartly-charts/workspace'
import type { BrowserSnapshot } from '@/lib/trader/browserSnapshot'
import type { ResolvedChartContext } from './chartContext'
import { templateForChartSource } from './chartWorkspaceTemplate'

export interface PreservedChartSetup {
  key: string
  namespace: string
  name: string
  sameSource: boolean
  document: WorkspaceDocument
  payload: WorkspacePayload
}
/** The owner-confirmed P02 workspace supplies records; never query a foreign origin or change its namespaces. */
export function preservedChartSetups(
  native: BrowserSnapshot['nativeCatalogs'] | undefined,
  context: ResolvedChartContext
): PreservedChartSetup[] {
  const result: PreservedChartSetup[] = []
  if (!context.dataset) return result
  const versionIds = new Set(
    [context.dataset.id, context.navigation.get('datasetVersionId')].filter(Boolean)
  )
  const binding = context.profile
    ? [`profile-${context.profile.id}`, ...(context.run ? [`run-${context.run.id}`] : [])]
    : []
  for (const [namespace, raw] of Object.entries(native?.['openalgo-chart-workspaces'] ?? {})) {
    if (namespace === context.namespace || !namespace.startsWith('oa-trading:')) continue
    let catalog
    try {
      catalog = parseWorkspaceCatalog(raw)
    } catch {
      continue
    }
    const parts = namespace.split(':')
    const scope = parts.slice(2)
    const version = scope.at(-1)
    const knownScope =
      scope.length === binding.length + 2 &&
      scope.slice(0, -2).join(':') === binding.join(':') &&
      scope.at(-2) === 'dataset' &&
      versionIds.has(version ?? '')
    for (const document of catalog.workspaces) {
      if (result.length >= 100) return result
      const sameSource =
        knownScope &&
        document.panes.every(
          (pane) =>
            pane.symbol === context.dataset!.metadata.symbol &&
            pane.exchange === context.dataset!.metadata.exchange &&
            pane.interval === context.dataset!.metadata.interval
        )
      const payload = sameSource
        ? structuredClone(document)
        : templateForChartSource(document, {
            symbol: context.dataset.metadata.symbol,
            exchange: context.dataset.metadata.exchange,
            interval: context.dataset.metadata.interval,
          })
      result.push({
        key: JSON.stringify([namespace, document.id]),
        namespace,
        name: document.name,
        sameSource,
        document,
        payload,
      })
    }
  }
  return result
}
