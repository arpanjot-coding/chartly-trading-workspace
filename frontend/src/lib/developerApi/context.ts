export interface DeveloperApiObservation {
  provider: string | null
  routing: 'broker' | 'sandbox' | 'unknown'
}

export function developerApiOwnerKey(username?: string | null, principal?: string | null): string {
  return JSON.stringify([username ?? null, principal ?? null])
}

export function developerApiPrincipalHeaders(principal?: string | null): Record<string, string> {
  return principal ? { 'X-Chartly-Principal': principal } : {}
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function observeDeveloperApi(
  capabilities: unknown,
  routingStatus: unknown
): DeveloperApiObservation {
  const capabilityResponse = record(capabilities)
  const providerData =
    capabilityResponse?.status === 'success' ? record(capabilityResponse.data) : null
  const provider = providerData?.broker_name
  const routingResponse = record(routingStatus)
  const routingData = routingResponse?.status === 'success' ? record(routingResponse.data) : null
  return {
    provider:
      typeof provider === 'string' && provider.trim() && provider.length <= 200
        ? provider.trim()
        : null,
    routing:
      routingData?.analyze_mode === true
        ? 'sandbox'
        : routingData?.analyze_mode === false
          ? 'broker'
          : 'unknown',
  }
}

/** Keep the legacy routing diagnostic, but remove its global mutation from navigation. */
export function isGlobalRoutingControl(path: string): boolean {
  try {
    const pathname = new URL(path, 'http://chartly.local').pathname.replace(/\/+$/, '')
    return pathname === '/api/v1/analyzer/toggle' || pathname === '/auth/analyzer-toggle'
  } catch {
    return false
  }
}

export function isLegacyRoutingDiagnostic(path: string): boolean {
  try {
    return new URL(path, 'http://chartly.local').pathname.replace(/\/+$/, '') === '/api/v1/analyzer'
  } catch {
    return false
  }
}
