import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import './index.css'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { installGlobalErrorReporter } from '@/utils/errorReporter'
import App from './App.tsx'

installGlobalErrorReporter()

const root = document.getElementById('root')!
const app = (
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)

if (root.dataset.prerendered === 'true') {
  hydrateRoot(root, app)
} else {
  createRoot(root).render(app)
}
