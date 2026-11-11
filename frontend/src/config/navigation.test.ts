import { describe, expect, it } from 'vitest'
import {
  bottomNavItems,
  isActiveRoute,
  mobileSheetItems,
  navItems,
  profileMenuItems,
} from './navigation'

describe('Navigation Config', () => {
  describe('navItems', () => {
    it('contains the expected main navigation items', () => {
      expect(navItems).toHaveLength(2)

      const labels = navItems.map((item) => item.label)
      expect(labels).toEqual(['Workspace', 'Automation'])
      expect(labels).not.toContain('Fundamentals')
      expect(labels).not.toContain('Workflows')

      // Journal belongs inside a trading profile, not in global navigation.
      expect(labels).not.toContain('Journal')
      expect(labels).not.toContain('Trading')
      expect(labels).not.toContain('Replay')
      expect(labels).not.toContain('Agent')
    })

    it('all items have required properties', () => {
      navItems.forEach((item) => {
        expect(item).toHaveProperty('href')
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('icon')
        expect(item.href).toMatch(/^\//)
        expect(item.label.length).toBeGreaterThan(0)
      })
    })
  })

  describe('bottomNavItems', () => {
    it('mirrors the desktop items for mobile bottom nav', () => {
      expect(bottomNavItems).toEqual(navItems)
    })

    it('has the same requested order across desktop and mobile', () => {
      const labels = bottomNavItems.map((item) => item.label)
      expect(labels).toEqual(['Workspace', 'Automation'])
    })
  })

  describe('mobileSheetItems', () => {
    it('excludes items already in bottomNavItems', () => {
      const bottomPaths = bottomNavItems.map((item) => item.href)
      const sheetPaths = mobileSheetItems.map((item) => item.href)

      sheetPaths.forEach((path) => {
        expect(bottomPaths).not.toContain(path)
      })
    })

    it('contains remaining nav items', () => {
      // Every primary item fits in the four-tab bottom bar, so the sheet has
      // no secondary Navigation section; it carries Quick Access only.
      expect(mobileSheetItems).toEqual([])
    })
  })

  describe('profileMenuItems', () => {
    it('groups configuration under Settings across all app shells', () => {
      const labels = profileMenuItems.map((item) => item.label)
      expect(labels).toEqual(['Settings', 'AI Agent'])
      expect(labels).not.toContain('Action Center')
      expect(labels).not.toContain('Broker Account')
      expect(labels).not.toContain('Sandbox')
      expect(labels).not.toContain('Orderbook')
      expect(labels).not.toContain('Tradebook')
      expect(labels).not.toContain('Positions')
      expect(labels).not.toContain('Master Contract')
      expect(labels).not.toContain('PnL Tracker')
      expect(labels).not.toContain('Scalping')
      expect(profileMenuItems.every((item) => item.description)).toBe(true)
    })
  })

  describe('isActiveRoute', () => {
    it('returns true for exact matches', () => {
      expect(isActiveRoute('/dashboard', '/dashboard')).toBe(true)
      expect(isActiveRoute('/orderbook', '/orderbook')).toBe(true)
      expect(isActiveRoute('/positions', '/positions')).toBe(true)
    })

    it('returns false for non-matching routes', () => {
      expect(isActiveRoute('/dashboard', '/orderbook')).toBe(false)
      expect(isActiveRoute('/positions', '/holdings')).toBe(false)
    })

    it('does not prefix match unrelated routes', () => {
      expect(isActiveRoute('/dashboard/sub', '/dashboard')).toBe(false)
      expect(isActiveRoute('/orderbookextra', '/orderbook')).toBe(false)
    })

    it('keeps Workspace active for nested profile routes', () => {
      expect(isActiveRoute('/workspace/profiles/12/journal', '/workspace')).toBe(true)
      expect(isActiveRoute('/workspaceold', '/workspace')).toBe(false)
    })

    it('keeps Automation active for its own nested routes only', () => {
      expect(isActiveRoute('/flow/editor/1', '/flow')).toBe(true)
      expect(isActiveRoute('/flow-other', '/flow')).toBe(false)
    })

    it('keeps Settings active throughout existing configuration and data routes', () => {
      for (const path of [
        '/settings',
        '/settings/connections',
        '/profile',
        '/apikey',
        '/admin/diagnostics',
        '/historify/charts/AAPL',
        '/agent/config',
        '/leverage',
      ]) {
        expect(isActiveRoute(path, '/settings')).toBe(true)
      }
      for (const path of ['/settings-other', '/agent', '/workspace/profiles/1/settings']) {
        expect(isActiveRoute(path, '/settings')).toBe(false)
      }
    })
  })
})
