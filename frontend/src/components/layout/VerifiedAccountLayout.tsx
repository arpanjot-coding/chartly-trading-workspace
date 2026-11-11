import { Navigate, Outlet, useLocation } from 'react-router'
import { SocketProvider } from '@/components/socket/SocketProvider'
import { useAuthStore } from '@/stores/authStore'
import { Footer } from './Footer'
import { MobileBottomNav } from './MobileBottomNav'
import { Navbar } from './Navbar'

/** Account/developer pages need app identity, independently of a broker connection. */
export function VerifiedAccountLayout({ fullWidth = false }: { fullWidth?: boolean }) {
  const { isAuthenticated, isLocalAuthenticated, localPrincipalId, user } = useAuthStore()
  const location = useLocation()
  const local =
    isLocalAuthenticated &&
    typeof localPrincipalId === 'string' &&
    /^principal_[0-9a-f]{32}$/.test(localPrincipalId)
  // Preserve the existing authenticated broker path; guest metadata grants no access.
  const broker = isAuthenticated && user?.isLoggedIn === true && !user.isLocalGuest && !!user.broker
  if (!local && !broker)
    return (
      <Navigate
        replace
        to={`/login?${new URLSearchParams({
          purpose: 'local',
          next: location.pathname + location.search,
        })}`}
      />
    )

  const page = fullWidth ? (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Outlet />
    </div>
  ) : (
    <div className="flex min-h-screen flex-col bg-[var(--app-surface)]">
      <Navbar />
      <main className="container mx-auto px-4 py-6 pb-24 md:pb-6 flex-1">
        <Outlet />
      </main>
      <Footer className="hidden md:block" />
      <MobileBottomNav />
    </div>
  )
  // Local-only entry must not start the legacy account/order event socket.
  return broker ? <SocketProvider>{page}</SocketProvider> : page
}
