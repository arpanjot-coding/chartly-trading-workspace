import { render, screen } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { bottomNavItems } from '@/config/navigation'
import { MobileBottomNav } from './MobileBottomNav'

expect.extend(toHaveNoViolations)

// Custom render with router that allows setting initial path
function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MobileBottomNav />
    </MemoryRouter>
  )
}

describe('MobileBottomNav', () => {
  it('renders all navigation items', () => {
    renderWithRouter('/dashboard')

    bottomNavItems.forEach((item) => {
      expect(screen.getByText(item.label)).toBeInTheDocument()
    })
  })

  it('renders as a nav element', () => {
    renderWithRouter('/dashboard')

    const nav = screen.getByRole('navigation')
    expect(nav).toBeInTheDocument()
  })

  it('renders links for each nav item', () => {
    renderWithRouter('/dashboard')

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(bottomNavItems.length)
  })

  it('has correct link hrefs', () => {
    renderWithRouter('/dashboard')

    bottomNavItems.forEach((item) => {
      const link = screen.getByRole('link', { name: new RegExp(item.label, 'i') })
      expect(link).toHaveAttribute('href', item.href)
    })
  })

  describe('active state', () => {
    it('highlights Workspace when on workspace route', () => {
      renderWithRouter('/workspace')

      const workspaceLink = screen.getByRole('link', { name: /workspace/i })
      expect(workspaceLink).toHaveClass('text-primary')
      expect(workspaceLink).toHaveAttribute('aria-current', 'page')
    })

    it('highlights Workspace when on a profile journal route', () => {
      renderWithRouter('/workspace/profiles/12/journal')

      expect(screen.queryByRole('link', { name: /journal/i })).not.toBeInTheDocument()
      const workspaceLink = screen.getByRole('link', { name: /workspace/i })
      expect(workspaceLink).toHaveClass('text-primary')
    })

    it('keeps Workspace and Automation in mobile navigation', () => {
      renderWithRouter('/flow')

      expect(screen.getByRole('link', { name: /automation/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /workspace/i })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /strategy builder/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /fundamentals/i })).not.toBeInTheDocument()
    })

    it('non-active items have muted color', () => {
      renderWithRouter('/flow')

      const workspaceLink = screen.getByRole('link', { name: /workspace/i })
      expect(workspaceLink).toHaveClass('text-muted-foreground')
    })
  })

  describe('responsive visibility', () => {
    it('has md:hidden class for mobile-only display', () => {
      renderWithRouter('/dashboard')

      const nav = screen.getByRole('navigation')
      expect(nav).toHaveClass('md:hidden')
    })
  })

  describe('touch targets', () => {
    it('has minimum touch target size of 44px', () => {
      renderWithRouter('/dashboard')

      const links = screen.getAllByRole('link')
      links.forEach((link) => {
        expect(link).toHaveClass('min-h-[44px]')
      })
    })

    it('has touch-manipulation class for better touch response', () => {
      renderWithRouter('/dashboard')

      const links = screen.getAllByRole('link')
      links.forEach((link) => {
        expect(link).toHaveClass('touch-manipulation')
      })
    })
  })

  describe('accessibility', () => {
    it('has no accessibility violations', async () => {
      const { container } = renderWithRouter('/dashboard')

      const results = await axe(container)
      expect(results).toHaveNoViolations()
    })

    it('has accessible names for all links', () => {
      renderWithRouter('/dashboard')

      bottomNavItems.forEach((item) => {
        const link = screen.getByRole('link', { name: new RegExp(item.label, 'i') })
        expect(link).toBeInTheDocument()
      })
    })
  })
})
