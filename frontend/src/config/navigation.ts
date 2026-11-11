import { Bot, LayoutDashboard, type LucideIcon, Settings, Workflow } from 'lucide-react'

export interface NavItem {
  href: string
  label: string
  description?: string
  icon: LucideIcon
  /** Served by Flask (not a React route): render as a full-page link. */
  external?: boolean
}

// Main navigation items shown in desktop navbar. Workspace is the home:
// users choose a profile first, then enter its chart, paper sessions or
// journal from that profile. Trading and Replay are therefore profile
// actions, not global tabs. Agent stays in the profile dropdown.
// Automation is global, so it sits beside Workspace.
export const navItems: NavItem[] = [
  { href: '/workspace', label: 'Workspace', icon: LayoutDashboard },
  { href: '/flow', label: 'Automation', icon: Workflow },
]

// Mobile follows the same profile-first order. Journal, chart and replay are
// opened from inside a trading profile rather than as global tabs.
export const bottomNavItems: NavItem[] = navItems

// Paths in bottom nav (for filtering mobile sheet items)
const bottomNavPaths = bottomNavItems.map((item) => item.href)

// Secondary items for mobile sheet (items not in bottom nav)
export const mobileSheetItems = navItems.filter((item) => !bottomNavPaths.includes(item.href))

// Configuration has one entry point across the navbar, chart and mobile
// sheet. Account, broker/data, developer and system controls live in Settings.
export const profileMenuItems: NavItem[] = [
  {
    href: '/settings',
    label: 'Settings',
    description: 'Account, connections & data, developer API and system',
    icon: Settings,
  },
  // Agent Config is NOT here. It lives under /admin with the other
  // configuration surfaces. The chat header carries its own settings control,
  // so a configured /agent still has a route back to its settings without this
  // menu holding one.
  {
    href: '/agent',
    label: 'AI Agent',
    description: 'Chat & chart assistance',
    icon: Bot,
  },
]

// Shared utility to check if a route is active. Workspace owns nested
// trading-profile routes; other primary items remain exact leaf routes.
export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === '/settings') {
    return (
      pathname === href ||
      pathname.startsWith('/settings/') ||
      ['/profile', '/apikey', '/historify', '/leverage', '/admin', '/agent/config'].some(
        (path) => pathname === path || pathname.startsWith(`${path}/`)
      )
    )
  }
  if (href === '/workspace') {
    return pathname === href || pathname.startsWith('/workspace/')
  }
  if (href === '/flow') {
    return pathname === href || pathname.startsWith(`${href}/`) || pathname === '/action-center'
  }
  return pathname === href
}
