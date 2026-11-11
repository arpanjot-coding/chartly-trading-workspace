import { expect, type Page, test } from '@playwright/test'

/**
 * The direct primary navigation must fit with the account controls. The centered
 * container and system fonts vary with viewport, so measure the rendered row.
 *
 * These run against the Vite dev server with no Flask backend, so the session
 * endpoint is stubbed; everything else is allowed to fail, which AuthSync
 * already tolerates.
 */

const SESSION_STATUS = {
  status: 'success',
  logged_in: true,
  authenticated: true,
  broker: 'angel',
  username: 'e2e',
  active_sessions: 1,
}

async function signedIn(page: Page) {
  await page.route('**/auth/session-status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION_STATUS) })
  )
}

/** Widths either side of every breakpoint the bar reacts to. */
const WIDTHS = [768, 1023, 1024, 1279, 1280, 1366, 1440, 1470, 1535, 1536, 1728, 1920]

test.describe('Navbar fits the space it has', () => {
  for (const width of WIDTHS) {
    test(`does not overflow at ${width}px`, async ({ page }) => {
      await signedIn(page)
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/workspace')

      const row = page.getByTestId('navbar-row')
      await expect(row).toBeVisible()

      const { scrollWidth, clientWidth } = await row.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }))

      expect(
        scrollWidth,
        `navbar row is ${scrollWidth - clientWidth}px wider than its ${clientWidth}px of space`
      ).toBeLessThanOrEqual(clientWidth)
    })
  }

  test('keeps the right-hand controls inside the bar at the tightest width', async ({ page }) => {
    await signedIn(page)
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto('/workspace')

    const row = page.getByTestId('navbar-row')
    await expect(row).toBeVisible()

    // When the row overflows it is the controls on the right, not the nav
    // items, that get pushed past the edge -- so measure those.
    const overhang = await row.evaluate((el) => {
      const right = el.getBoundingClientRect().right
      const controls = el.lastElementChild
      if (!controls) return 0
      return Math.round(controls.getBoundingClientRect().right - right)
    })

    expect(overhang, `right-hand controls hang ${overhang}px past the bar`).toBeLessThanOrEqual(1)
  })

  test('keeps Workspace and Automation visible without a More dropdown', async ({ page }) => {
    await signedIn(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/workspace')

    await expect(page.getByTestId('navbar-row')).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    await expect(nav.getByRole('link')).toHaveText(['Workspace', 'Automation'])
    await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0)
  })
})
