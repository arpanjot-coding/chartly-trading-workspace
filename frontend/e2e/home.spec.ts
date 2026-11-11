import { expect, test } from '@playwright/test'

const title = 'Chart the market. Practise before you trade.'

test('explores the chart, separate paper and live experiences, and journal without signing in', async ({
  page,
}) => {
  const sessionRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/auth/session-status') {
      sessionRequests.push(request.url())
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  const expectPreview = async (name: RegExp) => {
    const image = page.getByRole('img', { name })
    await image.scrollIntoViewIfNeeded()
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0)
  }
  await expectPreview(/Chartly candlestick chart with EMA and RSI/)

  await page.getByRole('link', { name: 'Explore paper replay' }).click()
  await expect(page).toHaveURL(/#paper-trading$/)
  const replay = page.getByRole('region', { name: 'Backtest a setup candle by candle.' })
  await expect(replay.getByRole('list', { name: 'Replay workflow' })).toBeVisible()
  await expectPreview(/BTCUSD replay chart with an isolated paper account/)
  const paperTab = replay.getByRole('tab', { name: 'Paper account' })
  await paperTab.focus()
  await paperTab.press('ArrowRight')
  await expect(replay.getByRole('tab', { name: 'Replay controls' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expectPreview(/Chart replay showing historical candles/)

  const nav = page.getByRole('navigation', { name: 'Product navigation' })
  await nav.getByRole('link', { name: 'Live trading' }).click()
  await expect(page).toHaveURL(/#live-trading$/)
  await expectPreview(/sample MetaTrader 5 balances/)
  await nav.getByRole('link', { name: 'Journal', exact: true }).click()
  await expectPreview(/Trade Journal showing book filters/)
  await page.getByRole('tab', { name: 'Trade log' }).click()
  await expectPreview(/Journal trade log with sample entries/)

  for (const [link, hash] of [
    ['Data & connections', 'connections'],
    ['Workflows', 'workflows'],
  ] as const) {
    await nav.getByRole('link', { name: link }).click()
    await expect(page).toHaveURL(new RegExp(`#${hash}$`))
  }
  expect(sessionRequests).toHaveLength(0)
})

test('opens the trading workspace from the product homepage', async ({ page }) => {
  await page.goto('/')
  const hero = page.getByRole('region', { name: title })
  await hero.getByRole('link', { name: 'Open workspace' }).click()
  await expect(page).toHaveURL(/\/workspace$/)
  await expect(page.getByRole('heading', { name: 'Trading profiles' })).toBeVisible()
})

test('serves public content in HTML and keeps the workspace shell out of search', async ({ request }) => {
  test.skip(process.env.CHARTLY_BUILT_SMOKE !== '1', 'Requires the built frontend served by Flask')

  const routes = [
    ['/', 'Chartly | Manual Backtesting, Paper Trading &amp; MT5 Charts', 'Practise before you trade.'],
    ['/guides/backtesting-software', 'Manual Backtesting Software', 'Manual backtesting with candle replay'],
    ['/guides/mt5-charts', 'MetaTrader 5 Charts', 'MT5 charts with your account in view'],
    ['/guides/chart-indicators', 'Trading Chart Indicators', 'Trading chart indicators and drawings'],
    ['/guides/tradingview-alternative', 'TradingView Alternative for Self-Hosted Charts', 'Chartly and TradingView for charting and replay'],
  ]
  for (const [path, titleText, heading] of routes) {
    const response = await request.get(path)
    expect(response.status()).toBe(200)
    expect(response.headers()['x-robots-tag']).toBeUndefined()
    const html = await response.text()
    expect(html).toContain(`<title>${titleText}`)
    expect(html).toMatch(/<h1\b/)
    expect(html).toContain(heading)
    expect(html).toContain('name="description"')
    expect(html).toContain('property="og:title"')
  }

  const workspace = await request.get('/workspace')
  expect(workspace.headers()['x-robots-tag']).toBe('noindex')
  expect(await workspace.text()).not.toContain('data-prerendered="true"')
  expect((await request.get('/guides/unknown-guide')).status()).toBe(404)
})
