import { Link, useLocation } from 'react-router'
import { bottomNavItems, isActiveRoute } from '@/config/navigation'
import { cn } from '@/lib/utils'

export function MobileBottomNav() {
  const location = useLocation()

  return (
    <nav
      aria-label="Mobile main navigation"
      className="safe-area-bottom fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur md:hidden"
    >
      <div
        className="grid h-16 items-center gap-2 px-3"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, bottomNavItems.length)}, minmax(0, 1fr))`,
        }}
      >
        {bottomNavItems.map((item) => {
          const active = isActiveRoute(location.pathname, item.href)
          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                'flex min-h-[44px] min-w-0 touch-manipulation flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-center transition-colors',
                active
                  ? 'bg-foreground/[0.06] text-primary dark:bg-foreground/[0.10]'
                  : 'text-muted-foreground hover:text-foreground active:bg-muted'
              )}
              aria-current={active ? 'page' : undefined}
            >
              <item.icon className="size-[18px]" aria-hidden="true" />
              <span className="text-[11px] font-medium leading-tight">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
