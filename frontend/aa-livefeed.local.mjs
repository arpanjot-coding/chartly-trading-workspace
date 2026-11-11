import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5000'
const OUT = '../docs/plans/chartly-professional-platform/p19/evidence/screenshots'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.setDefaultTimeout(60000)
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('CONSOLE', msg.text().slice(0, 400))
})
page.on('response', (res) => {
  if (res.url().includes('/api/local/v1/market/')) console.log('MARKET', res.status(), res.url())
})
await page.goto(`${BASE}/trading?profileId=2&profileName=AA&profileKind=live`, {
  waitUntil: 'domcontentloaded',
})
await page.waitForTimeout(9000)
await page.screenshot({ path: `${OUT}/aa-before-livefeed.png` })
console.log('BEFORE', (await page.locator('body').innerText()).slice(0, 1800))

const choose = page.getByRole('button', { name: 'Choose live chart feed' })
if (await choose.count()) {
  await choose.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/aa-source-picker.png` })
  console.log('PICKER', (await page.locator('body').innerText()).slice(0, 2200))
  await page.getByLabel('Platform feed', { exact: true }).selectOption('mt5')
  await page.getByLabel('Venue symbol', { exact: true }).fill('EURUSD')
  await page.getByLabel('Timeframe', { exact: true }).selectOption('15m')
  await page.getByRole('button', { name: 'Use live feed' }).click()
  await page.waitForTimeout(15000)
} else {
  console.log('No empty-state choose button; chart may already have a source')
  await page.waitForTimeout(5000)
}
await page.screenshot({ path: `${OUT}/aa-live-mt5-chart.png` })
const after = await page.locator('body').innerText()
console.log('AFTER', after.slice(0, 2800))
for (const needle of ['Live platform feed', 'EURUSD', 'No API key', 'Chart data is not set up'])
  console.log(needle + ':', after.includes(needle))
await browser.close()
