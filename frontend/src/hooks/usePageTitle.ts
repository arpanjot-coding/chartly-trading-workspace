import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { findPublicGuide, homeMetadata } from '@/config/publicPages'
import { retiredFeaturePaths } from '@/config/retiredFeatures'

const PAGE_TITLES: Record<string, string> = {
  '/faq': 'FAQ',
  '/setup': 'Setup',
  '/login': 'Login',
  '/reset-password': 'Reset Password',
  '/download': 'Download',
  '/broker': 'Select Broker',
  '/settings': 'Settings',
  '/settings/connections': 'Connections & Data',
  '/workspace': 'Trading Profiles',
  '/workspace/combined': 'Combined Live Analytics',
  '/journal': 'Trading Journal',
  '/dashboard': 'Trading Profiles',
  '/positions': 'Positions',
  '/orderbook': 'Order Book',
  '/tradebook': 'Trade Book',
  '/holdings': 'Holdings',
  '/search': 'Search',
  '/search/token': 'Token Search',
  '/apikey': 'Developer API Key',
  '/platforms': 'Platforms',
  '/tradingview': 'TradingView',
  '/gocharting': 'GoCharting',
  '/pnl-tracker': 'P&L Tracker',
  '/sandbox': 'Sandbox',
  '/sandbox/mypnl': 'Sandbox P&L',
  '/analyzer': 'Analyzer',
  '/optionchain': 'Option Chain',
  '/ivchart': 'IV Chart',
  '/oitracker': 'OI Tracker',
  '/oirange': 'OI Range',
  '/gammadensity': 'Gamma Density',
  '/maxpain': 'Max Pain',
  '/straddle': 'Straddle Chart',
  '/straddlepnl': 'Straddle P&L',
  '/volsurface': 'Vol Surface',
  '/gex': 'GEX Dashboard',
  '/strikeprofile': 'Strike Profile',
  '/ivsmile': 'IV Smile',
  '/oiprofile': 'OI Profile',
  '/websocket/test': 'WebSocket Test',
  '/websocket/order': 'Order Stream',
  '/python': 'Python Strategies',
  '/python/new': 'New Python Strategy',
  '/python/guide': 'Python Strategy Guide',
  '/strategy': 'Strategies',
  '/strategy/new': 'New Strategy',
  '/chartink': 'Chartink Strategies',
  '/chartink/new': 'New Chartink Strategy',
  '/flow': 'Workflows',
  '/flow/shortcuts': 'Flow Shortcuts',
  '/leverage': 'Leverage',
  '/admin': 'Admin',
  '/admin/freeze': 'Freeze Qty',
  '/admin/holidays': 'Holidays',
  '/admin/timings': 'Market Timings',
  '/logs': 'Logs',
  '/logs/live': 'Live Logs',
  '/logs/sandbox': 'Sandbox Logs',
  '/logs/security': 'Security',
  '/logs/traffic': 'Traffic',
  '/logs/latency': 'Latency',
  '/health': 'Health Monitor',
  '/profile': 'Account',
  '/master-contract': 'Master Contract',
  '/action-center': 'Automation Approvals',
  '/playground': 'Playground',
  '/historify': 'History & Data',
  '/historify/charts': 'History Charts',
}

/** Dynamic route patterns for parameterized routes */
const DYNAMIC_TITLES: Array<{ pattern: RegExp; title: string }> = [
  { pattern: /^\/workspace\/profiles\/[^/]+\/journal$/, title: 'Profile Journal' },
  { pattern: /^\/workspace\/profiles\/[^/]+\/connections$/, title: 'Profile Connections' },
  { pattern: /^\/workspace\/profiles\/[^/]+\/replay$/, title: 'Replay Project' },
  { pattern: /^\/workspace\/profiles\/[^/]+\/settings$/, title: 'Profile Settings' },
  { pattern: /^\/workspace\/profiles\/[^/]+$/, title: 'Trading Profile' },
  { pattern: /^\/python\/[^/]+\/edit$/, title: 'Edit Strategy' },
  { pattern: /^\/python\/[^/]+\/logs$/, title: 'Strategy Logs' },
  { pattern: /^\/python\/[^/]+\/schedule$/, title: 'Schedule Strategy' },
  { pattern: /^\/strategy\/[^/]+\/edit$/, title: 'Edit Strategy' },
  { pattern: /^\/strategy\/[^/]+$/, title: 'Strategy' },
  { pattern: /^\/chartink\/[^/]+\/configure$/, title: 'Configure Chartink' },
  { pattern: /^\/chartink\/[^/]+$/, title: 'View Chartink Strategy' },
  { pattern: /^\/flow\/editor\/[^/]+$/, title: 'Flow Editor' },
  { pattern: /^\/historify\/charts\/[^/]+$/, title: 'Historify Charts' },
  { pattern: /^\/websocket\/test\/\d+$/, title: 'WebSocket Test' },
]

function getPageTitle(pathname: string): string {
  if (retiredFeaturePaths.some((path) => path === pathname)) return 'Feature unavailable'
  if (PAGE_TITLES[pathname]) {
    return PAGE_TITLES[pathname]
  }

  for (const { pattern, title } of DYNAMIC_TITLES) {
    if (pattern.test(pathname)) {
      return title
    }
  }

  return 'Chartly'
}

export function usePageTitle() {
  const { pathname } = useLocation()

  useEffect(() => {
    const guideSlug = /^\/guides\/([^/]+)\/?$/.exec(pathname)?.[1]
    const publicPage =
      pathname === '/' ? homeMetadata : guideSlug ? findPublicGuide(guideSlug) : undefined
    if (publicPage) {
      document.title = publicPage.title
      document
        .querySelector('meta[name="description"]')
        ?.setAttribute('content', publicPage.description)
      return
    }
    const title = getPageTitle(pathname)
    document.title = title === 'Chartly' ? 'Chartly' : `${title} | Chartly`
  }, [pathname])
}
