import { parseWorkspacePayload, type WorkspacePayload } from 'chartly-charts/workspace'
import type { DatasetChartSource } from './chartSource'

/** Configuration can be copied; a template never changes source or relocates foreign drawings. */
export function templateForChartSource(
  input: WorkspacePayload,
  source?: Pick<DatasetChartSource, 'symbol' | 'exchange' | 'interval'>
): WorkspacePayload {
  const payload = parseWorkspacePayload(input)
  if (!source) return payload
  return parseWorkspacePayload({
    ...payload,
    panes: payload.panes.map((pane) => {
      return {
        ...pane,
        symbol: source.symbol,
        exchange: source.exchange,
        interval: source.interval,
        chart: {
          ...pane.chart,
          drawings: { version: 2, drawings: [] },
          alerts: { version: 1, alerts: [] },
        },
        comparisons: [],
      }
    }),
  })
}
