import { BookOpen, Menu } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { isActiveRoute, mobileSheetItems, navItems } from '@/config/navigation'
import { useProfileMenuItems } from '@/hooks/useProfileMenuItems'
import { cn } from '@/lib/utils'
import { AccountControls } from './AccountControls'

const TAB =
  'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
const TAB_IDLE = 'text-muted-foreground hover:bg-muted hover:text-foreground'
const TAB_CURRENT = 'bg-foreground/[0.06] font-semibold text-foreground dark:bg-foreground/[0.10]'

interface NavbarProps {
  /**
   * Span the full viewport instead of the centred, width-capped container.
   *
   * Pages rendered inside Layout share its `container mx-auto`, so the nav
   * lines up with the content below it and this stays false. Full-bleed pages
   * under FullWidthLayout render this navbar themselves and have no such
   * container, so a capped nav floats inset above edge-to-edge content -- on a
   * 1920px screen Tailwind caps `container` at 1536px, leaving ~192px of gutter
   * each side while the page fills the width.
   */
  fluid?: boolean
}

export function Navbar({ fluid = false }: NavbarProps = {}) {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Shared configuration entry points for every app shell.
  const filteredProfileMenuItems = useProfileMenuItems()

  const isActive = (href: string) => isActiveRoute(location.pathname, href)

  return (
    <nav className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
      <div
        data-testid="navbar-row"
        className={cn('flex h-[60px] items-center px-4', fluid ? 'w-full' : 'container mx-auto')}
      >
        {/* Mobile Menu */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon" className="mr-2 min-h-[44px] min-w-[44px]">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 overflow-y-auto">
            {/* Visually hidden but accessible for screen readers */}
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation Menu</SheetTitle>
              <SheetDescription>Main navigation and quick access links</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 py-4">
              <Link
                to="/"
                className="flex items-center gap-2 px-2"
                onClick={() => setMobileOpen(false)}
              >
                <img src="/logo.png" alt="" className="h-8 w-8" />
                <span className="font-semibold">Chartly</span>
              </Link>

              {/* Secondary nav items (not in bottom nav) */}
              {mobileSheetItems.length > 0 && (
                <nav className="flex flex-col gap-1">
                  <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Navigation
                  </div>
                  {mobileSheetItems.map((item) => {
                    const active = isActive(item.href)
                    const cls = cn(
                      'flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors min-h-[44px] touch-manipulation',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted active:bg-muted'
                    )
                    const inner = (
                      <>
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </>
                    )
                    return item.external ? (
                      <a
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={cls}
                        aria-current={active ? 'page' : undefined}
                      >
                        {inner}
                      </a>
                    ) : (
                      <Link
                        key={item.href}
                        to={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={cls}
                        aria-current={active ? 'page' : undefined}
                      >
                        {inner}
                      </Link>
                    )
                  })}
                </nav>
              )}

              {/* Profile menu items for mobile access */}
              <nav className="flex flex-col gap-1 border-t pt-4">
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Quick access
                </div>
                {filteredProfileMenuItems.map((item) => {
                  const active = isActive(item.href)
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors min-h-[44px] touch-manipulation',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted active:bg-muted'
                      )}
                      aria-current={active ? 'page' : undefined}
                    >
                      <item.icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <span className="block">{item.label}</span>
                        {item.description && (
                          <span
                            className={cn(
                              'block text-xs font-normal',
                              active ? 'text-primary-foreground/80' : 'text-muted-foreground'
                            )}
                          >
                            {item.description}
                          </span>
                        )}
                      </span>
                    </Link>
                  )
                })}
                <Link
                  to="/faq"
                  className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors min-h-[44px] touch-manipulation hover:bg-muted active:bg-muted"
                  onClick={() => setMobileOpen(false)}
                >
                  <BookOpen className="h-4 w-4" />
                  Help & FAQ
                </Link>
              </nav>
            </div>
          </SheetContent>
        </Sheet>

        {/* Logo */}
        <Link
          to="/"
          aria-label="Chartly home"
          className="mr-4 flex shrink-0 items-center gap-2.5 md:mr-6"
        >
          <img src="/logo.png" alt="" className="size-8 rounded-lg" />
          <span className="text-base font-semibold tracking-tight">Chartly</span>
        </Link>

        <nav
          aria-label="Main navigation"
          className="hidden min-w-0 items-center gap-1 border-l pl-4 md:flex"
        >
          {navItems.map((item) => {
            const active = isActive(item.href)
            const className = cn(TAB, active ? TAB_CURRENT : TAB_IDLE)
            // Flask-served pages (e.g. /trading) need a full page load,
            // not client-side routing.
            return item.external ? (
              <a
                key={item.href}
                href={item.href}
                className={className}
                aria-current={active ? 'page' : undefined}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </a>
            ) : (
              <Link
                key={item.href}
                to={item.href}
                className={className}
                aria-current={active ? 'page' : undefined}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Right Side: shared with the charting terminal's toolbar row. */}
        <div className="ml-auto flex shrink-0 items-center gap-1 pl-2 2xl:gap-2">
          <AccountControls />
        </div>
      </div>
    </nav>
  )
}
