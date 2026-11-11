import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chartStorageAccount, useAuthStore } from '@/stores/authStore'
import { FullWidthLayout, LocalChartLayout } from './FullWidthLayout'

vi.mock('@/components/socket/SocketProvider', () => ({
  SocketProvider: ({ children }: { children: React.ReactNode }) => children,
}))
beforeEach(() =>
  useAuthStore.setState({ isAuthenticated: false, isLocalAuthenticated: false, user: null })
)
function route(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<LocalChartLayout />}>
          <Route path="/trading" element={<h1>Original chart</h1>} />
          <Route path="/historify/charts" element={<h1>Saved dataset chart</h1>} />
        </Route>
        <Route element={<FullWidthLayout />}>
          <Route path="/agent" element={<h1>Broker app</h1>} />
        </Route>
        <Route path="/login" element={<SignInTarget />} />
      </Routes>
    </MemoryRouter>
  )
}
function SignInTarget() {
  const location = useLocation()
  return (
    <>
      <h1>Local sign in</h1>
      <output aria-label="Requested local destination">
        {new URLSearchParams(location.search).get('next')}
      </output>
    </>
  )
}
describe('local chart access remains separate from broker access', () => {
  it('keeps the same durable chart identity after an account rename', () => {
    const uid = 'principal_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    useAuthStore.getState().setLocalAccount('alice', uid)
    expect(chartStorageAccount(useAuthStore.getState())).toBe(uid)
    useAuthStore.getState().setLocalAccount('renamed-alice', uid)
    expect(chartStorageAccount(useAuthStore.getState())).toBe(uid)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
  it('opens the original chart for local-only authentication without a banner strip', () => {
    useAuthStore.getState().setLocalAccount('alice')
    route('/trading')
    expect(screen.getByRole('heading', { name: 'Original chart' })).toBeInTheDocument()
    expect(screen.queryByText(/Local chart workspace/)).not.toBeInTheDocument()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
  it('opens full-width surfaces (agent, AI configuration) for a verified local account', () => {
    useAuthStore.getState().setLocalAccount('alice')
    route('/agent')
    expect(screen.getByRole('heading', { name: 'Broker app' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Local sign in' })).not.toBeInTheDocument()
  })
  it('preserves an exact dataset deep link through local sign-in without selecting a broker', () => {
    const target =
      '/historify/charts?datasetVersionId=version-one&returnTo=%2Fworkspace%2Fprofiles%2F7%2Freplay'
    route(target)
    expect(screen.getByLabelText('Requested local destination')).toHaveTextContent(target)
    expect(screen.queryByRole('heading', { name: 'Saved dataset chart' })).not.toBeInTheDocument()
  })
})
