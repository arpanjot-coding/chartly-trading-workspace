import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer, loadEnv } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = path.join(root, 'dist')
const appShell = await readFile(path.join(dist, 'index.html'), 'utf8')
const configuredUrl = (
  loadEnv('production', root, 'CHARTLY_PUBLIC_SITE_URL').CHARTLY_PUBLIC_SITE_URL ?? ''
).trim()
const siteUrl = configuredUrl ? new URL(configuredUrl) : null
if (
  siteUrl &&
  (siteUrl.protocol !== 'https:' ||
    siteUrl.pathname !== '/' ||
    siteUrl.username ||
    siteUrl.password ||
    siteUrl.search ||
    siteUrl.hash)
) {
  throw new Error('CHARTLY_PUBLIC_SITE_URL must be the HTTPS origin of the public Chartly site')
}

const escape = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const meta = (key, content) => `<meta ${key} content="${escape(content)}" />`

const server = await createServer({
  configFile: false,
  root,
  plugins: [react()],
  resolve: { alias: { '@': path.join(root, 'src') } },
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, ws: false, watch: null },
  appType: 'custom',
})
try {
  const { publicPages, renderPublicPage } = await server.ssrLoadModule('/src/public-prerender.tsx')
  const shell = appShell.replace(/\s*<meta name="description"[^>]*>/, '')
  if (!shell.includes('<title>Chartly</title>') || !shell.includes('<div id="root"></div>')) {
    throw new Error('Could not find the title and root in the Chartly app shell')
  }

  const documents = await Promise.all(
    publicPages.map(async ({ path: pagePath, title, description, image, imageAlt }) => {
      await access(path.join(dist, image))
      const tags = [
        `<title>${escape(title)}</title>`,
        meta('name="description"', description),
        meta('property="og:site_name"', 'Chartly'),
        meta('property="og:type"', pagePath === '/' ? 'website' : 'article'),
        meta('property="og:title"', title),
        meta('property="og:description"', description),
      ]
      if (siteUrl) {
        const url = new URL(pagePath, siteUrl).href
        tags.push(
          `<link rel="canonical" href="${escape(url)}" />`,
          meta('property="og:url"', url),
          meta('property="og:image"', new URL(image, siteUrl).href),
          meta('property="og:image:alt"', imageAlt),
          meta('name="twitter:card"', 'summary_large_image')
        )
        if (pagePath === '/') {
          const schema = {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'Chartly',
            url,
          }
          tags.push(`<script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`)
        }
      }
      const markup = renderPublicPage(pagePath)
      if (!markup.includes('<h1') || markup.includes('<!--$!-->')) {
        throw new Error(`Could not prerender ${pagePath}`)
      }
      const html = shell
        .replace('<title>Chartly</title>', () => tags.join('\n    '))
        .replace('<div id="root"></div>', () =>
          `<div id="root" data-prerendered="true">${markup}</div>`
        )
      return { directory: path.join(dist, pagePath), html }
    })
  )
  await writeFile(
    path.join(dist, 'app.html'),
    shell.replace('<title>Chartly</title>', '<title>Chartly</title>\n    <meta name="robots" content="noindex" />')
  )
  for (const { directory, html } of documents) {
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'index.html'), html)
  }
  let robots = 'User-agent: *\nAllow: /\n'
  if (siteUrl) {
    const urls = publicPages.map(({ path: pagePath }) => `  <url><loc>${escape(new URL(pagePath, siteUrl).href)}</loc></url>`)
    await writeFile(
      path.join(dist, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
    )
    robots += `Sitemap: ${new URL('/sitemap.xml', siteUrl).href}\n`
  }
  await writeFile(path.join(dist, 'robots.txt'), robots)
  console.log(`Prerendered ${documents.length} public Chartly pages`)
} finally {
  await server.close()
}
