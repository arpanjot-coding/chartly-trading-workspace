import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.skip(
  process.env.CHARTLY_BUILT_SMOKE !== '1',
  'Requires the synthetic Flask fixture and built frontend.'
)

test('opens and replays saved candles, returns to the filtered journal, and exports the book', async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(60_000)
  const origin = new URL(baseURL!).origin
  await page.route((url) => url.origin !== origin, (route) => route.abort())
  await page.goto('/workspace')
  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(navigation.getByRole('link')).toHaveText(['Workspace', 'Automation'])

  const portfolio = page.getByRole('article').filter({ hasText: 'Release smoke portfolio' })
  await portfolio.getByRole('link', { name: 'Journal', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace\/profiles\/1\/journal$/)
  await page.getByRole('button', { name: 'Trades', exact: true }).click()
  const search = page.getByRole('textbox', { name: 'Search trades' })
  await search.fill('EXAMPLE')
  const tradeLog = page.getByRole('table', { name: 'Trade log' })
  await expect(tradeLog.getByText('EXAMPLE', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Open chart', exact: true }).click()
  await expect(page).toHaveURL(/\/trading\?/)
  await expect(page.getByText(/^Financial chart, 48 bars\b/)).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Replay', exact: true }).click()
  const startBar = page.getByRole('button', { name: 'Choose earlier replay start bar' })
  await expect(startBar).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Start replay', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  const position = page.getByRole('slider', { name: 'Replay position' })
  await expect(position).toBeVisible()
  const before = Number(await position.inputValue())
  await page.getByRole('button', { name: 'Next observation' }).press('Enter')
  await expect(position).toHaveValue(String(before + 1))
  await page.getByRole('button', { name: 'Stop replay' }).click()
  await page.getByRole('button', { name: 'Leave', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Workspace replay' })).toBeHidden()

  await page.getByRole('link', { name: 'Back to Release smoke portfolio journal' }).click()
  await expect(page).toHaveURL(/\/workspace\/profiles\/1\/journal\?tab=Trades&q=EXAMPLE$/)
  await expect(search).toHaveValue('EXAMPLE')
  await expect(tradeLog.getByText('EXAMPLE', { exact: true })).toBeVisible()

  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export full book JSON', exact: true }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/^chartly-book-.+\.json$/)
  const exportPath = testInfo.outputPath('journal-export.json')
  await download.saveAs(exportPath)
  const exported = JSON.parse(await readFile(exportPath, 'utf8'))
  expect(exported).toMatchObject({
    format: 'chartly-journal-export',
    version: 1,
    portfolioId: 1,
    trades: [{ pair: 'EXAMPLE', result: 'Open', amounts: { quantity: '10' } }],
  })
})
