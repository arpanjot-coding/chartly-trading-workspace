import { useEffect, useState } from 'react'
import { openLocalWorkspace } from '@/api/localWorkspace'
import { clearRuntimePreferences } from '@/lib/trader/browserSnapshot'
import { activationMarker, loadTraderBinding } from '@/lib/trader/dataPersistence'
import { useAuthStore } from '@/stores/authStore'
import { useBrokerStore } from '@/stores/brokerStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useThemeStore } from '@/stores/themeStore'

interface AuthSyncProps {
  children: React.ReactNode
}

/**
 * AuthSync component that synchronizes Flask session with Zustand store.
 * This ensures the React app knows about authentication state from OAuth callbacks.
 * Also syncs app mode (live/analyzer) from the backend.
 */
export function AuthSync({ children }: AuthSyncProps) {
  const [isChecking, setIsChecking] = useState(true)
  const { setUser, setApiKey, setLocalAccount, logout } = useAuthStore()
  const { fetchCapabilities, clearCapabilities } = useBrokerStore()
  const { setActiveSessionCount } = useSessionStore()
  const { syncAppMode } = useThemeStore()

  useEffect(() => {
    const controller = new AbortController()
    const syncSession = async () => {
      try {
        const response = await fetch('/auth/session-status', {
          credentials: 'include',
          signal: controller.signal,
        })

        if (response.ok) {
          const data = await response.json()

          if (controller.signal.aborted) return
          if (data.status === 'success' && data.local_guest) {
            setUser({
              username: 'Local workspace',
              broker: null,
              isLoggedIn: false,
              loginTime: null,
              isLocalGuest: true,
            })
            setApiKey(null)
            clearCapabilities()
          } else if (data.status === 'success' && data.logged_in && data.broker) {
            // Flask session is authenticated with broker - sync to Zustand
            setUser({
              username: data.user,
              broker: data.broker,
              isLoggedIn: true,
              loginTime: new Date().toISOString(),
              isLocalGuest: data.local_guest === true,
            })
            // Store the API key for trading API calls
            if (data.api_key) {
              setApiKey(data.api_key)
            }
            // Fetch broker capabilities (exchanges, type, features)
            await fetchCapabilities()
            // Also sync app mode from backend
            await syncAppMode()
            // Sync active session count
            if (data.active_sessions !== undefined) {
              setActiveSessionCount(data.active_sessions)
            }
          } else if (data.status === 'success' && data.authenticated && !data.broker) {
            // User is logged in but hasn't connected broker yet
            setUser({
              username: data.user,
              broker: null,
              isLoggedIn: false,
              loginTime: null,
              isLocalGuest: data.local_guest === true,
            })
            setApiKey(data.api_key ?? null)
            clearCapabilities()
          } else {
            // Not authenticated or status is not success - clear Zustand store
            logout()
            clearCapabilities()
          }
        } else {
          // Any non-OK response (401, 500, etc.) - clear Zustand store
          logout()
          clearCapabilities()
        }
      } catch (_error) {
        // On error, don't change auth state - let existing state persist
      } finally {
        try {
          if (!controller.signal.aborted) {
            const proof = await openLocalWorkspace(controller.signal)
            if (!controller.signal.aborted) {
              if (proof.principal?.personal) {
                setApiKey(null)
                clearCapabilities()
              }
              setLocalAccount(
                proof.authenticated ? (proof.principal?.username ?? null) : null,
                proof.principal?.uid,
                proof.principal?.personal === true
              )
              if (proof.authenticated) {
                try {
                  await loadTraderBinding()
                  if (!controller.signal.aborted) await useThemeStore.persist.rehydrate()
                } catch {
                  /* storage UI reports retained/locked source without exposing another account */
                }
              }
              if (!controller.signal.aborted && !proof.authenticated && (await activationMarker()))
                clearRuntimePreferences()
            }
          }
        } catch {
          /* network state does not prove an account session */
        }
        if (!controller.signal.aborted) setIsChecking(false)
      }
    }

    syncSession()
    return () => controller.abort()
  }, [
    setUser,
    setApiKey,
    setLocalAccount,
    logout,
    fetchCapabilities,
    clearCapabilities,
    syncAppMode,
    setActiveSessionCount,
  ])

  // Show nothing while checking - prevents flash of wrong content
  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return <>{children}</>
}
