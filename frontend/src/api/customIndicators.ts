import { fetchCSRFToken } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'

export interface CustomIndicatorFile {
  file: string
  bytes: number
  mtime: number
}

export interface CustomIndicatorDetail extends CustomIndicatorFile {
  source: string
}

export class CustomIndicatorError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 0) {
    super(message)
    this.name = 'CustomIndicatorError'
    this.code = code
    this.status = status
  }
}

const BASE = '/api/local/v1/custom-indicators'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const principal = useAuthStore.getState().localPrincipalId
  const headers = new Headers(init.headers)
  if (principal) headers.set('X-Chartly-Principal', principal)
  const method = (init.method ?? 'GET').toUpperCase()
  if (method !== 'GET') {
    const csrf = await fetchCSRFToken()
    if (!csrf)
      throw new CustomIndicatorError('csrf.unavailable', 'Sign in again to save indicators.')
    headers.set('X-CSRFToken', csrf)
  }
  if (init.body) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch {
    throw new CustomIndicatorError(
      'indicator.offline',
      'The local engine is unavailable. Your draft is retained; reconnect and retry.'
    )
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string }
    }
    const error = data.error ?? {}
    throw new CustomIndicatorError(
      error.code ?? 'indicator.request_failed',
      error.message ?? `Indicator request failed (${response.status}).`,
      response.status
    )
  }
  return (await response.json()) as T
}

export const customIndicatorsClient = {
  list: () =>
    request<{ indicators: CustomIndicatorFile[]; count: number }>('/').then((r) => r.indicators),
  read: (file: string) =>
    request<{ indicator: CustomIndicatorDetail }>(`/${encodeURIComponent(file)}`).then(
      (r) => r.indicator
    ),
  create: (filename: string, source: string) =>
    request<{ saved: { file: string; bytes: number; replaced: boolean } }>('/', {
      method: 'POST',
      body: JSON.stringify({ filename, source }),
    }).then((r) => r.saved),
  update: (file: string, source: string) =>
    request<{ saved: { file: string; bytes: number; replaced: boolean } }>(
      `/${encodeURIComponent(file)}`,
      { method: 'PUT', body: JSON.stringify({ source }) }
    ).then((r) => r.saved),
  /** Stage a draft server-side so the validator can import it same-origin. */
  stagePreview: (source: string) =>
    request<{ preview: { url: string; expiresInSeconds: number } }>('/preview', {
      method: 'POST',
      body: JSON.stringify({ source }),
    }).then((r) => r.preview.url),
  remove: (file: string) =>
    request<{ removed: { file: string; deleted: boolean } }>(`/${encodeURIComponent(file)}`, {
      method: 'DELETE',
    }).then((r) => r.removed),
  /** The portable SKILL.md a user hands to their own LLM. */
  async downloadSkill(): Promise<void> {
    const principal = useAuthStore.getState().localPrincipalId
    const headers = new Headers()
    if (principal) headers.set('X-Chartly-Principal', principal)
    const response = await fetch(`${BASE}/skill`, { headers, credentials: 'include' })
    if (!response.ok)
      throw new CustomIndicatorError(
        'indicator.request_failed',
        `The skill file could not be downloaded (${response.status}).`,
        response.status
      )
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'chartly-indicators-SKILL.md'
    anchor.click()
    URL.revokeObjectURL(url)
  },
}
