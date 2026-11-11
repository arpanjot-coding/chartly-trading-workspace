import { fetchCSRFToken } from './client'

export interface WorkspaceProof {
  authenticated: boolean
  principal?: { uid: string; username: string; personal?: boolean }
  personalModeAvailable?: boolean
}

/** The server decides whether this is a personal PC or an account-based install. */
export async function openLocalWorkspace(signal?: AbortSignal): Promise<WorkspaceProof> {
  const read = await fetch('/auth/local-session', { credentials: 'include', signal })
  let proof = (await read.json()) as WorkspaceProof
  if (
    (read.status === 401 && proof.personalModeAvailable === true) ||
    (read.ok && proof.authenticated && proof.principal?.personal === true)
  ) {
    const token = await fetchCSRFToken()
    if (signal?.aborted) throw new DOMException('Workspace opening cancelled', 'AbortError')
    if (!token) throw new Error('The local workspace could not be opened. Reload and retry.')
    const opened = await fetch('/auth/local-workspace', {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': token },
      body: '{}',
    })
    if (!opened.ok) throw new Error('The local workspace could not be opened. Reload and retry.')
    proof = (await opened.json()) as WorkspaceProof
  } else if (!read.ok && read.status !== 401) {
    throw new Error('The workspace service is unavailable. Retry when it is running.')
  }
  if (
    proof.authenticated &&
    (!proof.principal ||
      !/^principal_[a-f0-9]{32}$/.test(proof.principal.uid) ||
      typeof proof.principal.username !== 'string' ||
      !proof.principal.username)
  ) {
    throw new Error('The saved workspace identity could not be verified.')
  }
  return proof
}
