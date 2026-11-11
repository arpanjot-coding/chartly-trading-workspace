import { LogIn, LogOut, Moon, Sun, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { authApi } from '@/api/auth'
import { LogoutConfirmDialog } from '@/components/auth/LogoutConfirmDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useProfileMenuItems } from '@/hooks/useProfileMenuItems'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { showToast } from '@/utils/toast'
import { flushDrafts } from '@/lib/trading/openscriptDrafts'
import { persistPreferences } from '@/lib/trader/dataPersistence'

/**
 * The account end of the app header: light/dark and the profile menu.
 * Broker identity and Live/Replay belong inside a Trading Profile, not as
 * global top-bar state. One component serves the navbar and chart toolbar.
 */
export function AccountControls({ variant = 'navbar' }: { variant?: 'navbar' | 'toolbar' }) {
  const navigate = useNavigate()
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)
  const { mode, toggleMode } = useThemeStore()
  const { user, logout } = useAuthStore()
  const isLocalGuest = user?.isLocalGuest === true
  const toolbar = variant === 'toolbar'

  // Shared configuration entry points for every app shell.
  const filteredProfileMenuItems = useProfileMenuItems()

  const handleLogout = async () => {
    try {
      flushDrafts()
      try { await persistPreferences() } catch { /* interrupted editor draft remains scoped in the durable cache */ }
      await authApi.logout()
      logout()
      navigate('/login')
      showToast.success('Logged out successfully')
    } catch {
      showToast.error('Sign-out failed. Retry while the local engine is available.')
    }
  }

  // The toolbar's quiet button: its glyph on the toolbar surface, a fill on hover.
  const iconButton = toolbar
    ? 'h-7 w-7 rounded-md text-foreground/80 hover:bg-accent hover:text-foreground dark:hover:bg-accent'
    : 'h-8 w-8'
  const glyph = 'h-4 w-4'

  return (
    <>
      {/* Theme Toggle */}
      <Button
        variant="ghost"
        size="icon"
        className={iconButton}
        onClick={toggleMode}
        title={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        aria-label={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      >
        {mode === 'light' ? <Sun className={glyph} /> : <Moon className={glyph} />}
      </Button>

      {/* Profile Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'rounded-full bg-primary text-primary-foreground',
              toolbar
                ? 'ml-0.5 h-7 w-7 hover:bg-primary/90 hover:text-primary-foreground dark:hover:bg-primary/90'
                : 'h-8 w-8'
            )}
            aria-label="Open user menu"
          >
            <span className={toolbar ? 'text-[13px] font-semibold' : 'text-sm font-medium'}>
              {isLocalGuest ? 'L' : user?.username?.[0]?.toUpperCase() || 'C'}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel className="font-normal">
            <span className="block text-sm font-semibold text-foreground">
              {isLocalGuest ? 'Local mode' : user?.username || 'Chartly'}
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
              {isLocalGuest
                ? 'No account needed. Trading profiles and journals stay on this device.'
                : user
                  ? 'Signed in on this device.'
                  : 'Use Chartly locally, or sign in only if you want an account.'}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {filteredProfileMenuItems.map((item) => {
            const content = (
              <>
                <item.icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block">{item.label}</span>
                  {item.description && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </span>
              </>
            )
            return item.external ? (
              <DropdownMenuItem key={item.href} asChild className="cursor-pointer">
                <a href={item.href} className="flex items-start gap-2">
                  {content}
                </a>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                key={item.href}
                onSelect={() => navigate(item.href)}
                className="flex cursor-pointer items-start gap-2"
              >
                {content}
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          {isLocalGuest ? (
            <DropdownMenuItem onSelect={() => navigate('/profile')} className="cursor-pointer">
              <UserPlus className="mr-2 h-4 w-4" />
              Set up account security (optional)
            </DropdownMenuItem>
          ) : user ? (
            <DropdownMenuItem
              onClick={() => setShowLogoutDialog(true)}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => navigate('/login')} className="cursor-pointer">
              <LogIn className="mr-2 h-4 w-4" />
              Sign in or create account (optional)
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <LogoutConfirmDialog
        open={showLogoutDialog}
        onOpenChange={setShowLogoutDialog}
        onConfirm={handleLogout}
      />
    </>
  )
}
