import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5000'
const OUT = '../docs/plans/chartly-professional-platform/p19/evidence/screenshots'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
page.setDefaultTimeout(45000)
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('CONSOLE', msg.text().slice(0, 300))
})
await page.goto(`${BASE}/workspace`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
await page.screenshot({ path: `${OUT}/aa-workspace.png` })
const text = await page.locator('body').innerText()
console.log(text.slice(0, 3000))
const links = await page.locator('a').evaluateAll((els) =>
  els.map((el) => ({ text: el.textContent?.trim(), href: el.getAttribute('href') })).filter((x) => x.text || x.href)
)
console.log('LINKS', JSON.stringify(links.slice(0, 80), null, 1))
await browser.close()
