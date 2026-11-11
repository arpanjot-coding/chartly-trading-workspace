import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useBrokerStore } from './brokerStore'

interface User {
  username: string
  broker: string | null
  isLoggedIn: boolean
  loginTime: string | null
  isLocalGuest?: boolean
}

interface AuthStore {
  user: User | null
  apiKey: string | null
  isAuthenticated: boolean
  isLocalAuthenticated: boolean
  localPrincipalId: string | null

  setUser: (user: User) => void
  setLocalAccount: (username: string | null, principalId?: string, personal?: boolean) => void
  setApiKey: (apiKey: string | null) => void
  login: (username: string, broker: string) => void
  logout: () => void
  checkSession: () => boolean
}
export function chartStorageAccount(
  state: Pick<AuthStore, 'isLocalAuthenticated' | 'localPrincipalId' | 'isAuthenticated' | 'user'>
): string | null {
  return state.isLocalAuthenticated && state.localPrincipalId
    ? state.localPrincipalId
    : state.isAuthenticated
      ? (state.user?.username ?? null)
      : null
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      apiKey: null,
      isAuthenticated: false,
      isLocalAuthenticated: false,
      localPrincipalId: null,

      setLocalAccount: (username, principalId, personal = false) =>
        set((state) => ({
          ...(personal ? { isAuthenticated: false, apiKey: null } : {}),
          isLocalAuthenticated: username !== null,
          localPrincipalId: username
            ? (principalId ?? (state.user?.username === username ? state.localPrincipalId : null))
            : null,
          user:
            personal && username
              ? { username, broker: null, isLoggedIn: false, loginTime: null, isLocalGuest: true }
              : state.user?.isLoggedIn
                ? state.user
                : username
                  ? {
                      username,
                      broker: null,
                      isLoggedIn: false,
                      loginTime: null,
                      isLocalGuest: false,
                    }
                  : null,
        })),

      setUser: (user) => set({ user, isAuthenticated: user.isLoggedIn }),

      setApiKey: (apiKey) => set({ apiKey }),

      login: (username, broker) => {
        const user: User = {
          username,
          broker,
          isLoggedIn: true,
          loginTime: new Date().toISOString(),
          isLocalGuest: false,
        }
        set({ user, isAuthenticated: true })
      },

      logout: () => {
        set({
          user: null,
          isAuthenticated: false,
          isLocalAuthenticated: false,
          localPrincipalId: null,
          apiKey: null,
        })
        if (typeof window !== 'undefined')
          window.dispatchEvent(new Event('chartly:local-session-changed'))
      },

      checkSession: () => {
        const { user } = get()
        if (!user || !user.loginTime) return false

        // Skip session expiry for crypto brokers (24/7 markets)
        const capabilities = useBrokerStore.getState().capabilities
        if (capabilities?.broker_type === 'crypto') {
          return true
        }

        // Session expiry check (3 AM IST daily)
        const now = new Date()
        const loginTime = new Date(user.loginTime)

        // Convert to IST properly: UTC + 5.5 hours
        // First get UTC time, then add IST offset
        const istOffsetMs = 5.5 * 60 * 60 * 1000
        const localOffsetMs = now.getTimezoneOffset() * 60 * 1000

        // Convert current time to IST
        const nowUTC = now.getTime() + localOffsetMs
        const nowIST = new Date(nowUTC + istOffsetMs)

        // Convert login time to IST
        const loginUTC = loginTime.getTime() + localOffsetMs
        const loginIST = new Date(loginUTC + istOffsetMs)

        // Create today's 3 AM IST expiry time
        const todayExpiry = new Date(nowIST)
        todayExpiry.setHours(3, 0, 0, 0)

        // If current time is after 3 AM IST today and login was before 3 AM IST today
        if (nowIST > todayExpiry && loginIST < todayExpiry) {
          get().logout()
          return false
        }

        return true
      },
    }),
    {
      name: 'chartly-auth',
    }
  )
)
