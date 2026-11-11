import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Navbar } from './Navbar'

vi.mock('@/hooks/useProfileMenuItems', () => ({
  useProfileMenuItems: () => [
    {
      href: '/profile',
      label: 'Profile',
      icon: () => null,
    },
  ],
}))

function renderNavbar(pathname: string, props: { fluid?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Navbar {...props} />
    </MemoryRouter>
  )
}

function currentLinks(container: HTMLElement) {
  return within(container)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
}

describe('Navbar', () => {
  it('marks Workspace current for a nested profile journal and has no global Journal link', () => {
    renderNavbar('/workspace/profiles/12/journal')

    expect(screen.queryByRole('link', { name: 'Journal' })).not.toBeInTheDocument()
    const workspace = screen.getByRole('link', { name: 'Workspace' })

    expect(workspace).toHaveAttribute('aria-current', 'page')
    const desktopNav = screen
      .getAllByRole('navigation')
      .find((nav) => nav.classList.contains('md:flex'))

    expect(desktopNav).toBeDefined()
    expect(currentLinks(desktopNav!)).toEqual([workspace])
  })

  it('keeps only light/dark in account controls, not broker or global Live/Analyze mode', () => {
    renderNavbar('/workspace')

    expect(screen.queryByText(/zerodha/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Live', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByText('Analyze', { exact: true })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /switch to (analyze|live) mode/i })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /switch to (dark|light) mode/i })).toBeInTheDocument()
  })

  it('omits the secondary sheet nav when every primary item is in the bottom bar', async () => {
    const user = userEvent.setup()
    renderNavbar('/workspace')

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))

    const sheet = await screen.findByRole('dialog', { name: 'Navigation Menu' })
    expect(within(sheet).queryByText('Navigation')).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('link', { name: 'Agent' })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('link', { name: 'Tools' })).not.toBeInTheDocument()
  })

  it('marks the active quick-access sheet link as current', async () => {
    const user = userEvent.setup()
    renderNavbar('/profile')

    await user.click(screen.getByRole('button', { name: 'Toggle menu' }))

    const sheet = await screen.findByRole('dialog', { name: 'Navigation Menu' })
    const profile = within(sheet).getByRole('link', { name: 'Profile' })

    expect(profile).toHaveAttribute('aria-current', 'page')
    expect(currentLinks(sheet)).toEqual([profile])
  })
})

describe('Direct primary navigation', () => {
  it('shows Workspace and Automation', () => {
    renderNavbar('/workspace')
    expect(screen.getByRole('link', { name: 'Chartly home' })).toHaveAttribute('href', '/')
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(['Workspace', 'Automation'])
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fundamentals' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Workflows' })).not.toBeInTheDocument()
  })

  it('marks Workspace active on nested profile routes', () => {
    renderNavbar('/workspace/profiles/7/journal')
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Workspace' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('keeps Automation active on the approvals and executions page', () => {
    renderNavbar('/action-center')
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Automation' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })
})

describe('Navbar width', () => {
  /**
   * The bar itself is always w-full; what changes is the inner wrapper. Pages
   * under Layout share its `container mx-auto`, so the default has to keep
   * that or every ordinary page's nav stops lining up with its content.
   * Full-bleed pages like /trading render this navbar themselves with no such
   * container, and a capped nav floats inset above an edge-to-edge chart.
   */
  function innerWrapper(container: HTMLElement) {
    const nav = container.querySelector('nav')
    if (!nav) throw new Error('no nav element rendered')
    return nav.firstElementChild as HTMLElement
  }

  it('is centred and width-capped by default, matching Layout', () => {
    const { container } = renderNavbar('/dashboard')
    const inner = innerWrapper(container)

    expect(inner.className).toContain('container')
    expect(inner.className).toContain('mx-auto')
    expect(inner.className).not.toContain('w-full')
  })

  it('spans the viewport when fluid, for full-bleed pages', () => {
    const { container } = renderNavbar('/trading', { fluid: true })
    const inner = innerWrapper(container)

    expect(inner.className).toContain('w-full')
    expect(inner.className).not.toContain('container')
    expect(inner.className).not.toContain('mx-auto')
  })
})
