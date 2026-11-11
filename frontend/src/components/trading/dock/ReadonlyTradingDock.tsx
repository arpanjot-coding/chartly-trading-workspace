import { DockShell } from './DockShell'
import type { DockTab } from './dockState'
import { OrdersTable } from './OrdersTable'
import { PositionsTable } from './PositionsTable'
import { TradesTable } from './TradesTable'

/** The original dock chrome and keyboard behavior, with no account feed or command path. */
export function ReadonlyTradingDock({
  tab,
  onTabChange,
  storage,
  savedHistory = true,
  paperAvailable = false,
  onOpenPaper,
}: {
  tab: DockTab | null
  onTabChange(tab: DockTab | null): void
  storage?: Storage
  savedHistory?: boolean
  paperAvailable?: boolean
  onOpenPaper?(): void
}) {
  const ignore = () => {}
  return (
    <DockShell
      tab={tab}
      onTabChange={onTabChange}
      counts={{}}
      storage={storage}
      header={
        <span className="px-2 text-xs text-muted-foreground">
          {paperAvailable
            ? 'Broker books disconnected'
            : savedHistory
              ? 'Saved history'
              : 'Profile analysis'}{' '}
          · read-only
        </span>
      }
    >
      {paperAvailable ? (
        <div className="border-b p-2 text-xs text-muted-foreground">
          <p>
            Paper orders, positions and fills belong to this run’s Paper session panel. These
            broker-account books have no connected execution account.
          </p>
          <button type="button" className="mt-2 rounded border px-2 py-1" onClick={onOpenPaper}>
            Open paper account
          </button>
        </div>
      ) : (
        <p className="border-b p-2 text-xs text-muted-foreground">
          This chart has no account order connection. Historical replay here changes the chart view;
          simulation accounts and fills use the validated simulation workflow.
        </p>
      )}
      {tab === 'orders' && (
        <OrdersTable
          orders={[]}
          activeSymbol={null}
          onPick={ignore}
          onCancel={ignore}
          onModify={ignore}
          isLoading={false}
        />
      )}
      {tab === 'positions' && (
        <PositionsTable
          positions={[]}
          activeSymbol={null}
          onPick={ignore}
          onClose={ignore}
          isLoading={false}
        />
      )}
      {tab === 'trades' && (
        <TradesTable trades={[]} activeSymbol={null} onPick={ignore} isLoading={false} />
      )}
      {tab === 'gtt' && (
        <p className="p-3 text-xs text-muted-foreground">
          GTT requires a connected execution account. This analysis chart does not create or manage
          account orders.
        </p>
      )}
    </DockShell>
  )
}
