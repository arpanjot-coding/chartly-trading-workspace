import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import App from '@/App'
import { homeMetadata, publicGuides } from '@/config/publicPages'

export const publicPages = [
  { path: '/', ...homeMetadata },
  ...Object.entries(publicGuides).map(([slug, { title, description, image, imageAlt }]) => ({
    path: `/guides/${slug}`,
    title,
    description,
    image,
    imageAlt,
  })),
]

export function renderPublicPage(path: string) {
  return renderToString(
    <StrictMode>
      <App location={path} />
    </StrictMode>
  )
}
