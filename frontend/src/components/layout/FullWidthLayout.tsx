import { Navigate, Outlet, useLocation } from 'react-router'
import { SocketProvider } from '@/components/socket/SocketProvider'
import { useAuthStore } from '@/stores/authStore'

/**
 * Full-width layout for apps like Playground that need maximum screen space.
 * No container constraints, minimal chrome.
 */
export function FullWidthLayout() {
  const { isAuthenticated, isLocalAuthenticated } = useAuthStore()
  const location = useLocation()

  // Same rule as Layout: a verified local (personal-mode) account may
  // open these full-width surfaces (Agent, AI configuration, flow
  // editor); requiring the legacy account bounced local users away.
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
      <div className="h-screen bg-background flex flex-col overflow-hidden">
        <Outlet />
      </div>
    </SocketProvider>
  )
}

/** Saved charts are available to a verified local account without a broker session. */
export function LocalChartLayout() {
  const { isAuthenticated, isLocalAuthenticated } = useAuthStore()
  const location = useLocation()
  if (!isLocalAuthenticated && !isAuthenticated)
    return (
      <Navigate
        to={`/login?${new URLSearchParams({ purpose: 'local', next: location.pathname + location.search })}`}
        replace
      />
    )
  // No banner strip: the chart toolbar already names the feed and
  // symbol (e.g. EURUSD · MT5), so a permanent explanation line above
  // it only costs chart height.
  return (
    <SocketProvider>
      <div className="h-screen bg-background flex flex-col overflow-hidden">
        <Outlet />
      </div>
    </SocketProvider>
  )
}
