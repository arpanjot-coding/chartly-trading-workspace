import { ArrowUpRight, CircleAlert, Database } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { SocketProvider } from '@/components/socket/SocketProvider'
import { persistenceStatus, subscribePersistence } from '@/lib/trader/dataPersistence'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { Footer } from './Footer'
import { MobileBottomNav } from './MobileBottomNav'
import { Navbar } from './Navbar'

export function Layout() {
  const { isAuthenticated, isLocalAuthenticated } = useAuthStore()
  const location = useLocation()

  // AuthSync has already synced Flask session with Zustand store
  // So we just need to check the Zustand store state. There is no legacy
  // broker-selection step any more: platform connections are managed
  // inside each Trading Profile, so a signed-in account without a
  // legacy broker session is the normal case. A verified local
  // (personal-mode) account owns this installation, so it may open
  // these surfaces too — gating them on the legacy account alone
  // bounced local users from Settings targets like System & advanced
  // straight back to the workspace via the login page.
  if (!isAuthenticated && !isLocalAuthenticated) {
    return (
      <Navigate
        to={`/login?${new URLSearchParams({ purpose: 'local', next: location.pathname + location.search })}`}
        replace
      />
    )
  }

  return (
    <SocketProvider>
      <div className="flex min-h-screen flex-col bg-[var(--app-surface)]">
        <Navbar />
        <main className="container mx-auto px-4 py-6 pb-24 md:pb-6 flex-1">
          <Outlet />
        </main>
        <Footer className="hidden md:block" />
        <MobileBottomNav />
      </div>
    </SocketProvider>
  )
}

/**
 * Local trader surfaces (Workspace and Journal) keep their records in the
 * browser and must remain usable before any broker is connected. They share
 * the product chrome without inheriting Layout's broker-auth gate.
 */
export function TraderLayout() {
  const storage = useSyncExternalStore(subscribePersistence, persistenceStatus)
  const needsReview = storage.phase === 'error' || storage.phase === 'conflict'
  const StatusIcon = needsReview ? CircleAlert : Database
  return (
    <div className="flex min-h-screen flex-col bg-[var(--app-surface)]">
      <Navbar />
      <main className="container mx-auto flex-1 px-4 pt-4 pb-24 md:pb-8">
        <output
          className={cn(
            'mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground',
            needsReview && 'border-destructive/40 text-foreground'
          )}
        >
          <span className="flex items-center gap-2">
            <StatusIcon
              className={cn('size-3.5 shrink-0', needsReview && 'text-destructive')}
              aria-hidden="true"
            />
            {storage.message}
          </span>
          <Link
            to="/settings/storage"
            className="inline-flex items-center gap-1 font-medium text-foreground/85 hover:underline"
          >
            Storage & recovery <ArrowUpRight className="size-3" aria-hidden="true" />
          </Link>
        </output>
        <Outlet />
      </main>
      <Footer className="hidden md:block" />
      <MobileBottomNav />
    </div>
  )
}

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-background">
      <Outlet />
    </div>
  )
}
